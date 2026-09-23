import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { useT } from '../i18n/LanguageContext';
import { useTabClearance } from '../hooks/useTabClearance';
import PressableScale from '../components/PressableScale';

const TOOLS: { name: string; sub: string; icon: string; color: string; route: string }[] = [
  // 名称改为运行时翻译 key（zh/en 字典 addTx.loanCalc*）
  { name: 'addTx.loanCalc', sub: 'addTx.loanCalcSub', icon: 'cash-outline', color: '#4C9AFF', route: '贷款计算器' },
  { name: 'addTx.compoundCalc', sub: 'addTx.compoundCalcSub', icon: 'trending-up-outline', color: '#66BB6A', route: '复利计算器' },
];

export default function CalculatorHubScreen({ navigation }: any) {
  const { colors } = useTheme();
  const t = useT();
  const tabClearance = useTabClearance();

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <PressableScale onPress={() => navigation.goBack()} style={[s.backBtn, { borderColor: colors.link, backgroundColor: colors.card }]} activeScale={0.92}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </PressableScale>
        <Text style={[s.title, { color: colors.textPrimary }]}>{t('addTx.calcTitle')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={[s.content, { paddingBottom: tabClearance }]}>
        {TOOLS.map((tool) => (
          <PressableScale
            key={tool.name}
            style={[s.card, { backgroundColor: colors.card, borderColor: colors.dividerHair }]}
            activeScale={0.97}
            onPress={() => navigation.navigate(tool.route)}
          >
            <View style={[s.iconWrap, { backgroundColor: tool.color + '22' }]}>
              <Ionicons name={tool.icon as any} size={22} color={tool.color} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[s.cardTitle, { color: colors.textPrimary }]}>{t(tool.name)}</Text>
              <Text style={[s.cardSub, { color: colors.textTertiary }]}>{t(tool.sub)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </PressableScale>
        ))}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  backBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
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
