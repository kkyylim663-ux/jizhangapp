import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../context/AppContext';
import { useTheme } from '../theme/useTheme';
import { useThemeMode, ThemeMode } from '../context/ThemeModeContext';
import { ThemeColors } from '../theme/theme';
import { getCurrencySymbol } from '../utils/currencies';
import { DateFormat, WeekStartsOn, DecimalPlaces } from '../types';

// 常用货币候选列表（选择器用）。真正的当前值仍来自 context 的 currency / currencySymbol。
const CURRENCY_OPTIONS = ['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'MYR', 'HKD', 'TWD', 'SGD', 'KRW', 'AUD', 'CAD'];
const DATE_FORMAT_OPTIONS: DateFormat[] = ['YYYY/MM/DD', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY'];
const PERIOD_LABELS: Record<string, string> = {
  day: '日',
  week: '周',
  month: '月',
  year: '年',
  custom: '自定义范围',
};

const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  system: '跟随系统',
  light: '浅色模式',
  dark: '深色模式',
};

type SheetKey = 'ledger' | 'currency' | 'dateFormat' | 'weekStart' | 'decimalPlaces' | null;

export default function ProfileScreen({ navigation }: any) {
  const goBackToHome = () => {
    navigation.getParent()?.navigate('首页');
  };

  const {
    budgets,
    setBudget,
    transactions,
    currencySymbol,
    currency,
    setCurrency,
    ledgers,
    activeLedgerId,
    setActiveLedgerId,
    dateFormat,
    setDateFormat,
    weekStartsOn,
    setWeekStartsOn,
    decimalPlaces,
    setDecimalPlaces,
    periodPreference,
  } = useApp();
  const { colors } = useTheme();
  const { themeMode, setThemeMode } = useThemeMode();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [activeSheet, setActiveSheet] = useState<SheetKey>(null);

  const totalBudget = budgets.find((b) => b.categoryId === 'total')?.amount ?? 0;
  const activeLedgerName = ledgers.find((l) => l.id === activeLedgerId)?.name ?? '默认账本';

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthSpent = transactions
    .filter((t) => t.ledgerId === activeLedgerId && t.type === 'expense' && t.date.startsWith(currentMonthKey))
    .reduce((s, t) => s + t.amount, 0);

  const weekStartLabel = weekStartsOn === 1 ? '星期一' : '星期日';
  const decimalPlacesLabel = decimalPlaces === 0 ? '整数（0 位小数）' : `${decimalPlaces} 位小数`;

  const handlePickThemeMode = () => {
    Alert.alert('显示方式', '选择应用外观', [
      { text: THEME_MODE_LABELS.system, onPress: () => setThemeMode('system') },
      { text: THEME_MODE_LABELS.light, onPress: () => setThemeMode('light') },
      { text: THEME_MODE_LABELS.dark, onPress: () => setThemeMode('dark') },
      { text: '取消', style: 'cancel' },
    ]);
  };

  // 根据当前打开的是哪个 sheet，动态给出标题/选项/当前值/选中回调
  const sheetConfig = useMemo(() => {
    switch (activeSheet) {
      case 'ledger':
        return {
          title: '预设账本',
          options: ledgers.map((l) => ({ label: l.name, value: l.id })),
          selected: activeLedgerId,
          onSelect: (v: string) => setActiveLedgerId(v),
        };
      case 'currency':
        return {
          title: '预设货币',
          options: CURRENCY_OPTIONS.map((c) => ({ label: `${c} (${getCurrencySymbol(c)})`, value: c })),
          selected: currency,
          onSelect: (v: string) => setCurrency(v),
        };
      case 'dateFormat':
        return {
          title: '日期格式',
          options: DATE_FORMAT_OPTIONS.map((f) => ({ label: f, value: f })),
          selected: dateFormat,
          onSelect: (v: string) => setDateFormat(v as DateFormat),
        };
      case 'weekStart':
        return {
          title: '一周第一天',
          options: [
            { label: '星期一', value: '1' },
            { label: '星期日', value: '0' },
          ],
          selected: String(weekStartsOn),
          onSelect: (v: string) => setWeekStartsOn(Number(v) as WeekStartsOn),
        };
      case 'decimalPlaces':
        return {
          title: '小数位数',
          options: [
            { label: '整数（0 位小数）', value: '0' },
            { label: '1 位小数', value: '1' },
            { label: '2 位小数', value: '2' },
          ],
          selected: String(decimalPlaces),
          onSelect: (v: string) => setDecimalPlaces(Number(v) as DecimalPlaces),
        };
      default:
        return null;
    }
  }, [activeSheet, ledgers, activeLedgerId, currency, dateFormat, weekStartsOn, decimalPlaces]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBackToHome}
          style={styles.backButton}
          activeOpacity={0.7}
        >
          <Text style={styles.backText}>‹</Text>
          <Text style={styles.backLabel}>首页</Text>
        </TouchableOpacity>

        <Text style={styles.headerTitle}>个人设置</Text>

        <View style={styles.headerPlaceholder} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={styles.title}>本月预算</Text>
        <View style={styles.budgetCard}>
          {totalBudget > 0 ? (
            <>
              <View style={styles.budgetTop}>
                <Text style={styles.budgetSpent}>已花费 {currencySymbol}{monthSpent.toFixed(0)}</Text>
                <Text style={styles.budgetTotal}>预算 {currencySymbol}{totalBudget.toFixed(0)}</Text>
              </View>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${Math.min((monthSpent / totalBudget) * 100, 100)}%`,
                      backgroundColor: monthSpent > totalBudget ? colors.expenseOver : '#F2A087',
                    },
                  ]}
                />
              </View>
              {monthSpent > totalBudget && (
                <Text style={styles.overBudget}>已超出预算 {currencySymbol}{(monthSpent - totalBudget).toFixed(0)}</Text>
              )}
            </>
          ) : (
            <Text style={styles.emptyText}>还没设置预算</Text>
          )}
          <BudgetInput onSubmit={(v) => setBudget('total', v)} current={totalBudget} colors={colors} />
        </View>

        {/* 账本管理 */}
        <Text style={[styles.title, { marginTop: 28 }]}>账本管理</Text>
        <View style={styles.groupCard}>
          <SettingsRow
            title="预设账本"
            subtitle="设置新增账单时默认使用的账本"
            value={activeLedgerName}
            onPress={() => setActiveSheet('ledger')}
            colors={colors}
          />
          <SettingsRow
            title="开设账本"
            subtitle="创建和管理多个账本"
            onPress={() => navigation.navigate('开设账本')}
            colors={colors}
            isLast
          />
        </View>

        {/* 记账设置 */}
        <Text style={[styles.title, { marginTop: 28 }]}>记账设置</Text>
        <View style={styles.groupCard}>
          <SettingsRow
            title="类别分类"
            subtitle="管理收入和支出的分类"
            onPress={() => navigation.navigate('类别分类')}
            colors={colors}
          />
          <SettingsRow
            title="预设货币"
            subtitle="设置新增账单时默认使用的货币"
            value={`${currency} (${currencySymbol})`}
            onPress={() => setActiveSheet('currency')}
            colors={colors}
          />
          <SettingsRow
            title="日期格式"
            subtitle="设置日期显示格式"
            value={dateFormat}
            onPress={() => setActiveSheet('dateFormat')}
            colors={colors}
          />
          <SettingsRow
            title="一周第一天"
            subtitle="设置每周的起始日"
            value={weekStartLabel}
            onPress={() => setActiveSheet('weekStart')}
            colors={colors}
          />
          <SettingsRow
            title="小数位数"
            subtitle="设置金额显示的小数位数"
            value={decimalPlacesLabel}
            onPress={() => setActiveSheet('decimalPlaces')}
            colors={colors}
            isLast
          />
        </View>

        {/* 统计偏好 */}
        <Text style={[styles.title, { marginTop: 28 }]}>统计偏好</Text>
        <View style={styles.groupCard}>
          <SettingsRow
            title="自定义周期"
            subtitle="设置统计数据的默认时间周期"
            value={PERIOD_LABELS[periodPreference.type]}
            onPress={() => navigation.navigate('自定义周期')}
            colors={colors}
            isLast
          />
        </View>

        {/* 智能服务 */}
        <Text style={[styles.title, { marginTop: 28 }]}>智能服务</Text>
        <View style={styles.groupCard}>
          <SettingsRow
            title="AI专区"
            subtitle="管理 AI 相关功能与服务"
            onPress={() => navigation.navigate('AI专区')}
            colors={colors}
            isLast
          />
        </View>

        {/* 应用外观 */}
        <Text style={[styles.title, { marginTop: 28 }]}>应用外观</Text>
        <View style={styles.groupCard}>
          <SettingsRow
            title="深色模式"
            subtitle="选择应用的显示方式"
            value={THEME_MODE_LABELS[themeMode]}
            onPress={handlePickThemeMode}
            colors={colors}
            isLast
          />
        </View>
      </ScrollView>

      <Modal visible={!!sheetConfig} transparent animationType="fade" onRequestClose={() => setActiveSheet(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setActiveSheet(null)}>
          <View style={styles.modalSheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>{sheetConfig?.title}</Text>
            {sheetConfig?.options.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={styles.optionRow}
                onPress={() => {
                  sheetConfig.onSelect(opt.value);
                  setActiveSheet(null);
                }}
              >
                <Text style={styles.optionText}>{opt.label}</Text>
                {opt.value === sheetConfig.selected && <Text style={styles.optionCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setActiveSheet(null)}>
              <Text style={styles.cancelBtnText}>取消</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

function SettingsRow({
  title,
  subtitle,
  value,
  onPress,
  colors,
  isLast,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  onPress: () => void;
  colors: ThemeColors;
  isLast?: boolean;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={[styles.settingsRow, !isLast && styles.settingsRowDivider]}
      onPress={onPress}
    >
      <View style={styles.rowTextWrap}>
        <Text style={styles.settingsRowText}>{title}</Text>
        {!!subtitle && <Text style={styles.rowSubtitle}>{subtitle}</Text>}
      </View>
      {!!value && <Text style={styles.rowValue}>{value}</Text>}
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function BudgetInput({
  onSubmit,
  current,
  colors,
}: {
  onSubmit: (v: number) => void;
  current: number;
  colors: ThemeColors;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [value, setValue] = useState(current ? String(current) : '');
  return (
    <View style={{ flexDirection: 'row', marginTop: 12 }}>
      <TextInput
        style={[styles.input, { flex: 1, marginBottom: 0 }]}
        value={value}
        onChangeText={setValue}
        keyboardType="decimal-pad"
        placeholder="输入本月预算金额"
        placeholderTextColor={colors.textTertiary}
      />
      <TouchableOpacity
        style={styles.smallSaveBtn}
        onPress={() => {
          const v = parseFloat(value);
          if (!isNaN(v) && v > 0) onSubmit(v);
        }}
      >
        <Text style={styles.smallSaveBtnText}>保存</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },

    header: {
      height: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
    },

    backButton: {
      flexDirection: 'row',
      alignItems: 'center',
      width: 80,
    },

    backText: {
      fontSize: 32,
      lineHeight: 32,
      color: colors.textPrimary,
      fontWeight: '300',
    },

    backLabel: {
      fontSize: 16,
      color: colors.textPrimary,
      marginLeft: 2,
    },

    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
    },

    headerPlaceholder: {
      width: 80,
    },
    title: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },
    emptyText: { color: colors.textTertiary },
    budgetCard: { backgroundColor: colors.card, borderRadius: 14, padding: 16 },
    budgetTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    budgetSpent: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
    budgetTotal: { fontSize: 14, color: colors.textSecondary },
    barTrack: { height: 8, backgroundColor: colors.track, borderRadius: 4, overflow: 'hidden' },
    barFill: { height: 8, borderRadius: 4 },
    overBudget: { color: colors.expenseOver, fontSize: 12, marginTop: 6 },

    groupCard: { backgroundColor: colors.card, borderRadius: 14, overflow: 'hidden' },
    settingsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    settingsRowDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.dividerHair,
    },
    rowTextWrap: { flex: 1 },
    settingsRowText: { fontSize: 15, color: colors.textPrimary, fontWeight: '600' },
    rowSubtitle: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
    rowValue: { fontSize: 13, color: colors.textSecondary, marginRight: 6 },
    chevron: { fontSize: 18, color: colors.textTertiary },

    input: {
      backgroundColor: colors.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      padding: 10,
      fontSize: 14,
      color: colors.textPrimary,
    },
    smallSaveBtn: {
      backgroundColor: colors.textPrimary,
      borderRadius: 10,
      paddingHorizontal: 16,
      justifyContent: 'center',
      marginLeft: 8,
    },
    smallSaveBtnText: { color: colors.bg, fontWeight: '700', fontSize: 13 },

    modalOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingTop: 12,
      paddingBottom: 28,
      paddingHorizontal: 16,
    },
    modalTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: 8,
      paddingVertical: 8,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.dividerHair,
    },
    optionText: { fontSize: 15, color: colors.textPrimary },
    optionCheck: { fontSize: 15, color: colors.link, fontWeight: '700' },
    cancelBtn: { marginTop: 12, paddingVertical: 12, alignItems: 'center' },
    cancelBtnText: { fontSize: 15, color: colors.textSecondary, fontWeight: '600' },
  });
}
