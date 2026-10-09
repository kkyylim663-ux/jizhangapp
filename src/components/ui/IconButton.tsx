// IconButton.tsx
// 统一图标按钮（T03 / 计划 4.5）：44pt 触控区 + 必填无障碍标签 —— 取代现在 13 种页头里
// 各种 28–40pt 的圆环返回键、关闭键。
//
// 规则
// - 触控区一律 44×44（UI_RULES 第 4/8 节 + 计划 T30：所有可点元素 ≥44pt）；
// - 图标尺寸只有 20 / 24 两档，只用 Ionicons（UI_RULES 第 7 节）；
// - accessibilityLabel 必填：图标本身没有文字，读屏只能靠它；
// - 按下有反馈（PressableScale 弹簧缩放），但不震动（滚动、普通导航不震动）。
//
// 用法
//   <IconButton icon="chevron-back" accessibilityLabel={tr('common.back')} onPress={goBack} />
//   <IconButton icon="ellipsis-horizontal" variant="soft" accessibilityLabel="更多" onPress={openSheet} />

import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PressableScale from '../PressableScale';
import { useTheme } from '../../theme/useTheme';

/** 触控区边长（UI_RULES：所有可点元素 ≥44pt） */
const TOUCH_SIZE = 44;

export interface IconButtonProps {
  /** Ionicons 图标名（只用 Ionicons，UI_RULES 第 7 节） */
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** 无障碍标签（读屏用，必填） */
  accessibilityLabel: string;
  onPress?: () => void;
  onLongPress?: () => void;
  /** 图标尺寸：只有 20 / 24 两档 */
  size?: 20 | 24;
  /** 图标颜色（默认 semantic.textPrimary；深色卡上用 homeIconColor 等场景色） */
  color?: string;
  /** plain = 无底（默认，视觉只有图标）· soft = accentSoft 圆底 · solid = accent 实底 */
  variant?: 'plain' | 'soft' | 'solid';
  disabled?: boolean;
  /** 额外触控外扩（默认 0：触控区已经 44，再外扩会压到相邻控件） */
  hitSlop?: number;
  accessibilityState?: React.ComponentProps<typeof PressableScale>['accessibilityState'];
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  onLongPress,
  size = 24,
  color,
  variant = 'plain',
  disabled,
  hitSlop = 0,
  accessibilityState,
  style,
  testID,
}: IconButtonProps) {
  const { semantic } = useTheme();

  const background =
    variant === 'solid'
      ? semantic.accent
      : variant === 'soft'
        ? semantic.accentSoft
        : 'transparent';
  const iconColor =
    color ?? (variant === 'solid' ? semantic.onAccent : variant === 'soft' ? semantic.accentText : semantic.textPrimary);

  return (
    <PressableScale
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
      activeScale={0.9}
      style={[styles.touch, { backgroundColor: background }, disabled && styles.disabled, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ ...accessibilityState, disabled: disabled || undefined }}
      testID={testID}
    >
      <View style={styles.iconWrap} pointerEvents="none">
        <Ionicons name={icon} size={size} color={iconColor} />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  touch: {
    width: TOUCH_SIZE,
    minHeight: TOUCH_SIZE,
    borderRadius: TOUCH_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  // 禁用：变灰（不只是变淡），点了没反应由 Pressable 的 disabled 保证
  disabled: { opacity: 0.4 },
});

export default IconButton;
