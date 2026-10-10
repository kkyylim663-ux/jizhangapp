// ReportScreen.tsx —— 统计页（T21 / 计划 5.5 R1–R6）
//
// 本次只改展示与交互反馈（功能冻结：数据口径、计算、导航入口、左右滑换期手势全部照旧）：
//   R1 页头 ScreenHeader 大标题「统计」+ 日历按钮（入口不变，仍开原有 DateRangePickerSheet）；
//      周期控件改一行 ‹ 2026年10月 ›（左右箭头 + 保留滑动），周/月/年改 SegmentedControl
//   R2 饼图去掉引线百分比标签；扇区间留 2pt 缝；环心用 MoneyText 显示总额；
//      点扇区 / 点列表行 = 高亮该类（其余扇区变淡，环心换成类名 + 金额 + 占比 + selection 震动）
//   R3 排行列表每行：图标方块 + 名称 + 占比细条（2pt，进场增长）+ 金额（中性色）+ 百分比 1 位小数
//   R4 进场动画：扇区 600ms 顺序绘制（在 DonutChart 内）、细条按实测轨道宽增长；尊重「减弱动态效果」
//   R5 空状态 EmptyState（图标 + 一句话 + 记一笔按钮），不再渲染灰圈 + 0.00
//   R6 支出 / 收入切换改标准 SegmentedControl
//
// ⚠ 已知功能问题（本次明确不改，属功能逻辑不在 UI 范围内，见汇报）：
//   availableCurrencies / selectedReportCurrency 的币种回退 useEffect（下面的原注释保留）。

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import DateRangePickerSheet from '../components/DateRangePickerSheet';
import SegmentedControl from '../components/SegmentedControl';
import PressableScale from '../components/PressableScale';
import DonutChart from '../components/DonutChart';
import { useApp } from '../context/AppContext';
import { ROUTES } from '../navigation/routes';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import type { Layout, Radius, SemanticColors, Spacing } from '../theme/theme';
import {
  AppText,
  Card,
  Chip,
  EmptyState,
  IconButton,
  MoneyText,
  ScreenHeader,
} from '../components/ui';
import { withAlpha } from '../components/ui/color';
import { TransactionType, Transaction } from '../types';
import { UNCATEGORIZED_ICON, UNCATEGORIZED_NAME, UNCATEGORIZED_COLOR } from '../constants/uncategorized';
import { useT, useLanguage } from '../i18n/LanguageContext';
import { getCategoryLabel } from '../i18n/categories';
import { formatDate } from '../utils/formatDate';
import { hapticSelection } from '../utils/haptics';

type IconName = keyof typeof Ionicons.glyphMap;
type RangeType = 'year' | 'month' | 'week' | 'custom';

// 环的几何：DonutChart 的绘制与「点扇区命中判定」共用这三个数，改一处必须两处一起改
// 环放大：205 直径；粗厚环形环宽 50（圆孔 = 205 − 2×50 = 105pt）；渲染角度微调 -15° 让
// 扇区边界错开最挤的正上方。
const DONUT_SIZE = 205;
const DONUT_STROKE = 50;
const DONUT_ROTATION_DEG = -15;

/** 占比细条高度（2pt）—— 纯几何常量（与资产页额度使用率细条同一规格） */
const SHARE_BAR_HEIGHT = 2;
/** 排行行图标方块边长（40，UI_RULES 第 7 节统一规格） */
const CATEGORY_ICON_BOX = 40;

