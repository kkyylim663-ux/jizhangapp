import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Image,
  Modal,
  Switch,
  Dimensions,
  Platform,
  Keyboard,
} from 'react-native';
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import Reanimated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../context/AppContext';
import { ROUTES } from '../navigation/routes';
import DateRangePickerSheet from '../components/DateRangePickerSheet';
import { TransactionType, Transaction, Category } from '../types';
import { useT } from '../i18n/LanguageContext';
import { getCategoryLabel, getGroupLabel, findCategoryIdByChineseName } from '../i18n/categories';
import { EXPENSE_CATEGORY_GROUPS, INCOME_CATEGORY_GROUPS } from '../utils/defaultCategories';
import { scanReceipt } from '../utils/scanReceipt';
import { getCurrencySymbol, getCurrencyFlag } from '../utils/currencies';
import { CATEGORY_ICON_OPTIONS, CATEGORY_COLOR_OPTIONS, CategoryIconName } from '../constants/categoryAddOptions';
import { getAssetDisplayBalance, getAssetTransferBalance } from '../utils/creditCard';
import { hapticLight, hapticSelection, hapticSuccess, hapticWarning } from '../utils/haptics';
import { useTheme } from '../theme/useTheme';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler, useTabBarForceHide } from '../context/TabBarAutoHideContext';
import { ThemeColors } from '../theme/theme';
import { useAmountExpression } from '../hooks/useAmountExpression';
import { AmountCalculatorKeypad } from '../components/AmountCalculatorKeypad';
import { CursorAmountText } from '../components/CursorAmountText';
import { ReceiptCameraModal } from '../components/ReceiptCameraModal';
import { useDialog } from '../components/AppDialog';


type IconName = keyof typeof Ionicons.glyphMap;

// iOS 风格"左侧边缘右滑返回"：从屏幕左边缘(40px内)横向右滑超过阈值就返回。
// manualActivation 手动接管：只有"起点贴近左边缘且横向位移占主导"才激活手势，
// 纵向滚动、分类横滑条等都不受影响。
// 左滑删除包装器：向左拖动露出右侧"删除"按钮，点删除回调确认
function EdgeBackSwipe({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  const startPos = useRef({ x: 0, y: 0 });
  const gesture = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e) => {
      const t = e.allTouches[0];
      if (t) startPos.current = { x: t.absoluteX, y: t.absoluteY };
    })
    .onTouchesMove((e, stateManager) => {
      const t = e.allTouches[0];
      if (!t) return;
      const dx = t.absoluteX - startPos.current.x;
      const dy = t.absoluteY - startPos.current.y;
      if (startPos.current.x < 40 && dx > 24 && Math.abs(dy) < 24) stateManager.activate();
      else if (Math.abs(dy) > 24 || dx < -10) stateManager.fail();
    })
    .onEnd((e) => {
      if (e.translationX > 80) onBack();
    });
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}

// UI 层的四个入口："兑换" 在数据层复用 'transfer' 类型（types.ts 中 TransactionType 只有
// expense/income/transfer 三个值），仅在界面文案和是否强制显示汇率上做区分。
type UiType = 'expense' | 'income' | 'transfer' | 'exchange';

// D-3.2（2026-09-24）：账户名全展示——原「最多 4 字+省略号」的 truncateAccName 预截断退役
// （名字超宽由 Text 在框内两行折行兜底，见 heroCurrencyAccName numberOfLines 2）

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 日历选择器回调给的是 Date 对象，转成表单里统一用的 YYYY-MM-DD 字符串
function formatDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Step = 'category' | 'detail' | 'transferDetail';

// 类别横排"最近用过"快捷选择：本地存一份最近选过的类别 id（新的插最前面，去重），
// 跟 AssetScreen 里"最近用过的货币"是一个思路，只是这里存的是类别 id 顺序
const RECENT_CATEGORY_KEY = '@jizhang/recentCategories';
// TASK-022：每个类型的"最后选中类别"持久化（杀进程重启后自动恢复）——
// 值形如 { expense?: string, income?: string }；transfer/exchange 页无类别网格不参与
const LAST_CATEGORY_KEY = '@jizhang/lastCategory';
// TASK-022：每个类型的网格固定格（本次选过的类别置顶格）持久化，重启后网格原样恢复
// 值形如 { expense?: string[], income?: string[] }
const SESSION_PICKED_KEY = '@jizhang/sessionPickedCategories';
// 编辑模式拖动排序的持久化键：Record<分类id, 序号>，只在大组内部比较（资产页 assetOrder 同款）
const CATEGORY_ORDER_KEY = '@jizhang/categoryOrder';
// TASK-009：不设上限——历史里有多少就往网格铺多少，直到"全部"按钮碰到自绘计算器为止
const RECENT_CATEGORY_HISTORY_LIMIT = Infinity;
// 自绘计算器面板高度（实算：4 行按键 × CELL_HEIGHT 70 + 备注条(28+padding 10+发丝线)≈318，
// +stickyFooter paddingTop 6 ≈ 324，取 328 留 hairline 余量）——
// TASK-009 类别网格停止线用它，比旧的 320 估算更准（真机 17 个越线就是估矮了）
const KEYPAD_PANEL_HEIGHT = 328;

