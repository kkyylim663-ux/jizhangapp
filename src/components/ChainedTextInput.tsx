import React, { forwardRef } from 'react';
import { NativeSyntheticEvent, Platform, TextInput, TextInputProps, TextInputSubmitEditingEventData } from 'react-native';
import { useFieldChain } from './FieldChainProvider';

interface ChainedTextInputProps extends TextInputProps {
  /** 必须跟 FieldChainProvider 的 fields 数组里的名字一一对应 */
  field: string;
}

/**
 * 自动接入 FieldChainProvider 的 TextInput：
 * 处理好 ref 注册、onFocus 上报、Android 的 returnKeyType="next"/onSubmitEditing、
 * iOS 的 inputAccessoryViewID —— 业务代码只需要关心 value/onChangeText 本身。
 *
 * 不需要金额格式化的普通字段（比如"名称""备注"）也可以直接用它来接入跳转链；
 * 需要金额格式化的字段用同目录下的 <MoneyInput /> ，它内部就是基于这个组件实现的。
 */
export const ChainedTextInput = forwardRef<TextInput, ChainedTextInputProps>(
  ({ field, onFocus, onSubmitEditing, returnKeyType, ...rest }, forwardedRef) => {
    const { registerRef, goNext, setFocusedField, accessoryViewID } = useFieldChain();

    const handleFocus: TextInputProps['onFocus'] = (e) => {
      setFocusedField(field);
      onFocus?.(e);
    };

    const handleSubmitEditing = (e: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
      // Android 数字键盘的"下一步"键会触发这里；iOS 因为没有回车键，
      // 实际跳转由 FieldChainProvider 里的 InputAccessoryView 按钮触发
      goNext(field);
      onSubmitEditing?.(e);
    };

    return (
      <TextInput
        ref={(node) => {
          registerRef(field, node);
          if (typeof forwardedRef === 'function') forwardedRef(node);
          else if (forwardedRef) (forwardedRef as React.MutableRefObject<TextInput | null>).current = node;
        }}
        // Android 靠系统自带的"下一步"键；iOS 这个键在 decimal-pad/number-pad 下不存在，
        // 保留调用方自定义 returnKeyType 的余地（比如文本字段可能想要别的类型）
        returnKeyType={returnKeyType ?? (Platform.OS === 'android' ? 'next' : undefined)}
        inputAccessoryViewID={Platform.OS === 'ios' ? accessoryViewID : undefined}
        onFocus={handleFocus}
        onSubmitEditing={handleSubmitEditing}
        {...rest}
      />
    );
  }
);

ChainedTextInput.displayName = 'ChainedTextInput';
