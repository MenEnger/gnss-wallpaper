import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface CameraRigOptions {
  auto: boolean;
  /** [deg/s] */
  speed: number;
  /** [地球半径] */
  distance: number;
  resumeSec: number;
}

/** 自動周回時の基準仰角 [rad]（赤道面から） */
const BASE_ELEVATION = THREE.MathUtils.degToRad(18);
/** 仰角のゆるやかな揺らぎ */
const ELEVATION_SWING = THREE.MathUtils.degToRad(12);
const ELEVATION_PERIOD_SEC = 240;

/**
 * 手動操作（OrbitControls）と自動周回を切り替えるカメラ。
 * 手動操作が終わって resumeSec 経過すると、速度・距離・仰角を滑らかに自動周回へ戻す。
 */
export class CameraRig {
  readonly controls: OrbitControls;
  private lastInteraction = -Infinity;
  private interacting = false;
  /** 0..1。自動周回の効き具合（復帰時に徐々に上げる） */
  private blend = 1;
  private elapsed = 0;
  private spherical = new THREE.Spherical();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.3;
    this.controls.maxDistance = 40;
    this.controls.rotateSpeed = 0.5;
    this.controls.zoomSpeed = 0.8;
    this.controls.addEventListener('start', () => {
      this.interacting = true;
      this.blend = 0;
    });
    this.controls.addEventListener('end', () => {
      this.interacting = false;
      this.lastInteraction = performance.now();
    });
  }

  /** 初期位置を設定（太陽側斜め上から） */
  place(distance: number, azimuth: number): void {
    this.spherical.set(distance, Math.PI / 2 - BASE_ELEVATION, azimuth);
    this.camera.position.setFromSpherical(this.spherical);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
  }

  update(dtSec: number, opt: CameraRigOptions): void {
    this.elapsed += dtSec;
    // 長時間実行の保険: 数値が壊れたら初期姿勢に戻す
    const p = this.camera.position;
    if (!Number.isFinite(p.x + p.y + p.z) || p.lengthSq() < 1e-6) this.place(opt.distance, 0);
    const idle = !this.interacting && performance.now() - this.lastInteraction > opt.resumeSec * 1000;
    if (opt.auto && idle) {
      // 復帰は約 4 秒かけて滑らかに
      this.blend = Math.min(1, this.blend + dtSec / 4);
      const w = this.blend * this.blend * (3 - 2 * this.blend);
      const s = this.spherical.setFromVector3(this.camera.position);
      s.theta += THREE.MathUtils.degToRad(opt.speed) * dtSec * w;
      const targetPhi =
        Math.PI / 2 - BASE_ELEVATION - ELEVATION_SWING * Math.sin((this.elapsed / ELEVATION_PERIOD_SEC) * 2 * Math.PI);
      const ease = 1 - Math.exp(-dtSec * 0.4 * w);
      s.phi += (targetPhi - s.phi) * ease;
      s.radius += (opt.distance - s.radius) * ease;
      s.makeSafe();
      this.camera.position.setFromSpherical(s);
      this.camera.lookAt(0, 0, 0);
    } else if (!opt.auto) {
      this.blend = 0;
    }
    this.controls.update(dtSec);
  }
}
