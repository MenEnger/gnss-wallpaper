import type { SettingsPatch } from '../config/settings';
import { en, type MessageKey } from '../locales/en.ts';
import { LANG_INFO, LANGS } from '../locales/index.ts';

/**
 * Lively Wallpaper の「カスタマイズ」画面の定義。
 * 表示文は i18n の辞書（src/locales）のキーで指定し、scripts/package-lively.ts が
 * LivelyProperties.json（英語）と LivelyProperties.loc.json（他言語, Lively v2.2 以降）を生成する。
 * ページ側は toSettingsPatch で値を設定に変換する。
 * Node の型除去でそのまま読み込むため、import は拡張子付きの相対パスのみ。
 *
 * Lively の仕様: dropdown は選択肢の番号、slider は数値、checkbox は真偽値を返す。
 * 読み込み時に全項目の現在値が livelyPropertyListener で通知される。
 */

/** 辞書のキー、または全言語共通の固定文字列 */
type Text = MessageKey | { raw: string };

type Dropdown = { type: 'dropdown'; text: Text; options: [label: Text, value: unknown][]; value: number; help?: Text };
type Slider = { type: 'slider'; text: Text; min: number; max: number; step: number; value: number; help?: Text };
type Checkbox = { type: 'checkbox'; text: Text; value: boolean; help?: Text };
type Label = { type: 'label'; value: Text };
type Property = (Dropdown | Slider | Checkbox | Label) & { apply?: (v: never) => SettingsPatch };

const raw = (s: string): Text => ({ raw: s });

const gnss = (id: string, name: string): Checkbox & { apply: (v: boolean) => SettingsPatch } => ({
  type: 'checkbox',
  text: raw(name),
  value: true,
  apply: (v) => ({ constellations: { [id]: !!v } }),
});

