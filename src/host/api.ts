import type { Settings, SettingsPatch, SettingsStore } from '../config/settings';
import type { DataStatus } from '../data/celestrak';

/**
 * 壁紙ホスト（Windows/Android の WebView など）から表示を制御するための公開 API。
 * OS 固有の処理は持たず、ホスト側がこの API を呼ぶ。
 *
 * - JS から: window.gnssViewer.setSettings({ theme: 'technical' })
 * - postMessage: { type: 'gnss-viewer:settings', settings: {...} } / { type: 'gnss-viewer:paused', paused: true }
 */
export interface HostApi {
  getSettings(): Settings;
  setSettings(patch: SettingsPatch): void;
  /** ホストが不可視（他ウィンドウで隠れた等）を通知する。true の間は描画を止める */
  setPaused(paused: boolean): void;
  getStatus(): DataStatus;
  onStatus(listener: (s: DataStatus) => void): () => void;
  resetTime(): void;
}

export function installHostApi(
  store: SettingsStore,
  hooks: { setPaused(p: boolean): void; getStatus(): DataStatus; resetTime(): void },
): (s: DataStatus) => void {
  const listeners = new Set<(s: DataStatus) => void>();
  const api: HostApi = {
    getSettings: () => structuredClone(store.get()),
    setSettings: (patch) => store.set(patch),
    setPaused: (p) => hooks.setPaused(p),
    getStatus: () => structuredClone(hooks.getStatus()),
    onStatus: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    resetTime: () => hooks.resetTime(),
  };
  (window as unknown as { gnssViewer: HostApi }).gnssViewer = api;

  window.addEventListener('message', (ev: MessageEvent) => {
    const d = ev.data as { type?: string; settings?: SettingsPatch; paused?: boolean } | null;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'gnss-viewer:settings' && d.settings) store.set(d.settings);
    else if (d.type === 'gnss-viewer:paused') hooks.setPaused(!!d.paused);
  });

  return (s) => listeners.forEach((l) => l(s));
}
