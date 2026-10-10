// useTabClearance.ts
// 浮空 Tab 栏的几何常量（全项目唯一来源） + 页面底部避让高度。
//
// 组成（UI V2 第 3 节第 4 条定版，2026-10-10）：
//   栏身 68（悬浮胶囊，全圆角）+ 栏底距安全区上沿的缝隙 18 + 设备底部安全区（手势条 0-34 / 三键导航 ~48）。
//   中央「+」54 圆**在胶囊内部**（不再凸出栏顶），所以外壳高度 = 栏身，不再有凸起量。
// 目标：滚到底时最后一项完整露在栏上方，又不留大片空白。
//
// ⚠ 这组常量被三处消费，改一处必须全部同步：
//   1. App.tsx 的外壳几何（栏身 / 圆钮位置 / 外壳高度）
//   2. 本文件的 useTabClearance（各页面滚动容器的底部 padding）
//   3. TabBarAutoHideContext 的收起距离（tabBarHideOffset）

import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** 栏身高度（App.tsx 外壳与 react-navigation 内层栏共用同一个值）——UI V2：悬浮胶囊 68 */
export const TAB_BAR_HEIGHT = 68;
/** 栏底距安全区上沿的缝隙（浮空观感）——UI V2：18 */
export const TAB_BAR_GAP = 18;
/** 中央「+」圆钮凸出栏顶的高度——UI V2：圆钮收进胶囊内部，不再凸出 */
export const TAB_BAR_RAISE = 0;
/** 外壳在栏身之上再加的触摸余量——圆钮已在栏内，无需余量 */
export const TAB_BAR_SHELL_PAD = 0;
/** 外壳完整高度（= 栏身 + 凸起 + 触摸余量）：App.tsx 用它当外壳高度 */
export const TAB_BAR_SHELL_HEIGHT = TAB_BAR_HEIGHT + TAB_BAR_RAISE + TAB_BAR_SHELL_PAD;
/** 中央「+」圆钮直径（54pt，UI V2） */
export const TAB_CENTER_BUTTON_SIZE = 54;
/** 中央圆钮底边距外壳底边（= 栏内垂直居中：(68 − 54) / 2 = 7） */
export const TAB_CENTER_BUTTON_BOTTOM = (TAB_BAR_HEIGHT - TAB_CENTER_BUTTON_SIZE) / 2;

/**
 * 收起（滑出屏幕）需要的位移：外壳完整高度 + 距底 + 安全区 —— 整栏一起滑出；
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
