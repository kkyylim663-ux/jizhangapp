// AuroraFlowShader.tsx
// 真·无限流动极光层（GPU shader 驱动，@shopify/react-native-skia）。
//
// 原理：SkSL fragment shader 每像素每帧跑一次「域扭曲分形噪声」(domain-warped fbm)——
// 基础噪声 fbm 的坐标先被另一层噪声 q 揉歪，再取 fbm(p + 2q + t)：
// 时间 uTime 不断递增 → 噪声场连续变形 → 亮丝不断扭转生长，天然永不循环、永不重复。
// n 高的区域 = 发光脉络，经三段色 (uDark→uMid→uGlow) 映射成深底/紫雾/亮丝。
//
// 使用约束（勿改）：
// - 只在本组件里动 Reanimated 的 shared value（UI 线程），JS 不参与每帧
// - App 退后台时暂停累时（rAF 后台卡死前科的教训），单帧增量钳 100ms 防回前台快进跳变
// - shader 编译失败（异常设备/SkSL 语法）→ 返回 null，调用方底下的普通渐变原样兜底

import React, { useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';

const AURORA_SRC = `
uniform float2 uRes;
uniform float uTime;
uniform half3 uDark;
uniform half3 uMid;
uniform half3 uGlow;

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453123);
}
float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + float2(1.0, 0.0)), u.x),
    mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), u.x),
    u.y
  );
}
// 分形噪声：4 个八度叠加，细节逐层翻倍、振幅逐层减半
float fbm(float2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + float2(17.3, 9.1);
    a *= 0.5;
  }
  return v;
}

half4 main(float2 xy) {
  float2 p = xy / uRes.y * 1.5;    // 结构尺度：形状放大（1.5）= 噪点感下降、更舒展
  float t = uTime * 0.08;          // 全局流速（慢 = 高级感）

  // 双重域扭曲（Quilez 经典）：q 揉第一层、r 揉第二层——丝线蜿蜒扭转的来源
  float2 q = float2(
    fbm(p + float2(0.0, t)),
    fbm(p + float2(5.2, 1.3) - t * 0.7)
  );
  float2 r = float2(
    fbm(p + 3.0 * q + float2(1.7, 9.2) + t * 0.15),
    fbm(p + 3.0 * q + float2(8.3, 2.8) - t * 0.126)
  );
  float n = fbm(p + 2.5 * r);

  // 主脉络：噪声中线（n=0.5）的等高线连成发光丝——视频里亮丝的真实配方
  // （不是"噪声高处提亮"，那只会出云雾；等高线才出会蜿蜒的丝）
  float vein = 1.0 - abs(2.0 * n - 1.0);
  float core = pow(vein, 7.0);     // 锐亮芯
  float halo = pow(vein, 2.2);     // 柔宽晕（辉光感）

  // 次级细丝：更高频一层，弱一档，负责丝里丝的细节
  float n2 = fbm(p * 1.8 + r * 1.2 + t * 0.35);
  float core2 = pow(1.0 - abs(2.0 * n2 - 1.0), 9.0) * 0.22;

  // 底场：大面积沉底，中高段薄雾（增益全面调低 = 安静的纹理而非喧宾夺主的画面）
  half3 col = mix(uDark, uMid, smoothstep(0.45, 0.95, n) * 0.55);
  col += uGlow * halo * 0.16;
  col += uGlow * (core + core2) * 0.45;
  return half4(col, 1.0);
}
`;

// 编译改为惰性：模块求值时 Skia 可能尚未完成绑定（冷加载 import 链早于 skia 模块
// 完成求值，真机日志实锤 "Cannot read properties of undefined (reading 'RuntimeEffect')"），
// 所以不在模块顶层 Make——首次渲染时才编译（此时全模块图已加载），结果缓存全 App 一次
let auroraShaderCache: ReturnType<typeof makeAuroraFx> | undefined;

function makeAuroraFx() {
  return Skia.RuntimeEffect.Make(AURORA_SRC);
}

function compileAuroraShader() {
  if (auroraShaderCache !== undefined) return auroraShaderCache;
  try {
    const fx = makeAuroraFx();
    if (!fx) {
      console.error('[AURORA] SkSL 编译失败：Make 返回 null（明细请看 logcat 的 Skia 输出）');
      auroraShaderCache = null;
    } else {
      const names: string[] = [];
      for (let i = 0; i < fx.getUniformCount(); i++) names.push(fx.getUniformName(i));
      console.warn(`[AURORA] shader OK, uniforms: ${names.join(', ')}`);
      auroraShaderCache = fx;
    }
  } catch (e) {
    console.error('[AURORA] SkSL 编译抛异常:', e);
    auroraShaderCache = null;
  }
  return auroraShaderCache;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const f = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h;
  return [
    parseInt(f.slice(0, 2), 16) / 255,
    parseInt(f.slice(2, 4), 16) / 255,
    parseInt(f.slice(4, 6), 16) / 255,
  ];
}

interface AuroraFlowShaderProps {
  /** 三段色：暗部 / 中间雾 / 高亮丝（hex）——主题 token 里日夜各一套 */
  dark: string;
  mid: string;
  glow: string;
  /** 流速倍率，1 = 默认；调小更缓 */
  speed?: number;
  /** 整层不透明度：日间叠在浅渐变上用 0.5 左右，夜间 1 全接管 */
  opacity?: number;
  /** 裁剪圆角，跟卡面一致（防方形角穿帮） */
  borderRadius?: number;
}

export default function AuroraFlowShader({
  dark,
  mid,
  glow,
  speed = 1,
  opacity = 1,
  borderRadius = 20,
}: AuroraFlowShaderProps) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const time = useSharedValue(0);
  // shader 惰性编译（首次渲染时，模块图已全部加载完；结果缓存）
  const shader = useMemo(() => compileAuroraShader(), []);
  // 前台标志用 shared value（不用 useRef）：react-native-worklets 里 ref/对象跨线程
  // 会被转成不可变 serializable，之后任何键写入都会红屏；shared value 是唯一官方读写通道
  const active = useSharedValue(true);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      active.value = s === 'active';
    });
    return () => sub.remove();
  }, []);

  // 探针：挂载/尺寸/shader 状态打回 Metro 日志（验收完删除）
  useEffect(() => {
    console.warn(`[AURORA] mount: shader=${shader ? 'ok' : 'null'} size=${size.w}x${size.h}`);
  }, [shader, size.w, size.h]);

  // 时钟：只在 App 前台时累加（UI 线程帧回调，JS 零参与）；首帧 delta 为 null 跳过
  useFrameCallback((fi) => {
    const dt = fi.timeSincePreviousFrame;
    if (active.value && dt != null) {
      // 单帧增量钳 100ms：后台回前台第一帧的大 delta 不让画面快进
      time.value += (Math.min(dt, 100) / 1000) * speed;
    }
  }, true);

  // 三段色在 JS 侧转换一次（hexToRgb 是 JS 线程函数，worklet 里不能同步调）
  const darkRgb = useMemo(() => hexToRgb(dark), [dark]);
  const midRgb = useMemo(() => hexToRgb(mid), [mid]);
  const glowRgb = useMemo(() => hexToRgb(glow), [glow]);
  // 再拆成纯 number：worklet 只捕获原始数——数组（uDark 等）每帧在 worklet 内新建，
  // 绝不把 JS 侧数组/对象捕获进 worklet（跨线程转 serializable 后不可变，写键必红屏）
  const [dr, dg, db] = darkRgb;
  const [mr, mg, mb] = midRgb;
  const [gr, gg, gb] = glowRgb;
  const w = size.w;
  const h = size.h;

  const uniforms = useDerivedValue(
    () => ({
      uRes: [w, h],
      uTime: time.value,
      uDark: [dr, dg, db],
      uMid: [mr, mg, mb],
      uGlow: [gr, gg, gb],
    }),
    [w, h, dr, dg, db, mr, mg, mb, gr, gg, gb]
  );

  // shader 编译失败 → 整层不渲染（露出底下渐变兜底）。
  // ⚠外层 View 必须恒渲染（onLayout 靠它量尺寸）——只有 Canvas 按尺寸条件挂载，
  // 否则"没尺寸就不渲染、不渲染就没尺寸"死锁（真机日志实锤过）
  if (!shader) return null;

  return (
    <View
      pointerEvents="none"
      // 量测放外层普通 View（Skia Canvas 在 Fabric 上 onLayout 不可靠——日志实测
      // 永远 0x0）；Canvas 用 absoluteFill 自己铺满，尺寸只喂 uRes 做归一
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) =>
          Math.abs(width - prev.w) > 0.5 || Math.abs(height - prev.h) > 0.5
            ? { w: width, h: height }
            : prev
        );
      }}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius,
        overflow: 'hidden',
        opacity,
      }}
    >
      {size.w > 10 && size.h > 10 && (
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill>
            <Shader source={shader} uniforms={uniforms} />
          </Fill>
        </Canvas>
      )}
    </View>
  );
}
