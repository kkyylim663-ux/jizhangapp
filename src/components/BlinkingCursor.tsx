import React, { useEffect, useRef } from 'react';
import { Animated, TextStyle } from 'react-native';

/**
 * 真正会闪烁的输入光标：金额/汇率/手续费/当前余额这几格都是自绘的假输入框（不是真的
 * TextInput，没有系统自带的光标），只能自己画一条"|"并让它明暗交替，告诉用户正在输入这一格。
 * 真的 TextInput（如账户名称框）不需要它，聚焦后系统自己就会显示光标。
 *
 * 闪法是「硬闪」不是「渐变」（UI V2.1 §4 的连带修正）：原来是 500ms 淡入淡出，
 * 截图 / 对比度自测会正好抓在中间档（实测 0.107 不透明度），把一个装饰性光标判成
 * 1.27:1 的不达标文字 —— 而光标本身是两个状态：要么全亮（对比达标），要么全灭（不参与判定）。
 * 系统「减弱动态效果」下同样只跳档，不做连续变化。
 */
export function BlinkingCursor({ style }: { style?: any }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(500),
        Animated.timing(opacity, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(500),
        Animated.timing(opacity, { toValue: 1, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.Text style={[style as TextStyle, { opacity }]}>|</Animated.Text>;
}
