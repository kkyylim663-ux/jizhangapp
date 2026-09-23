import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { useT } from '../i18n/LanguageContext';
import { ThemeColors } from '../theme/theme';

/**
 * 全局主题化弹窗（替代系统 Alert.alert）。
 *
 * 视觉与账本弹层同一设计语言：深色卡片圆角 16、发丝描边、主题紫主按钮、
 * 危险操作红色按钮。API 仿 Alert.alert：
 *
 *   const dialog = useDialog();
 *   dialog.alert({ title, message, buttons: [{ text, style: 'cancel'|'default'|'destructive', onPress }] });
 *
 * 挂载：App.tsx 里 <AppDialogProvider><AppDialogHost /></AppDialogProvider>。
 * 纯 RN Modal + fade，不掺 Reanimated（避免 Android 幽灵副本，同 PinSheet/预算弹窗）。
 */

export interface DialogButton {
  text: string;
  /** cancel=普通左钮; destructive=红色; default=主题紫主钮（缺省） */
  style?: 'cancel' | 'default' | 'destructive';
  onPress?: () => void;
}

interface DialogRequest {
  title: string;
  message?: string;
  buttons: DialogButton[];
}

interface DialogContextValue {
  alert: (opts: { title: string; message?: string; buttons?: DialogButton[] }) => void;
}

const DialogContext = createContext<DialogContextValue | undefined>(undefined);

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  // 防重入：onPress 里再弹下一个弹窗时先收起当前再挂载新内容
  const closingRef = useRef(false);

  const alert = useCallback(
    (opts: { title: string; message?: string; buttons?: DialogButton[] }) => {
      const buttons: DialogButton[] =
        opts.buttons && opts.buttons.length > 0 ? opts.buttons : [{ text: '', style: 'default' }];
      setRequest({ title: opts.title, message: opts.message, buttons });
    },
    []
  );

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setRequest(null);
    // 等退场动画一帧后再允许下一次打开
    requestAnimationFrame(() => {
      closingRef.current = false;
    });
  }, []);

  const handlePress = (btn: DialogButton) => {
    close();
    // 等 Modal 关闭动画启动后再执行回调，避免「回调里立刻弹下一个」被 closingRef 拦截
    setTimeout(() => btn.onPress?.(), 120);
  };

  return (
    <DialogContext.Provider value={{ alert }}>
      {children}
      <DialogHost request={request} onClose={close} onPress={handlePress} />
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog必须在AppDialogProvider内部使用');
  return ctx;
}

/** 全局弹窗 Host：App.tsx 在 AppDialogProvider 内挂一次即可 */
export function AppDialogHost() {
  return null;
}

function DialogHost({
  request,
  onClose,
  onPress,
}: {
  request: DialogRequest | null;
  onClose: () => void;
  onPress: (btn: DialogButton) => void;
}) {
  const { colors } = useTheme();
  const tr = useT();
  return (
    <Modal visible={!!request} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
          onStartShouldSetResponder={() => true}
        >
          {request && (
            <>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{request.title}</Text>
              {!!request.message && (
                <Text style={[styles.message, { color: colors.textSecondary }]}>{request.message}</Text>
              )}
              {/* 按钮竖排全宽（用户定版）：横排三个时长文案（如「清除二级密码」）
                  会被截断成"清除二…"，竖排不再受限 */}
              <View style={styles.buttonRow}>
                {request.buttons.map((btn, idx) => {
                  const isCancel = btn.style === 'cancel';
                  const isDestructive = btn.style === 'destructive';
                  const label = btn.text || tr('common.confirm');
                  return (
                    <TouchableOpacity
                      key={`${idx}-${label}`}
                      style={[
                        styles.button,
                        isCancel && styles.buttonCancel,
                        { borderColor: isCancel ? colors.dividerHair : 'transparent' },
                        !isCancel && { backgroundColor: isDestructive ? colors.expenseOver : colors.fabBg },
                      ]}
                      activeOpacity={0.8}
                      onPress={() => onPress(btn)}
                    >
                      <Text
                        style={[
                          styles.buttonText,
                          { color: isCancel ? colors.textPrimary : '#FFFFFF' },
                        ]}
                        numberOfLines={1}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  message: { fontSize: 13, lineHeight: 19, marginTop: 8, textAlign: 'center' },
  // 按钮竖排全宽：长文案（"清除二级密码"等）不再截断；取消钮细描边、其余实底
  buttonRow: { flexDirection: 'column', gap: 10, marginTop: 18 },
  button: {
    width: '100%',
    minHeight: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  buttonCancel: { backgroundColor: 'transparent' },
  buttonText: { fontSize: 14, fontWeight: '700' },
});
