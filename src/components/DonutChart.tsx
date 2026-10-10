// DonutChart.tsx
// 环形图（T21 / 计划 5.5 R2）：只负责「把环画出来」，占比与中心文案都由调用方决定。
//
// 本版三件事
// 1. 扇区之间留 2pt 缝：真实占比的累积角度一字不动，只是每段绘制时两端各让出半个缝 ——
//    缝隙只发生在「画」这一层（绘制弧长收窄），不参与任何占比计算，数字口径保持不变。
// 2. 进场 600ms 顺序绘制：扇区按数据顺序一段段「长」出来，不是整体缩放。
//    时长取 motion.timing.numberRoll（600ms）—— 它本来就是 App 里「量在长出来」的时长档
//    （净资产 / 预算数字变化用的同一档，UI_RULES 第 3 节：时长只许取令牌，页面不许自造）；
//    系统「减弱动态效果」时（motion.reduceMotion / numberRoll === 0）直接落终态，不播。
// 3. 高亮：selectedIndex 之外的扇区降到 dimOpacity，切换用 motion.timing.fade 淡出。
//
// 角度约定（ReportScreen 的扇区点击命中判定必须与这里严格对齐）
//   react-native-svg 的 <circle> 路径从 3 点方向起画、顺时针前进；
//   <G rotate={-90 + rotation}> 把整环旋转一下，所以：
//     · 第 0 个扇区起点在屏幕角 θ0 = -90 + rotation（度；y 轴向下、顺时针为正）；
//     · 第 i 个扇区覆盖 [前面各段占比之和, +自身占比] 这段沿环区间，与 value/total 完全一致。

import React, { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import Animated, {
  SharedValue,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme/useTheme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** 扇区之间的缝隙（pt，沿圆周的弧长）—— 纯几何常量，不是设计令牌 */
const SLICE_GAP = 2;
/** 极窄扇区的最小可见弧长（pt）：占比再小也留一个点，不然分类会整个消失 */
const MIN_ARC = 1;
/** 高亮时未选中扇区的不透明度（只是不透明度，不改色值） */
const DIM_OPACITY = 0.25;

export interface DonutSlice {
  value: number;
  color: string;
}

export interface DonutChartProps {
  data: DonutSlice[];
  size?: number;
  strokeWidth?: number;
  /** 整环的起始角度微调（度，负 = 逆时针），默认从 12 点方向开始 */
  rotation?: number;
  /** 扇区之间的缝隙（pt，默认 2；0 = 扇区首尾相接） */
  gap?: number;
  /** 高亮的扇区下标（null / 不传 = 无高亮，全部正常显示） */
  selectedIndex?: number | null;
  /** 未选中扇区在高亮时的不透明度（默认 0.25） */
  dimOpacity?: number;
  /** 是否播放 600ms 进场绘制（默认 true；减弱动态效果时自动跳过） */
  animateIn?: boolean;
}

/** 一段弧：几何（起点 / 弧长 / 半径）由父组件按真实占比算好，这里只管画与动 */
function SliceArc({
  cx,
  cy,
  radius,
  strokeWidth,
  color,
  circumference,
  start,
  len,
  selected,
  dimOpacity,
  progress,
  dim,
}: {
  cx: number;
  cy: number;
  radius: number;
  strokeWidth: number;
  color: string;
  circumference: number;
  /** 本段可视化起点（沿圆周的弧长，pt） */
  start: number;
  /** 本段可视化弧长（pt，已扣掉两头的缝） */
  len: number;
  selected: boolean;
  dimOpacity: number;
  /** 进场进度 0 → 1（整环共用） */
  progress: SharedValue<number>;
  /** 高亮淡出进度 0 → 1（整环共用） */
  dim: SharedValue<number>;
}) {
  const animatedProps = useAnimatedProps(() => {
    // 进场：整环画到 progress × 周长处为止，本段只露出「已经画到」的那一截
    const drawn = Math.min(Math.max(progress.value * circumference - start, 0), len);
    return {
      strokeDasharray: `${drawn} ${Math.max(circumference - drawn, 0)}`,
      strokeDashoffset: -start,
      // 高亮：被点中的保持原样，其余压暗（dim 从 0 渐到 1）
      opacity: selected ? 1 : 1 - dim.value * (1 - dimOpacity),
    };
  });

  return (
    <AnimatedCircle
      cx={cx}
      cy={cy}
      r={radius}
      stroke={color}
      strokeWidth={strokeWidth}
      fill="transparent"
      animatedProps={animatedProps}
    />
  );
}

export default function DonutChart({
  data,
  size = 160,
  strokeWidth = 24,
  rotation = 0,
  gap = SLICE_GAP,
  selectedIndex = null,
  dimOpacity = DIM_OPACITY,
  animateIn = true,
}: DonutChartProps) {
  const { motion } = useTheme();

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;

  // 每段的绘制窗口：先按真实占比累积（pts 口径），再把「两头各半个缝」收掉；见文件头注释
  const segments = useMemo(() => {
    let acc = 0;
    return data.map((d) => {
      const arc = (d.value / total) * circumference;
      // 缝隙只在绘制层收窄；极窄扇区兜一个最小可见弧长（否则小分类会整个看不见）
      const len = Math.max(arc - gap, MIN_ARC);
      // 收掉的弧长平均分到两头 = 每头半个缝；比最小弧长还窄的段自然居中
      const start = acc + (arc - len) / 2;
      acc += arc;
      return { color: d.color, start, len };
    });
  }, [data, total, circumference, gap]);

  // 减弱动态效果 / 调用方关闭进场：直接落终态，不播（useSharedValue 的初值只在首帧生效）
  const skipAnim = !animateIn || motion.reduceMotion || motion.timing.numberRoll === 0;
  const progress = useSharedValue(skipAnim ? 1 : 0);
  const dim = useSharedValue(0);

  useEffect(() => {
    if (skipAnim) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration: motion.timing.numberRoll, easing: motion.easing.out });
  }, [skipAnim, progress, motion]);

  // 有无高亮：0 ↔ 1 的淡出，不动颜色只动不透明度
  useEffect(() => {
    dim.value = withTiming(selectedIndex === null ? 0 : 1, {
      duration: motion.timing.fade,
      easing: motion.easing.out,
    });
  }, [selectedIndex, dim, motion]);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G transform={`rotate(${-90 + rotation} ${size / 2} ${size / 2})`}>
          {segments.map((s, i) => (
            <SliceArc
              key={i}
              cx={size / 2}
              cy={size / 2}
              radius={radius}
              strokeWidth={strokeWidth}
              color={s.color}
              circumference={circumference}
              start={s.start}
              len={s.len}
              selected={selectedIndex === i}
              dimOpacity={dimOpacity}
              progress={progress}
              dim={dim}
            />
          ))}
        </G>
      </Svg>
    </View>
  );
}
