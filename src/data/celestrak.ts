import type { OMMJsonObject } from 'satellite.js';
import { classify, shortId, type ConstellationId } from './constellations';

export interface SatelliteRecord {
  omm: OMMJsonObject;
  name: string;
  shortId: string;
  noradId: number;
  constellation: ConstellationId;
}

export type DataState = 'loading' | 'fresh' | 'stale' | 'error';
/** 状態の詳細。表示文は i18n の status.<code> で組み立てる */
export type StatusCode = 'loading' | 'fresh' | 'staleFetch' | 'staleEpochs' | 'cacheAfterError' | 'cacheAfterErrorDetail' | 'fetchError';

/** 取得失敗の理由。表示文は i18n の error.<reason> */
export type FetchErrorReason = 'offline' | 'timeout' | 'http' | 'network' | 'data';

export interface DataStatus {
  state: DataState;
  /** 表示できる軌道データ（キャッシュを含む）があるか */
  hasData: boolean;
  /** 取得中か */
  fetching: boolean;
  /**
   * 自動取得を止めているか（正常でない応答、または応答なしが続いたとき）。
   * 利用ポリシーに従い、利用者が再試行するまで自動では問い合わせない。
   */
  stopped: boolean;
  /** 次の自動取得の時刻（失敗後の再試行、または他の問い合わせからの間隔待ち） */
  nextRetryAt: Date | null;
  /** 手動の再試行ができるようになる時刻 */
  manualRetryAt: Date | null;
  /** 取得（ダウンロード）時刻 */
  fetchedAt: Date | null;
  /** 軌道要素エポックの最古値 */
  oldestEpoch: Date | null;
  /** 直近の取得が失敗しキャッシュで代替している */
  usingCacheAfterError: boolean;
  code: StatusCode;
  /** 取得からの経過時間（staleFetch）やエラー内容など、表示文の差し込み値 */
  params: Record<string, string | number>;
  counts: Partial<Record<ConstellationId, number>>;
}

/**
 * 取得元。開発サーバーでは、CelesTrak への問い合わせを抑える
 * ディスクキャッシュ付きの中継（scripts/vite-celestrak-cache.ts）を通す。
 */
const SOURCE_URL = import.meta.env.DEV
  ? '/dev-celestrak/gnss.json'
  : 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=json';

/*
 * CelesTrak の利用ポリシー（https://celestrak.org/usage-policy.php）への対応:
 * - 1 時間に 1 回より多く問い合わせない。成否・自動／手動を問わず、問い合わせ同士は必ず 1 時間以上空ける
 *   （データは約 2 時間ごとの更新なので、成功後の定期取得は 2 時間ごと）
 * - 正常でない応答（301/403/404/429/50x、不正なデータ）を受けたら自動の問い合わせを即座に止め、人に知らせる
 * - 応答が無い（タイムアウト・接続失敗。遮断されている場合や CORS ヘッダーの無いエラー応答もこう見える）
 *   ことが続いたら、同様に止める
 * 再読み込みや複数の壁紙インスタンスでも守れるよう、問い合わせの記録は localStorage で共有し、
 * 問い合わせはブラウザの排他ロック（Web Locks）の中で記録を読み直してから行う。
 * localStorage が使えない環境でも、このインスタンスの中ではメモリ上の記録で守る。
 */
const CACHE_KEY = 'gnss-viewer.omm-cache.v1';
const FETCH_STATE_KEY = 'gnss-viewer.fetch-state.v1';
const LEGACY_BACKOFF_KEY = 'gnss-viewer.backoff-until.v1';
const LOCK_NAME = 'gnss-viewer.celestrak-fetch';
/** 問い合わせ同士の最小間隔（自動・手動・失敗後の再試行すべて） */
const MIN_REQUEST_GAP_MS = 3600_000;
/** 取得に成功してから次に取りに行くまでの間隔 */
const REFRESH_INTERVAL_MS = 2 * 3600_000;
/** 応答なしがこの回数続いたら自動取得を止める */
const MAX_NO_RESPONSE_FAILURES = 3;
/** 自動取得をわずかにずらし、複数インスタンスが同時に取りに行かないようにする */
const AUTO_JITTER_MS = 30_000;
/** 応答が無いときに諦めるまでの時間 */
const FETCH_TIMEOUT_MS = 20_000;
/** 軌道要素エポックがこれより古い衛星が多い場合は「古い」とみなす */
const STALE_EPOCH_MS = 3 * 86400_000;
/** 取得自体がこれより古い場合も「古い」とみなす */
const STALE_FETCH_MS = 24 * 3600_000;
/** 自動取得の時刻になったか確かめる間隔の上限（長時間のスリープ復帰などに備える） */
const MAX_TIMER_MS = 15 * 60_000;

