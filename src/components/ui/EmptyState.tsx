// EmptyState.tsx
// 统一空状态（T04 / 计划 4.5、UI_RULES 第 7 节「空状态」）：Ionicons 大图标 + 一句话 + 一个按钮。
//
// 规格
// - 图标 48 放在 96×96 的 accentSoft 圆里（图标色 accentText）—— 全 App 只有这一种空状态画法；
// - 标题 headline，说明 subhead + textSecondary，全部居中、最多 2 行、不截断不缩字（UI_RULES 第 6 节）；
// - 按钮复用 ui/Button 的 primary + fullWidth=false（空状态的动作用「按钮」而不是整块可点，语义更准）；
// - actionLabel 与 onAction 成对出现才渲染按钮 —— 只有标题的空状态（比如「本月还没有记录」）不该有假按钮；
// - 只给 minHeight + paddingVertical，不加固定高度：矮屏 / 大字模式下照样撑得开。
//
// 用法
//   <EmptyState title={tr('stats.empty')} description={tr('stats.emptyHint')} />
//   <EmptyState icon="receipt-outline" title="还没有账单" actionLabel={tr('common.add')} onAction={open} />

import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SemanticColors, Spacing } from '../../theme/theme';
import { useTheme } from '../../theme/useTheme';
import AppText from './AppText';
import Button from './Button';

/** 圆形底衬边长（96，纯图形常量） */
const CIRCLE_SIZE = 96;
/** 圆内图标尺寸（48：UI_RULES 第 7 节给空状态单独定的唯一大图标档） */
const CIRCLE_ICON_SIZE = 48;

export interface EmptyStateProps {
  /** Ionicons 图标名（默认 'file-tray-outline'） */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** 一句话标题（headline） */
  title: string;
  /** 可选补充说明（subhead + textSecondary，居中） */
  description?: string;
  /** 动作按钮文案（与 onAction 成对出现才渲染） */
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  description,
  actionLabel,
  onAction,
  style,
  testID,
}: EmptyStateProps) {
  const { semantic, spacing } = useTheme();

  const styles = useMemo(() => makeStyles(semantic, spacing), [semantic, spacing]);

  const showAction = !!actionLabel && !!onAction;

  return (
    <View style={[styles.container, style]} testID={testID}>
      <View style={styles.circle}>
        <Ionicons name={icon} size={CIRCLE_ICON_SIZE} color={semantic.accentText} />
      </View>
      {/* 标题最多 2 行；说明不设上限，宁可把空状态撑高也不省略（第 6 节：不用缩字和省略号） */}
      <AppText variant="headline" align="center" numberOfLines={2} style={styles.title}>
        {title}
      </AppText>
      {!!description && (
        <AppText variant="subhead" color={semantic.textSecondary} align="center" style={styles.description}>
          {description}
        </AppText>
      )}
      {showAction && (
        <Button
          title={actionLabel}
          variant="primary"
          fullWidth={false}
          onPress={onAction}
          style={styles.action}
        />
      )}
    </View>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 圆角 / 间距） */
function makeStyles(semantic: SemanticColors, spacing: Spacing) {
  return StyleSheet.create({
    container: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xxxl,
    },
    circle: {
      width: CIRCLE_SIZE,
      height: CIRCLE_SIZE,
      borderRadius: CIRCLE_SIZE / 2,
      backgroundColor: semantic.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { marginTop: spacing.lg },
    description: { marginTop: spacing.sm },
    action: { marginTop: spacing.xl },
  });
}

export default EmptyState;
