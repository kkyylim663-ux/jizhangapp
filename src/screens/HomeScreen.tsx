import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import {View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, TextInput, Animated, Dimensions, Easing, Pressable, Keyboard } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
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
import { useThemeMode } from '../context/ThemeModeContext';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler, useTabBarForceHide } from '../context/TabBarAutoHideContext';
import { ThemeColors, lightColors, darkColors } from '../theme/theme';
import { UNCATEGORIZED_ICON, UNCATEGORIZED_NAME, UNCATEGORIZED_COLOR } from '../constants/uncategorized';
import PressableScale from '../components/PressableScale';
import { AmountSheen, HeroCardSheen, HeroEdgeSheen, useHeroSheen } from '../components/HeroMetalSheen';
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

// 日期头部合计的排布阈值：任一天支出/收入 ≥10 万，整页头部才切上下排；以下一律左右排
const HEADER_STACK_THRESHOLD = 100000;

type IconName = keyof typeof Ionicons.glyphMap;

function formatMoney(n: number) {
  return n.toFixed(2);
}

// 净资产大金额字号：不用原生 adjustsFontSizeToFit——它在 Android 弹性容器里宽度测量失准，
// 会把正常数值偶发缩成蚂蚁字（日头部合计已因同一原因撤掉该属性，见下方注释）。
// 这里纯 JS 按字符估宽：金额串只有 0-9/./-，宽度近似均匀；装不下才逐级缩，下限 13
// （等效原 minimumFontScale 0.35 的承诺：14 位整数大额实算约 31 号仍完整显示）。
// 系数偏保守（0.58em/数字 + floor + 2px 余量）：宁可略缩不溢出，极端超长由省略号兜底。
function fitAmountFontSize(text: string, availW: number, base = 36, min = 13) {
  if (availW <= 0) return base;
  let em = 0;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') em += 0.58;
    else if (ch === '.' || ch === ',') em += 0.3;
    else em += 0.38; // 负号等
  }
  if (em <= 0) return base;
  return Math.max(min, Math.min(base, Math.floor((availW - 2) / em)));
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

