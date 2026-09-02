import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../context/AppContext';
import { CURRENCY_OPTIONS } from '../utils/currencies';
import { useTheme } from '../theme/useTheme';
import { ThemeColors } from '../theme/theme';

export default function CurrencyScreen() {
  const { currency, setCurrency } = useApp();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <View style={styles.card}>
          {CURRENCY_OPTIONS.map((c, i) => {
            const active = c.code === currency;
            return (
              <TouchableOpacity
                key={c.code}
                style={[styles.row, i === CURRENCY_OPTIONS.length - 1 && { borderBottomWidth: 0 }]}
                onPress={() => setCurrency(c.code)}
              >
                <View style={styles.rowLeft}>
                  <Text style={styles.symbol}>{c.symbol}</Text>
                  <View>
                    <Text style={styles.name}>{c.name}</Text>
                    <Text style={styles.code}>{c.code}</Text>
                  </View>
                </View>
                {active && <Text style={styles.check}>✓</Text>}
              </TouchableOpacity>
            );
          })}
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
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.dividerHair,
    },
    rowLeft: { flexDirection: 'row', alignItems: 'center' },
    symbol: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, width: 44 },
    name: { fontSize: 15, color: colors.textPrimary, fontWeight: '600' },
    code: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
    check: { fontSize: 18, color: colors.link, fontWeight: '700' },
  });
}
