// ColdStartMotion.tsx
// 冷启动动效（只在「本次 App 启动」的第一屏播放一次，切 Tab / 横滑币种不再重放）：
// - 净资产数字从 0.00 滚到真实值（HeroRollMoney）：一条连续的缓出曲线，约 1.6 秒落在真实值上；
//   中途真实数据变化（同步写回）→ 从当前位置平滑改追新目标，不重新从 0 开始；
// - 预算进度条同步从 0 长到真实占比（BudgetCardPage 调用 claimColdRoll）。
// 只改数字与进度条的内容，不额外包任何一层视图（布局与首次版式完全一致）。
//
// 「本次启动」的判定：模块级变量。第一次调用 claim 时打开一个 2.2 秒窗口，窗口内挂载的组件才播放；
// 窗口关闭后（以及减少动态效果时）一律直接显示最终值。
import { useEffect, useRef, useState } from 'react';
import { Easing } from 'react-native-reanimated';
import { MoneyText, type MoneyTextProps } from './MoneyText';
import { useMotion } from '../../theme/motion';

/** 数字滚动 / 进度条填充的时长（ms） */
export const COLD_ROLL_MS = 1600;
/** 进度条 / 数字 追赶新目标的时长（ms） */
const RETARGET_MS = 400;
/** 启动动效窗口（ms）：第一次 claim 之后这段时间内挂载的组件才播放 */
const WINDOW_MS = 2200;
export const COLD_EASE = Easing.out(Easing.cubic);

let windowOpen: boolean | undefined; // undefined = 还没开过窗口
let rollCode: string | null = null;

function ensureWindow(): boolean {
  if (windowOpen === undefined) {
    windowOpen = true;
    setTimeout(() => {
      windowOpen = false;
    }, WINDOW_MS);
  }
  return windowOpen;
}

/** 数字 / 进度条是否播放：第一个认领的币种播放，其他币种页直接显示终值 */
export function claimColdRoll(code: string): boolean {
  if (!ensureWindow()) return false;
  if (rollCode === null) rollCode = code;
  return rollCode === code;
}

/**
 * 净资产金额：启动窗口内从 0 缓出滚到目标；其余时候与 MoneyText 完全一致（透传全部属性）。
 * 滚动期间关掉 MoneyText 的逐位滚动，只由这里逐帧给出数字（一个组件内部重渲，不惊动页面）。
 */
export function HeroRollMoney({ code, value, ...rest }: MoneyTextProps & { code: string }) {
  const { reduceMotion } = useMotion();
  const claim = useRef<boolean | null>(null);
  if (claim.current === null) claim.current = !reduceMotion && claimColdRoll(code);
  const [shown, setShown] = useState<number>(claim.current ? 0 : value);
  const [rolling, setRolling] = useState<boolean>(!!claim.current);
  const targetRef = useRef(value);
  targetRef.current = value;

  useEffect(() => {
    if (!rolling) return;
    let raf = 0;
    let v = shown;
    let seg = { from: v, to: targetRef.current, t0: Date.now(), dur: COLD_ROLL_MS };
    const tick = () => {
      const now = Date.now();
      if (targetRef.current !== seg.to) {
        // 中途改目标：从当前位置平滑追过去（不从 0 重来）
        seg = { from: v, to: targetRef.current, t0: now, dur: RETARGET_MS };
      }
      const p = Math.min((now - seg.t0) / seg.dur, 1);
      v = seg.from + (seg.to - seg.from) * (1 - Math.pow(1 - p, 3));
      if (p >= 1) {
        setShown(seg.to);
        setRolling(false);
        return;
      }
      setShown(v);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // 只在开始滚动时启动一次；之后的目标变化由 targetRef 在循环里读取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolling]);

  return <MoneyText {...rest} value={rolling ? shown : value} roll={rolling ? false : undefined} />;
}
