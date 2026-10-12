import { loadSettings } from './config/settings';
import { THEMES } from './config/themes';
import { OrbitDataSource, type DataStatus } from './data/celestrak';
import { CONSTELLATION_IDS, CONSTELLATION_NAMES } from './data/constellations';
import { installHostApi } from './host/api';
import { installInputGuard } from './host/inputGuard';
import { installLivelyBridge } from './host/lively';
import { SimClock } from './orbit/clock';
import { OrbitEngine } from './orbit/engine';
import { View } from './render/view';
import { Hud } from './ui/hud';
import { Panel } from './ui/panel';

installInputGuard();
const app = document.getElementById('app')!;
const store = loadSettings();
const clock = new SimClock();
clock.setTimeScale(store.get().timeScale);

const engine = new OrbitEngine();
const view = new View(app);
view.setTheme(THEMES[store.get().theme]);
view.placeCamera(store.get().cameraDistance, clock.now());

const hud = new Hud(app, () => store.set({ showUi: true }));
let hostPaused = false;
let notifyHost: (s: DataStatus) => void = () => {};

const data = new OrbitDataSource(
  (records) => {
    engine.setRecords(records);
    view.setRecords(engine);
  },
  (status) => {
    const counts = CONSTELLATION_IDS.map((id) => `${CONSTELLATION_NAMES[id]} ${status.counts[id] ?? 0}`).join(', ');
    panel?.setStatus(status, counts);
    hud.setStatus(status);
    notifyHost(status);
  },
);

const panel: Panel = new Panel(store, {
  resetTime: () => clock.resetToRealTime(),
  refreshData: () => void data.refresh(),
});
panel.setStatus(data.status, '');

const host = installHostApi(store, {
  setPaused: (p) => {
    hostPaused = p;
  },
  getStatus: () => data.status,
  resetTime: () => clock.resetToRealTime(),
});
notifyHost = host.notifyStatus;
installLivelyBridge(host.api);

store.subscribe((s, changed) => {
  if (changed.has('theme')) view.setTheme(THEMES[s.theme]);
  if (changed.has('timeScale')) clock.setTimeScale(s.timeScale);
  hud.applySettings(s);
});
hud.applySettings(store.get());

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'h' || e.key === 'H') store.set({ showUi: !store.get().showUi });
});

function draw(dt: number): void {
  const s = store.get();
  const simMs = clock.now();
  const trailMs = s.trailMinutes * 60_000;
  engine.configure(trailMs, s.timeScale);
  engine.update(simMs, trailMs, s.timeScale, s.orbitLineMode === 'full');
  view.render(engine, simMs, dt, s);
  if (s.showUi) hud.setTime(simMs, clock.offsetFromReal());
}

let last = performance.now();
let lastDrawn = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  const s = store.get();
  // ホストから停止指示がある間は何もしない（タブ非表示時は rAF 自体が止まる）
  if (hostPaused) {
    last = now;
    return;
  }
  if (s.maxFps > 0 && now - lastDrawn < 1000 / s.maxFps - 1) return;
  lastDrawn = now;
  // 非表示から復帰した直後の大きな dt でカメラが飛ばないよう制限する
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  draw(dt);
}
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  // 開発用: 非表示タブでも検証できるよう、任意フレーム数を同期的に進める
  (window as unknown as Record<string, unknown>).__gnss = {
    view,
    engine,
    clock,
    step: (frames = 1, dt = 1 / 60) => {
      for (let i = 0; i < frames; i++) draw(dt);
    },
  };
}

void data.start();
