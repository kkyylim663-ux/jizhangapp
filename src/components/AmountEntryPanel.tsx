import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { useAmountExpression } from '../hooks/useAmountExpression';
import { AmountCalculatorKeypad } from './AmountCalculatorKeypad';
import DateRangePickerSheet from './DateRangePickerSheet';

interface AmountEntryPanelProps {
  initialValue?: number;      // 编辑已有记录时传入
  initialDate?: string;       // 'YYYY-MM-DD'，跟项目里其他地方的日期格式保持一致
  initialNote?: string;
  onConfirm: (result: { amount: number; date: string; note: string }) => void;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateLabel(dateStr: string): string {
  if (dateStr === todayStr()) return '今天';
  const [, m, d] = dateStr.split('-');
  return `${Number(m)}月${Number(d)}日`;
}

/**
 * 开箱即用的整块金额输入面板：顶部金额展示 + 备注栏 + 日期 chip + 自绘键盘。
 * 日期选择直接复用项目里已有的 DateRangePickerSheet（mode="single"），
 * 不另外造一个日历组件，保证跟其他页面的日期选择样式完全一致。
 *
 * 注意：这是给"只需要金额+备注+日期"的简单场景用的开箱即用组件。
 * AddTransactionScreen 本身还有类别/资产/凭证等更多字段，
 * 直接整体替换成这个面板可能装不下——那边更适合只拆出
 * useAmountExpression + AmountCalculatorKeypad 两块，嵌进现有表单结构里，
 * 日期部分复用已经在用的 <DateRangePickerSheet mode="single" ... />。
 */
export function AmountEntryPanel({ initialValue, initialDate, initialNote, onConfirm }: AmountEntryPanelProps) {
  const { colors } = useTheme();
  const { displayValue, isMulti, pressKey, confirm } = useAmountExpression(initialValue);
  const [date, setDate] = useState(initialDate ?? todayStr());
  const [note, setNote] = useState(initialNote ?? '');
  const [calendarOpen, setCalendarOpen] = useState(false);

  const handleConfirm = () => {
    const amount = confirm();
    onConfirm({ amount, date, note });
  };

  return (
    <View>
      {/* 顶部金额展示：多项拆分时字号小一点，免得 "15.00+20.00+5.00" 溢出 */}
      <View style={styles.amountRow}>
        <Text
          style={[styles.amountText, { color: colors.textPrimary }, isMulti && styles.amountTextSmall]}
          numberOfLines={1}
        >
          {displayValue}
        </Text>
      </View>

      {/* 备注栏 + 日期：点日期弹出 DateRangePickerSheet(single)，键盘里的"今天"按钮是快捷方式 */}
      <View style={[styles.metaRow, { backgroundColor: colors.card }]}>
        <Text style={[styles.metaLabel, { color: colors.textTertiary }]}>备注：</Text>
        <TextInput
          style={[styles.noteInput, { color: colors.textPrimary }]}
          placeholder="点击填写备注"
          placeholderTextColor={colors.textTertiary}
          value={note}
          onChangeText={setNote}
        />
        <Pressable onPress={() => setCalendarOpen(true)}>
          <Text style={[styles.dateChip, { color: colors.link }]}>{formatDateLabel(date)}</Text>
        </Pressable>
      </View>

      <AmountCalculatorKeypad
        onPressKey={pressKey}
        onPressToday={() => setDate(todayStr())}
        onConfirm={handleConfirm}
        onClear={() => pressKey('backspace')}
      />

      <DateRangePickerSheet
        visible={calendarOpen}
        start={date}
        end={date}
        mode="single"
        onApply={(picked) => setDate(picked)}
        onClose={() => setCalendarOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  amountRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'flex-end',
  },
  amountText: {
    fontSize: 34,
    fontWeight: '600',
  },
  amountTextSmall: {
    fontSize: 22,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  metaLabel: {
    fontSize: 14,
  },
  noteInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  dateChip: {
    fontSize: 14,
    fontWeight: '500',
  },
});
