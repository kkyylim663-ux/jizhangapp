/**
 * ReportScreen —— 合并版 v2（对齐真实 theme.ts 字段）
 *
 * 本次修正：
 * 1. 收入/支出金额分栏Tab 顺序调整为「支出在前，收入在后」
 * 2. 全部替换成真实 ThemeColors 字段（之前是猜测字段，chipBg/buttonBg/buttonText/border
 *    在你的 theme.ts 里并不存在，等于 undefined，这就是"定期"弹窗在夜间模式下背景/边框
 *    消失的原因）。字段映射如下：
 *      旧(猜测)       -> 新(真实字段)
 *      colors.border  -> colors.dividerHair （细分隔线/输入框边框）
 *      colors.chipBg  -> colors.summaryCard （周期类型下拉按钮等浅色块背景）
 *      colors.buttonBg   -> colors.fabBg   （主按钮背景，和悬浮记账按钮同一套配色）
 *      colors.buttonText -> colors.fabIcon （主按钮文字色，和fabBg配对）
 * 3. 收支颜色不再用写死常量 EXPENSE_COLOR/INCOME_COLOR，
 *    改成 colors.expense / colors.income —— 因为你的 theme.ts 里这两个颜色
 *    在深色模式下本来就做了微调（更亮一点以保证对比度），写死常量会导致夜间模式下
 *    这两个颜色不跟着变亮，看起来"没反转"。
 * 4. 趋势图的柱子轨道(trendBarTrack)新增 colors.track 底色，避免在深色背景下
 *    看不清柱子的可视范围（这也是主题里专门给进度条轨道准备的字段）。
 * 5. 弹出菜单(typeSheet)的阴影颜色改用 colors.cardShadow —— 浅色模式下是淡阴影，
 *    深色模式下 theme.ts 里定义成 transparent，正好避免深色UI下出现突兀的白色光晕。
 * 6. 分类展开明细的主要信息展示优先级：note（手打备注）> displayName（计划付款名称，
 *    如"房租"，来自 PlannedPayment.name）> "(无备注)" 占位文案。两个字段都没有才算真正
 *    "无备注"，只要 note 或 displayName 任一有值就正常加粗展示。
 */

import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { useTheme } from '../theme/useTheme';
import { ThemeColors } from '../theme/theme';
import DonutChart from '../components/DonutChart';
import { TransactionType, Transaction } from '../types';
import { UNCATEGORIZED_ICON, UNCATEGORIZED_NAME, UNCATEGORIZED_COLOR } from '../constants/uncategorized';
import { getCurrencySymbol } from '../utils/currencies';

type IconName = keyof typeof Ionicons.glyphMap;
type RangeType = 'year' | 'month' | 'week' | 'custom';

const DONUT_SIZE = 180;
const DONUT_STROKE = 26;

const RANGE_TYPE_LABELS: Record<RangeType, string> = {
  year: '年',
  month: '月',
  week: '周',
  custom: '定期',
};

function formatMoney(n: number) {
  return n.toFixed(2);
}

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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

// 圆心为原点，角度从12点方向顺时针算起(跟DonutChart内部 rotate(-90) 的画法保持一致)
function polarPoint(cx: number, cy: number, r: number, angleRad: number) {
  return { x: cx + r * Math.sin(angleRad), y: cy - r * Math.cos(angleRad) };
}

