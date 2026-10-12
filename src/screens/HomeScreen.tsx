import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SectionList, Modal, TextInput, Platform, Keyboard } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent, TextStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';


import { useFocusEffect } from '@react-navigation/native';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, withSequence, cancelAnimation, runOnJS, useAnimatedReaction, Easing } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '../context/AppContext';
import { CURRENCY_OPTIONS, getEnglishCurrencyName } from '../utils/currencies';
import { useT } from '../i18n/LanguageContext';
import { getCategoryLabel } from '../i18n/categories';
import { useLanguage } from '../i18n/LanguageContext';
import type { LangMode } from '../i18n';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler, useTabBarForceHide } from '../context/TabBarAutoHideContext';
import { ThemeColors, Elevation, Layout, Radius, SemanticColors, Spacing, layout as pageLayout } from '../theme/theme';
import { formatMoney as fmtMoney, HIDDEN_AMOUNT } from '../utils/formatMoney';
import { formatDate } from '../utils/formatDate';
import type { Ledger, Transaction } from '../types';
import { UNCATEGORIZED_ICON, UNCATEGORIZED_NAME, UNCATEGORIZED_COLOR } from '../constants/uncategorized';
import PressableScale from '../components/PressableScale';
import { AppText, BottomSheet, Button, EmptyState, GlassView, HeroGradient, IconButton, IconCircle, ListSection, MoneyText, StatusBarGlass } from '../components/ui';
import { withAlpha } from '../components/ui/color';
// HeroMetalSheen / AuroraFlowShader 文件与色 token 原样保留（可恢复）；V2 定稿里没有
// 紫色金属卡与流光，所以这里不再 import —— 陀螺仪（useHeroSheen）也就不会启动，省电。
import { AmountCalculatorKeypad } from '../components/AmountCalculatorKeypad';
import { useAmountExpression } from '../hooks/useAmountExpression';
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

/** 账本图标兜底色（旧数据无 color 时显示蓝，与 addLedger / 默认账本一致） */
const DEFAULT_LEDGER_COLOR = '#4C9AFF';
/** 从记一笔返回后，新增行「闪一下」的时长（T09 / H8：500ms 淡紫底） */
const FLASH_ROW_MS = 500;

// ── UI V2 首页版型常量（数值取自 .zcode/design/mockups/G_HomeDark|Light.dc.html 的内联样式）──
/** Hero 净资产整数段字号（V2 稿：58 / 500；RM 24 / 小数 28 由 MoneyText 按比例派生） */
const HERO_AMOUNT_SIZE = 40;
/** 大金额行盒高（V2 稿 line-height 64；隐藏态的 •••••• 也用它，显隐切换时行高不跳） */
const HERO_AMOUNT_LINE = 64;
/** 金额行的「眼睛」占位宽（眼睛 36 + 间距 10，V2 稿 1:1）：金额盒子的宽度上限 = 行宽 − 它 */
const HERO_EYE_RESERVE = 46;
/** 金额行与眼睛的间距（V2 稿 10；比 spacing.sm 大 2，按稿 1:1） */
const HERO_EYE_GAP = 10;
/** 账单列表卡圆角（V2 稿 26 —— 比 radius.lg(20) 大的内容卡档，只在首页用） */
const LIST_CARD_RADIUS = 22;
// ── 币种分页（手势）调参：真机 logcat 里的 [pager] 日志可以对照着调 ──
/** 甩动速度超过它才算「甩」（px/s） */
const PAGER_FLING_V = 500;
/** 速度超过它时方向用速度判定，否则用位移判定（px/s） */
const PAGER_DIR_V = 300;
/** 拖动位移超过页宽的这个比例也翻一页（慢拖过半） */
const PAGER_DIST_FRAC = 0.25;
/** 速度超过 PAGER_FLING_V 之后，每多这么多 px/s 额外翻一页 */
const PAGER_EXTRA_V_STEP = 700;
/** 翻页动画时长：基准 320ms，每多翻一页 +60ms；ease-out cubic，无回弹 */
const PAGER_BASE_MS = 320;
const PAGER_EXTRA_MS = 60;
/** 与 Gesture.Pan().activeOffsetX 一致：激活时的 10px 要扣掉，否则第一帧会跳 10px */
const PAGER_ACTIVATE_OFFSET = 10;
/** 开发构建下打印每次甩动的 velocityX / translationX / pages */
const PAGER_DEBUG = __DEV__;

function logPagerFling(vx: number, tx: number, pages: number) {
  console.log(`[pager] velocityX=${Math.round(vx)} translationX=${Math.round(tx)} pages=${pages}`);
}
// 账单卡左右外边距 = 页面边距令牌 layout.page（与预算卡同一条左右边线；QA 发现 12 与预算卡错位）
const LIST_CARD_MARGIN = pageLayout.page;
/** 行间分割线左缩进（V2 稿 70 = 行内边距 16 + 图标圆 42 + 行间距 12，正好与文字左缘对齐） */
const TX_SEP_INSET = 70;
/** 列表卡上下露出的卡边（V2 稿 4px） */
const LIST_CARD_EDGE = 4;

type IconName = keyof typeof Ionicons.glyphMap;

/** 账单 SectionList 的一组（T09 / H6）：data = 该日账单行（SectionList 认这个键），
 *  label = formatDate 的日期头、dateSub = 今天/昨天时补在后面的「10月10日 周六」、
 *  monthSep = 跨月时插的月份分隔、expense/income = 当日合计 */
type TxDaySection = {
  date: string;
  label: string;
  dateSub: string | null;
  monthSep: string | null;
  expense: number;
  income: number;
  currency: string;
  items: Transaction[];
  data: Transaction[];
  /** 首组：日期头承担列表卡的 26 上圆角 */
  isFirst: boolean;
  /** 末组：组内最后一行承担列表卡的 26 下圆角 */
  isLast: boolean;
};

function monthKeyOf(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 渐变上大金额的投影（V2 稿：0 2px 20px，比旧版的大而柔）。
 * 色取品牌深紫令牌（heroDark 起点色）按主题配透明度 —— 不在页面里写死色值。
 * UI V2.1 §3：投影只在夜间给（浅字压深紫渐变）；日间文字是深色压浅色渐变，投影只会糊字。
 */
function heroTextShadowStyle(darkestGradientColor: string, isDark: boolean): TextStyle {
  if (!isDark) return {};
  return {
    textShadowColor: withAlpha(darkestGradientColor, 0.35),
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 20,
  };
}

/** 账本创建时间戳 → 'YYYY-MM-DD'（本地时区；账本行的日期展示用） */
function formatDateTs(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── 账本抽屉的单行（T10 / H11，UI V2 换圆图标）──
// 结构：42 圆图标（IconCircle）+ 中间列（名称 ≤2 行 / 分币种结余 / 预设·创建于）+ 右侧「铅笔改名 / 垃圾桶删除」。
// ⚠ 改名与删除两个 IconButton 必须放在可点主区 **外面**（同级的动作列）：主区是 Pressable
//   （Web 上是 <button>），按钮放进去会变成 button 套 button（读屏重复 + 控制台 hydration 报错，
//   此前日历药丸踩过一次）。动作列固定宽 88（两个 44 触控区），各行铅笔左缘对齐；
//   中间列 minWidth 0 —— 长名字 / 长余额从这一列压缩，任何元素的右边界都不会越过 344（360 宽屏）。
// ⚠ 默认账本不渲染删除键（H11：默认账本不可删，就不该显示删除键）。
type LedgerRowProps = {
  ledger: Ledger;
  active: boolean;
  isDefault: boolean;
  /** 该账本的分币种结余（[币种代码, 金额]） */
  totals: [string, number][];
  renaming: boolean;
  renameValue: string;
  renameInputRef: React.RefObject<TextInput | null>;
  onRenameValueChange: (v: string) => void;
  onCommitRename: () => void;
  onStartRename: () => void;
  onDelete: () => void;
  onSelect: () => void;
};

function LedgerRow({
  ledger,
  active,
  isDefault,
  totals,
  renaming,
  renameValue,
  renameInputRef,
  onRenameValueChange,
  onCommitRename,
  onStartRename,
  onDelete,
  onSelect,
}: LedgerRowProps) {
  const { semantic, spacing, layout } = useTheme();
  const t = useT();
  const { langMode } = useLanguage();
  const baseColor = ledger.color ?? DEFAULT_LEDGER_COLOR;
  const styles2 = useMemo(() => makeLedgerRowStyles(semantic, spacing, layout), [semantic, spacing, layout]);

  // 改名态：这一行换成行内输入（与旧交互一致：点铅笔 → 名字变输入框，失焦 / 回车提交）
  if (renaming) {
    return (
      <View style={styles2.renameRow}>
        <TextInput
          ref={renameInputRef}
          style={[
            styles2.renameInput,
            { color: semantic.textPrimary, borderColor: semantic.accent, backgroundColor: semantic.bg },
          ]}
          value={renameValue}
          onChangeText={onRenameValueChange}
          onBlur={onCommitRename}
          onSubmitEditing={onCommitRename}
          selectTextOnFocus
          returnKeyType="done"
          autoFocus
          accessibilityLabel={t('home.editLedger')}
        />
        <Button title={t('common.save')} size="sm" fullWidth={false} onPress={onCommitRename} />
      </View>
    );
  }

  return (
    <View style={[styles2.row, active && { backgroundColor: semantic.accentSoft }]}>
      {/* 主区（整块可点 = 切换账本）：左 42 圆图标 + 中间三行（名称 / 余额 / 预设或创建于）。
          ⚠ 外层 mainWrap 才是被 flex 约束的那一层：PressableScale 的 style 落**内层** Animated.View 上，
            直接给它 flex:1 不会让外层 Pressable 收窄 —— 长账本名会把动作列顶出 344（360 宽屏自检抓到过）。
            做成「有界外层 + 内层铺满」后：中间列 minWidth 0 先压缩文字，动作列永远贴在 344 以内 */}
      <View style={styles2.mainWrap}>
        <PressableScale
          onPress={onSelect}
          activeScale={0.98}
          hitSlop={0}
          style={styles2.main}
          accessibilityRole="button"
          accessibilityLabel={active ? `${ledger.name}，${t('home.selected')}` : ledger.name}
          testID={`ledger-row-${ledger.id}`}
        >
          {/* 账本图标：42 圆（V2：列表图标一律圆形；底色/图标色由 IconCircle 从账本色派生） */}
          <IconCircle color={baseColor} icon={ledger.icon as IconName} />
          <View style={styles2.col}>
            <AppText variant="headline" numberOfLines={2}>
              {ledger.name}
            </AppText>
            {totals.length === 0 ? (
              <AppText variant="subhead" color={semantic.textSecondary}>
                {t('home.noAssets')}
              </AppText>
            ) : (
              totals.map(([code, amount]) => (
                // 抽屉是「看不出是什么钱」的地方 → 带币种代码（计划 4.4）；金额走 MoneyText（flexShrink 1：
                // 长余额在窄屏/长币种下压缩换紧凑格式，绝不把右侧动作列挤出 344）
                <View key={code} style={styles2.balanceLine}>
                  <AppText variant="subhead" color={semantic.textSecondary}>
                    {code}
                  </AppText>
                  <MoneyText value={amount} variant="subhead" color={semantic.textPrimary} style={styles2.balanceAmount} />
                </View>
              ))
            )}
            <AppText variant="caption" color={semantic.textSecondary} numberOfLines={1}>
              {isDefault
                ? t('home.defaultLedger')
                : t('home.createdOn', { date: ledgerCreatedLabel(ledger.createdAt, langMode) })}
            </AppText>
          </View>
        </PressableScale>
      </View>
      {/* 动作列放在可点区之外（整行是 button，按钮放进去会 button 套 button）。
          固定宽 88（两个 44 触控区）：默认账本只有铅笔，铅笔左缘与其它行一致；删除键在行尾 */}
      <View style={styles2.actions}>
        <IconButton
          icon="pencil"
          size={20}
          accessibilityLabel={t('home.editLedger')}
          onPress={onStartRename}
          testID={`ledger-rename-${ledger.id}`}
        />
        {!isDefault && (
          <IconButton
            icon="trash-outline"
            size={20}
            color={semantic.danger}
            accessibilityLabel={t('home.deleteLedger')}
            onPress={onDelete}
            testID={`ledger-delete-${ledger.id}`}
          />
        )}
      </View>
    </View>
  );

}

/** 账本抽屉单行的样式（令牌进、StyleSheet 出；LedgerRow 自己 useMemo 一份）。
 *  规格与 ui/ListRow 同族（minHeight / 内边距 / 按压），中间列多一行（预设·创建于），
 *  图标托换成 V2 的 42 圆（ui/IconCircle）—— 行内没有第二种画风。 */
function makeLedgerRowStyles(semantic: SemanticColors, spacing: Spacing, layout: Layout) {
  return StyleSheet.create({
    // 一行 = 可点主区 + 动作列；选中底色铺满整行
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: layout.rowMinHeight,
      paddingHorizontal: layout.card,
      paddingVertical: spacing.sm,
    },
    // 被 flex 约束的外层：flex 1 + minWidth 0（内层 Pressable 铺满它，见 JSX 注释）
    mainWrap: { flex: 1, minWidth: 0 },
    main: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.md,
    },
    // 中间列：名称（≤2 行）→ 余额（逐币种一行）→ 预设 / 创建于。
    // minWidth 0：长名字 / 长余额先压缩这一列，绝不把右侧动作列挤出屏
    col: { flex: 1, minWidth: 0, rowGap: 2 },
    balanceLine: { flexDirection: 'row', alignItems: 'baseline', columnGap: spacing.xs },
    // 余额数字可压缩（放不下自动换紧凑格式），保证行右缘 ≤ 页面边距内的 344
    balanceAmount: { flexShrink: 1 },
    // 动作列：铅笔 + 垃圾桶（各 44 触控区），固定宽 88 保证各行铅笔左缘对齐；
    // 默认账本只有铅笔，右侧同宽留白
    actions: {
      width: 88,
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 0,
    },
    // 改名态：行内输入 + 保存按钮（与旧交互一致：失焦 / 回车提交）
    renameRow: {
      minHeight: layout.rowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.sm,
      paddingHorizontal: layout.card,
      paddingVertical: spacing.sm,
    },
    renameInput: {
      flex: 1,
      flexShrink: 1,
      minHeight: 40,
      fontSize: 15,
      fontWeight: '600',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderWidth: 1,
      borderRadius: 10,
    },
  });
}

