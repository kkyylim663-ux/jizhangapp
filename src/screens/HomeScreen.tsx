import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import {View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, TextInput, Animated, Dimensions, Easing, Pressable, Keyboard } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';


import { useNavigation } from '@react-navigation/native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, { FadeInDown, useAnimatedScrollHandler, useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '../context/AppContext';
import { getCurrencySymbol } from '../utils/currencies';
import { useT } from '../i18n/LanguageContext';
import { getCategoryLabel } from '../i18n/categories';
import { useLanguage } from '../i18n/LanguageContext';
import { i18n } from '../i18n';
import { useTheme } from '../theme/useTheme';
import { useThemeMode } from '../context/ThemeModeContext';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler, useTabBarForceHide } from '../context/TabBarAutoHideContext';
import { ThemeColors } from '../theme/theme';
import { UNCATEGORIZED_ICON, UNCATEGORIZED_NAME, UNCATEGORIZED_COLOR } from '../constants/uncategorized';
import PressableScale from '../components/PressableScale';
import PinSheet from '../components/PinSheet';
import MonthCalendarCard, { CalendarDayTotals } from '../components/MonthCalendarCard';
import { useAppLock } from '../context/AppLockContext';
import { useDialog } from '../components/AppDialog';
import { ROUTES } from '../navigation/routes';
import { hapticLight, hapticSuccess } from '../utils/haptics';

// 首页三张卡片的入场：240ms、60ms 间隔的 stagger（30-80ms 区间内）。
// 构建器放模块作用域——写在 JSX 里会在每次渲染时重建。
// 不传自定义 easing：FadeInDown 的默认曲线就是 ease-out 族，且原生/web 都支持
// （自定义贝塞尔在布局动画里原生端会报 invalid、web 端被降级成 linear）。
const CARD_ENTER = [0, 1, 2].map((i) => FadeInDown.duration(240).delay(i * 60));

// 日期头部合计的排布阈值：任一天支出/收入 ≥10 万，整页头部才切上下排；以下一律左右排
const HEADER_STACK_THRESHOLD = 100000;

type IconName = keyof typeof Ionicons.glyphMap;

function formatMoney(n: number) {
  return n.toFixed(2);
}

