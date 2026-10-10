// IconCircle.tsx
// UI V2.1 §5：所有圆形图标（类别 / 账户 / 计划 / 设置行 / 账本……）= 同色系立体光泽球。
//   结构（自上而下）：外投影 → 球面径向渐变（亮 0% → 基色 48% → 暗 100%）
//     → 顶部白内阴影 + 底部暗内阴影 → 顶部高光条（49% × 9%，left 14% / top 4%，白 75% → 0）
//     → 白图标（带 0 1 1 细阴影）
//   颜色：亮色 = 基色混白 55%，暗色 = 基色混黑 32%；中性项（「全部」「已暂停」）基色 #8E8AA6；
//   日夜同一套；§4 的硬指标作用在**图标真正压着的那部分球面**上（亮档与基色各压到 ≥3:1，
//   高光不压到图标上 —— 详见 ballColors 与 gloss 两处注释）。
//   选中（记一笔类别格）：球面不变，外加两层外圈（日 #9B5BD6 / 夜 类别色 60%）。
//
// 用法：
//   <IconCircle color={cat.color} icon="fast-food-outline" />
//   <IconCircle size={48} color={cat.color} icon={cat.icon} selected />
//   <IconCircle icon="grid-outline" />   // 中性「全部」

import React, { useMemo } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { categoryRing } from '../../theme/theme';
import { contrastRatio, darken, mixWithBlack, mixWithWhite, withAlpha } from './color';

/** 中性项基色（UI V2.1 §5：「全部」「已暂停」等） */
export const ICON_BALL_NEUTRAL = '#8E8AA6';
/** 浅色基色的加深量（白图标对比 < 3:1 时；§5） */
const TOO_LIGHT_DARKEN = 0.15;
/** 亮档 = 基色混白比例（§5：亮色 = 基色混 55% 白） */
const HIGHLIGHT_MIX = 0.55;
/** 图标与其底的最低对比（§4：图标 ≥ 3:1） */
const ICON_MIN_CONTRAST = 3;

export interface IconCircleProps {
  /** 类别色 / 账户色（hex）；不传 = 中性球（「全部」那种） */
  color?: string;
  /** 直径：42（默认，列表/账户）· 48（记一笔格子） */
  size?: number;
  /** 图标直径（默认 = size × 0.48：42→20 / 48→23） */
  iconSize?: number;
  /** Ionicons 图标名 */
  icon?: keyof typeof Ionicons.glyphMap;
  /** 选中态：两层外圈（记一笔类别格） */
  selected?: boolean;
  style?: ViewStyle;
  children?: React.ReactNode;
}

/** 基色 → 球面色三档（§5）：太浅的基色先压深，保证白图标对比 ≥ 3:1（§4 的硬指标） */
function ballColors(color?: string): { base: string; light: string; dark: string } {
  let base = color ?? ICON_BALL_NEUTRAL;
  // 每次压深 15%（§5 的加深量）；一次不够就继续压（黄 #F5A524 一次只到 2.7:1），最多 4 次
  for (let step = 0; step < 4; step++) {
    const ratio = contrastRatio('#FFFFFF', base);
    if (ratio === null || ratio >= ICON_MIN_CONTRAST) break;
    base = darken(base, TOO_LIGHT_DARKEN);
  }
  // ⚠ 高光档同样要满足「白图标 ≥ 3:1」（§4）：白色图标正好压在 radial 的亮档上
  //   （渐变中心 cx 32% / cy 26% 就在图标中心附近），亮档 = 基色混白 55% —— 对中等 / 浅基色
  //   它会亮到 1.2–1.8:1（实测：娱乐 #AB47BC 亮档 1.77、工资 #43A047 亮档 1.19）。
  //   所以亮档按同一套规则继续压深，直到白图标达标（最多 4 步）；基色与暗档不动。
  let light = mixWithWhite(base, HIGHLIGHT_MIX);
  for (let step = 0; step < 4; step++) {
    const ratio = contrastRatio('#FFFFFF', light);
    if (ratio === null || ratio >= ICON_MIN_CONTRAST) break;
    light = darken(light, TOO_LIGHT_DARKEN);
  }
  return { base, light, dark: mixWithBlack(base, 0.32) };
}

