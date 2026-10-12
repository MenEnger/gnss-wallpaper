import type { OMMJsonObject } from 'satellite.js';

/** 軌道計算ワーカーとのメッセージ。位置はすべて TEME(ECI) [km]。 */
export type WorkerRequest =
  | { type: 'init'; gen: number; omms: OMMJsonObject[] }
  /** 指定時刻群の全衛星位置。結果は times × satellites × 3 */
  | { type: 'samples'; gen: number; id: number; times: number[] }
  /** 各衛星の 1 周回分の軌道。結果は satellites × segments × 3 */
  | { type: 'orbits'; gen: number; id: number; time: number; segments: number };

export type WorkerResponse =
  | { type: 'ready'; gen: number; count: number; failed: number }
  | { type: 'samples'; gen: number; id: number; times: number[]; data: Float32Array }
  | { type: 'orbits'; gen: number; id: number; time: number; segments: number; data: Float32Array };
