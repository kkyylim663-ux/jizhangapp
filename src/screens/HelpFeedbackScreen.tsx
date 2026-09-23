import React, { useState } from 'react';
import {View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { useDialog } from '../components/AppDialog';
import { useT } from '../i18n/LanguageContext';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import PressableScale from '../components/PressableScale';

export default function HelpFeedbackScreen({ navigation }: any) {
  const { colors } = useTheme();
  const t = useT();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  const [feedback, setFeedback] = useState('');

  const submitFeedback = () => {
    if (!feedback.trim()) {
      dialog.alert({ title: t('addTx.enterFeedback') });
      return;
    }
    dialog.alert({ title: t('addTx.submitOk'), message: t('addTx.submitThanks') });
    setFeedback('');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <PressableScale onPress={() => navigation.goBack()} style={[styles.backBtn, { borderColor: colors.link, backgroundColor: colors.card }]} activeScale={0.92} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </PressableScale>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t('addTx.helpTitle')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView onScroll={onTabScroll ?? undefined} scrollEventThrottle={16} contentContainerStyle={[styles.content, { paddingBottom: tabClearance }]}>
        <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>{t('addTx.faq')}</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.dividerHair }]}>
          <Row label={t('addTx.faqAdd')} colors={colors} />
          <Row label={t('addTx.faqSwitch')} colors={colors} />
          <Row label={t('addTx.faqAssets')} colors={colors} />
        </View>

        <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>{t('addTx.feedbackSection')}</Text>
        <View style={[styles.feedbackCard, { backgroundColor: colors.card, borderColor: colors.dividerHair }]}>
          <TextInput
            value={feedback}
            onChangeText={setFeedback}
            placeholder={t('addTx.feedbackPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            multiline
            textAlignVertical="top"
            style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bg, borderColor: colors.dividerHair }]}
          />
          <PressableScale style={[styles.button, { backgroundColor: colors.fabBg }]} activeScale={0.95} onPress={submitFeedback}>
            <Text style={[styles.buttonText, { color: colors.bg }]}>{t('addTx.submitFeedback')}</Text>
          </PressableScale>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, colors }: any) {
  return (
    <TouchableOpacity style={styles.row}>
      <Text style={[styles.rowText, { color: colors.textPrimary }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  backBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700' },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  sectionTitle: { fontSize: 12, fontWeight: '600', marginTop: 28, marginBottom: 9 },
  card: { width: '100%', borderWidth: 1, borderRadius: 16, paddingHorizontal: 16 },
  row: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowText: { fontSize: 15, fontWeight: '500' },
  feedbackCard: { width: '100%', borderWidth: 1, borderRadius: 16, padding: 16 },
  input: { minHeight: 130, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14 },
  button: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  buttonText: { fontSize: 14, fontWeight: '700' },
});
