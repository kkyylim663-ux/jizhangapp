import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CURRENCY_OPTIONS } from '../utils/currencies';
import { useTheme } from '../theme/useTheme';
import { ThemeColors } from '../theme/theme';

interface Props {
  /** 当前选中的币种 code */
  selected: string;
  onSelect: (code: string) => void;
}

// 常用货币展示数量：对应 CURRENCY_OPTIONS 数组里排在前面的常用币种（MYR~THB）
const COMMON_COUNT = 12;

/**
 * 内联货币选择卡：替代原来又长又挤的底部弹层。
 * 默认只显示前 COMMON_COUNT 个常用货币，两列网格一屏放下；
 * 底部"更多货币"展开后显示 CURRENCY_OPTIONS 全部选项。
 * 如果当前选中的币种不在常用列表里，默认直接展开，避免用户看不到自己当前的选择。
 * 点一下立刻切换（onSelect 后由调用方收起整个组件），不需要再点"取消/完成"。
 */
export default function InlineCurrencyPicker({ selected, onSelect }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const isSelectedInCommon = CURRENCY_OPTIONS.slice(0, COMMON_COUNT).some((c) => c.code === selected);
  const [showAll, setShowAll] = useState(!isSelectedInCommon);

  const visibleOptions = showAll ? CURRENCY_OPTIONS : CURRENCY_OPTIONS.slice(0, COMMON_COUNT);

  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        {visibleOptions.map((c) => {
          const active = c.code === selected;
          return (
            <TouchableOpacity
              key={c.code}
              style={[styles.cell, active && styles.cellActive]}
              onPress={() => onSelect(c.code)}
              activeOpacity={0.7}
            >
              <View style={styles.cellTextWrap}>
                <Text style={[styles.code, active && { color: colors.link }]}>{c.code}</Text>
                <Text style={styles.name} numberOfLines={1}>
                  {c.name}
                </Text>
              </View>
              {active && (
                <Ionicons name="checkmark-circle" size={18} color={colors.link} style={styles.check} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {!showAll && (
        <TouchableOpacity style={styles.moreBtn} onPress={() => setShowAll(true)} activeOpacity={0.7}>
          <Text style={styles.moreBtnText}>更多货币</Text>
          <Ionicons name="chevron-down" size={16} color={colors.link} style={{ marginLeft: 4 }} />
        </TouchableOpacity>
      )}
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
      padding: 8,
      marginTop: 8,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    cell: {
      width: '48.5%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      paddingVertical: 8,
      paddingHorizontal: 10,
      marginBottom: 6,
    },
    cellActive: {
      borderColor: colors.link,
      borderWidth: 1.5,
    },
    cellTextWrap: {
      flex: 1,
      flexDirection: 'column',
    },
    code: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    name: { fontSize: 11, color: colors.textTertiary, marginTop: 1 },
    check: {
      position: 'absolute',
      top: 4,
      right: 4,
    },
    moreBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      marginTop: 2,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      borderStyle: 'dashed',
    },
    moreBtnText: { fontSize: 13, fontWeight: '600', color: colors.link },
  });
}
