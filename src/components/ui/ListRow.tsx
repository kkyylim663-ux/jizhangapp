// ListRow.tsx
// 通用列表行（T04 / 计划 4.5、10.1 —— 全 App 的「设置型」列表行统一用它，UI_RULES 第 7 节）。
//
// 中英文不撞（UI_RULES 第 6 节 / 计划 9.2）
// - 行不写固定高度，只给 minHeight（useLayout().rowMinHeight）+ 上下内边距：标题换行时长高；
// - 左 / 中 / 右三块用「一行 flexWrap + space-between + gap」排布：标签和右侧值一起放不下时，
//   右侧值整块掉到第二行 —— 纯样式实现，不测量字数、不缩字、不用省略号（英文长的解法）；
// - 文字块 flexShrink:1（可以换行、可以被挤窄），右侧值块 flexShrink:0（金额永不被挤压）；
// - 标题最多 2 行（用户输入的超长备注在列表里也遵守这条）。
//
// 用法
//   <ListRow icon="wallet-outline" title="现金" value={<MoneyText value={n} />} chevron onPress={open} />
//   <ListRow title="提醒" subtitle="每天 21:00" trailing={<Switch value={v} onValueChange={setV} />} />

import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PressableScale from '../PressableScale';
import type { Layout, SemanticColors, Spacing } from '../../theme/theme';
import { useTheme } from '../../theme/useTheme';
import { useLayout } from '../../theme/useLayout';
import AppText from './AppText';

/** 行首小图标尺寸（UI_RULES 第 7 节：图标只有 20 / 24 两档，行内取小档）—— 纯图形常量 */
const ROW_ICON_SIZE = 20;
/** 行尾 chevron 的几何常量（16：箭头要明显小于内容图标）—— 纯图形常量 */
const CHEVRON_SIZE = 16;
/** 按压反馈档：整行是大目标，用通用 0.98（小控件才用更小的值） */
const ROW_ACTIVE_SCALE = 0.98;
/** 禁用态整体透明度（不是色值 / 字号，不算写死令牌） */
const DISABLED_OPACITY = 0.4;

