/** 実時刻に連動するシミュレーション時計。倍率変更時は現在のシミュレーション時刻を基準に引き継ぐ。 */
export class SimClock {
  private baseSim = Date.now();
  private baseReal = performance.now();
  private scale = 1;

  now(): number {
    return this.baseSim + (performance.now() - this.baseReal) * this.scale;
  }

  get timeScale(): number {
    return this.scale;
  }

  setTimeScale(scale: number): void {
    this.baseSim = this.now();
    this.baseReal = performance.now();
    this.scale = scale;
  }

  /** 実時刻に戻す */
  resetToRealTime(): void {
    this.baseSim = Date.now();
    this.baseReal = performance.now();
  }

  /** 実時刻からのずれ [ms] */
  offsetFromReal(): number {
    return this.now() - Date.now();
  }
}