export const LIVELY_PROPERTIES = {
  theme: {
    type: 'dropdown',
    text: 'theme',
    options: [
      [raw('Realistic'), 'realistic'],
      [raw('Technical'), 'technical'],
    ],
    value: 0,
  },
  labelMode: {
    type: 'dropdown',
    text: 'labels',
    options: [
      ['labels.off', 'off'],
      ['labels.id', 'id'],
      ['labels.name', 'name'],
    ],
    value: 0,
  },
  orbitLineMode: {
    type: 'dropdown',
    text: 'orbitLines',
    options: [
      ['orbit.trail', 'trail'],
      ['orbit.full', 'full'],
      ['orbit.none', 'none'],
    ],
    value: 0,
  },
  trailMinutes: { type: 'slider', text: 'trailMinutes', min: 10, max: 720, step: 5, value: 120 },
  altitudePercent: {
    type: 'slider',
    text: 'lively.altitude',
    min: 5,
    max: 100,
    step: 1,
    value: 10,
    help: 'lively.altitudeHelp',
    apply: (v: number) => ({ altitudeScale: Number(v) / 100 }),
  },
  gnssLabel: { type: 'label', value: 'folder.gnss' },
  gps: gnss('gps', 'GPS'),
  glonass: gnss('glonass', 'GLONASS'),
  galileo: gnss('galileo', 'Galileo'),
  beidou: gnss('beidou', 'BeiDou'),
  qzss: gnss('qzss', 'QZSS'),
  locationLabel: { type: 'label', value: 'folder.location' },
  locationMode: {
    type: 'dropdown',
    text: 'locationMode',
    options: [
      ['location.off', 'off'],
      ['location.auto', 'auto'],
      ['location.manual', 'manual'],
    ],
    value: 1,
    help: 'lively.locationHelp',
  },
  latitude: { type: 'slider', text: 'lively.latitude', min: -90, max: 90, step: 0.1, value: 35.7 },
  longitude: { type: 'slider', text: 'lively.longitude', min: -180, max: 180, step: 0.1, value: 139.8 },
  highlightVisible: { type: 'checkbox', text: 'sky.highlight', value: true },
  minElevation: { type: 'slider', text: 'sky.minElevation', min: 0, max: 30, step: 1, value: 5 },
  skyLines: { type: 'checkbox', text: 'sky.lines', value: true },
  showVisibleCount: { type: 'checkbox', text: 'sky.count', value: true },
  cameraLabel: { type: 'label', value: 'folder.camera' },
  autoCamera: { type: 'checkbox', text: 'autoCamera', value: true },
  cameraSpeed: { type: 'slider', text: 'cameraSpeed', min: 0, max: 10, step: 0.1, value: 1.2 },
  cameraDistance: { type: 'slider', text: 'cameraDistance', min: 2, max: 20, step: 0.5, value: 5 },
  otherLabel: { type: 'label', value: 'folder.other' },
  timeScale: {
    type: 'dropdown',
    text: 'timeScale',
    options: [
      ['time.real', 1],
      [raw('×10'), 10],
      ['time.x60', 60],
      ['time.x600', 600],
      ['time.x3600', 3600],
    ],
    value: 0,
  },
  language: {
    type: 'dropdown',
    text: 'language',
    options: [['language.auto', 'auto'], ...LANGS.map((l): [Text, unknown] => [raw(LANG_INFO[l].nativeName), l])],
    value: 0,
  },
  maxFps: {
    type: 'dropdown',
    text: 'maxFps',
    options: [
      ['fps.unlimited', 0],
      [raw('60'), 60],
      [raw('30'), 30],
      [raw('15'), 15],
    ],
    value: 2,
    help: 'lively.fpsHelp',
  },
  showUi: { type: 'checkbox', text: 'lively.showUi', value: false },
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

function text(x: Text, dict: Record<MessageKey, string>): string {
  return typeof x === 'object' ? x.raw : dict[x];
}

/** 1 言語分のプロパティ定義。base = true なら LivelyProperties.json 用の完全な形、false なら訳のみ */
function build(dict: Record<MessageKey, string>, base: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, p] of Object.entries(LIVELY_PROPERTIES) as [string, Property][]) {
    const help = 'help' in p && p.help ? { help: text(p.help, dict) } : {};
    if (p.type === 'label') {
      out[name] = base ? { type: p.type, value: text(p.value, dict) } : { value: text(p.value, dict) };
    } else if (p.type === 'dropdown') {
      const items = p.options.map(([l]) => text(l, dict));
      out[name] = base ? { type: p.type, text: text(p.text, dict), value: p.value, items, ...help } : { text: text(p.text, dict), items, ...help };
    } else if (p.type === 'slider') {
      out[name] = base
        ? { type: p.type, text: text(p.text, dict), min: p.min, max: p.max, step: p.step, value: p.value, ...help }
        : { text: text(p.text, dict), ...help };
    } else {
      out[name] = base ? { type: p.type, text: text(p.text, dict), value: p.value, ...help } : { text: text(p.text, dict), ...help };
    }
  }
  return out;
}

/** LivelyProperties.json（英語）の内容 */
export function toLivelyPropertiesJson(): Record<string, unknown> {
  return build(en, true);
}

/** LivelyProperties.loc.json（英語以外の全対応言語）の内容 */
export function toLivelyPropertiesLocJson(): Record<string, unknown> {
  const languages: Record<string, unknown> = {};
  for (const l of LANGS) for (const code of LANG_INFO[l].livelyCodes) languages[code] = build(LANG_INFO[l].dict, false);
  return { Languages: languages };
}

/** LivelyInfo.loc.json（ギャラリーのタイトルと説明）の内容 */
export function toLivelyInfoLocJson(title: string): Record<string, unknown> {
  const languages: Record<string, unknown> = {};
  for (const l of LANGS) for (const code of LANG_INFO[l].livelyCodes) languages[code] = { Title: title, Desc: LANG_INFO[l].dict['lively.desc'] };
  return { Languages: languages };
}
