// AssetScreen.tsx —— 资产页（T19 / 计划 5.4 S1–S5）
//
// 本次只改展示与交互（功能冻结：数据、计算、导航入口全部照旧）：
//   S1 页头换 ScreenHeader 大标题 + 顶部汇总卡（各币种净资产，资产 / 负债两行）
//   S2 币种分组改 ListSection：组头 = 币种代码 Chip + 合计；行 = ListRow（图标方块 + 名称 + 余额）
//   S3 信用卡行主数字显示欠款（−402.29），副行还款日、值下方"可用 X"，行下 2pt 额度使用率细条
//   S4 账户详情从居中弹窗改 BottomSheet；删除走 danger 色按钮；"设为默认"改 Switch 行
//   S5 空状态 EmptyState + 添加账户按钮；排序模式显示拖动把手
//
// 另外删掉首页式的「minHeight: 视口高 + 130」撑高写法（计划 G4）：内容短时不再滚出大片空白。
//
// 信用卡账单口径（computeCreditStatement）与本月流水（computeAssetFlowStats）的计算一字未动，
// 与 creditCard.ts 的 getAssetDisplayBalance 一样原样复用。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  PanResponder,
  PixelRatio,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { BlinkingCursor } from '../components/BlinkingCursor';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { useT } from '../i18n/LanguageContext';
import { useDialog } from '../components/AppDialog';
import { useApp } from '../context/AppContext';
import { ROUTES } from '../navigation/routes';
import { getAssetDisplayBalance } from '../utils/creditCard';
import { formatMoney } from '../utils/formatMoney';
import { AssetType } from '../types';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import { AmountCalculatorKeypad } from '../components/AmountCalculatorKeypad';
import { useAmountExpression } from '../hooks/useAmountExpression';
import { hapticWarning } from '../utils/haptics';
import PressableScale from '../components/PressableScale';
import { LinearGradient } from 'expo-linear-gradient';
import type { Layout, Radius, SemanticColors, Spacing, Typography } from '../theme/theme';
import { gradients } from '../theme/theme';
import {
  AppText,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  GlassView,
  HeroGradient,
  IconCircle,
  ListRow,
  MoneyText,
  Switch,
} from '../components/ui';
import { withAlpha } from '../components/ui/color';

/**
 * 账户类型 → i18n 键（与 AddAssetScreen 的 TYPE_OPTIONS.label 同源，六档齐全：
 * 投资 / 其他是 AssetType 本来就有的档，老数据里的这类账户列表照常显示）。
 * 账户行副行用「类型 · 默认」——UI V2 定稿每行都有副行，类型与是否默认都是现有数据。
 */
const TYPE_LABEL_KEYS: Record<AssetType, string> = {
  cash: 'asset.typeCash',
  bank: 'asset.typeBank',
  credit: 'asset.typeCredit',
  ewallet: 'asset.typeEwallet',
  investment: 'asset.typeInvestment',
  other: 'asset.typeOther',
};

/** 净资产玻璃卡与首个分组卡之间 / 分组卡与分组卡之间的间距（UI V2 稿：14）—— 纯版式常量 */
const CARD_GAP = 14;

type IconName = keyof typeof Ionicons.glyphMap;

const TYPE_OPTIONS: { type: AssetType; label: string; icon: IconName; color: string }[] = [
  { type: 'cash', label: '现金', icon: 'cash-outline', color: '#66BB6A' },
  { type: 'bank', label: '银行卡', icon: 'card-outline', color: '#4C9AFF' },
  { type: 'credit', label: '信用卡', icon: 'wallet-outline', color: '#EF5350' },
];

// 用户手动拖拽排出来的账户顺序，按币种分组各自记一份序号，存本地，不动 Asset 数据结构
const ASSET_ORDER_KEY = '@jizhang/assetOrder';

/** 信用卡额度使用率细条高度（计划 S3：2pt）—— 纯几何常量 */
/** 额度使用率细条高度（UI V2 定稿：3，与统计页占比细条同规格） */
const USAGE_BAR_HEIGHT = 3;
/** 细条的横向品牌渐变（accent 渐变的 start/end 是给方块用的对角；细条要横着走） */
const USAGE_BAR_GRADIENT = { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } } as const;
/** 额度使用率预警点（与预算条同一套语义：≥80% warning、≥100% danger） */
const USAGE_WARN_PCT = 80;
const USAGE_FULL_PCT = 100;

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 账户图标方块（UI_RULES 第 7 节统一规格：40 方块、radius.md 圆角、账户色 12% 底 + 100% 图标）。
 * 账户色是资产自带的数据（与类别色同一套用法），不是写死的设计色。
 */
/**
 * 账户行图标（UI V2 第 1 节「形状」：账户图标改圆形）。
 * 42 圆 + 底色 = 账户色 15%（夜）/ 近白淡底（日）—— 全部由 IconCircle 按主题推导，
 * 圆色仍取账户自带的数据色（与类别色同一套用法），不是写死的设计色。
 */
function AccountIcon({ color, icon }: { color: string; icon: IconName }) {
  return <IconCircle size={42} color={color} icon={icon} />;
}

/**
 * 渐变上的玻璃胶囊按钮（UI V2 稿：资产页右上「+ 添加账户」/ 排序模式「完成」）。
 * 为什么不用共享 Button：Button 只有 primary / secondary / destructive / ghost 四档，
 * 都是「实底 / 描边」材质，没有玻璃档；这里要的是 GlassView 材质 + 胶囊，
 * 所以按 GlassView 的规格页内组合一次（颜色 / 圆角 / 字号全部取令牌，不写死）。
 * 文字 / 图标 = text.primary（UI V2.1 §3：玻璃上的文字一律主文字色，日间不再有白字压浅色）。
 * 材质与规格照稿：高 40、左右内衬 14、radius.full、15/500、图标 16、图标与文字间距 6。
 */
function GlassPillButton({
  label,
  icon,
  onPress,
  testID,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  testID?: string;
}) {
  const { semantic, radius } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      activeScale={0.97}
      hitSlop={0}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <GlassView
        radius={radius.full}
        style={{
          height: 40,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 14,
        }}
      >
        {!!icon && <Ionicons name={icon} size={16} color={semantic.textPrimary} />}
        <AppText variant="subhead" weight="500" color={semantic.textPrimary}>
          {label}
        </AppText>
      </GlassView>
    </PressableScale>
  );
}

