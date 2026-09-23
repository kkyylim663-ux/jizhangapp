import { useCallback, useRef, useState } from 'react';

/**
 * 把用户目前打进输入框的原始字符串，格式化成"整数.两位小数"。
 *
 * 核心思路：不管输入框里现在显示的是什么，每次改动都只看
 * "这里面一共有几个数字字符"，然后把最后两位强制当成小数——
 * 这样退格、粘贴、清空都能自然处理，不需要单独写分支。
 */
export function formatMoneyCentsInput(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, ''); // 去掉非数字字符（含用户可能打进来的小数点）
  if (!digits) return '';
  const padded = digits.padStart(3, '0'); // 位数不够3位就补0，保证切得出"整数部分+分位"
  const intPart = padded.slice(0, -2).replace(/^0+(?=\d)/, ''); // 去掉多余前导0
  const decPart = padded.slice(-2);
  return `${intPart}.${decPart}`;
}

/**
 * 把一个已有数字（比如从后端/state里取出的 1500.5）转成同样规则的显示字符串。
 *
 * 用于"编辑已有记录"场景：初始值必须先标准化成两位小数字符串再放进 state，
 * 否则用户一开始输入，formatMoneyCentsInput 重新解析出来的数字个数会跟原来的对不上
 * （因为它只认数字个数，不认小数点原来在哪）。
 */
export function toMoneyCentsDisplay(value: number | string | undefined | null): string {
  if (value === undefined || value === null || value === '') return '';
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(n)) return '';
  return n.toFixed(2);
}

interface UseMoneyCentsInputOptions {
  /** 初始金额（元），如编辑已有账户时传入 1500.5，会被标准化成 "1500.50" */
  initialValue?: number | string;
  /** 每次数值真正变化（而不是每次按键）时触发，方便驱动表单校验/联动 */
  onChange?: (numericValue: number, displayValue: string) => void;
}

interface UseMoneyCentsInputResult {
  /** 直接喂给 TextInput 的 value，例如 "1.00" */
  displayValue: string;
  /** 转成 number 用于提交/计算，例如 1 */
  numericValue: number;
  /** 直接喂给 TextInput 的 onChangeText */
  onChangeText: (raw: string) => void;
  /** 需要外部重置（比如切换编辑对象、提交后清空）时调用 */
  reset: (value?: number | string) => void;
}

/**
 * 金额输入的核心状态管理：接管 TextInput 的 value/onChangeText，
 * 自动把"用户依次按下的数字"格式化成"整数.两位小数"。
 *
 * 用法：
 *   const money = useMoneyCentsInput({ initialValue: editingAccount?.balance });
 *   <TextInput
 *     keyboardType="decimal-pad"
 *     value={money.displayValue}
 *     onChangeText={money.onChangeText}
 *   />
 */
export function useMoneyCentsInput(
  options: UseMoneyCentsInputOptions = {}
): UseMoneyCentsInputResult {
  const { initialValue, onChange } = options;
  const [displayValue, setDisplayValue] = useState(() => toMoneyCentsDisplay(initialValue));
  const numericValue = displayValue ? parseFloat(displayValue) : 0;

  // 用 ref 记上一次的数值，避免 displayValue 每次按键都触发 onChange
  // （其实按键就是在变，这里主要是为了 reset() 之后不重复触发）
  const lastReported = useRef(numericValue);

  const report = useCallback(
    (next: string) => {
      const nextNumeric = next ? parseFloat(next) : 0;
      if (nextNumeric !== lastReported.current) {
        lastReported.current = nextNumeric;
        onChange?.(nextNumeric, next);
      }
    },
    [onChange]
  );

  const onChangeText = useCallback(
    (raw: string) => {
      const formatted = formatMoneyCentsInput(raw);
      setDisplayValue(formatted);
      report(formatted);
    },
    [report]
  );

  const reset = useCallback(
    (value?: number | string) => {
      const formatted = toMoneyCentsDisplay(value);
      setDisplayValue(formatted);
      lastReported.current = formatted ? parseFloat(formatted) : 0;
    },
    []
  );

  return { displayValue, numericValue, onChangeText, reset };
}
