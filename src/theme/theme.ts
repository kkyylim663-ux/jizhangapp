// theme.ts
// 颜色 token，light / dark 两套，字段名保持一致方便直接替换 StyleSheet 里的写死颜色。

export type ThemeColors = {
  bg: string;
  card: string;
  cardShadow: string;

  assetCard: string;
  assetLabel: string;
  assetHint: string;
  assetValue: string;

  summaryCard: string;
  divider: string;
  dividerHair: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  link: string;

  income: string;
  expense: string;
  expenseOver: string;
  track: string;

  fabBg: string;
  fabIcon: string;
  icon: string;
  avatarBg: string;

  overlay: string; // modal 遮罩
};

export const lightColors: ThemeColors = {
  bg: '#F7F7F9',
  card: '#ffffff',
  cardShadow: 'rgba(0,0,0,0.04)',

  assetCard: '#343435',
  assetLabel: '#B0B0B8',
  assetHint: '#87878d',
  assetValue: '#ffffff',

  summaryCard: '#f1f1f1b4',
  divider: '#c8c8c8',
  dividerHair: '#F0F0F3',

  textPrimary: '#1C1C1E',
  textSecondary: '#818181',
  textTertiary: '#B0B0B8',
  link: '#9f9f9f',

  income: 'rgb(12, 134, 234)',
  expense: '#FF7A5C',
  expenseOver: '#b46b67',
  track: '#d4d4d5',

  fabBg: '#1C1C1E',
  fabIcon: '#ffffff',
  icon: '#1C1C1E',
  avatarBg: '#F0F0F3',

  overlay: 'rgba(0,0,0,0.35)',
};

export const darkColors: ThemeColors = {
  bg: '#030305',
  card: '#1C1C1E',
  cardShadow: 'transparent',

  assetCard: '#232326',
  assetLabel: '#9A9AA0',
  assetHint: '#78787E',
  assetValue: '#ffffff',

  summaryCard: '#1C1C1E',
  divider: '#333336',
  dividerHair: '#29292C',

  textPrimary: '#F2F2F3',
  textSecondary: '#9A9AA0',
  textTertiary: '#6E6E73',
  link: '#6E6E73',

  income: '#4DA3FF',
  expense: '#FF9270',
  expenseOver: '#E06A56',
  track: '#3A3A3D',

  fabBg: '#8f8f95',
  fabIcon: '#323235',
  icon: '#F2F2F3',
  avatarBg: '#020202',

  overlay: 'rgba(0,0,0,0.55)',
};
