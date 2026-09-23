import React, { useEffect, useRef } from 'react';
import { Animated, TextStyle } from 'react-native';

/**
 * 真正会闪烁的输入光标：金额/汇率/手续费/当前余额这几格都是自绘的假输入框（不是真的
 * TextInput，没有系统自带的光标），只能自己画一条"|"并让它明暗交替，告诉用户正在输入这一格。
 * 真的 TextInput（如账户名称框）不需要它，聚焦后系统自己就会显示光标。
 */
export function BlinkingCursor({ style }: { style?: any }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.Text style={[style as TextStyle, { opacity }]}>|</Animated.Text>;
}
