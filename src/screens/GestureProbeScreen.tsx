import React, { useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView as GhScrollView } from 'react-native-gesture-handler';
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useTheme } from '../theme/useTheme';
import { useT } from '../i18n/LanguageContext';

/**
 * 手势诊断页（临时）：定位「账本弹层上滑滚不动」的坏点。
 * 四个测试区各验一个假设，横条显示手势是否拦截了滚动：
 * - A. 纯 GH ScrollView（无任何手势）：应能正常上滑滚动
 * - B. GH ScrollView + Pan(activeOffsetY/-failOffsetY + simultaneousWithExternalGesture)：官方方案，应能滚动且按钮显示 Pan 未拦截
 * - C. GH ScrollView + Pan.manualActivation 未决拦截：复现旧 bug 的对照组（预期：滚不动）
 * - D. 原生 RN ScrollView（无手势）：对照组
 */

type LogFn = (msg: string) => void;

function makeRow(colors: { card: string; textPrimary: string; dividerHair: string }) {
  return {
    row: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 12,
      marginBottom: 14,
      borderWidth: 1,
      borderColor: colors.dividerHair,
    },
    label: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
    badge: { fontSize: 12, fontWeight: '600', color: colors.textPrimary, marginTop: 6 },
    filler: { fontSize: 13, color: colors.textPrimary, lineHeight: 30, height: 340 },
  } as const;
}

export default function GestureProbeScreen() {
  const { colors } = useTheme();
  const tr = useT();
  const [log, setLog] = useState<string[]>([]);
  const addLog: LogFn = (msg) => setLog((prev) => [`${new Date().toLocaleTimeString()} ${msg}`, ...prev].slice(0, 6));

  const s = makeRow(colors);

  // ---- B 区：官方方案 ----
  const bScrollRef = useRef<any>(null);
  const bPan = Gesture.Pan()
    .activeOffsetY(12)
    .failOffsetY(-12)
    .simultaneousWithExternalGesture(bScrollRef)
    .onUpdate((e) => addLog(`B Pan update y=${Math.round(e.translationY)}`))
    .onEnd(() => addLog('B Pan end(activated)'));

  // ---- C 区：manualActivation 未决拦截（复现组） ----
  const cPan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown(() => {})
    .onTouchesMove((_e, sm) => {
      // 永不激活也永不 fail → 未决态拦截（旧账本弹层行为）
      void sm;
    })
    .onEnd(() => addLog('C Pan end'));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1, padding: 16 }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.textPrimary }}>
          手势诊断 GestureProbe
        </Text>
        <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2, marginBottom: 10 }}>
          {tr('pin.subtitle') === '6 位数字' ? '每个区域试着【上滑】滚动到底，看右侧/下方结论' : 'Swipe UP in each zone to scroll'}
        </Text>

        <GhScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }}>
          {/* A. 纯 GH ScrollView */}
          <View style={s.row}>
            <Text style={s.label}>A · GH ScrollView（无手势）</Text>
            <GhScrollView nestedScrollEnabled style={{ height: 160 }} contentContainerStyle={{}}>
              <Text style={s.filler}>{Array.from({ length: 14 }).map((_, i) => `A 行 ${i + 1}`).join('\n')}</Text>
            </GhScrollView>
            <Text style={s.badge}>期望：能滚动 = ScrollView 本身正常</Text>
          </View>

          {/* B. 官方方案 */}
          <View style={s.row}>
            <Text style={s.label}>B · GH ScrollView + Pan 协同（官方方案）</Text>
            <GestureDetector gesture={bPan}>
              <GhScrollView
                ref={bScrollRef}
                nestedScrollEnabled
                style={{ height: 160 }}
              >
                <Text style={s.filler}>{Array.from({ length: 14 }).map((_, i) => `B 行 ${i + 1}`).join('\n')}</Text>
              </GhScrollView>
            </GestureDetector>
            <Text style={s.badge}>期望：能滚动 = 官方方案在你设备上有效（主修复方向正确）</Text>
          </View>

          {/* C. 复现组 */}
          <View style={s.row}>
            <Text style={s.label}>C · manualActivation 未决拦截（复现旧 bug）</Text>
            <GestureDetector gesture={cPan}>
              <GhScrollView nestedScrollEnabled style={{ height: 160 }}>
                <Text style={s.filler}>{Array.from({ length: 14 }).map((_, i) => `C 行 ${i + 1}`).join('\n')}</Text>
              </GhScrollView>
            </GestureDetector>
            <Text style={s.badge}>预期：滚不动 = 证明旧实现确实是这个原因</Text>
          </View>

          {/* D. 原生 ScrollView */}
          <View style={s.row}>
            <Text style={s.label}>D · 原生 RN ScrollView（无手势）</Text>
            <GhScrollView nestedScrollEnabled style={{ height: 160 }} renderToHardwareTextureAndroid={false}>
              <Text style={s.filler}>{Array.from({ length: 14 }).map((_, i) => `D 行 ${i + 1}`).join('\n')}</Text>
            </GhScrollView>
            <Text style={s.badge}>期望：能滚动（对照组）</Text>
          </View>

          {/* 日志 */}
          <View style={[s.row, { minHeight: 110 }]}>
            <Text style={s.label}>手势事件日志（B 区 Pan 激活会出现在这里）</Text>
            {log.length === 0 ? (
              <Text style={{ fontSize: 12, color: colors.textSecondary }}>（空）</Text>
            ) : (
              log.map((l, i) => (
                <Text key={i} style={{ fontSize: 11, color: colors.textPrimary }}>
                  {l}
                </Text>
              ))
            )}
          </View>
        </GhScrollView>
      </View>
    </SafeAreaView>
  );
}

// Reanimated 引用占位（避免未使用告警；实际动画在主工程内验证）
export const __probeAnim = { useSharedValue, useAnimatedStyle, withSpring, Reanimated };
