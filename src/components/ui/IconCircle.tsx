// IconCircle.tsx
// UI V2 第 3 节第 6 条 + 第 1 节「形状」：类别图标 / 账户图标 / 列表图标全部改成圆形。
//   42 圆（列表行、账户行）· 48 圆（记一笔类别格子，size 传入）· 居中 20 / 24 图标。
//
// 色对（UI V2 稿取样）：
//   夜间：底 = 类别色 15% / 图标 = 类别色提亮（混白 18%）
//   日间：底 = 类别色混白 86%（近白淡底）/ 图标 = 同色相压实（见 color.ts categoryIconTint）
//   中性（不传 color，如「全部」）：夜 = surfaceSunken 底 + 次要字色；日 = surface 底 + 轻投影
//   选中（记一笔类别格）：实底类别色 + 两层外圈
//     （日：3dp 页面底色 + 5dp #9B5BD6；夜：3dp 页面底色 + 5dp 类别色 60%）
//
// 用法：
//   <IconCircle color={cat.color} icon="fast-food-outline" />
//   <IconCircle size={48} color={cat.color} icon={cat.icon} selected />
//   <IconCircle icon="grid-outline" />   // 中性「全部」

import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { categoryRing } from '../../theme/theme';
import { categoryIconTint, withAlpha } from './color';

export interface IconCircleProps {
  /** 类别色 / 账户色（hex）；不传 = 中性圆（「全部」那种） */
  color?: string;
  /** 直径：42（默认，列表/账户）· 48（记一笔格子） */
  size?: number;
  /** 图标直径（默认 = size × 0.48：42→20 / 48→23） */
  iconSize?: number;
  /** Ionicons 图标名 */
  icon?: keyof typeof Ionicons.glyphMap;
  /** 选中态：实底 + 两层外圈（记一笔类别格） */
  selected?: boolean;
  style?: ViewStyle;
  children?: React.ReactNode;
}

export function IconCircle({
  color,
  size = 42,
  iconSize,
  icon,
  selected = false,
  style,
  children,
}: IconCircleProps) {
  const { isDark, semantic, elevation } = useTheme();
  const tint = color ? categoryIconTint(color, isDark) : null;

  const bg = selected && color ? color : tint ? tint.bg : isDark ? semantic.surfaceSunken : semantic.surface;
  const fg = selected
    ? isDark
      ? semantic.bg
      : '#FFFFFF'
    : tint
      ? tint.fg
      : semantic.textSecondary;

  const ringColor = color
    ? isDark
      ? withAlpha(color, categoryRing.darkAlpha)
      : categoryRing.light
    : semantic.textTertiary;

  return (
    <View
      style={[
        styles.root,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
        },
        // 日间中性圆用一层轻投影撑轮廓（稿里「全部」格）；选中 / 有色圆不加
        !color && !isDark ? elevation.level1 : null,
      ]}
      // 选中态两层外圈：3dp 页面底色打底 + 5dp 外环（两层都给外侧，圆心不动）
      {...(selected
        ? {
            boxShadow: `0 0 0 ${categoryRing.gapWidth}px ${semantic.bg}, 0 0 0 ${categoryRing.gapWidth + categoryRing.ringWidth}px ${ringColor}`,
          }
        : null)}
    >
      {icon ? <Ionicons name={icon} size={iconSize ?? Math.round(size * 0.48)} color={fg} /> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});

export default IconCircle;
