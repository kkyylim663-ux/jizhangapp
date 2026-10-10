// GlassView.tsx
// UI V2.1 §2 唯一毛玻璃材质：按钮、分段、卡片、列表、表单、BottomSheet、AppDialog、
// Tab 栏全部用它 —— 不要在页面里各写一份（旧的「白 22% 玻璃 + 白字」「surface 实色卡」已删）。
//
// 材质五层：
//   1. 半透明填充（夜 rgba(14,10,30,.46) / 日 rgba(255,255,255,.55)）
//   2. 1px 亮边（夜 白 10% / 日 白 85%）
//   3. 顶部内高光（1dp 亮线；夜 白 12% / 日 白 90%）
//   4. 投影（0 12 32 -20 rgba(20,10,60,.55)，日夜同值）
//   5. 模糊（iOS / Web 用 expo-blur BlurView(24)，web 走 CSS backdrop-filter；
//      Android 原生模糊有性能/兼容问题 → 退回纯 rgba，只少一层模糊，绝不白屏）
//
// 圆角（§2）：卡片 26 · 按钮 / 分段 / 输入框 999。
//
// 用法：
//   <GlassView radius={999} style={{ height: 44, paddingHorizontal: 16, justifyContent: 'center' }}>
//     <AppText color={semantic.textPrimary}>默认账本</AppText>
//   </GlassView>

import React from 'react';
import { Platform, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../theme/useTheme';

export interface GlassViewProps {
  /** 圆角（数值或 'full'；默认 999 全圆；卡片传 26） */
  radius?: number | 'full';
  /** 模糊强度覆盖（默认取令牌 24） */
  intensity?: number;
  /** 投影开关（默认开；列表行等已在大卡内的玻璃件可关掉，阴影只留在大卡上） */
  shadow?: boolean;
  pointerEvents?: ViewProps['pointerEvents'];
  style?: ViewStyle | ViewStyle[];
  children?: React.ReactNode;
}

export function GlassView({
  radius = 'full',
  intensity,
  shadow = true,
  pointerEvents,
  style,
  children,
}: GlassViewProps) {
  const { glass } = useTheme();
  const blurSupported = Platform.OS === 'ios' || Platform.OS === 'web';
  // ⚠ web 的 BlurView 把 tint 当「白色叠层」用（expo-blur getBackgroundColor：
  //    'default' = rgba(255,255,255, (intensity/100) × 0.3)）—— intensity 100 就是 30% 白，
  //    把夜间玻璃整体提亮一档：实测浮空 Tab 栏内底被抬到 rgb(112,104,120)、玻璃槽抬到
  //    rgb(90,89,105)，上面的 11-13pt 次要字全掉到 4.2:1 以下（§4 要 4.5）。
  //    原生端 intensity 100 才是「最厚材质」的正确档位，所以只压 web：
  //    12px 模糊 + 18% 白，夜间玻璃回到「填色令牌说了算」的深色（与稿里的夜间玻璃对得上）。
  const WEB_BLUR_CAP = 60;
  const requested = intensity ?? glass.blurIntensity;
  const resolvedIntensity = Platform.OS === 'web' ? Math.min(requested, WEB_BLUR_CAP) : requested;

  return (
    <View
      pointerEvents={pointerEvents}
      style={[
        styles.root,
        {
          borderRadius: radius === 'full' ? 999 : radius,
          backgroundColor: glass.fill,
          borderWidth: glass.borderWidth,
          borderColor: glass.borderColor,
          boxShadow: shadow ? glass.shadow : undefined,
        },
        style,
      ]}
    >
      {/* 模糊垫底：只铺在内容下面，不吃触摸。
          tint 固定 'default'（iOS = 系统默认材质；web = 白色叠层，见上面 WEB_BLUR_CAP 的说明）：
          颜色由令牌的 fill 决定，模糊层不再二次染色（'dark' 会把夜间玻璃压暗一档） */}
      {blurSupported ? (
        <BlurView
          intensity={resolvedIntensity}
          tint="default"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}
      {/* 顶部内高光（1dp 细亮线；不随内容滚动） */}
      <View
        pointerEvents="none"
        style={[
          styles.highlight,
          { height: glass.highlightHeight, backgroundColor: glass.highlightColor },
        ]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // overflow hidden：亮边 / 高光 / 模糊都被圆角裁切（半透明卡不加 elevation——会透出阴影）
  root: {
    overflow: 'hidden',
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});

export default GlassView;
