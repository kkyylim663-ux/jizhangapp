// AmountCalculatorKeypad.tsx
// 自绘金额计算器键盘（记一笔 / 资产 / 计划 / 预算面板共用）。
//
// UI V2（2026-10-10，稿 G_Add.dc.html / G_AddLight.dc.html）：
//   - 面板：夜 #121219 / 日 #FFF（semantic.keypadPanel）+ 顶部 30 圆角 + 顶部细亮线；
//   - 按键无边框（数字 28/400，C 22/次要色）；右列 = 退格 / 日期键（surfaceSunken 底）/
//     「完成」占 2 行 = accent 渐变 + 白字 19/600 +「长按连续记」11；
//   - 备注行：surfaceSunken 胶囊（高 42，笔图标 + 输入）+ 42 圆收据按钮。
//
// 行为一律未变：键高仍按版型（useLayout().keypadKeyHeight）、退格长按连删、完成/长按完成、
// 震动分级、日期键打开日期选择、备注与小票的读写路径全部原样。

import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useT, useLanguage } from '../i18n/LanguageContext';
import { PRESS_TRANSITION } from './PressableScale';
import { hapticLight, hapticSelection } from '../utils/haptics';
import { formatDate } from '../utils/formatDate';

interface AmountCalculatorKeypadProps {
  onPressKey: (key: string) => void;
  onPressToday: () => void;
  onConfirm: () => void;
  /** "C" 键：清空当前正在输入的算式，回到 0 */
  onClear: () => void;
  /** 长按"完成"＝保存这一笔后不退出，留在原页面继续记下一笔；不传就只支持单击保存 */
  onConfirmLongPress?: () => void;
  /** 备注 + 小票：原来表单里单独一行，现在整个搬进键盘面板里，常驻在数字区上方。
   *  不传 onNoteChange 就不渲染这一条——转账/兑换那边已经有自己的备注字段，不需要这个。 */
  note?: string;
  onNoteChange?: (text: string) => void;
  /** 备注输入框的占位文案；不传就用默认的"添加备注（选填）..."——
   *  转账/兑换想沿用各自原来的提示语（比如"添加备注（选填）..."），可以传这个覆盖 */
  notePlaceholder?: string;
  receiptUri?: string | null;
  onAttachReceipt?: () => void;
  onRemoveReceipt?: () => void;
  onPreviewReceipt?: () => void;
  /** 备注框现在长在这个组件里了，外部想用 ref.current?.focus() 跳过来，得靠这个转发进来的 ref */
  noteInputRef?: React.RefObject<TextInput | null>;
  /** 备注框聚焦/失焦回调：父层用它区分"系统键盘是备注弹的"（自绘面板保留共存）
   *  和"系统键盘来自别的输入"（自绘面板让位收起） */
  onNoteFocus?: () => void;
  onNoteBlur?: () => void;
  /** 表单当前已选日期（YYYY-MM-DD）：日期键显示它；等于今天或不传时才标注"今天" */
  selectedDate?: string;
}

