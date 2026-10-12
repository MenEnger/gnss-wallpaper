import type { Settings } from '../config/settings';
import type { DataStatus } from '../data/celestrak';

/** 画面隅の状態表示（時刻・時間倍率・高度倍率・データ状態） */
export class Hud {
  private el: HTMLDivElement;
  private time: HTMLSpanElement;
  private tags: HTMLSpanElement;
  private data: HTMLDivElement;
  private toggle: HTMLButtonElement;
  private lastText = '';

  constructor(parent: HTMLElement, onToggleUi: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.time = document.createElement('span');
    this.time.className = 'hud-time';
    this.tags = document.createElement('span');
    this.tags.className = 'hud-tags';
    this.data = document.createElement('div');
    this.data.className = 'hud-data';
    this.el.append(this.time, this.tags, this.data);
    parent.appendChild(this.el);

    this.toggle = document.createElement('button');
    this.toggle.className = 'ui-toggle';
    this.toggle.title = '設定を表示 (H)';
    this.toggle.textContent = '⚙';
    this.toggle.addEventListener('click', onToggleUi);
    parent.appendChild(this.toggle);
  }

  applySettings(s: Readonly<Settings>): void {
    this.el.hidden = !s.showUi;
    this.toggle.hidden = s.showUi;
    const tags: string[] = [];
    if (s.timeScale !== 1) tags.push(s.timeScale === 0 ? '停止中' : `時間 ×${s.timeScale}`);
    if (s.altitudeScale < 1) tags.push(`高度 ${Math.round(s.altitudeScale * 100)}%（非実寸）`);
    this.tags.textContent = tags.join(' · ');
  }

  setStatus(st: DataStatus): void {
    this.data.textContent = st.state === 'fresh' ? '' : st.message;
    this.data.dataset.state = st.state;
  }

  /** 秒が変わったときだけ DOM を更新する */
  setTime(simMs: number, offsetMs: number): void {
    const iso = new Date(simMs).toISOString();
    const text = `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC${Math.abs(offsetMs) > 2000 ? '（シミュレーション）' : ''}`;
    if (text !== this.lastText) {
      this.time.textContent = text;
      this.lastText = text;
    }
  }
}
