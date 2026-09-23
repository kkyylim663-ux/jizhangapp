// theme.ts
// 颜色 token，light / dark 两套，字段名保持一致方便直接替换 StyleSheet 里的写死颜色。
//
// v4 设计原则（参照 apple-design / emil-design-eng skill）：
// 1. 全屏只有一个"主角"——净资产卡保留渐变，但收敛成更沉稳的深紫，
//    不再和正文卡片抢注意力；正文卡片一律纯色卡面 + 发丝描边。
// 2. 单一强调色：紫色系（link/fab/expense 同族），收入用薄荷绿区分，
//    超支/警示统一玫红。两套主题语义一致，只调明度。
// 3. 中性底色（去掉旧的紫底粉底），让卡面和强调色自己说话。

export type ThemeColors = {
  bg: string;
  // 背景渐变端点：日间是很淡的薰衣草紫→近白，压住纯白的刺眼感；夜间两端同色（等效纯色）
  bgGradientFrom: string;
  bgGradientTo: string;
  // 原生 Header 的底色：日间淡紫色调，夜间同卡片色
  headerTint: string;
  card: string;
  cardShadow: string;
  // 卡片描边色：日间基本不需要（阴影已经够撑轮廓），夜间用来给净资产卡/
  // 预算卡/今日账单卡这几张"纯阴影没边"的卡片补一条看得见的边界
  cardBorder: string;

  assetCard: string;
  assetLabel: string;
  assetHint: string;
  assetValue: string;

  // 净资产卡片专用的渐变配色（首页 Hero 卡），跟上面通用的 assetCard 系列分开
  // 避免影响资产页等其他还在用深底白字风格的地方
  netWorthGradientFrom: string;
  netWorthGradientTo: string;
  netWorthAccent: string; // 眼睛图标、走势线等强调色
  netWorthLabel: string;
  netWorthValue: string;
  netWorthHint: string;

  summaryCard: string;
  divider: string;
  dividerHair: string;

  // 预算/今日账单卡片现在走纯色卡面，渐变端点收成和 card 一致的扁平色，
  // token 保留是为了不动其他还在读这两个字段的页面
  summaryCardGradientFrom: string;
  summaryCardGradientTo: string;

  todayCardGradientFrom: string;
  todayCardGradientTo: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  link: string;

  income: string;
  expense: string;
  expenseOver: string;
  track: string;

  // 本月预算进度条的渐变端点色：正常 / 超支两种状态各一组
  budgetFillFrom: string;
  budgetFillTo: string;
  budgetFillOverFrom: string;
  budgetFillOverTo: string;

  // 信用卡"额度使用率"进度条的渐变端点色：正常 / 接近或超额度两种状态各一组，
  // 跟银行卡图标的蓝色系呼应，超额时复用预算条同一套警示红，两处红色语义保持一致
  creditFillFrom: string;
  creditFillTo: string;
  creditFillOverFrom: string;
  creditFillOverTo: string;

  fabBg: string;
  fabIcon: string;
  fabBorder: string;
  fabHighlight: string;
  fabShine: string;
  fabShadow: string;
  fabRipple: string;
  icon: string;
  avatarBg: string;

  overlay: string; // modal 遮罩
};