export function AmountCalculatorKeypad({
  onPressKey,
  onPressToday,
  onConfirm,
  onClear,
  onConfirmLongPress,
  note,
  onNoteChange,
  notePlaceholder,
  receiptUri,
  onAttachReceipt,
  onRemoveReceipt,
  onPreviewReceipt,
  noteInputRef,
  onNoteFocus,
  onNoteBlur,
  selectedDate,
}: AmountCalculatorKeypadProps) {
  const { semantic, gradients } = useTheme();
  const t = useT();
  const { langMode } = useLanguage();
  // 键高按版型分级（计划 8.2：窄 48 / 常规 56 / 大 60；矮屏统一 48），
  // 4 行按键总高随档位变化；数字格 / 退格 / 日期格 = 1 键高，「完成」= 2 键高
  const { keypadKeyHeight, isShort } = useLayout();
  // 矮屏（T15 惯例：留白再收一档）：面板上下留白 8/12→4/4、备注胶囊 42→36，
  // 换出「金额 + 至少 2 行类别 + 键盘」一屏可见（390×844 完全照稿不动）
  const notePillHeight = isShort ? 36 : 42;

  // 日期键实时显示表单选中的日期；只有选中的就是今天时才标注"今天"，
  // 选了别的日子就显示那天的月/日，避免误导用户还停留在今天
  const [today] = useState(() => new Date());
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const isToday = !selectedDate || selectedDate === todayStr;
  const parsedSelected = isToday ? today : new Date(`${selectedDate}T00:00:00`);
  const shownDate = isNaN(parsedSelected.getTime()) ? today : parsedSelected;
  // 日期显示格式统一走 formatDate（计划 4.4，修掉「日在前 / 月在前」的混乱）：
  // 中文 10月9日 / 英文 Oct 9。relative:false —— 上行标签已单独说「今天 / 日期」，
  // 这里恒定输出绝对月日，避免选中的是「今天」时两行都写「今天」
  const dateLabel = formatDate(shownDate, langMode, { style: 'monthDay', relative: false });

  // 左侧 3 列布局数据：右下角是小数点键（标准金额录入，替代原来的 Enter 箭头）
  const leftKeys = [
    { key: '1' }, { key: '2' }, { key: '3' },
    { key: '4' }, { key: '5' }, { key: '6' },
    { key: '7' }, { key: '8' }, { key: '9' },
    { key: 'C', type: 'clear' }, { key: '0' }, { key: '.', type: 'dot' },
  ];

  const handlePress = (key: string, type?: string) => {
    // 震动分级（计划 4.3）：数字键 0-9 = selection；退格 / C / 小数点 / 日期键 = light；
    // 「完成」键这里不震（保存成功的 success 震动由调用方统一处理）。
    // 注：退格长按连删走 onPressKeyRef 直连循环、不经过这里 —— 只在按下时震一次，连删保持静默
    if (type === 'confirm') {
      // 完成键：不震
    } else if (!type) {
      hapticSelection(); // 数字键 0-9
    } else {
      hapticLight(); // 退格 / C / 小数点 / 日期键
    }
    if (type === 'today') return onPressToday();
    if (type === 'confirm') return onConfirm();
    if (type === 'clear') return onClear();
    if (type === 'dot') return onPressKey('.');
    if (type === 'backspace') return onPressKey('backspace');
    onPressKey(key);
  };

  // ---------- 退格长按连删:长按 350ms 后每 60ms 删一位,松手即停 ----------
  const deleteIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 连删必须每次拿最新的 onPressKey：父层（记一笔）的 pressKeyAt 依赖当前算式 state、
  // 每删一位就重建——interval 若攥着长按开始那一刻的旧闭包，第 2 位起永远算出旧结果，
  // setState 无变化 → 真机上表现为"长按连删没生效"
  const onPressKeyRef = useRef(onPressKey);
  onPressKeyRef.current = onPressKey;
  const stopRepeatDelete = () => {
    if (deleteIntervalRef.current) {
      clearInterval(deleteIntervalRef.current);
      deleteIntervalRef.current = null;
    }
  };
  const startRepeatDelete = () => {
    stopRepeatDelete();
    deleteIntervalRef.current = setInterval(() => onPressKeyRef.current('backspace'), 60);
  };
  // 组件卸载时兜底清理,防止定时器泄漏
  useEffect(() => stopRepeatDelete, []);

  return (
    <View style={[styles.panel, isShort && styles.panelShort, { backgroundColor: semantic.keypadPanel }]}>
      {/* 顶部细亮线（夜：稿里的 inset 高光；日：发丝分割）——贴顶、随圆角裁切 */}
      <View pointerEvents="none" style={[styles.panelTopLine, { backgroundColor: semantic.hairline }]} />

      {/* 备注 + 小票：原来表单里那一行，原样搬过来，常驻在数字区上方；
          没传 onNoteChange 的调用方（转账/兑换）就不显示这一条 */}
      {onNoteChange && (
        <View style={[styles.noteRow, isShort && styles.noteRowShort]}>
          <View
            style={[styles.noteInputPill, { height: notePillHeight, backgroundColor: semantic.surfaceSunken }]}
          >
            <Ionicons name="create-outline" size={17} color={semantic.textTertiary} />
            <TextInput
              ref={noteInputRef}
              style={[styles.noteInputPillText, { color: semantic.textPrimary }]}
              value={note}
              onChangeText={onNoteChange}
              onFocus={onNoteFocus}
              onBlur={onNoteBlur}
              placeholder={notePlaceholder ?? t('addTx.keypadNotePlaceholder')}
              placeholderTextColor={semantic.textTertiary}
            />
          </View>
          {receiptUri ? (
            <Pressable
              style={({ pressed }) => [
                styles.receiptThumbPill,
                { height: notePillHeight, backgroundColor: semantic.surfaceSunken },
                PRESS_TRANSITION,
                pressed && { transform: [{ scale: 0.94 }] },
              ]}
              onPress={onPreviewReceipt}
              onLongPress={onAttachReceipt}
              accessibilityRole="button"
              accessibilityLabel={t('addTx.keypadReceipt')}
            >
              <Image source={{ uri: receiptUri }} style={[styles.receiptThumb, { backgroundColor: semantic.hairline }]} />
              <Pressable onPress={onRemoveReceipt} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={17} color={semantic.textSecondary} />
              </Pressable>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.receiptBtn,
                { width: notePillHeight, height: notePillHeight, backgroundColor: semantic.surfaceSunken },
                PRESS_TRANSITION,
                pressed && { transform: [{ scale: 0.94 }] },
              ]}
              onPress={onAttachReceipt}
              accessibilityRole="button"
              accessibilityLabel={t('addTx.keypadReceipt')}
            >
              {/* 稿：42 圆 + 收据图标 18（夜间浅紫 / 日间紫，取 accentText 档） */}
              <Ionicons name="receipt-outline" size={18} color={semantic.accentText} />
            </Pressable>
          )}
        </View>
      )}
      <View style={styles.container}>
      {/* 左侧 3 列：数字区 + C + 0 + 小数点（按键无边框，只有按下缩放反馈） */}
      <View style={styles.leftGrid}>
        {leftKeys.map((item, idx) => (
          <Pressable
            key={idx}
            onPress={() => handlePress(item.key, item.type)}
            style={({ pressed }) => [
              styles.cell3Col,
              { height: keypadKeyHeight },
              // 按下即时反馈：整格缩放 0.96（CSS transition 由 PRESS_TRANSITION 提供）
              PRESS_TRANSITION,
              pressed && { transform: [{ scale: 0.96 }] },
            ]}
          >
            {item.type === 'clear' ? (
              <Text style={[styles.keyText, styles.keyTextClear, { color: semantic.textSecondary }]}>C</Text>
            ) : item.type === 'dot' ? (
              /* 小数点键：标准金额录入由用户自己点小数点（替代原来的 Enter 箭头） */
              <Text style={[styles.keyText, { color: semantic.textPrimary }]}>.</Text>
            ) : (
              <Text style={[styles.keyText, { color: semantic.textPrimary }]}>{item.key}</Text>
            )}
          </Pressable>
        ))}
      </View>

      {/* 右侧 1 列：退格、日期键（surfaceSunken 底）、完成（占2格高） */}
      <View style={styles.rightColumn}>
        {/* 第 1 行：退格(长按连删) */}
        <Pressable
          onPress={() => {
            stopRepeatDelete();
            handlePress('backspace', 'backspace');
          }}
          onLongPress={startRepeatDelete}
          onPressOut={stopRepeatDelete}
          delayLongPress={350}
          style={({ pressed }) => [
            styles.cell1Col,
            { height: keypadKeyHeight },
            PRESS_TRANSITION,
            pressed && { transform: [{ scale: 0.96 }] },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('addTx.keypadBackspace')}
        >
          <Ionicons name="backspace-outline" size={26} color={semantic.textSecondary} />
        </Pressable>

        {/* 第 2 行：日期键（稿：surfaceSunken 底圆角块，两行文字居中，无图标） */}
        <Pressable
          onPress={() => handlePress('today', 'today')}
          style={({ pressed }) => [
            styles.cell1Col,
            styles.insetKey,
            styles.dateCell,
            { height: keypadKeyHeight, backgroundColor: semantic.surfaceSunken },
            PRESS_TRANSITION,
            pressed && { transform: [{ scale: 0.96 }] },
          ]}
          accessibilityRole="button"
          accessibilityLabel={isToday ? t('addTx.keypadToday') : dateLabel}
        >
          <Text style={[styles.dateLabelText, { color: semantic.textTertiary }]}>
            {isToday ? t('addTx.keypadToday') : t('addTx.keypadDate')}
          </Text>
          <Text style={[styles.dateValueText, { color: semantic.textPrimary }]} numberOfLines={1}>
            {dateLabel}
          </Text>
        </Pressable>

        {/* 第 3、4 行合并：完成键（稿：accent 渐变 + 白字 + 长按提示） */}
        <Pressable
          onPress={() => handlePress('confirm', 'confirm')}
          onLongPress={onConfirmLongPress}
          delayLongPress={350}
          style={({ pressed }) => [
            styles.cell1Col,
            styles.insetKey,
            styles.confirmCell,
            { height: keypadKeyHeight * 2 },
            PRESS_TRANSITION,
            pressed && { transform: [{ scale: 0.97 }] },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('addTx.keypadConfirm')}
        >
          {/* 渐变底：令牌 gradients.accent（135°）；顶部内高光 = 1dp 白线 */}
          <LinearGradient
            colors={gradients.accent.colors}
            locations={gradients.accent.locations as [number, number, ...number[]]}
            start={gradients.accent.start}
            end={gradients.accent.end}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View pointerEvents="none" style={styles.confirmTopLine} />
          <Text style={styles.confirmText}>{t('addTx.keypadConfirm')}</Text>
          {!!onConfirmLongPress && (
            <Text style={styles.confirmHint}>{t('addTx.keypadConfirmHint')}</Text>
          )}
        </Pressable>
      </View>
      </View>
    </View>
  );
}

