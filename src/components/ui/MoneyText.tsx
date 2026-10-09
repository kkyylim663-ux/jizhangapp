// MoneyText.tsx
// 全 App 唯一金额文字组件（T03 / 计划 4.4、4.5）。
//
// 职责
// - 一律经 formatMoney() 出文本（千分位 / 真减号 / 币种开关 / 紧凑格式 / 隐藏态），
//   页面里不许再出现 toFixed(2) 或手写千分位；
// - 按语义自动取色：支出 = 主文字色 + 「−」、收入 = 绿 + 「+」、转账 = 次要文字色 + 无符号；
// - 等宽数字（fontVariant ['tabular-nums']）+ 一行显示；
// - 金额永不被挤压：容器默认 flexShrink: 0；
// - 超大金额按「实际可用宽」降级：40 → 34 → 28 → 22 → 18（不做连续压缩，只按档位跳）；
// - 数字变化时逐位滚动（Reanimated 自写，不加依赖）：每位错开 30ms、600ms 缓出；
//   首次渲染（挂载）与首屏数据到位（挂载后 600ms 内的首次赋值）都不滚动。
//
// 金额永不截断、永不换行（验收 2026-10-09 退回第 2 条与返工）
//   1. 档位用**完整字符串**（含 +/− 号、币种前缀/后缀 RM、千分位、小数点）的宽度估算选，
//      取能放下的最大档；系数是 Inter 逐字符实测值（见下方 CHAR_EM 注释），
//      逐字符相加比整串实测略宽（~1.6% 字距），方向安全 —— 漏算 +RM 里的 M（0.92em）
//      就会选大一号档位、把最后一个 0 挤到第二行；
//   2. 连最小档 18 都放不下 → 退回**紧凑格式**（+RM123.5T），完整金额进 accessibilityLabel，
//      长按弹出完整金额（`compactFallback` 默认开）；
//   3. 兜底：金额 Text 恒 numberOfLines={1} + ellipsizeMode="clip"
//      —— 就算估算失灵也只是裁掉尾巴，**绝不换行、绝不出省略号**。
//
// 用法
//   <MoneyText value={tx.amount} kind="expense" variant="body" />
//   <MoneyText value={netWorth} variant="display" currency="MYR" showCurrency />
//   <MoneyText value={balance} hidden={hideAmount} />

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleProp, StyleSheet, TextStyle, View } from 'react-native';
import Animated, {
  runOnJS,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { formatMoney, FormatMoneyOptions, MINUS } from '../../utils/formatMoney';
import { TypographyVariant } from '../../theme/theme';
import { useTheme } from '../../theme/useTheme';
import { useDialogOptional } from '../AppDialog';
import AppText from './AppText';

/**
 * 降级阶梯（计划 4.2 的 40 → 34 → 28，验收再加 22 与 18 两档兜底；
 * 18 不是 typography 令牌档，是验收点名的兜底字号下限）。
 */
const SHRINK_LADDER = [40, 34, 28, 22, 18];
/** 各档的整数位上限（含）：≤9 → 阶梯[0] · ≤12 → [1] · ≤15 → [2] · 更多 → [3]（位数地板） */
const LADDER_MAX_INT_DIGITS = [9, 12, 15];
/**
 * 逐字符宽度表（em，Inter-SemiBold 100px 用 canvas measureText 实测，2026-10-09）：
 *   '0'-'9' = 0.62（等宽数字）· ',' '.' = 0.335 · '+' '−' = 0.68
 *   A-Z = 见下表（M 0.922 最宽之一、I 0.277 最窄）
 *   其余未知字符（币种符号 ¥ ₩ ฿ …）按 1.02 估（最宽字符 W 的宽度，宁可多算）。
 * ⚠ 这是「能不能放下」的判定用的估算，不参与排版 —— 排版永远交给 flex。
 */
const DIGIT_EM = 0.62;
const SEPARATOR_EM = 0.335;
const SIGN_EM = 0.68;
const UNKNOWN_EM = 1.02;
const LETTER_EM: Record<string, number> = {
  A: 0.728, B: 0.659, C: 0.737, D: 0.722, E: 0.605, F: 0.588, G: 0.749, H: 0.746,
  I: 0.277, J: 0.58, K: 0.703, L: 0.565, M: 0.922, N: 0.759, O: 0.769, P: 0.645,
  Q: 0.773, R: 0.652, S: 0.65, T: 0.66, U: 0.736, V: 0.728, W: 1.02, X: 0.72,
  Y: 0.713, Z: 0.652,
};
/** 每位错开 30ms（计划 5.10：每位错开 20–40ms） */
const STAGGER_MS = 30;
/** 最多错开 4 位；再多的位数一起滚，避免长数字滚太久 */
const STAGGER_MAX_STEPS = 4;
/** 挂载后这段时间内的首次赋值 = 首屏数据到位，不滚动（首次加载不滚动） */
const FIRST_LOAD_WINDOW_MS = 600;

export interface MoneyTextProps extends FormatMoneyOptions {
  value: number;
  /** 字号档位（默认 body） */
  variant?: TypographyVariant;
  /** 颜色覆盖（默认按 kind 取 semantic 语义色） */
  color?: string;
  /** 数字变化时逐位滚动（默认 true；挂载与首屏数据到位不滚） */
  roll?: boolean;
  /**
   * 超大金额的字号阶梯（默认：基准 ≥40 时 [40,34,28,22,18]，否则不降级）；
   * 传 null 表示永不降级。
   */
  shrinkLadder?: number[] | null;
  /** 连最小档都放不下时改用紧凑格式 + 长按看全文（默认 true；传 false 则一直用完整金额） */
  compactFallback?: boolean;
  /** 文本/布局微调（color / opacity / margin / textAlign 等；flexShrink 默认 0 = 金额不被挤压） */
  style?: StyleProp<TextStyle>;
  /** 读屏文本（默认 = 完整金额，即使屏上显示的是紧凑格式） */
  accessibilityLabel?: string;
}

/* ------------------------------------------------------- 宽度估算 / 档位 */

/** 逐字符宽度和（em，估算用；判定优先用实测，见 MeasuredLayer） */
function estimateEm(text: string): number {
  let em = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch >= '0' && ch <= '9') em += DIGIT_EM;
    else if (ch === ',' || ch === '.') em += SEPARATOR_EM;
    else if (ch === '+' || ch === MINUS) em += SIGN_EM;
    else em += LETTER_EM[ch.toUpperCase()] ?? UNKNOWN_EM;
  }
  return em;
}

