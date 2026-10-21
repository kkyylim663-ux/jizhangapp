/**
 * Hero 金额卡金属光泽（2026-10-08 按用户处方重做；2026-10-10 T11：陀螺仪搬进 UI 线程 +
 * 光带数值对齐计划 5.10 —— 视觉结构与降级链保持不变，只换驱动方式与数值窗口）
 *
 * 结构（三层，全部只在金额文字区内）：
 *  ① 下层 = HomeScreen 的可见 Text（原字色 + dayTextShadow 投影，保可读性，未动）；
 *  ② 金属底色层（MaskedView）= 金额数字本身显示一层「竖向金属渐变」：
 *     夜 #FFFFFF→#CFC4F5→#F2EEFF（拉丝银紫）/ 日 #FFFFFF→#E9E1FF→#FFFFFF；
 *     底色整体比纯白低一档 —— 给近纯白的流光亮芯留出亮度差（处方 1）；
 *  ③ 流光层（MaskedView）= 5 停光带：两端与相邻色同色、alpha 0
 *     （不用 'transparent' —— Android 上它是透明黑、边缘发灰，处方 3）；
 *     亮芯≈纯白 → 扫过时明显变亮；两肩保留轻微彩虹偏色。整体亮度：静止 0.5 / 扫光峰值 1.0；
 *     T11：可用 maskElement 传「RM + 整数 + 小数」三段同排的自定义遮罩（T08 净资产排版），
 *     不传则仍用单串 text/fontSize 自建遮罩（向后兼容）；
 *  ④ 卡面扫光层（HeroCardSheen）= 与数字流光**共用同一套 sweepPos/tiltPos** 的宽光带：
 *     卡片背景渐变之上、所有内容之下（按钮/文字/金额/预算面板都不被覆盖），宽度≈卡宽 70%、
 *     斜 20°、5 停渐变两端同色 alpha 0；被卡的 borderRadius + overflow hidden 裁切，pointerEvents none。
 *     共用一个位置驱动 → 光掠过数字时数字同时变亮，视觉上是一个光源。
 *     T11 质感（计划 5.10 第 3 条）：亮芯在本组件内确定性推导为「偏冷白 + alpha 0.32」
 *     （窗口 25–40%；token 冻结不能改，推导依据见 remapSheenCore 注释），两肩按同比例缩放。
 *  ⑤ 卡顶内高光（HeroEdgeSheen，T11）：1.5dp 光缝 → 1px、偏冷白、透明度=强度；
 *  ⑥ 卡外阴影（HeroCardShadow，T11）：随倾斜反向微移（光源在上方，计划 5.10 第 4 条）。
 *
 * 运动（处方 4/5/6；T11 起判定与跟随全部在 UI 线程的 worklet）：
 *  - TiltSensor 子组件用 Reanimated `useAnimatedSensor(SensorType.ROTATION)`（原为 JS 端
 *    expo-sensors DeviceMotion 30Hz + 每帧 withTiming）：roll(左右)/pitch(前后) 与 expo 的
 *    gamma/beta 两端原生实现同源、逐值一致（方向不反转）；倾角夹到 ±22.5°(π/8) 后做 120ms
 *    重定向式低通（光带"滑过"而不是抖）；扫光播放中不更新倾斜位置（播完自然回到跟随）。
 *  - 自动扫光（修正 21 处方 1-8）：**运动中不扫** —— 静止确认（相邻读数变化量 > 阈值 = 运动中，
 *    连续 `STILL_CONFIRM_MS`(1.5s) 低于阈值才判「完全静止」）也在 worklet 里数帧（calmFrames）；
 *    JS 侧计时器每次扫之前检查「已静止」。有传感器 = 完全静止后每 15s 一次（用户逐轮校准，保留）；
 *    无传感器（含 Web）= 视为一直静止、8s 一次（计划 5.10 第 6 条：6–10s）；
 *    进首页/金额变化/眼睛三个触发保持不变，任何扫光都重置静止确认与定时（处方 6）；
 *    失焦/后台清计时器、回来重新判断。进首页那次扫光延迟 ~600ms（在 HomeScreen 的 useFocusEffect 里做）。
 *  - 卡顶 1px 内高光：透明度=强度（静止 0.5 → 扫光 1.0，同步亮一下）；被卡圆角裁切。
 *
 * 降级（处方 7；计划 5.10 第 5/6/7 条）：
 *  - 系统「减少动态效果」→ 不订阅传感器（HeroTiltSensor 直接卸载）、不循环扫光，只保留静态
 *    效果（光带停正中不动）；HeroCardShadow 也不加动画属性；
 *  - 无传感器（Web / 无陀螺仪 / iOS 定位权限缺失等 → 首帧读数上报不到）→ 只保留自动慢扫 +
 *    触发扫光，静态流光效果照常；
 *  - ⚠ Web 守卫（T11a 教训：Web 上订阅传感器整页白屏）：TiltSensor 只在原生端被渲染 ——
 *    useAnimatedSensor 只在该子组件里调用（hook 不能条件调用 → 用「渲染/卸载」代替条件调用，
 *    卸载即自动 unregister）；Web：masked-view 的 Web 实现只渲染遮罩本身（不裁子层）→
 *    AmountSheen 整体不渲染（Web 只是预览环境，真机不受影响），本层绝不白屏。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import MaskedView from '@react-native-masked-view/masked-view';

const TILT_MAX_RAD = Math.PI / 8; // ±22.5°（计划 5.10 第 2 条）：倾斜满行程的夹取上限
const BETA_WEIGHT = 0.35; // 合成权重：roll 0.65 / pitch 0.35（用户校准）
const BETA_BASELINE_EMA = 0.015; // pitch 缓慢基线跟随速度（~30Hz 下 τ≈2.7s：姿势分量被扣掉，只留晃动）
const TILT_FOLLOW_MS = 120; // 倾斜跟随的平滑时长（重定向式低通；手机不动 = 完全静止）
const SWEEP_MS = 2200; // 扫光时长（修正 20 处方 3：ease-in-out ≈2.2s；数字流光与卡面光带同拍）
const SENSOR_INTERVAL_MS = 32; // 传感器更新间隔（~30Hz：足够顺滑也省电，与原 JS 端一致）
// ── 自动扫光的运动判定（2026-10-08 修正 21 处方 1；T11 起在 UI 线程数帧）──
const MOTION_DELTA_THRESHOLD = 0.02; // rad：相邻两次读数（pitch/roll 取大者）的变化量超过它 = 运动中
const STILL_CONFIRM_MS = 1500; // 连续低于阈值达到这么久 = 判定「完全静止」
const STILL_CALM_FRAMES = Math.ceil(STILL_CONFIRM_MS / SENSOR_INTERVAL_MS); // 上式的帧数换算（≈47 帧）
const STILL_SWEEP_INTERVAL_MS = 15000; // 有传感器：完全静止后每 15s 自动扫一次（用户逐轮校准，保留）
const NO_SENSOR_SWEEP_INTERVAL_MS = 8000; // 无传感器（Web/无陀螺仪）：8s 慢扫（计划 5.10 第 6 条：6–10s）
const SWEEP_EDGE = 1.15; // 扫光端点：±1.15 = 光带完全滑出笔画（-1.15 左外 → +1.15 右外）
const CARD_SHEEN_ROTATE_DEG = 20; // 卡面光带倾角（修正 20 处方 2）
const CARD_SHEEN_BLEED_Y = 60; // 卡面光带的纵向出血（斜 20° 后要盖满卡高；由卡的 overflow hidden 裁切）
const IDLE_INTENSITY = 0.5; // 静止/倾斜跟随时的整体亮度（扫光峰值 = 1）
const SWEEP_INTENSITY = 1;
const SHADOW_DRIFT_PX = 2.5; // 卡外阴影随倾斜反向微移幅度（计划 5.10 第 4 条：量级 2–3px）
// ── 光带亮芯数值窗口（计划 5.10 第 3 条：「窄、柔边，白色峰值 25–40%，略偏冷色」）──
const SHEEN_CORE_ALPHA = 0.32; // 亮芯目标 alpha = 窗口 25–40% 的中间值（token 现值 0.22/0.12 都低于窗口）
// 亮芯向冷白混合的比例：0.6 是「让日间暖白也真正落到 r≈g≤b（略偏冷）」的最小比例 ——
// 日 (255,246,226) → (241,241,243)；夜 (224,216,255) → (229,229,255)；低于 0.6 日间仍发黄
const CORE_COOL_MIX = 0.6;
const CORE_COOL_RGB = [232, 238, 255] as const; // 冷白目标色（略偏蓝的白）
const SHEEN_STOPS = [0, 0.22, 0.5, 0.78, 1] as const;

// 倾斜归一（夹到 -1..1）：用在 UI 线程的 worklet 里 → 带 'worklet' 标记才能被 worklet 调用
const clamp1 = (v: number) => {
  'worklet';
  return Math.max(-1, Math.min(1, v));
};
// 处方 3：渐变两端必须「同色 + alpha 0」（Android 上 'transparent' = 透明黑，边缘发灰）
const zeroAlpha = (c: string) => c.replace(/[\d.]+\)\s*$/, '0)');
/** 'rgba(r,g,b,a)' 解析（token 都是这个写法）；不是就返回 null → 调用方原样用原色（不猜、不崩） */
const parseRgba = (c: string): [number, number, number, number] | null => {
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(c);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : null;
};
/**
 * 光带亮芯推导（T11；计划 5.10 第 3 条）：把 palette 传入的亮芯色映射到「略偏冷、alpha 0.32」。
 * 为什么要推导：token 被冻结不能改，现值为 日 rgba(255,246,226,0.22)（偏暖、低于窗口）
 * / 夜 rgba(224,216,255,0.12)（低于窗口）→ alpha 一律取窗口中间值 0.32，RGB 向冷白 (232,238,255)
 * 混合 CORE_COOL_MIX → 日 rgba(241,241,243,0.32) / 夜 rgba(229,229,255,0.32)（都不再发黄）。
 * 卡面光带与卡顶内高光共用这一条推导。
 */
