// MonthCalendarCard.tsx
// 首页「日历视图」的月历卡内容（原型 prototype/calendar-switch-proto.html 拍板形态）：
// - ‹ 月份 › 导航 + 周日排首的 6 行月格（周末字用支出色）
// - 有账的日期下方金额药丸：支出紫 / 收入绿 / 总额=净额（正绿负紫），超长缩写
// - [支出|收入|总额] SegmentedControl 切换药丸显示的指标
// - 底部当月合计行：总额 / 收入 / 支出
// 本组件只负责渲染；月份状态与数据聚合都在 HomeScreen（dayGroups 单一数据源，
// 保证日历数字与账单列表逐日一致，天然继承币种过滤与转账排除）。
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, { FadeIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import PressableScale from './PressableScale';
import SegmentedControl from './SegmentedControl';
import { useTheme } from '../theme/useTheme';
import { useT } from '../i18n/LanguageContext';
import { useLanguage } from '../i18n/LanguageContext';
import { ThemeColors } from '../theme/theme';

export interface CalendarDayTotals {
  expense: number;
  income: number;
  /** 当日逐笔账单（点日期在下方展示明细用）；与账单列表同源，顺序=列表顺序 */
  items?: { id: string; title: string; amount: number; type: 'expense' | 'income' }[];
}

type SegKey = 'expense' | 'income' | 'net';

interface Props {
  year: number;
  /** 1-12 */
  month: number;
  /** 当月有账的日期 → 当日收支（YYYY-MM-DD 键，与账单列表同源） */
  days: Map<string, CalendarDayTotals>;
  monthExpense: number;
  monthIncome: number;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function fmtMoney(n: number) {
  return n.toFixed(2);
}

function trim1(v: number) {
  const s = v.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

// 缩放后的数值格式化：整数部分 ≥100 时去掉小数（505.3M → 505M）。
// 保留一位小数只对 <100 的数有意义（5.6千万/50.6B）——3 位整数再带小数会到 7 字符
// （-505.3M），撑爆药丸被截成 "-505.…"（真机截图 bug）。
// ⚠ toFixed(1) 有进位边界：999,999,999/1e6 → "1000.0" → 千分位溢出，
// 所以算完整数位后还要检查是否应晋升到下一档（1000M → 1B）
function scaledNum(v: number, unit: string) {
  const intDigits = v >= 100 ? 3 : v >= 10 ? 2 : 1;
  const s = intDigits === 3 ? v.toFixed(0) : trim1(v);
  // toFixed(0) 进位到 1000（如 999.99M → "1000"）：递归晋升到下一档重新算
  if (s === '1000') return null; // 由调用方晋升档位
  return s + unit;
}

// 药丸短格式：超长金额缩写，阶梯必须盖住任意位数——漏一档就会落回原始数字
// 撑爆药丸被截成 "-50.6…"（真机截图 bug：50,600,000,000 中文阶梯到「千万」就到顶了）。
// 第二轮真机 bug：505,343,269.91 → "-505.3M" 7字符仍溢出 → 整数≥100 去小数（scaledNum）。
// 单测说明：505510366 → 506M 是 toFixed(0) 正常舍入（四舍五入 505.51→506），非 bug。
// 英文：k → M → B → T（1e9=B 十亿、1e12=T 万亿）；中文按用户定版口语：
// 万(1e4) → 百万(1e6) → 千万(1e7) → 亿(1e8) → 百亿(1e10) → 千亿(1e11) → 万亿(1e12)。
// 万亿/T 之上走通用兜底：每级 ×10^4 继续爬（1e16、1e20…，1e16 中文=京），纯兜底——
// 记账到不了这个量级，但保证任何数字都落在 ≤7 字符的缩写里
function compactAmount(n: number, en: boolean) {
  if (en) {
    if (n >= 1e3) {
      // 逐级爬：k(1e3) → M(1e6) → B(1e9) → T(1e12) → Q(1e15)…（每级 ×1000）。
      // 循环条件 v>=1000：把 v 压进 [1,1000)——999,999,999 除一次得 999.99（e=6=M），
      // 不需要再爬；999.99 经 toFixed(0) 进位成 "1000" 时由 scaledNum 返 null 再爬一级
      let e = 3;
      let v = n / 1e3;
      while (v >= 1000) { v /= 1000; e += 3; }
      const units = ['k', 'M', 'B', 'T'];
      let unit = e <= 12 ? units[e / 3 - 1] : bigEnUnit(e);
      let r = scaledNum(v, unit);
      // toFixed(0) 进位 1000（999.99M → "1000M"）：晋升一档重算（→1B）
      while (r === null) {
        e += 3;
        v /= 1000;
        unit = e <= 12 ? units[e / 3 - 1] : bigEnUnit(e);
        r = scaledNum(v, unit);
      }
      return r;
    }
    return String(Math.round(n));
  }
  if (n >= 1e4) {
    // zh 档（用户定版口语）：万(1e4) → 百万(1e6) → 千万(1e7) → 亿(1e8) →
    // 百亿(1e10) → 千亿(1e11) → 万亿(1e12) → 京(1e16)…
    // 就近向下取定义档：指数落在两档之间时用低档（如 1e5→万、1e9→亿），
    // 除出来的 v 是 1~9999 区间，正好符合「5.6千万/50.6B」形态
    const defined: [number, string][] = [
      [16, '京'], [12, '万亿'], [11, '千亿'], [10, '百亿'],
      [8, '亿'], [7, '千万'], [6, '百万'], [4, '万'],
    ];
    const digitCount = Math.floor(Math.log10(n)) + 1;
    const hitIdx = defined.findIndex(([d]) => d < digitCount);
    if (hitIdx === -1) return String(Math.round(n)); // <1e4 原样
    // 从命中档往上爬：v≥1000 说明 toFixed 后会进位成 "1000"（scaledNum 返 null），
    // 阈值与 scaledNum 的 1000 进位对齐（v≥10000 会在 999.99万亿 这种 3 位整数
    // 带小数的组合上漏判 → null，真机/单测都抓到过）。idx-1 = 更大一档
    let idx = hitIdx;
    let v = n / Math.pow(10, defined[idx][0]);
    while (v >= 1000 && idx > 0) {
      idx -= 1;
      v = n / Math.pow(10, defined[idx][0]);
    }
    // 爬到顶（京）还 ≥1000：数值夸张到 1e19 以上，v 直接钳到 999 保输出有界
    const clamped = Math.min(v, 999);
    return scaledNum(clamped, defined[idx][1]);
  }
  return String(Math.round(n));
}

// 英文大数兜底档（1e15 起，每级 ×10^3）：Q(uadrillion) 之后按字母序占位，
// 只要不重复即可——记账场景到不了，保证封顶就行
function bigEnUnit(e: number) {
  const idx = e / 3 - 5; // 1e15 → 0
  return 'QRYZABCDEF'[idx] ?? 'Q';
}

// 合计行金额：|n| ≥ 100 万用缩写（12 位完整数字在 1/3 列宽必截断），其余完整两位小数。
// 负号在缩写外拼接（与药丸同款），保证 compactAmount 输出宽度最短
function totalsText(n: number, en: boolean) {
  if (Math.abs(n) < 1e6) return fmtMoney(n);
  const sign = n < 0 ? '-' : '';
  return sign + compactAmount(Math.abs(n), en);
}

export default function MonthCalendarCard({ year, month, days, monthExpense, monthIncome, onPrevMonth, onNextMonth }: Props) {
  const { colors } = useTheme();
  const t = useT();
  const { langMode } = useLanguage();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [segKey, setSegKey] = useState<SegKey>('expense');
  // 点选的日期（YYYY-MM-DD）：再点一次同日收起；翻月自动清空（月格 key 重挂不清 state，需显式清）
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  useEffect(() => {
    setSelectedDate(null);
  }, [year, month]);
  const selectedDay = selectedDate ? days.get(selectedDate) : undefined;
  const isEn = langMode === 'en';
  // 明细区标头：9/25周五 形态（与账单列表日期标签同款；t 稳定引用，依赖带 langMode）
  const selectedDateLabel = useMemo(() => {
    if (!selectedDate) return '';
    const d = new Date(Number(selectedDate.slice(0, 4)), Number(selectedDate.slice(5, 7)) - 1, Number(selectedDate.slice(8, 10)));
    const wd = t('home.weekdays').split(',')[d.getDay()];
    return isEn
      ? `${d.getMonth() + 1}/${d.getDate()} ${wd}`
      : `${d.getMonth() + 1}/${d.getDate()}周${wd}`;
  }, [selectedDate, t, langMode, isEn]);

  // 标题：中文 2026年9月 / 英文 September 2026（英文月份名单独维护，
  // report.monthLabel 的英文格式 %{m}/%{y} 不适合日历标题）
  const title = isEn ? `${MONTH_EN[month - 1]} ${year}` : `${year}年${month}月`;

  // 同上：t 是稳定引用，依赖数组必须带 langMode，切语言才会重算星期表头
  const weekdayLabels = useMemo(() => t('home.weekdays').split(','), [t, langMode]);

  // 42 格月格：周日排首（getDay() 周日=0，与 weekdays 键顺序一致），
  // 前后补上月/下月的灰显日期（只显示数字、不带药丸）
  const cells = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const offset = first.getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const daysPrev = new Date(year, month - 1, 0).getDate();
    const out: { day: number; muted: boolean; dateKey: string | null }[] = [];
    for (let i = 0; i < 42; i++) {
      if (i < offset) {
        out.push({ day: daysPrev - offset + 1 + i, muted: true, dateKey: null });
      } else if (i < offset + daysInMonth) {
        const day = i - offset + 1;
        out.push({
          day,
          muted: false,
          dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        });
      } else {
        out.push({ day: i - offset - daysInMonth + 1, muted: true, dateKey: null });
      }
    }
    return out;
  }, [year, month]);

  const todayKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  // ⚠ useT 返回的 t 是全局稳定引用（applyLangMode 改实例 locale，不换函数），
  // useMemo 依赖数组里只写 [t] 在切语言时不会重算 → 文案冻在旧语言（真机截图 bug：
  // 中文界面下分段仍显示 Expense/Income/Net）。所有带文案的 memo 都必须加 langMode。
  const segOptions = useMemo(
    () => [
      { label: t('report.expense'), value: 'expense' as const },
      { label: t('report.income'), value: 'income' as const },
      { label: t('home.calNet'), value: 'net' as const },
    ],
    [t, langMode]
  );

  const netTotal = monthIncome - monthExpense;

  return (
    <View>
      {/* 月份导航 */}
      <View style={styles.calHeader}>
        <PressableScale
          onPress={onPrevMonth}
          style={styles.calNav}
          activeScale={0.85}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel={t('report.rangeMonth')}
        >
          <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
        </PressableScale>
        <Text style={styles.calTitle} numberOfLines={1}>
          {title}
        </Text>
        <PressableScale
          onPress={onNextMonth}
          style={styles.calNav}
          activeScale={0.85}
          hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('report.rangeMonth')}
        >
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </PressableScale>
      </View>

      {/* 星期表头（周日排首，周末支出色） */}
      <View style={styles.weekRow}>
        {weekdayLabels.map((w, i) => (
          <Text key={i} style={[styles.weekLabel, (i === 0 || i === 6) && styles.weekLabelWeekend]}>
            {w}
          </Text>
        ))}
      </View>

      {/* 月格：key 随月份变化 → 重新挂载播 150ms 渐显（翻月反馈）。
          纯静态 Views 上用 entering，不与任何 animated transform 同节点，无冲突 */}
      <Reanimated.View key={`${year}-${month}`} entering={FadeIn.duration(150)} style={styles.grid}>
        {cells.map((cell, idx) => {
          const isToday = cell.dateKey === todayKey;
          const weekend = idx % 7 === 0 || idx % 7 === 6;
          const dayTotals = cell.dateKey ? days.get(cell.dateKey) : undefined;
          // ⚠ 选中判定必须先排除空 dateKey：灰显格 dateKey=null，未选择时
          // selectedDate 也是 null，直接 === 会 null===null 恒成立，把所有
          // 跨月格误标成选中（真机截图 bug：跨月日期全被框住）
          const isSelected = !!cell.dateKey && cell.dateKey === selectedDate;
          // 药丸内容随分段切换；当日无该类收支则不显示
          let pill: { text: string; kind: 'expense' | 'income' } | null = null;
          if (dayTotals) {
            if (segKey === 'expense' && dayTotals.expense > 0) {
              pill = { text: `-${compactAmount(dayTotals.expense, isEn)}`, kind: 'expense' };
            } else if (segKey === 'income' && dayTotals.income > 0) {
              pill = { text: `+${compactAmount(dayTotals.income, isEn)}`, kind: 'income' };
            } else if (segKey === 'net') {
              const net = dayTotals.income - dayTotals.expense;
              if (net !== 0) {
                pill = {
                  text: `${net > 0 ? '+' : '-'}${compactAmount(Math.abs(net), isEn)}`,
                  kind: net > 0 ? 'income' : 'expense',
                };
              }
            }
          }
          return (
            // 外层 View 托管 14.28% 列宽——⚠ 不能把百分比宽度直接挂 PressableScale：
            // 它的 style 在内层 Animated.View 上，外层 Pressable 无宽度约束时
            // 百分比失效，7 列会挤成 ~10 列（真机截图 bug）。 hitSlop 0：默认 12
            // 会让相邻日期格触摸区互相重叠
            <View key={idx} style={styles.cell}>
              <PressableScale
                style={styles.cellInner}
                // 有账的日期才可点开明细；无账日期/灰显日期点击无动作
                onPress={cell.dateKey && dayTotals ? () => setSelectedDate((d) => (d === cell.dateKey ? null : cell.dateKey!)) : undefined}
                activeScale={cell.dateKey && dayTotals ? 0.9 : 1}
                disabled={!cell.dateKey || !dayTotals}
                hitSlop={0}
                accessibilityRole={cell.dateKey && dayTotals ? 'button' : undefined}
                accessibilityLabel={cell.dateKey ?? undefined}
              >
                {/* 选中标记=数字外的圆环。⚠ 实现铁律：两层圆从挂载起就**常驻实底**，
                    选中只「换色」——绝不出现 无填充 View 翻入 border/bg（Fabric Android
                    重建背景 drawable 丢圆角 → 方形，真机 bug）或条件挂载新圆（新建
                    drawable 同样丢圆角）。App 内所有正常圆环（色点选中环/头像徽章）均此构。
                    三态同构：普通=外卡色隐形/内透明；今天=外卡色/内紫底白字；
                    选中非今天=外紫/内卡色(3px 紫环)紫字；选中今天=外 textPrimary/内紫白字 */}
                <View
                  style={[
                    styles.dayRingOuter,
                    isSelected && !isToday && styles.dayRingOuterSel,
                    isSelected && isToday && styles.dayRingOuterSelToday,
                  ]}
                >
                  <View
                    style={[
                      styles.dayRingInner,
                      // 内圆常驻卡色（见样式注释）；今天翻紫底白字
                      isToday && styles.dayRingInnerToday,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        weekend && !isToday && styles.dayTextWeekend,
                        cell.muted && styles.dayTextMuted,
                        isToday && styles.dayTextToday,
                        isSelected && !isToday && styles.dayTextSelected,
                      ]}
                    >
                      {cell.day}
                    </Text>
                  </View>
                </View>
                {pill && (
                  <Text style={[styles.pill, pill.kind === 'expense' ? styles.pillExpense : styles.pillIncome]} numberOfLines={1}>
                    {pill.text}
                  </Text>
                )}
              </PressableScale>
            </View>
          );
        })}
      </Reanimated.View>

      {/* 当日明细：点日期展开/收起，再点同日收起。行样式与账单列表的 todayRow 同构 */}
      {selectedDay && selectedDay.items && selectedDay.items.length > 0 && (
        <View style={styles.dayDetailWrap}>
          <Text style={styles.dayDetailDate} numberOfLines={1}>
            {selectedDateLabel}
          </Text>
          {selectedDay.items.map((it) => (
            <View key={it.id} style={styles.dayDetailRow}>
              <Text style={[styles.dayDetailTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                {it.title}
              </Text>
              <Text
                style={[styles.dayDetailAmount, { color: it.type === 'expense' ? colors.expense : colors.income }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {it.type === 'expense' ? '-' : '+'}
                {fmtMoney(it.amount)}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* 支出/收入/总额 分段：药丸显示哪个指标。
          SegmentedControl 轨道是 alignSelf:'flex-start'（设置页三颗开关依赖，公共组件不能动）。
      ⚠ Yoga 里子元素显式 alignSelf 优先级高于父容器 alignItems——用 alignItems:center 抵消无效（真机已验证仍靠左）。
      正确做法：居中层做成行容器，主轴 justifyContent:center 控制轨道水平位置 */}
      <View style={styles.segWrap}>
        <View style={styles.segCenter}>
          <SegmentedControl options={segOptions as { label: string; value: string }[]} selected={segKey} onSelect={(v) => setSegKey(v as SegKey)} />
        </View>
      </View>

      {/* 当月合计行：总额 / 收入 / 支出。金额 ≥100 万走同一套缩写阶梯——
          完整数字（-50545976.00 12字符）在 1/3 列宽里必然截断（真机截图 bug） */}
      <View style={styles.totalsRow}>
        <View style={styles.totalsCol}>
          <Text style={[styles.totalsAmt, { color: colors.textPrimary }]} numberOfLines={1}>
            {totalsText(netTotal, isEn)}
          </Text>
          <Text style={styles.totalsLabel}>{t('home.calNet')}</Text>
        </View>
        <View style={styles.totalsCol}>
          <Text style={[styles.totalsAmt, { color: colors.income }]} numberOfLines={1}>
            {totalsText(monthIncome, isEn)}
          </Text>
          <Text style={styles.totalsLabel}>{t('report.income')}</Text>
        </View>
        <View style={styles.totalsCol}>
          <Text style={[styles.totalsAmt, { color: colors.expense }]} numberOfLines={1}>
            {totalsText(monthExpense, isEn)}
          </Text>
          <Text style={styles.totalsLabel}>{t('report.expense')}</Text>
        </View>
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    calHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 2,
      marginBottom: 4,
    },
    calNav: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    calTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.textPrimary },
    weekRow: { flexDirection: 'row', marginBottom: 2 },
    weekLabel: { flex: 1, textAlign: 'center', fontSize: 11, color: colors.textTertiary, paddingVertical: 3 },
    weekLabelWeekend: { color: colors.expense, opacity: 0.75 },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    cell: {
      width: '14.28%',
      minHeight: 46,
      paddingTop: 3,
      paddingHorizontal: 1,
    },
    // 内层可按压区：铺满外层列宽（选中标记在日期圆环上，本层无底色无描边）
    cellInner: {
      width: '100%',
      minHeight: 46,
      alignItems: 'center',
    },
    dayDetailWrap: {
      marginTop: 6,
      paddingTop: 6,
      borderTopWidth: 1,
      borderTopColor: colors.dividerHair,
    },
    // 明细区日期标头（9/25周五）：与账单列表 dayHeaderText 同款风格但小一号
    dayDetailDate: { fontSize: 12, fontWeight: '700', color: colors.link, marginBottom: 2 },
    dayDetailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 7,
      minHeight: 36,
    },
    dayDetailTitle: { flex: 1, marginRight: 8, fontSize: 13, fontWeight: '600' },
    dayDetailAmount: {
      flexShrink: 1,
      minWidth: 0,
      marginLeft: 8,
      fontSize: 13,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    dayRingOuter: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      // ⚠ 常驻实底 colors.card：与本卡 sectionCard 同色=未选中时隐形。
      // 三态只换色不换几何，绝不出现「无填充→border/bg」或「条件挂载新圆」
      // （两种都会让 Fabric Android 重建背景 drawable 丢圆角画成方形）
      backgroundColor: colors.card,
    },
    // 选中非今天：外圆翻成紫（内圆保持卡色）→ 3px 紫环 + 紫字
    dayRingOuterSel: { backgroundColor: colors.link },
    // 选中今天：外圆翻成 textPrimary（内圆翻成紫底）→ 环套紫圆 + 白字
    dayRingOuterSelToday: { backgroundColor: colors.textPrimary },
    dayRingInner: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      // ⚠ 常驻实底 colors.card：与外圆默认卡色一致=未选中隐形；选中非今天时
      // 外圆翻紫、内圆保持卡色 → 差出 3px 紫环。内圆若透明，紫外圆整个透出
      backgroundColor: colors.card,
    },
    // 今天：内圆紫实底（数字白字见 dayTextToday）
    dayRingInnerToday: { backgroundColor: colors.link },
    dayText: { fontSize: 13, color: colors.textPrimary },
    dayTextWeekend: { color: colors.expense },
    dayTextMuted: { color: colors.textTertiary, opacity: 0.45 },
    // 选中非今天的数字用主题紫加粗（今天实底圆里是白字，见 dayTextToday）
    dayTextSelected: { color: colors.link, fontWeight: '700' },
    // 今天实底紫圆里的数字：白字加粗
    dayTextToday: { color: '#FFFFFF', fontWeight: '700' },
    pill: {
      marginTop: 2,
      maxWidth: '100%',
      fontSize: 9,
      fontWeight: '700',
      lineHeight: 12,
      paddingHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 5,
      overflow: 'hidden',
      fontVariant: ['tabular-nums'],
    },
    pillExpense: { color: colors.expense, backgroundColor: colors.expense + '21' },
    pillIncome: { color: colors.income, backgroundColor: colors.income + '21' },
    segWrap: { paddingVertical: 8 },
    // 抵消 SegmentedControl 轨道 alignSelf:'flex-start' 的居中层：
    // ⚠ Yoga 里子元素显式 alignSelf 优先级高于父容器 alignItems，alignItems:center 抵消无效
    // （真机已验证仍靠左）。必须做成行容器，用主轴 justifyContent:center 让轨道水平居中
    segCenter: { flexDirection: 'row', justifyContent: 'center' },
    totalsRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      borderTopWidth: 1,
      borderTopColor: colors.dividerHair,
      paddingTop: 10,
      paddingBottom: 2,
    },
    totalsCol: { flex: 1, alignItems: 'center' },
    totalsAmt: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
    totalsLabel: { fontSize: 10, color: colors.textTertiary, marginTop: 2 },
  });
}