/**
 * 宽度是否放得下：em 只算**字形**宽度，字距（letterSpacing）另算。
 * ⚠ 字距是固定 px（display 档 −0.8），不随字号缩放 —— 把它并进 em 里会得到
 *   「不同字号算出的 em 不一样」的假象（实测时在 18px 量、拿到 22px 去判就会误判放得下），
 *   所以这里显式拆开：宽(size) = 字形em × size + 字距 × 字符数。
 */
function fitsByEm(em: number, fontSize: number, spacingTotal: number, availableWidth: number): boolean {
  return em * fontSize + spacingTotal <= availableWidth;
}

/** 能放下的最大档位；-1 = 连最小档都放不下 */
function tierFitting(
  em: number,
  spacingTotal: number,
  ladder: number[],
  availableWidth: number
): number {
  if (availableWidth <= 0) return 0;
  for (let i = 0; i < ladder.length; i++) {
    if (fitsByEm(em, ladder[i] ?? 0, spacingTotal, availableWidth)) return i;
  }
  return -1;
}

/** 整数位个数（不含符号、千分位、小数点、币种） */
function moneyIntDigits(text: string): number {
  const dot = text.indexOf('.');
  const head = dot === -1 ? text : text.slice(0, dot);
  let n = 0;
  for (let i = 0; i < head.length; i++) {
    const ch = head[i];
    if (ch !== undefined && ch >= '0' && ch <= '9') n++;
  }
  return n;
}

/** 按整数位个数取阶梯档位（计划 4.2 的位数规则，作为地板，不单独决定最终档） */
function digitTier(intDigits: number): number {
  for (let i = 0; i < LADDER_MAX_INT_DIGITS.length; i++) {
    if (intDigits <= (LADDER_MAX_INT_DIGITS[i] ?? 0)) return i;
  }
  return LADDER_MAX_INT_DIGITS.length;
}

