// ThemeModeContext.tsx
// 管理"用户在设置项里选的深色模式偏好"，跟 useTheme.ts 的系统检测是分开的两件事：
// - 这里存的是用户的"选择"：始终亮色 / 始终暗色（TASK-021：跟随系统已去除——
//   旧存档里的 'system' 在启动迁移时按设备当前外观定死成 light/dark）
// - useTheme.ts 负责把这个选择算成最终该用的颜色

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
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
  const [themeMode, setThemeModeState] = useState<ThemeMode>('light');
  const [loaded, setLoaded] = useState(false);
  const systemScheme = useColorScheme();

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored === 'light' || stored === 'dark') {
          setThemeModeState(stored);
        } else if (stored === 'system') {
          // 旧存档迁移：跟随系统 → 按设备当前外观定死（之后 UI 不再提供跟随系统选项）
          const migrated: ThemeMode = systemScheme === 'dark' ? 'dark' : 'light';
          setThemeModeState(migrated);
          AsyncStorage.setItem(STORAGE_KEY, migrated);
        }
      } catch (e) {
        console.warn('读取深色模式偏好失败', e);
      } finally {
        setLoaded(true);
      }
    })();
    // systemScheme 只在挂载时读一次（迁移分支用）
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
