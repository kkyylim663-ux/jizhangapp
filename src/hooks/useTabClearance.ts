// useTabClearance.ts
// 悬浮 Tab 栏的底部避让高度：所有 Tab 可达页面的滚动容器 padding-bottom 统一用它，
// 保证列表最后一项滚到底时完整露出、不被悬浮栏和中间凸起的 + 按钮压住。
//
// 组成：栏体 64 + 距底 8 + FAB 凸出 22 + 呼吸间距 28 ≈ 122，再加上各设备自己的
// 底部安全区（手势条 0-34、三键导航约 48）——所以必须用 insets 动态算，
// 写死一个值在三键导航的 Android 上会不够。
//
// 2026-10-09 修正 24：栏上方新增 48dp「列表渐隐遮罩」（App.tsx 的 tabFadeMask）——
// 底部留白必须把遮罩高度一起算进去，最后一项才能完整滚出渐隐区、不被淡掉。
// 数值与 App.tsx 的 TAB_FADE_H 保持一致（改一处要同步另一处）。

import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TAB_FADE_H = 48;

export function useTabClearance(): number {
  const insets = useSafeAreaInsets();
  return 122 + TAB_FADE_H + insets.bottom;
}
