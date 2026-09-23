// i18n 实例：i18n-js 单例 + 语言模式。
// 默认跟随系统语言（zh/en 之外的语系回退中文），用户可在设置里手动指定并持久化。
import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';
import { zh } from './zh';
import { en } from './en';

export type LangMode = 'system' | 'zh' | 'en';
export type ResolvedLang = 'zh' | 'en';
export type TranslateFunction = (key: string, params?: Record<string, string | number>) => string;

const i18n = new I18n({ zh, en });
i18n.enableFallback = true;
i18n.defaultLocale = 'zh';

// 初始值跟随系统：系统首选语言是 zh 开头就用中文，否则英文
const deviceLang = Localization.getLocales()[0]?.languageTag ?? 'zh';
i18n.locale = deviceLang.toLowerCase().startsWith('zh') ? 'zh' : 'en';

/** 切换语言（跟随系统时按设备语言解析） */
export function applyLangMode(mode: LangMode) {
  i18n.locale =
    mode === 'system'
      ? deviceLang.toLowerCase().startsWith('zh')
        ? 'zh'
        : 'en'
      : mode;
}

/** 全局翻译函数：直接用 i18n 实例的 t（界面组件经 useT() 拿到同一实例） */
export const t: TranslateFunction = (key, params) => (params ? i18n.t(key, params) : i18n.t(key));

export { i18n };