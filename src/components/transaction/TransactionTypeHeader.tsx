// TransactionTypeHeader.tsx
// 记一笔页头（T13 抽取 / T14 改两行 —— 计划 9.2 第 ① 条「把挤的控件挪到单独一行」）：
//   第一行：返回 IconButton + 标题 + 右侧动作（扫票；编辑模式换成红色垃圾桶）
//   第二行：类型分段 SegmentedControl（stretch 四等分占满一整行，每段约 82dp，
//          英文 Exchange 也放得下；编辑模式没有类型切换，不渲染这一行）
//
// 扫票：支出/收入传 onScanPress；转账/兑换不做扫票识别（不传就不渲染，标题左对齐不受影响）。

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { useT } from '../../i18n/LanguageContext';
import AppText from '../ui/AppText';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import SegmentedControl from '../SegmentedControl';
import type { Layout, Spacing } from '../../theme/theme';

/** UI 层四个类型入口（兑换在数据层复用 transfer） */
export type TransactionUiType = 'expense' | 'income' | 'transfer' | 'exchange';

interface Props {
  uiType: TransactionUiType;
  /** 点类型格：父层负责 setUiType / 清类别 / 切步骤（分段控件的选中震动由组件内部发） */
  onSelectType: (type: TransactionUiType) => void;
  onBack: () => void;
  /** 标题（记一笔 / 编辑账单） */
  title: string;
  /** 扫票入口（相机图标 + 文字）；转账/兑换不传 */
  onScanPress?: () => void;
  /** 删除入口（编辑模式：右侧红色垃圾桶，替代扫票） */
  onDeletePress?: () => void;
  /** 类型分段行（默认显示；编辑模式传 false） */
  showTypeSwitch?: boolean;
}

export function TransactionTypeHeader({
  uiType,
  onSelectType,
  onBack,
  title,
  onScanPress,
  onDeletePress,
  showTypeSwitch = true,
}: Props) {
  const { semantic, spacing, layout } = useTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(spacing, layout), [spacing, layout]);

  const options = [
    { value: 'expense', label: t('addTx.expense') },
    { value: 'income', label: t('addTx.income') },
    { value: 'transfer', label: t('addTx.transfer') },
    { value: 'exchange', label: t('addTx.exchange') },
  ];

  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <IconButton icon="chevron-back" accessibilityLabel={t('common.back')} onPress={onBack} />
        {/* 标题左对齐跟住返回键（页头规范：返回 + 标题 + 右侧动作），放不下也不缩字、不省略 */}
        <AppText variant="title3" numberOfLines={1} style={styles.title}>
          {title}
        </AppText>
        {onDeletePress ? (
          <IconButton
            icon="trash-outline"
            color={semantic.danger}
            accessibilityLabel={t('common.delete')}
            onPress={onDeletePress}
          />
        ) : onScanPress ? (
          <Button
            title={t('addTx.scanReceipt')}
            icon="camera-outline"
            variant="ghost"
            size="sm"
            fullWidth={false}
            onPress={onScanPress}
          />
        ) : null}
      </View>
      {showTypeSwitch && (
        <View style={styles.typeRow}>
          {/* 分段控件的选项值就是 UiType（字符串联合），回传时收窄 */}
          <SegmentedControl
            options={options}
            selected={uiType}
            onSelect={(value) => onSelectType(value as TransactionUiType)}
            stretch
          />
        </View>
      )}
    </View>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 字号 / 间距） */
function makeStyles(spacing: Spacing, layout: Layout) {
  return StyleSheet.create({
    header: {
      paddingHorizontal: layout.page,
      paddingTop: spacing.xs,
      paddingBottom: spacing.sm,
    },
    // 第一行：返回 44 触控区 + 标题（吃满剩余宽）+ 右侧动作
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
      columnGap: spacing.sm,
    },
    title: { flex: 1 },
    // 第二行：类型分段独占一行（stretch 撑满内容宽），与标题行只留半个格
    typeRow: { marginTop: spacing.xs },
  });
}

export default TransactionTypeHeader;
