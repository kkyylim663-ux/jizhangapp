import React, { useMemo, useState } from 'react';
import {View, Text, StyleSheet, TouchableOpacity, TextInput, Keyboard } from 'react-native';
import PressableScale from '../components/PressableScale';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { useDialog } from '../components/AppDialog';
import { useTheme } from '../theme/useTheme';
import { useTabClearance } from '../hooks/useTabClearance';
import { ThemeColors } from '../theme/theme';
import { useT } from '../i18n/LanguageContext';
import { getGroupLabel } from '../i18n/categories';
import { hapticSuccess } from '../utils/haptics';

type IconName = keyof typeof Ionicons.glyphMap;

// 图标选择行已移除：账本数据模型必须有 icon 字段，创建时统一用默认图标，
// 顶部的大预览图标就是它的实时预览（以后若恢复选图标，换回这里的值即可）
const DEFAULT_LEDGER_ICON: IconName = 'book-outline';
// 预设 10 个账本颜色，固定 5 列 × 2 行
// 预设 25 个账本颜色，固定 5 列 × 5 行：每行一个色系（蓝 / 橙红粉 / 紫 / 青绿 / 大地色）
const COLOR_OPTIONS = [
  '#4C9AFF', '#2F7BE0', '#1565C0', '#5C6BC0', '#7986CB',
  '#FF7A5C', '#FF9F43', '#F4511E', '#EF5DA8', '#FF6F91',
  '#B983FF', '#9575CD', '#6A1B9A', '#BA68C8', '#CE93D8',
  '#26C6DA', '#66BB6A', '#4DB6AC', '#81C784', '#558B2F',
  '#F9A825', '#8D6E63', '#A1887F', '#FFB300', '#795548',
];

export default function LedgerScreen() {
    const { ledgers, addLedger } = useApp();
  const { colors } = useTheme();
  const navigation = useNavigation();
  const tabClearance = useTabClearance();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const t = useT();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COLOR_OPTIONS[0]);

  const handleAdd = async (name: string, icon: IconName, color: string) => {
    if (!name.trim()) {
      dialog.alert({ title: t('ledger.enterName') });
      return;
    }
    if (ledgers.some((l) => l.name === name.trim())) {
      dialog.alert({ title: t('ledger.dupName') });
      return;
    }
    await addLedger(name.trim(), icon, color);
    setNewName('');
    setNewColor(COLOR_OPTIONS[0]);
    // 用户定版：创建成功后给明确的交互反馈——主题化成功弹窗，按钮直接回到
    // 选择账本弹层（首页），否则用户不知道账本是否已加上
    hapticSuccess();
    dialog.alert({
      title: t('ledger.createOkTitle'),
      message: t('ledger.createOkMsg', { name: name.trim() }),
      buttons: [
        { text: t('common.confirm'), style: 'default', onPress: () => navigation.goBack() },
      ],
    });
  };

  // 顶栏与"记一笔"同款：原生 header 已关闭（App.tsx），自绘圆环返回键 + 标题；
  // edges 含 top：原生顶栏没了，需要自己垫状态栏高度
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}
      onTouchStart={() => { Keyboard.dismiss(); }}
    >
      <View style={styles.topBar}>
        <PressableScale
          style={styles.topBackBtn}
          activeScale={0.92}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={22} color={colors.icon} />
        </PressableScale>
        <Text style={styles.topBarTitle}>{t('ledger.pageTitle')}</Text>
        <View style={styles.topBarSpacer} />
      </View>
      <View style={{ flex: 1, paddingHorizontal: 20 }}>
        {/* 自定义账本表单：页面锁死不滚动（Scroll 会遮挡输入区），内容直接平铺 */}
        <View style={{ flex: 1, paddingTop: 6, paddingHorizontal: 20 }}>
          <Text style={styles.sectionTitle}>{t('ledger.customTitle')}</Text>
          <View style={styles.addCard}>
            <View style={styles.previewRow}>
              <View style={[styles.previewIconWrap, { backgroundColor: newColor + '22' }]}>
                <Ionicons name={DEFAULT_LEDGER_ICON} size={40} color={newColor} />
              </View>
            </View>

            <TextInput
              style={styles.input}
              value={newName}
              onChangeText={setNewName}
              placeholder={t('ledger.namePlaceholder')}
              placeholderTextColor={colors.textTertiary}
            />
            {/* 颜色固定 5×5 网格：25 色按色系分行渲染，每排 5 个 */}
            <Text style={styles.pickerLabel}>{t('ledger.colorLabel')}</Text>
            {[0, 1, 2, 3, 4].map((row) => (
              <View key={row} style={styles.colorRow}>
                {COLOR_OPTIONS.slice(row * 5, row * 5 + 5).map((color) => (
                  <TouchableOpacity
                    key={color}
                    style={[
                      styles.colorOption,
                      { backgroundColor: color },
                      newColor === color && styles.colorOptionActive,
                    ]}
                    onPress={() => setNewColor(color)}
                  />
                ))}
              </View>
            ))}
          </View>
        </View>

        {/* 保存按钮钉在页面最底部（避开浮空Tab栏），不再随内容滚动 */}
        <PressableScale
          style={[styles.saveBtn, { marginTop: 1, marginBottom: Math.max(4, tabClearance - 20) }]}
          onPress={() => handleAdd(newName, DEFAULT_LEDGER_ICON, newColor)}
          activeScale={0.97}
        >
          <Ionicons name="add" size={20} color={colors.bg} />
          <Text style={styles.saveBtnText}>{t('ledger.create')}</Text>
        </PressableScale>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1 },
    // 顶栏：与其他二级页同款——圆环返回键 + 居中标题
    topBar: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
    topBackBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: colors.link,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    topBarTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.textPrimary },
    topBarSpacer: { width: 40 },
    sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
    addCard: { backgroundColor: colors.card, borderRadius: 16, padding: 16 },
    previewRow: { alignItems: 'center', marginBottom: 12 },
    // 中心预览图标：做大做明显，作为本页视觉主角
    previewIconWrap: {
      width: 72,
      height: 72,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    input: {
      backgroundColor: colors.bg,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      padding: 10,
      minHeight: 48,
      fontSize: 15,
      color: colors.textPrimary,
      marginBottom: 12,
    },
    pickerLabel: { fontSize: 12, color: colors.textTertiary, marginBottom: 8 },
    colorRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    // 5×5 色格：方框样式，放大到行宽 17% 的正方形，固定网格、整页不滚动
    colorOption: { width: '17%', aspectRatio: 1, borderRadius: 10 },
    colorOptionActive: { borderWidth: 3, borderColor: colors.textPrimary },
    // 创建账本按钮：缩短不再全宽，钉在页面底部并水平居中
    saveBtn: {
      flexDirection: 'row',
      alignSelf: 'center',
      backgroundColor: colors.fabBg,
      borderRadius: 22,
      paddingHorizontal: 44,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    saveBtnText: { color: colors.bg, fontWeight: '700', fontSize: 16 },
  });
}