function monthKeyOf(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 把 #RRGGBB 颜色调暗 amount（0~1），做图标渐变底的深端（同色系渐变，不引入新依赖） */
function shadeColor(hex: string, amount: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const r = Math.max(0, Math.min(255, Math.round(((num >> 16) & 0xff) * (1 + amount))));
  const g = Math.max(0, Math.min(255, Math.round(((num >> 8) & 0xff) * (1 + amount))));
  const b = Math.max(0, Math.min(255, Math.round((num & 0xff) * (1 + amount))));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export default function HomeScreen({ navigation }: any) {
  const {
    transactions,
    deleteTransaction,
    getCategoryById,
    currencySymbol,
    currency,
    activeLedgerId,
    setActiveLedgerId,
    ledgers,
    renameLedger,
    deleteLedger,
    budgets,
    setBudget,
    assets,
    paymentPlans,
    getAssetBalance,
    getAssetById,
  } = useApp();

  const { colors, isDark } = useTheme();
  const { setThemeMode } = useThemeMode();
  const t = useT();
  const { langMode: homeLang, setLangMode } = useLanguage();
  const insets = useSafeAreaInsets();

  const tabClearance = useTabClearance();

  const onTabScroll = useTabBarScrollHandler();
  // 内容不满一屏时也要能上滑收起 Tab 栏：量出滚动容器高度，
  // 把内容 minHeight 撑到"容器高 + 130"，保证任何情况下都有 130px 可滚距离
  const [viewportH, setViewportH] = useState(0);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // 净资产卡片的渐变色：直接读主题里为这张卡专门定义的两个端点色
  // 日间/夜间各自的配色在 theme.ts 里维护，这里只负责组装成 LinearGradient 需要的数组
  const assetGradientColors = useMemo<[string, string]>(
    () => [colors.netWorthGradientFrom, colors.netWorthGradientTo],
    [colors.netWorthGradientFrom, colors.netWorthGradientTo]
  );
  const [balanceHidden, setBalanceHidden] = useState(false);
  // 隐藏净资产持久化：退出 App 下次进来仍保留隐藏，点眼睛才恢复
  const BALANCE_HIDDEN_KEY = '@jizhang/balanceHidden';
  useEffect(() => {
    AsyncStorage.getItem(BALANCE_HIDDEN_KEY)
      .then((v) => {
        if (v === '1') setBalanceHidden(true);
      })
      .catch(() => {});
  }, []);
  const toggleBalanceHidden = () => {
    setBalanceHidden((v) => {
      const next = !v;
      AsyncStorage.setItem(BALANCE_HIDDEN_KEY, next ? '1' : '0').catch(() => {});
      return next;
    });
  };
  const [ledgerPickerOpen, setLedgerPickerOpen] = useState(false);
  // 账本选择弹窗——完全照搬「记一笔 → 账户选择弹层」的定版模式（该模式真机验证滚动+下拉收起共存无冲突）：
  // - 列表 = Reanimated.ScrollView + useAnimatedScrollHandler 把滚动偏移写进 sharedValue（UI 线程零延迟）
  // - Pan = manualActivation 挂在面板外层，判定时【列表不在顶部直接 return 不接管】→ 滚动永远优先；
  //   列表在顶部时下拖 12px 接管收起，上拖/横向永远不碰
  const ledgerPickerPanY = useSharedValue(0);
  const ledgerScrim = useSharedValue(0);
  const ledgerListOffset = useSharedValue(0);
  const ledgerListScrollHandler = useAnimatedScrollHandler((e) => {
    ledgerListOffset.value = e.contentOffset.y;
  });
  const ledgerDragStart = useSharedValue({ x: 0, y: 0 });

  // 收起：滑出屏幕后真正关闭弹窗。
  const finishLedgerClose = () => {
    setLedgerPickerOpen(false);
  };
  // 统一收起入口：✕ / 选中账本 / 点遮罩 / 列表顶部下拖超阈值
  const dismissLedgerPickerSheet = () => {
    ledgerScrim.value = withTiming(0, { duration: 150 });
    ledgerPickerPanY.value = withTiming(
      800,
      { duration: 200 },
      (finished) => {
        if (finished) runOnJS(finishLedgerClose)();
      }
    );
  };
  // 弹窗打开期间强制收起浮空 Tab 栏（覆盖层在屏幕树内，Tab 栏会盖在它上面）
  const forceHideTabBar = useTabBarForceHide();
  useEffect(() => {
    if (ledgerPickerOpen) forceHideTabBar(true);
    return () => forceHideTabBar(false);
  }, [ledgerPickerOpen, forceHideTabBar]);

  // 下拉收起手势（账户弹层同款 manualActivation）：与 Reanimated.ScrollView 是
  // 父子关系而非包裹关系，滚动偏移在 UI 线程判定——不在顶部绝不接管。
  // 手势对象必须 useMemo——每次渲染重建会让 RNGH 反复拆装手势处理器
  const ledgerPickerGesture = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((e) => {
          const touch = e.allTouches[0];
          ledgerDragStart.value = { x: touch?.absoluteX ?? 0, y: touch?.absoluteY ?? 0 };
        })
        .onTouchesMove((e, stateManager) => {
          const touch = e.allTouches[0];
          if (!touch) return;
          if (ledgerListOffset.value > 0) return; // 列表不在顶部：不接管，让它正常滚
          const dy = touch.absoluteY - ledgerDragStart.value.y;
          const dx = touch.absoluteX - ledgerDragStart.value.x;
          if (dy > 12 && Math.abs(dy) > Math.abs(dx) * 1.2) stateManager.activate();
        })
        .onUpdate((e) => {
          ledgerPickerPanY.value = Math.max(0, e.translationY);
          ledgerScrim.value = Math.min(0.4, Math.max(0, e.translationY) / 500 + 0.15);
        })
        .onEnd((e) => {
          if (e.translationY > 120 || e.velocityY > 800) {
            runOnJS(dismissLedgerPickerSheet)();
          } else {
            ledgerPickerPanY.value = withTiming(0, { duration: 180 });
            ledgerScrim.value = withTiming(0.4, { duration: 150 });
          }
        }),
    []
  );

  // 跟手位移：只动 translateY 一个属性（入场动画复用 panY）。
  // 刻意不加 scale / borderRadius / overflow 动画——含 ScrollView 的整层在 Android 上
  // 做这类属性动画会留下硬件层残影（"缠影"），纯位移则干净。
  const ledgerSheetAnimStyle = useAnimatedStyle(
    () => ({ transform: [{ translateY: ledgerPickerPanY.value }] }),
    []
  );
  // 入场：不用 Reanimated 的 entering 布局动画（它和 animated style 的 transform 同属性，
  // 挂载瞬间会打架留鬼影）——直接复用 panY：挂载时从屏幕外滑到位；panY 同时在这里复位。
  // 打开时列表滚动偏移一并清零（上次滚到中间残留会让下拉收起失灵，账户弹层同款处理）
  useEffect(() => {
    if (ledgerPickerOpen) {
      ledgerListOffset.value = 0;
      ledgerPickerPanY.value = 900;
      ledgerScrim.value = 0;
      ledgerPickerPanY.value = withTiming(0, { duration: 260 });
      ledgerScrim.value = withTiming(0.4, { duration: 260 });
    }
  }, [ledgerPickerOpen, ledgerPickerPanY, ledgerScrim, ledgerListOffset]);
  // 底层遮罩：入场淡入、收起淡出
  const ledgerScrimAnimStyle = useAnimatedStyle(
    () => ({ opacity: ledgerScrim.value }),
    []
  );
  // 账本改名：点击账本名字变成输入框（重命名中的账本 id），失焦/确认时保存
  const [renamingLedgerId, setRenamingLedgerId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<TextInput>(null);
  const startRenameLedger = (id: string, name: string) => {
    setRenamingLedgerId(id);
    setRenameValue(name);
    requestAnimationFrame(() => renameInputRef.current?.focus());
  };
  const commitRenameLedger = () => {
    if (renamingLedgerId && renameValue.trim()) {
      renameLedger(renamingLedgerId, renameValue.trim());
    }
    setRenamingLedgerId(null);
  };
  // MRU 排序：最近使用的账本排最上面（lastUsedAt 降序）；没用过的保持原数组顺序。
  // Array.prototype.sort 在现代 JS 引擎里是稳定排序，比较函数返回 0 时原顺序保留。
  const sortedLedgers = useMemo(
    () =>
      [...ledgers].sort((a, b) => {
        const at = a.lastUsedAt ?? 0;
        const bt = b.lastUsedAt ?? 0;
        if (at === bt) return 0;
        return bt - at;
      }),
    [ledgers]
  );
  const activeLedger = ledgers.find((l) => l.id === activeLedgerId);

  const now = new Date();
  const thisMonthKey = monthKeyOf(now.getFullYear(), now.getMonth());
  const todayString = todayStr();

  const ledgerTransactions = useMemo(
    () => transactions.filter((t) => t.ledgerId === activeLedgerId),
    [transactions, activeLedgerId]
  );




  // 净资产只算当前账本名下的资产——账本之间互不连通，切到"公司账本"就只看公司账本自己的钱
  const totalsByCurrency = useMemo(() => {
    const totals: Record<string, number> = {};
    assets
      .filter((a) => a.ledgerId === activeLedgerId)
      .forEach((a) => {
        totals[a.currency] = (totals[a.currency] || 0) + getAssetBalance(a.id);
      });
    return Object.entries(totals);
  }, [assets, activeLedgerId, getAssetBalance]);

  // 净资产卡显示的币种：多币种时用右上角的小按钮循环切换；默认第一种
  const [netWorthCurrencyIdx, setNetWorthCurrencyIdx] = useState(0);
  const [currencyMenuOpen, setCurrencyMenuOpen] = useState(false);
  // 货币下拉菜单：从「金额/切换货币」那一行的底缘下拉出来（浮层，不改变卡本身布局）；
  // 面板宽度与净资产卡对齐，直接盖住卡内下方的预算区
  const valueRowRef = useRef<View>(null);
  const [currencyMenuRect, setCurrencyMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const openCurrencyMenu = () => {
    if (totalsByCurrency.length <= 1) return;
    valueRowRef.current?.measureInWindow((_x: number, y: number, w: number, h: number) => {
      // 面板顶到「切换货币」行的底缘（在行下方下拉出来），左右与净资产卡对齐
      // （行在卡内 padding 20，所以 left = x - 20, width = w + 40）
      setCurrencyMenuRect({ top: y + h, left: _x - 20, width: w + 40 });
      setCurrencyMenuOpen(true);
    });
  };
  const displayTotal = totalsByCurrency.length
    ? totalsByCurrency[Math.min(netWorthCurrencyIdx, totalsByCurrency.length - 1)]
    : undefined;
  // 净资产卡当前选中的币种：本月支出合计、预算都跟随它（每个币种各设各的预算）
  const activeCurrency = displayTotal?.[0] ?? currency;
  const txCurrencyOf = (t: { assetId?: string }) =>
    (t.assetId ? getAssetById(t.assetId)?.currency : undefined) ?? currency;
  const thisExpense = useMemo(
    () =>
      ledgerTransactions
        .filter((t) => t.type === 'expense' && t.date.startsWith(thisMonthKey) && txCurrencyOf(t) === activeCurrency)
        .reduce((s, t) => s + t.amount, 0),
    [ledgerTransactions, thisMonthKey, activeCurrency, getAssetById, currency]
  );
  // 当前币种的预算：每个币种各存一条；老数据没有 currency 字段的条目跟随全局设置货币
  const totalBudget = budgets.find((b) => b.categoryId === 'total' && (b.currency ?? currency) === activeCurrency)?.amount ?? 0;

  // 账单：按天分组（倒序）展示全部账单；头部合计只算净资产卡当前选中币种，
  // 条目金额仍按各自账户币种显示（货币代码后置）
  const dayGroups = useMemo(() => {
    const activeCode = activeCurrency;
    const byDate = new Map<string, typeof ledgerTransactions>();
    ledgerTransactions.forEach((t) => {
      if (t.type === 'transfer') return;
      const list = byDate.get(t.date) ?? [];
      list.push(t);
      byDate.set(t.date, list);
    });
    return Array.from(byDate.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, allItems]) => {
        // 条目本身也只保留选中币种：该币种当天没交易就只显示日期行，不显示其他币种的记录
        const items = allItems.filter((t) => txCurrencyOf(t) === activeCode);
        const expense = items
          .filter((t) => t.type === 'expense')
          .reduce((s, t) => s + t.amount, 0);
        const income = items
          .filter((t) => t.type === 'income')
          .reduce((s, t) => s + t.amount, 0);
        // 日期行标签：中文"9/12周五"；英文没有"周"字前缀 → "9/12 Fri"（不再出现 "9/11周Fri" 的中英混排）
        const wd = t('home.weekdays').split(',')[new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))).getDay()];
        // 不再带"今天 · "前缀：日期分组标题只显示日期 + 星期
        const label =
          homeLang === 'en'
            ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} ${wd}`
            : `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}周${wd}`;
        return { date, label, expense, income, currency: activeCode, items };
      })
      // 当前币种当天没有任何交易：这一整天都不显示
      .filter((g) => g.items.length > 0);
  }, [ledgerTransactions, activeCurrency, txCurrencyOf, currency, getAssetById, todayString, homeLang]);

  // 日期头部合计的排布规则（页面级）：任一天的支出或收入 ≥10 万，整页头部切上下排；
  // 10 万以内一律左右排——避免"有的组横排有的组竖排"高矮不齐
  const headerStacked = dayGroups.some(
    (g) => g.expense >= HEADER_STACK_THRESHOLD || g.income >= HEADER_STACK_THRESHOLD
  );

  // 视图切换时把长列表滚回顶部用（只读调用 scrollTo，不影响既有滚动行为）
  const scrollRef = useRef<ScrollView>(null);
  // 日历视图（详情 ⇄ 日历切换，HTML 原型拍板形态）──
  // 只在日历模式消费 dayGroups 派生数据，账单列表及其全部逻辑零改动。
  // viewMonth 独立记忆：切回详情再进来月份不重置
  const [viewMode, setViewMode] = useState<'detail' | 'calendar'>('detail');
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  // 日历数据源：dayGroups 已按日聚合好（同币种过滤、排除转账），摊平成 Map 给日历卡
  const calendarDays = useMemo(() => {
    const map = new Map<string, CalendarDayTotals>();
    dayGroups.forEach((g) =>
      map.set(g.date, {
        expense: g.expense,
        income: g.income,
        // 逐笔明细（点日期展开）：标题拼接与账单列表完全同款——类别 · 计划名/备注
        items: g.items.map((item) => {
          const cat = getCategoryById(item.categoryId);
          const catName = cat ? getCategoryLabel(cat, t) : UNCATEGORIZED_NAME;
          const extra = item.note?.trim() || item.displayName?.trim() || '';
          return {
            id: item.id,
            title: extra ? `${catName} · ${extra}` : catName,
            amount: item.amount,
            type: item.type as 'expense' | 'income',
          };
        }),
      })
    );
    return map;
    // ⚠ t 是全局稳定引用，依赖必须带 langMode，切语言明细标题才会重算
  }, [dayGroups, getCategoryById, t, homeLang]);
  // 当月合计：只加总 viewMonth 当月的日子（dayGroups 含跨月历史，需按月份前缀过滤）
  const calendarMonthTotals = useMemo(() => {
    const prefix = `${viewMonth.year}-${String(viewMonth.month).padStart(2, '0')}-`;
    let expense = 0;
    let income = 0;
    dayGroups.forEach((g) => {
      if (!g.date.startsWith(prefix)) return;
      expense += g.expense;
      income += g.income;
    });
    return { expense, income };
  }, [dayGroups, viewMonth]);
  const shiftCalendarMonth = (dir: number) => {
    setViewMonth((vm) => {
      let month = vm.month + dir;
      let year = vm.year;
      if (month > 12) { month = 1; year++; }
      if (month < 1) { month = 12; year--; }
      return { year, month };
    });
  };

  // 每个账本各自的资产合计（按币种），给快速切换账本弹窗用——同一套逻辑，跟 LedgerScreen 的账本列表保持一致
  const ledgerTotals = useMemo(() => {
    const map: Record<string, [string, number][]> = {};
    ledgers.forEach((l) => {
      const totals: Record<string, number> = {};
      assets
        .filter((a) => a.ledgerId === l.id)
        .forEach((a) => {
          totals[a.currency] = (totals[a.currency] || 0) + getAssetBalance(a.id);
        });
      map[l.id] = Object.entries(totals);
    });
    return map;
  }, [ledgers, assets, getAssetBalance]);

  // ── 删除账本（二级密码确认）──
  // 待删除账本（点了删除并确认后进入 PIN 验证；PIN 通过才真正删除）
  const { hasPin } = useAppLock();
  const dialog = useDialog();
  const [pendingDeleteLedgerId, setPendingDeleteLedgerId] = useState<string | null>(null);
  const [pinSheetOpen, setPinSheetOpen] = useState(false);
  const pendingDeleteLedger = ledgers.find((l) => l.id === pendingDeleteLedgerId);
  // PIN 弹层模式：已设 PIN → verify 验证一次即删；未设 → create 设置（两遍输入）后
  // 切到 verify 再输一次刚设置的 PIN（确认是本人在操作），通过才删——用户定版：
  // 删除流程 PIN 只需要「输入一次验证」；首次设置的两遍输入属于"设置确认"不算验证
  const [pinSheetMode, setPinSheetMode] = useState<'verify' | 'create'>('verify');
  // create 完成后是否要接着做一次 verify（首次删除引导设置 PIN 的场景）
  const [pinVerifyAfterCreate, setPinVerifyAfterCreate] = useState(false);
  // 抑制标记：create→verify 切换时 PinSheet 内部 finishCreate 会尾随调 onClose()，
  // 这里消费掉这次"程序性关闭"，让弹层保持打开进入 verify 阶段（Verify Agent P0-1）
  const pinCreateSwitchingRef = useRef(false);
  // 删除入口：主题化弹窗展示级联范围（用户定版：连同数据一律删除），确认后弹 PIN 键盘。
  // 注意：不调生物识别——删除只认 6 位 PIN（用户定版规则）。默认账本也可删；
  // 最后一个账本不可删（至少保留一个）。
  const requestDeleteLedger = (l: { id: string; name: string }) => {
    if (ledgers.length <= 1) {
      dialog.alert({ title: t('home.deleteLedgerLastTitle'), message: t('home.deleteLedgerLastMsg') });
      return;
    }
    const txCount = transactions.filter((x) => x.ledgerId === l.id).length;
    const assetCount = assets.filter((x) => x.ledgerId === l.id).length;
    const planCount = paymentPlans.filter((x) => x.ledgerId === l.id).length;
    const hasData = txCount > 0 || assetCount > 0 || planCount > 0;
    const msg = hasData
      ? t('home.deleteLedgerMsg', { name: l.name, tx: txCount, assets: assetCount, plans: planCount })
      : t('home.deleteLedgerEmptyMsg', { name: l.name });
    dialog.alert({
      title: t('home.deleteLedger'),
      message: msg,
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('home.deleteLedgerConfirm'),
          style: 'destructive',
          onPress: () => {
            setPendingDeleteLedgerId(l.id);
            if (hasPin) {
              // 已设 PIN：验证一次即删
              setPinVerifyAfterCreate(false);
              setPinSheetMode('verify');
            } else {
              // 未设 PIN：先引导设置（两遍输入），完成后再验证一次才删
              setPinVerifyAfterCreate(true);
              setPinSheetMode('create');
            }
            setPinSheetOpen(true);
          },
        },
      ],
    });
  };
  // 二级密码验证通过：执行级联删除（context 内同时清交易/资产/计划并回落 activeLedgerId）
  // 成功震动已在 PinSheet verify 通过时触发，这里不再重复
  const performLedgerDelete = async () => {
    if (!pendingDeleteLedgerId) return;
    const name = pendingDeleteLedger?.name ?? '';
    await deleteLedger(pendingDeleteLedgerId);
    setPendingDeleteLedgerId(null);
    if (name) dialog.alert({ title: t('home.deleteLedger'), message: t('home.deleteLedgerDone') });
  };
  // PinSheet create 模式完成（PIN 已设置）：若本轮是"未设 PIN 首次删除"流程，
  // 切到 verify 再输一次刚设置的 PIN；否则（不会发生在这里，设置入口在 ProfileScreen）直接关
  const handlePinCreateDone = () => {
    if (pinVerifyAfterCreate) {
      setPinVerifyAfterCreate(false);
      // 消费 PinSheet finishCreate 尾随触发的 onClose：这次关闭是程序性的，跳过
      pinCreateSwitchingRef.current = true;
      setPinSheetMode('verify');
      // PinSheet 的 [visible, mode] 重置 effect 会清空输入状态，弹层保持打开
    } else {
      setPinSheetOpen(false);
      setPendingDeleteLedgerId(null);
    }
  };

  // ---------- 预算：常驻细长条，点击弹窗直接改，不需要跳转设置页 ----------
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [budgetInput, setBudgetInput] = useState(totalBudget ? String(totalBudget) : '');

  const openBudgetModal = () => {
    setBudgetInput(totalBudget ? String(totalBudget) : '');
    setBudgetModalOpen(true);
  };
  // 保存当前选中币种的预算；0/留空 = 清掉这个币种的限制
  const saveBudget = () => {
    const value = parseFloat(budgetInput);
    setBudget('total', !isNaN(value) && value > 0 ? value : 0, activeCurrency);
    setBudgetModalOpen(false);
    hapticSuccess();
  };

  const budgetPct = totalBudget > 0 ? Math.min((thisExpense / totalBudget) * 100, 100) : 0;
  const budgetOver = totalBudget > 0 && thisExpense > totalBudget;

  // 预算进度条：宽度变化 300ms 补间（目的：state indication）。
  // withTiming 默认的 in-out 曲线正适合屏上的状态变化，且原生/web 都支持。
  // fill 是 overflow:hidden 轨道里无子元素的绝对定位元素——animate-expo skill
  // 里唯一放行的 width 动画，圆角不会被 scaleX 拉糊。
  const budgetProgress = useSharedValue(0);
  useEffect(() => {
    budgetProgress.set(withTiming(budgetPct, { duration: 300 }));
  }, [budgetPct, budgetProgress]);
  const budgetFillAnimStyle = useAnimatedStyle(
    () => ({ width: `${budgetProgress.get()}%` }),
    // web 端没有 Babel worklets 插件，useAnimatedStyle 必须显式传依赖数组
    [budgetProgress]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}
    >
      {/* 底部悬空区由 App.tsx 的 TabShell 统一预留（96+安全区），这里只留一点呼吸感 */}
      {/* RNW 的 ScrollView 会占用内容容器的 onLayout（转成 onContentSizeChange），
          所以高度测量放在外层普通 View 上，原生/web 都可靠 */}
      <View style={{ flex: 1 }} onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}>
      <ScrollView
        ref={scrollRef}
        onScroll={onTabScroll ?? undefined}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: tabClearance, minHeight: viewportH ? viewportH + 130 : undefined }}
      >
                <View style={styles.headerRow}>
          {/* 左侧:通知铃铛(从右侧移过来,做成圆框按钮) */}
          <View style={styles.headerSide}>
            <PressableScale
              onPress={() => dialog.alert({ title: t('home.notificationTitle'), message: t('home.notificationMsg') })}
              style={styles.headerIconBtnLeft}
              activeScale={0.88}
              hitSlop={{ top: 8, bottom: 8, left: -4, right: 8 }}
            >
              <View style={styles.headerCircleBtn}>
                <Ionicons name="notifications-outline" size={22} color={colors.icon} />
              </View>
            </PressableScale>
            {/* 选择账本按钮:从居中移到左侧、紧贴通知铃铛(用户要求 2026-09-23) */}
            <PressableScale style={styles.headerLedgerBtn} onPress={() => setLedgerPickerOpen(true)} activeScale={0.92}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {activeLedger?.name ?? t('home.ledgerName')}
              </Text>
              <Ionicons name="chevron-down" size={15} color={colors.icon} style={{ marginLeft: 5 }} />
            </PressableScale>
          </View>
          <View style={styles.headerSideRight}>
            {/* 语言状态按钮:显示当前语言(中/EN),点击在中文/English 间切换 */}
            <PressableScale
              onPress={() => {
                hapticLight();
                const isZh = i18n.locale.startsWith('zh');
                setLangMode(isZh ? 'en' : 'zh');
              }}
              style={styles.langChip}
              activeScale={0.88}
              hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            >
              <Text style={styles.langChipText}>{i18n.locale.startsWith('zh') ? '中' : 'EN'}</Text>
            </PressableScale>
            {/* 日/夜切换按钮:图标显示当前模式(太阳=日间、月亮=夜间),保持在最右侧 */}
            <PressableScale
              onPress={() => {
                hapticLight();
                setThemeMode(isDark ? 'light' : 'dark');
              }}
              style={styles.headerIconBtn}
              activeScale={0.88}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 2 }}
            >
              <View style={styles.headerCircleBtn}>
                <Ionicons name={isDark ? 'moon' : 'sunny'} size={22} color={colors.icon} />
              </View>
            </PressableScale>
            {/* 详情/日历视图切换按钮（原型拍板形态）：图标随模式切换 日历⇄列表 */}
            <PressableScale
              onPress={() => {
                hapticLight();
                setViewMode((m) => (m === 'detail' ? 'calendar' : 'detail'));
                // 切到日历（卡片矮）或切回详情（列表长）时滚回顶部，
                // 避免长列表滚动位置残留导致切换后看不到卡片头部
                scrollRef.current?.scrollTo({ y: 0, animated: false });
              }}
              style={styles.headerIconBtn}
              activeScale={0.88}
              hitSlop={{ top: 8, bottom: 8, left: 2, right: -4 }}
            >
              <View style={styles.headerCircleBtn}>
                <Ionicons name={viewMode === 'detail' ? 'calendar-outline' : 'list-outline'} size={20} color={colors.icon} />
              </View>
            </PressableScale>
          </View>
        </View>

        {/* 净资产 —— 全屏唯一的主角卡：渐变只留给它，正文卡片一律扁平 */}
        <Reanimated.View entering={CARD_ENTER[0]}>
          <View style={styles.assetCardShadow}>
            <LinearGradient
              colors={assetGradientColors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.assetCard}
            >
              <View style={styles.assetCardTopRow}>
                <Text style={styles.assetCardLabel}>{t('home.netWorth')}</Text>
                <PressableScale
                  onPress={toggleBalanceHidden}
                  style={styles.eyeBtn}
                  activeScale={0.88}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <Ionicons name={balanceHidden ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.netWorthAccent} />
                </PressableScale>
              </View>
              {totalsByCurrency.length === 0 ? (
                <View style={styles.assetCardEmptyWrap}>
                  <Text style={styles.assetCardEmptyTitle}>{t('home.noAssetsTitle')}</Text>
                  <Text style={styles.assetCardEmptyHint}>{t('home.noAssetsHint')}</Text>
                </View>
              ) : (
                /* 多币种时：金额到切换图标整行都是点击区，调出货币下拉菜单；单币种不可点。
                   图标仍保留在行右端原位（space-between 布局） */
<TouchableOpacity
    ref={valueRowRef}
    disabled={totalsByCurrency.length <= 1}
    onPress={openCurrencyMenu}
    style={styles.assetCardValueRow}
  >
                  {displayTotal && (
                    <View style={styles.assetValueCol}>
                      <Text style={styles.assetCardCode}>{displayTotal[0]}</Text>
                      <Text
                        style={styles.assetCardValue}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        // 标准：整数部分最多 14 位（不含小数点）。缩字下限 0.35（36px → 12.6px）
                        // 保证 14 位大额也能完整显示；平时仍是 36px 大字，只有超长时才稍微缩小
                        minimumFontScale={0.35}
                      >
                        {balanceHidden ? '***' : formatMoney(displayTotal[1])}
                      </Text>
                    </View>
                  )}
                  {totalsByCurrency.length > 1 && (
                    /* 切换图标保留眼睛按钮的实体感：半透明圆底 + 同尺寸，多币种时点击弹菜单 */
                    <View style={styles.eyeBtn}>
                      <Ionicons name="swap-vertical" size={20} color={colors.netWorthAccent} />
                    </View>
                  )}
                </TouchableOpacity>
              )}
              {/* 本月预算进度条：放进净资产卡底部；可点区域从进度条(Track Bar)开始，
                  上面的标签行不可点——避免点切换货币时误触弹窗 */}
              {totalBudget > 0 && (
                <View style={styles.assetCardBudgetTop}>
                  <Text style={styles.assetCardBudgetLabel}>{t('home.budgetLabel')}</Text>
                  <Text style={styles.assetCardBudgetValue}>
                    {balanceHidden ? '***' : formatMoney(thisExpense)}
                    <Text style={styles.assetCardBudgetDim}>
                      {' / '}
                      {balanceHidden ? '***' : formatMoney(totalBudget)}
                    </Text>
                  </Text>
                </View>
              )}
              <PressableScale onPress={openBudgetModal} activeScale={0.97}>
                {totalBudget > 0 ? (
                  <>
                    <View style={styles.assetCardBudgetTrack}>
                      <Reanimated.View
                        style={[
                          styles.assetCardBudgetFill,
                          budgetFillAnimStyle,
                          { backgroundColor: budgetOver ? colors.expenseOver : colors.netWorthAccent },
                        ]}
                      />
                    </View>
                    <Text style={[styles.assetCardBudgetDim, { marginTop: 4 }]}>
                      {budgetOver
                        ? t('home.budgetOver', { amount: formatMoney(thisExpense - totalBudget) })
                        : t('home.budgetLeft', { amount: formatMoney(totalBudget - thisExpense) })}
                    </Text>
                  </>
                ) : (
                  <View style={styles.assetCardBudgetEmptyRow}>
                    <View style={styles.assetCardBudgetEmptyIcon}>
                      <Ionicons name="add" size={12} color={colors.netWorthAccent} />
                    </View>
                    <Text style={styles.assetCardBudgetEmptyText}>{t('home.setBudget')}</Text>
                  </View>
                )}
              </PressableScale>
            </LinearGradient>
          </View>
        </Reanimated.View>
        {/* 日历视图卡：detail 模式整卡隐藏（display:none 保树，切回不重挂不重算）；
            entering 渐显只在 detail→calendar 切换瞬间播一次 */}
        {viewMode === 'calendar' && (
          <Reanimated.View entering={FadeInDown.duration(240)} style={viewMode === 'calendar' ? undefined : { display: 'none' }}>
            <View style={styles.sectionCardShadow}>
              <View style={styles.sectionCard}>
                <MonthCalendarCard
                  year={viewMonth.year}
                  month={viewMonth.month}
                  days={calendarDays}
                  monthExpense={calendarMonthTotals.expense}
                  monthIncome={calendarMonthTotals.income}
                  onPrevMonth={() => shiftCalendarMonth(-1)}
                  onNextMonth={() => shiftCalendarMonth(1)}
                />
              </View>
            </View>
          </Reanimated.View>
        )}
        {/* 账单：按天分组全部展示，日期行纯展示（无展开/收起）。
            calendar 模式用 display:none 整卡隐藏（保树不重挂，列表滚动状态/渲染结果全保留），
            JSX 与全部逻辑零改动 */}
        <Reanimated.View entering={CARD_ENTER[1]} style={viewMode === 'calendar' ? { display: 'none' } : undefined}>
          <View style={styles.sectionCardShadow}>
            <View style={styles.sectionCard}>
              {dayGroups.length === 0 ? (
                <View style={styles.emptyWrap}>
<View style={styles.emptyIconWrap}>
        <Ionicons name="receipt-outline" size={28} color={colors.textTertiary} />
      </View>
                  <Text style={styles.emptyText}>{t('home.noTx')}</Text>
                  <Text style={styles.emptyHint}>{t('home.noTxHint')}</Text>
                </View>
              ) : (
                dayGroups.map((group) => {
                  return (
                    <View key={group.date} style={styles.dayGroup}>
                      <View style={[styles.dayHeaderRow, headerStacked && styles.dayHeaderRowStacked]}>
                        <Text style={styles.dayHeaderText} numberOfLines={1}>{group.label}</Text>
                        {/* 支出/收入合计排布规则：页面上出现任一 ≥10 万的金额才整页切上下排；
                            10 万以内一律左右排。全部固定 14 号不缩字（adjustsFontSizeToFit 在
                            Android 弹性容器里宽度测量失准，会把 50.00 那种小数值缩成蚂蚁字） */}
                        <View style={[styles.dayHeaderTotals, headerStacked && styles.dayHeaderTotalsStacked]}>
                          {group.expense > 0 && (
                            <Text style={styles.dayHeaderExpense} numberOfLines={1}>
                              {t('home.expenseShort')}{formatMoney(group.expense)}
                            </Text>
                          )}
                          {group.income > 0 && (
                            <Text style={[styles.dayHeaderIncome, { color: colors.income }]} numberOfLines={1}>
                              {t('home.incomeShort')}{formatMoney(group.income)}
                            </Text>
                          )}
                        </View>
                      </View>
                      {group.items.map((item) => {
                          const cat = getCategoryById(item.categoryId);
                          // 显示优先级：类别名永远显示（含自动月结的账单——它们的 displayName 是计划名，
                          // 之前被 ?? 短路把类别整个顶掉，导致"财务规划记的账在 Home 不显示类别"）；
                          // 计划名/备注作为后半段拼接：类别 · 计划名 / 类别 · 备注
                          const catName = cat ? getCategoryLabel(cat, t) : UNCATEGORIZED_NAME;
                          const extra = item.note?.trim() || item.displayName?.trim() || '';
                          const categoryText = extra ? `${catName} · ${extra}` : catName;
                          return (
                            // 删除入口已移到编辑页右上角的垃圾桶按钮，账单行不再支持滑动删除
                            <Pressable
                              key={item.id}
                              style={styles.todayRow}
                              // 编辑改为长按 0.2 秒（真机震动提示）进入；不用 PressableScale——
                              // 它一碰就播缩放动画，看起来像"要点进编辑/删除"，误导手势意图
                              onLongPress={() => {
                                hapticLight();
                                navigation.navigate(ROUTES.ADD_TX, { editTransaction: item });
                              }}
                              delayLongPress={200}
                            >
                                {/* 左栏 = 类别 · 计划名/备注（合并、靠左、弹性截断——把宽度让给金额）；
                                    金额栏 flexShrink:0 固定字号永不压缩，始终完整显示 */}
                                <Text style={[styles.billTitleText, { color: colors.textPrimary }]} numberOfLines={1}>
                                  {categoryText}
                                </Text>
                                <Text
                                  style={[
                                    styles.billAmountCol,
                                    { color: item.type === 'expense' ? colors.expense : colors.income },
                                  ]}
                                  numberOfLines={1}
                                  adjustsFontSizeToFit
                                  minimumFontScale={0.7}
                                >
                                  {item.type === 'expense' ? '-' : '+'}
                                  {formatMoney(item.amount)}
                                </Text>
                            </Pressable>
                          );
                        })}
                    </View>
                  );
                })
              )}
            </View>
          </View>
        </Reanimated.View>
      </ScrollView>
</View>

      {/* 多账本切换：树内全屏覆盖层。不用 RN Modal——它是独立原生窗口，
          Reanimated 的 UI 线程动画在里面（Android）会渲染出第二份幽灵副本（两份重影的根源）。
          同一窗口渲染后物理上只有一个副本；打开期间浮空 Tab 栏被强制收起，不会盖在弹窗上。
          手势结构照搬「记一笔 → 账户选择弹层」定版模式：
          遮罩点击关闭 + Pan 挂面板外层（列表在顶部时下拖收起，否则让列表滚） */}
      {ledgerPickerOpen && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 100, elevation: 100, top: -insets.top }]}>
          {/* 底层遮罩：位于弹窗卡片之下、首页之上（入场淡入、收起淡出），点击关闭 */}
          <Pressable style={StyleSheet.absoluteFill} onPress={dismissLedgerPickerSheet}>
            <Reanimated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, ledgerScrimAnimStyle]} />
          </Pressable>
          {/* 手势挂在面板外层（账户弹层同款）：面板内 Reanimated.ScrollView 正常滚动，
              列表在顶部时下拖由 Pan 接管收起 */}
          <GestureDetector gesture={ledgerPickerGesture}>
          <Reanimated.View style={[styles.ledgerPickerSheet, ledgerSheetAnimStyle]}>
          {/* 把手条（账户弹层同款视觉），面板打开时它就是永远可拖的收起区 */}
          <View style={styles.ledgerPickerGrabber} pointerEvents="none" />
          <SafeAreaView style={styles.ledgerPickerScreen} edges={['bottom']}>
          <View style={{ flex: 1 }}>
          <View style={styles.ledgerPickerHeader}>
            <PressableScale
              onPress={dismissLedgerPickerSheet}
              activeScale={0.90}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={24} color={colors.icon} />
            </PressableScale>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={styles.ledgerPickerTitle}>{t('home.selectLedger')}</Text>
            </View>
            {/* 右侧齿轮入口及其跳转设置页的逻辑已移除;用同宽占位 View 保持标题居中 */}
            <View style={{ width: 24 }} />
          </View>

          <Reanimated.ScrollView
            // flex:1 约束在标题栏与底栏之间的剩余空间里——不约束的话 ScrollView 会按
            // 内容自然长高，账本一多整个菜单就超出屏幕、底部按钮被顶出去。
            // Reanimated.ScrollView + scrollHandler：滚动偏移进 shared value，
            // Pan 的 manualActivation 判定在 UI 线程实时读到（账户弹层定版方案）
            onScroll={ledgerListScrollHandler}
            scrollEventThrottle={16}
            style={{ flex: 1 }}
            contentContainerStyle={styles.ledgerPickerListContent}
            showsVerticalScrollIndicator={false}
          >
            {sortedLedgers.map((l) => {
              const active = l.id === activeLedgerId;
              const totals = ledgerTotals[l.id] ?? [];
              const isDefault = l.id === 'default';
              // 图标渐变底跟随创建时选的颜色（用户定版：选了绿色就显示绿色渐变）。
              // 兜底用 #4C9AFF（与 addLedger/默认账本一致）——旧数据无 color 时显示蓝
              // 而非紫，避免和"写死紫色"的旧行为混淆难以排查（Verify Agent 建议）
              const base = l.color ?? '#4C9AFF';
              const iconFrom = base;
              const iconTo = shadeColor(base, isDefault ? -0.28 : -0.42);
              return (
                <LedgerCardInner
                  key={l.id}
                  l={l}
                  active={active}
                  isDefault={isDefault}
                  totals={totals}
                  iconFrom={iconFrom}
                  iconTo={iconTo}
                  renamingLedgerId={renamingLedgerId}
                  renameValue={renameValue}
                  renameInputRef={renameInputRef}
                  setRenameValue={setRenameValue}
                  commitRenameLedger={commitRenameLedger}
                  startRenameLedger={startRenameLedger}
                  onCardPress={() => {
                    hapticLight();
                    setActiveLedgerId(l.id);
                    dismissLedgerPickerSheet();
                  }}
                  onEditPress={() => startRenameLedger(l.id, l.name)}
                  onDeletePress={() => requestDeleteLedger(l)}
                  styles={styles}
                  colors={colors}
                  t={t}
                />
              );
            })}
          </Reanimated.ScrollView>

          <View style={styles.ledgerPickerFooter}>
            <LinearGradient
              colors={[colors.fabHighlight, colors.fabBg, colors.fabShadow]}
              locations={[0, 0.55, 1]}
              start={{ x: 0.3, y: 0 }}
              end={{ x: 0.7, y: 1 }}
              style={styles.ledgerPickerAddBtn}
            >
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                onPress={() => {
                  dismissLedgerPickerSheet();
                  navigation.navigate(ROUTES.LEDGER);
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('home.addLedger')}
              />
              <View style={styles.ledgerPickerAddBtnInner} pointerEvents="none">
                <Ionicons name="add" size={18} color={colors.fabIcon} />
                <Text style={styles.ledgerPickerAddBtnText}>{t('home.addLedger')}</Text>
              </View>
            </LinearGradient>
          </View>
          </View>
        </SafeAreaView>
          </Reanimated.View>
          </GestureDetector>
        </View>
      )}

      {/* 预算调整弹窗 */}
      <Modal
        visible={budgetModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBudgetModalOpen(false)}
      >
        <TouchableOpacity
          style={styles.ledgerModalOverlay}
          activeOpacity={1}
          onPress={() => setBudgetModalOpen(false)}
        >
          <View style={styles.ledgerModalCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.ledgerModalTitle}>{t('home.budgetModalTitle', { cur: activeCurrency })}</Text>
            <TextInput
              style={styles.modalInput}
              value={budgetInput}
              onChangeText={setBudgetInput}
              keyboardType="decimal-pad"
              placeholder={t('home.budgetPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
            <PressableScale style={styles.modalSaveBtn} onPress={saveBudget} activeScale={0.98}>
              <Text style={styles.modalSaveBtnText}>{t('common.save')}</Text>
            </PressableScale>
          </View>
        </TouchableOpacity>
      </Modal>
      {/* 货币直选下拉：不用独立 Modal，直接渲染在页面顶层——
          面板从「金额/切换货币」行的底缘下拉出来（与卡同渐变、无顶圆角，像卡的一部分），
          可以盖住卡内的预算区；半透明遮罩压暗背景，点空白处关闭 */}
      {currencyMenuOpen && (
        <View style={StyleSheet.absoluteFill}>
          <TouchableOpacity style={styles.currencyMenuOverlay} activeOpacity={1} onPress={() => setCurrencyMenuOpen(false)}>
            <View />
          </TouchableOpacity>
          <LinearGradient
            colors={assetGradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.currencyMenuPanel,
              {
                top: currencyMenuRect?.top ?? 160,
                left: currencyMenuRect?.left ?? 16,
                width: currencyMenuRect?.width ?? '100%',
              },
            ]}
          >
            <Text style={styles.currencyMenuTitle}>{t('home.selectCurrency')}</Text>
            {totalsByCurrency.map(([code], idx) => {
              const active = idx === Math.min(netWorthCurrencyIdx, totalsByCurrency.length - 1);
              return (
                <PressableScale
                  key={code}
                  style={[styles.currencyMenuItem, active && { backgroundColor: 'rgba(255,255,255,0.14)' }]}
                  activeScale={0.95}
                  onPress={() => {
                    setNetWorthCurrencyIdx(idx);
                    setCurrencyMenuOpen(false);
                  }}
                >
                  <Text style={[styles.currencyMenuItemText, active && { color: colors.netWorthAccent, fontWeight: '700' }]}>{code}</Text>
                  {active && <Ionicons name="checkmark" size={18} color={colors.netWorthAccent} />}
                </PressableScale>
              );
            })}
          </LinearGradient>
        </View>
      )}

      {/* 删除账本的二级密码验证：只认 6 位 PIN（用户定版：指纹/扫脸不参与删除验证）。
          已设 PIN → verify 验证一次即删；未设 → create 设置完再 verify 一次（确认本人）。
          放在账本弹层之外——验证时账本弹层可能已被关闭 */}
      <PinSheet
        visible={pinSheetOpen}
        mode={pinSheetMode}
        onClose={() => {
          // create→verify 切换瞬间 PinSheet 会尾随触发一次程序性 onClose，跳过它
          if (pinCreateSwitchingRef.current) {
            pinCreateSwitchingRef.current = false;
            return;
          }
          setPinSheetOpen(false);
          setPendingDeleteLedgerId(null);
        }}
        onSuccess={() => {
          if (pinSheetMode === 'create') {
            handlePinCreateDone();
          } else {
            setPinSheetOpen(false);
            void performLedgerDelete();
          }
        }}
      />
    </SafeAreaView>
  );
}

// 账本卡片内容（弹层列表共用）：渐变图标 + 名称/副标题 + 右上角编辑/删除钮 + 单选圈 + 结余区。
// 选中态的渐变描边由外层（LinearGradient 包裹）承担；本组件只负责卡面本身。
type LedgerCardInnerProps = {
  l: { id: string; name: string; icon: string; createdAt: number };
  active: boolean;
  isDefault: boolean;
  totals: [string, number][];
  iconFrom: string;
  iconTo: string;
  renamingLedgerId: string | null;
  renameValue: string;
  renameInputRef: React.RefObject<TextInput | null>;
  setRenameValue: (v: string) => void;
  commitRenameLedger: () => void;
  startRenameLedger: (id: string, name: string) => void;
  onCardPress: () => void;
  onEditPress: () => void;
  onDeletePress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  t: (key: string, params?: Record<string, string | number>) => string;
};

function LedgerCardInner({
  l,
  active,
  isDefault,
  totals,
  iconFrom,
  iconTo,
  renamingLedgerId,
  renameValue,
  renameInputRef,
  setRenameValue,
  commitRenameLedger,
  startRenameLedger,
  onCardPress,
  onEditPress,
  onDeletePress,
  styles,
  colors,
  t,
}: LedgerCardInnerProps) {
  // 删除入口 = 编辑铅笔右侧的垃圾桶按钮（用户定版：侧滑删除手势会与纵向滚动抢触摸，
  // 卡片上不再挂任何手势，滚动保持干净）。
  return (
    <PressableScale
      style={[styles.ledgerPickerCard, active && styles.ledgerPickerCardActive]}
      activeScale={0.97}
      onPress={onCardPress}
      accessibilityRole="button"
      accessibilityLabel={l.name}
      accessibilityState={{ selected: active }}
    >
      <View style={styles.ledgerPickerCardTop}>
        <LinearGradient
          colors={[iconFrom, iconTo]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.ledgerPickerIconWrap}
        >
          <Ionicons name={l.icon as IconName} size={22} color="#FFFFFF" />
        </LinearGradient>
        <View style={{ flex: 1, marginLeft: 12 }}>
          {renamingLedgerId === l.id ? (
            <TextInput
              ref={renameInputRef}
              style={[styles.ledgerRenameInput, { borderColor: colors.link }]}
              value={renameValue}
              onChangeText={setRenameValue}
              onBlur={commitRenameLedger}
              onSubmitEditing={commitRenameLedger}
              selectTextOnFocus
              returnKeyType="done"
              autoFocus
            />
          ) : (
            <View style={styles.ledgerRenameBox}>
              {/* 名称 + 铅笔同框格：整体点击进入改名（用户定版：铅笔要有框格框住名称） */}
              <TouchableOpacity
                style={styles.ledgerRenameBoxInner}
                onPress={onEditPress}
                accessibilityRole="button"
                accessibilityLabel={t('home.editLedger')}
              >
                <Text style={[styles.ledgerPickerName, { flex: 1 }]} numberOfLines={1}>
                  {l.name}
                </Text>
                <Ionicons name="pencil" size={15} color={colors.link} />
              </TouchableOpacity>
            </View>
          )}
          <Text style={styles.ledgerPickerSub}>
            {isDefault ? t('home.defaultLedger') : t('home.createdOn', { date: formatDate(l.createdAt) })}
          </Text>
        </View>
        {/* 右上角操作区：只剩删除垃圾桶（用户定版：铅笔编辑钮整个去除，
            改名仍走名称框格内的铅笔） */}
        {renamingLedgerId !== l.id && (
          <TouchableOpacity
            style={styles.ledgerCardActionBtn}
            onPress={onDeletePress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={t('home.deleteLedger')}
          >
            <Ionicons name="trash-outline" size={17} color={colors.expenseOver} />
          </TouchableOpacity>
        )}
        <Ionicons
          name={active ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={active ? colors.link : colors.dividerHair}
        />
      </View>
      <View style={styles.ledgerPickerBalanceBlock}>
        <Text style={styles.ledgerPickerBalanceLabel}>{t('home.balanceLabel')}</Text>
        {totals.length === 0 ? (
          <Text style={styles.ledgerPickerBalanceEmpty}>{t('home.noAssets')}</Text>
        ) : (
          totals.map(([code, amount]) => (
            <View key={code} style={styles.ledgerPickerBalanceLine}>
              <Text style={styles.ledgerPickerBalanceCode}>{code}</Text>
              <Text style={styles.ledgerPickerBalanceValue}>{formatMoney(amount)}</Text>
            </View>
          ))
        )}
      </View>
    </PressableScale>
  );
}

function makeStyles(colors: ThemeColors) {  return StyleSheet.create({
    container: { flex: 1 },
    headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
    headerSide: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    headerSideRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
    // headerCenter 已删:账本按钮 2026-09-23 移入左侧 headerSide(紧贴通知铃铛)
    headerTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, maxWidth: 160 },
    // 头部按钮间距统一 6px(用户定版 2026-09-23):日夜/日历两颗共用本值
    headerIconBtn: { marginLeft: 6 },
    // 铃铛自身不再留右距,与账本胶囊的 6px 全靠账本的 marginLeft 提供
    headerIconBtnLeft: { marginRight: 0 },
    // 圆框按钮:铃铛/日夜切换共用,36×36 圆形描边(和二级页返回键同款风格,图案从 20 提到 22)
    headerCircleBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 账本名下拉:整块包成按钮形态(描边胶囊)。原居中,现移入左侧与铃铛相邻;
    // 头部按钮间距统一 6px(用户定版 2026-09-23)
    headerLedgerBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      maxWidth: 190,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 19,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      backgroundColor: colors.card,
      marginLeft: 6,
    },
    // 语言状态胶囊:显示当前语言(中/EN),点击切换
    langChip: {
      // 与圆框按钮同高的胶囊按钮(36 高),显示当前语言
      minWidth: 40,
      height: 36,
      paddingHorizontal: 10,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      // 头部按钮间距统一 6px(用户定版 2026-09-23):本按钮不再负 margin 拉近
      marginRight: 0,
    },
    langChipText: { fontSize: 13, fontWeight: '700', color: colors.icon },
    // 外层只负责投影 + 定位，圆角保持跟内层一致，方便阴影贴合渐变卡片的形状
    assetCardShadow: {
      marginHorizontal: 16,
      marginTop: 8,
      borderRadius: 20,
      shadowColor: '#1B1040',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.16,
      shadowRadius: 20,
      elevation: 5,
    },
    // 主角卡：渐变面 + 半透明白描边（比 cardBorder 更像"受光边缘"）
    assetCard: {
      borderRadius: 20,
      padding: 20,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.12)',
    },
    assetCardLabel: { fontSize: 15, fontWeight: '600', letterSpacing: 0.5, color: colors.netWorthLabel, marginBottom: 4 },
    assetCardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    // 眼睛按钮：小图标也要有 44pt 级的实体感——半透明圆底让它成为可按的"按钮"而不是裸图标
    dayGroup: { marginBottom: 4, borderBottomWidth: 1, borderBottomColor: colors.dividerHair, paddingBottom: 2 },
    // 头部默认左右排（10万以内）；出现大金额才切上下排（dayHeaderRowStacked）
    dayHeaderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, marginBottom: 2, marginHorizontal: -16, backgroundColor: colors.link + '0D', borderRadius: 0 },
    // 上下排时收紧上下留白：padding 8→4，两行合计的头部高度不至于比横排胖一倍
    dayHeaderRowStacked: { paddingVertical: 4 },
    // 英文日期标签比中文长：标题可收缩先截断，金额组保持完整
    // fontWeight '750' 不在 RN 类型白名单(仅整百),运行时按支持程度就近渲染,这里显式放宽类型
    dayHeaderText: { flex: 1, flexShrink: 1, fontSize: 13.5, fontWeight: '700', color: colors.link, marginLeft: 6 },
    // 合计默认左右排；上下排为支出/收入右对齐纵排——全部固定 14 号不缩字，保证高度统一
    dayHeaderTotals: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto', flexShrink: 0 },
    dayHeaderTotalsStacked: { flexDirection: 'column', alignItems: 'flex-end' },
    dayHeaderExpense: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: colors.expense, fontVariant: ['tabular-nums'] },
    dayHeaderIncome: { flexShrink: 1, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
    eyeBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: 'rgba(255,255,255,0.14)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    assetCardValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    // 大数字用负字距（大字号时字母会显得松）+ 等宽数字（金额跳动时不抖动）
    // 金额不用 tabular-nums：等宽数字会让首位"1"在字格里居中，视觉上左边缘比 MYR 缩进一点
    assetCardValue: { fontSize: 36, fontWeight: '700', letterSpacing: 0, color: colors.netWorthValue, textAlign: 'left' },
    // 币种代码：独立一行放在金额上方（参考图 EXPENSES/USD 排列）
    assetCardCode: { fontSize: 15, color: colors.netWorthLabel, fontWeight: '600', letterSpacing: 0, marginBottom: 2, textAlign: 'left' },
    // 币种代码 + 金额纵向排列容器:可收缩(flexShrink),右侧的上下箭头按钮(40 固定)永不被挤压
    assetValueCol: { flex: 1, flexShrink: 1, flexDirection: 'column', alignItems: 'flex-start', marginRight: 8 },
    assetCardEmptyWrap: { paddingVertical: 6 },
    assetCardEmptyTitle: { fontSize: 15, fontWeight: '600', color: colors.netWorthValue },
    assetCardEmptyHint: { fontSize: 12, color: colors.netWorthHint, marginTop: 5 },
    assetCardHint: { fontSize: 12, fontWeight: '500', color: colors.netWorthHint },
    // 净资产卡内嵌的本月预算进度条
    assetCardBudgetTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 8 },
    assetCardBudgetLabel: { flex: 1, flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.netWorthLabel },
    assetCardBudgetValue: { flexShrink: 1, fontSize: 14, fontWeight: '500', color: colors.netWorthValue },
    assetCardBudgetDim: { fontSize: 14, fontWeight: '500', color: colors.netWorthLabel },
    assetCardBudgetTrack: { height: 5, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 3, overflow: 'hidden' },
    assetCardBudgetFill: { height: '100%', borderRadius: 3 },
    // 未设置预算的占位行：minHeight 校准到已设置状态预算区的内容高度（标签行20+下距8+进度条5+间距6+状态行20≈59），
    // 两种状态卡片总高一致，设置预算时不跳动
    assetCardBudgetEmptyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 16,
      minHeight: 49, // 与已设置状态同步缩到 65px 总高（16 + 49）
      paddingTop: 10, // 整体往下压：内容在行内下移
    },
    assetCardBudgetEmptyIcon: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.netWorthAccent,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 6,
    },
    // 比总资产金额（assetCardValue 36px）小 2px
    assetCardBudgetEmptyText: { fontSize: 18, fontWeight: '600', color: colors.netWorthLabel },
    // 货币直选下拉：从切换行底缘拉出、与净资产卡同渐变的面板（顶部无圆角=无缝衔接）
    currencyMenuOverlay: { flex: 1, backgroundColor: 'rgba(20,15,40,0.35)' },
    currencyMenuPanel: {
      position: 'absolute',
      borderRadius: 20,
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.12)',
      borderTopWidth: 0,
      overflow: 'hidden',
      paddingBottom: 8,
    },
    currencyMenuTitle: { fontSize: 16, fontWeight: '700', color: colors.netWorthValue, paddingHorizontal: 16, paddingVertical: 8 },
currencyMenuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  currencyMenuItemText: { fontSize: 16, fontWeight: '600', color: colors.netWorthValue },
    // 卡片右上角的"+ 新增 / 查看全部"：做成胶囊，比裸文字有更大的可点区域和更明确的按钮感
    addLinkBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      backgroundColor: colors.link + '14',
      borderRadius: 13,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    // 今日账单卡片：跟预算卡同一套扁平处理，靠内容分层而不是靠底色区分
    sectionCardShadow: {
      marginHorizontal: 16,
      marginTop: 12,
      borderRadius: 18,
      shadowColor: '#1B1040',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.05,
      shadowRadius: 10,
      elevation: 2,
    },
    sectionCard: {
      borderRadius: 18,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 16,
      overflow: 'hidden',
    },
    sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    sectionTitle: { fontSize: 15, fontWeight: '600', letterSpacing: 0.2, color: colors.textPrimary },
    sectionLink: { fontSize: 13, fontWeight: '600', color: colors.link },
// 空状态：图标 + 主文案 + 弱化的引导，居中，给"下一步做什么"一个明确答案
  emptyWrap: { alignItems: 'center', paddingVertical: 32 },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyText: { fontSize: 17, fontWeight: '600', color: colors.textSecondary },
  emptyHint: { fontSize: 14, color: colors.textTertiary, marginTop: 6 },
    todayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, minHeight: 40 },
    // 左栏 = 类别 · 备注（sample 形态）：flex:1 弹性，超长截断，把宽度全部让给金额
    billTitleText: { flex: 1, marginRight: 8, fontSize: 13.5, fontWeight: '600' },
    // 金额：正常字号固定 13.5 不压缩；只有金额本身长到撑爆整行（>14 位整数）时才允许
    // 自身收缩 + 缩字（最低 0.7），配合 JSX 的 adjustsFontSizeToFit 实现"没位置就稍微缩小"
    billAmountCol: {
      flexShrink: 1,
      minWidth: 0,
      marginLeft: 8,
      fontSize: 13.5,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    ledgerModalOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
    },
    ledgerModalCard: {
      width: '100%',
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
    },
    planModalCard: {
      width: '100%',
      maxHeight: '92%',
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
    },
    ledgerModalTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 8, textAlign: 'center' },
    modalFieldLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 12, marginBottom: 6 },
    requiredMark: { color: colors.expense, fontWeight: '700' },
    // 全屏账本快速切换弹窗（参照 LedgerScreen 的卡片样式，保持视觉一致）
    // 贴底面板（账户弹层 accountPickerSheet 同款结构）：absolute 锚底、85% 高、
    // 顶部圆角、发丝描边。下滑收起手势挂在这一层外层
    ledgerPickerSheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: '85%',
      backgroundColor: colors.bg,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      overflow: 'hidden',
    },
    // 把手条（账户弹层 grabber 同款）：面板打开时它所在的头部区域永远可拖收起
    ledgerPickerGrabber: {
      alignSelf: 'center',
      width: 44,
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.divider,
      marginTop: 8,
      marginBottom: 2,
    },
    ledgerPickerScreen: { flex: 1, backgroundColor: colors.bg },
    ledgerPickerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 14,
    },
    ledgerPickerTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
    ledgerPickerListContent: { padding: 20, paddingTop: 4, gap: 12 },
    ledgerPickerCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
      marginBottom: 12,
    },
    // 选中卡片：2px 主题紫实色描边（用户要求去掉渐变外框后保留清晰选中态）
    ledgerPickerCardActive: {
      borderWidth: 2,
      borderColor: colors.link,
    },
    ledgerPickerCardTop: { flexDirection: 'row', alignItems: 'center' },
    ledgerPickerIconWrap: {
      width: 48,
      height: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ledgerPickerName: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
    // 名称 + 铅笔同框格：发丝描边圆角长条，整体点击进入改名（用户定版交互）
    ledgerRenameBox: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.cardBorder,
      borderRadius: 8,
      backgroundColor: colors.bg,
    },
    ledgerRenameBoxInner: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 34,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    // 改名输入框：编辑中在名称位置原位展开，主题色高亮
    ledgerRenameInput: {
      flex: 1,
      minHeight: 34,
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderRadius: 8,
    },
    ledgerPickerSub: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
    // 结余区改为竖排：「结余」标签在左上角，下面每行一个币种
    ledgerPickerBalanceBlock: {
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.dividerHair,
    },
    ledgerPickerBalanceLabel: { fontSize: 12, fontWeight: '600', color: colors.textTertiary, marginBottom: 4 },
    ledgerPickerBalanceEmpty: { fontSize: 13, color: colors.textTertiary },
    // 金额行：货币代码与金额同款字重字号，代码在左、金额贴行尾靠右
    ledgerPickerBalanceLine: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
    },
    // 用户定版：货币/金额用主题紫（代表色）、600 字重；字号=缩小版基础上各加大 2 号
    ledgerPickerBalanceValue: { fontSize: 18, fontWeight: '600', color: colors.link, lineHeight: 22 },
    ledgerPickerBalanceCode: { fontSize: 15, fontWeight: '600', color: colors.link, lineHeight: 20 },
    // 卡片右上角删除钮（用户定版：铅笔编辑钮已去除，改名走名称框格内的铅笔）
    ledgerCardActionBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ledgerPickerFooter: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 12,
      borderTopWidth: 1,
      borderTopColor: colors.dividerHair,
    },
    // 新增账本：通栏渐变主按钮（FAB 同款三段渐变），内容层叠在渐变上
    ledgerPickerAddBtn: {
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    ledgerPickerAddBtnInner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    ledgerPickerAddBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
    modalInput: {
      backgroundColor: colors.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      padding: 12,
      fontSize: 14,
      color: colors.textPrimary,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginRight: 8,
      marginBottom: 8,
    },
    chipActive: { backgroundColor: colors.fabBg, borderColor: colors.textPrimary },
    chipText: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
    chipTextActive: { color: colors.bg },
    // 付款计划的类别选择器：跟"记一笔"里选类别的网格样式保持一致（点一下直接选中，不用滑动）
    catGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    catItem: { width: '25%', alignItems: 'center', marginBottom: 16 },
    catIconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    catLabel: { fontSize: 11, color: colors.textPrimary, marginTop: 6, textAlign: 'center' },
    assetPickerBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    // 类别/账户没选时：框格描红边 + 下面配一行提醒文字，不用弹窗打断填表
    assetPickerBtnError: { borderColor: colors.expense },
    // 名称/金额没填时同样描红边，跟类别/账户保持一致，不用弹窗打断
    modalInputError: { borderColor: colors.expense },
    fieldErrorText: { fontSize: 11, color: colors.expense, marginTop: 4 },
    assetPickerPlaceholder: { fontSize: 14, color: colors.textTertiary },
    assetPickerChosenRow: { flexDirection: 'row', alignItems: 'center' },
    assetPickerChosenText: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
    assetPickerChosenCurrency: { fontSize: 12, color: colors.textTertiary },
    assetDropdown: {
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      borderRadius: 10,
      marginTop: 6,
      paddingVertical: 4,
    },
    assetDropdownDivider: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.summaryCard,
    },
    assetDropdownDividerText: { fontSize: 11, color: colors.textTertiary, fontWeight: '700' },
    assetDropdownItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    assetDropdownItemLeft: { flexDirection: 'row', alignItems: 'center' },
    assetDropdownItemText: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
    assetDropdownItemType: { fontSize: 11, color: colors.textTertiary },
    autoDeductRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingVertical: 4 },
    planTypeSegRow: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: 10, padding: 2, marginBottom: 12 },
    planTypeSegBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
    planTypeSegBtnActive: { backgroundColor: colors.fabBg },
    planTypeSegText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
    planTypeSegTextActive: { color: colors.fabIcon, fontWeight: '700' },
    incomePlanHint: { fontSize: 11, color: colors.textTertiary, marginTop: -6, marginBottom: 10 },
    autoDeductText: { fontSize: 13, color: colors.textPrimary, marginLeft: 8, fontWeight: '600' },
    modalSaveBtn: {
      backgroundColor: colors.fabBg,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 16,
    },
    // 付款计划弹窗专用：跟正上方的"到期自动扣账"复选框拉开更大间距，减少误触
    planModalSaveBtn: { marginTop: 28 },
    modalSaveBtnText: { color: colors.bg, fontWeight: '700', fontSize: 14 },
  });
}
