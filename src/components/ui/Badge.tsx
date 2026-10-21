// Badge.tsx
// 统一小徽章（T04 / 计划 4.5、10.1）：状态标签、预算警示、条数计数。
//
// 规格（UI_RULES 第 1/2 节 + 第 6 节长度预算「胶囊 / 徽章 ≤10 字符」）
// - 形状：radius.xs + 20 高下限 + caption2（11pt，全 App 最小字号档，不许更小）；
// - 色：底 = 主色 10–14% 淡底，字 = 主色本身（neutral 例外：hairline 底 + textSecondary 字）；
//   淡底一律用 withAlpha(语义色, α) 派生，不新写色值；
// - 贴左：alignSelf flex-start，免得在列容器里被拉伸成一条横杠；
// - dot：前置 6 圆点（与字同色），用于「进行中 / 已暂停」这类需要更弱提示的场合。
//
// 用法
//   <Badge label="已暂停" tone="warning" dot />
//   <Badge label="+3" tone="success" />
//   <Badge label={tr('budget.over')} tone="danger" />

import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import type { Radius, SemanticColors, Spacing } from '../../theme/theme';
import { useTheme } from '../../theme/useTheme';
import AppText from './AppText';
import { withAlpha } from './color';

/** 徽章高度下限（11pt 文字 + 上下各 4pt 内边距，胶囊形态） */
const BADGE_MIN_HEIGHT = 20;
/** 前置圆点直径（6：比任何字号都小）—— 纯图形常量 */
const DOT_SIZE = 6;

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  label: string;
  /** 语义色调（默认 neutral） */
  tone?: BadgeTone;
  /** 前置 6 小圆点 */
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Badge({ label, tone = 'neutral', dot = false, style, testID }: BadgeProps) {
  const { semantic, spacing, radius } = useTheme();

  const styles = useMemo(() => makeStyles(spacing, radius), [spacing, radius]);

  // 底 = 主色淡底（10–14%），字 = 主色；neutral 用现成的 hairline 底 + 次要文字色
  const toneColor: Record<BadgeTone, { background: string; foreground: string }> = {
    neutral: { background: semantic.hairline, foreground: semantic.textSecondary },
    accent: { background: semantic.accentSoft, foreground: semantic.accentText },
    success: {
      background: withAlpha(semantic.amountIncome, 0.12),
      foreground: semantic.amountIncome,
    },
    warning: { background: withAlpha(semantic.warning, 0.14), foreground: semantic.warning },
    danger: { background: withAlpha(semantic.danger, 0.12), foreground: semantic.danger },
  };
  const { background, foreground } = toneColor[tone];

  return (
    <View style={[styles.badge, { backgroundColor: background }, style]} testID={testID}>
      {dot && <View style={[styles.dot, { backgroundColor: foreground }]} />}
      {/* 不设 numberOfLines：标签换行也不截断（长度预算由文案侧保证） */}
      <AppText variant="caption2" color={foreground}>
        {label}
      </AppText>
    </View>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 圆角 / 间距） */
function makeStyles(spacing: Spacing, radius: Radius) {
  return StyleSheet.create({
    badge: {
      minHeight: BADGE_MIN_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.xs,
      // 徽章是「标签」不是「块」：列容器里贴左，不拉伸
      alignSelf: 'flex-start',
    },
    dot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2 },
  });
}

export default Badge;
