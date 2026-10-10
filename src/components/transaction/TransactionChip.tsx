// TransactionChip.tsx
// 记一笔 Hero 行的 V2 胶囊（账户 / 今天 / 每月，稿 G_Add.dc.html .chip）：
//   - 夜：surfaceSunken 实底 + 顶部细亮线（无描边）；日：白底 + elevation.level1 轻投影；
//   - 高 36 / 全圆角 / 内 12 / 图标 16 / 文字 13 500（选中 600 + accentSoft 底）；
//   - 账户 Chip 左侧带 16dp 账户色圆点；右侧 chevron 14 用 textTertiary。
//
// 为什么不是 ui/Chip：共享 Chip 是"描边筛选胶囊"（透明底 + hairline 边，用于统计/设置等页），
// 与记一笔稿里的实底 Chip 是两种外观；本组件只服务记一笔一行，避免动到其它页面的观感。
// 触控高度仍按 UI_RULES 撑到 44（视觉胶囊 36 居中）。

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import AppText from '../ui/AppText';
import PressableScale from '../PressableScale';

export interface TransactionChipProps {
  label: string;
  onPress?: () => void;
  /** 文字左侧的账户色圆点（16；仅账户 Chip 用） */
  dotColor?: string;
  /** 文字左侧小图标（Ionicons，16；「每月」的 repeat 用） */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** 文字右侧小图标（Ionicons，14；账户 / 日期 Chip 的 chevron-down） */
  trailingIcon?: React.ComponentProps<typeof Ionicons>['name'];
  /** 选中态（「每月」开关）：accentSoft 底 + accentText 字 */
  selected?: boolean;
  /** 矮屏档（T15 惯例）：触控容器 44→40，省下的 4 让给类别网格 */
  compact?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

export function TransactionChip({
  label,
  onPress,
  dotColor,
  icon,
  trailingIcon,
  selected,
  compact,
  accessibilityLabel,
  testID,
}: TransactionChipProps) {
  const { semantic, elevation, isDark } = useTheme();

  const foreground = selected ? semantic.accentText : semantic.textPrimary;
  const background = selected ? semantic.accentSoft : isDark ? semantic.surfaceSunken : semantic.surface;

  return (
    <PressableScale
      onPress={onPress}
      activeScale={0.95}
      // 胶囊成排出现，外扩 hitSlop 会盖住邻居；44 触控高已经够按
      hitSlop={0}
      style={[styles.touch, compact && styles.touchCompact]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected }}
      testID={testID}
    >
      <View
        style={[
          styles.pill,
          compact && styles.pillCompact,
          { backgroundColor: background },
          // 日间：白底靠轻投影撑轮廓；夜间不投影，改用顶部细亮线（与键帽/玻璃同一手法）
          !isDark && !selected ? elevation.level1 : null,
        ]}
      >
        {isDark && !selected ? (
          <View pointerEvents="none" style={[styles.topLine, { backgroundColor: semantic.hairline }]} />
        ) : null}
        {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
        {icon ? <Ionicons name={icon} size={16} color={foreground} /> : null}
        <AppText variant="footnote" weight={selected ? '600' : '500'} color={foreground} numberOfLines={1}>
          {label}
        </AppText>
        {trailingIcon ? <Ionicons name={trailingIcon} size={14} color={semantic.textTertiary} /> : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // 触控容器：撑到 44、胶囊居中（视觉 36，与稿一致）
  touch: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // 矮屏档：触控容器 40（胶囊本身不变）
  touchCompact: { minHeight: 40 },
  // 视觉胶囊（稿：高 36 / 内 12 / gap 6）
  pill: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 12,
    columnGap: 6,
    overflow: 'hidden',
  },
  // 矮屏档：内边距 12→10（三个 Chip 在 360 英文下仍能排成一行，不换行、不截断）
  pillCompact: { paddingHorizontal: 10 },
  // 账户色圆点（16）
  dot: { width: 16, height: 16, borderRadius: 999 },
  // 顶部细亮线（夜）：贴顶、随圆角裁切
  topLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
});

export default TransactionChip;
