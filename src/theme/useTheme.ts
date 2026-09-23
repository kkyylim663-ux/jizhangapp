// useTheme.ts
import { useColorScheme } from 'react-native';
import { lightColors, darkColors, ThemeColors } from './theme';
import { useThemeMode } from '../context/ThemeModeContext';

// override参数保留：极少数需要强制显示某个主题的场景可以用（比如某个截图/预览）。
// 正常页面不传override，会自动读取"设置项"里保存的深色模式偏好：
//   跟随系统 -> 用手机当前的系统外观
//   始终亮色 / 始终暗色 -> 忽略系统外观，固定用这个
export function useTheme(override?: 'light' | 'dark'): {
  isDark: boolean;
  colors: ThemeColors;
} {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null
  const { themeMode } = useThemeMode();

  const resolvedMode: 'light' | 'dark' =
    override ?? (themeMode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : themeMode);
  const isDark = resolvedMode === 'dark';

  return {
    isDark,
    colors: isDark ? darkColors : lightColors,
  };
}
