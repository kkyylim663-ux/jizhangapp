import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Keyboard,
  PanResponder,
} from 'react-native';
import { BlinkingCursor } from '../components/BlinkingCursor';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { useT } from '../i18n/LanguageContext';
import { useDialog } from '../components/AppDialog';
import { getGroupLabel } from '../i18n/categories';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '../context/AppContext';
import { ROUTES } from '../navigation/routes';
import { getCurrencySymbol, getCurrencyFlag } from '../utils/currencies';
import { getAssetDisplayBalance } from '../utils/creditCard';
import { AssetType } from '../types';
import { useTheme } from '../theme/useTheme';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import { ThemeColors } from '../theme/theme';
import { AmountCalculatorKeypad } from '../components/AmountCalculatorKeypad';
import { useAmountExpression } from '../hooks/useAmountExpression';
import { hapticWarning } from '../utils/haptics';
import PressableScale from '../components/PressableScale';

type IconName = keyof typeof Ionicons.glyphMap;

const TYPE_OPTIONS: { type: AssetType; label: string; icon: IconName; color: string }[] = [
  { type: 'cash', label: '现金', icon: 'cash-outline', color: '#66BB6A' },
  { type: 'bank', label: '银行卡', icon: 'card-outline', color: '#4C9AFF' },
  { type: 'credit', label: '信用卡', icon: 'wallet-outline', color: '#EF5350' },
];

// 用户手动拖拽排出来的账户顺序，按币种分组各自记一份序号，存本地，不动 Asset 数据结构
const ASSET_ORDER_KEY = '@jizhang/assetOrder';

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface CreditStatement {
  currentCycleSpend: number; // 本期（还没结算）已刷金额：本月 1 号到今天
  lastStatementAmount: number; // 上一期已结算账单金额：上个自然月整月
  isOverdue: boolean;
  overdueDays: number;
  estimatedInterest: number;
  available: number; // 可用额度
}

// 信用卡账单的固定标准：每月 1 号结算，结算区间为上一个自然月（1 号到月末）。
// 不使用账户上的账单日/还款日字段；本期已刷 = 本月 1 号到今天（含今天）
function computeCreditStatement(
  asset: { creditLimit?: number; interestRate?: number },
  balance: number,
  spendInRange: (start: Date, end: Date) => number
): CreditStatement | null {
  const today = new Date();
  // 两个结算日：本月 1 号（最近一次）和上月 1 号（上一次）
  const closeDate = new Date(today.getFullYear(), today.getMonth(), 1);
  const prevCloseDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  // 本期区间含今天：结束取到明天 0 点
  const cycleEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

  const currentCycleSpend = spendInRange(closeDate, cycleEnd);
  const lastStatementAmount = spendInRange(prevCloseDate, closeDate);

  const totalOwed = Math.max(0, -balance); // balance 是负数代表欠款
  // 上期账单已出（已进入新月份）仍没还：欠款还覆盖着上期账单金额就视为逾期
  const isOverdue = lastStatementAmount > 0 && totalOwed >= lastStatementAmount;
  const overdueDays = isOverdue ? Math.floor((today.getTime() - closeDate.getTime()) / 86400000) : 0;
  const estimatedInterest =
    isOverdue && asset.interestRate ? lastStatementAmount * (asset.interestRate / 100 / 365) * overdueDays : 0;

  const available = (asset.creditLimit ?? 0) - totalOwed;

  return { currentCycleSpend, lastStatementAmount, isOverdue, overdueDays, estimatedInterest, available };
}


interface AssetFlowStats {
  inflowAmount: number; // 本月流入：收入 + 转入
  inflowCount: number;
  outflowAmount: number; // 本月流出：支出 + 转出（含手续费）
  outflowCount: number;
}

function computeAssetFlowStats(
  assetId: string,
  monthStart: string,
  transactions: {
    type: string;
    assetId?: string;
    fromAssetId?: string;
    toAssetId?: string;
    amount: number;
    fee?: number;
    convertedAmount?: number;
    date: string;
  }[]
): AssetFlowStats {
  let inflowAmount = 0;
  let inflowCount = 0;
  let outflowAmount = 0;
  let outflowCount = 0;
  transactions
    .filter((t) => t.date >= monthStart)
    .forEach((t) => {
      if (t.type === 'income' && t.assetId === assetId) {
        inflowAmount += t.amount;
        inflowCount += 1;
      } else if (t.type === 'expense' && t.assetId === assetId) {
        outflowAmount += t.amount;
        outflowCount += 1;
      } else if (t.type === 'transfer') {
        if (t.toAssetId === assetId) {
          inflowAmount += t.convertedAmount ?? t.amount;
          inflowCount += 1;
        }
        if (t.fromAssetId === assetId) {
          outflowAmount += t.amount + (t.fee ?? 0);
          outflowCount += 1;
        }
      }
    });
  return { inflowAmount, inflowCount, outflowAmount, outflowCount };
}

