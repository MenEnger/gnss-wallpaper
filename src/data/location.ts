import type { Settings } from '../config/settings';
import { TIMEZONE_COORDS } from './timezones';

export interface ResolvedLocation {
  lat: number;
  lon: number;
  /** 自動推定の元になったタイムゾーン名（手動指定時は null） */
  timeZone: string | null;
}

/** OS／ブラウザのタイムゾーン名（例: Asia/Tokyo） */
export function systemTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * 表示する現在地を決める。自動の場合はタイムゾーンの代表地点（多くは主要都市）を使うため、
 * 精度は「おおよその地域」程度。権限やネットワークは不要。
 */
export function resolveLocation(s: Readonly<Settings>): ResolvedLocation | null {
  if (s.locationMode === 'off') return null;
  if (s.locationMode === 'manual') return { lat: s.latitude, lon: s.longitude, timeZone: null };
  const tz = systemTimeZone();
  const c = tz ? TIMEZONE_COORDS[tz] : undefined;
  return c ? { lat: c[0], lon: c[1], timeZone: tz } : null;
}
