// Switch.tsx
// 统一开关（T04 / 计划 4.5）：RN 自带 Switch 的语义化包装。
//
// 为什么包一层
// - 触控区 ≥44（UI_RULES 第 4/8 节）：RN Switch 本体只有 ~31 高，外面补一个 44 的居中容器；
// - 颜色只从令牌取：关 = hairline（中性轨道）、开 = accent（唯一紫色填充）；
// - 切换是「状态变更」类操作 → 震动走 selection 档（UI_RULES 第 3 节），先震动再回调。
//
// 用法
//   <Switch value={remind} onValueChange={setRemind} accessibilityLabel="每日提醒" />

import React from 'react';
import { StyleProp, StyleSheet, Switch as RNSwitch, View, ViewStyle } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { hapticSelection } from '../../utils/haptics';

/** 触控区边长（UI_RULES：所有可点元素 ≥44pt） */
const TOUCH_SIZE = 44;

export interface SwitchProps {
  value: boolean;
  onValueChange?: (v: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Switch({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
  style,
  testID,
}: SwitchProps) {
  const { semantic } = useTheme();
  // ⚠ react-native-web 的 Switch 把拇指色拆成两个：thumbColor 只管「关」，
  //   「开」走 activeThumbColor，不传就用内置的青绿 #009688（真机上没见过，web 上是紫轨道 + 青绿圆点）。
  //   这里两个都显式给 onAccent（两套主题都是白色，与 iOS 原生拇指一致）。
  //   原生侧不认 activeThumbColor（是 RNW 扩展属性），用可选属性对象透传，不影响安卓 / iOS。
  const webActiveThumb = {
    activeThumbColor: semantic.onAccent,
  } as unknown as Partial<React.ComponentProps<typeof RNSwitch>>;

  // 开关是选中 / 取消的切换类操作：selection 档震动（一次动作最多一次，与视觉同帧）
  const handleValueChange = (next: boolean) => {
    hapticSelection();
    onValueChange?.(next);
  };

  return (
    <View style={[styles.touch, style]}>
      <RNSwitch
        {...webActiveThumb}
        value={value}
        onValueChange={handleValueChange}
        disabled={disabled}
        trackColor={{ false: semantic.hairline, true: semantic.accent }}
        ios_backgroundColor={semantic.hairline}
        // ⚠ thumbColor 必须显式给：react-native-web 不传就用内置色（见上 webActiveThumb 注释），
        //   原生侧这也是「关」状态的拇指色
        thumbColor={semantic.onAccent}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ checked: value, disabled: !!disabled }}
        testID={testID}
      />
    </View>
  );
}

// 这里只有几何（触控区高度），颜色全部走 RNSwitch 的 trackColor / ios_backgroundColor 令牌，
// 所以不需要 makeStyles(semantic…) 那套「令牌进」写法。
const styles = StyleSheet.create({
  // 触控区：44 高居中容器，Switch 本体在中间；不压缩（行尾控件不能被文字挤走）
  touch: {
    minHeight: TOUCH_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
});

export default Switch;
