import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  Modal,
  Dimensions,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
// 需要先安装：expo install @react-native-community/datetimepicker
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useApp } from '../context/AppContext';
import { TransactionType, Transaction } from '../types';
import { scanReceipt } from '../utils/scanReceipt';
import { getCurrencySymbol } from '../utils/currencies';
import { getAssetDisplayBalance, getAssetTransferBalance } from '../utils/creditCard';
import { useTheme } from '../theme/useTheme';
import { ThemeColors } from '../theme/theme';


type IconName = keyof typeof Ionicons.glyphMap;

// UI 层的四个入口："兑换" 在数据层复用 'transfer' 类型（types.ts 中 TransactionType 只有
// expense/income/transfer 三个值），仅在界面文案和是否强制显示汇率上做区分。
type UiType = 'expense' | 'income' | 'transfer' | 'exchange';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function offsetDateStr(base: string, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 日历选择器回调给的是 Date 对象，转成表单里统一用的 YYYY-MM-DD 字符串
function formatDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Step = 'category' | 'detail' | 'transferDetail';

export default function AddTransactionScreen({ navigation, route }: any) {
  const { categories, addTransaction, updateTransaction, addTransfer, assets, getAssetBalance, currencySymbol } =
    useApp();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme(); // 不传参数！
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const editTransaction: Transaction | undefined = route?.params?.editTransaction;
  const isEditing = !!editTransaction;

  const initialUiType: UiType = editTransaction
    ? (editTransaction.type as UiType)
    : route?.params?.initialType ?? 'expense';
  const presetCategoryId: string | undefined = route?.params?.presetCategoryId;
  const autoScan: boolean = !!route?.params?.autoScan;

  const [uiType, setUiType] = useState<UiType>(initialUiType);
  // 数据层类型：兑换在存储上就是一笔转账
  const type: TransactionType = uiType === 'exchange' ? 'transfer' : uiType;
  const isExchange = uiType === 'exchange';

  // 长按在"资产"页勾选过的默认账户，新增记录时自动带出来（编辑已有记录时不覆盖，还是用那笔记录本来的账户）
  const defaultAsset = assets.find((a) => a.isDefault);

  // 转账/兑换必须先选转出/转入账户，所以从"category"步骤开始；
  // 收入/支出可以直接进详情表单，类别留给用户自己在表单里点"类别"那一行去选。
  const stepForType = (t: UiType): Step => (t === 'transfer' || t === 'exchange' ? 'category' : 'detail');

  const [step, setStep] = useState<Step>(() => {
    if (isEditing) return 'detail';
    return stepForType(initialUiType);
  });
  const [categoryId, setCategoryId] = useState<string | null>(editTransaction?.categoryId ?? null);
  const [amount, setAmount] = useState(editTransaction ? String(editTransaction.amount) : '');
  const [date, setDate] = useState(editTransaction?.date ?? todayStr());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [note, setNote] = useState(editTransaction?.note ?? '');
  const [scanning, setScanning] = useState(false);
  // 凭证：支出/收入详情页里附加的真实单据照片（拍照或从相册选）
  const [receiptUri, setReceiptUri] = useState<string | null>(editTransaction?.receiptUri ?? null);
  const [receiptPreviewOpen, setReceiptPreviewOpen] = useState(false);

  // 普通收支专用：可选的资产账户（这笔钱从/到哪个账户）——没有编辑数据时，用"资产"页设的默认账户
  const [assetId, setAssetId] = useState<string | null>(editTransaction?.assetId ?? defaultAsset?.id ?? null);
  const [assetDropdownOpen, setAssetDropdownOpen] = useState(false);

  // 转账/兑换专用状态——"转出"账户也带默认值（通常就是平时最常用那张），"转入"留给用户自己选
  const [fromAssetId, setFromAssetId] = useState<string | null>(defaultAsset?.id ?? null);
  const [toAssetId, setToAssetId] = useState<string | null>(null);
  const [exchangeRate, setExchangeRate] = useState('1');
  const [fee, setFee] = useState('');

  const filteredCategories = useMemo(
    () => categories.filter((c) => c.type === (type === 'transfer' ? 'expense' : type)),
    [categories, type]
  );

  const selectedCategory = categories.find((c) => c.id === categoryId);
  // 金额输入框的货币符号跟着选的资产账户走；没选账户就用 setting 里的默认货币
  const selectedAsset = assets.find((a) => a.id === assetId);
  const amountCurrencySymbol = selectedAsset ? getCurrencySymbol(selectedAsset.currency) : currencySymbol;
  const fromAsset = assets.find((a) => a.id === fromAssetId);
  const toAsset = assets.find((a) => a.id === toAssetId);
  const isCrossCurrency = !!fromAsset && !!toAsset && fromAsset.currency !== toAsset.currency;
  // 兑换页始终显示汇率输入；普通转账只在跨币种时才显示
  const showRateField = isExchange || isCrossCurrency;

  useEffect(() => {
    if (isEditing && editTransaction?.type === 'transfer') {
      Alert.alert('暂不支持', '转账记录暂时还不能在这里编辑，请先删除后重新记一笔');
      navigation?.goBack();
    }
    if (presetCategoryId) {
      setCategoryId(presetCategoryId);
      setStep('detail');
    }
    if (autoScan) {
      handleScanPress();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetAll = () => {
    setStep(stepForType(uiType));
    setCategoryId(null);
    setAmount('');
    setNote('');
    setDate(todayStr());
    setAssetId(defaultAsset?.id ?? null);
    setAssetDropdownOpen(false);
    setFromAssetId(defaultAsset?.id ?? null);
    setToAssetId(null);
    setExchangeRate('1');
    setFee('');
    setReceiptUri(null);
  };

  // 底部Tab导航默认会把没聚焦的页面状态一直留着（不会卸载重建），
  // 所以"切走再切回来表单清空"这个效果得主动做：监听"离开这个页面"（blur），
  // 一旦离开就立刻重置——这样不管用户是切到别的Tab、还是从"记一笔"跳去创建资产账户，
  // 只要真的离开过这个页面，回来看到的都是干净的新表单。
  // 编辑已有账单（isEditing）时不重置，避免正常编辑流程里出现的跳转（比如点"类别"、"资产"字段）把编辑中的内容清掉。
  useEffect(() => {
    if (!navigation?.addListener) return;
    const unsubscribe = navigation.addListener('blur', () => {
      if (!isEditing) {
        resetAll();
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, isEditing]);

  const handlePickCategory = (id: string) => {
    setCategoryId(id);
    setStep('detail');
  };

  // 支出/收入保存的公共逻辑，返回是否保存成功（校验不过时不弹走）
  const saveTransaction = async () => {
    const value = parseFloat(amount);
    if (!value || value <= 0) {
      Alert.alert('请输入正确的金额');
      return false;
    }
    if (!categoryId) {
      Alert.alert('请选择一个分类');
      return false;
    }
    if (isEditing && editTransaction) {
      await updateTransaction(editTransaction.id, {
        amount: value,
        categoryId,
        type: type as 'expense' | 'income',
        date,
        note,
        assetId: assetId ?? undefined,
        receiptUri: receiptUri ?? undefined,
      });
    } else {
      await addTransaction({
        amount: value,
        categoryId,
        type: type as 'expense' | 'income',
        date,
        note,
        assetId: assetId ?? undefined,
        receiptUri: receiptUri ?? undefined,
      });
    }
    return true;
  };

  const handleSave = async () => {
    const ok = await saveTransaction();
    if (ok) {
      if (isEditing) {
        navigation?.goBack();
      } else {
        resetAll();
        navigation?.navigate('首页');
      }
    }
  };

  // "继续"：保存后留在本页，直接回到选分类步骤，方便连续记多笔（仅新增模式可用）
  const handleSaveAndContinue = async () => {
    const ok = await saveTransaction();
    if (ok) {
      resetAll();
    }
  };

  const handleSaveTransfer = async () => {
    const value = parseFloat(amount);
    if (!value || value <= 0) {
      Alert.alert(isExchange ? '请输入正确的兑换金额' : '请输入正确的转账金额');
      return;
    }
    if (!fromAssetId || !toAssetId) {
      Alert.alert('请选择转出和转入账户');
      return;
    }
    if (fromAssetId === toAssetId) {
      Alert.alert('转出和转入不能是同一个账户');
      return;
    }
    const rate = showRateField ? parseFloat(exchangeRate) : 1;
    if (showRateField && (!rate || rate <= 0)) {
      Alert.alert('请输入正确的汇率');
      return;
    }
    const feeValue = parseFloat(fee) || 0;
    await addTransfer({
      fromAssetId,
      toAssetId,
      amount: value,
      exchangeRate: rate,
      fee: feeValue,
      date,
      note,
    });
    resetAll();
    navigation?.navigate('首页');
  };

  // ---------- 扫描小票 ----------
  const runScan = async (base64: string, uri: string) => {
    setScanning(true);
    try {
      const result = await scanReceipt(base64);
      setUiType(result.type);

      if (result.suggestedCategory) {
        const matched = categories.find((c) => c.type === result.type && c.name === result.suggestedCategory);
        if (matched) setCategoryId(matched.id);
      }
      if (result.amount != null) setAmount(String(result.amount));
      if (result.date) setDate(result.date);
      if (result.merchant) setNote(result.merchant);
      // 扫描用的这张照片本身就是单据，顺手存成凭证，不用用户再拍一次
      setReceiptUri(uri);

      setStep('detail');

      if (result.amount == null) {
        Alert.alert('识别提示', 'AI没能读出金额，麻烦手动填一下');
      }
    } catch (e: any) {
      Alert.alert('识别失败', e?.message ?? '请重试或换一张更清晰的照片');
    } finally {
      setScanning(false);
    }
  };

  const handleScanPress = () => {
    Alert.alert('扫描小票', '选择照片来源', [
      { text: '拍照', onPress: takePhoto },
      { text: '从相册选择', onPress: pickFromLibrary },
      { text: '取消', style: 'cancel' },
    ]);
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('需要相机权限', '请在系统设置里允许本APP使用相机');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6, base64: true });
    if (!result.canceled && result.assets?.[0]?.base64 && result.assets?.[0]?.uri) {
      runScan(result.assets[0].base64, result.assets[0].uri);
    }
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('需要相册权限', '请在系统设置里允许本APP访问照片');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, base64: true });
    if (!result.canceled && result.assets?.[0]?.base64 && result.assets?.[0]?.uri) {
      runScan(result.assets[0].base64, result.assets[0].uri);
    }
  };

  // ---------- 凭证附件：单纯留档用的原始单据照片，不走AI识别 ----------
  const handleAttachReceipt = () => {
    Alert.alert('添加凭证', '选择照片来源', [
      { text: '拍照', onPress: takeReceiptPhoto },
      { text: '从相册选择', onPress: pickReceiptFromLibrary },
      { text: '取消', style: 'cancel' },
    ]);
  };

  const takeReceiptPhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('需要相机权限', '请在系统设置里允许本APP使用相机');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!result.canceled && result.assets?.[0]?.uri) setReceiptUri(result.assets[0].uri);
  };

  const pickReceiptFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('需要相册权限', '请在系统设置里允许本APP访问照片');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
    if (!result.canceled && result.assets?.[0]?.uri) setReceiptUri(result.assets[0].uri);
  };

  if (scanning) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.scanningWrap}>
          <ActivityIndicator size="large" color={colors.icon} />
          <Text style={styles.scanningText}>AI正在识别小票…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // 日历快速选择：Android 弹系统原生对话框（选完/取消都自动关闭）；
  // iOS 用底部弹层包住内嵌日历（iOS的DateTimePicker本身不是浮层，需要自己包一层Modal + "完成"按钮）
  const DatePickerModal = (
    <>
      {Platform.OS === 'android' && datePickerOpen && (
        <DateTimePicker
          value={new Date(`${date}T00:00:00`)}
          mode="date"
          display="default"
          onChange={(event: DateTimePickerEvent, selectedDate?: Date) => {
            setDatePickerOpen(false);
            if (event.type !== 'dismissed' && selectedDate) {
              setDate(formatDate(selectedDate));
            }
          }}
        />
      )}

      {Platform.OS === 'ios' && (
        <Modal
          visible={datePickerOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setDatePickerOpen(false)}
        >
          <TouchableOpacity
            style={styles.datePickerBackdrop}
            activeOpacity={1}
            onPress={() => setDatePickerOpen(false)}
          >
            <TouchableOpacity style={styles.datePickerSheet} activeOpacity={1}>
              <DateTimePicker
                value={new Date(`${date}T00:00:00`)}
                mode="date"
                display="inline"
                onChange={(event: DateTimePickerEvent, selectedDate?: Date) => {
                  if (selectedDate) setDate(formatDate(selectedDate));
                }}
              />
              <TouchableOpacity style={styles.saveBtn} onPress={() => setDatePickerOpen(false)}>
                <Text style={styles.saveBtnText}>完成</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}
    </>
  );

  const TYPE_TABS: { key: UiType; label: string }[] = [
    { key: 'expense', label: '支出' },
    { key: 'income', label: '收入' },
    { key: 'transfer', label: '转账' },
    { key: 'exchange', label: '兑换' },
  ];

  const TypeSwitch = (
    <View style={styles.typeSwitch}>
      {TYPE_TABS.map((t) => (
        <TouchableOpacity
          key={t.key}
          style={[styles.typeBtn, uiType === t.key && styles.typeBtnActive]}
          onPress={() => {
            setUiType(t.key);
            setCategoryId(null);
            setStep(t.key === 'transfer' || t.key === 'exchange' ? 'category' : 'detail');
          }}
        >
          <Text style={[styles.typeText, uiType === t.key && styles.typeTextActive]}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  // ---------- 转账/兑换：选转出/转入账户 ----------
  if (type === 'transfer' && step === 'category') {
    if (assets.length < 2) {
      return (
        <SafeAreaView style={styles.container} edges={['top']}>
          {TypeSwitch}
          <View style={styles.emptyAssetWrap}>
            <Text style={styles.emptyAssetText}>
              {isExchange ? '兑换' : '转账'}需要至少两个资产账户{'\n'}先去"资产"页面创建吧
            </Text>
            <TouchableOpacity style={styles.saveBtn} onPress={() => navigation.navigate('资产')}>
              <Text style={styles.saveBtnText}>去创建资产账户</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.formHeaderRow}>
          <View style={styles.formHeaderSide}>
            <TouchableOpacity onPress={() => navigation?.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-back" size={20} color={colors.icon} />
            </TouchableOpacity>
          </View>
          <Text style={styles.formHeaderTitle}>记一笔</Text>
          <View style={styles.formHeaderSideRight} />
        </View>

        {TypeSwitch}

        {/* 账户列表放在可滚动区域，下面的"下一步"按钮固定在屏幕底部，不会被挤出屏幕 */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 24 }}>
          <Text style={styles.sectionTitle}>从（转出账户）</Text>
          <View style={styles.assetGrid3}>
            {assets.map((a) => (
              <TouchableOpacity
                key={a.id}
                style={[
                  styles.assetOption3,
                  fromAssetId === a.id && { borderColor: a.color, borderWidth: 2 },
                  toAssetId === a.id && styles.assetOptionDisabled,
                ]}
                disabled={toAssetId === a.id}
                onPress={() => setFromAssetId(a.id)}
              >
                <Ionicons name={a.icon as IconName} size={18} color={a.color} />
                <Text style={styles.assetOption3Label} numberOfLines={1} ellipsizeMode="tail">
                  {a.name}
                </Text>
                <Text style={styles.assetOption3Currency} numberOfLines={1} ellipsizeMode="tail">
                  {a.type === 'credit' ? '欠 ' : ''}
                  {getCurrencySymbol(a.currency)}
                  {getAssetTransferBalance(a, getAssetBalance(a.id)).toFixed(2)}
                </Text>
                <Text style={styles.assetOption3Code} numberOfLines={1}>{a.currency}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionTitle}>到（转入账户）</Text>
          <View style={styles.assetGrid3}>
            {assets.map((a) => (
              <TouchableOpacity
                key={a.id}
                style={[
                  styles.assetOption3,
                  toAssetId === a.id && { borderColor: a.color, borderWidth: 2 },
                  fromAssetId === a.id && styles.assetOptionDisabled,
                ]}
                disabled={fromAssetId === a.id}
                onPress={() => setToAssetId(a.id)}
              >
                <Ionicons name={a.icon as IconName} size={18} color={a.color} />
                <Text style={styles.assetOption3Label} numberOfLines={1} ellipsizeMode="tail">
                  {a.name}
                </Text>
                <Text style={styles.assetOption3Currency} numberOfLines={1} ellipsizeMode="tail">
                  {a.type === 'credit' ? '欠 ' : ''}
                  {getCurrencySymbol(a.currency)}
                  {getAssetTransferBalance(a, getAssetBalance(a.id)).toFixed(2)}
                </Text>
                <Text style={styles.assetOption3Code} numberOfLines={1}>{a.currency}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* 固定底部按钮：不管上面账户列表多长，这个按钮永远看得见 */}
        <View style={[styles.stickyFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity
            style={[styles.saveBtn, { marginTop: 0 }, (!fromAssetId || !toAssetId) && { opacity: 0.4 }]}
            disabled={!fromAssetId || !toAssetId}
            onPress={() => setStep('transferDetail')}
          >
            <Text style={styles.saveBtnText}>下一步</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ---------- 转账/兑换：填金额/汇率/手续费 ----------
  if (type === 'transfer' && step === 'transferDetail') {
    const fromSymbol = getCurrencySymbol(fromAsset?.currency ?? 'CNY');
    const toSymbol = getCurrencySymbol(toAsset?.currency ?? 'CNY');
    const rateNum = parseFloat(exchangeRate) || 0;
    const amountNum = parseFloat(amount) || 0;
    const converted = showRateField ? (amountNum * rateNum).toFixed(2) : amountNum.toFixed(2);

    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.formHeaderRow}>
          <View style={styles.formHeaderSide}>
            <TouchableOpacity onPress={() => setStep('category')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-back" size={20} color={colors.icon} />
            </TouchableOpacity>
          </View>
          <Text style={styles.formHeaderTitle}>记一笔</Text>
          <View style={styles.formHeaderSideRight} />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={styles.transferSummary}>
            <View style={styles.transferSummaryRow}>
              <Ionicons name={(fromAsset?.icon as IconName) ?? 'help-outline'} size={16} color={fromAsset?.color ?? colors.textTertiary} />
              <Text style={styles.transferSummaryText}> {fromAsset?.name} </Text>
              <Ionicons name="arrow-forward-outline" size={14} color={colors.textSecondary} />
              <Ionicons name={(toAsset?.icon as IconName) ?? 'help-outline'} size={16} color={toAsset?.color ?? colors.textTertiary} style={{ marginLeft: 6 }} />
              <Text style={styles.transferSummaryText}> {toAsset?.name}</Text>
            </View>
          </View>

          <View style={styles.amountWrap}>
            <Text style={styles.currencySign}>{fromSymbol}</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
          </View>

          {showRateField && (
            <>
              <Text style={styles.sectionTitle}>
                汇率（1 {fromAsset?.currency} = ? {toAsset?.currency}）
              </Text>
              <TextInput
                style={styles.rateInput}
                value={exchangeRate}
                onChangeText={setExchangeRate}
                keyboardType="decimal-pad"
                placeholder="例如：4.7"
                placeholderTextColor={colors.textTertiary}
              />
              <Text style={styles.convertedPreview}>
                对方将收到约 {toSymbol}
                {converted}
              </Text>
            </>
          )}

          <Text style={styles.sectionTitle}>手续费（选填，计入支出，{fromAsset?.currency}）</Text>
          <TextInput
            style={styles.rateInput}
            value={fee}
            onChangeText={setFee}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.textTertiary}
          />

          <Text style={styles.sectionTitle}>日期</Text>
          <View style={styles.dateRow}>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setDate(offsetDateStr(date, -1))}>
              <Text style={styles.dateBtnText}>← 前一天</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setDatePickerOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.dateText}>{date}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setDate(offsetDateStr(date, 1))}>
              <Text style={styles.dateBtnText}>后一天 →</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionTitle}>备注（选填）</Text>
          <TextInput
            style={styles.noteInput}
            value={note}
            onChangeText={setNote}
            placeholder={isExchange ? '例如：机场换汇' : '例如：还信用卡'}
            placeholderTextColor={colors.textTertiary}
          />
        </ScrollView>

        {/* 固定底部按钮 */}
        <View style={[styles.stickyFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity style={[styles.saveBtn, { marginTop: 0 }]} onPress={handleSaveTransfer}>
            <Text style={styles.saveBtnText}>{isExchange ? '保存兑换' : '保存转账'}</Text>
          </TouchableOpacity>
        </View>
        {DatePickerModal}
      </SafeAreaView>
    );
  }

  // ---------- 支出/收入：选分类 ----------
  if (step === 'category') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.formHeaderRow}>
          <View style={styles.formHeaderSide}>
            <TouchableOpacity
              onPress={() => setStep('detail')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back" size={20} color={colors.icon} />
            </TouchableOpacity>
          </View>
          <Text style={styles.formHeaderTitle}>选择类别</Text>
          <View style={styles.formHeaderSideRight} />
        </View>

        {TypeSwitch}

        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={styles.catGrid}>
            {filteredCategories.map((c) => (
              <TouchableOpacity key={c.id} style={styles.catItem} onPress={() => handlePickCategory(c.id)}>
                <View style={[styles.catIconCircle, { backgroundColor: c.color + '22' }]}>
                  <Ionicons name={c.icon as IconName} size={22} color={c.color} />
                </View>
                <Text style={styles.catLabel}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---------- 支出/收入：填详情（卡片行式布局） ----------
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={styles.formHeaderRow}>
          <View style={styles.formHeaderSide}>
            <TouchableOpacity
              onPress={() => navigation?.goBack()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back" size={20} color={colors.icon} />
            </TouchableOpacity>
          </View>
          <Text style={styles.formHeaderTitle}>{isEditing ? '编辑账单' : '记一笔'}</Text>
          <View style={styles.formHeaderSideRight}>
            {!isEditing && (
              <TouchableOpacity style={styles.formHeaderScanBtn} onPress={handleScanPress}>
                <Ionicons name="camera-outline" size={13} color={colors.icon} style={{ marginRight: 3 }} />
                <Text style={styles.formHeaderScanBtnText}>扫一扫</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {!isEditing && TypeSwitch}

        <View style={styles.formCard}>
          {/* 日期 */}
          <View style={styles.formRow}>
            <View style={styles.formRowLeft}>
              <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.formRowLabel}>日期</Text>
            </View>
            <View style={styles.dateStepper}>
              <TouchableOpacity onPress={() => setDate(offsetDateStr(date, -1))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="chevron-back" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setDatePickerOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                <Text style={styles.formRowValue}>{date}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setDate(offsetDateStr(date, 1))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.formDivider} />

          {/* 资产（点击展开选择，帮的号跟货币一起显示） */}
          {assets.length > 0 && (
            <>
              <TouchableOpacity
                style={styles.formRow}
                onPress={() => setAssetDropdownOpen((prev) => !prev)}
                activeOpacity={0.7}
              >
                <View style={styles.formRowLeft}>
                  <Ionicons name="card-outline" size={18} color={colors.textSecondary} />
                  <Text style={styles.formRowLabel}>资产</Text>
                </View>
                <View style={styles.formRowRight}>
                  <Text style={styles.formRowValue}>{selectedAsset ? selectedAsset.name : '未选择'}</Text>
                  <Ionicons
                    name={assetDropdownOpen ? 'chevron-up-outline' : 'chevron-down-outline'}
                    size={16}
                    color={colors.textTertiary}
                  />
                </View>
              </TouchableOpacity>

              {assetDropdownOpen && (
                <View style={styles.assetDropdown}>
                  <TouchableOpacity
                    style={styles.assetDropdownItem}
                    onPress={() => {
                      setAssetId(null);
                      setAssetDropdownOpen(false);
                    }}
                  >
                    <Text style={styles.assetDropdownItemText}>未选择</Text>
                    {assetId === null && <Ionicons name="checkmark" size={16} color={colors.icon} />}
                  </TouchableOpacity>
                  {assets.map((a) => (
                    <TouchableOpacity
                      key={a.id}
                      style={styles.assetDropdownItem}
                      onPress={() => {
                        setAssetId(a.id);
                        setAssetDropdownOpen(false);
                      }}
                    >
                      <View style={styles.formRowLeft}>
                        <Ionicons name={a.icon as IconName} size={16} color={a.color} />
                        <View style={{ marginLeft: 6 }}>
                          <Text style={styles.assetDropdownItemText}>{a.name}</Text>
                          <Text style={styles.assetDropdownItemBalance}>
                            {a.type === 'credit' ? '可用' : '余额'} {getCurrencySymbol(a.currency)}
                            {getAssetDisplayBalance(a, getAssetBalance(a.id)).toFixed(2)}
                          </Text>
                        </View>
                      </View>
                      {assetId === a.id && <Ionicons name="checkmark" size={16} color={colors.icon} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={styles.formDivider} />
            </>
          )}

          {/* 金额（货币符号跟着上面选的资产账户变） */}
          <View style={styles.formRow}>
            <View style={styles.formRowLeft}>
              <Ionicons name="wallet-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.formRowLabel}>金额</Text>
            </View>
            <View style={styles.amountRowRight}>
              <Text style={styles.currencySignSmall}>{amountCurrencySymbol}</Text>
              <TextInput
                style={styles.amountInputInline}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.textTertiary}
                autoFocus
              />
            </View>
          </View>

          <View style={styles.formDivider} />

          {/* 类别（点击回到选分类页） */}
          <TouchableOpacity style={styles.formRow} onPress={() => setStep('category')}>
            <View style={styles.formRowLeft}>
              <View style={[styles.catIconCircleSmall, { backgroundColor: (selectedCategory?.color ?? colors.textTertiary) + '22' }]}>
                <Ionicons name={(selectedCategory?.icon as IconName) ?? 'help-outline'} size={14} color={selectedCategory?.color ?? colors.textTertiary} />
              </View>
              <Text style={styles.formRowLabel}>类别</Text>
            </View>
            <View style={styles.formRowRight}>
              <Text style={styles.formRowValue}>{selectedCategory?.name ?? '未选择'}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </View>
          </TouchableOpacity>

          <View style={styles.formDivider} />

          {/* 内容/备注 */}
          <View style={styles.formRow}>
            <View style={styles.formRowLeft}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.formRowLabel}>内容</Text>
            </View>
            <TextInput
              style={styles.formRowInput}
              value={note}
              onChangeText={setNote}
              placeholder="输入内容（选填）"
              placeholderTextColor={colors.textTertiary}
              textAlign="right"
            />
          </View>

          <View style={styles.formDivider} />

          {/* 凭证：真实单据照片，拍照或从相册选，仅留档不参与AI识别 */}
          {receiptUri ? (
            <View style={styles.formRow}>
              <View style={styles.formRowLeft}>
                <Ionicons name="receipt-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.formRowLabel}>凭证</Text>
              </View>
              <View style={styles.receiptPreviewWrap}>
                <TouchableOpacity
                  onPress={() => setReceiptPreviewOpen(true)}
                  onLongPress={handleAttachReceipt}
                  activeOpacity={0.8}
                >
                  <Image source={{ uri: receiptUri }} style={styles.receiptThumb} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.receiptRemoveBadge}
                  onPress={() => setReceiptUri(null)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.formRow} onPress={handleAttachReceipt} activeOpacity={0.7}>
              <View style={styles.formRowLeft}>
                <Ionicons name="receipt-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.formRowLabel}>凭证</Text>
              </View>
              <View style={styles.formRowRight}>
                <Text style={styles.formRowHint}>拍照/相册（选填）</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </View>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
          <Text style={styles.saveBtnText}>{isEditing ? '保存修改' : '保存'}</Text>
        </TouchableOpacity>
        {!isEditing && (
          <TouchableOpacity style={styles.continueBtn} onPress={handleSaveAndContinue}>
            <Text style={styles.continueBtnText}>保存并继续记一笔</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* 凭证大图预览：点缩略图放大查看整体，长按缩略图可重新拍照/选相册 */}
      <Modal
        visible={receiptPreviewOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setReceiptPreviewOpen(false)}
      >
        <TouchableOpacity
          style={styles.receiptViewerOverlay}
          activeOpacity={1}
          onPress={() => setReceiptPreviewOpen(false)}
        >
          {receiptUri && (
            <Image source={{ uri: receiptUri }} style={styles.receiptViewerImage} resizeMode="contain" />
          )}
          <TouchableOpacity
            style={styles.receiptViewerCloseBtn}
            onPress={() => setReceiptPreviewOpen(false)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={26} color={colors.bg} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      {DatePickerModal}
    </SafeAreaView>

  );
}

// 关键：样式表要写成函数，接收 colors，返回 StyleSheet
function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.card },
  scanningWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanningText: { marginTop: 16, color: colors.textSecondary, fontSize: 14 },
  typeSwitch: { flexDirection: 'row', marginHorizontal: 20, marginTop: 12, marginBottom: 20, backgroundColor: colors.bg, borderRadius: 14, padding: 4 },
  typeBtn: { flex: 1, paddingVertical: 16, borderRadius: 11, alignItems: 'center' },
  typeBtnActive: { backgroundColor: colors.textPrimary },
  typeText: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
  typeTextActive: { color: colors.bg },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 },
  catItem: { width: '25%', alignItems: 'center', marginBottom: 20 },
  catIconCircle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  catLabel: { fontSize: 12, color: colors.textPrimary, marginTop: 6 },
  backRow: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  backText: { color: colors.link, fontSize: 14 },
  selectedCatRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginTop: 8 },
  selectedCatName: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginLeft: 12 },
  amountWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: 28 },
  currencySign: { fontSize: 28, color: colors.textPrimary, marginRight: 4 },
  amountInput: { fontSize: 44, fontWeight: '700', color: colors.textPrimary, minWidth: 120, textAlign: 'center' },
  sectionTitle: { fontSize: 13, color: colors.textSecondary, marginLeft: 20, marginBottom: 8, marginTop: 8 },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 12,
  },
  dateBtn: { padding: 6 },
  dateBtnText: { color: colors.link, fontSize: 13 },
  dateText: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  noteInput: {
    marginHorizontal: 20,
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: colors.textPrimary,
  },
  saveBtn: {
    marginHorizontal: 20,
    marginTop: 28,
    backgroundColor: colors.textPrimary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveBtnText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
  emptyAssetWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyAssetText: { textAlign: 'center', color: colors.textSecondary, marginBottom: 20, lineHeight: 22 },
  assetGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8 },
  assetOption: {
    width: '48%',
    marginBottom: 12,
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 6,
  },
  assetOptionDisabled: { opacity: 0.3 },
  // width: '100%' 是关键——不设的话，文字换行时每一行只会按内容宽度紧贴，
  // textAlign: 'center' 只能让单行看起来居中，一旦数字长到换行，第二行就会看着像贴边一样。
  assetOptionLabel: { fontSize: 13, color: colors.textPrimary, marginTop: 6, textAlign: 'center', width: '100%' },
  assetOptionCurrency: { fontSize: 11, color: colors.textTertiary, marginTop: 4, textAlign: 'center', width: '100%' },

  // ---------- 转账/兑换选账户：一行3个的紧凑卡片 ----------
  assetGrid3: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 4 },
  assetOption3: {
    width: '31%',
    minHeight: 92,
    marginBottom: 10,
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  // numberOfLines={1} + 固定宽度 + 居中：不管名字/金额多长，卡片高度都保持一致，
  // 三张卡片并排时不会因为某一张文字换行而错位、看着"乱"
  assetOption3Label: { fontSize: 12, fontWeight: '600', color: colors.textPrimary, marginTop: 6, textAlign: 'center', width: '100%' },
  assetOption3Currency: { fontSize: 11, color: colors.textSecondary, marginTop: 3, textAlign: 'center', width: '100%' },
  assetOption3Code: { fontSize: 9, color: colors.textTertiary, marginTop: 1, textAlign: 'center', width: '100%' },

  // ---------- 固定在屏幕底部的按钮栏：不随内容滚动，永远看得见 ----------
  stickyFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.dividerHair,
  },

  // ---------- 日历快速选择（iOS用底部弹层包住内嵌日历） ----------
  datePickerBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  datePickerSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
  },

  transferSummary: { paddingHorizontal: 20, marginTop: 16 },
  transferSummaryRow: { flexDirection: 'row', alignItems: 'center' },
  transferSummaryText: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  rateInput: {
    marginHorizontal: 20,
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  convertedPreview: { marginHorizontal: 20, fontSize: 12, color: colors.income, marginTop: 4, marginBottom: 8 },

  // ---------- 支出/收入卡片式表单新增样式 ----------
  formHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 4,
  },
  formHeaderSide: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  formHeaderSideRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  formHeaderTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  formHeaderScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  formHeaderScanBtnText: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
  formCard: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: colors.bg,
    borderRadius: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    overflow: 'hidden',
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  formRowLeft: { flexDirection: 'row', alignItems: 'center' },
  formRowRight: { flexDirection: 'row', alignItems: 'center' },
  formRowLabel: { fontSize: 14, color: colors.textPrimary, marginLeft: 8 },
  formRowValue: { fontSize: 14, color: colors.textPrimary, fontWeight: '600', marginRight: 4 },
  formRowHint: { fontSize: 11, color: colors.textTertiary },
  formRowInput: {
    flex: 1,
    marginLeft: 12,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'right',
  },
  formDivider: { height: 1, backgroundColor: colors.dividerHair },
  dateStepper: { flexDirection: 'row', alignItems: 'center' },
  amountRowRight: { flexDirection: 'row', alignItems: 'center' },
  currencySignSmall: { fontSize: 16, color: colors.textPrimary, marginRight: 4, fontWeight: '600' },
  amountInputInline: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    minWidth: 90,
    textAlign: 'right',
    padding: 0,
  },
  catIconCircleSmall: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  assetDropdown: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    marginBottom: 12,
    overflow: 'hidden',
  },
  assetDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.dividerHair,
  },
  assetDropdownItemText: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
  assetDropdownItemBalance: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  receiptPreviewWrap: { flexDirection: 'row', alignItems: 'center' },
  receiptThumb: { width: 64, height: 64, borderRadius: 10, marginRight: 8, backgroundColor: colors.dividerHair },
  receiptRemoveBadge: { padding: 2 },
  receiptViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptViewerImage: {
    width: Dimensions.get('window').width,
    height: '80%',
  },
  receiptViewerCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
  },
  continueBtn: {
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    paddingVertical: 15,
    alignItems: 'center',
  },
  continueBtnText: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  });
}