/* ---------------------------------------------------------------- 字符格 */

type MoneyCell = {
  /** 位置键：从右往左编号（金额变化时最低位最稳定，右边对齐不会整行错位） */
  key: string;
  char: string;
  /** 上一轮的字符：非 null 表示这格正在滚动 */
  from: string | null;
  /** 错开延迟（毫秒） */
  delay: number;
};

/** 把金额拆成字符格（从左到右渲染，键按「从右数第几位」编号） */
function splitCells(text: string, prevText: string | null, stagger: boolean): MoneyCell[] {
  let prevMap: Map<string, string> | null = null;
  if (prevText !== null && prevText !== text) {
    prevMap = new Map(splitChars(prevText).map((c) => [c.key, c.char]));
  }
  return splitChars(text).map(({ key, char, indexFromRight }) => {
    const prevChar = prevMap?.get(key);
    // 只有「数字 → 数字」的变化才滚动；逗号 / 小数点 / 符号 / 币种字母直换
    const rolls =
      stagger && prevChar !== undefined && prevChar !== char && /\d/.test(char) && /\d/.test(prevChar);
    return {
      key,
      char,
      from: rolls ? (prevChar as string) : null,
      delay: Math.min(indexFromRight, STAGGER_MAX_STEPS) * STAGGER_MS,
    };
  });
}

function splitChars(text: string): { key: string; char: string; indexFromRight: number }[] {
  const out: { key: string; char: string; indexFromRight: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const indexFromRight = text.length - 1 - i;
    out.push({ key: `c${indexFromRight}`, char: text[i] ?? '', indexFromRight });
  }
  return out;
}

/* ------------------------------------------------------- 单格（逐位滚动） */

function RollingCell({
  char,
  from,
  progress,
  startFraction,
  variant,
  textStyle,
  color,
}: {
  char: string;
  from: string | null;
  /** 整段滚动进度 0 → 1（一个组件共用一个：每位用 startFraction 错开，不用 per-cell 延迟） */
  progress: SharedValue<number>;
  startFraction: number;
  variant: TypographyVariant;
  textStyle: StyleProp<TextStyle>;
  color: string;
}) {
  // 格子高度 = 一行文字的自然高（onLayout 实测：系统大字 / 最大缩放上限都自动跟上）
  const [cellHeight, setCellHeight] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h > 0 && h !== cellHeight) setCellHeight(h);
  };

  const incomingStyle = useAnimatedStyle(() => {
    // from === null：这格没变，钉在原地（否则整体的 progress 会把它一起推走）
    if (from === null || cellHeight === 0) return { transform: [{ translateY: 0 }] };
    const t = progress.value <= startFraction ? 0 : (progress.value - startFraction) / (1 - startFraction);
    return { transform: [{ translateY: (1 - t) * cellHeight }] };
  }, [from, startFraction, cellHeight]);

  const outgoingStyle = useAnimatedStyle(() => {
    if (cellHeight === 0) return { transform: [{ translateY: 0 }] };
    const t = progress.value <= startFraction ? 0 : (progress.value - startFraction) / (1 - startFraction);
    return { transform: [{ translateY: -t * cellHeight }] };
  }, [startFraction, cellHeight]);

  return (
    <View style={styles.cell} onLayout={onLayout}>
      <Animated.View style={incomingStyle}>
        {/* 每格只有 1 个字符：这里 numberOfLines={1} 不是「截断金额」，只是保证格子恒为一行高 */}
        <AppText variant={variant} color={color} style={textStyle} numberOfLines={1}>
          {char}
        </AppText>
      </Animated.View>
      {from !== null && (
        <Animated.View style={[styles.cellOutgoing, outgoingStyle]} pointerEvents="none">
          <AppText variant={variant} color={color} style={textStyle} numberOfLines={1}>
            {from}
          </AppText>
        </Animated.View>
      )}
    </View>
  );
}

/* ------------------------------------------------------- 隐藏测量层 */

