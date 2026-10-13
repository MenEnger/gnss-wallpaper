import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { OrbitLineMode } from '../config/settings';
import type { Theme } from '../config/themes';
import type { ConstellationId } from '../data/constellations';
import type { SatelliteRecord } from '../data/celestrak';
import type { OrbitEngine } from '../orbit/engine';
import { EARTH_RADIUS_KM, eciToScene } from './coords';

const markerVertex = /* glsl */ `
  attribute vec3 color;
  // 0 = 非表示, 1 = 通常, 2 = 現在地の上空にいる（強調）
  attribute float visible;
  uniform float size;
  varying vec3 vColor;
  varying float vHighlight;
  void main() {
    vColor = color;
    vHighlight = visible > 1.5 ? 1.0 : 0.0;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = visible > 0.5 ? size * (1.0 + 0.6 * vHighlight) : 0.0;
  }
`;

const markerFragment = /* glsl */ `
  uniform float glow;
  varying vec3 vColor;
  varying float vHighlight;
  void main() {
    // 点スプライトの 1/3 を芯、残りを光芒にする（強調時は点が大きいぶん芯を相対的に小さく）
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float coreR = mix(0.26, 0.17, vHighlight);
    float core = 1.0 - smoothstep(coreR, coreR + 0.08, r);
    float halo = exp(-r * r * 6.0) * glow;
    // 強調時は細いリングを足す
    float ring = vHighlight * (1.0 - smoothstep(0.0, 0.06, abs(r - 0.5))) * 0.75;
    float a = max(max(core, halo), ring);
    if (a < 0.01) discard;
    vec3 c = mix(vColor, vec3(1.0), core * 0.35);
    gl_FragColor = vec4(c * a, a);
    #include <colorspace_fragment>
  }
`;

/**
 * LineMaterial は線分の両端を丸く描くため、加算合成では連結部が二重に塗られて点線状に見える。
 * 端の丸めを捨て、線分を矩形として描く（標本間の折れ角は小さいので隙間は目立たない）。
 */
function capless(m: LineMaterial): LineMaterial {
  m.fragmentShader = m.fragmentShader.replace('void main() {', 'void main() {\n\tif ( abs( vUv.y ) > 1.0 ) discard;');
  return m;
}

/** 描画座標の線分 A→B が地球（半径 1）の内側を通るか。A は地表のわずかに上にある前提 */
function segmentHitsEarth(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 === 0) return false;
  // 原点に最も近い点の位置（線分上に制限）
  const t = Math.min(1, Math.max(0, -(ax * dx + ay * dy + az * dz) / len2));
  const px = ax + dx * t;
  const py = ay + dy * t;
  const pz = az + dz * t;
  return px * px + py * py + pz * pz < 0.999;
}

/** 線分群（LineSegments2）をバッファを再確保せずに毎フレーム書き換えるためのラッパー */
class SegmentBuffer {
  readonly object: LineSegments2;
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  private geometry: LineSegmentsGeometry;
  count = 0;

