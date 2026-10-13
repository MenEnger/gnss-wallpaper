import { de } from './de.ts';
import { en, type MessageKey } from './en.ts';
import { es } from './es.ts';
import { fr } from './fr.ts';
import { ja } from './ja.ts';
import { ko } from './ko.ts';
import { ptBR } from './pt-BR.ts';
import { ru } from './ru.ts';
import { zhCN } from './zh-CN.ts';
import { zhHant } from './zh-Hant.ts';

export type { MessageKey };

export const LANGS = ['en', 'ja', 'zh-CN', 'zh-Hant', 'ko', 'ru', 'es', 'fr', 'de', 'pt-BR'] as const;
export type Lang = (typeof LANGS)[number];

export interface LangInfo {
  /** その言語自身での名称（言語選択に表示） */
  nativeName: string;
  dict: Record<MessageKey, string>;
  /** Lively の言語コード（LivelyProperties.loc.json のキー）。en は基準なので空 */
  livelyCodes: string[];
}

export const LANG_INFO: Record<Lang, LangInfo> = {
  en: { nativeName: 'English', dict: en, livelyCodes: [] },
  ja: { nativeName: '日本語', dict: ja, livelyCodes: ['ja-JP'] },
  'zh-CN': { nativeName: '简体中文', dict: zhCN, livelyCodes: ['zh-CN'] },
  'zh-Hant': { nativeName: '繁體中文', dict: zhHant, livelyCodes: ['zh-Hant'] },
  ko: { nativeName: '한국어', dict: ko, livelyCodes: ['ko-KR'] },
  ru: { nativeName: 'Русский', dict: ru, livelyCodes: ['ru-RU'] },
  es: { nativeName: 'Español', dict: es, livelyCodes: ['es-ES', 'es-MX'] },
  fr: { nativeName: 'Français', dict: fr, livelyCodes: ['fr-FR'] },
  de: { nativeName: 'Deutsch', dict: de, livelyCodes: ['de-DE'] },
  'pt-BR': { nativeName: 'Português (Brasil)', dict: ptBR, livelyCodes: ['pt-BR', 'pt-PT'] },
};

/** BCP 47 の言語タグ（navigator.language など）を対応言語に寄せる。対応外は null */
export function matchLang(tag: string): Lang | null {
  const t = tag.toLowerCase();
  if (t.startsWith('zh')) return /hant|-tw|-hk|-mo/.test(t) ? 'zh-Hant' : 'zh-CN';
  if (t.startsWith('pt')) return 'pt-BR';
  const base = t.split('-')[0];
  return (LANGS as readonly string[]).includes(base) ? (base as Lang) : null;
}
