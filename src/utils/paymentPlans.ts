// 财务规划-计划付款的扣账引擎(纯函数,不依赖 React):
// processPaymentPlans 按"补账游标"逐期生成到期日并回调入账,供 AppContext 启动补账与云同步后补账调用。
//
// 设计要点(与 PROJECT.md 规划一致):
// - weekly:每 7 天同星期几;monthly:下月同号,超出当月天数时兜底到当月最后一天;
//   yearly:下年同月同日(2/29 兜底 2/28)
// - 补账上限 24 期:设备长期未开 App 时防止一次性灌入过量账单
// - 游标 lastProcessedDate 记录"已处理到的最后一期",下次从它的下一期开始
import type { PaymentPlan } from '../types';

export const MAX_CATCHUP_OCCURRENCES = 24;

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

/** 当月最后一天(兼容闰年):day 超出时兜底 */
function clampDay(year: number, month: number, day: number): Date {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
}

/** 计划在某周期内的扣账日(返回该期日期);date 参数给出期锚点 */
function occurrenceFor(plan: PaymentPlan, year: number, month: number): Date | null {
  if (plan.cycle === 'monthly') {
    const day = plan.dayOfMonth ?? 1;
    return clampDay(year, month, day);
  }
  return null;
}

/** 从 anchor 开始推下一期日期 */
export function nextOccurrence(plan: PaymentPlan, anchor: Date): Date {
  if (plan.cycle === 'weekly') {
    const d = new Date(anchor);
    d.setDate(d.getDate() + 7);
    return d;
  }
  if (plan.cycle === 'monthly') {
    const day = plan.dayOfMonth ?? 1;
    // 以"当前月应扣日"为基准推下一个月;月末兜底避免 1/31 → 2/31 溢出到 3 月
    return clampDay(anchor.getFullYear(), anchor.getMonth() + 1, day);
  }
  // yearly:下年同月同日(2/29 兜底 2/28)
  const m = plan.month ?? 1;
  const d = plan.day ?? 1;
  return clampDay(anchor.getFullYear() + 1, m, d);
}

/** 计划的起始锚点:weekly → startDate 所在周的 dayOfWeek;
 *  monthly/yearly → startDate 当月/当年的应扣日(不早于 startDate) */
export function firstOccurrenceOnOrAfter(plan: PaymentPlan, startDate: string): Date {
  const start = parseDate(startDate);
  if (plan.cycle === 'weekly') {
    // 目标星期几(RN getDay: 0=周日;dayOfWeek 约定 1=周一…5=周五,0=周日)
    const target = plan.dayOfWeek ?? 1;
    const delta = (target - start.getDay() + 7) % 7;
    const d = new Date(start);
    d.setDate(d.getDate() + delta);
    return d;
  }
  if (plan.cycle === 'monthly') {
    const occ = occurrenceFor(plan, start.getFullYear(), start.getMonth())!;
    return occ >= start ? occ : nextOccurrence(plan, occ);
  }
  const m = plan.month ?? 1;
  const d = plan.day ?? 1;
  const occ = clampDay(start.getFullYear(), m - 1, d);
  return occ >= start ? occ : nextOccurrence(plan, occ);
}

export interface PlanOccurrenceResult {
  /** 需要入账的期(到期日 <= today),按时间升序 */
  dueDates: Date[];
  /** 处理完后的新游标(最后一期的日期);没有新期时返回 null 表示游标可清空 */
  newCursor: string | null;
}

/** 计算单个计划需要补账的所有期(含今天,不含未来) */
export function computePlanOccurrences(plan: PaymentPlan, today: Date): PlanOccurrenceResult {
  const dueDates: Date[] = [];
  if (!plan.active || !plan.autoDeduct) {
    return { dueDates, newCursor: plan.lastProcessedDate ?? null };
  }
  const todayStr = fmt(today);
  const startDate = plan.startDate;
  if (plan.endDate && plan.endDate < todayStr) {
    // 已过结束日:游标推进到结束日,不再生成
    const end = parseDate(plan.endDate);
    return { dueDates, newCursor: fmt(end) };
  }

  // 起点:游标的下一期(有游标)或计划的首次扣账日
  let cursorDate = plan.lastProcessedDate ? parseDate(plan.lastProcessedDate) : null;
  let occ: Date;
  if (cursorDate) {
    occ = nextOccurrence(plan, cursorDate);
  } else {
    occ = firstOccurrenceOnOrAfter(plan, startDate);
    if (plan.lastProcessedDate === undefined && occ < parseDate(startDate)) {
      occ = nextOccurrence(plan, occ);
    }
  }

  let count = 0;
  while (occ <= today && count < MAX_CATCHUP_OCCURRENCES) {
    if (plan.endDate && fmt(occ) > plan.endDate) break;
    dueDates.push(new Date(occ));
    cursorDate = new Date(occ);
    occ = nextOccurrence(plan, occ);
    count += 1;
  }

  // 过了结束日:游标钉到结束日
  let newCursor = cursorDate ? fmt(cursorDate) : plan.lastProcessedDate ?? null;
  if (plan.endDate && cursorDate && parseDate(plan.endDate) <= cursorDate) {
    newCursor = plan.endDate;
  }
  return { dueDates, newCursor };
}

/** 计划的下一期扣账日(不含今天之前);无(已结束/暂停)返回 null */
export function nextDueDate(plan: PaymentPlan, today: Date): Date | null {
  if (!plan.active) return null;
  const todayStr = fmt(today);
  if (plan.endDate && plan.endDate < todayStr) return null;
  const anchor = plan.lastProcessedDate ? parseDate(plan.lastProcessedDate) : null;
  let occ = anchor
    ? nextOccurrence(plan, anchor)
    : firstOccurrenceOnOrAfter(plan, plan.startDate);
  // 起始期早于今天且从未处理过:逐期推进到今天及以后
  let guard = 0;
  while (occ < today && guard < MAX_CATCHUP_OCCURRENCES) {
    occ = nextOccurrence(plan, occ);
    guard += 1;
  }
  if (plan.endDate && fmt(occ) > plan.endDate) return null;
  return occ;
}

export { fmt as formatPlanDate };
