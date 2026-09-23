import React, { useMemo, useState } from 'react';
import {View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import { ThemeColors } from '../theme/theme';
import PressableScale from '../components/PressableScale';

const FREQUENCIES: { label: string; value: number }[] = [
  { label: '每年', value: 1 },
  { label: '每半年', value: 2 },
  { label: '每季度', value: 4 },
  { label: '每月', value: 12 },
];

function fmt(n: number) {
  if (!isFinite(n)) return '--';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CompoundInterestScreen({ navigation }: any) {
  const { colors } = useTheme();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [principalStr, setPrincipalStr] = useState('');
  const [rateStr, setRateStr] = useState('');
  const [yearsStr, setYearsStr] = useState('');
  const [monthlyStr, setMonthlyStr] = useState('');
  const [frequency, setFrequency] = useState(12);

  const principal = parseFloat(principalStr) || 0;
  const annualRate = parseFloat(rateStr) || 0;
  const years = parseFloat(yearsStr) || 0;
  const monthlyContribution = parseFloat(monthlyStr) || 0;

  const result = useMemo(() => {
    if (years <= 0) return null;
    const i = annualRate / 100 / frequency;
    const n = frequency * years;
    const growth = Math.pow(1 + i, n);
    const futureFromPrincipal = principal * growth;

    // 定投按频率折算：例如按季度复利，每季度实际投入的是「月定投 × 3」
    const contributionPerPeriod = monthlyContribution * (12 / frequency);
    const futureFromContributions =
      i === 0 ? contributionPerPeriod * n : contributionPerPeriod * ((growth - 1) / i);

    const futureValue = futureFromPrincipal + futureFromContributions;
    const totalContributed = principal + contributionPerPeriod * n;
    const totalInterest = futureValue - totalContributed;

    return { futureValue, totalContributed, totalInterest };
  }, [principal, annualRate, years, monthlyContribution, frequency]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}
    >
      <View style={styles.header}>
        <PressableScale onPress={() => navigation.goBack()} activeScale={0.92}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </PressableScale>
        <Text style={styles.title}>复利计算器</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView onScroll={onTabScroll ?? undefined} scrollEventThrottle={16} contentContainerStyle={{ padding: 20, paddingBottom: tabClearance }}>
        <Text style={styles.label}>本金</Text>
        <TextInput
          style={styles.input}
          value={principalStr}
          onChangeText={setPrincipalStr}
          keyboardType="numeric"
          placeholder="例如 100000"
          placeholderTextColor={colors.textTertiary}
        />

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>年利率 (%)</Text>
            <TextInput
              style={styles.input}
              value={rateStr}
              onChangeText={setRateStr}
              keyboardType="numeric"
              placeholder="例如 5"
              placeholderTextColor={colors.textTertiary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>年限</Text>
            <TextInput
              style={styles.input}
              value={yearsStr}
              onChangeText={setYearsStr}
              keyboardType="numeric"
              placeholder="例如 10"
              placeholderTextColor={colors.textTertiary}
            />
          </View>
        </View>

        <Text style={styles.label}>每月定投（可选，不投就填 0）</Text>
        <TextInput
          style={styles.input}
          value={monthlyStr}
          onChangeText={setMonthlyStr}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={colors.textTertiary}
        />

        <Text style={styles.label}>复利频率</Text>
        <View style={styles.freqRow}>
          {FREQUENCIES.map((f) => (
            <PressableScale
              key={f.value}
              style={[styles.freqBtn, frequency === f.value && styles.freqBtnActive]}
              activeScale={0.95}
              onPress={() => setFrequency(f.value)}
            >
              <Text style={[styles.freqText, frequency === f.value && styles.freqTextActive]}>{f.label}</Text>
            </PressableScale>
          ))}
        </View>

        {result ? (
          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>到期总额</Text>
            <Text style={styles.resultValue}>{fmt(result.futureValue)}</Text>
            <View style={styles.divider} />
            <View style={styles.resultRow}>
              <Text style={styles.resultLabelSmall}>累计投入本金</Text>
              <Text style={styles.resultValueSmall}>{fmt(result.totalContributed)}</Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabelSmall}>利息总额</Text>
              <Text style={styles.resultValueSmall}>{fmt(result.totalInterest)}</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.hint}>请输入本金、利率和年限</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1 },
    header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
    title: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
    label: { fontSize: 12, color: colors.textTertiary, marginTop: 16, marginBottom: 8 },
    input: {
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      padding: 12,
      fontSize: 15,
      color: colors.textPrimary,
    },
    freqRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    freqBtn: {
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      backgroundColor: colors.card,
    },
    freqBtnActive: { borderColor: colors.link, backgroundColor: colors.link + '14' },
    freqText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
    freqTextActive: { color: colors.link },
    resultCard: { backgroundColor: colors.card, borderRadius: 14, padding: 18, marginTop: 24, alignItems: 'center' },
    resultLabel: { fontSize: 13, color: colors.textSecondary },
    resultValue: { fontSize: 26, fontWeight: '700', color: colors.textPrimary, marginTop: 6 },
    divider: { height: 1, backgroundColor: colors.dividerHair, marginVertical: 14, alignSelf: 'stretch' },
    resultRow: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', paddingVertical: 4 },
    resultLabelSmall: { fontSize: 12, color: colors.textTertiary },
    resultValueSmall: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
    hint: { fontSize: 13, color: colors.textTertiary, textAlign: 'center', marginTop: 40 },
  });
}