const remapSheenCore = (core: string) => {
  const p = parseRgba(core);
  if (!p) return core;
  const mix = (v: number, t: number) => Math.round(v + (t - v) * CORE_COOL_MIX);
  return `rgba(${mix(p[0], CORE_COOL_RGB[0])},${mix(p[1], CORE_COOL_RGB[1])},${mix(p[2], CORE_COOL_RGB[2])},${SHEEN_CORE_ALPHA})`;
};
/** 肩色 alpha 按 factor 缩放（肩原本就是亮芯的固定低透明度比例，跟着芯一起涨落）；非 rgba 原样返回 */
const scaleSheenAlpha = (c: string, factor: number) => {
  const p = parseRgba(c);
  return p ? `rgba(${p[0]},${p[1]},${p[2]},${Number((p[3] * factor).toFixed(3))})` : c;
};

export type HeroSheenPalette = {
  core: string; // 亮芯（≈纯白：夜 rgba(255,255,255,1) / 日 rgba(255,250,235,1)）
  shoulderA: string; // 肩 A（微彩虹一侧）
  shoulderB: string; // 肩 B（另一侧）
  metalTop: string; // 金属底色·上（竖向渐变顶）
  metalMid: string; // 金属底色·中（比纯白低一档 = 留出高光空间）
  metalBottom: string; // 金属底色·下
  cardCore: string; // 卡面光带·亮芯（夜 rgba(…,0.12) 冷紫白 / 日 rgba(…,0.22) 暖白）
  cardShoulderA: string; // 卡面光带·肩 A（低透明度）
  cardShoulderB: string; // 卡面光带·肩 B（低透明度）
};

