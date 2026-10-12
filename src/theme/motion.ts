// motion.ts
// 动效令牌（UI/UX 改造计划 4.3）：全项目动画只用这里的这几种 + 数字滚动 600ms，
// 页面里不许再出现零散的 duration / damping / stiffness 数字。
//
// 用法：
//   const { motion } = useTheme();
//   progress.value = withSpring(1, motion.spring.default);
//   opacity.value = withTiming(1, { duration: motion.timing.fade, easing: motion.easing.out });
//   scale.value = withSpring(pressed ? motion.pressScale : 1, motion.spring.press);
//
// 系统「减弱动态效果」开启时，useMotion() 自动返回降级档：150ms 交叉淡入、无位移、无回弹。

import { Easing, useReducedMotion } from 'react-native-reanimated';

/** 弹簧档位：Reanimated 的 dampingRatio + duration 组合（1 = 临界阻尼、不回弹） */
export type SpringToken = { dampingRatio: number; duration: number };

export const motion = {
  spring: {
    /** 大多数 UI：临界阻尼、不回弹（Apple 做法） */
    default: { dampingRatio: 1, duration: 350 },
    /** 底部抽屉 / 弹层：0.85 阻尼略带弹性，松手速度由手势传入（velocity handoff） */
    sheet: { dampingRatio: 0.85, duration: 400 },
    /** 按压反馈：按下即响应（不等松手） */
    press: { dampingRatio: 1, duration: 180 },
    /** 磁吸入场（列表卡滑入）：轻微过冲；Reanimated withSpring 原生参数 */
    snap: { damping: 14, stiffness: 180, mass: 0.9 },
  },
  timing: {
    /** 仅用于淡入淡出 */
    fade: 150,
    /** 净资产 / 预算数字变化的逐位滚动 */
    numberRoll: 600,
    /** 数字统一滚动总时长（MoneyText：每位从左到右错开，整体 1.2s；可调） */
    numberRollTotal: 1200,
  },
  /** 淡入淡出缓动（ease-out） */
  easing: { out: Easing.out(Easing.cubic) },
  /** 按下时的目标缩放（松开回 1） */
  pressScale: 0.97,
  /** 是否为「减弱动态效果」降级档（基础档恒为 false） */
  reduceMotion: false,
};

export type MotionTokens = typeof motion;

/** 减弱动态效果降级档：150ms 交叉淡入，不位移、不回弹、不滚动 */
export const reducedMotion: MotionTokens = {
  spring: {
    default: { dampingRatio: 1, duration: 150 },
    sheet: { dampingRatio: 1, duration: 150 },
    press: { dampingRatio: 1, duration: 150 },
    snap: { damping: 40, stiffness: 400, mass: 1 },
  },
  timing: { fade: 150, numberRoll: 0, numberRollTotal: 0 },
  easing: { out: Easing.out(Easing.cubic) },
  pressScale: 1,
  reduceMotion: true,
};

/**
 * 取当前生效的动效令牌（在 useTheme() 里已默认返回）。
 * ⚠ 底层是 Reanimated 的 useReducedMotion()：在 App 启动时读取系统设置，
 *   运行中改系统开关不会触发重渲染（Reanimated 已知行为），可接受。
 */
export function useMotion(): MotionTokens {
  const reduce = useReducedMotion();
  return reduce ? reducedMotion : motion;
}