export default function ReportScreen() {
  const { transactions, categories, getAssetById, currency, activeLedgerId } = useApp();
  const { colors } = useTheme(); // 不传参数！
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [type, setType] = useState<TransactionType>('expense');

  const now = new Date();

  const [rangeType, setRangeType] = useState<RangeType>('month');
  const [anchor, setAnchor] = useState(now);
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null);

  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [customStart, setCustomStart] = useState(fmt(now));
  const [customEnd, setCustomEnd] = useState(fmt(now));

  const range = useMemo(() => {
    if (rangeType === 'custom' && customRange) {
      return { start: customRange.start, end: customRange.end, label: `${customRange.start} ~ ${customRange.end}` };
    }
    return buildRange(rangeType === 'custom' ? 'month' : rangeType, anchor);
  }, [rangeType, anchor, customRange]);

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

  const ledgerTransactions = useMemo(
    () => transactions.filter((t) => t.ledgerId === activeLedgerId),
    [transactions, activeLedgerId]
  );

  const rangeTransactions = useMemo(
    () => ledgerTransactions.filter((t) => t.date >= range.start && t.date <= range.end),
    [ledgerTransactions, range]
  );

  // 这笔交易实际用的是哪个货币：优先看关联资产的货币，查不到就退回账本默认货币，不做汇率换算
  const getTransactionCurrency = (t: Transaction): string =>
    (t.assetId ? getAssetById(t.assetId)?.currency : undefined) ?? currency;

  // 按货币分开汇总收入/支出，避免不同货币的金额被直接相加
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

  // 账本默认货币排最前，其余按活跃程度从高到低
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

  const [selectedReportCurrency, setSelectedReportCurrency] = useState(currency);

  useEffect(() => {
    if (!availableCurrencies.includes(selectedReportCurrency)) {
      setSelectedReportCurrency(currency);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableCurrencies]);

  const reportSymbol = getCurrencySymbol(selectedReportCurrency);
  const incomeTotal = currencyBreakdown[selectedReportCurrency]?.income ?? 0;
  const expenseTotal = currencyBreakdown[selectedReportCurrency]?.expense ?? 0;

  const categoryBreakdown = useMemo(() => {
    const totals: Record<string, number> = {};
    rangeTransactions
      .filter((t) => t.type === type && getTransactionCurrency(t) === selectedReportCurrency)
      .forEach((t) => {
        totals[t.categoryId] = (totals[t.categoryId] || 0) + t.amount;
      });
    return Object.entries(totals)
      .map(([categoryId, value]) => {
        const cat = categories.find((c) => c.id === categoryId);
        return {
          categoryId,
          value,
          name: cat?.name ?? UNCATEGORIZED_NAME,
          color: cat?.color ?? UNCATEGORIZED_COLOR,
          icon: (cat?.icon ?? UNCATEGORIZED_ICON) as IconName,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [rangeTransactions, categories, type, selectedReportCurrency]);

  const periodTotal = categoryBreakdown.reduce((s, c) => s + c.value, 0);

  // 最大占比那一块的扇形中点角度，用来把标注线精确指到那块扇形上（跟DonutChart内部同一套算法）
  const topCallout = useMemo(() => {
    if (categoryBreakdown.length === 0 || periodTotal <= 0) return null;
    let cumulative = 0;
    let result: { name: string; pct: number; angle: number } | null = null;
    categoryBreakdown.forEach((c, i) => {
      const fraction = c.value / periodTotal;
      const midFraction = cumulative + fraction / 2;
      cumulative += fraction;
      if (i === 0) {
        result = { name: c.name, pct: fraction * 100, angle: midFraction * 2 * Math.PI };
      }
    });
    return result;
  }, [categoryBreakdown, periodTotal]);

  const calloutGeometry = useMemo(() => {
    if (!topCallout) return null;
    const cx = DONUT_SIZE / 2;
    const cy = DONUT_SIZE / 2;
    const rOuter = (DONUT_SIZE - DONUT_STROKE) / 2 + DONUT_STROKE / 2;
    const p1 = polarPoint(cx, cy, rOuter, topCallout.angle);
    const p2 = polarPoint(cx, cy, rOuter + 22, topCallout.angle);
    const pointsRight = p2.x >= cx;
    const pointsDown = p2.y >= cy;
    return { p1, p2, pointsRight, pointsDown };
  }, [topCallout]);

  // 分类展开：点某个分类，显示这段时间里这个分类下的每一笔明细（以 note 为主要展示信息）
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);

  const categoryItems = (categoryId: string): Transaction[] =>
    rangeTransactions
      .filter(
        (t) => t.type === type && t.categoryId === categoryId && getTransactionCurrency(t) === selectedReportCurrency
      )
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));

  const typeLabel = type === 'expense' ? '支出' : '收入';
  // 收支语义色直接读主题，深色模式下会自动换成 theme.ts 里定义的更亮版本
  const typeColor = type === 'expense' ? colors.expense : colors.income;

  // ---------- 近6个月趋势：保留自 Report Screen 1，颜色跟随类型（支出橙/收入蓝，来自主题） ----------
  const trend = useMemo(() => {
    const months: { key: string; label: string; value: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(d);
      const value = ledgerTransactions
        .filter((t) => t.type === type && t.date.startsWith(key) && getTransactionCurrency(t) === selectedReportCurrency)
        .reduce((s, t) => s + t.amount, 0);
      months.push({ key, label: `${d.getMonth() + 1}月`, value });
    }
    return months;
  }, [ledgerTransactions, type, selectedReportCurrency]);

  // 按"6个月总量"分配每根柱子的高度占比（7月4000+8月1000=5000时，7月占80%高度、8月占20%），
  // 而不是拿每个月去跟"6个月里最大的那个月"比——那样最大月份会固定站满100%，看不出真实占比份额
  const trendTotal = trend.reduce((s, m) => s + m.value, 0);
  const trendColor = typeColor;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
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

      {/* 多币种切换：这段时间里出现不止一种货币时才显示，点哪个整页就换成看哪个（不做汇率换算） */}
      {availableCurrencies.length > 1 && (
        <View style={styles.currencyChipRow}>
          {availableCurrencies.map((code) => (
            <TouchableOpacity
              key={code}
              style={[styles.currencyChip, selectedReportCurrency === code && styles.currencyChipActive]}
              onPress={() => setSelectedReportCurrency(code)}
            >
              <Text
                style={[styles.currencyChipText, selectedReportCurrency === code && styles.currencyChipTextActive]}
              >
                {code}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* 收支Tab顺序：支出在前，收入在后 */}
      <View style={styles.amountTabs}>
        <TouchableOpacity style={styles.amountTab} onPress={() => setType('expense')}>
          <Text style={[styles.amountTabText, type === 'expense' && { color: colors.expense, fontWeight: '700' }]}>
            支出 {reportSymbol}{formatMoney(expenseTotal)}
          </Text>
          {type === 'expense' && <View style={[styles.amountTabUnderline, { backgroundColor: colors.expense }]} />}
        </TouchableOpacity>
        <TouchableOpacity style={styles.amountTab} onPress={() => setType('income')}>
          <Text style={[styles.amountTabText, type === 'income' && { color: colors.income, fontWeight: '700' }]}>
            收入 {reportSymbol}{formatMoney(incomeTotal)}
          </Text>
          {type === 'income' && <View style={[styles.amountTabUnderline, { backgroundColor: colors.income }]} />}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {categoryBreakdown.length === 0 ? (
          <Text style={styles.emptyText}>这段时间还没有{typeLabel}记录</Text>
        ) : (
          <View style={styles.donutWrap}>
            <View style={{ width: DONUT_SIZE, height: DONUT_SIZE }}>
              <DonutChart
                data={categoryBreakdown.map((c) => ({ value: c.value, color: c.color }))}
                size={DONUT_SIZE}
                strokeWidth={DONUT_STROKE}
              />
              {calloutGeometry && topCallout && (
                <>
                  <Svg width={DONUT_SIZE} height={DONUT_SIZE} style={{ position: 'absolute', top: 0, left: 0 }}>
                    <Line
                      x1={calloutGeometry.p1.x}
                      y1={calloutGeometry.p1.y}
                      x2={calloutGeometry.p2.x}
                      y2={calloutGeometry.p2.y}
                      stroke={colors.textTertiary}
                      strokeWidth={1}
                    />
                  </Svg>
                  <View
                    style={{
                      position: 'absolute',
                      left: calloutGeometry.pointsRight ? calloutGeometry.p2.x : undefined,
                      right: calloutGeometry.pointsRight ? undefined : DONUT_SIZE - calloutGeometry.p2.x,
                      top: calloutGeometry.pointsDown ? calloutGeometry.p2.y : calloutGeometry.p2.y - 34,
                      alignItems: calloutGeometry.pointsRight ? 'flex-start' : 'flex-end',
                    }}
                  >
                    <Text style={styles.calloutName}>{topCallout.name}</Text>
                    <Text style={styles.calloutPct}>{topCallout.pct.toFixed(1)} %</Text>
                  </View>
                </>
              )}
            </View>
          </View>
        )}

        {categoryBreakdown.map((c) => {
          const pct = periodTotal > 0 ? (c.value / periodTotal) * 100 : 0;
          const expanded = expandedCategoryId === c.categoryId;
          const items = expanded ? categoryItems(c.categoryId) : [];
          return (
            <View key={c.categoryId}>
              <TouchableOpacity
                style={styles.breakdownRow}
                activeOpacity={0.6}
                onPress={() => setExpandedCategoryId(expanded ? null : c.categoryId)}
              >
                <View style={[styles.pctBadge, { backgroundColor: c.color + '22' }]}>
                  <Text style={[styles.pctBadgeText, { color: c.color }]}>{pct.toFixed(0)}%</Text>
                </View>
                <View style={[styles.breakdownIconWrap, { backgroundColor: c.color + '22' }]}>
                  <Ionicons name={c.icon} size={16} color={c.color} />
                </View>
                <Text style={styles.breakdownName}>{c.name}</Text>
                <Text style={styles.breakdownValue}>{reportSymbol}{formatMoney(c.value)}</Text>
                <Ionicons
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={colors.textTertiary}
                  style={{ marginLeft: 6 }}
                />
              </TouchableOpacity>

              {expanded && (
                <View style={styles.itemList}>
                  {items.length === 0 ? (
                    <Text style={styles.itemEmpty}>没有明细</Text>
                  ) : (
                    items.map((t) => {
                      const asset = t.assetId ? getAssetById(t.assetId) : undefined;
                      // 主要信息展示优先级：note（手打备注）> displayName（计划付款名称，如"房租"）> 占位文案
                      const hasNote = !!t.note?.trim();
                      const hasDisplayName = !hasNote && !!t.displayName?.trim();
                      const primaryText = hasNote
                        ? t.note!.trim()
                        : hasDisplayName
                        ? t.displayName!.trim()
                        : '(无备注)';
                      const isPlaceholder = !hasNote && !hasDisplayName;
                      return (
                        <View key={t.id} style={styles.itemRow}>
                          <View style={{ flex: 1, marginRight: 10 }}>
                            {/* 主要信息：note 优先，其次 displayName，都没有才是占位文案 */}
                            <Text
                              style={[styles.itemNote, isPlaceholder && styles.itemNotePlaceholder]}
                              numberOfLines={1}
                            >
                              {primaryText}
                            </Text>
                            {/* 次要信息：日期 + 资产 */}
                            <Text style={styles.itemMeta} numberOfLines={1}>
                              {t.date}{asset ? `  ·  ${asset.name}` : ''}
                            </Text>
                          </View>
                          <Text style={[styles.itemAmount, { color: typeColor }]}>
                            {type === 'expense' ? '-' : '+'}{reportSymbol}{formatMoney(t.amount)}
                          </Text>
                        </View>
                      );
                    })
                  )}
                </View>
              )}
            </View>
          );
        })}

        {/* 近6个月趋势：保留自 Report Screen 1，颜色跟随类型（读主题）；
            柱子高度按"占6个月总量的百分比"分配，不是跟最大月份比 */}
        <Text style={[styles.title, { marginTop: 32 }]}>近6个月{typeLabel}趋势</Text>
        <View style={styles.trendChart}>
          {trend.map((m) => {
            const sharePct = trendTotal > 0 ? (m.value / trendTotal) * 100 : 0;
            return (
              <View key={m.key} style={styles.trendCol}>
                <View style={styles.trendBarTrack}>
                  <View
                    style={[
                      styles.trendBarFill,
                      { height: `${sharePct}%`, backgroundColor: trendColor },
                    ]}
                  />
                </View>
                <Text style={styles.trendLabel}>{m.label}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

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

// 关键：样式表要写成函数，接收 colors，返回 StyleSheet
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
    currencyChipRow: {
      flexDirection: 'row',
      paddingHorizontal: 12,
      marginBottom: 4,
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
    amountTabs: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: colors.dividerHair,
    },
    amountTab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
    amountTabText: { fontSize: 13, color: colors.textSecondary },
    amountTabUnderline: { height: 2, width: '60%', marginTop: 8, borderRadius: 1 },
    title: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, marginBottom: 16 },
    emptyText: { color: colors.textTertiary, marginTop: 40, textAlign: 'center' },
    donutWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 40, marginTop: 12 },
    calloutName: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
    calloutPct: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
    breakdownRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    pctBadge: {
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 3,
      marginRight: 10,
      minWidth: 40,
      alignItems: 'center',
    },
    pctBadgeText: { fontSize: 11, fontWeight: '700' },
    breakdownIconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
    breakdownName: { flex: 1, fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
    breakdownValue: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
    itemList: { backgroundColor: colors.card, borderRadius: 10, marginBottom: 8, paddingHorizontal: 12 },
    itemEmpty: { fontSize: 12, color: colors.textTertiary, paddingVertical: 10 },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.dividerHair,
    },
    // 主要信息：note，加粗、字号稍大，是这一行的视觉重点
    itemNote: { fontSize: 14, color: colors.textPrimary, fontWeight: '700' },
    // 没有备注时的占位样式：斜体+浅色，明确区分"真实备注"和"占位提示"
    itemNotePlaceholder: { fontStyle: 'italic', fontWeight: '400', color: colors.textTertiary },
    // 次要信息：日期 + 资产，小字浅色
    itemMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 3 },
    itemAmount: { fontSize: 13, fontWeight: '700' },
    trendChart: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      height: 140,
      marginTop: 8,
    },
    trendCol: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
    // 轨道底色用 colors.track，深色模式下也能看清柱子的可视范围
    trendBarTrack: {
      width: 22,
      height: '85%',
      justifyContent: 'flex-end',
      backgroundColor: colors.track,
      borderRadius: 6,
      overflow: 'hidden',
    },
    trendBarFill: { width: 22, borderRadius: 6, minHeight: 2 },
    trendLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 6 },
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
    },
    pickerTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 16 },
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
