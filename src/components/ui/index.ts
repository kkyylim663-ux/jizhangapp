// src/components/ui —— 设计系统组件统一出口（计划 4.5 / 10.1）。
//
// 页面里只许用这里的组件，不要在页面里再造卡片 / 按钮 / 列表行（UI_RULES 第 7 节）。
// 交互三件套（PressableScale / SegmentedControl / AppDialog）仍在各自的老路径，保持既有 import 不变。
//
// 用法：import { AppText, MoneyText, Button, Card, ListRow } from '../components/ui';

export { AppText } from './AppText';
export type { AppTextProps } from './AppText';

export { MoneyText } from './MoneyText';
export type { MoneyTextProps } from './MoneyText';

export { IconButton } from './IconButton';
export type { IconButtonProps } from './IconButton';

export { Button } from './Button';
export type { ButtonProps, ButtonVariant } from './Button';

export { ScreenHeader } from './ScreenHeader';
export type { ScreenHeaderProps } from './ScreenHeader';

export { BottomSheet } from './BottomSheet';
export type { BottomSheetProps } from './BottomSheet';

export { Card } from './Card';
export type { CardProps } from './Card';

export { ListSection } from './ListSection';
export type { ListSectionProps } from './ListSection';

export { ListRow } from './ListRow';
export type { ListRowProps } from './ListRow';

export { Switch } from './Switch';
export type { SwitchProps } from './Switch';

export { Chip } from './Chip';
export type { ChipProps } from './Chip';

export { Badge } from './Badge';
export type { BadgeProps, BadgeTone } from './Badge';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { TransactionRow } from './TransactionRow';
export type { TransactionRowProps } from './TransactionRow';