interface LastError {
  reason: FetchErrorReason;
  httpStatus?: number;
}

/** 同じ PC の全インスタンスで共有する問い合わせの記録 */
interface FetchState {
  /** 最後に CelesTrak へ問い合わせた時刻（成否を問わない） */
  lastRequestAt: number;
  /** 応答が無かった連続回数 */
  failures: number;
  /** 自動取得を止めた時刻（止まっていなければ 0） */
  stoppedAt: number;
  /** サーバーが Retry-After で指定した待ち時間 */
  retryAfterMs: number;
  lastError: LastError | null;
}

const EMPTY_STATE: FetchState = { lastRequestAt: 0, failures: 0, stoppedAt: 0, retryAfterMs: 0, lastError: null };

/**
 * 問い合わせ記録の読み書き。localStorage が使えない・壊れている場合に備えてメモリ上にも同じ記録を持ち、
 * 読むときは新しい方（lastRequestAt が大きい方）を採用する。
 */
class FetchStateStore {
  private mem: FetchState = { ...EMPTY_STATE };

  read(): FetchState {
    let stored: FetchState | null = null;
    try {
      const s = JSON.parse(localStorage.getItem(FETCH_STATE_KEY) ?? 'null') as Partial<FetchState> | null;
      if (s && typeof s.lastRequestAt === 'number') stored = { ...EMPTY_STATE, ...s };
    } catch {
      /* 読めない場合はメモリ上の記録を使う */
    }
    // 同じ時刻ならメモリ側を優先する（結果の書き込みだけが失敗した場合に停止状態を失わないため。
    // 他のインスタンスは必ずより新しい lastRequestAt で書く）
    const s = stored && stored.lastRequestAt > this.mem.lastRequestAt ? stored : { ...this.mem };
    // 時計が戻った場合に、未来の時刻のせいで手動でも再開できなくなるのを防ぐ。
    // 切り詰めた値は保存し直す（保存しないと読むたびに now に寄って期限が先へ延び続ける）
    const now = Date.now();
    if (s.lastRequestAt > now || s.stoppedAt > now) {
      const fixed = { ...s, lastRequestAt: Math.min(s.lastRequestAt, now), stoppedAt: Math.min(s.stoppedAt, now) };
      this.write(fixed);
      return fixed;
    }
    return s;
  }

  write(s: FetchState): void {
    this.mem = { ...s };
    try {
      localStorage.setItem(FETCH_STATE_KEY, JSON.stringify(s));
    } catch {
      /* 保存できない環境ではメモリ上の記録だけで守る */
    }
  }
}

class FetchError extends Error {
  constructor(
    readonly reason: FetchErrorReason,
    readonly httpStatus?: number,
    readonly retryAfterMs?: number,
  ) {
    super(httpStatus ? `${reason} ${httpStatus}` : reason);
  }
}

/** Retry-After（秒数または日時）を ms に変換する。CORS で読めない場合は undefined */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const sec = Number(value);
  if (Number.isFinite(sec)) return sec * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

function classifyError(e: unknown): FetchError {
  if (e instanceof FetchError) return e;
  if (!navigator.onLine) return new FetchError('offline');
  if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) return new FetchError('timeout');
  return new FetchError('network');
}

/**
 * 他のインスタンスと排他して fn を実行する。ロックを取れなければ（取得中のインスタンスがあれば）実行せず false。
 * Web Locks が無い環境では排他せずに実行する（localStorage の記録とずらし量で抑える）
 */
