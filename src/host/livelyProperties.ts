import type { SettingsPatch } from '../config/settings';

/**
 * Lively Wallpaper の「カスタマイズ」画面の定義（LivelyProperties.json の元）。
 * scripts/package-lively.ts がこの定義から JSON を生成し、ページ側は toSettingsPatch で値を設定に変換する。
 * Node の型除去でそのまま読み込むため、実行時の import は持たない。
 *
 * Lively の仕様: dropdown は選択肢の番号、slider は数値、checkbox は真偽値を返す。
 * 読み込み時に全項目の現在値が livelyPropertyListener で通知される。
 */

type Dropdown = { type: 'dropdown'; text: string; options: [label: string, value: unknown][]; value: number; help?: string };
type Slider = { type: 'slider'; text: string; min: number; max: number; step: number; value: number; help?: string };
type Checkbox = { type: 'checkbox'; text: string; value: boolean; help?: string };
type Label = { type: 'label'; value: string };
type Property = (Dropdown | Slider | Checkbox | Label) & { apply?: (v: never) => SettingsPatch };

const gnss = (id: string, text: string): Checkbox & { apply: (v: boolean) => SettingsPatch } => ({
  type: 'checkbox',
  text,
  value: true,
  apply: (v) => ({ constellations: { [id]: !!v } }),
});

export const LIVELY_PROPERTIES = {
  theme: {
    type: 'dropdown',
    text: 'テーマ',
    options: [
      ['Realistic', 'realistic'],
      ['Technical', 'technical'],
    ],
    value: 0,
  },
  labelMode: {
    type: 'dropdown',
    text: 'ラベル',
    options: [
      ['非表示', 'off'],
      ['識別子', 'id'],
      ['衛星名', 'name'],
    ],
    value: 0,
  },
  orbitLineMode: {
    type: 'dropdown',
    text: '軌道線',
    options: [
      ['過去の軌跡', 'trail'],
      ['軌道全体', 'full'],
      ['非表示', 'none'],
    ],
    value: 0,
  },
  trailMinutes: { type: 'slider', text: '軌跡の長さ [分]', min: 10, max: 720, step: 5, value: 120 },
  altitudePercent: {
    type: 'slider',
    text: '衛星高度 [%]（100 = 実寸）',
    min: 10,
    max: 100,
    step: 1,
    value: 10,
    help: '地球の大きさは変えず、地表からの高さだけを縮めて表示します',
    apply: (v: number) => ({ altitudeScale: Number(v) / 100 }),
  },
  gnssLabel: { type: 'label', value: '表示する衛星群' },
  gps: gnss('gps', 'GPS'),
  glonass: gnss('glonass', 'GLONASS'),
  galileo: gnss('galileo', 'Galileo'),
  beidou: gnss('beidou', 'BeiDou'),
  qzss: gnss('qzss', 'QZSS'),
  cameraLabel: { type: 'label', value: 'カメラ' },
  autoCamera: { type: 'checkbox', text: '自動周回', value: true },
  cameraSpeed: { type: 'slider', text: '周回速度 [度/秒]', min: 0, max: 10, step: 0.1, value: 1.2 },
  cameraDistance: { type: 'slider', text: '距離 [地球半径]', min: 2, max: 20, step: 0.5, value: 5 },
  otherLabel: { type: 'label', value: 'その他' },
  timeScale: {
    type: 'dropdown',
    text: '時間倍率',
    options: [
      ['×1（実時間）', 1],
      ['×10', 10],
      ['×60（1分/秒）', 60],
      ['×600（10分/秒）', 600],
      ['×3600（1時間/秒）', 3600],
    ],
    value: 0,
  },
  maxFps: {
    type: 'dropdown',
    text: '最大フレームレート',
    options: [
      ['制限なし', 0],
      ['60', 60],
      ['30', 30],
      ['15', 15],
    ],
    value: 2,
    help: '低くすると GPU の負荷と消費電力が下がります',
  },
  showUi: { type: 'checkbox', text: '設定パネルと時刻を表示', value: false },
} satisfies Record<string, Property>;

export type LivelyPropertyName = keyof typeof LIVELY_PROPERTIES;

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

/** LivelyProperties.json の内容を作る（Lively が知らない独自フィールドは除く） */
export function toLivelyPropertiesJson(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, p] of Object.entries(LIVELY_PROPERTIES) as [string, Property][]) {
    if (p.type === 'dropdown') {
      out[name] = { type: p.type, text: p.text, value: p.value, items: p.options.map(([label]) => label), ...(p.help ? { help: p.help } : {}) };
    } else {
      const { apply: _, ...rest } = p;
      out[name] = rest;
    }
  }
  return out;
}
