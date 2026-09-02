import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { useTheme } from '../theme/useTheme';
import { ThemeColors } from '../theme/theme';

type IconName = keyof typeof Ionicons.glyphMap;

// 账本图标改用跟分类/资产一致的线框图标（Ionicons），不再用彩色 emoji
const TEMPLATES: { name: string; icon: IconName; color: string }[] = [
  { name: '生意账本', icon: 'storefront-outline', color: '#FF9F43' },
  { name: '报销账本', icon: 'receipt-outline', color: '#26C6DA' },
  { name: '公司账本', icon: 'business-outline', color: '#B983FF' },
  { name: '团队账本', icon: 'people-outline', color: '#66BB6A' },
];

const ICON_OPTIONS: IconName[] = [
  'book-outline',
  'storefront-outline',
  'receipt-outline',
  'business-outline',
  'people-outline',
  'home-outline',
  'airplane-outline',
  'school-outline',
  'briefcase-outline',
  'paw-outline',
];
const COLOR_OPTIONS = ['#4C9AFF', '#FF7A5C', '#B983FF', '#FF9F43', '#26C6DA', '#66BB6A', '#F9A825'];

function formatDate(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function LedgerScreen() {
  const { ledgers, activeLedgerId, addLedger, deleteLedger, setActiveLedgerId, assets, getAssetBalance } = useApp();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState<IconName>(ICON_OPTIONS[0]);
  const [newColor, setNewColor] = useState(COLOR_OPTIONS[0]);

  // 每个账本按币种汇总名下资产余额，跟 HomeScreen 的资产总览用同一套分组逻辑，
  // 不做任何货币换算——账本本身没有"主币种"这个概念，只是原样列出每种币种的合计。
  const ledgerTotals = useMemo(() => {
    const map: Record<string, [string, number][]> = {};
    ledgers.forEach((l) => {
      const totals: Record<string, number> = {};
      assets
        .filter((a) => a.ledgerId === l.id)
        .forEach((a) => {
          totals[a.currency] = (totals[a.currency] || 0) + getAssetBalance(a.id);
        });
      map[l.id] = Object.entries(totals);
    });
    return map;
  }, [ledgers, assets, getAssetBalance]);

  const handleAdd = async (name: string, icon: IconName, color: string) => {
    if (!name.trim()) {
      Alert.alert('请输入账本名称');
      return;
    }
    if (ledgers.some((l) => l.name === name.trim())) {
      Alert.alert('已存在同名账本');
      return;
    }
    await addLedger(name.trim(), icon, color);
    setNewName('');
  };

  const handleDelete = (id: string, name: string) => {
    if (id === 'default') {
      Alert.alert('默认账本不能删除');
      return;
    }
    Alert.alert(`删除账本"${name}"？`, '账本内的记账记录也会一并保留但无法再查看，请谨慎操作', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => deleteLedger(id) },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text style={styles.title}>我的账本</Text>
        <View style={{ gap: 10 }}>
          {ledgers.map((l) => {
            const active = l.id === activeLedgerId;
            const color = l.color ?? '#4C9AFF';
            const totals = ledgerTotals[l.id] ?? [];
            return (
              <TouchableOpacity
                key={l.id}
                style={[styles.ledgerCard, active && { borderColor: colors.link }]}
                onPress={() => setActiveLedgerId(l.id)}
                activeOpacity={0.8}
              >
                <View style={styles.ledgerCardTop}>
                  <View style={[styles.ledgerIconWrap, { backgroundColor: color + '22' }]}>
                    <Ionicons name={l.icon as IconName} size={22} color={color} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={styles.ledgerName}>{l.name}</Text>
                      {l.id !== 'default' && (
                        <TouchableOpacity onPress={() => handleDelete(l.id, l.name)} style={{ marginLeft: 8 }}>
                          <Ionicons name="trash-outline" size={14} color={colors.expense} />
                        </TouchableOpacity>
                      )}
                    </View>
                    <Text style={styles.ledgerSub}>
                      {l.id === 'default' ? '预设账本' : `创建于 ${formatDate(l.createdAt)}`}
                    </Text>
                  </View>
                  <Ionicons
                    name={active ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={active ? colors.link : colors.dividerHair}
                  />
                </View>
                <View style={styles.ledgerBalanceRow}>
                  <Text style={styles.ledgerBalanceLabel}>结余</Text>
                  {totals.length === 0 ? (
                    <Text style={styles.ledgerBalanceEmpty}>暂无资产</Text>
                  ) : (
                    <View style={{ alignItems: 'flex-end' }}>
                      {totals.map(([code, amount]) => (
                        <Text key={code} style={styles.ledgerBalanceValue}>
                          {code} {amount.toFixed(2)}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.title, { marginTop: 28 }]}>快捷创建</Text>
        <View style={styles.templateRow}>
          {TEMPLATES.map((t) => (
            <TouchableOpacity
              key={t.name}
              style={styles.templateBtn}
              onPress={() => handleAdd(t.name, t.icon, t.color)}
            >
              <View style={[styles.templateIconWrap, { backgroundColor: t.color + '22' }]}>
                <Ionicons name={t.icon} size={20} color={t.color} />
              </View>
              <Text style={styles.templateName}>{t.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.title, { marginTop: 28 }]}>自定义账本</Text>
        <View style={styles.addCard}>
          <View style={styles.previewRow}>
            <View style={[styles.previewIconWrap, { backgroundColor: newColor + '22' }]}>
              <Ionicons name={newIcon} size={28} color={newColor} />
            </View>
          </View>

          <TextInput
            style={styles.input}
            value={newName}
            onChangeText={setNewName}
            placeholder="账本名称，例如：装修账本"
            placeholderTextColor={colors.textTertiary}
          />
          <Text style={styles.pickerLabel}>选图标</Text>
          <View style={styles.pickerRow}>
            {ICON_OPTIONS.map((icon) => (
              <TouchableOpacity
                key={icon}
                style={[styles.iconOption, newIcon === icon && styles.iconOptionActive]}
                onPress={() => setNewIcon(icon)}
              >
                <Ionicons name={icon} size={18} color={newIcon === icon ? newColor : colors.icon} />
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.pickerLabel}>选颜色</Text>
          <View style={styles.pickerRow}>
            {COLOR_OPTIONS.map((color) => (
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
          <TouchableOpacity style={styles.saveBtn} onPress={() => handleAdd(newName, newIcon, newColor)}>
            <Ionicons name="add" size={18} color={colors.bg} />
            <Text style={styles.saveBtnText}>创建账本</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    title: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },
    ledgerCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 14,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    ledgerCardTop: { flexDirection: 'row', alignItems: 'center' },
    ledgerIconWrap: {
      width: 48,
      height: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ledgerName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    ledgerSub: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
    ledgerBalanceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.dividerHair,
    },
    ledgerBalanceLabel: { fontSize: 12, color: colors.textTertiary },
    ledgerBalanceEmpty: { fontSize: 13, color: colors.textTertiary },
    ledgerBalanceValue: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    templateRow: { flexDirection: 'row', flexWrap: 'wrap' },
    templateBtn: {
      width: '23.5%',
      aspectRatio: 1,
      marginRight: '2%',
      marginBottom: 10,
      backgroundColor: colors.card,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    templateIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 6,
    },
    templateName: { fontSize: 11, color: colors.textPrimary, textAlign: 'center' },
    addCard: { backgroundColor: colors.card, borderRadius: 14, padding: 16 },
    previewRow: { alignItems: 'center', marginBottom: 16 },
    previewIconWrap: {
      width: 64,
      height: 64,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    input: {
      backgroundColor: colors.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      padding: 10,
      fontSize: 14,
      color: colors.textPrimary,
      marginBottom: 12,
    },
    pickerLabel: { fontSize: 12, color: colors.textTertiary, marginBottom: 8 },
    pickerRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
    iconOption: {
      width: 36,
      height: 36,
      borderRadius: 8,
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 8,
      marginBottom: 8,
    },
    iconOptionActive: { borderColor: colors.link, borderWidth: 2 },
    colorOption: { width: 28, height: 28, borderRadius: 14, marginRight: 10, marginBottom: 8 },
    colorOptionActive: { borderWidth: 3, borderColor: colors.textPrimary },
    saveBtn: {
      flexDirection: 'row',
      backgroundColor: colors.textPrimary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    saveBtnText: { color: colors.bg, fontWeight: '700', fontSize: 14 },
  });
}