async function withFetchLock(fn: () => Promise<void>): Promise<boolean> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) {
    await fn();
    return true;
  }
  let ran = false;
  try {
    await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      ran = true;
      await fn();
    });
  } catch {
    // ロック API 自体が使えない環境（不透明オリジンなど）では排他せずに実行する
    if (!ran) {
      await fn();
      ran = true;
    }
  }
  return ran;
}

interface CacheEntry {
  fetchedAt: number;
  records: OMMJsonObject[];
}

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CacheEntry;
    return Array.isArray(c.records) && typeof c.fetchedAt === 'number' ? c : null;
  } catch {
    return null;
  }
}

function writeCache(entry: CacheEntry): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* 容量超過などは無視 */
  }
}

function parseEpoch(epoch: string): Date {
  // CelesTrak の EPOCH はタイムゾーン無しの UTC
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(epoch) ? epoch : `${epoch}Z`);
}

function toRecords(omms: OMMJsonObject[]): SatelliteRecord[] {
  const out: SatelliteRecord[] = [];
  for (const omm of omms) {
    const c = classify(omm.OBJECT_NAME);
    if (!c) continue;
    const name = omm.OBJECT_NAME.replace(/\s+/g, ' ').trim();
    out.push({ omm, name, shortId: shortId(name, c), noradId: Number(omm.NORAD_CAT_ID), constellation: c });
  }
  return out;
}

export class OrbitDataSource {
  private fetchedAt = 0;
  private epochs: number[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | null = null;
  private store = new FetchStateStore();
  /** 取得すべき時刻なのにオフラインで待っている（問い合わせはしていない） */
  private waitingOffline = false;
  private disposed = false;
  /** 他インスタンスが取得中でロックを取れなかったとき、この時刻までは試し直さない */
  private lockBusyUntil = 0;
  /** このインスタンスの自動取得のずらし量 */
  private jitter = Math.random() * AUTO_JITTER_MS;
  status: DataStatus = {
    state: 'loading',
    hasData: false,
    fetching: false,
    stopped: false,
    nextRetryAt: null,
    manualRetryAt: null,
    fetchedAt: null,
    oldestEpoch: null,
    usingCacheAfterError: false,
    code: 'loading',
    params: {},
    counts: {},
  };

  constructor(
    private onData: (records: SatelliteRecord[]) => void,
    private onStatus: (status: DataStatus) => void,
  ) {}

  start(): void {
    try {
      localStorage.removeItem(LEGACY_BACKOFF_KEY);
    } catch {
      /* 旧版の待機記録は不要 */
    }
    // 他のインスタンスが取得・停止したら、その結果を取り込む
    window.addEventListener('storage', (e) => {
      if (e.key === CACHE_KEY || e.key === FETCH_STATE_KEY) this.tick();
    });
    window.addEventListener('online', () => this.tick());
    this.tick();
  }

  stop(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }

  /** 利用者による再試行（お知らせのボタン・設定パネル）。間隔が空いていなければ何もしない */
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const now = Date.now();
    if (now < this.lockBusyUntil || now < this.manualAllowedAt(this.store.read())) return Promise.resolve();
    return this.request(true);
  }

  /** 次に自動で問い合わせてよい時刻。止まっている場合は Infinity */
  private autoAllowedAt(s: FetchState): number {
    if (s.stoppedAt) return Infinity;
    if (!s.lastRequestAt) return 0;
    const gap = s.failures > 0 ? MIN_REQUEST_GAP_MS : REFRESH_INTERVAL_MS;
    return Math.max(s.lastRequestAt, this.fetchedAt) + gap;
  }

  /** 手動で問い合わせてよい時刻（止まっていても、問い合わせ同士は 1 時間以上空ける） */
  private manualAllowedAt(s: FetchState): number {
    const last = Math.max(s.lastRequestAt, s.stoppedAt);
    return last ? last + Math.max(MIN_REQUEST_GAP_MS, s.retryAfterMs) : 0;
  }

