import * as THREE from 'three';
import type { Theme } from '../config/themes';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDirW = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const realisticFragment = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform vec3 sunDir;
  uniform float ambient;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  void main() {
    vec3 n = normalize(vNormalW);
    float d = dot(n, sunDir);
    float dayAmt = smoothstep(-0.12, 0.18, d);
    vec3 day = texture2D(dayMap, vUv).rgb;
    vec3 night = texture2D(nightMap, vUv).rgb;
    vec3 lit = day * (ambient + (1.0 - ambient) * clamp(d * 1.4 + 0.1, 0.0, 1.0));
    vec3 dark = night * vec3(1.0, 0.85, 0.6) * 0.9 + day * ambient;
    vec3 col = mix(dark, lit, dayAmt);
    // 縁の淡い青み（大気の簡易な示唆。散乱計算はしない）
    float rim = pow(1.0 - max(dot(n, normalize(vViewDirW)), 0.0), 3.0);
    col += vec3(0.25, 0.45, 0.9) * rim * 0.35 * smoothstep(-0.3, 0.4, d);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const technicalFragment = /* glsl */ `
  uniform sampler2D waterMask;
  uniform vec2 maskTexel;
  uniform vec3 sunDir;
  uniform float ambient;
  uniform vec3 landColor;
  uniform vec3 oceanColor;
  uniform vec3 coastColor;
  uniform vec3 gridColor;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;

  float gridLine(float coord, float spacing) {
    float c = coord / spacing;
    float w = fwidth(c);
    float f = abs(fract(c - 0.5) - 0.5);
    return 1.0 - smoothstep(0.0, w * 1.2, f);
  }

  void main() {
    vec3 n = normalize(vNormalW);
    float water = texture2D(waterMask, vUv).r;
    float land = 1.0 - smoothstep(0.35, 0.65, water);
    // 近傍の差分から海岸線を求める
    float gx = texture2D(waterMask, vUv + vec2(maskTexel.x, 0.0)).r - texture2D(waterMask, vUv - vec2(maskTexel.x, 0.0)).r;
    float gy = texture2D(waterMask, vUv + vec2(0.0, maskTexel.y)).r - texture2D(waterMask, vUv - vec2(0.0, maskTexel.y)).r;
    float coast = smoothstep(0.15, 0.6, length(vec2(gx, gy)));

    vec3 col = mix(oceanColor, landColor, land);
    float lon = vUv.x * 360.0;
    float lat = vUv.y * 180.0;
    float g = max(gridLine(lon, 15.0), gridLine(lat, 15.0));
    float eq = gridLine(lat + 90.0, 180.0);
    col = mix(col, gridColor, g * 0.7);
    col = mix(col, gridColor * 1.6, eq * 0.6);
    col = mix(col, coastColor, coast * 0.85);

    float d = dot(n, sunDir);
    float dayAmt = smoothstep(-0.08, 0.08, d);
    col *= mix(ambient, 1.0, dayAmt);
    // 明暗境界線を細く強調
    float term = 1.0 - smoothstep(0.0, 0.03, abs(d));
    col += coastColor * term * 0.18;

    float rim = pow(1.0 - max(dot(n, normalize(vViewDirW)), 0.0), 2.5);
    col += coastColor * rim * 0.25;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * 地球。group を自転角（GMST）で y 軸回転させる。
 * SphereGeometry の UV は経度 0 が +x、東経 90 度が -z になり、描画座標 (x, z, -y) と一致する。
 */
export class Earth {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial | null = null;
  private loader = new THREE.TextureLoader();
  private textures = new Map<string, THREE.Texture>();
  private sunDir = new THREE.Vector3(1, 0, 0);

  constructor(private maxAnisotropy: number) {
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64));
    this.group.add(this.mesh);
  }

  private texture(url: string, onLoad?: (t: THREE.Texture) => void): THREE.Texture {
    let t = this.textures.get(url);
    if (!t) {
      t = this.loader.load(url, onLoad);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.maxAnisotropy;
      this.textures.set(url, t);
    } else if (onLoad && t.image) {
      onLoad(t);
    }
    return t;
  }

  setTheme(theme: Theme): void {
    const e = theme.earth;
    const common = {
      sunDir: { value: this.sunDir },
      ambient: { value: e.ambient },
    };
    let material: THREE.ShaderMaterial;
    if (e.style === 'realistic') {
      material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader: realisticFragment,
        uniforms: {
          ...common,
          dayMap: { value: this.texture(e.dayMap) },
          nightMap: { value: this.texture(e.nightMap ?? e.dayMap) },
        },
      });
    } else {
      const maskTexel = new THREE.Vector2(1 / 2048, 1 / 1024);
      const mask = this.texture(e.waterMask ?? e.dayMap, (t) => {
        const img = t.image as { width: number; height: number };
        maskTexel.set(1.5 / img.width, 1.5 / img.height);
      });
      mask.colorSpace = THREE.NoColorSpace;
      material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader: technicalFragment,
        uniforms: {
          ...common,
          waterMask: { value: mask },
          maskTexel: { value: maskTexel },
          landColor: { value: new THREE.Color(e.landColor) },
          oceanColor: { value: new THREE.Color(e.oceanColor) },
          coastColor: { value: new THREE.Color(e.coastColor) },
          gridColor: { value: new THREE.Color(e.gridColor) },
        },
      });
    }
    this.material?.dispose();
    this.material = material;
    this.mesh.material = material;
  }

  /** gmst: 自転角 [rad]、sunScene: 描画座標での太陽方向 */
  update(gmst: number, sunScene: THREE.Vector3): void {
    this.group.rotation.y = gmst;
    this.sunDir.copy(sunScene);
  }
}
