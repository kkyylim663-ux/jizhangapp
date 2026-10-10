// MonthCalendarCard.tsx
// 首页「日历视图」的月历卡内容（UI V2.1 按 .zcode/design/mockups/v21/P_Calendar.dc.html 重做）：
// - ‹ 月份 › 导航 = 36 圆钮 + chip 淡底（触控区 44）+ 周日排首的 6 行月格（周末不再单独上色）
// - 日期数字 = 26 圆：今天 = 选中色实心圆，选中日 = 同色描边圈（普通日隐形描边）
// - 有账的日期下方金额药丸 = chip 淡底胶囊 + textPrimary 紧凑金额（−1.5k / +6.8k，11pt）
// - [支出|收入|总额] SegmentedControl 切换药丸显示的指标
// - 底部当月合计行：总额 / 收入 / 支出
// 配色统一走 useTheme().semantic 令牌层、字号统一走 AppText / MoneyText 档位（UI_RULES 第 1/2/7 节）。
// 本组件只负责渲染；月份状态与数据聚合都在 HomeScreen（dayGroups 单一数据源，
// 保证日历数字与账单列表逐日一致，天然继承币种过滤与转账排除）。
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, { FadeIn } from 'react-native-reanimated';
import PressableScale from './PressableScale';
import SegmentedControl from './SegmentedControl';
import AppText from './ui/AppText';
import MoneyText from './ui/MoneyText';
import { IconCircle } from './ui/IconCircle';
import { Ionicons } from '@expo/vector-icons';
import { withAlpha } from './ui/color';
import { useTheme } from '../theme/useTheme';
import { useT } from '../i18n/LanguageContext';
import { useLanguage } from '../i18n/LanguageContext';
import type { MoneyKind } from '../utils/formatMoney';
import { formatDate } from '../utils/formatDate';
import type { Layout, Radius, SemanticColors, Spacing } from '../theme/theme';

/** 当日逐笔账单（点日期在下方展开的明细行）：字段与首页列表的 TransactionRow 一一对应
 *  —— 明细行要求和首页列表行一模一样（验收退回第 3 条）。
 *  ⚠ note 由调用方做和首页列表相同的回落：有备注/计划名时 = 该文本、无则 = 类别名，
 *    同时 categoryName 传空串，这样副标题只剩账户（不把类别写第二遍）。 */
export interface CalendarDayItem {
  id: string;
  /** 标题（备注；无备注时为类别名） */
  note?: string;
  /** 类别名（副标题第一段；与 note 同为类别名时传空串） */
  categoryName: string;
  categoryIcon?: React.ComponentProps<typeof Ionicons>['name'];
  categoryColor?: string;
  accountName?: string;
  amount: number;
  type: 'expense' | 'income';
}

export interface CalendarDayTotals {
  expense: number;
  income: number;
  /** 当日逐笔账单（点日期在下方展示明细用）；与账单列表同源，顺序=列表顺序 */
  items?: CalendarDayItem[];
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
  /** 点明细行 → 交给页面走「进入编辑」的现有入口（与首页列表行同一入口） */
  onPressItem?: (id: string) => void;
}

const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** chip 淡底（P_Calendar 稿 --chip）：夜 = textPrimary 12%，日 = accent 10%（令牌 + withAlpha 派生） */
function chipFillOf(semantic: SemanticColors, isDark: boolean) {
  return isDark ? withAlpha(semantic.textPrimary, 0.12) : withAlpha(semantic.accent, 0.1);
}

/** 月份翻页圆钮（P_Calendar 稿）：36 视觉圆 + chip 淡底 + 16 图标；触控区 44（外层兜住）。
 *  为什么不再用 ui/IconButton：稿里这两颗是「chip 淡底圆钮」，IconButton 只有 plain/soft/solid
 *  三档平涂（共享组件不在此车道可改范围），所以按稿的规格页内组合一次，颜色全取令牌。 */
function MonthNavButton({
  icon,
  accessibilityLabel,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const { semantic, isDark } = useTheme();
  const chipFill = chipFillOf(semantic, isDark);
  return (
    <PressableScale
      onPress={onPress}
      activeScale={0.9}
      hitSlop={0}
      style={navStyles.touch}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[navStyles.circle, { backgroundColor: chipFill }]}>
        <Ionicons name={icon} size={16} color={semantic.textPrimary} />
      </View>
    </PressableScale>
  );
}

