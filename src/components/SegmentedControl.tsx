// SegmentedControl.tsx
// 分段开关（T05 升级 / 计划 4.5）：灰底胶囊槽 + 实底滑块（accent 底 + onAccent 字）。
//
// 本版升级点
// - 高度 36（触控区用外层 padding + 段 hitSlop 补到 44，见 TOUCH_HEIGHT）；
// - 滑块改 Reanimated 弹簧（motion.spring.default）：位移与宽度一起弹，切换是「滑过去」不是「跳过去」；
// - 无障碍：每段 accessibilityRole="button" + accessibilityState.selected，读屏能读出「已选中」；
// - 全部颜色 / 圆角 / 字号改取令牌（semantic / radius / typography）。
//
// 保持不变的（都是用户真机校准过的，别改）
// - props 仍是 { options, selected, onSelect }（设置页 ×3、日历卡 ×1 调用点不用改）；
// - 滑块定位必须逐段 onLayout 实测 —— 段与段文字宽度不同（英文 Expense/Income/Net、中文 中/英），
//   按「槽宽 ÷ 段数」等分推算会让滑块和文字错位（真机截图 bug 换来的一条）；
// - 段最小宽 52：两段开关（中/英）不至于太窄；
// - 首帧几何未测到时滑块先藏起来，实测到位再淡入，避免停在 0 位盖住第一段。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useTheme } from '../theme/useTheme';
import { Radius, SemanticColors } from '../theme/theme';
import { hapticSelection } from '../utils/haptics';
import AppText from './ui/AppText';

export interface SegmentOption {
  label: string;
  value: string;
}

interface Props {
  options: SegmentOption[];
  /** 当前选中的 option.value */
  selected: string;
  /** 点选项立即生效（含重复点已选中项，由调用方决定行为） */
  onSelect: (value: string) => void;
}

/** 槽高（视觉高度） */
const TRACK_HEIGHT = 36;
/** 槽内边距：滑块贴槽内缘留 3 */
const TRACK_PADDING = 3;
/** 触控区高度下限（UI_RULES：可点元素 ≥44pt） */
const TOUCH_HEIGHT = 44;
/** 段最小宽（用户定版：两段开关不至于太窄） */
const SEGMENT_MIN_WIDTH = 52;
/** 每段上下各补多少触控：轨道 36 + 外侧留白 → 整块 44 */
const SEGMENT_HIT_SLOP = (TOUCH_HEIGHT - TRACK_HEIGHT) / 2 + TRACK_PADDING;

export default function SegmentedControl({ options, selected, onSelect }: Props) {
  const { semantic, radius, motion } = useTheme();
  const styles = useMemo(() => makeStyles(semantic, radius), [semantic, radius]);

  // 每段的实测几何：key=value，x 为段左缘在槽坐标系里的位置。
  // 逐段 onLayout 上报 —— 各段文字宽度不同也各自准确（不许改成等分推算）
  const [segFrames, setSegFrames] = useState<Record<string, { x: number; width: number }>>({});
  const onSegmentLayout = (value: string) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setSegFrames((prev) =>
      prev[value]?.x === x && prev[value]?.width === width ? prev : { ...prev, [value]: { x, width } }
    );
  };

  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === selected)
  );
  const active = options[activeIndex];
  const activeFrame = active ? segFrames[active.value] : undefined;

  const thumbX = useSharedValue(0);
  const thumbWidth = useSharedValue(0);
  const thumbOpacity = useSharedValue(0);
  const positioned = useRef(false);

  useEffect(() => {
    if (!activeFrame) return;
    // 首帧（几何未测得）：不播动画直接落位，然后淡入 —— 避免滑块从 0 位滑过去盖住第一段
    if (!positioned.current) {
      positioned.current = true;
      thumbX.value = activeFrame.x;
      thumbWidth.value = activeFrame.width;
      thumbOpacity.value = withTiming(1, { duration: motion.timing.fade, easing: motion.easing.out });
      return;
    }
    thumbX.value = withSpring(activeFrame.x, motion.spring.default);
    thumbWidth.value = withSpring(activeFrame.width, motion.spring.default);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFrame?.x, activeFrame?.width]);

  const thumbStyle = useAnimatedStyle(() => ({
    width: thumbWidth.value,
    opacity: thumbOpacity.value,
    transform: [{ translateX: thumbX.value }],
  }));

  return (
    <View style={styles.touchWrap}>
      <View style={styles.track}>
        <Animated.View style={[styles.thumb, thumbStyle]} />
        {options.map((opt) => {
          const isActive = opt.value === selected;
          return (
            <TouchableOpacity
              key={opt.value}
              style={styles.segment}
              activeOpacity={0.75}
              onLayout={onSegmentLayout(opt.value)}
              hitSlop={{ top: SEGMENT_HIT_SLOP, bottom: SEGMENT_HIT_SLOP, left: 0, right: 0 }}
              onPress={() => {
                if (!isActive) hapticSelection();
                onSelect(opt.value);
              }}
              accessibilityRole="button"
              accessibilityLabel={opt.label}
              accessibilityState={{ selected: isActive }}
            >
              {/* 分段压在滑块上（透明底），缩放反馈看不见 → 沿用按下降透明度的反馈 */}
              <AppText
                variant="footnote"
                weight={isActive ? '600' : '400'}
                color={isActive ? semantic.onAccent : semantic.textSecondary}
                numberOfLines={1}
              >
                {opt.label}
              </AppText>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function makeStyles(semantic: SemanticColors, radius: Radius) {
  return StyleSheet.create({
    // 外侧留白：把触控区从 36 撑到 44，视觉轨道仍是 36
    touchWrap: { paddingVertical: (TOUCH_HEIGHT - TRACK_HEIGHT) / 2, alignSelf: 'flex-start' },
    // 槽：中性灰底（hairline 在日夜两套里都是"浅一档的底"），minHeight 而非固定高度
    track: {
      flexDirection: 'row',
      backgroundColor: semantic.hairline,
      borderRadius: radius.full,
      padding: TRACK_PADDING,
      minHeight: TRACK_HEIGHT,
      alignItems: 'center',
    },
    // 滑块：贴槽内缘，水平位置完全由 translateX（实测段 x）驱动；宽度随段弹
    thumb: {
      position: 'absolute',
      top: TRACK_PADDING,
      bottom: TRACK_PADDING,
      left: 0,
      borderRadius: radius.full,
      backgroundColor: semantic.accent,
    },
    segment: {
      minWidth: SEGMENT_MIN_WIDTH,
      minHeight: TRACK_HEIGHT - TRACK_PADDING * 2,
      paddingHorizontal: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
