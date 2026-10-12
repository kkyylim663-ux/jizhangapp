// useBottomSystemInset.ts
// 底部系统栏高度（手势条 / 三键导航条）的唯一来源：底部自绘面板（计算器键盘）、
// App 的导航栏遮罩（NavBarScrim）、底部抽屉的补白都从这里取，保证"遮罩高度 == 面板让位高度"。
//
// 为什么不直接用 insets.bottom：安卓上 Expo Go / 非 edge-to-edge 场景下 insets.bottom 可能是 0，
// 但导航条确实可见。这时用「屏幕高 − 窗口高 − 状态栏高」实测导航条高度，取两者最大值。
// 窗口尺寸变化（旋转、分屏、导航条模式切换）时 useWindowDimensions 会触发重算。
import { useMemo } from 'react';
import { Dimensions, Platform, StatusBar, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function useBottomSystemInset(): number {
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  return useMemo(() => {
    if (Platform.OS !== 'android') return insets.bottom;
    const screenH = Dimensions.get('screen').height;
    const windowH = Dimensions.get('window').height;
    const statusH = StatusBar.currentHeight ?? 0;
    const measured = Math.max(0, screenH - windowH - statusH);
    return Math.max(insets.bottom, measured);
    // win.height / win.width：窗口变化时强制重算（读取值本身在 Dimensions 里）
  }, [insets.bottom, win.height, win.width]);
}