export default function AssetScreen() {
  const { assets, transactions, getAssetBalance, deleteAsset, setDefaultAsset, updateAsset } = useApp();
  type AssetItem = (typeof assets)[number];
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  // 内容不满一屏时也要能上滑收起 Tab 栏：内容 minHeight 撑到容器高 + 130
  const [viewportH, setViewportH] = useState(0);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const t = useT();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）

  // ---------- "我的账户"：编辑排列模式 / 币种分组折叠 / 自定义拖拽顺序 ----------
  // reorderMode：长按账户卡进入，此时强制展开全部分组改成可拖拽的卡片，右上"完成"退出
  // expandedCurrencies：浏览模式下展开的币种分组（收起时只显示该币种的合并总额）
  // assetOrder：拖拽产生的顺序，只在同一币种分组内比较，不需要跨分组唯一，存本地不动账户数据结构
  const [reorderMode, setReorderMode] = useState(false);
  const [expandedCurrencies, setExpandedCurrencies] = useState<string[]>([]);
  const [assetOrder, setAssetOrder] = useState<Record<string, number>>({});
  const toggleCurrencyGroup = (code: string) => {
    setExpandedCurrencies((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  // 启动时恢复上次保存的拖拽排序
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(ASSET_ORDER_KEY);
        if (raw) setAssetOrder(JSON.parse(raw));
      } catch (e) {
        console.warn('读取账户排序失败', e);
      }
    })();
  }, []);

  const persistAssetOrder = (next: Record<string, number>) => {
    setAssetOrder(next);
    AsyncStorage.setItem(ASSET_ORDER_KEY, JSON.stringify(next)).catch((e) => console.warn('保存账户排序失败', e));
  };

  // 某个币种分组内拖拽结束：按新顺序把 0..n-1 写回该分组这几个账户的 order，
  // 不同分组的编号可以重叠，反正排序比较永远只发生在同一分组内部
  const handleGroupReorder = (groupItems: { id: string }[]) => {
    const next = { ...assetOrder };
    groupItems.forEach((item, index) => {
      next[item.id] = index;
    });
    persistAssetOrder(next);
  };

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

  const handleDelete = (id: string, assetName: string) => {
    dialog.alert({
      title: t('asset.deleteAssetTitle', { name: assetName }),
      message: t('asset.deleteAssetMsg'),
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => { hapticWarning(); deleteAsset(id); } },
      ],
    });
  };

  // ---------- 点击账户查看详情：信用卡看账单周期，银行卡/现金看本月收支流水 ----------
  // 弹窗打开即可直接改：名称是输入框、点金额数字调起计算器键盘，一个"保存"统一提交（无单独编辑模式）
  const [viewingAssetId, setViewingAssetId] = useState<string | null>(null);
  const [viewSetDefault, setViewSetDefault] = useState(false);
  const viewingAsset = assets.find((a) => a.id === viewingAssetId);

  const [viewName, setViewName] = useState('');
  const [viewBalanceStr, setViewBalanceStr] = useState('');
  const [viewKeypadOpen, setViewKeypadOpen] = useState(false);
  const balanceExpr = useAmountExpression();

  // ---------- 当前余额/信用额度：自绘光标（长按拖动定位，按键在光标位置生效） ----------
  const [viewBalanceCursor, setViewBalanceCursor] = useState(0); // 光标距显示串尾部的偏移（0 = 最末尾）
  const viewNameInputRef = useRef<any>(null); // 名称框：切到金额时让它失焦（光标互斥）
  const amountTextRef = useRef<any>(null);
  const amountTextBoxRef = useRef<{ x: number; w: number } | null>(null);
  // 金额文字在窗口里的位置（长按/点按定位光标用）
  const refreshAmountTextBox = () => {
    amountTextRef.current?.measureInWindow((x: number, _y: number, w: number) => {
      amountTextBoxRef.current = { x, w };
    });
  };
  const amountCursorDragRef = useRef(false);
  // 系统键盘高度（名称输入框弹出的那块）：用于和自绘计算器键盘统一"上拉"高度
  const [sysKbH, setSysKbH] = useState(0);
  const [viewKeypadH, setViewKeypadH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      setSysKbH(e.endCoordinates.height);
      // 系统键盘（名称输入）弹出 → 自绘键盘收起（两套键盘互斥协调）
      setViewKeypadOpen(false);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setSysKbH(0);
      // 系统键盘收起 → 自绘键盘显示回来（含 Android 返回键收起键盘的情况）
      setViewKeypadOpen(true);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  // 任一键盘（系统键盘 / 自绘计算器键盘）弹出即视为"编辑中"：弹窗统一切换到顶部对齐
  const viewKeyboardUp = viewKeypadOpen || sysKbH > 0;
  const viewDisplayRef = useRef('');
  viewDisplayRef.current = viewKeypadOpen ? balanceExpr.displayValue : '';
  // 光标在显示串里的下标（渲染切片用）
  const viewCursorIdx = Math.max(
    0,
    Math.min(viewDisplayRef.current.length, viewDisplayRef.current.length - viewBalanceCursor)
  );
  const placeCursorFromTouch = (pageX: number) => {
    const box = amountTextBoxRef.current;
    const display = viewDisplayRef.current;
    if (!box || box.w <= 0 || !display) return;
    const idx = Math.max(0, Math.min(display.length, Math.round((pageX - box.x) / (box.w / display.length))));
    setViewBalanceCursor(display.length - idx);
  };
  const handleViewKeyPress = (key: string) => {
    setViewBalanceCursor(balanceExpr.pressKeyAt(key, viewBalanceCursor));
  };
  const handleAmountBoxPress = (e: any) => {
    if (!viewKeypadOpen) {
      openViewKeypad();
      return;
    }
    placeCursorFromTouch(e.nativeEvent.pageX);
  };
  const handleAmountBoxLongPress = (e: any) => {
    if (!viewKeypadOpen) return;
    amountCursorDragRef.current = true;
    placeCursorFromTouch(e.nativeEvent.pageX);
  };
  const amountCursorPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => amountCursorDragRef.current,
      onPanResponderMove: (_e, g) => placeCursorFromTouch(g.moveX),
      onPanResponderRelease: () => {
        amountCursorDragRef.current = false;
      },
      onPanResponderTerminate: () => {
        amountCursorDragRef.current = false;
      },
    })
  ).current;
  const amountBoxPressProps = {
    onPress: handleAmountBoxPress,
    onLongPress: handleAmountBoxLongPress,
    delayLongPress: 300,
  };

  useEffect(() => {
    if (viewingAssetId) {
      const asset = assets.find((a) => a.id === viewingAssetId);
      if (asset) {
        setViewSetDefault(!!asset.isDefault);
        setViewName(asset.name);
        // 金额字段预填当前值：非信用卡是当前余额（输入"想让当前余额变成的数"），信用卡是信用额度
        setViewBalanceStr(
          String(asset.type === 'credit' ? asset.creditLimit ?? 0 : getAssetBalance(asset.id)),
        );
      }
    }
    setViewKeypadOpen(false);
  }, [viewingAssetId, assets]);

  const openViewKeypad = () => {
    // 名称框的系统键盘/光标退场：一次只允许一个光标显示（点余额/额度 = 切换输入焦点）
    viewNameInputRef.current?.blur();
    // 预填当前数额：光标在末尾，退格逐位修改或长按定位；按 C（清除）才归零重新输入
    balanceExpr.reset(parseFloat(viewBalanceStr) || 0);
    setViewBalanceCursor(0); // 光标从最末尾开始
    setViewKeypadOpen(true);
  };
  // 计算器「完成」：求值落回金额行并直接保存（与"保存"按钮同一效果）
  const handleViewKeypadConfirm = () => {
    const typed = balanceExpr.confirm();
    setViewBalanceStr(String(typed));
    setViewKeypadOpen(false);
    saveViewChanges(typed);
  };

  // 未保存修改检测：名称、余额目标值、默认勾选任一变化即视为脏
  const viewEditDirty =
    !!viewingAsset &&
    (viewName.trim() !== viewingAsset.name ||
      viewSetDefault !== !!viewingAsset.isDefault ||
      (parseFloat(viewBalanceStr) || 0) !==
        (viewingAsset.type === 'credit'
          ? viewingAsset.creditLimit ?? 0
          : getAssetBalance(viewingAsset.id)));

  // 关弹窗：有未保存修改先确认放弃，防误触
  const tryCloseModal = () => {
    if (viewEditDirty) {
      dialog.alert({
        title: t('asset.discardEditTitle'),
        buttons: [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.discard'), style: 'destructive', onPress: () => setViewingAssetId(null) },
        ],
      });
      return;
    }
    setViewingAssetId(null);
  };

  const saveViewChanges = async (overrideBalance?: number) => {
    if (!viewingAsset || !viewName.trim()) return;
    // 自绘键盘还开着：先把屏幕上正在输入的表达式求值落回金额行再保存——
    // 否则这里读到的还是打开键盘前的旧值（"点保存金额不跟着变"的原因）
    let typed = overrideBalance;
    if (typed == null && viewKeypadOpen) {
      typed = balanceExpr.confirm();
      setViewBalanceStr(String(typed));
      setViewBalanceCursor(0);
      setViewKeypadOpen(false);
    }
    typed = typed ?? (parseFloat(viewBalanceStr) || 0);
    if (viewingAsset.type === 'credit') {
      await updateAsset(viewingAsset.id, { name: viewName.trim(), creditLimit: typed });
    } else {
      // 输入的是"想让当前余额变成的数"：差额写回起始余额，保存后当前余额即变为输入值
      const delta = getAssetBalance(viewingAsset.id) - viewingAsset.initialBalance;
      await updateAsset(viewingAsset.id, { name: viewName.trim(), initialBalance: typed - delta });
    }
    // 默认账户勾选随本次保存一并生效；保存后关闭弹窗（列表已是最新数据）
    if (viewSetDefault !== !!viewingAsset.isDefault) {
      await setDefaultAsset(viewSetDefault ? viewingAsset.id : null);
    }
    setViewingAssetId(null);
  };

  const viewingCreditAsset = viewingAsset?.type === 'credit' ? viewingAsset : undefined;

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

  // 银行卡/现金类：本月流入流出（含转账）金额与笔数
  const viewingFlowStats = useMemo(() => {
    if (!viewingAsset || viewingAsset.type === 'credit') return null;
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    return computeAssetFlowStats(viewingAsset.id, monthStart, transactions);
  }, [viewingAsset, transactions]);

  const renderDeleteAction = (id: string, assetName: string) => (
    <TouchableOpacity style={styles.swipeDeleteBtn} onPress={() => handleDelete(id, assetName)}>
      <Ionicons name="trash-outline" size={18} color={colors.fabIcon} />
      <Text style={styles.swipeDeleteText}>{t('common.delete')}</Text>
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
        items: [...items].sort((a, b) => {
          const oa = assetOrder[a.id];
          const ob = assetOrder[b.id];
          // 两边都手动排过序：按拖拽顺序来
          if (oa != null && ob != null) return oa - ob;
          // 只有一边排过序：排过的排在前面，新账户/没拖过的账户排在后面
          if (oa != null) return -1;
          if (ob != null) return 1;
          // 都没排过序：沿用原来"现金/银行卡/信用卡"的默认顺序
          return (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99);
        }),
      }));
  }, [assets, typeOrder, assetOrder]);

  // 排序模式下强制展示全部分组（拖拽需要看到全部账户），浏览模式直接用分组折叠
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={{ flex: 1 }} onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}>
      <ScrollView onScroll={onTabScroll ?? undefined} scrollEventThrottle={16} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: tabClearance, minHeight: viewportH ? viewportH + 130 : undefined }}>
        {liabilitiesByCurrency.length > 0 && (
          <View style={styles.liabilityCard}>
            <Text style={styles.liabilityLabel}>{t('asset.liabilityLabel')}</Text>
            {liabilitiesByCurrency.map(([code, value]) => (
              <Text key={code} style={styles.liabilityValue}>
                {value.toFixed(2)} <Text style={styles.liabilityCode}>{code}</Text>
              </Text>
            ))}
          </View>
        )}

        {/* 标题带上账户总数；右侧常驻"添加账户"，排序模式时换成"完成"退出（排序靠长按账户卡拖动） */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.title}>
            {t('asset.myAccounts')}{assets.length > 0 ? t('asset.accountsCount', { count: assets.length }) : ''}
          </Text>
          {reorderMode ? (
            <PressableScale
              style={styles.headerDoneBtn}
              activeScale={0.92}
              onPress={() => setReorderMode(false)}
            >
              <Text style={styles.headerDoneBtnText}>{t('common.done')}</Text>
            </PressableScale>
          ) : (
            <PressableScale
              style={styles.headerAddBtn}
              activeScale={0.92}
              onPress={() => navigation.navigate(ROUTES.ADD_ASSET)}
            >
              <Ionicons name="add" size={16} color={colors.bg} />
              <Text style={styles.headerAddBtnText}>{t('asset.addAccount')}</Text>
            </PressableScale>
          )}
        </View>

        {assets.length === 0 ? (
          <View style={styles.assetList}>
            <Text style={styles.emptyText}>{t('asset.emptyAssets')}</Text>
          </View>
        ) : reorderMode ? (
          // ---------- 编辑排列模式：每个币种分组各自一个可拖拽列表，长按拖动排序 ----------
          groupedAssets.map((group) => (
            <View key={group.code} style={{ marginBottom: 16 }}>
              <Text style={styles.groupTitle}>{group.code}</Text>
              <DraggableFlatList
                data={group.items}
                scrollEnabled={false}
                keyExtractor={(item) => item.id}
                onDragEnd={({ data }) => handleGroupReorder(data)}
                renderItem={({ item: a, drag, isActive }: RenderItemParams<AssetItem>) => (
                  <ScaleDecorator>
                    <TouchableOpacity
                      style={[styles.assetCardBig, isActive && { opacity: 0.85 }]}
                      activeOpacity={0.8}
                      onLongPress={drag}
                      delayLongPress={150}
                    >
                      <View style={styles.assetCardTopRow}>
                        <View style={[styles.assetIconWrap, { backgroundColor: '#FFFFFF' }]}>
                          <Ionicons name={a.icon as IconName} size={22} color={a.color} />
                        </View>
                        <Text style={[styles.assetName, { flex: 1, marginLeft: 12 }]}>{a.name}</Text>
                        <Ionicons name="reorder-three-outline" size={22} color={colors.textTertiary} />
                      </View>
                    </TouchableOpacity>
                  </ScaleDecorator>
                )}
              />
            </View>
          ))
        ) : (
          // ---------- 正常浏览模式：按币种分组折叠——收起时每张卡显示该币种的合并总额，
          // 点击展开看组内各个账户（账户讯息在分组内合并成一张总额卡） ----------
          groupedAssets.map((group) => {
            const isExpanded = expandedCurrencies.includes(group.code);
            // 同一币种下所有账户的余额合并成组的总额（信用卡按负数计入，欠款另在负债卡汇总）
            const groupTotal = group.items.reduce((sum, a) => sum + getAssetBalance(a.id), 0);
            return (
              <View key={group.code} style={styles.currencyGroupShadow}>
                {/* 货币分组卡：与首页资产总览大卡同款渐变/描边/圆角，日夜间各有一组 token 自动切换 */}
                <LinearGradient
                  colors={[colors.netWorthGradientFrom, colors.netWorthGradientTo]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.currencyGroupCard}
                >
                <PressableScale
                  style={styles.currencyGroupHeader}
                  activeScale={0.98}
                  onPress={() => toggleCurrencyGroup(group.code)}
                >
                  <View style={styles.currencyFlagBadge}>
                    {(() => {
                      const flag = getCurrencyFlag(group.code);
                      return (
                        <Text style={flag ? styles.currencyFlagEmoji : styles.currencyFlagText}>
                          {flag ?? getCurrencySymbol(group.code)}
                        </Text>
                      );
                    })()}
                  </View>
                  <Text style={styles.currencyGroupCode}>{group.code}</Text>
                  <Text style={styles.currencyGroupTotal}>{groupTotal.toFixed(2)}</Text>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.netWorthAccent}
                    style={{ marginLeft: 6 }}
                  />
                </PressableScale>
                {isExpanded && (
                  <View style={styles.currencyGroupBody}>
                    {group.items.map((a) => {
                      return (
                        <Swipeable
                          key={a.id}
                          overshootRight={false}
                          renderRightActions={() => renderDeleteAction(a.id, a.name)}
                        >
                          <PressableScale
                            style={styles.assetRowOnGradient}
                            activeScale={0.97}
                            onPress={() => setViewingAssetId(a.id)}
                            onLongPress={() => setReorderMode(true)}
                          >
                            {/* 卡片只保留三样东西：图标、账户名、金额；点击进详情，长按进排序 */}
                            <View style={styles.assetCardTopRow}>
                              <View style={[styles.assetIconWrap, { backgroundColor: '#FFFFFF' }]}>
                                <Ionicons name={a.icon as IconName} size={22} color={a.color} />
                              </View>
                              <View style={{ flex: 1, marginLeft: 12 }}>
                                {/* 长英文账户名单行截断，不撑高卡片 */}
                                <Text style={styles.assetNameOnGradient} numberOfLines={1}>{a.name}</Text>
                              </View>
                              {(() => {
                                // 信用卡这里显示的是"还能刷多少"（可用额度），不是欠了多少钱——
                                // 欠款已经在上面的"负债"卡片里单独汇总了，这里再显示一遍欠款反而容易看错方向
                                const displayValue = getAssetDisplayBalance(a, getAssetBalance(a.id));
                                return (
                                  <Text style={[styles.assetNameOnGradient, { fontSize: 17 }, a.type === 'credit' && displayValue < 0 && { color: colors.expense }]}>
                                    {a.type === 'credit' && displayValue < 0 ? '-' : ''}
                                    {Math.abs(displayValue).toFixed(2)}
                                  </Text>
                                );
                              })()}
                              <Ionicons name="chevron-forward" size={16} color={colors.netWorthAccent} style={{ marginLeft: 4 }} />
                            </View>
                          </PressableScale>
                        </Swipeable>
                      );
                    })}
                  </View>
                )}
                </LinearGradient>
              </View>
            );
          })
        )}

      </ScrollView>
      </View>

      {/* 账户详情弹窗：信用卡看账单周期，银行卡/现金看本月收支流水 */}
      <Modal visible={!!viewingAssetId} transparent animationType="fade" onRequestClose={tryCloseModal}>
        <TouchableOpacity
          style={[styles.modalOverlay, viewKeyboardUp && styles.modalOverlayTop]}
          activeOpacity={1}
          onPress={tryCloseModal}
        >
          {/* 卡片单独包一层边距：计算器键盘不进这层，保持与记一笔页相同的全宽原样 */}
          {/* 键盘弹出时：边距层 flex:1 占满键盘上方空间，卡片 maxHeight 100% ——
              卡片底部永远紧贴键盘上缘，结构上不可能重叠（不再用像素公式估算） */}
          <View style={[styles.modalSidePadding, viewKeyboardUp && { flex: 1 }]} onStartShouldSetResponder={() => true}>
          <View style={[styles.modalCard, viewKeyboardUp && { maxHeight: '100%' }]}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={viewKeyboardUp ? { paddingBottom: 4 } : undefined}
            >
            {viewingAsset && (
              <>
                {/* 名称：可编辑框格 + 笔图标（为空标红、"保存"不可用） */}
                <View style={[styles.editNameBox, !viewName.trim() && styles.editInputError]}>
                  <TextInput
                    ref={viewNameInputRef}
                    style={styles.editNameInput}
                    value={viewName}
                    onChangeText={setViewName}
                    placeholder={t('addTx.accountNamePlaceholder')}
                    placeholderTextColor={colors.textTertiary}
                    selectionColor={colors.link}
                    returnKeyType="done"
                  />
                  <Ionicons name="pencil" size={15} color={colors.link} />
                </View>

                {/* 信用卡：信用额度框格，点整格调起计算器键盘 */}
                {viewingCreditAsset && (
                  <View {...amountCursorPan.panHandlers}>
                    <TouchableOpacity style={styles.editAmountBox} activeOpacity={0.7} {...amountBoxPressProps}>
                      <Text style={styles.editAmountLabel}>{t('addTx.creditLimitLabel')}</Text>
                      <View style={styles.balanceValueWrap}>
                        <Text style={styles.editAmountValue} ref={amountTextRef} onLayout={refreshAmountTextBox}>
                          {viewKeypadOpen ? (
                            <>
                              <Text>{viewDisplayRef.current.slice(0, viewCursorIdx)}</Text>
                              <BlinkingCursor style={styles.editAmountCursor} />
                              <Text>{viewDisplayRef.current.slice(viewCursorIdx)}</Text>
                            </>
                          ) : (
                            (parseFloat(viewBalanceStr) || 0).toFixed(2)
                          )}
                        </Text>
                        <Text style={styles.editAmountCurrency}>{viewingCreditAsset.currency}</Text>
                      </View>
                      <Ionicons name="pencil" size={15} color={colors.link} />
                    </TouchableOpacity>
                  </View>
                )}

                {/* 当前余额：框格，点整格调起计算器键盘；输入"想让当前余额变成的数"（保存时按差额写回起始余额） */}
                {!viewingCreditAsset && (
                  <View {...amountCursorPan.panHandlers}>
                    <TouchableOpacity style={styles.editAmountBox} activeOpacity={0.7} {...amountBoxPressProps}>
                      <Text style={styles.editAmountLabel}>{t('asset.currentBalance')}</Text>
                      <View style={styles.balanceValueWrap}>
                        <Text style={styles.editAmountValue} ref={amountTextRef} onLayout={refreshAmountTextBox}>
                          {viewKeypadOpen ? (
                            <>
                              <Text>{viewDisplayRef.current.slice(0, viewCursorIdx)}</Text>
                              <BlinkingCursor style={styles.editAmountCursor} />
                              <Text>{viewDisplayRef.current.slice(viewCursorIdx)}</Text>
                            </>
                          ) : (
                            (parseFloat(viewBalanceStr) || 0).toFixed(2)
                          )}
                        </Text>
                        <Text style={styles.editAmountCurrency}>{viewingAsset.currency}</Text>
                      </View>
                      <Ionicons name="pencil" size={15} color={colors.link} />
                    </TouchableOpacity>
                  </View>
                )}

                {viewingCreditAsset ? (
                  !viewingStatement ? (
                    <Text style={styles.emptyText}>{t('asset.noStatement')}</Text>
                  ) : (
                    <>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>{t('asset.availableLimit')}</Text>
                        <Text style={styles.detailValue}>
                          {viewingStatement.available.toFixed(2)} {viewingCreditAsset.currency}
                        </Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>{t('asset.currentSpend')}</Text>
                        <Text style={styles.detailValue}>
                          {viewingStatement.currentCycleSpend.toFixed(2)} {viewingCreditAsset.currency}
                        </Text>
                      </View>
                      <View style={styles.detailDivider} />
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>{t('asset.lastStatement')}</Text>
                        <Text style={styles.detailValue}>
                          {viewingStatement.lastStatementAmount.toFixed(2)} {viewingCreditAsset.currency}
                        </Text>
                      </View>
                      {viewingStatement.isOverdue && viewingStatement.estimatedInterest > 0 && (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>{t('asset.estInterest')}</Text>
                          <Text style={[styles.detailValue, { color: colors.expense }]}>
                            {viewingStatement.estimatedInterest.toFixed(2)} {viewingCreditAsset.currency}
                          </Text>
                        </View>
                      )}
                    </>
                  )
                ) : (
                  viewingFlowStats && (
                    <>
                      <View style={styles.detailDivider} />
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>{t('asset.inflow')}</Text>
                        <Text style={[styles.detailValue, { color: colors.income }]}>
                          +{viewingFlowStats.inflowAmount.toFixed(2)}
                          <Text style={styles.detailLabel}>{t('asset.inflowCount', { count: viewingFlowStats.inflowCount })}</Text>
                        </Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>{t('asset.outflow')}</Text>
                        <Text style={[styles.detailValue, { color: colors.expense }]}>
                          -{viewingFlowStats.outflowAmount.toFixed(2)}
                          <Text style={styles.detailLabel}>{t('asset.inflowCount', { count: viewingFlowStats.outflowCount })}</Text>
                        </Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>{t('asset.netChange')}</Text>
                        <Text
                          style={[
                            styles.detailValue,
                            {
                              color:
                                viewingFlowStats.inflowAmount - viewingFlowStats.outflowAmount >= 0
                                  ? colors.income
                                  : colors.expense,
                            },
                          ]}
                        >
                          {viewingFlowStats.inflowAmount - viewingFlowStats.outflowAmount >= 0 ? '+' : ''}
                          {(viewingFlowStats.inflowAmount - viewingFlowStats.outflowAmount).toFixed(2)}
                        </Text>
                      </View>
                    </>
                  )
                )}

                {/* 设为默认账户：随"保存"一并提交 */}
                <PressableScale
                  style={styles.defaultCheckRow}
                  activeScale={0.97}
                  onPress={() => setViewSetDefault((v) => !v)}
                >
                  <Ionicons
                    name={viewSetDefault ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={viewSetDefault ? colors.textPrimary : colors.textTertiary}
                  />
                  <Text style={styles.defaultCheckLabel}>{t('asset.setDefault')}</Text>
                </PressableScale>

                <PressableScale
                  style={[styles.saveBtn, !viewName.trim() && { opacity: 0.5 }]}
                  activeScale={0.97}
                  onPress={() => saveViewChanges()}
                >
                  <Text style={styles.saveBtnText}>{t('common.save')}</Text>
                </PressableScale>
              </>
            )}
            </ScrollView>
          </View>
          </View>

          {/* 计算器键盘：不进卡片边距层，全宽原样（与记一笔/添加账户页一致）；点金额数字弹出，「完成」＝求值并直接保存 */}
          {viewingAsset && viewKeypadOpen && (
            <View
              style={[
                styles.viewKeypadFooter,
                {
                  paddingBottom: Math.max(insets.bottom, 16),
                  backgroundColor: colors.card,
                  borderTopColor: colors.dividerHair,
                },
              ]}
              onStartShouldSetResponder={() => true}
              onLayout={(e) => setViewKeypadH(e.nativeEvent.layout.height)}
            >
              <AmountCalculatorKeypad
                onPressKey={handleViewKeyPress}
                onPressToday={() => {}}
                onClear={() => {
                  balanceExpr.reset(0);
                  setViewBalanceCursor(0);
                }}
                onConfirm={handleViewKeypadConfirm}
              />
            </View>
          )}
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1 },
    // 币种分组折叠卡：与首页资产总览大卡同款——渐变底 + 半透明白描边 + 投影，
    // 渐变色/文字色走 netWorth* token，日间浅紫、夜间深紫自动切换
    currencyGroupShadow: {
      borderRadius: 20,
      shadowColor: '#1B1040',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.16,
      shadowRadius: 20,
      elevation: 5,
      marginBottom: 5,
    },
    currencyGroupCard: {
      borderRadius: 20,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.12)',
      overflow: 'hidden',
    },
    currencyGroupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    currencyFlagBadge: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: 'rgba(255,255,255,0.14)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    currencyFlagText: { fontSize: 13, fontWeight: '700', color: colors.netWorthValue },
    // 国旗 emoji 稍大一点，撑满圆形徽章
    currencyFlagEmoji: { fontSize: 22, marginTop: -2 },
    currencyGroupCode: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.netWorthLabel, marginLeft: 10 },
    currencyGroupTotal: { fontSize: 20, fontWeight: '800', color: colors.netWorthValue, marginLeft: 6, fontVariant: ['tabular-nums'] },
    currencyGroupBody: { paddingHorizontal: 10, paddingBottom: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.18)', paddingTop: 10 },
    // 展开后叠在渐变卡上的账户行：半透明白底 + 白色系文字（与首页卡内子元素同语言）
    assetRowOnGradient: {
      backgroundColor: 'rgba(255,255,255,0.10)',
      borderRadius: 12,
      paddingVertical: 5,
      paddingHorizontal: 9,
      marginBottom: 3,
    },
    assetNameOnGradient: { fontSize: 15, fontWeight: '700', color: colors.netWorthValue },
    liabilityCard: { backgroundColor: colors.card, borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.expense + '33' },
    liabilityLabel: { fontSize: 12, color: colors.textSecondary, marginBottom: 8 },
    liabilityValue: { fontSize: 20, fontWeight: '700', color: colors.expense, marginBottom: 4 },
    liabilityCode: { fontSize: 12, color: colors.textTertiary, fontWeight: '400' },
    emptyText: { color: colors.textTertiary, fontSize: 13 },
    sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    title: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, flexShrink: 1 },
    // 头部右侧常驻按钮：实心"＋ 添加账户"；排序模式换成"完成"
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
    // 完成按钮：实心紫色，跟"添加账户"同色系，深浅色模式下都够醒目
    headerDoneBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.fabBg,
      borderRadius: 17,
      paddingHorizontal: 16,
      paddingVertical: 8,
      marginLeft: 10,
    },
    headerDoneBtnText: { color: colors.fabIcon, fontSize: 13, fontWeight: '700' },
    saveBtn: { backgroundColor: colors.fabBg, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    saveBtnText: { color: colors.bg, fontWeight: '700', fontSize: 15 },
    groupTitle: { fontSize: 12, color: colors.textTertiary, fontWeight: '600', marginBottom: 8, marginLeft: 4 },
    assetList: { backgroundColor: colors.card, borderRadius: 14, overflow: 'hidden' },
    assetCardBig: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 16,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    assetCardTopRow: { flexDirection: 'row', alignItems: 'center' },
    assetIconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    assetName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    assetBalance: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
    swipeDeleteBtn: {
      backgroundColor: colors.expense,
      justifyContent: 'center',
      alignItems: 'center',
      width: 64,
    },
    swipeDeleteText: { color: colors.fabIcon, fontSize: 11, marginTop: 2, fontWeight: '600' },
    modalOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
    },
    // 卡片单独包的左右边距层：计算器键盘不进这层，保持全宽原样不被压窄
    modalSidePadding: { width: '100%', paddingHorizontal: 20 },
    // 计算器键盘弹出时卡片靠顶，给底部键盘让位
    modalOverlayTop: { justifyContent: 'flex-start', paddingTop: 56 },
    // 弹窗内计算器键盘的底座（与"记一笔"/添加账户页同规格：卡片底色 + 顶部分隔线 + 安全区垫高）
    viewKeypadFooter: { width: '100%', paddingTop: 6, borderTopWidth: 1, marginTop: 'auto' },
    modalCard: { width: '100%', backgroundColor: colors.card, borderRadius: 18, padding: 20 },
    // ---------- 弹窗内行内编辑（与"添加账户"页同视觉：bg 底框格 + 笔图标表示可编辑） ----------
    // 名称框格
    editNameBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.bg,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      height: 48,
      paddingHorizontal: 12,
      marginBottom: 12,
    },
    editNameInput: {
      flex: 1,
      fontSize: 17,
      fontWeight: '700',
      color: colors.textPrimary,
      paddingVertical: 0,
      textAlign: 'center',
    },
    editInputError: { borderColor: colors.expense, borderWidth: 1.5 },
    // 金额框格（当前余额/信用额度）：点整格调起计算器键盘
    editAmountBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.bg,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      height: 48,
      paddingHorizontal: 12,
      marginBottom: 12,
    },
    editAmountLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    balanceValueWrap: { flexDirection: 'row', alignItems: 'baseline', flexShrink: 1 },
    editAmountValue: { fontSize: 17, fontWeight: '800', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    // 自绘光标：与金额同字号、细体、主题紫（BlinkingCursor 组件负责闪烁）
    editAmountCursor: { fontSize: 17, fontWeight: '300', color: colors.link },
    editAmountCurrency: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginLeft: 6 },
    detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9 },
    // 英文文案比中文长 30-60%：label 可收缩、value 不被挤走
    detailLabel: { flex: 1, flexShrink: 1, fontSize: 14, color: colors.textSecondary },
    detailValue: { flexShrink: 1, marginLeft: 12, fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    detailDivider: { height: 1, backgroundColor: colors.dividerHair, marginVertical: 8 },
    defaultCheckRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 16 },
    defaultCheckLabel: { fontSize: 14, color: colors.textPrimary, marginLeft: 8 },
  });
}
