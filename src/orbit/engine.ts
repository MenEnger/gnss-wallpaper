import type { SatelliteRecord } from '../data/celestrak';
import type { WorkerRequest, WorkerResponse } from './protocol';

/** 過去軌跡の標本数の目安 */
const TRAIL_SAMPLES = 180;
/** 1 実秒あたりに新たに計算する標本数の上限（高い時間倍率での負荷を抑える） */
const MAX_SAMPLES_PER_REAL_SEC = 15;
/** 1 回の要求に含める時刻数の上限 */
const MAX_TIMES_PER_REQUEST = 240;
const ORBIT_SEGMENTS = 256;
/** 軌道全体表示の再計算間隔（シミュレーション時間） */
const ORBIT_REFRESH_MS = 3 * 3600_000;

/**
 * 軌道計算（ワーカー）と描画の間を取り持つ。
 * 一定間隔 step ごとの時刻格子で全衛星の位置をワーカーに計算させ、
 * 描画側には格子間を線形補間した位置と、過去軌跡用の標本列を提供する。
 * 位置は TEME(ECI) [km]。
 */
export class OrbitEngine {
  records: SatelliteRecord[] = [];
  private worker: Worker;
  private gen = 0;
  private ready = false;
  private nextId = 1;

  private stepMs = 60_000;
  private samples = new Map<number, Float32Array>();
  private pending = new Set<number>();

  orbitData: Float32Array | null = null;
  orbitSegments = ORBIT_SEGMENTS;
  private orbitTime = NaN;
  private orbitPending = false;
  /** 軌道全体データが更新されるたびに増える */
  orbitVersion = 0;

  onRecords: ((records: SatelliteRecord[]) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL('./orbit.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.receive(ev.data);
  }

  get count(): number {
    return this.records.length;
  }

  get step(): number {
    return this.stepMs;
  }

  setRecords(records: SatelliteRecord[]): void {
    this.records = records;
    this.gen++;
    this.ready = false;
    this.clear();
    this.post({ type: 'init', gen: this.gen, omms: records.map((r) => r.omm) });
    this.onRecords?.(records);
  }

  /** 軌跡長と時間倍率から格子間隔を決める。変わった場合は標本を捨てる。 */
  configure(trailMs: number, timeScale: number): void {
    const step = Math.max(trailMs / TRAIL_SAMPLES, (Math.abs(timeScale) * 1000) / MAX_SAMPLES_PER_REAL_SEC, 1000);
    // 細かな変動で作り直さないよう 2 のべき乗段階に丸める
    const rounded = 1000 * 2 ** Math.ceil(Math.log2(step / 1000));
    if (rounded !== this.stepMs) {
      this.stepMs = rounded;
      this.samples.clear();
      this.pending.clear();
    }
  }

  /** 毎フレーム呼ぶ。必要な標本を要求し、不要な標本を捨てる。 */
  update(simMs: number, trailMs: number, timeScale: number, needOrbits: boolean): void {
    if (!this.ready) return;
    const step = this.stepMs;
    const kNow = Math.floor(simMs / step);
    const kFrom = Math.floor((simMs - trailMs) / step);
    const ahead = Math.ceil((Math.max(timeScale, 0) * 500) / step) + 2;
    const kTo = kNow + ahead;

    for (const k of this.samples.keys()) if (k < kFrom || k > kTo) this.samples.delete(k);

    // 現在位置の補間に必要な格子を優先して要求する
    const missing: number[] = [];
    for (let k = kNow; k <= kTo; k++) if (!this.samples.has(k) && !this.pending.has(k)) missing.push(k);
    for (let k = kNow - 1; k >= kFrom; k--) if (!this.samples.has(k) && !this.pending.has(k)) missing.push(k);
    for (let i = 0; i < missing.length; i += MAX_TIMES_PER_REQUEST) {
      const ks = missing.slice(i, i + MAX_TIMES_PER_REQUEST);
      ks.forEach((k) => this.pending.add(k));
      this.post({ type: 'samples', gen: this.gen, id: this.nextId++, times: ks.map((k) => k * step) });
    }

    if (needOrbits && !this.orbitPending && !(Math.abs(simMs - this.orbitTime) < ORBIT_REFRESH_MS)) {
      this.orbitPending = true;
      this.post({ type: 'orbits', gen: this.gen, id: this.nextId++, time: simMs, segments: ORBIT_SEGMENTS });
    }
  }

  /** 格子 k の標本（無ければ undefined） */
  sample(k: number): Float32Array | undefined {
    return this.samples.get(k);
  }

  /**
   * 時刻 t の衛星 i の位置を out[o..o+2] に書く。
   * 補間元が無い場合は近い方の標本で代用し、それも無ければ false。
   */
  positionAt(t: number, i: number, out: Float32Array, o: number): boolean {
    const step = this.stepMs;
    const k0 = Math.floor(t / step);
    const a = this.samples.get(k0);
    const b = this.samples.get(k0 + 1);
    const j = i * 3;
    if (a && b) {
      const f = (t - k0 * step) / step;
      out[o] = a[j] + (b[j] - a[j]) * f;
      out[o + 1] = a[j + 1] + (b[j + 1] - a[j + 1]) * f;
      out[o + 2] = a[j + 2] + (b[j + 2] - a[j + 2]) * f;
    } else {
      const s = a ?? b;
      if (!s) return false;
      out[o] = s[j];
      out[o + 1] = s[j + 1];
      out[o + 2] = s[j + 2];
    }
    return Number.isFinite(out[o]);
  }

  private clear(): void {
    this.samples.clear();
    this.pending.clear();
    this.orbitData = null;
    this.orbitTime = NaN;
    this.orbitPending = false;
  }

  private post(msg: WorkerRequest): void {
    this.worker.postMessage(msg);
  }

  private receive(msg: WorkerResponse): void {
    if (msg.gen !== this.gen) return;
    const n = this.records.length;
    if (msg.type === 'ready') {
      this.ready = true;
      if (msg.failed > 0) console.warn(`${msg.failed} 件の軌道要素を解釈できませんでした`);
    } else if (msg.type === 'samples') {
      msg.times.forEach((t, ti) => {
        const k = Math.round(t / this.stepMs);
        // 要求後に格子間隔が変わった標本は捨てる
        if (!this.pending.delete(k) || k * this.stepMs !== t) return;
        this.samples.set(k, msg.data.subarray(ti * n * 3, (ti + 1) * n * 3));
      });
    } else if (msg.type === 'orbits') {
      this.orbitPending = false;
      this.orbitTime = msg.time;
      this.orbitSegments = msg.segments;
      this.orbitData = msg.data;
      this.orbitVersion++;
    }
  }

  dispose(): void {
    this.worker.terminate();
  }
}