export const lightColors: ThemeColors = {
  bg: '#F5F3FB',
  // 极淡的薰衣草紫渐变：顶部稍带紫、向下渐近白，柔和不刺眼
  bgGradientFrom: '#EFEBFC',
  bgGradientTo: '#dcd5fa',
  headerTint: '#e6dffb',
  card: '#f5f1fb',
  cardShadow: 'rgba(23,15,45,0.05)',
  cardBorder: 'rgba(23,15,45,0.14)',

  assetCard: '#23222B',
  assetLabel: 'rgba(255,255,255,0.62)',
  assetHint: 'rgba(255,255,255,0.45)',
  assetValue: '#f7e0f1',

  // 净资产卡：两套主题里都是饱和紫渐变 + 白字，品牌一致；
  // 日间稍亮一档，夜间更沉
  netWorthGradientFrom: '#7C5CFA',
  netWorthGradientTo: '#c5bbf2',
  netWorthAccent: '#FFFFFF',
  netWorthLabel: 'rgba(255,255,255,0.78)',
  netWorthValue: '#FFFFFF',
  netWorthHint: 'rgba(255,255,255,0.62)',

  summaryCard: '#F1F1F4',
  divider: '#DEDEE4',
  dividerHair: '#DCDCE4',

  summaryCardGradientFrom: '#FFFFFF',
  summaryCardGradientTo: '#FFFFFF',

  todayCardGradientFrom: '#FFFFFF',
  todayCardGradientTo: '#FFFFFF',

  textPrimary: '#1B1B22',
  textSecondary: '#6E6E7A',
  textTertiary: '#A4A4B2',
  link: '#5B45E0',

  income: '#0E9F6E',
  expense: '#6C4DF6',
  expenseOver: '#E11D48',
  track: '#ECECF1',

  budgetFillFrom: '#8B7CFF',
  budgetFillTo: '#6C4DF6',
  budgetFillOverFrom: '#f1d6d6',
  budgetFillOverTo: '#E11D48',

  creditFillFrom: '#f67a54',
  creditFillTo: '#ff1500',
  creditFillOverFrom: '#F87171',
  creditFillOverTo: '#E11D48',

  fabBg: '#6C4DF6',
  fabIcon: '#ffffff',
  fabBorder: 'rgba(255,255,255,0.10)',
  fabHighlight: '#8570FF',
  fabShine: 'rgba(255,255,255,0.25)',
  fabShadow: '#4B32D4',
  fabRipple: '#BFAEFF',
  icon: '#1B1B22',
  avatarBg: '#EDEDF2',

  overlay: 'rgba(20,15,40,0.4)',
};

export const darkColors: ThemeColors = {
  bg: '#011525',
  bgGradientFrom: '#2e2e4c',
  bgGradientTo: '#02020d',
  headerTint: '#080116',
  card: '#0b162e',
  cardShadow: 'transparent',
  // 比 card 亮半档的发丝线，在深底上撑起卡片轮廓（阴影在深色背景上不够用）
  cardBorder: 'rgba(255,255,255,0.14)',

  assetCard: '#17171E',
  assetLabel: '#9B9BA8',
  assetHint: '#71717F',
  assetValue: '#ffffff',

  // 净资产卡：沉稳的深紫渐变，做全屏唯一的主角，
  // 比旧版的高饱和紫（#7B2FF2）收敛，靠层次而不是亮度突出
  netWorthGradientFrom: '#47257b',
  netWorthGradientTo: '#160932',
  netWorthAccent: '#C3B5FF',
  netWorthLabel: 'rgba(255,255,255,0.72)',
  netWorthValue: '#FFFFFF',
  netWorthHint: 'rgba(255,255,255,0.55)',

  summaryCard: '#17171E',
  divider: '#2A2A33',
  dividerHair: 'rgba(255,255,255,0.12)',

  summaryCardGradientFrom: '#17171E',
  summaryCardGradientTo: '#17171E',

  todayCardGradientFrom: '#17171E',
  todayCardGradientTo: '#17171E',

  textPrimary: '#F4F4F6',
  textSecondary: '#A2A2B5',
  textTertiary: '#6E6E80',
  link: '#A595FF',

  income: '#34D399',
  expense: '#A78BFA',
  expenseOver: '#FB7185',
  track: '#26262E',

  budgetFillFrom: '#8B7CFF',
  budgetFillTo: '#6C4DF6',
  budgetFillOverFrom: '#fdb2bd',
  budgetFillOverTo: '#E11D48',

  creditFillFrom: '#f67a54',
  creditFillTo: '#ff1500',
  creditFillOverFrom: '#FB7185',
  creditFillOverTo: '#E11D48',

  fabBg: '#6C4DF6',
  fabIcon: '#ffffff',
  fabBorder: 'rgba(255,255,255,0.10)',
  fabHighlight: '#8570FF',
  fabShine: 'rgba(255,255,255,0.18)',
  fabShadow: '#3B28B8',
  fabRipple: '#BFAEFF',
  icon: '#F4F4F6',
  avatarBg: '#202028',

  overlay: 'rgba(0,0,0,0.55)',
};