/**
 * 隐藏测量层：把金额用**同样字号**在「不受容器宽度约束」的盒子里渲染一遍，量出真实宽度。
 * - 可见的那份是 numberOfLines={1}，被容器夹住时量不出真实宽度，只能靠它；
 * - 绝对定位：不参与任何排版（宽 = 估算上限 ×1.3 + 24，保证不被盒子本身夹住）；
 * - 只在估算说「放不下」时渲染，量完就卸载（平时零开销）；
 * - 位置无所谓（只取宽度），所以可以直接放在 Fragment 里跟可见文字并列。
 */
function MeasureLayer({
  text,
  variant,
  textStyle,
  boxWidth,
  onMeasured,
}: {
  text: string;
  variant: TypographyVariant;
  textStyle: StyleProp<TextStyle>;
  boxWidth: number;
  onMeasured: (width: number) => void;
}) {
  return (
    <View pointerEvents="none" accessible={false} style={[styles.measureBox, { width: boxWidth }]}>
      <AppText
        variant={variant}
        color="transparent"
        numberOfLines={1}
        style={textStyle}
        onLayout={(e) => onMeasured(e.nativeEvent.layout.width)}
      >
        {text}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------- MoneyText */

export function MoneyText({
  value,
  variant = 'body',
  kind = 'plain',
  currency,
  showCurrency,
  currencyPosition,
  compact,
  hidden,
  decimals,
  color,
  roll = true,
  shrinkLadder,
  compactFallback = true,
  style,
  accessibilityLabel,
}: MoneyTextProps) {
  const { typography, semantic, motion } = useTheme();
  const token = typography[variant];
  // 软获取：不在 AppDialogProvider 里时返回 null（长按看全文自动禁用，不报错）
  const dialog = useDialogOptional();

  const formatOptions = useMemo(
    () => ({ kind, currency, showCurrency, currencyPosition, compact, hidden, decimals }),
    [kind, currency, showCurrency, currencyPosition, compact, hidden, decimals]
  );
  // 完整金额（永不缩写的“真身”）：屏上被紧凑化时，它也进 accessibilityLabel
  const fullText = useMemo(() => formatMoney(value, formatOptions), [value, formatOptions]);

  // 颜色：支出中性 + −、收入绿 + +、转账次要色 + 无符号（UI_RULES 第 1 节）
  const kindColor =
    kind === 'expense'
        ? semantic.amountExpense
        : kind === 'income'
          ? semantic.amountIncome
          : kind === 'transfer'
            ? semantic.amountTransfer
            : semantic.textPrimary;
  const resolvedColor = color ?? kindColor;

  // 阶梯：基准 ≥40 的大字号档才走降级（display / amountEntry）
  const ladder = useMemo(() => {
    if (shrinkLadder === null) return [token.fontSize];
    if (shrinkLadder) return shrinkLadder;
    if (token.fontSize < SHRINK_LADDER[0]) return [token.fontSize];
    return SHRINK_LADDER.map((step, index) => (index === 0 ? token.fontSize : step));
  }, [shrinkLadder, token.fontSize]);

  // 本组件被允许占的宽度（onLayout 实测：卡片里 = 卡片内宽，行内跟着自己的框走）
  const [availableWidth, setAvailableWidth] = useState(0);
  const measureWidth = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== availableWidth) setAvailableWidth(w);
  };

  // 实测每 px 字形宽（em）：隐藏测量层量出的「(真实宽 − 字距) ÷ 当时字号」。
  // 换文本要重新量；换字号不用（字形 em 与字号无关，见 fitsByEm 注释）
  const [measuredEm, setMeasuredEm] = useState<number | null>(null);
  useEffect(() => {
    setMeasuredEm(null);
  }, [fullText]);

  // ── 选文本 + 选档（顺序很重要：先按完整金额选，放不下才退紧凑格式） ──
  // 字距总贡献（px，与字号无关）：display 档 −0.8 × 26 字符 ≈ −21px，不能忽略
  const spacingTotal = token.letterSpacing * fullText.length;
  const estimatedEm = useMemo(() => estimateEm(fullText), [fullText]);
  const widthEm = measuredEm ?? estimatedEm;
  // 只在「估算说放不下、又还没实测过」时渲染隐藏测量层做精确判定（平时不占节点）
  const needsMeasure =
    measuredEm === null &&
    availableWidth > 0 &&
    !fitsByEm(estimatedEm, ladder[0] ?? token.fontSize, spacingTotal, availableWidth);
  const fullTier = tierFitting(widthEm, spacingTotal, ladder, availableWidth);
  // 紧凑格式只在**实测确认**放不下时才启用：估算有 ±3% 误差，在「父容器宽度=内容宽」
  // 的地方（TransactionRow 的金额、ListRow 的值列）会把放得下的金额误判成放不下，
  // 屏上就会莫名变成 +6.8k 这种缩写（自检里抓到过）。
  // ⚠ |值| ≥ 1e21 时 JS 的 toFixed 会吐指数写法（"1.23e+21"）—— 这种文本一律走紧凑格式，
  //   屏幕上不能出现 e+21 这种东西（现实金额到不了这个量级，属于数据异常兜底）。
  const unusableText = /e[+-]\d/.test(fullText);
  const useCompact =
    compactFallback &&
    !hidden &&
    (unusableText || (measuredEm !== null && fullTier < 0 && availableWidth > 0));
  const shownText = useMemo(
    () => (useCompact ? formatMoney(value, { ...formatOptions, compact: true }) : fullText),
    [useCompact, value, formatOptions, fullText]
  );
  const tier = useCompact
    ? Math.max(0, tierFitting(estimateEm(shownText), token.letterSpacing * shownText.length, ladder, availableWidth))
    : Math.max(0, fullTier, digitTier(moneyIntDigits(fullText)));
  const fontSize = ladder[Math.min(tier, ladder.length - 1)] ?? token.fontSize;
  const lineHeight = Math.round((token.lineHeight / token.fontSize) * fontSize);
  const sizeStyle: TextStyle | undefined =
    fontSize === token.fontSize && lineHeight === token.lineHeight ? undefined : { fontSize, lineHeight };

  /* -------------------------------------------------- 布局 / 文本样式拆分 */

  const flatStyle = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  // 容器只认「盒子」属性；其余（color / 字距 / 变形 …）交给文字本身
  const containerStyle: TextStyle = {
    flexShrink: flatStyle.flexShrink ?? 0,
    alignSelf: flatStyle.alignSelf,
    opacity: flatStyle.opacity,
    marginTop: flatStyle.marginTop,
    marginBottom: flatStyle.marginBottom,
    marginLeft: flatStyle.marginLeft,
    marginRight: flatStyle.marginRight,
  };
  const cellTextStyle = useMemo(() => {
    const s: TextStyle = { ...flatStyle };
    // 盒子属性一律归容器：格子里的文字只保留文字属性
    delete s.flexShrink;
    delete s.alignSelf;
    delete s.opacity;
    delete s.margin;
    delete s.marginTop;
    delete s.marginBottom;
    delete s.marginLeft;
    delete s.marginRight;
    delete s.marginHorizontal;
    delete s.marginVertical;
    return Object.keys(s).length > 0 ? s : undefined;
  }, [style]);

  /* ------------------------------------------------------------ 滚动状态 */

  const [cells, setCells] = useState<MoneyCell[]>(() => splitCells(shownText, null, false));
  const [hasRolled, setHasRolled] = useState(false);
  const progress = useSharedValue(1);
  const prevTextRef = useRef<string | null>(null);
  const mountedAtRef = useRef(Date.now());

  const settle = () => {
    setCells((prev) => (prev.some((c) => c.from !== null) ? prev.map((c) => (c.from === null ? c : { ...c, from: null })) : prev));
  };

  useEffect(() => {
    const prevText = prevTextRef.current;
    prevTextRef.current = shownText;
    // 首次渲染（挂载）不滚动；文本没变也不动
    if (prevText === null || prevText === shownText) return;

    // 首屏数据到位（挂载后 600ms 内的首次赋值）不滚动：不算「用户操作引起的变化」
    const isFirstLoad = Date.now() - mountedAtRef.current < FIRST_LOAD_WINDOW_MS;
    const canRoll = roll && !motion.reduceMotion && !isFirstLoad;
    const next = splitCells(shownText, prevText, canRoll);
    setCells(next);

    if (next.some((c) => c.from !== null)) {
      setHasRolled(true);
      progress.value = 0;
      progress.value = withTiming(
        1,
        { duration: motion.timing.numberRoll + STAGGER_MAX_STEPS * STAGGER_MS, easing: motion.easing.out },
        (finished) => {
          'worklet';
          if (finished) runOnJS(settle)();
        }
      );
    }
  }, [shownText, roll, motion]);

  /* ------------------------------------------------------------- 渲染 */

  // 紧凑格式：长按看完整金额（走 AppDialog；不在 Provider 里就没这个手势）。
  // ⚠ 必须包一层 Pressable：react-native-web 的 Text 根本不支持 onLongPress（只支持 onPress），
  //   直接挂在 Text 上在浏览器里毫无反应（真机才有）。Pressable 两端都支持。
  const longPressable = useCompact && dialog;
  // 读屏永远读完整金额（屏上是紧凑格式时也一样）
  const a11yLabel = accessibilityLabel ?? (useCompact ? fullText : shownText);

  const measureLayer = needsMeasure ? (
    <MeasureLayer
      text={fullText}
      variant={variant}
      textStyle={[sizeStyle, cellTextStyle]}
      boxWidth={Math.ceil((ladder[0] ?? token.fontSize) * estimatedEm + spacingTotal) * 2 + 24}
      onMeasured={(w) => {
        // 把字距剥掉 → 纯字形 em（与字号无关，之后换档位都能直接换算）
        if (w > 0 && fontSize > 0) setMeasuredEm((w - spacingTotal) / fontSize);
      }}
    />
  ) : null;

  // 静态路径（挂载时 / roll 关闭 / 减弱动态效果）：整段一个 Text，最省。
  // ⚠ numberOfLines={1} + ellipsizeMode="clip"：金额恒一行、**永不换行也永不出省略号**，
  //   即便估算失灵也只是裁掉尾巴（正常情况下档位/紧凑格式已经保证放得下）。
  if (!hasRolled) {
    const textEl = (
      <AppText
        variant={variant}
        color={resolvedColor}
        style={[sizeStyle, longPressable ? cellTextStyle : style]}
        numberOfLines={1}
        ellipsizeMode="clip"
        onLayout={measureWidth}
        // 包了 Pressable 时无障碍归 Pressable（避免同一金额读两遍）
        accessible={!longPressable}
        accessibilityLabel={longPressable ? undefined : a11yLabel}
      >
        {shownText}
      </AppText>
    );

    if (longPressable && dialog) {
      return (
        <Pressable
          style={containerStyle}
          onLongPress={() => dialog.alert({ title: fullText })}
          delayLongPress={400}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          accessibilityHint={fullText}
        >
          {textEl}
          {measureLayer}
        </Pressable>
      );
    }
    return (
      <>
        {textEl}
        {measureLayer}
      </>
    );
  }

  return (
    <View
      style={[styles.row, containerStyle]}
      onLayout={measureWidth}
      accessible
      accessibilityLabel={a11yLabel}
    >
      {cells.map((cell) => (
        <RollingCell
          key={cell.key}
          char={cell.char}
          from={cell.from}
          progress={progress}
          startFraction={cell.delay / (motion.timing.numberRoll + STAGGER_MAX_STEPS * STAGGER_MS)}
          variant={variant}
          textStyle={[sizeStyle, cellTextStyle]}
          color={resolvedColor}
        />
      ))}
      {measureLayer}
    </View>
  );
}

const styles = StyleSheet.create({
  // 一行字符格：底部对齐，数字不会因为格子高度差而错位
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  // 单格：高度由内容（一行文字）决定，超出的滚动层被裁掉
  cell: { overflow: 'hidden' },
  // 旧字符层：绝对定位在格子左上，滚出去就被裁掉
  cellOutgoing: { position: 'absolute', top: 0, left: 0 },
  // 隐藏测量层：绝对定位 + 透明，只用来量真实宽度（不参与排版）
  measureBox: { position: 'absolute', top: 0, left: 0, opacity: 0, alignItems: 'flex-start' },
});

export default MoneyText;
