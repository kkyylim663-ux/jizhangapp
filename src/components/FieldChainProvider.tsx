import React, { createContext, ReactNode, useContext, useMemo, useRef, useState } from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';

interface FieldChainContextValue {
  registerRef: (field: string, ref: TextInput | null) => void;
  focusField: (field: string) => void;
  goNext: (currentField: string) => void;
  setFocusedField: (field: string | null) => void;
  /** iOS 专用：InputAccessoryView 的 nativeID，同一 Provider 下的输入框都应该用这个 */
  accessoryViewID: string;
}

const FieldChainContext = createContext<FieldChainContextValue | null>(null);

export function useFieldChain(): FieldChainContextValue {
  const ctx = useContext(FieldChainContext);
  if (!ctx) {
    throw new Error('useFieldChain 必须在 <FieldChainProvider> 内部使用');
  }
  return ctx;
}

interface FieldChainProviderProps {
  /** 表单字段的填写顺序，跟界面从上到下的顺序保持一致，如 ['amount', 'name', 'creditLimit'] */
  fields: string[];
  /** 同一屏里如果有多组独立表单，用不同 id 区分 accessoryViewID，避免横条互相顶替 */
  id?: string;
  /** 自定义横条容器样式（可选） */
  barStyle?: ViewStyle;
  /** 非最后一项时按钮文案，默认"下一项" */
  nextLabel?: string;
  /** 最后一项时按钮文案，默认"完成" */
  doneLabel?: string;
  children: ReactNode;
}

/**
 * 把一组 TextInput 串成"点下一项自动跳焦点"的整体。
 *
 * 背景：Android 数字键盘自带"下一步"键，靠 returnKeyType="next" 就行；
 * 但 iOS 的 decimal-pad/number-pad 压根没有回车键（系统限制，不是RN的bug），
 * 所以 iOS 端统一渲染一条 InputAccessoryView 横条，跟着当前聚焦的输入框
 * 浮在键盘正上方，点按钮时查 fields 顺序表，跳到下一个该聚焦的字段。
 *
 * 用法：
 *   <FieldChainProvider fields={['amount', 'name', 'creditLimit']}>
 *     <ChainedTextInput field="amount" ... />
 *     <ChainedTextInput field="name" ... />
 *     <ChainedTextInput field="creditLimit" ... />
 *   </FieldChainProvider>
 */
export function FieldChainProvider({
  fields,
  id = 'fieldChainBar',
  barStyle,
  nextLabel = '下一项',
  doneLabel = '完成',
  children,
}: FieldChainProviderProps) {
  const refs = useRef<Record<string, TextInput | null>>({});
  const [focusedField, setFocusedField] = useState<string | null>(null);
  // 用 id + 字段列表拼出唯一的 accessoryViewID，避免同一屏多组表单互相干扰
  const accessoryViewID = useMemo(() => `${id}-${fields.join('-')}`, [id, fields]);

  const registerRef = (field: string, ref: TextInput | null) => {
    refs.current[field] = ref;
  };

  const focusField = (field: string) => {
    refs.current[field]?.focus();
  };

  const goNext = (currentField: string) => {
    const idx = fields.indexOf(currentField);
    const next = fields[idx + 1];
    if (next) {
      focusField(next);
    } else {
      Keyboard.dismiss();
    }
  };

  const value = useMemo(
    () => ({ registerRef, focusField, goNext, setFocusedField, accessoryViewID }),
    [accessoryViewID]
  );

  const isLast = focusedField ? fields.indexOf(focusedField) === fields.length - 1 : false;

  return (
    <FieldChainContext.Provider value={value}>
      {children}
      {/* 同一个 nativeID 的 InputAccessoryView 只需要渲染一份，谁聚焦就跟着谁出现 */}
      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={accessoryViewID}>
          <View style={[styles.bar, barStyle]}>
            <TouchableOpacity
              onPress={() => (focusedField ? goNext(focusedField) : Keyboard.dismiss())}
            >
              <Text style={styles.barButtonText}>{isLast ? doneLabel : nextLabel}</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}
    </FieldChainContext.Provider>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#F2F2F7',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#C7C7CC',
  },
  barButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
});
