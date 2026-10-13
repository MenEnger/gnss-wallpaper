import type { SettingsPatch } from '../config/settings';

/**
 * Lively Wallpaper の「カスタマイズ」画面の定義。
 * scripts/package-lively.ts がここから LivelyProperties.json（英語）と
 * LivelyProperties.loc.json（日本語, Lively v2.2 以降）を生成し、ページ側は toSettingsPatch で値を設定に変換する。
 * Node の型除去でそのまま読み込むため、実行時の import は持たない。
 *
 * Lively の仕様: dropdown は選択肢の番号、slider は数値、checkbox は真偽値を返す。
 * 読み込み時に全項目の現在値が livelyPropertyListener で通知される。
 */

/** [英語, 日本語] */
type Text = [en: string, ja: string];

type Dropdown = { type: 'dropdown'; text: Text; options: [label: Text, value: unknown][]; value: number; help?: Text };
type Slider = { type: 'slider'; text: Text; min: number; max: number; step: number; value: number; help?: Text };
type Checkbox = { type: 'checkbox'; text: Text; value: boolean; help?: Text };
type Label = { type: 'label'; value: Text };
type Property = (Dropdown | Slider | Checkbox | Label) & { apply?: (v: never) => SettingsPatch };

const same = (s: string): Text => [s, s];

const gnss = (id: string, name: string): Checkbox & { apply: (v: boolean) => SettingsPatch } => ({
  type: 'checkbox',
  text: same(name),
  value: true,
  apply: (v) => ({ constellations: { [id]: !!v } }),
});

export const LIVELY_PROPERTIES = {
  theme: {
    type: 'dropdown',
    text: ['Theme', 'テーマ'],
    options: [
      [same('Realistic'), 'realistic'],
      [same('Technical'), 'technical'],
    ],
    value: 0,
  },
  labelMode: {
    type: 'dropdown',
    text: ['Labels', 'ラベル'],
    options: [
      [['Hidden', '非表示'], 'off'],
      [['ID', '識別子'], 'id'],
      [['Name', '衛星名'], 'name'],
    ],
    value: 0,
  },
  orbitLineMode: {
    type: 'dropdown',
    text: ['Orbit lines', '軌道線'],
    options: [
      [['Recent trail', '過去の軌跡'], 'trail'],
      [['Full orbit', '軌道全体'], 'full'],
      [['Hidden', '非表示'], 'none'],
    ],
    value: 0,
  },
  trailMinutes: { type: 'slider', text: ['Trail length [min]', '軌跡の長さ [分]'], min: 10, max: 720, step: 5, value: 120 },
  altitudePercent: {
    type: 'slider',
    text: ['Satellite altitude [%] (100 = true scale)', '衛星高度 [%]（100 = 実寸）'],
    min: 5,
    max: 100,
    step: 1,
    value: 10,
    help: [
      'Shrinks only the height above the surface; the Earth keeps its size',
      '地球の大きさは変えず、地表からの高さだけを縮めて表示します',
    ],
    apply: (v: number) => ({ altitudeScale: Number(v) / 100 }),
  },
  gnssLabel: { type: 'label', value: ['Constellations', '表示する衛星群'] },
  gps: gnss('gps', 'GPS'),
  glonass: gnss('glonass', 'GLONASS'),
  galileo: gnss('galileo', 'Galileo'),
  beidou: gnss('beidou', 'BeiDou'),
  qzss: gnss('qzss', 'QZSS'),
  locationLabel: { type: 'label', value: ['Your location', '現在地'] },
  locationMode: {
    type: 'dropdown',
    text: ['Show', '表示'],
    options: [
      [['Off', 'オフ'], 'off'],
      [['Auto (from time zone)', '自動（タイムゾーンから推定）'], 'auto'],
      [['Manual', '手動'], 'manual'],
    ],
    value: 1,
    help: [
      'Auto uses the representative city of your time zone. No IP lookup or GPS is used.',
      '自動ではタイムゾーンの代表都市を使います。IP や GPS は使いません。',
    ],
  },
  latitude: { type: 'slider', text: ['Latitude (manual) [°]', '緯度（手動）[度]'], min: -90, max: 90, step: 0.1, value: 35.7 },
  longitude: { type: 'slider', text: ['Longitude (manual) [°]', '経度（手動）[度]'], min: -180, max: 180, step: 0.1, value: 139.8 },
  cameraLabel: { type: 'label', value: ['Camera', 'カメラ'] },
  autoCamera: { type: 'checkbox', text: ['Auto orbit', '自動周回'], value: true },
  cameraSpeed: { type: 'slider', text: ['Orbit speed [°/s]', '周回速度 [度/秒]'], min: 0, max: 10, step: 0.1, value: 1.2 },
  cameraDistance: { type: 'slider', text: ['Distance [Earth radii]', '距離 [地球半径]'], min: 2, max: 20, step: 0.5, value: 5 },
  otherLabel: { type: 'label', value: ['Other', 'その他'] },
  timeScale: {
    type: 'dropdown',
    text: ['Time scale', '時間倍率'],
    options: [
      [['×1 (real time)', '×1（実時間）'], 1],
      [same('×10'), 10],
      [['×60 (1 min/s)', '×60（1分/秒）'], 60],
      [['×600 (10 min/s)', '×600（10分/秒）'], 600],
      [['×3600 (1 h/s)', '×3600（1時間/秒）'], 3600],
    ],
    value: 0,
  },
  language: {
    type: 'dropdown',
    text: ['Language', '言語'],
    options: [
      [['Auto', '自動'], 'auto'],
      [same('English'), 'en'],
      [same('日本語'), 'ja'],
    ],
    value: 0,
  },
  maxFps: {
    type: 'dropdown',
    text: ['Max frame rate', '最大フレームレート'],
    options: [
      [['Unlimited', '制限なし'], 0],
      [same('60'), 60],
      [same('30'), 30],
      [same('15'), 15],
    ],
    value: 2,
    help: ['Lower values reduce GPU load and power use', '低くすると GPU の負荷と消費電力が下がります'],
  },
  showUi: { type: 'checkbox', text: ['Show settings panel and clock', '設定パネルと時刻を表示'], value: false },
} satisfies Record<string, Property>;

