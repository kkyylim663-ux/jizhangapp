// Card.tsx
// 统一卡片（T04 / 计划 4.5、10.1 —— 取代全 App 各写各的卡面）。
//
// 外观（UI_RULES 第 7 节：卡片全 App 只有 2 种，这是普通卡）
// - 日间：surface 底 + radius.lg + elevation.level1（阴影撑轮廓，不需要描边）；
// - 夜间：elevation.level1 是空阴影（夜间不靠阴影分层），改靠 surface 比 bg 亮一档 +
//   StyleSheet.hairlineWidth 的发丝描边，深底上才有看得见的卡面边界。
//
// 用法
//   <Card>…</Card>
//   <Card padded={false}><ListRow … /></Card>   // 行自带内边距时不要双份
//   <Card onPress={openAccount}>…</Card>        // 整卡可点（读屏整块读一遍）

import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import PressableScale from '../PressableScale';
import type { Elevation, Layout, Radius, SemanticColors } from '../../theme/theme';
import { useTheme } from '../../theme/useTheme';

export interface CardProps {
  children: React.ReactNode;
  /** 内边距 layout.card（16）；列表类内容（行自己做内边距）传 false */
  padded?: boolean;
  /** 传了就整卡可点 */
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** 按压反馈档：整卡是大目标，用通用 0.98（小图标才用更小的值） */
const CARD_ACTIVE_SCALE = 0.98;

export function Card({
  children,
  padded = true,
  onPress,
  onLongPress,
  accessibilityLabel,
  style,
  testID,
}: CardProps) {
  const { semantic, radius, elevation, layout, isDark } = useTheme();

  const styles = useMemo(
    () => makeStyles(semantic, radius, elevation, layout, isDark),
    [semantic, radius, elevation, layout, isDark]
  );

  const cardStyle = [styles.card, padded ? styles.padded : null, style];

  if (onPress) {
    return (
      <PressableScale
        onPress={onPress}
        onLongPress={onLongPress}
        activeScale={CARD_ACTIVE_SCALE}
        style={cardStyle}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      >
        {children}
      </PressableScale>
    );
  }

  return (
    <View style={cardStyle} testID={testID}>
      {children}
    </View>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 圆角 / 间距） */
function makeStyles(
  semantic: SemanticColors,
  radius: Radius,
  elevation: Elevation,
  layout: Layout,
  isDark: boolean
) {
  return StyleSheet.create({
    card: {
      backgroundColor: semantic.surface,
      borderRadius: radius.lg,
      ...elevation.level1,
      // 夜间：level1 无阴影，补发丝线撑轮廓（日间 borderWidth 0 即无描边，不影响布局）
      borderWidth: isDark ? StyleSheet.hairlineWidth : 0,
      borderColor: semantic.hairline,
    },
    padded: { padding: layout.card },
  });
}

export default Card;
