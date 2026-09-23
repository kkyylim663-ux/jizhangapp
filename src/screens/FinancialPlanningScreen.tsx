// 财务规划页(设置项 → 财务规划):
// - 计划付款列表:卡片(名称/金额/周期/下一扣账日/自动状态),点卡片进编辑页,长按删除
// - 底部固定"＋ 新增规划"按钮 → 跳转整页表单(PlanFormScreen),不用弹窗
// - 未来模块(储蓄目标等)按"模块卡"组织,各占一卡
import React, { useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { useDialog } from '../components/AppDialog';
import { useTheme } from '../theme/useTheme';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarForceHide } from '../context/TabBarAutoHideContext';
import { ThemeColors } from '../theme/theme';
import { useT } from '../i18n/LanguageContext';
import { Swipeable } from 'react-native-gesture-handler';
import { PaymentPlan } from '../types';
import { nextDueDate } from '../utils/paymentPlans';
import { ROUTES } from '../navigation/routes';
import { hapticWarning } from '../utils/haptics';
import PressableScale from '../components/PressableScale';

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function FinancialPlanningScreen({ navigation }: any) {
  const { paymentPlans, deletePaymentPlan, activeLedgerId } = useApp();
  const { colors } = useTheme();
  const tr = useT();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tabClearance = useTabClearance();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const setTabBarForceHidden = useTabBarForceHide();
  // 本页面（财务规划）**永远不显示底部导航栏**：与添加/编辑计划页同一语义——
  // 从设置项 push 进来的二级页不该有 Tab 栏。只要前台就一直强制隐藏，卸载时才交还。
  // 失焦时【不放栏】：从添加计划 goBack 回本页的转场里，本页的"聚焦隐藏"先执行、
  // 添加计划的失焦 cleanup 后执行——若这里在失焦分支放栏会互相覆盖（同上根源）
  useEffect(() => {
    if (isFocused) setTabBarForceHidden(true);
  }, [isFocused, setTabBarForceHidden]);
  useEffect(() => {
    return () => setTabBarForceHidden(false);
  }, []);

  const plans = paymentPlans.filter((p) => p.ledgerId === activeLedgerId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function cycleBadgeText(p: PaymentPlan): string {
    // 周计划：用 i18n 的 weekShort 数组（索引 0=周一…6=周日；dayOfWeek 约定 0=周日）
    if (p.cycle === 'weekly') {
      const dow = p.dayOfWeek ?? 1;
      const weekShort = tr('finance.weekShort') as unknown as string[];
      const short = Array.isArray(weekShort) ? weekShort[dow === 0 ? 6 : dow - 1] : String(dow);
      return `${tr('finance.weeklyLabel')}·${short}`;
    }
    if (p.cycle === 'monthly') return `${tr('finance.monthlyLabel')}·${p.dayOfMonth ?? 1}`;
    return `${tr('finance.yearlyLabel')}·${p.month ?? 1}/${p.day ?? 1}`;
  }

  // 副标题：显示下一次实际结算的具体日期（月末自动兜底：31 号计划 9 月显示"9月30号结算"）；
  // 周/年计划显示对应结算日
  function settleDayLabel(p: PaymentPlan): string {
    if (p.cycle === 'weekly') {
      const dow = p.dayOfWeek ?? 1;
      const weekShort = tr('finance.weekShort') as unknown as string[];
      const short = Array.isArray(weekShort) ? weekShort[dow === 0 ? 6 : dow - 1] : String(dow);
      return `${tr('finance.weeklyLabel')}·${short}`;
    }
    if (p.cycle === 'yearly') return `${tr('finance.yearlyLabel')}·${p.month ?? 1}/${p.day ?? 1}`;
    const next = nextDueDate(p, today);
    if (next) {
      return tr('finance.nextSettleLabel', { month: next.getMonth() + 1, day: next.getDate() });
    }
    return tr('finance.settleDayLabel', { day: p.dayOfMonth ?? 1 });
  }

  const handleDelete = (p: PaymentPlan) => {
    dialog.alert({
      title: tr('finance.deletePlan'),
      message: tr('finance.deletePlanMsg'),
      buttons: [
        { text: tr('finance.cancel'), style: 'cancel' },
        { text: tr('finance.delete'), style: 'destructive', onPress: () => { hapticWarning(); void deletePaymentPlan(p.id); } },
      ],
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* 头部:左右两个 flex:1 侧栏夹住标题,保证标题严格居中(右侧按钮比返回键宽,不能用 space-between) */}
      <View style={styles.header}>
        <View style={styles.headerSide}>
          <PressableScale onPress={() => navigation.goBack()} style={styles.backBtn} activeScale={0.92}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </PressableScale>
        </View>
        <Text style={styles.headerTitle}>{tr('finance.title')}</Text>
        <View style={styles.headerSideRight}>
          {/* 右上角"添加项目"按钮(与资产页头部"添加账户"同款规格) */}
          <PressableScale
            style={styles.headerAddBtn}
            activeScale={0.92}
            onPress={() => navigation.navigate(ROUTES.FINANCE_PLAN_EDIT)}
          >
            <Ionicons name="add" size={16} color={colors.bg} />
            <Text style={styles.headerAddBtnText}>{tr('finance.addPlan')}</Text>
          </PressableScale>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* TASK-020②（用户纠偏版）：左右对齐的固定支出/固定收入——加在「添加规划」按钮之后、
            列表之前，两卡并排各半，显示各自类型计划金额合计（纯展示，不做筛选、不加交互） */}
        <View style={styles.typeSummaryRow}>
          {(['expense', 'income'] as const).map((tp) => {
            const tpColor = tp === 'expense' ? colors.expense : colors.income;
            const tpTotal = plans
              .filter((p) => p.type === tp)
              .reduce((sum, p) => sum + p.amount, 0);
            return (
              <View key={tp} style={styles.typeSummaryCard}>
                <Text style={styles.typeSummaryLabel}>{tp === 'expense' ? tr('finance.typeExpense') : tr('finance.typeIncome')}</Text>
                <Text style={[styles.typeSummaryAmount, { color: tpColor }]}>
                  {tp === 'expense' ? '-' : '+'}
                  {tpTotal.toFixed(2)}
                </Text>
              </View>
            );
          })}
        </View>
        {plans.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="clipboard-outline" size={28} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>{tr('finance.noPlans')}</Text>
            <Text style={styles.emptyHint}>{tr('finance.noPlansHint')}</Text>
          </View>
        ) : (
          plans.map((p) => {
            const color = p.type === 'expense' ? colors.expense : colors.income;
            return (
              /* 侧滑删除：往左滑出红色删除按钮（与 Home 账单曾用的 Swipeable 同交互）；
                  点卡片仍进编辑页 */
              <Swipeable
                key={p.id}
                overshootLeft={false}
                renderLeftActions={() => (
                  <TouchableOpacity
                    style={styles.planSwipeDelete}
                    activeOpacity={0.8}
                    onPress={() => handleDelete(p)}
                  >
                    <Ionicons name="trash-outline" size={20} color={colors.bg} />
                    <Text style={styles.planSwipeDeleteText}>{tr('finance.delete')}</Text>
                  </TouchableOpacity>
                )}
              >
              <PressableScale
                style={[styles.planCard, !p.active && { opacity: 0.55 }]}
                activeScale={0.97}
                onPress={() => navigation.navigate(ROUTES.FINANCE_PLAN_EDIT, { planId: p.id })}
              >
                <View style={[styles.planIcon, { backgroundColor: color + '1A' }]}>
                  <Ionicons
                    name={p.type === 'expense' ? 'arrow-up-outline' : 'arrow-down-outline'}
                    size={17}
                    color={color}
                  />
                </View>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.planName, !p.active && { color: colors.textTertiary }]} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <View style={[styles.planBadge, { backgroundColor: p.active ? colors.link + '14' : colors.dividerHair }]}>
                      <Text style={{ fontSize: 9, fontWeight: '700', color: p.active ? colors.link : colors.textTertiary }}>
                        {!p.active ? tr('finance.pausedBadge') : p.autoDeduct ? tr('finance.autoBadge') : tr('finance.remindBadge')}
                      </Text>
                    </View>
                  </View>
                  {/* 副标题：只保留"每月几号结算"字样（周/年计划显示对应结算日） */}
                  <Text style={styles.planMeta}>{settleDayLabel(p)}</Text>
                </View>
                <Text style={[styles.planAmount, { color }]}>
                  {p.type === 'expense' ? '-' : '+'}
                  {p.amount.toFixed(2)}
                </Text>
              </PressableScale>
              </Swipeable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: {
      height: 56,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
    },
    // 头部左右侧栏等宽(flex:1),把标题夹在正中间
    headerSide: { flex: 1, flexDirection: 'row' },
    headerSideRight: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: colors.link,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
    // 右上角"添加项目"按钮:与资产页头部"添加账户"同款规格
    headerAddBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.fabBg,
      borderRadius: 17,
      paddingHorizontal: 14,
      paddingVertical: 8,
      marginLeft: 10,
    },
    headerAddBtnText: { color: colors.bg, fontSize: 13, fontWeight: '700', marginLeft: 3 },

    // TASK-020②（用户纠偏版）：「添加规划」下方固定支出/固定收入两卡左右并排各半
    typeSummaryRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
    typeSummaryCard: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    typeSummaryLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
    typeSummaryAmount: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 4 },

    sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginTop: 16, marginBottom: 8 },

    emptyCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      alignItems: 'center',
      // 空态卡加高:上下留白拉大,占住列表区域(56 → 75)
      paddingVertical: 75,
      paddingHorizontal: 24,
    },
    emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginTop: 14 },
    emptyHint: { fontSize: 12, color: colors.textTertiary, marginTop: 6 },

    planCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      marginBottom: 8,
    },
    // 侧滑露出的删除按钮（左侧）：与卡片同高，红底白字垃圾桶
    planSwipeDelete: {
      width: 88,
      minHeight: 72,
      borderRadius: 14,
      backgroundColor: colors.expense,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
      marginRight: 8,
      marginBottom: 8,
    },
    planSwipeDeleteText: { fontSize: 12, fontWeight: '700', color: colors.bg },
    planIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 10,
    },
    planName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, flexShrink: 1 },
    planBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 7 },
    planMeta: { fontSize: 11, color: colors.textTertiary, marginTop: 3 },
    planAmount: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },

    addBtnText: { color: colors.bg, fontSize: 15, fontWeight: '700' },
  });
}
