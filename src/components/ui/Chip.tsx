// Chip.tsx
// 统一胶囊选择器（T04 / 计划 4.5、10.1）：筛选条 / 分段替代 / 多选标签。
//
// 结构（两层，故意的）
// - 外层：44 高的触控容器（UI_RULES 第 4/8 节：所有可点元素 ≥44pt），按压缩放 0.95；
// - 内层：视觉胶囊，minHeight 32（12pt 文字 + 上下内边距），radius.full。
//   视觉件比触控区矮，所以用外层兜住触控高度，胶囊本身不必硬撑到 44 —— 观感紧凑、手指也好按。
//
// 状态（UI_RULES 第 8 节）
// - 选中：accentSoft 底 + accentText 字 + 600 字重（读屏读出「已选中」）；
// - 未选中：透明底 + hairline 描边 + textSecondary 字；
// - 两种状态都保留 hairline 宽度的描边（只换描边色），切换时不发生 1px 布局跳动。
//
// 用法
//   <Chip label={tr('stats.thisMonth')} selected={tab === 'month'} onPress={() => setTab('month')} />
//   <Chip label="餐饮" icon="restaurant-outline" selected={sel} onPress={toggle} />

import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PressableScale from '../PressableScale';
import type { Radius, SemanticColors, Spacing } from '../../theme/theme';
import { useTheme } from '../../theme/useTheme';
import AppText from './AppText';

/** 触控区边长（UI_RULES：所有可点元素 ≥44pt） */
const TOUCH_SIZE = 44;
/** 胶囊视觉高度下限（12pt 文字 + 4pt 上下内边距，比触控区矮，观感更紧凑） */
const CHIP_MIN_HEIGHT = 32;
/** 胶囊内小图标尺寸（16：明显小于正文图标，不喧宾夺主）—— 纯图形常量 */
const CHIP_ICON_SIZE = 16;
/** 按压反馈档：小控件比整行的 0.98 更明显才好感知 */
const CHIP_ACTIVE_SCALE = 0.95;
/** 禁用态整体透明度（不是色值 / 字号，不算写死令牌） */
const DISABLED_OPACITY = 0.4;

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** 文字左侧小图标（Ionicons，16） */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
  disabled,
  accessibilityLabel,
  style,
  testID,
}: ChipProps) {
  const { semantic, spacing, radius } = useTheme();

  const styles = useMemo(
    () => makeStyles(semantic, spacing, radius),
    [semantic, spacing, radius]
  );

  const foreground = selected ? semantic.accentText : semantic.textSecondary;

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      activeScale={CHIP_ACTIVE_SCALE}
      // 胶囊常成排出现，外扩 hitSlop 会盖住邻居；44 触控高已经够按
      hitSlop={0}
      style={[styles.touch, disabled ? styles.disabled : null, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      testID={testID}
    >
      <View style={[styles.chip, selected ? styles.selected : styles.unselected]}>
        {!!icon && <Ionicons name={icon} size={CHIP_ICON_SIZE} color={foreground} />}
        {/* 不设 numberOfLines：标签换行变高也不截断、不缩字（UI_RULES 第 6 节） */}
        <AppText
          variant="caption"
          color={foreground}
          weight={selected ? '600' : undefined}
          style={styles.label}
        >
          {label}
        </AppText>
      </View>
    </PressableScale>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 圆角 / 间距） */
function makeStyles(semantic: SemanticColors, spacing: Spacing, radius: Radius) {
  return StyleSheet.create({
    // 触控容器：撑到 44 并把胶囊居中，本身透明
    touch: {
      minHeight: TOUCH_SIZE,
      justifyContent: 'center',
      alignItems: 'center',
    },
    // 视觉胶囊：形状与两种状态的底色 / 描边
    chip: {
      minHeight: CHIP_MIN_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.full,
      // 描边宽度两态一致，只换颜色：选中时不变形、不跳动
      borderWidth: StyleSheet.hairlineWidth,
    },
    selected: {
      backgroundColor: semantic.accentSoft,
      borderColor: semantic.accentSoft,
    },
    unselected: {
      backgroundColor: 'transparent',
      borderColor: semantic.hairline,
    },
    // 只加 flexShrink:1（文字可换行 / 可被挤窄），字号与颜色由令牌决定
    label: { flexShrink: 1 },
    disabled: { opacity: DISABLED_OPACITY },
  });
}

export default Chip;
