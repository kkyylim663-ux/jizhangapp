import React, { useCallback, useMemo, useRef } from 'react';
import { PanResponder, Pressable, Text, TextStyle, View, ViewStyle } from 'react-native';
import { BlinkingCursor } from './BlinkingCursor';

/**
 * 可定位光标的自绘金额文本：渲染"光标前的文字 + 闪烁光标 + 光标后的文字"，
 * 支持把光标放到显示串的任意字符缝隙之间：
 * - 点按文字：光标移到点按位置最近的字符缝隙；
 * - 长按（300ms）进入拖动：按住左右滑，光标实时跟随手指，松手结束；
 * - 未启用（enabled=false）时退化为普通文本，点按回落到 onPress（通常是"打开计算器键盘"）。
 *
 * 页面侧职责（与 AssetScreen 既有用法同一套约定）：
 * - 自己持有 cursorFromEnd state（光标距显示串尾部的偏移，0 = 最末尾）；
 * - display 传 useAmountExpression 的 displayValue（或键盘未开时的最终金额）；
 * - 键盘按键走 expr.pressKeyAt(key, cursorFromEnd)，返回值写回 cursorFromEnd state。
 *
 * 字符下标换算：文字用等宽数字（fontVariant tabular-nums / 表单金额均为数字），
 * 下标 ≈ (手指x − 文字左缘) ÷ (文字宽 ÷ 字符数)。文字宽度用 measureInWindow 实测，
 * 与手势事件的 pageX 同一坐标系。
 */
interface CursorAmountTextProps {
  /** 当前显示串（如 "5.00"）；空串时不渲染 */
  display: string;
  /** 光标距显示串尾部的偏移（0 = 最末尾） */
  cursorFromEnd: number;
  /** 光标移动回调（点按/拖动都会触发） */
  onCursorChange: (cursorFromEnd: number) => void;
  /** false 时不渲染光标、点按回落到 onPress */
  enabled?: boolean;
  /** 未启用时的点按回落（通常是打开计算器键盘）；启用时点按只定位光标、不触发 */
  onPress?: () => void;
  /** 文本样式（字号/颜色/字重等；不要带 width/flex 等布局属性——布局走 containerStyle） */
  style?: TextStyle | (TextStyle | undefined)[];
  /** 光标样式（各页面既有的 *Cursor 规格样式） */
  cursorStyle?: TextStyle | (TextStyle | undefined)[];
  /** 外层容器布局样式（flex/对齐等） */
  containerStyle?: ViewStyle | (ViewStyle | undefined)[];
  /** 共享拖动标记：外层若需要（如与页面其他手势协调）可传入同一份 ref；不传组件自持 */
  dragRef?: { current: boolean };
  /** 单行截断：透传给内层 Text（TASK-015 固定行高用） */
  numberOfLines?: number;
}

export function CursorAmountText({
  display,
  cursorFromEnd,
  onCursorChange,
  enabled = true,
  onPress,
  style,
  cursorStyle,
  containerStyle,
  dragRef: dragRefProp,
  numberOfLines,
}: CursorAmountTextProps) {
  const internalDragRef = useRef(false);
  const dragRef = dragRefProp ?? internalDragRef;
  const textRef = useRef<any>(null);
  const boxRef = useRef<{ x: number; w: number } | null>(null);

  const refreshTextBox = useCallback(() => {
    textRef.current?.measureInWindow((x: number, _y: number, w: number) => {
      boxRef.current = { x, w };
    });
  }, []);

  const placeCursor = useCallback(
    (pageX: number) => {
      const box = boxRef.current;
      const text = display;
      if (!box || box.w <= 0 || !text) return;
      const idx = Math.max(0, Math.min(text.length, Math.round((pageX - box.x) / (box.w / text.length))));
      onCursorChange(text.length - idx);
    },
    [display, onCursorChange]
  );

  // 长按置位 dragRef 后接管移动事件：结构与 AssetScreen 既有实现一致
  // （外层 View 挂 panHandlers，内层 Pressable 的 onLongPress 置位标记）
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: () => dragRef.current,
        onPanResponderMove: (_e, g) => placeCursor(g.moveX),
        onPanResponderRelease: () => {
          dragRef.current = false;
        },
        onPanResponderTerminate: () => {
          dragRef.current = false;
        },
      }),
    [placeCursor, dragRef]
  );

  const handlePress = useCallback(
    (e: any) => {
      if (enabled) {
        placeCursor(e?.nativeEvent?.pageX ?? 0);
      } else {
        onPress?.();
      }
    },
    [enabled, onPress, placeCursor]
  );

  const handleLongPress = useCallback(
    (e: any) => {
      if (!enabled) return;
      dragRef.current = true;
      placeCursor(e?.nativeEvent?.pageX ?? 0);
    },
    [enabled, dragRef, placeCursor]
  );

  const cursorIdx = Math.max(0, Math.min(display.length, display.length - Math.max(0, cursorFromEnd)));

  if (!display) {
    return (
      <View style={containerStyle} collapsable={false}>
        <Text style={style} />
      </View>
    );
  }

  return (
    <View style={containerStyle} collapsable={false} {...(enabled ? pan.panHandlers : {})}>
      <Pressable onPress={handlePress} onLongPress={handleLongPress} delayLongPress={300}>
        <Text ref={textRef} onLayout={refreshTextBox} style={style} numberOfLines={numberOfLines}>
          {enabled ? (
            <>
              <Text>{display.slice(0, cursorIdx)}</Text>
              <BlinkingCursor style={cursorStyle} />
              <Text>{display.slice(cursorIdx)}</Text>
            </>
          ) : (
            display
          )}
        </Text>
      </Pressable>
    </View>
  );
}