  /** 定期処理: 共有の記録を取り込み、時刻になっていれば自動で取得し、次の確認を予約する */
  private tick(): void {
    clearTimeout(this.timer);
    // 取得中は終わったとき（request の finally）に呼び直す
    if (this.inFlight || this.disposed) return;
    const state = this.syncFromShared();
    const now = Date.now();
    const due = this.autoAllowedAt(state);
    let wait = Number.isFinite(due) ? Math.max(1000, due - now) : MAX_TIMER_MS;
    if (now < this.lockBusyUntil) {
      wait = this.lockBusyUntil - now;
    } else if (now >= due) {
      if (navigator.onLine) {
        this.waitingOffline = false;
        // 初回（記録なし）以外は、インスタンスごとに少しずらしてから取りに行く
        const delay = state.lastRequestAt ? this.jitter : 0;
        if (delay > 0 && now < due + delay) wait = due + delay - now;
        else {
          void this.request(false);
          return;
        }
      } else {
        // オフラインの間は問い合わせず、online イベント（と念のための定期確認）で再開する
        this.waitingOffline = true;
        this.publish(state);
        wait = 60_000;
      }
    }
    this.timer = setTimeout(() => this.tick(), Math.min(wait, MAX_TIMER_MS));
  }

  /** 他のインスタンスが保存したキャッシュと問い合わせ記録を、このインスタンスの状態に反映する */
  private syncFromShared(): FetchState {
    const cache = readCache();
    if (cache && cache.fetchedAt > this.fetchedAt) this.apply(cache);
    const state = this.store.read();
    this.publish(state);
    return state;
  }

  private request(manual: boolean): Promise<void> {
    this.inFlight ??= withFetchLock(() => this.doRequest(manual))
      .then((ran) => {
        if (!ran) this.lockBusyUntil = Date.now() + 5000;
      })
      .catch(() => {
        // 想定外の失敗でも即座に繰り返さない
        this.lockBusyUntil = Date.now() + 60_000;
      })
      .finally(() => {
        this.inFlight = null;
        this.tick();
      });
    return this.inFlight;
  }

