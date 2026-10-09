// AccountPickerSheet.tsx
// 账户选择抽屉（T13 / 计划 A8 抽取）：记一笔页内两处弹层合一 —— 支出/收入的 assetPicker
// 与转账/兑换的 accountPicker 结构、头部、列表、底部按钮完全同款，只有三处小差异用 props 区分：
//   1. selectionMode：single（支出/收入，点即选中并关闭）· role（转账/兑换，由父层决定 toggle 写回 + 排除对方账户）
//   2. balance：display（信用卡显示欠款）· transfer（转出可用余额，跨币种同额）
//   3. anchorDropToHeader：转出/转入的 EN 标题折行会把头部撑高，币种下拉锚到头部实测底缘；
//      支出/收入标题恒单行，沿用固定 top 62
//
// T13 阶段视觉与行为零变化：样式值沿用抽取前页面里的同一组旧令牌值（主题逐页迁移在后续任务做）。
// 挂载即打开（父层条件渲染）—— 面板从屏幕外滑入 + 遮罩淡入的逻辑原来在页面的 effect 里，现随组件走。

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Reanimated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../theme/useTheme';
import { useT } from '../../i18n/LanguageContext';
import { getCurrencyFlag, getCurrencySymbol } from '../../utils/currencies';
import { getAssetDisplayBalance, getAssetTransferBalance } from '../../utils/creditCard';
import { ThemeColors } from '../../theme/theme';

type IconName = keyof typeof Ionicons.glyphMap;

interface Props {
  /** 面板标题（支出/收入：选择账户；转账/兑换：选择转出/转入账户） */
  title: string;
  /** 当前选中账户 id（role 模式传当前角色的 from/to） */
  selectedId: string | null;
  /** 互斥排除的账户 id（role 模式传对方账户） */
  excludeId?: string | null;
  /** 点账户写回；随后由父层关闭弹层（保持既有"点完立即收起"行为） */
  onPickAsset: (assetId: string) => void;
  /** 卡内余额展示口径：display = getAssetDisplayBalance · transfer = getAssetTransferBalance */
  balance: 'display' | 'transfer';
  /** 币种下拉锚到头部实测底缘（转账/兑换的 EN 标题折行场景）；false = 固定 top 62 */
  anchorDropToHeader?: boolean;
  /** 打开即展开币种下拉（从金额卡的币种标签进入的场景） */
  openCurrencyDropOnShow?: boolean;
  /** 金额显示币种（自定义币种列表用：没有账户的全局货币也要能选到） */
  currencyCode: string;
  /** 遮罩 / 关闭键 / 下滑收起 */
  onClose: () => void;
  /** 面板内「添加新账户」：父层负责关闭并跳转 */
  onAddAccount: () => void;
}

