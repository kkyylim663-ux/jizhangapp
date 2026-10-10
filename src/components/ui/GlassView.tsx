// GlassView.tsx
// UI V2 第 1 节「玻璃」+ 第 3 节第 2 条：所有落在品牌渐变上的控件（账本胶囊、44 圆钮、
// 预算卡、分段槽…）统一用它 —— 不要在页面里各写一份。
//
// 材质三层：
//   1. 半透明填充（夜 rgba(255,255,255,.14) / 日 rgba(255,255,255,.22)）
//   2. 1px 亮边（夜 .22 / 日 .40）
//   3. 顶部内高光（夜 .25 / 日 .5，贴顶 1dp 细亮线）
// 模糊：iOS / Web 用 expo-blur BlurView(intensity 30) 垫底（web 走 CSS backdrop-filter）；
//       Android 原生模糊有性能/兼容问题 → 按规范退回纯 rgba（只少一层模糊，绝不白屏）。
//
// 用法：
//   <GlassView radius={999} style={{ height: 44, paddingHorizontal: 16, justifyContent: 'center' }}>
//     <AppText color="#fff">默认账本</AppText>
//   </GlassView>

import React from 'react';
import { Platform, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../theme/useTheme';

export interface GlassViewProps {
  /** 圆角（数值或 'full'；默认 999 全圆） */
  radius?: number | 'full';
  /** 模糊强度覆盖（默认取令牌 30） */
  intensity?: number;
  style?: ViewStyle | ViewStyle[];
  children?: React.ReactNode;
}

export function GlassView({ radius = 'full', intensity, style, children }: GlassViewProps) {
  const { glass } = useTheme();
  const blurSupported = Platform.OS === 'ios' || Platform.OS === 'web';

  return (
    <View
      style={[
        styles.root,
        {
          borderRadius: radius === 'full' ? 999 : radius,
          backgroundColor: glass.fill,
          borderWidth: glass.borderWidth,
          borderColor: glass.borderColor,
        },
        style,
      ]}
    >
      {/* 模糊垫底：只铺在内容下面，不吃触摸。
          tint 固定 'default'（web = rgba(255,255,255,.09) / iOS = 系统默认材质）：
          颜色由令牌的 fill 决定，模糊层不再二次染色（'dark' 会把夜间玻璃压暗一档） */}
      {blurSupported ? (
        <BlurView
          intensity={intensity ?? glass.blurIntensity}
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
  // overflow hidden：亮边 / 高光 / 模糊都被圆角裁切（半透明卡不要加 elevation，会透出阴影）
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