/** 账本创建时间：今年的只写月日（10月8日 周四），跨年带上年份（2025年10月8日 周三）——
 *  两种都走 formatDate 的既有档位，不自己拼字符串 */
function ledgerCreatedLabel(createdAt: number, lang: LangMode): string {
  const d = new Date(createdAt);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return formatDate(d, lang, { style: sameYear ? 'full' : 'fullWithYear' });
}

/** 账单行的 key：交易 id（稳定函数，放模块作用域避免每次渲染换身份） */
function txKeyExtractor(item: Transaction) {
  return item.id;
}

// 切币种列表过渡参数：旧列表淡出 140ms 后，新列表入场时间轴 = 520ms + 前 6 格（0..5）每格错峰 30ms
const LIST_IN_MS = 520;
const LIST_IN_STAGGER_MS = 30;
const LIST_IN_STAGGER_MAX_INDEX = 5;
const LIST_IN_TOTAL_MS = LIST_IN_MS + LIST_IN_STAGGER_MS * LIST_IN_STAGGER_MAX_INDEX;
const LIST_IN_LIFT = 36;

/** 列表格子（日期头 / 行）的过渡包装：淡出 = outP；入场 = 本格的缓出三次方进度（上滑 36，无回弹、无缩放）。
 *  纯 UI 线程 useAnimatedStyle，不用 entering / exiting 属性（Fabric 下会 addViewAt 崩） */
function ListEnterItem({ index, outP, inT, children }: { index: number; outP: SharedValue<number>; inT: SharedValue<number>; children: React.ReactNode }) {
  const style = useAnimatedStyle(() => {
    const delay = Math.min(index, LIST_IN_STAGGER_MAX_INDEX) * LIST_IN_STAGGER_MS;
    const local = Math.min(1, Math.max(0, (inT.value * LIST_IN_TOTAL_MS - delay) / LIST_IN_MS));
    const e = 1 - Math.pow(1 - local, 3);
    return { opacity: outP.value * e, transform: [{ translateY: (1 - e) * LIST_IN_LIFT }] };
  });
  return <Reanimated.View style={style}>{children}</Reanimated.View>;
}

/** 分割线随列表一起淡入淡出（不上滑） */
function TxSeparatorEnter({ outP, inT }: { outP: SharedValue<number>; inT: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const local = Math.min(1, (inT.value * LIST_IN_TOTAL_MS) / LIST_IN_MS);
    return { opacity: outP.value * (1 - Math.pow(1 - local, 3)) };
  });
  return (
    <Reanimated.View style={style}>
      <TxSeparator />
    </Reanimated.View>
  );
}

// 行间发丝分割线（T09 / H4）：与 ListSection 的分割线同款（左右缩进 = 卡内边距，与行文字对齐）。
// ⚠ 必须放在模块作用域：写成组件体内的箭头函数会在每次渲染时变成新的组件类型 →
//   ItemSeparatorComponent 每次渲染都卸载重挂，VirtualizedList 的测量（frames / 平均行高）
//   反复失效，滚动时不再补渲染后面的行（T09 自检实测：45 笔只出前 5 行、滚到底没内容）。
function TxSeparator() {
  const { semantic, layout } = useTheme();
  return (
    // 外层 = 卡的底色（分割线两侧的行都是 surface；不铺底会从 1px 缝里透出后面的渐变）
    <View style={{ backgroundColor: semantic.homeCard, marginHorizontal: LIST_CARD_MARGIN }}>
      <View
        style={{
          height: StyleSheet.hairlineWidth,
          backgroundColor: semantic.homeHairline,
          marginLeft: TX_SEP_INSET,
        }}
      />
    </View>
  );
}

// ── 账单行（UI V2）：左 42 圆图标（IconCircle）+ 标题（备注）+ 副标题（类别 · 账户）+ 右金额。
// V2 定稿把全 App 列表图标改成圆形，而 ui/TransactionRow 是本车道之外的共享文件（改它会波及其它
// 车道），所以首页与日历明细行按同规格自绘一份：几何与 TransactionRow 一致，只把 40 方块换成 42 圆。
// 行自己铺 surface 底 —— 列表滚动时行会压到渐变区上，不铺底会透出渐变。
type TxRowProps = {
  /** 标题（有备注用备注，没有则调用方传类别名） */
  title: string;
  /** 副标题第一段（标题已经是类别名时传空串） */
  categoryName: string;
  categoryIcon: IconName;
  categoryColor: string;
  accountName?: string;
  amount: number;
  kind: 'expense' | 'income';
  /** 命中「新增后闪一下」：淡紫底 */
  flash?: boolean;
  /** 列表卡的最后一行：26 下圆角 + 4pt 卡底边 */
  isCardBottom?: boolean;
  onPress: () => void;
  testID?: string;
};

function TxRow({
  title,
  categoryName,
  categoryIcon,
  categoryColor,
  accountName,
  amount,
  kind,
  flash,
  isCardBottom,
  onPress,
  testID,
}: TxRowProps) {
  const { semantic, spacing, layout } = useTheme();
  const rowStyles = useMemo(() => makeTxRowStyles(semantic, spacing, layout), [semantic, spacing, layout]);
  // V3：金额 15 / 600，等宽数字（TextStyle 上下文类型让 'tabular-nums' 收窄为 FontVariant）
  const rowAmountStyle = useMemo<TextStyle>(
    () => ({ fontSize: 15, lineHeight: 20, fontVariant: ['tabular-nums'] }),
    []
  );
  // 副标题：类别 · 账户（账户缺失时只有类别，不留下孤零零的分隔点）
  const subtitle = [categoryName, accountName].filter((part): part is string => !!part).join(' · ');
  return (
    <PressableScale
      onPress={onPress}
      onLongPress={onPress}
      activeScale={0.98}
      // 行本身 ≥60 高，外扩 hitSlop 会抢到相邻行的手势
      hitSlop={0}
      style={[
        rowStyles.row,
        flash && { backgroundColor: semantic.accentSoft },
        isCardBottom && rowStyles.rowCardBottom,
      ]}
      testID={testID}
    >
      {/* 类别图标：42 圆（底色/图标色由 IconCircle 按主题从类别色派生） */}
      <IconCircle color={categoryColor} icon={categoryIcon} shape="tile" size={38} />
      {/* 中：flex:1 吃掉剩余宽度，把金额顶到行尾 */}
      <View style={rowStyles.textBlock}>
        <AppText variant="subhead" weight="600" style={rowStyles.rowTitleText} numberOfLines={2}>
          {title}
        </AppText>
        {!!subtitle && (
          <AppText variant="caption" weight="400" color={semantic.textTertiary} style={rowStyles.rowSubText} numberOfLines={1}>
            {subtitle}
          </AppText>
        )}
      </View>
      {/* 右：金额（MoneyText 自带 flexShrink:0，不要在外面包固定宽度） */}
      <MoneyText value={amount} kind={kind} variant="body" weight="600" style={rowAmountStyle} />
    </PressableScale>
  );
}

/** TxRow 的样式（令牌进、StyleSheet 出；几何取自 V2 稿：行高 ≥60、内边距 16、行间距 12） */
function makeTxRowStyles(semantic: SemanticColors, spacing: Spacing, layout: Layout) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.md,
      minHeight: 60,
      paddingHorizontal: layout.card,
      paddingVertical: 9,
      backgroundColor: semantic.homeCard,
      // 列表卡左右边距 = LIST_CARD_MARGIN（= 页面令牌，与预算卡同一边线） —— 卡体就是这些行 + 日期头拼出来的（SectionList 内容不好整体收窄）
      marginHorizontal: LIST_CARD_MARGIN,
    },
    // 末行 = 列表卡底边：26 下圆角（只圆下两角 → 行高 60 足够撑出真 26 弧）+ 稿里卡内下 4pt
    rowCardBottom: {
      borderBottomLeftRadius: LIST_CARD_RADIUS,
      borderBottomRightRadius: LIST_CARD_RADIUS,
      paddingBottom: spacing.sm + LIST_CARD_EDGE,
    },
    textBlock: { flex: 1, minWidth: 0, rowGap: 2 },
    rowTitleText: { fontSize: 14, lineHeight: 19 },
    rowSubText: { fontSize: 12, lineHeight: 16 },
  });
}

// ── V2 渐变上的 44 玻璃圆钮（铃铛 / 日历）：GlassView 玻璃材质 + text.primary 图标
//    （UI V2.1 §3：日间不再有白图标压在浅色玻璃上）；
//    按压反馈挂在**外层** PressableScale 上（玻璃整块缩才看得见）。
//    44 = V2 稿的 .gb 规格（也是全 App 最小触控区），图标 20 与 IconButton 同档。
const GLASS_ROUND = 44;

function GlassRoundButton({
  icon,
  accessibilityLabel,
  accessibilityState,
  onPress,
  testID,
}: {
  icon: IconName;
  accessibilityLabel: string;
  accessibilityState?: React.ComponentProps<typeof PressableScale>['accessibilityState'];
  onPress: () => void;
  testID?: string;
}) {
  const { semantic } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      activeScale={0.9}
      hitSlop={0}
      style={glassRoundStyles.touch}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      testID={testID}
    >
      <GlassView radius="full" style={glassRoundStyles.glass}>
        <Ionicons name={icon} size={20} color={semantic.textPrimary} />
      </GlassView>
    </PressableScale>
  );
}

/** 44 圆钮的纯图形几何（尺寸来自 V2 稿，不进间距体系） */
const glassRoundStyles = StyleSheet.create({
  touch: { width: GLASS_ROUND, height: GLASS_ROUND, borderRadius: GLASS_ROUND / 2 },
  glass: { width: GLASS_ROUND, height: GLASS_ROUND, alignItems: 'center', justifyContent: 'center' },
});

// ── accent 渐变主按钮（UI V2：与「记一笔」完成键 / 中央「+」同一条渐变）──
// ui/Button 只有平涂档（那是全 App 共享文件、不在本车道可改范围），所以按同规格自绘一层：
// 几何与 ui/Button 的 md/primary 一致（高 50 / radius.md / 内边距 xl·md / 图标 20 + 间距 sm）。
const GRADIENT_BTN_HEIGHT = 50;