/** 「完成」键顶部内高光（渐变上的白线；与 GlassView 同一手法，透明度写在样式中） */
const CONFIRM_TOP_LINE = 'rgba(255,255,255,0.35)';

const styles = StyleSheet.create({
  // 面板（V2）：顶部 30 圆角 + 内边距（8 / 12 / 12；底部再由外层按安全区补）
  panel: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingTop: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
    overflow: 'hidden',
  },
  // 矮屏：上下留白各收一档（8→4 / 12→4），把高度让给类别网格（≥2 行）
  panelShort: { paddingTop: 4, paddingBottom: 4 },
  panelTopLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  // 备注行（稿：上下 2 / 6，左右再内收 4）
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 2,
    paddingBottom: 6,
    paddingHorizontal: 4,
    columnGap: 10,
  },
  // 矮屏：下留白再收 2
  noteRowShort: { paddingBottom: 4 },
  // 备注胶囊：高 42（稿；矮屏 36）、全圆角、左图标 17 + 输入框 14
  noteInputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 14,
    columnGap: 8,
  },
  noteInputPillText: {
    flex: 1,
    fontSize: 14,
    padding: 0,
    height: 28,
    textAlignVertical: 'center',
  },
  // 收据按钮（空态）：42 圆（矮屏 36），surfaceSunken 底
  receiptBtn: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  // 收据缩略胶囊（有凭证时）：surfaceSunken 底 + 缩略图 + 删除叉
  receiptThumbPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 10,
    columnGap: 7,
    flexShrink: 0,
  },
  receiptThumb: {
    width: 26,
    height: 26,
    borderRadius: 7,
  },
  container: {
    flexDirection: 'row',
  },
  leftGrid: {
    width: '75%',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  rightColumn: {
    width: '25%',
    flexDirection: 'column',
  },
  // 数字键（V2 无边框）：高度由 JSX 内联传 useLayout().keypadKeyHeight
  cell3Col: {
    width: '33.33%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cell1Col: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // 有底的键（日期 / 完成）：四周留 3 → 与相邻键形成 6 的视觉缝（稿 gap 6）
  insetKey: {
    margin: 3,
    alignSelf: 'stretch',
  },
  // 日期键：圆角 18、两行文字居中（标签 11.5 / 日期 14/600）
  dateCell: {
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // 完成键：圆角 22、占 2 行高（高度由 JSX 内联传入）
  confirmCell: {
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  confirmTopLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: CONFIRM_TOP_LINE,
  },
  dateLabelText: {
    fontSize: 11.5,
    fontWeight: '500',
  },
  dateValueText: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 1,
  },
  // 完成键文字（稿 19/600 白）与长按提示（原稿 11/500 白 80%）
  confirmText: {
    fontSize: 19,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  confirmHint: {
    // ⚠ 不是 11：accent 渐变最亮处（渐变末端 ~rgb(160,88,200)）连纯白都只有 4.46:1，
    // 11pt 达不到 UI V2.1 §4 的 4.5；提到 14/700 走「大字档 3:1」（实测 3.45 ✓）。
    // 仍占「完成」键内部第二行，不再降透明度（满白最亮）
    fontSize: 14,
    fontWeight: '700',
    marginTop: 3,
    color: '#FFFFFF',
    textAlign: 'center',
    alignSelf: 'center',
  },
  // 数字键（稿 28/400）；C 键单独降到 22（稿）
  keyText: {
    fontSize: 28,
    textAlign: 'center',
    alignSelf: 'center',
  },
  keyTextClear: {
    fontSize: 22,
  },
});

export default AmountCalculatorKeypad;
