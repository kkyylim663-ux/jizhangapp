import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import {View, Text, StyleSheet, TouchableOpacity, ScrollView, SectionList, Modal, TextInput, Animated, DimensionValue, Easing, Platform, Pressable, Keyboard } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';


import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, { FadeIn, FadeInDown, FadeOut, FadeOutUp, useAnimatedScrollHandler, useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, LinearGradient as SvgLinearGradient, Stop, Ellipse, Rect, ClipPath, G } from 'react-native-svg';
import { useApp } from '../context/AppContext';
import { getCurrencySymbol, CURRENCY_OPTIONS, getEnglishCurrencyName } from '../utils/currencies';
import { useT } from '../i18n/LanguageContext';
import { getCategoryLabel } from '../i18n/categories';
import { useLanguage } from '../i18n/LanguageContext';
import { i18n } from '../i18n';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler, useTabBarForceHide } from '../context/TabBarAutoHideContext';
import { ThemeColors, Elevation, Layout, Radius, SemanticColors, Spacing } from '../theme/theme';
import { formatMoney as fmtMoney, HIDDEN_AMOUNT } from '../utils/formatMoney';
import { formatDate } from '../utils/formatDate';
import type { Transaction } from '../types';
import { UNCATEGORIZED_ICON, UNCATEGORIZED_NAME, UNCATEGORIZED_COLOR } from '../constants/uncategorized';
import PressableScale from '../components/PressableScale';
import { AppText, Card, EmptyState, IconButton, ListRow, ListSection, MoneyText, TransactionRow } from '../components/ui';
import { AmountSheen, HeroCardSheen, HeroCardShadow, HeroEdgeSheen, useHeroSheen } from '../components/HeroMetalSheen';
import AuroraFlowShader from '../components/AuroraFlowShader';
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
const CARD_ENTER = [0, 1, 2].map((i) => FadeInDown.duration(240).delay(i * 60));

/** Hero 净资产「币种前缀 / 小数」的不透明度（T08 / H2：70%） */
const HERO_SMALL_OPACITY = 0.7;
/** 滚动停止多久后恢复卡下辉光呼吸（毫秒；T08 用一次性定时器取代原 400ms 轮询） */
const SCROLL_QUIET_MS = 1100;
/** 从记一笔返回后，新增行「闪一下」的时长（T09 / H8：500ms 淡紫底） */
const FLASH_ROW_MS = 500;

type IconName = keyof typeof Ionicons.glyphMap;

/** 账单 SectionList 的一组（T09 / H6）：data = 该日账单行（SectionList 认这个键），
 *  label = formatDate 的日期头、monthSep = 跨月时插的月份分隔、expense/income = 当日合计 */
type TxDaySection = {
  date: string;
  label: string;
  monthSep: string | null;
  expense: number;
  income: number;
  currency: string;
  items: Transaction[];
  data: Transaction[];
};

function formatMoney(n: number) {
  return n.toFixed(2);
}

// 净资产大金额：不再用原生 adjustsFontSizeToFit（Android 弹性容器里宽度测量失准，会把
// 正常数值偶发缩成蚂蚁字）。T08 起改为「三段同排」——币种前缀 + 整数 + 小数，整数按可用宽
// 在字号档位里挑（见 heroAmountSizes），估宽系数与 MoneyText 同一套表（金额专用，只用于选档，
// 不参与排版：排版永远交给 flex）。
/** 金额字符宽度估算（em；非拉丁的币种符号按最宽估，与 MoneyText 的「宁可多算」同一条） */
function amountEm(text: string): number {
  let em = 0;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') em += 0.62;
    else if (ch === ',' || ch === '.') em += 0.335;
    else if (ch === '+' || ch === '\u2212') em += 0.68;
    else if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) em += 0.75;
    else em += 1.02;
  }
  return em;
}

/**
 * Hero 净资产三段的字号档位（计划 H2）：整数从 [heroAmountFontSize, 34, 28, 22, 18] 里
 * 挑「能放下」的最大档（按档位降级，不做连续压缩，UI_RULES 第 5 节）；「RM」与小数固定 60% 字号。
 * 3% 余量与 MoneyText 的保守方向一致（宁可降一档，不溢出）。
 */
function heroAmountSizes(prefix: string, intText: string, decText: string, base: number, availW: number) {
  const smallFactor = 0.6 * (amountEm(prefix) + amountEm(decText));
  const intFactor = amountEm(intText);
  for (const size of [base, 34, 28, 22, 18]) {
    if (availW <= 0 || size * (intFactor + smallFactor) * 1.03 <= availW) {
      return { int: size, small: Math.max(11, Math.round(size * 0.6)) };
    }
  }
  return { int: 18, small: 11 };
}

/** 金额串拆三段：'RM28,797.59' → { prefix: 'RM', int: '28,797', dec: '.59' }（隐藏态不拆） */
function splitMoneyText(text: string): { prefix: string; int: string; dec: string } {
  const m = /^([^\d]*)([\d,]*)(\.\d+)?$/.exec(text);
  return { prefix: m?.[1] ?? '', int: m?.[2] || text, dec: m?.[3] ?? '' };
}

function monthKeyOf(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/// Hero 卡上的文字投影（日间玻璃质感配套；夜间底深、白字投影反而脏）：日间紫投影、夜间空对象。
// makeStyles 与渲染期（净资产三段、遮罩）共用同一份，避免两处漂移。
function heroTextShadowStyle(isDark: boolean): TextStyle {
  return isDark
    ? {}
    : {
        textShadowColor: 'rgba(75, 0, 173, 0.7)',
        // 光由左上角往右下角照射：影子投向右下；模长 ≈1.5（与玻璃参考图的高光位同源）
        textShadowOffset: { width: 1.1, height: 1.1 },
        textShadowRadius: 4,
      };
}

/** 账本创建时间戳 → 'YYYY-MM-DD'（本地时区；账本行的日期展示用） */
function formatDateTs(ts: number) {
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

/** 账单行的 key：交易 id（稳定函数，放模块作用域避免每次渲染换身份） */
function txKeyExtractor(item: Transaction) {
  return item.id;
}

// 行间发丝分割线（T09 / H4）：与 ListSection 的分割线同款（左右缩进 = 卡内边距，与行文字对齐）。
// ⚠ 必须放在模块作用域：写成组件体内的箭头函数会在每次渲染时变成新的组件类型 →
//   ItemSeparatorComponent 每次渲染都卸载重挂，VirtualizedList 的测量（frames / 平均行高）
//   反复失效，滚动时不再补渲染后面的行（T09 自检实测：45 笔只出前 5 行、滚到底没内容）。
function TxSeparator() {
  const { semantic, layout } = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: semantic.hairline,
        marginHorizontal: layout.card,
      }}
    />
  );
}


// ── 卡下外辉光（用户定版 2026-10-06「卡片底部的辉光缓慢闪动」）：卡片底部向下投的柔光。
// SVG 径向渐变椭圆 + 共享呼吸相位（4s，与反光 8s 错开）；放在卡容器第一子位、绝对定位伸出卡底，
// 绘制顺序天然在卡面之下。透明度映射 0.35~0.85，呼吸不抢戏。
function CardUnderGlow({ phase, color }: { phase: Animated.Value; color: string }) {
  const opacity = useMemo(
    () => phase.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.85] }),
    [phase]
  );
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: '12%', right: '12%', bottom: -16, height: 36 },
        { opacity },
      ]}
    >
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          {/* 2026-10-08·修正 14：id 并入颜色指纹——RNSVG 原生端同 id 的渐变定义不保证随 props 重建，
              主题切换后会继续引用旧色（同 id 直接复用旧定义） */}
          <RadialGradient id={`homeCardGlow${color.replace(/[^0-9a-zA-Z]/g, '')}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity="0.55" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Ellipse
          cx="50%"
          cy="50%"
          rx="50%"
          ry="50%"
          fill={`url(#homeCardGlow${color.replace(/[^0-9a-zA-Z]/g, '')})`}
        />
      </Svg>
    </Animated.View>
  );
}

// GlassLift 的柔光渐变 id 序号（同屏多个实例必须各不相同，否则 url(#id) 会互相串色）
let glassGlowSeq = 0;

// 'rgba(r,g,b,a)' / 'rgb(r,g,b)' / 其它原样 → { color, opacity }
// ⚠ react-native-svg 原生端的 <Stop> 不读 stopColor 里 rgba 的 alpha（真机上渐变会变不透明实底），
//    必须把透明度单独放进 stopOpacity —— 2026-10-08·修正 13
function splitColorAlpha(c: string): { color: string; opacity: number } {
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c);
  if (m) {
    return {
      color: `rgb(${m[1]},${m[2]},${m[3]})`,
      opacity: m[4] !== undefined ? Math.max(0, Math.min(1, parseFloat(m[4]))) : 1,
    };
  }
  return { color: c, opacity: 1 };
}

