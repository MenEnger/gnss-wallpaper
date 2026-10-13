import type { Theme } from '../config/themes';
import { CONSTELLATION_IDS, type ConstellationId } from '../data/constellations';
import { t } from '../i18n';

/** 衛星群の略称（国際的に使われる表記） */
const SHORT: Record<ConstellationId, string> = { gps: 'GPS', glonass: 'GLO', galileo: 'GAL', beidou: 'BDS', qzss: 'QZS' };

/**
 * 現在地の上空にいる衛星の数を画面右下に出す。
 * デスクトップアイコンが並ぶ左上と、タスクバーに隠れる下端を避けた位置に置く。
 */
export class SkyCount {
  private el: HTMLDivElement;
  private total: HTMLDivElement;
  private breakdown: HTMLDivElement;
  private lastKey = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'sky-count';
    this.el.hidden = true;
    this.total = document.createElement('div');
    this.total.className = 'sky-count-total';
    this.breakdown = document.createElement('div');
    this.breakdown.className = 'sky-count-breakdown';
    this.el.append(this.total, this.breakdown);
    parent.appendChild(this.el);
  }

  /** counts が null（現在地なし）または show = false なら隠す。内容が変わったときだけ DOM を更新する */
  update(counts: Partial<Record<ConstellationId, number>> | null, show: boolean, enabled: Record<ConstellationId, boolean>, theme: Theme): void {
    const visible = show && !!counts;
    const ids = CONSTELLATION_IDS.filter((id) => enabled[id]);
    const key = visible ? `${t('sky.countText')}|${theme.id}|${ids.map((id) => `${id}:${counts![id] ?? 0}`).join(',')}` : '';
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.el.hidden = !visible;
    if (!visible) return;

    const sum = ids.reduce((a, id) => a + (counts![id] ?? 0), 0);
    this.total.textContent = t('sky.countText', { count: sum });
    this.breakdown.replaceChildren(
      ...ids.map((id) => {
        const item = document.createElement('span');
        item.style.setProperty('--swatch', theme.colors[id]);
        item.textContent = `${SHORT[id]} ${counts![id] ?? 0}`;
        return item;
      }),
    );
  }
}
