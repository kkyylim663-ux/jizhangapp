import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';

const TOOLS: { name: string; sub: string; icon: string; color: string; route: string }[] = [
  { name: '贷款计算器', sub: '本金 / 利率 / 年限 → 每月供款', icon: 'cash-outline', color: '#4C9AFF', route: '贷款计算器' },
  { name: '复利计算器', sub: '本金 / 利率 / 定投 → 到期总额', icon: 'trending-up-outline', color: '#66BB6A', route: '复利计算器' },
];

export default function CalculatorHubScreen({ navigation }: any) {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.bg }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.textPrimary }]}>计算器</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={s.content}>
        {TOOLS.map((t) => (
          <TouchableOpacity
            key={t.name}
            style={[s.card, { backgroundColor: colors.card, borderColor: colors.dividerHair }]}
            activeOpacity={0.8}
            onPress={() => navigation.navigate(t.route)}
          >
            <View style={[s.iconWrap, { backgroundColor: t.color + '22' }]}>
              <Ionicons name={t.icon as any} size={22} color={t.color} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[s.cardTitle, { color: colors.textPrimary }]}>{t.name}</Text>
              <Text style={[s.cardSub, { color: colors.textTertiary }]}>{t.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  title: { fontSize: 17, fontWeight: '700' },
  content: { padding: 20, gap: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  cardSub: { fontSize: 12, marginTop: 3 },
});
