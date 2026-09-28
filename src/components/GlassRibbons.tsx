// GlassRibbons.tsx
// 净资产卡「曲面玻璃」静态层（2026-09-25 参考图：多层弯曲玻璃薄带+边缘高光）。
// 纯 SVG 静态渲染——零动画、零帧成本；色值走主题 token（homeHeroGlass*）日夜各一套。
// 结构：3 条大曲率玻璃带（渐变填充）+ 2 条上缘高光描边，叠在 heroGradient 渐变之上、
// 内容之下；pointerEvents none 不挡任何点击；圆角裁剪与卡面一致。
// 坐标系：viewBox 0 0 100 60 + preserveAspectRatio="none"（抽象薄带允许随卡比例拉伸）。

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

interface GlassRibbonsProps {
  /** 玻璃亮面色（薄带受光端/高光基底） */
  light: string;
  /** 玻璃深面色（薄带背光端） */
  deep: string;
  /** 上缘高光描边色 */
  sheen: string;
  /** 整层不透明度（日夜可各给一档） */
  opacity?: number;
  /** 裁剪圆角，跟卡面一致 */
  borderRadius?: number;
}

export default function GlassRibbons({
  light,
  deep,
  sheen,
  opacity = 1,
  borderRadius = 20,
}: GlassRibbonsProps) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius,
        overflow: 'hidden',
        opacity,
      }}
    >
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 60" preserveAspectRatio="none">
        <Defs>
          {/* 玻璃带 A：左下→右上大横带 */}
          <LinearGradient id="glassA" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={light} stopOpacity="0.95" />
            <Stop offset="1" stopColor={deep} stopOpacity="0.9" />
          </LinearGradient>
          {/* 玻璃带 B：右上小带 */}
          <LinearGradient id="glassB" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={light} stopOpacity="0.8" />
            <Stop offset="1" stopColor={deep} stopOpacity="0.85" />
          </LinearGradient>
          {/* 玻璃带 C：底部细带 */}
          <LinearGradient id="glassC" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={light} stopOpacity="0.7" />
            <Stop offset="1" stopColor={deep} stopOpacity="0.8" />
          </LinearGradient>
        </Defs>

        {/* 大横带（主曲面） */}
        <Path
          d="M -8 42 C 15 28, 32 52, 55 40 C 75 30, 88 34, 108 16 L 108 34 C 88 46, 74 44, 55 52 C 32 60, 14 44, -8 56 Z"
          fill="url(#glassA)"
        />
        {/* 右上小带 */}
        <Path
          d="M 38 -8 C 52 12, 76 6, 108 -6 L 108 6 C 80 16, 56 20, 42 4 Z"
          fill="url(#glassB)"
        />
        {/* 底部细带 */}
        <Path
          d="M -8 58 C 30 46, 62 58, 108 40 L 108 47 C 62 64, 28 52, -8 64 Z"
          fill="url(#glassC)"
        />

        {/* 玻璃上缘高光：薄带受光边（静态「曲面反光」的关键） */}
        <Path
          d="M -8 42 C 15 28, 32 52, 55 40 C 75 30, 88 34, 108 16"
          fill="none"
          stroke={sheen}
          strokeWidth={0.7}
          strokeOpacity={0.55}
        />
        <Path
          d="M 38 -8 C 52 12, 76 6, 108 -6"
          fill="none"
          stroke={sheen}
          strokeWidth={0.5}
          strokeOpacity={0.45}
        />
      </Svg>
    </View>
  );
}