// '#RRGGBB' + alpha → 'rgba(r,g,b,a)' —— 供 boxShadow 字符串用（2026-10-08·修正 16）
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── 立体毛玻璃托（2026-10-07 批次2，批次3/5 复用）：外投影 + 内渐变 + 1px 描边 + 贴合轮廓的柔光顶缘。
// 配方来源 apple-design §12（材质与深度）：亮顶缘=光打在材质上、外投影=悬浮、内渐变=受光。
// ⚠ 2026-10-07 晚·用户指出「顶缘是一条硬白线」（真机实测：亮线浮在描边内侧 1px、上下各有一条缝）：
// 旧做法（顶部 left/right 内缩的 1px 实心 View）已退役——它不跟圆角、且亮度 0.65 远高于目标图。
// 现改为 SVG 描边式柔光：同一圆角矩形描 9 层（0.25→2.25dp，外半被裁在形状外），
// 由外向内叠出「~1dp 亮边 + ~1dp 拖尾」的平滑衰减，并沿高度渐变（顶最亮 → 两侧次之 → 底最暗），
// 数值按目标图取样（顶缘合成 ≈白 0.42、1dp 处 ≈白 0.31、2dp 处 ≈白 0.25、2.3dp 外回落填充色）。
// ⚠ 2026-10-09·修正 25（日间金属化）：**日间**柔光只留 3 层、上限 ~1dp（rimWidthsDay）、
//   强度 [0.10,0.05,0.02]——锐利感交给 1px 白 0.95 描边 + 底部深紫灰倒角（去掉那圈柔和发光）；夜间 9 层原样。
// palette 由调用处传入（homeGlass* token 日/夜成对；夜间控件叠加后≈白 18%）。
function GlassLift({
  radius,
  palette,
  style,
  isDark,
  shadowRadius = 10,
  shadowOffsetY = 5,
  elevation = 6,
  children,
}: {
  radius: number;
  palette: { fill: [string, string, string]; border: string; edgeShade: string; shadowColor: string; shadowOpacity: number; glow: [number, number, number] };
  style?: StyleProp<ViewStyle>;
  /** 当前主题（2026-10-08·修正 16）：日间半透明件用 boxShadow 外部阴影 + 倒角描边；
   *  2026-10-09·修正 25：日间填充改不透明金属 → 自动走 elevation/shadow*（小模糊、更利落）；夜间保持原状 */
  isDark: boolean;
  shadowRadius?: number;
  shadowOffsetY?: number;
  elevation?: number;
  children?: React.ReactNode;
}) {
  const glowId = useMemo(() => `homeGlassGlow${++glassGlowSeq}`, []);
  // ⚠ 2026-10-08·修正 14：渐变定义 id 必须「每实例唯一（glowId）+ 随主题变化（paletteKey）」——
  // RNSVG 原生端对同 id 的渐变定义不会可靠重建：主题切换后，沿用旧 id 的元素会继续引用旧主题的
  // 渐变（用户实测：夜间按钮保持日间白色实底、图标已变而按钮滞后）。paletteKey = 当前调色板指纹
  // （填充两端 + 柔光顶停），主题一变 id 即变，定义必然重建。颜色与 stopOpacity 全程在渲染期读取。
  const paletteKey = useMemo(
    () => `${palette.fill[0]}|${palette.fill[1]}|${palette.fill[2]}|${palette.glow[0]}`.replace(/[^0-9a-zA-Z]/g, ''),
    [palette]
  );
  const themedGlowId = `${glowId}-${paletteKey}`;
  // 柔光裁切路径 id：同源派生（每实例唯一 + 随主题刷新）
  const clipId = `${glowId}c-${paletteKey}`;
  // 填充渐变 id：同源派生 + 主题指纹（RNSVG 版填充层，2026-10-08·修正 12）
  const fillId = `${glowId}f-${paletteKey}`;
  // ⚠ 2026-10-07 第 6 轮·修正 4b：柔光层改「实测坐标」绘制。
  // 真机染色排查（红=柔光层）实测：此前用 StyleSheet.absoluteFill + SVG 百分比几何时，柔光层
  // 的**底部**比面板短 ~13dp（顶部/左右正常），在面板底边上方又多描出一条线 = 用户报的
  // 「两个框格/重影」。现改为：onLayout 实测本元件宽高，柔光 Svg 用显式 top/left + 数值宽高，
  // 描边矩形与 ClipPath 全写数值（不用任何百分比、不用 bottom/right 约束）——
  // 几何只依赖实测值，各平台对百分比/inset 的解析差异不再影响它。
  const [rimBox, setRimBox] = useState<{ w: number; h: number } | null>(null);
  // ⚠ 2026-10-07 第 6 轮·修正 3：把调用方 style 里的 padding 摘出来、改铺到「内容包装」上——
  // Android 上绝对定位的柔光层是相对父级**内容盒**定位的，父级带 padding 时柔光会整体内缩一圈，
  // 在元件内部再描出一圈框（用户报的「两个框格」，日夜都有；web 渲染复现不出这个现象）。
  // padding 挪到内层包装后柔光就能贴住真实边线；flexDirection/alignItems/justifyContent
  // 同时保留在外层并复制给包装层，布局与原来完全一致
  const flat = (StyleSheet.flatten(style) || {}) as ViewStyle;
  const {
    padding,
    paddingTop,
    paddingBottom,
    paddingLeft,
    paddingRight,
    paddingHorizontal,
    paddingVertical,
    ...restStyle
  } = flat;
  const hasPad = [padding, paddingTop, paddingBottom, paddingLeft, paddingRight, paddingHorizontal, paddingVertical].some(
    (v) => v !== undefined
  );
  const contentWrap: ViewStyle = {
    flexDirection: flat.flexDirection,
    alignItems: flat.alignItems,
    justifyContent: flat.justifyContent,
    padding,
    paddingTop,
    paddingBottom,
    paddingLeft,
    paddingRight,
    paddingHorizontal,
    paddingVertical,
  };
  // 描边中心线压在形状边界上、外半被裁 → 内侧 0.125~1.125dp 的同心环（目标图柔光只吃 ~1dp）。
  // 9 层等步长（每层只加 ~0.017 的 stopOpacity，≈4/255）：单层台阶看不见，合起来是平滑衰减；
  // 用 1~3 层粗描边会在真机上出现"套圈"式的层级台阶（已试过，弃）
  // ⚠ 2026-10-07 晚·修正 8：柔光弧半径改与描边完全一致（radius-1→radius）——真机上 15/16 两套
  //   圆角在四角处会各画各的弧（用户报「颜色没有对准、两个框格包裹在一起，右下角最明显」）；
  //   半径对齐后柔光带与描边同心重合，四角只剩一条边
  const rimRx = Math.max(0, radius);
  const rimWidths = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25];
  // 2026-10-09·修正 25：日间金属化 → 柔光层收窄到 ~1dp、只留 3 层（去掉那圈柔和发光；
  // 边缘的锐利感交给 1px 白 0.95 描边 + 底部深紫灰倒角）；夜间 9 层原样不动
  const rimWidthsDay = [0.25, 0.5, 1];
  // 填充渐变三端色（2026-10-08·修正 13 alpha 拆到 stopOpacity；2026-10-09·修正 25 加中停=3 段金属反光带）
  const fillTop = splitColorAlpha(palette.fill[0]);
  const fillMid = splitColorAlpha(palette.fill[1]);
  const fillBottom = splitColorAlpha(palette.fill[2]);
  // ⚠ 2026-10-08·修正 15（用户真机实测定位）：Android 的 elevation/shadow 画在 View **底下**，
  // 透过半透明填充显出一圈"内矩形/内框"（夜间面板曾同因出两层边、当时靠改不透明解决；日间一直带病）。
  // 修正 16（用户：日间卡片要恢复和夜间同等的立体感）：半透明件日间改用 **boxShadow 外部阴影**
  // （RN Android OutsetBoxShadowDrawable 用 clipOutPath 只画卡片外侧，不会渗入卡内——源码已核；
  // RN 0.86 新架构支持）；夜间一律保持原状（不透明夜间面板仍用原 elevation/shadow*）。
  // 修正 25（日间金属化）：日间填充改不透明 → 本条自动切到 elevation 路径（用户处方第 3 条：不透明可用 elevation）
  const translucentFill = [fillTop, fillMid, fillBottom].some((f) => f.opacity < 1);
  return (
    <View
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setRimBox((prev) =>
          prev && Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5 ? prev : { w: Math.round(w), h: Math.round(h) }
        );
      }}
      style={[
        {
          borderRadius: radius,
          borderWidth: 1,
          // 描边（2026-10-08·修正 16 / 2026-10-09·修正 25）：日间「顶/两侧锐利白高光（0.95）+ 底部深紫灰」
          // 的双色倒角——夜间同款结构的浅底版本（表面比亮边暗 = 暗面 + 亮棱）；夜间保持原 border 不动
          ...(isDark
            ? { borderColor: palette.border }
            : {
                borderTopColor: palette.border,
                borderLeftColor: palette.border,
                borderRightColor: palette.border,
                borderBottomColor: palette.edgeShade,
              }),
          // 投影：日间半透明 → boxShadow 外部阴影（修正 16）；夜间半透明 → 不加（修正 15 后现状）；
          // 不透明（夜间面板 + 修正 25 起的全部日间金属件）→ elevation/shadow*——
          // 修正 25 日间「投影更利落」：模糊/偏移/高度都收小一档（夜间用原值，恒等不变）
          ...(translucentFill
            ? isDark
              ? null
              : { boxShadow: `0px ${shadowOffsetY}px ${shadowRadius}px ${hexToRgba(palette.shadowColor, palette.shadowOpacity)}` }
            : {
                shadowColor: palette.shadowColor,
                shadowOpacity: palette.shadowOpacity,
                shadowRadius: isDark ? shadowRadius : Math.min(shadowRadius, 6),
                shadowOffset: { width: 0, height: isDark ? shadowOffsetY : Math.min(shadowOffsetY, 3) },
                elevation: isDark ? elevation : Math.min(elevation, 4),
              }),
          // 2026-10-08 按用户方案：外层普通 View 统一裁切（borderRadius + overflow hidden）
          overflow: 'hidden',
        },
        restStyle,
      ]}
    >
      {/* 渐变填充层（2026-10-08·修正 12）：填充改由 RNSVG 绘制（与柔光层、Hero 顶光同一渲染引擎，
          真机上一直被验证是干净的）；expo LinearGradient 的原生绘制经用户真机「灰底试验」指认，
          会产生「内容区浅色内矩形」色阶（纯灰实底时该现象消失），弃用。
          绝对定位铺满卡片、数值化几何（与柔光层同源 rimBox），由外层 View 的圆角 + overflow 裁切兜底 */}
      {rimBox ? (
        <Svg pointerEvents="none" width={rimBox.w} height={rimBox.h} style={{ position: 'absolute', top: 0, left: 0 }}>
          <Defs>
            <SvgLinearGradient id={fillId} x1="0.5" y1="0" x2="0.5" y2="1">
              {/* ⚠ 2026-10-08·修正 13：RNSVG 原生端不读 stopColor 里 rgba 的 alpha → 颜色与透明度拆开写
                  （stopColor=rgb / stopOpacity=alpha，与原 expo rgba 一一对应），否则真机上渐变变不透明实底 */}
              <Stop offset="0" stopColor={fillTop.color} stopOpacity={fillTop.opacity} />
              <Stop offset="0.5" stopColor={fillMid.color} stopOpacity={fillMid.opacity} />
              <Stop offset="1" stopColor={fillBottom.color} stopOpacity={fillBottom.opacity} />
            </SvgLinearGradient>
          </Defs>
          <Rect x={0} y={0} width={rimBox.w} height={rimBox.h} rx={rimRx} ry={rimRx} fill={`url(#${fillId})`} />
        </Svg>
      ) : null}
      {hasPad ? <View style={contentWrap}>{children}</View> : children}
      {/* 柔光层（2026-10-07 第 6 轮·修正 4b：实测坐标版，见 rimBox 注释）：
          9 层等步长描边（0.25→2.25dp，≈4/255 步进叠加成平滑衰减）+ 垂直渐变（顶最亮→底最暗），
          数值按目标图取样（顶缘合成 ≈白 0.42、2.3dp 外回落填充色）；外半由数值化 ClipPath 裁切 */}
      {rimBox ? (
        <Svg
          pointerEvents="none"
          width={rimBox.w}
          height={rimBox.h}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
        >
          <Defs>
            <SvgLinearGradient id={themedGlowId} x1="0.5" y1="0" x2="0.5" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={palette.glow[0]} />
              <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={palette.glow[1]} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={palette.glow[2]} />
            </SvgLinearGradient>
            <ClipPath id={clipId}>
              <Rect x={0} y={0} width={rimBox.w} height={rimBox.h} rx={rimRx} ry={rimRx} />
            </ClipPath>
          </Defs>
          <G clipPath={`url(#${clipId})`}>
            {(isDark ? rimWidths : rimWidthsDay).map((w) => (
              <Rect
                key={w}
                x={0}
                y={0}
                width={rimBox.w}
                height={rimBox.h}
                rx={rimRx}
                ry={rimRx}
                fill="none"
                stroke={`url(#${themedGlowId})`}
                strokeWidth={w}
              />
            ))}
          </G>
        </Svg>
      ) : null}
    </View>
  );
}

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
    paymentPlans,
    getAssetBalance,
    getAssetById,
  } = useApp();

  const { colors, isDark, semantic, spacing, layout, radius, typography, elevation, motion } = useTheme();
  const t = useT();
  const { langMode: homeLang } = useLanguage();
  const insets = useSafeAreaInsets();
  // 版型分级（计划 8.2 第 2 条）：Hero 金额字号 / 行高从这里取，不再用 Dimensions
  const layoutTokens = useLayout();

  const tabClearance = useTabClearance();

  const onTabScroll = useTabBarScrollHandler();
  const styles = useMemo(
    () => makeStyles(colors, isDark, semantic, spacing, radius, layout, elevation),
    [colors, isDark, semantic, spacing, radius, layout, elevation]
  );
  // 极光层总开关（2026-09-25 用户要求：先断开保留，说到要恢复时改 true）
  // 组件/色 token/依赖全部原样保留，详见 AURORA_FLOW_GUIDE.md
  const AURORA_ENABLED = false;
  // 渐变规格：色值在 theme.ts homeHero* token 里维护。
  // 日间 = 左上→右下对角（薰衣草→长春花紫）；
  // 夜间 = 底色 73° 陡对角（左上空紫 → 右下近黑）+ 顶部光晕径向层（heroTopGlow，见卡内 JSX）
  // ——2026-10-07 按新目标图逐像素取样拟合（RMSE≈5/255）；end 的 y=1.266 = 73° 轴映射精确值
  const heroGradient = useMemo<
    {
      colors: [string, string, ...string[]];
      locations: [number, number, ...number[]];
      start: { x: number; y: number };
      end: { x: number; y: number };
    }
  >(
    () =>
      isDark
        ? {
            colors: [colors.homeHeroGlow, colors.homeHeroGlowMid, colors.homeHeroDeep],
            locations: [0, 0.5, 1],
            start: { x: 0, y: 0 },
            end: { x: 0.308, y: 1.266 },
          }
        : {
            colors: [colors.homeHeroGradientFrom, colors.homeHeroGradientTo],
            locations: [0, 1],
            start: { x: 0, y: 0 },
            end: { x: 1, y: 1 },
          },
    [isDark, colors]
  );
  // 立体毛玻璃配色（2026-10-07 批次2 起共用）：浅色档=卡上白玻璃（日/夜 token 成对；按目标图取样校准）
  // glow=顶缘柔光的三个 stopOpacity（沿高度 顶/中/底；叠三层描边后顶缘合成≈白 0.44）
  // ⚠ 2026-10-09 修正 25（用户「日间按钮/面板要改成和夜间一样的金属质感」）：
  //   日间从「半透明玻璃 + 强柔光」改成**银紫拉丝金属**（夜间读起来像金属的结构：不透明偏灰表面 +
  //   一条锐利细亮边（表面比亮边暗）+ 无柔光晕 + 干净利落投影）：
  //   填充 = 不透明 3 段（#ECE8F8 → #D3CCEC → #E0DAF3，lightColors.homeGlass*）；
  //   柔光 [0.22,0.12,0.06] → **[0.10,0.05,0.02]** 且层数收窄到 ~1dp（GlassLift rimWidthsDay）；
  //   投影走 elevation（填充不透明后自动切换），模糊/偏移在 GlassLift 里日间收小一档、色 #3D2A7A 0.25
  const glassPalette = useMemo(
    () => ({
      fill: [colors.homeGlassFillTop, colors.homeGlassFillMid, colors.homeGlassFillBottom] as [string, string, string],
      border: colors.homeGlassBorder,
      edgeShade: colors.glassEdgeShade,
      shadowColor: colors.homeGlassShadow,
      shadowOpacity: isDark ? 0.32 : 0.25,
      glow: (isDark ? [0.017, 0.0131, 0.0105] : [0.10, 0.05, 0.02]) as [number, number, number],
    }),
    [colors, isDark]
  );
  // 预算面板专用玻璃（大面档）：比小控件更薄更柔的填充 + 更远更轻的影（按目标图取样：面板≈白 11%）
  // 柔光同样低一档：大面上的边缘光要更收敛
  // ⚠ 夜间档（2026-10-08 修正 2 起）=「近不透明等效色」（原白 0.16/0.08 太透，Android elevation
  //   阴影透过来在面板内侧烧出一圈灰边 = 用户报的「两层边」；等效色 = 白 0.16/0.08 叠夜卡的实测
  //   合成色 #3D3752→#27223B）——夜间不动（修正 25 只加中停 = 两段线性中值，渲染逐像素不变）。
  // ⚠ 2026-10-09 修正 25（用户「日间面板要改成和夜间一样的金属质感」）：日间从「半透明玻璃」改成
  //   银紫拉丝金属（处方色）：填充 **不透明 3 段 #E3DDF6 → #CBC2EC → #D8D1F2**（比按钮档略深一档）、
  //   描边 **白 0.95** + 底部深紫灰倒角；柔光 [0.22,0.12,0.06] → **[0.10,0.05,0.02]**；
  //   投影走 elevation（面板不透明 → 自动切换），模糊/偏移日间收小一档、色 #3D2A7A 0.25
  const glassPalettePanel = useMemo(
    () => ({
      fill: (isDark
        ? ['rgba(61,55,82,1)', 'rgba(50,45,71,1)', 'rgba(39,34,59,1)']
        : ['#E3DDF6', '#CBC2EC', '#D8D1F2']) as [string, string, string],
      border: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.95)',
      edgeShade: colors.glassEdgeShade,
      shadowColor: colors.homeGlassShadow,
      shadowOpacity: isDark ? 0.22 : 0.25,
      glow: (isDark ? [0.012, 0.009, 0.0074] : [0.10, 0.05, 0.02]) as [number, number, number],
    }),
    [colors, isDark]
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
  // ── Hero 金额卡金属光泽（2026-10-08 用户处方重做：陀螺仪驱动 + 笔画内流光）──
  // 三个触发：进首页（focus）/ 金额变化 / 眼睛显示金额 → 自动扫一次（1.5s ease-in-out）；
  // 陀螺仪倾斜 → 高光位置（120ms 平滑插值，静止即静止）；降级规则见 components/HeroMetalSheen.tsx
  const [homeFocused, setHomeFocused] = useState(true);
  const heroSheen = useHeroSheen({ active: homeFocused });
  const { sweep: sweepHeroSheen } = heroSheen;
  const heroSheenPalette = useMemo(
    () => ({
      core: colors.homeAmountSheenCore,
      shoulderA: colors.homeAmountSheenShoulderA,
      shoulderB: colors.homeAmountSheenShoulderB,
      metalTop: colors.homeAmountMetalTop,
      metalMid: colors.homeAmountMetalMid,
      metalBottom: colors.homeAmountMetalBottom,
      cardCore: colors.homeCardSheenCore,
      cardShoulderA: colors.homeCardSheenShoulderA,
      cardShoulderB: colors.homeCardSheenShoulderB,
    }),
    [colors]
  );
  useFocusEffect(
    useCallback(() => {
      setHomeFocused(true);
      // 进首页的扫光延迟 ~600ms（2026-10-08 修正 19 处方 4：等页面渲染完成再播放）
      const t = setTimeout(() => sweepHeroSheen(), 600);
      return () => {
        clearTimeout(t);
        setHomeFocused(false);
      };
    }, [sweepHeroSheen])
  );
  const toggleBalanceHidden = () => {
    const next = !balanceHidden;
    if (!next) sweepHeroSheen(); // 由隐藏→显示金额：扫一次（2026-10-08）
    setBalanceHidden(next);
    AsyncStorage.setItem(BALANCE_HIDDEN_KEY, next ? '1' : '0').catch(() => {});
  };

  // ── 日夜切换：圆心扩散换肤 + 三合一胶囊里的「日/夜」段已按 T08 删除 ──
  // 主题改为跟随系统（T01e，设置页可手动指定），首页不再放切换按钮，也不再需要那套遮罩动画。
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
  // 币种列表按 ABC 字母序排列（2026-09-24 用户定版）
  const totalsByCurrency = useMemo(() => {
    const totals: Record<string, number> = {};
    assets
      .filter((a) => a.ledgerId === activeLedgerId)
      .forEach((a) => {
        totals[a.currency] = (totals[a.currency] || 0) + getAssetBalance(a.id);
      });
    return Object.entries(totals).sort(([c1], [c2]) => c1.localeCompare(c2));
  }, [assets, activeLedgerId, getAssetBalance]);

  // 净资产卡显示的币种：多币种时点行调出货币下拉菜单；默认=资产数组第一个账户的币种（兜底全局货币）
  const defaultNetWorthCurrency = useMemo(() => {
    const first = assets.find((a) => a.ledgerId === activeLedgerId);
    return first?.currency ?? currency;
  }, [assets, activeLedgerId, currency]);
  // 用户手选的币种代码（null=未手选过，跟随默认）——列表已按 ABC 排序，不能再用下标，否则默认币种会跟着排序漂移
  const [netWorthCurrency, setNetWorthCurrency] = useState<string | null>(null);
  const [currencyMenuOpen, setCurrencyMenuOpen] = useState(false);
  // 货币下拉菜单（2026-10-06 按交互视频 1:1 重做）：⇅ 钮与金额行都可触发；悬浮面板锚在 ⇅ 钮下方，
  // 左右与卡同边距（样式里定死 16），四角圆角 + 深紫玻璃底。只存 top，进退场动画由 Reanimated 承担
  const valueRowRef = useRef<View>(null);
  const currencySwapRef = useRef<View>(null);
  const [currencyMenuRect, setCurrencyMenuRect] = useState<{ top: number } | null>(null);
  // 金额行实测宽（Δ>0.5 才更新）：只用来给净资产大金额选字号档位，
  // 行宽由父级 flex 布局决定、与文字字号无关——单向数据流，无测量正反馈
  const [amountRowW, setAmountRowW] = useState(0);
  const openCurrencyMenu = () => {
    if (totalsByCurrency.length <= 1) return;
    currencySwapRef.current?.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      // 面板顶到「⇅」钮底缘下 6px（视频同款：从钮下方下拉出来、悬浮盖住卡内下方内容）
      setCurrencyMenuRect({ top: y + h + 6 });
      setCurrencyMenuOpen(true);
    });
  };
  const displayTotal =
    totalsByCurrency.find(([c]) => c === (netWorthCurrency ?? defaultNetWorthCurrency)) ?? totalsByCurrency[0];

  // ── Hero 净资产（T08 / H2）：`RM28,797.59` —— 币种前缀与小数缩到 60% 字号、70% 不透明度，
  //    与整数同一行；整数走 display 档，字号从 useLayout().heroAmountFontSize 起步、放不下按档位降级。
  //    三段串都由 formatMoney 产出后按「非数字 / 数字 / 小数」切分，页面里不手写千分位。
  //    可见文字与 AmountSheen 的遮罩共用同一份字号与同一套 AppText 档位 —— 两层字形逐像素对齐。
  const heroAmountFull = displayTotal
    ? fmtMoney(displayTotal[1], { currency: displayTotal[0], showCurrency: true })
    : '';
  const heroParts = useMemo(() => splitMoneyText(heroAmountFull), [heroAmountFull]);
  const heroSizes = useMemo(
    () => heroAmountSizes(heroParts.prefix, heroParts.int, heroParts.dec, layoutTokens.heroAmountFontSize, amountRowW),
    [heroParts, layoutTokens.heroAmountFontSize, amountRowW]
  );
  const heroIntValue = displayTotal ? Math.abs(Math.trunc(displayTotal[1])) : 0;
  // 行高按 display 档的比例（46/40）换算，三段在同一个基线行上，行盒高度一致
  const heroLineRatio = typography.display.lineHeight / typography.display.fontSize;
  const heroSmallStyle = useMemo<TextStyle>(
    () => ({ fontSize: heroSizes.small, lineHeight: Math.round(heroLineRatio * heroSizes.small), opacity: HERO_SMALL_OPACITY }),
    [heroSizes.small, heroLineRatio]
  );
  const heroIntStyle = useMemo<TextStyle>(
    () => ({ fontSize: heroSizes.int, lineHeight: Math.round(heroLineRatio * heroSizes.int) }),
    [heroSizes.int, heroLineRatio]
  );
  // 日间紫投影（Hero 上所有文字共用；夜间为空）
  const heroTextShadow = useMemo(() => heroTextShadowStyle(isDark), [isDark]);
  // 笔画内流光的遮罩：与可见文字完全同构（同 AppText 档位 / 同字号 / 同基线行 / 同 60%/70% 小字档），
  // 只把字色换成纯黑、去掉投影 —— 两层字形逐像素对齐（T08 / H2）
  const heroAmountMask = useMemo(
    () => (
      <View style={styles.heroAmountRow}>
        <AppText variant="body" color="#000000" style={heroSmallStyle}>
          {heroParts.prefix}
        </AppText>
        <AppText variant="display" color="#000000" style={heroIntStyle}>
          {heroParts.int}
        </AppText>
        <AppText variant="body" color="#000000" style={heroSmallStyle}>
          {heroParts.dec}
        </AppText>
      </View>
    ),
    [heroParts, heroSmallStyle, heroIntStyle, styles]
  );
  // 金额变化 → 自动扫光一次（首帧与「进首页触发的扫光」重复，用 ref 跳过；隐藏态不扫）
  const sheenSkippedFirstAmountRef = useRef(true);
  useEffect(() => {
    if (!heroAmountFull || balanceHidden) return;
    if (sheenSkippedFirstAmountRef.current) {
      sheenSkippedFirstAmountRef.current = false;
      return;
    }
    sweepHeroSheen();
  }, [heroAmountFull, balanceHidden, sweepHeroSheen]);
  // 净资产卡当前选中的币种：本月支出合计、预算都跟随它（每个币种各设各的预算）
  const activeCurrency = displayTotal?.[0] ?? currency;
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
    return groups.map((g) => {
      const month = g.date.slice(0, 7);
      let monthSep: string | null = null;
      if (month !== prevMonth) {
        prevMonth = month;
        // %{m} 取 date.months（中文「10月」/ 英文「Oct」），模板在本页 home 块里
        monthSep = t('home.monthSep', { y: g.date.slice(0, 4), m: t(`date.months.${Number(g.date.slice(5, 7)) - 1}`) });
      }
      return { ...g, label: formatDate(g.date, homeLang), monthSep, data: g.items };
    });
    // ⚠ t 是全局稳定引用：依赖数组必须带 homeLang，切语言后日期与月份分隔才会重算
  }, [ledgerTransactions, activeCurrency, txCurrencyOf, homeLang, t]);

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

  // ── 账单行（T09 / H5）：统一 TransactionRow —— 标题 = 备注（无备注用类别名）、副标题 = 类别 · 账户、
  //    支出中性色「−」/ 收入绿「+」；单击即编辑（与长按同一入口），长按保留；命中闪行时加淡紫底 ──
  const renderTxRow = useCallback(({ item }: { item: Transaction }) => {
    const cat = getCategoryById(item.categoryId);
    const catName = cat ? getCategoryLabel(cat, t) : UNCATEGORIZED_NAME;
    const catIcon = (cat?.icon ?? UNCATEGORIZED_ICON) as IconName;
    const catColor = cat?.color ?? UNCATEGORIZED_COLOR;
    const assetName = item.assetId ? getAssetById(item.assetId)?.name : undefined;
    const openEdit = () => navigation.navigate(ROUTES.ADD_TX, { editTransaction: item });
    // 标题 = 备注（计划付款的 displayName 也当备注用）；两者都没有时标题落到类别名，
    // 这时副标题只显示账户、不再把类别写第二遍（验收小修：原来是「Dining / Dining · Maybank 储蓄」）。
    // TransactionRow 的副标题固定是「类别 · 账户」拼接，把 categoryName 传空串即只剩账户；
    // 类别图标/颜色仍照常传，图标方块不变（组件文件不在本车道可改范围，用参数绕开重复）
    const ownTitle = item.note?.trim() || item.displayName?.trim() || '';
    const hasOwnTitle = ownTitle.length > 0;
    return (
      <TransactionRow
        note={hasOwnTitle ? ownTitle : catName}
        categoryName={hasOwnTitle ? catName : ''}
        categoryIcon={catIcon}
        categoryColor={catColor}
        accountName={assetName}
        amount={item.amount}
        kind={item.type === 'income' ? 'income' : 'expense'}
        onPress={openEdit}
        onLongPress={openEdit}
        style={item.id === flashTxId ? styles.txRowFlash : undefined}
      />
    );
    // 依赖：渲染期读到的都列进来；stable 的 renderItem 让 VirtualizedList 的 CellRenderer
    //（PureComponent，比较 renderItem 身份 + item 身份）在滚动 / 切 Tab 时跳过重渲染
  }, [t, getCategoryById, getAssetById, flashTxId, navigation, styles]);

  // 吸顶日期头（H4）：formatDate 的「今天 / 昨天 / 10月7日 周三」+ 右侧「支出 172.72 · 收入 6,800.00」
  // （wrap 行：放不下自动换行，不缩字不省略）；跨月时在日期头之上再插一条月份分隔
  const renderDayHeader = useCallback(({ section }: { section: TxDaySection }) => (
    <View style={styles.dayHeaderWrap}>
      {!!section.monthSep && (
        <AppText variant="caption" color={semantic.textSecondary} style={styles.monthSepText}>
          {section.monthSep}
        </AppText>
      )}
      <View style={styles.dayHeaderRow}>
        <AppText variant="footnote" weight="600" style={styles.dayHeaderDate} numberOfLines={1}>
          {section.label}
        </AppText>
        <View style={styles.dayHeaderTotals}>
          {section.expense > 0 && (
            <>
              <AppText variant="footnote" color={semantic.textSecondary}>
                {`${t('report.expense')} `}
              </AppText>
              <MoneyText value={section.expense} variant="footnote" color={semantic.amountExpense} />
            </>
          )}
          {section.expense > 0 && section.income > 0 && (
            <AppText variant="footnote" color={semantic.textTertiary}>
              {'·'}
            </AppText>
          )}
          {section.income > 0 && (
            <>
              <AppText variant="footnote" color={semantic.textSecondary}>
                {`${t('report.income')} `}
              </AppText>
              <MoneyText value={section.income} variant="footnote" color={semantic.amountIncome} />
            </>
          )}
        </View>
      </View>
    </View>
  ), [semantic, styles, t]);

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
  // 预算条单色状态（T08 / H3）：<80% 白（Hero 卡上的白色 token）/ 80–100% warning / >100% danger
  const budgetBarColor = budgetOver
    ? semantic.danger
    : budgetPctText >= 80
      ? semantic.warning
      : colors.netWorthValue;

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

  // 未读消息数（用户定版 2026-10-06：铃铛=有消息才出现的条件整钮）。
  // 当前 App 还没有消息系统 → 恒 0（红点不渲染）；消息系统接入后把这里接到真实未读数即可
  const unreadCount: number = 0;

  // ── 卡下辉光呼吸（4s 循环）──
  // T08 / H9：删掉已不渲染的 MetalSheen 8s 扫光循环与 400ms setInterval（改成滚动事件直接暂停 +
  // 静止 1.1s 定时恢复）；首页失焦（切 Tab / 进二级页）或无弹层打开时也停 —— 省电、减少发热。
  const [scrollQuiet, setScrollQuiet] = useState(true);
  const scrollQuietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glowPhase = useRef(new Animated.Value(0)).current;
  const glowLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const anyOverlayOpen = ledgerPickerOpen || currencyMenuOpen || budgetModalOpen || pinSheetOpen;
  const glowActive = homeFocused && !anyOverlayOpen && scrollQuiet;
  useEffect(() => {
    if (!glowActive) return;
    glowLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(glowPhase, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(glowPhase, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    glowLoopRef.current.start();
    return () => {
      glowLoopRef.current?.stop();
      glowLoopRef.current = null;
    };
  }, [glowActive, glowPhase]);
  useEffect(
    () => () => {
      if (scrollQuietTimer.current) clearTimeout(scrollQuietTimer.current);
    },
    []
  );
  // 滚动中暂停辉光（滚动静止 ~1.1s 后恢复；顺带透传给 Tab 栏自动隐藏处理器：滚动期间缓动暂停）
  const handleHomeScroll = useCallback(
    (e: any) => {
      setScrollQuiet(false);
      if (scrollQuietTimer.current) clearTimeout(scrollQuietTimer.current);
      scrollQuietTimer.current = setTimeout(() => setScrollQuiet(true), SCROLL_QUIET_MS);
      // 吸顶条显示条件之一：列表已经滚过 Hero 卡（值只在边界翻转一次，不会每帧 setState）
      const y = e?.nativeEvent?.contentOffset?.y ?? 0;
      const passed = y >= heroHeightRef.current - 6;
      setHeroPassed((prev) => (prev === passed ? prev : passed));
      onTabScroll?.(e);
    },
    [onTabScroll]
  );

  return (
    <>
    {/* 顶部安全区不再由 SafeAreaView 让位（2026-10-06 晚·全出血目标图）：Hero 卡通顶连屏、
        状态栏压在卡面上（状态栏=透明，见 android styles.xml）；内容让位改由卡片自身
        paddingTop=insets.top 承担（见 assetCard 的 JSX 内联 style）。内容滚动时从状态栏下方穿过属预期 */}
    <SafeAreaView style={styles.container} edges={[]}
      onTouchStart={() => { Keyboard.dismiss(); }}
    >
      {/* 首页主体 = 一个 SectionList（T09 / H4 / H6）：
          头部（Hero + 日历卡）走 ListHeaderComponent，账单按天分组渲染（吸顶日期头 + TransactionRow 行）；
          滚动事件继续透传给 Tab 栏自动隐藏（T07 联动）。
          底部悬空区由 App.tsx 的 TabShell 统一预留（96+安全区），这里只留一点呼吸感 */}
      <SectionList<Transaction, TxDaySection>
        ref={listRef}
        // ⚠ 数据「空 → 非空」时强制重挂列表 —— 验收退回「只出前几行」的真根因：
        //   VirtualizedList 的窗口状态在挂载那一刻按当时的数据算；AppContext 读本地数据是异步的，
        //   首页首帧 sections=[] → 它的 cellsAroundViewport 被钉成 { first: 0, last: -1 }，
        //   而源码里 _scheduleCellsToRenderUpdate 要求 last >= 0 才允许扩窗口 →
        //   数据随后到达窗口也不会恢复（表现：只有首批几行、滚到底没内容；数据碰巧先到就正常，
        //   所以小数据量时像偶发 bug）。让它在有真实 sections 时用新 key 重挂一次即可解决。
        key={dayGroups.length === 0 ? 'empty' : 'ready'}
        // 虚拟化参数（验收要求的性能档）：一屏多一点首批、8 屏窗口、每批 10 条
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={8}
        // 安卓开视图裁剪（省内存 / 提升滚动性能）；Web 上无意义且会和 RNW 的测量打架
        removeClippedSubviews={Platform.OS === 'android'}
        // 日历模式下 sections 为空：列表不渲染（与旧的 display:none 等价），只剩头部卡
        sections={viewMode === 'calendar' ? [] : dayGroups}
        keyExtractor={txKeyExtractor}
        renderItem={renderTxRow}
        renderSectionHeader={renderDayHeader}
        ItemSeparatorComponent={TxSeparator}
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
        {/* 净资产 —— 全屏唯一的主角卡：渐变只留给它，正文卡片一律扁平 */}
        <Reanimated.View
          entering={CARD_ENTER[0]}
          onLayout={(e) => {
            heroHeightRef.current = e.nativeEvent.layout.height;
          }}
        >
          {/* 卡外阴影（T11）：HeroCardShadow 在原静态阴影上叠加「随倾斜反向微移」（光源在上方），
              原生端 + 非减弱动效才动；Web / 减弱动效 = 纯静态，与现状一致 */}
          <HeroCardShadow sheen={heroSheen} style={styles.assetCardShadow}>
            {/* 卡下呼吸辉光（2026-10-07 批次6 按用户拍板「Hero 卡下方要有辉光呼吸感」）：复用现成
                CardUnderGlow（4s 呼吸相位）；色=homeHeroUnderGlow（按目标图卡下辉光带取样）；
                放第一子位=绘制在卡面之下、绝对定位伸出卡底；T08 起失焦/滚动中/弹层打开都会暂停 */}
            <CardUnderGlow phase={glowPhase} color={colors.homeHeroUnderGlow} />
            {/* style 里的 paddingTop 为「全出血」让位状态栏：卡面贴屏幕顶，内容从 insets.top 之下开始 */}
            <LinearGradient
              colors={heroGradient.colors}
              locations={heroGradient.locations}
              start={heroGradient.start}
              end={heroGradient.end}
              style={[styles.assetCard, { paddingTop: insets.top + 14 }]}
            >
              {/* 顶部受光层（2026-10-07 批次1 夜间按目标图像素拟合；第 5 轮补日间版）：
                  夜间=圆心卡外上方 (0.70,-0.30)/r 0.83/幂律 2.11/色 #7856a2（已定版，数值不动）；
                  日间=同一套结构，光位改左上 (0.25,-0.25)（与日间文字紫投影的光位一致）、色白、
                  峰值透明度 0.42 —— 日间卡面不再是纯渐变，有了"受光"层次。
                  viewBox 100×79.5 + preserveAspectRatio none = 等比铺满卡面（不随设备变形）；
                  pointerEvents none、放内容之前 = 盖底色不盖文字 */}
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <Svg width="100%" height="100%" viewBox="0 0 100 79.5" preserveAspectRatio="none">
                  <Defs>
                    <RadialGradient
                      id={`heroTopGlowGrad${isDark ? 'D' : 'L'}`}
                      cx={isDark ? '70' : '25'}
                      cy={isDark ? '-30' : '-25'}
                      r={isDark ? '83' : '80'}
                      gradientUnits="userSpaceOnUse"
                    >
                      <Stop offset="0" stopColor={isDark ? colors.homeHeroTopGlow : '#FFFFFF'} stopOpacity={isDark ? '1' : '0.42'} />
                      <Stop offset="0.25" stopColor={isDark ? colors.homeHeroTopGlow : '#FFFFFF'} stopOpacity={isDark ? '0.546' : '0.229'} />
                      <Stop offset="0.5" stopColor={isDark ? colors.homeHeroTopGlow : '#FFFFFF'} stopOpacity={isDark ? '0.232' : '0.097'} />
                      <Stop offset="0.75" stopColor={isDark ? colors.homeHeroTopGlow : '#FFFFFF'} stopOpacity={isDark ? '0.054' : '0.023'} />
                      <Stop offset="1" stopColor={isDark ? colors.homeHeroTopGlow : '#FFFFFF'} stopOpacity="0" />
                    </RadialGradient>
                  </Defs>
                  <Rect x="0" y="0" width="100" height="79.5" fill={`url(#heroTopGlowGrad${isDark ? 'D' : 'L'})`} />
                </Svg>
              </View>
              {/* 2026-10-08 用户处方：整卡金属扫光（8s 匀速纯白硬边光带）退役 —— 重做为
                  「金额笔画内流光（MaskedView 遮罩 + 陀螺仪倾斜驱动 + 触发式扫光）+ 卡顶随倾斜光缝」
                  见 components/HeroMetalSheen.tsx。MetalSheen 组件与 sheenPhase 循环 0 引用保留
                  可恢复（照 AURORA / MetalSheen 先例）——回滚只需恢复下一行：
                  <MetalSheen phase={sheenPhase} tint={colors.homeMetalSheen} /> */}
              <HeroEdgeSheen palette={heroSheenPalette} sheen={heroSheen} />
              {/* 卡面扫光（2026-10-08 修正 20 处方 1/4/6）：与数字流光共用同一套位置驱动（同一个
                  sweepPos/tiltPos → 光掠过数字时数字同时变亮）；放在背景渐变之上、内容之前
                  （内容是后画的 → 按钮/文字/金额/预算面板不被覆盖）；宽≈卡宽 70%、斜 20°、
                  两端同色 alpha 0、被卡的 borderRadius + overflow hidden 裁切、pointerEvents none */}
              <HeroCardSheen palette={heroSheenPalette} sheen={heroSheen} />
              {/* 极光层：真·GPU shader（Skia 域扭曲噪声，无限流动不重复）——
                  【总开关 AURORA_ENABLED】2026-09-25 用户要求先断开保留：
                  组件(AuroraFlowShader.tsx)/色 token(homeHeroAurora*)/依赖(react-native-skia)
                  全部原样保留，改 AURORA_ENABLED = true 即恢复；shader 编译失败时本层返回 null，
                  底下 heroGradient 原样兜底。放在内容之前=盖渐变不盖文字，pointerEvents none */}
              {AURORA_ENABLED && (
                <AuroraFlowShader
                  dark={colors.homeHeroAuroraDark}
                  mid={colors.homeHeroAuroraMid}
                  glow={colors.homeHeroAuroraGlow}
                  opacity={0.35}
                />
              )}
              {/* 曲面玻璃层（GlassRibbons）已按用户 2026-10-06 指示移除——组件文件与
                  homeHeroGlass* 令牌保留可恢复（同 AURORA 先例） */}
              {/* 头部一行（2026-10-06 按目标图移入卡内）：左=铃铛 · 中=账本胶囊 · 右=三合一胶囊；
                  三槽 flex 布局；材质=卡上玻璃族（2026-10-07 批次2 起逐件升级为 GlassLift 立体玻璃）
                  2026-10-07 批次2：铃铛改常显（原 2026-10-06「有消息才出现」按新目标图撤销） */}
              <View style={styles.headerRow}>
                <View style={styles.headerSide}>
                  {/* 铃铛：Hero 卡上的标准 IconButton（T08 / H1）——半透明白底 = 卡上件统一材质，
                      多层 GlassLift 描边堆叠已撤掉；红点条件位保留（当前无消息系统 → 不显示） */}
                  <View style={styles.heroCtlWrap}>
                    <IconButton
                      icon="notifications-outline"
                      size={20}
                      color={colors.homeIconColor}
                      style={styles.heroCtlBtn}
                      accessibilityLabel={t('home.notificationTitle')}
                      onPress={() => dialog.alert({ title: t('home.notificationTitle'), message: t('home.notificationMsg') })}
                    />
                    {unreadCount > 0 && (
                      <View style={styles.notifBadge}>
                        <Text style={styles.notifBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                      </View>
                    )}
                  </View>
                </View>
                {/* 账本胶囊：纯文字 + 下拉箭头（用户定版：不加身份标识），点按仍是账本抽屉入口；
                    T08 起底 = 与铃铛/切换钮同一材质（半透明白底），不再包 GlassLift */}
                <PressableScale
                  onPress={() => setLedgerPickerOpen(true)}
                  activeScale={0.94}
                  style={[styles.heroCtlPill, { backgroundColor: colors.homeGlassFillTop }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('home.selectLedger')}
                  accessibilityState={{ expanded: ledgerPickerOpen }}
                >
                  <AppText variant="headline" color={colors.homeGlassText} numberOfLines={1} style={styles.ledgerPillText}>
                    {activeLedger?.name ?? t('home.ledgerName')}
                  </AppText>
                  <Ionicons name="chevron-down" size={16} color={colors.homeIconColor} />
                </PressableScale>
                <View style={styles.headerSideRight}>
                  {/* 日历 / 列表切换（T08 / H1）：「中/EN」与「日/夜」两段已删除——语言在设置页、
                      主题跟随系统；只留这一个视图切换钮，材质与铃铛/账本胶囊一致 */}
                  <IconButton
                    icon={viewMode === 'detail' ? 'calendar-outline' : 'list-outline'}
                    size={20}
                    color={colors.homeIconColor}
                    style={styles.heroCtlBtn}
                    accessibilityLabel={t('home.toggleView')}
                    accessibilityState={{ selected: viewMode === 'calendar' }}
                    onPress={() => {
                      hapticLight();
                      const nextMode = viewMode === 'detail' ? 'calendar' : 'detail';
                      setViewMode(nextMode);
                      // 切回列表时滚回顶部（避免长列表滚动位置残留、切回来看不到卡片头部）。
                      // ⚠ 只在「切回列表」时滚：切到日历时 sections 会置空，
                      //    此时 scrollToLocation 会因 item 数 0 报错（自检抓到 scrollToIndex out of range）；
                      //    等一帧让新 sections 上去再滚，SectionList 的公开 API 是 scrollToLocation
                      if (nextMode === 'detail') {
                        requestAnimationFrame(() => {
                          listRef.current?.scrollToLocation({ sectionIndex: 0, itemIndex: 0, animated: false });
                        });
                      }
                    }}
                  />
                </View>
              </View>
              {/* 行1：净资产标签 + 右侧「眼睛 + ⇅」（T08：Hero 卡上的标准 IconButton，同一半透明白底） */}
              <View style={styles.assetCardTopRow}>
                <AppText variant="subhead" color={colors.netWorthLabel}>
                  {t('home.netWorth')}
                </AppText>
                <View style={styles.heroIconRow}>
                  {displayTotal && (
                    <IconButton
                      icon={balanceHidden ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color={colors.homeIconColor}
                      style={styles.heroCtlBtn}
                      accessibilityLabel={t('home.toggleAmount')}
                      accessibilityState={{ checked: !balanceHidden }}
                      onPress={toggleBalanceHidden}
                    />
                  )}
                  {totalsByCurrency.length > 1 && (
                    // ref 留在外层 View：货币下拉面板的窗口坐标锚点测量沿用它
                    <View ref={currencySwapRef} collapsable={false}>
                      <IconButton
                        icon="swap-vertical"
                        size={20}
                        color={colors.homeIconColor}
                        style={styles.heroCtlBtn}
                        accessibilityLabel={t('home.selectCurrency')}
                        onPress={openCurrencyMenu}
                      />
                    </View>
                  )}
                </View>
              </View>
              {totalsByCurrency.length === 0 ? (
                /* 无账户（T08 / H2）：统一 EmptyState（图标 + 一句话 + 一个按钮），
                   按钮走现有「添加资产账户」入口 */
                <EmptyState
                  icon="wallet-outline"
                  title={t('home.noAssetsTitle')}
                  description={t('home.noAssetsHint')}
                  actionLabel={t('home.addAccount')}
                  onAction={() => navigation.navigate(ROUTES.ADD_ASSET)}
                  style={styles.heroEmpty}
                />
              ) : (
                displayTotal && (
                  /* 金额行（T08 / H2）：`RM28,797.59` —— 币种前缀与小数 = 60% 字号 / 70% 不透明度，
                     整数 = display 档（档位见 heroAmountSizes）；三段同一行、同一基线。
                     整行点按仍调出货币下拉（原交互不变） */
                  <View
                    style={styles.heroAmountWrap}
                    onLayout={(e) => {
                      const w = e.nativeEvent.layout.width;
                      setAmountRowW((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
                    }}
                  >
                    <PressableScale
                      onPress={openCurrencyMenu}
                      disabled={totalsByCurrency.length <= 1}
                      activeScale={0.98}
                      style={styles.heroAmountPress}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('home.netWorth')}：${heroAmountFull}`}
                    >
                      {balanceHidden ? (
                        <AppText
                          variant="display"
                          color={colors.netWorthValue}
                          style={[heroIntStyle, heroTextShadow]}
                          numberOfLines={1}
                        >
                          {HIDDEN_AMOUNT}
                        </AppText>
                      ) : (
                        <View style={styles.heroAmountRow}>
                          <AppText variant="body" color={colors.netWorthValue} style={[heroSmallStyle, heroTextShadow]}>
                            {heroParts.prefix}
                          </AppText>
                          {/* 整数走 MoneyText（逐位滚动 / 永不截断 都是它的既有实现）；
                              字号由 heroSizes 算好后用等长阶梯固定住，与遮罩层同号同档 */}
                          <MoneyText
                            value={heroIntValue}
                            kind="plain"
                            decimals={0}
                            variant="display"
                            color={colors.netWorthValue}
                            shrinkLadder={[heroSizes.int, heroSizes.int]}
                            compactFallback={false}
                            accessibilityLabel={heroAmountFull}
                            style={[heroIntStyle, heroTextShadow]}
                          />
                          <AppText variant="body" color={colors.netWorthValue} style={[heroSmallStyle, heroTextShadow]}>
                            {heroParts.dec}
                          </AppText>
                        </View>
                      )}
                    </PressableScale>
                    {/* 笔画内流光（T08：遮罩与新文字逐像素对齐）——遮罩 = 与可见文字同结构、同档位、
                        同字号、同基线的黑字（只去掉字色与投影）。Web 端 AmountSheen 自身不渲染 */}
                    {!balanceHidden && (
                      <AmountSheen
                        text={heroAmountFull}
                        fontSize={heroSizes.int}
                        maskElement={heroAmountMask}
                        palette={heroSheenPalette}
                        sheen={heroSheen}
                      />
                    )}
                  </View>
                )
              )}
              {/* 预算面板（T08 / H3）：去掉「浅紫→青」无语义渐变与 GlassLift 多层描边堆叠，
                  改为「一层中性洗底 + 6pt 圆头单色条」——条色按状态：<80% 白 / 80–100% warning /
                  >100% danger；文案「已用 x / y · 剩余 z」是 wrap 行（放不下自动换行，不缩字不省略）；
                  整块点按仍调起原有预算编辑弹窗；未设预算时的空态行保留 */}
              <PressableScale onPress={openBudgetModal} activeScale={0.98} style={styles.budgetPanel}>
                {totalBudget > 0 ? (
                  <>
                    <AppText variant="footnote" color={colors.netWorthLabel} numberOfLines={1}>
                      {t('home.budgetLabel')} ({budgetPctText}%)
                    </AppText>
                    <View style={styles.budgetLine}>
                      <AppText variant="footnote" color={colors.netWorthLabel}>
                        {t('home.budgetUsed')}
                      </AppText>
                      <MoneyText value={thisExpense} variant="footnote" color={colors.netWorthValue} hidden={balanceHidden} />
                      <AppText variant="footnote" color={colors.netWorthHint}>
                        {' / '}
                      </AppText>
                      <MoneyText value={totalBudget} variant="footnote" color={colors.netWorthLabel} hidden={balanceHidden} />
                      <AppText variant="footnote" color={colors.netWorthHint}>
                        {' · '}
                      </AppText>
                      <AppText variant="footnote" color={colors.netWorthLabel}>
                        {budgetOver ? t('home.budgetOverLabel') : t('home.budgetLeftLabel')}
                      </AppText>
                      <MoneyText
                        value={budgetOver ? thisExpense - totalBudget : totalBudget - thisExpense}
                        variant="footnote"
                        color={budgetOver ? semantic.danger : colors.netWorthValue}
                        hidden={balanceHidden}
                      />
                    </View>
                    <View style={styles.budgetTrack}>
                      <Reanimated.View
                        style={[styles.budgetFill, { backgroundColor: budgetBarColor }, budgetFillAnimStyle]}
                      />
                    </View>
                  </>
                ) : (
                  <View style={styles.budgetCardEmptyRow}>
                    <Ionicons name="add" size={16} color={colors.netWorthValue} />
                    <AppText variant="subhead" color={colors.netWorthLabel}>
                      {t('home.setBudget')}
                    </AppText>
                  </View>
                )}
              </PressableScale>
            </LinearGradient>
          </HeroCardShadow>
        </Reanimated.View>
        {/* 日历视图卡（只在日历模式渲染，与旧行为一致——切回详情即卸载）；
            卡面 = 标准 Card（surface 底 + radius.lg + level1）—— 日期格的「常驻卡色」圆环
            靠它与 surface 同色才隐形（T12 交接事项） */}
        {viewMode === 'calendar' && (
          <Reanimated.View entering={FadeInDown.duration(240)}>
            <View style={styles.calendarWrap}>
              <Card>
                <MonthCalendarCard
                  year={viewMonth.year}
                  month={viewMonth.month}
                  days={calendarDays}
                  monthExpense={calendarMonthTotals.expense}
                  monthIncome={calendarMonthTotals.income}
                  onPrevMonth={() => shiftCalendarMonth(-1)}
                  onNextMonth={() => shiftCalendarMonth(1)}
                />
              </Card>
            </View>
          </Reanimated.View>
        )}
          </>
        }
      />
      {/* ── T09 / H4：旧的「每天一张卡」账单块已删除 —— 行与吸顶日期头改由 SectionList 渲染
          （renderTxRow / renderDayHeader 在组件体内，样式见 txRowFlash / dayHeaderWrap 等）── */}

      {/* 吸顶日期头（自绘，见 pinnedSection 的注释）：钉在列表视口顶部，与内容里的日期头同款；
          Hero 还占着顶部（首项是 Hero）时不显示 —— 只覆盖列表，不盖弹层（zIndex 低于弹层） */}
      {Platform.OS === 'web' && heroPassed && pinnedSection && (
        <View style={styles.pinnedHeader} pointerEvents="none" testID="home-pinned-header">
          {renderDayHeader({ section: pinnedSection })}
        </View>
      )}

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
      {currencyMenuOpen && (
        <View style={StyleSheet.absoluteFill}>
          <Reanimated.View
            entering={FadeIn.duration(motion.timing.fade)}
            exiting={FadeOut.duration(motion.timing.fade)}
            style={StyleSheet.absoluteFill}
          >
            <TouchableOpacity style={styles.currencyMenuOverlay} activeOpacity={1} onPress={() => setCurrencyMenuOpen(false)}>
              <View />
            </TouchableOpacity>
          </Reanimated.View>
          <Reanimated.View
            entering={FadeInDown.duration(motion.spring.default.duration)}
            exiting={FadeOutUp.duration(motion.timing.fade)}
            style={[styles.currencyMenuPanel, { top: currencyMenuRect?.top ?? 160, maxHeight: Math.round(layoutTokens.height * 0.6) }]}
          >
            <AppText variant="footnote" color={semantic.textSecondary} style={styles.currencyMenuTitle} numberOfLines={1}>
              {t('home.currencyMenuTitle')}
            </AppText>
            <ScrollView style={styles.currencyMenuScroll} showsVerticalScrollIndicator={false}>
              {totalsByCurrency.map(([code]) => {
                const active = code === displayTotal?.[0];
                const option = CURRENCY_OPTIONS.find((c) => c.code === code);
                const zhName = option?.name ?? code;
                const enName = getEnglishCurrencyName(code) ?? zhName;
                const isZh = homeLang !== 'en';
                const name = isZh ? zhName : enName;
                return (
                  <PressableScale
                    key={code}
                    style={[styles.currencyMenuItem, active && styles.currencyMenuItemActive]}
                    activeScale={0.98}
                    onPress={() => {
                      setNetWorthCurrency(code);
                      setCurrencyMenuOpen(false);
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
                    {active && <Ionicons name="checkmark" size={20} color={semantic.accent} />}
                  </PressableScale>
                );
              })}
            </ScrollView>
          </Reanimated.View>
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
    </>
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

function makeStyles(
  colors: ThemeColors,
  isDark: boolean,
  semantic: SemanticColors,
  spacing: Spacing,
  radius: Radius,
  layout: Layout,
  elevation: Elevation
) {
  // 日间玻璃卡上的文字紫色投影（曲面玻璃质感配套；夜间底深白字，投影反而脏，不加）——
  // 与渲染期共用同一份（heroTextShadowStyle），避免两处漂移
  const dayTextShadow = heroTextShadowStyle(isDark);
  return StyleSheet.create({
    container: { flex: 1 },
    // 头部一行（T08 / H1 定版）：三槽布局——左铃铛 / 中账本胶囊 / 右日历·列表切换，
    // 三件同一材质（半透明白底 homeGlassFillTop，渲染期给）；marginHorizontal -6 → 控件贴卡内 14px
    headerRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: -6, marginTop: 4, marginBottom: 10 },
    headerSide: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    headerSideRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
    // Hero 卡上控件（IconButton）：半透明白底 + 圆角方（图标方块同族 radius.md）
    heroCtlBtn: { backgroundColor: colors.homeGlassFillTop, borderRadius: radius.md },
    // 铃铛的红点定位锚（IconButton 不吃 children，红点单独叠在包装层上）
    heroCtlWrap: { position: 'relative' },
    // 账本胶囊（文字 + 箭头）：胶囊形 + 同一半透明白底；文字可被挤窄（金额/操作永不被挤）
    heroCtlPill: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.xs,
      minHeight: 40,
      maxWidth: 200,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.full,
      flexShrink: 1,
    },
    ledgerPillText: { flexShrink: 1 },
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
    // 外层只负责投影 + 定位，圆角保持跟内层一致，方便阴影贴合渐变卡片的形状。
    // 2026-10-06 晚·全出血（按第二版目标图）：卡面通顶连屏——外边距全撤（贴屏幕顶/左右边），
    // 四角圆角保留（顶部圆角处露出页底）、投影主要落在卡底；
    // 2026-10-07 批次6 按拍板「Hero 卡更浮」：影加深加远（0.16/r20/y10/ele5 → 0.22/r26/y13/ele8）
    // ⚠ 2026-10-07 晚：曾试 −22 出血把侧圆角推出屏幕——但那同时把**底部**圆角弧也推出去了
    // （用户实测「圆角没了」，已回退）。恢复 0：四角圆角全保留（贴边的四个角各露一点页底，属原定版形态）
    assetCardShadow: {
      marginHorizontal: 0,
      marginTop: 0,
      borderRadius: 20,
      shadowColor: '#1B1040',
      shadowOffset: { width: 0, height: 13 },
      shadowOpacity: 0.22,
      shadowRadius: 26,
      elevation: 8,
    },
    // 主角卡：渐变面 + 半透明白描边（比 cardBorder 更像"受光边缘"）
    // 上下留白压缩：paddingVertical 14→6（2026-09-24 用户两轮压缩定版）；
    // 全出血后 paddingTop 由 JSX 动态给 insets.top+14（内容让开状态栏，卡面仍通顶）
    // 2026-10-08 按用户指示：加 overflow hidden —— 给金属扫光层做圆角裁切（扫光不溢出卡缘）；
    // 卡下呼吸辉光是 assetCardShadow 的兄弟节点、不在本层内，不会被裁
    assetCard: {
      borderRadius: 20,
      paddingHorizontal: 20,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.12)',
      overflow: 'hidden',
    },
    // 吸顶日期头（自绘）：钉在列表视口顶部（浮层允许绝对定位）；底色不透明才能盖住滚过去的行
    pinnedHeader: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 5,
      backgroundColor: semantic.bg,
    },
    // ── 账单列表（T09 / H4）：旧的「每天一张卡」样式已删除，改为「吸顶日期头 + 行间发丝线」──
    // 吸顶块：月份分隔行 + 日期头；底色 = 页面底（吸顶时正好盖住下面的行，不透明才不穿透）
    dayHeaderWrap: { backgroundColor: semantic.bg },
    // 跨月月份分隔（只在当月第一次出现时渲染）：caption（12pt，≥ 令牌最小档）
    monthSepText: {
      paddingHorizontal: layout.page,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },
    dayHeaderRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      columnGap: spacing.sm,
      minHeight: 40,
      paddingHorizontal: layout.page,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: semantic.hairline,
    },
    // 日期标签（今天 / 昨天 / 10月7日 周三）：可被挤窄，合计整块不被挤
    dayHeaderDate: { flexShrink: 1 },
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
    // 行间分割线（与 ListSection 的分割线同款：左右缩进 = 卡内边距）
    txSeparator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: semantic.hairline,
      marginHorizontal: layout.card,
    },
    // T09 / H8：从记一笔返回后新增行闪一下（500ms 淡紫底）
    txRowFlash: { backgroundColor: semantic.accentSoft },
    // 无账单空状态（EmptyState 自带内边距，这里只补与头部的间距）
    listEmpty: { paddingTop: spacing.lg },
    // 净资产标题行（T08 / H2）：标签左、眼睛 + ⇅ 右；图标组右缘 -6 与头部控件右缘对齐（卡内 14px）
    assetCardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    heroIconRow: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.xs, marginRight: -6 },
    // 金额行外层：整卡内容宽（onLayout 实测喂字号档位；货币下拉面板与卡同宽）
    heroAmountWrap: { position: 'relative', alignSelf: 'stretch' },
    heroAmountPress: { alignSelf: 'flex-start' },
    // 三段同排：基线对齐（不同字号共用一条基线，整数与「RM / 小数」不会错位）
    heroAmountRow: { flexDirection: 'row', alignItems: 'baseline' },
    // Hero 无账户空状态：EmptyState 组件自带内边距，这里只补卡内上下留白
    heroEmpty: { paddingVertical: spacing.lg },
    // 预算面板（T08 / H3）：一层中性洗底（hairline = 浅一档的中性色，日夜都成立）——
    // 不再有 GlassLift 的多层描边 / 渐变 / 投影；内容直接排在卡上
    budgetPanel: {
      marginTop: spacing.lg,
      marginBottom: spacing.lg,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: semantic.hairline,
    },
    // 文案行：wrap + rowGap/columnGap —— 放不下自动换行（纯样式，不用测量、不缩字、不省略）
    budgetLine: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
      columnGap: spacing.xs,
      rowGap: 2,
      marginTop: spacing.xs,
    },
    // 进度条：6pt 圆头单色条（无渐变）；轨道 = 暗面 shade token，保证白色进度在日夜都有对比
    budgetTrack: {
      height: 6,
      borderRadius: radius.full,
      backgroundColor: colors.glassEdgeShade,
      overflow: 'hidden',
      marginTop: spacing.sm,
    },
    budgetFill: { height: '100%', borderRadius: radius.full },
    budgetCardEmptyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      columnGap: spacing.sm,
      minHeight: 28,
    },
    // 货币下拉（T08 退回定版）：全 App 唯一遮罩色 + 不透明浮层底（surfaceElevated）+ level2 阴影
    currencyMenuOverlay: { flex: 1, backgroundColor: semantic.scrim },
    currencyMenuPanel: {
      position: 'absolute',
      left: layout.page,
      right: layout.page,
      borderRadius: radius.lg,
      backgroundColor: semantic.surfaceElevated,
      ...elevation.level2,
      // 夜间 level2 是纯阴影，补发丝描边撑轮廓（与 ui/Card 同一条规矩）
      borderWidth: isDark ? StyleSheet.hairlineWidth : 0,
      borderColor: semantic.hairline,
      overflow: 'hidden',
      paddingBottom: spacing.xs,
    },
    currencyMenuTitle: {
      paddingHorizontal: layout.card,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: semantic.hairline,
    },
    // 行多时内部滚动；flexShrink 让它在面板 maxHeight 内收缩，不把面板顶破
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
    // 日历卡外层：页面左右边距 + 与 Hero 卡的间距（卡面本身交给 ui/Card）
    calendarWrap: { paddingHorizontal: layout.page, paddingTop: spacing.md },
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
