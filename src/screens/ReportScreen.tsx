/**
 * ReportScreen —— 合并版 v2（对齐真实 theme.ts 字段）
 *
 * 本次修正：
 * 1. 收入/支出金额分栏Tab 顺序调整为「支出在前，收入在后」
 * 2. 全部替换成真实 ThemeColors 字段（之前是猜测字段，chipBg/buttonBg/buttonText/border
 *    在你的 theme.ts 里并不存在，等于 undefined，这就是"定期"弹窗在夜间模式下背景/边框
 *    消失的原因）。字段映射如下：
 *      旧(猜测)       -> 新(真实字段)
 *      colors.border  -> colors.dividerHair （细分隔线/输入框边框）
 *      colors.chipBg  -> colors.summaryCard （周期类型下拉按钮等浅色块背景）
 *      colors.buttonBg   -> colors.fabBg   （主按钮背景，和悬浮记账按钮同一套配色）
 *      colors.buttonText -> colors.fabIcon （主按钮文字色，和fabBg配对）
 * 3. 收支颜色不再用写死常量 EXPENSE_COLOR/INCOME_COLOR，
 *    改成 colors.expense / colors.income —— 因为你的 theme.ts 里这两个颜色
 *    在深色模式下本来就做了微调（更亮一点以保证对比度），写死常量会导致夜间模式下
 *    这两个颜色不跟着变亮，看起来"没反转"。
 * 4. 弹出菜单(typeSheet)的阴影颜色改用 colors.cardShadow —— 浅色模式下是淡阴影，
 *    深色模式下 theme.ts 里定义成 transparent，正好避免深色UI下出现突兀的白色光晕。
 * 5. 分类展开明细的主要信息展示优先级：note（手打备注）> displayName（记账时保存的
 *    名称，如"房租"）> "(无备注)" 占位文案。两个字段都没有才算真正
 *    "无备注"，只要 note 或 displayName 任一有值就正常加粗展示。
 * 6. 近6个月趋势柱状图已移除；日期范围/年月周选择上移到页面顶部控制条，
 *    顺序：顶栏（日期+年月周）→ 支出/收入 Tab → 币种 pill → Donut 卡 → 分类明细。
 *    年/月/周下拉点空白处自动收起。
 */

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable, Modal, TextInput, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Line as SvgLine } from 'react-native-svg';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, interpolate } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import DateRangePickerSheet from '../components/DateRangePickerSheet';
import { useDialog } from '../components/AppDialog';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { useTheme } from '../theme/useTheme';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import { ThemeColors } from '../theme/theme';
import DonutChart from '../components/DonutChart';
import { TransactionType, Transaction } from '../types';
import { UNCATEGORIZED_ICON, UNCATEGORIZED_NAME, UNCATEGORIZED_COLOR } from '../constants/uncategorized';
import PressableScale from '../components/PressableScale';
import { useT, useLanguage } from '../i18n/LanguageContext';
import { getCategoryLabel } from '../i18n/categories';
import { hapticSelection } from '../utils/haptics';


type IconName = keyof typeof Ionicons.glyphMap;
type RangeType = 'year' | 'month' | 'week' | 'custom';

// 环放大：百分比标签围绕环外缘极坐标分布（无引导线）
const DONUT_SIZE = 205;
// 粗厚环形：环宽约占半径 40%，中心留孔显示"总支出/总收入 + 金额"
const DONUT_STROKE = 50;
// 整个环的渲染角度微调（度，负=逆时针）：让扇区边界错开最挤的正上方，
// 标签角度同步加这个旋转，颜色和文字的对应关系不变
const DONUT_ROTATION_DEG = -15;

// 标签层的画布高度：环 160 + 上下各 (外推余量 16 + 文字高 ~18)
const DONUT_LABEL_BOX_H = 250;
// 百分比文字框宽度：只装文字本身（色点已拆分出去单独定位），
// 够放 "100.0%" 这种最长的情况即可。
const DONUT_LABEL_BOX_W = 36;

// 周期类型标签：在组件内用 t() 翻译（zh/en 字典 report.range*）
const RANGE_TYPE_KEYS: Record<RangeType, string> = {
  year: 'report.rangeYear',
  month: 'report.rangeMonth',
  week: 'report.rangeWeek',
  custom: 'report.rangeCustom',
};

function formatMoney(n: number) {
  return n.toFixed(2);
}

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

