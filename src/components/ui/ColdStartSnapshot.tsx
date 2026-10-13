// ColdStartSnapshot.tsx
// 冷启动「上次快照」：本地数据还没读完时，首页位置先显示上一次的样子（净资产 / 预算 / 最近 3 笔）。
//
// 行为：
// - 净资产数字从 0.00 开始「追赶」快照值（指数衰减，时间常数 ≈ 上次加载耗时 / 2.5，快→慢，中间不停顿）；
//   预算进度条用同一套追赶。
// - 真实数据到达后，目标切换为真实值（时间常数 260ms），从当前位置滑到终值，差值 < 0.005 时精确贴合。
// - 三块依次淡入上浮：金额 0ms、预算 250ms、账单 450ms（只在冷启动显示一次，不在切 Tab 时重放）。
// - 减少动态效果：不追赶、不淡入，直接显示最终值。
// - 覆盖层吃掉触摸：快照期间点击不会触发任何编辑（真实页面此时还不可交互）。
// - 只用于「先看见」，不可编辑；真实页面就绪后整层淡出。
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import type { HomeSnapshot } from '../../services/homeSnapshot';
import { useTheme } from '../../theme/useTheme';
import { useT } from '../../i18n/LanguageContext';
import { formatMoney } from '../../utils/formatMoney';
import { AppText } from './AppText';
import { IconCircle } from './IconCircle';
import { Ionicons } from '@expo/vector-icons';

/** 追赶的时间常数：快照期按上次加载耗时（1.5–6 秒钳制）/2.5 */
const SNAPSHOT_TAU_MIN_MS = 1500;
const SNAPSHOT_TAU_MAX_MS = 6000;
/** 真实数据到达后的收敛时间常数 */
const REAL_TAU_MS = 260;
/** 精确贴合阈值（金额差） */
const SNAP_EPS = 0.005;
/** 精确贴合阈值（进度条占比） */
const FRAC_EPS = 0.0005;
/** 整层淡出时长 */
const FADE_OUT_MS = 180;

function budgetFrac(spent: number, total: number): number {
  return total > 0 ? Math.min(Math.max(spent / total, 0), 1) : 0;
}

export function snapshotTau(loadMs: number): number {
  const clamped = Math.min(Math.max(loadMs, SNAPSHOT_TAU_MIN_MS), SNAPSHOT_TAU_MAX_MS);
  return clamped / 2.5;
}

interface Props {
  /** 上次保存的快照（必有） */
  snap: HomeSnapshot;
  /** 真实数据（读完后才传；传入即开始向真实值收敛） */
  real: HomeSnapshot | null;
  reduceMotion: boolean;
  /** 整层淡出完成后回调（父层据此卸载覆盖层） */
  onSettled: () => void;
}

