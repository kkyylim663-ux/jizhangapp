import React, { useMemo, useState } from 'react';
import {View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import { ThemeColors } from '../theme/theme';
import PressableScale from '../components/PressableScale';

type Method = 'reducing' | 'straight' | 'flat';

type ScheduleRow = {
  period: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
};

function fmt(n: number) {
  if (!isFinite(n)) return '--';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 余额递减法（等额本息）：每月供款固定，利息按剩余本金算，本金部分逐月变多
function buildReducingSchedule(principal: number, monthlyRate: number, months: number): { payment: number; rows: ScheduleRow[] } {
  const payment =
    monthlyRate === 0
      ? principal / months
      : (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);

  const rows: ScheduleRow[] = [];
  let balance = principal;
  for (let period = 1; period <= months; period++) {
    const interest = balance * monthlyRate;
    let principalPortion = payment - interest;
    if (period === months) principalPortion = balance; // 抹掉最后一期的浮点误差
    balance = Math.max(0, balance - principalPortion);
    rows.push({ period, payment: principalPortion + interest, principal: principalPortion, interest, balance });
  }
  return { payment, rows };
}

// 直线法（等额本金）：每月还的本金固定，利息按剩余本金算，月供逐月变少
function buildStraightSchedule(principal: number, monthlyRate: number, months: number): { rows: ScheduleRow[] } {
  const monthlyPrincipal = principal / months;
  const rows: ScheduleRow[] = [];
  let balance = principal;
  for (let period = 1; period <= months; period++) {
    const interest = balance * monthlyRate;
    balance = Math.max(0, balance - monthlyPrincipal);
    rows.push({ period, payment: monthlyPrincipal + interest, principal: monthlyPrincipal, interest, balance });
  }
  return { rows };
}

// 平息法（Flat Rate）：利息一开始就按最初的本金总额算死、平摊到每期，
// 不管你已经还了多少本金，每期利息永远是同一个数字——跟前两种「利息按剩余本金算」的逻辑完全不同，
// 所以本金和月供都是固定值，总利息 = 本金 × 月利率 × 期数（相当于单利，不复利）。
function buildFlatSchedule(principal: number, monthlyRate: number, months: number): { payment: number; rows: ScheduleRow[] } {
  const totalInterest = principal * monthlyRate * months;
  const monthlyPrincipal = principal / months;
  const monthlyInterest = totalInterest / months;
  const payment = monthlyPrincipal + monthlyInterest;

  const rows: ScheduleRow[] = [];
  let balance = principal;
  for (let period = 1; period <= months; period++) {
    balance = Math.max(0, balance - monthlyPrincipal);
    rows.push({ period, payment, principal: monthlyPrincipal, interest: monthlyInterest, balance });
  }
  return { payment, rows };
}

export default function LoanCalculatorScreen({ navigation }: any) {
  const { colors } = useTheme();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [principalStr, setPrincipalStr] = useState('');
  const [rateStr, setRateStr] = useState('');
  const [yearsStr, setYearsStr] = useState('');
  const [method, setMethod] = useState<Method>('reducing');
  const [showSchedule, setShowSchedule] = useState(false);

  const principal = parseFloat(principalStr) || 0;
  const annualRate = parseFloat(rateStr) || 0;
  const years = parseFloat(yearsStr) || 0;
  const months = Math.max(0, Math.round(years * 12));
  const monthlyRate = annualRate / 100 / 12;

  const result = useMemo(() => {
    if (principal <= 0 || months <= 0) return null;
    if (method === 'reducing') {
      const { payment, rows } = buildReducingSchedule(principal, monthlyRate, months);
      const totalPaid = rows.reduce((s, r) => s + r.payment, 0);
      return {
        firstPayment: payment,
        lastPayment: payment,
        totalInterest: totalPaid - principal,
        totalPaid,
        rows,
      };
    } else if (method === 'straight') {
      const { rows } = buildStraightSchedule(principal, monthlyRate, months);
      const totalPaid = rows.reduce((s, r) => s + r.payment, 0);
      return {
        firstPayment: rows[0].payment,
        lastPayment: rows[rows.length - 1].payment,
        totalInterest: totalPaid - principal,
        totalPaid,
        rows,
      };
    } else {
      const { payment, rows } = buildFlatSchedule(principal, monthlyRate, months);
      const totalPaid = rows.reduce((s, r) => s + r.payment, 0);
      return {
        firstPayment: payment,
        lastPayment: payment,
        totalInterest: totalPaid - principal,
        totalPaid,
        rows,
      };
    }
  }, [principal, monthlyRate, months, method]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}
    >
      <View style={styles.header}>
        <PressableScale onPress={() => navigation.goBack()} activeScale={0.92}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </PressableScale>
        <Text style={styles.title}>贷款计算器</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView onScroll={onTabScroll ?? undefined} scrollEventThrottle={16} contentContainerStyle={{ padding: 20, paddingBottom: tabClearance }}>
        <Text style={styles.label}>贷款本金</Text>
        <TextInput
          style={styles.input}
          value={principalStr}
          onChangeText={setPrincipalStr}
          keyboardType="numeric"
          placeholder="例如 10000"
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
              placeholder="例如 10"
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
              placeholder="例如 5"
              placeholderTextColor={colors.textTertiary}
            />
          </View>
        </View>

        <Text style={styles.label}>还款方式</Text>
        <View style={styles.methodRow}>
          <PressableScale
            style={[styles.methodBtn, method === 'reducing' && styles.methodBtnActive]}
            activeScale={0.95}
            onPress={() => setMethod('reducing')}
          >
            <Text style={[styles.methodText, method === 'reducing' && styles.methodTextActive]}>
              余额递减法{'\n'}
              <Text style={styles.methodSub}>月供固定</Text>
            </Text>
          </PressableScale>
          <PressableScale
            style={[styles.methodBtn, method === 'straight' && styles.methodBtnActive]}
            activeScale={0.95}
            onPress={() => setMethod('straight')}
          >
            <Text style={[styles.methodText, method === 'straight' && styles.methodTextActive]}>
              直线法{'\n'}
              <Text style={styles.methodSub}>月供递减</Text>
            </Text>
          </PressableScale>
          <PressableScale
            style={[styles.methodBtn, method === 'flat' && styles.methodBtnActive]}
            activeScale={0.95}
            onPress={() => setMethod('flat')}
          >
            <Text style={[styles.methodText, method === 'flat' && styles.methodTextActive]}>
              平息法{'\n'}
              <Text style={styles.methodSub}>本息都固定</Text>
            </Text>
          </PressableScale>
        </View>

        {result ? (
          <>
            <View style={styles.resultCard}>
              {method !== 'straight' ? (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>每月供款</Text>
                  <Text style={styles.resultValue}>{fmt(result.firstPayment)}</Text>
                </View>
              ) : (
                <>
                  <View style={styles.resultRow}>
                    <Text style={styles.resultLabel}>首月供款</Text>
                    <Text style={styles.resultValue}>{fmt(result.firstPayment)}</Text>
                  </View>
                  <View style={styles.resultRow}>
                    <Text style={styles.resultLabel}>末月供款</Text>
                    <Text style={styles.resultValue}>{fmt(result.lastPayment)}</Text>
                  </View>
                </>
              )}
              <View style={styles.divider} />
              <View style={styles.resultRow}>
                <Text style={styles.resultLabelSmall}>还款总额</Text>
                <Text style={styles.resultValueSmall}>{fmt(result.totalPaid)}</Text>
              </View>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabelSmall}>利息总额</Text>
                <Text style={styles.resultValueSmall}>{fmt(result.totalInterest)}</Text>
              </View>
            </View>

            <PressableScale style={styles.toggleBtn} activeScale={0.94} onPress={() => setShowSchedule((v) => !v)}>
              <Text style={styles.toggleBtnText}>{showSchedule ? '收起每月明细' : `查看每月明细（共 ${months} 期）`}</Text>
              <Ionicons name={showSchedule ? 'chevron-up' : 'chevron-down'} size={16} color={colors.link} />
            </PressableScale>

            {showSchedule && (
              <View style={styles.scheduleCard}>
                <View style={styles.scheduleHeaderRow}>
                  <Text style={[styles.scheduleCell, styles.scheduleHeaderText, { flex: 0.6 }]}>期数</Text>
                  <Text style={[styles.scheduleCell, styles.scheduleHeaderText]}>月供</Text>
                  <Text style={[styles.scheduleCell, styles.scheduleHeaderText]}>本金</Text>
                  <Text style={[styles.scheduleCell, styles.scheduleHeaderText]}>利息</Text>
                  <Text style={[styles.scheduleCell, styles.scheduleHeaderText]}>剩余本金</Text>
                </View>
                {result.rows.map((r) => (
                  <View key={r.period} style={styles.scheduleRow}>
                    <Text style={[styles.scheduleCell, { flex: 0.6 }]}>{r.period}</Text>
                    <Text style={styles.scheduleCell}>{fmt(r.payment)}</Text>
                    <Text style={styles.scheduleCell}>{fmt(r.principal)}</Text>
                    <Text style={styles.scheduleCell}>{fmt(r.interest)}</Text>
                    <Text style={styles.scheduleCell}>{fmt(r.balance)}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
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
    methodRow: { flexDirection: 'row', gap: 8 },
    methodBtn: {
      flex: 1,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      backgroundColor: colors.card,
      paddingVertical: 10,
      paddingHorizontal: 6,
      alignItems: 'center',
    },
    methodBtnActive: { borderColor: colors.link, backgroundColor: colors.link + '14' },
    methodText: { fontSize: 12, fontWeight: '700', color: colors.textPrimary, lineHeight: 18, textAlign: 'center' },
    methodTextActive: { color: colors.link },
    methodSub: { fontSize: 10, fontWeight: '400', color: colors.textTertiary },
    resultCard: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginTop: 24 },
    resultRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
    resultLabel: { fontSize: 14, color: colors.textSecondary },
    resultValue: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
    resultLabelSmall: { fontSize: 12, color: colors.textTertiary },
    resultValueSmall: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
    divider: { height: 1, backgroundColor: colors.dividerHair, marginVertical: 10 },
    toggleBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 14,
    },
    toggleBtnText: { fontSize: 13, fontWeight: '600', color: colors.link },
    scheduleCard: { backgroundColor: colors.card, borderRadius: 14, padding: 12, marginBottom: 20 },
    scheduleHeaderRow: {
      flexDirection: 'row',
      paddingBottom: 8,
      marginBottom: 4,
      borderBottomWidth: 1,
      borderBottomColor: colors.dividerHair,
    },
    scheduleHeaderText: { fontWeight: '700', color: colors.textTertiary },
    scheduleRow: { flexDirection: 'row', paddingVertical: 6 },
    scheduleCell: { flex: 1, fontSize: 11, color: colors.textPrimary },
    hint: { fontSize: 13, color: colors.textTertiary, textAlign: 'center', marginTop: 40 },
  });
}
