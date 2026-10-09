// formatMoney.ts
// 金额格式化唯一入口（UI/UX 改造计划 4.4）：千分位 / 真减号 / 币种开关 / 紧凑格式 / 隐藏态。
// 全 App 的金额都从这里出，页面里不许再出现 toFixed(2) 或手写千分位。
//
// 规则要点
// - 千分位一律加：1,234.56（默认 2 位小数）。
// - 符号：支出 −12.50（真减号 U+2212，不是连字符）；收入 +6,800.00；转账无符号；plain 跟随数值本身的正负。
// - 币种只在「看不出是什么钱」的地方标（showCurrency: true）：
//     净资产大数字 RM28,797.59（前缀符号，马来西亚习惯、无空格）/ 资产页币种分组头 /
//     跨币种转账、兑换、账本抽屉分币种余额 / 某行币种与当前页面不同（后缀代码 −5,200.00 USD）。
//   账单行、日期头合计、预算数字、统计排行、日历小数字一律不标。
// - 紧凑格式 compact：1.5k / 1.2M / 3.4B（日历小数字、计算器页用）。
// - 隐藏金额用 HIDDEN_AMOUNT（••••••），取代旧的 ***。
//
// ⚠ 勿动：HomeScreen 现有的中文缩写阶梯（505M / 1B / 5.6千万 / 10百亿，用户逐档校准过）
//   与这里的 compact 是两套东西，迁移要单独派任务，不许顺手替换。
//
// 10 个输入 → 输出示例：
//   1. formatMoney(1234.5)                                            → '1,234.50'
//   2. formatMoney(172.72, { kind: 'expense' })                       → '−172.72'
//   3. formatMoney(6800, { kind: 'income' })                          → '+6,800.00'
//   4. formatMoney(5200, { kind: 'transfer' })                        → '5,200.00'
//   5. formatMoney(-402.29)                                           → '−402.29'   （信用卡欠款，值本身为负）
//   6. formatMoney(28797.59, { currency: 'MYR', showCurrency: true }) → 'RM28,797.59'（净资产大数字）
//   7. formatMoney(-5200, { currency: 'USD', showCurrency: true, currencyPosition: 'suffix' })
//                                                                     → '−5,200.00 USD'（与页面币种不同的一行）
//   8. formatMoney(6800, { kind: 'income', currency: 'MYR', showCurrency: true })
//                                                                     → '+RM6,800.00'（符号在前）
//   9. formatMoney(1500, { compact: true })                           → '1.5k'
//  10. formatMoney(1234567, { compact: true })                        → '1.2M'
//  11. formatMoney(1234.5, { hidden: true })                          → '••••••'
//  （小数位自定义：formatMoney(1234.5, { decimals: 0 }) → '1,235'）

import { getCurrencySymbol } from './currencies';

/** 隐藏金额的统一占位符（旧代码里的 *** 一律换成它） */
export const HIDDEN_AMOUNT = '••••••';

/** 真减号 U+2212（不是连字符 U+002D，后者和数字不等宽、排版会晃） */
export const MINUS = '\u2212';

/** 金额语义：决定正负号怎么写 */
export type MoneyKind =
  /** 无符号语义，跟随数值本身（账户余额、信用卡欠款） */
  | 'plain'
  /** 支出：−（取绝对值后加号，数据里存正存负都不会出现 «−−»） */
  | 'expense'
  /** 收入：+ */
  | 'income'
  /** 转账：无正负号 */
  | 'transfer';

export interface FormatMoneyOptions {
  /** 金额语义（默认 'plain'） */
  kind?: MoneyKind;
  /** 币种代码（'MYR' / 'USD' …）；只在 showCurrency 为 true 时参与拼接 */
  currency?: string;
  /** 是否显示币种（默认 false —— 页面/卡片头已经说明币种的地方不显示） */
  showCurrency?: boolean;
  /** 币种位置（默认 'prefix' 用符号：RM1,234.56；'suffix' 用代码：−5,200.00 USD） */
  currencyPosition?: 'prefix' | 'suffix';
  /** 紧凑格式：1.5k / 1.2M / 3.4B（忽略 decimals） */
  compact?: boolean;
  /** 隐藏态：直接返回 HIDDEN_AMOUNT */
  hidden?: boolean;
  /** 小数位（默认 2） */
  decimals?: number;
}

/** 去尾零：1.50 → 1.5，12.00 → 12，0.50 → 0.5 */
function trimZeros(n: number, decimals: number): string {
  const s = n.toFixed(decimals);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** 千分位：1234.5 → '1,234.50' */
function groupThousands(n: number, decimals: number): string {
  const fixed = n.toFixed(decimals);
  const dot = fixed.indexOf('.');
  const int = dot === -1 ? fixed : fixed.slice(0, dot);
  const frac = dot === -1 ? '' : fixed.slice(dot);
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + frac;
}

/** 紧凑格式：1.5k / 1.2M / 3.4B；1000 以下保留原值（去尾零） */
function compactNumber(abs: number): string {
  if (abs >= 1e9) return trimZeros(abs / 1e9, 1) + 'B';
  if (abs >= 1e6) return trimZeros(abs / 1e6, 1) + 'M';
  if (abs >= 1e3) {
    const k = trimZeros(abs / 1e3, 1);
    // 999,999 → '1000k' 这种进位直接升一级成 '1M'
    return Number(k) >= 1000 ? trimZeros(abs / 1e6, 1) + 'M' : k + 'k';
  }
  return trimZeros(abs, 2);
}

/**
 * 金额格式化唯一入口。
 * @param value 数值（NaN / undefined / Infinity 一律按 0 处理，避免列表里出现 'NaN'）
 */
export function formatMoney(value: number, options: FormatMoneyOptions = {}): string {
  const {
    kind = 'plain',
    currency,
    showCurrency = false,
    currencyPosition = 'prefix',
    compact = false,
    hidden = false,
    decimals = 2,
  } = options;

  if (hidden) return HIDDEN_AMOUNT;

  const raw = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(raw);

  const sign =
    kind === 'expense' ? MINUS : kind === 'income' ? '+' : kind === 'transfer' ? '' : raw < 0 ? MINUS : '';

  const body = compact ? compactNumber(abs) : groupThousands(abs, decimals);

  if (!showCurrency || !currency) return sign + body;

  const symbol = currencyPosition === 'prefix' ? getCurrencySymbol(currency) : ` ${currency}`;
  return currencyPosition === 'prefix' ? `${sign}${symbol}${body}` : `${sign}${body}${symbol}`;
}
