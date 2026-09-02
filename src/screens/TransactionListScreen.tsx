/**
 * TransactionListScreen —— 修改说明
 *
 * 1. 日期范围选择器改成跟 ReportScreen 一样的样式：
 *    箭头(‹ › 上一/下一) + 中间标签 + 右侧"年/月/周/定期"下拉小按钮，
 *    点下拉弹出悬浮菜单选类型，选"定期"再弹出自定义起止日期的输入框。
 *    去掉了原本"今天/昨天/本周/上周/本月/上月/今年/去年"那一整个大网格预设弹窗
 *    （RangeType 也跟着从 'day'|'week'|'month'|'year'|'custom' 简化成
 *    'year'|'month'|'week'|'custom'，和 ReportScreen 完全对齐）。
 *
 * 2. 接入夜间模式：useTheme() + makeStyles(colors) 写法，字段用真实 theme.ts：
 *    bg / card / textPrimary / textSecondary / textTertiary / dividerHair /
 *    overlay / income / expense / summaryCard / icon / cardShadow 等。
 *
 * 3. 账单行标题展示优先级调整：
 *    原本 = 分类名 ?? displayName ?? 未分类
 *    现在 = note(手打备注) > displayName(计划付款名称) > 分类名 > 未分类
 *    同时：如果标题用的是 note 或 displayName（也就是没有直接显示分类名），
 *    会把分类名补进副标题(meta)那一行，避免用户看不出这笔钱到底是什么分类。
 *    转账类型不受影响，标题依然固定是"账户A → 账户B"，note 仍显示在副标题里。
 */

