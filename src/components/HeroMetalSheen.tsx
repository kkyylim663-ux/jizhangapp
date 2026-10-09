/**
 * Hero 金额卡金属光泽（2026-10-08 按用户处方重做；同日修正 19 按处方二轮：从"看不见"到"看得见"）
 *
 * 结构（三层，全部只在金额文字区内）：
 *  ① 下层 = HomeScreen 的可见 Text（原字色 + dayTextShadow 投影，保可读性，未动）；
 *  ② 金属底色层（MaskedView）= 金额数字本身显示一层「竖向金属渐变」：
 *     夜 #FFFFFF→#CFC4F5→#F2EEFF（拉丝银紫）/ 日 #FFFFFF→#E9E1FF→#FFFFFF；
 *     底色整体比纯白低一档 —— 给近纯白的流光亮芯留出亮度差
 *     （根因：白字上叠浅色高光 = 看不见，处方 1）；
 *  ③ 流光层（MaskedView）= 5 停光带：两端与相邻色同色、alpha 0
 *     （不用 'transparent' —— Android 上它是透明黑、边缘发灰，处方 3）；
 *     亮芯≈纯白（夜 rgba(255,255,255,1) / 日 rgba(255,250,235,1)）→ 扫过时明显变亮；
 *     两肩保留轻微彩虹偏色。整体亮度：静止 0.5 / 扫光峰值 1.0。
 *  ④ 卡面扫光层（HeroCardSheen，2026-10-08 修正 20 处方）= 与数字流光**共用同一套 sweepPos/tiltPos**
 *     的宽光带：卡片背景渐变之上、所有内容之下（按钮/文字/金额/预算面板都不被覆盖），
 *     宽度≈卡宽 70%、斜 20°、5 停渐变两端同色 alpha 0、亮芯 alpha 夜≈0.12（冷紫白）/ 日≈0.22（暖白）；
 *     被卡的 borderRadius + overflow hidden 裁切，pointerEvents none。
 *     共用一个位置驱动 → 光掠过数字时数字同时变亮，视觉上是一个光源。
 *
 * 运动（处方 4/5/6）：
 *  - 陀螺仪：gamma（左右）绝对映射 + beta（前后）**相对缓慢基线的晃动分量**映射
 *    （正常持握的姿势分量被基线扣掉，轻微晃动也能看到高光移动）；120ms 平滑插值；
 *    扫光播放中不被倾斜打断。
 *  - 自动扫光（修正 21 处方 1-8）：**运动中不扫**——用相邻读数的倾斜变化量（|Δbeta|/|Δgamma| 取大者
 *    > `MOTION_DELTA_THRESHOLD` 0.02rad）判定运动中；连续 `STILL_CONFIRM_MS`(1.5s) 低于阈值才判
 *    「完全静止」，此后每 `STILL_SWEEP_INTERVAL_MS`(15s) 自动扫一次；一旦再动立刻取消计时
 *    （正在播放的扫光不打断，播完自然回到倾斜跟随）；进首页/金额变化/眼睛三个触发保持不变并重置 15s 计时；
 *    无传感器设备 = 视为一直静止（同样 15s 一次）；失焦/后台清计时器、回来重新判断。
 *    进首页的那次扫光延迟 ~600ms（等页面渲染完成；延时在 HomeScreen 的 useFocusEffect 里做）。
 *  - 卡顶光缝：1.5dp、透明度=强度（静止 0.5 → 扫光 1.0，同步亮一下）；被卡圆角裁切。
 *
 * 降级（处方 7）：系统「减少动态效果」→ 不订阅陀螺仪、不循环扫光，只保留静态效果（光带停正中）；
 * 无传感器的设备 → 只保留自动循环 + 触发扫光；Web / 订阅失败（T11a）→ 同样不订阅陀螺仪、
 * 退回自动扫光（15s 一次），流光照常显示、不白屏；
 * Web：masked-view 的 Web 实现只渲染遮罩本身（不裁子层）→ 本组件整体不渲染（Web 只是预览环境，真机不受影响）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { DeviceMotion } from 'expo-sensors';
import type { DeviceMotionMeasurement } from 'expo-sensors';
import MaskedView from '@react-native-masked-view/masked-view';

const GAMMA_MAX_RAD = 0.35; // ±20°（左右倾）映射满行程：小倾角即可见
const BETA_MAX_RAD = 0.35; // ±20°（前后倾「晃动分量」）映射满行程
const BETA_WEIGHT = 0.35; // 合成权重：gamma 0.65 / beta 0.35
const BETA_BASELINE_EMA = 0.015; // beta 缓慢基线跟随速度（~30Hz 下 τ≈2.7s：姿势分量被扣掉，只留晃动）
const TILT_FOLLOW_MS = 120; // 倾斜跟随的平滑时长（重定向式低通；手机不动 = 完全静止）
const SWEEP_MS = 2200; // 扫光时长（修正 20 处方 3：ease-in-out ≈2.2s；数字流光与卡面光带同拍）
// ── 自动扫光的运动判定（2026-10-08 修正 21 处方 1；三个阈值都放成常量方便调）──
const MOTION_DELTA_THRESHOLD = 0.02; // rad：相邻两次读数（beta/gamma 取大者）的变化量超过它 = 运动中
const STILL_CONFIRM_MS = 1500; // 连续低于阈值达到这么久 = 判定「完全静止」
const STILL_SWEEP_INTERVAL_MS = 15000; // 完全静止后每 15s 自动扫一次
const SWEEP_EDGE = 1.15; // 扫光端点：±1.15 = 光带完全滑出笔画（-1.15 左外 → +1.15 右外）
const CARD_SHEEN_ROTATE_DEG = 20; // 卡面光带倾角（修正 20 处方 2）
const CARD_SHEEN_BLEED_Y = 60; // 卡面光带的纵向出血（斜 20° 后要盖满卡高；由卡的 overflow hidden 裁切）
const IDLE_INTENSITY = 0.5; // 静止/倾斜跟随时的整体亮度（扫光峰值 = 1）
const SWEEP_INTENSITY = 1;
const SHEEN_STOPS = [0, 0.22, 0.5, 0.78, 1] as const;

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
// 处方 3：渐变两端必须「同色 + alpha 0」（Android 上 'transparent' = 透明黑，边缘发灰）
const zeroAlpha = (c: string) => c.replace(/[\d.]+\)\s*$/, '0)');

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

/**
 * 陀螺仪驱动 + 自动循环的共享值。
 * active = 页面是否聚焦（HomeScreen 用 useFocusEffect 传；失焦/后台不订阅、不循环）。
 */
