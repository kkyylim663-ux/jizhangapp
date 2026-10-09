import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, Image, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  const { colors, semantic } = useTheme();
  const t = useT();
  const { langMode } = useLanguage();
  // 键高按版型分级（计划 8.2：窄 48 / 常规 56 / 大 60；矮屏统一 48），
  // 4 行按键总高随档位变化；数字格 / 退格 / 日期格 = 1 键高，「完成」= 2 键高
  const { keypadKeyHeight } = useLayout();

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
    <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      {/* 备注 + 小票：原来表单里那一行，原样搬过来，常驻在数字区上方；
          没传 onNoteChange 的调用方（转账/兑换）就不显示这一条 */}
      {onNoteChange && (
        <View style={[styles.noteRow, { borderColor: colors.dividerHair }]}>
          <View style={styles.noteInputPill}>
            <Ionicons name="create-outline" size={18} color={colors.textTertiary} style={{ marginRight: 8 }} />
            <TextInput
              ref={noteInputRef}
              style={[styles.noteInputPillText, { color: colors.textPrimary }]}
              value={note}
              onChangeText={onNoteChange}
              onFocus={onNoteFocus}
              onBlur={onNoteBlur}
              placeholder={notePlaceholder ?? t('addTx.keypadNotePlaceholder')}
              placeholderTextColor={colors.textTertiary}
            />
          </View>
          {receiptUri ? (
            <Pressable
              style={({ pressed }) => [
                styles.smallChip,
                { backgroundColor: colors.bg, borderColor: colors.link },
                PRESS_TRANSITION,
                pressed && { transform: [{ scale: 0.94 }] },
              ]}
              onPress={onPreviewReceipt}
              onLongPress={onAttachReceipt}
            >
              <Image source={{ uri: receiptUri }} style={[styles.smallChipThumb, { backgroundColor: colors.dividerHair }]} />
              <Pressable onPress={onRemoveReceipt} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={17} color={colors.textSecondary} />
              </Pressable>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.smallChip,
                { backgroundColor: colors.bg, borderColor: colors.link },
                PRESS_TRANSITION,
                pressed && { transform: [{ scale: 0.94 }] },
              ]}
              onPress={onAttachReceipt}
            >
              {/* 图标与页面顶部"扫票"按钮完全一致：camera-outline / 13 / 主题紫色 */}
              <Ionicons name="camera-outline" size={13} color={colors.link} style={{ marginRight: 4 }} />
              <Text style={[styles.smallChipText, { color: colors.link }]}>{t('addTx.keypadReceipt')}</Text>
            </Pressable>
          )}
        </View>
      )}
      <View style={styles.container}>
      {/* 左侧 3 列：数字区 + C + 0 + Enter图标 */}
      <View style={styles.leftGrid}>
        {leftKeys.map((item, idx) => (
          <Pressable
            key={idx}
            onPress={() => handlePress(item.key, item.type)}
            style={({ pressed }) => [
              styles.cell3Col,
              { height: keypadKeyHeight, borderColor: colors.dividerHair },
              // 按下即时反馈：整格缩放 0.96（CSS transition 由 PRESS_TRANSITION 提供）
              PRESS_TRANSITION,
              pressed && { transform: [{ scale: 0.96 }] },
            ]}
          >
            {item.type === 'clear' ? (
              <Text style={[styles.keyText, { color: colors.textSecondary, fontWeight: '700' }]}>C</Text>
            ) : item.type === 'dot' ? (
              /* 小数点键：标准金额录入由用户自己点小数点（替代原来的 Enter 箭头） */
              <Text style={[styles.keyText, { color: colors.textPrimary }]}>.</Text>
            ) : (
              <Text style={[styles.keyText, { color: colors.textPrimary }]}>{item.key}</Text>
            )}
          </Pressable>
        ))}
      </View>

      {/* 右侧 1 列：退格、今天、完成（占2格高） */}
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
            { height: keypadKeyHeight, borderColor: colors.dividerHair },
            PRESS_TRANSITION,
            pressed && { transform: [{ scale: 0.96 }] },
          ]}
        >
          <Ionicons name="backspace-outline" size={26} color={colors.textPrimary} />
        </Pressable>

        {/* 第 2 行：今天 */}
        <Pressable
          onPress={() => handlePress('today', 'today')}
          style={({ pressed }) => [
            styles.cell1Col,
            { height: keypadKeyHeight, borderColor: colors.dividerHair },
            PRESS_TRANSITION,
            pressed && { transform: [{ scale: 0.96 }] },
          ]}
        >
          <View style={styles.todayCell}>
            <Ionicons name="calendar-outline" size={19} color={colors.textSecondary} />
            <View style={styles.todayTextCol}>
              <Text style={[styles.todayLabelText, { color: colors.textTertiary }]}>
                {isToday ? t('addTx.keypadToday') : t('addTx.keypadDate')}
              </Text>
              <Text style={[styles.todayDateText, { color: colors.textSecondary }]} numberOfLines={1}>
                {dateLabel}
              </Text>
            </View>
          </View>
        </Pressable>

        {/* 第 3、4 行合并：完成键 */}
        <Pressable
          onPress={() => handlePress('confirm', 'confirm')}
          onLongPress={onConfirmLongPress}
          delayLongPress={350}
          style={({ pressed }) => [
            styles.cell1Col,
            styles.confirmCell,
            { height: keypadKeyHeight * 2, borderColor: colors.dividerHair, backgroundColor: semantic.accent },
            PRESS_TRANSITION,
            pressed && { transform: [{ scale: 0.97 }] },
          ]}
        >
          <Text style={[styles.keyText, { color: semantic.onAccent, fontWeight: '600' }]}>{t('addTx.keypadConfirm')}</Text>
          {!!onConfirmLongPress && (
            <Text style={[styles.confirmHint, { color: semantic.onAccent }]}>{t('addTx.keypadConfirmHint')}</Text>
          )}
        </Pressable>
      </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {},
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noteInputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginRight: 10,
  },
  noteInputPillText: {
    flex: 1,
    fontSize: 16,
    padding: 0,
    height: 28,
    textAlignVertical: 'center',
  },
  // 收据芯片视觉规格 = 页面头部"扫票"按钮：同圆角(18)、同1px描边、同内边距，
  // 加上同尺寸图标(13)和文字(12/600)，保证半屏键盘和全屏页面里看起来完全一致。
  // 注意：样式表是模块级常量，主题色（紫色描边）在 JSX 内联传入
  smallChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  smallChipText: {
    fontSize: 12,
    marginLeft: 4,
    fontWeight: '600',
  },
  smallChipThumb: {
    width: 24,
    height: 24,
    borderRadius: 6,
    marginRight: 7,
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
  cell3Col: {
    width: '33.33%',
    // 高度不用写死：由 JSX 内联传 useLayout().keypadKeyHeight（4 行总高随版型档位变化）
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cell1Col: {
    width: '100%',
    // 高度由 JSX 内联传 useLayout().keypadKeyHeight
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  confirmCell: {
    // 高度 = 2 × keypadKeyHeight，由 JSX 内联传入（占右侧第 3、4 行两格）
    justifyContent: 'center',
    alignItems: 'center',
  },
  todayCell: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  todayTextCol: {
    marginLeft: 6,
    alignItems: 'flex-start',
  },
  todayLabelText: {
    fontSize: 11,
    fontWeight: '500',
  },
  todayDateText: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 1,
  },
  confirmHint: {
    // 11pt = 字号令牌最小档（UI_RULES：禁止 7–10pt），仍在「完成」键内部第二行
    fontSize: 11,
    marginTop: 3,
    opacity: 0.75,
    textAlign: 'center',
    alignSelf: 'center',
  },
  keyText: {
    // 26pt 为计划 5.3 A5 用户定版值
    fontSize: 26,
    textAlign: 'center',
    alignSelf: 'center',
  },
});