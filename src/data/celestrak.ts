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

export interface DataStatus {
  state: DataState;
  /** 取得（ダウンロード）時刻 */
  fetchedAt: Date | null;
  /** 軌道要素エポックの最古値 */
  oldestEpoch: Date | null;
  /** 直近の取得が失敗しキャッシュで代替している */
  usingCacheAfterError: boolean;
  message: string;
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
  status: DataStatus = {
    state: 'loading',
    fetchedAt: null,
    oldestEpoch: null,
    usingCacheAfterError: false,
    message: '軌道データを読み込み中…',
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
    if (!cache || Date.now() - cache.fetchedAt > MIN_REFETCH_MS) {
      await this.refresh();
    }
    // 長時間実行に備え、定期的に更新を確認する
    this.timer = setInterval(() => {
      if (Date.now() - this.fetchedAt > MIN_REFETCH_MS) void this.refresh();
      else this.updateStaleness();
    }, 15 * 60_000);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async refresh(): Promise<void> {
    try {
      const res = await fetch(SOURCE_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as unknown;
      if (!Array.isArray(body) || body.length === 0) throw new Error('空のレスポンス');
      const entry: CacheEntry = { fetchedAt: Date.now(), records: body as OMMJsonObject[] };
      writeCache(entry);
      this.apply(entry, false);
    } catch (e) {
      const cache = readCache();
      if (cache && this.fetchedAt === 0) this.apply(cache, true);
      else if (cache) {
        this.status.usingCacheAfterError = true;
        this.updateStaleness();
      }
      if (!cache) {
        this.setStatus({ ...this.status, state: 'error', message: `軌道データを取得できません (${String(e)})` });
      } else {
        this.status.message = `更新に失敗したためキャッシュを使用中 (${String(e)})`;
        this.onStatus(this.status);
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
    let message = '最新の軌道データを使用中';
    if (staleFetch) message = `軌道データが古くなっています（取得から ${Math.floor((now - this.fetchedAt) / 3600_000)} 時間）`;
    else if (staleEpochs) message = '多くの衛星の軌道要素エポックが 3 日以上前です';
    else if (this.status.usingCacheAfterError) message = '更新に失敗したためキャッシュを使用中';
    this.setStatus({ ...this.status, state: stale ? 'stale' : 'fresh', message });
  }

  private setStatus(s: DataStatus): void {
    this.status = s;
    this.onStatus(s);
  }
}