  constructor(
    readonly capacity: number,
    readonly material: LineMaterial,
  ) {
    this.geometry = new LineSegmentsGeometry();
    this.geometry.setPositions(new Float32Array(capacity * 6));
    this.geometry.setColors(new Float32Array(capacity * 6));
    this.positions = (this.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data
      .array as Float32Array;
    this.colors = (this.geometry.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute).data
      .array as Float32Array;
    this.object = new LineSegments2(this.geometry, material);
    this.object.frustumCulled = false;
  }

  /** 線分を 1 本追加。色は加算合成用に不透明度を掛け込んだ値。 */
  push(ax: number, ay: number, az: number, bx: number, by: number, bz: number, c: THREE.Color, fa: number, fb: number): void {
    if (this.count >= this.capacity) return;
    const o = this.count * 6;
    const p = this.positions;
    p[o] = ax;
    p[o + 1] = ay;
    p[o + 2] = az;
    p[o + 3] = bx;
    p[o + 4] = by;
    p[o + 5] = bz;
    const k = this.colors;
    k[o] = c.r * fa;
    k[o + 1] = c.g * fa;
    k[o + 2] = c.b * fa;
    k[o + 3] = c.r * fb;
    k[o + 4] = c.g * fb;
    k[o + 5] = c.b * fb;
    this.count++;
  }

  commit(): void {
    this.geometry.instanceCount = this.count;
    (this.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data.needsUpdate = true;
    (this.geometry.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute).data.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

export interface SatelliteViewOptions {
  orbitLineMode: OrbitLineMode;
  trailMs: number;
  altitudeScale: number;
  enabled: Record<ConstellationId, boolean>;
  /** 現在地（ECI の単位ベクトル）。null なら上空判定をしない */
  observer: [number, number, number] | null;
  /** 上空とみなす最低仰角 [度] */
  minElevation: number;
  highlightVisible: boolean;
  skyLines: boolean;
}

/** 衛星マーカー・過去軌跡・軌道全体の描画 */
export class SatelliteLayer {
  readonly group = new THREE.Group();
  /** 現在の描画座標（ラベル配置でも使う）。無効な衛星は visible = 0 */
  scenePositions = new Float32Array(0);
  visible = new Uint8Array(0);
  /** 現在地の上空（最低仰角以上）にいるか */
  aboveHorizon = new Uint8Array(0);
  /** 上空にいる衛星の数（衛星群ごと）。現在地が無いときは null */
  visibleCounts: Partial<Record<ConstellationId, number>> | null = null;

  private records: SatelliteRecord[] = [];
  private points: THREE.Points | null = null;
  private pointGeometry: THREE.BufferGeometry | null = null;
  private pointMaterial: THREE.ShaderMaterial;
  private trailMaterial: LineMaterial;
  private orbitMaterial: LineMaterial;
  private trails: SegmentBuffer | null = null;
  private orbits: SegmentBuffer | null = null;
  private skyLineMaterial: LineMaterial;
  private skyLines: SegmentBuffer | null = null;
  private orbitBuiltFor = { version: -1, altitudeScale: NaN, enabledKey: '' };
  private satColors: THREE.Color[] = [];
  private theme: Theme | null = null;
  private eci = new Float32Array(3);
  private tmpA = new Float32Array(3);
  private tmpB = new Float32Array(3);

  constructor() {
    this.pointMaterial = new THREE.ShaderMaterial({
      vertexShader: markerVertex,
      fragmentShader: markerFragment,
      uniforms: { size: { value: 12 }, glow: { value: 0.4 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const lineParams = {
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      linewidth: 1.5,
    };
    this.trailMaterial = capless(new LineMaterial(lineParams));
    this.orbitMaterial = capless(new LineMaterial(lineParams));
    this.skyLineMaterial = capless(new LineMaterial({ ...lineParams, linewidth: 1 }));
  }

  setRecords(records: SatelliteRecord[], trailSegmentsPerSat: number, orbitSegmentsPerSat: number): void {
    this.records = records;
    const n = records.length;
    this.scenePositions = new Float32Array(n * 3);
    this.visible = new Uint8Array(n);
    this.aboveHorizon = new Uint8Array(n);

    if (this.points) this.group.remove(this.points);
    this.pointGeometry?.dispose();
    this.pointGeometry = new THREE.BufferGeometry();
    this.pointGeometry.setAttribute('position', new THREE.BufferAttribute(this.scenePositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.pointGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.pointGeometry.setAttribute('visible', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(this.pointGeometry, this.pointMaterial);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;

    for (const buf of [this.trails, this.orbits, this.skyLines]) {
      if (buf) {
        this.group.remove(buf.object);
        buf.dispose();
      }
    }
    this.trails = new SegmentBuffer(Math.max(1, n * trailSegmentsPerSat), this.trailMaterial);
    this.orbits = new SegmentBuffer(Math.max(1, n * orbitSegmentsPerSat), this.orbitMaterial);
    this.skyLines = new SegmentBuffer(Math.max(1, n), this.skyLineMaterial);
    this.trails.object.renderOrder = 1;
    this.orbits.object.renderOrder = 1;
    this.skyLines.object.renderOrder = 1;
    this.group.add(this.orbits.object, this.trails.object, this.skyLines.object, this.points);
    this.orbitBuiltFor.version = -1;
    if (this.theme) this.setTheme(this.theme);
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.satColors = this.records.map((r) => new THREE.Color(theme.colors[r.constellation]));
    const colorAttr = this.pointGeometry?.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (colorAttr) {
      this.satColors.forEach((c, i) => colorAttr.setXYZ(i, c.r, c.g, c.b));
      colorAttr.needsUpdate = true;
    }
    this.trailMaterial.linewidth = theme.lineWidth;
    this.orbitMaterial.linewidth = theme.lineWidth;
    this.orbitBuiltFor.version = -1;
  }

  setPixelRatio(ratio: number): void {
    if (this.theme) {
      this.pointMaterial.uniforms.size.value = this.theme.markerSize * 3 * ratio;
      this.pointMaterial.uniforms.glow.value = this.theme.markerGlow;
    }
  }

  setResolution(width: number, height: number): void {
    this.trailMaterial.resolution.set(width, height);
    this.orbitMaterial.resolution.set(width, height);
    this.skyLineMaterial.resolution.set(width, height);
  }

  update(engine: OrbitEngine, simMs: number, opt: SatelliteViewOptions): void {
    const theme = this.theme;
    if (!theme || !this.pointGeometry || !this.trails || !this.orbits || !this.skyLines) return;
    const n = this.records.length;
    const visAttr = this.pointGeometry.getAttribute('visible') as THREE.BufferAttribute;
    const alt = opt.altitudeScale;

    // 現在地の位置 [km] と、上空とみなす仰角の正弦（球形の地球で近似）
    const obs = opt.observer;
    const ox = obs ? obs[0] * EARTH_RADIUS_KM : 0;
    const oy = obs ? obs[1] * EARTH_RADIUS_KM : 0;
    const oz = obs ? obs[2] * EARTH_RADIUS_KM : 0;
    const sinMinEl = Math.sin((opt.minElevation * Math.PI) / 180);
    const counts: Partial<Record<ConstellationId, number>> = {};

    const lines = this.skyLines;
    lines.count = 0;
    // 見通し線の地上側の端（描画座標, 地表のわずかに上）
    const g = this.tmpB;
    if (obs) eciToScene([obs[0] * EARTH_RADIUS_KM * 1.002, obs[1] * EARTH_RADIUS_KM * 1.002, obs[2] * EARTH_RADIUS_KM * 1.002], 0, 1, g, 0);

    for (let i = 0; i < n; i++) {
      const c = this.records[i].constellation;
      const on = opt.enabled[c] && engine.positionAt(simMs, i, this.eci, 0);
      let above = false;
      if (on) {
        eciToScene(this.eci, 0, alt, this.scenePositions, i * 3);
        if (obs) {
          const dx = this.eci[0] - ox;
          const dy = this.eci[1] - oy;
          const dz = this.eci[2] - oz;
          const sinEl = (dx * obs[0] + dy * obs[1] + dz * obs[2]) / Math.hypot(dx, dy, dz);
          above = sinEl >= sinMinEl;
        }
      }
      this.visible[i] = on ? 1 : 0;
      this.aboveHorizon[i] = above ? 1 : 0;
      if (above) {
        counts[c] = (counts[c] ?? 0) + 1;
        const j = i * 3;
        const sp = this.scenePositions;
        // 高度を縮めて描いていると、実際は地平線の上でも描画上は地球の陰になることがある。
        // その場合は線が地球を貫いて途切れるので引かない（強調と機数は実際の位置で判定したまま）
        if (opt.skyLines && !segmentHitsEarth(g[0], g[1], g[2], sp[j], sp[j + 1], sp[j + 2])) {
          lines.push(g[0], g[1], g[2], sp[j], sp[j + 1], sp[j + 2], this.satColors[i], 0.3, 0.06);
        }
      }
      visAttr.setX(i, on ? (above && opt.highlightVisible ? 2 : 1) : 0);
    }
    visAttr.needsUpdate = true;
    lines.commit();
    lines.object.visible = !!obs && opt.skyLines;
    this.visibleCounts = obs ? counts : null;
    (this.pointGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    this.trails.object.visible = opt.orbitLineMode === 'trail';
    this.orbits.object.visible = opt.orbitLineMode === 'full';
    if (opt.orbitLineMode === 'trail') this.buildTrails(engine, simMs, opt, theme);
    if (opt.orbitLineMode === 'full') this.buildOrbits(engine, opt, theme);
  }

  /** 過去の軌跡。古い部分ほど暗く（加算合成なので透明に）する。 */
  private buildTrails(engine: OrbitEngine, simMs: number, opt: SatelliteViewOptions, theme: Theme): void {
    const buf = this.trails!;
    buf.count = 0;
    const step = engine.step;
    const tStart = simMs - opt.trailMs;
    const kNow = Math.floor(simMs / step);
    const kFirst = Math.floor(tStart / step) + 1;
    const a = this.tmpA;
    const b = this.tmpB;
    const fade = (t: number) => {
      const x = Math.min(1, Math.max(0, (t - tStart) / opt.trailMs));
      return x * x * theme.trailOpacity;
    };

    for (let i = 0; i < this.records.length; i++) {
      if (!this.visible[i]) continue;
      const color = this.satColors[i];
      // 起点（軌跡の最古端）
      let hasPrev = engine.positionAt(tStart, i, this.eci, 0);
      if (hasPrev) eciToScene(this.eci, 0, opt.altitudeScale, a, 0);
      let tPrev = tStart;
      for (let k = kFirst; k <= kNow + 1; k++) {
        const t = k > kNow ? simMs : k * step;
        let ok: boolean;
        if (k > kNow) {
          b[0] = this.scenePositions[i * 3];
          b[1] = this.scenePositions[i * 3 + 1];
          b[2] = this.scenePositions[i * 3 + 2];
          ok = true;
        } else {
          const s = engine.sample(k);
          ok = !!s && Number.isFinite(s[i * 3]);
          if (ok) eciToScene(s!, i * 3, opt.altitudeScale, b, 0);
        }
        if (ok && hasPrev) buf.push(a[0], a[1], a[2], b[0], b[1], b[2], color, fade(tPrev), fade(t));
        if (ok) {
          a[0] = b[0];
          a[1] = b[1];
          a[2] = b[2];
          tPrev = t;
        }
        hasPrev = ok;
      }
    }
    buf.commit();
  }

  /** 軌道 1 周分。データ・倍率・表示対象が変わったときだけ作り直す。 */
  private buildOrbits(engine: OrbitEngine, opt: SatelliteViewOptions, theme: Theme): void {
    const data = engine.orbitData;
    const key = Object.entries(opt.enabled).map(([k, v]) => (v ? k : '')).join(',');
    const built = this.orbitBuiltFor;
    if (!data || (built.version === engine.orbitVersion && built.altitudeScale === opt.altitudeScale && built.enabledKey === key))
      return;
    built.version = engine.orbitVersion;
    built.altitudeScale = opt.altitudeScale;
    built.enabledKey = key;

    const buf = this.orbits!;
    buf.count = 0;
    const seg = engine.orbitSegments;
    const a = this.tmpA;
    const b = this.tmpB;
    for (let i = 0; i < this.records.length; i++) {
      if (!opt.enabled[this.records[i].constellation]) continue;
      const color = this.satColors[i];
      const base = i * seg * 3;
      if (!Number.isFinite(data[base])) continue;
      eciToScene(data, base + (seg - 1) * 3, opt.altitudeScale, a, 0);
      for (let k = 0; k < seg; k++) {
        eciToScene(data, base + k * 3, opt.altitudeScale, b, 0);
        buf.push(a[0], a[1], a[2], b[0], b[1], b[2], color, theme.orbitOpacity, theme.orbitOpacity);
        a.set(b);
      }
    }
    buf.commit();
  }
}
