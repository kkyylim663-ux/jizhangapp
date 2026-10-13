// StartupSkeleton.tsx
// 冷启动骨架屏：数据还没从本地存储读完时，首页位置上先铺一层与最终版式同形的灰块
// （顶栏两颗胶囊 / 金额块 + 圆点 / 预算卡 / 5 行账单），让「等待」看起来是在加载而不是卡住。
//
// 铁律：
// - 不写任何文字、不放按钮、不出现「还没有记账 / 添加账户」这类空态文案；
// - 只做 transform（translateX）的扫光动画，由一个共享值驱动，全在 UI 线程；
// - 减少动态效果（系统开关）时：静态灰块，不扫光；
// - 颜色全部取 semantic 令牌（块色 = surface，扫光 = textPrimary 的极低透明度）。
import React, { useEffect } from 'react';
import { StyleSheet, View, ViewStyle, useWindowDimensions } from 'react-native';
import Reanimated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme/useTheme';
import { useMotion } from '../../theme/motion';
import { withAlpha } from './color';

/** 扫光带宽度（逻辑像素） */
const SWEEP_W = 180;
/** 一轮扫光时长（ms）：慢一点，避免看起来像闪烁 */
const SWEEP_MS = 1500;

export function StartupSkeleton() {
  const { semantic, layout, spacing, radius, isDark } = useTheme();
  const motion = useMotion();
  const { width } = useWindowDimensions();
  const sweep = useSharedValue(0);

  useEffect(() => {
    if (motion.reduceMotion) return;
    sweep.value = withRepeat(withTiming(1, { duration: SWEEP_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(sweep);
  }, [motion.reduceMotion, sweep]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -SWEEP_W + sweep.value * (width + SWEEP_W) }],
  }));

  const blockColor = semantic.surface;
  const hi = withAlpha(semantic.textPrimary, isDark ? 0.08 : 0.06);
  const clear = withAlpha(semantic.textPrimary, 0);

  // 一块灰：圆角 + 裁切；扫光带叠在上面（静态时不渲染）
  const Bone = ({ style }: { style: ViewStyle }) => (
    <View style={[styles.bone, { backgroundColor: blockColor }, style]}>
      {!motion.reduceMotion ? (
        <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { width: SWEEP_W }, sweepStyle]}>
          <LinearGradient
            colors={[clear, hi, clear]}
            locations={[0, 0.5, 1]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Reanimated.View>
      ) : null}
    </View>
  );

  const pad = layout.page;
  return (
    <View style={[styles.root, { backgroundColor: semantic.bg, paddingHorizontal: pad }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* 顶栏：左胶囊 + 右两颗圆 */}
      <View style={[styles.topRow, { marginTop: spacing.lg }]}>
        <Bone style={{ width: 112, height: 32, borderRadius: 16 }} />
        <View style={styles.topRight}>
          <Bone style={{ width: 36, height: 36, borderRadius: 18 }} />
          <Bone style={{ width: 36, height: 36, borderRadius: 18 }} />
        </View>
      </View>

      {/* 金额块 + 圆点 */}
      <View style={[styles.heroCol, { marginTop: spacing.xxxl }]}>
        <Bone style={{ width: 200, height: 52, borderRadius: radius.md }} />
        <View style={[styles.dotRow, { marginTop: spacing.md }]}>
          <Bone style={{ width: 16, height: 5, borderRadius: 3 }} />
          <Bone style={{ width: 5, height: 5, borderRadius: 3 }} />
          <Bone style={{ width: 5, height: 5, borderRadius: 3 }} />
        </View>
      </View>

      {/* 预算卡 */}
      <Bone style={{ marginTop: spacing.xl, height: 76, borderRadius: 24 }} />

      {/* 账单卡：5 行 */}
      <View style={[styles.listCard, { marginTop: spacing.xl, borderRadius: 22, backgroundColor: semantic.homeCard }]}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={[styles.row, { paddingHorizontal: layout.card }]}>
            <Bone style={{ width: 42, height: 42, borderRadius: 21 }} />
            <View style={styles.rowText}>
              <Bone style={{ width: '55%', height: 12, borderRadius: 6 }} />
              <Bone style={{ width: '35%', height: 10, borderRadius: 5 }} />
            </View>
            <Bone style={{ width: 64, height: 14, borderRadius: 7 }} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  bone: { overflow: 'hidden' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topRight: { flexDirection: 'row', columnGap: 8 },
  heroCol: { alignItems: 'center' },
  dotRow: { flexDirection: 'row', alignItems: 'center', columnGap: 6 },
  listCard: { overflow: 'hidden', paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', columnGap: 12, height: 60 },
  rowText: { flex: 1, rowGap: 8 },
});

export default StartupSkeleton;
