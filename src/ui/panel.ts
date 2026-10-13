import GUI, { OptionController, type Controller } from 'lil-gui';
import type { SettingsStore, Settings } from '../config/settings';
import { THEMES } from '../config/themes';
import { CONSTELLATION_IDS, CONSTELLATION_NAMES, type ConstellationId } from '../data/constellations';
import type { DataStatus } from '../data/celestrak';
import { resolveLocation } from '../data/location';
import { LANG_INFO, LANGS, statusMessage, t } from '../i18n';
import { useInPageMenu } from './menuSelect';

export interface PanelActions {
  resetTime(): void;
  refreshData(): void;
}

function fmt(d: Date | null): string {
  if (!d) return '—';
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/**
 * 設定オーバーレイ。値の変更はすべて SettingsStore を経由する。
 * 表示言語が変わったときは destroy して作り直す。
 */
export class Panel {
  private gui: GUI;
  private model: Settings & Record<string, unknown>;
  private controllers: Controller[] = [];
  private status = { state: '', message: '', fetched: '', epoch: '', locationSource: '' };
  private altitudeCtl: Controller;
  private constellationCtls = new Map<ConstellationId, Controller>();
  private manualCtls: Controller[] = [];
  private skyCtls: Controller[] = [];
  private sourceCtl: Controller;
  private unsubscribe: () => void;

  constructor(store: SettingsStore, actions: PanelActions) {
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

    const view = this.gui.addFolder(t('folder.view'));
    bind(view.add(m, 'theme', Object.fromEntries(Object.values(THEMES).map((th) => [th.label, th.id]))).name(t('theme')), 'theme');
    bind(
      view.add(m, 'labelMode', { [t('labels.off')]: 'off', [t('labels.id')]: 'id', [t('labels.name')]: 'name' }).name(t('labels')),
      'labelMode',
    );
    bind(
      view
        .add(m, 'orbitLineMode', { [t('orbit.trail')]: 'trail', [t('orbit.full')]: 'full', [t('orbit.none')]: 'none' })
        .name(t('orbitLines')),
      'orbitLineMode',
    );
    bind(view.add(m, 'trailMinutes', 10, 720, 5).name(t('trailMinutes')), 'trailMinutes');
    this.altitudeCtl = bind(view.add(m, 'altitudeScale', 0.05, 1, 0.01).name(t('altitude')), 'altitudeScale');
    m.realScale = () => store.set({ altitudeScale: 1 });
    view.add(m, 'realScale').name(t('altitude.setReal'));

    const gnss = this.gui.addFolder(t('folder.gnss'));
    for (const id of CONSTELLATION_IDS) {
      const c = gnss.add(m.constellations, id).name(CONSTELLATION_NAMES[id]);
      c.onChange((v: boolean) => store.set({ constellations: { [id]: v } }));
      this.constellationCtls.set(id, c);
    }

    const loc = this.gui.addFolder(t('folder.location'));
    bind(
      loc
        .add(m, 'locationMode', { [t('location.off')]: 'off', [t('location.auto')]: 'auto', [t('location.manual')]: 'manual' })
        .name(t('locationMode')),
      'locationMode',
    );
    this.sourceCtl = loc.add(this.status, 'locationSource').name(t('location.source')).disable();
    this.manualCtls = [
      bind(loc.add(m, 'latitude', -90, 90, 0.01).name(t('latitude')), 'latitude'),
      bind(loc.add(m, 'longitude', -180, 180, 0.01).name(t('longitude')), 'longitude'),
    ];
    this.skyCtls = [
      bind(loc.add(m, 'highlightVisible').name(t('sky.highlight')), 'highlightVisible'),
      bind(loc.add(m, 'minElevation', 0, 30, 1).name(t('sky.minElevation')), 'minElevation'),
      bind(loc.add(m, 'skyLines').name(t('sky.lines')), 'skyLines'),
      bind(loc.add(m, 'showVisibleCount').name(t('sky.count')), 'showVisibleCount'),
    ];
    loc.close();

    const cam = this.gui.addFolder(t('folder.camera'));
    bind(cam.add(m, 'autoCamera').name(t('autoCamera')), 'autoCamera');
    bind(cam.add(m, 'cameraSpeed', 0, 10, 0.1).name(t('cameraSpeed')), 'cameraSpeed');
    bind(cam.add(m, 'cameraDistance', 2, 20, 0.1).name(t('cameraDistance')), 'cameraDistance');
    bind(cam.add(m, 'cameraResumeSec', 0, 60, 1).name(t('cameraResume')), 'cameraResumeSec');

    const time = this.gui.addFolder(t('folder.time'));
    bind(
      time
        .add(m, 'timeScale', {
          [t('time.paused')]: 0,
          [t('time.real')]: 1,
          '×10': 10,
          [t('time.x60')]: 60,
          [t('time.x600')]: 600,
          [t('time.x3600')]: 3600,
        })
        .name(t('timeScale')),
      'timeScale',
    );
    m.resetTime = actions.resetTime;
    time.add(m, 'resetTime').name(t('resetTime'));

    const data = this.gui.addFolder(t('folder.data'));
    data.add(this.status, 'state').name(t('data.state')).disable();
    data.add(this.status, 'message').name('').disable();
    data.add(this.status, 'fetched').name(t('data.fetched')).disable();
    data.add(this.status, 'epoch').name(t('data.oldestEpoch')).disable();
    m.refresh = actions.refreshData;
    data.add(m, 'refresh').name(t('data.refresh'));
    data.close();

    const sys = this.gui.addFolder(t('folder.other'));
    bind(
      sys
        .add(m, 'language', {
          [t('language.auto')]: 'auto',
          ...Object.fromEntries(LANGS.map((l) => [LANG_INFO[l].nativeName, l])),
        })
        .name(t('language')),
      'language',
    );
    bind(sys.add(m, 'maxFps', { [t('fps.unlimited')]: 0, '60': 60, '30': 30, '15': 15 }).name(t('maxFps')), 'maxFps');
    m.hide = () => store.set({ showUi: false });
    sys.add(m, 'hide').name(t('hideUi'));
    sys.close();

    const about = this.gui.addFolder(t('folder.about'));
    const credits = document.createElement('div');
    credits.className = 'credits';
    credits.innerHTML = t('about.credits');
    about.$children.appendChild(credits);
    about.close();

    for (const c of this.gui.controllersRecursive()) if (c instanceof OptionController) useInPageMenu(c);

    this.unsubscribe = store.subscribe((next) => this.sync(next));
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
    this.altitudeCtl.name(s.altitudeScale >= 1 ? t('altitude.real') : t('altitude.scaled', { pct }));
    this.altitudeCtl.domElement.classList.toggle('non-real-scale', s.altitudeScale < 1);

    for (const c of this.manualCtls) c.show(s.locationMode === 'manual');
    for (const c of this.skyCtls) c.show(s.locationMode !== 'off');
    const loc = resolveLocation(s);
    this.sourceCtl.show(s.locationMode === 'auto');
    this.status.locationSource = loc?.timeZone ?? '—';
    this.sourceCtl.updateDisplay();

    this.gui.domElement.style.display = s.showUi ? '' : 'none';
  }

  setStatus(st: DataStatus, counts: string): void {
    this.status.state = `${t(`state.${st.state}`)}${counts ? ` (${counts})` : ''}`;
    this.status.message = statusMessage(st);
    this.status.fetched = fmt(st.fetchedAt);
    this.status.epoch = fmt(st.oldestEpoch);
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  destroy(): void {
    this.unsubscribe();
    document.querySelectorAll('.in-page-menu').forEach((el) => el.remove());
    this.gui.destroy();
  }
}