export type HeroSheen = {
  tiltPos: SharedValue<number>; // -1..1（陀螺仪映射，平滑后）
  sweepPos: SharedValue<number>; // -1.15..1.15（扫光播放时的位置）
  sweepOn: SharedValue<boolean>; // 扫光进行中
  intensity: SharedValue<number>; // 0.5 静止 / 1 扫光峰值
  sweep: () => void; // 触发扫一次
};

/** TiltSensor（UI 线程传感器）↔ useHeroSheen（JS 计时器）之间的最小桥（本文件内部用） */
type HeroSheenSensorBridge = {
  calmFrames: SharedValue<number>; // 连续「静止读数」帧数（运动中清零；UI 线程写、JS 计时器读）
  onAttached: (ok: boolean) => void; // 传感器是否真的在出数（首帧读数 true / 卸载 false）
};
/** 取内部桥：HeroSheen 的对外类型与调用点不变（T11 约束），桥挂在返回对象的内部字段上 */
const sensorBridgeOf = (sheen: HeroSheen) =>
  (sheen as HeroSheen & { sensorBridge?: HeroSheenSensorBridge }).sensorBridge;

/**
 * 陀螺仪驱动 + 自动循环的共享值（T11：倾斜与静止判定在 UI 线程，这里只留「何时触发扫光」的计时器）。
 * active = 页面是否聚焦（HomeScreen 用 useFocusEffect 传；失焦/后台不订阅、不循环）。
 */
