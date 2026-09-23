/**
 * 分录金额录入（账务键盘惯例）：数字从分位（小数点后）往高位顶——
 * 按 5 显示 0.05、按 50 显示 0.50、按 500 显示 5.00；小数点固定在倒数第二位，
 * 不需要（也没有）小数点键。退格删最后一位，C 清零。
 * 仍保留 + / - 多项连算能力（供拆分金额扩展用）。
 *
 * 内部存储：每项 raw 只存"按过的数字串"（"5" 代表 5 分、"500" 代表 5.00 元），
 * 显示时才格式化成带小数点的字符串。光标定位插入/退格的偏移量以"显示串"为准
 * （与显示串切片渲染同一坐标系），内部自动换算到数字串下标。
 */
export interface AmountTerm {
  op: '+' | '-';
  raw: string; // 这一项目前按了哪些数字键，如 "5"（=0.05）、"500"（=5.00）；"" 表示还没输入
}

export interface AmountExpressionState {
  terms: AmountTerm[];
}

/** 每项最多 14 位数字（含分位）——对应整数 12 位 + 小数 2 位 */
export const MAX_DIGITS = 14;

/** 初始值转录入数字串：空值 → ""（空态显示 0.00）；负数不支持分录取录，按空态处理 */
function toRaw(value: number | string | undefined | null): string {
  if (value === undefined || value === null || value === '') return '';
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(n) || n < 0) return '';
  return String(Math.round(n * 100)); // 以"分"为单位：5 元 → "500"
}

export function createExpression(initialValue?: number | string): AmountExpressionState {
  return { terms: [{ op: '+', raw: toRaw(initialValue) }] };
}

/** 数字串 → 显示串：倒数两位是小数；前导 0 只保留一位（"0005" → "0.05"） */
export function formatCentsDigits(raw: string): string {
  if (!raw) return '0.00';
  if (raw.length === 1) return `0.0${raw}`;
  if (raw.length === 2) return `0.${raw}`;
  const int = raw.slice(0, -2).replace(/^0+(?=[0-9])/, '');
  return `${int}.${raw.slice(-2)}`;
}

/**
 * 规范化：位数超过 3 时剥掉多余前导 0（值不变，"0005" ≡ "005" ≡ 5 分）。
 * 这保证 n≥3 时显示串长度恒等于 n+1（整数区无多余前导 0），光标映射才有唯一解。
 */
function normalizeRaw(raw: string): string {
  let r = raw;
  while (r.length > 3 && r.startsWith('0')) r = r.slice(1);
  return r;
}

/** 按数字键：追加到当前项末尾（分录入法从分位往高位顶）；超位数上限拒绝 */
export function pressDigit(state: AmountExpressionState, digit: string): AmountExpressionState {
  const clean = digit.replace(/[^0-9]/g, '');
  if (!clean) return state;
  const terms = [...state.terms];
  const last = terms[terms.length - 1];
  if (last.raw.length >= MAX_DIGITS) return state;
  terms[terms.length - 1] = { ...last, raw: normalizeRaw(last.raw + clean) };
  return { terms };
}

/** 分录模式没有小数点概念（小数点固定在倒数第二位），"."键为无害 no-op */
export function pressDot(state: AmountExpressionState): AmountExpressionState {
  return state;
}

/** 按退格：删当前项最后一位；当前项已空则撤销上一个运算符，回到编辑上一项 */
export function pressBackspace(state: AmountExpressionState): AmountExpressionState {
  const terms = [...state.terms];
  const last = terms[terms.length - 1];
  if (last.raw.length > 0) {
    terms[terms.length - 1] = { ...last, raw: last.raw.slice(0, -1) };
    return { terms };
  }
  if (terms.length > 1) {
    terms.pop();
    return { terms };
  }
  return state;
}

/** 按 + 或 -：当前项有值就结算开新项；没值只改符号 */
export function pressOperator(state: AmountExpressionState, op: '+' | '-'): AmountExpressionState {
  const terms = [...state.terms];
  const last = terms[terms.length - 1];
  if (!last.raw) {
    if (terms.length === 1) return state; // 第一项恒为 +，不允许改
    terms[terms.length - 1] = { ...last, op };
    return { terms };
  }
  terms.push({ op, raw: '' });
  return { terms };
}

/** 键盘顶部展示：每项格式化成 "5.00" 样式（空项显示 0.00），多项用运算符连接 */
export function getExpressionDisplay(state: AmountExpressionState): string {
  return state.terms
    .map((t, i) => {
      const shown = formatCentsDigits(t.raw);
      return i === 0 ? shown : ` ${t.op} ${shown}`;
    })
    .join('');
}

/** 按"完成"时用：数字串按分还原成金额（带符号求和，避免浮点误差保留两位） */
export function getExpressionTotal(state: AmountExpressionState): number {
  const total = state.terms.reduce(
    (sum, t) => sum + (t.op === '-' ? -1 : 1) * ((parseInt(t.raw, 10) || 0) / 100),
    0,
  );
  return Math.round(total * 100) / 100;
}