  private async doRequest(manual: boolean): Promise<void> {
    // ロックの中で記録を読み直し、まだ問い合わせてよいか確かめる（他インスタンスが直前に取った場合など）
    let state = this.store.read();
    const now = Date.now();
    if (now < (manual ? this.manualAllowedAt(state) : this.autoAllowedAt(state))) {
      this.publish(state);
      return;
    }
    // 問い合わせる前に記録し、他のインスタンスが同時に取りに行かないようにする。
    // 手動の再試行では停止の解除も同じ書き込みで行う
    state = { ...state, lastRequestAt: now, ...(manual ? { stoppedAt: 0, failures: 0, retryAfterMs: 0 } : {}) };
    this.store.write(state);
    this.status = { ...this.status, fetching: true };
    this.publish(state);
    try {
      const res = await fetch(SOURCE_URL, {
        cache: 'no-store',
        // リダイレクト（301 など）も「正常でない応答」として扱うため自動では追わない
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.type === 'opaqueredirect') throw new FetchError('http', 301);
      if (!res.ok) throw new FetchError('http', res.status, parseRetryAfter(res.headers.get('Retry-After')));
      let body: unknown;
      try {
        body = await res.json();
      } catch (e) {
        // JSON として読めない本文は不正なデータ。本文の受信途中の失敗は応答なしと同じ扱い
        throw e instanceof SyntaxError ? new FetchError('data') : e;
      }
      if (!Array.isArray(body) || body.length === 0) throw new FetchError('data');
      const entry: CacheEntry = { fetchedAt: Date.now(), records: body as OMMJsonObject[] };
      writeCache(entry);
      state = { ...state, failures: 0, stoppedAt: 0, retryAfterMs: 0, lastError: null };
      this.status = { ...this.status, fetching: false, usingCacheAfterError: false };
      this.apply(entry);
    } catch (e) {
      const err = classifyError(e);
      const lastError: LastError = { reason: err.reason, ...(err.httpStatus ? { httpStatus: err.httpStatus } : {}) };
      if (err.reason === 'http' || err.reason === 'data') {
        // サーバーが応答した上での異常: 自動の問い合わせを止め、人の判断を待つ
        state = { ...state, stoppedAt: Date.now(), failures: 0, retryAfterMs: err.retryAfterMs ?? 0, lastError };
      } else if (err.reason === 'offline') {
        // 端末側がオフラインになった失敗は CelesTrak に届いていないので数えない（1 時間の間隔は守る）
        state = { ...state, failures: Math.max(state.failures, 1), lastError };
      } else {
        // 応答なし: 1 時間空けて再試行し、続くようなら止める（遮断や CORS の無いエラー応答もこう見えるため）
        const failures = state.failures + 1;
        state = { ...state, failures, lastError, stoppedAt: failures >= MAX_NO_RESPONSE_FAILURES ? Date.now() : 0 };
      }
      this.status = { ...this.status, fetching: false, usingCacheAfterError: this.status.hasData };
    }
    this.store.write(state);
    this.publish(state);
  }

  private apply(entry: CacheEntry): void {
    const records = toRecords(entry.records);
    this.fetchedAt = entry.fetchedAt;
    const counts: DataStatus['counts'] = {};
    let oldest = Infinity;
    const epochs: number[] = [];
    for (const r of records) {
      counts[r.constellation] = (counts[r.constellation] ?? 0) + 1;
      const t = parseEpoch(r.omm.EPOCH).getTime();
      epochs.push(t);
      oldest = Math.min(oldest, t);
    }
    this.epochs = epochs;
    this.status = {
      ...this.status,
      hasData: records.length > 0,
      fetchedAt: new Date(entry.fetchedAt),
      oldestEpoch: Number.isFinite(oldest) ? new Date(oldest) : null,
      counts,
    };
    this.onData(records);
  }

  /** 共有の記録とデータの状態から、表示用の状態を組み立てて通知する */
  private publish(s: FetchState): void {
    const now = Date.now();
    const st = this.status;
    const offline = this.waitingOffline && !navigator.onLine;
    const err: LastError | null = offline ? { reason: 'offline' } : s.lastError;
    const failing = !!err && (offline || s.stoppedAt > 0 || s.failures > 0);
    const errParams: DataStatus['params'] = err
      ? { reason: err.reason, ...(err.httpStatus ? { httpStatus: err.httpStatus } : {}) }
      : {};
    const due = this.autoAllowedAt(s);

    let state: DataState;
    let code: StatusCode;
    let params: DataStatus['params'] = {};
    if (!st.hasData) {
      // 失敗後の再試行中もエラー表示を保つ（「再試行中…」として見せる）
      if (failing) {
        state = 'error';
        code = 'fetchError';
        params = errParams;
      } else {
        state = 'loading';
        code = 'loading';
      }
    } else {
      const old = this.epochs.filter((t) => now - t > STALE_EPOCH_MS).length;
      const staleFetch = now - this.fetchedAt > STALE_FETCH_MS;
      const staleEpochs = this.epochs.length > 0 && old > this.epochs.length / 2;
      state = staleFetch || staleEpochs || failing ? 'stale' : 'fresh';
      if (failing) {
        code = 'cacheAfterErrorDetail';
        params = errParams;
      } else if (staleFetch) {
        code = 'staleFetch';
        params = { hours: Math.floor((now - this.fetchedAt) / 3600_000) };
      } else if (staleEpochs) code = 'staleEpochs';
      else code = 'fresh';
    }

    // データが無いのに取得を待っている（失敗後、または他の問い合わせからの間隔待ち）ときは次の取得時刻を出す
    const waitingForDue = !st.fetching && !offline && Number.isFinite(due) && due > now && (failing || !st.hasData);
    this.status = {
      ...st,
      state,
      code,
      params,
      stopped: s.stoppedAt > 0,
      nextRetryAt: waitingForDue ? new Date(due) : null,
      manualRetryAt: failing || !st.hasData ? new Date(this.manualAllowedAt(s)) : null,
      usingCacheAfterError: st.hasData && failing,
    };
    this.onStatus(this.status);
  }
}
