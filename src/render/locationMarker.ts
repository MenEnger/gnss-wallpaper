import * as THREE from 'three';

const vertexShader = /* glsl */ `
  uniform float size;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 color;
  uniform float time;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    // 中心の点
    float dot = 1.0 - smoothstep(0.14, 0.2, r);
    // 外へ広がって消える波紋（周期 2.4 秒）
    float phase = fract(time / 2.4);
    float ringR = 0.2 + phase * 0.75;
    float ring = (1.0 - smoothstep(0.0, 0.07, abs(r - ringR))) * (1.0 - phase);
    float a = max(dot, ring * 0.8);
    if (a < 0.01) discard;
    gl_FragColor = vec4(color * a, a);
    #include <colorspace_fragment>
  }
`;

/** 地表上の現在地マーカー。Earth.group の子にして地球と一緒に自転させる。 */
export class LocationMarker {
  readonly object: THREE.Points;
  private material: THREE.ShaderMaterial;
  private position = new THREE.BufferAttribute(new Float32Array(3), 3);
  private baseSize = 22;

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', this.position);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { size: { value: 22 }, color: { value: new THREE.Color('#ffffff') }, time: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.object = new THREE.Points(geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 3;
    this.object.visible = false;
  }

  /** 緯度経度 [度] に置く。null で非表示。経度 0 = +x、東経 90 度 = -z（地球テクスチャの向きと一致） */
  set(location: { lat: number; lon: number } | null): void {
    this.object.visible = !!location;
    if (!location) return;
    const lat = THREE.MathUtils.degToRad(location.lat);
    const lon = THREE.MathUtils.degToRad(location.lon);
    // 球面のポリゴン近似より少し外に出して、地表に埋もれないようにする
    const r = 1.004;
    this.position.setXYZ(0, r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(lon));
    this.position.needsUpdate = true;
  }

  setStyle(color: string, pixelRatio: number): void {
    this.material.uniforms.color.value.set(color);
    this.material.uniforms.size.value = this.baseSize * pixelRatio;
  }

  update(timeSec: number): void {
    this.material.uniforms.time.value = timeSec % 1000;
  }
}