/** 翻页圆钮的纯图形几何（36 视觉 / 44 触控，来自 P_Calendar 稿与 UI_RULES 第 4 节） */
const navStyles = StyleSheet.create({
  touch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});

/** 明细行（UI V2）：42 圆图标 + 标题（备注）+ 副标题（类别 · 账户）+ 右金额。
 *  几何与首页账单行同规格（见 HomeScreen 的 TxRow），点整行 = 进编辑。 */
function CalendarDetailRow({
  item,
  onPress,
}: {
  item: CalendarDayItem;
  onPress?: () => void;
}) {
  const { semantic, spacing, layout } = useTheme();
  const styles = useMemo(() => makeDetailRowStyles(semantic, spacing, layout), [semantic, spacing, layout]);
  // 副标题：类别 · 账户（账户缺失时只有类别，不留下孤零零的分隔点）
  const subtitle = [item.categoryName, item.accountName].filter((part): part is string => !!part).join(' · ');
  return (
    <PressableScale
      onPress={onPress}
      activeScale={0.98}
      hitSlop={0}
      style={styles.row}
      accessibilityRole="button"
    >
      <IconCircle color={item.categoryColor} icon={item.categoryIcon} />
      <View style={styles.textBlock}>
        <AppText variant="subhead" weight="500" numberOfLines={2}>
          {item.note ?? item.categoryName}
        </AppText>
        {!!subtitle && (
          <AppText variant="caption" color={semantic.textSecondary} numberOfLines={1}>
            {subtitle}
          </AppText>
        )}
      </View>
      <MoneyText value={item.amount} kind={item.type} variant="body" />
    </PressableScale>
  );
}

/** 明细行样式（令牌进、StyleSheet 出） */
function makeDetailRowStyles(semantic: SemanticColors, spacing: Spacing, layout: Layout) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.md,
      minHeight: 60,
      paddingVertical: spacing.sm,
    },
    textBlock: { flex: 1, minWidth: 0, rowGap: 2 },
  });
}

// 药丸 / 合计金额此前有一套自造的中文缩写阶梯（万→百万→千万…，多轮真机截断 bug 修补：
// 505.3M、50.6亿、万亿兜底…）。T12 起统一交给 MoneyText / formatMoney 的紧凑格式
// （1.5k / 1.2M / 3.4B），本文件的 compactAmount / scaledNum / bigEnUnit / totalsText
// 一并删除 —— formatMoney 头注释里「迁移要单独派任务」指的就是本任务（仅限本文件）。