export function AccountPickerSheet({
  title,
  selectedId,
  excludeId,
  onPickAsset,
  balance,
  anchorDropToHeader,
  openCurrencyDropOnShow,
  currencyCode,
  onClose,
  onAddAccount,
}: Props) {
  const { assets, getAssetBalance } = useApp();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  // 面板内的临时状态：组件挂载（= 每次打开）时从初始值开始 —— 等价于原来"打开前父层逐一复位"
  const [accountSearch, setAccountSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState<'all' | 'cash' | 'bank' | 'credit' | 'ewallet'>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  const [currencyDropOpen, setCurrencyDropOpen] = useState(!!openCurrencyDropOnShow);
  // 币种分组折叠：反向记录「被收起」的组，默认全展开
  const [pickerCollapsedGroups, setPickerCollapsedGroups] = useState<Set<string>>(new Set());
  const togglePickerGroup = (code: string) => {
    setPickerCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  // 头部实测盒（相对弹层）+ 货币钮实测高：EN 标题折两行会把头部撑高，固定 top 会压住货币钮
  const [headerBox, setHeaderBox] = useState({ y: 0, h: 0 });
  const [pillH, setPillH] = useState(0);

  // 用户已有账户出现过的币种（去重、ABC 字母序），给货币下拉菜单用
  const ownCurrencies = useMemo(() => {
    const codes: string[] = [];
    assets.forEach((a) => {
      if (a.currency && !codes.includes(a.currency)) codes.push(a.currency);
    });
    if (!codes.includes(currencyCode)) codes.push(currencyCode);
    return codes.sort((c1, c2) => c1.localeCompare(c2));
  }, [assets, currencyCode]);

  // 列表滚动偏移：手动经 useAnimatedScrollHandler 写进 sharedValue（UI 线程零延迟）
  const listOffset = useSharedValue(0);
  const listScrollHandler = useAnimatedScrollHandler((e) => {
    listOffset.value = e.contentOffset.y;
  });
  const panY = useSharedValue(900);
  const scrim = useSharedValue(0);
  const dragStart = useSharedValue({ x: 0, y: 0 });
  const closingSV = useSharedValue(false);

  // 入场：面板从屏幕外滑入 + 遮罩淡入（挂载即播）；列表滚动偏移清零——
  // 上次打开时滚到中间残留的话，下滑收起手势会因"列表不在顶部"失灵
  useEffect(() => {
    closingSV.value = false;
    panY.value = 900;
    scrim.value = 0;
    listOffset.value = 0;
    panY.value = withTiming(0, { duration: 260 });
    scrim.value = withTiming(0.4, { duration: 260 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 下滑收起：列表滚到顶部时往下拖 → 接管手势整块面板跟手下移，松手超过 120px / 快速甩动就收起；
  // 列表不在顶部、或往上拖 → 不接管，账户列表照常滚动；从把手/头部下滑永远生效
  const gesture = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e) => {
      const t = e.allTouches[0];
      dragStart.value = { x: t?.absoluteX ?? 0, y: t?.absoluteY ?? 0 };
    })
    .onTouchesMove((e, stateManager) => {
      const t = e.allTouches[0];
      if (!t) return;
      if (listOffset.value > 0) return; // 列表不在顶部：不接管，让它正常滚
      const dy = t.absoluteY - dragStart.value.y;
      const dx = t.absoluteX - dragStart.value.x;
      if (dy > 12 && Math.abs(dy) > Math.abs(dx) * 1.2) stateManager.activate();
    })
    .onUpdate((e) => {
      panY.value = Math.max(0, e.translationY);
      scrim.value = Math.min(0.4, Math.max(0, e.translationY) / 500 + 0.15);
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 800) {
        if (closingSV.value) return;
        closingSV.value = true;
        scrim.value = withTiming(0, { duration: 180 });
        panY.value = withTiming(900, { duration: 220 }, (finished) => {
          if (finished) runOnJS(onClose)();
        });
      } else {
        panY.value = withTiming(0, { duration: 180 });
        scrim.value = withTiming(0.4, { duration: 150 });
      }
    });
  const animStyle = useAnimatedStyle(() => ({ transform: [{ translateY: panY.value }] }), []);
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }), []);

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 90, elevation: 90 }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
        <Reanimated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, scrimStyle]} />
      </Pressable>
      <GestureDetector gesture={gesture}>
        <Reanimated.View style={[styles.accountPickerSheet, animStyle]}>
          <View style={styles.accountPickerGrabber} />
          <View
            style={styles.accountPickerHeader}
            onLayout={
              anchorDropToHeader
                ? (e) => {
                    // 头部盒实测（相对弹层）：币种下拉面板的锚点，头部被 EN 标题折行撑高时跟着下移
                    const { y, height } = e.nativeEvent.layout;
                    if (Math.abs(y - headerBox.y) > 0.5 || Math.abs(height - headerBox.h) > 0.5) {
                      setHeaderBox({ y, h: height });
                    }
                  }
                : undefined
            }
          >
            <View style={{ flexShrink: 1, marginRight: 8 }}>
              <Text style={styles.accountPickerTitle}>{title}</Text>
            </View>
            <View style={styles.accountPickerHeaderRight}>
              {/* 货币直选键：点开"自己已有的币种"下拉，点选直接筛选账户列表。
                  按键文字跟随当前筛选：打开时默认"全部货币"→显示该文案，选了具体币种→显示该代码 */}
              <TouchableOpacity
                style={styles.accountPickerCurrencyBtn}
                activeOpacity={0.75}
                onPress={() => setCurrencyDropOpen((v) => !v)}
                onLayout={
                  anchorDropToHeader
                    ? (e) => {
                        const h = e.nativeEvent.layout.height;
                        if (Math.abs(h - pillH) > 0.5) setPillH(h);
                      }
                    : undefined
                }
              >
                <Text style={styles.accountPickerCurrencyBtnText}>
                  {currencyFilter === 'all' ? t('addTx.allCurrencies') : currencyFilter}
                </Text>
                <Ionicons name={currencyDropOpen ? 'chevron-up' : 'chevron-down'} size={12} color={colors.link} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.accountPickerClose} onPress={onClose}>
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* 币种下拉面板：悬浮在货币按钮正下方（绝对定位不占布局空间），点面板外任意空白处收起；
              只筛选账户列表，不改金额显示币种 */}
          {currencyDropOpen && <Pressable style={styles.currencyDropCatch} onPress={() => setCurrencyDropOpen(false)} />}
          {currencyDropOpen && (
            <View
              style={[
                styles.currencyDropPanel,
                // 锚到货币钮实测底缘（+4 与固定档同距）：EN 标题折行撑高头部时不再压住按钮
                !!anchorDropToHeader &&
                  headerBox.h > 0 &&
                  pillH > 0 && { top: headerBox.y + (headerBox.h + pillH) / 2 + 4 },
              ]}
            >
              <Text style={styles.currencyDropTitle}>{t('addTx.selectCurrency')}</Text>
              <TouchableOpacity
                style={[styles.currencyDropItem, currencyFilter === 'all' && { backgroundColor: colors.link + '14' }]}
                onPress={() => {
                  setCurrencyFilter('all');
                  setCurrencyDropOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.currencyDropItemText,
                    currencyFilter === 'all' && { color: colors.link, fontWeight: '700' },
                  ]}
                >
                  {t('addTx.allCurrencies')}
                </Text>
                {currencyFilter === 'all' && <Ionicons name="checkmark" size={16} color={colors.link} />}
              </TouchableOpacity>
              {ownCurrencies.map((code) => {
                const active = currencyFilter === code;
                return (
                  <TouchableOpacity
                    key={code}
                    style={[styles.currencyDropItem, active && { backgroundColor: colors.link + '14' }]}
                    onPress={() => {
                      setCurrencyFilter(code);
                      setCurrencyDropOpen(false);
                    }}
                  >
                    <Text style={[styles.currencyDropItemText, active && { color: colors.link, fontWeight: '700' }]}>
                      {code}
                    </Text>
                    {active && <Ionicons name="checkmark" size={16} color={colors.link} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <View style={styles.accountSearchBox}>
            <Ionicons name="search-outline" size={16} color={colors.textTertiary} />
            <TextInput
              style={styles.accountSearchInput}
              value={accountSearch}
              onChangeText={setAccountSearch}
              placeholder={t('addTx.searchPlaceholder')}
              placeholderTextColor={colors.textTertiary}
            />
          </View>

          <View style={styles.accountFilterRow}>
            {[
              ['all', t('common.all')],
              ['cash', t('addTx.filterCash')],
              ['bank', t('addTx.filterBank')],
              ['credit', t('addTx.filterCredit')],
              ['ewallet', t('addTx.filterEwallet')],
            ].map(([key, label]) => (
              <TouchableOpacity
                key={key}
                style={[styles.accountFilterChip, accountFilter === key && styles.accountFilterChipActive]}
                onPress={() => setAccountFilter(key as typeof accountFilter)}
              >
                <Text style={[styles.accountFilterText, accountFilter === key && styles.accountFilterTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Reanimated.ScrollView
            onScroll={listScrollHandler}
            style={styles.accountPickerList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {(() => {
              // 资产页同款「一币一大卡」：每货币一张紫渐变大卡（卡头=旗徽+代码+组总额+折叠chevron），
              // 卡内=账户小框；role 模式互相排除对方账户
              const visible = assets.filter((a) => {
                const keyword = accountSearch.trim().toLowerCase();
                const matchSearch = !keyword || `${a.name} ${a.currency} ${a.type}`.toLowerCase().includes(keyword);
                // 币种筛选：下拉里点了 USD 之类后，列表只显示该币种的账户
                const matchCurrency = currencyFilter === 'all' || a.currency === currencyFilter;
                // 分类按账户类型精确匹配（现金/银行卡/信用卡/电子钱包）；投资等其他类型只在"全部"里出现
                const matchFilter = accountFilter === 'all' || a.type === accountFilter;
                // 转账的两个角色互相排除：选转出时不列转入账户，反之亦然
                const matchExclude = !excludeId || a.id !== excludeId;
                return matchSearch && matchCurrency && matchFilter && matchExclude;
              });
              const byCurrency: Record<string, typeof visible> = {};
              visible.forEach((a) => {
                if (!byCurrency[a.currency]) byCurrency[a.currency] = [];
                byCurrency[a.currency].push(a);
              });
              return Object.entries(byCurrency)
                .sort(([c1], [c2]) => c1.localeCompare(c2))
                .map(([code, items]) => {
                  const expanded = !pickerCollapsedGroups.has(code);
                  const groupTotal = items.reduce((sum, a) => sum + getAssetBalance(a.id), 0);
                  const flag = getCurrencyFlag(code);
                  return (
                    <View key={`grp-${code}`} style={styles.accountGroupShadow}>
                      <LinearGradient
                        colors={[colors.netWorthGradientFrom, colors.netWorthGradientTo]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.accountGroupCard}
                      >
                        <TouchableOpacity
                          style={styles.accountGroupHeader}
                          activeOpacity={0.75}
                          onPress={() => togglePickerGroup(code)}
                        >
                          <View style={styles.accountGroupFlag}>
                            <Text style={flag ? styles.accountGroupFlagEmoji : styles.accountGroupFlagText}>
                              {flag ?? getCurrencySymbol(code)}
                            </Text>
                          </View>
                          <Text style={styles.accountGroupCode}>{code}</Text>
                          <Text style={styles.accountGroupTotal}>{groupTotal.toFixed(2)}</Text>
                          <Ionicons
                            name={expanded ? 'chevron-up' : 'chevron-down'}
                            size={16}
                            color={colors.netWorthAccent}
                            style={{ marginLeft: 6 }}
                          />
                        </TouchableOpacity>
                        {expanded && (
                          <View style={styles.accountGroupBody}>
                            {items.map((a) => {
                              const selected = selectedId === a.id;
                              return (
                                <TouchableOpacity
                                  key={a.id}
                                  style={[styles.accountGroupRow, selected && styles.accountGroupRowActive]}
                                  activeOpacity={0.8}
                                  onPress={() => onPickAsset(a.id)}
                                >
                                  <View style={styles.accountGroupRowIcon}>
                                    <Ionicons name={a.icon as IconName} size={20} color={a.color} />
                                  </View>
                                  <View style={styles.accountGroupRowInfo}>
                                    <Text style={styles.accountGroupRowName} numberOfLines={1}>
                                      {a.name}
                                    </Text>
                                    {a.isDefault && <Text style={styles.accountDefaultBadge}>{t('addTx.currentDefault')}</Text>}
                                  </View>
                                  <Text style={styles.accountGroupRowAmount}>
                                    {balance === 'transfer'
                                      ? getAssetTransferBalance(a, getAssetBalance(a.id)).toFixed(2)
                                      : getAssetDisplayBalance(a, getAssetBalance(a.id)).toFixed(2)}
                                  </Text>
                                  {selected && (
                                    <Ionicons name="checkmark-circle" size={18} color={colors.income} style={{ marginLeft: 6 }} />
                                  )}
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        )}
                      </LinearGradient>
                    </View>
                  );
                });
            })()}
          </Reanimated.ScrollView>

          {/* "添加新账户"固定在面板最底部，不随账户列表滚动 */}
          <View style={[styles.accountPickerFooter, { paddingBottom: Math.max(insets.bottom, 20) + 8 }]}>
            <TouchableOpacity style={styles.addAccountPickerBtn} onPress={onAddAccount}>
              <Ionicons name="add-circle-outline" size={18} color={colors.link} />
              <Text style={styles.addAccountPickerText}>{t('addTx.addAccount')}</Text>
            </TouchableOpacity>
          </View>
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
}

/** 令牌进、StyleSheet 出（T13 零视觉变化：沿用抽取前页面里的同一组旧令牌值） */
function makeStyles(colors: ThemeColors, isDark: boolean) {
  return StyleSheet.create({
    accountPickerGrabber: {
      alignSelf: 'center',
      width: 44,
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.divider,
      marginBottom: 10,
    },
    accountPickerSheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.card,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 9,
      height: '82%',
      borderWidth: 1,
      borderColor: colors.dividerHair,
    },
    accountPickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, zIndex: 21 },
    accountPickerHeaderRight: { flexDirection: 'row', alignItems: 'center' },
    accountPickerTitle: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
    accountPickerClose: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
    accountPickerCurrencyBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.link + '14',
      borderWidth: 1,
      borderColor: colors.link + '33',
      borderRadius: 14,
      paddingHorizontal: 9,
      paddingVertical: 5,
      marginRight: 8,
    },
    accountPickerCurrencyBtnText: { fontSize: 12, fontWeight: '700', color: colors.link, marginRight: 2 },
    currencyDropCatch: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 18 },
    currencyDropPanel: {
      position: 'absolute',
      // top: 62 只服务支出/收入弹层（头部恒为单行标题，EN/ZH 实测都对齐）；
      // 转账/兑换弹层头部会被 EN 标题折行撑高，走货币钮实测底缘动态锚定（见 JSX 内联 top）
      top: 62,
      right: 54,
      zIndex: 20,
      backgroundColor: colors.bg,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      paddingVertical: 4,
      minWidth: 150,
      elevation: 6,
    },
    currencyDropTitle: { fontSize: 11, fontWeight: '600', color: colors.textTertiary, paddingHorizontal: 14, paddingVertical: 6 },
    currencyDropItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
    currencyDropItemText: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
    accountSearchBox: {
      height: 42,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      borderRadius: 13,
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.dividerHair,
    },
    accountSearchInput: { flex: 1, fontSize: 12, color: colors.textPrimary, marginLeft: 8, paddingVertical: 0 },
    accountFilterRow: { flexDirection: 'row', marginTop: 10, marginBottom: 8 },
    accountFilterChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.dividerHair, marginRight: 7 },
    accountFilterChipActive: { backgroundColor: colors.fabBg },
    accountFilterText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    accountFilterTextActive: { color: colors.bg },
    accountPickerList: { flex: 1 },
    accountPickerFooter: {
      marginTop: 4,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.dividerHair,
    },
    accountDefaultBadge: { fontSize: 7, fontWeight: '700', color: colors.income, marginLeft: 6, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, backgroundColor: colors.income + '18' },
    // ---------- 账户弹层分组卡（资产页 currencyGroup* 同款）：一币一大卡、卡内小账户框 ----------
    accountGroupShadow: {
      borderRadius: 20,
      shadowColor: '#1B1040',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.16,
      shadowRadius: 20,
      elevation: 5,
      marginBottom: 5,
    },
    accountGroupCard: {
      borderRadius: 20,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.12)',
      overflow: 'hidden',
    },
    accountGroupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    accountGroupFlag: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: 'rgba(255,255,255,0.14)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    accountGroupFlagText: { fontSize: 13, fontWeight: '700', color: colors.netWorthValue },
    accountGroupFlagEmoji: { fontSize: 22, marginTop: -2 },
    accountGroupCode: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.netWorthLabel, marginLeft: 10 },
    accountGroupTotal: { fontSize: 20, fontWeight: '800', color: colors.netWorthValue, marginLeft: 6, fontVariant: ['tabular-nums'] },
    accountGroupBody: {
      paddingHorizontal: 10,
      paddingBottom: 10,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: 'rgba(255,255,255,0.18)',
    },
    accountGroupRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.10)',
      borderRadius: 12,
      paddingVertical: 5,
      paddingHorizontal: 9,
      marginBottom: 3,
    },
    accountGroupRowActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
    accountGroupRowIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: '#FFFFFF',
      alignItems: 'center',
      justifyContent: 'center',
    },
    accountGroupRowInfo: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', marginLeft: 12 },
    accountGroupRowName: { fontSize: 15, fontWeight: '700', color: colors.netWorthValue, flexShrink: 1 },
    accountGroupRowAmount: { fontSize: 16, fontWeight: '700', color: colors.netWorthValue, marginLeft: 8, fontVariant: ['tabular-nums'] },
    addAccountPickerBtn: {
      height: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 14,
      marginTop: 10,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      backgroundColor: colors.bg,
    },
    addAccountPickerText: { fontSize: 14, fontWeight: '700', color: colors.link, marginLeft: 7 },
  });
}

export default AccountPickerSheet;
