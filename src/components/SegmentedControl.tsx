// SegmentedControl.tsx
// 图1 样式的分段开关：灰底胶囊槽 + 选中项实底圆角滑块（fabBg 底白字）+ 未选中灰字，
// 滑块用 Animated 平滑滑动。设置页语言/深色模式/生物锁三处共用；
// 日历卡的 支出/收入/总额 三段也用（第五十节起）。
//
// ⚠ 滑块定位必须是逐段 onLayout 实测——旧版按「槽宽÷段数」等分推算，段与段文字宽度
// 不同时（英文 Expense/Income/Net、中文 中/英）滑块和文字错位（真机截图 bug）。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { ThemeColors } from '../theme/theme';
import { hapticSelection } from '../utils/haptics';

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

const TRACK_PADDING = 3;

export default function SegmentedControl({ options, selected, onSelect }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // 每段的实测几何：key=value，x 为段左缘在槽内容坐标系里的位置（不含 TRACK_PADDING，
  // 滑块定位时统一加上）。逐段 onLayout 上报——各段文字宽度不同也各自准确
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
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 首帧/语言切换瞬间段几何未测得：滑块先藏起来，实测到位后再淡入，
    // 避免停在 0 位盖住第一段
    if (!activeFrame) return;
    Animated.timing(slideAnim, {
      toValue: activeFrame.x,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [activeFrame?.x, activeFrame?.width, slideAnim]);

  return (
    <View style={styles.track}>
      {activeFrame && (
        <Animated.View
          style={[
            styles.thumb,
            { width: activeFrame.width, transform: [{ translateX: slideAnim }] },
            !activeFrame && { opacity: 0 },
          ]}
        />
      )}
      {options.map((opt) => {
        const active = opt.value === selected;
        return (
          <TouchableOpacity
            key={opt.value}
            style={styles.segment}
            activeOpacity={0.8}
            onLayout={onSegmentLayout(opt.value)}
            onPress={() => {
              if (!active) hapticSelection();
              onSelect(opt.value);
            }}
          >
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    // 灰底胶囊槽（图1：浅色灰底；深色模式自动跟 colors token 切换）
    track: {
      flexDirection: 'row',
      backgroundColor: colors.bg,
      borderRadius: 17,
      padding: TRACK_PADDING,
      alignSelf: 'flex-start',
    },
    // 选中滑块：fabBg 实底圆角（图1 蓝底白字），贴槽内缘。
    // left 固定 0：水平位置完全由 translateX（实测段 x + TRACK_PADDING 偏移）驱动
    thumb: {
      position: 'absolute',
      top: TRACK_PADDING,
      bottom: TRACK_PADDING,
      left: 0,
      borderRadius: 14,
      backgroundColor: colors.fabBg,
      shadowColor: colors.fabBg,
      shadowOpacity: 0.3,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    segment: {
      // 最小段宽保留：两段开关（中/英 等）不至于太窄（用户定版）；
      // 段宽现在由文字实测决定，不再强制等分
      minWidth: 52,
      paddingHorizontal: 10,
      paddingVertical: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    labelActive: { color: colors.fabIcon, fontWeight: '700' },
  });
}