function GradientButton({
  title,
  icon,
  onPress,
  testID,
}: {
  title: string;
  icon?: IconName;
  onPress: () => void;
  testID?: string;
}) {
  const { semantic, spacing, radius, gradients } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      activeScale={0.97}
      style={[
        gradientButtonStyles.button,
        {
          minHeight: GRADIENT_BTN_HEIGHT,
          borderRadius: radius.md,
          paddingHorizontal: spacing.xl,
          paddingVertical: spacing.md,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={testID}
    >
      {/* 渐变填充铺满按钮底（白字压在上面）：135° accent 渐变，色值只从令牌取 */}
      <LinearGradient
        colors={gradients.accent.colors}
        locations={gradients.accent.locations as [number, number, ...number[]]}
        start={gradients.accent.start}
        end={gradients.accent.end}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={gradientButtonStyles.content} pointerEvents="none">
        {icon && <Ionicons name={icon} size={20} color={semantic.onAccent} style={{ marginRight: spacing.sm }} />}
        <AppText variant="headline" color={semantic.onAccent} align="center" style={gradientButtonStyles.label}>
          {title}
        </AppText>
      </View>
    </PressableScale>
  );
}

/** 渐变主按钮的静态几何（尺寸/内边距在渲染期从令牌取；这里只留与令牌无关的排布） */
const gradientButtonStyles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  label: { flexShrink: 1 },
});