/**
 * S1 顶部净资产卡（UI V2 稿）：落在渐变上的**玻璃**卡 —— 净资产大数字（Hero 42）
 * + 资产 / 负债两格 + 其余币种各一行「XXX 净资产」。
 * 为什么不用共享 Card：Card 只有 surface 材质档，这一张在渐变上必须是玻璃（第 3 节第 2 条），
 * 所以走 GlassView；卡内小格沿用同一材质思路（夜 = 页面底色 25% 压暗，日 = 玻璃填充）。
 * 数值照稿内联样式：圆角 26 / 内衬 18 / 大数字 42 / 两格 gap 10 圆角 16 / 币种行 12.5（→ footnote 13）。
 * 口径不变：净资产 = 资产 − 负债（同一币种内），主币种 = 排序后的第一个币种。
 */
function NetWorthCard({
  summaryByCurrency,
}: {
  summaryByCurrency: [string, { assets: number; liabilities: number }][];
}) {
  const { semantic, spacing, isDark, glass, layout } = useTheme();
  const { pagePadding } = useLayout();
  const t = useT();

  const primary = summaryByCurrency[0];
  if (!primary) return null;
  const [code, totals] = primary;
  const net = totals.assets - totals.liabilities;
  // 卡内小格底：夜间是压暗一档的页面底色，日间就是玻璃填充（见文件头「玻璃」说明）
  const cellBg = isDark ? withAlpha(semantic.bg, 0.25) : glass.fill;

  return (
    <GlassView
      radius={26}
      style={{
        marginHorizontal: pagePadding,
        marginTop: CARD_GAP,
        marginBottom: CARD_GAP,
        padding: 18,
      }}
    >
      <AppText variant="footnote" color={semantic.textPrimary}>
        {`${t('asset.summaryNet')} · ${code}`}
      </AppText>
      <MoneyText
        hero
        heroSize={42}
        value={net}
        currency={code}
        showCurrency
        color={semantic.textPrimary}
        style={{ marginTop: spacing.xs }}
      />
      <View style={{ flexDirection: 'row', gap: 10, marginTop: spacing.lg }}>
        {(
          [
            [t('asset.summaryAssets'), totals.assets],
            [t('asset.summaryLiabilities'), totals.liabilities],
          ] as [string, number][]
        ).map(([label, value]) => (
          <View
            key={label}
            style={{ flex: 1, borderRadius: 16, backgroundColor: cellBg, paddingHorizontal: spacing.md, paddingVertical: 10 }}
          >
            <AppText variant="caption" color={semantic.textPrimary}>
              {label}
            </AppText>
            <MoneyText
              value={value}
              variant="headline"
              color={semantic.textPrimary}
              style={{ marginTop: 2 }}
            />
          </View>
        ))}
      </View>
      {summaryByCurrency.slice(1).map(([otherCode, otherTotals]) => (
        <View
          key={otherCode}
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: spacing.sm,
            marginTop: spacing.md,
          }}
        >
          <AppText variant="footnote" color={semantic.textPrimary}>
            {`${otherCode} ${t('asset.summaryNet')}`}
          </AppText>
          <MoneyText
            value={otherTotals.assets - otherTotals.liabilities}
            variant="footnote"
            currency={otherCode}
            showCurrency
            color={semantic.textPrimary}
          />
        </View>
      ))}
    </GlassView>
  );
}

/**
 * 币种分组头（UI V2 稿：卡内一行 —— 左侧币种小胶囊 + 右侧该币种合计）。
 * 为什么不用共享 Chip：稿里币种标记是「实心小胶囊（24 高 / 左右内衬 9 / 12-600）」，
 * 而 Chip 是描边胶囊 + 44 触控外框，当卡内分组头会把这一行撑高一档。
 * 收起 / 展开的功能一点没变：胶囊本身就是原来的开关（点它收起该组）；
 * 收起时胶囊降透明度，读屏照旧报「选中 / 未选中」。
 */
function CurrencyGroupHeader({
  code,
  total,
  collapsed,
  onToggle,
  testID,
}: {
  code: string;
  total: number;
  collapsed: boolean;
  onToggle: () => void;
  testID?: string;
}) {
  const { semantic, spacing, radius, layout } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        columnGap: spacing.sm,
        rowGap: spacing.xs,
        paddingHorizontal: layout.card,
        paddingTop: 14,
        paddingBottom: 6,
      }}
    >
      <PressableScale
        onPress={onToggle}
        activeScale={0.96}
        // 胶囊只有 24 高，外扩到 44 触控（UI_RULES：可点元素 ≥44pt）
        hitSlop={{ top: 10, bottom: 10, left: 0, right: 0 }}
        accessibilityRole="button"
        accessibilityLabel={code}
        accessibilityState={{ selected: !collapsed }}
        testID={testID}
      >
        <View
          style={{
            height: 24,
            borderRadius: radius.full,
            paddingHorizontal: 9,
            justifyContent: 'center',
            backgroundColor: semantic.surfaceSunken,
            opacity: collapsed ? 0.55 : 1,
          }}
        >
          <AppText variant="caption" weight="600" color={semantic.textSecondary}>
            {code}
          </AppText>
        </View>
      </PressableScale>
      <MoneyText value={total} variant="headline" />
    </View>
  );
}

/**
 * 账户行（验收退回第 1 条定版）。
 *
 * 为什么不用 ListRow：ListRow 的三块排布是「一行 flexWrap + space-between」——
 * 账户名一长，右侧金额整块会被挤到第二行；而这一行要求的是
 * 「金额永远留在第一行最右（flexShrink:0）、标题在自己那一栏里最多 2 行、
 * 副行与额度细条都对齐标题栏（不伸到图标下方）」，ListRow 表达不了，所以在页面内用
 * 令牌 + 同一套 40 图标方块规格实现（画风与 ListRow 一致：行高 ≥ useLayout().rowMinHeight）。
 */