// ── 变形图标切换（用户定版 2026-10-06）：值变化时旧内容「上翻淡出」、新内容「下翻淡入」。
// 出/入共用同一插值映射（隐藏态 = rotateX -85° + 缩到 0.72 + 透明），两相位只是播放方向相反；
// 单值动画 + 中点定时器换内容，纯 Animated 原生驱动，零新依赖。
function MorphSwap({ valueKey, children }: { valueKey: string; children: React.ReactNode }) {
  const morph = useRef(new Animated.Value(1)).current;
  const [shown, setShown] = useState<{ key: string; node: React.ReactNode }>({ key: valueKey, node: children });
  useEffect(() => {
    if (shown.key === valueKey) return;
    Animated.sequence([
      Animated.timing(morph, { toValue: 0, duration: 130, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(morph, { toValue: 1, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
    const timer = setTimeout(() => setShown({ key: valueKey, node: children }), 132);
    return () => clearTimeout(timer);
    // shown 只在动画中点由定时器推进；valueKey 变化才触发新一轮
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueKey]);
  return (
    <Animated.View
      style={{
        opacity: morph,
        transform: [
          { perspective: 300 },
          { rotateX: morph.interpolate({ inputRange: [0, 1], outputRange: ['-85deg', '0deg'] }) },
          { scale: morph.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) },
        ],
      }}
    >
      {/* 2026-10-08·修正 17（用户定位 + 处方）：shown.node 是快照，只有 valueKey 变化才更新——
          valueKey 与主题无关的图标（中/日历/眼睛）会冻结在旧主题的颜色（夜间淡紫残留到日间）。
          稳态（key 相等）时渲染实时 children，让主题色即时生效；换形动画中点（key 不等）仍用快照，
          动画逻辑、valueKey、图标取色一律未动 */}
      {shown.key === valueKey ? children : shown.node}
    </Animated.View>
  );
}

// ── 金属反光带（用户定版 2026-10-06）：一条斜向高光带在宿主表面缓慢扫过（全局 8s 循环）。
// phase 为共享循环值——多个宿主共用一个驱动循环，位移按宿主实测宽度映射（onLayout）；
// 宿主需 overflow:hidden 裁边；滚动/弹层打开时由外层暂停循环，省电。
function MetalSheen({ phase, tint }: { phase: Animated.Value; tint: string }) {
  const [w, setW] = useState(0);
  const translateX = useMemo(
    () => phase.interpolate({ inputRange: [0, 1], outputRange: [-0.8 * w, w * 1.3] }),
    [phase, w]
  );
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        const nw = e.nativeEvent.layout.width;
        setW((prev) => (Math.abs(prev - nw) > 0.5 ? nw : prev));
      }}
    >
      {w > 0 && (
        <Animated.View
          style={{
            position: 'absolute',
            top: -12,
            bottom: -12,
            left: 0,
            width: Math.max(70, w * 0.5),
            transform: [{ translateX }, { rotate: '18deg' }],
          }}
        >
          <LinearGradient
            colors={['transparent', tint, 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      )}
    </View>
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
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
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

  // ── 日夜切换：圆心扩散换肤（用户定版 2026-10-06）──
  // 以主题钮圆心为原点，新主题背景渐变的圆形从按钮尺寸扩到盖满全屏；扩张完成那一帧才真正
  // 切换主题、再撤掉遮罩——整屏已被新底色盖住，切换无闪变；日→夜 / 夜→日双向。
  // 遮罩渲染在 SafeAreaView 之外（可盖到状态栏区域），measureInWindow 的窗口坐标直接可用。
  const themeBtnRef = useRef<View>(null);
  const themeSwitchingRef = useRef(false);
  const revealProgress = useRef(new Animated.Value(0)).current;
  const [themeReveal, setThemeReveal] = useState<{
    cx: number;
    cy: number;
    startR: number;
    scale: number;
    target: 'light' | 'dark';
  } | null>(null);
  const startThemeReveal = () => {
    if (themeSwitchingRef.current) return;
    hapticLight();
    const target: 'light' | 'dark' = isDark ? 'light' : 'dark';
    themeBtnRef.current?.measureInWindow((bx, by, bw, bh) => {
      const cx = bx + bw / 2;
      const cy = by + bh / 2;
      const { width: sw, height: sh } = Dimensions.get('window');
      // 扩张距离 = 圆心到最远屏角；起点圆 = 按钮本身大小
      const cover = Math.hypot(Math.max(cx, sw - cx), Math.max(cy, sh - cy));
      const startR = Math.max(bw, bh) / 2 || 18;
      themeSwitchingRef.current = true;
      revealProgress.setValue(0);
      setThemeReveal({ cx, cy, startR, scale: cover / startR + 0.2, target });
      Animated.timing(revealProgress, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        setThemeMode(target);
        // 下一帧再撤遮罩：此刻新主题已生效，遮罩色与页底一致，撤下无痕
        requestAnimationFrame(() => {
          setThemeReveal(null);
          themeSwitchingRef.current = false;
        });
      });
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
  // 金额行实测宽（Δ>0.5 才更新）：喂 fitAmountFontSize 算净资产大金额字号，
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
  // ⇅ 钮点按「上下反转」：rotateX 0→180°，到顶点瞬时归零——swap-vertical 图标上下对称，
  // 翻完视觉与起点一致，每次点按都能重播；spring 手感沿用全 App 弹簧档
  const currencyFlip = useRef(new Animated.Value(0)).current;
  const flipAndOpenCurrencyMenu = () => {
    hapticLight();
    Animated.spring(currencyFlip, { toValue: 1, friction: 6, tension: 120, useNativeDriver: true }).start(({ finished }) => {
      if (finished) currencyFlip.setValue(0);
    });
    openCurrencyMenu();
  };
  const displayTotal =
    totalsByCurrency.find(([c]) => c === (netWorthCurrency ?? defaultNetWorthCurrency)) ?? totalsByCurrency[0];
  // Hero 金额文本 + 字号（2026-10-08）：可见 Text 与「笔画内流光」的 MaskedView 遮罩共用同一份
  // 串与字号 —— 两层字形逐像素对齐；隐藏态（'***'）不渲染流光层
  const heroAmountText = displayTotal ? (balanceHidden ? '***' : formatMoney(displayTotal[1])) : '';
  const heroAmountFontSize = fitAmountFontSize(heroAmountText || '0.00', amountRowW);
  // 金额变化 → 自动扫光一次（首帧与「进首页触发的扫光」重复，用 ref 跳过；隐藏态不扫）
  const sheenSkippedFirstAmountRef = useRef(true);
  useEffect(() => {
    if (!heroAmountText || heroAmountText === '***') return;
    if (sheenSkippedFirstAmountRef.current) {
      sheenSkippedFirstAmountRef.current = false;
      return;
    }
    sweepHeroSheen();
  }, [heroAmountText, sweepHeroSheen]);
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
            : `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} 周${wd}`;
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
  // 进度头高光色（2026-10-07 晚·接缝修复：高光带左缘改柔化融入，色值在此单点取值）
  const budgetHeadTint = budgetOver ? colors.budgetFillHeadOver : colors.budgetFillHead;

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
  // 未封顶百分比（独立预算卡标题用）：超支时显示真实值（如 130%），进度条宽度仍封顶 100
  const budgetPctText = totalBudget > 0 ? Math.round((thisExpense / totalBudget) * 100) : 0;

  // 未读消息数（用户定版 2026-10-06：铃铛=有消息才出现的条件整钮）。
  // 当前 App 还没有消息系统 → 恒 0（铃铛不渲染）；消息系统接入后把这里接到真实未读数即可
  const unreadCount: number = 0;

  // ── 缓慢动效总驱动（用户定版 2026-10-06：金属反光 8s 缓慢扫过 + 卡下辉光 4s 缓慢呼吸）──
  // 滚动/弹层打开时暂停（onScroll 记时间戳，静止 ~1.1s 恢复）——省电，也避免"边滚边闪"。
  // 所有宿主共用这两个循环值（原生驱动），JS 侧零逐帧负担。
  const lastScrollAt = useRef(Date.now());
  const [motionOn, setMotionOn] = useState(true);
  const sheenPhase = useRef(new Animated.Value(0)).current;
  const glowPhase = useRef(new Animated.Value(0)).current;
  const sheenLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const glowLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const anyOverlayOpen = ledgerPickerOpen || currencyMenuOpen || budgetModalOpen || pinSheetOpen;
  useEffect(() => {
    const id = setInterval(() => {
      setMotionOn(!anyOverlayOpen && Date.now() - lastScrollAt.current > 1100);
    }, 400);
    return () => clearInterval(id);
  }, [anyOverlayOpen]);
  useEffect(() => {
    if (motionOn) {
      sheenLoopRef.current = Animated.loop(
        Animated.timing(sheenPhase, { toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: true })
      );
      glowLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(glowPhase, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(glowPhase, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ])
      );
      sheenLoopRef.current.start();
      glowLoopRef.current.start();
    } else {
      sheenLoopRef.current?.stop();
      glowLoopRef.current?.stop();
      sheenLoopRef.current = null;
      glowLoopRef.current = null;
    }
    return () => {
      sheenLoopRef.current?.stop();
      glowLoopRef.current?.stop();
    };
  }, [motionOn, sheenPhase, glowPhase]);
  // 滚动时间戳（顺带透传给 Tab 栏自动隐藏处理器：滚动期间缓动暂停）
  const handleHomeScroll = useCallback(
    (e: any) => {
      lastScrollAt.current = Date.now();
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
      {/* 底部悬空区由 App.tsx 的 TabShell 统一预留（96+安全区），这里只留一点呼吸感 */}
      {/* RNW 的 ScrollView 会占用内容容器的 onLayout（转成 onContentSizeChange），
          所以高度测量放在外层普通 View 上，原生/web 都可靠 */}
      <View style={{ flex: 1 }} onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}>
      <ScrollView
        ref={scrollRef}
        onScroll={handleHomeScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: tabClearance, minHeight: viewportH ? viewportH + 130 : undefined }}
      >
        {/* 净资产 —— 全屏唯一的主角卡：渐变只留给它，正文卡片一律扁平 */}
        <Reanimated.View entering={CARD_ENTER[0]}>
          <View style={styles.assetCardShadow}>
            {/* 卡下呼吸辉光（2026-10-07 批次6 按用户拍板「Hero 卡下方要有辉光呼吸感」）：复用现成
                CardUnderGlow（4s 呼吸相位）；色=homeHeroUnderGlow（按目标图卡下辉光带取样）；
                放第一子位=绘制在卡面之下、绝对定位伸出卡底 */}
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
                  {/* 铃铛常显（2026-10-07 批次2：撤掉 unreadCount>0 整钮条件；红点条件位保留——
                      当前无消息系统 → 红点不显示=预期）；托=立体毛玻璃托（GlassLift，按目标图取样）。
                      2026-10-07 晚·用户「铃铛是方形圆角」：目标图铃铛托是 36 圆角方（圆角/边长≈0.43，
                      不是正圆 radius18）→ radius 15；图标按目标图比例（图标墨高/托边长≈0.36）缩到 15 */}
                  <PressableScale
                    onPress={() => dialog.alert({ title: t('home.notificationTitle'), message: t('home.notificationMsg') })}
                    style={styles.headerIconBtnLeft}
                    activeScale={0.88}
                    hitSlop={{ top: 8, bottom: 8, left: -4, right: 8 }}
                  >
                    <GlassLift isDark={isDark} radius={15} palette={glassPalette} style={styles.headerBellLift}>
                      <Ionicons name="notifications-outline" size={15} color={colors.homeIconColor} />
                      {unreadCount > 0 && (
                        <View style={styles.notifBadge}>
                          <Text style={styles.notifBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                        </View>
                      )}
                    </GlassLift>
                  </PressableScale>
                </View>
                {/* 选择账本按钮：保持素净（纯文字+箭头，用户定版 2026-10-06 不加身份标识）；
                    2026-10-07 批次3：材质升级 GlassLift 立体毛玻璃；
                    2026-10-07 第 5 轮·用户「顶部的变成一样的圆角方框」：radius 19（近全圆胶囊）
                    → 15，与铃铛同值（圆角/边长≈0.42）= 顶部三件同一套圆角方框 */}
                <PressableScale onPress={() => setLedgerPickerOpen(true)} activeScale={0.92}>
                  <GlassLift isDark={isDark} radius={15} palette={glassPalette} style={styles.headerLedgerBtnLift}>
                    <Text style={styles.headerTitle} numberOfLines={1}>
                      {activeLedger?.name ?? t('home.ledgerName')}
                    </Text>
                    <Ionicons name="chevron-down" size={15} color={colors.homeIconColor} style={{ marginLeft: 5 }} />
                  </GlassLift>
                </PressableScale>
                <View style={styles.headerSideRight}>
                  {/* 三合一胶囊（用户定版 2026-10-06）：中/EN · 月/日 · 日历，三段之间 1px 半透明竖线；
                      每段点按各管各的（语言/日夜/视图）——日夜段触发圆心扩散换肤；图标切换走变形动画；
                      2026-10-07 批次3：材质升级 GlassLift 立体毛玻璃；
                      2026-10-07 第 5 轮：radius 18（近全圆胶囊）→ 15，与铃铛/账本按钮同一套圆角方 */}
                  <GlassLift isDark={isDark} radius={15} palette={glassPalette} style={styles.headerCapsuleLift}>
                    {/* 金属扫光按用户 2026-10-07 指示拿掉（「三合一胶囊的光线扫过也要拿掉」）；
                        MetalSheen 组件与 sheenPhase 相位保留可恢复（同 AURORA 先例） */}
                    <PressableScale
                      onPress={() => {
                        hapticLight();
                        const isZh = i18n.locale.startsWith('zh');
                        setLangMode(isZh ? 'en' : 'zh');
                      }}
                      style={styles.capsuleSeg}
                      activeScale={0.88}
                      hitSlop={{ top: 8, bottom: 8 }}
                    >
                      <MorphSwap valueKey={i18n.locale.startsWith('zh') ? 'zh' : 'en'}>
                        <Text style={styles.capsuleLangText}>{i18n.locale.startsWith('zh') ? '中' : 'EN'}</Text>
                      </MorphSwap>
                    </PressableScale>
                    <View style={styles.capsuleDivider} />
                    <PressableScale onPress={startThemeReveal} style={styles.capsuleSeg} activeScale={0.88} hitSlop={{ top: 8, bottom: 8 }}>
                      <View ref={themeBtnRef} collapsable={false} style={styles.capsuleIconWrap}>
                        <MorphSwap valueKey={isDark ? 'dark' : 'light'}>
                          <Ionicons name={isDark ? 'moon' : 'sunny'} size={19} color={colors.homeIconColor} />
                        </MorphSwap>
                      </View>
                    </PressableScale>
                    <View style={styles.capsuleDivider} />
                    <PressableScale
                      onPress={() => {
                        hapticLight();
                        setViewMode((m) => (m === 'detail' ? 'calendar' : 'detail'));
                        // 切到日历（卡片矮）或切回详情（列表长）时滚回顶部，
                        // 避免长列表滚动位置残留导致切换后看不到卡片头部
                        scrollRef.current?.scrollTo({ y: 0, animated: false });
                      }}
                      style={styles.capsuleSeg}
                      activeScale={0.88}
                      hitSlop={{ top: 8, bottom: 8 }}
                    >
                      <View style={styles.capsuleIconWrap}>
                        <MorphSwap valueKey={viewMode}>
                          <Ionicons name={viewMode === 'detail' ? 'calendar-outline' : 'list-outline'} size={19} color={colors.homeIconColor} />
                        </MorphSwap>
                      </View>
                    </PressableScale>
                  </GlassLift>
                </View>
              </View>
              {/* 行1:净资产 + 右侧「眼睛 + ⇅」圆角方玻璃小钮组（2026-10-06 按交互视频定版：
                  眼睛从币种行上移到标题行；⇅=货币切换钮，点按上下翻转并打开货币下拉） */}
              <View style={styles.assetCardTopRow}>
                <Text style={styles.assetCardLabel}>{t('home.netWorth')}</Text>
                <View style={styles.heroGlassBtnRow}>
                  {displayTotal && (
                    <PressableScale
                      onPress={toggleBalanceHidden}
                      activeScale={0.88}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 2 }}
                    >
                      <GlassLift isDark={isDark} radius={11} palette={glassPalette} style={styles.heroGlassBtnLift}>
                        <MorphSwap valueKey={balanceHidden ? 'hidden' : 'shown'}>
                          <Ionicons
                            name={balanceHidden ? 'eye-off-outline' : 'eye-outline'}
                            size={19}
                            color={colors.homeIconColor}
                          />
                        </MorphSwap>
                      </GlassLift>
                    </PressableScale>
                  )}
                  {totalsByCurrency.length > 1 && (
                    <PressableScale
                      onPress={flipAndOpenCurrencyMenu}
                      activeScale={0.88}
                      hitSlop={{ top: 6, bottom: 6, left: 2, right: 6 }}
                    >
                      {/* ref 留在外层 View：GlassLift 不转发 ref，货币下拉的窗口坐标锚点测量沿用它 */}
                      <View ref={currencySwapRef} collapsable={false}>
                        <GlassLift isDark={isDark} radius={11} palette={glassPalette} style={styles.heroGlassBtnLift}>
                          <Animated.View
                            style={{
                              transform: [
                                { perspective: 320 },
                                { rotateX: currencyFlip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) },
                              ],
                            }}
                          >
                            <Ionicons name="swap-vertical" size={19} color={colors.homeIconColor} />
                          </Animated.View>
                        </GlassLift>
                      </View>
                    </PressableScale>
                  )}
                </View>
              </View>
              {totalsByCurrency.length === 0 ? (
                <View style={styles.assetCardEmptyWrap}>
                  <Text style={styles.assetCardEmptyTitle}>{t('home.noAssetsTitle')}</Text>
                  <Text style={styles.assetCardEmptyHint}>{t('home.noAssetsHint')}</Text>
                </View>
              ) : (
                /* 行2:币种代码（眼睛已上移到标题行，2026-10-06）；行3:金额行(点击=调出货币下拉) */
                displayTotal && (
                  <View style={styles.assetValueCol}>
                    <View style={styles.assetCardCurrencyRow}>
                      <Text style={styles.assetCardCode}>{displayTotal[0]}</Text>
                    </View>
                    <TouchableOpacity
                      ref={valueRowRef}
                      disabled={totalsByCurrency.length <= 1}
                      onPress={openCurrencyMenu}
                      style={styles.assetCardValueRow}
                      onLayout={(e) => {
                        const w = e.nativeEvent.layout.width;
                        setAmountRowW((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
                      }}
                    >
                      {/* 字号=fitAmountFontSize 纯 JS 估算（行宽实测 + 字符估宽），不用原生
                          adjustsFontSizeToFit——Android 弹性容器里它宽度测量失准、会偶发把
                          正常数值缩成蚂蚁字（同因先例=本文件日头部合计，注释见其上方）。
                          正常位数仍是 36 号大字；14 位整数大额实算约 31 号完整显示 */}
                      {/* 2026-10-08：外层 View 收缩包裹（布局中性）→ 绝对定位的流光层以同一串金额
                          文字作遮罩（MaskedView 在 HeroMetalSheen.tsx），高光只在笔画内流动；
                          Web 端不渲染该层（masked-view 的 Web 实现不裁子层） */}
                      <View style={styles.assetCardValueWrap}>
                        <Text style={[styles.assetCardValue, { fontSize: heroAmountFontSize }]} numberOfLines={1}>
                          {heroAmountText}
                        </Text>
                        {heroAmountText !== '***' && (
                          <AmountSheen
                            text={heroAmountText}
                            fontSize={heroAmountFontSize}
                            palette={heroSheenPalette}
                            sheen={heroSheen}
                          />
                        )}
                      </View>
                    </TouchableOpacity>
                  </View>
                )
              )}
              {/* 预算面板（2026-10-06 移回 Hero 卡内；2026-10-07 批次5 材质/细节升级）：内嵌大面档
                  GlassLift 立体玻璃（左右 14px 内缩）；标题「本月预算 (82%)」实时百分比（不封顶）；
                  进度条按目标图改 3 停渐变（浅蓝紫→亮紫 55%→青）+亮青收尾高光（条上扫光已移除）；
                  剩余预算行按目标图取样提亮到 0.88 白；整块点按调起预算弹窗；未设预算时空态行保留 */}
              <View style={styles.budgetHeroPanelWrap}>
                <PressableScale onPress={openBudgetModal} activeScale={0.97}>
                  {/* 2026-10-07 晚·用户「卡片内部有直角内矩形/一深一浅两层框」→ 按用户诊断处方撤掉
                      内层叠加：金属扫光带（MetalSheen 是面板内唯一一层自带半透明白的覆盖层，
                      与外层半透明填充叠加会显出方形亮斑/色差）。静态金属亮边（描边+柔光）保留；
                      本期只保留外层一层背景。若日后要扫光回归，需改为不叠加的做法（画进外层渐变）
                      或严格按圆周裁切 + 白色透明渐变（勿用 transparent=黑透）。
                      注：进度条与三合一胶囊的扫光按用户当时指示仍保持停用 */}
                  <GlassLift isDark={isDark} radius={16} palette={glassPalettePanel} style={styles.budgetHeroPanelLift} shadowRadius={14} shadowOffsetY={6} elevation={4}>
                    {totalBudget > 0 ? (
                      <>
                        <View style={styles.budgetCardTop}>
                          <Text style={styles.budgetCardLabel} numberOfLines={1}>
                            {t('home.budgetLabel')} ({budgetPctText}%)
                          </Text>
                          <Text style={styles.budgetCardValue} numberOfLines={1}>
                            {balanceHidden ? '***' : formatMoney(thisExpense)}
                            <Text style={styles.budgetCardDim}>
                              {' / '}
                              {balanceHidden ? '***' : formatMoney(totalBudget)}
                            </Text>
                          </Text>
                        </View>
                        <View style={styles.budgetCardTrack}>
                          <Reanimated.View style={[styles.budgetCardFill, budgetFillAnimStyle]}>
                            <LinearGradient
                              colors={
                                budgetOver
                                  ? [colors.budgetFillOverFrom, colors.budgetFillOverTo]
                                  : [colors.budgetFillFrom, colors.budgetFillMid, colors.budgetFillTo]
                              }
                              locations={budgetOver ? [0, 1] : [0, 0.55, 1]}
                              start={{ x: 0, y: 0.5 }}
                              end={{ x: 1, y: 0.5 }}
                              style={StyleSheet.absoluteFill}
                            />
                            {/* 收尾高光：贴在进度头上的亮色小段（交互视频的亮青头）。
                                2026-10-07 晚·用户「两种颜色没有对齐」：原实底左缘一刀切，
                                与渐变尾端之间出现接缝（尾部过渡色 vs 高光实底对不上）→
                                改同色 8 位渐变（首停全透明）：左缘柔化融入渐变尾端，右端仍为高光，
                                圆弧由外层圆角裁出 */}
                            <LinearGradient
                              colors={[budgetHeadTint + '00', budgetHeadTint, budgetHeadTint]}
                              locations={[0, 0.55, 1]}
                              start={{ x: 0, y: 0.5 }}
                              end={{ x: 1, y: 0.5 }}
                              style={styles.budgetFillHeadCap}
                            />
                          </Reanimated.View>
                          {/* 预算进度条扫光按用户 2026-10-07 指示拿掉（「本月预算进度条的光扫过不需要」）；
                              MetalSheen 保留可恢复 */}
                        </View>
                        <Text
                          style={[styles.budgetCardStatus, { color: budgetOver ? colors.expenseOver : colors.homeHeroPanelText }]}
                          numberOfLines={1}
                        >
                          {budgetOver
                            ? t('home.budgetOver', { amount: formatMoney(thisExpense - totalBudget) })
                            : t('home.budgetLeft', { amount: formatMoney(totalBudget - thisExpense) })}
                        </Text>
                      </>
                    ) : (
                      <View style={styles.budgetCardEmptyRow}>
                        <View style={styles.budgetCardEmptyIcon}>
                          <Ionicons name="add" size={12} color={colors.homeBudgetLabel} />
                        </View>
                        <Text style={styles.budgetCardEmptyText}>{t('home.setBudget')}</Text>
                      </View>
                    )}
                  </GlassLift>
                </PressableScale>
              </View>
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
            2026-10-06 按目标图/交互视频改版：每组=独立圆角玻璃卡（组间留白），
            组头「9/26 周六」+ 右侧支出合计；行=类别图标托 +「类别 (备注)」+ 资产副标题 + 金额。
            calendar 模式仍用 display:none 整卡隐藏（保树不重挂），数据逻辑零改动 */}
        <Reanimated.View entering={CARD_ENTER[2]} style={viewMode === 'calendar' ? { display: 'none' } : undefined}>
          {dayGroups.length === 0 ? (
            <View style={styles.sectionCardShadow}>
              <View style={styles.sectionCard}>
                <View style={styles.emptyWrap}>
                  <View style={styles.emptyIconWrap}>
                    <Ionicons name="receipt-outline" size={28} color={colors.textTertiary} />
                  </View>
                  <Text style={styles.emptyText}>{t('home.noTx')}</Text>
                  <Text style={styles.emptyHint}>{t('home.noTxHint')}</Text>
                </View>
              </View>
            </View>
          ) : (
            dayGroups.map((group) => (
              <View key={group.date} style={styles.dayCardShadow}>
                {/* 卡下呼吸辉光按用户 2026-10-07 拍板撤掉（「账单日志下方不需要辉光呼吸」，辉光已改挂 Hero 卡底） */}
                <View style={styles.dayCard}>
                  {/* 顶缘柔光带（2026-10-07 批次6 微立体；2026-10-07 晚改成柔光——
                      原 1px 实心亮线在真机上是浮在卡顶的硬直线，与 GlassLift 的柔光顶缘不是一套语言；
                      通栏铺满由 dayCard 的 overflow hidden + borderRadius 裁出圆角）。
                      日卡=浅色档：日间 0.40 / 夜间 0.10 */}
                  <View pointerEvents="none" style={styles.dayCardTopEdge}>
                    <LinearGradient
                      colors={
                        isDark
                          ? ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0)']
                          : ['rgba(255,255,255,0.40)', 'rgba(255,255,255,0)']
                      }
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={{ flex: 1 }}
                    />
                  </View>
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
                    // 计划名/备注作为后半段括号拼接：类别 (计划名/备注)（2026-10-06 按目标图改括号式）
                    const catName = cat ? getCategoryLabel(cat, t) : UNCATEGORIZED_NAME;
                    const extra = item.note?.trim() || item.displayName?.trim() || '';
                    const categoryText = extra ? `${catName} (${extra})` : catName;
                    const catIcon = (cat?.icon ?? UNCATEGORIZED_ICON) as IconName;
                    const catColor = cat?.color ?? UNCATEGORIZED_COLOR;
                    const assetName = item.assetId ? getAssetById(item.assetId)?.name : undefined;
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
                        {/* 左：类别图标托（圆角方 40、类别色淡底 + 顶缘高光做"金属小托"）
                            2026-10-09 修正 22（用户：日间图标托是平的 / 夜间有立体感，要日间和夜间一样）：
                            日间改「同色系竖向渐变底（12%→28%）+ 类别色 30% 描边 + 贴顶 1.5dp 白 0.9 细亮边
                            + boxShadow 外投影」—— 白高光在白卡上完全看不见，日间只能靠"轮廓 + 受光渐变
                            + 底部投影"立起来；夜间原样不动。
                            ⚠ 2026-10-09·修正 26（用户报「切到夜间后类别图标 + 顶部高光都不见了，方块底色还在」）：
                            按用户处方把这套「边框 + 阴影 + 覆盖层」从**图标托本体**上摘干净，三条改动：
                            ① 日间外投影移到**外层包装**（`txIconTileWrap`，boxShadow 只画在托外侧）——
                               图标托本体在两种主题下都**不再切 borderWidth / boxShadow**
                               （跨主题增删边框 + 同层盒阴影 + overflow 裁切是安卓/Fabric 上
                               「子层不画、底色还在」的高危组合，本机 Fabric 边框裁切怪症史已多次）；
                            ② 日间轮廓改**托内绝对覆盖层**（`txIconTileOutline`，1px 类别色 30%），
                               几何与旧 borderWidth 一致但不吃布局、不参与主题切换的增删；
                            ③ 图标固定为**最后一个子元素 + zIndex 1**（永不被任何覆盖层压住）；
                            夜间分支 = 修正 22 之前的样子（类别色淡底 + 顶部白 30% 高光 + 类别色图标），
                            结构上不再带边框/阴影，逐像素还原 */}
                        <View
                          // 修正 26·第二道保险：跨主题强制重挂载图标托子树——
                          // 任何"原生层残留"（子层不重画/裁切路径失效）都被这一次重挂载清掉；
                          // 只在主题切换这一帧重挂，平时渲染路径零变化
                          key={isDark ? 'tile-night' : 'tile-day'}
                          style={[
                            styles.txIconTileWrap,
                            // 日间：外投影只画在托外侧（包装层无裁切、无边框；夜间此对象缺席 = 空壳）
                            !isDark && {
                              borderRadius: 12,
                              backgroundColor: 'transparent',
                              boxShadow: `0px 2px 4px ${hexToRgba(catColor, 0.18)}`,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.txIconTile,
                              isDark ? { backgroundColor: catColor + '26' } : { backgroundColor: 'transparent' },
                            ]}
                          >
                            {isDark ? (
                              <LinearGradient
                                colors={['rgba(255,255,255,0.30)', 'rgba(255,255,255,0)']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 0, y: 1 }}
                                style={styles.txIconTileSheen}
                                pointerEvents="none"
                              />
                            ) : (
                              <>
                                {/* 日间：受光面（顶 12%）→ 背光面（底 28%）的同色竖向渐变 */}
                                <LinearGradient
                                  colors={[catColor + '1F', catColor + '47']}
                                  start={{ x: 0.5, y: 0 }}
                                  end={{ x: 0.5, y: 1 }}
                                  style={StyleSheet.absoluteFill}
                                  pointerEvents="none"
                                />
                                {/* 日间：1px 类别色 30% 轮廓（绝对覆盖层，取代旧「托上 borderWidth」——
                                    覆盖层不吃布局、不随主题增删，避开 Fabric 边框/裁切怪症） */}
                                <View
                                  style={[styles.txIconTileOutline, { borderColor: catColor + '4D' }]}
                                  pointerEvents="none"
                                />
                                {/* 日间：贴顶缘的细亮边（1.5dp 白 0.9）取代原大面积白渐变 */}
                                <View style={styles.txIconTileTopLine} pointerEvents="none" />
                              </>
                            )}
                            <Ionicons name={catIcon} size={20} color={catColor} style={styles.txIconTileIcon} />
                          </View>
                        </View>
                        {/* 中：两行文本（标题+资产副标题），弹性截断把宽度让给金额 */}
                        <View style={styles.txTextCol}>
                          <Text style={[styles.billTitleText, { color: colors.textPrimary }]} numberOfLines={1}>
                            {categoryText}
                          </Text>
                          {assetName ? (
                            <Text style={styles.txSubtitle} numberOfLines={1}>{assetName}</Text>
                          ) : null}
                        </View>
                        {/* 右：金额（-/+、紫/绿不变；金额栏固定字号永不压缩，始终完整显示） */}
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
              </View>
            ))
          )}
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
      {/* 货币直选下拉（2026-10-06 按交互视频 1:1 重做）：悬浮深紫玻璃面板、四角圆角、紫调描边，
          锚在「⇅」钮下方；行结构=左侧 2 字母码 +「代码 名称」+ 语言对照名副行 + 选中紫勾。
          不突然出现：进场=轻微位移+透明度（220ms），退场平滑反向（180ms） */}
      {currencyMenuOpen && (
        <View style={StyleSheet.absoluteFill}>
          <Reanimated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
            <TouchableOpacity style={styles.currencyMenuOverlay} activeOpacity={1} onPress={() => setCurrencyMenuOpen(false)}>
              <View />
            </TouchableOpacity>
          </Reanimated.View>
          <Reanimated.View
            entering={FadeInDown.duration(220)}
            exiting={FadeOutUp.duration(180)}
            style={[styles.currencyMenuPanel, { top: currencyMenuRect?.top ?? 160 }]}
          >
            <Text style={styles.currencyMenuTitle}>{t('home.currencyMenuTitle')}</Text>
            <ScrollView style={{ maxHeight: 430 }} showsVerticalScrollIndicator={false}>
              {totalsByCurrency.map(([code]) => {
                const active = code === displayTotal?.[0];
                const option = CURRENCY_OPTIONS.find((c) => c.code === code);
                const zhName = option?.name ?? code;
                const enName = getEnglishCurrencyName(code) ?? zhName;
                const isZh = i18n.locale.toLowerCase().startsWith('zh');
                return (
                  <PressableScale
                    key={code}
                    style={styles.currencyMenuItem}
                    activeScale={0.97}
                    onPress={() => {
                      setNetWorthCurrency(code);
                      setCurrencyMenuOpen(false);
                    }}
                  >
                    <Text style={[styles.currencyMenuCodeBadge, active && { color: colors.netWorthAccent }]}>
                      {code.slice(0, 2)}
                    </Text>
                    <View style={styles.currencyMenuTextCol}>
                      <Text style={[styles.currencyMenuName, active && { color: colors.netWorthAccent }]} numberOfLines={1}>
                        {code} {isZh ? zhName : enName}
                      </Text>
                      <Text style={styles.currencyMenuSub} numberOfLines={1}>
                        {isZh ? enName : zhName}
                      </Text>
                    </View>
                    {active && <Ionicons name="checkmark" size={18} color={colors.netWorthAccent} />}
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

      {/* 日夜切换：圆心扩散遮罩（用户定版 2026-10-06）——渲染在 SafeAreaView 之外，
          可覆盖到状态栏区域；扩张完成那一帧真正切主题，下一帧撤罩（新底已就位，无闪变）；
          pointerEvents auto 吃掉 520ms 过渡期的触摸，防止连点 */}
      {themeReveal && (
        <View pointerEvents="auto" style={[StyleSheet.absoluteFill, { zIndex: 999, elevation: 60 }]}>
          <Animated.View
            style={{
              position: 'absolute',
              left: themeReveal.cx - themeReveal.startR,
              top: themeReveal.cy - themeReveal.startR,
              width: themeReveal.startR * 2,
              height: themeReveal.startR * 2,
              borderRadius: themeReveal.startR,
              overflow: 'hidden',
              transform: [{ scale: revealProgress.interpolate({ inputRange: [0, 1], outputRange: [0, themeReveal.scale] }) }],
            }}
          >
            <LinearGradient
              colors={
                themeReveal.target === 'dark'
                  ? [darkColors.bgGradientFrom, darkColors.bgGradientTo]
                  : [lightColors.bgGradientFrom, lightColors.bgGradientTo]
              }
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={{ flex: 1 }}
            />
          </Animated.View>
        </View>
      )}
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

function makeStyles(colors: ThemeColors, isDark: boolean) {
  // 日间玻璃卡上的文字紫色投影（曲面玻璃质感配套；夜间底深白字，投影反而脏，不加）
  const dayTextShadow: {
    textShadowColor?: string;
    textShadowOffset?: { width: number; height: number };
    textShadowRadius?: number;
  } = isDark
    ? {}
    : {
        textShadowColor: 'rgba(75, 0, 173, 0.7)',
        // 光由左上角往右下角照射：影子投向右下；模长 ≈1.5（与玻璃参考图的高光位同源）
        textShadowOffset: { width: 1.1, height: 1.1 },
        textShadowRadius: 4,
      };
  return StyleSheet.create({
    container: { flex: 1 },
    // 头部一行（2026-10-06 按目标图移入 Hero 卡内）：三槽布局——左铃铛(flex:1)/中账本胶囊/右胶囊(flex:1)，
    // 铃铛隐藏时中胶囊仍居中；marginHorizontal -6 → 控件贴卡内 14px（文字保持卡内 20px）
    headerRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: -6, marginTop: 4, marginBottom: 14 },
    headerSide: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    headerSideRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
    // 账本胶囊 2026-10-06 起回到中间槽位（三槽布局，居中）；headerSide 现只装左侧铃铛占位
    headerTitle: { fontSize: 17, fontWeight: '700', color: colors.homeGlassText, maxWidth: 160 },
    // 铃铛槽位占位（2026-10-06 三槽布局后账本胶囊已居中，不再需要相邻间距）
    headerIconBtnLeft: { marginRight: 0 },
    // 铃铛钮（2026-10-07 批次2 按目标图改版；晚第二轮 radius 18→15）：
    // 36×36 立体毛玻璃托（GlassLift radius15 提供圆角/渐变/描边/柔光顶缘/投影）；
    // 目标图为「方形圆角」不是正圆——圆角/边长实测 ≈0.427（110px 托 / 47px 圆角）
    // 此处只管尺寸与内容居中
    headerBellLift: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 账本名下拉（2026-10-06 按目标图；2026-10-07 批次3 材质升级；第 5 轮 radius 19→15）；
    // 保持素净不加深色点；此处只留布局（圆角/渐变/描边/柔光顶缘/投影由 GlassLift 提供）
    headerLedgerBtnLift: {
      flexDirection: 'row',
      alignItems: 'center',
      maxWidth: 190,
      paddingVertical: 8,
      paddingHorizontal: 14,
    },
    // 三合一胶囊（用户定版 2026-10-06；2026-10-07 批次3 材质升级；第 5 轮 radius 18→15）：
    // 中/EN · 月/日 · 日历三段共一枚玻璃件（高 36 圆角 15），1px 半透明竖线分隔；各段点按各管各的；
    // 金属反光带已按 2026-10-07 指示移除；此处只留布局（材质由 GlassLift 提供）
    headerCapsuleLift: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 36,
    },
    // 段高固定 34（胶囊 36 − 上下描边各 1）：PressableScale 的 style 挂内层 Animated.View、
    // 外层 Pressable 随内容自适应——百分比高度在这里会塌成内容高，导致点击区变矮
    capsuleSeg: { height: 34, minWidth: 40, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
    capsuleDivider: { width: 1, height: 18, backgroundColor: 'rgba(255,255,255,0.22)' },
    capsuleLangText: { fontSize: 13, fontWeight: '700', color: colors.homeIconColor },
    capsuleIconWrap: { alignItems: 'center', justifyContent: 'center' },
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
    assetCardLabel: { ...dayTextShadow, fontSize: 15, fontWeight: '700', letterSpacing: 0.5, color: colors.netWorthLabel, marginBottom: 4 },
    assetCardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    // hero 图标组（2026-10-06 按交互视频；2026-10-07 批次3 材质升级）：眼睛 + ⇅ 两枚 GlassLift
    // 立体毛玻璃小钮（radius 11）；右缘 -6 与头部胶囊右缘对齐（均为卡内 14px）
    heroGlassBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: -6 },
    heroGlassBtnLift: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 账单分组卡（2026-10-06）：每组独立圆角玻璃卡、组间留白；
    // 2026-10-07 批次6 按拍板：卡下呼吸辉光撤掉；投影轻加强 + 卡内顶缘柔光带（微立体）
    dayCardShadow: {
      marginHorizontal: 16,
      marginTop: 12,
      borderRadius: 18,
      // 2026-10-08·修正 16（用户：日间交易卡要恢复和夜间同等的立体感、且不能有内框）：
      // 日间改 **boxShadow**（RN Android OutsetBoxShadowDrawable 用 clipOutPath 只画卡片外侧，
      // 不会渗入卡内 → 杜绝 elevation 透半透明填充的内框问题）；偏移/模糊参照夜间观感，
      // 颜色=淡紫灰（非纯黑）。夜间保留原 elevation/shadow* 不动。
      ...(isDark
        ? {
            shadowColor: '#1B1040',
            shadowOffset: { width: 0, height: 5 },
            shadowOpacity: 0.10,
            shadowRadius: 12,
            elevation: 3,
          }
        : { boxShadow: '0px 5px 12px rgba(76,58,132,0.16)' }),
    },
    // 日卡顶缘柔光带（2026-10-07 批次6 微立体；晚第二轮按用户「硬线」反馈改柔光）：
    // 通栏 9dp 高的白→透明竖渐变，圆角由 dayCard 的 overflow hidden 裁切（所以左右不用内缩）
    dayCardTopEdge: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 9,
      overflow: 'hidden',
    },
    dayCard: {
      borderRadius: 18,
      backgroundColor: colors.homeGlassCard,
      borderWidth: 1,
      // 2026-10-08·修正 16（用户第 2 条）：日间描边改「顶/两侧白高光 + 底部极淡紫灰」的倒角
      // （浅色底上纯白线看不见，底部紫灰给出厚度感 = 与夜间一致的倒角观感）；夜间保持原 cardBorder 不动
      ...(isDark
        ? { borderColor: colors.cardBorder }
        : {
            borderTopColor: 'rgba(255,255,255,0.85)',
            borderLeftColor: 'rgba(255,255,255,0.85)',
            borderRightColor: 'rgba(255,255,255,0.85)',
            borderBottomColor: 'rgba(110,90,160,0.20)',
          }),
      overflow: 'hidden',
    },
    // 组头（2026-10-06 改为卡内通栏条）：默认左右排（10万以内）；出现大金额才切上下排。
    // 浅紫底 + 底部一条发丝线；贴卡顶与圆角由 dayCard 的 overflow hidden 裁切
    dayHeaderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 16, backgroundColor: colors.link + '0D', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.dividerHair },
    // 上下排时收紧上下留白：padding 9→5，两行合计的头部高度不至于比横排胖一倍
    dayHeaderRowStacked: { paddingVertical: 5 },
    // 英文日期标签比中文长：标题可收缩先截断，金额组保持完整
    // fontWeight '750' 不在 RN 类型白名单(仅整百),运行时按支持程度就近渲染,这里显式放宽类型
    dayHeaderText: { flex: 1, flexShrink: 1, fontSize: 13.5, fontWeight: '700', color: colors.textPrimary },
    // 合计默认左右排；上下排为支出/收入右对齐纵排——全部固定 14 号不缩字，保证高度统一
    dayHeaderTotals: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto', flexShrink: 0 },
    dayHeaderTotalsStacked: { flexDirection: 'column', alignItems: 'flex-end' },
    dayHeaderExpense: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: colors.expense, fontVariant: ['tabular-nums'] },
    dayHeaderIncome: { flexShrink: 1, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
    assetCardValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    // 大数字用负字距（大字号时字母会显得松）+ 等宽数字（金额跳动时不抖动）
    // 金额不用 tabular-nums：等宽数字会让首位"1"在字格里居中，视觉上左边缘比 MYR 缩进一点
    assetCardValue: { ...dayTextShadow, fontSize: 36, fontWeight: '700', letterSpacing: 0, color: colors.netWorthValue, textAlign: 'left' },
    // 金额 + 笔画内流光层（2026-10-08）：收缩包裹 Text（布局中性），给绝对定位的
    // MaskedView 流光层做定位锚（宿主尺寸 = 文字尺寸，遮罩与可见文字逐像素对齐）
    assetCardValueWrap: { position: 'relative' },
    // 币种代码：与眼睛并排放金额上方（参考图 CNY 👁 排列）
    assetCardCode: { ...dayTextShadow, fontSize: 18, color: colors.netWorthValue, fontWeight: '700', letterSpacing: 0.5, textAlign: 'left' },
    // 币种代码 + 眼睛开关行：并排小间距（参考图 CNY 👁）
    assetCardCurrencyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, marginBottom: -4 },
    // 币种代码 + 金额纵向排列容器：子节点拉伸到整卡内容宽（默认 stretch——金额行实测宽=卡内宽，
    // 下拉面板才能与卡片同宽；旧版 alignItems:'flex-start' 会让金额行收窄到文字宽，面板跟着变窄）
    assetValueCol: { flex: 1, flexShrink: 1, flexDirection: 'column' },
    assetCardEmptyWrap: { paddingVertical: 6 },
    assetCardEmptyTitle: { ...dayTextShadow, fontSize: 15, fontWeight: '600', color: colors.netWorthValue },
    assetCardEmptyHint: { ...dayTextShadow, fontSize: 12, color: colors.netWorthHint, marginTop: 5 },
    assetCardHint: { fontSize: 12, fontWeight: '500', color: colors.netWorthHint },
    // 预算内嵌面板（2026-10-06 移回 Hero 卡内；2026-10-07 批次5 材质升级）：GlassLift 大面档立体玻璃
    // （radius 16、更柔更远投影）；左右内缩 14px（marginHorizontal:-6 抵消卡内边距 20）；
    // 剩余预算行按目标图取样提亮 0.88 白；条上扫光已按 2026-10-07 指示移除
    budgetHeroPanelWrap: {
      marginHorizontal: -6,
      marginTop: 14,
      marginBottom: 16,
    },
    budgetHeroPanelLift: {
      padding: 12,
    },
    budgetCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    // 面板内文字（2026-10-07 第 6 轮）：homeBudget* 一套 —— 日间面板改深紫罗兰玻璃后
    // 日/夜同款白字（深玻璃上的白字），不再需要分深浅两套色
    budgetCardLabel: { flex: 1, flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.homeBudgetLabel },
    budgetCardValue: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.homeBudgetValue },
    budgetCardDim: { fontSize: 14, fontWeight: '500', color: colors.homeBudgetDim },
    // 进度条：轨道（第 6 轮）日/夜同款深轨道（面板=深玻璃）；
    // 填充=浅紫→青渐变 + 亮青收尾高光
    budgetCardTrack: { height: 7, backgroundColor: colors.homeBudgetTrack, borderRadius: 4, overflow: 'hidden' },
    budgetCardFill: { height: '100%', borderRadius: 4, overflow: 'hidden' },
    budgetFillHeadCap: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
    budgetCardStatus: { fontSize: 12.5, fontWeight: '500', marginTop: 8 },
    // 未设置预算的占位行：minHeight 校准到已设置状态预算区的内容高度，两种状态卡片总高一致
    budgetCardEmptyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 49, paddingTop: 4 },
    // 空态（第 5 轮）：同面板文字，日间改深紫（homeBudgetLabel）
    budgetCardEmptyIcon: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: colors.homeBudgetLabel, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
    budgetCardEmptyText: { fontSize: 15, fontWeight: '600', color: colors.homeBudgetLabel },
    // 货币下拉（2026-10-06 按交互视频 1:1）：悬浮玻璃面板、四角圆角、紫调描边；锚在 ⇅ 钮下方
    currencyMenuOverlay: { flex: 1, backgroundColor: 'rgba(20,15,40,0.35)' },
    currencyMenuPanel: {
      position: 'absolute',
      left: 16,
      right: 16,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.budgetFillFrom + '59',
      backgroundColor: colors.homePanelGlass,
      overflow: 'hidden',
      paddingBottom: 6,
    },
    currencyMenuTitle: {
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.5,
      color: colors.textSecondary,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.dividerHair,
    },
    // 行结构（视频同款）：左侧 2 字母码 +「代码 名称」+ 语言对照名副行 + 选中紫勾
    currencyMenuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.dividerHair,
    },
    currencyMenuCodeBadge: { width: 32, fontSize: 14, fontWeight: '700', color: colors.textPrimary, letterSpacing: 0.5 },
    currencyMenuTextCol: { flex: 1, marginRight: 8 },
    currencyMenuName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    currencyMenuSub: { fontSize: 11.5, color: colors.textTertiary, marginTop: 1 },
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
    // 账单行（2026-10-06 按目标图）：左侧类别图标托 + 两行文本（标题/资产副标题）+ 右侧金额
    todayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16, minHeight: 56 },
    // 类别图标托：40 圆角方、类别色淡底（15%，行内联拼色）；静态顶缘高光做"金属小托"
    // 2026-10-09 修正 22：日间不再用「白渐变高光」（白卡上看不见）→ 改同色竖向渐变 + 30% 类别色描边
    // + 贴顶 1.5dp 白 0.9 细亮边 + boxShadow 外投影（都是行内联拼色，因为类别色每行不同）；夜间不动
    // ⚠ 2026-10-09·修正 26：轮廓/阴影全部搬离本层（见下方三个新样式的注释）——
    //   本层在两种主题下只切 background，**永不增删 borderWidth / boxShadow**
    txIconTile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    txIconTileSheen: { position: 'absolute', left: 0, right: 0, top: 0, height: '58%' },
    // 日间外投影的承载层（修正 26）：无裁切/无边框/无内容 → boxShadow（只画托外侧）不会与
    // 图标托的 overflow 裁切同层；夜间此层等于空壳（样式对象不参与）
    txIconTileWrap: {},
    // 日间轮廓（修正 26）：1px 绝对覆盖层，几何 = 旧 borderWidth:1 的边框，但不吃布局、不随主题增删
    txIconTileOutline: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderWidth: 1, borderRadius: 12 },
    // 日间贴顶细亮边：顶/左右各内缩 1px（= 旧版"边框内"的几何，把轮廓的 1px 让开）
    txIconTileTopLine: { position: 'absolute', left: 1, right: 1, top: 1, height: 1.5, backgroundColor: 'rgba(255,255,255,0.9)' },
    // 图标（修正 26）：固定为图标托的最后一个子元素 + zIndex 1（任何覆盖层都不得压住它）
    txIconTileIcon: { zIndex: 1 },
    txTextCol: { flex: 1, marginLeft: 12, marginRight: 8 },
    // 标题：类别 (备注) 括号式；弹性截断把宽度让给金额
    billTitleText: { fontSize: 13.5, fontWeight: '600' },
    txSubtitle: { fontSize: 11.5, color: colors.textTertiary, marginTop: 2 },
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
