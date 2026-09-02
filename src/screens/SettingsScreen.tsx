import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../context/AppContext';
import { CURRENCY_OPTIONS } from '../utils/currencies';
import { useTheme } from '../theme/useTheme';
import { useThemeMode, ThemeMode } from '../context/ThemeModeContext';
import { ThemeColors } from '../theme/theme';

const PERIOD_LABELS: Record<string, string> = {
  day: '日',
  week: '周',
  month: '月',
  year: '年',
  custom: '自定义范围',
};

const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  system: '跟随系统',
  light: '浅色模式',
  dark: '深色模式',
};

export default function SettingsScreen({ navigation }: any) {
  const goBackToHome = () => {
    navigation.getParent()?.navigate('首页');
  };
  const { currency, periodPreference, ledgers, activeLedgerId } = useApp();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { themeMode, setThemeMode } = useThemeMode();

  const currencyName = CURRENCY_OPTIONS.find((c) => c.code === currency)?.name ?? currency;
  const activeLedgerName = ledgers.find((l) => l.id === activeLedgerId)?.name ?? '默认账本';

  const handlePickThemeMode = () => {
    Alert.alert('深色模式', '选择显示方式', [
      { text: THEME_MODE_LABELS.system, onPress: () => setThemeMode('system') },
      { text: THEME_MODE_LABELS.light, onPress: () => setThemeMode('light') },
      { text: THEME_MODE_LABELS.dark, onPress: () => setThemeMode('dark') },
      { text: '取消', style: 'cancel' },
    ]);
  };

  const rows = [
    {
      key: 'category',
      title: '类别分类',
      value: '',
      onPress: () => navigation.navigate('类别分类'),
    },
    {
      key: 'currency',
      title: '选择货币',
      value: currencyName,
      onPress: () => navigation.navigate('选择货币'),
    },
    {
      key: 'period',
      title: '自定义周期',
      value: PERIOD_LABELS[periodPreference.type],
      onPress: () => navigation.navigate('自定义周期'),
    },
    {
      key: 'ledger',
      title: '开设账本',
      value: activeLedgerName,
      onPress: () => navigation.navigate('开设账本'),
    },
    {
      key: 'ai',
      title: 'AI专区',
      value: '',
      onPress: () => navigation.navigate('AI专区'),
    },
  ];

  const appearanceRows = [
    {
      key: 'themeMode',
      title: '深色模式',
      value: THEME_MODE_LABELS[themeMode],
      onPress: handlePickThemeMode,
    },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <View style={styles.card}>
          {appearanceRows.map((row, i) => (
            <TouchableOpacity
              key={row.key}
              style={[styles.row, i === appearanceRows.length - 1 && { borderBottomWidth: 0 }]}
              onPress={row.onPress}
            >
              <Text style={styles.rowTitle}>{row.title}</Text>
              <View style={styles.rowRight}>
                {!!row.value && <Text style={styles.rowValue}>{row.value}</Text>}
                <Text style={styles.chevron}>›</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.card, { marginTop: 16 }]}>
          {rows.map((row, i) => (
            <TouchableOpacity
              key={row.key}
              style={[styles.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}
              onPress={row.onPress}
            >
              <Text style={styles.rowTitle}>{row.title}</Text>
              <View style={styles.rowRight}>
                {!!row.value && <Text style={styles.rowValue}>{row.value}</Text>}
                <Text style={styles.chevron}>›</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
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
      paddingVertical: 16,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.dividerHair,
    },
    rowTitle: { fontSize: 15, color: colors.textPrimary, fontWeight: '600' },
    rowRight: { flexDirection: 'row', alignItems: 'center' },
    rowValue: { fontSize: 14, color: colors.textSecondary, marginRight: 6 },
    chevron: { fontSize: 18, color: colors.textTertiary },
  });
}
