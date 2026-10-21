// ThemeModeContext.tsx
// 管理"深色模式取哪套颜色"的用户选择：
// - 'system'（默认）：跟随手机 —— 系统深色 / 省电模式进入深色时 App 自动变夜间
//   （Android 10+ 开省电模式会自动切系统深色；iPhone 低电量模式不会，只跟随"外观"设置）
// - 'light' / 'dark'：用户明确固定成日间或夜间
// useTheme.ts 负责把这个选择算成最终该用的颜色。

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = '@jizhang/themeMode';
// 一次性迁移标记（计划 T01e）：写下它之后，用户的主题选择不再被重置
const MIGRATION_V2_KEY = '@jizhang/themeModeV2';

interface ThemeModeContextValue {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  loaded: boolean; // 本地保存的偏好是否已经读取完成，避免刚启动时闪一下默认值
}

const ThemeModeContext = createContext<ThemeModeContextValue | undefined>(undefined);

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  // 默认「跟随系统」：第一帧就跟着手机外观，不会先闪一下日间
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // 一次性迁移（计划 T01e）：旧版本把「跟随系统」按当时外观定死成 light / dark 并写回存档，
        // 那些用户读到的就是被锁死的值。没有 v2 标记的用户一律重置为「跟随系统」并打标记，只做一次。
        const migrated = await AsyncStorage.getItem(MIGRATION_V2_KEY);
        if (!migrated) {
          setThemeModeState('system');
          await AsyncStorage.multiSet([
            [MIGRATION_V2_KEY, '1'],
            [STORAGE_KEY, 'system'],
          ]);
        } else {
          const stored = await AsyncStorage.getItem(STORAGE_KEY);
          if (stored === 'light' || stored === 'dark' || stored === 'system') {
            setThemeModeState(stored);
          }
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
    // 一起写迁移标记：用户手动选过主题后，即使迁移逻辑还没跑到，也不能再把他重置回「跟随系统」
    AsyncStorage.multiSet([
      [STORAGE_KEY, mode],
      [MIGRATION_V2_KEY, '1'],
    ]).catch((e) => console.warn('保存深色模式偏好失败', e));
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
