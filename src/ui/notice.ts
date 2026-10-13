import type { DataStatus } from '../data/celestrak';
import { formatDuration, t, type MessageKey } from '../i18n';

/** 読み込み表示を出すまでの猶予（キャッシュや速い回線では出さない） */
const LOADING_DELAY_MS = 1500;

/**
 * 画面下部のお知らせ。設定パネルを隠した壁紙状態でも見えるようにする。
 * - 衛星を一つも表示できないとき（初回の読み込み中・取得失敗）
 * - CelesTrak から正常でない応答を受けて自動取得を止めたとき（データがあっても出す。
 *   利用ポリシーが「止めて人に知らせる」ことを求めているため）
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
    const stopped = !!st && st.stopped;
    const loading = !!st && !stopped && !st.hasData && st.state === 'loading' && performance.now() - this.loadingSince >= LOADING_DELAY_MS;
    const error = !!st && !stopped && !st.hasData && st.state === 'error';
    this.el.hidden = !(loading || error || stopped);
    this.el.dataset.kind = loading ? 'loading' : 'error';
    if (this.el.hidden || !st) {
      clearInterval(this.tick);
      this.tick = undefined;
      return;
    }

    if (loading) {
      this.title.textContent = t('notice.loading');
      this.detail.textContent = '';
      // 他の問い合わせからの間隔待ちなら、次の取得までの時間だけ出す
      this.footer.hidden = !st.nextRetryAt;
      this.retry.hidden = true;
      if (st.nextRetryAt) {
        this.updateFooter();
        this.tick ??= setInterval(() => this.updateFooter(), 1000);
      }
      return;
    }
    this.retry.hidden = false;
    const { reason, ...params } = st.params;
    if (stopped) {
      this.title.textContent = t('notice.stoppedTitle');
      const key = reason === 'data' ? 'notice.stoppedData' : reason === 'http' ? 'notice.stopped' : 'notice.stoppedNoResponse';
      this.detail.textContent = t(key, params);
    } else {
      this.title.textContent = t('notice.errorTitle');
      this.detail.textContent = t(`notice.${reason ?? 'network'}` as MessageKey, params);
    }
    this.footer.hidden = false;
    this.retry.textContent = t('notice.retryNow');
    this.updateFooter();
    this.tick ??= setInterval(() => this.updateFooter(), 1000);
  }

  /** 残り時間と再試行ボタンの状態（1 秒ごと） */
  private updateFooter(): void {
    const st = this.status;
    if (!st) return;
    const now = Date.now();
    const manualIn = st.manualRetryAt ? st.manualRetryAt.getTime() - now : 0;
    this.retry.disabled = st.fetching || manualIn > 0;
    if (st.fetching) this.countdown.textContent = t('notice.retrying');
    else if (st.stopped)
      // 自動では再試行しない。手動で再試行できるまでの時間だけ出す
      this.countdown.textContent = manualIn > 0 ? t('notice.retryAvailableIn', { time: formatDuration(manualIn) }) : '';
    else if (st.nextRetryAt) this.countdown.textContent = t('notice.retryIn', { time: formatDuration(st.nextRetryAt.getTime() - now) });
    else this.countdown.textContent = '';
  }
}
