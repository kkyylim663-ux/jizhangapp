// MonthCalendarCard.tsx
// 首页「日历视图」的月历卡内容（原型 prototype/calendar-switch-proto.html 拍板形态）：
// - ‹ 月份 › 导航（IconButton）+ 周日排首的 6 行月格（周末不再单独上色）
// - 有账的日期下方金额药丸：MoneyText 紧凑格式（−1.5k / +6.8k / 172.72，11pt），
//   支出中性− / 收入绿+ / 净额按正负取收入/支出色
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
import { IconButton } from './ui/IconButton';
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

/** 药丸淡底透明度（UI_RULES 第 1 节：语义色 12% 淡底，与类别图标方块 / Badge 同比例） */
const PILL_TINT_ALPHA = 0.12;

// 药丸 / 合计金额此前有一套自造的中文缩写阶梯（万→百万→千万…，多轮真机截断 bug 修补：
// 505.3M、50.6亿、万亿兜底…）。T12 起统一交给 MoneyText / formatMoney 的紧凑格式
// （1.5k / 1.2M / 3.4B），本文件的 compactAmount / scaledNum / bigEnUnit / totalsText
// 一并删除 —— formatMoney 头注释里「迁移要单独派任务」指的就是本任务（仅限本文件）。

export default function MonthCalendarCard({ year, month, days, monthExpense, monthIncome, onPrevMonth, onNextMonth, onPressItem }: Props) {
  const { semantic, spacing, radius } = useTheme();
  const t = useT();
  const { langMode } = useLanguage();
  const styles = useMemo(() => makeStyles(semantic, spacing, radius), [semantic, spacing, radius]);
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
      {/* 月份导航：IconButton（44pt 触控区 + 必填读屏标签；标签语义=「上个月/下个月」，
          旧实现借 report.rangeMonth（'月'）语义不对）。图标色保持次要文字色，别抢标题 */}
      <View style={styles.calHeader}>
        <IconButton
          icon="chevron-back"
          size={20}
          color={semantic.textSecondary}
          onPress={onPrevMonth}
          accessibilityLabel={t('home.prevMonth')}
        />
        <AppText variant="headline" style={styles.calTitle} numberOfLines={1}>
          {title}
        </AppText>
        <IconButton
          icon="chevron-forward"
          size={20}
          color={semantic.textSecondary}
          onPress={onNextMonth}
          accessibilityLabel={t('home.nextMonth')}
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
          // 药丸底色 = 语义色 12% 淡底（字色/符号由 MoneyText 按 kind 自动取：支出中性−、收入绿+）
          const pillTone = pill && pill.kind === 'income' ? semantic.amountIncome : semantic.amountExpense;
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
                {/* 选中标记 = 数字外的圆环。⚠ 实现铁律：三层圆从挂载起就**常驻实底**、几何不变，
                    选中 / 今天只「换色」——绝不出现 无填充 View 翻入 border/bg（Fabric Android
                    重建背景 drawable 丢圆角 → 方形，真机 bug）或条件挂载新圆（同样丢圆角）。
                    三态（验收退回第 4 条，不得出现黑 / 白圈）：
                      普通 = 外/中/内全卡色（隐形）
                      今天 = 内 accent 实心圆 + onAccent 字
                      选中 = 外 accent（2pt 描边圈）+ 内卡色 + accentText 字
                      今天且选中 = accent 实心圆 + 2pt 间隙（中圈卡色）+ accent 外圈 */}
                <View style={[styles.dayRingOuter, isSelected && styles.dayRingOuterSel]}>
                  <View style={styles.dayRingMid}>
                    <View style={[styles.dayRingInner, isToday && styles.dayRingInnerToday]}>
                    <AppText
                      variant="footnote"
                      // 今天 / 选中加粗走 AppText 的 weight 分流（不能写 style.fontWeight：
                      // Inter 按字重分家族，合成加粗会双重加粗）
                      weight={isToday || isSelected ? '700' : undefined}
                      style={[
                        styles.dayText,
                        cell.muted && styles.dayTextMuted,
                        isToday && styles.dayTextToday,
                        isSelected && !isToday && styles.dayTextSelected,
                      ]}
                    >
                      {cell.day}
                    </AppText>
                    </View>
                  </View>
                </View>
                {pill && (
                  // 药丸外形保留（小胶囊 + 同色淡底）；文字用 MoneyText（紧凑格式、永不换行），
                  // roll 关掉：一次切段 42 个药丸同时滚数字是白烧性能。
                  // ⚠ compactFallback={false} 必须关：日期格本身是 button，MoneyText 的
                  // 「放不下 → 包 Pressable 长按看全文」会在里面再套一个 button
                  // （Web 控制台报 <button> 不能嵌套 + 读屏重复播报）；药丸已有
                  // maxWidth 100% + overflow hidden，11pt 紧凑文本不会溢出
                  <View style={[styles.pill, { backgroundColor: withAlpha(pillTone, PILL_TINT_ALPHA) }]}>
                    <MoneyText value={pill.value} kind={pill.kind} variant="caption2" compact compactFallback={false} roll={false} />
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
function makeStyles(semantic: SemanticColors, spacing: Spacing, radius: Radius) {
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
    // 三层圆（外 32 / 中 28 / 内 24）：选中 → 外翻 accent（2pt 描边圈）；
    // 今天 → 内翻 accent 实心圆；中圈恒卡色 = 今天+选中时天然形成「2pt 间隙」。
    // ⚠ 三层从挂载起常驻实底、几何不变，只换色（见 JSX 注释的真机铁律）
    dayRingOuter: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: semantic.surface,
    },
    dayRingOuterSel: { backgroundColor: semantic.accent },
    dayRingMid: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: semantic.surface,
    },
    dayRingInner: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: semantic.surface,
    },
    dayRingInnerToday: { backgroundColor: semantic.accent },
    // 日期数字（footnote 档，加粗由 JSX 的 weight 给）：四态颜色互斥——
    // 普通 / 周末 textPrimary、灰显 textTertiary、今天 onAccent、选中非今天 accentText
    dayText: { color: semantic.textPrimary },
    dayTextMuted: { color: semantic.textTertiary, opacity: 0.45 },
    dayTextSelected: { color: semantic.accentText },
    dayTextToday: { color: semantic.onAccent },
    // 金额药丸（与 Badge 同规格：radius.xs + caption2 文字 + 语义色 12% 淡底，底色在
    // JSX 里 withAlpha 派生）。maxWidth 100% + overflow hidden：再长也只裁尾不溢出格
    pill: {
      marginTop: spacing.xs,
      maxWidth: '100%',
      overflow: 'hidden',
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.xs,
      borderRadius: radius.xs,
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
