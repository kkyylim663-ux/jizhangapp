// 语言模式 Provider：中文 / English（TASK-021：跟随系统选项已去除——
// 旧存档里的 'system' 在启动迁移时按设备语言定死成 zh/en）。
// 与 ThemeModeContext 同款模式：用户选择持久化到 AsyncStorage，切换即时生效。
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getLocales } from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LangMode, applyLangMode, t as globalT, TranslateFunction } from './index';

export { LangMode } from './index';

const LANGUAGE_KEY = '@jizhang/language';

// 旧存档 'system' 的迁移解析：设备首选语言 zh 开头 → 中文，否则英文
const resolveSystemLang = (): 'zh' | 'en' => {
  const tag = getLocales()[0]?.languageTag ?? 'zh';
  return tag.toLowerCase().startsWith('zh') ? 'zh' : 'en';
};

interface LanguageContextValue {
  langMode: LangMode;
  setLangMode: (mode: LangMode) => void;
  /** 当前语言模式下的翻译函数 */
  t: TranslateFunction;
}

const LanguageContext = createContext<LanguageContextValue>({
  langMode: 'zh',
  setLangMode: () => {},
  t: globalT,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [langMode, setLangModeState] = useState<LangMode>('zh');
  const [loaded, setLoaded] = useState(false);

  // 启动时恢复上次选择的语言模式（旧 'system' 存档迁移成确定语言后写回）
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(LANGUAGE_KEY);
        if (saved === 'zh' || saved === 'en') {
          setLangModeState(saved);
          applyLangMode(saved);
        } else if (saved === 'system') {
          const migrated = resolveSystemLang();
          setLangModeState(migrated);
          applyLangMode(migrated);
          AsyncStorage.setItem(LANGUAGE_KEY, migrated).catch(() => {});
        }
      } catch (e) {
        console.warn('读取语言设置失败', e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const setLangMode = (mode: LangMode) => {
    setLangModeState(mode);
    applyLangMode(mode);
    AsyncStorage.setItem(LANGUAGE_KEY, mode).catch((e) => console.warn('保存语言设置失败', e));
  };

  // t 直接引用全局实例函数（applyLangMode 改的就是实例 locale，重渲染时自然取新语言）
  const value = useMemo(() => ({ langMode, setLangMode, t: globalT }), [langMode]);

  // 语言恢复完成前不渲染（避免先以系统语言闪一帧再跳变）
  if (!loaded) return null;

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

/** 页面里用：拿当前语言的翻译函数 */
export function useT(): TranslateFunction {
  return useContext(LanguageContext).t;
}