import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { ThemeColors } from '../theme/theme';

export interface InlineOption {
  label: string;
  value: string;
}

interface Props {
  options: InlineOption[];
  /** 当前选中的 option.value，打 ✓ 高亮 */
  selected?: string;
  /** 点任何一项立即生效；收起由调用方控制（通常选完即收） */
  onSelect: (value: string) => void;
}

/**
 * 内联设置选项卡：预设账本/日期格式/深色模式等短选项列表的行下展开样式，
 * 替代底部弹层——点一下立即切换，不需要再点"取消/完成"。
 * （货币因为条目多做成两列网格，见 InlineCurrencyPicker；这个组件管普通单列选项。）
 */
export default function InlineOptionPicker({ options, selected, onSelect }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={styles.wrap}>
      {options.map((opt, i) => {
        const active = opt.value === selected;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.row, i === options.length - 1 && { borderBottomWidth: 0 }]}
            onPress={() => onSelect(opt.value)}
            activeOpacity={0.7}
          >
            <Text style={[styles.label, active && { color: colors.link, fontWeight: '700' }]}>{opt.label}</Text>
            {/* 选中只画一个纯对勾，不带圆框；未选中不显示图标 */}
            {active && <Ionicons name="checkmark" size={20} color={colors.link} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingHorizontal: 14,
      marginTop: 8,
      marginBottom: 8,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.dividerHair,
    },
    label: { fontSize: 14, color: colors.textPrimary },
  });
}