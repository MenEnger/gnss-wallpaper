import * as THREE from 'three';
import type { LabelMode } from '../config/settings';
import type { Theme } from '../config/themes';
import type { SatelliteRecord } from '../data/celestrak';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** ラベル候補位置 [dx, dy, anchor]。dx, dy はマーカーからの px、anchor は 0 = 左端 / 0.5 = 中央 / 1 = 右端基準 */
const PLACEMENTS: [number, number, number][] = [
  [8, -4, 0],
  [-8, -4, 1],
  [0, -12, 0.5],
  [0, 16, 0.5],
];

/**
 * 2D キャンバスで衛星ラベルを描く。
 * 手前の衛星から順に配置し、既に置いたラベルと重なる場合は別の位置を試し、
 * どこにも置けなければ省略することで重なりを抑える。
 */
export class LabelLayer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private ratio = 1;
  private order: number[] = [];
  private depth = new Float32Array(0);
  private screen = new Float32Array(0);
  private placed: Rect[] = [];
  private v = new THREE.Vector3();
  private widthCache = new Map<string, number>();
  private cleared = true;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'label-layer';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  resize(width: number, height: number, ratio: number): void {
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.widthCache.clear();
  }

  update(
    camera: THREE.PerspectiveCamera,
    records: SatelliteRecord[],
    positions: Float32Array,
    visible: Uint8Array,
    mode: LabelMode,
    theme: Theme,
  ): void {
    const ctx = this.ctx;
    if (mode === 'off') {
      if (!this.cleared) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.cleared = true;
      return;
    }
    this.cleared = false;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.font = theme.labelStyle.font;
    ctx.textBaseline = 'middle';

    const n = records.length;
    if (this.depth.length !== n) {
      this.depth = new Float32Array(n);
      this.screen = new Float32Array(n * 2);
    }
    const cam = camera.position;
    const camDist2 = cam.lengthSq();
    this.order.length = 0;
    for (let i = 0; i < n; i++) {
      if (!visible[i]) continue;
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      if (isOccluded(cam.x, cam.y, cam.z, camDist2, px, py, pz)) continue;
      this.v.set(px, py, pz).project(camera);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) continue;
      this.screen[i * 2] = (this.v.x * 0.5 + 0.5) * this.width;
      this.screen[i * 2 + 1] = (-this.v.y * 0.5 + 0.5) * this.height;
      this.depth[i] = (px - cam.x) ** 2 + (py - cam.y) ** 2 + (pz - cam.z) ** 2;
      this.order.push(i);
    }
    this.order.sort((a, b) => this.depth[a] - this.depth[b]);

    // マーカー自体も障害物として登録し、ラベルが他の衛星を覆わないようにする
    this.placed.length = 0;
    for (const i of this.order) {
      this.placed.push({ x: this.screen[i * 2] - 4, y: this.screen[i * 2 + 1] - 4, w: 8, h: 8 });
    }
    const markerCount = this.placed.length;

    ctx.shadowColor = theme.labelStyle.shadow;
    ctx.shadowBlur = 3;
    const h = 13;
    for (const i of this.order) {
      const r = records[i];
      const text = mode === 'name' ? r.name : r.shortId;
      let w = this.widthCache.get(text);
      if (w === undefined) {
        w = ctx.measureText(text).width;
        this.widthCache.set(text, w);
      }
      const sx = this.screen[i * 2];
      const sy = this.screen[i * 2 + 1];
      for (const [dx, dy, anchor] of PLACEMENTS) {
        const rect = { x: sx + dx - w * anchor - 2, y: sy + dy - h / 2, w: w + 4, h };
        if (this.collides(rect, i, markerCount)) continue;
        this.placed.push(rect);
        ctx.fillStyle = theme.labelStyle.color ?? theme.colors[r.constellation];
        ctx.fillText(text, rect.x + 2, sy + dy);
        break;
      }
    }
    ctx.shadowBlur = 0;
  }

  private collides(r: Rect, self: number, markerCount: number): boolean {
    for (let j = 0; j < this.placed.length; j++) {
      // 自分自身のマーカーは除外
      if (j < markerCount && this.order[j] === self) continue;
      const p = this.placed[j];
      if (r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y) return true;
    }
    return r.x < 0 || r.y < 0 || r.x + r.w > this.width || r.y + r.h > this.height;
  }
}

/** カメラから点 P への線分が地球（半径 1）と交差するか */
function isOccluded(cx: number, cy: number, cz: number, c2: number, px: number, py: number, pz: number): boolean {
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (cx * dx + cy * dy + cz * dz);
  const c = c2 - 1;
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return false;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t > 0 && t < 1;
}
