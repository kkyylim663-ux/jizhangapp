// useTabClearance.ts
// 悬浮 Tab 栏的底部避让高度：所有 Tab 可达页面的滚动容器 padding-bottom 统一用它，
// 保证列表最后一项滚到底时完整露出、不被悬浮栏和中间凸起的 + 按钮压住。
//
// 组成：栏体 64 + 距底 8 + FAB 凸出 22 + 呼吸间距 28 ≈ 122，再加上各设备自己的
// 底部安全区（手势条 0-34、三键导航约 48）——所以必须用 insets 动态算，
// 写死一个值在三键导航的 Android 上会不够。

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function useTabClearance(): number {
  const insets = useSafeAreaInsets();
  return 122 + insets.bottom;
}