export function ColdStartSnapshot({ snap, real, reduceMotion, onSettled }: Props) {
  const { semantic, layout, spacing, radius } = useTheme();
  const t = useT();

  const startNet = reduceMotion ? snap.netWorth : 0;
  const startFrac = reduceMotion ? budgetFrac(snap.budgetSpent, snap.budgetTotal) : 0;
  const [net, setNet] = useState(startNet);
  const [frac, setFrac] = useState(startFrac);
  const netV = useRef(startNet);
  const fracV = useRef(startFrac);
  // 当前追赶目标：快照期 = 快照值（慢常数）；真实数据到达后 = 真实值（260ms）
  const target = useRef({
    net: snap.netWorth,
    frac: budgetFrac(snap.budgetSpent, snap.budgetTotal),
    tau: snapshotTau(snap.loadMs),
    real: false,
  });
  const settled = useRef(false);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  // 三块淡入上浮的进度（0→1）；减少动态效果时直接到 1
  const heroP = useSharedValue(reduceMotion ? 1 : 0);
  const budgetP = useSharedValue(reduceMotion ? 1 : 0);
  const listP = useSharedValue(reduceMotion ? 1 : 0);
  const outP = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) return;
    const cfg = { duration: 240, easing: Easing.out(Easing.cubic) };
    heroP.value = withTiming(1, cfg);
    budgetP.value = withDelay(250, withTiming(1, cfg));
    listP.value = withDelay(450, withTiming(1, cfg));
  }, [reduceMotion, heroP, budgetP, listP]);

  const heroStyle = useAnimatedStyle(() => ({
    opacity: heroP.value,
    transform: [{ translateY: (1 - heroP.value) * 12 }],
  }));
  const budgetStyle = useAnimatedStyle(() => ({
    opacity: budgetP.value,
    transform: [{ translateY: (1 - budgetP.value) * 12 }],
  }));
  const listStyle = useAnimatedStyle(() => ({
    opacity: listP.value,
    transform: [{ translateY: (1 - listP.value) * 12 }],
  }));
  const rootStyle = useAnimatedStyle(() => ({ opacity: outP.value }));

  // 真实数据到达：切换目标（减少动态效果时直接显示终值）
  useEffect(() => {
    if (!real) return;
    target.current = {
      net: real.netWorth,
      frac: budgetFrac(real.budgetSpent, real.budgetTotal),
      tau: REAL_TAU_MS,
      real: true,
    };
    if (reduceMotion) {
      netV.current = real.netWorth;
      fracV.current = target.current.frac;
      setNet(real.netWorth);
      setFrac(target.current.frac);
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, reduceMotion]);

  function finish() {
    if (settled.current) return;
    settled.current = true;
    if (reduceMotion) {
      onSettledRef.current();
      return;
    }
    const cb = onSettledRef.current;
    outP.value = withTiming(0, { duration: FADE_OUT_MS, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(cb)();
    });
  }

  // 追赶循环（JS 侧 rAF，每帧只更新这个小组件的两个数字）：
  // v += (target − v) × (1 − e^(−dt/τ))。真实值到达后继续跑到贴合才停。
  useEffect(() => {
    if (reduceMotion) return;
    let raf = 0;
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      const dt = Math.min(now - last, 100);
      last = now;
      const tg = target.current;
      const k = 1 - Math.exp(-dt / tg.tau);
      netV.current += (tg.net - netV.current) * k;
      fracV.current += (tg.frac - fracV.current) * k;
      if (Math.abs(tg.net - netV.current) < SNAP_EPS) netV.current = tg.net;
      if (Math.abs(tg.frac - fracV.current) < FRAC_EPS) fracV.current = tg.frac;
      setNet(netV.current);
      setFrac(fracV.current);
      if (tg.real && netV.current === tg.net && fracV.current === tg.frac) {
        finish();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const decimals = snap.decimals;
  const rows = snap.recent;

  return (
    // pointerEvents 默认 auto：覆盖层吃掉所有触摸，快照期间不会误触编辑
    <Reanimated.View style={[StyleSheet.absoluteFill, { backgroundColor: semantic.bg, paddingHorizontal: layout.page }, rootStyle]}>
      {/* 顶栏占位（不放图标，避免与真实页面的图标错位） */}
      <View style={[styles.topRow, { marginTop: spacing.lg }]}>
        <View style={[styles.pill, { backgroundColor: semantic.surface, width: 112 }]} />
        <View style={styles.topRight}>
          <View style={[styles.round, { backgroundColor: semantic.surface }]} />
          <View style={[styles.round, { backgroundColor: semantic.surface }]} />
        </View>
      </View>

      {/* 净资产（追赶中的数字） */}
      <Reanimated.View style={[styles.heroCol, { marginTop: spacing.xxxl }, heroStyle]}>
        <AppText variant="display" color={semantic.textPrimary} numberOfLines={1} style={styles.heroAmount}>
          {formatMoney(net, { decimals })}
        </AppText>
      </Reanimated.View>

      {/* 预算卡 */}
      <Reanimated.View
        style={[
          styles.card,
          { backgroundColor: semantic.homeCard, borderRadius: 24, padding: layout.card, marginTop: spacing.xl },
          budgetStyle,
        ]}
      >
        <View style={styles.budgetHead}>
          <AppText variant="footnote" weight="500" color={semantic.textSecondary}>
            {t('home.budgetLabel')}
          </AppText>
          <AppText variant="footnote" color={semantic.textSecondary}>
            {snap.budgetTotal > 0 ? `${formatMoney(snap.budgetSpent, { decimals })} / ${formatMoney(snap.budgetTotal, { decimals })}` : ''}
          </AppText>
        </View>
        <View style={[styles.track, { backgroundColor: semantic.hairline, marginTop: spacing.sm }]}>
          <View style={[styles.fill, { backgroundColor: semantic.accent, width: `${Math.round(frac * 100)}%` }]} />
        </View>
      </Reanimated.View>

      {/* 账单（最近 3 笔） */}
      <Reanimated.View
        style={[styles.card, { backgroundColor: semantic.homeCard, borderRadius: 22, marginTop: spacing.xl, paddingVertical: spacing.xs }, listStyle]}
      >
        {rows.length === 0 ? (
          <View style={{ height: 60 }} />
        ) : (
          rows.map((r) => (
            <View key={r.id} style={[styles.row, { paddingHorizontal: layout.card }]}>
              <IconCircle color={r.color} icon={r.icon as React.ComponentProps<typeof Ionicons>['name']} />
              <View style={styles.rowText}>
                <AppText variant="subhead" weight="500" numberOfLines={1}>
                  {r.title}
                </AppText>
                {!!r.subtitle && (
                  <AppText variant="caption" color={semantic.textSecondary} numberOfLines={1}>
                    {r.subtitle}
                  </AppText>
                )}
              </View>
              <AppText
                variant="body"
                color={r.type === 'income' ? semantic.amountIncome : semantic.amountExpense}
                style={styles.rowAmount}
              >
                {formatMoney(r.amount, { kind: r.type, decimals })}
              </AppText>
            </View>
          ))
        )}
      </Reanimated.View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topRight: { flexDirection: 'row', columnGap: 8 },
  pill: { height: 32, borderRadius: 16 },
  round: { width: 36, height: 36, borderRadius: 18 },
  heroCol: { alignItems: 'center' },
  heroAmount: { textAlign: 'center' },
  card: { overflow: 'hidden' },
  budgetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  row: { flexDirection: 'row', alignItems: 'center', columnGap: 12, minHeight: 60, paddingVertical: 9 },
  rowText: { flex: 1, minWidth: 0, rowGap: 2 },
  rowAmount: { marginLeft: 8 },
});

export default ColdStartSnapshot;
