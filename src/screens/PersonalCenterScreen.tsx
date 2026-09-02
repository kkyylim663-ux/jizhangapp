import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';

export default function PersonalCenterScreen({ navigation }: any) {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.bg }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.textPrimary }]}>个人中心</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={s.content}>
        <View style={[s.avatar, { backgroundColor: colors.avatarBg }]}>
          <Ionicons name="person-outline" size={42} color={colors.icon} />
        </View>
        <Text style={[s.name, { color: colors.textPrimary }]}>我的账户</Text>
        <Text style={[s.sub, { color: colors.textTertiary }]}>Personal Finance</Text>

        <Text style={[s.section, { color: colors.textTertiary }]}>账户信息</Text>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.dividerHair }]}>
          <TouchableOpacity style={s.row}>
            <Text style={[s.rowText, { color: colors.textPrimary }]}>个人资料</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <Text style={[s.section, { color: colors.textTertiary }]}>使用情况</Text>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.dividerHair }]}>
          <Info label="已使用天数" value="-- 天" colors={colors} />
          <Info label="累计记账" value="-- 笔" colors={colors} />
          <Info label="创建账本" value="-- 个" colors={colors} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function Info({ label, value, colors }: any) {
  return (
    <View style={s.info}>
      <Text style={[s.rowText, { color: colors.textPrimary }]}>{label}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 14 }}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  title: { fontSize: 17, fontWeight: '700' },
  content: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 32 },
  avatar: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 21, fontWeight: '700', marginTop: 14 },
  sub: { fontSize: 13, marginTop: 5 },
  section: { width: '100%', fontSize: 12, fontWeight: '600', marginTop: 34, marginBottom: 9 },
  card: { width: '100%', borderWidth: 1, borderRadius: 16, paddingHorizontal: 16 },
  row: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowText: { fontSize: 15, fontWeight: '500' },
  info: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