// 周期类型标签：在组件内用 t() 翻译（zh/en 字典 report.range*）
const RANGE_TYPE_KEYS: Record<RangeType, string> = {
  year: 'report.rangeYear',
  month: 'report.rangeMonth',
  week: 'report.rangeWeek',
  custom: 'report.rangeCustom',
};

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 周视图 / 自定义区间用：只要"月/日"，不带年份，避免跨月区间("2026-09-28 ~ 2026-10-04")
// 在滑动条中间这种窄空间里被截断成"2026-09-..."
function fmtShort(d: Date) {
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

// 自定义区间存的是 fmt() 出来的 "YYYY-MM-DD" 字符串，直接摘掉年份部分即可，不用重新解析成 Date
function shortFromIso(s: string) {
  return s.slice(5).replace('-', '/');
}

function startOfWeek(d: Date) {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}

function buildRange(type: Exclude<RangeType, 'custom'>, anchor: Date, tr: (k: string, p?: Record<string, string | number>) => string): { start: string; end: string; label: string } {
  if (type === 'week') {
    const mon = startOfWeek(anchor);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { start: fmt(mon), end: fmt(sun), label: `${fmtShort(mon)}~${fmtShort(sun)}` };
  }
  if (type === 'year') {
    return {
      start: `${anchor.getFullYear()}-01-01`,
      end: `${anchor.getFullYear()}-12-31`,
      label: `${anchor.getFullYear()}`,
    };
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return {
    start: fmt(first),
    end: fmt(last),
    label: tr('report.monthLabel', { y: anchor.getFullYear(), m: anchor.getMonth() + 1 }),
  };
}

/**
 * 类别图标方块（UI_RULES 第 7 节统一规格：40 方块、radius.md 圆角、类别色 12% 底 + 100% 图标）。
 * 与资产页的账户图标方块同规格，统计页的每一项排行都从这里出。
 */
function CategoryIcon({ color, icon }: { color: string; icon: IconName }) {
  const { radius } = useTheme();
  return (
    <View
      style={{
        width: CATEGORY_ICON_BOX,
        height: CATEGORY_ICON_BOX,
        borderRadius: radius.md,
        backgroundColor: withAlpha(color, 0.12),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={20} color={color} />
    </View>
  );
}

/**
 * 占比细条（R3 / 验收退回第 4 条）：2pt 高、hairline 底 + **类别自己的颜色**填充
 * —— 饼图去掉引线标签后，下面这份列表就是图例，颜色必须和扇区一一对上。
 * 宽度 = onLayout 实测的轨道宽 × 占比（不写死像素）；进场按 motion.timing.numberRoll（600ms）
 * 「长」出来，与扇区绘制同一档时长；系统「减弱动态效果」时直接落终态。
 */
function ShareBar({ fraction, color, style }: { fraction: number; color: string; style?: StyleProp<ViewStyle> }) {
  const { semantic, radius, spacing, motion } = useTheme();
  const [trackW, setTrackW] = useState(0);

  const skipAnim = motion.reduceMotion || motion.timing.numberRoll === 0;
  const progress = useSharedValue(skipAnim ? 1 : 0);

  useEffect(() => {
    if (skipAnim) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration: motion.timing.numberRoll, easing: motion.easing.out });
  }, [skipAnim, progress, motion]);

  const fillStyle = useAnimatedStyle(() => ({ width: trackW * fraction * progress.value }));

  return (
    <View
      style={[
        {
          marginTop: spacing.sm,
          height: SHARE_BAR_HEIGHT,
          borderRadius: radius.full,
          backgroundColor: semantic.hairline,
          overflow: 'hidden',
        },
        style,
      ]}
      onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
    >
      <Animated.View
        style={[
          { height: SHARE_BAR_HEIGHT, borderRadius: radius.full, backgroundColor: color },
          fillStyle,
        ]}
      />
    </View>
  );
}

/**
 * 排行行（验收退回第 4/5 条定版）。
 *
 * 为什么不用 ListRow：这一行需要「图标方块 + 名称 + 占比细条 + 金额 + 百分比」五件套，
 * 且选中时整行要 accentSoft 底 + 标题加粗（ListRow 的标题字重是固定的 headline 档，改不了），
 * 所以在页面内用令牌 + 同一套 40 图标方块规格实现（行高 ≥ useLayout().rowMinHeight，与 ListRow 同规格）。
 */
function RankRow({
  color,
  icon,
  title,
  amount,
  fraction,
  pctText,
  selected,
  onPress,
  testID,
}: {
  color: string;
  icon: IconName;
  title: string;
  amount: number;
  /** 占比（0–1） */
  fraction: number;
  pctText: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { semantic, spacing, layout } = useTheme();
  const { rowMinHeight } = useLayout();

  return (
    <PressableScale
      onPress={onPress}
      activeScale={0.98}
      hitSlop={0}
      style={{
        minHeight: rowMinHeight,
        paddingHorizontal: layout.card,
        paddingVertical: spacing.md,
        justifyContent: 'center',
        // 选中：整行 accentSoft 底（与 Chip / 分段控件的选中态同一档紫）
        backgroundColor: selected ? semantic.accentSoft : 'transparent',
      }}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected }}
      testID={testID}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <CategoryIcon color={color} icon={icon} />
        <View style={{ flexGrow: 1, flexShrink: 1, marginLeft: spacing.md }}>
          <AppText variant="headline" weight={selected ? '700' : undefined} numberOfLines={2}>
            {title}
          </AppText>
        </View>
        {/* 金额（中性色、不带正负号）+ 百分比统一 1 位小数；flexShrink:0，永不被标题挤走 */}
        <View style={{ flexShrink: 0, marginLeft: spacing.sm, alignItems: 'flex-end' }}>
          <MoneyText value={amount} variant="body" />
          <AppText variant="footnote" color={semantic.textTertiary} align="right" style={{ marginTop: spacing.xs }}>
            {pctText}
          </AppText>
        </View>
      </View>
      {/* 占比细条单独占一行（左对齐标题栏、右到卡内边距）：长度与右边金额宽度无关，
          所以所有行的轨道等长，横向可以直接比长短（验收小修） */}
      <ShareBar fraction={fraction} color={color} style={{ marginLeft: CATEGORY_ICON_BOX + spacing.md }} />
    </PressableScale>
  );
}

export default function ReportScreen() {
  const { transactions, categories, getAssetById, currency, activeLedgerId } = useApp();
  const { semantic, spacing, layout, radius } = useTheme();
  const { pagePadding, contentMaxWidth } = useLayout();
  const tr = useT();
  const { langMode } = useLanguage();
  const navigation = useNavigation<any>();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  const styles = useMemo(
    () => makeStyles(semantic, spacing, layout, radius),
    [semantic, spacing, layout, radius]
  );

  const [type, setType] = useState<TransactionType>('expense');

  const now = new Date();

  const [rangeType, setRangeType] = useState<RangeType>('month');
  const [anchor, setAnchor] = useState(now);
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null);
  const [rangeSheetOpen, setRangeSheetOpen] = useState(false);

  const range = useMemo(() => {
    if (rangeType === 'custom' && customRange) {
      return { start: customRange.start, end: customRange.end, label: `${shortFromIso(customRange.start)}~${shortFromIso(customRange.end)}` };
    }
    return buildRange(rangeType === 'custom' ? 'month' : rangeType, anchor, tr);
  }, [rangeType, anchor, customRange]);

  const shiftRange = (dir: 1 | -1) => {
    if (rangeType === 'custom') return;
    hapticSelection();
    if (rangeType === 'month') {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
    } else if (rangeType === 'year') {
      setAnchor(new Date(anchor.getFullYear() + dir, 0, 1));
    } else {
      const next = new Date(anchor);
      next.setDate(next.getDate() + dir * 7);
      setAnchor(next);
    }
  };

  // 分段控件选周/月/年：直接切周期类型（与原来的下拉行为一致）。
  // 「自定义」这一档只在自定义区间时出现（用来把选中态摆正），点它不做切换。
  const handleRangeSelect = (value: string) => {
    if (value === 'custom') return;
    setRangeType(value as RangeType);
  };

  // 中间周期视图的跟手滑动：拖动时内容实时跟随（带阻尼），松手按距离/速度决定
  // 滑出换页（从另一侧滑入）还是弹回原位。Donut 区和下方滑动条共用同一组共享值。
  const DRAG_ROOM = 240;
  const dragX = useSharedValue(0);

  const makeDragGesture = () => Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      dragX.value = e.translationX;
    })
    .onEnd((e) => {
      'worklet';
      const dx = e.translationX;
      const commit = Math.abs(dx) > 60 || Math.abs(e.velocityX) > 500;
      if (!commit || rangeType === 'custom') {
        dragX.value = withTiming(0, { duration: 180 });
        return;
      }
      const dir = dx < 0 || e.velocityX < -400 ? 1 : -1;
      dragX.value = withTiming(dir * -DRAG_ROOM, { duration: 140 }, (fin) => {
        if (fin) {
          scheduleOnRN(shiftRange, dir);
          dragX.value = dir * DRAG_ROOM;
          dragX.value = withTiming(0, { duration: 200 });
        }
      });
    });

  const openDatePicker = () => {
    setRangeSheetOpen(true);
  };

  const ledgerTransactions = useMemo(
    () => transactions.filter((t) => t.ledgerId === activeLedgerId),
    [transactions, activeLedgerId]
  );

  const rangeTransactions = useMemo(
    () => ledgerTransactions.filter((t) => t.date >= range.start && t.date <= range.end),
    [ledgerTransactions, range]
  );

  // 这笔交易实际用的是哪个货币：优先看关联资产的货币，查不到就退回账本默认货币，不做汇率换算
  const getTransactionCurrency = (t: Transaction): string =>
    (t.assetId ? getAssetById(t.assetId)?.currency : undefined) ?? currency;

  // 按货币分开汇总收入/支出，避免不同货币的金额被直接相加
  const currencyBreakdown = useMemo(() => {
    const totals: Record<string, { income: number; expense: number }> = {};
    rangeTransactions.forEach((t) => {
      if (t.type !== 'income' && t.type !== 'expense') return;
      const code = getTransactionCurrency(t);
      if (!totals[code]) totals[code] = { income: 0, expense: 0 };
      if (t.type === 'income') totals[code].income += t.amount;
      else totals[code].expense += t.amount;
    });
    return totals;
  }, [rangeTransactions, currency]);

  // 币种 Chip 按 ABC 字母序排列（2026-09-24 用户定版，不再默认货币置顶/按活跃度排序）
  const availableCurrencies = useMemo(() => {
    const codes = Object.keys(currencyBreakdown);
    return codes.sort((c1, c2) => c1.localeCompare(c2));
  }, [currencyBreakdown]);

  const [selectedReportCurrency, setSelectedReportCurrency] = useState(currency);

  // ⚠ 币种回退逻辑：本次改造明确不动（属于功能逻辑，由用户决定是否修）
  useEffect(() => {
    if (!availableCurrencies.includes(selectedReportCurrency)) {
      setSelectedReportCurrency(currency);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableCurrencies]);

  const categoryBreakdown = useMemo(() => {
    const totals: Record<string, number> = {};
    rangeTransactions
      .filter((t) => t.type === type && getTransactionCurrency(t) === selectedReportCurrency)
      .forEach((t) => {
        totals[t.categoryId] = (totals[t.categoryId] || 0) + t.amount;
      });
    return Object.entries(totals)
      .map(([categoryId, value]) => {
        const cat = categories.find((c) => c.id === categoryId);
        return {
          categoryId,
          value,
          name: cat ? getCategoryLabel(cat, tr) : UNCATEGORIZED_NAME,
          color: cat?.color ?? UNCATEGORIZED_COLOR,
          icon: (cat?.icon ?? UNCATEGORIZED_ICON) as IconName,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [rangeTransactions, categories, type, selectedReportCurrency, langMode]);

  // 真实总额（包含占比很小的分类），百分比数字始终按这个算，保证是真实占比
  const periodTotal = categoryBreakdown.reduce((s, c) => s + c.value, 0);

  // R5：这段时间没有可统计的分类（或总额为 0）→ 空状态，不再画灰圈 + 0.00
  const isEmpty = categoryBreakdown.length === 0 || periodTotal <= 0;

  // R2 高亮：点扇区 / 点列表行选中的分类（null = 默认态，环心显示总支出/总收入）
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  // 环上高亮的下标（与 DonutChart 的 data 顺序一致 —— 环上渲染全部分类，不做「其他」合并）
  const selectedRingIndex = useMemo(() => {
    if (!selectedCategoryId) return null;
    const idx = categoryBreakdown.findIndex((c) => c.categoryId === selectedCategoryId);
    return idx >= 0 ? idx : null;
  }, [categoryBreakdown, selectedCategoryId]);
  const selectedCategory = selectedRingIndex === null ? null : categoryBreakdown[selectedRingIndex] ?? null;
  const selectedSharePct =
    selectedCategory && periodTotal > 0 ? (selectedCategory.value / periodTotal) * 100 : 0;

  // 分类展开：点某个分类，显示这段时间里这个分类下的每一笔明细（以 note 为主要展示信息）
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);

  const categoryItems = (categoryId: string): Transaction[] =>
    rangeTransactions
      .filter(
        (t) => t.type === type && t.categoryId === categoryId && getTransactionCurrency(t) === selectedReportCurrency
      )
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));

  // 列表行点击（R2 + 原展开功能联动）：点开 → 高亮 + 展开；再点 → 收起 + 取消高亮
  const toggleCategoryFromList = (categoryId: string) => {
    const expanding = expandedCategoryId !== categoryId;
    setExpandedCategoryId(expanding ? categoryId : null);
    setSelectedCategoryId(expanding ? categoryId : null);
    // 震动只在「选中」这一刻给（与 SegmentedControl 同规则：取消选中不震）
    if (expanding) hapticSelection();
  };

  // R2 扇区点击命中：把触点坐标换算成「沿环的占比」，与 DonutChart 的绘制几何严格对齐。
  // 角度公式（与 DonutChart 的 <G rotate(-90 + rotation)> 同一套约定，见 DonutChart 头注释）：
  //   θ = atan2(dy, dx) —— 屏幕角度（度，y 轴向下、顺时针为正）
  //   第 0 个扇区起点 θ0 = -90 + DONUT_ROTATION_DEG
  //   沿环位置 s = ((θ - θ0) mod 360) / 360 ∈ [0,1)，再按各分类真实占比的累积区间找落点
  // 圆孔内 = 取消选中（中心回到总额）；环外一律不处理（验收退回第 5 条）
  const handleDonutTap = (x: number, y: number) => {
    if (isEmpty) return;
    const r = DONUT_SIZE / 2;
    const dx = x - r;
    const dy = y - r;
    const dist = Math.hypot(dx, dy);
    if (dist < r - DONUT_STROKE) {
      // 点圆孔：有选中就取消（中心恢复总额）；本来没选中则什么都不做
      if (selectedCategoryId) setSelectedCategoryId(null);
      return;
    }
    if (dist > r) return;
    const theta = (Math.atan2(dy, dx) * 180) / Math.PI;
    const s = ((((theta - (-90 + DONUT_ROTATION_DEG)) % 360) + 360) % 360) / 360;
    let acc = 0;
    let hitId: string | null = null;
    for (const c of categoryBreakdown) {
      const frac = c.value / periodTotal;
      if (s < acc + frac) {
        hitId = c.categoryId;
        break;
      }
      acc += frac;
    }
    if (!hitId) return;
    const willSelect = selectedCategoryId !== hitId;
    setSelectedCategoryId(willSelect ? hitId : null);
    // 震动只在「选中」这一刻给（与列表行同规则）
    if (willSelect) hapticSelection();
  };

  // 点扇区与左右滑必须共存：Race 先激活者赢 —— 水平拖过 20pt 由 Pan 接管（换期），
  // 没怎么动的点按在抬手时交给 Tap 判命中（拖动超过 Tap 的位移上限后它自然失败，不挡手势）。
  // ⚠ success=false（被 Pan 抢走 / 位移过大 / 超时）一律不判命中，免得滑一下换期顺手选中某个分类
  const donutTapGesture = Gesture.Tap()
    // 慢一点的点按（看着环想一下再点）也算点按；上限 700ms，仍远短于拖动判定
    .maxDuration(700)
    .onEnd((e, success) => {
      'worklet';
      if (!success) return;
      // 命中判定跑在 JS 线程（要用 React state 与 haptic，见 handleDonutTap）
      scheduleOnRN(handleDonutTap, e.x, e.y);
    });
  const donutAreaGesture = Gesture.Race(donutTapGesture, makeDragGesture());
  const stripGesture = makeDragGesture();

  const donutDragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value * 0.35 }],
    opacity: interpolate(Math.abs(dragX.value), [0, DRAG_ROOM], [1, 0.3]),
  }));

  // 周 / 月 / 年分段（R1）：自定义区间不在三档里 —— 补一个只显示选中态的「自定义」段，
  // 否则分段控件会把「月」错误地显示成选中（实际看的是自定义区间）
  const rangeOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = (['year', 'month', 'week'] as const).map((v) => ({
      value: v,
      label: tr(RANGE_TYPE_KEYS[v]),
    }));
    if (rangeType === 'custom') opts.push({ value: 'custom', label: tr(RANGE_TYPE_KEYS.custom) });
    return opts;
  }, [rangeType, tr]);

  // 日历面板选完后的落地：优先匹配内置周期（保留滑动/箭头切换），否则记为自定义范围
  const applySheetRange = (s: string, e: string) => {
    const monday = new Date();
    const day = monday.getDay();
    monday.setDate(monday.getDate() + ((day === 0 ? -6 : 1) - day));
    const lastWeekMon = new Date(monday);
    lastWeekMon.setDate(monday.getDate() - 7);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastYear = new Date(now.getFullYear() - 1, 0, 1);
    const trySet = (t: 'week' | 'month' | 'year', a: Date) => {
      const r = buildRange(t, a, tr);
      if (r.start === s && r.end === e) {
        setRangeType(t);
        setAnchor(a);
        return true;
      }
      return false;
    };
    if (trySet('month', now)) return;
    if (trySet('month', lastMonth)) return;
    if (trySet('year', now)) return;
    if (trySet('year', lastYear)) return;
    if (trySet('week', monday)) return;
    if (trySet('week', lastWeekMon)) return;
    setCustomRange({ start: s, end: e });
    setRangeType('custom');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        onScroll={onTabScroll ?? undefined}
        scrollEventThrottle={16}
        style={
          contentMaxWidth ? { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' } : undefined
        }
        contentContainerStyle={{ paddingTop: spacing.xs, paddingBottom: tabClearance }}
      >
        {/* R1 页头：Tab 根页大标题（日历入口移到下面周期行右侧，与大日期是同一件事） */}
        <ScreenHeader variant="root" title={tr('report.title')} />

        {/* R1 周期行：‹ 2026年10月 › 在左、日历按钮在右。箭头与左右滑共用 shiftRange；
            自定义区间时箭头不可点（shiftRange 原行为即不响应） */}
        <View style={[styles.periodRow, { paddingHorizontal: pagePadding }]}>
          <View style={styles.periodNav}>
            <IconButton
              icon="chevron-back"
              size={20}
              accessibilityLabel={tr('report.prevPeriod')}
              onPress={() => shiftRange(-1)}
              disabled={rangeType === 'custom'}
              testID="report-prev"
            />
            <AppText variant="title3" style={styles.periodLabel}>
              {range.label}
            </AppText>
            <IconButton
              icon="chevron-forward"
              size={20}
              accessibilityLabel={tr('report.nextPeriod')}
              onPress={() => shiftRange(1)}
              disabled={rangeType === 'custom'}
              testID="report-next"
            />
          </View>
          <IconButton
            icon="calendar-outline"
            size={24}
            accessibilityLabel={tr('addTx.dateSheetTitle')}
            onPress={openDatePicker}
            testID="report-calendar"
          />
        </View>

        {/* R1 + R6 两个分段控件同一行（验收退回第 3 条）：左边周期（周/月/年）、右边类型（支出/收入）；
            窄屏一行放不下时右侧整块掉到第二行（UI_RULES 第 6 节 ②） */}
        <View style={[styles.segRow, { paddingHorizontal: pagePadding }]}>
          <SegmentedControl options={rangeOptions} selected={rangeType} onSelect={handleRangeSelect} />
          <SegmentedControl
            options={[
              { value: 'expense', label: tr('report.expense') },
              { value: 'income', label: tr('report.income') },
            ]}
            selected={type}
            onSelect={(v) => setType(v as TransactionType)}
          />
        </View>

        {/* 多币种切换：这段时间里出现不止一种货币时才显示（排序与行为照旧，只换成标准 Chip） */}
        {availableCurrencies.length > 1 && (
          <View style={[styles.chipRow, { paddingHorizontal: pagePadding }]}>
            {availableCurrencies.map((code) => (
              <Chip
                key={code}
                label={code}
                selected={selectedReportCurrency === code}
                onPress={() => setSelectedReportCurrency(code)}
                accessibilityLabel={code}
              />
            ))}
          </View>
        )}

        {isEmpty ? (
          /* R5 空状态：图标 + 一句话 + 「记一笔」按钮（不再渲染灰圈 + 0.00 的饼图，也不渲染排行） */
          <View style={{ paddingHorizontal: pagePadding, marginTop: spacing.xl }}>
            <Card>
              <EmptyState
                icon="pie-chart-outline"
                title={tr(type === 'expense' ? 'report.emptyExpenseTitle' : 'report.emptyIncomeTitle')}
                description={tr('report.emptyHint')}
                actionLabel={tr('report.recordOne')}
                onAction={() => navigation.navigate(ROUTES.TAB_ADD_TX)}
                testID="report-empty"
              />
            </Card>
          </View>
        ) : (
          <>
            {/* R2 饼图卡：环 + 环心。环区上挂 Race(点按命中, 左右滑)，卡底保留 strip 的滑动换期 */}
            <Card padded={false} style={[styles.donutCard, { marginHorizontal: pagePadding }]}>
              <GestureDetector gesture={donutAreaGesture}>
                <Animated.View style={[styles.donutArea, donutDragStyle]} testID="report-donut">
                  <DonutChart
                    data={categoryBreakdown.map((c) => ({ value: c.value, color: c.color }))}
                    size={DONUT_SIZE}
                    strokeWidth={DONUT_STROKE}
                    rotation={DONUT_ROTATION_DEG}
                    selectedIndex={selectedRingIndex}
                  />
                  {/* 环心：默认 = 总支出/总收入 + 总额 + 币种；选中 = 类名 + 该类金额 + 该类占比 */}
                  <View style={styles.donutCenter} pointerEvents="none">
                    {selectedCategory ? (
                      <>
                        <AppText variant="caption" color={semantic.textSecondary} align="center" numberOfLines={2}>
                          {selectedCategory.name}
                        </AppText>
                        <MoneyText
                          value={selectedCategory.value}
                          variant="title2"
                          // 汇总数字中性色、不带正负号（方向由上面的支出/收入分段说明）；
                          // 圆孔窄（孔径 = DONUT_SIZE − 2×DONUT_STROKE = 105pt）：按档位降到 18 为止，
                          // 不用 12.3k 紧凑格式（看不出具体钱数）；读屏仍读完整金额
                          shrinkLadder={[22, 18]}
                          compactFallback={false}
                          style={styles.donutCenterValue}
                        />
                        <AppText variant="caption2" color={semantic.textSecondary} align="center">
                          {selectedSharePct.toFixed(1)}%
                        </AppText>
                      </>
                    ) : (
                      <>
                        <AppText variant="caption" color={semantic.textSecondary} align="center" numberOfLines={2}>
                          {type === 'expense' ? tr('report.totalExpense') : tr('report.totalIncome')}
                        </AppText>
                        <MoneyText
                          value={periodTotal}
                          variant="title2"
                          // 同上：汇总数字中性色、不带正负号；title2 放不下按档位降到 18，不退化紧凑格式
                          shrinkLadder={[22, 18]}
                          compactFallback={false}
                          style={styles.donutCenterValue}
                        />
                        {/* 币种代码缀在金额下方（圆孔放不下「符号 + 金额」一整串）；
                            13pt（footnote）起 —— textTertiary 只给 ≥13pt 的文字用（UI_RULES 第 1 节） */}
                        <AppText variant="footnote" color={semantic.textTertiary} align="center">
                          {selectedReportCurrency}
                        </AppText>
                      </>
                    )}
                  </View>
                </Animated.View>
              </GestureDetector>
              <GestureDetector gesture={stripGesture}>
                <View style={styles.swipeStrip} />
              </GestureDetector>
            </Card>

            {/* R3 排行列表：图标方块 + 名称 + 占比细条（类别色，图例）+ 金额（中性色）+ 百分比 1 位小数；
                选中行整行 accentSoft 底 + 标题加粗（验收退回第 4/5 条） */}
            <View style={[styles.rankList, { marginHorizontal: pagePadding }]}>
              <Card padded={false}>
                {categoryBreakdown.map((c, index) => {
                  const pct = periodTotal > 0 ? (c.value / periodTotal) * 100 : 0;
                  const expanded = expandedCategoryId === c.categoryId;
                  const items = expanded ? categoryItems(c.categoryId) : [];
                  return (
                    <View key={c.categoryId}>
                      <RankRow
                        color={c.color}
                        icon={c.icon}
                        title={c.name}
                        amount={c.value}
                        fraction={pct / 100}
                        pctText={`${pct.toFixed(1)}%`}
                        selected={selectedCategoryId === c.categoryId}
                        onPress={() => toggleCategoryFromList(c.categoryId)}
                        testID={`report-row-${c.categoryId}`}
                      />
                      {/* 组内分割线由页面插（选中行的 accentSoft 底要压住整行，所以不用 ListSection 的插线） */}
                      {index < categoryBreakdown.length - 1 && !expanded && (
                        <View style={[styles.rowSeparator, { marginHorizontal: layout.card }]} />
                      )}

                    {/* 展开明细：note 优先，其次 displayName，都没有才是占位文案（行为照旧） */}
                    {expanded && (
                      <View style={styles.detailBlock}>
                        {items.length === 0 ? (
                          <AppText variant="footnote" color={semantic.textTertiary} style={styles.detailEmpty}>
                            {tr('report.noItems')}
                          </AppText>
                        ) : (
                          items.map((t, idx) => {
                            const asset = t.assetId ? getAssetById(t.assetId) : undefined;
                            const hasNote = !!t.note?.trim();
                            const hasDisplayName = !hasNote && !!t.displayName?.trim();
                            const primaryText = hasNote
                              ? t.note!.trim()
                              : hasDisplayName
                              ? t.displayName!.trim()
                              : tr('report.noNote');
                            const isPlaceholder = !hasNote && !hasDisplayName;
                            return (
                              <View
                                key={t.id}
                                style={[styles.detailRow, idx < items.length - 1 && styles.detailRowDivider]}
                              >
                                <View style={styles.detailTextBlock}>
                                  <AppText
                                    variant="body"
                                    numberOfLines={2}
                                    color={isPlaceholder ? semantic.textTertiary : undefined}
                                    style={[styles.detailNote, isPlaceholder && styles.detailNotePlaceholder]}
                                  >
                                    {primaryText}
                                  </AppText>
                                  {/* 次要信息：日期 + 资产 */}
                                  <AppText variant="footnote" color={semantic.textSecondary} numberOfLines={1}>
                                    {formatDate(t.date, langMode)}
                                    {asset ? `  ·  ${asset.name}` : ''}
                                  </AppText>
                                </View>
                                <MoneyText
                                  value={t.amount}
                                  kind={type}
                                  variant="subhead"
                                  style={styles.detailAmount}
                                />
                              </View>
                            );
                          })
                        )}
                      </View>
                    )}
                  </View>
                );
                })}
              </Card>
            </View>
          </>
        )}
      </ScrollView>

      <DateRangePickerSheet
        visible={rangeSheetOpen}
        start={range.start}
        end={range.end}
        onClose={() => setRangeSheetOpen(false)}
        onApply={applySheetRange}
      />
    </SafeAreaView>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 字号 / 间距；几何常量只留纯图形尺寸，见文件头） */
function makeStyles(semantic: SemanticColors, spacing: Spacing, layout: Layout, radius: Radius) {
  return StyleSheet.create({
    container: { flex: 1 },
    // 周期行：‹ 日期 › 在左、日历按钮在右；窄屏放不下时按钮整块掉第二行
    periodRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      columnGap: spacing.md,
      rowGap: spacing.sm,
      marginTop: spacing.xs,
    },
    // 两个分段控件同一行：周期在左、类型在右。行间距取 spacing.sm —— 实测英文最宽组合
    // （Year/Month/Week 173 + Expense/Income 145 + 8 = 326）在 360 宽的内容区（328）里正好放得下；
    // 系统大字 / 更窄的屏幕放不下时，右侧那块整行掉到第二行（UI_RULES 第 6 节 ②）
    segRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      columnGap: spacing.sm,
      rowGap: spacing.sm,
      marginTop: spacing.sm,
    },
    periodNav: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
    // 日期标签允许换行变高（不截断、不用省略号）；宽度由内容决定，挤不到就整行换下去
    periodLabel: { flexShrink: 1, textAlign: 'center', marginHorizontal: spacing.xs },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: spacing.sm,
      rowGap: spacing.xs,
      marginTop: spacing.sm,
    },
    donutCard: { marginTop: spacing.md },
    // 环区必须与 DonutChart 同尺寸（205×205）：绘制坐标与点击命中的坐标系都从这里起算。
    // 用 minHeight（不用固定 height）：高度实际由环本身撑出，文字容器不写死高度（UI_RULES 第 4 节）
    donutArea: {
      width: DONUT_SIZE,
      minHeight: DONUT_SIZE,
      alignSelf: 'center',
      marginTop: spacing.xl,
      marginBottom: spacing.lg,
    },
    // 环心内容严格限制在圆孔内：孔径 = DONUT_SIZE − 2×DONUT_STROKE = 105pt，
    // 于是左右内边距取环宽，MoneyText 实测到的可用宽就是孔径（超长金额才会按档位降级）
    donutCenter: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: DONUT_STROKE,
    },
    donutCenterValue: { marginTop: spacing.xs },
    rankList: { marginTop: layout.section },
    // 排行列表行间发丝线（由页面插：选中行要压住整行底色）
    rowSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: semantic.hairline },
    swipeStrip: { height: 1 },
    // 展开明细：与卡片左右留白对齐；行与行之间发丝线，最后一行不画（下面是分组分割线）
    detailBlock: { paddingHorizontal: layout.card, paddingBottom: spacing.sm },
    detailEmpty: { paddingVertical: spacing.sm },
    detailRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      columnGap: spacing.sm,
      paddingVertical: spacing.sm,
    },
    detailRowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: semantic.hairline },
    detailTextBlock: { flexGrow: 1, flexShrink: 1 },
    detailNote: { marginBottom: spacing.xs },
    // 没有备注时的占位样式：斜体 + 浅色，明确区分"真实备注"和"占位提示"
    detailNotePlaceholder: { fontStyle: 'italic' },
    detailAmount: { marginLeft: spacing.sm },
  });
}
