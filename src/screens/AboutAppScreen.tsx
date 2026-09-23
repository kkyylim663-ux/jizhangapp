import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useTheme } from '../theme/useTheme';
import { useT } from '../i18n/LanguageContext';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import PressableScale from '../components/PressableScale';
import { ThemeColors } from '../theme/theme';

// 版本号统一从 app.json 读取，避免页面里硬编码后跟配置脱节
const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

export default function AboutAppScreen({ navigation }: any) {
  const { colors } = useTheme();
  const t = useT();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <PressableScale
          onPress={() => navigation.goBack()}
          style={[styles.backBtn, { borderColor: colors.link, backgroundColor: colors.card }]}
          activeScale={0.92}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </PressableScale>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t('addTx.aboutTitle')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView onScroll={onTabScroll ?? undefined} scrollEventThrottle={16} contentContainerStyle={[styles.content, { paddingBottom: tabClearance }]}>
        <View style={[styles.logo, { backgroundColor: colors.avatarBg }]}>
          <Ionicons name="wallet-outline" size={34} color={colors.icon} />
        </View>
        <Text style={[styles.appName, { color: colors.textPrimary }]}>Personal Finance</Text>
        <Text style={[styles.version, { color: colors.textTertiary }]}>Version {APP_VERSION}</Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.dividerHair }]}>
          <Row label={t('addTx.currentVersion')} value={APP_VERSION} colors={colors} />
          <Row
            label={t('addTx.whatsNew')}
            value={t('addTx.whatsNewValue')}
            colors={colors}
            valueStyle={styles.valueWrap}
          />
          <TouchableOpacity style={styles.actionRow} activeOpacity={0.6}>
            <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>{t('addTx.checkUpdate')}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.footer, { color: colors.textTertiary }]}>© 2026 Personal Finance</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// 信息行：单行左右布局（标签左、值右），压低行高让整页一屏放完
function Row({
  label,
  value,
  colors,
  valueStyle,
}: {
  label: string;
  value: string;
  colors: ThemeColors;
  valueStyle?: object;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.value, { color: colors.textPrimary }, valueStyle]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 17, fontWeight: '700' },
  content: { alignItems: 'center', paddingTop: 16, paddingHorizontal: 20 },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appName: { fontSize: 22, fontWeight: '700', marginTop: 8 },
  version: { fontSize: 13, marginTop: 2 },
  card: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 18,
    marginTop: 24,
    paddingHorizontal: 16,
  },
  infoRow: {
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: { fontSize: 14 },
  // 长文案（如"更新内容"）：右对齐并允许换行，行高收紧保持行距一致
  value: { fontSize: 15, fontWeight: '500', textAlign: 'right' },
  valueWrap: { flex: 1, marginLeft: 16, lineHeight: 20 },
  actionRow: {
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footer: { fontSize: 11, marginTop: 20 },
});