export function isMultiTerm(state: AmountExpressionState): boolean {
  return state.terms.length > 1;
}

// ---------- 光标定位插入/退格（单项目前支持；多项表达式退回尾部操作） ----------
// cursorFromEnd 以"显示串"为准（距尾部偏移，0 = 最末尾）——页面用显示串切片渲染光标，
// 这里负责显示串偏移 ↔ 数字串下标的双向换算。
//
// 换算规则（display 为格式化后的显示串，p 为显示串下标，n 为数字串长度）：
//   n=0  "0.00"        任意位置等价于第 0 位
//   n=1  "0.0d"        p=3 → r=0（d 前）；p=4 → r=1（d 后）；更靠前clamp到 0
//   n=2  "0.ab"        p=2/3/4 → r=0/1/2；更靠前 clamp 到 0
//   n≥3  "int.frac"    p≤n-2 → r=p（整数区）；p=n-1 → r=n-2（点两侧同一个缝隙）；
//                     p=n → r=n-1；p=n+1 → r=n（末尾）

/** 显示串距尾偏移 → 数字串插入位 */
function rawIndexFromCursorCfe(raw: string, cursorFromEnd: number): number {
  const n = raw.length;
  if (n === 0) return 0;
  const display = formatCentsDigits(raw);
  const p = Math.max(0, Math.min(display.length, display.length - Math.max(0, cursorFromEnd)));
  if (n === 1) return Math.max(0, Math.min(1, p - 3));
  if (n === 2) return Math.max(0, Math.min(2, p - 2));
  if (p <= n - 2) return p;
  if (p === n - 1) return n - 2;
  return Math.min(n, p - 1);
}

/** 数字串插入位 → 新显示串距尾偏移（插入/删除后光标跟随内容走） */
function displayCfeFromRawIndex(raw: string, r: number): number {
  const n = raw.length;
  const len = formatCentsDigits(raw).length;
  let p: number;
  if (n === 0) p = 4;
  else if (n === 1) p = r === 0 ? 3 : 4;
  else if (n === 2) p = 2 + r;
  else p = r <= n - 2 ? r : r === n - 1 ? n : n + 1;
  return Math.max(0, len - p);
}

/** 在显示串光标位置插入数字。多项表达式退回"尾部追加"。返回新状态与新光标（距尾部偏移） */
export function pressDigitAtIndex(
  state: AmountExpressionState,
  digit: string,
  cursorFromEnd: number
): { state: AmountExpressionState; cursorFromEnd: number } {
  const clean = digit.replace(/[^0-9]/g, '');
  if (!clean) return { state, cursorFromEnd };
  if (isMultiTerm(state)) return { state: pressDigit(state, clean), cursorFromEnd: 0 };
  const terms = [...state.terms];
  const last = terms[terms.length - 1];
  if (last.raw.length >= MAX_DIGITS) return { state, cursorFromEnd };
  const r = rawIndexFromCursorCfe(last.raw, cursorFromEnd);
  const merged = last.raw.slice(0, r) + clean + last.raw.slice(r);
  const nextRaw = normalizeRaw(merged);
  // 剥掉的前导零都在光标左侧：新 raw 里"插入位之后"的下标要左移同样的格数
  const newRawCursor = Math.max(0, r + 1 - (merged.length - nextRaw.length));
  terms[terms.length - 1] = { ...last, raw: nextRaw };
  return { state: { terms }, cursorFromEnd: displayCfeFromRawIndex(nextRaw, newRawCursor) };
}

/** 分录模式没有小数点键：光标模式下同样 no-op，光标原位不动 */
export function pressDotAtIndex(
  state: AmountExpressionState,
  cursorFromEnd: number
): { state: AmountExpressionState; cursorFromEnd: number } {
  return { state, cursorFromEnd };
}

/** 在显示串光标位置退格（删光标前一个数字）。多项退回尾部退格 */
export function pressBackspaceAtIndex(
  state: AmountExpressionState,
  cursorFromEnd: number
): { state: AmountExpressionState; cursorFromEnd: number } {
  if (isMultiTerm(state)) return { state: pressBackspace(state), cursorFromEnd: 0 };
  const terms = [...state.terms];
  const last = terms[terms.length - 1];
  if (!last.raw) return { state, cursorFromEnd };
  const r = rawIndexFromCursorCfe(last.raw, cursorFromEnd);
  if (r <= 0) return { state, cursorFromEnd };
  const merged = last.raw.slice(0, r - 1) + last.raw.slice(r);
  const nextRaw = normalizeRaw(merged);
  // 删除位在剥掉的前导零之后时，光标缝隙跟着左移同样的格数
  const newRawCursor = Math.max(0, r - 1 - (merged.length - nextRaw.length));
  terms[terms.length - 1] = { ...last, raw: nextRaw };
  return { state: { terms }, cursorFromEnd: displayCfeFromRawIndex(nextRaw, newRawCursor) };
}
