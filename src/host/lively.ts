import type { HostApi } from './api';
import { toSettingsPatch } from './livelyProperties';

/**
 * Lively Wallpaper との接続。Lively はページのグローバル関数を呼んで通知してくる。
 * - livelyPropertyListener(name, value): カスタマイズ画面の値（読み込み時に全項目、以後は変更のたび）
 * - livelyWallpaperPlaybackChanged(json): 一時停止状態。LivelyInfo.json の Arguments に
 *   "--pause-event true" が必要。Lively が止めるのは描画だけで JS は動き続けるため、こちらで計算も止める。
 */
export function installLivelyBridge(api: HostApi): void {
  const w = window as unknown as Record<string, unknown>;

  w.livelyPropertyListener = (name: string, value: unknown) => {
    const patch = toSettingsPatch(name, value);
    if (patch) api.setSettings(patch);
  };

  w.livelyWallpaperPlaybackChanged = (data: string) => {
    try {
      const { IsPaused } = JSON.parse(data) as { IsPaused?: boolean };
      api.setPaused(!!IsPaused);
    } catch {
      /* 想定外の形式は無視 */
    }
  };
}
