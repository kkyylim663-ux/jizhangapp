// haptics.ts
// 触感反馈统一入口（animate-expo skill §8：sparingly，一次用户动作最多一次，
// 且永远和视觉反馈同帧出现）。web 上 expo-haptics 不可用，静默跳过——
// 视觉反馈必须独立成立，haptic 只是锦上添花。
//
// 四档语义（2026-09-21 扩展，旧 API 原样保留）：
// - light：普通点按（keypad 按键、芯片选择）
// - selection：状态切换/选项变更（开关、分段选择）——比 light 更"咔哒"
// - success：保存成功等正向完成
// - warning：删除确认等需要"重一点"的警示（不用 Error——过于惩罚性）

import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

export function hapticLight() {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function hapticSelection() {
  if (Platform.OS === 'web') return;
  Haptics.selectionAsync().catch(() => {});
}

export function hapticSuccess() {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function hapticWarning() {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