export function useHeroSheen({ active }: { active: boolean }): HeroSheen {
  const reduceMotion = useReducedMotion();
  const [appActive, setAppActive] = useState(true);
  const [sensorOk, setSensorOk] = useState(false); // 传感器真的在出数（TiltSensor 首帧读数上报）
  const tiltPos = useSharedValue(0);
  const sweepPos = useSharedValue(0);
  const sweepOn = useSharedValue(false);
  const intensity = useSharedValue(IDLE_INTENSITY);
  // 运动门（修正 21 处方 1 的 UI 线程版）：连续「低于阈值」的读数帧数；运动中清零
  const calmFrames = useSharedValue(0);

  // ── JS 侧只剩「静止后定时扫」的计时器（运动判定与静止确认都在 UI 线程的 worklet 里）──
  const enabledRef = useRef(false); // 聚焦 + 前台 + 非减少动效
  const sensorOkRef = useRef(false); // 与 sensorOk 同步（计时器闭包读它，避免每次重排都换实现）
  const autoSweepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sweepFnRef = useRef<() => void>(() => {}); // 计时器永远调最新的 sweep 实现

  const clearAutoSweep = () => {
    if (autoSweepTimerRef.current) clearInterval(autoSweepTimerRef.current);
    autoSweepTimerRef.current = null;
  };
  // 静止后定时扫（处方 2/3/5/6）：有传感器 = 每 15s 一次、每次扫前先确认「已静止」（运动中不扫）；
  // 无传感器（Web / 无陀螺仪）= 视为一直静止，8s 一次慢扫（计划 5.10 第 6 条：6–10s）
  const rescheduleAutoSweep = () => {
    clearAutoSweep();
    if (!enabledRef.current) return;
    const withSensor = sensorOkRef.current;
    autoSweepTimerRef.current = setInterval(() => {
      // 运动中不扫：UI 线程的静止确认（连续静止帧数）没走完 → 跳过这一次
      if (withSensor && calmFrames.value < STILL_CALM_FRAMES) return;
      sweepFnRef.current();
    }, withSensor ? STILL_SWEEP_INTERVAL_MS : NO_SENSOR_SWEEP_INTERVAL_MS);
  };

  // 传感器桥（挂在返回对象的内部字段上；onAttached 双写：ref 给计时器闭包读、state 触发重排计时）
  const sensorBridge = useMemo<HeroSheenSensorBridge>(
    () => ({
      calmFrames,
      onAttached: (ok: boolean) => {
        sensorOkRef.current = ok;
        setSensorOk(ok);
      },
    }),
    [calmFrames]
  );

  // 后台不订阅（省电）：HeroTiltSensor 在后台会自行卸载；这里只管自己这侧的计时器
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // 聚焦/前后台/减少动效/传感器可用性变化 → 清计时器并重新判断（处方 7/8）：
  // 无传感器 = 视为一直静止（处方 7）；有传感器 = calmFrames 未达确认时自动扫光会跳过
  useEffect(() => {
    enabledRef.current = active && appActive && !reduceMotion;
    clearAutoSweep();
    calmFrames.value = 0; // 重新激活 = 静止确认从头开始
    if (enabledRef.current) rescheduleAutoSweep();
  }, [active, appActive, reduceMotion, sensorOk, calmFrames]);

  // 卸载 → 清掉计时器
  useEffect(() => () => clearAutoSweep(), []);

  // 「减少动态效果」→ 关闭陀螺仪与扫光，只保留静态效果（光带停在正中不动）
  useEffect(() => {
    if (!reduceMotion) return;
    cancelAnimation(tiltPos);
    cancelAnimation(sweepPos);
    cancelAnimation(intensity);
    sweepOn.value = false;
    tiltPos.value = 0;
    intensity.value = IDLE_INTENSITY;
  }, [reduceMotion, intensity, sweepOn, sweepPos, tiltPos]);

  const sweep = useCallback(() => {
    if (reduceMotion || sweepOn.value) return; // 播放中不重入
    sweepOn.value = true;
    calmFrames.value = 0; // 任何扫光（触发 / 自动）都重置静止确认（处方 6）
    rescheduleAutoSweep(); // 同时重置定时（有传感器 15s / 无传感器 8s）
    intensity.value = withTiming(SWEEP_INTENSITY, { duration: 250, easing: Easing.out(Easing.quad) });
    sweepPos.value = -SWEEP_EDGE;
    sweepPos.value = withTiming(SWEEP_EDGE, { duration: SWEEP_MS, easing: Easing.inOut(Easing.cubic) }, () => {
      'worklet';
      // 终点在笔画之外 → 先淡出，再切回「倾斜跟随」的位置（切换发生在光带不可见时，
      // 避免"从右端瞬移到中间"的跳变），最后把静止微光淡回来
      intensity.value = withTiming(0, { duration: 150, easing: Easing.out(Easing.quad) }, (faded) => {
        'worklet';
        if (!faded) return;
        sweepOn.value = false;
        intensity.value = withTiming(IDLE_INTENSITY, { duration: 420, easing: Easing.inOut(Easing.quad) });
      });
    });
  }, [reduceMotion, intensity, sweepOn, sweepPos, calmFrames]);

  // 自动扫光的计时器永远调最新的 sweep 实现（sweep 随 reduceMotion 变化时自动跟上）
  useEffect(() => {
    sweepFnRef.current = sweep;
  });

  const sheen: HeroSheen & { sensorBridge: HeroSheenSensorBridge } = {
    tiltPos,
    sweepPos,
    sweepOn,
    intensity,
    sweep,
    sensorBridge,
  };
  return sheen; // 对外返回类型仍是 HeroSheen（HomeScreen 调用点不变）
}

