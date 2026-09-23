import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Pressable,
  Keyboard,
  BackHandler,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import Reanimated, { useSharedValue, useAnimatedStyle, useAnimatedScrollHandler, withTiming, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { CURRENCY_OPTIONS, WORLD_CURRENCY_OPTIONS, getCurrencyFlag } from '../utils/currencies';
import { useT } from '../i18n/LanguageContext';
import { AssetType } from '../types';
import { useTheme } from '../theme/useTheme';
import { ThemeColors } from '../theme/theme';
import { AmountCalculatorKeypad } from '../components/AmountCalculatorKeypad';
import { CursorAmountText } from '../components/CursorAmountText';
import PressableScale from '../components/PressableScale';
import { useAmountExpression } from '../hooks/useAmountExpression';
import { useTabBarForceHide } from '../context/TabBarAutoHideContext';
import { hapticSuccess } from '../utils/haptics';

type IconName = keyof typeof Ionicons.glyphMap;

const TYPE_OPTIONS: { type: AssetType; label: string; icon: IconName; color: string }[] = [
  { type: 'cash', label: 'asset.typeCash', icon: 'cash-outline', color: '#66BB6A' },
  { type: 'bank', label: 'asset.typeBank', icon: 'card-outline', color: '#4C9AFF' },
  { type: 'credit', label: 'asset.typeCredit', icon: 'wallet-outline', color: '#EF5350' },
  { type: 'ewallet', label: 'asset.typeEwallet', icon: 'phone-portrait-outline', color: '#26C6DA' },
];

// 计算器键盘当前在给哪个金额字段打字；null = 键盘收起
// （信用卡模式下这个字段就是"信用额度"，现金/银行卡是"起始余额"）
type AmountField = 'balance';

// 底部上拉菜单当前选的是哪一项；null = 收起（type 已改为行下内联下拉，仅 currency 走弹层）
type SheetKind = 'type' | 'currency' | null;

export default function AddAssetScreen({ route }: any) {
  const { addAsset, updateAsset, getAssetById, currency } = useApp();
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const setTabBarForceHidden = useTabBarForceHide();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const t = useT();

  // 编辑模式：route.params.assetId 有值时预填原账户（与新增共用同一表单，保存走 updateAsset）
  const editAsset = route?.params?.assetId ? getAssetById(route.params.assetId) : undefined;
  const isEdit = !!editAsset;

  const [name, setName] = useState(editAsset?.name ?? '');
  const [selectedType, setSelectedType] = useState<AssetType>(editAsset?.type ?? 'cash');
  const [selectedCurrency, setSelectedCurrency] = useState(editAsset?.currency ?? currency);

  // ---------- 金额字段：点一下调出计算器键盘（跟"记一笔"同一套），键盘上直接算 ----------
  // 现金/银行卡填"起始余额"；信用卡填"信用额度"。点"完成"把求值结果落到提交值里并收起键盘
  const balanceExpr = useAmountExpression();
  // 编辑模式预填：信用卡填的是额度（creditLimit），其余是起始余额（initialBalance）
  const [balanceValue, setBalanceValue] = useState(
    editAsset ? (editAsset.type === 'credit' ? editAsset.creditLimit ?? 0 : editAsset.initialBalance) : 0,
  );
  const [amountField, setAmountField] = useState<AmountField | null>(null);
  // 金额格自绘光标（距显示串尾部的偏移，0=最末尾）：按键在光标处生效
  const [balanceCursor, setBalanceCursor] = useState(0);

  // ---------- 自绘键盘与系统键盘的协调 ----------
  // 系统键盘（如账户名称输入框）出现时，自绘键盘让位收起；
  // 系统键盘收起后，只要金额编辑模式还开着（amountField 未清空），自绘键盘自动回到原位。
  // 金额模式本身不受影响：点账户名称打字不会丢掉键盘里未提交的算式，回来接着算。
  const [sysKeyboardVisible, setSysKeyboardVisible] = useState(false);
  useEffect(() => {
    // will/did 两套都挂：iOS 的 will 系列更灵敏，Android 只有 did 系列；
    // 有些设备/收起路径（返回键、点空白）did 事件偶发缺失，双保险避免自绘键盘收不回来
    const show1 = Keyboard.addListener('keyboardWillShow', () => setSysKeyboardVisible(true));
    const show2 = Keyboard.addListener('keyboardDidShow', () => setSysKeyboardVisible(true));
    const hide1 = Keyboard.addListener('keyboardWillHide', () => setSysKeyboardVisible(false));
    const hide2 = Keyboard.addListener('keyboardDidHide', () => setSysKeyboardVisible(false));
    return () => {
      show1.remove();
      show2.remove();
      hide1.remove();
      hide2.remove();
    };
  }, []);

  const openAmountField = () => {
    // 系统键盘可能开着（名称框聚焦中）：无论如何都收掉，并让名称框失焦——
    // 系统光标消失、自绘光标接棒。这两步不能跳过，否则从名称框点回金额区时
    // 系统键盘不收、光标也不切换
    Keyboard.dismiss();
    nameInputRef.current?.blur();
    // 金额模式已开着：只收系统键盘/切换光标，不重置算式
    if (amountField === 'balance') return;
    // 打开键盘即从空态起输：按 5 就是 0.05（分录入法），新输入直接替换旧值
    balanceExpr.reset();
    setBalanceCursor(0);
    setAmountField('balance');
  };

  // 进入页面默认常驻计算器键盘（金额是第一填写项）——用户点其他控件（货币弹层/名称框）时
  // 由各自的让位逻辑收起；关闭菜单/失焦后金额模式仍在，键盘自动回到原位
  useEffect(() => {
    if (isFocused) setAmountField('balance');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitAmountField = () => {
    if (!amountField) return;
    setBalanceValue(balanceExpr.confirm());
    setAmountField(null);
  };

  // 计算器键盘上的 Enter（下一项）箭头已由小数点键取代（标准金额录入）
  const nameInputRef = useRef<TextInput>(null);

  const activeExpr = balanceExpr;

  // ---------- 底部上拉菜单：货币选择用弹层；账户类型用行下内联下拉 ----------
  const [sheetOpen, setSheetOpen] = useState<SheetKind>(null);

  // 底部导航栏在本页【全程隐藏】：添加资产账户是专注填表页（键盘/弹层随时可能出现），
  // 不让 Tab 栏在任何状态下弹出来；离开页面时恢复
  useEffect(() => {
    if (isFocused) setTabBarForceHidden(true);
    return () => setTabBarForceHidden(false);
  }, [isFocused, setTabBarForceHidden]);

  // —— 币种弹层下滑收起手势：与记一笔账户弹层完全同款（manualActivation Pan + sharedValue 动画）——
  // 列表滚到顶部时往下拖 → 接管手势，整块面板跟手下移，松手超 120px / 快速甩动就收起
  const currencySheetPanY = useSharedValue(0);
  const currencySheetScrim = useSharedValue(0);
  const currencyListOffset = useSharedValue(0);
  const currencyListScrollHandler = useAnimatedScrollHandler((e) => {
    currencyListOffset.value = e.contentOffset.y;
  });
  const currencyDragStart = useSharedValue({ x: 0, y: 0 });
  const currencyClosingSV = useSharedValue(false);
  const closeCurrencySheet = () => {
    setSheetOpen(null);
    setCurrencySearch('');
  };
  const currencySheetGesture = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e) => {
      const t = e.allTouches[0];
      currencyDragStart.value = { x: t?.absoluteX ?? 0, y: t?.absoluteY ?? 0 };
    })
    .onTouchesMove((e, stateManager) => {
      const t = e.allTouches[0];
      if (!t) return;
      if (currencyListOffset.value > 0) return; // 列表不在顶部：不接管，让它正常滚
      const dy = t.absoluteY - currencyDragStart.value.y;
      const dx = t.absoluteX - currencyDragStart.value.x;
      if (dy > 12 && Math.abs(dy) > Math.abs(dx) * 1.2) stateManager.activate();
    })
    .onUpdate((e) => {
      currencySheetPanY.value = Math.max(0, e.translationY);
      currencySheetScrim.value = Math.min(0.4, Math.max(0, e.translationY) / 500 + 0.15);
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 800) {
        if (currencyClosingSV.value) return;
        currencyClosingSV.value = true;
        currencySheetScrim.value = withTiming(0, { duration: 180 });
        currencySheetPanY.value = withTiming(900, { duration: 220 }, (finished) => {
          if (finished) runOnJS(closeCurrencySheet)();
        });
      } else {
        currencySheetPanY.value = withTiming(0, { duration: 180 });
        currencySheetScrim.value = withTiming(0.4, { duration: 150 });
      }
    });
  const currencySheetAnimStyle = useAnimatedStyle(() => ({ transform: [{ translateY: currencySheetPanY.value }] }), []);
  const currencySheetScrimStyle = useAnimatedStyle(() => ({ opacity: currencySheetScrim.value }), []);
  // 入场：面板滑入 + 遮罩淡入；列表滚动偏移清零
  useEffect(() => {
    if (sheetOpen === 'currency') {
      currencyClosingSV.value = false;
      currencySheetPanY.value = 900;
      currencySheetScrim.value = 0;
      currencyListOffset.value = 0;
      currencySheetPanY.value = withTiming(0, { duration: 260 });
      currencySheetScrim.value = withTiming(0.4, { duration: 260 });
    }
  }, [sheetOpen, currencySheetPanY, currencySheetScrim, currencyListOffset]);

  // 硬件返回键：币种弹层开着 → 先关弹层（拦截，不退出整页——否则填一半的表单全丢）；
  // 没开弹层时撤掉金额模式（自绘键盘不再随 keyboardDidHide 回弹）再放行返回。
  // return false = 不拦截，导航器照常 pop 本页
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (sheetOpen === 'currency') {
        closeCurrencySheet();
        return true;
      }
      setAmountField(null);
      setSysKeyboardVisible(false);
      return false;
    });
    return () => sub.remove();
  }, [sheetOpen]);

  // 货币搜索：世界货币表 ~150 种，按代码/中文名过滤
  const [currencySearch, setCurrencySearch] = useState('');
  const filteredCurrencies = useMemo(() => {
    const kw = currencySearch.trim().toLowerCase();
    if (!kw) return WORLD_CURRENCY_OPTIONS;
    return WORLD_CURRENCY_OPTIONS.filter(
      (c) => c.code.toLowerCase().includes(kw) || c.name.toLowerCase().includes(kw)
    );
  }, [currencySearch]);

  // ---------- 校验 + 提交（错误直接亮在对应字段上，不打断） ----------
  type ErrorField = 'name';
  const [errors, setErrors] = useState<Partial<Record<ErrorField, string>>>({});
  const clearError = (field: ErrorField) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const handleSave = async (overrideBalance?: number) => {
    const isCredit = selectedType === 'credit';
    const nextErrors: Partial<Record<ErrorField, string>> = {};
    if (!name.trim()) nextErrors.name = t('addTx.enterAccountName');
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});

    // 类型不在 TYPE_OPTIONS 里时（如旧数据的投资/其他类型账户）保持原图标颜色，避免查不到而崩溃
    const typeInfo = TYPE_OPTIONS.find((t) => t.type === selectedType);
    // 信用卡只填"信用额度"：初始余额从 0 开始，填的数字存成 creditLimit；
    // 现金/银行卡填的数字就是初始余额。账单日/还款日/年利率不在此填写
    const bal = overrideBalance ?? balanceValue;

    if (isEdit && editAsset) {
      await updateAsset(editAsset.id, {
        name: name.trim(),
        icon: typeInfo?.icon ?? editAsset.icon,
        color: typeInfo?.color ?? editAsset.color,
        type: selectedType,
        currency: selectedCurrency,
        initialBalance: isCredit ? 0 : bal,
        // 信用额度只属于信用卡：类型从信用卡切走时显式清掉，防止残留
        creditLimit: isCredit ? bal : undefined,
      });
    } else {
      await addAsset({
        name: name.trim(),
        icon: typeInfo!.icon,
        color: typeInfo!.color,
        type: selectedType,
        currency: selectedCurrency,
        initialBalance: isCredit ? 0 : bal,
        ...(isCredit ? { creditLimit: bal } : {}),
      });
    }
    hapticSuccess();
    navigation.goBack();
  };

  // 键盘上的「完成」＝先把当前算式求值落进字段，再直接保存（新增＝创建账户，编辑＝更新账户，与"记一笔"的完成语义一致）
  const handleKeypadConfirm = () => {
    const bal = balanceExpr.confirm();
    setBalanceValue(bal);
    setAmountField(null);
    handleSave(bal);
  };

  // 金额是否多项拆分（15.00+20.00 这类）：多项时字号调小防溢出
  const balanceIsMulti = amountField === 'balance' && balanceExpr.isMulti;

  const selectedTypeInfo = TYPE_OPTIONS.find((opt) => opt.type === selectedType);
  const selectedCurrencyInfo = CURRENCY_OPTIONS.find((c) => c.code === selectedCurrency);

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top']}
      // 点空白处（页面任意非输入区）：收系统键盘 + 名称框失焦——金额模式常驻，
      // 系统键盘一收自绘计算器立刻自动回位（渲染条件只剩 amountField && !sysKeyboardVisible）
      onTouchStart={() => {
        Keyboard.dismiss();
        nameInputRef.current?.blur();
      }}
    >
      {/* 顶栏：返回键（回到资产页）+ 标题，颜色全部跟随明暗主题 */}
      <View style={styles.header}>
        <PressableScale
          style={styles.backBtn}
          activeScale={0.92}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="chevron-back" size={22} color={colors.icon} />
        </PressableScale>
        <Text style={styles.headerTitle}>{t(isEdit ? 'addTx.editAssetTitle' : 'addTx.addAssetTitle')}</Text>
        {isEdit ? (
          // 编辑模式：右上角"保存"。计算器键盘开着时先求值再提交，未确认的算式不丢失
          <PressableScale
            style={styles.headerSaveBtn}
            activeScale={0.95}
            onPress={() => {
              if (amountField) {
                const bal = balanceExpr.confirm();
                setBalanceValue(bal);
                setAmountField(null);
                handleSave(bal);
              } else {
                handleSave();
              }
            }}
          >
            <Text style={styles.headerSaveBtnText}>{t('common.save')}</Text>
          </PressableScale>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {/* 整页表单：所有字段一屏放下；金额框贴着顶栏 */}
      <View style={{ flex: 1, paddingHorizontal: 20, paddingBottom: 24 }}>
        {/* 类型下拉展开时:全屏透明层垫在下方,点击空白任意处收起下拉 */}
        {sheetOpen === 'type' && (
          <Pressable
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 }}
            onPress={() => setSheetOpen(null)}
          />
        )}
        {/* 起始金额：第一焦点。整张卡片都是点按热区（标签、留白也包含在内），
            点一下调出计算器键盘；键盘已开着时再点不会清掉未提交的算式（见 openAmountField 守卫） */}
        <PressableScale
          style={[styles.amountHero, amountField === 'balance' && styles.amountHeroActive]}
          activeScale={0.98}
          onPress={openAmountField}
        >
          <Text style={styles.amountLabel}>
            {selectedType === 'credit' ? t('addTx.creditLimitLabel') : t('addTx.balanceLabel')}
          </Text>
          <View style={styles.amountRow}>
            {/* 货币代码:12 号、固定在 Hero 框最左侧;位置固定不参与压缩 */}
            <Text style={styles.amountCurrency}>{selectedCurrency}</Text>
            {/* 金额可定位光标：金额模式开着时点按/长按拖动可把光标放到任意字符缝隙；
                未开启时点按整格调起计算器键盘（回落 openAmountField） */}
            <CursorAmountText
              containerStyle={styles.amountTextContainer}
              style={[styles.amountText, ...(balanceIsMulti ? [styles.amountTextSmall] : [])]}
              cursorStyle={styles.amountCursor}
              display={amountField === 'balance' ? balanceExpr.displayValue : balanceValue.toFixed(2)}
              enabled={amountField === 'balance' && !sysKeyboardVisible}
              cursorFromEnd={balanceCursor}
              onCursorChange={setBalanceCursor}
              onPress={openAmountField}
            />
          </View>
        </PressableScale>

        {/* 账户名称 / 账户类型：左右 60% / 40%，类型是下拉选择框 */}
        <View style={styles.nameTypeRow}>
          <View style={styles.nameColumn}>
            <Text style={styles.pickerLabel}>
              {t('addTx.accountName')} <Text style={styles.requiredMark}>*</Text>
            </Text>
            <TextInput
              ref={nameInputRef}
              style={[styles.input, errors.name && styles.inputError]}
              value={name}
              onFocus={() => {
                // 名称用系统键盘：聚焦时把开关置位，自绘键盘随即让位收起；
                // 金额模式保持不动——系统键盘收起后（onBlur/keyboard 隐藏事件）自绘键盘自动弹回
                setSysKeyboardVisible(true);
              }}
              onBlur={() => {
                setSysKeyboardVisible(false);
              }}
              onChangeText={(t) => {
                setName(t);
                clearError('name');
              }}
              placeholder={t('addTx.accountNamePlaceholder')}
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.link}
              returnKeyType="done"
            />
            {/* 错误提示：出现时只在名称列下方占一格，不影响右侧"账户类型"下拉框大小 */}
            {!!errors.name && <Text style={styles.errorText}>{errors.name}</Text>}
          </View>

          <View style={styles.typeColumn}>
            <Text style={styles.pickerLabel}>{t('addTx.accountType')}</Text>
            <PressableScale
              style={[styles.selectBox, sheetOpen === 'type' && { borderColor: colors.link }]}
              activeScale={0.98}
              onPress={() => setSheetOpen((prev) => (prev === 'type' ? null : 'type'))}
            >
              <Ionicons name={selectedTypeInfo?.icon ?? 'wallet-outline'} size={16} color={colors.link} />
              <Text style={styles.selectBoxText} numberOfLines={1}>
                {selectedTypeInfo ? t(selectedTypeInfo.label) : selectedType}
              </Text>
              <Ionicons name={sheetOpen === 'type' ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textTertiary} />
            </PressableScale>
            {/* 行下内联下拉：点选择框展开，选完即收起（不再用底部上滑弹层） */}
            {sheetOpen === 'type' && (
              <View style={[styles.inlineDropdown, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                {TYPE_OPTIONS.map((opt) => {
                  const active = selectedType === opt.type;
                  return (
                    <PressableScale
                      key={opt.type}
                      style={styles.inlineDropdownRow}
                      activeScale={0.97}
                      onPress={() => {
                        setSelectedType(opt.type);
                        setSheetOpen(null);
                      }}
                    >
                      <Ionicons name={opt.icon} size={16} color={opt.color} />
                      <Text style={[styles.inlineDropdownText, active && { fontWeight: '700', color: colors.link }]}>
                        {t(opt.label)}
                      </Text>
                      {active && <Ionicons name="checkmark" size={16} color={colors.link} />}
                    </PressableScale>
                  );
                })}
              </View>
            )}
          </View>
        </View>

        {/* 货币：下拉选择框 + 底部上拉菜单（框格比名称/类型行的 40 更矮一档） */}
        <Text style={styles.pickerLabel}>{t('addTx.selectCurrency')}</Text>
        <PressableScale
          style={[styles.selectBox, styles.currencySelectBox, sheetOpen === 'currency' && { borderColor: colors.link }]}
          activeScale={0.98}
          onPress={() => {
            // 同一时间只保留一个输入焦点：收系统键盘 + 名称框失焦（金额模式保留，键盘会自动回位）
            Keyboard.dismiss();
            nameInputRef.current?.blur();
            setCurrencySearch('');
            setSheetOpen('currency');
          }}
        >
          {getCurrencyFlag(selectedCurrency) && <Text style={styles.selectBoxFlag}>{getCurrencyFlag(selectedCurrency)}</Text>}
          <Text style={styles.selectBoxText}>
            {selectedCurrencyInfo ? `${selectedCurrencyInfo.name}（${selectedCurrencyInfo.code}）` : selectedCurrency}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.textTertiary} />
        </PressableScale>

        {/* 底部上拉菜单：货币选择（世界货币表 ~150 种 + 顶部搜索框）。
            树内覆盖层（不用 RN Modal——接不了下滑手势）：遮罩 + GestureDetector 下滑收起，与记一笔账户弹层同款 */}
        {sheetOpen === 'currency' && (
          <View style={[StyleSheet.absoluteFill, { zIndex: 90, elevation: 90 }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeCurrencySheet}>
              <Reanimated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, currencySheetScrimStyle]} />
            </Pressable>
            <GestureDetector gesture={currencySheetGesture}>
              <Reanimated.View style={[styles.sheetCard, currencySheetAnimStyle, { backgroundColor: colors.card, height: '75%' }]}>
              {/* 把手条：下滑收起的视觉提示（点击无功能） */}
              <View style={styles.sheetGrabber} />
              {/* 右上角 ✕ 关闭键 */}
              <PressableScale
                style={styles.sheetClose}
                activeScale={0.90}
                hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                onPress={closeCurrencySheet}
              >
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </PressableScale>
              <Text style={styles.sheetTitle}>{t('addTx.selectCurrency')}</Text>
              {/* 搜索框：样式参考记一笔"选择账户"的搜索框 */}
              <View style={[styles.currencySearchBox, { backgroundColor: colors.bg, borderColor: colors.cardBorder }]}>
                <Ionicons name="search-outline" size={16} color={colors.textTertiary} />
                <TextInput
                  style={[styles.currencySearchInput, { color: colors.textPrimary }]}
                  value={currencySearch}
                  onChangeText={setCurrencySearch}
                  placeholder="搜索货币 / Search currency"
                  placeholderTextColor={colors.textTertiary}
                  autoCorrect={false}
                />
                {!!currencySearch && (
                  <PressableScale onPress={() => setCurrencySearch('')} hitSlop={6} activeScale={0.90}>
                    <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                  </PressableScale>
                )}
              </View>
              {/* 弹性列表：填满 3/4 卡片剩余空间（配合底部安全区内边距） */}
              <View style={{ flex: 1 }}>
                <Reanimated.ScrollView
                  onScroll={currencyListScrollHandler}
                  style={{ flex: 1 }}
                  keyboardShouldPersistTaps="handled"
                >
                  {filteredCurrencies.map((c) => {
                    const active = selectedCurrency === c.code;
                    const flag = getCurrencyFlag(c.code);
                    return (
                      <PressableScale
                        key={c.code}
                        style={[styles.sheetRow, active && { backgroundColor: colors.link + '14' }]}
                        activeScale={0.97}
                        onPress={() => {
                          setSelectedCurrency(c.code);
                          closeCurrencySheet();
                        }}
                      >
                        <Text style={styles.sheetRowName}>
                          {flag ? `${flag} ${c.name}` : c.name}
                        </Text>
                        <Text style={[styles.sheetRowCode, active && { color: colors.link }]}>{c.code}</Text>
                        {active && <Ionicons name="checkmark" size={18} color={colors.link} />}
                      </PressableScale>
                    );
                  })}
                  {filteredCurrencies.length === 0 && (
                    <Text style={[styles.sheetRowName, { textAlign: 'center', paddingVertical: 24, color: colors.textTertiary }]}>
                      {currencySearch ? '未找到匹配的货币' : ''}
                    </Text>
                  )}
                </Reanimated.ScrollView>
              </View>
              {/* 底部安全区留白：手势条不挡列表最后一行 */}
              <View style={{ height: Math.max(insets.bottom, 8) }} />
              </Reanimated.View>
            </GestureDetector>
          </View>
        )}
      </View>

      {/* 计算器键盘：只在点了金额字段时出现；底部用与"记一笔"相同的 stickyFooter 包裹，
          垫高到底部安全区之上，键盘位置/高度与那边完全一致。「完成」＝直接保存。
          系统键盘出现时自绘键盘收起让位，系统键盘收起后自动回到原位（金额模式还在的话） */}
      {/* 自绘计算器常驻规则：金额模式开着 && 没有任何上拉菜单（币种弹层）&& 系统键盘没弹——
          三个条件都满足才显示；菜单关闭后金额模式还在，键盘自动回位 */}
      {amountField && sheetOpen !== 'currency' && !sysKeyboardVisible && (
        <View
          style={[
            styles.keypadFooter,
            // 底部留白与"记一笔"同公式（insets−40，edge-to-edge 下根视图已延伸到导航条后面），
            // 不再垫满 insets——那会在键盘下方多出一条空位
            { paddingBottom: Math.max(insets.bottom - 40, 8), backgroundColor: colors.card, borderTopColor: colors.dividerHair },
          ]}
        >
          <AmountCalculatorKeypad
            onPressKey={(key) => setBalanceCursor(activeExpr.pressKeyAt(key, balanceCursor))}
            onPressToday={() => {}}
            onClear={() => { activeExpr.reset(0); setBalanceCursor(0); }}
            onConfirm={handleKeypadConfirm}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 4,
    },
    // 返回键：与其他页面顶栏返回键同款（40×40 圆环）
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
    headerTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
    headerSpacer: { width: 40 },
    // 编辑模式右上角的"保存"文字按钮（40 宽占位与返回键对称，保持标题居中）
    headerSaveBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerSaveBtnText: { fontSize: 14, fontWeight: '700', color: colors.link },
    amountHero: {
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      alignItems: 'flex-start',
      paddingVertical: 26,
      paddingHorizontal: 20,
      marginBottom: 14,
    },
    amountHeroActive: { borderColor: colors.link },
    amountLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textSecondary,
      marginBottom: 10,
      letterSpacing: 0.3,
    },
    // 金额行固定高度 56：大金额触发等比缩字（minimumFontScale）时行高不变，
    // 整个 Hero 框的尺寸也就恒定——不会随金额位数增减而变高变矮
    amountRow: { flexDirection: 'row', alignItems: 'center', width: '100%', height: 56 },
    // 货币代码:28 号,固定在 Hero 框最左侧;位置固定不参与压缩
    amountCurrency: {
      fontSize: 28,
      fontWeight: '700',
      color: colors.textSecondary,
      marginRight: 8,
    },
    // 金额:右对齐占据货币右侧的全部活动空间,位数超宽等比例缩小(minimumFontScale 0.4),
    // 压缩只发生在金额自己身上,货币的位置/大小永不被挤压
    amountText: {
      flex: 1,
      fontSize: 40,
      fontWeight: '700',
      color: colors.textPrimary,
      fontVariant: ['tabular-nums'],
      textAlign: 'right',
    },
    // 金额文字容器（CursorAmountText 外壳）：占货币右侧全部空间、内容右对齐
    amountTextContainer: { flex: 1, alignItems: 'flex-end' },
    amountTextSmall: { fontSize: 28 },
    // 金额输入光标(内置键盘开着时显示在金额末尾)
    amountCursor: { fontSize: 34, fontWeight: '300', color: colors.link, marginLeft: 2 },
    // 账户名称 / 账户类型：左右 55% / 45%
    nameTypeRow: { flexDirection: 'row', gap: 10, marginBottom: 12, zIndex: 10, elevation: 10 },
    nameColumn: { flex: 55 },
    // zIndex:类型下拉展开时高于全屏透明遮罩层,下拉行不会被遮罩盖住
    typeColumn: { flex: 45, zIndex: 10, elevation: 10 },
    input: {
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      height: 40,
      paddingVertical: 7,
      paddingHorizontal: 12,
      fontSize: 13,
      color: colors.textPrimary,
    },
    inputError: { borderColor: colors.expense, borderWidth: 1.5 },
    requiredMark: { color: colors.expense, fontWeight: '700' },
    // 固定高度：报错文案出现时名称列变高，也不会把类型下拉框拉高（单行固定）
    errorText: { fontSize: 11, color: colors.expense, marginTop: 4, height: 15, lineHeight: 15 },
    pickerLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 },
    // 下拉选择框（账户类型/货币）：固定高度、不参与纵向伸缩——名称列出现报错行时，
    // 右侧类型下拉框保持原尺寸不变（之前带 flex:1 会被拉高变形）
    selectBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      height: 40, // 与"账户名称"输入框同高，视觉对齐
      paddingHorizontal: 12,
    },
    selectBoxFlag: { fontSize: 16 },
    selectBoxText: {
      flex: 1,
      fontSize: 13,
      color: colors.textPrimary,
      fontWeight: '600',
    },
    // 币种选择框：比名称/类型行的 40 再矮一档。
    // flex:0 + alignSelf:stretch —— 之前继承 selectBox 的 flex:1，在页面纵列里被
    // 纵向拉伸成一个大空框（触发框显得超高）；这里显式关掉拉伸、横 向撑满。
    currencySelectBox: { flex: 0, alignSelf: 'stretch', height: 40 },
    // 账户类型:行下内联下拉（替代原底部上滑弹层）
    // 类型下拉:覆盖式浮层——绝对定位悬浮在选择框正下方,盖住下方的货币栏位,
    // 不把货币栏往下挤(展开时页面其他行纹丝不动);zIndex 高于相邻内容
    inlineDropdown: {
      position: 'absolute',
      // 选择框正下方:标签行 ~24px + 选择框 40px,所以 68 起步(贴着框底,不压住框)
      top: 68,
      left: 0,
      right: 0,
      borderRadius: 10,
      borderWidth: 1,
      overflow: 'hidden',
      zIndex: 30,
      elevation: 30,
    },
    inlineDropdownRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 11,
      paddingHorizontal: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.dividerHair,
    },
    inlineDropdownText: { flex: 1, fontSize: 13, color: colors.textPrimary },
    // 货币搜索框:样式参考记一笔"选择账户"的搜索框
    currencySearchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      height: 40,
      borderRadius: 10,
      borderWidth: 1,
      paddingHorizontal: 10,
      marginBottom: 8,
    },
    currencySearchInput: { flex: 1, fontSize: 14 },
    // 底部弹层右上角的 ✕ 关闭键
    sheetClose: {
      position: 'absolute',
      top: 8,
      right: 10,
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 「+」/选择器共用的底部上拉菜单（与设置页底部弹层同款视觉）
    sheetOverlay: {
      flex: 1,
      // 比 colors.overlay 更深：避免弹层上方露出页面里的框格轮廓，看着像被"挡住"
      backgroundColor: 'rgba(0,0,0,0.72)',
      justifyContent: 'flex-end',
    },
    sheetCard: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      // 高度固定 75% 屏（JSX 内联传入），打开即全览 ~150 种货币
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      paddingTop: 12,
      paddingBottom: 8,
      paddingHorizontal: 16,
    },
    sheetGrabber: {
      alignSelf: 'center',
      width: 44,
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.divider,
      marginBottom: 10,
    },
    sheetTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: 8,
      paddingVertical: 8,
    },
    sheetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.dividerHair,
    },
    sheetRowCode: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    sheetRowName: { flex: 1, fontSize: 14, color: colors.textPrimary, marginRight: 12 },
    // 键盘底座：与"记一笔"的 stickyFooter 同规格（左右留白 + 顶部分隔线），
    // 底部安全区 padding 在 JSX 里用 insets 算
    keypadFooter: {
      paddingHorizontal: 0,
      paddingTop: 6,
      borderTopWidth: 1,
    },
  });
}
