import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../context/AppContext';
import { PeriodType } from '../types';
import { useTheme } from '../theme/useTheme';
import { ThemeColors } from '../theme/theme';

const OPTIONS: { type: PeriodType; label: string; desc: string }[] = [
  { type: 'day', label: '日', desc: '按每一天查看账单' },
  { type: 'week', label: '周', desc: '按每一周查看账单' },
  { type: 'month', label: '月', desc: '按每个月查看账单（默认）' },
  { type: 'year', label: '年', desc: '按每一年查看账单' },
  { type: 'custom', label: '自定义范围', desc: '手动指定一段起止日期' },
];

export default function PeriodScreen() {
  const { periodPreference, setPeriodPreference } = useApp();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [customStart, setCustomStart] = useState(periodPreference.customStart ?? '');
  const [customEnd, setCustomEnd] = useState(periodPreference.customEnd ?? '');

  const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

  const handleSelect = (type: PeriodType) => {
    if (type !== 'custom') {
      setPeriodPreference({ type });
      return;
    }
    // 选中"自定义范围"时先不保存，等用户填好起止日期再点确认
    setPeriodPreference({ type, customStart, customEnd });
  };

  const handleConfirmCustomRange = () => {
    if (!isValidDate(customStart) || !isValidDate(customEnd)) {
      Alert.alert('日期格式不对', '请按 YYYY-MM-DD 的格式填写，例如 2026-01-01');
      return;
    }
    if (customStart > customEnd) {
      Alert.alert('日期范围不对', '起始日期不能晚于结束日期');
      return;
    }
    setPeriodPreference({ type: 'custom', customStart, customEnd });
    Alert.alert('已保存', '自定义时间范围已更新');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <View style={styles.card}>
          {OPTIONS.map((opt, i) => {
            const active = periodPreference.type === opt.type;
            return (
              <TouchableOpacity
                key={opt.type}
                style={[styles.row, i === OPTIONS.length - 1 && { borderBottomWidth: 0 }]}
                onPress={() => handleSelect(opt.type)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{opt.label}</Text>
                  <Text style={styles.rowDesc}>{opt.desc}</Text>
                </View>
                {active && <Text style={styles.check}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        {periodPreference.type === 'custom' && (
          <View style={styles.customCard}>
            <Text style={styles.customLabel}>起始日期（YYYY-MM-DD）</Text>
            <TextInput
              style={styles.input}
              value={customStart}
              onChangeText={setCustomStart}
              placeholder="2026-01-01"
              placeholderTextColor={colors.textTertiary}
            />
            <Text style={styles.customLabel}>结束日期（YYYY-MM-DD）</Text>
            <TextInput
              style={styles.input}
              value={customEnd}
              onChangeText={setCustomEnd}
              placeholder="2026-01-31"
              placeholderTextColor={colors.textTertiary}
            />
            <TouchableOpacity style={styles.saveBtn} onPress={handleConfirmCustomRange}>
              <Text style={styles.saveBtnText}>确认保存</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    card: { backgroundColor: colors.card, borderRadius: 14, overflow: 'hidden' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.dividerHair,
    },
    rowTitle: { fontSize: 15, color: colors.textPrimary, fontWeight: '600' },
    rowDesc: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
    check: { fontSize: 18, color: colors.link, fontWeight: '700' },
    customCard: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginTop: 16 },
    customLabel: { fontSize: 12, color: colors.textTertiary, marginBottom: 6 },
    input: {
      backgroundColor: colors.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      padding: 10,
      fontSize: 14,
      color: colors.textPrimary,
      marginBottom: 14,
    },
    saveBtn: { backgroundColor: colors.textPrimary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
    saveBtnText: { color: colors.bg, fontWeight: '700', fontSize: 14 },
  });
}
