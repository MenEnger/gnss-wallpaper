import { CONSTELLATION_IDS, type ConstellationId } from '../data/constellations';

export type ThemeId = 'realistic' | 'technical';
export type OrbitLineMode = 'trail' | 'full' | 'none';
export type LabelMode = 'off' | 'id' | 'name';

/**
 * 表示状態のすべて。壁紙ホストなど外部からはこの型の部分集合を渡して制御する。
 * 値はシリアライズ可能なプリミティブのみとする（localStorage / URL / postMessage 共通）。
 */
export interface Settings {
  theme: ThemeId;
  constellations: Record<ConstellationId, boolean>;
  labelMode: LabelMode;
  orbitLineMode: OrbitLineMode;
  /** 過去軌跡の長さ [分] */
  trailMinutes: number;
  /** 衛星高度の描画倍率。1 = 実寸 */
  altitudeScale: number;
  /** 時間倍率。1 = 実時間、0 = 停止 */
  timeScale: number;
  autoCamera: boolean;
  /** 自動周回の角速度 [deg/s] */
  cameraSpeed: number;
  /** カメラ距離 [地球半径] */
  cameraDistance: number;
  /** 手動操作後に自動周回へ戻るまでの秒数 */
  cameraResumeSec: number;
  showUi: boolean;
  /** 0 = 制限なし */
  maxFps: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'realistic',
  constellations: Object.fromEntries(CONSTELLATION_IDS.map((id) => [id, true])) as Record<ConstellationId, boolean>,
  labelMode: 'off',
  orbitLineMode: 'trail',
  trailMinutes: 120,
  altitudeScale: 0.5,
  timeScale: 1,
  autoCamera: true,
  cameraSpeed: 1.2,
  cameraDistance: 12,
  cameraResumeSec: 8,
  showUi: true,
  maxFps: 0,
};

export type SettingsPatch = Partial<Omit<Settings, 'constellations'>> & {
  constellations?: Partial<Record<ConstellationId, boolean>>;
};

type Listener = (s: Readonly<Settings>, changed: ReadonlySet<keyof Settings>) => void;

const STORAGE_KEY = 'gnss-viewer.settings.v1';

export class SettingsStore {
  private state: Settings;
  private listeners = new Set<Listener>();

  constructor(initial: Settings) {
    this.state = structuredClone(initial);
  }

  get(): Readonly<Settings> {
    return this.state;
  }

  set(patch: SettingsPatch): void {
    const changed = new Set<keyof Settings>();
    const next = { ...this.state };
    for (const key of Object.keys(patch) as (keyof Settings)[]) {
      const value = patch[key];
      if (value === undefined || !(key in DEFAULT_SETTINGS)) continue;
      if (key === 'constellations') {
        const merged = { ...next.constellations, ...(value as SettingsPatch['constellations']) };
        if (CONSTELLATION_IDS.some((id) => merged[id] !== next.constellations[id])) {
          next.constellations = merged;
          changed.add(key);
        }
      } else if (next[key] !== value) {
        (next as Record<string, unknown>)[key] = value;
        changed.add(key);
      }
    }
    if (changed.size === 0) return;
    this.state = sanitize(next);
    this.persist();
    for (const l of this.listeners) l(this.state, changed);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private persist(): void {
    try {
      // 起動時は常に実時刻・等倍で始めるため、時間倍率は保存しない
      const { timeScale: _, ...rest } = this.state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    } catch {
      /* ストレージ不可の環境では保存しない */
    }
  }
}

function clamp(v: number, lo: number, hi: number, fallback: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function sanitize(s: Settings): Settings {
  const d = DEFAULT_SETTINGS;
  return {
    ...s,
    theme: s.theme === 'technical' ? 'technical' : 'realistic',
    labelMode: (['off', 'id', 'name'] as const).includes(s.labelMode) ? s.labelMode : d.labelMode,
    orbitLineMode: (['trail', 'full', 'none'] as const).includes(s.orbitLineMode) ? s.orbitLineMode : d.orbitLineMode,
    trailMinutes: clamp(s.trailMinutes, 5, 720, d.trailMinutes),
    altitudeScale: clamp(s.altitudeScale, 0.05, 1, d.altitudeScale),
    timeScale: clamp(s.timeScale, 0, 10000, d.timeScale),
    cameraSpeed: clamp(s.cameraSpeed, 0, 20, d.cameraSpeed),
    cameraDistance: clamp(s.cameraDistance, 1.5, 30, d.cameraDistance),
    cameraResumeSec: clamp(s.cameraResumeSec, 0, 600, d.cameraResumeSec),
    maxFps: clamp(s.maxFps, 0, 240, d.maxFps),
  };
}

/** URL クエリから設定を読む（例: ?theme=technical&ui=0&alt=1&labels=id） */
function fromQuery(search: string): SettingsPatch {
  const q = new URLSearchParams(search);
  const p: SettingsPatch = {};
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  const bool = (k: string) => (q.has(k) ? !['0', 'false', 'off'].includes(q.get(k)!) : undefined);
  if (q.has('theme')) p.theme = q.get('theme') as ThemeId;
  if (q.has('orbit')) p.orbitLineMode = q.get('orbit') as OrbitLineMode;
  if (q.has('labels')) p.labelMode = q.get('labels') as LabelMode;
  p.trailMinutes = num('trail');
  p.altitudeScale = num('alt');
  p.timeScale = num('speed');
  p.autoCamera = bool('autocam');
  p.cameraSpeed = num('camspeed');
  p.cameraDistance = num('camdist');
  p.showUi = bool('ui');
  p.maxFps = num('fps');
  if (q.has('gnss')) {
    const on = new Set(q.get('gnss')!.split(','));
    p.constellations = Object.fromEntries(CONSTELLATION_IDS.map((id) => [id, on.has(id)]));
  }
  return p;
}

export function loadSettings(): SettingsStore {
  let stored: Partial<Settings> = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    /* 破損データは無視 */
  }
  const store = new SettingsStore(DEFAULT_SETTINGS);
  store.set(stored);
  store.set(fromQuery(location.search));
  return store;
}
