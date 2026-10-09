// useTabClearance.ts
// 浮空 Tab 栏的几何常量（全项目唯一来源） + 页面底部避让高度。
//
// 组成（2026-10-10 T07 定版，删掉过时的「栏体 64 + 距底 8 + FAB 凸出 22 + 呼吸间距 28」算法）：
//   栏身 54 + 栏底距安全区上沿的缝隙 2 + 设备底部安全区（手势条 0-34 / 三键导航 ~48）。
//   栏上方不再有列表渐隐遮罩（T06 撤掉），所以也不用再为它留 48。
//   中央「+」圆钮凸出栏顶 13（外壳把它整个包进可点区域），留白里不额外加它。
// 目标：滚到底时最后一项完整露在栏上方，又不留大片空白。
//
// ⚠ 这组常量被三处消费，改一处必须全部同步：
//   1. App.tsx 的外壳几何（栏身 / 圆钮位置 / 外壳高度）
//   2. 本文件的 useTabClearance（各页面滚动容器的底部 padding）
//   3. TabBarAutoHideContext 的收起距离（tabBarHideOffset）

import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** 栏身高度（App.tsx 外壳与 react-navigation 内层栏共用同一个值） */
export const TAB_BAR_HEIGHT = 54;
/** 栏底距安全区上沿的缝隙（浮空观感） */
export const TAB_BAR_GAP = 2;
/** 中央「+」圆钮凸出栏顶的高度 */
export const TAB_BAR_RAISE = 13;
/** 外壳在「栏身 + 圆钮凸起」之上再加的触摸余量：保证整圆严格落在外壳内（Android 才判得中） */
export const TAB_BAR_SHELL_PAD = 2;
/** 外壳完整高度（= 栏身 + 凸起 + 触摸余量）：App.tsx 用它当外壳高度 */
export const TAB_BAR_SHELL_HEIGHT = TAB_BAR_HEIGHT + TAB_BAR_RAISE + TAB_BAR_SHELL_PAD;
/** 中央「+」圆钮直径（56pt） */
export const TAB_CENTER_BUTTON_SIZE = 56;
/** 中央圆钮底边距外壳底边（= 栏身 + 凸起 − 圆径 = 11）：圆顶正好凸出栏顶 TAB_BAR_RAISE */
export const TAB_CENTER_BUTTON_BOTTOM =
  TAB_BAR_HEIGHT + TAB_BAR_RAISE - TAB_CENTER_BUTTON_SIZE;

/**
 * 收起（滑出屏幕）需要的位移：外壳完整高度 + 距底 + 安全区 —— 整栏连凸起的圆钮一起滑出；
 * 末尾 +4 抵消亚像素舍入，避免屏底残留一条缝。TabBarAutoHideContext 用它，不再写死 60。
 */
export function tabBarHideOffset(insetsBottom: number): number {
  return TAB_BAR_SHELL_HEIGHT + TAB_BAR_GAP + insetsBottom + 4;
}

/** 页面滚动容器统一的底部留白：滚到底时最后一项完整露在 Tab 栏上方 */
export function useTabClearance(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + TAB_BAR_GAP + insets.bottom;
}
