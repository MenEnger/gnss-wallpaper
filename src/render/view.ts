import * as THREE from 'three';
import type { Settings } from '../config/settings';
import { THEMES, type Theme } from '../config/themes';
import type { OrbitEngine } from '../orbit/engine';
import { gmst, sunDirectionEci } from '../orbit/astro';
import { CameraRig } from './cameraRig';
import { Earth } from './earth';
import { LabelLayer } from './labels';
import { LocationMarker } from './locationMarker';
import { SatelliteLayer } from './satellites';

function createStars(count: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.randomDirection().multiplyScalar(400);
    pos.set([v.x, v.y, v.z], i * 3);
    const b = 0.25 + Math.random() ** 3 * 0.75;
    const warm = Math.random() * 0.15;
    col.set([b, b * (1 - warm * 0.3), b * (1 - warm)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 1.2, sizeAttenuation: false, vertexColors: true, depthWrite: false });
  const p = new THREE.Points(g, m);
  p.renderOrder = -1;
  return p;
}

/** 3D ビュー全体。データ・設定を受け取り描画するだけで、取得や計算は持たない。 */
export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: CameraRig;
  private scene = new THREE.Scene();
  private earth: Earth;
  private marker = new LocationMarker();
  private sats = new SatelliteLayer();
  private labels: LabelLayer;
  private stars = createStars(2500);
  private theme: Theme = THEMES.realistic;
  private sunScene = new THREE.Vector3();
  private date = new Date();

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.labels = new LabelLayer(container);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 1000);
    this.rig = new CameraRig(this.camera, this.renderer.domElement);
    this.earth = new Earth(this.renderer.capabilities.getMaxAnisotropy());
    this.earth.group.add(this.marker.object);
    this.scene.add(this.stars, this.earth.group, this.sats.group);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  /** 初期カメラ: 昼側を斜め上から眺める */
  placeCamera(distance: number, simMs: number): void {
    this.date.setTime(simMs);
    const [x, y] = sunDirectionEci(this.date);
    // ECI の太陽方位から 35 度ずらして明暗境界が見えるようにする
    const az = Math.atan2(x, -y) + THREE.MathUtils.degToRad(35);
    this.rig.place(this.effectiveDistance(distance), az);
  }

  /** 縦長画面（スマートフォン等）では左右が切れないよう少し引く */
  private effectiveDistance(distance: number): number {
    const aspect = Number.isFinite(this.camera.aspect) && this.camera.aspect > 0 ? this.camera.aspect : 1;
    return distance / Math.min(1, aspect) ** 0.7;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.scene.background = new THREE.Color(theme.background);
    this.stars.visible = theme.showStars;
    this.earth.setTheme(theme);
    this.sats.setTheme(theme);
    this.sats.setPixelRatio(this.renderer.getPixelRatio());
    this.marker.setStyle(theme.locationColor, this.renderer.getPixelRatio());
  }

  /** 地表の現在地マーカー（null で非表示） */
  setLocation(location: { lat: number; lon: number } | null): void {
    this.marker.set(location);
  }

  setRecords(engine: OrbitEngine): void {
    this.sats.setRecords(engine.records, 184, engine.orbitSegments);
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    // 壁紙ホスト等で一時的に大きさ 0 になる場合は無視する（aspect が NaN になるため）
    if (w <= 0 || h <= 0) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const ratio = this.renderer.getPixelRatio();
    this.sats.setResolution(w * ratio, h * ratio);
    this.sats.setPixelRatio(ratio);
    this.marker.setStyle(this.theme.locationColor, ratio);
    this.labels.resize(w, h, ratio);
  }

  render(engine: OrbitEngine, simMs: number, dtSec: number, s: Readonly<Settings>): void {
    this.date.setTime(simMs);
    const [x, y, z] = sunDirectionEci(this.date);
    this.sunScene.set(x, z, -y);
    this.earth.update(gmst(this.date), this.sunScene);
    this.marker.update(performance.now() / 1000);

    this.rig.update(dtSec, {
      auto: s.autoCamera,
      speed: s.cameraSpeed,
      distance: this.effectiveDistance(s.cameraDistance),
      resumeSec: s.cameraResumeSec,
    });

    this.sats.update(engine, simMs, {
      orbitLineMode: s.orbitLineMode,
      trailMs: s.trailMinutes * 60_000,
      altitudeScale: s.altitudeScale,
      enabled: s.constellations,
    });
    this.renderer.render(this.scene, this.camera);
    this.labels.update(this.camera, engine.records, this.sats.scenePositions, this.sats.visible, s.labelMode, this.theme);
  }
}
