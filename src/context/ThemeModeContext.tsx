// ThemeModeContext.tsx
// 管理"用户在设置项里选的深色模式偏好"，跟 useTheme.ts 的系统检测是分开的两件事：
// - 这里存的是用户的"选择"：跟随系统 / 始终亮色 / 始终暗色
// - useTheme.ts 负责把这个选择 + 系统当前外观，算成最终该用 light 还是 dark 的颜色

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = '@jizhang/themeMode';

interface ThemeModeContextValue {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  loaded: boolean; // 本地保存的偏好是否已经读取完成，避免刚启动时闪一下默认值
}

const ThemeModeContext = createContext<ThemeModeContextValue | undefined>(undefined);

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setThemeModeState(stored);
        }
      } catch (e) {
        console.warn('读取深色模式偏好失败', e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    AsyncStorage.setItem(STORAGE_KEY, mode);
  };

  return (
    <ThemeModeContext.Provider value={{ themeMode, setThemeMode, loaded }}>
      {children}
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode() {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error('useThemeMode必须在ThemeModeProvider内部使用');
  return ctx;
}
