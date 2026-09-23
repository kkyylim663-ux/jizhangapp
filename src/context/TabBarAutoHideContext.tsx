// TabBarAutoHideContext.tsx
// 浮空 Tab 栏的滚动收起/展开共享状态。
//
// 用法：
// - App 里用 useCreateTabBarAutoHide() 创建一份 value，包在 Tab.Navigator 外层；
//   同一个 value 喂给 TabBarAutoHideProvider 和 NavigationContainer 的 onStateChange。
// - 各页面（含嵌套 Stack 内的子页面）调 useTabBarScrollHandler() 拿 onScroll，
//   挂到自己的 ScrollView/FlatList 上：onScroll={onTabScroll} scrollEventThrottle={16}。
//
// 设计要点：
// - 方向判断用"锚点迟滞"：沿同方向持续滚过 60px 才触发收起/展开，
//   方向一反转就重置锚点——轻微抖动不会让栏来回闪烁。
// - 顶部 50px 以内强制显示（列表刚下拉/回顶时栏必须可见）。
// - 位移和淡出动画用原生驱动（web 除外），JS 里只做每帧几次的比较，无 setState。

import React, { createContext, useContext, useMemo } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type TabBarAutoHideValue = {
  translateY: Animated.Value;
  opacity: Animated.Value;
  onScroll: (e: any) => void;
  reset: () => void;
  // 外部强制隐藏/恢复（比如页面里弹出了自绘键盘、跟Tab bar在同一块屏幕区域相撞时用）。
  // 优先级高于滚动：forced 为 true 期间，onScroll/reset 都不会再改变显隐状态。
  setForceHidden: (hidden: boolean) => void;
};

const TabBarAutoHideContext = createContext<TabBarAutoHideValue | null>(null);

const HIDE_DISTANCE = 60; // 同方向滚动 60px 才切换状态
const TOP_ZONE = 50; // 距顶部 50px 以内强制显示
const ANIM_MS = 240; // UI 动画 240ms ease-out（<300ms 原则）

export function useCreateTabBarAutoHide(): TabBarAutoHideValue {
  const insets = useSafeAreaInsets();

  return useMemo(() => {
    const translateY = new Animated.Value(0);
    const opacity = new Animated.Value(1);
    let hidden = false;
    let lastY = 0;
    let anchor = 0;
    let lastDirDown = true;
    let forced = false; // true 期间，滚动/导航跳转都不再决定显隐，只听 setForceHidden
    // 位置待同步：reset()/解除强制隐藏时，列表可能还停在中途滚动位置（比如 y=800）。
    // 此时把锚点盲目归零的话，下一次滚动事件会被误判成"向下滚了一大步"，
    // 刚弹出来的 Tab 栏立刻又被藏回去。置 true 后，下一个 onScroll 只同步真实位置、
    // 不做方向判断，之后再恢复正常判断。
    let pendingSync = false;

    const toggle = (hide: boolean) => {
      if (hide === hidden) return;
      hidden = hide;
      // 收起位移 = 栏体 60 + 距底 8 + 安全区 + 余量，确保完全滑出屏幕之外
      const off = 60 + 8 + insets.bottom + 30;
      const anim = { duration: ANIM_MS, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' };
      Animated.parallel([
        Animated.timing(translateY, { toValue: hide ? off : 0, ...anim }),
        Animated.timing(opacity, { toValue: hide ? 0 : 1, ...anim }),
      ]).start();
    };

    const onScroll = (e: any) => {
      if (forced) return; // 键盘等弹层开着的时候，滚动不应该把栏重新弹出来
      const y = e?.nativeEvent?.contentOffset?.y ?? 0;
      if (pendingSync) {
        // 面板刚关闭/刚切回来：先校准到列表真实位置，不做方向判断
        pendingSync = false;
        lastY = y;
        anchor = y;
        return;
      }
      const dy = y - lastY;
      lastY = y;
      if (Math.abs(dy) < 0.5) return;
      const goingDown = dy > 0;

      // 顶部区域常显
      if (y <= TOP_ZONE) {
        anchor = y;
        lastDirDown = goingDown;
        toggle(false);
        return;
      }
      // 方向反转：只更新方向标记。锚点保留——这样快滑一大步（一次事件跨过
      // 整个迟滞距离）也能立即触发，而不是只"重新武装"等下一次滚动
      if (goingDown !== lastDirDown) {
        lastDirDown = goingDown;
      }
      const travelled = goingDown ? y - anchor : anchor - y;
      if (travelled >= HIDE_DISTANCE) {
        anchor = y;
        toggle(goingDown);
      }
    };

    const reset = () => {
      if (forced) return; // 强制隐藏期间，导航状态变化（切Tab/push/pop）也不该把栏拉出来
      // 不再把 lastY/anchor 归零（列表可能停在中途位置）：交给下一个 onScroll 校准
      pendingSync = true;
      toggle(false);
    };

    const setForceHidden = (hide: boolean) => {
      forced = hide;
      if (hide) {
        toggle(true);
      } else {
        // 交还给滚动逻辑：先按"不隐藏"处理并把栏弹出来；下一个 onScroll 只校准
        // 真实滚动位置，不会把"位置跳变"误判成向下滚动（修复选完日期栏又缩回去的 bug）
        pendingSync = true;
        toggle(false);
      }
    };

    return { translateY, opacity, onScroll, reset, setForceHidden };
  }, [insets.bottom]);
}

export function TabBarAutoHideProvider({
  value,
  children,
}: {
  value: TabBarAutoHideValue;
  children: React.ReactNode;
}) {
  return <TabBarAutoHideContext.Provider value={value}>{children}</TabBarAutoHideContext.Provider>;
}

// 页面里用：拿滚动 handler（在 Provider 外时返回 null，页面侧 ?? undefined 兜底）
export function useTabBarScrollHandler(): ((e: any) => void) | null {
  return useContext(TabBarAutoHideContext)?.onScroll ?? null;
}

// 页面里用：拿强制隐藏/恢复开关（自绘键盘、全屏弹层等跟Tab bar打架的场景用）。
// Provider 外调用给个 no-op，不会报错，方便页面不关心"是否真的在Provider里"。
export function useTabBarForceHide(): (hidden: boolean) => void {
  const ctx = useContext(TabBarAutoHideContext);
  return ctx?.setForceHidden ?? (() => {});
}

// Tab 栏外壳用：拿 translateY/opacity 驱动收起/展开动画
export function useTabBarAutoHide(): TabBarAutoHideValue {
  const ctx = useContext(TabBarAutoHideContext);
  if (!ctx) throw new Error('useTabBarAutoHide must be used within TabBarAutoHideProvider');
  return ctx;
}
