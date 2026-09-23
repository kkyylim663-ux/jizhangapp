// PressableScale.tsx
// 全局统一的按压反馈：按下去 scale 0.97、120ms ease-out（animate-expo skill 的
// press feedback 配方）。反馈发生在按下瞬间，而不是松手之后——这是"界面在听你"的感觉来源。
//
// 用法：直接替换 TouchableOpacity/Pressable，onPress + style + children。
// 大卡片用默认 0.97；小图标建议 0.88-0.94（activeScale），反馈更可感知。

import React, { useState } from 'react';
import { Platform, Pressable, StyleProp, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

// RN 的 ViewStyle 类型还没收录 CSS transition 这几个属性
// （web 端 react-native-web 和新架构原生都实际支持），抽成宽类型常量绕过检查。
// 注意：原生端 Reanimated 的 transitionTimingFunction 只认预定义关键字
// （linear/ease/ease-in/ease-out/ease-in-out...），cubic-bezier 字符串会直接报错；
// web 端浏览器则完全支持 cubic-bezier。
export const PRESS_TRANSITION = {
  transitionProperty: 'transform',
  transitionDuration: '120ms',
  transitionTimingFunction: Platform.select({
    web: 'cubic-bezier(0.23, 1, 0.32, 1)',
    default: 'ease-out',
  }),
} as unknown as ViewStyle;

type Props = {
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  // 默认 0.97：卡片/行这类大目标；小按钮建议 0.88-0.94
  activeScale?: number;
  disabled?: boolean;
  hitSlop?: number | { top?: number; bottom?: number; left?: number; right?: number };
  /** 长按触发延迟（毫秒），透传给 RN Pressable 的 delayLongPress */
  delayLongPress?: number;
  // 无障碍透传（可选）：TouchableOpacity 迁移时原样带上，不影响既有调用点
  accessibilityRole?: React.ComponentProps<typeof Pressable>['accessibilityRole'];
  accessibilityLabel?: string;
  accessibilityState?: React.ComponentProps<typeof Pressable>['accessibilityState'];
};

export default function PressableScale({
  onPress,
  onLongPress,
  style,
  children,
  activeScale = 0.97,
  disabled,
  hitSlop = 12,
  delayLongPress,
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
}: Props) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      hitSlop={hitSlop as any}
      pressRetentionOffset={16}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
    >
      <Animated.View
        style={[PRESS_TRANSITION, pressed && { transform: [{ scale: activeScale }] }, style]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}
