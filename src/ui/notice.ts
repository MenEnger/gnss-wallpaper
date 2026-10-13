import type { DataStatus } from '../data/celestrak';
import { lang, t, type MessageKey } from '../i18n';

/** 読み込み表示を出すまでの猶予（キャッシュや速い回線では出さない） */
const LOADING_DELAY_MS = 1500;

function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (lang() === 'ja') {
    if (h > 0) return `${h} 時間 ${m} 分`;
    return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
  }
  if (h > 0) return `${h} h ${m} min`;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

/**
 * 衛星を一つも表示できないとき（初回の読み込み中・取得失敗）に画面下部へ出すお知らせ。
 * 設定パネルを隠した壁紙状態でも見えるようにし、データが表示できるようになったら消える。
 */
export class Notice {
  private el: HTMLDivElement;
  private title: HTMLDivElement;
  private detail: HTMLDivElement;
  private footer: HTMLDivElement;
  private countdown: HTMLSpanElement;
  private retry: HTMLButtonElement;
  private status: DataStatus | null = null;
  private loadingSince = 0;
  private tick: ReturnType<typeof setInterval> | undefined;
  private loadingTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(parent: HTMLElement, onRetry: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'notice';
    this.el.hidden = true;
    this.el.setAttribute('role', 'status');
    this.title = document.createElement('div');
    this.title.className = 'notice-title';
    this.detail = document.createElement('div');
    this.detail.className = 'notice-detail';
    this.footer = document.createElement('div');
    this.footer.className = 'notice-footer';
    this.countdown = document.createElement('span');
    this.retry = document.createElement('button');
    this.retry.type = 'button';
    this.retry.addEventListener('click', onRetry);
    this.footer.append(this.countdown, this.retry);
    this.el.append(this.title, this.detail, this.footer);
    parent.appendChild(this.el);
  }

  update(status: DataStatus): void {
    const wasLoading = this.status && !this.status.hasData && this.status.state === 'loading';
    this.status = status;
    if (!status.hasData && status.state === 'loading' && !wasLoading) {
      this.loadingSince = performance.now();
      clearTimeout(this.loadingTimer);
      this.loadingTimer = setTimeout(() => this.render(), LOADING_DELAY_MS);
    }
    this.render();
  }

  /** 言語変更時の再描画 */
  refreshText(): void {
    this.render();
  }

  private render(): void {
    const st = this.status;
    const loading = !!st && !st.hasData && st.state === 'loading' && performance.now() - this.loadingSince >= LOADING_DELAY_MS;
    const error = !!st && !st.hasData && st.state === 'error';
    this.el.hidden = !(loading || error);
    this.el.dataset.kind = error ? 'error' : 'loading';
    if (this.el.hidden || !st) {
      clearInterval(this.tick);
      this.tick = undefined;
      return;
    }

    if (loading) {
      this.title.textContent = t('notice.loading');
      this.detail.textContent = '';
      this.footer.hidden = true;
    } else {
      const { reason, refused, ...params } = st.params;
      this.title.textContent = t('notice.errorTitle');
      this.detail.textContent = t(refused ? 'notice.refused' : (`notice.${reason ?? 'network'}` as MessageKey), params);
      this.footer.hidden = false;
      this.retry.textContent = t('notice.retryNow');
      this.retry.disabled = st.fetching;
      // 拒否されている間は手動でも問い合わせない
      this.retry.hidden = !!refused;
      this.updateCountdown();
      this.tick ??= setInterval(() => this.updateCountdown(), 1000);
    }
  }

  private updateCountdown(): void {
    const st = this.status;
    if (!st) return;
    if (st.fetching) this.countdown.textContent = t('notice.retrying');
    else if (st.nextRetryAt)
      this.countdown.textContent = t('notice.retryIn', { time: formatDuration(st.nextRetryAt.getTime() - Date.now()) });
    else this.countdown.textContent = '';
  }
}