export default function MonthCalendarCard({ year, month, days, monthExpense, monthIncome, onPrevMonth, onNextMonth, onPressItem }: Props) {
  const { semantic, spacing, radius, isDark, glassPill } = useTheme();
  const t = useT();
  const { langMode } = useLanguage();
  // 「今天 / 选中」的实心色档（P_Calendar 稿 --sel / --selt）：夜 = 白圆 + 深字 #1A1040，
  // 日 = 紫圆 + 白字 —— 直接复用分段控件选中块的令牌（useTheme 已按主题解析好），不另造色
  const sel = glassPill;
  // 金额小胶囊 / 月份翻页圆钮的淡底（稿 --chip）：夜 = textPrimary 12%，日 = accent 10%
  // （令牌 + withAlpha 派生，不写死色值）
  const chipFill = chipFillOf(semantic, isDark);
  const styles = useMemo(
    () => makeStyles(semantic, spacing, radius, chipFill, sel.fill),
    [semantic, spacing, radius, chipFill, sel.fill]
  );
  const [segKey, setSegKey] = useState<SegKey>('expense');
  // 点选的日期（YYYY-MM-DD）：再点一次同日收起；翻月自动清空（月格 key 重挂不清 state，需显式清）
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  useEffect(() => {
    setSelectedDate(null);
  }, [year, month]);
  const selectedDay = selectedDate ? days.get(selectedDate) : undefined;
  const isEn = langMode === 'en';
  // 明细区标头：与首页列表的日期头同一写法（今天 / 昨天 / 10月8日 周四 · Today / Oct 8, Thu），
  // 不再手拼 9/25周五 那种另一种写法（验收退回第 3 条）
  const selectedDateLabel = useMemo(
    () => (selectedDate ? formatDate(selectedDate, langMode) : ''),
    [selectedDate, langMode]
  );

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
      {/* 月份导航（P_Calendar 稿）：36 圆钮 + chip 淡底 + textPrimary 图标 16；
          触控区仍 ≥44（按 v2 稿的 .gb 规格做 44 外框兜住 36 视觉件，与 ui/Chip 同一手法）。
          图标色走 textPrimary（§3：玻璃上的图标文字都用主文字色） */}
      <View style={styles.calHeader}>
        <MonthNavButton
          icon="chevron-back"
          accessibilityLabel={t('home.prevMonth')}
          onPress={onPrevMonth}
        />
        <AppText variant="headline" style={styles.calTitle} numberOfLines={1}>
          {title}
        </AppText>
        <MonthNavButton
          icon="chevron-forward"
          accessibilityLabel={t('home.nextMonth')}
          onPress={onNextMonth}
        />
      </View>

      {/* 星期表头（周日排首）：7 列统一 textSecondary——周末不再用支出色（H10），
          且 11pt 不许用 textTertiary（UI_RULES 第 1 节：textTertiary 只给 ≥13pt） */}
      <View style={styles.weekRow}>
        {weekdayLabels.map((w, i) => (
          <AppText key={i} variant="caption2" color={semantic.textSecondary} style={styles.weekLabel}>
            {w}
          </AppText>
        ))}
      </View>

      {/* 月格：key 随月份变化 → 重新挂载播 150ms 渐显（翻月反馈）。
          纯静态 Views 上用 entering，不与任何 animated transform 同节点，无冲突 */}
      <Reanimated.View key={`${year}-${month}`} entering={FadeIn.duration(150)} style={styles.grid}>
        {cells.map((cell, idx) => {
          const isToday = cell.dateKey === todayKey;
          const dayTotals = cell.dateKey ? days.get(cell.dateKey) : undefined;
          // ⚠ 选中判定必须先排除空 dateKey：灰显格 dateKey=null，未选择时
          // selectedDate 也是 null，直接 === 会 null===null 恒成立，把所有
          // 跨月格误标成选中（真机截图 bug：跨月日期全被框住）
          const isSelected = !!cell.dateKey && cell.dateKey === selectedDate;
          // 药丸内容随分段切换；当日无该类收支则不显示。
          // 金额交给 MoneyText（全 App 唯一金额组件）：紧凑格式（1.5k/1.2M）在
          // 7 列窄格（360dp 屏每格约 51dp）里永不换行、不溢出，也不再手写 9pt 字号。
          // 净额按正负套收入/支出语义（+1.5k 绿 / −1.5k 中性，与旧版一致），0 不显示
          let pill: { value: number; kind: MoneyKind } | null = null;
          if (dayTotals) {
            if (segKey === 'expense' && dayTotals.expense > 0) {
              pill = { value: dayTotals.expense, kind: 'expense' };
            } else if (segKey === 'income' && dayTotals.income > 0) {
              pill = { value: dayTotals.income, kind: 'income' };
            } else if (segKey === 'net') {
              const net = dayTotals.income - dayTotals.expense;
              if (net > 0) pill = { value: net, kind: 'income' };
              else if (net < 0) pill = { value: net, kind: 'expense' };
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
                // 读屏读出「已选中」（UI_RULES 第 8 节：选中态必须可读）
                accessibilityState={isSelected ? { selected: true } : undefined}
              >
                {/* 日期数字的圆标（P_Calendar 稿）：26 圆、描边 1.5 常驻，三态只「换色」——
                    ⚠ 沿用真机铁律（Fabric Android）：几何从挂载起不变、边框常驻，绝不出现
                    「无填充 View 翻入 border/bg」（重建背景 drawable 丢圆角 → 方形）。
                      普通    = 描边透明 + 底透明（隐形）
                      今天    = sel.fill 实心圆（夜白字深字 / 日紫字白字）
                      选中    = sel.fill 描边圈 + textPrimary 字
                      今天+选中 = 实心圆 + 1.5 描边（外圈再套一圈同色描边圈做区分） */}
                <View style={[styles.dayOuter, isToday && isSelected && styles.dayOuterBoth]}>
                  <View
                    style={[
                      styles.dayCircle,
                      isToday && { backgroundColor: sel.fill, borderColor: sel.fill },
                      isSelected && !isToday && styles.dayCircleSelected,
                    ]}
                  >
                    <AppText
                      variant="footnote"
                      // 今天 / 选中加粗走 AppText 的 weight 分流（不能写 style.fontWeight：
                      // Inter 按字重分家族，合成加粗会双重加粗）
                      weight={isToday || isSelected ? '700' : undefined}
                      style={[
                        styles.dayText,
                        cell.muted && styles.dayTextMuted,
                        isToday && { color: sel.text },
                      ]}
                    >
                      {cell.day}
                    </AppText>
                  </View>
                </View>
                {pill && (
                  // 药丸（P_Calendar 稿 .chip）：chip 淡底胶囊 + 11pt 等宽数字。
                  // 字色统一 textPrimary（稿里药丸文字就是 --cgt），正负号仍由 MoneyText 的 kind 给
                  // —— 稿里 42 格药丸全是中性色，收入/支出的区分交给上方分段筛选与 +/− 号。
                  // roll 关掉：一次切段 42 个药丸同时滚数字是白烧性能。
                  // ⚠ compactFallback={false} 必须关：日期格本身是 button，MoneyText 的
                  // 「放不下 → 包 Pressable 长按看全文」会在里面再套一个 button
                  // （Web 控制台报 <button> 不能嵌套 + 读屏重复播报）；药丸已有
                  // maxWidth 100% + overflow hidden，11pt 紧凑文本不会溢出
                  <View style={styles.pill}>
                    <MoneyText
                      value={pill.value}
                      kind={pill.kind}
                      color={semantic.textPrimary}
                      variant="caption2"
                      compact
                      compactFallback={false}
                      roll={false}
                    />
                  </View>
                )}
              </PressableScale>
            </View>
          );
        })}
      </Reanimated.View>

      {/* 当日明细：点日期展开/收起，再点同日收起。行样式与账单列表同构 */}
      {selectedDay && selectedDay.items && selectedDay.items.length > 0 && (
        <View style={styles.dayDetailWrap}>
          <AppText variant="caption" color={semantic.accentText} weight="700" style={styles.dayDetailDate} numberOfLines={1}>
            {selectedDateLabel}
          </AppText>
          {selectedDay.items.map((it) => (
            // 明细行 = 首页列表同款（42 圆图标 + 标题=备注 + 副标题 类别 · 账户 + MoneyText）；
            // 点一下走页面的现有「进入编辑」入口（验收退回第 3 条）。
            // ⚠ 这里自绘而不复用 ui/TransactionRow：UI V2 把列表图标改成圆形，TransactionRow 是
            //   本车道之外的共享文件（40 方块），改它会波及别的车道 —— 按同一几何自绘一份。
            <CalendarDetailRow
              key={it.id}
              item={it}
              onPress={onPressItem ? () => onPressItem(it.id) : undefined}
            />
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

      {/* 当月合计行：支出 · 收入 · 总额（与上面分段控件同顺序；数值与计算逻辑不变 —— 验收退回第 5 条）
          金额走 MoneyText：完整金额放不下时自动降级紧凑格式，长按看完整金额 */}
      <View style={styles.totalsRow}>
        <View style={styles.totalsCol}>
          <MoneyText value={monthExpense} variant="headline" color={semantic.amountExpense} />
          <AppText variant="caption2" color={semantic.textSecondary} style={styles.totalsLabel}>
            {t('report.expense')}
          </AppText>
        </View>
        <View style={styles.totalsCol}>
          <MoneyText value={monthIncome} variant="headline" color={semantic.amountIncome} />
          <AppText variant="caption2" color={semantic.textSecondary} style={styles.totalsLabel}>
            {t('report.income')}
          </AppText>
        </View>
        <View style={styles.totalsCol}>
          <MoneyText value={netTotal} variant="headline" />
          <AppText variant="caption2" color={semantic.textSecondary} style={styles.totalsLabel}>
            {t('home.calNet')}
          </AppText>
        </View>
      </View>
    </View>
  );
}

/** 令牌进、StyleSheet 出（UI_RULES 第 1/3/7 节：禁止写死色值 / 字号 / 圆角 / 间距） */
function makeStyles(semantic: SemanticColors, spacing: Spacing, radius: Radius, chipFill: string, selFill: string) {
  return StyleSheet.create({
    calHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.xs,
    },
    // 标题只管居中与占位；字号 / 字重 / 颜色全走 AppText headline 档
    calTitle: { flex: 1, textAlign: 'center' },
    weekRow: { flexDirection: 'row', marginBottom: spacing.xs },
    // 7 列统一上色（H10：周末不再用支出色）；caption2 = 11pt 最小档，11pt 不许 textTertiary
    weekLabel: { flex: 1, textAlign: 'center', paddingVertical: spacing.xs },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    cell: {
      width: '14.28%',
      minHeight: 46,
      paddingTop: spacing.xs,
      // 1px 列间隙：相邻药丸之间的视觉缝（纯图形常量，非布局间距）
      paddingHorizontal: 1,
    },
    // 内层可按压区：铺满外层列宽（选中标记在日期圆环上，本层无底色无描边）
    cellInner: {
      width: '100%',
      minHeight: 46,
      alignItems: 'center',
    },
    dayDetailWrap: {
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: semantic.hairline,
    },
    // 明细区日期标头（9/25周五）：紫字 accentText + caption 档 + 700（JSX 里给）
    dayDetailDate: { marginBottom: spacing.xs },
    dayDetailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      minHeight: 36,
    },
    dayDetailTitle: { flex: 1, marginRight: spacing.sm },
    // 明细金额（MoneyText）：只留左边距；flexShrink 由 MoneyText 自带（金额永不被挤压）
    dayDetailAmount: { marginLeft: spacing.sm },
    // 日期圆标（P_Calendar 稿）：外托 32（今天+选中时给一圈同色描边，做区分）+ 内圆 26。
    // ⚠ 描边宽度 1.5 从挂载起常驻、几何不变，三态只换色（见 JSX 注释的真机铁律）
    dayOuter: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayOuterBoth: { borderColor: selFill },
    dayCircle: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 1.5,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayCircleSelected: { borderColor: selFill },
    // 日期数字（footnote 档，加粗由 JSX 的 weight 给）：普通 textPrimary，灰显整档压暗
    // （P_Calendar 稿 opacity .35，且不进交互）；今天字色 = sel.text（JSX 里给）
    dayText: { color: semantic.textPrimary },
    dayTextMuted: { opacity: 0.35 },
    // 金额药丸（P_Calendar 稿 .chip：10.5pt / 内衬 1×5 / 全圆角 / chip 淡底 + textPrimary 字）。
    // maxWidth 100% + overflow hidden：再长也只裁尾不溢出格
    pill: {
      marginTop: 3,
      maxWidth: '100%',
      overflow: 'hidden',
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: radius.full,
      backgroundColor: chipFill,
      alignItems: 'center',
    },
    segWrap: { paddingVertical: spacing.sm },
    // 抵消 SegmentedControl 轨道 alignSelf:'flex-start' 的居中层：
    // ⚠ Yoga 里子元素显式 alignSelf 优先级高于父容器 alignItems，alignItems:center 抵消无效
    // （真机已验证仍靠左）。必须做成行容器，用主轴 justifyContent:center 让轨道水平居中
    segCenter: { flexDirection: 'row', justifyContent: 'center' },
    totalsRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      borderTopWidth: 1,
      borderTopColor: semantic.hairline,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },
    totalsCol: { flex: 1, alignItems: 'center' },
    // 合计标签：caption2（11pt 最小档）+ textSecondary（11pt 不许 textTertiary）
    totalsLabel: { marginTop: spacing.xs },
  });
}
