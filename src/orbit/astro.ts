import { gstime, jday, sunPos } from 'satellite.js';

/** グリニッジ平均恒星時 [rad]。地球の自転角として使う。 */
export function gmst(date: Date): number {
  return gstime(date);
}

/** ECI での太陽方向の単位ベクトル */
export function sunDirectionEci(date: Date): [number, number, number] {
  const { rsun } = sunPos(jday(date));
  const len = Math.hypot(rsun.x, rsun.y, rsun.z) || 1;
  return [rsun.x / len, rsun.y / len, rsun.z / len];
}
