// formatDate.ts
// 日期格式化唯一入口（UI/UX 改造计划 4.4 / T02）：全 App 只有这一套日期写法。
// 修掉「记一笔写 9/10、首页写 10/9」的格式混乱。
//
// 规则
// - 今天 / 昨天：今天、昨天（英文 Today / Yesterday）
// - 其它：10月7日 周三（英文 Oct 7, Wed）；跨年场景可用 fullWithYear（2026年10月7日 周三）
// - 只要月日用 monthDay（10月7日 / Oct 7）—— 记一笔的日期键、月历小字等
// - 文案取自 i18n 字典（zh.ts / en.ts 的 date 命名空间），**不读全局语言状态**：
//   调用方把当前语言传进来，保证结果与传入语言一致。
//
// 10 个输入 → 输出示例（假设"今天" = 2026-10-09 周五，昨天 = 2026-10-08）：
//   1. formatDate('2026-10-09', 'zh')                                    → '今天'
//   2. formatDate('2026-10-08', 'zh')                                    → '昨天'
//   3. formatDate('2026-10-07', 'zh')                                    → '10月7日 周三'
//   4. formatDate('2026-10-07', 'en')                                    → 'Oct 7, Wed'
//   5. formatDate('2026-10-09', 'en')                                    → 'Today'
//   6. formatDate('2026-10-07', 'zh', { style: 'monthDay' })             → '10月7日'
//   7. formatDate('2026-10-07', 'en', { style: 'monthDay' })             → 'Oct 7'
//   8. formatDate('2026-01-03', 'zh', { style: 'fullWithYear' })         → '2026年1月3日 周六'
//   9. formatDate('2026-10-07', 'zh', { relative: false })               → '10月7日 周三'
//  10. formatDate(new Date(2026, 9, 1), 'en')                            → 'Oct 1, Thu'
//  11. formatDate('2026-10-07', 'zh', { style: 'monthDay', relative: false }) → '10月7日'

import { zh } from '../i18n/zh';
import { en } from '../i18n/en';
import type { LangMode } from '../i18n';

/** 日期呈现档位：只有月日 / 月日 + 星期（默认）/ 年月日 + 星期 */
export type DateStyle = 'monthDay' | 'full' | 'fullWithYear';

export interface FormatDateOptions {
  /** 呈现档位（默认 'full' = 10月7日 周三） */
  style?: DateStyle;
  /** 是否把今天 / 昨天说成「今天」「昨天」（默认 true） */
  relative?: boolean;
}

const DICTS = { zh: zh.date, en: en.date };

/** 'system' 与其它未知值一律按中文处理（App 默认语言） */
function normalizeLang(lang?: LangMode | 'zh' | 'en'): 'zh' | 'en' {
  return lang === 'en' ? 'en' : 'zh';
}

/** 解析输入：YYYY-MM-DD 字符串按本地时区构造，避免 new Date('2026-10-07') 被当成 UTC 而差一天 */
function toDate(input: Date | number | string): Date {
  if (input instanceof Date) return input;
  if (typeof input === 'number') return new Date(input);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(input);
}

/** 本地「年月日」是否同一天 */
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 把模板里的 %{x} 替换成参数（缺参数的占位符原样保留，方便一眼看出哪里漏传） */
function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/%\{(\w+)\}/g, (raw, key: string) =>
    params[key] !== undefined ? String(params[key]) : raw,
  );
}

/**
 * 日期格式化唯一入口。
 * @param input Date / 时间戳 / 'YYYY-MM-DD' 字符串
 * @param lang  当前语言（'zh' | 'en'；传 'system' 或省略按中文）
 */
export function formatDate(
  input: Date | number | string,
  lang?: LangMode,
  options: FormatDateOptions = {},
): string {
  const { style = 'full', relative = true } = options;
  const date = toDate(input);
  if (Number.isNaN(date.getTime())) return '';

  const dict = DICTS[normalizeLang(lang)];

  if (relative) {
    const today = new Date();
    if (isSameDay(date, today)) return dict.today;
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (isSameDay(date, yesterday)) return dict.yesterday;
  }

  const params = {
    mn: dict.months[date.getMonth()],
    d: date.getDate(),
    y: date.getFullYear(),
    w: dict.weekdays[date.getDay()],
  };

  const template =
    style === 'monthDay' ? dict.monthDay : style === 'fullWithYear' ? dict.fullWithYear : dict.full;
  return fill(template, params);
}
