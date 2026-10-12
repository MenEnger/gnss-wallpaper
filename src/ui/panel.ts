import GUI, { OptionController, type Controller } from 'lil-gui';
import type { SettingsStore, Settings } from '../config/settings';
import { THEMES } from '../config/themes';
import { CONSTELLATION_IDS, CONSTELLATION_NAMES, type ConstellationId } from '../data/constellations';
import type { DataStatus } from '../data/celestrak';
import { useInPageMenu } from './menuSelect';

export interface PanelActions {
  resetTime(): void;
  refreshData(): void;
}

const TIME_SCALES: Record<string, number> = {
  '停止': 0,
  '×1（実時間）': 1,
  '×10': 10,
  '×60（1分/秒）': 60,
  '×600（10分/秒）': 600,
  '×3600（1時間/秒）': 3600,
};

function fmt(d: Date | null): string {
  if (!d) return '—';
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/** 設定オーバーレイ。値の変更はすべて SettingsStore を経由する。 */
export class Panel {
  private gui: GUI;
  private model: Settings & Record<string, unknown>;
  private controllers: Controller[] = [];
  private status = { state: '', fetched: '', epoch: '' };
  private altitudeCtl: Controller;
  private constellationCtls = new Map<ConstellationId, Controller>();

  constructor(
    store: SettingsStore,
    actions: PanelActions,
  ) {
    this.gui = new GUI({ title: 'GNSS Orbit Viewer' });
    this.gui.domElement.classList.add('settings-panel');
    const s = store.get();
    this.model = structuredClone(s) as Settings & Record<string, unknown>;
    const m = this.model;
    const bind = (c: Controller, key: keyof Settings) => {
      c.onChange((v: unknown) => store.set({ [key]: v }));
      this.controllers.push(c);
      return c;
    };

    const view = this.gui.addFolder('表示');
    bind(
      view.add(m, 'theme', Object.fromEntries(Object.values(THEMES).map((t) => [t.label, t.id]))).name('テーマ'),
      'theme',
    );
    bind(view.add(m, 'labelMode', { 非表示: 'off', 識別子: 'id', 衛星名: 'name' }).name('ラベル'), 'labelMode');
    bind(view.add(m, 'orbitLineMode', { 過去の軌跡: 'trail', 軌道全体: 'full', 非表示: 'none' }).name('軌道線'), 'orbitLineMode');
    bind(view.add(m, 'trailMinutes', 10, 720, 5).name('軌跡の長さ [分]'), 'trailMinutes');
    this.altitudeCtl = bind(view.add(m, 'altitudeScale', 0.1, 1, 0.01).name('衛星高度'), 'altitudeScale');
    m.realScale = () => store.set({ altitudeScale: 1 });
    view.add(m, 'realScale').name('実寸（100%）にする');

    const gnss = this.gui.addFolder('衛星群');
    for (const id of CONSTELLATION_IDS) {
      const c = gnss.add(m.constellations, id).name(CONSTELLATION_NAMES[id]);
      c.onChange((v: boolean) => store.set({ constellations: { [id]: v } }));
      this.constellationCtls.set(id, c);
    }

    const cam = this.gui.addFolder('カメラ');
    bind(cam.add(m, 'autoCamera').name('自動周回'), 'autoCamera');
    bind(cam.add(m, 'cameraSpeed', 0, 10, 0.1).name('周回速度 [度/秒]'), 'cameraSpeed');
    bind(cam.add(m, 'cameraDistance', 2, 20, 0.1).name('距離 [地球半径]'), 'cameraDistance');
    bind(cam.add(m, 'cameraResumeSec', 0, 60, 1).name('操作後の復帰 [秒]'), 'cameraResumeSec');

    const time = this.gui.addFolder('時間');
    bind(time.add(m, 'timeScale', TIME_SCALES).name('時間倍率'), 'timeScale');
    m.resetTime = actions.resetTime;
    time.add(m, 'resetTime').name('現在時刻に戻す');

    const data = this.gui.addFolder('軌道データ');
    data.add(this.status, 'state').name('状態').disable();
    data.add(this.status, 'fetched').name('取得時刻').disable();
    data.add(this.status, 'epoch').name('最古エポック').disable();
    m.refresh = actions.refreshData;
    data.add(m, 'refresh').name('今すぐ再取得');
    data.close();

    const sys = this.gui.addFolder('その他');
    bind(sys.add(m, 'maxFps', { 制限なし: 0, '60': 60, '30': 30, '15': 15 }).name('最大フレームレート'), 'maxFps');
    m.hide = () => store.set({ showUi: false });
    sys.add(m, 'hide').name('UI を隠す（H キーで切替）');
    sys.close();

    for (const c of this.gui.controllersRecursive()) if (c instanceof OptionController) useInPageMenu(c);

    store.subscribe((next) => this.sync(next));
    this.sync(s);
  }

  /** 外部（ホスト API・キー操作）からの変更を表示へ反映 */
  private sync(s: Readonly<Settings>): void {
    Object.assign(this.model, structuredClone(s));
    for (const c of this.controllers) c.updateDisplay();
    for (const [id, c] of this.constellationCtls) {
      c.object = this.model.constellations;
      c.domElement.classList.add('constellation');
      c.domElement.style.setProperty('--swatch', THEMES[s.theme].colors[id]);
      c.updateDisplay();
    }
    const pct = Math.round(s.altitudeScale * 100);
    this.altitudeCtl.name(s.altitudeScale >= 1 ? '衛星高度（実寸）' : `衛星高度（非実寸 ${pct}%）`);
    this.altitudeCtl.domElement.classList.toggle('non-real-scale', s.altitudeScale < 1);
    this.gui.domElement.style.display = s.showUi ? '' : 'none';
  }

  setStatus(st: DataStatus, counts: string): void {
    const label = { loading: '読み込み中', fresh: '最新', stale: '古いデータ', error: 'エラー' }[st.state];
    this.status.state = `${label}（${counts}）`;
    this.status.fetched = fmt(st.fetchedAt);
    this.status.epoch = fmt(st.oldestEpoch);
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }
}
