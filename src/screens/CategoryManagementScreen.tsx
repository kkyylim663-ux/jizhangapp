import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { useTheme } from '../theme/useTheme';
import { ThemeColors } from '../theme/theme';

type IconName = keyof typeof Ionicons.glyphMap;

const ICON_OPTIONS: IconName[] = [
  'fast-food-outline',
  'car-outline',
  'bag-handle-outline',
  'home-outline',
  'game-controller-outline',
  'medkit-outline',
  'cube-outline',
  'cash-outline',
  'gift-outline',
  'wallet-outline',
  'airplane-outline',
  'book-outline',
  'paw-outline',
  'happy-outline',
];
const COLOR_OPTIONS = ['#FF7A5C', '#4C9AFF', '#B983FF', '#FF9F43', '#26C6DA', '#66BB6A', '#F9A825'];

export default function CategoryManagementScreen() {
  const { categories, addCategory, deleteCategory } = useApp();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState<IconName>(ICON_OPTIONS[0]);
  const [newColor, setNewColor] = useState(COLOR_OPTIONS[0]);

  const handleAddCategory = async () => {
    if (!newName.trim()) {
      Alert.alert('请输入分类名称');
      return;
    }
    await addCategory({ name: newName.trim(), icon: newIcon, color: newColor, type: 'expense' });
    setNewName('');
  };

  const handleDeleteCategory = (id: string, name: string) => {
    Alert.alert(`删除分类"${name}"？`, '已有记录仍会保留，但会显示为未分类', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => deleteCategory(id) },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text style={styles.title}>我的分类</Text>
        <View style={styles.catList}>
          {categories.map((c) => (
            <View key={c.id} style={styles.catRow}>
              <View style={[styles.catIconWrap, { backgroundColor: c.color + '22' }]}>
                <Ionicons name={c.icon as IconName} size={16} color={c.color} />
              </View>
              <Text style={styles.catName}>{c.name}</Text>
              <Text style={styles.catType}>{c.type === 'expense' ? '支出' : '收入'}</Text>
              <TouchableOpacity onPress={() => handleDeleteCategory(c.id, c.name)}>
                <Text style={styles.deleteBtn}>删除</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <Text style={[styles.title, { marginTop: 28 }]}>新增支出分类</Text>
        <View style={styles.addCatCard}>
          <TextInput
            style={styles.input}
            value={newName}
            onChangeText={setNewName}
            placeholder="分类名称，例如：宠物"
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
                <Ionicons name={icon} size={18} color={colors.textPrimary} />
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
          <TouchableOpacity style={styles.saveBtn} onPress={handleAddCategory}>
            <Text style={styles.saveBtnText}>添加分类</Text>
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
    catList: { backgroundColor: colors.card, borderRadius: 14 },
    catRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.dividerHair,
    },
    catIconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    catName: { flex: 1, marginLeft: 10, fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
    catType: { fontSize: 12, color: colors.textTertiary, marginRight: 12 },
    deleteBtn: { color: colors.expense, fontSize: 13 },
    addCatCard: { backgroundColor: colors.card, borderRadius: 14, padding: 16 },
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
    saveBtn: { backgroundColor: colors.textPrimary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
    saveBtnText: { color: colors.bg, fontWeight: '700', fontSize: 14 },
  });
}
