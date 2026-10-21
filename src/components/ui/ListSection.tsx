// ListSection.tsx
// 列表分组（T04 / 计划 4.5、10.1）：标题 + 卡片 + 组脚说明，行与行之间自动插发丝分割线。
//
// 为什么分割线由本组件插入
// - 单行（ListRow）不知道自己在不在组里、是不是最后一行，让它各自画线必然出现「最后一行多一条」；
//   由分组统一在「相邻两项之间」插，最后一行后面一定没有线。
// - 不向 children 传任何额外 props：行保持自己的 API，页面照常写 <ListRow/>。
//
// 外层不加左右页边距（页面自己加，UI_RULES 第 4 节）：这里是「组」，不是页面。
//
// 用法
//   <ListSection title={tr('settings.general')} footer={tr('settings.generalHint')}>
//     <ListRow title="…" chevron />
//     <ListRow title="…" trailing={<Switch value={v} onValueChange={setV} />} />
//   </ListSection>

import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import type { Layout, SemanticColors, Spacing } from '../../theme/theme';
import { useTheme } from '../../theme/useTheme';
import AppText from './AppText';
import Card from './Card';

export interface ListSectionProps {
  /** 分组标题（footnote + textSecondary，在卡片上方） */
  title?: string;
  /** 组脚说明（footnote + textTertiary，在卡片下方） */
  footer?: string;
  /** 行（ListRow）；相邻两项之间自动插分割线 */
  children: React.ReactNode;
  /** 直接给卡片外壳的样式（比如抽屉里贴边：bottom 两个圆角抹平） */
  cardStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ListSection({ title, footer, children, cardStyle, style, testID }: ListSectionProps) {
  const { semantic, spacing, layout } = useTheme();

  const styles = useMemo(
    () => makeStyles(semantic, spacing, layout),
    [semantic, spacing, layout]
  );

  // 只认「有效子项」：null / undefined / 布尔是条件渲染的常见结果，toArray 会直接剔掉，
  // 避免它们被当成一项而在列表里插出多余的分割线。
  const items = React.Children.toArray(children);
  const rows: React.ReactNode[] = [];
  items.forEach((child, index) => {
    rows.push(child);
    // 最后一行后面不插线（组与组之间靠页面间距区分）
    if (index < items.length - 1) {
      rows.push(<View key={`separator-${index}`} style={styles.separator} />);
    }
  });

  return (
    <View style={style} testID={testID}>
      {!!title && (
        <AppText variant="footnote" color={semantic.textSecondary} style={styles.title}>
          {title}
        </AppText>
      )}
      <Card padded={false} style={cardStyle}>{rows}</Card>
      {!!footer && (
        <AppText variant="footnote" color={semantic.textTertiary} style={styles.footer}>
          {footer}
        </AppText>
      )}
    </View>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 圆角 / 间距） */
function makeStyles(semantic: SemanticColors, spacing: Spacing, layout: Layout) {
  return StyleSheet.create({
    title: { paddingHorizontal: layout.card, marginBottom: spacing.sm },
    // 分割线左右缩进 = 卡内边距，与行文字对齐；高度用发丝线（不写死 1）
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: semantic.hairline,
      marginHorizontal: layout.card,
    },
    footer: { paddingHorizontal: layout.card, marginTop: spacing.sm },
  });
}

export default ListSection;