/**
 * 传感器挂载闸门（T11）：只有「原生端 + 聚焦 + 前台 + 未开减少动效」才渲染 TiltSensor 本体。
 * 为什么拆两层：useAnimatedSensor 是 hook、不能条件调用（Web 上绝不订阅 —— T11a 白屏教训）→
 * 用「渲染 / 卸载」代替条件调用；卸载即自动 unregister（省电，也不会漏订阅）。
 */
function HeroTiltSensor({ sheen, bridge }: { sheen: HeroSheen; bridge: HeroSheenSensorBridge }) {
  const focused = useIsFocused(); // 与 HomeScreen 的 useFocusEffect 语义一致（失焦即卸载）
  const reduceMotion = useReducedMotion();
  const [appActive, setAppActive] = useState(true);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);
  if (Platform.OS === 'web' || !focused || !appActive || reduceMotion) return null;
  return <TiltSensor sheen={sheen} bridge={bridge} />;
}

/**
 * 传感器本体（T11：不渲染任何东西）：全文件唯一调用 useAnimatedSensor 的地方。
 * 读数变化 → useAnimatedReaction（UI 线程）：① 数「连续静止帧」（运动判定）② 更新 tiltPos。
 * 与 expo-sensors DeviceMotion 的对应：rotation.roll ≈ gamma（左右）/ rotation.pitch ≈ beta（前后）
 * —— Android 与 iOS 的两端原生实现同源（SensorManager.getOrientation 取负 / CMAttitude），方向不反转。
 */