export function useHeroSheen({ active }: { active: boolean }): HeroSheen {
  const reduceMotion = useReducedMotion();
  const [sensorOk, setSensorOk] = useState(false);
  const [appActive, setAppActive] = useState(true);
  const tiltPos = useSharedValue(0);
  const sweepPos = useSharedValue(0);
  const sweepOn = useSharedValue(false);
  const intensity = useSharedValue(IDLE_INTENSITY);
  const betaNeutralRef = useRef<number | null>(null); // beta 的缓慢基线（每次订阅重新取握姿）

  // ── 运动状态机（修正 21）：moving = 只跟随倾斜；still = 每 15s 自动扫一次 ──
  const enabledRef = useRef(false); // 聚焦 + 前台 + 非减少动效
  const motionStateRef = useRef<'moving' | 'still'>('moving'); // 无传感器时置为 'still'（处方 7）
  const lastRotRef = useRef<{ beta: number; gamma: number } | null>(null);
  const stillConfirmRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSweepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sweepFnRef = useRef<() => void>(() => {}); // 计时器永远调最新的 sweep 实现

  const clearStillConfirm = () => {
    if (stillConfirmRef.current) clearTimeout(stillConfirmRef.current);
    stillConfirmRef.current = null;
  };
  const clearAutoSweep = () => {
    if (autoSweepTimerRef.current) clearInterval(autoSweepTimerRef.current);
    autoSweepTimerRef.current = null;
  };
  // 重排自动扫光计时：只有「条件允许 + 当前完全静止」才排；运动中一律不排（处方 2/3/5）
  const rescheduleAutoSweep = () => {
    clearAutoSweep();
    if (!enabledRef.current || motionStateRef.current !== 'still') return;
    autoSweepTimerRef.current = setInterval(() => sweepFnRef.current(), STILL_SWEEP_INTERVAL_MS);
  };
  // 连续低于阈值 1.5s → 判定完全静止 → 开始 15s 计时（处方 1/3）
  const confirmStill = () => {
    stillConfirmRef.current = null;
    if (!enabledRef.current) return;
    motionStateRef.current = 'still';
    rescheduleAutoSweep();
  };

  // 传感器可用性探测：无陀螺仪的设备（与 Web）拿不到 → 仍保留自动循环 + 触发扫光
  useEffect(() => {
    // T11a：Web 端 expo-sensors 的 DeviceMotion 没有对应原生模块，addListener 会直接抛
    // "this._nativeModule.addListener is not a function"（整页白屏）→ 直接判为不可用，不订阅。
    if (Platform.OS === 'web') {
      setSensorOk(false);
      return;
    }
    let mounted = true;
    DeviceMotion.isAvailableAsync()
      .then((ok) => {
        if (mounted) setSensorOk(!!ok);
      })
      .catch(() => {
        if (mounted) setSensorOk(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // 后台不订阅（省电）：回前台恢复
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // 倾斜 → 高光位置：仅「页面聚焦 + App 在前台 + 有传感器 + 未开减少动效」时订阅
  useEffect(() => {
    if (!active || !appActive || !sensorOk || reduceMotion) return;
    const handleRotation = ({ rotation }: DeviceMotionMeasurement) => {
      if (!rotation) return;
      const beta = rotation.beta ?? 0;
      const gamma = rotation.gamma ?? 0;
      // ① 运动判定（处方 1）：相邻读数变化量（beta/gamma 取大者）> 阈值 = 运动中
      const prev = lastRotRef.current;
      lastRotRef.current = { beta, gamma };
      if (prev) {
        const delta = Math.max(Math.abs(beta - prev.beta), Math.abs(gamma - prev.gamma));
        if (delta > MOTION_DELTA_THRESHOLD) {
          // 静止连续中断 → 重新计 1.5s（处方 1/5）
          clearStillConfirm();
          stillConfirmRef.current = setTimeout(confirmStill, STILL_CONFIRM_MS);
          if (motionStateRef.current === 'still') {
            motionStateRef.current = 'moving';
            // 立刻取消 15s 计时（处方 4）；正在播放的扫光不打断 —— 播完后端在笔画外、
            // 完成回调自会把状态交还倾斜跟随
            clearAutoSweep();
          }
        } else if (!stillConfirmRef.current && motionStateRef.current === 'moving') {
          // 本次低于阈值：启动静止确认倒计时（期间任何超阈值读数都会把它重置）
          stillConfirmRef.current = setTimeout(confirmStill, STILL_CONFIRM_MS);
        }
      }
      // ② 倾斜跟随（扫光播放中不更新位置 → 播完自然回到跟随，处方 4）
      if (sweepOn.value) return;
      // beta（前后倾）里含一个恒定的"握姿分量"：用缓慢跟随的基线扣掉它，
      // 只把晃动（相对基线的变化）映射进高光位置 —— 正常拿手机轻微晃动也能看到移动（处方 5）
      if (betaNeutralRef.current == null) betaNeutralRef.current = beta;
      else betaNeutralRef.current += (beta - betaNeutralRef.current) * BETA_BASELINE_EMA;
      const gammaPos = clamp1(gamma / GAMMA_MAX_RAD);
      const betaPos = clamp1((beta - betaNeutralRef.current) / BETA_MAX_RAD);
      const target = clamp1(gammaPos * (1 - BETA_WEIGHT) + betaPos * BETA_WEIGHT);
      tiltPos.value = withTiming(target, { duration: TILT_FOLLOW_MS, easing: Easing.linear });
    };
    let sub: { remove: () => void } | null = null;
    try {
      // T11a：真正碰传感器前才做订阅动作；拿不到（原生模块缺失 / 环境不支持）就退化为
      // 「无传感器」—— 只走自动扫光（15s 一次），流光与静态效果照常显示，绝不白屏
      DeviceMotion.setUpdateInterval(32); // ~30Hz：足够顺滑，也省电
      betaNeutralRef.current = null; // 重新订阅 = 重新取一次握姿基线
      sub = DeviceMotion.addListener(handleRotation);
    } catch (e) {
      console.warn('陀螺仪订阅失败，退回自动扫光：', e);
      setSensorOk(false);
    }
    return () => sub?.remove();
  }, [active, appActive, sensorOk, reduceMotion, sweepOn, tiltPos]);

  // 聚焦/前后台/减少动效/传感器可用性变化 → 清计时器并重新判断（处方 7/8）
  useEffect(() => {
    enabledRef.current = active && appActive && !reduceMotion;
    clearStillConfirm();
    clearAutoSweep();
    lastRotRef.current = null;
    betaNeutralRef.current = null;
    // 无传感器 = 视为一直静止（处方 7）；有传感器 = 先按"运动中"起步，等连续 1.5s 低于阈值再确认静止
    motionStateRef.current = sensorOk ? 'moving' : 'still';
    if (!enabledRef.current) return;
    if (!sensorOk) {
      rescheduleAutoSweep();
      return;
    }
    stillConfirmRef.current = setTimeout(confirmStill, STILL_CONFIRM_MS);
  }, [active, appActive, reduceMotion, sensorOk]);

  // 卸载 → 清掉两个计时器
  useEffect(
    () => () => {
      clearStillConfirm();
      clearAutoSweep();
    },
    []
  );

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
    // 任何扫光（触发 / 自动）都重置 15s 计时（处方 6）；运动中不会排 → 自动扫光只在完全静止时发生
    rescheduleAutoSweep();
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
  }, [reduceMotion, intensity, sweepOn, sweepPos]);

  // 自动扫光的计时器永远调最新的 sweep 实现（sweep 随 reduceMotion 变化时自动跟上）
  useEffect(() => {
    sweepFnRef.current = sweep;
  });

  return { tiltPos, sweepPos, sweepOn, intensity, sweep };
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
 * ⚠ 不带 dayTextShadow —— 投影留在下层可见 Text 上（可读性 + 紫投影都在，且投影不进遮罩）。
 */
export function AmountSheen({
  text,
  fontSize,
  palette,
  sheen,
}: {
  text: string;
  fontSize: number;
  palette: HeroSheenPalette;
  sheen: HeroSheen;
}) {
  // Web：masked-view 的 Web 实现只渲染遮罩本身（黑字），不裁子层 → 直接不渲染这两层
  if (Platform.OS === 'web') return null;
  const { tiltPos, sweepPos, sweepOn, intensity } = sheen;
  const mask = (
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
 * 卡顶光缝（处方 6）：1.5dp 高的一段高光，随倾斜左右移动、扫光时同步亮一下
 * （透明度 = intensity：静止 0.5 → 扫光 1.0）；放在卡内 top 0，
 * 被 assetCard 的 overflow hidden + 圆角 20 裁切。
 */
export function HeroEdgeSheen({ palette, sheen }: { palette: HeroSheenPalette; sheen: HeroSheen }) {
  const { tiltPos, intensity } = sheen;
  const coreZero = zeroAlpha(palette.core);
  return (
    <View pointerEvents="none" style={styles.edgeWrap}>
      <SheenBand
        tiltPos={tiltPos}
        intensity={intensity}
        colors={[coreZero, palette.core, coreZero]}
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
 */
export function HeroCardSheen({ palette, sheen }: { palette: HeroSheenPalette; sheen: HeroSheen }) {
  const { tiltPos, sweepPos, sweepOn, intensity } = sheen;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <SheenBand
        tiltPos={tiltPos}
        sweepPos={sweepPos}
        sweepOn={sweepOn}
        intensity={intensity}
        colors={[
          zeroAlpha(palette.cardShoulderA),
          palette.cardShoulderA,
          palette.cardCore,
          palette.cardShoulderB,
          zeroAlpha(palette.cardShoulderB),
        ]}
        locations={SHEEN_STOPS}
        bandRatio={0.7}
        minBand={0}
        maxBand={Number.MAX_SAFE_INTEGER} // 卡面光带不做宽度上限（≈卡宽 70%）
        rotateDeg={CARD_SHEEN_ROTATE_DEG}
        bleedY={CARD_SHEEN_BLEED_Y}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  edgeWrap: { position: 'absolute', top: 0, left: 0, right: 0, height: 1.5 },
});