import React, { useMemo, useState, useEffect, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { useTheme } from '../theme/useTheme';
import { ThemeColors } from '../theme/theme';
import { Transaction } from '../types';
import { getCurrencySymbol } from '../utils/currencies';
import {
  UNCATEGORIZED_ICON,
  UNCATEGORIZED_NAME,
  UNCATEGORIZED_COLOR,
} from '../constants/uncategorized';

type IconName = keyof typeof Ionicons.glyphMap;
type RangeType = 'year' | 'month' | 'week' | 'custom';

// 账单页视觉配色：收入/正结余统一蓝色，支出/负结余统一橙红色。
// 这些颜色按参考截图校准，不依赖主题文件里可能被其他页面使用的 income/expense 色值。
const BILL_INCOME_COLOR = '#3F86D9';
const BILL_EXPENSE_COLOR = '#E47A63';

type TxSection = {
  title: string;
  data: Transaction[];
  dayIncome: number;
  dayExpense: number;
  dayBalance: number;
  count: number;
  collapsible: boolean;
  expanded: boolean;
};

const RANGE_TYPE_LABELS: Record<RangeType, string> = {
  year: '年',
  month: '月',
  week: '周',
  custom: '定期',
};

function formatMoney(n: number) {
  return n.toFixed(2);
}

function formatDateLabel(date: string) {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfWeek(d: Date) {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}

function buildRange(type: Exclude<RangeType, 'custom'>, anchor: Date): { start: string; end: string; label: string } {
  if (type === 'week') {
    const mon = startOfWeek(anchor);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { start: fmt(mon), end: fmt(sun), label: `${fmt(mon)} ~ ${fmt(sun)}` };
  }
  if (type === 'year') {
    return {
      start: `${anchor.getFullYear()}-01-01`,
      end: `${anchor.getFullYear()}-12-31`,
      label: `${anchor.getFullYear()}年`,
    };
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return {
    start: fmt(first),
    end: fmt(last),
    label: `${anchor.getFullYear()}年${anchor.getMonth() + 1}月`,
  };
}

export default function TransactionListScreen({ navigation }: any) {
  const {
    transactions,
    getCategoryById,
    getAssetById,
    deleteTransaction,
    currency,
    activeLedgerId,
  } = useApp();

  const { colors } = useTheme(); // 不传参数！
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const now = new Date();

  const [rangeType, setRangeType] = useState<RangeType>('month');
  const [anchor, setAnchor] = useState(now);
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null);

  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [customStart, setCustomStart] = useState(fmt(now));
  const [customEnd, setCustomEnd] = useState(fmt(now));

  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  const range = useMemo(() => {
    if (rangeType === 'custom' && customRange) {
      return { start: customRange.start, end: customRange.end, label: `${customRange.start} ~ ${customRange.end}` };
    }
    return buildRange(rangeType === 'custom' ? 'month' : rangeType, anchor);
  }, [rangeType, anchor, customRange]);

  useEffect(() => {
    setExpandedDates(new Set());
  }, [range.start, range.end]);

  useLayoutEffect(() => {
    navigation?.setOptions?.({
      title: '账单',
      // Header 是 React Navigation 渲染的原生导航栏，不在这个组件的 makeStyles(colors) 范围内，
      // 之前只改了页面内容的颜色，Header 还是写死的白底黑字，导致夜间模式下"上白下黑"两截颜色。
      // 这里把 Header 背景/标题/返回箭头颜色也接上主题，colors 变了就会重新跑这个 effect。
      headerStyle: { backgroundColor: colors.card },
      headerTintColor: colors.textPrimary,
      headerTitleStyle: { color: colors.textPrimary },
      // 深色模式下 header 底部那条系统默认阴影/分隔线在纯黑背景上会显得很突兀，直接关掉
      headerShadowVisible: false,
      headerRight: () => (
        <TouchableOpacity
          onPress={() => Alert.alert('更多', '导出、筛选等功能还在开发中')}
          style={{ marginRight: 4 }}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.icon} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, colors]);

  const ledgerTransactions = useMemo(
    () => transactions.filter((t) => t.ledgerId === activeLedgerId),
    [transactions, activeLedgerId]
  );

  const rangeTransactions = useMemo(
    () => ledgerTransactions.filter((t) => t.date >= range.start && t.date <= range.end),
    [ledgerTransactions, range]
  );

  // 这笔交易实际用的是哪个货币：
  // 普通收支 -> 关联资产的货币；转账 -> 转出账户(fromAsset)的货币（amount字段本来就是以fromAsset货币计的）；
  // 都查不到就退回账本默认货币，不强行做汇率换算。
  const getTransactionCurrency = (item: Transaction): string => {
    if (item.type === 'transfer') {
      return getAssetById(item.fromAssetId ?? '')?.currency ?? currency;
    }
    return (item.assetId ? getAssetById(item.assetId)?.currency : undefined) ?? currency;
  };

  // 按货币分开汇总收入/支出（不做换算，不同货币的钱不会被错误相加）
  const currencyBreakdown = useMemo(() => {
    const totals: Record<string, { income: number; expense: number }> = {};
    rangeTransactions.forEach((t) => {
      if (t.type !== 'income' && t.type !== 'expense') return;
      const code = getTransactionCurrency(t);
      if (!totals[code]) totals[code] = { income: 0, expense: 0 };
      if (t.type === 'income') totals[code].income += t.amount;
      else totals[code].expense += t.amount;
    });
    return totals;
  }, [rangeTransactions, currency]);

  // 账本默认货币排最前，其余按活跃程度（收入+支出）从高到低
  const availableCurrencies = useMemo(() => {
    const codes = Object.keys(currencyBreakdown);
    return codes.sort((a, b) => {
      if (a === currency) return -1;
      if (b === currency) return 1;
      const totalA = currencyBreakdown[a].income + currencyBreakdown[a].expense;
      const totalB = currencyBreakdown[b].income + currencyBreakdown[b].expense;
      return totalB - totalA;
    });
  }, [currencyBreakdown, currency]);

  const [selectedSummaryCurrency, setSelectedSummaryCurrency] = useState(currency);

  // 切换月份/范围后，如果之前选中的货币这段时间没有记录了，退回账本默认货币
  useEffect(() => {
    if (!availableCurrencies.includes(selectedSummaryCurrency)) {
      setSelectedSummaryCurrency(currency);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableCurrencies]);

  const summarySymbol = getCurrencySymbol(selectedSummaryCurrency);
  const rangeIncome = currencyBreakdown[selectedSummaryCurrency]?.income ?? 0;
  const rangeExpense = currencyBreakdown[selectedSummaryCurrency]?.expense ?? 0;
  const rangeBalance = rangeIncome - rangeExpense;

  const sections: TxSection[] = useMemo(() => {
    const groups: Record<string, Transaction[]> = {};
    rangeTransactions.forEach((t) => {
      if (!groups[t.date]) groups[t.date] = [];
      groups[t.date].push(t);
    });

    const dates = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));
    const multiDay = dates.length > 1;

    return dates.map((date) => {
      const dayIncome = groups[date]
        .filter((t) => t.type === 'income' && getTransactionCurrency(t) === selectedSummaryCurrency)
        .reduce((sum, t) => sum + t.amount, 0);
      const dayExpense = groups[date]
        .filter((t) => t.type === 'expense' && getTransactionCurrency(t) === selectedSummaryCurrency)
        .reduce((sum, t) => sum + t.amount, 0);

      return {
        title: date,
        data: multiDay && !expandedDates.has(date) ? [] : groups[date],
        dayIncome,
        dayExpense,
        dayBalance: dayIncome - dayExpense,
        count: groups[date].length,
        collapsible: multiDay,
        expanded: expandedDates.has(date),
      };
    });
  }, [rangeTransactions, expandedDates, selectedSummaryCurrency]);

  const toggleDate = (date: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const shiftRange = (dir: 1 | -1) => {
    if (rangeType === 'custom') return;
    if (rangeType === 'month') {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
    } else if (rangeType === 'year') {
      setAnchor(new Date(anchor.getFullYear() + dir, 0, 1));
    } else {
      const next = new Date(anchor);
      next.setDate(next.getDate() + dir * 7);
      setAnchor(next);
    }
  };

  const pickRangeType = (t: RangeType) => {
    setTypePickerOpen(false);
    if (t === 'custom') {
      setCustomModalOpen(true);
      return;
    }
    setRangeType(t);
  };

  const applyCustomRange = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customStart) || !/^\d{4}-\d{2}-\d{2}$/.test(customEnd)) {
      Alert.alert('日期格式不对', '请按 YYYY-MM-DD 格式填写');
      return;
    }
    if (customStart > customEnd) {
      Alert.alert('日期范围不对', '起始日期不能晚于结束日期');
      return;
    }
    setCustomRange({ start: customStart, end: customEnd });
    setRangeType('custom');
    setCustomModalOpen(false);
  };

  const handleDelete = (id: string) => {
    Alert.alert('删除这条记录？', '删除后无法恢复', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => deleteTransaction(id) },
    ]);
  };

  const getTransactionAssetText = (item: Transaction) => {
    if (item.type === 'transfer') {
      const fromAsset = getAssetById(item.fromAssetId ?? '');
      const toAsset = getAssetById(item.toAssetId ?? '');
      return `${fromAsset?.name ?? '未知资产'} → ${toAsset?.name ?? '未知资产'}`;
    }

    // 兼容当前 Transaction 模型：优先使用 assetId；如果项目里旧数据使用 accountId，也能正常显示。
    const raw = item as Transaction & {
      assetId?: string;
      accountId?: string;
      asset?: { id?: string; name?: string };
    };
    const asset = raw.assetId
      ? getAssetById(raw.assetId)
      : raw.accountId
        ? getAssetById(raw.accountId)
        : raw.asset?.name
          ? raw.asset
          : undefined;

    return asset?.name ?? '未指定资产';
  };

  const renderRowInfo = (item: Transaction) => {
    const rowSymbol = getCurrencySymbol(getTransactionCurrency(item));

    if (item.type === 'transfer') {
      return {
        icon: 'swap-horizontal-outline' as IconName,
        color: colors.textPrimary,
        title: getTransactionAssetText(item),
        amountText: `${rowSymbol}${formatMoney(item.amount)}`,
        amountColor: colors.textPrimary,
      };
    }

    const cat = getCategoryById(item.categoryId);
    const isExpense = item.type === 'expense';
    const typeColor = isExpense ? BILL_EXPENSE_COLOR : BILL_INCOME_COLOR;

    // 标题展示优先级：note（手打备注）> displayName（计划付款名称）> 分类名 > 未分类
    const hasNote = !!item.note?.trim();
    const hasDisplayName = !hasNote && !!item.displayName?.trim();
    const title = hasNote
      ? item.note!.trim()
      : hasDisplayName
        ? item.displayName!.trim()
        : cat?.name ?? UNCATEGORIZED_NAME;

    return {
      icon: (cat?.icon ?? UNCATEGORIZED_ICON) as IconName,
      color: typeColor,
      title,
      amountText: `${isExpense ? '-' : '+'}${rowSymbol}${formatMoney(item.amount)}`,
      amountColor: typeColor,
      // 标题有没有"借用"分类名——没借用的话（用了note/displayName），
      // 副标题里需要补上分类名，避免用户看不出这笔钱的分类
      titleUsedCategory: !hasNote && !hasDisplayName,
      categoryName: cat?.name,
    };
  };

  const renderAssetLine = (item: Transaction, titleUsedCategory: boolean, categoryName?: string) => {
    const assetText = getTransactionAssetText(item);
    const timeText = (item as Transaction & { time?: string }).time;
    const metaParts = [assetText, timeText].filter(Boolean) as string[];

    if (item.type === 'transfer') {
      // 转账的标题固定是"账户A → 账户B"，note 没被提升为标题，所以还是放进副标题里
      if (item.note) metaParts.push(item.note);
    } else if (!titleUsedCategory && categoryName) {
      // 标题用了 note/displayName，把分类名补进副标题，保留分类信息
      metaParts.push(categoryName);
    }

    return metaParts.join(' · ');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* 日期范围选择器：跟 ReportScreen 同款 —— 箭头 + 标签 + 年/月/周/定期 下拉 */}
      <View style={styles.rangeSwitcher}>
        <TouchableOpacity onPress={() => shiftRange(-1)} style={styles.rangeArrow} disabled={rangeType === 'custom'}>
          <Ionicons name="chevron-back" size={18} color={rangeType === 'custom' ? colors.textTertiary : colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.rangeLabel}>{range.label}</Text>
        <TouchableOpacity onPress={() => shiftRange(1)} style={styles.rangeArrow} disabled={rangeType === 'custom'}>
          <Ionicons name="chevron-forward" size={18} color={rangeType === 'custom' ? colors.textTertiary : colors.textSecondary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={styles.typePickerBtn} onPress={() => setTypePickerOpen(true)}>
          <Text style={styles.typePickerBtnText}>{RANGE_TYPE_LABELS[rangeType]}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.textPrimary} style={{ marginLeft: 2 }} />
        </TouchableOpacity>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.summaryCol}>
          <Text style={styles.summaryLabel}>收入</Text>
          <Text style={[styles.summaryValue, { color: BILL_INCOME_COLOR }]}>
            {summarySymbol}{formatMoney(rangeIncome)}
          </Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCol}>
          <Text style={styles.summaryLabel}>支出</Text>
          <Text style={[styles.summaryValue, { color: BILL_EXPENSE_COLOR }]}>
            {summarySymbol}{formatMoney(rangeExpense)}
          </Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCol}>
          <Text style={styles.summaryLabel}>结余</Text>
          <Text
            style={[
              styles.summaryValue,
              { color: rangeBalance >= 0 ? BILL_INCOME_COLOR : BILL_EXPENSE_COLOR },
            ]}
          >
            {rangeBalance < 0 ? '-' : ''}
            {summarySymbol}{formatMoney(Math.abs(rangeBalance))}
          </Text>
        </View>
      </View>

      {/* 多币种切换：这段时间里出现不止一种货币时才显示，点哪个上面三栏就换算成看哪个（不做汇率换算） */}
      {availableCurrencies.length > 1 && (
        <View style={styles.currencyChipRow}>
          {availableCurrencies.map((code) => (
            <TouchableOpacity
              key={code}
              style={[styles.currencyChip, selectedSummaryCurrency === code && styles.currencyChipActive]}
              onPress={() => setSelectedSummaryCurrency(code)}
            >
              <Text
                style={[styles.currencyChipText, selectedSummaryCurrency === code && styles.currencyChipTextActive]}
              >
                {code}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {sections.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>这段时间还没有记账记录</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 24 }}
          renderSectionHeader={({ section }) => (
            <TouchableOpacity
              style={styles.sectionHeader}
              activeOpacity={section.collapsible ? 0.7 : 1}
              disabled={!section.collapsible}
              onPress={() => toggleDate(section.title)}
            >
              <View style={styles.sectionHeaderLeft}>
                <View>
                  <Text style={styles.sectionDate}>{formatDateLabel(section.title)}</Text>
                  <Text style={styles.sectionSubDate}>{section.count} 笔</Text>
                </View>
              </View>

              <View style={styles.sectionRight}>
                <Text
                  style={[
                    styles.dayTotal,
                    {
                      color:
                        section.dayBalance < 0
                          ? BILL_EXPENSE_COLOR
                          : section.dayBalance > 0
                            ? BILL_INCOME_COLOR
                            : colors.textSecondary,
                    },
                  ]}
                >
                  {section.dayBalance < 0 ? '-' : section.dayBalance > 0 ? '+' : ''}
                  {summarySymbol}{formatMoney(Math.abs(section.dayBalance))}
                </Text>
                {section.collapsible && (
                  <Ionicons
                    name={section.expanded ? 'chevron-down' : 'chevron-forward'}
                    size={18}
                    color={colors.textTertiary}
                    style={styles.sectionChevron}
                  />
                )}
              </View>
            </TouchableOpacity>
          )}
          renderItem={({ item }) => {
            const info = renderRowInfo(item);
            return (
              <View style={styles.swipeWrap}>
                <Swipeable
                  renderRightActions={() => (
                    <TouchableOpacity
                      style={styles.deleteAction}
                      activeOpacity={0.8}
                      onPress={() => handleDelete(item.id)}
                    >
                      <Ionicons name="trash-outline" size={20} color="#fff" />
                      <Text style={styles.deleteActionText}>删除</Text>
                    </TouchableOpacity>
                  )}
                  overshootRight={false}
                >
                  <TouchableOpacity
                    style={styles.row}
                    activeOpacity={0.6}
                    onPress={() => navigation.navigate('记一笔', { editTransaction: item })}
                  >
                    <View style={[styles.iconWrap, { backgroundColor: `${info.color}18` }]}>
                      <Ionicons name={info.icon} size={19} color={info.color} />
                    </View>
                    <View style={styles.rowMid}>
                      <Text style={styles.catName} numberOfLines={1}>{info.title}</Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {renderAssetLine(item, info.titleUsedCategory ?? true, info.categoryName)}
                      </Text>
                    </View>
                    <Text style={[styles.amount, { color: info.amountColor }]}>
                      {info.amountText}
                    </Text>
                  </TouchableOpacity>
                </Swipeable>
              </View>
            );
          }}
        />
      )}

      {/* 年/月/周/定期 下拉菜单 */}
      <Modal visible={typePickerOpen} transparent animationType="fade" onRequestClose={() => setTypePickerOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setTypePickerOpen(false)}>
          <View style={styles.typeSheet}>
            {(['year', 'month', 'week', 'custom'] as RangeType[]).map((t) => (
              <TouchableOpacity key={t} style={styles.typeSheetRow} onPress={() => pickRangeType(t)}>
                <Text style={[styles.typeSheetText, rangeType === t && styles.typeSheetTextActive]}>
                  {RANGE_TYPE_LABELS[t]}
                </Text>
                {rangeType === t && <Ionicons name="checkmark" size={16} color={colors.textPrimary} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 自定义范围（选"定期"时弹出） */}
      <Modal visible={customModalOpen} transparent animationType="slide" onRequestClose={() => setCustomModalOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setCustomModalOpen(false)}>
          <TouchableOpacity style={styles.pickerSheet} activeOpacity={1}>
            <Text style={styles.pickerTitle}>自定义范围（定期）</Text>
            <View style={styles.customRow}>
              <TextInput
                style={styles.customInput}
                value={customStart}
                onChangeText={setCustomStart}
                placeholder="起始日期 YYYY-MM-DD"
                placeholderTextColor={colors.textTertiary}
              />
              <Text style={styles.customSep}>~</Text>
              <TextInput
                style={styles.customInput}
                value={customEnd}
                onChangeText={setCustomEnd}
                placeholder="结束日期 YYYY-MM-DD"
                placeholderTextColor={colors.textTertiary}
              />
            </View>
            <TouchableOpacity style={styles.applyBtn} onPress={applyCustomRange}>
              <Text style={styles.applyBtnText}>应用</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    rangeSwitcher: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 4,
    },
    rangeArrow: { padding: 8 },
    rangeLabel: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
    typePickerBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.summaryCard,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    typePickerBtnText: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
    summaryCard: {
      flexDirection: 'row',
      backgroundColor: colors.card,
      marginHorizontal: 12,
      borderRadius: 12,
      paddingVertical: 11,
      paddingHorizontal: 6,
      marginBottom: 6,
    },
    summaryCol: { flex: 1, alignItems: 'center' },
    summaryDivider: { width: 1, backgroundColor: colors.dividerHair },
    summaryLabel: { fontSize: 11, color: colors.textSecondary },
    summaryValue: { fontSize: 16, fontWeight: '700', marginTop: 4 },
    currencyChipRow: {
      flexDirection: 'row',
      paddingHorizontal: 12,
      marginBottom: 8,
    },
    currencyChip: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 14,
      backgroundColor: colors.summaryCard,
      marginRight: 8,
    },
    currencyChipActive: { backgroundColor: colors.textPrimary },
    currencyChipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
    currencyChipTextActive: { color: colors.bg },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyText: { textAlign: 'center', color: colors.textTertiary, lineHeight: 22 },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: 52,
      paddingHorizontal: 18,
      paddingVertical: 6,
      backgroundColor: colors.bg,
      borderBottomWidth: 1,
      borderBottomColor: colors.dividerHair,
    },
    sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    sectionDate: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    sectionSubDate: { fontSize: 12, color: colors.textTertiary, marginTop: 1 },
    sectionRight: { flexDirection: 'row', alignItems: 'center', marginLeft: 12 },
    dayTotal: { fontSize: 15, fontWeight: '700' },
    sectionChevron: { marginLeft: 8 },
    swipeWrap: { marginHorizontal: 0, marginBottom: 0, overflow: 'hidden' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      paddingHorizontal: 18,
      paddingVertical: 7,
      minHeight: 58,
      borderBottomWidth: 1,
      borderBottomColor: colors.dividerHair,
    },
    // 删除按钮固定用红色（危险操作色），不跟随主题反转，保证两种模式下都足够醒目
    deleteAction: {
      width: 76,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#FF3B30',
    },
    deleteActionText: { color: '#fff', fontSize: 12, fontWeight: '600', marginTop: 2 },
    iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    rowMid: { flex: 1, marginLeft: 10, paddingRight: 6 },
    catName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
    meta: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
    amount: { fontSize: 14, fontWeight: '700' },
    modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
    typeSheet: {
      position: 'absolute',
      top: 90,
      right: 16,
      backgroundColor: colors.card,
      borderRadius: 12,
      paddingVertical: 4,
      width: 120,
      shadowColor: colors.cardShadow,
      shadowOpacity: 1,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    typeSheetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    typeSheetText: { fontSize: 14, color: colors.textSecondary },
    typeSheetTextActive: { fontWeight: '700', color: colors.textPrimary },
    pickerSheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
      paddingBottom: 30,
      maxHeight: '75%',
    },
    pickerTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 16 },
    customLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 16, marginBottom: 8 },
    customRow: { flexDirection: 'row', alignItems: 'center' },
    customInput: {
      flex: 1,
      backgroundColor: colors.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      padding: 10,
      fontSize: 13,
      color: colors.textPrimary,
    },
    customSep: { marginHorizontal: 8, color: colors.textSecondary },
    applyBtn: {
      backgroundColor: colors.fabBg,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 16,
    },
    applyBtnText: { color: colors.fabIcon, fontWeight: '700', fontSize: 14 },
  });
}