function TiltSensor({ sheen, bridge }: { sheen: HeroSheen; bridge: HeroSheenSensorBridge }) {
  const sensor = useAnimatedSensor(SensorType.ROTATION, { interval: SENSOR_INTERVAL_MS });
  const rotation = sensor.sensor; // 同一 (type, config) 下 SensorContainer 缓存同一个 shared value → 跨渲染稳定
  const { tiltPos, sweepOn } = sheen;
  const calm = bridge.calmFrames;
  const onAttached = bridge.onAttached;
  const pitchBase = useSharedValue(Number.NaN); // pitch 的缓慢握姿基线（挂载即重取；NaN = 还没取过）

  useAnimatedReaction(
    () => rotation.value,
    (curr, prev) => {
      // 第一帧没有相邻读数可比：只上报「传感器真的在出数」（降级链据此选 15s / 8s 节奏）
      if (prev === null) {
        runOnJS(onAttached)(true);
        return;
      }
      // ① 运动判定（原 JS 端处方 1 的语义，搬进 UI 线程）：相邻读数变化量（pitch/roll 取大者）
      //    > 阈值 = 运动中 → 静止计数清零；否则 +1（封顶在确认帧数，只用于比较）
      const delta = Math.max(Math.abs(curr.pitch - prev.pitch), Math.abs(curr.roll - prev.roll));
      calm.value = delta > MOTION_DELTA_THRESHOLD ? 0 : Math.min(calm.value + 1, STILL_CALM_FRAMES);
      // ② 倾斜跟随（处方 4：扫光播放中不更新位置 → 播完自然回到跟随）
      if (sweepOn.value) return;
      // pitch（前后倾）里含一个恒定的"握姿分量"：用缓慢跟随的基线扣掉它，只把晃动映射进
      // 高光位置 —— 正常拿手机轻微晃动也能看到移动（处方 5）
      if (Number.isNaN(pitchBase.value)) pitchBase.value = curr.pitch;
      else pitchBase.value += (curr.pitch - pitchBase.value) * BETA_BASELINE_EMA;
      // 倾角夹到 ±22.5°（计划 5.10 第 2 条）再归一；roll 0.65 / pitch 0.35 合成（用户校准权重）；
      // 120ms 重定向式低通 = 光带"滑过"而不是抖
      const rollPos = clamp1(curr.roll / TILT_MAX_RAD);
      const pitchPos = clamp1((curr.pitch - pitchBase.value) / TILT_MAX_RAD);
      tiltPos.value = withTiming(clamp1(rollPos * (1 - BETA_WEIGHT) + pitchPos * BETA_WEIGHT), {
        duration: TILT_FOLLOW_MS,
        easing: Easing.linear,
      });
    }
  );

  // 卸载 = useAnimatedSensor 自带 unregister + 通知 hook 回到「无传感器」节奏
  useEffect(() => () => onAttached(false), [onAttached]);

  return null;
}

/**
 * 通用光带：宿主绝对铺满、自身量宽 → 光带按比例宽度在宿主上从左外滑到右外。
 * 位置源：扫光播放中取 sweepPos，否则取 tiltPos（倾斜跟随）。
 * 整体透明度 = intensity（无 intensity 时用 fixedOpacity）。
 */
