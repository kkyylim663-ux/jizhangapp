import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { CURRENCY_OPTIONS } from '../utils/currencies';
import { getAssetDisplayBalance } from '../utils/creditCard';
import { AssetType } from '../types';
import { useTheme } from '../theme/useTheme';
import { ThemeColors } from '../theme/theme';

type IconName = keyof typeof Ionicons.glyphMap;

const TYPE_OPTIONS: { type: AssetType; label: string; icon: IconName; color: string }[] = [
  { type: 'cash', label: '现金', icon: 'cash-outline', color: '#66BB6A' },
  { type: 'bank', label: '银行卡', icon: 'card-outline', color: '#4C9AFF' },
  { type: 'credit', label: '信用卡', icon: 'wallet-outline', color: '#EF5350' },
];

const CURRENCY_USAGE_KEY = '@jizhang/currencyUsage';
const TOP_CURRENCY_COUNT = 4;

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 最近一次「账单日」发生在今天或之前的那个日期
function lastStatementClose(today: Date, statementDay: number): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), statementDay);
  if (d > today) d.setMonth(d.getMonth() - 1);
  return d;
}

// 根据账单结算日 + 还款日（几号）算出这一期账单的到期还款日
// 还款日数字 <= 账单日数字 -> 落在下个月；否则落在结算当月
function computeDueDate(closeDate: Date, statementDay: number, dueDay: number): Date {
  let month = closeDate.getMonth();
  let year = closeDate.getFullYear();
  if (dueDay <= statementDay) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return new Date(year, month, dueDay);
}

interface CreditStatement {
  currentCycleSpend: number; // 本期（还没结算）已刷金额
  lastStatementAmount: number; // 上一期已结算账单金额
  lastDueDate: Date | null;
  isOverdue: boolean;
  overdueDays: number;
  estimatedInterest: number;
  available: number; // 可用额度
}

function computeCreditStatement(
  asset: { creditLimit?: number; statementDay?: number; dueDay?: number; interestRate?: number },
  balance: number,
  spendInRange: (start: Date, end: Date) => number
): CreditStatement | null {
  if (!asset.statementDay || !asset.dueDay) return null;
  const today = new Date();
  const closeDate = lastStatementClose(today, asset.statementDay);
  const prevCloseDate = new Date(closeDate);
  prevCloseDate.setMonth(prevCloseDate.getMonth() - 1);

  const currentCycleSpend = spendInRange(closeDate, today);
  const lastStatementAmount = spendInRange(prevCloseDate, closeDate);
  const lastDueDate = computeDueDate(closeDate, asset.statementDay, asset.dueDay);

  const totalOwed = Math.max(0, -balance); // balance 是负数代表欠款
  // 近似判断：还款日已过，且总欠款仍然覆盖上一期账单金额，就当作这一期没还
  const isOverdue = today > lastDueDate && lastStatementAmount > 0 && totalOwed >= lastStatementAmount;
  const overdueDays = isOverdue ? Math.floor((today.getTime() - lastDueDate.getTime()) / 86400000) : 0;
  const estimatedInterest =
    isOverdue && asset.interestRate ? lastStatementAmount * (asset.interestRate / 100 / 365) * overdueDays : 0;

  const available = (asset.creditLimit ?? 0) - totalOwed;

  return { currentCycleSpend, lastStatementAmount, lastDueDate, isOverdue, overdueDays, estimatedInterest, available };
}