export default function ReportScreen() {
  const { transactions, categories, getAssetById, currency, activeLedgerId } = useApp();
  const { colors } = useTheme();
  const tr = useT();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）
  const { langMode } = useLanguage();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  const { width: winW } = useWindowDimensions();
  // 标签层画布宽度 = 屏幕宽 - ScrollView左右padding(40) - 卡片左右padding(32)，
  // 跟卡片内容区实际能用的宽度对齐——环和标签的定位坐标系都以这个宽度为准，
  // 不会再出现"按环的宽度算坐标、却按屏幕宽度去摆放"这种两套尺寸对不上的错位。
  const donutBoxW = winW - 40 - 32;
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [type, setType] = useState<TransactionType>('expense');

  const now = new Date();

  const [rangeType, setRangeType] = useState<RangeType>('month');
  const [anchor, setAnchor] = useState(now);
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null);

  const [rangeSheetOpen, setRangeSheetOpen] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  // 年/月/周下拉面板的锚定位置：实测「月 ⌄」按钮位置，紧贴其下方展开
    const typePickerBtnRef = useRef<View>(null);
  const rootRef = useRef<View>(null);
  const [typeMenuRect, setTypeMenuRect] = useState<{ top: number; right: number } | null>(null);
  const openTypePicker = () => {
    typePickerBtnRef.current?.measureInWindow((x: number, y: number, w: number, h: number) => {
      // measureInWindow 是含状态栏的窗口坐标，而浮层的 absolute 坐标系从根容器（状态栏下方）起算，
      // 所以再测一次根容器在窗口里的偏移，换算成容器内坐标，面板才能精准贴到按钮下方
      rootRef.current?.measureInWindow((_rx: number, ry: number, rw: number, _rh: number) => {
        setTypeMenuRect({
          top: y + h + 6 - ry,
          right: Math.max(10, rw - (x - _rx + w)),
        });
        setTypePickerOpen(true);
      });
    });
  };
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [customStart, setCustomStart] = useState(fmt(now));
  const [customEnd, setCustomEnd] = useState(fmt(now));

  // 点击 <2026> 这类日期label 弹出的日历选择（年/月/周三种模式复用同一个底部弹窗）
  const [yearPageStart, setYearPageStart] = useState(now.getFullYear() - 5);

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
  const donutAreaGesture = makeDragGesture();
  const stripGesture = makeDragGesture();

  const donutDragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value * 0.35 }],
    opacity: interpolate(Math.abs(dragX.value), [0, DRAG_ROOM], [1, 0.3]),
  }));

  const openDatePicker = () => {
    setRangeSheetOpen(true);
  };

  const applyCustomRange = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customStart) || !/^\d{4}-\d{2}-\d{2}$/.test(customEnd)) {
      dialog.alert({ title: tr('report.dateInvalidTitle'), message: tr('report.dateInvalidMsg') });
      return;
    }
    if (customStart > customEnd) {
      dialog.alert({ title: tr('report.dateRangeTitle'), message: tr('report.dateRangeInvalid') });
      return;
    }
    setCustomRange({ start: customStart, end: customEnd });
    setRangeType('custom');
    setCustomModalOpen(false);
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

  // 账本默认货币排最前，其余按活跃程度从高到低
  const availableCurrencies = useMemo(() => {
    const codes = Object.keys(currencyBreakdown);
    return codes.sort((a, b) => {
      if (a === currency) return -1;
      if (b === currency) return 1;
      const totalA = currencyBreakdown[a].income + currencyBreakdown[a].expense;
      const totalB = currencyBreakdown[b].income + currencyBreakdown[b].expense;
      return totalB - totalA;
    });
  }, [currencyBreakdown, currency]);

  const [selectedReportCurrency, setSelectedReportCurrency] = useState(currency);

  useEffect(() => {
    if (!availableCurrencies.includes(selectedReportCurrency)) {
      setSelectedReportCurrency(currency);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableCurrencies]);

  const typeColor = type === 'expense' ? colors.expense : colors.income;

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

  // 环上展示用：占比 >= MIN_SHOW_PCT 的分类照常显示；所有 <5% 的小分类
  // 环上渲染全部分类：不足 5% 的小分类也各自显示（不再合并成「其他」），
  // 下方分类明细列表同样逐项列出全部原始分类。
  const ringCategories = useMemo(() => categoryBreakdown, [categoryBreakdown]);

  // 分类标注：百分比必须出现在【各自扇区的外侧】——标签角度 = 扇区中点角度，
  // 不做任何沿轨道的挪动/排队（挪了标签就不再对着自己的颜色扇区）。
  // 防重叠用「半径分层」：同一扇区簇内角度太近的标签按顺序往外叠一层（+22px），
  // 层与层径向分离，视觉上不叠字；角度差够大的标签一律留在第一层（贴环外缘 26px）。
  const topCallouts = useMemo(() => {
    if (ringCategories.length === 0 || periodTotal <= 0 || donutBoxW <= 0) return [];
    const cx = donutBoxW / 2;
    const cy = DONUT_LABEL_BOX_H / 2;
    // 引导线起点用「内环边缘」而不是真正的圆心：圆孔是空的，之前从圆心出发的那一段
    // 会穿过中心的"总支出/金额"文字背后，好几条颜色的线全部汇聚在一起看着乱。
    // 改成从内环边缘起步，方向还是同一条 rad 射线（视觉上仍然是"顺着圆心方向发出"），
    // 只是不把圆孔里那段画出来。
    const INNER_RADIUS = DONUT_SIZE / 2 - DONUT_STROKE;
    const LABEL_RADIUS = DONUT_SIZE / 2 + 23; // 第一层：离环外缘 26px
    const LAYER_GAP = 1; // 第二层及以后，每层往外 +1px
    const ANGLE_MIN_DEG = 13; // 同层内两标签的最小角度差

    let cumulative = 0;
    const items = ringCategories.map((c) => {
      const fraction = c.value / periodTotal;
      const midFraction = cumulative + fraction / 2;
      cumulative += fraction;
      const raw = midFraction * 360 + DONUT_ROTATION_DEG;
      const midAngle = ((raw % 360) + 360) % 360;
      return { name: c.name, color: c.color, pct: (c.value / periodTotal) * 100, midAngle };
    });
    items.sort((a, b) => a.midAngle - b.midAngle);
    // 半径分层：按 midAngle 顺序，与前一个角度差 < 14° 的归到外一层；
    // 一旦角度差恢复正常，立即回到第一层（层号不延续）
    const layerOf = (items: { midAngle: number }[]) => {
      const layers: number[] = [];
      items.forEach((it, i) => {
        if (i === 0) {
          layers.push(0);
          return;
        }
        const gap = Math.abs(it.midAngle - items[i - 1].midAngle);
        layers.push(gap < ANGLE_MIN_DEG ? layers[i - 1] + 1 : 0);
      });
      return layers;
    };
    const layers = layerOf(items);
    if (__DEV__) {
      console.log('[Donut 标签]', items.map((it, i) => `${it.name}:${it.pct.toFixed(1)}% L${layers[i]}`).join(' | '));
    }
    return items.map((it, i) => {
      const rad = ((it.midAngle - 90) * Math.PI) / 180;
      const labelRadius = LABEL_RADIUS + layers[i] * LAYER_GAP;
      // 只用一个标量半径乘 cos/sin：任何角度下到圆心的直线距离一致
      const labelX = cx + labelRadius * Math.cos(rad);
      const labelY = cy + labelRadius * Math.sin(rad);
      // 对齐：左半圆右对齐、右半圆左对齐、正上/正下居中
      const norm = it.midAngle;
      const nearTop = norm <= 14 || norm >= 346;
      const nearBottom = norm >= 166 && norm <= 194;
      const nearVertical = nearTop || nearBottom;
      const align: 'left' | 'right' | 'center' = nearVertical ? 'center' : norm > 90 && norm < 270 ? 'right' : 'left';
      // 居中态（正上/正下）时，色点和文字不能叠在同一个点上，
      // 要靠 vSide 告诉渲染层："文字摆在色点的上方还是下方"
      const vSide: 'top' | 'bottom' = nearTop ? 'top' : 'bottom';
      // 标签框宽度收紧到实际需要的宽度（"44.4%"这种5字符文本约36px≈40，
      // 留一点缓冲给两位数百分比，比如"100.0%"）。
      // 色点和文字之间留的空隙（含色点半径3 + 间距3）
      const GUTTER = 2;
      // 回推（clamp）逻辑：文字框的锚点先按"贴着色点"算出来，再夹到
      // [2, donutBoxW-(DONUT_LABEL_BOX_W+2)] 这个区间内，保证不管色点多靠边，
      // 文字本身永远不会被推出可视区域外。
      const boxLeft =
        align === 'left' ? labelX + GUTTER
        : align === 'right' ? labelX - GUTTER - DONUT_LABEL_BOX_W
        : labelX - DONUT_LABEL_BOX_W / 2;
      const clampedLeft = Math.max(2, Math.min(boxLeft, donutBoxW - (DONUT_LABEL_BOX_W + 2)));
      // 保险检查：clampedLeft 只保证不超出屏幕，不保证还留在环外面。
      // 如果被拉回的幅度已经让标签的锚点比外半径更靠近圆心，说明这个屏幕宽度下
      // 横向空间本身就不够用了——先在开发模式打印出来，而不是让它悄悄叠进环里。
      if (__DEV__) {
        const anchorX = clampedLeft + DONUT_LABEL_BOX_W / 2;
        const distFromCenter = Math.hypot(anchorX - cx, labelY - cy);
        const outerRadius = DONUT_SIZE / 2;
        if (distFromCenter < outerRadius + 4) {
          console.warn(
            `[Donut 标签] "${it.name}" (${it.pct.toFixed(1)}%) 横向空间不够，被拉回后距圆心 ${distFromCenter.toFixed(1)}px，` +
            `已经小于环外半径 ${outerRadius}px，会看起来叠进环里。当前屏幕下 donutBoxW=${donutBoxW}，考虑缩小 DONUT_LABEL_BOX_W 或 LABEL_RADIUS。`
          );
        }
      }
      // 引导线：起点是内环边缘上同一角度的点，终点沿同一条 rad 射线走到标签落点。
      // 起点终点用的是同一套 cos/sin 公式，线本身天然是直的，不会有斜角变形问题。
      const lineX1 = cx + INNER_RADIUS * Math.cos(rad);
      const lineY1 = cy + INNER_RADIUS * Math.sin(rad);
      return {
        name: it.name,
        color: it.color,
        pct: it.pct,
        labelX,
        labelY,
        align,
        vSide,
        boxLeft: clampedLeft,
        lineX1,
        lineY1,
        // 引导线终点 = 色点圆心。色点渲染时直接钉在这个坐标上，
        // 不再用 flex 布局去"猜"色点位置——这样无论文字多长，线永远直连色点。
        lineX2: labelX,
        lineY2: labelY,
      };
    });
  }, [ringCategories, periodTotal, donutBoxW]);

  // 分类展开：点某个分类，显示这段时间里这个分类下的每一笔明细（以 note 为主要展示信息）
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);

  const categoryItems = (categoryId: string): Transaction[] =>
    rangeTransactions
      .filter(
        (t) => t.type === type && t.categoryId === categoryId && getTransactionCurrency(t) === selectedReportCurrency
      )
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));

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
    <SafeAreaView ref={rootRef} style={styles.container} edges={['top']}>

      {/* 顶部控制条：日历范围 + 年/月/周（原在 Donut 卡头部，提到页面最上方） */}
      <View style={styles.reportTopBar}>
        <PressableScale style={styles.donutRangeField} activeScale={0.97} onPress={openDatePicker}>
          <View style={styles.donutRangeFieldIcon}>
            <Ionicons name="calendar-outline" size={16} color={colors.link} />
          </View>
          <Text style={styles.donutRangeFieldText} numberOfLines={1}>{range.label}</Text>
          <Ionicons name="chevron-down" size={13} color={colors.textTertiary} />
        </PressableScale>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          ref={typePickerBtnRef}
          style={styles.typePickerBtn}
          onPress={openTypePicker}
        >
          <Text style={styles.typePickerBtnText}>{tr(RANGE_TYPE_KEYS[rangeType])}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.textTertiary} style={{ marginLeft: 2 }} />
        </TouchableOpacity>
      </View>

      {/* 年/月/周下拉：点按钮展开，点空白处自动收起（透明遮罩垫在弹层下方拦截外部点击） */}
      {typePickerOpen && (
        <TouchableOpacity
          style={styles.typeDropdownOverlay}
          activeOpacity={1}
          onPress={() => setTypePickerOpen(false)}
        />
      )}
      {typePickerOpen && (
        <View
          style={[
            styles.typeDropdown,
            {
              top: typeMenuRect?.top ?? 52,
              right: typeMenuRect?.right ?? 10,
            },
          ]}
        >
          {(['year', 'month', 'week'] as const).map((t) => (
            <PressableScale
              key={t}
              style={styles.typeSheetRow}
              activeScale={0.95}
              onPress={() => {
                setRangeType(t);
                setTypePickerOpen(false);
              }}
            >
              <Text style={[styles.typeSheetText, rangeType === t && styles.typeSheetTextActive]}>
                {tr(RANGE_TYPE_KEYS[t])}
              </Text>
              {rangeType === t && <Ionicons name="checkmark" size={16} color={colors.textPrimary} />}
            </PressableScale>
          ))}
        </View>
      )}

      {/* 收支Tab顺序：支出在前，收入在后 */}
      <View style={styles.amountTabs}>
        <Pressable
          style={({ pressed }) => [
            styles.amountBox,
            type === 'expense' && styles.amountBoxActiveExpense,
            pressed && type === 'expense' && styles.amountBoxSinkExpense,
            pressed && type !== 'expense' && styles.amountBoxSink,
          ]}
          onPress={() => setType('expense')}
        >
          <Text style={[styles.amountTabText, type === 'expense' && { color: colors.expenseOver, fontWeight: '700' }]}>
            {tr('report.expense')}
          </Text>
          {type === 'expense' && <View style={[styles.amountTabUnderline, { backgroundColor: colors.expense }]} />}
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.amountBox,
            type === 'income' && styles.amountBoxActiveIncome,
            pressed && type === 'income' && styles.amountBoxSinkIncome,
            pressed && type !== 'income' && styles.amountBoxSink,
          ]}
          onPress={() => setType('income')}
        >
          <Text style={[styles.amountTabText, type === 'income' && { color: colors.income, fontWeight: '700' }]}>
            {tr('report.income')}
          </Text>
          {type === 'income' && <View style={[styles.amountTabUnderline, { backgroundColor: colors.income }]} />}
        </Pressable>
      </View>

      {/* 多币种切换：这段时间里出现不止一种货币时才显示，放在支出/收入下方，点哪个整页就换成看哪个 */}
      {availableCurrencies.length > 1 && (
        <View style={styles.currencyChipRow}>
          {availableCurrencies.map((code) => (
            <PressableScale
              key={code}
              style={[styles.currencyChip, selectedReportCurrency === code && styles.currencyChipActive]}
              activeScale={0.92}
              onPress={() => setSelectedReportCurrency(code)}
            >
              <Text
                style={[styles.currencyChipText, selectedReportCurrency === code && styles.currencyChipTextActive]}
              >
                {code}
              </Text>
            </PressableScale>
          ))}
        </View>
      )}

      <ScrollView onScroll={onTabScroll ?? undefined} scrollEventThrottle={16} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: tabClearance }}>
      <View style={styles.donutCard}>
        <GestureDetector gesture={donutAreaGesture}>
          <Animated.View style={[styles.donutWrap, donutDragStyle, { width: donutBoxW, height: DONUT_LABEL_BOX_H }]}>
            {/* 引导线层：从内环边缘出发（不再从圆心），圆孔里那段不会被画出来，
                中心的"总支出/金额"文字背后不会再有一堆线交汇在一起 */}
            {donutBoxW > 0 && (
              <Svg
                pointerEvents="none"
                style={{ position: 'absolute', left: 0, top: 0 }}
                width={donutBoxW}
                height={DONUT_LABEL_BOX_H}
              >
                {topCallouts.map((c) => (
                  <SvgLine
                    key={`line-${c.name}`}
                    x1={c.lineX1}
                    y1={c.lineY1}
                    x2={c.lineX2}
                    y2={c.lineY2}
                    stroke={c.color}
                    strokeWidth={1}
                  />
                ))}
              </Svg>
            )}
            <View
              style={{
                position: 'absolute',
                left: (donutBoxW - DONUT_SIZE) / 2,
                top: (DONUT_LABEL_BOX_H - DONUT_SIZE) / 2,
                width: DONUT_SIZE,
                height: DONUT_SIZE,
              }}
            >
              <DonutChart
                // 环上渲染 ringCategories：大分类照常 + <5% 的合并成灰色「其他」扇区
                data={ringCategories.length ? ringCategories.map((c) => ({ value: c.value, color: c.color })) : [{ value: 1, color: colors.dividerHair }]}
                size={DONUT_SIZE}
                strokeWidth={DONUT_STROKE}
                rotation={DONUT_ROTATION_DEG}
              />
              {/* 环心：当前类别（总支出/总收入）+ 该周期总额 */}
              <View style={styles.donutCenter} pointerEvents="none">
                <Text style={styles.donutCenterLabel} numberOfLines={1} adjustsFontSizeToFit>{type === 'expense' ? tr('report.totalExpense') : tr('report.totalIncome')}</Text>
                <Text
                  style={[styles.donutCenterValue, { color: typeColor }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {selectedReportCurrency} {formatMoney(periodTotal)}
                </Text>
              </View>
            </View>
            {/* 百分比标注：颜色小圆点 + 百分比（黑/白字随主题），围绕环外缘分布。
                色点固定钉在引导线终点(lineX2, lineY2)上，文字再贴着色点摆在对应一侧——
                这样色点永远和线对齐，不会因为文字长短（"5.0%" vs "100.0%"）把色点挤偏，
                导致线看起来连到了文字而不是色点。 */}
            {topCallouts.map((c) => (
              <React.Fragment key={c.name}>
                {/* 色点：圆心 = 引导线终点 */}
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: c.lineX2 - 3,
                    top: c.lineY2 - 3,
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: c.color,
                  }}
                />
                {/* 百分比文字：位置已经在 useMemo 里算好并"回推"夹在屏幕范围内了
                    (c.boxLeft = clampedLeft)，这里只按 align 决定文字在框内贴哪一边，
                    不会再出现数字被推出可视区域的情况 */}
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: c.boxLeft,
                    width: DONUT_LABEL_BOX_W,
                    top: c.align === 'center' ? (c.vSide === 'top' ? c.lineY2 - 22 : c.lineY2 + 8) : c.lineY2 - 8,
                    alignItems: c.align === 'left' ? 'flex-start' : c.align === 'right' ? 'flex-end' : 'center',
                  }}
                >
                  <Text style={styles.calloutPct}>{c.pct.toFixed(1)}%</Text>
                </View>
              </React.Fragment>
            ))}
          </Animated.View>
        </GestureDetector>
        {/* 底部月份查看器条已移除，但左右滑切换月份的手势保留（挂在整个 Donut 卡上） */}
        <GestureDetector gesture={stripGesture}>
          <View style={styles.swipeStripInvisible} />
        </GestureDetector>
      </View>

        {/* 分类明细：显示全部分类（不过滤占比） */}
        {categoryBreakdown.map((c) => {
          const pct = periodTotal > 0 ? (c.value / periodTotal) * 100 : 0;
          const expanded = expandedCategoryId === c.categoryId;
          const items = expanded ? categoryItems(c.categoryId) : [];
          return (
            <View key={c.categoryId}>
              <PressableScale
                style={styles.breakdownRow}
                activeScale={0.97}
                onPress={() => setExpandedCategoryId(expanded ? null : c.categoryId)}
              >
                <View style={[styles.pctBadge, { backgroundColor: c.color + '22' }]}>
                  <Text style={[styles.pctBadgeText, { color: c.color }]}>{pct.toFixed(0)}%</Text>
                </View>
                <View style={[styles.breakdownIconWrap, { backgroundColor: c.color + '22' }]}>
                  <Ionicons name={c.icon} size={16} color={c.color} />
                </View>
                <Text style={styles.breakdownName}>{c.name}</Text>
<Text style={[styles.breakdownValue, { color: type === 'expense' ? colors.expenseOver : colors.income }]}>{type === 'expense' ? '-' : '+'}{formatMoney(c.value)}</Text>
                <Ionicons
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={colors.textTertiary}
                  style={{ marginLeft: 6 }}
                />
              </PressableScale>

              {expanded && (
                <View style={styles.itemList}>
                  {items.length === 0 ? (
                    <Text style={styles.itemEmpty}>{tr('report.noItems')}</Text>
                  ) : (
                    items.map((t) => {
                      const asset = t.assetId ? getAssetById(t.assetId) : undefined;
                      // 主要信息展示优先级：note（手打备注）> displayName（计划付款名称，如"房租"）> 占位文案
                      const hasNote = !!t.note?.trim();
                      const hasDisplayName = !hasNote && !!t.displayName?.trim();
                      const primaryText = hasNote
                        ? t.note!.trim()
                        : hasDisplayName
                        ? t.displayName!.trim()
                        : tr('report.noNote');
                      const isPlaceholder = !hasNote && !hasDisplayName;
                      return (
                        <View key={t.id} style={styles.itemRow}>
                          <View style={{ flex: 1, marginRight: 10 }}>
                            {/* 主要信息：note 优先，其次 displayName，都没有才是占位文案 */}
                            <Text
                              style={[styles.itemNote, isPlaceholder && styles.itemNotePlaceholder]}
                              numberOfLines={1}
                            >
                              {primaryText}
                            </Text>
                            {/* 次要信息：日期 + 资产 */}
                            <Text style={styles.itemMeta} numberOfLines={1}>
                              {t.date}{asset ? `  ·  ${asset.name}` : ''}
                            </Text>
                          </View>
                          <Text style={[styles.itemAmount, { color: type === 'expense' ? colors.expenseOver : colors.income }]}>
                            {type === 'expense' ? '-' : '+'}{formatMoney(t.amount)}
                          </Text>
                        </View>
                      );
                    })
                  )}
                </View>
              )}
            </View>
          );
        })}

      </ScrollView>


      <DateRangePickerSheet
        visible={rangeSheetOpen}
        start={range.start}
        end={range.end}
        onClose={() => setRangeSheetOpen(false)}
        onApply={applySheetRange}
      />


      {/* 点击 <2026> 这类日期label 弹出的日历选择，从手机底部滑出，年/月/周三种周期各自换一套内容 */}
    </SafeAreaView>
  );
}