function AssetRow({
  color,
  icon,
  title,
  subtitle,
  value,
  barFraction,
  barTone,
  trailing,
  onPress,
  onLongPress,
  style,
  testID,
}: {
  color: string;
  icon: IconName;
  title: string;
  /** 副行（信用卡：可用额度 · 还款日）；放不下时自己换行，不截断不缩略 */
  subtitle?: string;
  /** 右侧金额（flexShrink:0，永远留在第一行最右） */
  value?: React.ReactNode;
  /** 行下细条（信用卡额度使用率；0–1） */
  barFraction?: number;
  /** 细条色调：accent（正常，走品牌渐变）/ warning（≥80%）/ danger（≥100%）—— 告警档沿用原来的语义色 */
  barTone?: 'accent' | 'warning' | 'danger';
  /** 行尾自定义内容（排序模式的拖动把手） */
  trailing?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { semantic, typography, spacing, radius, layout } = useTheme();
  const { rowMinHeight } = useLayout();

  // 标题是否占到了第二行（实测高度判定，与 ScreenHeader 同一套做法）：
  // 单行时三块垂直居中（和 ListRow 观感一致）；两行时文字块与金额一律靠上，
  // 金额因此永远停在第一行最右边，不会被顶到第二行去
  const [titleLines, setTitleLines] = useState(1);
  const singleLineHeight =
    typography.headline.lineHeight *
    Math.min(PixelRatio.getFontScale(), typography.headline.maxFontSizeMultiplier);
  useEffect(() => {
    setTitleLines(1);
  }, [title]);
  const alignTop = titleLines > 1;

  return (
    <PressableScale
      onPress={onPress}
      onLongPress={onLongPress}
      activeScale={0.98}
      hitSlop={0}
      style={[
        {
          minHeight: rowMinHeight,
          paddingHorizontal: layout.card,
          paddingVertical: spacing.md,
          justifyContent: 'center',
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={testID}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: alignTop ? 'flex-start' : 'center',
          columnGap: spacing.md,
        }}
      >
        <View style={{ alignSelf: 'center' }}>
          <AccountIcon color={color} icon={icon} />
        </View>
        <View style={{ flexGrow: 1, flexShrink: 1 }}>
          <AppText
            variant="headline"
            numberOfLines={2}
            onLayout={(e) =>
              setTitleLines(Math.max(1, Math.round(e.nativeEvent.layout.height / singleLineHeight)))
            }
          >
            {title}
          </AppText>
          {!!subtitle && (
            <AppText variant="footnote" color={semantic.textSecondary} style={{ marginTop: spacing.xs }}>
              {subtitle}
            </AppText>
          )}
          {barFraction != null && (
            <View
              style={{
                marginTop: spacing.sm,
                height: USAGE_BAR_HEIGHT,
                borderRadius: radius.full,
                backgroundColor: semantic.hairline,
                overflow: 'hidden',
              }}
            >
              {barTone === 'accent' ? (
                // 正常档（UI V2 稿）：品牌横向渐变；超 80% / 100% 仍退回语义告警色
                <LinearGradient
                  colors={gradients.accent.colors}
                  locations={gradients.accent.locations as [number, number, ...number[]]}
                  start={USAGE_BAR_GRADIENT.start}
                  end={USAGE_BAR_GRADIENT.end}
                  style={{
                    width: `${Math.min(Math.max(barFraction, 0), 1) * 100}%`,
                    height: USAGE_BAR_HEIGHT,
                    borderRadius: radius.full,
                  }}
                />
              ) : (
                <View
                  style={{
                    width: `${Math.min(Math.max(barFraction, 0), 1) * 100}%`,
                    height: USAGE_BAR_HEIGHT,
                    borderRadius: radius.full,
                    backgroundColor:
                      barTone === 'danger' ? semantic.danger : semantic.warning,
                  }}
                />
              )}
            </View>
          )}
        </View>
        {value != null && (
          <View style={{ flexShrink: 0, marginLeft: spacing.sm, alignSelf: alignTop ? 'flex-start' : 'center' }}>
            {value}
          </View>
        )}
        {trailing}
      </View>
    </PressableScale>
  );
}

interface CreditStatement {
  currentCycleSpend: number; // 本期（还没结算）已刷金额：本月 1 号到今天
  lastStatementAmount: number; // 上一期已结算账单金额：上个自然月整月
  isOverdue: boolean;
  overdueDays: number;
  estimatedInterest: number;
  available: number; // 可用额度
}

// 信用卡账单的固定标准：每月 1 号结算，结算区间为上一个自然月（1 号到月末）。
// 不使用账户上的账单日/还款日字段；本期已刷 = 本月 1 号到今天（含今天）
function computeCreditStatement(
  asset: { creditLimit?: number; interestRate?: number },
  balance: number,
  spendInRange: (start: Date, end: Date) => number
): CreditStatement | null {
  const today = new Date();
  // 两个结算日：本月 1 号（最近一次）和上月 1 号（上一次）
  const closeDate = new Date(today.getFullYear(), today.getMonth(), 1);
  const prevCloseDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  // 本期区间含今天：结束取到明天 0 点
  const cycleEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

  const currentCycleSpend = spendInRange(closeDate, cycleEnd);
  const lastStatementAmount = spendInRange(prevCloseDate, closeDate);

  const totalOwed = Math.max(0, -balance); // balance 是负数代表欠款
  // 上期账单已出（已进入新月份）仍没还：欠款还覆盖着上期账单金额就视为逾期
  const isOverdue = lastStatementAmount > 0 && totalOwed >= lastStatementAmount;
  const overdueDays = isOverdue ? Math.floor((today.getTime() - closeDate.getTime()) / 86400000) : 0;
  const estimatedInterest =
    isOverdue && asset.interestRate ? lastStatementAmount * (asset.interestRate / 100 / 365) * overdueDays : 0;

  const available = (asset.creditLimit ?? 0) - totalOwed;

  return { currentCycleSpend, lastStatementAmount, isOverdue, overdueDays, estimatedInterest, available };
}

interface AssetFlowStats {
  inflowAmount: number; // 本月流入：收入 + 转入
  inflowCount: number;
  outflowAmount: number; // 本月流出：支出 + 转出（含手续费）
  outflowCount: number;
}

function computeAssetFlowStats(
  assetId: string,
  monthStart: string,
  transactions: {
    type: string;
    assetId?: string;
    fromAssetId?: string;
    toAssetId?: string;
    amount: number;
    fee?: number;
    convertedAmount?: number;
    date: string;
  }[]
): AssetFlowStats {
  let inflowAmount = 0;
  let inflowCount = 0;
  let outflowAmount = 0;
  let outflowCount = 0;
  transactions
    .filter((t) => t.date >= monthStart)
    .forEach((t) => {
      if (t.type === 'income' && t.assetId === assetId) {
        inflowAmount += t.amount;
        inflowCount += 1;
      } else if (t.type === 'expense' && t.assetId === assetId) {
        outflowAmount += t.amount;
        outflowCount += 1;
      } else if (t.type === 'transfer') {
        if (t.toAssetId === assetId) {
          inflowAmount += t.convertedAmount ?? t.amount;
          inflowCount += 1;
        }
        if (t.fromAssetId === assetId) {
          outflowAmount += t.amount + (t.fee ?? 0);
          outflowCount += 1;
        }
      }
    });
  return { inflowAmount, inflowCount, outflowAmount, outflowCount };
}

export default function AssetScreen() {
  const { assets, transactions, getAssetBalance, deleteAsset, setDefaultAsset, updateAsset } = useApp();
  type AssetItem = (typeof assets)[number];
  const { semantic, typography, spacing, radius, layout } = useTheme();
  const { pagePadding, contentMaxWidth } = useLayout();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  const styles = useMemo(
    () => makeStyles(semantic, typography, spacing, radius, layout),
    [semantic, typography, spacing, radius, layout]
  );
  const t = useT();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）

  // ---------- "我的账户"：编辑排列模式 / 币种分组折叠 / 自定义拖拽顺序 ----------
  // reorderMode：长按账户行进入，此时强制展开全部分组改成可拖拽的行，右上"完成"退出
  // collapsedCurrencies：浏览模式下收起（默认全展开，点币种 Chip 收起该组）
  // assetOrder：拖拽产生的顺序，只在同一币种分组内比较，不需要跨分组唯一，存本地不动账户数据结构
  const [reorderMode, setReorderMode] = useState(false);
  const [collapsedCurrencies, setCollapsedCurrencies] = useState<string[]>([]);
  const [assetOrder, setAssetOrder] = useState<Record<string, number>>({});
  const toggleCurrencyGroup = (code: string) => {
    setCollapsedCurrencies((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  // 启动时恢复上次保存的拖拽排序
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(ASSET_ORDER_KEY);
        if (raw) setAssetOrder(JSON.parse(raw));
      } catch (e) {
        console.warn('读取账户排序失败', e);
      }
    })();
  }, []);

  const persistAssetOrder = (next: Record<string, number>) => {
    setAssetOrder(next);
    AsyncStorage.setItem(ASSET_ORDER_KEY, JSON.stringify(next)).catch((e) => console.warn('保存账户排序失败', e));
  };

  // 某个币种分组内拖拽结束：按新顺序把 0..n-1 写回该分组这几个账户的 order，
  // 不同分组的编号可以重叠，反正排序比较永远只发生在同一分组内部
  const handleGroupReorder = (groupItems: { id: string }[]) => {
    const next = { ...assetOrder };
    groupItems.forEach((item, index) => {
      next[item.id] = index;
    });
    persistAssetOrder(next);
  };

  // ---------- 负债汇总：只统计信用卡欠款 ----------
  const liabilitiesByCurrency = useMemo(() => {
    const totals: Record<string, number> = {};
    assets
      .filter((a) => a.type === 'credit')
      .forEach((a) => {
        const owed = Math.max(0, -getAssetBalance(a.id));
        if (owed > 0) totals[a.currency] = (totals[a.currency] || 0) + owed;
      });
    return Object.entries(totals);
  }, [assets, getAssetBalance]);

  // ---------- 顶部汇总卡数据：各币种的资产 / 负债（数据全部来自现有平衡计算，不新增算法）----------
  const summaryByCurrency = useMemo(() => {
    const map: Record<string, { assets: number; liabilities: number }> = {};
    assets.forEach((a) => {
      if (!map[a.currency]) map[a.currency] = { assets: 0, liabilities: 0 };
      // 信用卡欠款单独走"负债"行（与下面的 liabilitiesByCurrency 同一个数），不混进资产行
      if (a.type === 'credit') return;
      map[a.currency].assets += getAssetBalance(a.id);
    });
    liabilitiesByCurrency.forEach(([code, owed]) => {
      if (!map[code]) map[code] = { assets: 0, liabilities: 0 };
      map[code].liabilities = owed;
    });
    return Object.entries(map).sort(([codeA], [codeB]) => codeA.localeCompare(codeB));
  }, [assets, getAssetBalance, liabilitiesByCurrency]);

  const handleDelete = (id: string, assetName: string) => {
    dialog.alert({
      title: t('asset.deleteAssetTitle', { name: assetName }),
      message: t('asset.deleteAssetMsg'),
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        // 删除后账户已不存在：连带关闭详情抽屉，避免留下空壳抽屉（删除入口在抽屉内）
        { text: t('common.delete'), style: 'destructive', onPress: () => { closeDetail(); hapticWarning(); deleteAsset(id); } },
      ],
    });
  };

  // ---------- 点击账户查看详情：信用卡看账单周期，银行卡/现金看本月收支流水 ----------
  // 抽屉打开即可直接改：名称是输入框、点金额数字调起计算器键盘，一个"保存"统一提交（无单独编辑模式）
  const [viewingAssetId, setViewingAssetId] = useState<string | null>(null);
  const [viewSetDefault, setViewSetDefault] = useState(false);
  const viewingAsset = assets.find((a) => a.id === viewingAssetId);
  // 抽屉出场动画播放期间父级已把 viewingAssetId 置空：留住最后一份数据，动画不会闪成空壳
  const lastViewingRef = useRef<AssetItem | undefined>(undefined);
  if (viewingAsset) lastViewingRef.current = viewingAsset;
  const sheetAsset = viewingAsset ?? lastViewingRef.current;
  // 同一次编辑会话（"放弃修改"对话框点取消后抽屉弹回）不重新预填，用户已输入的内容不丢
  const prefilledIdRef = useRef<string | null>(null);

  const [viewName, setViewName] = useState('');
  const [viewBalanceStr, setViewBalanceStr] = useState('');
  const [viewKeypadOpen, setViewKeypadOpen] = useState(false);
  const balanceExpr = useAmountExpression();

  // ---------- 当前余额/信用额度：自绘光标（长按拖动定位，按键在光标位置生效） ----------
  const [viewBalanceCursor, setViewBalanceCursor] = useState(0); // 光标距显示串尾部的偏移（0 = 最末尾）
  const viewNameInputRef = useRef<any>(null); // 名称框：切到金额时让它失焦（光标互斥）
  const amountTextRef = useRef<any>(null);
  const amountTextBoxRef = useRef<{ x: number; w: number } | null>(null);
  // 金额文字在窗口里的位置（长按/点按定位光标用）
  const refreshAmountTextBox = () => {
    amountTextRef.current?.measureInWindow((x: number, _y: number, w: number) => {
      amountTextBoxRef.current = { x, w };
    });
  };
  const amountCursorDragRef = useRef(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      // 系统键盘（名称输入）弹出 → 自绘键盘收起（两套键盘互斥协调）
      setViewKeypadOpen(false);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      // 系统键盘收起 → 自绘键盘显示回来（含 Android 返回键收起键盘的情况）
      setViewKeypadOpen(true);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const viewDisplayRef = useRef('');
  viewDisplayRef.current = viewKeypadOpen ? balanceExpr.displayValue : '';
  // 光标在显示串里的下标（渲染切片用）
  const viewCursorIdx = Math.max(
    0,
    Math.min(viewDisplayRef.current.length, viewDisplayRef.current.length - viewBalanceCursor)
  );
  const placeCursorFromTouch = (pageX: number) => {
    const box = amountTextBoxRef.current;
    const display = viewDisplayRef.current;
    if (!box || box.w <= 0 || !display) return;
    const idx = Math.max(0, Math.min(display.length, Math.round((pageX - box.x) / (box.w / display.length))));
    setViewBalanceCursor(display.length - idx);
  };
  const handleViewKeyPress = (key: string) => {
    setViewBalanceCursor(balanceExpr.pressKeyAt(key, viewBalanceCursor));
  };
  const handleAmountBoxPress = (e: any) => {
    if (!viewKeypadOpen) {
      openViewKeypad();
      return;
    }
    placeCursorFromTouch(e.nativeEvent.pageX);
  };
  const handleAmountBoxLongPress = (e: any) => {
    if (!viewKeypadOpen) return;
    amountCursorDragRef.current = true;
    placeCursorFromTouch(e.nativeEvent.pageX);
  };
  const amountCursorPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => amountCursorDragRef.current,
      onPanResponderMove: (_e, g) => placeCursorFromTouch(g.moveX),
      onPanResponderRelease: () => {
        amountCursorDragRef.current = false;
      },
      onPanResponderTerminate: () => {
        amountCursorDragRef.current = false;
      },
    })
  ).current;
  // PressableScale 的 onPress 类型不带事件参数，运行时事件照常透传（两个处理函数要 pageX 定位光标）
  const amountBoxPressProps = {
    onPress: handleAmountBoxPress as unknown as () => void,
    onLongPress: handleAmountBoxLongPress as unknown as () => void,
    delayLongPress: 300,
  };

  useEffect(() => {
    if (!viewingAssetId) return;
    // 同一次编辑会话：不重新预填（"放弃修改"对话框点取消后抽屉弹回时保留已输入内容）
    if (prefilledIdRef.current === viewingAssetId) return;
    const asset = assets.find((a) => a.id === viewingAssetId);
    if (asset) {
      prefilledIdRef.current = viewingAssetId;
      setViewSetDefault(!!asset.isDefault);
      setViewName(asset.name);
      // 金额字段预填当前值：非信用卡是当前余额（输入"想让当前余额变成的数"），信用卡是信用额度
      setViewBalanceStr(
        String(asset.type === 'credit' ? asset.creditLimit ?? 0 : getAssetBalance(asset.id)),
      );
    }
    setViewKeypadOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingAssetId]);

  const openViewKeypad = () => {
    // 名称框的系统键盘/光标退场：一次只允许一个光标显示（点余额/额度 = 切换输入焦点）
    viewNameInputRef.current?.blur();
    // 预填当前数额：光标在末尾，退格逐位修改或长按定位；按 C（清除）才归零重新输入
    balanceExpr.reset(parseFloat(viewBalanceStr) || 0);
    setViewBalanceCursor(0); // 光标从最末尾开始
    setViewKeypadOpen(true);
  };
  // 计算器「完成」：求值落回金额行并直接保存（与"保存"按钮同一效果）
  const handleViewKeypadConfirm = () => {
    const typed = balanceExpr.confirm();
    setViewBalanceStr(String(typed));
    setViewKeypadOpen(false);
    saveViewChanges(typed);
  };

  // 未保存修改检测：名称、余额目标值、默认勾选任一变化即视为脏
  const viewEditDirty =
    !!viewingAsset &&
    (viewName.trim() !== viewingAsset.name ||
      viewSetDefault !== !!viewingAsset.isDefault ||
      (parseFloat(viewBalanceStr) || 0) !==
        (viewingAsset.type === 'credit'
          ? viewingAsset.creditLimit ?? 0
          : getAssetBalance(viewingAsset.id)));

  /** 真正关掉详情抽屉（清掉预填标记，下次打开同一账户重新读数据） */
  const closeDetail = () => {
    prefilledIdRef.current = null;
    setViewingAssetId(null);
  };

  // 关抽屉：有未保存修改先确认放弃，防误触。
  // ⚠ BottomSheet 收到 onClose 时已经播完出场动画把自己卸载了，所以这里只能"拦"在数据层：
  //   点取消 = 重新打开同一账户（预填标记还在，已输入内容原样保留），点放弃 = 真正关闭。
  const tryCloseDetail = () => {
    if (viewEditDirty) {
      const id = viewingAssetId;
      dialog.alert({
        title: t('asset.discardEditTitle'),
        buttons: [
          {
            text: t('common.cancel'),
            style: 'cancel',
            onPress: () => {
              // 先置空再置回：visible 变化才会触发 BottomSheet 重新挂载并播入场动画
              setViewingAssetId(null);
              setTimeout(() => setViewingAssetId(id), 0);
            },
          },
          { text: t('common.discard'), style: 'destructive', onPress: closeDetail },
        ],
      });
      return;
    }
    closeDetail();
  };

  const saveViewChanges = async (overrideBalance?: number) => {
    if (!viewingAsset || !viewName.trim()) return;
    // 自绘键盘还开着：先把屏幕上正在输入的表达式求值落回金额行再保存——
    // 否则这里读到的还是打开键盘前的旧值（"点保存金额不跟着变"的原因）
    let typed = overrideBalance;
    if (typed == null && viewKeypadOpen) {
      typed = balanceExpr.confirm();
      setViewBalanceStr(String(typed));
      setViewBalanceCursor(0);
      setViewKeypadOpen(false);
    }
    typed = typed ?? (parseFloat(viewBalanceStr) || 0);
    if (viewingAsset.type === 'credit') {
      await updateAsset(viewingAsset.id, { name: viewName.trim(), creditLimit: typed });
    } else {
      // 输入的是"想让当前余额变成的数"：差额写回起始余额，保存后当前余额即变为输入值
      const delta = getAssetBalance(viewingAsset.id) - viewingAsset.initialBalance;
      await updateAsset(viewingAsset.id, { name: viewName.trim(), initialBalance: typed - delta });
    }
    // 默认账户勾选随本次保存一并生效；保存后关闭抽屉（列表已是最新数据）
    if (viewSetDefault !== !!viewingAsset.isDefault) {
      await setDefaultAsset(viewSetDefault ? viewingAsset.id : null);
    }
    closeDetail();
  };

  const viewingCreditAsset = viewingAsset?.type === 'credit' ? viewingAsset : undefined;

  const viewingStatement = useMemo(() => {
    if (!viewingCreditAsset) return null;
    return computeCreditStatement(viewingCreditAsset, getAssetBalance(viewingCreditAsset.id), (start, end) =>
      transactions
        .filter(
          (t) =>
            t.assetId === viewingCreditAsset.id &&
            t.type === 'expense' &&
            t.date >= toDateStr(start) &&
            t.date < toDateStr(end)
        )
        .reduce((s, t) => s + t.amount, 0)
    );
  }, [viewingCreditAsset, transactions, getAssetBalance]);

  // 银行卡/现金类：本月流入流出（含转账）金额与笔数
  const viewingFlowStats = useMemo(() => {
    if (!viewingAsset || viewingAsset.type === 'credit') return null;
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    return computeAssetFlowStats(viewingAsset.id, monthStart, transactions);
  }, [viewingAsset, transactions]);

  // ---------- 先按货币分大组，组内再按类型顺序（现金 / 银行卡 / 信用卡）排列 ----------
  const typeOrder = useMemo(() => {
    const order: Record<AssetType, number> = {} as Record<AssetType, number>;
    TYPE_OPTIONS.forEach((t, i) => {
      order[t.type] = i;
    });
    return order;
  }, []);

  const groupedAssets = useMemo(() => {
    const byCurrency: Record<string, typeof assets> = {};
    assets.forEach((a) => {
      if (!byCurrency[a.currency]) byCurrency[a.currency] = [];
      byCurrency[a.currency].push(a);
    });
    return Object.entries(byCurrency)
      .sort(([codeA], [codeB]) => codeA.localeCompare(codeB))
      .map(([code, items]) => ({
        code,
        items: [...items].sort((a, b) => {
          const oa = assetOrder[a.id];
          const ob = assetOrder[b.id];
          // 两边都手动排过序：按拖拽顺序来
          if (oa != null && ob != null) return oa - ob;
          // 只有一边排过序：排过的排在前面，新账户/没拖过的账户排在后面
          if (oa != null) return -1;
          if (ob != null) return 1;
          // 都没排过序：沿用原来"现金/银行卡/信用卡"的默认顺序
          return (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99);
        }),
      }));
  }, [assets, typeOrder, assetOrder]);

  /** 浏览模式的一行：图标方块 + 名称 + 余额；信用卡换成"欠款 + 可用 / 还款日 + 使用率细条" */
  const renderAssetRow = (a: AssetItem) => {
    const balance = getAssetBalance(a.id);
    const isCredit = a.type === 'credit';
    const limit = a.creditLimit ?? 0;
    const owed = isCredit ? Math.max(0, -balance) : 0;
    const available = getAssetDisplayBalance(a, balance);
    const usedPct = isCredit && limit > 0 ? Math.min(USAGE_FULL_PCT, (owed / limit) * 100) : 0;
    // 告警分档原封不动（≥100% danger / ≥80% warning / 其余 accent 渐变）
    const barTone: 'accent' | 'warning' | 'danger' =
      usedPct >= USAGE_FULL_PCT ? 'danger' : usedPct >= USAGE_WARN_PCT ? 'warning' : 'accent';
    // 信用卡副行：可用额度 + 还款日（分组头已标币种）。放不下时副行自己换行，
    // 不挤金额、也不出省略号（UI_RULES 第 6 节 ③）。
    const creditSubtitle = isCredit
      ? [
          `${t('asset.creditAvailableShort')} ${formatMoney(available)}`,
          a.dueDay ? t('asset.creditDueDay', { day: a.dueDay }) : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : undefined;
    // 其余账户的副行：账户类型（+ 默认标记），UI V2 定稿每行都有副行
    const accountSubtitle = [
      t(TYPE_LABEL_KEYS[a.type] ?? 'asset.typeOther'),
      a.isDefault ? t('asset.defaultTag') : null,
    ]
      .filter(Boolean)
      .join(' · ');

    return (
      <AssetRow
        key={a.id}
        color={a.color}
        icon={a.icon as IconName}
        title={a.name}
        subtitle={isCredit ? creditSubtitle : accountSubtitle}
        // 信用卡：主数字是欠款（分组头已标币种）；其余账户就是余额
        value={<MoneyText value={isCredit ? -owed : balance} variant="body" />}
        barFraction={isCredit && limit > 0 ? usedPct / 100 : undefined}
        barTone={barTone}
        onPress={() => setViewingAssetId(a.id)}
        onLongPress={() => setReorderMode(true)}
        testID={`asset-row-${a.id}`}
      />
    );
  };

  return (
    // 全出血（同首页）：SafeAreaView 不让位，渐变一路通到屏幕顶；内容自己用 insets.top 让开状态栏
    <SafeAreaView style={styles.container} edges={[]}>
      {/* UI V2.1 §1：品牌渐变铺满整页（fill），卡片 / 列表直接浮在渐变上 */}
      <HeroGradient fill />
      <ScrollView
        onScroll={onTabScroll ?? undefined}
        scrollEventThrottle={16}
        style={
          contentMaxWidth ? { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' } : undefined
        }
        contentContainerStyle={{ paddingBottom: tabClearance }}
      >
        {/* 页头（G5）：大标题 30/600（text.primary，§3：渐变上不再用白字）+ 右侧玻璃胶囊动作；
            排序模式换成「完成」（长按账户行进入）。空状态时页头不放按钮，动作只留空状态卡里那一个 */}
        <View style={{ paddingHorizontal: pagePadding, paddingTop: insets.top + 14 }}>
          <View style={styles.headerRow}>
            <AppText
              variant="title1"
              weight="600"
              color={semantic.textPrimary}
              style={styles.heroTitle}
              testID="asset-header"
            >
              {t('asset.title')}
            </AppText>
            {assets.length > 0 &&
              (reorderMode ? (
                <GlassPillButton
                  label={t('common.done')}
                  onPress={() => setReorderMode(false)}
                  testID="asset-reorder-done"
                />
              ) : (
                <GlassPillButton
                  label={t('asset.addAccount')}
                  icon="add"
                  onPress={() => navigation.navigate(ROUTES.ADD_ASSET)}
                  testID="asset-add-button"
                />
              ))}
          </View>
        </View>

        {/* S1 顶部汇总卡（UI V2）：主币种一张玻璃卡 = 净资产大数字 + 资产 / 负债两格 +
            其余币种各一行「XXX 净资产」；口径（资产 − 负债）与改造前一致 */}
        {summaryByCurrency.length > 0 && <NetWorthCard summaryByCurrency={summaryByCurrency} />}

        {assets.length === 0 ? (
          /* S5 空状态：图标 + 一句话 + 一个按钮 */
          <View style={{ paddingHorizontal: pagePadding, marginTop: spacing.xl }}>
            <Card>
              <EmptyState
                icon="wallet-outline"
                title={t('asset.emptyTitle')}
                description={t('asset.emptyHint')}
                actionLabel={t('asset.addAccount')}
                onAction={() => navigation.navigate(ROUTES.ADD_ASSET)}
                testID="asset-empty"
              />
            </Card>
          </View>
        ) : reorderMode ? (
          // ---------- 编辑排列模式：每个币种分组各自一个可拖拽列表，长按拖动排序 ----------
          groupedAssets.map((group) => (
            <View key={group.code} style={[styles.groupBlock, { paddingHorizontal: pagePadding }]}>
              <Card padded={false} style={{ borderRadius: 26 }}>
                <CurrencyGroupHeader
                  code={group.code}
                  total={group.items.reduce((sum, a) => sum + getAssetBalance(a.id), 0)}
                  collapsed={false}
                  onToggle={() => undefined}
                />
                <DraggableFlatList
                  data={group.items}
                  scrollEnabled={false}
                  keyExtractor={(item) => item.id}
                  onDragEnd={({ data }) => handleGroupReorder(data)}
                  renderItem={({ item: a, drag, isActive }: RenderItemParams<AssetItem>) => (
                    <ScaleDecorator>
                      <AssetRow
                        color={a.color}
                        icon={a.icon as IconName}
                        title={a.name}
                        // 排序模式：行尾是拖动把手（计划 S5）
                        trailing={
                          <Ionicons name="reorder-three-outline" size={20} color={semantic.textTertiary} />
                        }
                        onLongPress={drag}
                        style={isActive ? styles.draggingRow : undefined}
                        testID={`asset-drag-${a.id}`}
                      />
                    </ScaleDecorator>
                  )}
                />
              </Card>
            </View>
          ))
        ) : (
          // ---------- 浏览模式：按币种分组（默认展开，点币种小胶囊收起该组）----------
          groupedAssets.map((group) => {
            const isCollapsed = collapsedCurrencies.includes(group.code);
            // 同一币种下所有账户的余额合并成组的合计（信用卡按负数计入，即"欠款"）
            const groupTotal = group.items.reduce((sum, a) => sum + getAssetBalance(a.id), 0);
            return (
              <View key={group.code} style={[styles.groupBlock, { paddingHorizontal: pagePadding }]}>
                <Card padded={false} style={{ borderRadius: 26 }}>
                  {/* 组头 + 行都在同一张卡里（UI V2 稿）；行与行之间才插分割线，组头下不插 */}
                  <CurrencyGroupHeader
                    code={group.code}
                    total={groupTotal}
                    collapsed={isCollapsed}
                    onToggle={() => toggleCurrencyGroup(group.code)}
                    testID={`asset-group-${group.code}`}
                  />
                  {!isCollapsed &&
                    group.items.map((a, index) => (
                      <View key={a.id}>
                        {index > 0 && <View style={styles.groupSeparator} />}
                        {renderAssetRow(a)}
                      </View>
                    ))}
                </Card>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* S4 账户详情：底部抽屉（替换原来的居中弹窗）；删除走 danger 按钮，"设为默认"是 Switch 行 */}
      <BottomSheet
        visible={!!viewingAssetId}
        onClose={tryCloseDetail}
        title={t('asset.accountDetail')}
        maxHeightRatio={viewKeypadOpen ? 0.92 : 0.9}
        accessibilityLabel={t('asset.accountDetail')}
        testID="asset-detail"
      >
        {sheetAsset && (
          <View style={styles.sheetColumn}>
            <ScrollView
              style={styles.sheetScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[styles.sheetContent, { paddingHorizontal: layout.card }]}
            >
              {/* 名称：内联可改（为空时描边转 danger，"保存"变灰） */}
              <AppText variant="footnote" color={semantic.textSecondary} style={styles.fieldLabel}>
                {t('addTx.accountName')}
              </AppText>
              <TextInput
                ref={viewNameInputRef}
                style={[
                  styles.nameInput,
                  { backgroundColor: semantic.bg, borderColor: semantic.hairline, color: semantic.textPrimary },
                  !viewName.trim() && { borderColor: semantic.danger },
                ]}
                value={viewName}
                onChangeText={setViewName}
                placeholder={t('addTx.accountNamePlaceholder')}
                placeholderTextColor={semantic.textTertiary}
                selectionColor={semantic.accent}
                returnKeyType="done"
                testID="asset-detail-name"
              />

              {/* 金额格（当前余额 / 信用额度）：点整格调起计算器键盘，长按拖动可把光标放到任意字符处 */}
              <AppText variant="footnote" color={semantic.textSecondary} style={styles.fieldLabel}>
                {sheetAsset.type === 'credit' ? t('addTx.creditLimitLabel') : t('asset.currentBalance')}
              </AppText>
              <View {...amountCursorPan.panHandlers}>
                <PressableScale
                  style={[styles.amountBox, { backgroundColor: semantic.bg, borderColor: semantic.hairline }]}
                  activeScale={0.98}
                  {...amountBoxPressProps}
                  accessibilityRole="button"
                  accessibilityLabel={
                    sheetAsset.type === 'credit' ? t('addTx.creditLimitLabel') : t('asset.currentBalance')
                  }
                  testID="asset-detail-amount"
                >
                  <View style={styles.amountValueRow}>
                    {viewKeypadOpen ? (
                      <Text
                        ref={amountTextRef}
                        onLayout={refreshAmountTextBox}
                        style={[
                          styles.amountText,
                          { color: semantic.textPrimary },
                        ]}
                      >
                        <Text style={styles.amountText}>{viewDisplayRef.current.slice(0, viewCursorIdx)}</Text>
                        <BlinkingCursor style={[styles.amountText, { color: semantic.accentText }]} />
                        <Text style={styles.amountText}>{viewDisplayRef.current.slice(viewCursorIdx)}</Text>
                      </Text>
                    ) : (
                      <MoneyText value={parseFloat(viewBalanceStr) || 0} variant="title3" />
                    )}
                    <AppText variant="caption" color={semantic.textSecondary}>
                      {sheetAsset.currency}
                    </AppText>
                  </View>
                  <Ionicons name="pencil" size={16} color={semantic.accentText} />
                </PressableScale>
              </View>

              {/* 信用卡：账单周期明细（计算原样，仅换成列表行呈现） */}
              {sheetAsset.type === 'credit' ? (
                !viewingStatement ? (
                  <AppText variant="footnote" color={semantic.textTertiary} style={styles.sheetNote}>
                    {t('asset.noStatement')}
                  </AppText>
                ) : (
                  <View style={styles.sheetList}>
                    <ListRow
                      title={t('asset.availableLimit')}
                      value={
                        <MoneyText
                          value={viewingStatement.available}
                          variant="subhead"
                          currency={sheetAsset.currency}
                          showCurrency
                          currencyPosition="suffix"
                        />
                      }
                      separator
                    />
                    <ListRow
                      title={t('asset.currentSpend')}
                      value={
                        <MoneyText
                          value={viewingStatement.currentCycleSpend}
                          variant="subhead"
                          currency={sheetAsset.currency}
                          showCurrency
                          currencyPosition="suffix"
                        />
                      }
                      separator
                    />
                    <ListRow
                      title={t('asset.lastStatement')}
                      value={
                        <MoneyText
                          value={viewingStatement.lastStatementAmount}
                          variant="subhead"
                          currency={sheetAsset.currency}
                          showCurrency
                          currencyPosition="suffix"
                        />
                      }
                      separator={viewingStatement.isOverdue && viewingStatement.estimatedInterest > 0}
                    />
                    {viewingStatement.isOverdue && viewingStatement.estimatedInterest > 0 && (
                      <ListRow
                        title={t('asset.estInterest')}
                        value={
                          <MoneyText
                            value={viewingStatement.estimatedInterest}
                            variant="subhead"
                            kind="expense"
                            currency={sheetAsset.currency}
                            showCurrency
                            currencyPosition="suffix"
                          />
                        }
                      />
                    )}
                  </View>
                )
              ) : (
                viewingFlowStats && (
                  <View style={styles.sheetList}>
                    <ListRow
                      title={t('asset.inflow')}
                      value={<MoneyText value={viewingFlowStats.inflowAmount} variant="subhead" kind="income" />}
                      valueCaption={t('asset.inflowCount', { count: viewingFlowStats.inflowCount })}
                      separator
                    />
                    <ListRow
                      title={t('asset.outflow')}
                      value={<MoneyText value={viewingFlowStats.outflowAmount} variant="subhead" kind="expense" />}
                      valueCaption={t('asset.inflowCount', { count: viewingFlowStats.outflowCount })}
                      separator
                    />
                    <ListRow
                      title={t('asset.netChange')}
                      value={
                        <MoneyText
                          value={viewingFlowStats.inflowAmount - viewingFlowStats.outflowAmount}
                          variant="subhead"
                        />
                      }
                    />
                  </View>
                )
              )}

              {/* 设为默认账户：Switch 行（随"保存"一并提交） */}
              <View style={styles.sheetList}>
                <ListRow
                  title={t('asset.setDefaultRow')}
                  trailing={
                    <Switch
                      value={viewSetDefault}
                      onValueChange={setViewSetDefault}
                      accessibilityLabel={t('asset.setDefaultRow')}
                    />
                  }
                />
              </View>

              <Button
                title={t('common.save')}
                onPress={() => saveViewChanges()}
                disabled={!viewName.trim()}
                style={styles.sheetButton}
                testID="asset-detail-save"
              />
              <Button
                title={t('asset.deleteAccount')}
                variant="destructive"
                onPress={() => sheetAsset && handleDelete(sheetAsset.id, sheetAsset.name)}
                style={styles.sheetButton}
                testID="asset-detail-delete"
              />
            </ScrollView>

            {/* 计算器键盘：抽屉内全宽呈现；「完成」＝求值并直接保存（与"保存"按钮同一效果） */}
            {viewKeypadOpen && (
              <View
                style={[
                  styles.keypadFooter,
                  { borderTopColor: semantic.hairline, paddingBottom: Math.max(insets.bottom, spacing.lg) },
                ]}
              >
                <AmountCalculatorKeypad
                  onPressKey={handleViewKeyPress}
                  onPressToday={() => {}}
                  onClear={() => {
                    balanceExpr.reset(0);
                    setViewBalanceCursor(0);
                  }}
                  onConfirm={handleViewKeypadConfirm}
                />
              </View>
            )}
          </View>
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 字号 / 间距；几何常量只留纯图形尺寸） */
function makeStyles(
  semantic: SemanticColors,
  typography: Typography,
  spacing: Spacing,
  radius: Radius,
  layout: Layout
) {
  return StyleSheet.create({
    container: { flex: 1 },
    // 页头：大标题与右侧动作垂直居中对齐（同一行，动作跟着大标题中线走）；
    // 放不下时动作整块掉到第二行（UI_RULES 第 6 节 ②）
    headerRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      columnGap: spacing.md,
      rowGap: spacing.xs,
    },
    headerTitle: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
    // 大标题（渐变上的白字）：稿为 30 / 600（token title1 是 28/700，字号按稿覆盖）
    heroTitle: { fontSize: 30, lineHeight: 36 },
    groupBlock: { marginBottom: CARD_GAP },
    // 分组卡内的行间分割线：左缩进 = 图标 42 + 间距 12 + 卡内衬 16 = 70（与稿一致，右侧通到卡边）
    groupSeparator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: semantic.hairline,
      marginLeft: 70,
    },
    draggingRow: { opacity: 0.85 },
    // ---------- 详情抽屉 ----------
    sheetColumn: { flexShrink: 1 },
    sheetScroll: { flexShrink: 1 },
    sheetContent: { paddingBottom: spacing.md },
    fieldLabel: { marginTop: spacing.md, marginBottom: spacing.xs },
    nameInput: {
      minHeight: 44,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: typography.body.fontSize,
      lineHeight: typography.body.lineHeight,
    },
    amountBox: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      columnGap: spacing.sm,
      rowGap: spacing.xs,
      minHeight: 44,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    amountValueRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      flexShrink: 1,
      columnGap: spacing.xs,
    },
    amountText: {
      fontSize: typography.title3.fontSize,
      lineHeight: typography.title3.lineHeight,
      fontWeight: typography.title3.fontWeight,
      includeFontPadding: false,
      fontVariant: ['tabular-nums'],
    },
    sheetList: { marginTop: spacing.sm },
    sheetNote: { marginTop: spacing.lg, paddingHorizontal: spacing.sm },
    sheetButton: { marginTop: spacing.md },
    keypadFooter: {
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
  });
}