/** Lively から通知された値を設定の変更に変換する。対象外の項目は null。 */
export function toSettingsPatch(name: string, value: unknown): SettingsPatch | null {
  const p = (LIVELY_PROPERTIES as Record<string, Property>)[name];
  if (!p || p.type === 'label') return null;
  if (p.apply) return (p.apply as (v: unknown) => SettingsPatch)(value);
  if (p.type === 'dropdown') {
    const option = p.options[Number(value)];
    return option ? ({ [name]: option[1] } as SettingsPatch) : null;
  }
  if (p.type === 'slider') return { [name]: Number(value) } as SettingsPatch;
  return { [name]: value === true || value === 'true' } as SettingsPatch;
}

/** LivelyProperties.json（英語）の内容 */
export function toLivelyPropertiesJson(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, p] of Object.entries(LIVELY_PROPERTIES) as [string, Property][]) {
    const help = 'help' in p && p.help ? { help: p.help[0] } : {};
    if (p.type === 'label') out[name] = { type: p.type, value: p.value[0] };
    else if (p.type === 'dropdown')
      out[name] = { type: p.type, text: p.text[0], value: p.value, items: p.options.map(([l]) => l[0]), ...help };
    else if (p.type === 'slider')
      out[name] = { type: p.type, text: p.text[0], min: p.min, max: p.max, step: p.step, value: p.value, ...help };
    else out[name] = { type: p.type, text: p.text[0], value: p.value, ...help };
  }
  return out;
}

/** LivelyProperties.loc.json（日本語訳）の内容 */
export function toLivelyPropertiesLocJson(): Record<string, unknown> {
  const ja: Record<string, unknown> = {};
  for (const [name, p] of Object.entries(LIVELY_PROPERTIES) as [string, Property][]) {
    const help = 'help' in p && p.help ? { help: p.help[1] } : {};
    if (p.type === 'label') ja[name] = { value: p.value[1] };
    else if (p.type === 'dropdown') ja[name] = { text: p.text[1], items: p.options.map(([l]) => l[1]), ...help };
    else ja[name] = { text: p.text[1], ...help };
  }
  return { Languages: { 'ja-JP': ja } };
}