export default function AssetScreen() {
  const { assets, transactions, getAssetBalance, addAsset, updateAsset, deleteAsset, setDefaultAsset, currency } = useApp();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [selectedType, setSelectedType] = useState<AssetType>('cash');
  const [selectedCurrency, setSelectedCurrency] = useState(currency);
  const [initialBalance, setInitialBalance] = useState('');
  // 信用卡专属字段
  const [creditLimitInput, setCreditLimitInput] = useState('');
  const [statementDayInput, setStatementDayInput] = useState('');
  const [dueDayInput, setDueDayInput] = useState('');
  const [interestRateInput, setInterestRateInput] = useState('');

  // ---------- 常用货币：按点击次数排序，前4个常驻，其余收进展开框 ----------
  const [currencyUsage, setCurrencyUsage] = useState<Record<string, number>>({});
  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CURRENCY_USAGE_KEY);
        if (raw) setCurrencyUsage(JSON.parse(raw));
      } catch (e) {
        console.warn('读取货币使用记录失败', e);
      }
    })();
  }, []);

  const bumpCurrencyUsage = (code: string) => {
    setCurrencyUsage((prev) => {
      const next = { ...prev, [code]: (prev[code] ?? 0) + 1 };
      AsyncStorage.setItem(CURRENCY_USAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const pickCurrency = (code: string) => {
    setSelectedCurrency(code);
    bumpCurrencyUsage(code);
    setCurrencyPickerOpen(false);
  };

  const sortedCurrencies = useMemo(() => {
    return [...CURRENCY_OPTIONS].sort((a, b) => (currencyUsage[b.code] ?? 0) - (currencyUsage[a.code] ?? 0));
  }, [currencyUsage]);

  const topCurrencies = sortedCurrencies.slice(0, TOP_CURRENCY_COUNT);
  const moreCurrencies = sortedCurrencies.slice(TOP_CURRENCY_COUNT);

  // ---------- 净资产汇总：信用卡是负债，不计入净资产 ----------
  const netWorthByCurrency = useMemo(() => {
    const totals: Record<string, number> = {};
    assets
      .filter((a) => a.type !== 'credit')
      .forEach((a) => {
        totals[a.currency] = (totals[a.currency] || 0) + getAssetBalance(a.id);
      });
    return Object.entries(totals);
  }, [assets, getAssetBalance]);

  // ---------- 负债汇总：只统计信用卡欠款 ----------
  const liabilitiesByCurrency = useMemo(() => {
    const totals: Record<string, number> = {};
    assets
      .filter((a) => a.type === 'credit')
      .forEach((a) => {
        const owed = Math.max(0, -getAssetBalance(a.id));
        if (owed > 0) totals[a.currency] = (totals[a.currency] || 0) + owed;
      });
    return Object.entries(totals);
  }, [assets, getAssetBalance]);

  const handleAdd = async () => {
    if (!name.trim()) {
      Alert.alert('请输入资产名称');
      return;
    }
    const typeInfo = TYPE_OPTIONS.find((t) => t.type === selectedType)!;
    const isCredit = selectedType === 'credit';

    let balance = parseFloat(initialBalance) || 0;
    let creditLimit: number | undefined;
    let statementDay: number | undefined;
    let dueDay: number | undefined;
    let interestRate: number | undefined;

    if (isCredit) {
      // 信用卡「起始余额」填的是已欠多少钱（正数好填），内部存成负数，和现金/银行卡的余额语义保持一致
      balance = -Math.abs(balance);
      creditLimit = parseFloat(creditLimitInput) || 0;
      statementDay = parseInt(statementDayInput, 10);
      dueDay = parseInt(dueDayInput, 10);
      interestRate = parseFloat(interestRateInput) || 0;
      if (!statementDay || statementDay < 1 || statementDay > 28 || !dueDay || dueDay < 1 || dueDay > 28) {
        Alert.alert('请填写正确的账单日/还款日', '范围是 1-28 号');
        return;
      }
    }

    await addAsset({
      name: name.trim(),
      icon: typeInfo.icon,
      color: typeInfo.color,
      type: selectedType,
      currency: selectedCurrency,
      initialBalance: balance,
      ...(isCredit ? { creditLimit, statementDay, dueDay, interestRate } : {}),
    });
    bumpCurrencyUsage(selectedCurrency);
    setName('');
    setInitialBalance('');
    setCreditLimitInput('');
    setStatementDayInput('');
    setDueDayInput('');
    setInterestRateInput('');
    setShowAddForm(false);
  };

  const handleDelete = (id: string, assetName: string) => {
    Alert.alert(`删除资产"${assetName}"？`, '与该资产相关的转账记录仍会保留，但资产余额将无法再查看', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => deleteAsset(id) },
    ]);
  };

  // ---------- 长按编辑：名称/余额通用；信用卡额外可改额度/账单日/还款日/利率 ----------
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editBalance, setEditBalance] = useState('');
  const [editCreditLimit, setEditCreditLimit] = useState('');
  const [editStatementDay, setEditStatementDay] = useState('');
  const [editDueDay, setEditDueDay] = useState('');
  const [editInterestRate, setEditInterestRate] = useState('');
  const [editIsDefault, setEditIsDefault] = useState(false);

  const editingAsset = assets.find((a) => a.id === editingAssetId);
  const isEditingCredit = editingAsset?.type === 'credit';

  const openEditModal = (id: string) => {
    const asset = assets.find((a) => a.id === id);
    if (!asset) return;
    setEditingAssetId(id);
    setEditName(asset.name);
    setEditBalance(String(asset.type === 'credit' ? Math.abs(asset.initialBalance) : asset.initialBalance));
    setEditCreditLimit(asset.creditLimit != null ? String(asset.creditLimit) : '');
    setEditStatementDay(asset.statementDay != null ? String(asset.statementDay) : '');
    setEditDueDay(asset.dueDay != null ? String(asset.dueDay) : '');
    setEditInterestRate(asset.interestRate != null ? String(asset.interestRate) : '');
    setEditIsDefault(!!asset.isDefault);
  };

  const saveEdit = async () => {
    if (!editingAssetId) return;
    if (!editName.trim()) {
      Alert.alert('请输入资产名称');
      return;
    }
    const balanceNum = parseFloat(editBalance);
    if (Number.isNaN(balanceNum)) {
      Alert.alert('请输入正确的起始余额');
      return;
    }
    if (isEditingCredit) {
      const statementDay = parseInt(editStatementDay, 10);
      const dueDay = parseInt(editDueDay, 10);
      if (!statementDay || statementDay < 1 || statementDay > 28 || !dueDay || dueDay < 1 || dueDay > 28) {
        Alert.alert('请填写正确的账单日/还款日', '范围是 1-28 号');
        return;
      }
      await updateAsset(editingAssetId, {
        name: editName.trim(),
        initialBalance: -Math.abs(balanceNum),
        creditLimit: parseFloat(editCreditLimit) || 0,
        statementDay,
        dueDay,
        interestRate: parseFloat(editInterestRate) || 0,
      });
    } else {
      await updateAsset(editingAssetId, { name: editName.trim(), initialBalance: balanceNum });
    }
    // 默认账户是单独一套状态（保证同一时间只有一个默认），跟名称/余额这些字段分开处理：
    // 勾上了就把这张设成默认；如果取消勾选的正是当前默认这张，就清空默认，不动别的账户
    if (editIsDefault) {
      await setDefaultAsset(editingAssetId);
    } else if (editingAsset?.isDefault) {
      await setDefaultAsset(null);
    }
    setEditingAssetId(null);
  };

  // ---------- 点击信用卡查看详情 ----------
  const [viewingCreditId, setViewingCreditId] = useState<string | null>(null);
  const viewingCreditAsset = assets.find((a) => a.id === viewingCreditId);

  const viewingStatement = useMemo(() => {
    if (!viewingCreditAsset) return null;
    return computeCreditStatement(viewingCreditAsset, getAssetBalance(viewingCreditAsset.id), (start, end) =>
      transactions
        .filter(
          (t) =>
            t.assetId === viewingCreditAsset.id &&
            t.type === 'expense' &&
            t.date >= toDateStr(start) &&
            t.date < toDateStr(end)
        )
        .reduce((s, t) => s + t.amount, 0)
    );
  }, [viewingCreditAsset, transactions, getAssetBalance]);

  const renderDeleteAction = (id: string, assetName: string) => (
    <TouchableOpacity style={styles.swipeDeleteBtn} onPress={() => handleDelete(id, assetName)}>
      <Ionicons name="trash-outline" size={18} color="#fff" />
      <Text style={styles.swipeDeleteText}>删除</Text>
    </TouchableOpacity>
  );

  // ---------- 先按货币分大组，组内再按类型顺序（现金 / 银行卡 / 信用卡）排列 ----------
  const typeOrder = useMemo(() => {
    const order: Record<AssetType, number> = {} as Record<AssetType, number>;
    TYPE_OPTIONS.forEach((t, i) => {
      order[t.type] = i;
    });
    return order;
  }, []);

  const groupedAssets = useMemo(() => {
    const byCurrency: Record<string, typeof assets> = {};
    assets.forEach((a) => {
      if (!byCurrency[a.currency]) byCurrency[a.currency] = [];
      byCurrency[a.currency].push(a);
    });
    return Object.entries(byCurrency)
      .sort(([codeA], [codeB]) => codeA.localeCompare(codeB))
      .map(([code, items]) => ({
        code,
        items: [...items].sort((a, b) => (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99)),
      }));
  }, [assets, typeOrder]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text style={styles.pageTitle}>资产</Text>

        <View style={styles.netWorthCard}>
          <Text style={styles.netWorthLabel}>总资产（按币种分开显示，不含信用卡欠款）</Text>
          {netWorthByCurrency.length === 0 ? (
            <Text style={styles.emptyText}>还没有添加资产账户</Text>
          ) : (
            netWorthByCurrency.map(([code, value]) => (
              <Text key={code} style={styles.netWorthValue}>
                {value.toFixed(2)} <Text style={styles.netWorthCode}>{code}</Text>
              </Text>
            ))
          )}
        </View>

        {liabilitiesByCurrency.length > 0 && (
          <View style={styles.liabilityCard}>
            <Text style={styles.liabilityLabel}>负债（信用卡欠款）</Text>
            {liabilitiesByCurrency.map(([code, value]) => (
              <Text key={code} style={styles.liabilityValue}>
                {value.toFixed(2)} <Text style={styles.liabilityCode}>{code}</Text>
              </Text>
            ))}
          </View>
        )}

        <View style={styles.sectionTitleRow}>
          <Text style={styles.title}>我的账户</Text>
          <TouchableOpacity onPress={() => setShowAddForm((s) => !s)}>
            <Text style={styles.addLink}>{showAddForm ? '取消' : '+ 新增账户'}</Text>
          </TouchableOpacity>
        </View>

        {showAddForm && (
          <View style={styles.addCard}>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="账户名称，例如：银行卡尾号****"
              placeholderTextColor={colors.textTertiary}
            />
            <Text style={styles.pickerLabel}>账户类型</Text>
            <View style={styles.pickerRow}>
              {TYPE_OPTIONS.map((t) => (
                <TouchableOpacity
                  key={t.type}
                  style={[styles.typeOption, selectedType === t.type && { borderColor: t.color, borderWidth: 2 }]}
                  onPress={() => setSelectedType(t.type)}
                >
                  <Ionicons name={t.icon} size={18} color={t.color} />
                  <Text style={styles.typeOptionLabel}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.pickerLabel}>货币</Text>
            <View style={styles.pickerRow}>
              {topCurrencies.map((c) => (
                <TouchableOpacity
                  key={c.code}
                  style={[styles.currencyOption, selectedCurrency === c.code && styles.currencyOptionActive]}
                  onPress={() => pickCurrency(c.code)}
                >
                  <Text style={[styles.currencyOptionText, selectedCurrency === c.code && { color: colors.bg }]}>
                    {c.code}
                  </Text>
                </TouchableOpacity>
              ))}
              {moreCurrencies.length > 0 && (
                <TouchableOpacity
                  style={[
                    styles.currencyOption,
                    !topCurrencies.some((c) => c.code === selectedCurrency) && styles.currencyOptionActive,
                  ]}
                  onPress={() => setCurrencyPickerOpen(true)}
                >
                  {!topCurrencies.some((c) => c.code === selectedCurrency) ? (
                    <Text style={[styles.currencyOptionText, { color: colors.bg }]}>{selectedCurrency}</Text>
                  ) : (
                    <Ionicons name="ellipsis-horizontal" size={16} color={colors.textPrimary} />
                  )}
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.pickerLabel}>{selectedType === 'credit' ? '目前已欠金额' : '起始余额'}</Text>
            <TextInput
              style={styles.input}
              value={initialBalance}
              onChangeText={setInitialBalance}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textTertiary}
            />

            {selectedType === 'credit' && (
              <>
                <Text style={styles.pickerLabel}>信用额度</Text>
                <TextInput
                  style={styles.input}
                  value={creditLimitInput}
                  onChangeText={setCreditLimitInput}
                  keyboardType="decimal-pad"
                  placeholder="例如：10000"
                  placeholderTextColor={colors.textTertiary}
                />
                <Text style={styles.pickerLabel}>账单日（几号结算，1-28）</Text>
                <TextInput
                  style={styles.input}
                  value={statementDayInput}
                  onChangeText={setStatementDayInput}
                  keyboardType="number-pad"
                  placeholder="例如：15"
                  placeholderTextColor={colors.textTertiary}
                />
                <Text style={styles.pickerLabel}>还款日（几号截止，1-28）</Text>
                <TextInput
                  style={styles.input}
                  value={dueDayInput}
                  onChangeText={setDueDayInput}
                  keyboardType="number-pad"
                  placeholder="例如：5"
                  placeholderTextColor={colors.textTertiary}
                />
                <Text style={styles.pickerLabel}>年利率（%，选填，用于估算逾期利息）</Text>
                <TextInput
                  style={styles.input}
                  value={interestRateInput}
                  onChangeText={setInterestRateInput}
                  keyboardType="decimal-pad"
                  placeholder="例如：18"
                  placeholderTextColor={colors.textTertiary}
                />
              </>
            )}

            <TouchableOpacity style={styles.saveBtn} onPress={handleAdd}>
              <Text style={styles.saveBtnText}>创建账户</Text>
            </TouchableOpacity>
          </View>
        )}

        {groupedAssets.length === 0 && !showAddForm ? (
          <View style={styles.assetList}>
            <Text style={styles.emptyText}>还没有资产账户，点上面"+ 新增账户"添加一个吧</Text>
          </View>
        ) : (
          groupedAssets.map((group) => (
            <View key={group.code} style={{ marginBottom: 16 }}>
              <Text style={styles.groupTitle}>{group.code}</Text>
              <View style={styles.assetList}>
                {group.items.map((a) => (
                  <Swipeable
                    key={a.id}
                    overshootRight={false}
                    renderRightActions={() => renderDeleteAction(a.id, a.name)}
                  >
                    <TouchableOpacity
                      style={styles.assetRow}
                      activeOpacity={0.7}
                      onPress={() => a.type === 'credit' && setViewingCreditId(a.id)}
                      onLongPress={() => openEditModal(a.id)}
                    >
                      <View style={[styles.assetIconWrap, { backgroundColor: a.color + '22' }]}>
                        <Ionicons name={a.icon as IconName} size={18} color={a.color} />
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.assetName}>{a.name}</Text>
                        <Text style={styles.assetType}>
                          {TYPE_OPTIONS.find((t) => t.type === a.type)?.label}
                          {a.isDefault ? ' · 默认' : ''}
                          {a.type === 'credit' ? ' · 点击查看详情' : ''}
                        </Text>
                      </View>
                      {(() => {
                        // 信用卡这里显示的是"还能刷多少"（可用额度），不是欠了多少钱——
                        // 欠款已经在上面的"负债"卡片里单独汇总了，这里再显示一遍欠款反而容易看错方向
                        const displayValue = getAssetDisplayBalance(a, getAssetBalance(a.id));
                        return (
                          <View style={{ alignItems: 'flex-end' }}>
                            {a.type === 'credit' && <Text style={styles.assetBalanceLabel}>可用</Text>}
                            <Text style={[styles.assetBalance, a.type === 'credit' && displayValue < 0 && { color: colors.expense }]}>
                              {a.type === 'credit' && displayValue < 0 ? '-' : ''}
                              {Math.abs(displayValue).toFixed(2)}
                            </Text>
                          </View>
                        );
                      })()}
                      {a.type === 'credit' && (
                        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} style={{ marginLeft: 4 }} />
                      )}
                    </TouchableOpacity>
                  </Swipeable>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* 更多货币选择弹窗 */}
      <Modal visible={currencyPickerOpen} transparent animationType="fade" onRequestClose={() => setCurrencyPickerOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setCurrencyPickerOpen(false)}>
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>选择货币</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {sortedCurrencies.map((c) => (
                <TouchableOpacity key={c.code} style={styles.currencyListRow} onPress={() => pickCurrency(c.code)}>
                  <Text style={styles.currencyListCode}>{c.code}</Text>
                  <Text style={styles.currencyListName}>{c.name}</Text>
                  {selectedCurrency === c.code && <Ionicons name="checkmark" size={18} color={colors.textPrimary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 长按编辑弹窗 */}
      <Modal visible={!!editingAssetId} transparent animationType="fade" onRequestClose={() => setEditingAssetId(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setEditingAssetId(null)}>
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <ScrollView>
              <Text style={styles.modalTitle}>编辑账户</Text>
              <Text style={styles.pickerLabel}>账户名称</Text>
              <TextInput
                style={styles.input}
                value={editName}
                onChangeText={setEditName}
                placeholderTextColor={colors.textTertiary}
              />
              <Text style={styles.pickerLabel}>{isEditingCredit ? '目前已欠金额' : '起始余额'}</Text>
              <TextInput
                style={styles.input}
                value={editBalance}
                onChangeText={setEditBalance}
                keyboardType="decimal-pad"
                placeholderTextColor={colors.textTertiary}
              />
              {isEditingCredit && (
                <>
                  <Text style={styles.pickerLabel}>信用额度</Text>
                  <TextInput
                    style={styles.input}
                    value={editCreditLimit}
                    onChangeText={setEditCreditLimit}
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.textTertiary}
                  />
                  <Text style={styles.pickerLabel}>账单日（1-28）</Text>
                  <TextInput
                    style={styles.input}
                    value={editStatementDay}
                    onChangeText={setEditStatementDay}
                    keyboardType="number-pad"
                    placeholderTextColor={colors.textTertiary}
                  />
                  <Text style={styles.pickerLabel}>还款日（1-28）</Text>
                  <TextInput
                    style={styles.input}
                    value={editDueDay}
                    onChangeText={setEditDueDay}
                    keyboardType="number-pad"
                    placeholderTextColor={colors.textTertiary}
                  />
                  <Text style={styles.pickerLabel}>年利率（%）</Text>
                  <TextInput
                    style={styles.input}
                    value={editInterestRate}
                    onChangeText={setEditInterestRate}
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.textTertiary}
                  />
                </>
              )}

              <TouchableOpacity
                style={styles.defaultCheckRow}
                activeOpacity={0.7}
                onPress={() => setEditIsDefault((v) => !v)}
              >
                <Ionicons
                  name={editIsDefault ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={editIsDefault ? colors.textPrimary : colors.textTertiary}
                />
                <Text style={styles.defaultCheckLabel}>设为默认账户（记一笔时自动带出）</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.saveBtn} onPress={saveEdit}>
                <Text style={styles.saveBtnText}>保存</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 信用卡详情弹窗 */}
      <Modal visible={!!viewingCreditId} transparent animationType="fade" onRequestClose={() => setViewingCreditId(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setViewingCreditId(null)}>
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            {viewingCreditAsset && (
              <>
                <Text style={styles.modalTitle}>{viewingCreditAsset.name}</Text>
                {!viewingStatement ? (
                  <Text style={styles.emptyText}>这张卡还没设置账单日/还款日，长按编辑补充一下</Text>
                ) : (
                  <>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>信用额度</Text>
                      <Text style={styles.detailValue}>
                        {(viewingCreditAsset.creditLimit ?? 0).toFixed(2)} {viewingCreditAsset.currency}
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>可用额度</Text>
                      <Text style={styles.detailValue}>
                        {viewingStatement.available.toFixed(2)} {viewingCreditAsset.currency}
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>本期已刷（未结算）</Text>
                      <Text style={styles.detailValue}>
                        {viewingStatement.currentCycleSpend.toFixed(2)} {viewingCreditAsset.currency}
                      </Text>
                    </View>
                    <View style={styles.detailDivider} />
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>上期账单金额</Text>
                      <Text style={styles.detailValue}>
                        {viewingStatement.lastStatementAmount.toFixed(2)} {viewingCreditAsset.currency}
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>应还日期</Text>
                      <Text
                        style={[styles.detailValue, viewingStatement.isOverdue && { color: colors.expense }]}
                      >
                        {viewingStatement.lastDueDate ? toDateStr(viewingStatement.lastDueDate) : '-'}
                        {viewingStatement.isOverdue ? `（已逾期${viewingStatement.overdueDays}天）` : ''}
                      </Text>
                    </View>
                    {viewingStatement.isOverdue && viewingStatement.estimatedInterest > 0 && (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>预估逾期利息</Text>
                        <Text style={[styles.detailValue, { color: colors.expense }]}>
                          {viewingStatement.estimatedInterest.toFixed(2)} {viewingCreditAsset.currency}
                        </Text>
                      </View>
                    )}
                  </>
                )}
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={() => {
                    const id = viewingCreditId!;
                    setViewingCreditId(null);
                    openEditModal(id);
                  }}
                >
                  <Text style={styles.saveBtnText}>编辑这张卡</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    pageTitle: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: 16 },
    netWorthCard: { backgroundColor: colors.assetCard, borderRadius: 16, padding: 18, marginBottom: 24 },
    netWorthLabel: { fontSize: 12, color: colors.assetLabel, marginBottom: 8 },
    netWorthValue: { fontSize: 22, fontWeight: '700', color: colors.assetValue, marginBottom: 4 },
    netWorthCode: { fontSize: 12, color: colors.assetLabel, fontWeight: '400' },
    liabilityCard: { backgroundColor: colors.card, borderRadius: 16, padding: 18, marginBottom: 24, borderWidth: 1, borderColor: colors.expense + '33' },
    liabilityLabel: { fontSize: 12, color: colors.textSecondary, marginBottom: 8 },
    liabilityValue: { fontSize: 20, fontWeight: '700', color: colors.expense, marginBottom: 4 },
    liabilityCode: { fontSize: 12, color: colors.textTertiary, fontWeight: '400' },
    emptyText: { color: colors.textTertiary, fontSize: 13 },
    sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    title: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
    addLink: { color: colors.link, fontSize: 14, fontWeight: '600' },
    addCard: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 20 },
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
    pickerLabel: { fontSize: 12, color: colors.textSecondary, marginBottom: 8 },
    pickerRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
    typeOption: {
      width: '31%',
      marginRight: '2%',
      marginBottom: 8,
      backgroundColor: colors.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      alignItems: 'center',
      paddingVertical: 10,
    },
    typeOptionLabel: { fontSize: 11, color: colors.textPrimary, marginTop: 4 },
    currencyOption: {
      minWidth: 44,
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      marginRight: 8,
      marginBottom: 8,
    },
    currencyOptionActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
    currencyOptionText: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
    saveBtn: { backgroundColor: colors.textPrimary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
    saveBtnText: { color: colors.bg, fontWeight: '700', fontSize: 14 },
    groupTitle: { fontSize: 12, color: colors.textTertiary, fontWeight: '600', marginBottom: 8, marginLeft: 4 },
    assetList: { backgroundColor: colors.card, borderRadius: 14, overflow: 'hidden' },
    assetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.dividerHair,
      backgroundColor: colors.card,
    },
    assetIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    assetName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
    assetType: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
    assetBalance: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    assetBalanceLabel: { fontSize: 10, color: colors.textTertiary, marginBottom: 1 },
    swipeDeleteBtn: {
      backgroundColor: colors.expense,
      justifyContent: 'center',
      alignItems: 'center',
      width: 64,
    },
    swipeDeleteText: { color: '#fff', fontSize: 11, marginTop: 2, fontWeight: '600' },
    modalOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
    },
    modalCard: { width: '100%', backgroundColor: colors.card, borderRadius: 16, padding: 16 },
    modalTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 12, textAlign: 'center' },
    currencyListRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.dividerHair,
    },
    currencyListCode: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, width: 56 },
    currencyListName: { fontSize: 13, color: colors.textSecondary, flex: 1 },
    detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
    detailLabel: { fontSize: 13, color: colors.textSecondary },
    detailValue: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    detailDivider: { height: 1, backgroundColor: colors.dividerHair, marginVertical: 8 },
    defaultCheckRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 16 },
    defaultCheckLabel: { fontSize: 13, color: colors.textPrimary, marginLeft: 8 },
  });
}
