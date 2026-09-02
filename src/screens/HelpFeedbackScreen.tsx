import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';

export default function HelpFeedbackScreen({ navigation }: any) {
  const { colors } = useTheme();
  const [feedback, setFeedback] = useState('');

  const submitFeedback = () => {
    if (!feedback.trim()) {
      Alert.alert('请输入反馈内容');
      return;
    }
    Alert.alert('提交成功', '感谢你的反馈');
    setFeedback('');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.textPrimary }]}>帮助与反馈</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>常见问题</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.dividerHair }]}>
          <Row label="如何新增一笔账单？" colors={colors} />
          <Row label="如何切换账本？" colors={colors} />
          <Row label="如何管理资产账户？" colors={colors} />
        </View>

        <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>意见反馈</Text>
        <View style={[styles.feedbackCard, { backgroundColor: colors.card, borderColor: colors.dividerHair }]}>
          <TextInput
            value={feedback}
            onChangeText={setFeedback}
            placeholder="告诉我们你遇到的问题或建议"
            placeholderTextColor={colors.textTertiary}
            multiline
            textAlignVertical="top"
            style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bg, borderColor: colors.dividerHair }]}
          />
          <TouchableOpacity style={[styles.button, { backgroundColor: colors.textPrimary }]} onPress={submitFeedback}>
            <Text style={[styles.buttonText, { color: colors.bg }]}>提交反馈</Text>
          </TouchableOpacity>
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
