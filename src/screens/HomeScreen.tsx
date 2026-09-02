import React, { useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Modal, TextInput, Animated, Dimensions, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { getCurrencySymbol } from '../utils/currencies';
import { useTheme } from '../theme/useTheme';
import { ThemeColors } from '../theme/theme';
import { PlannedPaymentRecurrence } from '../types';
import { UNCATEGORIZED_ICON, UNCATEGORIZED_NAME, UNCATEGORIZED_COLOR } from '../constants/uncategorized';

type IconName = keyof typeof Ionicons.glyphMap;

const RECURRENCE_LABELS: Record<PlannedPaymentRecurrence, string> = {
  once: '一次性',
  monthly: '每月',
  yearly: '每年',
};

// 账户类型显示顺序：现金 → 银行卡 → 信用卡 → 电子钱包 → 投资 → 其他
const ASSET_TYPE_ORDER = ['cash', 'bank', 'credit', 'ewallet', 'investment', 'other'] as const;
const ASSET_TYPE_LABELS: Record<string, string> = {
  cash: '现金',
  bank: '银行卡',
  credit: '信用卡',
  ewallet: '电子钱包',
  investment: '投资',
  other: '其他',
};

function formatMoney(n: number) {
  return n.toFixed(2);
}

function monthKeyOf(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function HomeScreen({ navigation }: any) {
  const {
    transactions,
    categories,
    getCategoryById,
    currencySymbol,
    activeLedgerId,
    setActiveLedgerId,
    ledgers,
    budgets,
    setBudget,
    assets,
    getAssetBalance,
    getAssetById,
    plannedPayments,
    addPlannedPayment,
    updatePlannedPayment,
    deletePlannedPayment,
    markPlannedPaymentPaid,
  } = useApp();

  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [ledgerPickerOpen, setLedgerPickerOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const drawerX = useRef(new Animated.Value(-Dimensions.get('window').width * 0.82)).current;

  const openProfileDrawer = () => {
    drawerX.setValue(-Dimensions.get('window').width * 0.82);
    setProfileMenuOpen(true);
    requestAnimationFrame(() => {
      Animated.timing(drawerX, {
        toValue: 0,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  };
  const closeProfileDrawer = (callback?: () => void) => {
    Animated.timing(drawerX, { toValue: -Dimensions.get('window').width * 0.82, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
      setProfileMenuOpen(false);
      callback?.();
    });
  };
  const activeLedger = ledgers.find((l) => l.id === activeLedgerId);

  const now = new Date();
  const thisMonthKey = monthKeyOf(now.getFullYear(), now.getMonth());
  const todayString = todayStr();

  const ledgerTransactions = useMemo(
    () => transactions.filter((t) => t.ledgerId === activeLedgerId),
    [transactions, activeLedgerId]
  );

  const thisExpense = useMemo(
    () =>
      ledgerTransactions
        .filter((t) => t.type === 'expense' && t.date.startsWith(thisMonthKey))
        .reduce((s, t) => s + t.amount, 0),
    [ledgerTransactions, thisMonthKey]
  );

  const todayTransactions = useMemo(
    () => ledgerTransactions.filter((t) => t.date === todayString && t.type !== 'transfer').slice(0, 5),
    [ledgerTransactions, todayString]
  );

  const totalBudget = budgets.find((b) => b.categoryId === 'total')?.amount ?? 0;

  // 净资产只算当前账本名下的资产——账本之间互不连通，切到"公司账本"就只看公司账本自己的钱
  const totalsByCurrency = useMemo(() => {
    const totals: Record<string, number> = {};
    assets
      .filter((a) => a.ledgerId === activeLedgerId)
      .forEach((a) => {
        totals[a.currency] = (totals[a.currency] || 0) + getAssetBalance(a.id);
      });
    return Object.entries(totals);
  }, [assets, activeLedgerId, getAssetBalance]);

  // 每个账本各自的资产合计（按币种），给快速切换账本弹窗用——同一套逻辑，跟 LedgerScreen 的账本列表保持一致
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

  // ---------- 预算：常驻细长条，点击弹窗直接改，不需要跳转设置页 ----------
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [budgetInput, setBudgetInput] = useState(totalBudget ? String(totalBudget) : '');

  const openBudgetModal = () => {
    setBudgetInput(totalBudget ? String(totalBudget) : '');
    setBudgetModalOpen(true);
  };

  const saveBudget = () => {
    const value = parseFloat(budgetInput);
    if (!value || value <= 0) {
      Alert.alert('请输入正确的预算金额');
      return;
    }
    setBudget('total', value);
    setBudgetModalOpen(false);
  };

  const budgetPct = totalBudget > 0 ? Math.min((thisExpense / totalBudget) * 100, 100) : 0;
  const budgetOver = totalBudget > 0 && thisExpense > totalBudget;

  // ---------- 计划付款：即将到期、还没实际记账的固定支出（房租/车贷等） ----------
  // 类别必须选：统计页是按分类汇总的，没有分类就没法算进对应分类的总额，只能挤进"未分类"。
  // 账单列表显示的名称（"房租"）由 displayName 负责，跟这里选的类别互不影响。
  const expenseCategories = useMemo(() => categories.filter((c) => c.type === 'expense'), [categories]);

  // 资产下拉：按币种分割线分组，组内再按 现金/银行卡/信用卡/电子钱包/投资/其他 顺序排
  const assetGroups = useMemo(() => {
    const byCurrency: Record<string, typeof assets> = {};
    assets
      .filter((a) => a.ledgerId === activeLedgerId)
      .forEach((a) => {
        if (!byCurrency[a.currency]) byCurrency[a.currency] = [];
        byCurrency[a.currency].push(a);
      });
    return Object.keys(byCurrency)
      .sort()
      .map((currency) => ({
        currency,
        items: [...byCurrency[currency]].sort(
          (x, y) => ASSET_TYPE_ORDER.indexOf(x.type as any) - ASSET_TYPE_ORDER.indexOf(y.type as any)
        ),
      }));
  }, [assets, activeLedgerId]);

  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planName, setPlanName] = useState('');
  const [planCategoryId, setPlanCategoryId] = useState<string | null>(null);
  const [planAmount, setPlanAmount] = useState('');
  const [planAssetId, setPlanAssetId] = useState<string | null>(null);
  const [planDueDate, setPlanDueDate] = useState(todayString);
  const [planRecurrence, setPlanRecurrence] = useState<PlannedPaymentRecurrence>('monthly');
  const [planAutoDeduct, setPlanAutoDeduct] = useState(false);
  const [planAssetPickerOpen, setPlanAssetPickerOpen] = useState(false);
  const [planCategoryPickerOpen, setPlanCategoryPickerOpen] = useState(false);

  const upcomingPlans = useMemo(
    () =>
      plannedPayments
        .filter((p) => p.ledgerId === activeLedgerId && !p.isPaid)
        .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)),
    [plannedPayments, activeLedgerId]
  );

  const isOverdue = (dueDate: string) => dueDate < todayString;

  const resetPlanForm = () => {
    setEditingPlanId(null);
    setPlanName('');
    setPlanCategoryId(null);
    setPlanAmount('');
    setPlanAssetId(null);
    setPlanDueDate(todayString);
    setPlanRecurrence('monthly');
    setPlanAutoDeduct(false);
    setPlanAssetPickerOpen(false);
    setPlanCategoryPickerOpen(false);
  };

  const openPlanModal = () => {
    resetPlanForm();
    setPlanModalOpen(true);
  };

  // 点名称编辑：把已有记录的字段灌回表单
  const openEditPlanModal = (planId: string) => {
    const p = plannedPayments.find((x) => x.id === planId);
    if (!p) return;
    setEditingPlanId(p.id);
    setPlanName(p.name);
    setPlanCategoryId(p.categoryId ?? null);
    setPlanAmount(String(p.amount));
    setPlanAssetId(p.assetId ?? null);
    setPlanDueDate(p.dueDate);
    setPlanRecurrence(p.recurrence);
    setPlanAutoDeduct(p.autoDeduct);
    setPlanCategoryPickerOpen(false);
    setPlanModalOpen(true);
  };

  const savePlan = async () => {
    const value = parseFloat(planAmount);
    if (!planName.trim()) {
      Alert.alert('请输入付款名称');
      return;
    }
    if (!planCategoryId) {
      Alert.alert('请选择类别', '统计页需要按分类汇总，计划付款也要选一个类别');
      return;
    }
    if (!value || value <= 0) {
      Alert.alert('请输入正确的金额');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(planDueDate)) {
      Alert.alert('日期格式不对', '请按 YYYY-MM-DD 格式填写');
      return;
    }
    if (editingPlanId) {
      await updatePlannedPayment(editingPlanId, {
        name: planName.trim(),
        categoryId: planCategoryId,
        amount: value,
        assetId: planAssetId ?? undefined,
        dueDate: planDueDate,
        recurrence: planRecurrence,
        autoDeduct: planAutoDeduct,
      });
    } else {
      await addPlannedPayment({
        name: planName.trim(),
        categoryId: planCategoryId,
        amount: value,
        assetId: planAssetId ?? undefined,
        dueDate: planDueDate,
        recurrence: planRecurrence,
        autoDeduct: planAutoDeduct,
      });
    }
    setPlanModalOpen(false);
    resetPlanForm();
  };

  const handleDeletePlan = (id: string, name: string) => {
    Alert.alert(`删除"${name}"？`, '删除后无法恢复', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => deletePlannedPayment(id) },
    ]);
  };

  // 勾选 = 立即支付这笔计划付款：记一笔支出，从选定资产账户扣除，总资产也会跟着变
  const handlePayNow = (p: (typeof upcomingPlans)[number]) => {
    const asset = p.assetId ? getAssetById(p.assetId) : undefined;
    Alert.alert(
      `确认支付"${p.name}"？`,
      asset
        ? `将记一笔 ${currencySymbol}${formatMoney(p.amount)} 支出，从"${asset.name}"扣除，操作后无法撤回`
        : `将记一笔 ${currencySymbol}${formatMoney(p.amount)} 支出，操作后无法撤回`,
      [
        { text: '取消', style: 'cancel' },
        { text: '确认支付', onPress: () => markPlannedPaymentPaid(p.id) },
      ]
    );
  };

  // 向左滑动露出的删除按钮
  const renderPlanRightActions = (id: string, name: string) => (
    <TouchableOpacity style={styles.swipeDeleteBtn} onPress={() => handleDeletePlan(id, name)}>
      <Ionicons name="trash-outline" size={18} color="#fff" />
      <Text style={styles.swipeDeleteText}>删除</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={styles.headerRow}>
          <View style={styles.headerSide}>
            <TouchableOpacity style={styles.avatar} onPress={openProfileDrawer}>
              <Ionicons name="person-outline" size={20} color={colors.icon} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.headerCenter} onPress={() => setLedgerPickerOpen(true)}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {activeLedger?.name ?? '账本'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.icon} style={{ marginLeft: 4 }} />
          </TouchableOpacity>
          <View style={styles.headerSideRight}>
            <TouchableOpacity onPress={() => navigation.navigate('账单明细')} style={styles.headerIconBtn}>
              <Ionicons name="search-outline" size={20} color={colors.icon} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => Alert.alert('消息通知', '这个功能还在开发中')}
              style={styles.headerIconBtn}
            >
              <Ionicons name="notifications-outline" size={20} color={colors.icon} />
            </TouchableOpacity>
          </View>
        </View>

        {/* 总资产结算 */}
    <TouchableOpacity style={styles.assetCard} onPress={() => navigation.navigate('资产')} activeOpacity={0.85}>
      <View style={styles.assetCardTopRow}>,
       <Text style={styles.assetCardLabel}>净资产</Text>
        <TouchableOpacity onPress={() => setBalanceHidden((v) => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
         <Ionicons name={balanceHidden ? 'eye-off-outline' : 'eye-outline'} size={24} color={colors.assetLabel} />
        </TouchableOpacity>
     </View>
     {totalsByCurrency.length === 0 ? (
       <Text style={styles.assetCardEmpty}>还没有添加资产账户，点这里去创建</Text>
      ) : (
     <View style={styles.assetCardValueRow}>
      {totalsByCurrency.map(([code, value], i) => (
        <Text key={code} style={styles.assetCardValue}>
          {balanceHidden ? '***' : formatMoney(value)}
          <Text style={styles.assetCardCode}> {code}</Text>
          {i < totalsByCurrency.length - 1 ? '   ' : ''}
        </Text>
      ))}
      </View>
      )}
     <Text style={styles.assetCardHint}>点击查看资产明细 ›</Text>
        </TouchableOpacity>

        {/* 本月预算 + 计划付款：合并进同一格，上下用分割线隔开 */}
        <View style={styles.combinedCard}>
          <TouchableOpacity onPress={openBudgetModal} activeOpacity={0.75}>
            {totalBudget > 0 ? (
              <>
                <View style={styles.budgetBarTop}>
                  <Text style={styles.budgetBarLabel}>本月预算</Text>
                  <Text style={styles.budgetBarValue}>
                    {currencySymbol}{formatMoney(thisExpense)}
                    <Text style={styles.budgetBarValueDim}> / {currencySymbol}{formatMoney(totalBudget)}</Text>
                  </Text>
                </View>
                <View style={styles.budgetBarTrack}>
                  <View
                    style={[
                      styles.budgetBarFill,
                      { width: `${budgetPct}%`, backgroundColor: budgetOver ? colors.expenseOver : colors.expense },
                    ]}
                  />
                </View>
              </>
            ) : (
              <View style={styles.budgetBarEmptyRow}>
                <Ionicons name="add-circle-outline" size={16} color={colors.link} />
                <Text style={styles.budgetBarEmptyText}>设置本月预算</Text>
              </View>
            )}
          </TouchableOpacity>

          <View style={styles.combinedDivider} />

          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>计划付款</Text>
            <TouchableOpacity onPress={openPlanModal}>
              <Text style={styles.sectionLink}>+ 新增</Text>
            </TouchableOpacity>
          </View>
          {upcomingPlans.length === 0 ? (
            <Text style={styles.emptyText}>暂无即将到期的账目</Text>
          ) : (
            upcomingPlans.map((p) => {
              const overdue = isOverdue(p.dueDate);
              const cat = p.categoryId ? getCategoryById(p.categoryId) : undefined;
              const asset = p.assetId ? getAssetById(p.assetId) : undefined;
              return (
                <Swipeable
                  key={p.id}
                  renderRightActions={() => renderPlanRightActions(p.id, p.name)}
                  overshootRight={false}
                >
                  <TouchableOpacity
                    style={styles.planRow}
                    activeOpacity={0.85}
                    onLongPress={() => openEditPlanModal(p.id)}
                  >
                    {/* 左侧勾选框：勾选 = 立即支付，从资产扣款并计入总资产 */}
                    <TouchableOpacity
                      style={styles.planCheckBtn}
                      onPress={() => handlePayNow(p)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="square-outline" size={20} color={colors.link} />
                    </TouchableOpacity>

                    {cat && (
                      <View style={[styles.planIconWrap, { backgroundColor: cat.color + '22' }]}>
                        <Ionicons name={cat.icon as IconName} size={14} color={cat.color} />
                      </View>
                    )}

                    <TouchableOpacity style={{ flex: 1, marginLeft: 10 }} onPress={() => openEditPlanModal(p.id)}>
                      <Text style={styles.planName}>{p.name}</Text>
                      <Text style={[styles.planDate, overdue && { color: colors.expense }]}>
                        {p.dueDate}
                        {overdue ? '（已逾期）' : ''}
                        {p.recurrence !== 'once' ? ` · ${RECURRENCE_LABELS[p.recurrence]}` : ''}
                        {asset ? ` · ${asset.name}` : ''}
                      </Text>
                    </TouchableOpacity>

                    <Text style={styles.planAmount}>
                      {currencySymbol}{formatMoney(p.amount)}
                    </Text>
                  </TouchableOpacity>
                </Swipeable>
              );
            })
          )}
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>今日账单</Text>
            <TouchableOpacity onPress={() => navigation.navigate('账单明细')}>
              <Text style={styles.sectionLink}>查看全部 ›</Text>
            </TouchableOpacity>
          </View>
          {todayTransactions.length === 0 ? (
            <Text style={styles.emptyText}>今天还没有记账</Text>
          ) : (
            todayTransactions.map((item) => {
              const cat = getCategoryById(item.categoryId);
              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.todayRow}
                  activeOpacity={0.6}
                  onPress={() => navigation.navigate('记一笔', { editTransaction: item })}
                >
                  <View style={[styles.todayIconWrap, { backgroundColor: (cat?.color ?? UNCATEGORIZED_COLOR) + '22' }]}>
                    <Ionicons name={(cat?.icon as IconName) ?? UNCATEGORIZED_ICON} size={16} color={cat?.color ?? UNCATEGORIZED_COLOR} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.todayName}>{item.displayName ?? cat?.name ?? UNCATEGORIZED_NAME}</Text>
                    <Text style={styles.todayDate}>{item.date}</Text>
                  </View>
                  <Text style={[styles.todayAmount, { color: item.type === 'expense' ? colors.expense : colors.income }]}>
                    {item.type === 'expense' ? '-' : '+'}
                    {item.assetId ? getCurrencySymbol(getAssetById(item.assetId)?.currency ?? '') : currencySymbol}{formatMoney(item.amount)}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* 左侧个人中心 Drawer */}
      <Modal
        visible={profileMenuOpen}
        transparent
        animationType="none"
        onRequestClose={() => closeProfileDrawer()}
      >
        <View style={styles.drawerRoot}>
          <TouchableOpacity style={styles.drawerOverlay} activeOpacity={1} onPress={() => closeProfileDrawer()} />
          <Animated.View style={[styles.drawerPanel, { transform: [{ translateX: drawerX }] }]}>
            <SafeAreaView style={styles.drawerSafe} edges={['top', 'bottom']}>
              <View style={styles.drawerHeader}>
                <View style={styles.drawerAvatar}>
                  <Ionicons name="person-outline" size={30} color={colors.icon} />
                </View>
                <View style={styles.drawerHeaderText}>
                  <Text style={styles.drawerName}>我的账户</Text>
                  <Text style={styles.drawerSubtitle}>Personal Finance</Text>
                </View>
                <TouchableOpacity onPress={() => closeProfileDrawer()} style={styles.drawerClose}>
                  <Ionicons name="close" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={styles.drawerDivider} />
              <Text style={styles.drawerSectionLabel}>账户</Text>

              <TouchableOpacity style={styles.drawerItem} onPress={() => closeProfileDrawer(() => navigation.navigate('个人中心'))}>
                <View style={styles.drawerItemIcon}><Ionicons name="person-outline" size={21} color={colors.icon} /></View>
                <Text style={styles.drawerItemText}>个人中心</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.drawerItem} onPress={() => closeProfileDrawer(() => navigation.navigate('设置项', {
                    screen: 'home',
                  }))}>
                <View style={styles.drawerItemIcon}><Ionicons name="settings-outline" size={21} color={colors.icon} /></View>
                <Text style={styles.drawerItemText}>设置</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>

              <Text style={[styles.drawerSectionLabel, { marginTop: 22 }]}>工具</Text>
              <TouchableOpacity style={styles.drawerItem} onPress={() => closeProfileDrawer(() => navigation.navigate('计算器'))}>
                <View style={styles.drawerItemIcon}><Ionicons name="calculator-outline" size={21} color={colors.icon} /></View>
                <Text style={styles.drawerItemText}>计算器</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>

              <Text style={[styles.drawerSectionLabel, { marginTop: 22 }]}>支持</Text>
              <TouchableOpacity style={styles.drawerItem} onPress={() => closeProfileDrawer(() => navigation.navigate('帮助与反馈'))}>
                <View style={styles.drawerItemIcon}><Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.icon} /></View>
                <Text style={styles.drawerItemText}>帮助与反馈</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.drawerItem} onPress={() => closeProfileDrawer(() => navigation.navigate('关于应用'))}>
                <View style={styles.drawerItemIcon}><Ionicons name="information-circle-outline" size={21} color={colors.icon} /></View>
                <Text style={styles.drawerItemText}>关于应用</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>

              <View style={styles.drawerFooter}>
                <View style={styles.drawerDivider} />
                <Text style={styles.drawerVersion}>Version 1.0.0</Text>
                <Text style={styles.drawerCopyright}>© 2026 Personal Finance</Text>
              </View>
            </SafeAreaView>
          </Animated.View>
        </View>
      </Modal>

      {/* 多账本切换弹窗 */}
      <Modal
        visible={ledgerPickerOpen}
        animationType="slide"
        onRequestClose={() => setLedgerPickerOpen(false)}
      >
        <SafeAreaView style={styles.ledgerPickerScreen} edges={['top', 'bottom']}>
          <View style={styles.ledgerPickerHeader}>
            <TouchableOpacity
              onPress={() => setLedgerPickerOpen(false)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={24} color={colors.icon} />
            </TouchableOpacity>
            <Text style={styles.ledgerPickerTitle}>选择账本</Text>
            <TouchableOpacity
              onPress={() => {
                setLedgerPickerOpen(false);
                navigation.navigate('设置项', { screen: 'home' });
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="settings-outline" size={22} color={colors.icon} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.ledgerPickerListContent}>
            {ledgers.map((l) => {
              const active = l.id === activeLedgerId;
              const color = l.color ?? '#4C9AFF';
              const totals = ledgerTotals[l.id] ?? [];
              return (
                <TouchableOpacity
                  key={l.id}
                  style={[styles.ledgerPickerCard, active && { borderColor: colors.link }]}
                  activeOpacity={0.85}
                  onPress={() => {
                    setActiveLedgerId(l.id);
                    setLedgerPickerOpen(false);
                  }}
                >
                  <View style={styles.ledgerPickerCardTop}>
                    <View style={[styles.ledgerPickerIconWrap, { backgroundColor: color + '22' }]}>
                      <Ionicons name={l.icon as IconName} size={22} color={color} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={styles.ledgerPickerName}>{l.name}</Text>
                        {totals.length === 1 && (
                          <View style={styles.ledgerPickerBadge}>
                            <Text style={styles.ledgerPickerBadgeText}>{totals[0][0]}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.ledgerPickerSub}>
                        {l.id === 'default' ? '预设账本' : `创建于 ${formatDate(l.createdAt)}`}
                      </Text>
                    </View>
                    <Ionicons
                      name={active ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={active ? colors.link : colors.dividerHair}
                    />
                  </View>
                  <View style={styles.ledgerPickerBalanceRow}>
                    <Text style={styles.ledgerPickerBalanceLabel}>结余</Text>
                    {totals.length === 0 ? (
                      <Text style={styles.ledgerPickerBalanceEmpty}>暂无资产</Text>
                    ) : (
                      <View style={{ alignItems: 'flex-end' }}>
                        {totals.map(([code, amount]) => (
                          <Text key={code} style={styles.ledgerPickerBalanceValue}>
                            {code} {formatMoney(amount)}
                          </Text>
                        ))}
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.ledgerPickerFooter}>
            <TouchableOpacity
              style={styles.ledgerPickerAddBtn}
              onPress={() => {
                setLedgerPickerOpen(false);
                navigation.navigate('开设账本');
              }}
            >
              <Ionicons name="add" size={18} color={colors.bg} />
              <Text style={styles.ledgerPickerAddBtnText}>新增账本</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* 预算调整弹窗 */}
      <Modal
        visible={budgetModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBudgetModalOpen(false)}
      >
        <TouchableOpacity
          style={styles.ledgerModalOverlay}
          activeOpacity={1}
          onPress={() => setBudgetModalOpen(false)}
        >
          <View style={styles.ledgerModalCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.ledgerModalTitle}>设置本月预算</Text>
            <TextInput
              style={styles.modalInput}
              value={budgetInput}
              onChangeText={setBudgetInput}
              keyboardType="decimal-pad"
              placeholder="输入预算金额"
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
            <TouchableOpacity style={styles.modalSaveBtn} onPress={saveBudget}>
              <Text style={styles.modalSaveBtnText}>保存</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 新增/编辑计划付款弹窗 */}
      <Modal
        visible={planModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPlanModalOpen(false)}
      >
        <TouchableOpacity
          style={styles.ledgerModalOverlay}
          activeOpacity={1}
          onPress={() => setPlanModalOpen(false)}
        >
          <View style={styles.planModalCard} onStartShouldSetResponder={() => true}>
            <ScrollView contentContainerStyle={{ paddingBottom: 4 }}>
              <Text style={styles.ledgerModalTitle}>{editingPlanId ? '编辑计划付款' : '新增计划付款'}</Text>

              <Text style={styles.modalFieldLabel}>名称</Text>
              <TextInput
                style={styles.modalInput}
                value={planName}
                onChangeText={setPlanName}
                placeholder="例如：房租"
                placeholderTextColor={colors.textTertiary}
              />

              <Text style={styles.modalFieldLabel}>类别</Text>
              <TouchableOpacity
                style={styles.assetPickerBtn}
                onPress={() => setPlanCategoryPickerOpen((v) => !v)}
                activeOpacity={0.7}
              >
                {(() => {
                  const chosen = planCategoryId ? expenseCategories.find((c) => c.id === planCategoryId) : undefined;
                  return chosen ? (
                    <View style={styles.assetPickerChosenRow}>
                      <Ionicons name={chosen.icon as IconName} size={15} color={chosen.color} />
                      <Text style={styles.assetPickerChosenText}> {chosen.name}</Text>
                    </View>
                  ) : (
                    <Text style={styles.assetPickerPlaceholder}>未选择</Text>
                  );
                })()}
                <Ionicons
                  name={planCategoryPickerOpen ? 'chevron-up-outline' : 'chevron-down-outline'}
                  size={16}
                  color={colors.textTertiary}
                />
              </TouchableOpacity>

              {planCategoryPickerOpen && (
                <View style={styles.catGrid}>
                  {expenseCategories.map((c) => {
                    const active = planCategoryId === c.id;
                    return (
                      <TouchableOpacity
                        key={c.id}
                        style={styles.catItem}
                        onPress={() => {
                          setPlanCategoryId(c.id);
                          setPlanCategoryPickerOpen(false);
                        }}
                      >
                        <View
                          style={[
                            styles.catIconCircle,
                            { backgroundColor: active ? c.color : c.color + '22' },
                          ]}
                        >
                          <Ionicons name={c.icon as IconName} size={22} color={active ? '#fff' : c.color} />
                        </View>
                        <Text style={styles.catLabel}>{c.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              <Text style={styles.modalFieldLabel}>金额</Text>
              <TextInput
                style={styles.modalInput}
                value={planAmount}
                onChangeText={setPlanAmount}
                keyboardType="decimal-pad"
                placeholder="金额"
                placeholderTextColor={colors.textTertiary}
              />

              <Text style={styles.modalFieldLabel}>从哪个账户出账（选填）</Text>
              <TouchableOpacity
                style={styles.assetPickerBtn}
                onPress={() => setPlanAssetPickerOpen((v) => !v)}
                activeOpacity={0.7}
              >
                {(() => {
                  const chosen = planAssetId ? getAssetById(planAssetId) : undefined;
                  return chosen ? (
                    <View style={styles.assetPickerChosenRow}>
                      <Ionicons name={chosen.icon as IconName} size={15} color={chosen.color} />
                      <Text style={styles.assetPickerChosenText}> {chosen.name}</Text>
                      <Text style={styles.assetPickerChosenCurrency}>（{chosen.currency}）</Text>
                    </View>
                  ) : (
                    <Text style={styles.assetPickerPlaceholder}>未选择</Text>
                  );
                })()}
                <Ionicons
                  name={planAssetPickerOpen ? 'chevron-up-outline' : 'chevron-down-outline'}
                  size={16}
                  color={colors.textTertiary}
                />
              </TouchableOpacity>

              {planAssetPickerOpen && (
                <View style={styles.assetDropdown}>
                  <TouchableOpacity
                    style={styles.assetDropdownItem}
                    onPress={() => {
                      setPlanAssetId(null);
                      setPlanAssetPickerOpen(false);
                    }}
                  >
                    <Text style={styles.assetDropdownItemText}>未选择</Text>
                    {planAssetId === null && <Ionicons name="checkmark" size={16} color={colors.textPrimary} />}
                  </TouchableOpacity>

                  {assetGroups.map((group) => (
                    <View key={group.currency}>
                      <View style={styles.assetDropdownDivider}>
                        <Text style={styles.assetDropdownDividerText}>{group.currency}</Text>
                      </View>
                      {group.items.map((a) => (
                        <TouchableOpacity
                          key={a.id}
                          style={styles.assetDropdownItem}
                          onPress={() => {
                            setPlanAssetId(a.id);
                            setPlanAssetPickerOpen(false);
                          }}
                        >
                          <View style={styles.assetDropdownItemLeft}>
                            <Ionicons name={a.icon as IconName} size={15} color={a.color} />
                            <Text style={styles.assetDropdownItemText}> {a.name}</Text>
                            <Text style={styles.assetDropdownItemType}>
                              {' '}
                              · {ASSET_TYPE_LABELS[a.type] ?? a.type}
                            </Text>
                          </View>
                          {planAssetId === a.id && <Ionicons name="checkmark" size={16} color={colors.textPrimary} />}
                        </TouchableOpacity>
                      ))}
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.modalFieldLabel}>到期日</Text>
              <TextInput
                style={styles.modalInput}
                value={planDueDate}
                onChangeText={setPlanDueDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textTertiary}
              />

              <Text style={styles.modalFieldLabel}>周期性</Text>
              <View style={styles.chipRow}>
                {(Object.keys(RECURRENCE_LABELS) as PlannedPaymentRecurrence[]).map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.chip, planRecurrence === r && styles.chipActive]}
                    onPress={() => setPlanRecurrence(r)}
                  >
                    <Text style={[styles.chipText, planRecurrence === r && styles.chipTextActive]}>
                      {RECURRENCE_LABELS[r]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={styles.autoDeductRow}
                onPress={() => setPlanAutoDeduct((v) => !v)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={planAutoDeduct ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={planAutoDeduct ? colors.link : colors.textTertiary}
                />
                <Text style={styles.autoDeductText}>到期自动扣账</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.modalSaveBtn} onPress={savePlan}>
                <Text style={styles.modalSaveBtnText}>{editingPlanId ? '保存修改' : '保存'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
    headerSide: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    headerSideRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
    avatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.avatarBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    drawerRoot: { flex: 1, flexDirection: 'row' },
    drawerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.24)' },
    drawerPanel: { width: '78%', height: '100%', backgroundColor: colors.card, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 22, shadowOffset: { width: 6, height: 0 }, elevation: 12 },
    drawerSafe: { flex: 1, paddingHorizontal: 20 },
    drawerHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: 18, paddingBottom: 24 },
    drawerAvatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.avatarBg, alignItems: 'center', justifyContent: 'center', marginRight: 13 },
    drawerHeaderText: { flex: 1 },
    drawerName: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
    drawerSubtitle: { fontSize: 12, color: colors.textTertiary, marginTop: 4 },
    drawerClose: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    drawerDivider: { height: 1, backgroundColor: colors.dividerHair },
    drawerSectionLabel: { fontSize: 11, color: colors.textTertiary, fontWeight: '600', letterSpacing: 0.8, marginTop: 20, marginBottom: 8 },
    drawerItem: { flexDirection: 'row', alignItems: 'center', minHeight: 54, borderRadius: 12, paddingHorizontal: 4 },
    drawerItemIcon: { width: 38, alignItems: 'center' },
    drawerItemText: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.textPrimary },
    drawerFooter: { marginTop: 'auto', paddingBottom: 12 },
    drawerVersion: { fontSize: 12, color: colors.textTertiary, marginTop: 16 },
    drawerCopyright: { fontSize: 11, color: colors.textTertiary, marginTop: 5 },
    headerCenter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, maxWidth: 160 },
    headerIconBtn: { marginLeft: 16 },
    assetCard: {
      backgroundColor: colors.assetCard,
      marginHorizontal: 16,
      borderRadius: 16,
      padding: 18,
      marginTop: 8,
    },
    assetCardLabel: { fontSize: 12, color: colors.assetLabel, marginBottom: 8 },
    assetCardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    assetCardValueRow: { flexDirection: 'row', flexWrap: 'wrap' },
    assetCardValue: { fontSize: 24, fontWeight: '700', color: colors.assetValue },
    assetCardCode: { fontSize: 12, color: colors.assetLabel, fontWeight: '400' },
    assetCardEmpty: { fontSize: 13, color: colors.assetLabel },
    assetCardHint: { fontSize: 11, color: colors.assetHint, marginTop: 10 },
    // 本月预算 + 计划付款 合并卡片
    combinedCard: {
      backgroundColor: colors.summaryCard,
      marginHorizontal: 16,
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginTop: 12,
    },
    combinedDivider: {
      height: 1,
      backgroundColor: colors.dividerHair,
      marginVertical: 14,
    },
    budgetBarTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    budgetBarLabel: { fontSize: 12, color: colors.textSecondary },
    budgetBarValue: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
    budgetBarValueDim: { fontSize: 12, color: colors.textSecondary, fontWeight: '400' },
    budgetBarTrack: { height: 5, backgroundColor: colors.track, borderRadius: 3, overflow: 'hidden' },
    budgetBarFill: { height: 5, borderRadius: 3 },
    budgetBarEmptyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
    budgetBarEmptyText: { fontSize: 13, color: colors.link, marginLeft: 6, fontWeight: '600' },
    sectionCard: { backgroundColor: colors.card, marginHorizontal: 16, borderRadius: 16, padding: 16, marginTop: 12 },
    sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    sectionLink: { fontSize: 12, color: colors.link },
    emptyText: { fontSize: 13, color: colors.textTertiary },
    todayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
    todayIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    todayName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
    todayDate: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
    todayAmount: { fontSize: 14, fontWeight: '700' },
    planRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      backgroundColor: colors.summaryCard,
    },
    planCheckBtn: { padding: 2 },
    planIconWrap: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 8,
    },
    planName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
    planDate: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
    planAmount: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    swipeDeleteBtn: {
      backgroundColor: colors.expense,
      justifyContent: 'center',
      alignItems: 'center',
      width: 64,
      borderRadius: 10,
      marginLeft: 8,
    },
    swipeDeleteText: { color: '#fff', fontSize: 11, marginTop: 2, fontWeight: '600' },
    ledgerModalOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
    },
    ledgerModalCard: {
      width: '100%',
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
    },
    planModalCard: {
      width: '100%',
      maxHeight: '85%',
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
    },
    ledgerModalTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 8, textAlign: 'center' },
    modalFieldLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 12, marginBottom: 6 },
    // 全屏账本快速切换弹窗（参照 LedgerScreen 的卡片样式，保持视觉一致）
    ledgerPickerScreen: { flex: 1, backgroundColor: colors.bg },
    ledgerPickerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 14,
    },
    ledgerPickerTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
    ledgerPickerListContent: { padding: 20, paddingTop: 4, gap: 12 },
    ledgerPickerCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 14,
      borderWidth: 2,
      borderColor: 'transparent',
      marginBottom: 12,
    },
    ledgerPickerCardTop: { flexDirection: 'row', alignItems: 'center' },
    ledgerPickerIconWrap: {
      width: 48,
      height: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ledgerPickerName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    ledgerPickerBadge: {
      marginLeft: 8,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.link,
    },
    ledgerPickerBadgeText: { fontSize: 11, fontWeight: '700', color: colors.link },
    ledgerPickerSub: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
    ledgerPickerBalanceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.dividerHair,
    },
    ledgerPickerBalanceLabel: { fontSize: 12, color: colors.textTertiary },
    ledgerPickerBalanceEmpty: { fontSize: 13, color: colors.textTertiary },
    ledgerPickerBalanceValue: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    ledgerPickerFooter: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 12,
      borderTopWidth: 1,
      borderTopColor: colors.dividerHair,
    },
    ledgerPickerAddBtn: {
      flexDirection: 'row',
      backgroundColor: colors.textPrimary,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    ledgerPickerAddBtnText: { color: colors.bg, fontWeight: '700', fontSize: 14 },
    modalInput: {
      backgroundColor: colors.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      padding: 12,
      fontSize: 14,
      color: colors.textPrimary,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginRight: 8,
      marginBottom: 8,
    },
    chipActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
    chipText: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
    chipTextActive: { color: colors.bg },
    // 计划付款的类别选择器：跟"记一笔"里选类别的网格样式保持一致（点一下直接选中，不用滑动）
    catGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    catItem: { width: '25%', alignItems: 'center', marginBottom: 16 },
    catIconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    catLabel: { fontSize: 11, color: colors.textPrimary, marginTop: 6, textAlign: 'center' },
    assetPickerBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    assetPickerPlaceholder: { fontSize: 14, color: colors.textTertiary },
    assetPickerChosenRow: { flexDirection: 'row', alignItems: 'center' },
    assetPickerChosenText: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
    assetPickerChosenCurrency: { fontSize: 12, color: colors.textTertiary },
    assetDropdown: {
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      borderRadius: 10,
      marginTop: 6,
      paddingVertical: 4,
    },
    assetDropdownDivider: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.summaryCard,
    },
    assetDropdownDividerText: { fontSize: 11, color: colors.textTertiary, fontWeight: '700' },
    assetDropdownItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    assetDropdownItemLeft: { flexDirection: 'row', alignItems: 'center' },
    assetDropdownItemText: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
    assetDropdownItemType: { fontSize: 11, color: colors.textTertiary },
    autoDeductRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
    autoDeductText: { fontSize: 13, color: colors.textPrimary, marginLeft: 8, fontWeight: '600' },
    modalSaveBtn: {
      backgroundColor: colors.textPrimary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 16,
    },
    modalSaveBtnText: { color: colors.bg, fontWeight: '700', fontSize: 14 },
  });
}