// 关键：样式表要写成函数，接收 colors，返回 StyleSheet
function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1 },
    rangeSwitcher: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 4,
    },
    rangeArrow: { padding: 8 },
    rangeLabel: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
    currencyChipRow: {
      flexDirection: 'row',
      paddingHorizontal: 12,
      // 多货币 pill 出现时多留一点空隙，把下面的 Donut 卡往下推；没有 pill 时 Donut 卡
      // 只靠自身的 6px 上边距贴着支出/收入 Tab
      marginBottom: 8,
    },
    currencyChip: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 14,
      backgroundColor: colors.summaryCard,
      marginRight: 8,
    },
    currencyChipActive: { backgroundColor: colors.textPrimary },
    currencyChipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
    currencyChipTextActive: { color: colors.bg },
    amountTabs: {
      flexDirection: 'row',
      gap: 12,
      marginHorizontal: 20,
      marginTop: 6,
      marginBottom: 2,
    },
    // 立体方框：卡片底 + 柔和投影（凸起感），选中时染对应语义浅底
    amountBox: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 7,
      borderRadius: 14,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      shadowColor: colors.cardShadow,
      shadowOpacity: 1,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    amountBoxActiveExpense: { backgroundColor: colors.expense + '1A', borderColor: colors.expense + '55' },
    amountBoxActiveIncome: { backgroundColor: colors.income + '1A', borderColor: colors.income + '55' },
    // 按下下沉：位移 2px + 语义浅底 + 阴影收拢（贴回桌面）
    amountBoxSink: {
      transform: [{ translateY: 2 }],
      shadowOffset: { width: 0, height: 1 },
      shadowRadius: 3,
      elevation: 1,
    },
    amountBoxSinkExpense: { backgroundColor: colors.expense + '2E' },
    amountBoxSinkIncome: { backgroundColor: colors.income + '2E' },
    amountTabText: { fontSize: 13, color: colors.textSecondary },
    amountTabUnderline: { height: 2, width: '60%', marginTop: 4, borderRadius: 1 },
    // 顶部控制条：日历范围 + 年/月/周（原 Donut 卡头部上移至此）
    reportTopBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 6,
      paddingBottom: 4,
    },
    // 年/月/周下拉展开时垫在全屏的透明遮罩：点空白处即收起
    typeDropdownOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 19,
    },
    emptyText: { color: colors.textTertiary, marginTop: 40, textAlign: 'center' },
    donutWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 0 },
    // 环心文案：总支出/总收入 + 当前周期总额
    donutCenter: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    donutCenterLabel: { fontSize: 10, fontWeight: '600', color: colors.textTertiary },
    donutCenterValue: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
    donutCenterCode: { fontSize: 9, fontWeight: '600', color: colors.textTertiary },
    donutCard: {
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      paddingHorizontal: 16,
      paddingVertical: 24,
      marginHorizontal: 0,
      // 与支出/收入 Tab 只留 1px 空隙
      marginTop: 1,
      marginBottom: 2,
      shadowColor: colors.cardShadow,
      shadowOpacity: 1,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    typePickerBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    typePickerBtnText: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
    donutCardSwitch: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    typeDropdown: {
      position: 'absolute',
      minWidth: 120,
      backgroundColor: colors.card,
      borderRadius: 12,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      shadowColor: colors.cardShadow,
      shadowOpacity: 1,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
      zIndex: 20,
    },
    donutRangeField: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.card,
      borderRadius: 10,
      paddingHorizontal: 7,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    donutRangeFieldIcon: {
      width: 26,
      height: 26,
      borderRadius: 4,
      backgroundColor: colors.link + '14',
      alignItems: 'center',
      justifyContent: 'center',
    },
    donutRangeFieldText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    donutCardTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    ghostMonth: { position: 'absolute', top: '50%', marginTop: -9, fontSize: 13, fontWeight: '600', color: colors.textTertiary, opacity: 0.5 },
    // 底部查看器条已移除：只留一个透明手势区承接左右滑切换月份
    swipeStripInvisible: { height: 1 },
    // 环外统计样式标注：颜色圆点 + 百分比（不带分类名，名称看下方明细列表）
    // 环外百分比标注：黑色字（夜间自动变白 = textPrimary），色点标识所属扇区
    calloutPct: { fontSize: 11, fontWeight: '700', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    breakdownRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
    pctBadge: {
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 3,
      marginRight: 10,
      minWidth: 40,
      alignItems: 'center',
    },
    pctBadgeText: { fontSize: 11, fontWeight: '700' },
    breakdownIconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
    breakdownName: { flex: 1, fontSize: 14, color: colors.textPrimary, fontWeight: '700', flexShrink: 1 },
    breakdownValue: { fontSize: 14, color: colors.textPrimary, fontWeight: '700' },
    itemList: { backgroundColor: colors.card, borderRadius: 10, marginBottom: 8, paddingHorizontal: 12 },
    itemEmpty: { fontSize: 12, color: colors.textTertiary, paddingVertical: 10 },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.dividerHair,
    },
    // 主要信息：note，加粗、字号稍大，是这一行的视觉重点
    itemNote: { fontSize: 14, color: colors.textPrimary, fontWeight: '700' },
    // 没有备注时的占位样式：斜体+浅色，明确区分"真实备注"和"占位提示"
    itemNotePlaceholder: { fontStyle: 'italic', fontWeight: '400', color: colors.textTertiary },
    // 次要信息：日期 + 资产，小字浅色
    itemMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 3 },
    itemAmount: { fontSize: 13, fontWeight: '600' },
    modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
    typeSheet: {
      position: 'absolute',
      top: 90,
      right: 16,
      backgroundColor: colors.card,
      borderRadius: 12,
      paddingVertical: 4,
      minWidth: 120,
      shadowColor: colors.cardShadow,
      shadowOpacity: 1,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    typeSheetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    typeSheetText: { fontSize: 14, color: colors.textSecondary },
    typeSheetTextActive: { fontWeight: '700', color: colors.textPrimary },
    pickerSheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
      paddingBottom: 30,
    },
    pickerTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 16 },
    customRow: { flexDirection: 'row', alignItems: 'center' },
    customInput: {
      flex: 1,
      backgroundColor: colors.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      padding: 10,
      fontSize: 13,
      color: colors.textPrimary,
    },
    customSep: { marginHorizontal: 8, color: colors.textSecondary },
    applyBtn: {
      backgroundColor: colors.fabBg,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 16,
    },
    applyBtnText: { color: colors.fabIcon, fontWeight: '700', fontSize: 14 },
    // 底部日历弹窗：年/月/周三种模式共用
    pickerNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    pickerTitle2: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    pickerGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    // 年/月网格：4列3行共12格
    pickerCell: { width: '25%', paddingVertical: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
    pickerCellActive: { backgroundColor: colors.fabBg },
    pickerCellText: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
    pickerCellTextActive: { color: colors.fabIcon },
    weekdayRow: { flexDirection: 'row', marginBottom: 4 },
    weekdayText: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 12, color: colors.textTertiary, fontWeight: '600' },
    // 周模式的日期格：7列，正方形格子
    dayCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
    dayCellEmpty: { width: `${100 / 7}%`, aspectRatio: 1 },
  });
}
