import React, { forwardRef } from 'react';
import { TextInput, TextInputProps } from 'react-native';
import { ChainedTextInput } from './ChainedTextInput';
import { useMoneyCentsInput } from '../hooks/useMoneyCentsInput';

interface MoneyInputProps
  extends Omit<TextInputProps, 'value' | 'onChangeText' | 'keyboardType'> {
  /** 在字段链里的名字，需要跟外层 <FieldChainProvider fields={[...]}> 里的名字对应 */
  field: string;
  /** 编辑已有数据时传入，如 1500.5，会被标准化成 "1500.50" 再显示 */
  initialValue?: number | string;
  /** 数值真正变化时回调（而不是每次按键），拿去更新表单 state / 做校验 */
  onAmountChange?: (numericValue: number, displayValue: string) => void;
}

/**
 * 三件事的组合体：
 *   1. keyboardType="decimal-pad" —— 调出系统数字键盘，不用自己画
 *   2. useMoneyCentsInput —— "打100自动变1.00"的格式化逻辑
 *   3. ChainedTextInput —— 接入 FieldChainProvider，支持"下一项"跳转
 *
 * 业务代码只需要：
 *   <FieldChainProvider fields={['amount', 'name', 'creditLimit']}>
 *     <MoneyInput
 *       field="amount"
 *       initialValue={editingAccount?.balance}
 *       onAmountChange={(value) => setAmount(value)}
 *     />
 *     ...
 *   </FieldChainProvider>
 *
 * 注意：因为格式化逻辑只认"数字个数"，不产生负号，如果某个场景需要负数金额
 * （比如"支出为负、收入为正"），建议在外层单独用一个正负切换开关，
 * 而不是让用户在这个输入框里直接打"-"。
 */
export const MoneyInput = forwardRef<TextInput, MoneyInputProps>(
  ({ field, initialValue, onAmountChange, ...rest }, ref) => {
    const { displayValue, onChangeText } = useMoneyCentsInput({
      initialValue,
      onChange: onAmountChange,
    });

    return (
      <ChainedTextInput
        ref={ref}
        field={field}
        keyboardType="decimal-pad"
        value={displayValue}
        onChangeText={onChangeText}
        {...rest}
      />
    );
  }
);

MoneyInput.displayName = 'MoneyInput';