export default function AddTransactionScreen({ navigation, route }: any) {
  const { categories, categoryGroups, addCategory, addCategoryGroup, deleteCategoryGroup, addTransaction, updateTransaction, addTransfer, updateCategory, deleteCategory, deleteTransaction, assets, getAssetBalance, currencySymbol, currency, activeLedgerId, paymentPlans, addPaymentPlan } =
    useApp();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const t = useT();
  // 主题化弹窗（替代系统 Alert）
  const dialog = useDialog();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler(); // 不传参数！
  const setTabBarForceHidden = useTabBarForceHide();
  const isFocused = useIsFocused();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const editTransaction: Transaction | undefined = route?.params?.editTransaction;
  const isEditing = !!editTransaction;

  const initialUiType: UiType = editTransaction
    ? (editTransaction.type as UiType)
    : route?.params?.initialType ?? 'expense';
  const presetCategoryId: string | undefined = route?.params?.presetCategoryId;
  const autoScan: boolean = !!route?.params?.autoScan;

  const [uiType, setUiType] = useState<UiType>(initialUiType);
  // 数据层类型：兑换在存储上就是一笔转账
  const type: TransactionType = uiType === 'exchange' ? 'transfer' : uiType;
  const isExchange = uiType === 'exchange';

  // 长按在"资产"页勾选过的默认账户，新增记录时自动带出来（编辑已有记录时不覆盖，还是用那笔记录本来的账户）
  const defaultAsset = assets.find((a) => a.isDefault);

  // 所有类型都直接进入主表单；转账/兑换的账户改为页面内弹层选择，不再增加独立选择步骤。
  const stepForType = (t: UiType): Step => (t === 'transfer' || t === 'exchange' ? 'transferDetail' : 'detail');

  const [step, setStep] = useState<Step>(() => {
    if (isEditing) return editTransaction?.type === 'transfer' ? 'transferDetail' : 'detail';
    return stepForType(initialUiType);
  });
  const [categoryId, setCategoryId] = useState<string | null>(editTransaction?.categoryId ?? null);
  const [amount, setAmount] = useState(editTransaction ? String(editTransaction.amount) : '');
  // 自绘计算器键盘：amount 字符串仍然是提交表单时用的最终值（跟以前一样），
  // amountExpr 只在键盘面板打开时管理当前正在输入/拆分的表达式，
  // 按"完成"时把算好的结果写回 amount，这样 saveTransaction 等原有逻辑完全不用改
  const amountExpr = useAmountExpression(editTransaction ? editTransaction.amount : undefined);
  const [amountKeypadOpen, setAmountKeypadOpen] = useState(true);
  // 各金额格的自绘光标位置（距显示串尾部的偏移，0=最末尾）：
  // 键盘按键在光标处插入/删除（pressKeyAt），点按/长按拖动金额文字可移动光标
  const [amountCursor, setAmountCursor] = useState(0);
  const [rateCursor, setRateCursor] = useState(0);
  const [feeCursor, setFeeCursor] = useState(0);
  // 支出/收入计算器的输入目标：金额（大看板）或规划期数。点期数格子切到期数目标，
  // "完成"键在期数格只负责把算出的值写回 state 并切回金额，不会误存整笔（参照转账页三格的做法）
  const [date, setDate] = useState(editTransaction?.date ?? todayStr());
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  // 自动月结开关（Hero 卡内，仅新增模式）：默认关闭，手动点击才开启——
  // 打开后保存这笔账时，会在财务规划自动生成一条「每月同日自动入账」的计划付款
  const [autoMonthly, setAutoMonthly] = useState(false);
  const [note, setNote] = useState(editTransaction?.note ?? '');
  const [scanning, setScanning] = useState(false);
  // 凭证：支出/收入详情页里附加的真实单据照片（拍照或从相册选）
  const [receiptUri, setReceiptUri] = useState<string | null>(editTransaction?.receiptUri ?? null);
  const [receiptPreviewOpen, setReceiptPreviewOpen] = useState(false);

  // 普通收支专用：可选的资产账户（这笔钱从/到哪个账户）——没有编辑数据时，用"资产"页设的默认账户
  const [assetId, setAssetId] = useState<string | null>(editTransaction?.assetId ?? defaultAsset?.id ?? null);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  // 账户选择弹窗下滑收起（与日期选择面板同款的 manualActivation 手势 + 树内覆盖层）：
  // - 账户列表滚到顶部时往下拖 → 接管手势，整块面板跟手下移，松手超过 120px / 快速甩动就收起
  // - 列表不在顶部、或往上拖 → 不接管，账户列表照常滚动；从把手/头部下滑永远生效
  const accountPickerPanY = useSharedValue(0);
  const accountPickerScrim = useSharedValue(0);
  // 列表滚动偏移：手动经 useAnimatedScrollHandler 写进 sharedValue（UI 线程零延迟）。
  // 之前用 useScrollViewOffset(accountListRef)，但 ScrollView 挂在 assetPickerOpen 条件分支里，
  // 弹窗未打开时 ref 未挂载，Reanimated 每帧报 "animatedRef is not initialized" 警告
  const accountListOffset = useSharedValue(0);
  const accountListScrollHandler = useAnimatedScrollHandler((e) => {
    accountListOffset.value = e.contentOffset.y;
  });
  const pickerDragStart = useSharedValue({ x: 0, y: 0 });
  const accountPickerClosingSV = useSharedValue(false);
  const closeAccountPicker = () => {
    // 支出/收入与转账/兑换共用同一个弹层外壳（两个分支互斥渲染，永远只开一个），这里一把全关
    setAssetPickerOpen(false);
    setAccountPickerOpen(false);
    setCurrencyDropOpen(false);
  };
  const accountPickerGesture = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e) => {
      const t = e.allTouches[0];
      pickerDragStart.value = { x: t?.absoluteX ?? 0, y: t?.absoluteY ?? 0 };
    })
    .onTouchesMove((e, stateManager) => {
      const t = e.allTouches[0];
      if (!t) return;
      if (accountListOffset.value > 0) return; // 列表不在顶部：不接管，让它正常滚
      const dy = t.absoluteY - pickerDragStart.value.y;
      const dx = t.absoluteX - pickerDragStart.value.x;
      if (dy > 12 && Math.abs(dy) > Math.abs(dx) * 1.2) stateManager.activate();
    })
    .onUpdate((e) => {
      accountPickerPanY.value = Math.max(0, e.translationY);
      accountPickerScrim.value = Math.min(0.4, Math.max(0, e.translationY) / 500 + 0.15);
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 800) {
        if (accountPickerClosingSV.value) return;
        accountPickerClosingSV.value = true;
        accountPickerScrim.value = withTiming(0, { duration: 180 });
        accountPickerPanY.value = withTiming(900, { duration: 220 }, (finished) => {
          if (finished) runOnJS(closeAccountPicker)();
        });
      } else {
        accountPickerPanY.value = withTiming(0, { duration: 180 });
        accountPickerScrim.value = withTiming(0.4, { duration: 150 });
      }
    });
  const accountPickerAnimStyle = useAnimatedStyle(
    () => ({ transform: [{ translateY: accountPickerPanY.value }] }),
    []
  );
  const accountPickerScrimStyle = useAnimatedStyle(() => ({ opacity: accountPickerScrim.value }), []);

  // 入场动画已移到下方 accountPickerOpen 声明之后：两个分支共用一套面板动画
  // 用户手动选过账户后就不再自动跟随"默认账户"变化；保存后重置（resetAll）恢复自动跟随。
  // 编辑已有账单时初始值来自账单本身，视为已手动确定
  const userPickedAssetRef = useRef(!!editTransaction?.assetId);
  const userPickedFromRef = useRef(false);

  // "默认账户"实时联动：在资产页勾选/取消"设为默认账户"后，只要用户没在本页手动选过账户，
  // 这里的预选账户立刻跟着变（取消勾选→回到未选择；勾选别的→换成新的默认账户）。
  // 账户变了，金额显示币种自动跟着变——金额币种只认所选账户
  useEffect(() => {
    if (userPickedAssetRef.current) return;
    setAssetId(defaultAsset?.id ?? null);
  }, [defaultAsset?.id]);

  useEffect(() => {
    if (userPickedFromRef.current) return;
    setFromAssetId(defaultAsset?.id ?? null);
  }, [defaultAsset?.id]);

  // 转账/兑换专用状态——"转出"账户也带默认值（通常就是平时最常用那张），"转入"留给用户自己选
  const [fromAssetId, setFromAssetId] = useState<string | null>(defaultAsset?.id ?? null);
  const [toAssetId, setToAssetId] = useState<string | null>(null);
  const [exchangeRate, setExchangeRate] = useState('');
  const [fee, setFee] = useState('');
  // 转账/兑换的所有金额字段统一使用自绘计算器：金额、汇率、手续费。
  // 汇率跟手续费一样默认空（显示 0.00），不预填 1.00——不然每次都要先删掉默认值才能输入
  const rateExpr = useAmountExpression(undefined);
  const feeExpr = useAmountExpression(undefined);
  const [calculatorTarget, setCalculatorTarget] = useState<'amount' | 'rate' | 'fee'>('amount');

  // 当前键盘目标格的光标分发：按键在光标处生效（pressKeyAt 返回新光标偏移写回 state）。
  // reset 打开键盘（空态起输）时光标一律回到末尾
  const handleExprKey = (key: string) => {
    if (calculatorTarget === 'amount') setAmountCursor(amountExpr.pressKeyAt(key, amountCursor));
    else if (calculatorTarget === 'rate') setRateCursor(rateExpr.pressKeyAt(key, rateCursor));
    else setFeeCursor(feeExpr.pressKeyAt(key, feeCursor));
  };

  // 转账/兑换账户选择：不再经过独立的“选择步骤”，直接在当前页面通过弹层菜单切换账户
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [accountPickerRole, setAccountPickerRole] = useState<'from' | 'to'>('from');
  const [accountSearch, setAccountSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState<'all' | 'cash' | 'bank' | 'credit' | 'ewallet'>('all');
  // TASK-025：账户弹层币种分组（资产页内联菜单式）——反向记录「被收起」的组，默认全展开；
  // 点分组头切换；两处弹层（支出/收入 assetPicker 与转账/兑换 accountPicker）共用
  const [pickerCollapsedGroups, setPickerCollapsedGroups] = useState<Set<string>>(new Set());
  const togglePickerGroup = (code: string) => {
    setPickerCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  // 入场：面板从屏幕外滑入 + 遮罩淡入（panY 复位也在这里做，保证每次打开都是全新状态）。
  // 支出/收入（assetPickerOpen）与转账/兑换（accountPickerOpen）共用同一套面板动画；
  // 列表滚动偏移一并清零——上次打开时滚到中间残留的话，下滑收起手势会因"列表不在顶部"失灵
  useEffect(() => {
    if (assetPickerOpen || accountPickerOpen) {
      accountPickerClosingSV.value = false;
      accountPickerPanY.value = 900;
      accountPickerScrim.value = 0;
      accountListOffset.value = 0;
      accountPickerPanY.value = withTiming(0, { duration: 260 });
      accountPickerScrim.value = withTiming(0.4, { duration: 260 });
    }
  }, [assetPickerOpen, accountPickerOpen, accountPickerPanY, accountPickerScrim, accountListOffset]);

  // Enter/下一步跳到"备注"这个真实输入框——详情页和转账页的备注框不会同时挂载，共用一个 ref 就够
  const noteInputRef = useRef<TextInput>(null);

  // 让"当前正在输入的那一块"自动滚到屏幕居中位置，不用自己找它在哪——
  // 详情页和转账页各自有独立的 ScrollView，但不会同时挂载，共用一套记录就够。
  // fieldY 记的是每个字段块在滚动内容里的 y 坐标（这些字段块都是 ScrollView 的直接子节点，
  // onLayout 给的 y 天然就是"相对滚动内容"的坐标，不用再额外做坐标换算）。
  const scrollViewRef = useRef<ScrollView>(null);
  const fieldY = useRef<Record<string, number>>({});
  const registerFieldY = (key: string) => (e: { nativeEvent: { layout: { y: number } } }) => {
    fieldY.current[key] = e.nativeEvent.layout.y;
  };
  const scrollToField = (key: string) => {
    const y = fieldY.current[key];
    if (y == null) return;
    // 键盘（自绘计算器面板，或者系统输入法）常驻在底部会占掉一截屏幕，真正"看得见"的
    // 区域没有整个屏幕那么高，用"可视区域高度的一半"当作目标位置的偏移量，而不是死算像素中点。
    // 遮挡高度分两种：自绘计算器面板用 KEYPAD_PANEL_HEIGHT（实算常量，TASK-009 起与
    // 类别网格停止线共用同一个值，不会再估矮越线）；系统键盘（备注框聚焦弹出来的那个）
    // 用 keyboardDidShow 事件给的真实高度，不能套用面板的常量——两个高度并不一样。
    const occludedHeight = amountKeypadOpen ? KEYPAD_PANEL_HEIGHT : keyboardVisible ? keyboardHeight : 0;
    const visibleH = Dimensions.get('window').height - insets.top - occludedHeight;
    const targetOffset = Math.max(y - visibleH / 2, 0);
    // 延迟一帧再滚：紧跟在 setAmountKeypadOpen(true) 之后调用时，键盘面板刚出现，
    // 布局还没稳定，不等一下滚动目标位置会算得不准
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({ y: targetOffset, animated: true });
    });
  };

  // 左边缘右滑返回：优先走返回栈（编辑流回列表/首页），Tab 版本直接切回"首页"
  const edgeBackHome = () => {
    hapticLight();
    if (typeof navigation?.canGoBack === 'function' && navigation.canGoBack()) navigation.goBack();
    else navigation?.navigate(ROUTES.TAB_HOME);
  };

  const filteredCategories = useMemo(
    () => categories.filter((c) => c.type === (type === 'transfer' ? 'expense' : type)),
    [categories, type]
  );

  // 选择类别页：支出按大类分组分节（组序=EXPENSE_CATEGORY_GROUPS，无组分类落尾部"其他"节）；
  // 折叠状态只在本页用，保存后重置。搜索时全部强制展开并按名字过滤。
  // 编辑模式（长按任一图标进入，iOS 风格）：图标抖动 + 删除角标，把分类拖到目标大组卡片标题上即换组
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [catEditMode, setCatEditMode] = useState(false);
  // 组内联添加（TASK-004：从类别分类页并入——能力补齐后选择类别页自成一页，不再跳转）
  const [addingGroupName, setAddingGroupName] = useState<string | null>(null);
  const [inlineName, setInlineName] = useState('');
  const [inlineIcon, setInlineIcon] = useState<CategoryIconName>(CATEGORY_ICON_OPTIONS[0]);
  const [inlineColor, setInlineColor] = useState(CATEGORY_COLOR_OPTIONS[0]);
  // TASK-012④：名称输入框跟随焦点——聚焦时若被键盘挡住，滚动到输入框可见
  const inlineInputRef = useRef<TextInput | null>(null);
  const categoryScrollRef = useRef<ScrollView | null>(null);
  const keyboardHeightRef = useRef(0);
  // TASK-016⑥：聚焦时把输入框滚到键盘上方。
  // measureLayout 在新架构(Fabric)下要求原生 ref，getInnerViewNode() 直接报
  // "must be called with a ref to a native component"——放弃测量输入框本身，
  // 改用分节卡片 onLayout 记录各组在 ScrollView 内容里的 y（卡片是 ScrollView
  // 直接子节点，layout.y 就是内容坐标，零测量歧义），聚焦时按组名查表滚动。
  const groupContentYRef = useRef<Record<string, number>>({});
  // 内联小卡在组卡内的 y 偏移（网格可能占多行，只滚到卡顶可能还盖不住/露不出输入框）
  const inlineCardOffsetRef = useRef<Record<string, number>>({});
  // 正在编辑内联小卡的组名：键盘弹出（keyboardDidShow）时补滚一次——
  // autoFocus 聚焦发生在键盘高度还未知的时候，先按 0 滚一版，键盘弹起后校正
  const inlineFocusGroupRef = useRef<string | null>(null);
  const scrollInlineInputIntoView = (groupName: string, keyboardH?: number) => {
    requestAnimationFrame(() => {
      const scroll = categoryScrollRef.current;
      if (!scroll) return;
      const cardY = groupContentYRef.current[groupName];
      if (cardY === undefined) return;
      const inlineY = inlineCardOffsetRef.current[groupName] ?? 0;
      // 头部留白 = 键盘高度的一半再减 60：键盘矮时输入框大致露在视口中部，
      // 键盘高时相应多滚。keyboardH 不传按当前 ref 值（键盘未弹时为 0，先滚一版）
      const kb = keyboardH ?? keyboardHeightRef.current;
      scroll.scrollTo({ y: Math.max(0, cardY + inlineY - Math.max(60, kb / 2)), animated: true });
    });
  };
  // 提交：加进目标组、轻震反馈、收起表单（不用弹窗打断——展开处立即可见新增结果）
  const handleInlineAdd = async (groupName: string) => {
    const name = inlineName.trim();
    if (!name) return;
    await addCategory({ name, icon: inlineIcon, color: inlineColor, type: type as 'expense' | 'income', group: groupName });
    hapticSuccess();
    setInlineName('');
    setInlineIcon(CATEGORY_ICON_OPTIONS[0]);
    setInlineColor(CATEGORY_COLOR_OPTIONS[0]);
    setAddingGroupName(null);
  };
  const [newGroupFormOpen, setNewGroupFormOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  // 编辑模式拖动排序（TASK-016：资产页三条横线式，只在大组内部排序、不跨组）
  const [categoryOrder, setCategoryOrder] = useState<Record<string, number>>({});
  useEffect(() => {
    AsyncStorage.getItem(CATEGORY_ORDER_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') setCategoryOrder(parsed);
      })
      .catch(() => {});
  }, []);
  const persistCategoryOrder = (next: Record<string, number>) => {
    setCategoryOrder(next);
    AsyncStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(next)).catch(() => {});
  };
  // 某个大组内拖拽结束：把 0..n-1 写回该组这几个分类的序号；缺序号的分类排在其原本位置之后
  const handleCatReorder = (groupItems: Category[]) => {
    const next = { ...categoryOrder };
    groupItems.forEach((item, index) => {
      next[item.id] = index;
    });
    persistCategoryOrder(next);
    hapticSelection();
  };
  // 图标选择底部弹层（TASK-016 两步小卡：点预览方块打开，119 个图标 6 列）
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const confirmDeleteCategory = (c: Category) => {
    // 防呆：删的是大组里最后一个分类时提示"大组将一并移除"（组删除的既有级联行为不变，只加文案）
    const groupSize = filteredCategories.filter((x) => x.group === c.group).length;
    const isLastInGroup = !!c.group && groupSize <= 1;
    dialog.alert({
      title: t('addTx.deleteCategoryTitle'),
      message: isLastInGroup
        ? t('addTx.deleteLastInGroupMsg', { name: c.name, group: getGroupLabel(c.group as string, t) })
        : t('addTx.deleteCategoryMsg', { name: c.name }),
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => deleteCategory(c.id) },
      ],
    });
  };

  // 确认删除大组：自定义组删除组记录；默认组把组内分类移到"其他"（组空了自动隐藏）
  const confirmDeleteGroup = (groupName: string, itemCount: number) => {
    const members = filteredCategories.filter((c) => c.group === groupName);
    const isCustom = categoryGroups.some((g) => g.name === groupName);
    dialog.alert({
      title: t('addTx.deleteGroupTitle', { name: groupName }),
      message: itemCount > 0 ? t('addTx.deleteGroupMsg', { count: itemCount }) : t('addTx.emptyGroup'),
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            if (isCustom) {
              deleteCategoryGroup(groupName);
            } else {
              members.forEach((c) => updateCategory(c.id, { group: undefined }));
            }
          },
        },
      ],
    });
  };
  // 离开本页/切换类型时重置编辑与搜索状态（分组默认全部展开，点卡片空白处可收起）
  useEffect(() => {
    setCollapsedGroups(new Set<string>());
    setCatEditMode(false);
    setNewGroupFormOpen(false);
    setNewGroupName('');
  }, [type, step, categoryGroups]);
  // 收入/支出各自的大组分组（默认组 + 自定义组 + 其他），支出与收入流程完全一致
  const groupedExpenseSections = useMemo(() => {
    const customGroups = categoryGroups.filter((g) => g.type === type);
    const customNames = customGroups.map((g) => g.name);
    const defaultGroups: string[] = type === 'expense' ? [...EXPENSE_CATEGORY_GROUPS] : [...INCOME_CATEGORY_GROUPS];
    const inOrder: { group: string; items: Category[]; custom?: boolean }[] = defaultGroups.map((group) => ({
      group,
      items: filteredCategories.filter((c) => c.group === group),
    }));
    // 自定义大类：空组也保留（编辑模式下可以拖分类进去）
    categoryGroups.forEach((cg) => {
      inOrder.push({
        group: cg.name,
        items: filteredCategories.filter((c) => c.group === cg.name),
        custom: true,
      });
    });
    const rest = filteredCategories.filter(
      (c) => !defaultGroups.includes(c.group as any) && !customNames.includes(c.group as any)
    );
    if (rest.length) {
      inOrder.push({ group: t('group.other'), items: rest });
    }
    // 默认组无内容时隐藏；自定义组即使为空也显示
    return inOrder.filter((s) => s.items.length > 0 || (s.custom && s.items.length === 0));
  }, [filteredCategories, categoryGroups, type]);

  // ---------- 类别横排"最近用过"：外面直接显示4个，点了就直接选中，不用进选择页 ----------
  const [recentCategoryIds, setRecentCategoryIds] = useState<string[]>([]);
  useEffect(() => {
    AsyncStorage.getItem(RECENT_CATEGORY_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setRecentCategoryIds(parsed);
      })
      .catch(() => {});
  }, []);
  // TASK-022：按类型恢复"最后选中类别 + 网格固定格"（杀进程重启后回来还是上次选好的）。
  // 只对 expense/income 恢复（transfer/exchange 无类别网格）。
  // 编辑模式也要恢复【网格固定格】——编辑页和记一笔必须铺出同一份格子（用户反馈：两页不一样）；
  // 但【选中类别】不恢复：编辑中的账单保持它自己的 categoryId，不被新增流的默认值覆盖。
  // 恢复的 id 若已被删除：selectedCategory 为 undefined（无高亮）、gridPinned 的 byId 查不到自动跳过，无副作用
  useEffect(() => {
    if (uiType !== 'expense' && uiType !== 'income') return;
    const savedType = uiType as 'expense' | 'income';
    let cancelled = false;
    Promise.all([
      AsyncStorage.getItem(LAST_CATEGORY_KEY),
      AsyncStorage.getItem(SESSION_PICKED_KEY),
    ])
      .then(([lastRaw, pickedRaw]) => {
        if (cancelled) return;
        if (pickedRaw) {
          try {
            const picked = JSON.parse(pickedRaw);
            // 固定格两个模式共用：编辑页与记一笔铺出同一份网格
            if (picked && Array.isArray(picked[savedType])) setSessionPickedIds(picked[savedType]);
          } catch {}
        }
        // 编辑模式：网格照铺，但选中类别保持账单自己的，不读"最后选中"默认值
        if (isEditing) return;
        if (lastRaw) {
          try {
            const last = JSON.parse(lastRaw);
            if (last && typeof last[savedType] === 'string') setCategoryId(last[savedType]);
          } catch {}
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // 仅挂载/类型确定时恢复一次：依赖空数组会拿不到 route 参数，这里跟着 uiType/isEditing 走
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiType, isEditing]);
  const bumpRecentCategory = (id: string) => {
    setRecentCategoryIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_CATEGORY_HISTORY_LIMIT);
      AsyncStorage.setItem(RECENT_CATEGORY_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };
  // 最近用过的排前面，不够4个就用当前类型下的其他类别补齐，保证横排始终有得选
  // ---------- 类别自适应网格：按机型定列数，最近用过的往下开新行，"全部"永远殿后 ----------
  // 列数（类别胶囊数，不含"全部"）按屏宽分档：≥420 宽机 4 个，其余窄/中机 3 个；
  // "全部"入口独占行尾一格，不与类别挤。用户选了新类别就追加进网格，
  // "全部"随之往下移一行；网格不限行数（TASK-007），挤满自动换行继续往下铺
  const winW = Dimensions.get('window').width;
  const categoryColumns = winW >= 420 ? 4 : 3;
  const categoryChipW = (winW - 36 - categoryColumns * 5) / (categoryColumns + 1);

  // ---------- 类别网格内容：固定格 + 首行补齐 ----------
  // - 固定格：本次会话新选过的类别（新的在最前）+ 本地"最近用过"（记账成功时写入），顺序固定；
  // - 固定格不满第一行时按默认顺序补满（首屏永远是一整行 3/4 个类别）；
  // - 选了网格里没有的新类别：置顶插入并 +1 格（"全部"随流式布局下移一行，可无限开行）；
  // - 选已在网格里的旧类别：格位完全不动（保持现状），只切换高亮。
  // TASK-007：网格不限行数，历史类别累积越多铺得越远（最近用过历史上限 20）。
  const [sessionPickedIds, setSessionPickedIds] = useState<string[]>([]);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  // ---------- 可见容量计算（TASK-024：挪到 gridPinned 之前——补齐目标要用 gridMaxCount） ----------
  // 五轮（用户定版尝试）：外层换成普通 View 不再可滚——内容物理上不可能滚到键盘底下，
  // flex 纵向布局自动把键盘面板高度从容器里扣除，「全部」按钮天然停在键盘上沿。
  // 兜底：仍保留容量 slice——用 View 的 onLayout 高度（已扣键盘）和网格顶内容坐标计算，
  // 超出容量的类别不渲染，保证任何机型「全部」都完整可见。
  const [scrollViewH, setScrollViewH] = useState<number | null>(null);
  const [gridTopY, setGridTopY] = useState<number | null>(null);
  // 行高（2026-09-25 字号15批次）：图标 23 + paddingV 3.5×2 + 边框 2 ≈ 32，+ 行距 6 = 38
  const chipRowHeight = 38;
  const columnsInRow = categoryColumns + 1; // 类别列 + 「全部」行尾格
  const gridVisibleRows =
    scrollViewH == null || gridTopY == null
      ? null
      : Math.max(1, Math.floor((scrollViewH - gridTopY) / chipRowHeight));
  const gridMaxCount =
    gridVisibleRows == null ? null : gridVisibleRows * columnsInRow - 1;
  const gridPinned = useMemo(() => {
    const byId = new Map(filteredCategories.map((c) => [c.id, c] as const));
    const pinned: Category[] = [];
    const seen = new Set<string>();
    const push = (id: string) => {
      if (seen.has(id)) return;
      const c = byId.get(id);
      if (c) {
        pinned.push(c);
        seen.add(id);
      }
    };
    sessionPickedIds.forEach(push);
    recentCategoryIds.forEach(push);
    // TASK-024：补齐目标从"第一行"扩为"全部可见容量"（gridMaxCount 已为「全部」预留 -1 格）——
    // Hero 区腾出的空间有多少格就填多少格（第 5 行自动出现）；首帧容量未知时维持只补第一行。
    // 新选/最近用过的永远排在补齐类别前面，顺序规则不变
    const fillTarget = gridMaxCount ?? categoryColumns;
    for (const c of filteredCategories) {
      if (pinned.length >= fillTarget) break;
      if (!seen.has(c.id)) {
        pinned.push(c);
        seen.add(c.id);
      }
    }
    return pinned;
    // TASK-024：补齐目标跟随可见容量（键盘弹出/收起、Hero 压缩都会改变 gridMaxCount）
  }, [sessionPickedIds, recentCategoryIds, filteredCategories, categoryColumns, gridMaxCount]);
  const [currencyDropOpen, setCurrencyDropOpen] = useState(false);
  // 账户列表的币种筛选：下拉里点了某个币种（如 USD），列表就只显示该币种的账户；'all' 为不筛
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  // 金额币种只认所选账户（2026-09-24 用户定版）：选什么账户显示什么货币，没选账户用全局设置货币；
  // 弹层里的币种项只做账户筛选，不再改金额币种（displayCurrencyCode 直选机制已移除）
  const selectedAsset = assets.find((a) => a.id === assetId);
  const amountCurrencyCode = selectedAsset?.currency ?? currency;
  const amountCurrencySymbol = getCurrencySymbol(amountCurrencyCode);
  // Hero 账户选择框宽度 = 转账页账户块的实测宽度（transferBlockW，onLayout 从转账块同步来，
  // 两页切换零跑位）；首次渲染还没量到时用几何公式兜底（转账卡内 flex:1 均分 = (屏宽−116)/2）
  const [transferBlockW, setTransferBlockW] = useState((Dimensions.get('window').width - 116) / 2);
  const heroPickerW = transferBlockW;
  // D-3.1：真机反馈——账户名过长会被截断，账户框改「弹性撑满」金额行下方可用宽度
  // （不再跟随转账块定宽）；宽度 onLayout 实测喂给 SVG 路径。货币标签仍贴内容宽不跟长
  const [heroWrapW, setHeroWrapW] = useState(heroPickerW);
  // D-3：L 型选择器整块改 SVG 一笔轮廓——标签+胶囊一根线画完，物理上无接缝；
  // 内凹圆角（ri）让标签右缘自然拐进胶囊顶边，是 View 边框画不出的「自然拐角」。
  // 标签宽 Wt=标签内容 onLayout 实测（货币代码恒 3 字母，稳定），路径随其实测值动态生成
  const [heroTabW, setHeroTabW] = useState(88);
  const HT = 38; // 标签高
  const HP = 54; // 胶囊高
  const HH = HT + HP; // 整块高 92
  const heroLPaths = useMemo(() => {
    const W = Math.max(heroWrapW, heroTabW + 40);
    const wt = Math.min(heroTabW, W - 40); // 防御：标签宽不得挤掉内凹角与胶囊右圆角
    const ri = 10; // 内凹拐角半径
    const rT = 14; // 标签顶部圆角
    const rP = 15; // 胶囊圆角（与原 heroCurrencyTouch radius 一致）
    const f = (n: number) => n.toFixed(2);
    const dL = [
      `M ${f(rT)},0`,
      `H ${f(wt - rT)}`,
      `A ${rT} ${rT} 0 0 1 ${f(wt)},${rT}`,
      `V ${f(HT - ri)}`,
      `A ${ri} ${ri} 0 0 0 ${f(wt + ri)},${f(HT)}`,
      `H ${f(W - rP)}`,
      `A ${rP} ${rP} 0 0 1 ${f(W)},${f(HT + rP)}`,
      `V ${f(HH - rP)}`,
      `A ${rP} ${rP} 0 0 1 ${f(W - rP)},${f(HH)}`,
      `H ${f(rP)}`,
      `A ${rP} ${rP} 0 0 1 0,${f(HH - rP)}`,
      `V ${f(rT)}`,
      `A ${rT} ${rT} 0 0 1 ${f(rT)},0`,
      'Z',
    ].join(' ');
    return { dL, W };
  }, [heroWrapW, heroTabW]);
  // Hero 金额字号：TASK-022 用户指定 21 号——基准 21，每多 1 位 -0.25px；底线 13 号
  const heroAmountRaw = amountKeypadOpen ? amountExpr.displayValue : amount || '0.00';
  const heroAmountFontSize = Math.max(13, 21 - Math.max(0, heroAmountRaw.replace('.', '').length - 9) * 0.25);
  // 用户已有账户出现过的币种（去重、ABC 字母序——2026-09-24 用户定版），给货币下拉菜单用——和首页的多币种切换同一思路
  const ownCurrencies = useMemo(() => {
    const codes: string[] = [];
    assets.forEach((a) => {
      if (a.currency && !codes.includes(a.currency)) codes.push(a.currency);
    });
    // 金额币种若还没有任何账户（如全局货币）也要能选到——按字母位插入而非置顶，选中项靠勾亮定位不靠位置
    if (!codes.includes(amountCurrencyCode)) codes.push(amountCurrencyCode);
    return codes.sort((c1, c2) => c1.localeCompare(c2));
  }, [assets, amountCurrencyCode]);
  const fromAsset = assets.find((a) => a.id === fromAssetId);
  const toAsset = assets.find((a) => a.id === toAssetId);
  const isCrossCurrency = !!fromAsset && !!toAsset && fromAsset.currency !== toAsset.currency;
  // 兑换页始终显示汇率输入；普通转账只在跨币种时才显示
  const showRateField = isExchange || isCrossCurrency;

  useEffect(() => {
    if (isEditing && editTransaction?.type === 'transfer') {
      dialog.alert({ title: t('addTx.transferEditUnsupported'), message: t('addTx.transferEditUnsupportedMsg') });
      navigation?.goBack();
    }
    if (presetCategoryId) {
      setCategoryId(presetCategoryId);
      setStep('detail');
    }
    if (autoScan) {
      handleScanPress();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetAll = () => {
    // 类型也要重置回支出：底部Tab的"记一笔"切走不会卸载，uiType 留着的话，
    // 上次停在转账/兑换，回来就还是转账/兑换，而不是用户期望的全新支出表单
    setUiType('expense');
    setStep(stepForType('expense'));
    // TASK-009：退出返回不清类别——sessionPickedIds（本次选过的）/recentCategoryIds（本地历史）
    // /categoryId（当前选中）全部保留，回来网格和选中态原样恢复；只清表单内容
    setAmount('');
    amountExpr.reset();
    setAmountKeypadOpen(true);
    setNote('');
    setDate(todayStr());
    // 重置后恢复"自动跟随默认账户"（金额币种只认所选账户，无需复位手动币种）
    userPickedAssetRef.current = false;
    userPickedFromRef.current = false;
    setAssetId(defaultAsset?.id ?? null);
    setAssetPickerOpen(false);
    setFromAssetId(defaultAsset?.id ?? null);
    setToAssetId(null);
    setExchangeRate('');
    setFee('');
    rateExpr.reset();
    feeExpr.reset();
    setAmountCursor(0);
    setRateCursor(0);
    setFeeCursor(0);
    setCalculatorTarget('amount');
    setReceiptUri(null);
    // 自动月结开关复位为关：默认关闭，每次回来都要手动开启
    setAutoMonthly(false);
    // 离开页面时可能还开着的弹层一并关掉，回来才是干净的初始状态
    setAccountPickerOpen(false);
    setCurrencyDropOpen(false);
    setCurrencyFilter('all');
    setDateSheetOpen(false);
    setDatePickerOpen(false);
    setReceiptPreviewOpen(false);
  };

  // 底部Tab导航默认会把没聚焦的页面状态一直留着（不会卸载重建），
  // 所以"切走再切回来表单清空"这个效果得主动做：监听"离开这个页面"（blur），
  // 一旦离开就立刻重置——这样不管用户是切到别的Tab、还是从"记一笔"跳去创建资产账户，
  // 只要真的离开过这个页面，回来看到的都是干净的新表单。
  // 编辑已有账单（isEditing）时不重置，避免正常编辑流程里出现的跳转（比如点"类别"、"资产"字段）把编辑中的内容清掉。
  // 另外正在"选择类别"步骤（step === 'category'）时也不重置：此时点「＋ 添加」会 push 类别分类页，
  // push 会触发本页 blur——如果这里重置了 step，goBack 弹回来就变成记账表单而不是选择类别页。
  useEffect(() => {
    if (!navigation?.addListener) return;
    const unsubscribe = navigation.addListener('blur', () => {
      if (!isEditing && step !== 'category') {
        resetAll();
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, isEditing]);

  // 备注框是真实 TextInput，聚焦时弹出的是系统键盘——这跟 amountKeypadOpen（自绘计算器面板）
  // 是两码事，之前只盯着 amountKeypadOpen 一个条件，备注聚焦、系统键盘弹起来的时候
  // Tab bar 完全没被强制隐藏。转账/兑换这个页面内容本来就不长，可滚动的距离经常不够
  // 60px（滚动隐藏逻辑触发的最小距离），所以单靠"滚动去触发隐藏"这条路常常根本走不通——
  // 真正该盯的信号是"系统键盘是不是弹出来了"，而不是"滚了多少像素"。
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // 备注框聚焦标记：系统键盘此刻是"面板内备注框"弹的——这是唯一允许系统键盘与
  // 自绘面板共存的场景，keyboardDidShow 时不能把面板收掉（否则备注框随面板卸载、
  // 系统键盘跟着掉下来、面板又被 keyboardDidHide 弹回来，两套键盘互相卡死）
  const noteFocusRef = useRef(false);
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardVisible(true);
      setKeyboardHeight(e?.endCoordinates?.height ?? 0);
      keyboardHeightRef.current = e?.endCoordinates?.height ?? 0;
      // TASK-016⑥：内联小卡输入框聚焦中 → 键盘弹起后按真实高度校正滚动位置
      if (isFocused && inlineFocusGroupRef.current) {
        scrollInlineInputIntoView(inlineFocusGroupRef.current, keyboardHeightRef.current);
      }
      // 系统键盘弹出 → 自绘面板收起让位；但备注框聚焦的共存场景例外
      if (isFocused && !noteFocusRef.current) setAmountKeypadOpen(false);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
      keyboardHeightRef.current = 0;
      // 系统键盘收起 → 自绘面板重新出现（含 Android 返回键收起键盘的情况）
      if (isFocused && !noteFocusRef.current) setAmountKeypadOpen(true);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [isFocused]);

  // （可见容量计算已上移至 gridPinned 之前——TASK-024：gridPinned 补齐要用 gridMaxCount）

  // 最终网格：容量裁剪兜底——能放几格显示几格，「全部」永远殿后可见；
  // 当前选中的类别若被裁掉则强制保留（替换末尾一格），保证选中态高亮在网格里可见
  // ---------- 可见容量（宽度感知装箱版，2026-09-25 字号14批次）----------
  // 胶囊改 minWidth 自适应后，4 字名（如「贷款还款」≈97）比网格宽（≈78），
  // 旧计数容量(rows×cols−1)会高估行容量——「全部」被挤到裁剪线外一行悬空。
  // 这里按字符估宽模拟真实装箱：容器宽内逐格横排、放不下换行；
  // 超过可见行数就从尾部丢类别，保证「全部」永远落在最后一行的行尾
  // （=用户定版：全部前一个类别被全部替代）。
  // ⚠纯估算、不回流测量——避免 TASK-009 记录过的 measure→trim→remeasure 正反馈循环。
  // ⚠估宽常量与样式同步：label 14 号（CJK 全宽 14/半角 8）、图标座23+右距4+横padding12+边框2=41
  const gridContentW = winW - 36; // categoryChipGrid paddingHorizontal 18×2
  const chipWidthOf = useCallback((c: Category) => {
    const label = getCategoryLabel(c, t);
    let textW = 0;
    for (const ch of label) textW += ch.charCodeAt(0) > 0x2e80 ? 14 : 8;
    return Math.max(categoryChipW, 41 + Math.ceil(textW) + 1);
  }, [categoryChipW, t]);

  const displayCategories = useMemo(() => {
    const withSelected =
      selectedCategory && !gridPinned.some((c) => c.id === selectedCategory.id)
        ? [selectedCategory, ...gridPinned]
        : gridPinned;
    // 首帧（可见行数未知）：退回旧的计数裁剪兜底
    if (gridVisibleRows == null) {
      if (gridMaxCount == null || withSelected.length + 1 <= gridMaxCount) return withSelected;
      const base = withSelected.slice(0, gridMaxCount);
      if (selectedCategory && !base.some((c) => c.id === selectedCategory.id)) {
        base[base.length - 1] = selectedCategory;
      }
      return base;
    }
    // 宽度感知装箱：放不下「全部」就从尾部丢，丢完保持「选中项可见」的既有规则
    const list = [...withSelected];
    const rowsNeeded = (items: Category[]) => {
      let rows = 1;
      let w = 0;
      for (const c of items) {
        const cw = chipWidthOf(c);
        if (w > 0 && w + 5 + cw > gridContentW) {
          rows++;
          w = cw;
        } else {
          w = w > 0 ? w + 5 + cw : cw;
        }
      }
      if (w > 0 && w + 5 + categoryChipW > gridContentW) rows++; // 「全部」固定宽 categoryChipW
      return rows;
    };
    while (list.length > 0 && rowsNeeded(list) > gridVisibleRows) list.pop();
    if (selectedCategory && list.length > 0 && !list.some((c) => c.id === selectedCategory.id)) {
      list[list.length - 1] = selectedCategory;
    }
    return list;
  }, [gridPinned, selectedCategory, gridMaxCount, gridVisibleRows, chipWidthOf, categoryChipW, gridContentW]);

  // 计算器键盘和浮空 Tab bar 在同一块屏幕区域，键盘展开时强制把 Tab bar 收起，
  // 键盘收起（按完成、或者切到别的表单）时恢复——避免两者叠在一起互相挡住点击
  //
  // 关键：一定要判断 isFocused。"记一笔"这个屏幕在 App.tsx 里注册了两次
  // （底部Tab中间按钮 + HomeStack 里编辑用的那个），底部Tab那个默认不会因为
  // 切走就卸载，会一直挂在内存里。如果不判断 isFocused，这个"看不见"的实例
  // 光是初始 amountKeypadOpen=true 就会在App启动时偷偷把全局 forced 设成 true，
  // 之后不管你在哪个页面，Tab bar 的滚动隐藏逻辑全都会被这个跟当前画面无关的
  // 状态卡住——这正是"进页面弹计算器Tab bar还在"/"完成后Tab bar消失不回来"这类
  // 看起来随机、其实是两个实例互相抢状态的根源。
  //
  // 三个来源都会挡住底部：自绘计算器面板（amountKeypadOpen）、系统键盘（keyboardVisible）、
  // 键盘日期键弹出的 DateRangePickerSheet（datePickerOpen——之前它开/关时会把 Tab 栏放出来，
  // 选完日期正好挡住计算器面板）。任一开着就强制隐藏，全部关了才交还控制权。
  useEffect(() => {
    if (!isFocused) return; // 没在前台的实例，不该去动全局 Tab bar 状态
    setTabBarForceHidden(amountKeypadOpen || keyboardVisible || datePickerOpen);
    // 注意：释放动作不挂在这里的 cleanup 上——每次键盘/日期弹层开关都会先跑 cleanup
    // 把栏放出来再收回，Tab 栏会在间隙里跳出来。释放只在下面的失焦 effect 里做。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountKeypadOpen, keyboardVisible, datePickerOpen, isFocused]);

  // 失焦（切走/卸载）时才把强制隐藏交还回去
  useEffect(() => {
    if (!isFocused) {
      setTabBarForceHidden(false);
    }
    return () => setTabBarForceHidden(false);
  }, [isFocused]);

  const handlePickCategory = (id: string) => {
    setCategoryId(id);
    // TASK-022 补充：编辑账单时点类别只改这一笔，绝不写持久化键——
    // 否则会污染"记一笔（新增）"记住的默认类别（编辑模式自己又不读这个键，表现为两边不同步）
    if (!isEditing) {
      // 按类型持久化"最后选中"（杀进程重启后自动恢复）；transfer/exchange 不记
      if (uiType === 'expense' || uiType === 'income') {
        AsyncStorage.getItem(LAST_CATEGORY_KEY)
          .then((raw) => {
            const last = raw ? JSON.parse(raw) : {};
            last[uiType] = id;
            AsyncStorage.setItem(LAST_CATEGORY_KEY, JSON.stringify(last)).catch(() => {});
          })
          .catch(() => {});
      }
      // 新选的类别进入网格固定格（置顶、自动 +1 格）；已在网格里的旧类别不动格位。
      // 固定格同步持久化（SESSION_PICKED_KEY），重启后网格原样恢复
      setSessionPickedIds((prev) => {
        const next = [id, ...prev.filter((x) => x !== id)];
        if (uiType === 'expense' || uiType === 'income') {
          AsyncStorage.getItem(SESSION_PICKED_KEY)
            .then((raw) => {
              const saved = raw ? JSON.parse(raw) : {};
              saved[uiType] = next;
              AsyncStorage.setItem(SESSION_PICKED_KEY, JSON.stringify(saved)).catch(() => {});
            })
            .catch(() => {});
        }
        return next;
      });
    }
    setStep('detail');
  };

  // 支出/收入保存的公共逻辑，返回是否保存成功（校验不过时不弹走）
  // amountOverride：计算器键盘刚算完结果、还没来得及走完 setAmount 的下一次渲染就要保存时，
  // 直接把算出来的数传进来，不依赖 state 更新时序，避免"刚打完字点完成，存的却是上一笔的金额"
  const saveTransaction = async (amountOverride?: number) => {
    const value = amountOverride ?? parseFloat(amount);
    if (!value || value <= 0) {
      dialog.alert({ title: t('addTx.enterValidAmount') });
      return false;
    }
    if (!categoryId) {
      dialog.alert({ title: t('addTx.selectCategoryAlert') });
      return false;
    }
    // 账户必选：没选账户不允许保存（转账/兑换走各自的 from/to 校验，不经过这里）
    if (!isEditing && !assetId) {
      dialog.alert({ title: t('addTx.selectAssetAlert') });
      return false;
    }
    if (isEditing && editTransaction) {
      await updateTransaction(editTransaction.id, {
        amount: value,
        categoryId,
        type: type as 'expense' | 'income',
        date,
        note,
        assetId: assetId ?? undefined,
        receiptUri: receiptUri ?? undefined,
      });
    } else {
      await addTransaction({
        amount: value,
        categoryId,
        type: type as 'expense' | 'income',
        date,
        note,
        assetId: assetId ?? undefined,
        receiptUri: receiptUri ?? undefined,
      });
    }
    // "最近用过"只在这一笔真的记完账之后才更新，点击/切换类别选择本身不算——
    // 这样横排那4个分类在你填表的过程中不会因为点了别的类别就跳位置
    bumpRecentCategory(categoryId);

    // 自动月结：开关打开（默认关，手动开）时，把这笔账同步建成一条「每月同日自动入账」的
    // 财务规划——之后每个月由补账引擎自动 ±账目。防重复：同名称+同金额+同周期+同账户的计划已存在则跳过
    if (!isEditing && autoMonthly) {
      const planName = note.trim() || (selectedCategory ? getCategoryLabel(selectedCategory, t) : (type === 'income' ? t('finance.typeIncome') : t('finance.typeExpense')));
      const alreadyPlanned = paymentPlans.some(
        (p) => p.cycle === 'monthly' && p.amount === value && p.name === planName && p.assetId === (assetId ?? undefined)
      );
      if (!alreadyPlanned) {
        void addPaymentPlan({
          ledgerId: activeLedgerId,
          name: planName,
          amount: value,
          type: type as 'expense' | 'income',
          cycle: 'monthly',
          dayOfMonth: Math.min(31, Math.max(1, Number(date.slice(8, 10)) || 1)),
          startDate: date,
          autoDeduct: true,
          categoryId: categoryId,
          assetId: assetId ?? undefined,
          active: true,
        } as any);
      }
    }

    return true;
  };

  // 编辑页右上角垃圾桶：确认后删除这笔账并返回列表
  const handleDeleteTransaction = () => {
    if (!isEditing || !editTransaction) return;
    dialog.alert({
      title: t('addTx.deleteTxTitle'),
      message: t('addTx.deleteTxMsg'),
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            hapticWarning();
            deleteTransaction(editTransaction.id);
            navigation?.goBack();
          },
        },
      ],
    });
  };

  // 把计算器表达式算出来的结果写回 amount。键盘现在是常驻的（保存键一直露在外面），
  // 点"完成"/长按"完成"/点键盘以外的地方都只是"把这个数定下来"，不会再把键盘收起去
  const commitAmount = () => {
    const total = amountExpr.confirm();
    setAmount(total.toFixed(2));
    return total;
  };

  // 计算器键盘的"完成"键现在就是保存键：点一下＝算出金额、保存这一笔（键盘不用收起，保存键一直都在）
  // 加 try/catch 是因为：这是个 async 函数，如果内部（amountExpr.confirm / addTransaction 等）
  // 抛出异常又没人接住，Promise 会变成"未处理的 rejection"——不会崩溃，也不会有任何提示，
  // 表现出来就是点了"完成"完全没反应。这里统一兜底，出问题至少能看到是哪里错了。
  const handleKeypadConfirm = async () => {
    try {
      const total = commitAmount();
      const ok = await saveTransaction(total);
      if (ok) {
        hapticSuccess();
        if (isEditing) {
          navigation?.goBack();
        } else {
          resetAll();
          navigation?.navigate(ROUTES.TAB_HOME);
        }
      }
    } catch (err) {
      console.error('保存失败:', err);
      dialog.alert({ title: t('addTx.saveFailed'), message: err instanceof Error ? err.message : String(err) });
    }
  };

  // 长按"完成"＝保存这一笔之后不退出，留在本页直接记下一笔
  // （原来"保存并继续记一笔"按钮做的事，现在挪到这个长按手势上；编辑模式下不会用到）
  const handleKeypadConfirmAndContinue = async () => {
    try {
      const total = commitAmount();
      const ok = await saveTransaction(total);
      if (ok) {
        hapticSuccess();
        resetAll();
      }
    } catch (err) {
      console.error('保存失败:', err);
      dialog.alert({ title: t('addTx.saveFailed'), message: err instanceof Error ? err.message : String(err) });
    }
  };

  // Enter/下一步箭头已由小数点键取代（标准金额录入）；备注框常驻在计算器面板里可随时点

  // 转账/兑换字段统一走同一个计算器。只有编辑“转出金额”时，完成键才会保存整笔记录；
  // 汇率/手续费完成键只负责把计算结果写回对应字段，不会提前保存。
  const openTransferCalculator = (target: 'amount' | 'rate' | 'fee') => {
    // 备注框的系统键盘/光标退场：一次只允许一个光标显示（点自绘字段 = 切换输入焦点）
    noteInputRef.current?.blur();
    // 切换到另一个字段之前，先把当前正在编辑、还没确认的算式定下来——
    // 不然直接点别的格子（比如输入了500转出金额，手滑点了汇率格子）会导致
    // 刚输入的值从没写回 amount/exchangeRate/fee 这几个 state，显示直接跳回 0
    if (amountKeypadOpen && calculatorTarget !== target) {
      commitTransferField();
    }
    setCalculatorTarget(target);
    // 打开键盘即从空态起输：按 5 就是 5 元，新输入直接替换旧值（不再从尾部续接）
    if (target === 'amount') { amountExpr.reset(); setAmountCursor(0); }
    if (target === 'rate') { rateExpr.reset(); setRateCursor(0); }
    if (target === 'fee') { feeExpr.reset(); setFeeCursor(0); }
    setAmountKeypadOpen(true);
    scrollToField(target);
  };

  // 转账/兑换计算器统一的"定下当前这一格的值"，不负责收起键盘——理由同上，键盘常驻
  const commitTransferField = () => {
    if (calculatorTarget === 'amount') {
      const total = amountExpr.confirm();
      setAmount(total.toFixed(2));
      return total;
    }
    if (calculatorTarget === 'rate') {
      const value = rateExpr.confirm();
      setExchangeRate(value.toString());
      return value;
    }
    const value = feeExpr.confirm();
    setFee(value.toString());
    return value;
  };

  // 同样的道理：这是 async 函数，内部任何一步抛错都可能悄无声息地失败，这里统一兜底弹出来
  //
  // 之前这里写死成"只有停在金额这一格，完成才会保存"——但兑换默认要经过
  // 金额→汇率→手续费三格，用户打完汇率或手续费之后顺手点"完成"（并没有特意跳回金额格）
  // 是最常见的操作路径，这种情况以前会直接掉进 commitTransferField() 就 return 了，
  // 界面上什么反应都没有，跟没点一样。现在改成：不管停在哪一格，"完成"都先把这一格定下来，
  // 再拿着这个刚算出来的值去尝试保存整笔——跟支出/收入那边"完成＝保存"保持一致语义。
  const handleTransferCalculatorConfirm = async () => {
    try {
      const committed = commitTransferField();
      const ok = await handleSaveTransferWithAmount(
        calculatorTarget === 'amount' ? committed : undefined,
        {
          rateOverride: calculatorTarget === 'rate' ? committed : undefined,
          feeOverride: calculatorTarget === 'fee' ? committed : undefined,
        }
      );
      // 校验没过（比如还没选转入账户）时 ok 是 undefined：commitTransferField 已经把这一格的值
      // 写回 state 了，保留着不用回滚，用户能看到刚打的数字，去把没填的部分填完再点一次就行
      void ok;
    } catch (err) {
      console.error('保存失败:', err);
      dialog.alert({ title: t('addTx.saveFailed'), message: err instanceof Error ? err.message : String(err) });
    }
  };

  // 长按"完成"＝保存后留在本页继续记下一笔转账/兑换，跟支出/收入那边是同一个概念；
  // 跟上面单击"完成"一样，不再局限于"必须停在金额格"才生效
  const handleTransferCalculatorConfirmAndContinue = async () => {
    try {
      const committed = commitTransferField();
      await handleSaveTransferWithAmount(
        calculatorTarget === 'amount' ? committed : undefined,
        {
          continueRecording: true,
          rateOverride: calculatorTarget === 'rate' ? committed : undefined,
          feeOverride: calculatorTarget === 'fee' ? committed : undefined,
        }
      );
    } catch (err) {
      console.error('保存失败:', err);
      dialog.alert({ title: t('addTx.saveFailed'), message: err instanceof Error ? err.message : String(err) });
    }
  };

  // amountOverride/rateOverride/feeOverride：三个都是可选的"这一格刚算出来、
  // 还没等 state 更新生效"的即时值——跟原来只有 amount 有这个保护是一个道理，
  // 现在汇率/手续费格点"完成"也要能直接保存，一样会撞上同样的时序坑，所以一起补上
  const handleSaveTransferWithAmount = async (
    amountOverride?: number,
    options?: { continueRecording?: boolean; rateOverride?: number; feeOverride?: number }
  ) => {
    const value = amountOverride ?? parseFloat(amount);
    if (!value || value <= 0) {
      dialog.alert({ title: t('addTx.transferAmountInvalid') });
      return;
    }
    if (!fromAssetId || !toAssetId) {
      dialog.alert({ title: t('addTx.selectBothAccounts') });
      return;
    }
    if (fromAssetId === toAssetId) {
      dialog.alert({ title: t('addTx.sameAccount') });
      return;
    }
    const rate = showRateField ? (options?.rateOverride ?? parseFloat(exchangeRate)) : 1;
    if (showRateField && (!rate || rate <= 0)) {
      dialog.alert({ title: t('addTx.rateInvalid') });
      return;
    }
    const feeValue = options?.feeOverride ?? (parseFloat(fee) || 0);
    // 备注同下面这行一起搬进了键盘面板，小票(收据)现在转账/兑换也能附了——
    // 如果 addTransfer 的类型定义里还没有 receiptUri 字段，需要先在那边补上
    await addTransfer({
      fromAssetId,
      toAssetId,
      amount: value,
      exchangeRate: rate,
      fee: feeValue,
      date,
      note,
      receiptUri: receiptUri ?? undefined,
    });
    resetAll();
    // 长按"完成"＝保存后继续记下一笔，留在本页；普通点击才退出到首页
    if (!options?.continueRecording) {
      navigation?.navigate(ROUTES.TAB_HOME);
    }
    return true;
  };

  const handleSaveTransfer = () => handleSaveTransferWithAmount();

  // ---------- 扫描小票 ----------
  // 纯云端模式：统一走云端 OCR 解析（本地 AICore 模块已移除，ML Kit GenAI 依赖在
  // EAS 上无法解析——公开仓库不含该 artifact，恢复本地模式时从 Zcode 备份取回）
  const runScan = async (base64: string, uri: string) => {
    setScanning(true);
    try {
      const result = await scanReceipt(base64);

      setUiType(result.type);

      if (result.suggestedCategory) {
        // AI 提示词固定中文，返回的是中文分类名 → 先映射成内置分类 id 再按 id 匹配，
        // 与界面语言（中文/英文）无关；AI 不会建议用户自建分类，不再按存储名兜底
        const suggestedId = findCategoryIdByChineseName(result.suggestedCategory);
        const matched = suggestedId
          ? categories.find((c) => c.type === result.type && c.id === suggestedId)
          : undefined;
        if (matched) setCategoryId(matched.id);
      }
      if (result.amount != null) {
        setAmount(String(result.amount));
        amountExpr.reset(result.amount);
      }
      if (result.date) setDate(result.date);
      if (result.merchant) setNote(result.merchant);
      // 扫描用的这张照片本身就是单据，顺手存成凭证，不用用户再拍一次
      setReceiptUri(uri);

      setStep('detail');

      if (result.amount == null) {
        dialog.alert({ title: t('common.confirm'), message: t('addTx.scanNoAmount') });
      }
    } catch (e: any) {
      dialog.alert({ title: t('addTx.scanFailed'), message: e?.message ?? t('addTx.scanFailed') });
    } finally {
      setScanning(false);
    }
  };

  // 拍小票用自绘相机（ReceiptCameraModal），不再调系统相机 App。
  // 'scan' = 扫描小票走 OCR 识别；'receipt' = 单纯留档附凭证，不识别。
  // 两个入口共用同一个相机页面，用这个字段区分拍完之后要干嘛
  const [cameraMode, setCameraMode] = useState<'scan' | 'receipt' | null>(null);

  const handleScanPress = () => {
    setCameraMode('scan');
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      dialog.alert({ title: t('addTx.photoPermissionTitle'), message: t('addTx.photoPermissionMsg') });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, base64: true });
    if (!result.canceled && result.assets?.[0]?.base64 && result.assets?.[0]?.uri) {
      runScan(result.assets[0].base64, result.assets[0].uri);
    }
  };

  // ---------- 凭证附件：单纯留档用的原始单据照片，不走AI识别 ----------
  const handleAttachReceipt = () => {
    setCameraMode('receipt');
  };

  const pickReceiptFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      dialog.alert({ title: t('addTx.photoPermissionTitle'), message: t('addTx.photoPermissionMsg') });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
    if (!result.canceled && result.assets?.[0]?.uri) setReceiptUri(result.assets[0].uri);
  };

  if (scanning) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}>
        <View style={styles.scanningWrap}>
          <ActivityIndicator size="large" color={colors.icon} />
          <Text style={styles.scanningText}>{t('addTx.aiScanning')}</Text>
        </View>
      </SafeAreaView>
    );
  }


  const TYPE_TABS: { key: UiType; label: string }[] = [
    { key: 'expense', label: t('addTx.expense') },
    { key: 'income', label: t('addTx.income') },
    { key: 'transfer', label: t('addTx.transfer') },
    { key: 'exchange', label: t('addTx.exchange') },
  ];

  // 转账/兑换账户选择已改为当前页面内的弹层菜单，直接进入金额表单。

  // ---------- 转账/兑换：填金额/汇率/手续费 ----------
  if (type === 'transfer' && step === 'transferDetail') {
    const fromSymbol = getCurrencySymbol(fromAsset?.currency ?? currency);
    const toSymbol = getCurrencySymbol(toAsset?.currency ?? currency);    const rateNum = parseFloat(exchangeRate) || 0;
    const amountNum = parseFloat(amount) || 0;
    const feeNum = parseFloat(fee) || 0;
    // 正在哪个格子上打字，到账金额就实时用那个格子键盘上当前的数字算，不用等按"完成"——
    // parseFloat 遇到还没打完的算式（比如"12+"）只会取到已经能解析的那一段，
    // 这是能不依赖 useAmountExpression 内部状态、又不用等 confirm() 的前提下能做到的最好效果
    const liveAmountNum = calculatorTarget === 'amount' && amountKeypadOpen ? parseFloat(amountExpr.displayValue) || 0 : amountNum;
    const liveRateNum = calculatorTarget === 'rate' && amountKeypadOpen ? parseFloat(rateExpr.displayValue) || 0 : rateNum;
    const liveFeeNum = calculatorTarget === 'fee' && amountKeypadOpen ? parseFloat(feeExpr.displayValue) || 0 : feeNum;
    // 手续费从转出金额里先扣掉，剩下的部分才拿去换算成到账金额（普通转账没有汇率，等于 rate=1）
    const netAmount = Math.max(0, liveAmountNum - liveFeeNum);
    const converted = showRateField ? (netAmount * liveRateNum).toFixed(2) : netAmount.toFixed(2);

    return (
      <EdgeBackSwipe onBack={edgeBackHome}>
      <SafeAreaView style={styles.container} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}>
        <View style={{ flex: 1 }}>
        {/* 顶部与收入/支出完全统一：返回 + 四个类型 Tab + 扫票 */}
        <View style={styles.txHeaderRow}>
          <TouchableOpacity
            style={styles.txHeaderBackBtn}
            onPress={() => navigation?.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={22} color={colors.icon} style={{ fontWeight: "700" }} />
          </TouchableOpacity>
          <View style={styles.txHeaderTypeSwitch}>
            {TYPE_TABS.map((t, idx) => (
              <React.Fragment key={t.key}>
                {/* 格间竖分割线：一体框格内的分格标记 */}
                {idx > 0 && <View style={styles.txHeaderTypeDivider} />}
                <Pressable
                  style={({ pressed }) => [
                    styles.txHeaderTypeBtn,
                    uiType === t.key && styles.txHeaderTypeBtnActive,
                    pressed && (uiType === t.key ? styles.txHeaderTypeBtnSinkActive : styles.txHeaderTypeBtnSink),
                  ]}
                  onPress={() => {
                    hapticSelection();
                    setUiType(t.key);
                    setCategoryId(null);
                    setStep(stepForType(t.key));
                  }}
                >
                  <Text
                    style={[styles.txHeaderTypeText, uiType === t.key && styles.txHeaderTypeTextActive]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                  >
                    {t.label}
                  </Text>
                  {/* 底线：标记当前所在页面 */}
                  {uiType === t.key && <View style={styles.txHeaderTypeUnderline} />}
                </Pressable>
              </React.Fragment>
            ))}
          </View>
          {/* 转账/兑换不做扫票识别：按钮隐藏，但用同尺寸的透明占位保住排版不变 */}
          <View style={[styles.txHeaderScanBtn, { opacity: 0 }]} pointerEvents="none">
            <Ionicons name="camera-outline" size={13} color={colors.link} style={{ marginRight: 4 }} />
            <Text style={styles.txHeaderScanBtnText}>{t('addTx.scanReceipt')}</Text>
          </View>
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={{ flex: 1 }}
          onScroll={onTabScroll ?? undefined}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.exchangePageContent,
            // 键盘面板是常驻底部 footer，页面内容现在正好一屏放下：
            // 键盘开着时只留一点点底部空隙让内容紧贴键盘上方，不再撑出多余的滚动空间；
            // 键盘没开（极端情况）才回退到悬浮 Tab 栏的让位留白
            { paddingBottom: amountKeypadOpen ? 16 : tabClearance + 36 },
          ]}
        >
          {/* FROM / TO 账户卡：对应参考图顶部的资金流向卡 */}
          <View style={styles.transferRouteCard}>
            <View style={styles.transferRouteTopRow}>
              <Text style={styles.transferRouteHint}>{t('addTx.fundFlow')}</Text>
              <View style={styles.transferStatusPill}>
                <View style={styles.transferStatusDot} />
                <Text style={styles.transferStatusText}>{t('addTx.instantRecord')}</Text>
              </View>
            </View>

            <View style={styles.transferRouteRow}>
              <TouchableOpacity
                style={styles.transferAccountBlock}
                activeOpacity={0.72}
                // 实测转账账户块的真实渲染宽度，同步给支出/收入页的账户选择框——
                // 两页切换时框格宽度像素级一致（手算公式会被描边/字渲染等细节带偏）
                onLayout={(e) => {
                  const w = e.nativeEvent.layout.width;
                  setTransferBlockW((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
                }}
                onPress={() => {
                  setAccountPickerRole('from');
                  setAccountSearch('');
                  setAccountFilter('all');
                  setCurrencyFilter('all');
                  setAccountPickerOpen(true);
                }}
              >
                <Text style={styles.transferAccountCaption}>{t('addTx.outAccount')}</Text>
                <View style={styles.transferAccountMain}>
                  <View style={[styles.transferAccountIcon, { backgroundColor: (fromAsset?.color ?? colors.link) + '20' }]}>
                    <Ionicons name={(fromAsset?.icon as IconName) ?? 'wallet-outline'} size={20} color={fromAsset?.color ?? colors.link} />
                  </View>
                  <View style={styles.transferAccountInfo}>
                    <Text style={styles.transferAccountName} numberOfLines={1}>{fromAsset?.name ?? t('common.notSelected')}</Text>
                  </View>
                </View>
                <Ionicons name="chevron-down" size={12} color={colors.textTertiary} style={styles.transferAccountChevron} />
              </TouchableOpacity>

              {/* 中间按钮：点击互换转出/转入两个账户 */}
              <TouchableOpacity
                style={styles.transferRouteArrow}
                activeOpacity={0.7}
                onPress={() => {
                  hapticLight();
                  // 互换是显式操作，之后转出账户不再自动跟随默认账户变化
                  userPickedFromRef.current = true;
                  setFromAssetId(toAssetId);
                  setToAssetId(fromAssetId);
                }}
              >
                <Ionicons name="swap-horizontal" size={18} color={colors.link} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.transferAccountBlock, styles.transferAccountBlockRight]}
                activeOpacity={0.72}
                onPress={() => {
                  setAccountPickerRole('to');
                  setAccountSearch('');
                  setAccountFilter('all');
                  setCurrencyFilter('all');
                  setAccountPickerOpen(true);
                }}
              >
                <Text style={[styles.transferAccountCaption, styles.transferAccountCaptionRight]}>{t('addTx.inAccount')}</Text>
                <View style={styles.transferAccountMain}>
                  <View style={styles.transferAccountInfoRight}>
                    <Text style={styles.transferAccountName} numberOfLines={1}>{toAsset?.name ?? t('common.notSelected')}</Text>
                  </View>
                  <View style={[styles.transferAccountIcon, { backgroundColor: (toAsset?.color ?? colors.link) + '20' }]}>
                    <Ionicons name={(toAsset?.icon as IconName) ?? 'wallet-outline'} size={20} color={toAsset?.color ?? colors.link} />
                  </View>
                </View>
                <Ionicons name="chevron-down" size={12} color={colors.textTertiary} style={styles.transferAccountChevronRight} />
              </TouchableOpacity>
            </View>

          </View>

          {/* 转账和兑换/跨币种转账统一用同一套网格排版：
              第一行左边永远是可编辑的"转出金额"，右边是根据 converted 算出来的只读金额
              （兑换叫"到账"、普通转账叫"转入金额"，本质是同一个数——普通转账走 !showRateField
              时 converted 就是 amount 本身，天然 1:1，不用额外分支处理数值）。
              第二行：有汇率就分左右两格（汇率/手续费）；普通转账没有汇率，手续费独占一整行。 */}
          <View
            style={styles.exchangeRateCard}
            onLayout={(e) => {
              fieldY.current['cardTop'] = e.nativeEvent.layout.y;
            }}
          >
            <Text style={styles.exchangeRateTitle}>{showRateField ? t('addTx.exchangeRate') : t('addTx.transfer')}</Text>

            {/* 第一行：左边转出金额输入框，右边到账/转入金额（只读展示） */}
            <View style={styles.rateGridRow}>
              <TouchableOpacity
                style={styles.rateGridCellLeft}
                activeOpacity={0.8}
                onPress={() => openTransferCalculator('amount')}
                onLayout={(e) => {
                  const cardY = fieldY.current['cardTop'] ?? 0;
                  fieldY.current['amount'] = cardY + e.nativeEvent.layout.y;
                }}
              >
                <View style={styles.rateGridLabelRow}>
                  <Text style={styles.rateGridLabel}>{t('addTx.outAmount')}</Text>
                  {/* 后置货币提示贴在"转出金额"标签右侧：选了转出账户才显示，不与金额数字碰撞 */}
                  {fromAsset && <Text style={styles.rateGridLabelSuffix}>({fromAsset.currency})</Text>}
                </View>
                <View style={styles.rateGridValueRow}>
                  <CursorAmountText
                    display={calculatorTarget === 'amount' && amountKeypadOpen ? amountExpr.displayValue : amount || '0.00'}
                    enabled={calculatorTarget === 'amount' && amountKeypadOpen}
                    cursorFromEnd={amountCursor}
                    onCursorChange={setAmountCursor}
                    style={styles.rateGridValue}
                    cursorStyle={styles.rateCursor}
                  />
                </View>
              </TouchableOpacity>

              {/* 分隔竖线：兑换/普通转账都渲染——转账没有汇率时这条线就是转出与转入的分界；
                  大金额换行时线跟随格子布局，两种货币不会撞在一起 */}
              <View style={styles.rateGridDividerVertical} />

              {showRateField ? (
                <>
                  <TouchableOpacity
                    style={styles.rateCenterCell}
                    activeOpacity={0.75}
                    onPress={() => openTransferCalculator('rate')}
                    onLayout={(e) => {
                      const cardY = fieldY.current['cardTop'] ?? 0;
                      fieldY.current['rate'] = cardY + e.nativeEvent.layout.y;
                    }}
                  >
                    <Text style={styles.rateCenterLabel}>{t('addTx.rate')}</Text>
                    <View style={styles.rateGridValueRow}>
                      <Text style={styles.rateFieldValue}>×</Text>
                      <CursorAmountText
                        display={calculatorTarget === 'rate' && amountKeypadOpen ? rateExpr.displayValue : exchangeRate || '0.00'}
                        enabled={calculatorTarget === 'rate' && amountKeypadOpen}
                        cursorFromEnd={rateCursor}
                        onCursorChange={setRateCursor}
                        style={styles.rateFieldValue}
                        cursorStyle={styles.rateCursor}
                      />
                      <Ionicons name="calculator-outline" size={12} color={colors.link} style={styles.rateGridCalcIcon} />
                    </View>
                  </TouchableOpacity>
                  <View style={styles.rateGridDividerVertical} />
                </>
              ) : null}

              <View style={styles.rateGridCellRight}>
                <View style={styles.rateGridLabelRow}>
                  <Text style={styles.rateGridLabel}>{showRateField ? t('addTx.receivedLabel') : t('addTx.inAmountLabel')}</Text>
                  {/* 后置货币提示贴在标签右侧：选了转入账户才显示，不与金额数字碰撞 */}
                  {toAsset && <Text style={styles.rateGridLabelSuffix}>({toAsset.currency})</Text>}
                </View>
                <View style={styles.rateGridValueRow}>
                  <Text style={[styles.rateGridValue, showRateField ? styles.rateGridValueTo : styles.rateGridValueTransfer]}>{converted}</Text>
                </View>
              </View>
            </View>

            <View style={styles.exchangeRateDivider} />

            {/* 第二行：手续费独占一整行——兑换和普通转账统一用同一套整行布局，大小完全一致 */}
            <View
              style={styles.transferMetaNoteRow}
              onLayout={(e) => {
                const cardY = fieldY.current['cardTop'] ?? 0;
                fieldY.current['fee'] = cardY + e.nativeEvent.layout.y;
              }}
            >
              <View style={styles.transferMetaLeft}>
                <Ionicons name="receipt-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.transferMetaLabel}>{t('addTx.fee')}</Text>
              </View>
              <TouchableOpacity
                style={styles.transferFeeValueButton}
                activeOpacity={0.75}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                onPress={() => openTransferCalculator('fee')}
              >
                <CursorAmountText
                  display={calculatorTarget === 'fee' && amountKeypadOpen ? feeExpr.displayValue : (feeNum > 0 ? `${fromSymbol}${feeNum.toFixed(2)}` : t('common.optional'))}
                  enabled={calculatorTarget === 'fee' && amountKeypadOpen}
                  cursorFromEnd={feeCursor}
                  onCursorChange={setFeeCursor}
                  style={[styles.transferFeeValue, ...(feeNum > 0 ? [styles.transferFeeValueActive] : [])]}
                  cursorStyle={styles.feeCursor}
                />
                <Ionicons name="calculator-outline" size={15} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>

            {/* 填了手续费就提示：手续费先从转出金额里扣掉——兑换的到账是"扣完再按汇率换算"，
                普通转账则直接按扣完的金额到账 */}
            {liveFeeNum > 0 && (
              <View style={styles.exchangeFeeHintRow}>
                <Ionicons name="information-circle-outline" size={12} color={colors.textTertiary} />
                <Text style={styles.exchangeFeeHintText} numberOfLines={2}>
                  {showRateField
                    ? t('addTx.feeDeductExchange', { fee: `${fromSymbol}${liveFeeNum.toFixed(2)}`, net: `${fromSymbol}${netAmount.toFixed(2)}` })
                    : t('addTx.feeDeductTransfer', { fee: `${fromSymbol}${liveFeeNum.toFixed(2)}`, net: `${toSymbol}${netAmount.toFixed(2)}` })}
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
        </View>

        {/* 转账/兑换也使用同一套计算器；金额/汇率/手续费点击后进入这里。
            底部留白收紧(insets-32)：edge-to-edge 下根视图已延伸到导航条后面，
            再垫满 insets 会在键盘下方多出一条空位——键盘整体下移填补它 */}
        {amountKeypadOpen && (
          <View style={[styles.stickyFooter, { paddingBottom: Math.max(insets.bottom - 40, 8), paddingHorizontal: 0 }]}>
            <AmountCalculatorKeypad
              onPressKey={handleExprKey}
              onPressToday={() => setDatePickerOpen(true)}
              selectedDate={date}
              onConfirm={handleTransferCalculatorConfirm}
              onClear={() => {
                if (calculatorTarget === 'amount') { amountExpr.reset(); setAmountCursor(0); }
                else if (calculatorTarget === 'rate') { rateExpr.reset(); setRateCursor(0); }
                else { feeExpr.reset(); setFeeCursor(0); }
              }}
              onConfirmLongPress={handleTransferCalculatorConfirmAndContinue}
              note={note}
              onNoteChange={setNote}
              receiptUri={receiptUri}
              onAttachReceipt={handleAttachReceipt}
              onRemoveReceipt={() => setReceiptUri(null)}
              onPreviewReceipt={() => setReceiptPreviewOpen(true)}
              noteInputRef={noteInputRef}
              onNoteFocus={() => { noteFocusRef.current = true; }}
              onNoteBlur={() => { noteFocusRef.current = false; }}
            />
          </View>
        )}

        {/* 选择账户（转账/兑换）：与支出/收入的账户弹层完全同款——树内覆盖层 + 下滑收起手势 +
            头部货币直选按钮；仅列表逻辑保留转账特有：排除对方账户、按 from/to 角色写回选择 */}
        {accountPickerOpen && (
          <View style={[StyleSheet.absoluteFill, { zIndex: 90, elevation: 90 }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeAccountPicker}>
              <Reanimated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, accountPickerScrimStyle]} />
            </Pressable>
            <GestureDetector gesture={accountPickerGesture}>
              <Reanimated.View style={[styles.accountPickerSheet, accountPickerAnimStyle]}>
                <View style={styles.accountPickerGrabber} />
                <View style={styles.accountPickerHeader}>
                  <View style={{ flexShrink: 1, marginRight: 8 }}>
                    <Text style={styles.accountPickerTitle}>
                      {accountPickerRole === 'from' ? t('addTx.selectOut') : t('addTx.selectIn')}
                    </Text>
                    <Text style={styles.accountPickerSubtitle}>
                      {accountPickerRole === 'from' ? t('addTx.fromWhichAccount') : t('addTx.toWhichAccount')}
                    </Text>
                  </View>
                  <View style={styles.accountPickerHeaderRight}>
                    {/* 货币直选键：与支出/收入弹层同款，点开"自己已有的币种"下拉，点选直接筛选账户列表。
                        按键文字跟随当前筛选：打开时默认"全部货币"→显示该文案，选了具体币种→显示该代码 */}
                    <TouchableOpacity
                      style={styles.accountPickerCurrencyBtn}
                      activeOpacity={0.75}
                      onPress={() => setCurrencyDropOpen((v) => !v)}
                    >
                      <Text style={styles.accountPickerCurrencyBtnText}>
                        {currencyFilter === 'all' ? t('addTx.allCurrencies') : currencyFilter}
                      </Text>
                      <Ionicons
                        name={currencyDropOpen ? 'chevron-up' : 'chevron-down'}
                        size={12}
                        color={colors.link}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.accountPickerClose} onPress={closeAccountPicker}>
                      <Ionicons name="close" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* 币种下拉面板：与支出/收入弹层同款；转账侧只筛选列表，不动金额显示币种（那是支出/收入的语义） */}
                {currencyDropOpen && (
                  <Pressable style={styles.currencyDropCatch} onPress={() => setCurrencyDropOpen(false)} />
                )}
                {currencyDropOpen && (
                  <View style={styles.currencyDropPanel}>
                    <Text style={styles.currencyDropTitle}>{t('addTx.selectCurrency')}</Text>
                    <TouchableOpacity
                      style={[styles.currencyDropItem, currencyFilter === 'all' && { backgroundColor: colors.link + '14' }]}
                      onPress={() => {
                        setCurrencyFilter('all');
                        setCurrencyDropOpen(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.currencyDropItemText,
                          currencyFilter === 'all' && { color: colors.link, fontWeight: '700' },
                        ]}
                      >
                        {t('addTx.allCurrencies')}
                      </Text>
                      {currencyFilter === 'all' && <Ionicons name="checkmark" size={16} color={colors.link} />}
                    </TouchableOpacity>
                    {ownCurrencies.map((code) => {
                      const active = currencyFilter === code;
                      return (
                        <TouchableOpacity
                          key={code}
                          style={[styles.currencyDropItem, active && { backgroundColor: colors.link + '14' }]}
                          onPress={() => {
                            setCurrencyFilter(code);
                            setCurrencyDropOpen(false);
                          }}
                        >
                          <Text style={[styles.currencyDropItemText, active && { color: colors.link, fontWeight: '700' }]}>
                            {code}
                          </Text>
                          {active && <Ionicons name="checkmark" size={16} color={colors.link} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                <View style={styles.accountSearchBox}>
                  <Ionicons name="search-outline" size={16} color={colors.textTertiary} />
                  <TextInput
                    style={styles.accountSearchInput}
                    value={accountSearch}
                    onChangeText={setAccountSearch}
                    placeholder={t('addTx.searchPlaceholder')}
                    placeholderTextColor={colors.textTertiary}
                  />
                </View>

                <View style={styles.accountFilterRow}>
                  {[
                    ['all', t('common.all')],
                    ['cash', t('addTx.filterCash')],
                    ['bank', t('addTx.filterBank')],
                    ['credit', t('addTx.filterCredit')],
                    ['ewallet', t('addTx.filterEwallet')],
                  ].map(([key, label]) => (
                    <TouchableOpacity
                      key={key}
                      style={[styles.accountFilterChip, accountFilter === key && styles.accountFilterChipActive]}
                      onPress={() => setAccountFilter(key as typeof accountFilter)}
                    >
                      <Text style={[styles.accountFilterText, accountFilter === key && styles.accountFilterTextActive]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Reanimated.ScrollView
                  onScroll={accountListScrollHandler}
                  style={styles.accountPickerList}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {(() => {
                    // 资产页同款「一币一大卡」（与支出/收入弹层同款）：任何时候都是大卡，
                    // from/to 双选语义保留（再点已选=取消）
                    const visible = assets.filter((a) => {
                      const keyword = accountSearch.trim().toLowerCase();
                      const matchSearch = !keyword || `${a.name} ${a.currency} ${a.type}`.toLowerCase().includes(keyword);
                      // 币种筛选：下拉里点了 USD 之类后，列表只显示该币种的账户
                      const matchCurrency = currencyFilter === 'all' || a.currency === currencyFilter;
                      // 分类按账户类型精确匹配（现金/银行卡/信用卡/电子钱包）；投资等其他类型只在"全部"里出现
                      const matchFilter = accountFilter === 'all' || a.type === accountFilter;
                      // 转账的两个角色互相排除：选转出时不列转入账户，反之亦然
                      const otherId = accountPickerRole === 'from' ? toAssetId : fromAssetId;
                      return matchSearch && matchCurrency && matchFilter && a.id !== otherId;
                    });
                    const byCurrency: Record<string, typeof visible> = {};
                    visible.forEach((a) => {
                      if (!byCurrency[a.currency]) byCurrency[a.currency] = [];
                      byCurrency[a.currency].push(a);
                    });
                    return Object.entries(byCurrency)
                      .sort(([c1], [c2]) => c1.localeCompare(c2))
                      .map(([code, items]) => {
                        const expanded = !pickerCollapsedGroups.has(code);
                        const groupTotal = items.reduce((sum, a) => sum + getAssetBalance(a.id), 0);
                        const flag = getCurrencyFlag(code);
                        return (
                          <View key={`grp-${code}`} style={styles.accountGroupShadow}>
                            <LinearGradient
                              colors={[colors.netWorthGradientFrom, colors.netWorthGradientTo]}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 1 }}
                              style={styles.accountGroupCard}
                            >
                              <TouchableOpacity
                                style={styles.accountGroupHeader}
                                activeOpacity={0.75}
                                onPress={() => togglePickerGroup(code)}
                              >
                                <View style={styles.accountGroupFlag}>
                                  <Text style={flag ? styles.accountGroupFlagEmoji : styles.accountGroupFlagText}>
                                    {flag ?? getCurrencySymbol(code)}
                                  </Text>
                                </View>
                                <Text style={styles.accountGroupCode}>{code}</Text>
                                <Text style={styles.accountGroupTotal}>{groupTotal.toFixed(2)}</Text>
                                <Ionicons
                                  name={expanded ? 'chevron-up' : 'chevron-down'}
                                  size={16}
                                  color={colors.netWorthAccent}
                                  style={{ marginLeft: 6 }}
                                />
                              </TouchableOpacity>
                              {expanded && (
                                <View style={styles.accountGroupBody}>
                                  {items.map((a) => {
                                    const selected = accountPickerRole === 'from' ? fromAssetId === a.id : toAssetId === a.id;
                                    return (
                                      <TouchableOpacity
                                        key={a.id}
                                        style={[styles.accountGroupRow, selected && styles.accountGroupRowActive]}
                                        activeOpacity={0.8}
                                        onPress={() => {
                                          // 手动选择/取消，之后不再自动跟随"默认账户"变化；再点一次已选＝取消选择
                                          userPickedFromRef.current = true;
                                          if (accountPickerRole === 'from') {
                                            setFromAssetId((prev) => (prev === a.id ? null : a.id));
                                          } else {
                                            setToAssetId((prev) => (prev === a.id ? null : a.id));
                                          }
                                          setCurrencyFilter('all');
                                          closeAccountPicker();
                                        }}
                                      >
                                        <View style={styles.accountGroupRowIcon}>
                                          <Ionicons name={a.icon as IconName} size={20} color={a.color} />
                                        </View>
                                        <View style={styles.accountGroupRowInfo}>
                                          <Text style={styles.accountGroupRowName} numberOfLines={1}>
                                            {a.name}
                                          </Text>
                                          {a.isDefault && <Text style={styles.accountDefaultBadge}>{t('addTx.currentDefault')}</Text>}
                                        </View>
                                        <Text style={styles.accountGroupRowAmount}>
                                          {getAssetTransferBalance(a, getAssetBalance(a.id)).toFixed(2)}
                                        </Text>
                                        {selected && (
                                          <Ionicons name="checkmark-circle" size={18} color={colors.income} style={{ marginLeft: 6 }} />
                                        )}
                                      </TouchableOpacity>
                                    );
                                  })}
                                </View>
                              )}
                            </LinearGradient>
                          </View>
                        );
                      });
                  })()}
                </Reanimated.ScrollView>

                {/* "添加新账户"固定在面板最底部，不随账户列表滚动；点击直达添加资产账户页，返回时 goBack 回记一笔 */}
                <View style={[styles.accountPickerFooter, { paddingBottom: Math.max(insets.bottom, 20) + 8 }]}>
                  <TouchableOpacity
                    style={styles.addAccountPickerBtn}
                    onPress={() => {
                      closeAccountPicker();
                      navigation?.navigate(ROUTES.ADD_ASSET);
                    }}
                  >
                    <Ionicons name="add-circle-outline" size={18} color={colors.link} />
                    <Text style={styles.addAccountPickerText}>{t('addTx.addAccount')}</Text>
                  </TouchableOpacity>
                </View>
              </Reanimated.View>
            </GestureDetector>
          </View>
        )}

        <DateRangePickerSheet
          visible={datePickerOpen}
          start={date}
          end={date}
          mode="single"
          onApply={(picked) => setDate(picked)}
          onClose={() => setDatePickerOpen(false)}
        />

        {/* 转账/兑换的收据上传：相机 + 凭证预览弹窗也要挂在本分支里，点"收据"才能拍照/选图 */}
        <ReceiptCameraModal
          visible={cameraMode !== null}
          withBase64={cameraMode === 'scan'}
          onClose={() => setCameraMode(null)}
          onCapture={(photo) => {
            if (cameraMode === 'receipt') {
              setReceiptUri(photo.uri);
            }
            setCameraMode(null);
          }}
          onPickFromLibrary={() => {
            const mode = cameraMode;
            setCameraMode(null);
            if (mode === 'receipt') pickReceiptFromLibrary();
          }}
        />

        <Modal
          visible={receiptPreviewOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setReceiptPreviewOpen(false)}
        >
          <TouchableOpacity
            style={styles.receiptViewerOverlay}
            activeOpacity={1}
            onPress={() => setReceiptPreviewOpen(false)}
          >
            {receiptUri && (
              <Image source={{ uri: receiptUri }} style={styles.receiptViewerImage} resizeMode="contain" />
            )}
            <TouchableOpacity
              style={styles.receiptViewerCloseBtn}
              onPress={() => setReceiptPreviewOpen(false)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close" size={26} color={colors.bg} />
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
      </EdgeBackSwipe>
    );
  }

  // ---------- 支出/收入：选分类 ----------
  if (step === 'category') {
    return (
      <EdgeBackSwipe onBack={edgeBackHome}>
      <SafeAreaView style={styles.container} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}>
        <View style={styles.formHeaderRow}>
          <View style={styles.formHeaderSide}>
            <TouchableOpacity
              style={styles.txHeaderBackBtn}
              onPress={() => setStep('detail')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back" size={22} color={colors.icon} style={{ fontWeight: "700" }} />
            </TouchableOpacity>
          </View>
          <Text style={styles.formHeaderTitle}>{t('addTx.selectCategory')}</Text>
          <View style={styles.formHeaderSideRight}>
            {/* 右上编辑键：进出排版模式——三条横线行式拖动排序 + ⊖ 删除（资产页同款范式） */}
            <TouchableOpacity
              style={[styles.catEditToggleBtn, catEditMode && styles.catEditToggleBtnActive]}
              onPress={() => {
                hapticLight();
                setCatEditMode((prev) => !prev);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name={catEditMode ? 'checkmark' : 'create-outline'}
                size={16}
                color={catEditMode ? colors.fabIcon : colors.link}
              />
              <Text style={[styles.catEditToggleText, catEditMode && { color: colors.fabIcon }]}>
                {catEditMode ? t('common.done') : t('addTx.edit')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 类别选择页不再显示 支出/收入/转账/兑换 切换栏：进来是什么类型就只显示该类型的类别 */}


        <ScrollView ref={categoryScrollRef} onScroll={onTabScroll ?? undefined} scrollEventThrottle={16} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: tabClearance }}>
          {/* 按大类分节（每节一张圆角卡片、可折叠）；编辑模式行式拖动排序 + ⊖ 删除，自定义大类可左滑删除 */}
          {groupedExpenseSections.map(({ group, items, custom }) => {
              const expanded = catEditMode || !collapsedGroups.has(group);
              const themeColor = colors.link;
              const toggleGroup = () => {
                if (catEditMode) return;
                setCollapsedGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(group)) next.delete(group);
                  else next.add(group);
                  return next;
                });
              };
              // 编辑模式行式列表：组内按拖拽顺序排，没序号的按原数组顺序殿后
              const orderedItems = catEditMode
                ? [...items].sort((a, b) => {
                    const oa = categoryOrder[a.id];
                    const ob = categoryOrder[b.id];
                    if (oa === undefined && ob === undefined) return 0;
                    if (oa === undefined) return 1;
                    if (ob === undefined) return -1;
                    return oa - ob;
                  })
                : items;
              const card = (
                <Pressable
                  key={group}
                  style={styles.catGroupCard}
                  /* TASK-016⑥：卡片是 ScrollView 直接子节点，layout.y 即内容坐标——
                     聚焦滚动按组名查这张表，绕开 Fabric 不支持的 measureLayout */
                  onLayout={(e) => {
                    groupContentYRef.current[group] = e.nativeEvent.layout.y;
                  }}
                >
                  {/* TASK-012②：收起大列表只点头部行（箭头所在行）；点卡片其余区域/空白不收 */}
                  <Pressable style={styles.catGroupHeader} onPress={toggleGroup} hitSlop={{ top: 6, bottom: 6 }}>
                    <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={14} color={themeColor} />
                    <Text style={[styles.catGroupTitle, { color: themeColor }]}>{getGroupLabel(group, t)}</Text>
                    {/* TASK-016①：＋入口移入标题行（组名隔壁），点开组内两步小卡；编辑态不显示 */}
                    {!catEditMode && (
                      <TouchableOpacity
                        style={styles.catHeaderAddBtn}
                        onPress={() => {
                          hapticLight();
                          if (addingGroupName === group) {
                            setAddingGroupName(null);
                            setInlineName('');
                          } else {
                            setInlineName('');
                            setInlineIcon(CATEGORY_ICON_OPTIONS[0]);
                            setInlineColor(CATEGORY_COLOR_OPTIONS[0]);
                            setAddingGroupName(group);
                          }
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name={addingGroupName === group ? 'remove' : 'add'} size={13} color={colors.fabIcon} />
                        <Text style={styles.catHeaderAddText}>
                          {addingGroupName === group ? t('addTx.headerCollapse') : t('addTx.headerAdd')}
                        </Text>
                      </TouchableOpacity>
                    )}
                    <View style={styles.catGroupCountWrap}>
                      <Text style={styles.catGroupCount}>{t('addTx.itemsCount', { count: items.length })}</Text>
                    </View>
                    {/* TASK-016①：整组删除入口（原左滑删除改这里）：垃圾桶贴数量胶囊右侧；编辑态不显示 */}
                    {!catEditMode && (
                      <TouchableOpacity
                        style={styles.catHeaderDeleteBtn}
                        onPress={() => confirmDeleteGroup(group, items.length)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="trash-outline" size={15} color={colors.expense} />
                      </TouchableOpacity>
                    )}
                  </Pressable>
                  {expanded && catEditMode && (
                    /* 编辑模式：行式拖动排序（资产页三条横线同款）——长按行拖动组内排序、⊖ 删除；
                       scrollEnabled=false 嵌在页面 ScrollView 里（资产页同款，无手势冲突） */
                    <View style={styles.catEditListWrap}>
                      <DraggableFlatList
                        data={orderedItems}
                        scrollEnabled={false}
                        keyExtractor={(item) => item.id}
                        onDragEnd={({ data }) => handleCatReorder(data)}
                        renderItem={({ item: c, drag, isActive }: RenderItemParams<Category>) => (
                          <ScaleDecorator>
                            <TouchableOpacity
                              style={[styles.catEditRow, isActive && styles.catEditRowActive]}
                              activeOpacity={0.8}
                              onLongPress={drag}
                              delayLongPress={150}
                            >
                              <View style={[styles.catEditRowIcon, { backgroundColor: c.color + '22' }]}>
                                <Ionicons name={c.icon as IconName} size={20} color={c.color} />
                              </View>
                              <Text style={styles.catEditRowName} numberOfLines={1}>
                                {getCategoryLabel(c, t)}
                              </Text>
                              <TouchableOpacity
                                style={styles.catEditRowDelete}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                onPress={() => confirmDeleteCategory(c)}
                              >
                                <Ionicons name="remove-circle" size={20} color={colors.expense} />
                              </TouchableOpacity>
                              <Ionicons name="reorder-three-outline" size={22} color={colors.textTertiary} />
                            </TouchableOpacity>
                          </ScaleDecorator>
                        )}
                      />
                    </View>
                  )}
                  {expanded && !catEditMode && (
                    <View style={styles.catGrid}>
                      {items.map((c) => (
                        <View key={c.id} style={styles.catItem}>
                          <TouchableOpacity
                            activeOpacity={0.7}
                            onPress={() => handlePickCategory(c.id)}
                          >
                            <View style={[styles.catIconCircle, { backgroundColor: c.color + '22' }]}>
                              <Ionicons name={c.icon as IconName} size={22} color={c.color} />
                            </View>
                          </TouchableOpacity>
                          <Text style={styles.catLabel}>{getCategoryLabel(c, t)}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {expanded && !catEditMode && addingGroupName === group && (
                    /* TASK-016②：两步小卡——一行（图标预览 + 名称 + ✓）+ 单行色条；
                       图标在弹层里选（点预览方块打开底部弹层） */
                    <View
                      style={styles.catInlineCard}
                      /* TASK-016⑥：记小卡在组卡内的 y 偏移，聚焦滚动 = 组卡 y + 小卡偏移 */
                      onLayout={(e) => {
                        inlineCardOffsetRef.current[group] = e.nativeEvent.layout.y;
                      }}
                    >
                      <View style={styles.catInlineNameRow}>
                        <TouchableOpacity
                          style={styles.catIconPreviewBtn}
                          onPress={() => {
                            hapticLight();
                            setIconPickerOpen(true);
                          }}
                        >
                          <Ionicons name={inlineIcon} size={22} color={colors.textPrimary} />
                        </TouchableOpacity>
                        <TextInput
                          ref={inlineInputRef}
                          style={styles.catInlineInput}
                          value={inlineName}
                          onChangeText={setInlineName}
                          placeholder={t('addTx.inlineAddPlaceholder', { group })}
                          placeholderTextColor={colors.textTertiary}
                          maxLength={10}
                          autoFocus
                          onFocus={() => {
                            inlineFocusGroupRef.current = group;
                            scrollInlineInputIntoView(group);
                          }}
                          onBlur={() => {
                            if (inlineFocusGroupRef.current === group) inlineFocusGroupRef.current = null;
                          }}
                        />
                        <TouchableOpacity
                          style={[styles.catInlineSaveSquare, !inlineName.trim() && { opacity: 0.35 }]}
                          disabled={!inlineName.trim()}
                          onPress={() => handleInlineAdd(group)}
                        >
                          <Ionicons name="checkmark" size={20} color={colors.fabIcon} />
                        </TouchableOpacity>
                      </View>
                      {/* TASK-016⑥：16 色直接铺 2 排（每排 8 个），不再横向滑动 */}
                      <View style={styles.catMiniColorsGrid}>
                        {CATEGORY_COLOR_OPTIONS.map((color) => (
                          <TouchableOpacity
                            key={color}
                            style={[
                              styles.catMiniColorDot,
                              { backgroundColor: color },
                              inlineColor === color && styles.catMiniColorDotActive,
                            ]}
                            onPress={() => setInlineColor(color)}
                          />
                        ))}
                      </View>
                    </View>
                  )}
                </Pressable>
              );
              // TASK-016①：整组删除入口已移入标题行垃圾桶，左滑删除退役——分节直接返回卡片
              return card;
            })}

          {/* 新增大分类：点击展开表单，填写名字+主题色后创建（空组也会显示，编辑模式下可拖分类进去） */}
          {!catEditMode && (
            <View style={[styles.catGroupCard, styles.newGroupCard]}>
              {newGroupFormOpen ? (
                <>
                  <View style={styles.newCatTitleRow}>
                    <Text style={styles.newCatTitle}>{t('addTx.addGroup')}</Text>
                    <TouchableOpacity onPress={() => setNewGroupFormOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={styles.newCatInput}
                    value={newGroupName}
                    onChangeText={setNewGroupName}
                    placeholder={t('addTx.groupNamePlaceholder')}
                    placeholderTextColor={colors.textTertiary}
                    maxLength={10}
                  />
                  <TouchableOpacity
                    style={[styles.newCatBtnFull, !newGroupName.trim() && { opacity: 0.4 }]}
                    disabled={!newGroupName.trim()}
                    onPress={() => {
                      const name = newGroupName.trim();
                      if (!name) return;
                      hapticSuccess();
                      addCategoryGroup({ name, icon: 'folder-outline', type: type as 'expense' | 'income' });
                      setNewGroupName('');
                      setNewGroupFormOpen(false);
                    }}
                  >
                    <Text style={styles.newCatBtnFullText}>{t('addTx.createGroup')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity style={styles.newGroupEntry} onPress={() => setNewGroupFormOpen(true)}>
                  <Ionicons name="add-circle-outline" size={18} color={colors.link} />
                  <Text style={styles.newGroupEntryText}>{t('addTx.addGroup')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

        </ScrollView>

        {/* 编辑模式提示条（TASK-016：三条横线行式排序——按住行拖动、⊖ 删除）+ 底部完成键 */}
        {catEditMode && (
          <View style={styles.catEditHintBar} pointerEvents="none">
            <Text style={styles.catEditHintText} numberOfLines={1}>
              {t('addTx.catEditHint')}
            </Text>
          </View>
        )}
        {catEditMode && (
          <TouchableOpacity style={styles.catEditDoneBtn} onPress={() => setCatEditMode(false)}>
            <Text style={styles.catEditDoneText}>{t('common.done')}</Text>
          </TouchableOpacity>
        )}

        {/* TASK-016③：图标选择底部弹层（两步小卡的第二步）——119 个图标 6 列网格，
            点选回填小卡预览方块；挂在选择类别页自己的 return 分支内（详情分支的 Modal 在这里渲染不到） */}
        <Modal
          visible={iconPickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIconPickerOpen(false)}
        >
          <TouchableOpacity style={styles.iconPickerOverlay} activeOpacity={1} onPress={() => setIconPickerOpen(false)}>
            <Pressable style={styles.iconPickerSheet} onPress={() => {}}>
              <View style={styles.iconPickerHeader}>
                <Text style={styles.iconPickerTitle}>{t('addTx.pickIconTitle')}</Text>
                <TouchableOpacity
                  style={styles.iconPickerClose}
                  onPress={() => setIconPickerOpen(false)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.iconPickerGrid} keyboardShouldPersistTaps="handled">
                <View style={styles.iconPickerGridInner}>
                  {CATEGORY_ICON_OPTIONS.map((icon) => (
                    <TouchableOpacity
                      key={icon}
                      style={[styles.iconPickerCell, inlineIcon === icon && styles.iconPickerCellActive]}
                      onPress={() => {
                        hapticSelection();
                        setInlineIcon(icon);
                        setIconPickerOpen(false);
                      }}
                    >
                      <Ionicons name={icon} size={22} color={inlineIcon === icon ? colors.link : colors.textPrimary} />
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </Pressable>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
      </EdgeBackSwipe>
    );
  }

  // ---------- 支出/收入：填详情（金额为主视觉的新版排版） ----------
  return (
    <EdgeBackSwipe onBack={edgeBackHome}>
    <SafeAreaView style={styles.container} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}>
      <View style={{ flex: 1 }}>
      {/* TASK-011 五轮（用户定版尝试）：外层不再可滚——普通 View 替代 ScrollView。
          页面不能滚 → 内容不可能被滚到键盘底下 → flex 布局让「全部」按钮天然停在键盘上沿。
          scrollViewRef 不再挂在本页（scrollToField 的 ?. 兜底安全跳过）；转账/兑换分支不动 */}
      <View
        style={{ flex: 1 }}
        onLayout={(e) => {
          // 可视高度锁存（flex 已自动扣除键盘面板高度）——slice 裁剪兜底的输入
          const h = e.nativeEvent.layout.height;
          setScrollViewH((prev) => (prev == null || Math.abs(prev - h) > 0.5 ? h : prev));
        }}
      >
        {/* 头部：返回 + 类型切换 + 扫票，合并成一行；编辑模式没有类型切换，保留原来的标题式头部 */}
        {isEditing ? (
          <View style={styles.formHeaderRow}>
            <View style={styles.formHeaderSide}>
              <TouchableOpacity
                style={styles.txHeaderBackBtn}
                onPress={() => navigation?.goBack()}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="chevron-back" size={22} color={colors.icon} style={{ fontWeight: "700" }} />
              </TouchableOpacity>
            </View>
            <Text style={styles.formHeaderTitle}>{t('addTx.editTitle')}</Text>
            <View style={styles.formHeaderSideRight}>
              {/* 删除入口从账单列表的滑动改到这里：点垃圾桶确认后删除并返回 */}
              <TouchableOpacity
                style={styles.txDeleteBtn}
                onPress={handleDeleteTransaction}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="trash-outline" size={20} color={colors.expense} />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.txHeaderRow}>
            <TouchableOpacity
              style={styles.txHeaderBackBtn}
              onPress={() => navigation?.goBack()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back" size={22} color={colors.icon} style={{ fontWeight: "700" }} />
            </TouchableOpacity>
            <View style={styles.txHeaderTypeSwitch}>
              {TYPE_TABS.map((t, idx) => (
                <React.Fragment key={t.key}>
                  {idx > 0 && <View style={styles.txHeaderTypeDivider} />}
                  <Pressable
                    style={({ pressed }) => [
                      styles.txHeaderTypeBtn,
                      uiType === t.key && styles.txHeaderTypeBtnActive,
                      pressed && (uiType === t.key ? styles.txHeaderTypeBtnSinkActive : styles.txHeaderTypeBtnSink),
                    ]}
                    onPress={() => {
                      hapticSelection();
                      setUiType(t.key);
                      setCategoryId(null);
                      setStep(stepForType(t.key));
                    }}
                  >
                    <Text
                      style={[styles.txHeaderTypeText, uiType === t.key && styles.txHeaderTypeTextActive]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                    >
                      {t.label}
                    </Text>
                    {/* 底线：标记当前所在页面 */}
                    {uiType === t.key && <View style={styles.txHeaderTypeUnderline} />}
                  </Pressable>
                </React.Fragment>
              ))}
            </View>
          <TouchableOpacity style={styles.txHeaderScanBtn} onPress={handleScanPress}>
              <Ionicons name="camera-outline" size={13} color={colors.link} style={{ marginRight: 4 }} />
              <Text style={styles.txHeaderScanBtnText}>{t('addTx.scanReceipt')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 金额：整屏视觉主角——与转账/兑换的资金流向卡同款外框,内含金额行 + 账户选择下拉 */}
        <View style={styles.heroCard}>
        <View style={styles.heroAmountWrap} onLayout={registerFieldY('amount')}>
          {/* D-2（2026-09-24 用户拍板）：货币钮并入账户选择器成 L 型标签——
              金额行只剩金额（行高 44 不变、改垂直居中），点金额区域打开自绘计算器键盘 */}
          <View style={styles.heroAmountLine}>
            {/* 金额行：TASK-015 固定行高不随位数变化——缩字+单行截断，14 位也不撑变形；
                金额自己接管点按（原 heroAmountLine 的 onPress 移到 CursorAmountText 外包一层） */}
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.heroAmountTextWrap}
              onPress={() => {
                // 备注框的系统键盘/光标退场：一次只允许一个光标显示
                noteInputRef.current?.blur();
                // 打开键盘即从空态起输：按 5 就是 5 元，新输入直接替换旧值（不再从尾部续接）
                amountExpr.reset();
                setAmountCursor(0);
                setAmountKeypadOpen(true);
                scrollToField('amount');
              }}
            >
              <CursorAmountText
                containerStyle={styles.heroAmountTextInner}
                style={[styles.heroAmountText, { fontSize: heroAmountFontSize, lineHeight: heroAmountFontSize * 1.2 }]}
                cursorStyle={[styles.heroCursorInline, { fontSize: heroAmountFontSize * 0.85 }]}
                display={amountKeypadOpen ? amountExpr.displayValue : amount || '0.00'}
                enabled={amountKeypadOpen}
                cursorFromEnd={amountCursor}
                onCursorChange={setAmountCursor}
                numberOfLines={1}
              />
            </TouchableOpacity>
          </View>

          {/* D-3（2026-09-24 用户拍板）：第二行 = L 型选择器（左）+ 自动月结开关（右）。
              视觉整块交给一张 SVG 一笔轮廓（外填紫罩+描边），标签与胶囊物理上无接缝、
              拐角内凹圆弧自然过渡；内容与触区仍是透明 RN 视图叠在 SVG 上：
              标签区=弹层直开「选择货币」，账户区=普通开弹层（选完账户币种自动跟随
              =选择账户同时就能切换货币）；原金额行内联「选择货币」下拉面板已删 */}
          <View style={styles.heroSecondRow}>
            <View
              style={[styles.heroCurrencyWrap, { height: HH }]}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                if (Math.abs(w - heroWrapW) > 0.5) setHeroWrapW(w);
              }}
            >
              <Svg width={heroLPaths.W} height={HH} style={styles.heroLSvg}>
                <Path d={heroLPaths.dL} fill={colors.link + '14'} />
                <Path
                  d={heroLPaths.dL}
                  stroke={assetPickerOpen ? colors.link : colors.link + '33'}
                  strokeWidth={1}
                  fill="none"
                />
              </Svg>
              {/* 货币标签触区+内容（L 型上半）：点开弹层并直接展开「选择货币」面板 */}
              <TouchableOpacity
                style={styles.heroLTabRow}
                activeOpacity={0.75}
                onLayout={(e) => {
                  const w = e.nativeEvent.layout.width;
                  if (Math.abs(w - heroTabW) > 0.5) setHeroTabW(w);
                }}
                onPress={() => {
                  setAccountSearch('');
                  setAccountFilter('all');
                  setCurrencyDropOpen(true);
                  setAssetPickerOpen(true);
                }}
              >
                <Text style={[styles.heroCurrencyTabText, { fontSize: 21, lineHeight: 21 * 1.2 }]}>
                  {amountCurrencyCode}
                </Text>
                {/* D-3.5：货币旁的下拉箭头去除（用户定版）——点击整块标签仍可开「选择货币」面板 */}
              </TouchableOpacity>
              {/* 账户触区+内容（L 型下半）：收起货币面板防串态；选完账户币种自动跟随 */}
              <TouchableOpacity
                style={styles.heroLAccRow}
                activeOpacity={0.7}
                onPress={() => {
                  setAccountSearch('');
                  setAccountFilter('all');
                  setCurrencyDropOpen(false);
                  setAssetPickerOpen(true);
                }}
              >
                <View
                  style={[
                    styles.heroCurrencyIconCircle,
                    { backgroundColor: (selectedAsset?.color ?? colors.link) + '20' },
                  ]}
                >
                  <Ionicons
                    name={(selectedAsset?.icon as IconName) ?? 'wallet-outline'}
                    size={20}
                    color={selectedAsset?.color ?? colors.link}
                  />
                </View>
                <Text style={styles.heroCurrencyAccName} numberOfLines={1}>
                  {selectedAsset ? selectedAsset.name : t('common.notSelected')}
                </Text>
                <Ionicons name="chevron-down" size={12} color={colors.textTertiary} style={styles.heroCurrencyChevron} />
              </TouchableOpacity>
            </View>

            {/* 月度结转开关（仅新增模式，默认关）：图示胶囊按钮式——左状态圆（关=空心圈/开=✓ 实心圆）
                + 右侧文字；开时胶囊发光描边；整行点按切换 */}
            {!isEditing && (
              <TouchableOpacity
                style={[styles.autoMonthlyRow, autoMonthly && styles.autoMonthlyRowOn]}
                activeOpacity={0.8}
                onPress={() => {
                  hapticLight();
                  setAutoMonthly((v) => !v);
                }}
              >
                {/* 左状态圆：关=空心圈（dividerHair 描边），开=实心 link 圆 + 白色 ✓ */}
                {autoMonthly ? (
                  <View style={[styles.autoMonthlyStateCircle, styles.autoMonthlyStateCircleOn]}>
                    <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                  </View>
                ) : (
                  <View style={styles.autoMonthlyStateCircle} />
                )}
                <Text style={[styles.autoMonthlyLabel, autoMonthly && styles.autoMonthlyLabelOn]} numberOfLines={1}>
                  {/* 按类型显示「月度支出/月度收入」 */}
                  {type === 'income' ? t('finance.typeIncome') : t('finance.typeExpense')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        </View>

        {/* 类别：自适应网格——列数按机型（宽机 4 个/行、窄机 3 个/行，"全部"占行尾一格）；
            最近用过的排前面，选了新类别就追加进网格、"全部"随之下移一行（TASK-007：
            不限行数，挤满自动换行继续往下铺，铺不下的滚动查看） */}
        <View style={styles.categorySectionHeader}>
          <Text style={styles.sectionLabel}>
            {selectedCategory ? `${t('addTx.categoryPrefix')}${getCategoryLabel(selectedCategory, t)}` : t('addTx.categoryRequired')}
          </Text>
        </View>
        {/* 类别网格容器：onLayout 记录它在内容里的顶部 y（slice 裁剪兜底输入）。
            外层已不可滚，网格被 flex 顶在键盘上方——此值仅作容量计算 */}
        <View
          style={styles.categoryChipGrid}
          onLayout={(e) => {
            const top = e.nativeEvent.layout.y;
            setGridTopY((prev) => (prev == null || Math.abs(prev - top) > 0.5 ? top : prev));
          }}
        >
          {displayCategories.map((c) => {
            const active = categoryId === c.id;
            return (
              <TouchableOpacity
                key={c.id}
                style={[
                  styles.categoryChip,
                  // 长名不截断（2026-09-25 字号15批次）：短名保持网格等宽（minWidth），
                  // 4 字名按内容加长、flexWrap 自动 reflow——文字永不被挤出框外
                  { minWidth: categoryChipW },
                  active && { backgroundColor: colors.fabBg, borderColor: colors.fabBg },
                ]}
                onPress={() => handlePickCategory(c.id)}
              >
                <View
                  style={[
                    styles.categoryChipIconBox,
                    { backgroundColor: active ? 'rgba(255,255,255,0.28)' : c.color + '20' },
                  ]}
                >
                  {/* TASK-011 三轮（用户定版）：选中不再渲染白色✓，图标格保持原分类图标不变 */}
                  <Ionicons name={c.icon as IconName} size={15} color={active ? '#fff' : c.color} />
                </View>
                <Text style={[styles.categoryChipLabel, active && { color: '#fff' }]} numberOfLines={1}>
                  {getCategoryLabel(c, t)}
                </Text>
              </TouchableOpacity>
            );
          })}

          {/* "全部"入口：做成和类别胶囊一样大小的紫色描边 Pill，放在网格最后一位。
              TASK-011 容量裁剪：超出可见容量的类别不渲染，「全部」永远殿后且必在
              键盘面板上方的可见区域内（网格顶→停止线之间），不会再被键盘盖住 */}
          <TouchableOpacity
            style={[styles.morePill, { width: categoryChipW }]}
            onPress={() => setStep('category')}
            activeOpacity={0.8}
          >
            <Text style={styles.morePillText}>{t('common.all')}</Text>
            <Ionicons name="chevron-forward" size={13} color={colors.link} />
          </TouchableOpacity>
        </View>
      </View>
      </View>

      {/* 自绘计算器键盘：点金额区域出现，"完成"＝保存，长按"完成"＝保存后继续记下一笔。
          底部留白收紧(insets-32)：edge-to-edge 下根视图已延伸到导航条后面，
          再垫满 insets 会在键盘下方多出一条空位——键盘整体下移填补它 */}
      {amountKeypadOpen && (
        <View
          style={[styles.stickyFooter, { paddingBottom: Math.max(insets.bottom - 40, 8), paddingHorizontal: 0 }]}
        >
          <AmountCalculatorKeypad
            onPressKey={(key) => setAmountCursor(amountExpr.pressKeyAt(key, amountCursor))}
            onPressToday={() => setDatePickerOpen(true)}
            selectedDate={date}
            onConfirm={handleKeypadConfirm}
            onClear={() => { amountExpr.reset(); setAmountCursor(0); }}
            onConfirmLongPress={isEditing ? undefined : handleKeypadConfirmAndContinue}
            note={note}
            onNoteChange={setNote}
            receiptUri={receiptUri}
            onAttachReceipt={handleAttachReceipt}
            onRemoveReceipt={() => setReceiptUri(null)}
            onPreviewReceipt={() => setReceiptPreviewOpen(true)}
            noteInputRef={noteInputRef}
            onNoteFocus={() => { noteFocusRef.current = true; }}
            onNoteBlur={() => { noteFocusRef.current = false; }}
          />
        </View>
      )}

      {/* 日期选择：点键盘上的日期键打开，逻辑没变 */}
      <DateRangePickerSheet
        visible={datePickerOpen}
        start={date}
        end={date}
        mode="single"
        onApply={(picked) => setDate(picked)}
        onClose={() => setDatePickerOpen(false)}
      />

      {/* 自绘拍小票相机：cameraMode 区分是"扫描识别"还是"单纯附凭证"，
          拍完之后各自接回原来的处理逻辑（runScan 走OCR / 直接setReceiptUri留档） */}
      <ReceiptCameraModal
        visible={cameraMode !== null}
        withBase64={cameraMode === 'scan'}
        onClose={() => setCameraMode(null)}
        onCapture={(photo) => {
          if (cameraMode === 'scan' && photo.base64) {
            runScan(photo.base64, photo.uri);
          } else if (cameraMode === 'receipt') {
            setReceiptUri(photo.uri);
          }
          setCameraMode(null);
        }}
        onPickFromLibrary={() => {
          const mode = cameraMode;
          setCameraMode(null);
          if (mode === 'scan') pickFromLibrary();
          else if (mode === 'receipt') pickReceiptFromLibrary();
        }}
      />

      {/* 凭证大图预览：点缩略图放大查看整体，长按缩略图可重新拍照/选相册 */}
      <Modal
        visible={receiptPreviewOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setReceiptPreviewOpen(false)}
      >
        <TouchableOpacity
          style={styles.receiptViewerOverlay}
          activeOpacity={1}
          onPress={() => setReceiptPreviewOpen(false)}
        >
          {receiptUri && (
            <Image source={{ uri: receiptUri }} style={styles.receiptViewerImage} resizeMode="contain" />
          )}
          <TouchableOpacity
            style={styles.receiptViewerCloseBtn}
            onPress={() => setReceiptPreviewOpen(false)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={26} color={colors.bg} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      {/* 选择账户：树内覆盖层（不用 RN Modal——Modal 是独立原生窗口，和 Reanimated 在安卓上
          会出重影、也接不了下滑手势；外壳与日期选择面板完全同款） */}
      {assetPickerOpen && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 90, elevation: 90 }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeAccountPicker}>
            <Reanimated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, accountPickerScrimStyle]} />
          </Pressable>
          <GestureDetector gesture={accountPickerGesture}>
            <Reanimated.View style={[styles.accountPickerSheet, accountPickerAnimStyle]}>
              <View style={styles.accountPickerGrabber} />
                <View style={styles.accountPickerHeader}>
                  <View style={{ flexShrink: 1, marginRight: 8 }}>
                    <Text style={styles.accountPickerTitle}>{t('addTx.selectAccount')}</Text>
                  </View>
                  <View style={styles.accountPickerHeaderRight}>
                    {/* 货币直选键：点击弹出"自己已有的币种"下拉菜单（同首页多币种切换），点选直接切换金额币种。
                        按键文字跟随当前筛选：打开时默认"全部"→显示 ALL，选了具体币种→显示该代码 */}
                    <TouchableOpacity
                      style={styles.accountPickerCurrencyBtn}
                      activeOpacity={0.75}
                      onPress={() => setCurrencyDropOpen((v) => !v)}
                    >
                      <Text style={styles.accountPickerCurrencyBtnText}>
                        {currencyFilter === 'all' ? t('addTx.allCurrencies') : currencyFilter}
                      </Text>
                      <Ionicons
                        name={currencyDropOpen ? 'chevron-up' : 'chevron-down'}
                        size={12}
                        color={colors.link}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.accountPickerClose} onPress={closeAccountPicker}>
                      <Ionicons name="close" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                </View>

            {/* 币种下拉面板：悬浮在货币按钮正下方（右对齐、绝对定位不挤压下方内容）；
                点面板外任意空白处收起；选项只显示 MYR/THB 这种后置代码，
                点选只筛选账户列表（金额币种只认所选账户，不随面板币种变化）；"全部币种"恢复不筛选 */}
            {currencyDropOpen && (
              <Pressable style={styles.currencyDropCatch} onPress={() => setCurrencyDropOpen(false)} />
            )}
            {currencyDropOpen && (
              <View style={styles.currencyDropPanel}>
                <Text style={styles.currencyDropTitle}>{t('addTx.selectCurrency')}</Text>
                <TouchableOpacity
                  style={[styles.currencyDropItem, currencyFilter === 'all' && { backgroundColor: colors.link + '14' }]}
                  onPress={() => {
                    setCurrencyFilter('all');
                    setCurrencyDropOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.currencyDropItemText,
                      currencyFilter === 'all' && { color: colors.link, fontWeight: '700' },
                    ]}
                  >
                    {t('addTx.allCurrencies')}
                  </Text>
                  {currencyFilter === 'all' && <Ionicons name="checkmark" size={16} color={colors.link} />}
                </TouchableOpacity>
                {ownCurrencies.map((code) => {
                  const active = currencyFilter === code;
                  return (
                    <TouchableOpacity
                      key={code}
                      style={[styles.currencyDropItem, active && { backgroundColor: colors.link + '14' }]}
                      onPress={() => {
                        setCurrencyFilter(code);
                        setCurrencyDropOpen(false);
                      }}
                    >
                      <Text style={[styles.currencyDropItemText, active && { color: colors.link, fontWeight: '700' }]}>
                        {code}
                      </Text>
                      {active && <Ionicons name="checkmark" size={16} color={colors.link} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <View style={styles.accountSearchBox}>
              <Ionicons name="search-outline" size={16} color={colors.textTertiary} />
              <TextInput
                style={styles.accountSearchInput}
                value={accountSearch}
                onChangeText={setAccountSearch}
                placeholder={t('addTx.searchPlaceholder')}
                placeholderTextColor={colors.textTertiary}
              />
            </View>

            <View style={styles.accountFilterRow}>
              {[
                ['all', t('common.all')],
                ['cash', t('addTx.filterCash')],
                ['bank', t('addTx.filterBank')],
                ['credit', t('addTx.filterCredit')],
                ['ewallet', t('addTx.filterEwallet')],
              ].map(([key, label]) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.accountFilterChip, accountFilter === key && styles.accountFilterChipActive]}
                  onPress={() => setAccountFilter(key as typeof accountFilter)}
                >
                  <Text style={[styles.accountFilterText, accountFilter === key && styles.accountFilterTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Reanimated.ScrollView
              onScroll={accountListScrollHandler}
              style={styles.accountPickerList}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {(() => {
                // 资产页同款「一币一大卡」：每货币一张紫渐变大卡（卡头=旗徽+代码+组总额+折叠chevron，
                // 点卡头收/展沿用 pickerCollapsedGroups），卡内=账户小框（白0.10底圆角12无边框）。
                // 任何时候都是大卡——选了某币种=只显示那一张卡（原「筛选后平铺」分支删除）
                const visible = assets.filter((a) => {
                  const keyword = accountSearch.trim().toLowerCase();
                  const matchSearch = !keyword || `${a.name} ${a.currency} ${a.type}`.toLowerCase().includes(keyword);
                  // 币种筛选：下拉里点了 USD 之类后，列表只显示该币种的账户
                  const matchCurrency = currencyFilter === 'all' || a.currency === currencyFilter;
                  // 分类按账户类型精确匹配（现金/银行卡/信用卡/电子钱包）；投资等其他类型只在"全部"里出现
                  const matchFilter = accountFilter === 'all' || a.type === accountFilter;
                  return matchSearch && matchCurrency && matchFilter;
                });
                const byCurrency: Record<string, typeof visible> = {};
                visible.forEach((a) => {
                  if (!byCurrency[a.currency]) byCurrency[a.currency] = [];
                  byCurrency[a.currency].push(a);
                });
                return Object.entries(byCurrency)
                  .sort(([c1], [c2]) => c1.localeCompare(c2))
                  .map(([code, items]) => {
                    const expanded = !pickerCollapsedGroups.has(code);
                    const groupTotal = items.reduce((sum, a) => sum + getAssetBalance(a.id), 0);
                    const flag = getCurrencyFlag(code);
                    return (
                      <View key={`grp-${code}`} style={styles.accountGroupShadow}>
                        {/* 与资产页 currencyGroupCard 同款渐变/描边/圆角，日夜间各有一组 token 自动切换 */}
                        <LinearGradient
                          colors={[colors.netWorthGradientFrom, colors.netWorthGradientTo]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.accountGroupCard}
                        >
                          <TouchableOpacity
                            style={styles.accountGroupHeader}
                            activeOpacity={0.75}
                            onPress={() => togglePickerGroup(code)}
                          >
                            <View style={styles.accountGroupFlag}>
                              <Text style={flag ? styles.accountGroupFlagEmoji : styles.accountGroupFlagText}>
                                {flag ?? getCurrencySymbol(code)}
                              </Text>
                            </View>
                            <Text style={styles.accountGroupCode}>{code}</Text>
                            <Text style={styles.accountGroupTotal}>{groupTotal.toFixed(2)}</Text>
                            <Ionicons
                              name={expanded ? 'chevron-up' : 'chevron-down'}
                              size={16}
                              color={colors.netWorthAccent}
                              style={{ marginLeft: 6 }}
                            />
                          </TouchableOpacity>
                          {expanded && (
                            <View style={styles.accountGroupBody}>
                              {items.map((a) => {
                                const selected = assetId === a.id;
                                return (
                                  <TouchableOpacity
                                    key={a.id}
                                    style={[styles.accountGroupRow, selected && styles.accountGroupRowActive]}
                                    activeOpacity={0.8}
                                    onPress={() => {
                                      userPickedAssetRef.current = true;
                                      setAssetId(a.id);
                                      // 金额币种自动跟随新账户（只认所选账户），筛选复位
                                      setCurrencyFilter('all');
                                      setAssetPickerOpen(false);
                                    }}
                                  >
                                    <View style={styles.accountGroupRowIcon}>
                                      <Ionicons name={a.icon as IconName} size={20} color={a.color} />
                                    </View>
                                    <View style={styles.accountGroupRowInfo}>
                                      <Text style={styles.accountGroupRowName} numberOfLines={1}>
                                        {a.name}
                                      </Text>
                                      {a.isDefault && <Text style={styles.accountDefaultBadge}>{t('addTx.currentDefault')}</Text>}
                                    </View>
                                    <Text style={styles.accountGroupRowAmount}>
                                      {getAssetDisplayBalance(a, getAssetBalance(a.id)).toFixed(2)}
                                    </Text>
                                    {selected && (
                                      <Ionicons name="checkmark-circle" size={18} color={colors.income} style={{ marginLeft: 6 }} />
                                    )}
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          )}
                        </LinearGradient>
                      </View>
                    );
                  });
              })()}

            </Reanimated.ScrollView>

            {/* "添加新账户"固定在面板最底部，不随账户列表滚动；点击直达添加资产账户页，返回时 goBack 回记一笔 */}
            <View style={[styles.accountPickerFooter, { paddingBottom: Math.max(insets.bottom, 20) + 8 }]}>
              <TouchableOpacity
                style={styles.addAccountPickerBtn}
                onPress={() => {
                  setAssetPickerOpen(false);
                  navigation?.navigate(ROUTES.ADD_ASSET);
                }}
              >
                <Ionicons name="add-circle-outline" size={18} color={colors.link} />
                <Text style={styles.addAccountPickerText}>{t('addTx.addAccount')}</Text>
              </TouchableOpacity>
            </View>
            </Reanimated.View>
          </GestureDetector>
        </View>
      )}
    </SafeAreaView>
    </EdgeBackSwipe>
  );
}

// 关键：样式表要写成函数，接收 colors，返回 StyleSheet
function makeStyles(colors: ThemeColors, isDark: boolean) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.card },
  scanningWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanningText: { marginTop: 16, color: colors.textSecondary, fontSize: 14 },
  typeSwitch: { flexDirection: 'row', marginHorizontal: 20, marginTop: 12, marginBottom: 20, backgroundColor: colors.bg, borderRadius: 14, padding: 4 },
  typeBtn: { flex: 1, paddingVertical: 16, borderRadius: 11, alignItems: 'center' },
  typeBtnActive: { backgroundColor: colors.fabBg },
  typeText: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
  typeTextActive: { color: colors.bg },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 },
  catItem: { width: '25%', alignItems: 'center', marginBottom: 14 },
  catIconCircle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  catLabel: { fontSize: 12, color: colors.textPrimary, marginTop: 6 },
  // 「添加」方块：与分类图标同尺寸，点击跳到 类别分类 页新增
  catAddTile: { width: '25%', alignItems: 'center', marginBottom: 14 },
  // 组内联添加（TASK-004 自类别分类页并入；TASK-016 两步小卡：图标预览 + 名称 + ✓ 一行 + 单行色条）
  catInlineCard: { paddingHorizontal: 14, paddingBottom: 12, paddingTop: 2 },
  catInlineInput: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  // 图标预览方块：显示当前选中图标，点它打开底部弹层选 119 图标
  catIconPreviewBtn: {
    width: 44,
    height: 44,
    borderRadius: 11,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  // ✓ 确认方钮：名称+图标齐了就能点（替代原「添加到 X」文字钮）
  catInlineSaveSquare: {
    marginLeft: 8,
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: colors.fabBg,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  catInlineNameRow: { flexDirection: 'row', alignItems: 'center' },
  // 单行 16 色横条（横向可滑）→ TASK-016⑥：2 排网格（每排 8 个）
  catMiniColorsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    paddingHorizontal: 2,
  },
  catMiniColorDot: { width: 26, height: 26, borderRadius: 13, marginRight: 10, marginBottom: 8 },
  catMiniColorDotActive: { borderWidth: 2, borderColor: colors.textPrimary },
  // 右上编辑键（TASK-006）：与返回键同尺寸圆框，未激活 link 描边、激活 fabBg 实底
  catEditToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: colors.link,
    backgroundColor: colors.card,
  },
  catEditToggleBtnActive: { backgroundColor: colors.fabBg, borderColor: colors.fabBg },
  catEditToggleText: { color: colors.link, fontSize: 12, fontWeight: '700' },
  // TASK-016⑤：编辑模式行式列表（资产页三条横线同款）
  catEditListWrap: { paddingHorizontal: 10, paddingBottom: 8 },
  catEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  catEditRowActive: { opacity: 0.85 },
  catEditRowIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  catEditRowName: { flex: 1, fontSize: 13, color: colors.textPrimary },
  catEditRowDelete: { marginRight: 10 },
  // 大组分节：每节一张圆角卡片（图1 样式：外框 boarder + 卡片内标题行 + 九宫格）
  catGroupCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    marginHorizontal: 12,
    marginTop: 10,
    paddingBottom: 6,
    overflow: 'hidden',
  },
  // 搜索框：与卡片同宽同风格
  // 组标题行：紫色小标题 + 右侧数量胶囊 + 折叠箭头
  catGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  catGroupTitle: { fontSize: 13, fontWeight: '700', color: colors.link, marginLeft: 6 },
  catGroupCountWrap: { marginLeft: 'auto', backgroundColor: colors.bg, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 2 },
  catGroupCount: { fontSize: 10, color: colors.textTertiary },
  // 标题行药丸「新增」键 + 垃圾桶（TASK-016①：添加/删除入口都在标题行，左滑删除退役）
  catHeaderAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.fabBg,
    paddingHorizontal: 9,
    marginLeft: 8,
    gap: 2,
    shadowColor: colors.fabBg,
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  catHeaderAddText: { color: colors.fabIcon, fontSize: 11, fontWeight: '700' },
  catHeaderDeleteBtn: { marginLeft: 8, padding: 2 },
  // 新增大分类：底部入口 + 表单 + 主题色板
  newGroupCard: { marginTop: 14, padding: 14 },
  newGroupEntry: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  newGroupEntryText: { color: colors.link, fontSize: 14, fontWeight: '700', marginLeft: 6 },
  newCatTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  newCatTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  newGroupColorLabel: { fontSize: 11, color: colors.textTertiary, marginTop: 10, marginBottom: 6 },
  newGroupColorRow: { flexDirection: 'row', flexWrap: 'wrap' },
  newGroupColorDot: { width: 28, height: 28, borderRadius: 14, marginRight: 10, marginBottom: 6 },
  newGroupColorDotActive: { borderWidth: 2, borderColor: colors.textPrimary },
  newCatBtnFull: {
    marginTop: 12,
    backgroundColor: colors.fabBg,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  newCatBtnFullText: { color: colors.fabIcon, fontWeight: '700', fontSize: 14 },
  newCatInput: {
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    backgroundColor: colors.bg,
    paddingHorizontal: 10,
    fontSize: 13,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  // 编辑模式：提示条 + 底部完成键（三条横线行式排序的行样式在 catEditRow* 上）
  catEditHintBar: {
    position: 'absolute',
    bottom: 90,
    alignSelf: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: '90%',
  },
  catEditHintText: { fontSize: 12, color: colors.textSecondary },
  catEditDoneBtn: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: colors.fabBg,
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 8,
  },
  catEditDoneText: { color: colors.fabIcon, fontWeight: '700', fontSize: 13 },
  backRow: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  backText: { color: colors.link, fontSize: 14 },
  selectedCatRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginTop: 8 },
  selectedCatName: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginLeft: 12 },
  amountWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: 28 },
  currencySign: { fontSize: 28, color: colors.textPrimary, marginRight: 4 },
  amountInput: { fontSize: 44, fontWeight: '700', color: colors.textPrimary, minWidth: 120, textAlign: 'center' },
  sectionTitle: { fontSize: 13, color: colors.textSecondary, marginLeft: 20, marginBottom: 8, marginTop: 8 },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 12,
  },
  dateBtn: { padding: 6 },
  dateBtnText: { color: colors.link, fontSize: 13 },
  dateText: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  noteInput: {
    marginHorizontal: 20,
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: colors.textPrimary,
  },
  emptyAssetWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyAssetText: { textAlign: 'center', color: colors.textSecondary, marginBottom: 20, lineHeight: 22 },
  assetGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8 },
  assetOption: {
    width: '48%',
    marginBottom: 12,
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 6,
  },
  assetOptionDisabled: { opacity: 0.3 },
  // width: '100%' 是关键——不设的话，文字换行时每一行只会按内容宽度紧贴，
  // textAlign: 'center' 只能让单行看起来居中，一旦数字长到换行，第二行就会看着像贴边一样。
  assetOptionLabel: { fontSize: 13, color: colors.textPrimary, marginTop: 6, textAlign: 'center', width: '100%' },
  assetOptionCurrency: { fontSize: 11, color: colors.textTertiary, marginTop: 4, textAlign: 'center', width: '100%' },

  // ---------- 转账/兑换选账户：一行3个的紧凑卡片 ----------
  assetGrid3: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 4 },
  assetOption3: {
    width: '31%',
    minHeight: 92,
    marginBottom: 10,
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  // numberOfLines={1} + 固定宽度 + 居中：不管名字/金额多长，卡片高度都保持一致，
  // 三张卡片并排时不会因为某一张文字换行而错位、看着"乱"
  assetOption3Label: { fontSize: 12, fontWeight: '600', color: colors.textPrimary, marginTop: 6, textAlign: 'center', width: '100%' },
  assetOption3Currency: { fontSize: 11, color: colors.textSecondary, marginTop: 3, textAlign: 'center', width: '100%' },
  assetOption3Code: { fontSize: 9, color: colors.textTertiary, marginTop: 1, textAlign: 'center', width: '100%' },

  // ---------- 固定在屏幕底部的按钮栏：不随内容滚动，永远看得见 ----------
  stickyFooter: {
    paddingHorizontal: 20,
    paddingTop: 6,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.dividerHair,
  },

  // ---------- 日历快速选择（iOS用底部弹层包住内嵌日历） ----------
  datePickerBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  datePickerSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
  },

  transferSummary: { paddingHorizontal: 20, marginTop: 16 },
  transferSummaryRow: { flexDirection: 'row', alignItems: 'center' },
  transferSummaryText: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  rateInput: {
    marginHorizontal: 20,
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  convertedPreview: { marginHorizontal: 20, fontSize: 12, color: colors.income, marginTop: 4, marginBottom: 8 },

  // ---------- 支出/收入卡片式表单新增样式 ----------
  // 与转账/兑换页头部(txHeaderRow)对齐：同样的水平边距和更高的上下留白，
  // 让选择类别/编辑页的返回按钮和标题与主页面保持在同一层
  formHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 10,
    // 与主页面头部(内容高50px)完全同高：Yoga 的 minHeight 不会让子元素重新居中，
    // 必须用显式高度，返回钮/标题才会和主页面一样居中下沉 5px
    height: 66,
  },
  formHeaderSide: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  formHeaderSideRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  formHeaderTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  formHeaderScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  formHeaderScanBtnText: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
  formCard: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: colors.bg,
    borderRadius: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    overflow: 'hidden',
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  formRowLeft: { flexDirection: 'row', alignItems: 'center' },
  formRowRight: { flexDirection: 'row', alignItems: 'center' },
  formRowLabel: { fontSize: 14, color: colors.textPrimary, marginLeft: 8 },
  formRowValue: { fontSize: 14, color: colors.textPrimary, fontWeight: '600', marginRight: 4 },
  formRowHint: { fontSize: 11, color: colors.textTertiary },
  formRowInput: {
    flex: 1,
    marginLeft: 12,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'right',
  },
  formDivider: { height: 1, backgroundColor: colors.dividerHair },
  dateStepper: { flexDirection: 'row', alignItems: 'center' },
  amountRowRight: { flexDirection: 'row', alignItems: 'center' },
  currencySignSmall: { fontSize: 16, color: colors.textPrimary, marginRight: 4, fontWeight: '600' },
  amountInputInline: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    minWidth: 90,
    textAlign: 'right',
    padding: 0,
  },
  catIconCircleSmall: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  assetDropdown: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    marginBottom: 12,
    overflow: 'hidden',
  },
  assetDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.dividerHair,
  },
  assetDropdownItemText: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
  assetDropdownItemBalance: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  receiptPreviewWrap: { flexDirection: 'row', alignItems: 'center' },
  receiptThumb: { width: 64, height: 64, borderRadius: 10, marginRight: 8, backgroundColor: colors.dividerHair },
  receiptRemoveBadge: { padding: 2 },
  receiptViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptViewerImage: {
    width: Dimensions.get('window').width,
    height: '80%',
  },
  receiptViewerCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
  },
  // TASK-016③：图标选择底部弹层（fade 遮罩 + 顶部圆角面板 + 6 列图标网格）
  iconPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  iconPickerSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: Dimensions.get('window').height * 0.72,
    paddingBottom: 16,
  },
  iconPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  iconPickerTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  iconPickerClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPickerGrid: { paddingHorizontal: 10 },
  iconPickerGridInner: { flexDirection: 'row', flexWrap: 'wrap' },
  iconPickerCell: {
    width: `${100 / 6}%` as unknown as `${number}%`,
    aspectRatio: 1.15,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  iconPickerCellActive: { backgroundColor: colors.link + '1A' },

  // ---------- 新版"记一笔"排版：头部一行(返回+类型切换+扫票) ----------
  txHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 10,
  },
  // 返回按钮：更大(40)、紫色外环（与"全部"Pill 同色）、加粗箭头，让返回入口足够明显
  txHeaderBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.link,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  // 编辑页右上角的删除按钮：与返回键同款圆环，用红色警示色
  txDeleteBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.expense,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 类型导航（支出/收入/转账/兑换）：一体框格——外层一个大框，内部四格间竖分割线贯通整格；
  // 点击渲染整个格子（选中紫实底铺满格内全部空间，无内 padding 缝隙 → 不会出现"框中框"）；
  // 选中格带 2px 底线标记当前页面；字体 14 饱满；按钮尺寸 flex:1 四等分 + minHeight 46 不变
  txHeaderTypeSwitch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.bg,
    borderRadius: 14, // 与统计页 amountBox 圆角一致
    borderWidth: 1,
    borderColor: colors.dividerHair,
    overflow: 'hidden', // 分割线与选中底色裁进外框圆角内，视觉上与外框连成一体
  },
  // 格间竖分割线：stretch 贯通整格高度（与金额网格分隔线同色）
  txHeaderTypeDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.dividerHair },
  txHeaderTypeBtn: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 按下（未选中项）：泛 link 浅底
  txHeaderTypeBtnSink: { backgroundColor: colors.link + '14' },
  // 按下（已选中项）：底色加深
  txHeaderTypeBtnSinkActive: { backgroundColor: colors.fabBg },
  txHeaderTypeBtnActive: { backgroundColor: colors.fabBg },
  txHeaderTypeText: { fontSize: 14, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
  txHeaderTypeTextActive: { color: colors.bg },
  // 选中项底线：2px 高、60% 宽，标记"目前在什么页面"
  txHeaderTypeUnderline: { height: 2, width: '60%', marginTop: 3, borderRadius: 1, backgroundColor: colors.bg },
  txHeaderScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.link,
    backgroundColor: colors.bg,
  },
  txHeaderScanBtnText: { fontSize: 12, fontWeight: '600', color: colors.link },

  // ---------- 资产账户内联下拉（备用样式保留） ----------
  assetDropdownFloating: {
    marginHorizontal: 20,
    marginTop: 8,
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    overflow: 'hidden',
  },

  // ---------- 金额 Hero 区：整屏视觉主角（货币胶囊贴左侧，金额在胶囊右侧的整段空间里居中，
  // 数字变长时光标一路向右推进到屏幕边缘才缩字） ----------
  // Hero 外框:与转账/兑换页"资金流向卡"同款——bg 底、圆角 18、1px 描边
  // 宽度:转账卡所在内容区左右 padding 18(总 36),记一笔页面是 20(总 40),
  // 这里用 -2 外边距补偿,让两页卡片宽度一致;上下留白比原来拉高(20/18 → 24/22)
  heroCard: {
    backgroundColor: colors.bg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    // TASK-022：顶部留白从 5 收到 2.5（三处同步缩共省 9.2px，卡边到 MYR/0.00 ≈ 9px）；
    // 左右/底部保持 5
    paddingTop: 2.5,
    paddingBottom: 5,
    paddingHorizontal: 5,
    // 左右留白与转账/兑换一致:内容区滚动容器无水平 padding,这里直接给 18
    marginHorizontal: 18,
    // 顶部与转账页"资金流向卡"对齐:那边是零上边距贴着头部排,这边也要 0,
    // 切换支出/收入/转账时两张卡的第一条边在同一高度
    marginTop: 0,
    marginBottom: 5,
  },
  heroAmountWrap: {
    flexDirection: 'column',
    // TASK-022：上方留白从 4 收到 2（三处同步缩，见 heroCard 注释）
    // D-2 真机反馈：胶囊下探后底部余白偏大，下方收紧 4→2
    paddingTop: 2,
    paddingBottom: 2,
    // 左右 0：账户按钮距卡内边 = 卡片 padding 5，与转账页"转出资金"块完全一致
    paddingHorizontal: 0,
  },
  // 金额行:固定高 44（TASK-015：固定大小不随输入位数变化）——
  // D-2：货币钮并入账户选择器成 L 型标签后，行内只剩金额；标签由 heroCurrencyWrap 负
  // margin 上移到本行（见 heroCurrencyWrap 注释），对齐沿用校准体系（顶对齐+金额 paddingTop 9.3）
  heroAmountLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    height: 44,
    flexShrink: 0,
  },
  // ---------- D-3：L 型选择器（SVG 一笔轮廓版，2026-09-24 用户拍板）----------
  // 视觉全部由 SVG Path 承担（外填紫罩 + 一根描边画完整个 L，内凹圆角自然拐进胶囊顶边）；
  // RN 视图只负责内容与触区。旧 View 边框方案（heroCurrencyTab/TabInner/Touch 盒）退役——
  // 双色调相接必有色阶线、内凹拐角 View 画不出，是接缝去不掉的根因
  heroLSvg: { position: 'absolute', top: 0, left: 0 },
  // 标签触区+内容行：随内容自适应宽（onLayout 实测喂给 SVG 路径的 wt），不随账户框加长
  heroLTabRow: {
    height: 38,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
  },
  // 账户触区+内容行（L 型下半）：图标圆 + 完整账户名（超一行自动折行，行高 54 容两行）+ 内联箭头
  heroLAccRow: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 6,
  },
  heroCurrencyTabText: { fontWeight: '700', color: colors.link },
  // 账户触区内容：与转账块同规格（图标圆 40 + 账户名 13/700 + 内联箭头）；盒边框/底色归 SVG 路径
  // 下拉箭头：与转账/兑换账户块同款（size 12 / textTertiary / 右上角定位）
  // TASK-019：金额行下方第二行 = 账户框（左）+ 自动月结开关（右）并排
  // D-2：L 型组合的胶囊顶边随负 margin 上探越过本行顶部，必须 overflow visible 放行；
  // marginTop 归零让胶囊顶边贴住标签底边（一体相接）
  heroSecondRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 0,
    overflow: 'visible',
  },
  // 下拉箭头：TASK-019 改为内联跟在账户名后（图1 排列），不再钉右上角
  heroCurrencyChevron: { marginLeft: 6 },
  // ---------- 月度结转开关（TASK-022 图示胶囊按钮式，用户反馈加大）：左状态圆 + 右文字，开时发光描边 ----------
  autoMonthlyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 40,
    marginRight: 5,
    // D-3.2：与账户框右缘留 8px（marginRight 5 保留=金额右缘对齐锚点不动）
    marginLeft: 8,
    paddingLeft: 8,
    paddingRight: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.dividerHair,
    backgroundColor: colors.card,
  },
  // 开：link 发光描边（阴影同色模拟霓虹）+ 微亮底
  autoMonthlyRowOn: {
    borderColor: colors.link,
    backgroundColor: colors.link + '14',
    shadowColor: colors.link,
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  autoMonthlyLabel: { fontSize: 13, fontWeight: '600', color: colors.textTertiary },
  autoMonthlyLabelOn: { color: colors.link, fontWeight: '700' },
  // 左状态圆：关=空心圈；开=实心 link 圆内白 ✓（由 JSX 条件渲染，圆尺寸不变）
  autoMonthlyStateCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: colors.dividerHair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoMonthlyStateCircleOn: {
    backgroundColor: colors.link,
    borderColor: colors.link,
  },
  // MYR 触发器容器（D-3.4：账户框弹性撑满至月结开关左侧 8px（用户红竖线定版）——长名单行展示；
  // 高度由 JSX 内联 HH 给出）
  // 负 margin 把整块上移到与金额同行：标签顶 = 弹层 paddingTop 2 + 4.7（原货币钮校准位），
  // 即 -(2+44) + 6.7 = -39.3；胶囊顶边随之上探越过行顶，靠 heroSecondRow overflow visible 放行；
  // 月结开关经 alignItems center 自对齐胶囊中线（±1px），左缘 8px 间隙（autoMonthlyRow marginLeft）。
  // 货币标签贴内容宽（heroLTabRow 自适应），不跟账户框宽度走
  heroCurrencyWrap: { flex: 1, flexDirection: 'column', marginTop: -39.3 },
  // 账户触区内容在 SVG 之上，不再需要盒边框/底色（视觉归 SVG 路径）
  // 主行：40×40 圆角图标 + 账户名，与 transferAccountMain/Icon/Name 同规格
  heroCurrencyIconCircle: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  // 账户名：两行内完整展示（numberOfLines=2）；flexShrink 让长名在框内折行而非溢出
  heroCurrencyAccName: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, marginLeft: 10, flexShrink: 1 },
  // 金额:对齐资产页（800 右对齐、等宽数字）；字号由组件内 heroAmountFontSize 按位数微调;
  // 外层（TouchableOpacity 点按热区）：占金额行整行宽度
  heroAmountTextWrap: {
    flex: 1,
    flexShrink: 1, // 大金额时金额侧收缩让位，14 位也不撑变形（D-2：货币钮已并入账户选择器）
    minWidth: 0, // 允许缩到比内容窄：配合 numberOfLines=1 + 缩字截断
    alignItems: 'flex-end',
    justifyContent: 'center',
    // 对齐 MYR 标签（标签已由负 margin 回到原货币钮校准位）：标签文字中心 ≈ 24.3（行顶相对）；
    // 金额 paddingTop 9.3 后中心 ≈ 26.6——沿用五轮校准的视觉平行关系，勿改回居中
    paddingTop: 9.3,
    height: '100%',
    position: 'relative', // 光标的定位基准
  },
  // 内层（CursorAmountText 容器）：内容右对齐，宽度随内容不撑满
  heroAmountTextInner: {
    alignItems: 'flex-end',
  },
  heroAmountText: {
    // 字号由组件内 heroAmountFontSize 给出（TASK-022：基准 21 号，超 9 位每字 −0.25）；
    // lineHeight 由 JSX 内联 21×1.2=25.2——与货币按钮同一 lineHeight，基线完全平行；
    // 字重 800/等宽数字一致；颜色日夜分档——金额区底是浅紫 L 型填充，日间必须深字
    // （货币标签 link/账户名 textPrimary 同族深色，白字曾只在夜间正确）；
    // TASK-022：paddingRight 22→5——光标已内联不再需要预留位，右缘对齐下方开关按钮
    // （autoMonthlyRow marginRight: 5，同一 5px 让金额光标与开关右缘垂直对齐）
    fontWeight: '800',
    color: isDark ? colors.netWorthValue : colors.textPrimary,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    width: 'auto',
    paddingRight: 5,
  },
  // 光标：内联在金额文字流里（CursorAmountText 切片渲染），紧跟光标位置而非固定右下角
  heroCursorInline: { fontWeight: '300', color: colors.link },

  // ---------- 账户选择弹窗头部：货币显示切换按键 ----------
  accountPickerCurrencyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.link + '14',
    borderWidth: 1,
    borderColor: colors.link + '33',
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginRight: 8,
  },
  accountPickerCurrencyBtnText: { fontSize: 12, fontWeight: '700', color: colors.link, marginRight: 2 },

  // ---------- 账户弹窗里的币种下拉：悬浮在货币按钮正下方（绝对定位不占布局空间），点空白处收起 ----------
  currencyDropCatch: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 18 },
  currencyDropPanel: {
    position: 'absolute',
    top: 62, // 紧贴头部 MYR 按钮的正下方（加了把手条后头部整体下移过 15px，这里同步校准）
    right: 54,
    zIndex: 20,
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    paddingVertical: 4,
    minWidth: 150,
    elevation: 6,
  },
  currencyDropTitle: { fontSize: 11, fontWeight: '600', color: colors.textTertiary, paddingHorizontal: 14, paddingVertical: 6 },
  currencyDropItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  // TASK-023：菜单项按压瞬间高亮（Pressable pressed 态）——亮紫底，比选中常亮态 '14' 更实
  currencyDropItemPressed: { backgroundColor: colors.link + '2E' },
  currencyDropItemText: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  rateCursor: { fontSize: 17, fontWeight: '300', color: colors.link, marginLeft: 2 },
  feeCursor: { fontSize: 15, fontWeight: '400', color: colors.link, marginLeft: 3 },

  // ---------- 类别自适应网格（点击仍是"进入选择页" ----------
  categorySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    marginTop: 2,
    marginBottom: 6,
  },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  sectionLabelMuted: { fontSize: 12, color: colors.textTertiary },
  // "全部"入口做成紫色药丸按钮，比纯文字明显得多
  sectionMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.link + '14',
    borderWidth: 1,
    borderColor: colors.link + '33',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 13,
  },
  sectionMoreText: { fontSize: 12, fontWeight: '700', color: colors.link, marginRight: 2 },
  // 分类网格容器：flexWrap 自动叠层；左右 18 与 hero 卡边距对齐，行间 6
  categoryChipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 18,
    columnGap: 5,
    rowGap: 6,
    paddingBottom: 6,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderRadius: 15, // TASK-011 三轮：圆角做方一些（19→15）——用户定版值，不随字号等比
    borderWidth: 1,
    borderColor: colors.dividerHair,
    paddingHorizontal: 6,
    paddingVertical: 3.5, // 字号 15 等比增高：3→3.5，总高 20座→23座+7+2 = 32
    minHeight: 32, // 2026-09-25 字号15批次：胶囊总高 28→32（等比 ×1.154）
  },
  categoryChipIconBox: {
    width: 23, // 字号 15 等比增高：20→23（图标 glyph 同步 13→15）
    height: 23,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  // 文字 14 号（2026-09-25 二批）：宽度自适应胶囊（minWidth 网格宽，长名加长），不再 flexShrink 截断
  categoryChipLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  // "全部"入口 Pill：尺寸/圆角/内边距与类别胶囊一致，紫色描边+紫色文字做入口区分；
  // 宽度由 JSX 内联 categoryChipW 给出（与胶囊同一格宽）
  morePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15, // 与 categoryChip 同步（19→15）
    borderWidth: 1,
    borderColor: colors.link,
    backgroundColor: colors.bg,
    paddingHorizontal: 6,
    paddingVertical: 3.5, // 与 categoryChip 同步等比增高
    minHeight: 32, // 与新高胶囊对齐（殿后格不变矮）
  },
  morePillText: { fontSize: 14, fontWeight: '600', color: colors.link },

  // ---------- 转账/兑换新版整页排版 ----------
  exchangeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 10,
  },
  exchangeBackBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.dividerHair,
  },
  exchangeHeaderCenter: { flex: 1, alignItems: 'center', marginLeft: -34 },
  exchangeHeaderEyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 1.4, color: colors.textTertiary },
  exchangeHeaderTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, marginTop: 1 },
  exchangeHeaderSpacer: { width: 34 },
  exchangePageContent: { paddingHorizontal: 18, paddingBottom: 26 },

  transferRouteCard: {
    backgroundColor: colors.bg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    padding: 5,
  },
  transferRouteTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  transferRouteHint: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.3 },
  transferStatusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12, backgroundColor: colors.card },
  transferStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.income, marginRight: 5 },
  transferStatusText: { fontSize: 9, fontWeight: '700', color: colors.textSecondary },
  transferRouteRow: { flexDirection: 'row', alignItems: 'center' },
  transferAccountBlock: { flex: 1, minWidth: 0, minHeight: 46, padding: 8, borderRadius: 15, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.dividerHair },
  transferAccountBlockRight: { alignItems: 'flex-end' },
  transferAccountCaption: { fontSize: 10.5, fontWeight: '700', color: colors.textTertiary, letterSpacing: 0.8, marginBottom: 6 },
  transferAccountCaptionRight: { textAlign: 'right' },
  transferAccountMain: { flexDirection: 'row', alignItems: 'center' },
  transferAccountIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  transferAccountInfo: { marginLeft: 10, flex: 1, minWidth: 0 },
  transferAccountInfoRight: { marginRight: 10, flex: 1, minWidth: 0, alignItems: 'flex-end' },
  transferAccountName: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  transferAccountChevron: { position: 'absolute', top: 1, right: 1 },
  transferAccountChevronRight: { position: 'absolute', top: 1, left: 1 },
  transferRouteArrow: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.dividerHair, alignItems: 'center', justifyContent: 'center', marginHorizontal: 8 },

  // 合并卡：金额、汇率、手续费纵向三行叠在同一张卡里，用 padding 撑开呼吸感
  exchangeRateCard: { marginTop: 6, backgroundColor: colors.bg, borderRadius: 18, borderWidth: 1, borderColor: colors.dividerHair, paddingHorizontal: 13, paddingVertical: 12 },
  exchangeRateTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },

  // 两行网格：每行左右各一格，中间一条竖线分隔，行与行之间用 exchangeRateDivider 横线分隔
  // flexWrap：转出/转入任意一侧出现大金额放不下时，整格自动换到第二行（与兑换同样的行为），两种货币不撞
  rateGridRow: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap' },
  rateGridDividerVertical: { width: 1, backgroundColor: colors.dividerHair, marginHorizontal: 12, alignSelf: 'stretch' },
  rateGridCellLeft: { flex: 1, alignItems: 'flex-start', paddingVertical: 6 },
  rateGridCellRight: { flex: 1, alignItems: 'flex-end', paddingVertical: 6 },
  rateGridLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginBottom: 6 },
  rateGridValueRow: { flexDirection: 'row', alignItems: 'baseline' },
  // 标签行：转出/转入标签与后置货币提示同排，右格整体靠右
  rateGridLabelRow: { flexDirection: 'row', alignItems: 'center' },
  // 后置货币提示「(MYR)」：小号淡色，贴在标签文字右侧（不与金额数字碰撞）
  rateGridLabelSuffix: { fontSize: 11, fontWeight: '700', color: colors.textTertiary, marginLeft: 4 },
  rateGridValue: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  // 到账金额用 income 色区分，一眼跟左边"要付出的钱"分开
  rateGridValueTo: { color: colors.income },
  // 普通转账的"转入金额"单独一个颜色，跟兑换的"到账"绿色区分开——想换颜色改这一行就行
  rateGridValueTransfer: { color: colors.income },
  // 汇率居中格：夹在转出金额和到账之间，小标签+汇率值纵向堆叠、整体水平垂直都居中
  rateCenterCell: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 6 },
  rateCenterLabel: { fontSize: 11, fontWeight: '700', color: colors.textTertiary, marginBottom: 4 },

  // 手续费扣费提示：小字说明"到账是扣完手续费后的金额换算出来的"
  exchangeFeeHintRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingHorizontal: 2 },
  exchangeFeeHintText: { flex: 1, fontSize: 10, color: colors.textTertiary, marginLeft: 4 },
  rateGridCalcIcon: { marginLeft: 4 },
  // 汇率数值：颜色用 link 强调色，保持"这里能点"的视觉权重
  rateFieldValue: { fontSize: 18, fontWeight: '800', color: colors.link },
  exchangeRateDivider: { height: 1, backgroundColor: colors.dividerHair, marginTop: 14 },

  feeEntryCard: { marginTop: 10, minHeight: 64, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 16, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.dividerHair, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feeEntryLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
  feeIconCircle: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  feeEntryTitle: { fontSize: 12, fontWeight: '800', color: colors.textPrimary },
  feeEntrySubtitle: { fontSize: 8, color: colors.textTertiary, marginTop: 3 },
  feeEntryRight: { flexDirection: 'row', alignItems: 'center', marginLeft: 8 },
  feeEntryValue: { fontSize: 11, fontWeight: '700', color: colors.textTertiary, marginRight: 5 },
  feeEntryValueActive: { color: colors.textPrimary },

  transferMetaRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  transferMetaLeft: { flexDirection: 'row', alignItems: 'center' },
  transferMetaLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginLeft: 8 },
  transferMetaNoteRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center' },
  transferFeeValueButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 8, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.card },
  transferFeeValue: { fontSize: 18, fontWeight: '800', color: colors.textTertiary, marginRight: 6 },
  transferFeeValueActive: { color: colors.textPrimary },
  transferBottomTip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8, paddingHorizontal: 12 },
  transferBottomTipText: { fontSize: 9, color: colors.textTertiary, marginLeft: 5, textAlign: 'center' },
  transferStickyFooter: { paddingTop: 9, borderTopWidth: 0 },
  transferSaveBtn: { minHeight: 52, marginHorizontal: 0, marginTop: 0, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  transferSaveIcon: { width: 25, height: 25, borderRadius: 12.5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center', marginRight: 7 },

  // ---------- 转账账户选择菜单 ----------
  // 与支出/收入共用同一套树内弹层外壳样式（sheet/header/列表/底部按钮全部同款）
  // 下拉收起的把手条：与日期选择面板同款视觉
  accountPickerGrabber: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.divider,
    marginBottom: 10,
  },
  accountPickerSheet: {
    // 树内覆盖层里的贴底面板：absolute 锚定屏幕底部，高度 82%（与原 Modal 版一致）
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 9, // 底部留白减半：底部还有"添加新账户"按钮自身的安全区内边距
    height: '82%',
    borderWidth: 1,
    borderColor: colors.dividerHair,
  },
  accountPickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, zIndex: 21 },
  accountPickerHeaderRight: { flexDirection: 'row', alignItems: 'center' },
  accountPickerTitle: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
  accountPickerSubtitle: { fontSize: 10, color: colors.textTertiary, marginTop: 4 },
  accountPickerClose: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  accountSearchBox: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: 13,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.dividerHair,
  },
  accountSearchInput: { flex: 1, fontSize: 12, color: colors.textPrimary, marginLeft: 8, paddingVertical: 0 },
  accountFilterRow: { flexDirection: 'row', marginTop: 10, marginBottom: 8 },
  // 显眼外框：全部/现金/银行卡/信用卡/电子钱包每个芯片都有 1px 描边（选中态 fabBg 实底覆盖）
  accountFilterChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.dividerHair, marginRight: 7 },
  accountFilterChipActive: { backgroundColor: colors.fabBg },
  // 字号与账户名（accountPickerName）一致，读起来不费劲
  accountFilterText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  accountFilterTextActive: { color: colors.bg },
  accountPickerList: { flex: 1 }, // 固定高度面板内撑满剩余空间，列表自身滚动
  accountPickerFooter: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.dividerHair,
  },
  accountDefaultBadge: { fontSize: 7, fontWeight: '700', color: colors.income, marginLeft: 6, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, backgroundColor: colors.income + '18' },
  // ---------- 账户弹层分组卡（资产页 currencyGroup* 同款）：一币一大卡、卡内小账户框 ----------
  accountGroupShadow: {
    borderRadius: 20,
    shadowColor: '#1B1040',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 5,
    marginBottom: 5,
  },
  accountGroupCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  accountGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  accountGroupFlag: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountGroupFlagText: { fontSize: 13, fontWeight: '700', color: colors.netWorthValue },
  accountGroupFlagEmoji: { fontSize: 22, marginTop: -2 },
  accountGroupCode: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.netWorthLabel, marginLeft: 10 },
  accountGroupTotal: { fontSize: 20, fontWeight: '800', color: colors.netWorthValue, marginLeft: 6, fontVariant: ['tabular-nums'] },
  accountGroupBody: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.18)',
  },
  // 卡内账户小框（资产页 assetRowOnGradient 同款）：半透明白底无边框
  accountGroupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 12,
    paddingVertical: 5,
    paddingHorizontal: 9,
    marginBottom: 3,
  },
  accountGroupRowActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
  accountGroupRowIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountGroupRowInfo: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', marginLeft: 12 },
  accountGroupRowName: { fontSize: 15, fontWeight: '700', color: colors.netWorthValue, flexShrink: 1 },
  accountGroupRowAmount: { fontSize: 16, fontWeight: '700', color: colors.netWorthValue, marginLeft: 8, fontVariant: ['tabular-nums'] },
  addAccountPickerBtn: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    backgroundColor: colors.bg,
  },
  addAccountPickerText: { fontSize: 14, fontWeight: '700', color: colors.link, marginLeft: 7 },

  feeModalRoot: { flex: 1, justifyContent: 'flex-end' },
  feeModalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.overlay },
  feeModalSheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20, borderWidth: 1, borderColor: colors.dividerHair },
  feeModalHandle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: colors.dividerHair, marginBottom: 15 },
  feeModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feeModalEyebrow: { fontSize: 8, fontWeight: '800', letterSpacing: 1.1, color: colors.textTertiary },
  feeModalTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },
  feeModalClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  feeModalHint: { fontSize: 10, color: colors.textTertiary, marginTop: 9, lineHeight: 15 },
  feeModalInputCard: { flexDirection: 'row', alignItems: 'center', marginTop: 15, paddingHorizontal: 15, height: 64, borderRadius: 16, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.link },
  feeModalCurrency: { fontSize: 20, fontWeight: '800', color: colors.link, marginRight: 7 },
  feeModalInput: { flex: 1, fontSize: 30, fontWeight: '800', color: colors.textPrimary, padding: 0 },
  feeConfirmBtn: { height: 48, borderRadius: 15, backgroundColor: colors.fabBg, marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  feeConfirmText: { color: colors.bg, fontSize: 14, fontWeight: '800', marginRight: 7 },
  });
}