export interface ListRowProps {
  /** 左侧小图标（20），leading 存在时被忽略 */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** 图标色（默认 semantic.accentText） */
  iconColor?: string;
  /** 左侧自定义内容（优先于 icon，比如类别图标方块） */
  leading?: React.ReactNode;
  /** 主标题（headline，最多 2 行） */
  title: string;
  /** 副标题（footnote + textSecondary，1 行） */
  subtitle?: string;
  /** 右侧值（字符串或 <MoneyText/>）；flexShrink:0，永不被挤压 */
  value?: React.ReactNode;
  /** 值下方小字（caption + textTertiary） */
  valueCaption?: string;
  /** 右侧 chevron（Ionicons 'chevron-forward' 16） */
  chevron?: boolean;
  /** 右侧自定义内容（Switch / Chip 等，优先于 value / chevron） */
  trailing?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** 独立成行（不在 ListSection 里）时传 true，自行画底部发丝线 */
  separator?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ListRow({
  icon,
  iconColor,
  leading,
  title,
  subtitle,
  value,
  valueCaption,
  chevron,
  trailing,
  onPress,
  onLongPress,
  disabled,
  separator = false,
  accessibilityLabel,
  style,
  testID,
}: ListRowProps) {
  const { semantic, spacing, layout } = useTheme();
  const { rowMinHeight } = useLayout();

  const styles = useMemo(
    () => makeStyles(semantic, spacing, layout, rowMinHeight),
    [semantic, spacing, layout, rowMinHeight]
  );

  // 左侧：自定义 leading 优先（类别图标方块等），否则小图标，都没有就不占位
  const left =
    leading ??
    (icon ? (
      <Ionicons name={icon} size={ROW_ICON_SIZE} color={iconColor ?? semantic.accentText} />
    ) : null);

  // 右侧：自定义 trailing 优先（Switch / Chip 自带交互），否则「值 + 值下方小字 + chevron」
  const hasValueColumn = value !== undefined || !!valueCaption;
  const right =
    trailing ??
    (hasValueColumn || chevron ? (
      <View style={styles.right}>
        {hasValueColumn && (
          <View style={styles.valueColumn}>
            {/* 字符串值按正文档渲染；金额请传 <MoneyText/>（自带等宽数字与 flexShrink:0） */}
            {typeof value === 'string' ? <AppText variant="body">{value}</AppText> : value}
            {!!valueCaption && (
              // footnote(13pt)：textTertiary 只给 ≥13pt 的文字用（UI_RULES 第 1 节）
              <AppText variant="footnote" color={semantic.textTertiary} align="right">
                {valueCaption}
              </AppText>
            )}
          </View>
        )}
        {chevron && (
          <Ionicons name="chevron-forward" size={CHEVRON_SIZE} color={semantic.textTertiary} />
        )}
      </View>
    ) : null);

  const content = (
    // 三块排布层：wrap + space-between —— 放不下时右侧值整块掉到第二行；gap 保证最小间距
    <View style={styles.row}>
      {left}
      <View style={styles.textBlock}>
        <AppText variant="headline" numberOfLines={2}>
          {title}
        </AppText>
        {!!subtitle && (
          <AppText variant="footnote" color={semantic.textSecondary} numberOfLines={1}>
            {subtitle}
          </AppText>
        )}
      </View>
      {right}
    </View>
  );

  const containerStyle = [styles.container, disabled ? styles.disabled : null];

  const body = onPress ? (
    <PressableScale
      onPress={onPress}
      onLongPress={onLongPress}
      activeScale={ROW_ACTIVE_SCALE}
      disabled={disabled}
      // 行本身已经 ≥56 高，外扩 hitSlop 会抢到相邻行的手势，所以不外扩
      hitSlop={0}
      style={containerStyle}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
    >
      {content}
    </PressableScale>
  ) : (
    // 不可点时用普通 View：不设 accessible，否则会盖住 trailing 里的 Switch 等子控件
    <View style={containerStyle} testID={testID}>
      {content}
    </View>
  );

  return (
    <View style={style}>
      {body}
      {/* 组内分割线由 ListSection 负责；独立成行时自己画最后一条 */}
      {separator && <View style={styles.separator} />}
    </View>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 圆角 / 间距） */
function makeStyles(
  semantic: SemanticColors,
  spacing: Spacing,
  layout: Layout,
  rowMinHeight: number
) {
  return StyleSheet.create({
    // 外层：只负责高度下限与内边距（含文字的容器禁止固定 height），并把内容垂直居中
    container: {
      minHeight: rowMinHeight,
      paddingHorizontal: layout.card,
      paddingVertical: spacing.md,
      justifyContent: 'center',
    },
    // 三块排布层：flexWrap + space-between，右侧值放不下就掉第二行（不测量、不缩字）
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      alignItems: 'center',
      columnGap: spacing.sm,
      rowGap: spacing.sm,
    },
    // 文本块：可换行 / 可被挤窄，并吃掉行内剩余宽度 ——
    // 这样左侧图标后面的标题是「紧跟图标、左对齐」，而不是被 space-between 顶到中间
    textBlock: { flexShrink: 1, flexGrow: 1 },
    // 右侧值块：永不压缩，宽度由内容决定
    right: {
      flexShrink: 0,
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.sm,
    },
    // 值与值下方小字竖排，右对齐（金额列在行尾对齐）
    valueColumn: { alignItems: 'flex-end' },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: semantic.hairline,
      marginHorizontal: layout.card,
    },
    // 禁用：变灰（点了没反应由 Pressable 的 disabled 保证）
    disabled: { opacity: DISABLED_OPACITY },
  });
}

export default ListRow;
