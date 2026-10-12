/** 描画座標の単位 = 地球赤道半径 */
export const EARTH_RADIUS_KM = 6378.137;

/**
 * ECI [km] → 描画座標（y 軸 = 地軸北向き）へ変換し、高度倍率を適用する。
 * 地球の大きさは変えず、地表からの高さのみを altitudeScale 倍する。
 * scene = (x, z, -y) / Re
 */
export function eciToScene(
  src: ArrayLike<number>,
  si: number,
  altitudeScale: number,
  out: Float32Array | number[],
  oi: number,
): void {
  const x = src[si];
  const y = src[si + 1];
  const z = src[si + 2];
  const r = Math.hypot(x, y, z);
  const rs = altitudeScale === 1 || r <= EARTH_RADIUS_KM ? r : EARTH_RADIUS_KM + (r - EARTH_RADIUS_KM) * altitudeScale;
  const k = r > 0 ? rs / r / EARTH_RADIUS_KM : 0;
  out[oi] = x * k;
  out[oi + 1] = z * k;
  out[oi + 2] = -y * k;
}
