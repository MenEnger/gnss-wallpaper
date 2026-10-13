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
  /** データが無いときの次の自動再試行時刻 */
  nextRetryAt: Date | null;
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

const SOURCE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=json';
const CACHE_KEY = 'gnss-viewer.omm-cache.v1';
/** CelesTrak の GP データは約 2 時間ごとに更新されるため、それより短い間隔では再取得しない */
const MIN_REFETCH_MS = 2 * 3600_000;
/** 軌道要素エポックがこれより古い衛星が多い場合は「古い」とみなす */
const STALE_EPOCH_MS = 3 * 86400_000;
/** 取得自体がこれより古い場合も「古い」とみなす */
const STALE_FETCH_MS = 24 * 3600_000;
/** 応答が無いときに諦めるまでの時間 */
const FETCH_TIMEOUT_MS = 20_000;
/** データが一度も取れていないときの再試行間隔（最後の値を繰り返す） */
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000, 600_000, 900_000];

class FetchError extends Error {
  constructor(
    readonly reason: FetchErrorReason,
    readonly httpStatus?: number,
  ) {
    super(httpStatus ? `${reason} ${httpStatus}` : reason);
  }
}

function classifyError(e: unknown): FetchError {
  if (e instanceof FetchError) return e;
  if (!navigator.onLine) return new FetchError('offline');
  if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) return new FetchError('timeout');
  if (e instanceof SyntaxError) return new FetchError('data');
  return new FetchError('network');
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
    /* 容量超過などは無視（毎回取得になるだけ） */
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
  private timer: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryCount = 0;
  private inFlight: Promise<void> | null = null;
  status: DataStatus = {
    state: 'loading',
    hasData: false,
    fetching: false,
    nextRetryAt: null,
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

  async start(): Promise<void> {
    const cache = readCache();
    if (cache) {
      this.apply(cache, false);
    }
    // 長時間実行に備え、定期的に更新を確認する
    this.timer = setInterval(() => {
      if (Date.now() - this.fetchedAt > MIN_REFETCH_MS) void this.refresh();
      else this.updateStaleness();
    }, 15 * 60_000);
    // ネット接続が戻ったら、データが無い・古い場合はすぐ取りに行く
    window.addEventListener('online', () => {
      if (!this.status.hasData || this.status.state !== 'fresh') void this.refresh();
    });
    if (!cache || Date.now() - cache.fetchedAt > MIN_REFETCH_MS) {
      await this.refresh();
    }
  }

  stop(): void {
    clearInterval(this.timer);
    clearTimeout(this.retryTimer);
  }

  /** 取得する。取得中に呼ばれた場合は同じ取得を待つ。 */
  refresh(): Promise<void> {
    this.inFlight ??= this.doRefresh().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  private async doRefresh(): Promise<void> {
    clearTimeout(this.retryTimer);
    this.setStatus({
      ...this.status,
      fetching: true,
      nextRetryAt: null,
      // 失敗後の再試行中はエラー表示を保つ（「再試行中…」として見せる）
      ...(this.status.hasData || this.status.state === 'error' ? {} : { state: 'loading' as const, code: 'loading' as const, params: {} }),
    });
    try {
      if (!navigator.onLine) throw new FetchError('offline');
      const res = await fetch(SOURCE_URL, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new FetchError('http', res.status);
      const body = (await res.json()) as unknown;
      if (!Array.isArray(body) || body.length === 0) throw new FetchError('data');
      const entry: CacheEntry = { fetchedAt: Date.now(), records: body as OMMJsonObject[] };
      writeCache(entry);
      this.retryCount = 0;
      this.status.fetching = false;
      this.apply(entry, false);
    } catch (e) {
      const err = classifyError(e);
      const params: DataStatus['params'] = { reason: err.reason, ...(err.httpStatus ? { httpStatus: err.httpStatus } : {}) };
      this.status.fetching = false;
      const cache = this.status.hasData ? null : readCache();
      if (cache) this.apply(cache, true);
      if (this.status.hasData) {
        // 手元のデータで表示を続け、通常の定期確認で再取得する
        this.status.usingCacheAfterError = true;
        this.updateStaleness();
        this.setStatus({ ...this.status, code: 'cacheAfterErrorDetail', params });
      } else {
        // 何も表示できないので、間隔を空けながら自動で再試行する
        const delay = RETRY_DELAYS_MS[Math.min(this.retryCount++, RETRY_DELAYS_MS.length - 1)];
        this.retryTimer = setTimeout(() => void this.refresh(), delay);
        this.setStatus({ ...this.status, state: 'error', code: 'fetchError', params, nextRetryAt: new Date(Date.now() + delay) });
      }
    }
  }

  private apply(entry: CacheEntry, afterError: boolean): void {
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
    this.status = {
      ...this.status,
      hasData: records.length > 0,
      nextRetryAt: null,
      fetchedAt: new Date(entry.fetchedAt),
      oldestEpoch: Number.isFinite(oldest) ? new Date(oldest) : null,
      usingCacheAfterError: afterError,
      counts,
    };
    this.epochs = epochs;
    this.updateStaleness();
    this.onData(records);
  }

  private epochs: number[] = [];

  private updateStaleness(): void {
    const now = Date.now();
    const old = this.epochs.filter((t) => now - t > STALE_EPOCH_MS).length;
    const staleFetch = now - this.fetchedAt > STALE_FETCH_MS;
    const staleEpochs = this.epochs.length > 0 && old > this.epochs.length / 2;
    const stale = staleFetch || staleEpochs || this.status.usingCacheAfterError;
    let code: StatusCode = 'fresh';
    const params: DataStatus['params'] = {};
    if (staleFetch) {
      code = 'staleFetch';
      params.hours = Math.floor((now - this.fetchedAt) / 3600_000);
    } else if (staleEpochs) code = 'staleEpochs';
    else if (this.status.usingCacheAfterError) code = 'cacheAfterError';
    this.setStatus({ ...this.status, state: stale ? 'stale' : 'fresh', code, params });
  }

  private setStatus(s: DataStatus): void {
    this.status = s;
    this.onStatus(s);
  }
}