export default function HomeScreen({ navigation }: any) {
  const {
    transactions,
    loading: dataLoading,
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
    activeAssets,
    paymentPlans,
    getAssetBalance,
    getAssetById,
  } = useApp();

  const { colors, isDark, semantic, spacing, layout, radius, elevation, glass, gradients, motion } = useTheme();
  const t = useT();
  const { langMode: homeLang } = useLanguage();
  const insets = useSafeAreaInsets();
  // 版型分级（计划 8.2 第 2 条）：矮屏 / 平板等内容收窄仍用它，不再用 Dimensions
  const layoutTokens = useLayout();

  const tabClearance = useTabClearance();

  const onTabScroll = useTabBarScrollHandler();
  const styles = useMemo(
    () => makeStyles(colors, isDark, semantic, spacing, radius, layout, elevation),
    [colors, isDark, semantic, spacing, radius, layout, elevation]
  );
  // 渐变 / 玻璃上的文字（UI V2.1 §3）：日夜统一 text.primary —— 夜间不再用暗灰，
  // 日间不再有白字压在浅色渐变上。⚠ 不能退回 onAccent（白）/ glassPill.muted（夜 0.70 透明）：
  // 夜间 hero 渐变是亮紫（实测底色 ~rgb(100,83,160)），半透明浅字只有 3.7:1，不达 §4 的 4.5；
  // 层级改由字号 / 字重承担（金额 display、标签 footnote/caption 本身分档）
  const onGradientText = semantic.textPrimary;
  const onGradientMuted = semantic.textPrimary;
  const heroShadow = useMemo(
    () => heroTextShadowStyle(gradients.heroDark.colors[0], isDark),
    [gradients, isDark]
  );
  // 吸顶日期头的判据仍是「头部区实测高度」（heroHeightRef，见 onLayout）；
  // 渐变高度不再参与计算 —— UI V2.1 §1 的 fill 模式铺满整页
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
    setBalanceHidden((prev) => {
      AsyncStorage.setItem(BALANCE_HIDDEN_KEY, prev ? '0' : '1').catch(() => {});
      return !prev;
    });
  };

  // ── 日夜切换：圆心扩散换肤 + 三合一胶囊里的「日/夜」段已按 T08 删除 ──
  // 主题改为跟随系统（T01e，设置页可手动指定），首页不再放切换按钮，也不再需要那套遮罩动画。
  const [ledgerPickerOpen, setLedgerPickerOpen] = useState(false);
  // 账本抽屉（T10 / H11）：改用 ui/BottomSheet —— 拖动把手下拉关闭、点遮罩关闭、安全区、
  // 打开期间强制收起浮空 Tab 栏都由它内部处理，原来这套自绘（scrim / pan / 入场位移动画 /
  // manualActivation 手势 / Reanimated.ScrollView + 滚动偏移判定）整体退役。
  // 行改用 ui/ListRow（图标方块 + 名称/副标题 + 结余 + 铅笔/垃圾桶），默认账本不再显示删除键。
  const closeLedgerPicker = () => setLedgerPickerOpen(false);
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
  // 币种列表按 ABC 字母序排列（2026-09-24 用户定版）
  const totalsByCurrency = useMemo(() => {
    const totals: Record<string, number> = {};
    activeAssets
      .filter((a) => a.ledgerId === activeLedgerId)
      .forEach((a) => {
        totals[a.currency] = (totals[a.currency] || 0) + getAssetBalance(a.id);
      });
    return Object.entries(totals).sort(([c1], [c2]) => c1.localeCompare(c2));
  }, [activeAssets, activeLedgerId, getAssetBalance]);

  // 净资产卡显示的币种：多币种时点行调出货币下拉菜单；默认=资产数组第一个账户的币种（兜底全局货币）
  const defaultNetWorthCurrency = useMemo(() => {
    const first = activeAssets.find((a) => a.ledgerId === activeLedgerId);
    return first?.currency ?? currency;
  }, [activeAssets, activeLedgerId, currency]);
  // 用户手选的币种代码（null=未手选过，跟随默认）——列表已按 ABC 排序，不能再用下标，否则默认币种会跟着排序漂移
  const [netWorthCurrency, setNetWorthCurrency] = useState<string | null>(null);
  const [currencyMenuOpen, setCurrencyMenuOpen] = useState(false);
  // V3：币种面板 = ui/BottomSheet（切换币种），搜索词仅在 >6 个币种时出现
  const [currencyQuery, setCurrencyQuery] = useState('');
  // 金额行实测宽（Δ>0.5 才更新）：只给金额盒子当 maxWidth 用（短金额盒子贴合内容，眼睛紧贴金额；
  // 超长金额被夹住 → MoneyText 内部按档降级）。行宽由页面 flex 决定、与金额字号无关 —— 单向数据流
  const [amountRowW, setAmountRowW] = useState(0);
  const openCurrencyMenu = () => {
    if (totalsByCurrency.length <= 1) return;
    setCurrencyMenuOpen(true);
  };
  const displayTotal =
    totalsByCurrency.find(([c]) => c === (netWorthCurrency ?? defaultNetWorthCurrency)) ?? totalsByCurrency[0];
  // 净资产当前选中的币种：本月支出合计、预算都跟随它（每个币种各设各的预算）
  const activeCurrency = displayTotal?.[0] ?? currency;
  // 头部首次进场（挂载时淡入 + 微上滑）与日历卡进场：共享值 + useEffect，不用 entering 动画
  const heroEnterP = useSharedValue(0);
  const heroEnterStyle = useAnimatedStyle(() => ({
    opacity: heroEnterP.value,
    transform: [{ translateY: (1 - heroEnterP.value) * 12 }],
  }));
  useEffect(() => {
    heroEnterP.value = withTiming(1, { duration: 240, easing: motion.easing.out });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 列表 remount 锁存：数据第一次非空后永远是 'ready'（左右滑到空币种不再整表重挂）
  const hasEverHadDataRef = useRef(false);
  // V3：当前币种在列表中的下标（底部小圆点）
  const curIdx = totalsByCurrency.findIndex(([c]) => c === activeCurrency);
  // ── 净资产横移 = UI 线程手势分页（替换旧的横向 ScrollView 分页：安卓惯性被截断、拖动中 setState 打断甩动）──
  // 页条 = 一个 translateX 的横向 strip，页宽 = 行实测宽 pagerW；拖动实时跟手，越界橡皮筋；
  // 松手时按甩动速度投影出目标页（甩得快可以跨多页），动画结束才把 netWorthCurrency 提交一次；
  // 胶囊文字 / 小圆点只在「页下标变化」时才 setState（useAnimatedReaction），不随每帧重渲染。
  // 每页 MoneyText 挂载即定格、只在数据真变时才逐位滚动。
  const pagerX = useSharedValue(0);
  const pagerStart = useSharedValue(0);
  const pagerW = useSharedValue(0);
  const pagerN = useSharedValue(1);
  /** 1 = 正在拖动或翻页动画中（布局同步不许碰 pagerX） */
  const pagerBusy = useSharedValue(0);
  const pagerStripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pagerX.value }] }));
  /** 拖动 / 动画中的「预览页下标」（由 reaction 同步；null = 未就绪，用已提交的 curIdx） */
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  // 胶囊 / 小圆点读预览下标（过半即切换）
  const shownIdx = previewIdx != null && totalsByCurrency[previewIdx] ? previewIdx : curIdx;
  const shownCurrency = totalsByCurrency[shownIdx]?.[0] ?? activeCurrency;
  const shownRow = totalsByCurrency[shownIdx];

  // 手势回调里要读最新的 totals / activeCurrency：走 ref，手势对象只在「多页 / 减弱动效」变化时重建
  const pagerSettleRef = useRef<(idx: number) => void>(() => {});
  const pagerOpenRef = useRef<() => void>(() => {});
  pagerSettleRef.current = (idx: number) => {
    const row = totalsByCurrency[idx];
    if (row && row[0] !== activeCurrency) setNetWorthCurrency(row[0]);
  };
  pagerOpenRef.current = openCurrencyMenu;
  const pagerSettle = useCallback((idx: number) => pagerSettleRef.current(idx), []);
  const pagerOpen = useCallback(() => pagerOpenRef.current(), []);

  const multiPage = totalsByCurrency.length > 1;
  const reduceMotion = motion.reduceMotion;
  const pagerGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(multiPage)
      .activeOffsetX([-PAGER_ACTIVATE_OFFSET, PAGER_ACTIVATE_OFFSET])
      // 竖向超过 14 就放弃 → 竖向滚动交给外层列表
      .failOffsetY([-14, 14])
      .onStart(() => {
        // 在途动画先停，再从停下的位置开始拖（起点在这里记，不在 onBegin 记）
        cancelAnimation(pagerX);
        pagerBusy.value = 1;
        pagerStart.value = pagerX.value;
      })
      .onUpdate((e) => {
        const w = pagerW.value;
        // translationX 从手指按下算起，含激活前的 10px → 扣掉，保证拖动连续
        const tx = e.translationX - (e.translationX > 0 ? PAGER_ACTIVATE_OFFSET : -PAGER_ACTIVATE_OFFSET);
        const min = -(pagerN.value - 1) * w;
        let nx = pagerStart.value + tx;
        // 两端橡皮筋：越界部分只跟 35%
        if (nx > 0) nx = nx * 0.35;
        else if (nx < min) nx = min + (nx - min) * 0.35;
        pagerX.value = nx;
      })
      .onEnd((e) => {
        const w = pagerW.value;
        if (w <= 0) {
          pagerBusy.value = 0;
          return;
        }
        const n = pagerN.value;
        const v = e.velocityX;
        const absV = Math.abs(v);
        const tx = e.translationX - (e.translationX > 0 ? PAGER_ACTIVATE_OFFSET : -PAGER_ACTIVATE_OFFSET);
        // 确定性翻页：从按下时所在页出发，按方向走 pages 页（不再靠速度投影，避免只翻一页）
        const startIdx = Math.round(-pagerStart.value / w);
        const dir = absV > PAGER_DIR_V ? (v < 0 ? 1 : -1) : tx < 0 ? 1 : -1;
        const basePages = Math.abs(tx) > PAGER_DIST_FRAC * w || absV > PAGER_FLING_V ? 1 : 0;
        const extra = Math.floor(Math.max(0, absV - PAGER_FLING_V) / PAGER_EXTRA_V_STEP);
        const pages = Math.min(basePages + extra, Math.max(0, n - 1));
        let idx = startIdx + dir * pages;
        if (idx < 0) idx = 0;
        if (idx > n - 1) idx = n - 1;
        if (PAGER_DEBUG) runOnJS(logPagerFling)(v, tx, pages);
        const target = -idx * w;
        if (reduceMotion) {
          pagerX.value = target;
          pagerBusy.value = 0;
          runOnJS(pagerSettle)(idx);
          return;
        }
        const ms = pages === 0 ? 220 : PAGER_BASE_MS + PAGER_EXTRA_MS * (pages - 1);
        // 只有动画自然结束才提交；被新手势打断（finished=false）不提交
        pagerX.value = withTiming(target, { duration: ms, easing: Easing.out(Easing.cubic) }, (finished) => {
          pagerBusy.value = 0;
          if (finished) runOnJS(pagerSettle)(idx);
        });
      });
    const tap = Gesture.Tap()
      .maxDistance(10)
      .maxDuration(500)
      .onEnd((_e, success) => {
        if (success) runOnJS(pagerOpen)();
      });
    return Gesture.Race(pan, tap);
  }, [multiPage, reduceMotion, pagerSettle, pagerOpen]);

  // 拖动中：页下标变化才同步到 JS（过半即切；不是每帧）
  useAnimatedReaction(
    () => {
      const w = pagerW.value;
      if (w <= 0) return -1;
      const i = Math.round(-pagerX.value / w);
      return Math.min(Math.max(i, 0), Math.max(0, pagerN.value - 1));
    },
    (next, prev) => {
      if (next >= 0 && next !== prev) runOnJS(setPreviewIdx)(next);
    }
  );

  // 页宽 / 页数变化（首次测量、增减币种）：瞬时对准当前页，不播动画
  useEffect(() => {
    if (amountRowW <= 0) return;
    // 拖动 / 翻页中只更新宽度，不动 pagerX（否则在途动画会被砍掉）
    if (pagerBusy.value) {
      pagerW.value = amountRowW;
      return;
    }
    const wanted = netWorthCurrency ?? defaultNetWorthCurrency;
    const idx = Math.max(0, totalsByCurrency.findIndex(([c]) => c === wanted));
    cancelAnimation(pagerX);
    pagerN.value = Math.max(1, totalsByCurrency.length);
    pagerX.value = -idx * amountRowW;
    // 先写 X 再写宽：reaction 读到 w>0 时 X 已经是目标位置
    pagerW.value = amountRowW;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountRowW, totalsByCurrency.length]);

  // 外部换页（币种面板选币 / 默认币种变化）：短动画滑到目标页；拖动提交后的同位调用是 no-op
  useEffect(() => {
    if (amountRowW <= 0 || totalsByCurrency.length === 0) return;
    const wanted = netWorthCurrency ?? defaultNetWorthCurrency;
    const idx = Math.max(0, totalsByCurrency.findIndex(([c]) => c === wanted));
    const target = -idx * amountRowW;
    cancelAnimation(pagerX);
    pagerX.value = reduceMotion ? target : withTiming(target, { duration: 200, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netWorthCurrency, defaultNetWorthCurrency]);
  // 币种面板行：默认币种（账本基础货币）排第一，其余保持原顺序；搜索按代码 / 中英文名过滤
  const currencySheetRows = useMemo(() => {
    const q = currencyQuery.trim().toLowerCase();
    const rows = totalsByCurrency.filter(([code]) => {
      if (!q) return true;
      const zhName = CURRENCY_OPTIONS.find((c) => c.code === code)?.name ?? '';
      const enName = getEnglishCurrencyName(code) ?? '';
      return code.toLowerCase().includes(q) || zhName.toLowerCase().includes(q) || enName.toLowerCase().includes(q);
    });
    const baseIdx = rows.findIndex(([c]) => c === currency);
    if (baseIdx > 0) {
      const [base] = rows.splice(baseIdx, 1);
      if (base) rows.unshift(base);
    }
    return rows;
  }, [totalsByCurrency, currencyQuery, currency]);
  // 交易所属币种（按账户币种；账户缺失时跟随全局货币）。必须 useCallback：
  // 它进 dayGroups 的依赖数组 —— 函数每帧换新身份会让 sections 每帧重建、列表整表重渲染
  // （验收退回的性能项：切 Tab 慢）
  const txCurrencyOf = useCallback(
    (t: { assetId?: string }) => (t.assetId ? getAssetById(t.assetId)?.currency : undefined) ?? currency,
    [getAssetById, currency]
  );
  const thisExpense = useMemo(
    () =>
      ledgerTransactions
        .filter((t) => t.type === 'expense' && t.date.startsWith(thisMonthKey) && txCurrencyOf(t) === activeCurrency)
        .reduce((s, t) => s + t.amount, 0),
    [ledgerTransactions, thisMonthKey, activeCurrency, getAssetById, currency]
  );
  // 当前币种的预算：每个币种各存一条；老数据没有 currency 字段的条目跟随全局设置货币
  const totalBudget = budgets.find((b) => b.categoryId === 'total' && (b.currency ?? currency) === activeCurrency)?.amount ?? 0;

  // 账单：按天分组（倒序）→ SectionList 的 sections（T09 / H4 / H6）。
  // 头部合计只算净资产卡当前选中币种；条目本身也只保留该币种（既有行为不变）。
  // 日期标签一律走 formatDate（今天 / 昨天 / 10月7日 周三）；跨月再插一条月份分隔（本月首次出现时给）
  const dayGroups = useMemo(() => {
    const activeCode = activeCurrency;
    const byDate = new Map<string, typeof ledgerTransactions>();
    ledgerTransactions.forEach((t) => {
      if (t.type === 'transfer') return;
      const list = byDate.get(t.date) ?? [];
      list.push(t);
      byDate.set(t.date, list);
    });
    // 先分组求合计，再剔掉「当前币种当天没有任何交易」的日子，最后才排「跨月月份分隔」——
    // 否则被剔掉的那天会白白吃掉 prevMonth 的更新，导致后面同月的组拿不到分隔标签
    const groups = Array.from(byDate.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, allItems]) => {
        const items = allItems.filter((t) => txCurrencyOf(t) === activeCode);
        const expense = items
          .filter((t) => t.type === 'expense')
          .reduce((s, t) => s + t.amount, 0);
        const income = items
          .filter((t) => t.type === 'income')
          .reduce((s, t) => s + t.amount, 0);
        return { date, expense, income, currency: activeCode, items };
      })
      .filter((g) => g.items.length > 0);

    let prevMonth = '';
    return groups.map((g, index) => {
      const month = g.date.slice(0, 7);
      let monthSep: string | null = null;
      if (month !== prevMonth) {
        prevMonth = month;
        // %{m} 取 date.months（中文「10月」/ 英文「Oct」），模板在本页 home 块里
        monthSep = t('home.monthSep', { y: g.date.slice(0, 4), m: t(`date.months.${Number(g.date.slice(5, 7)) - 1}`) });
      }
      // 日期头两段式（V2 稿「今天 10月10日 周六」）：相对词（今天/昨天）当主标，
      // 具体日期补在后面；非相对日期时 formatDate 本身就带全，副段留空不重复
      const label = formatDate(g.date, homeLang);
      const fullLabel = formatDate(g.date, homeLang, { relative: false });
      // 首/末组标记：列表卡的上下 26 圆角挂在首组日期头与末组最后一行的**自己身上**
      //（SectionList 的每一格都是独立节点，卡壳只能这样拼）—— 见 renderDayHeader / TxRow
      return {
        ...g,
        label,
        dateSub: label === fullLabel ? null : fullLabel,
        monthSep,
        data: g.items,
        isFirst: index === 0,
        isLast: index === groups.length - 1,
      };
    });
    // ⚠ t 是全局稳定引用：依赖数组必须带 homeLang，切语言后日期与月份分隔才会重算
  }, [ledgerTransactions, activeCurrency, txCurrencyOf, homeLang, t]);

  // ── 切币种列表过渡：旧列表淡出（140ms）→ 换成新币种数据 → 新列表缓慢上滑入场（520ms，无回弹）──
  // 只作用于 SectionList 的格子（日期头 / 行 / 分割线）：头部、胶囊、小圆点、预算卡都不动。
  // shownGroups = 列表真正显示的分组；过渡期间冻结在旧数据上，淡出结束才换成当前 dayGroups。
  const [shownGroups, setShownGroups] = useState(dayGroups);
  const listOutP = useSharedValue(1);
  const listInT = useSharedValue(1);
  const listTransitionRef = useRef(false);
  const dayGroupsRef = useRef(dayGroups);
  dayGroupsRef.current = dayGroups;
  const prevListCurrencyRef = useRef(activeCurrency);
  const swapInList = useCallback(() => {
    listTransitionRef.current = false;
    setShownGroups(dayGroupsRef.current);
    listOutP.value = 1;
    listInT.value = 0;
    listInT.value = withTiming(1, { duration: LIST_IN_TOTAL_MS, easing: Easing.linear });
  }, [listOutP, listInT]);
  // 币种变化（挂载时不播）：旧列表淡出 → 结束后 swapInList。被二次切换打断时 cancelAnimation，不会停在 0
  useEffect(() => {
    if (prevListCurrencyRef.current === activeCurrency) return;
    prevListCurrencyRef.current = activeCurrency;
    cancelAnimation(listOutP);
    cancelAnimation(listInT);
    if (motion.reduceMotion) {
      // 减弱动效：不播动画，dayGroups effect 直接同步
      listTransitionRef.current = false;
      listOutP.value = 1;
      listInT.value = 1;
      return;
    }
    listTransitionRef.current = true;
    listOutP.value = withTiming(0, { duration: 140, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) runOnJS(swapInList)();
    });
  }, [activeCurrency, listOutP, listInT, swapInList, motion.reduceMotion]);
  // 非过渡期间数据照常同步（新增 / 编辑账单即时可见）；过渡期间跳过，等淡出结束再换
  useEffect(() => {
    if (!listTransitionRef.current) setShownGroups(dayGroups);
  }, [dayGroups]);
  const TxSeparatorFaded = useMemo(
    () =>
      function TxSeparatorFadedItem() {
        return <TxSeparatorEnter outP={listOutP} inT={listInT} />;
      },
    [listOutP, listInT]
  );

  // 视图切换时把列表滚回顶部用（只读调用 scrollToOffset，不影响既有滚动行为）
  const listRef = useRef<SectionList<Transaction, TxDaySection>>(null);

  // ── H8：从记一笔返回后，新增的那一行闪一下（500ms 淡紫底）──
  // 判定用「离开首页前记下的 id 集合」比对：只在首页失焦期间新增的账单会闪，
  // 首次载入 / 切 Tab 回来 / 编辑已有账单都不闪（编辑后 id 不变）。
  const knownTxIdsRef = useRef<Set<string> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flashTxId, setFlashTxId] = useState<string | null>(null);
  const rememberTxIds = useCallback(() => {
    knownTxIdsRef.current = new Set(transactions.map((t) => t.id));
  }, [transactions]);
  useEffect(() => {
    // 本地数据读完先建一次基线（首屏不闪任何行）
    if (!dataLoading && knownTxIdsRef.current === null) rememberTxIds();
  }, [dataLoading, rememberTxIds]);
  useFocusEffect(
    useCallback(() => {
      const known = knownTxIdsRef.current;
      if (known && !dataLoading) {
        const added = transactions.filter((t) => !known.has(t.id));
        if (added.length > 0) {
          // 连记多笔时只闪最新的一笔（createdAt 降序取首）
          const newest = added.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
          setFlashTxId(newest.id);
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
          flashTimerRef.current = setTimeout(() => setFlashTxId(null), FLASH_ROW_MS);
        }
      }
      if (!dataLoading) rememberTxIds();
      return () => {
        // 离开首页：清闪 + 记下当前 id 集合，供下次回来比对
        if (flashTimerRef.current) {
          clearTimeout(flashTimerRef.current);
          flashTimerRef.current = null;
        }
        setFlashTxId(null);
        rememberTxIds();
      };
    }, [transactions, dataLoading, rememberTxIds])
  );

  // ── 账单行（V2）：TxRow —— 标题 = 备注（无备注用类别名）、副标题 = 类别 · 账户、
  //    支出中性色「−」/ 收入绿「+」；单击即编辑（与长按同一入口），长按保留；命中闪行时加淡紫底 ──
  const renderTxRow = useCallback(({ item, index, section }: { item: Transaction; index: number; section: TxDaySection }) => {
    const cat = getCategoryById(item.categoryId);
    const catName = cat ? getCategoryLabel(cat, t) : UNCATEGORIZED_NAME;
    const catIcon = (cat?.icon ?? UNCATEGORIZED_ICON) as IconName;
    const catColor = cat?.color ?? UNCATEGORIZED_COLOR;
    const assetName = item.assetId ? getAssetById(item.assetId)?.name : undefined;
    const openEdit = () => navigation.navigate(ROUTES.ADD_TX, { editTransaction: item });
    // 标题 = 备注（计划付款的 displayName 也当备注用）；两者都没有时标题落到类别名，
    // 这时副标题只显示账户、不再把类别写第二遍（验收小修：原来是「Dining / Dining · Maybank 储蓄」）。
    // 副标题固定是「类别 · 账户」拼接，把 categoryName 传空串即只剩账户
    const ownTitle = item.note?.trim() || item.displayName?.trim() || '';
    const hasOwnTitle = ownTitle.length > 0;
    // 列表卡底边 = 末组最后一行：26 下圆角 + 4pt 卡底边（稿里卡内 padding 下 4）
    const isCardBottom = !!section.isLast && index === (section.data?.length ?? 0) - 1;
    return (
      <ListEnterItem index={index} outP={listOutP} inT={listInT}>
        <TxRow
          title={hasOwnTitle ? ownTitle : catName}
          categoryName={hasOwnTitle ? catName : ''}
          categoryIcon={catIcon}
          categoryColor={catColor}
          accountName={assetName}
          amount={item.amount}
          kind={item.type === 'income' ? 'income' : 'expense'}
          flash={item.id === flashTxId}
          isCardBottom={isCardBottom}
          onPress={openEdit}
          testID={`tx-row-${item.id}`}
        />
      </ListEnterItem>
    );
    // 依赖：渲染期读到的都列进来；stable 的 renderItem 让 VirtualizedList 的 CellRenderer
    //（PureComponent，比较 renderItem 身份 + item 身份）在滚动 / 切 Tab 时跳过重渲染
  }, [t, getCategoryById, getAssetById, flashTxId, navigation, listOutP, listInT]);

  // 日期头（V2 稿）：左「今天」（15/500）+ 紧跟的「10月10日 周六」（caption 弱化色），
  // 右侧「支出 43.60」（caption 次要色，收入仍用收入绿）—— wrap 行：放不下自动换行，不缩字不省略；
  // 跨月时在日期头之上再插一条月份分隔
  const renderDayHeader = useCallback(({ section }: { section: TxDaySection }) => (
    // 首组的日期头就是列表卡的**顶边**：26 上圆角挂在这一格上（只圆上两角 → 高度够时是真 26 弧，
    // 不会被 CSS 圆角收缩规则压小）；其余组保持直角，跨组处靠卡内的发丝线/间距区分
    <View style={[styles.dayHeaderWrap, section.isFirst && styles.dayHeaderWrapFirst]}>
      {!!section.monthSep && (
        <AppText variant="caption" color={semantic.textSecondary} style={styles.monthSepText}>
          {section.monthSep}
        </AppText>
      )}
      <View style={styles.dayHeaderRow}>
        <AppText variant="caption" weight="600" color={semantic.textSecondary} style={styles.dayHeaderLabelText} numberOfLines={1}>
          {section.label}
        </AppText>
        {!!section.dateSub && (
          <AppText variant="caption" weight="500" color={semantic.textTertiary} style={styles.dayHeaderLabelText} numberOfLines={1}>
            {section.dateSub}
          </AppText>
        )}
        <View style={styles.dayHeaderTotals}>
          {section.expense > 0 && (
            <>
              <AppText variant="caption" weight="500" color={semantic.textTertiary}>
                {`${t('report.expense')} `}
              </AppText>
              {/* 支出金额 = 语义支出色（紫，V3 规则），与收入（绿）成对 —— 不覆盖成次要色：
                  显式 color 会把 amountExpense 语义色盖掉，表头就和下方流水行不一致了 */}
              <MoneyText value={section.expense} kind="expense" variant="caption" weight="600" />
            </>
          )}
          {section.expense > 0 && section.income > 0 && (
            <AppText variant="caption" color={semantic.textTertiary}>
              {'·'}
            </AppText>
          )}
          {section.income > 0 && (
            <>
              <AppText variant="caption" weight="500" color={semantic.textTertiary}>
                {`${t('report.income')} `}
              </AppText>
              <MoneyText value={section.income} variant="caption" weight="600" color={semantic.amountIncome} />
            </>
          )}
        </View>
      </View>
    </View>
  ), [semantic, styles, t]);

  // 列表内的日期头：切币种过渡时跟着列表淡出 / 上滑（吸顶条 / pinnedHeader 仍直接用 renderDayHeader，不动）
  const renderSectionHeaderEntering = useCallback(
    ({ section }: { section: TxDaySection }) => (
      <ListEnterItem index={0} outP={listOutP} inT={listInT}>
        {renderDayHeader({ section })}
      </ListEnterItem>
    ),
    [renderDayHeader, listOutP, listInT]
  );

  // 行间发丝分割线 = 模块作用域的 TxSeparator（稳定组件标识，见其定义处注释）

  // ── 吸顶日期头（T09 / H4）──
  // 不用 SectionList 自带的 stickySectionHeadersEnabled：react-native-web 的 position:sticky 包在
  // 虚拟化列表里会错位（自检实测：两条日期头叠着钉在顶部）。改成自己画一条「吸顶条」——
  // onViewableItemsChanged 给出「当前可见的第一项」，它属于哪一组就钉哪一组的日期头：
  //   · 第一项是 Hero（section 为空）→ 不显示（首屏顶部还给 Hero 卡）
  //   · 否则钉住那一组的日期头（含跨月月份分隔）—— web / 原生行为一致，且不是每帧 setState
  const [pinnedDate, setPinnedDate] = useState<string | null>(null);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 1, minimumViewTime: 0 }).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ section?: TxDaySection | null }> }) => {
      const next = viewableItems[0]?.section?.date ?? null;
      setPinnedDate((prev) => (prev === next ? prev : next));
    }
  ).current;
  const pinnedSection = pinnedDate ? dayGroups.find((g) => g.date === pinnedDate) ?? null : null;
  // Hero 卡实测高度 + 「列表已滚过 Hero」判定：吸顶条只在 Hero 完全滚出顶部后才显示。
  // ⚠ 不能只看 viewability：数据量大（1000 笔）时视图化时序会让「第一可见项」在首帧就报成某一组，
  //    吸顶条会叠在 Hero 上（自检抓到）。这里用滚动位置 vs Hero 高度显式判定，跨数据量都确定。
  const heroHeightRef = useRef(0);
  const [heroPassed, setHeroPassed] = useState(false);
  // 日历视图（详情 ⇄ 日历切换，HTML 原型拍板形态）──
  // 只在日历模式消费 dayGroups 派生数据，账单列表及其全部逻辑零改动。
  // viewMonth 独立记忆：切回详情再进来月份不重置
  const [viewMode, setViewMode] = useState<'detail' | 'calendar'>('detail');
  // 日历抽屉（底部弹入）：calEnterP 0→1 = 卡片自下而上 48→0 + 淡入（420ms，缓出三次方，无回弹 / 缩放）；
  // 切回列表：卡片下落淡出 220ms，卡片卸载后列表才淡入（卡片卸载时列表还是透明的，不会跳动）。
  // calDimP = 底下页面背景的浅遮罩：0→1→0（浅浅变深再淡回，只是过渡提示，最终不残留）。
  const calEnterP = useSharedValue(0);
  const calDimP = useSharedValue(0);
  // 切回列表时卡片还要留在树上播完下落动画：calExiting 在动画结束前保持 true
  const [calExiting, setCalExiting] = useState(false);
  const calRendered = viewMode === 'calendar' || calExiting;
  const calEnterStyle = useAnimatedStyle(() => ({ opacity: calEnterP.value, transform: [{ translateY: (1 - calEnterP.value) * 48 }] }));
  const calDimStyle = useAnimatedStyle(() => ({ opacity: calDimP.value * 0.6 }));
  // 卡片下落结束：卸载卡片，列表格子同时淡入（220ms）
  const finishCalExit = useCallback(() => {
    setCalExiting(false);
    if (!listTransitionRef.current) {
      listOutP.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) });
    }
  }, [listOutP]);
  // 切换日历 / 列表（唯一入口）：先取消上一段动画、定好初始值，再切 viewMode（同一批更新，首帧不闪）
  const toggleCalendarMode = useCallback(
    (nextMode: 'detail' | 'calendar') => {
      cancelAnimation(calEnterP);
      cancelAnimation(calDimP);
      const reduce = motion.reduceMotion;
      if (nextMode === 'calendar') {
        setCalExiting(false);
        if (reduce) {
          calEnterP.value = 1;
          calDimP.value = 0;
        } else {
          // 从当前值起跑（快速连点时不跳）
          calEnterP.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
          calDimP.value = withSequence(
            withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: 420, easing: Easing.out(Easing.quad) })
          );
        }
      } else if (reduce) {
        calEnterP.value = 0;
        calDimP.value = 0;
        setCalExiting(false);
      } else {
        setCalExiting(true);
        calDimP.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) });
        calEnterP.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) }, (finished) => {
          if (finished) runOnJS(finishCalExit)();
        });
        // 列表格子先压到透明（新挂上的行此时不可见），等卡片卸载后再淡入；过渡中的币种淡出不抢
        if (!listTransitionRef.current) {
          cancelAnimation(listOutP);
          listOutP.value = 0;
        }
      }
      setViewMode(nextMode);
    },
    [calEnterP, calDimP, finishCalExit, listOutP]
  );
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
        // 逐笔明细（点日期展开）：字段与首页列表行一一对应，回落规则也一致——
        // 标题 = 备注（计划名也当备注用），无备注时标题落到类别名、副标题只留账户（与 T09 小修同款）
        items: g.items.map((item) => {
          const cat = getCategoryById(item.categoryId);
          const catName = cat ? getCategoryLabel(cat, t) : UNCATEGORIZED_NAME;
          const ownTitle = item.note?.trim() || item.displayName?.trim() || '';
          return {
            id: item.id,
            note: ownTitle.length > 0 ? ownTitle : catName,
            categoryName: ownTitle.length > 0 ? catName : '',
            categoryIcon: (cat?.icon ?? UNCATEGORIZED_ICON) as IconName,
            categoryColor: cat?.color ?? UNCATEGORIZED_COLOR,
            accountName: item.assetId ? getAssetById(item.assetId)?.name : undefined,
            amount: item.amount,
            type: item.type as 'expense' | 'income',
          };
        }),
      })
    );
    return map;
    // ⚠ t 是全局稳定引用，依赖必须带 langMode，切语言明细标题才会重算
  }, [dayGroups, getCategoryById, getAssetById, t, homeLang]);
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
      activeAssets
        .filter((a) => a.ledgerId === l.id)
        .forEach((a) => {
          totals[a.currency] = (totals[a.currency] || 0) + getAssetBalance(a.id);
        });
      map[l.id] = Object.entries(totals);
    });
    return map;
  }, [ledgers, activeAssets, getAssetBalance]);

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

  // ---------- 预算：常驻细长条，整块可点，弹窗用自绘计算器键盘（与资产页编辑同款）----------
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  // 算式状态：预填当前预算值（退格逐位改 / C 归零重输 / 可直接按算式），「完成」求值落库
  const budgetExpr = useAmountExpression();

  const openBudgetModal = () => {
    budgetExpr.reset(totalBudget || 0);
    setBudgetModalOpen(true);
  };
  // 计算器「完成」= 求值保存：0/空 = 清掉这个币种的预算（与旧弹窗语义一致）
  const handleBudgetConfirm = () => {
    const value = budgetExpr.confirm();
    setBudget('total', !isNaN(value) && value > 0 ? value : 0, activeCurrency);
    setBudgetModalOpen(false);
    hapticSuccess();
  };

  const budgetPct = totalBudget > 0 ? Math.min((thisExpense / totalBudget) * 100, 100) : 0;
  const budgetOver = totalBudget > 0 && thisExpense > totalBudget;
  // 未封顶百分比（预算面板标题用）：超支时显示真实值（如 130%），进度条宽度仍封顶 100
  const budgetPctText = totalBudget > 0 ? Math.round((thisExpense / totalBudget) * 100) : 0;
  // 预算条单色状态（T08 / H3）：<80% 白（渐变上的白档）/ 80–100% warning / >100% danger
  const budgetBarColor = budgetOver
    ? semantic.danger
    : budgetPctText >= 80
      ? semantic.warning
      : semantic.textPrimary;

  // 预算进度条：宽度变化走令牌时长补间（目的：state indication）；fill 是 overflow:hidden 轨道里
  // 无子元素的绝对定位元素——唯一放行的 width 动画，圆角不会被 scaleX 拉糊。
  const budgetProgress = useSharedValue(0);
  useEffect(() => {
    budgetProgress.set(withTiming(budgetPct, { duration: motion.spring.default.duration, easing: motion.easing.out }));
  }, [budgetPct, budgetProgress, motion]);
  const budgetFillAnimStyle = useAnimatedStyle(
    () => ({ width: `${budgetProgress.get()}%` }),
    // web 端没有 Babel worklets 插件，useAnimatedStyle 必须显式传依赖数组
    [budgetProgress]
  );

  // 未读消息数（用户定版 2026-10-06：铃铛=有消息才出现的红点条件位）。
  // 当前 App 还没有消息系统 → 恒 0（红点不渲染）；消息系统接入后把这里接到真实未读数即可
  const unreadCount: number = 0;

  // 滚动：透传给 Tab 栏自动隐藏处理器（滚动期间缓动暂停），并维护吸顶条的显示条件
  // （V2 去掉了卡下辉光呼吸 —— 那张卡不存在了，相关定时器 / Animated 循环一并删除）
  const handleHomeScroll = useCallback(
    (e: any) => {
      // 吸顶条显示条件之一：列表已经滚过头部区（值只在边界翻转一次，不会每帧 setState）
      const y = e?.nativeEvent?.contentOffset?.y ?? 0;
      const passed = y >= heroHeightRef.current - 6;
      setHeroPassed((prev) => (prev === passed ? prev : passed));
      onTabScroll?.(e);
    },
    [onTabScroll]
  );

  if (dayGroups.length > 0) hasEverHadDataRef.current = true;
  return (
    <>
    {/* 顶部安全区不由 SafeAreaView 让位（全出血）：V2 的品牌渐变通顶连屏、状态栏压在渐变上
        （状态栏=透明，见 android styles.xml）；内容让位由头部区自身 paddingTop=insets.top 承担
        （见样式 heroTopRow 的 paddingTop 用 insets.top + 14 —— 与稿里「顶部 14」对齐） */}
    <SafeAreaView style={[styles.container, { backgroundColor: semantic.homeBg }]} edges={[]}
      onTouchStart={() => { Keyboard.dismiss(); }}
    >
      {/* 页面最底层 = 品牌渐变（UI V2.1 §1）：铺满整页（fill）、不再淡出成纯色底，
          卡片 / 列表 / 弹层全部浮在渐变上；网格线只在首页保留 */}
      <HeroGradient height={330} grid />
      {/* 顶部渐变底部淡出到页面底色（硬边修复）：最后 40% 高度从透明过渡到 homeBg */}
      <LinearGradient
        colors={isDark ? ['rgba(10,9,16,0)', '#0A0910'] : ['rgba(244,243,248,0)', '#F4F3F8']}
        locations={[0, 1]}
        style={styles.heroFadeOverlay}
        pointerEvents="none"
      />
      {/* 日历抽屉的浅遮罩（过渡提示）：压在页面背景（渐变）之上、列表 / 卡片之下；pointerEvents none，不挡点按 */}
      <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: semantic.scrim }, calDimStyle]} />
      {/* C1：顶部安全区挡板 —— 滚动时内容不从状态栏文字下穿过 */}
      <StatusBarGlass />
      {/* 首页主体 = 一个 SectionList（T09 / H4 / H6）：
          头部（Hero 区 + 日历卡）走 ListHeaderComponent，账单按天分组渲染（吸顶日期头 + 圆形图标行）；
          滚动事件继续透传给 Tab 栏自动隐藏（T07 联动）。
          底部悬空区由 App.tsx 的 TabShell 统一预留（68+18+安全区），这里只留一点呼吸感 */}
      <SectionList<Transaction, TxDaySection>
        ref={listRef}
        // ⚠ 数据「空 → 非空」时强制重挂列表 —— 验收退回「只出前几行」的真根因：
        //   VirtualizedList 的窗口状态在挂载那一刻按当时的数据算；AppContext 读本地数据是异步的，
        //   首页首帧 sections=[] → 它的 cellsAroundViewport 被钉成 { first: 0, last: -1 }，
        //   而源码里 _scheduleCellsToRenderUpdate 要求 last >= 0 才允许扩窗口 →
        //   数据随后到达窗口也不会恢复（表现：只有首批几行、滚到底没内容；数据碰巧先到就正常，
        //   所以小数据量时像偶发 bug）。让它在有真实 sections 时用新 key 重挂一次即可解决。
        key={hasEverHadDataRef.current ? 'ready' : 'empty'}
        // 虚拟化参数（验收要求的性能档）：一屏多一点首批、8 屏窗口、每批 10 条
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={8}
        // 安卓开视图裁剪（省内存 / 提升滚动性能）；Web 上无意义且会和 RNW 的测量打架
        removeClippedSubviews={false}
        // 日历模式下 sections 为空：列表不渲染（与旧的 display:none 等价），只剩头部卡
        sections={viewMode === 'calendar' ? [] : shownGroups}
        keyExtractor={txKeyExtractor}
        renderItem={renderTxRow}
        renderSectionHeader={renderSectionHeaderEntering}
        ItemSeparatorComponent={TxSeparatorFaded}
        // 吸顶（验收定版）：原生用系统吸顶；Web 关掉系统吸顶、改由下面自绘的「吸顶条」承担
        //   —— react-native-web 给每个日期头都套 position:sticky;top:0，包含块是整个内容容器，
        //      所有日期头会永久钉在顶部互相叠着（自检抓到过双头叠影）
        stickySectionHeadersEnabled={Platform.OS !== 'web'}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onScroll={handleHomeScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: tabClearance }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          // 日历模式不显示空状态（列表为空是刻意的）；真没账单时才给「记第一笔」
          viewMode === 'calendar' ? null : (
            <EmptyState
              icon="receipt-outline"
              title={t('home.noTx')}
              description={t('home.noTxHint')}
              actionLabel={t('home.addFirst')}
              onAction={() => navigation.navigate(ROUTES.ADD_TX)}
              style={styles.listEmpty}
            />
          )
        }
        ListHeaderComponent={
          <>
        {/* ── 头部区（UI V2 稿，不套卡）：渐变本身铺在页面最底层（见根节点 HeroGradient），
            顶部一行（账本胶囊 + 铃铛/日历 44 圆钮）→ 净资产 + 币种玻璃胶囊 → 大金额 + 眼睛 → 预算玻璃卡。
            实测高度写进 heroHeightRef：吸顶日期头据此判断头部区是否已滚出屏幕 */}
        <Reanimated.View
          style={[styles.heroBlock, { paddingTop: insets.top + 14 }, heroEnterStyle]}
          onLayout={(e) => {
            heroHeightRef.current = e.nativeEvent.layout.height;
          }}
        >
          {/* 顶部一行（V2 稿）：左「账本 ▾」玻璃胶囊（账本抽屉入口），右 铃铛 / 日历 两枚 44 玻璃圆钮 */}
          <View style={styles.heroTopRow}>
            <PressableScale
              onPress={() => setLedgerPickerOpen(true)}
              activeScale={0.94}
              hitSlop={0}
              style={styles.heroPillPress}
              accessibilityRole="button"
              accessibilityLabel={t('home.selectLedger')}
              accessibilityState={{ expanded: ledgerPickerOpen }}
              testID="home-ledger-pill"
            >
              <GlassView radius="full" style={styles.heroLedgerPill}>
                <AppText variant="subhead" weight="500" color={onGradientText} numberOfLines={1} style={styles.heroPillText}>
                  {activeLedger?.name ?? t('home.ledgerName')}
                </AppText>
                <Ionicons name="chevron-down" size={16} color={onGradientMuted} />
              </GlassView>
            </PressableScale>
            <View style={styles.heroTopActions}>
              <View style={styles.heroCtlWrap}>
                <GlassRoundButton
                  icon="notifications-outline"
                  accessibilityLabel={t('home.notificationTitle')}
                  onPress={() => dialog.alert({ title: t('home.notificationTitle'), message: t('home.notificationMsg') })}
                />
                {unreadCount > 0 && (
                  <View style={styles.notifBadge}>
                    <Text style={styles.notifBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                  </View>
                )}
              </View>
              <GlassRoundButton
                icon={viewMode === 'detail' ? 'calendar-outline' : 'list-outline'}
                accessibilityLabel={t('home.toggleView')}
                accessibilityState={{ selected: viewMode === 'calendar' }}
                onPress={() => {
                  hapticLight();
                  const nextMode = viewMode === 'detail' ? 'calendar' : 'detail';
                  toggleCalendarMode(nextMode);
                  // 切回列表时滚回顶部（避免长列表滚动位置残留、切回来看不到列表头）。
                  // ⚠ 只在「切回列表」时滚：切到日历时 sections 会置空，
                  //    此时 scrollToLocation 会因 item 数 0 报错（自检抓到 scrollToIndex out of range）；
                  //    等一帧让新 sections 上去再滚，SectionList 的公开 API 是 scrollToLocation
                  // 空账本（dayGroups 为空）没有可滚的 item：不滚，否则 scrollToIndex 越界崩溃
                  if (nextMode === 'detail' && dayGroups.length > 0) {
                    requestAnimationFrame(() => {
                      try {
                        listRef.current?.scrollToLocation({ sectionIndex: 0, itemIndex: 0, animated: false });
                      } catch {
                        // 列表已被卸载或数据已清空：忽略，保持当前位置
                      }
                    });
                  }
                }}
                testID="home-toggle-view"
              />
            </View>
          </View>

          {/* V3：居中玻璃胶囊「净资产 · 币种 ⌄」= 原币种入口（单币种时按不动，与旧行为一致） */}
          {displayTotal && (
            <View style={styles.heroNetWorthRow}>
              <PressableScale
                onPress={openCurrencyMenu}
                disabled={totalsByCurrency.length <= 1}
                activeScale={0.94}
                hitSlop={0}
                accessibilityRole="button"
                accessibilityLabel={t('home.selectCurrency')}
                accessibilityState={{ disabled: totalsByCurrency.length <= 1 }}
                testID="home-currency-pill"
              >
                <GlassView radius="full" style={styles.heroCurrencyPill}>
                  <AppText variant="caption" weight="600" color={onGradientText} style={styles.budgetText} numberOfLines={1}>
                    {/* 拖动过半时这里已经切到目标币种（previewIdx 预置），不用等吸附提交 */}
                    {`${t('home.netWorth')} · ${shownCurrency}`}
                  </AppText>
                  <Ionicons name="chevron-down" size={12} color={onGradientText} />
                </GlassView>
              </PressableScale>
                  <IconButton
                    icon={balanceHidden ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={onGradientMuted}
                    style={styles.heroEyeBtn}
                    hitSlop={4}
                    accessibilityLabel={t('home.toggleAmount')}
                    accessibilityState={{ checked: !balanceHidden }}
                    onPress={toggleBalanceHidden}
                    testID="home-toggle-amount"
                  />
            </View>
          )}

          {totalsByCurrency.length === 0 ? (
            /* 无账户（原空状态入口保留）：EmptyState 的文字是深色令牌，直接放渐变上读不了 →
               垫一张玻璃卡；按钮仍走现有「添加资产账户」入口 */
            <GlassView radius={24} style={styles.heroEmptyCard}>
              <EmptyState
                icon="wallet-outline"
                title={t('home.noAssetsTitle')}
                description={t('home.noAssetsHint')}
                actionLabel={t('home.addAccount')}
                onAction={() => navigation.navigate(ROUTES.ADD_ASSET)}
                testID="home-no-assets"
              />
            </GlassView>
          ) : (
            displayTotal && (
              /* 金额行（V2 稿）→ V3 跟手分页：一币种一页的横向 ScrollView，拖动实时跟随、按页吸附。
                 MoneyText hero —— 整数 40/700、小数 22/600（参数原样保留），挂载即定格、只在数据真变时
                 才逐位滚动，所以横移切换不再出现数字叠影；页宽 = 行实测宽（超长金额按档降级，不溢出）。
                 整行点按仍调出货币面板（原交互不变）；右侧眼睛在上方胶囊行 = 原隐藏金额入口 */
              <View
                style={styles.heroAmountRow}
                onLayout={(e) => {
                  const w = e.nativeEvent.layout.width;
                  setAmountRowW((prev) => (Math.abs(prev - w) >= 1 ? w : prev));
                }}
              >
                {amountRowW > 0 && (
                  <GestureDetector gesture={pagerGesture}>
                    <Reanimated.View
                      style={[styles.heroPagerClip, { width: amountRowW }]}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={`${t('home.netWorth')}：${
                        shownRow
                          ? balanceHidden
                            ? HIDDEN_AMOUNT
                            : fmtMoney(shownRow[1], { currency: shownRow[0], showCurrency: true })
                          : ''
                      }`}
                      testID="home-amount"
                    >
                      <Reanimated.View
                        style={[styles.heroPagerStrip, { width: amountRowW * totalsByCurrency.length }, pagerStripStyle]}
                      >
                        {totalsByCurrency.map(([code, total]) => (
                          <View key={code} style={[styles.heroPagerPage, { width: amountRowW }]}>
                            {balanceHidden ? (
                              <AppText
                                variant="display"
                                color={onGradientText}
                                style={[styles.heroHiddenAmount, heroShadow]}
                                numberOfLines={1}
                              >
                                {HIDDEN_AMOUNT}
                              </AppText>
                            ) : (
                              <MoneyText
                                value={total}
                                kind="plain"
                                currency={code}
                                // V2.2：大数字不再带 RM 前缀（上方胶囊已表示币种）——
                                // 小数点后两位照常保留，读屏标签仍带币种
                                variant="display"
                                hero
                                heroSize={HERO_AMOUNT_SIZE}
                                weight="700"
                                heroDecimalSize={22}
                                heroDecimalWeight="600"
                                heroDecimalColor={semantic.textSecondary}
                                heroLetterRatio={-0.03}
                                color={onGradientText}
                                compactFallback={false}
                                accessibilityLabel={fmtMoney(total, { currency: code, showCurrency: true })}
                                style={heroShadow}
                              />
                            )}
                          </View>
                        ))}
                      </Reanimated.View>
                    </Reanimated.View>
                  </GestureDetector>
                )}
              </View>
            )
          )}

          {/* V3：币种小圆点（5dp，当前 14dp 长条）；只有多于 1 个币种时显示 */}
          {totalsByCurrency.length > 1 && (
            <View style={styles.heroDots} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              {/* 拖动中读 shownIdx（预览）：过半时圆点已经指到目标币种页 */}
              {totalsByCurrency.map(([code], i) => (
                <View key={code} style={[styles.heroDot, { backgroundColor: onGradientText }, i === shownIdx ? styles.heroDotActive : styles.heroDotIdle]} />
              ))}
            </View>
          )}

          {/* 预算（V2 稿）：玻璃卡 + 8 高白色进度条（>80% warning / >100% danger 仍是原逻辑）；
              整卡点按 = 原预算编辑弹窗入口；未设预算时的空态行保留 */}
          <PressableScale onPress={openBudgetModal} activeScale={0.98} hitSlop={0} style={styles.budgetWrap} testID="home-budget-card">
            <GlassView radius={24} style={styles.budgetCard}>
              {totalBudget > 0 ? (
                <>
                  <View style={styles.budgetCardHead}>
                    <AppText variant="footnote" weight="500" color={semantic.textSecondary} style={styles.budgetText} numberOfLines={1}>
                      {t('home.budgetLabel')}
                    </AppText>
                    <View style={styles.budgetCardHeadRight}>
                      <AppText variant="footnote" weight="500" color={semantic.textSecondary} style={styles.budgetText}>
                        {budgetOver ? t('home.budgetOverLabel') : t('home.budgetLeftLabel')}
                      </AppText>
                      <MoneyText
                        value={budgetOver ? thisExpense - totalBudget : totalBudget - thisExpense}
                        variant="footnote"
                        weight="600"
                        color={budgetOver ? semantic.danger : semantic.textPrimary}
                        style={styles.budgetText}
                        hidden={balanceHidden}
                      />
                    </View>
                  </View>
                  <View style={styles.budgetTrack}>
                    <Reanimated.View
                      style={[styles.budgetFill, { backgroundColor: budgetBarColor }, budgetFillAnimStyle]}
                    />
                  </View>
                  <View style={styles.budgetCardFoot}>
                    <AppText variant="caption" color={onGradientMuted}>
                      {`${t('home.budgetUsed')} `}
                    </AppText>
                    {/* 已用金额 = 支出金额，走语义支出色（紫）；不覆盖成次要色 */}
                    <MoneyText value={thisExpense} kind="expense" variant="caption" hidden={balanceHidden} />
                    <AppText variant="caption" color={onGradientMuted}>
                      {' / '}
                    </AppText>
                    <MoneyText value={totalBudget} variant="caption" color={onGradientMuted} hidden={balanceHidden} />
                    <View style={styles.budgetCardFootSpacer} />
                    <AppText variant="caption" color={onGradientMuted}>
                      {`${budgetPctText}%`}
                    </AppText>
                  </View>
                </>
              ) : (
                <View style={styles.budgetCardEmptyRow}>
                  <Ionicons name="add" size={16} color={onGradientText} />
                  <AppText variant="subhead" color={onGradientText}>
                    {t('home.setBudget')}
                  </AppText>
                </View>
              )}
            </GlassView>
          </PressableScale>
        </Reanimated.View>
        {/* 日历视图卡（只在日历模式渲染，与旧行为一致——切回详情即卸载）；
            卡面 = GlassView（UI V2.1 §2：全 App 唯一毛玻璃材质，P_Calendar 稿整张日历就是一块玻璃）
            + 圆角 26 / 内衬 12·10·10（与账单列表卡同一张卡的观感） */}
        {calRendered && (
          <Reanimated.View style={calEnterStyle}>
            <View style={styles.calendarWrap}>
              <GlassView radius={26} style={styles.calendarCard}>
                <MonthCalendarCard
                  year={viewMonth.year}
                  month={viewMonth.month}
                  days={calendarDays}
                  monthExpense={calendarMonthTotals.expense}
                  monthIncome={calendarMonthTotals.income}
                  onPrevMonth={() => shiftCalendarMonth(-1)}
                  onNextMonth={() => shiftCalendarMonth(1)}
                  // 日历明细点一行 = 进编辑（与首页列表行同一个现有入口）
                  onPressItem={(id) => {
                    const tx = ledgerTransactions.find((x) => x.id === id);
                    if (tx) navigation.navigate(ROUTES.ADD_TX, { editTransaction: tx });
                  }}
                />
              </GlassView>
            </View>
          </Reanimated.View>
        )}
          </>
        }
      />
      {/* 吸顶日期头（自绘，见 pinnedSection 的注释）：钉在列表视口顶部，与内容里的日期头同款；
          头部区还占着顶部时不显示 —— 只覆盖列表，不盖弹层（zIndex 低于弹层） */}
      {/* 只在列表视图显示：切到日历视图时列表（含吸顶条）必须完全不显示（验收退回第 2 条） */}
      {Platform.OS === 'web' && viewMode === 'detail' && heroPassed && pinnedSection && (
        <View style={styles.pinnedHeader} pointerEvents="none" testID="home-pinned-header">
          {renderDayHeader({ section: pinnedSection })}
        </View>
      )}

      {/* 账本抽屉（T10 / H11）：改用 ui/BottomSheet —— 拖动把手下拉 / 点遮罩 / 关闭键三条路径
          都先播出场动画再卸载，安全区与「打开期间强制收起浮空 Tab 栏」都由组件内部处理；
          行 = 本文件的 LedgerRow（图标圆 + 名称/结余/预设行 + 右动作列）；列表滚动交给抽屉内的 ScrollView。
          改名 / 新建 / 删除（含二级密码）/ 切换 的行为与旧版一致，一行没改 */}
      <BottomSheet
        visible={ledgerPickerOpen}
        onClose={closeLedgerPicker}
        title={t('home.selectLedger')}
        testID="ledger-sheet"
      >
        <ScrollView
          style={styles.ledgerSheetScroll}
          contentContainerStyle={styles.ledgerSheetListContent}
          showsVerticalScrollIndicator={false}
        >
          <ListSection cardStyle={styles.ledgerSheetSection}>
            {sortedLedgers.map((l) => (
              <LedgerRow
                key={l.id}
                ledger={l}
                active={l.id === activeLedgerId}
                isDefault={l.id === 'default'}
                totals={ledgerTotals[l.id] ?? []}
                renaming={renamingLedgerId === l.id}
                renameValue={renameValue}
                renameInputRef={renameInputRef}
                onRenameValueChange={setRenameValue}
                onCommitRename={commitRenameLedger}
                onStartRename={() => startRenameLedger(l.id, l.name)}
                onDelete={() => requestDeleteLedger(l)}
                onSelect={() => {
                  hapticLight();
                  setActiveLedgerId(l.id);
                  closeLedgerPicker();
                }}
              />
            ))}
          </ListSection>
        </ScrollView>
        {/* 新增账本：accent 渐变主按钮（与完成键 / 中央「+」同款；旧平涂紫退役）；
            逻辑不变 = 关抽屉 + 进「开设账本」页 */}
        <View style={styles.ledgerSheetFooter}>
          <GradientButton
            title={t('home.addLedger')}
            icon="add"
            onPress={() => {
              closeLedgerPicker();
              navigation.navigate(ROUTES.LEDGER);
            }}
            testID="ledger-add"
          />
        </View>
      </BottomSheet>

      {/* 预算调整弹窗：自绘计算器键盘常驻（资产页编辑同款「我的计算机」）——
          预填当前预算值，可直接按算式（如 500+300），「完成」求值保存，点遮罩取消不保存；
          无系统键盘参与，也就没有键盘互斥/收起时序问题 */}
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
            {/* 算式显示行：右对齐大字，键盘按键实时回显 */}
            <Text style={styles.budgetExprText} numberOfLines={1}>
              {budgetExpr.displayValue || '0'}
            </Text>
            {/* 键盘通铺到卡片边缘：卡片 padding 16 会把网格边线（末行底线/右列边线）
                悬在离圆角边框 16px 的位置——负 margin 抵消内边距，边线正好落在卡片边框上
                （与记一笔/资产页贴底键盘通铺同款）；配合卡片 overflow hidden 裁进圆角 */}
            <View style={styles.budgetKeypadBleed}>
              <AmountCalculatorKeypad
                onPressKey={(key) => budgetExpr.pressKeyAt(key, 0)}
                onPressToday={() => {}}
                onClear={() => budgetExpr.reset(0)}
                onConfirm={handleBudgetConfirm}
              />
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
      {/* 货币直选下拉（T08 验收退回后重做）：锚在「⇅」钮下方，**不透明** semantic.surfaceElevated 底
          + elevation.level2（不再用半透明玻璃，后面的净资产数字不会透上来）；
          行结构（验收定版）= 左：币种代码小方块（accentSoft 底 + radius.sm）· 中：币种名（当前语言，
          副行放另一语言名，信息保留不混排）· 右：选中勾；
          选中行 = accentSoft 底 + accentText 字 + accent 勾，未选中 = textPrimary / textSecondary；
          标题只走 i18n（按当前语言显示一种）。⚠ 不用国旗 emoji（Windows / 网页会退化成字母） */}
      {/* V3：切换币种 = ui/BottomSheet（原下拉面板下线，入口只剩一个） */}
      <BottomSheet
        visible={currencyMenuOpen}
        onClose={() => {
          setCurrencyMenuOpen(false);
          setCurrencyQuery('');
        }}
        title={t('home.currencySheetTitle')}
        maxHeightRatio={0.7}
        testID="home-currency-sheet"
      >
        {totalsByCurrency.length > 6 && (
          <TextInput
            value={currencyQuery}
            onChangeText={setCurrencyQuery}
            placeholder={t('home.currencySearch')}
            placeholderTextColor={semantic.textTertiary}
            style={[styles.currencySearch, { color: semantic.textPrimary, backgroundColor: semantic.surfaceSunken }]}
            autoCorrect={false}
            autoCapitalize="characters"
            testID="home-currency-search"
          />
        )}
        <ScrollView style={styles.currencyMenuScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {currencySheetRows.map(([code, total]) => {
            const active = code === displayTotal?.[0];
            const option = CURRENCY_OPTIONS.find((c) => c.code === code);
            const zhName = option?.name ?? code;
            const enName = getEnglishCurrencyName(code) ?? zhName;
            const isZh = homeLang !== 'en';
            const name = isZh ? zhName : enName;
            return (
              <PressableScale
                key={code}
                style={[styles.currencyMenuItem, active && { backgroundColor: semantic.selectedRow }]}
                activeScale={0.98}
                onPress={() => {
                  setNetWorthCurrency(code);
                  setCurrencyMenuOpen(false);
                  setCurrencyQuery('');
                }}
                accessibilityRole="button"
                accessibilityLabel={`${code} ${name}`}
                accessibilityState={{ selected: active }}
              >
                <View style={styles.currencyMenuCodeBox}>
                  <AppText variant="caption" color={semantic.accentText} numberOfLines={1}>
                    {code}
                  </AppText>
                </View>
                <View style={styles.currencyMenuTextCol}>
                  <AppText variant="body" color={active ? semantic.accentText : semantic.textPrimary} numberOfLines={1}>
                    {name}
                  </AppText>
                  <AppText variant="footnote" color={semantic.textSecondary} numberOfLines={1}>
                    {isZh ? enName : zhName}
                  </AppText>
                </View>
                <MoneyText value={total} kind="plain" currency={code} variant="footnote" color={semantic.textSecondary} />
                {active && <Ionicons name="checkmark" size={20} color={semantic.accent} style={styles.currencyCheck} />}
              </PressableScale>
            );
          })}
        </ScrollView>
      </BottomSheet>

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
    </>
  );
}

function makeStyles(
  colors: ThemeColors,
  isDark: boolean,
  semantic: SemanticColors,
  spacing: Spacing,
  radius: Radius,
  layout: Layout,
  elevation: Elevation
) {
  return StyleSheet.create({
    container: { flex: 1 },
    // ── 头部区（UI V2 稿）：内容不套卡，直接排在页面渐变上；左右 16（heroBlock），
    //    顶部 14 + 状态栏让位（JSX 内联给，与全出血口径一致）──
    heroBlock: { paddingHorizontal: layout.page, paddingBottom: spacing.lg },
    heroTopRow: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.sm },
    // 右侧两枚 44 玻璃圆钮（铃铛 / 日历）靠 marginLeft auto 顶到行尾
    heroTopActions: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.sm, marginLeft: 'auto' },
    // 账本胶囊（V2 稿：高 44 · 内边距 16 · 全圆角 · 白字 15/500 + 下拉箭头；名字长时省略号收尾）
    heroLedgerPill: {
      height: 44,
      maxWidth: 200,
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.xs,
      paddingHorizontal: layout.card,
    },
    heroPillText: { flexShrink: 1 },
    // 胶囊按压缩小（长账本名交给文字省略号），不能被内容撑破顶行
    heroPillPress: { flexShrink: 1 },
    // 铃铛的红点定位锚（GlassRoundButton 不吃 children，红点单独叠在包装层上）
    heroCtlWrap: { position: 'relative' },
    // 未读数字角标（铃铛右上角；有消息才显示，当前无消息源恒不渲染）
    notifBadge: {
      position: 'absolute',
      top: -3,
      right: -3,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      paddingHorizontal: 3,
      backgroundColor: colors.expenseOver,
      alignItems: 'center',
      justifyContent: 'center',
    },
    notifBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
    // 币种小胶囊（V2 稿：高 26 · 内边距 8 · 白字 12/500 + 12 图标）
    heroCurrencyPill: {
      height: 26,
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.xs,
      paddingHorizontal: spacing.sm,
    },
    // 净资产标签行（V2 稿 margin-top 34，1:1）
    heroNetWorthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      columnGap: spacing.sm,
      marginTop: 34,
    },
    // 金额行（V2 稿 margin-top 4）：横向分页容器；间距 = 稿的 10（HERO_EYE_GAP）
    heroAmountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.xs,
    },
    // V3 跟手分页的一页：页宽 = 行实测宽（JSX 给），金额在页内水平居中
    heroPagerPage: { alignItems: 'center', justifyContent: 'center' },
    // 手势分页：clip 盒裁掉相邻页；strip 横排、页宽 = 行宽
    heroPagerClip: { overflow: 'hidden' },
    heroPagerStrip: { flexDirection: 'row' },
    heroAmountPress: { flexShrink: 1, minWidth: 0 },
    // 隐藏金额（••••••）：与 hero 整数段同字号同行高，避免显隐切换时行高跳动
    heroHiddenAmount: { fontSize: HERO_AMOUNT_SIZE, lineHeight: HERO_AMOUNT_LINE },
    // 眼睛（V2 稿 36 圆、空心无底）：IconButton 默认触控区 44 —— 这里覆盖成 36 并收紧 minHeight，
    // 外加 hitSlop 4 补回 44 触控
    heroEyeBtn: { width: 32, height: 32, minHeight: 32, borderRadius: 16 },
    // 无账户空状态：EmptyState 的文字是深色令牌，垫一张玻璃卡才在渐变上读得清
    heroEmptyCard: { marginTop: spacing.xl, paddingHorizontal: spacing.md },
    // 预算玻璃卡（V2 稿：圆角 24 · 内边距 16；整卡可点 = 原预算弹窗入口）
    budgetWrap: { marginTop: spacing.xl },
    budgetCard: { padding: layout.card },
    // 标题行：左「本月预算」右「剩余 X」（基线对齐，两端分开）
    budgetCardHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      columnGap: spacing.sm,
    },
    budgetCardHeadRight: { flexDirection: 'row', alignItems: 'baseline', columnGap: spacing.xs, flexShrink: 1 },
    // 进度条（V2 稿：8 高圆头白条；轨道 = 白 22%）
    budgetTrack: {
      height: 6,
      borderRadius: radius.full,
      backgroundColor: withAlpha(semantic.onAccent, 0.22),
      overflow: 'hidden',
      marginTop: spacing.sm,
    },
    budgetFill: { height: '100%', borderRadius: radius.full },
    // 明细行：左「已用 x / y」右百分比（两端分开）
    budgetCardFoot: { flexDirection: 'row', alignItems: 'baseline', marginTop: spacing.sm },
    budgetCardFootSpacer: { flex: 1 },
    // 未设预算：一行「＋ 设置本月预算」居中（原空态行保留）
    budgetCardEmptyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      columnGap: spacing.sm,
      minHeight: 28,
    },
    // 吸顶日期头（自绘）：钉在列表视口顶部（浮层允许绝对定位）。本体自带 surface 底 + 16 边距
    // （见 dayHeaderWrap），这里补一条通栏发丝线 + **26 上圆角 + overflow hidden** ——
    // 钉住时它代表列表卡的顶边，两角必须被圆角裁住（与卡本身的首组日期头同款）
    pinnedHeader: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 5,
      borderTopLeftRadius: LIST_CARD_RADIUS,
      borderTopRightRadius: LIST_CARD_RADIUS,
      overflow: 'hidden',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: semantic.homeHairline,
    },
    // ── 账单列表（V2 / H4）：日期头 = 卡内的一段（12 上 / 4 下 + 16 边距，无底线 —— 与稿一致）──
    dayHeaderWrap: { backgroundColor: semantic.homeCard, marginHorizontal: LIST_CARD_MARGIN },
    // 首组日期头 = 列表卡顶边：26 上圆角（只圆上两角，高度够 → 真 26 弧；不用 4pt 顶帽 ——
    // 4pt 高的圆角块会被 CSS 圆角收缩规则压成 ~2pt，看上去就是直角）
    dayHeaderWrapFirst: {
      borderTopLeftRadius: LIST_CARD_RADIUS,
      borderTopRightRadius: LIST_CARD_RADIUS,
    },
    // 跨月月份分隔（只在当月第一次出现时渲染）：caption（12pt，≥ 令牌最小档）
    monthSepText: {
      paddingHorizontal: layout.card,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },
    dayHeaderRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      columnGap: spacing.sm,
      paddingHorizontal: layout.card,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },
    // 日期标签（今天 / 昨天 / 10月7日 周三）：可被挤窄，合计整块不被挤
    dayHeaderDate: { flexShrink: 1 },
    heroFadeOverlay: { position: 'absolute', left: 0, right: 0, top: 330 * 0.6, height: 330 * 0.4 },
    // V3 字号（设计稿逐值）：行标题 14/600、副标题 12/400、日期头 12、预算文字 12.5
    dayHeaderLabelText: { fontSize: 12, lineHeight: 16 },
    budgetText: { fontSize: 12.5, lineHeight: 17 },
    // 当日合计：wrap 行（放不下自动换行到第二行，右对齐；不缩字、不省略）
    dayHeaderTotals: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
      alignItems: 'baseline',
      columnGap: spacing.xs,
      rowGap: 2,
      flexShrink: 1,
      marginLeft: 'auto',
    },
    // 无账单空状态（EmptyState 自带内边距，这里只补与头部区的间距）
    listEmpty: { paddingTop: spacing.lg },
    // 货币下拉（T08 退回定版）：全 App 唯一遮罩色 + 不透明浮层底（surfaceElevated）+ level2 阴影
    currencySearch: {
      marginHorizontal: layout.page,
      marginBottom: spacing.sm,
      height: 40,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      fontSize: 15,
    },
    currencyCheck: { marginLeft: spacing.xs },
    heroDots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', columnGap: 6, marginTop: spacing.md },
    heroDot: { height: 5, width: 5, borderRadius: 3 },
    heroDotActive: { width: 14, opacity: 1 },
    heroDotIdle: { opacity: 0.3 },
    currencyMenuScroll: { flexGrow: 0, flexShrink: 1 },
    // 行结构（验收定版）：左币种代码方块 · 中币种名 · 右选中勾
    currencyMenuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.md,
      minHeight: layout.rowMinHeight,
      paddingHorizontal: layout.card,
      paddingVertical: spacing.sm,
    },
    // 选中行：accentSoft 底（字色 / 勾色在渲染期给）
    currencyMenuItemActive: { backgroundColor: semantic.accentSoft },
    // 币种代码方块（radius.sm + accentSoft 底）：含文字所以只给 minWidth/minHeight + padding
    currencyMenuCodeBox: {
      minWidth: 44,
      minHeight: 36,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.sm,
      backgroundColor: semantic.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    currencyMenuTextCol: { flex: 1, flexShrink: 1 },
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
    // 日历卡外层：页面左右边距（与头部区的间距由 heroBlock 的 paddingBottom 给，见其注释）
    calendarWrap: { paddingHorizontal: layout.page },
    // 玻璃圆角 26（半径由 GlassView 的 radius 给，这里补稿的内衬 12/10/10）
    calendarCard: { paddingTop: 12, paddingHorizontal: 10, paddingBottom: 10 },
    // ── 以下旧的「账单卡 / 空状态 / 账单行（图标托 + 类别(备注)）」样式已按 T09 删除 ──
    // （H4：连续分组列表；H5：行统一走 ui/TransactionRow；H7：空状态统一走 ui/EmptyState）
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
      // 键盘通铺到卡缘后其方角背景会顶到卡片下缘——裁进圆角内，避免圆角外露出方角
      overflow: 'hidden',
    },
    planModalCard: {
      width: '100%',
      maxHeight: '92%',
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
    },
    ledgerModalTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 8, textAlign: 'center' },
    // 预算弹窗的算式显示行：右对齐大字、等宽数字；minHeight 防算式清空时高度塌陷
    budgetExprText: {
      fontSize: 28,
      fontWeight: '700',
      color: colors.textPrimary,
      textAlign: 'right',
      fontVariant: ['tabular-nums'],
      minHeight: 40,
      marginBottom: 10,
    },
    // 预算键盘通铺：负 margin 抵消卡片 padding 16，网格边线（末行底线/侧线端头）正好落在卡片圆角边框上
    budgetKeypadBleed: { marginHorizontal: -16, marginBottom: -16 },
    modalFieldLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 12, marginBottom: 6 },
    requiredMark: { color: colors.expense, fontWeight: '700' },
    // 账本抽屉（T10 / H11）：BottomSheet 内的内容 —— 贴边列表（不套四角圆角卡，避免「抽屉里浮一张卡」）
    // + 底部通栏「新增账本」主按钮；列表需要滚动时在抽屉内滚动（flexShrink 让它在 maxHeight 内收缩）
    ledgerSheetScroll: { flexGrow: 0, flexShrink: 1 },
    ledgerSheetListContent: { paddingVertical: spacing.md },
    ledgerSheetSection: { borderRadius: 0, borderWidth: 0 },
    ledgerSheetFooter: {
      paddingHorizontal: layout.card,
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: semantic.hairline,
    },
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