function SheenBand({
  tiltPos,
  sweepPos,
  sweepOn,
  intensity,
  colors,
  locations,
  bandRatio,
  fixedOpacity,
  minBand = 48,
  maxBand = 140,
  rotateDeg = 0,
  bleedY = 0,
}: {
  tiltPos: SharedValue<number>;
  sweepPos?: SharedValue<number>;
  sweepOn?: SharedValue<boolean>;
  intensity?: SharedValue<number> | null;
  colors: readonly [string, string, ...string[]];
  locations: readonly [number, number, ...number[]];
  bandRatio: number;
  fixedOpacity?: number;
  minBand?: number; // 光带宽度下限
  maxBand?: number; // 光带宽度上限
  rotateDeg?: number; // 光带倾角（0 = 不斜；卡面光带 20°）
  bleedY?: number; // 纵向出血（斜带要盖满宿主高度；宿主自己裁切）
}) {
  const [w, setW] = useState(0);
  // 光带宽度随宿主宽度自适应：金额取 0.55（夹 48~140）、卡顶光缝 0.32、卡面光带 0.70（不设上限）
  const bandW = Math.max(minBand, Math.min(maxBand, w * bandRatio));
  const animStyle = useAnimatedStyle(() => {
    const raw = sweepOn && sweepOn.value ? (sweepPos?.value ?? 0) : tiltPos.value;
    const t = Math.max(-SWEEP_EDGE, Math.min(SWEEP_EDGE, raw));
    const u = (t + SWEEP_EDGE) / (2 * SWEEP_EDGE); // 0..1（越界已饱和）
    return {
      transform: [{ translateX: -bandW + u * (w + bandW) }, { rotate: `${rotateDeg}deg` }],
      opacity: (fixedOpacity ?? 1) * (intensity ? intensity.value : 1),
    };
  });
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
          style={[
            { position: 'absolute', top: -bleedY, bottom: -bleedY, left: 0, width: bandW },
            animStyle,
          ]}
        >
          <LinearGradient
            colors={colors}
            locations={locations}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

/**
 * 金额数字上的两层（覆盖在可见金额 Text 之上；宿主尺寸 = 文字尺寸，逐像素对齐）：
 *  ① 金属底色层：数字本身 = 竖向金属渐变（底色比纯白低一档）
 *  ② 流光层：近纯白亮芯的光带（两端同色 alpha 0）
 * maskElement = 同一串金额、同字号/同字重/同字距的黑色文字（纯 alpha 遮罩）；
 * T11：T08 把净资产拆成「RM + 整数 + 小数」三段不同字号后，遮罩必须逐像素对齐 → 可用
 * maskElement 传入与可见文字完全相同的 AppText 结构；不传则用 text/fontSize 自建（向后兼容）。
 * ⚠ 不带 dayTextShadow —— 投影留在下层可见 Text 上（可读性 + 紫投影都在，且投影不进遮罩）。
 */
export function AmountSheen({
  text,
  fontSize,
  maskElement,
  palette,
  sheen,
}: {
  text: string;
  fontSize: number;
  maskElement?: React.ReactNode;
  palette: HeroSheenPalette;
  sheen: HeroSheen;
}) {
  // Web：masked-view 的 Web 实现只渲染遮罩本身（黑字），不裁子层 → 直接不渲染这两层
  if (Platform.OS === 'web') return null;
  const { tiltPos, sweepPos, sweepOn, intensity } = sheen;
  // 两层共用同一个遮罩节点；传了 maskElement 就完全用它（逐像素对齐三段排版）。
  // MaskedView 的 maskElement 只接受单个元素（字符串/fragment 会破坏遮罩）→ 校验后使用，
  // 未传或非法时退回自带的单串文字遮罩（= 原有行为）
  const mask = React.isValidElement(maskElement) ? (
    maskElement
  ) : (
    <Text style={{ fontSize, fontWeight: '700', letterSpacing: 0, color: '#000' }} numberOfLines={1}>
      {text}
    </Text>
  );
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* ① 金属底色层（处方 1）：数字本身显示竖向金属渐变，整体比纯白低一档 → 给高光留空间 */}
      <MaskedView style={StyleSheet.absoluteFill} maskElement={mask}>
        <LinearGradient
          colors={[palette.metalTop, palette.metalMid, palette.metalBottom]}
          locations={[0, 0.5, 1] as const}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </MaskedView>
      {/* ② 流光层（处方 2/3）：亮芯≈纯白（扫过明显变亮）；两端 = 相邻色同色 alpha 0 */}
      <MaskedView style={StyleSheet.absoluteFill} maskElement={mask}>
        <SheenBand
          tiltPos={tiltPos}
          sweepPos={sweepPos}
          sweepOn={sweepOn}
          intensity={intensity}
          colors={[zeroAlpha(palette.shoulderA), palette.shoulderA, palette.core, palette.shoulderB, zeroAlpha(palette.shoulderB)]}
          locations={SHEEN_STOPS}
          bandRatio={0.55}
        />
      </MaskedView>
    </View>
  );
}

/**
 * 卡顶内高光（T11：处方 6 的 1.5dp 光缝 → 1px 内高光、偏冷白 —— 计划 5.10 第 4 条）：
 * 随倾斜左右移动、扫光时同步亮一下（透明度 = intensity：静止 0.5 → 扫光 1.0）；
 * 放在卡内 top 0，被 assetCard 的 overflow hidden + 圆角 20 裁切。
 */
export function HeroEdgeSheen({ palette, sheen }: { palette: HeroSheenPalette; sheen: HeroSheen }) {
  const { tiltPos, intensity } = sheen;
  // 与卡面光带同一条推导（计划 5.10 第 3 条：窗口 25–40% + 略偏冷）→ 亮芯 alpha 0.32、冷白
  const core = remapSheenCore(palette.core);
  const coreZero = zeroAlpha(core);
  return (
    <View pointerEvents="none" style={styles.edgeWrap}>
      <SheenBand
        tiltPos={tiltPos}
        intensity={intensity}
        colors={[coreZero, core, coreZero]}
        locations={[0, 0.5, 1] as const}
        bandRatio={0.32}
      />
    </View>
  );
}

