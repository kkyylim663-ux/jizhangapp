import React, { useCallback, useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { useT } from '../i18n/LanguageContext';
import { useAppLock } from '../context/AppLockContext';
import { hapticLight, hapticSuccess } from '../utils/haptics';

/**
 * 二级密码（6 位 PIN）键盘弹层。
 *
 * 三种模式：
 * - verify：验证已设置的 PIN（onSuccess 回调）
 * - create：直接设置新 PIN——输入两遍一致即创建（用户定版：不再要求生物识别前置）
 * - change：同 create，但开始前先验证原 PIN
 *
 * 用户定版规则：删除账本等敏感操作【只认 PIN】；生物识别锁解锁失败时可用 PIN 兜底
 * （兜底在 AppLockOverlay 内处理，不走本组件）。
 * 写法：纯 RN Modal + fade（同 HomeScreen 预算弹窗模式），不掺 Reanimated，
 * 避免 Android 独立窗口幽灵副本问题。
 */

export type PinSheetMode = 'verify' | 'create' | 'change';

interface PinSheetProps {
  visible: boolean;
  mode: PinSheetMode;
  onClose: () => void;
  /** verify/change 模式验证通过 / create 模式创建完成 */
  onSuccess: () => void;
  /** change 模式：旧 PIN 验证通过时回调（供外部在验证后中断流程，如「清除」场景） */
  onVerified?: () => void;
}

const PIN_LENGTH = 6;

export default function PinSheet({ visible, mode, onClose, onSuccess, onVerified }: PinSheetProps) {
  const { colors } = useTheme();
  const tr = useT();
  const { verifyPin, setPin } = useAppLock();

  // 阶段：change 模式 = 先验旧 PIN 再走 create 流程；其余模式固定
  const [stage, setStage] = useState<'verify' | 'create' | 'confirm'>(mode === 'create' ? 'create' : 'verify');
  const [pinValue, setPinValue] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 每次打开重置状态
  useEffect(() => {
    if (visible) {
      setStage(mode === 'create' ? 'create' : 'verify');
      setPinValue('');
      setFirstPin('');
      setError(null);
      setBusy(false);
    }
  }, [visible, mode]);

  const title =
    error
      ? error
      : stage === 'verify'
        ? tr('pin.verifyTitle')
        : stage === 'create'
          ? tr('pin.createTitle')
          : tr('pin.confirmTitle');

  const finishCreate = useCallback(
    async (finalPin: string) => {
      setBusy(true);
      await setPin(finalPin);
      setBusy(false);
      hapticSuccess();
      onSuccess();
      onClose();
    },
    [setPin, onSuccess, onClose]
  );

  const handleDigit = useCallback(
    (d: string) => {
      if (busy || pinValue.length >= PIN_LENGTH) return;
      setError(null);
      hapticLight();
      const next = pinValue + d;
      setPinValue(next);
      if (next.length < PIN_LENGTH) return;

      if (stage === 'verify') {
        // 验证旧 PIN（verify 模式=直接回调；change 模式=通过后进入创建阶段）
        setBusy(true);
        void (async () => {
          const ok = await verifyPin(next);
          setBusy(false);
          if (!ok) {
            setError(tr('pin.wrong'));
            setPinValue('');
            return;
          }
          if (mode === 'change') {
            onVerified?.();
            setFirstPin('');
            setPinValue('');
            setStage('create');
          } else {
            hapticSuccess();
            onSuccess();
            onClose();
          }
        })();
      } else if (stage === 'create') {
        setFirstPin(next);
        setPinValue('');
        setStage('confirm');
      } else {
        // confirm 阶段：两遍一致才创建
        if (next === firstPin) {
          void finishCreate(next);
        } else {
          setError(tr('pin.mismatch'));
          setPinValue('');
          setStage('create');
          setFirstPin('');
        }
      }
    },
    [pinValue, stage, mode, firstPin, busy, verifyPin, finishCreate, onSuccess, onVerified, onClose, tr]
  );

  const handleBackspace = useCallback(() => {
    if (busy) return;
    hapticLight();
    setPinValue((p: string) => p.slice(0, -1));
  }, [busy]);

  const handleClearPress = useCallback(() => {
    if (busy) return;
    hapticLight();
    setPinValue('');
    setError(null);
  }, [busy]);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View
          style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.handle} />
          {/* 右上角 ✕ 关闭钮（用户定版：取消改为 ✕ 并放到右侧上方，与账本弹层/账户弹层同语言） */}
          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: colors.bg }]}
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            disabled={busy}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={tr('common.cancel')}
          >
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            {title}
          </Text>
          {error ? null : (
            <Text style={[styles.subtitle, { color: colors.textTertiary }]}>{tr('pin.subtitle')}</Text>
          )}

          {/* 6 位圆点 */}
          <View style={styles.dotsRow}>
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  { borderColor: colors.link },
                  i < pinValue.length && { backgroundColor: colors.link },
                ]}
              />
            ))}
          </View>

          {/* 键盘：3×4 网格，底行 左=清空 中=0 右=退格 */}
          <View style={styles.keypad}>
            {keys.map((k) => (
              <TouchableOpacity
                key={k}
                style={[styles.key, { backgroundColor: colors.bg, borderColor: colors.dividerHair }]}
                onPress={() => handleDigit(k)}
                disabled={busy}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={k}
              >
                <Text style={[styles.keyText, { color: colors.textPrimary }]}>{k}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.key, styles.keyGhost]}
              onPress={handleClearPress}
              disabled={busy || pinValue.length === 0}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="clear"
            >
              <Text style={[styles.keyGhostText, { color: colors.textSecondary }]}>C</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.key, { backgroundColor: colors.bg, borderColor: colors.dividerHair }]}
              onPress={() => handleDigit('0')}
              disabled={busy}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="0"
            >
              <Text style={[styles.keyText, { color: colors.textPrimary }]}>0</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.key, styles.keyGhost]}
              onPress={handleBackspace}
              disabled={busy || pinValue.length === 0}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="backspace"
            >
              <Ionicons name="backspace-outline" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 34,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(128,128,140,0.4)',
    marginBottom: 14,
  },
  title: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 12, marginTop: 4, textAlign: 'center' },
  // 右上角 ✕ 关闭钮（账户弹层 accountPickerClose 同款规格：30×30 圆底）
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 16,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
    marginTop: 18,
    marginBottom: 20,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 14,
  },
  key: {
    width: 72,
    height: 56,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyGhost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  keyText: { fontSize: 22, fontWeight: '600' },
  keyGhostText: { fontSize: 18, fontWeight: '700' },
});
