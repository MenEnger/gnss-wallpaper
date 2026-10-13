import { LANG_INFO, LANGS, matchLang, type Lang, type MessageKey } from './locales/index.ts';
import { en } from './locales/en.ts';

/** 表示言語。既定は英語で、ブラウザ／OS の言語が対応言語ならその言語にする。 */
export { LANGS, LANG_INFO, type Lang, type MessageKey };
export type LanguageSetting = 'auto' | Lang;

let current: Lang = 'en';

export function detectLang(): Lang {
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const l = tag ? matchLang(tag) : null;
    if (l) return l;
  }
  return 'en';
}

export function setLanguage(setting: LanguageSetting): Lang {
  current = setting === 'auto' ? detectLang() : setting;
  document.documentElement.lang = current;
  return current;
}

export function lang(): Lang {
  return current;
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let s: string = LANG_INFO[current].dict[key] ?? en[key];
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** 経過・残り時間の表示（例: 1 h 59 min / 4:05 / 25s） */
export function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return t('duration.hm', { h, m });
  if (m > 0) return t('duration.ms', { m, s, ss: String(s).padStart(2, '0') });
  return t('duration.s', { s });
}

/** 軌道データの状態を表示文にする */
export function statusMessage(st: { code: string; params: Record<string, string | number> }): string {
  const { reason, ...rest } = st.params;
  const error = reason ? t(`error.${reason}` as MessageKey, rest) : '';
  return t(`status.${st.code}` as MessageKey, { ...rest, error });
}