/**
 * 卡面扫光层（修正 20 处方 1/2/4/6）：宽光带（≈卡宽 70%、斜 20°）在卡片背景渐变之上、
 * 所有内容之下（内容是后画的 → 扫光不覆盖按钮/文字/金额/预算面板）；
 * 与数字流光共用同一套 tiltPos/sweepPos → 光掠过数字时数字同时变亮（一个光源）；
 * 被 Hero 卡的 borderRadius + overflow hidden 裁切，pointerEvents none（不挡点击）。
 * T11 质感（计划 5.10 第 3 条）：亮芯 → 冷白 + alpha 0.32（窗口 25–40%），两肩按同比例缩放；
 * 陀螺仪订阅点也挂在本层（Hero 卡在就必然渲染它 → 不用改 HomeScreen 调用点）。
 */
export function HeroCardSheen({ palette, sheen }: { palette: HeroSheenPalette; sheen: HeroSheen }) {
  const { tiltPos, sweepPos, sweepOn, intensity } = sheen;
  const coreAlpha = parseRgba(palette.cardCore)?.[3]; // 原芯 alpha = 肩色缩放的基准
  const shoulderScale = coreAlpha ? SHEEN_CORE_ALPHA / coreAlpha : 1;
  const core = remapSheenCore(palette.cardCore);
  const shoulderA = scaleSheenAlpha(palette.cardShoulderA, shoulderScale);
  const shoulderB = scaleSheenAlpha(palette.cardShoulderB, shoulderScale);
  const sensorBridge = sensorBridgeOf(sheen);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <SheenBand
        tiltPos={tiltPos}
        sweepPos={sweepPos}
        sweepOn={sweepOn}
        intensity={intensity}
        colors={[zeroAlpha(shoulderA), shoulderA, core, shoulderB, zeroAlpha(shoulderB)]}
        locations={SHEEN_STOPS}
        bandRatio={0.7}
        minBand={0}
        maxBand={Number.MAX_SAFE_INTEGER} // 卡面光带不做宽度上限（≈卡宽 70%）
        rotateDeg={CARD_SHEEN_ROTATE_DEG}
        bleedY={CARD_SHEEN_BLEED_Y}
      />
      {/* T11：传感器订阅点（原生端 + 聚焦 + 前台 + 非减少动效才真正挂载；Web 永不订阅） */}
      {sensorBridge && <HeroTiltSensor sheen={sheen} bridge={sensorBridge} />}
    </View>
  );
}

/**
 * Hero 卡外层阴影容器（T11 新增；计划 5.10 第 4 条：卡片阴影随倾斜反向微移 —— 光源在上方）。
 * 把调用方的静态阴影 style 原样合并进去（只动 x、保留其 y 偏移与全部参数），原生端 + 非减少动效
 * 时才产生动画属性；Web / 减少动效 → 不产生任何动画属性（只渲染静态 style，Web 预览与现状一致）。
 * 接入方式：<HeroCardShadow sheen={heroSheen} style={styles.assetCardShadow}><卡…/></HeroCardShadow>
 */
export function HeroCardShadow({
  sheen,
  style,
  children,
}: {
  sheen: HeroSheen;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}): React.ReactElement {
  const { tiltPos } = sheen;
  const reduceMotion = useReducedMotion();
  const animate = Platform.OS !== 'web' && !reduceMotion; // JS 端先算好，worklet 只捕获这个布尔
  // 调用方阴影的 y 偏移原样保留（如 assetCardShadow 的 height 13）—— 只动 x，否则阴影会"掉下来"
  const baseOffsetY = StyleSheet.flatten<ViewStyle>(style)?.shadowOffset?.height ?? 0;
  const drift = useAnimatedStyle(() => {
    if (!animate) return {};
    return { shadowOffset: { width: -tiltPos.value * SHADOW_DRIFT_PX, height: baseOffsetY } };
  });
  return <Animated.View style={[style, drift]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  edgeWrap: { position: 'absolute', top: 0, left: 0, right: 0, height: 1 }, // 1px 内高光（T11）
});