export function IconCircle({
  color,
  size = 42,
  iconSize,
  icon,
  selected = false,
  style,
  children,
}: IconCircleProps) {
  const { isDark, semantic } = useTheme();
  const { base, light, dark } = useMemo(() => ballColors(color), [color]);
  const radius = size / 2;
  // 渐变定义 id 带基色指纹：同色实例共用一份定义（web 的 url(#id) 按文档解析），异色不会串
  const ballId = `ic3d${base.replace(/[^0-9a-zA-Z]/g, '')}`;

  // 外投影（§5）：同色投影 80% + 2/3 黑；选中再叠两层外圈（3dp 页面底色打底 + 5dp 外环）
  const outerShadow = [
    `0px 8px 16px -6px ${withAlpha(base, 0.8)}`,
    '0px 2px 3px rgba(0,0,0,0.2)',
  ].join(', ');
  const ringColor = color
    ? isDark
      ? withAlpha(color, categoryRing.darkAlpha)
      : categoryRing.light
    : semantic.textTertiary;
  const selectedShadow = selected
    ? `0px 0px 0px ${categoryRing.gapWidth}px ${semantic.bg}, 0px 0px 0px ${
        categoryRing.gapWidth + categoryRing.ringWidth
      }px ${ringColor}, ${outerShadow}`
    : outerShadow;

  // 内阴影（§5）：顶部 inset 白 .55 / 底部 inset 暗色 —— 单独一层画在球面之上（CSS 的 inset
  // 画在背景与内容之间，挂在根节点会被球面 SVG 盖住）
  const innerShadow = `inset 0px 2px 1px rgba(255,255,255,0.55), inset 0px -3px 6px ${dark}`;

  return (
    <View
      style={[
        styles.root,
        { width: size, height: size, borderRadius: radius, boxShadow: selectedShadow },
        style,
      ]}
    >
      {/* 球面：radial-gradient(circle at 32% 26%, 亮 → 基色 48% → 暗) */}
      <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id={ballId} cx="32%" cy="26%" r="1">
            <Stop offset="0" stopColor={light} />
            <Stop offset="0.48" stopColor={base} />
            <Stop offset="1" stopColor={dark} />
          </RadialGradient>
        </Defs>
        <Circle cx={radius} cy={radius} r={radius} fill={`url(#${ballId})`} />
      </Svg>
      {/* 左上高光：白 75% → 0（§5 的左上椭圆高光）。
          ⚠ 几何是硬指标，别把它做大：白图标正好落在球面中部，高光只要盖到图标上，
          图标与球面的对比就掉到 1.2–2.4:1（实测 #AB47BC 1.77 / 中性球 1.97 / #43A047 1.19）。
          高光的**强段**（顶部 75%）留在图标（+ 3px 采样环）之上 —— 49% 宽 × 9% 高、
          left 14% / top 4%：各种球径（34/38/42/48）图标环的上沿都在 17–20% 处，
          高光在 13% 处已淡到 0，图标环只吃到球面的亮档 / 基色（两者都已按 ≥3:1 压深） */}
      <LinearGradient
        colors={['rgba(255,255,255,0.75)', 'rgba(255,255,255,0)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.gloss}
        pointerEvents="none"
      />
      {/* 内阴影层：压在高光之上、图标之下 */}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius: radius, boxShadow: innerShadow }]}
      />
      {icon ? (
        <Ionicons
          name={icon}
          size={iconSize ?? Math.round(size * 0.48)}
          color="#FFFFFF"
          style={styles.icon}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  gloss: {
    position: 'absolute',
    left: '14%',
    top: '4%',
    width: '49%',
    height: '9%',
    borderRadius: 999,
    overflow: 'hidden',
  },
  // 图标细阴影（§5：0 1 1 rgba(0,0,0,.28)）
  icon: {
    textShadowColor: 'rgba(0,0,0,0.28)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
});

export default IconCircle;
