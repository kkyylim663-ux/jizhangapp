// AppDialog.tsx
// 全局主题化弹窗（T05 换新样式）—— 全 App 唯一的确认对话框（计划 4.5 / 10.1，取代系统 Alert.alert）。
//
// API 完全不变（13 个页面在调，不许改）
//   const dialog = useDialog();
//   dialog.alert({ title, message, buttons: [{ text, style: 'cancel'|'default'|'destructive', onPress }] });
//   挂载：App.tsx 里 <AppDialogProvider><AppDialogHost /></AppDialogProvider>。
//
// 本版变化
// - 遮罩改用全 App 唯一遮罩色 semantic.scrim（原写死 rgba(0,0,0,0.55)）；
// - 卡片换新样式：surfaceElevated + radius.lg(20) + elevation.level2 + 令牌字号；
// - 按钮高 50（≥44）、圆角 14、色调与 ui/Button 一致（取消=描边、默认=实心紫、危险=红字淡红底）；
// - 点遮罩 = 取消：有 cancel 按钮就触发它的回调，没有就只是关掉（原来点遮罩只关、不回调）。
// - 按钮仍竖排全宽、危险钮最下（用户定版：横排长文案会被截断）。
//
// ⚠ 仍走纯 RN Modal + fade，**不掺 Reanimated**（项目定论：Modal 独立原生窗口 + Reanimated
//   在安卓上会出幽灵副本，同 PinSheet / 预算弹窗）—— 所以这里的按钮是自绘 Pressable，
//   不复用 ui/Button（那个走 PressableScale）。

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { useT } from '../i18n/LanguageContext';
import AppText from './ui/AppText';
import { withAlpha } from './ui/color';

export interface DialogButton {
  text: string;
  /** cancel=普通描边钮（点遮罩也会触发它）; destructive=红字; default=主题紫主钮（缺省） */
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

/** 按钮高度（≥44 触控下限，与 ui/Button 的 md 档一致） */
const BUTTON_HEIGHT = 50;

/**
 * 竖排按钮顺序（iOS 习惯，验收退回第 6 条）：取消永远排最后。
 * 其余保持调用方给的相对顺序（主要操作在前、危险操作在后），Array.sort 是稳定排序。
 * 只在渲染期排序，不改调用方传进来的数组。
 */
function orderedButtons(buttons: DialogButton[]): DialogButton[] {
  return [...buttons]
    .map((btn, index) => ({ btn, index }))
    .sort((a, b) => {
      const aCancel = a.btn.style === 'cancel' ? 1 : 0;
      const bCancel = b.btn.style === 'cancel' ? 1 : 0;
      return aCancel - bCancel || a.index - b.index;
    })
    .map((item) => item.btn);
}

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  // 防重入：onPress 里再弹下一个弹窗时先收起当前再挂载新内容
  const closingRef = useRef(false);

  const alert = useCallback((opts: { title: string; message?: string; buttons?: DialogButton[] }) => {
    const buttons: DialogButton[] =
      opts.buttons && opts.buttons.length > 0 ? opts.buttons : [{ text: '', style: 'default' }];
    setRequest({ title: opts.title, message: opts.message, buttons });
  }, []);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setRequest(null);
    // 等退场动画一帧后再允许下一次打开
    requestAnimationFrame(() => {
      closingRef.current = false;
    });
  }, []);

  const handlePress = useCallback(
    (btn: DialogButton) => {
      close();
      // 等 Modal 关闭动画启动后再执行回调，避免「回调里立刻弹下一个」被 closingRef 拦截
      setTimeout(() => btn.onPress?.(), 120);
    },
    [close]
  );

  /** 点遮罩 = 取消：有 cancel 按钮就触发它的回调（用户要求），没有就单纯关掉 */
  const handleScrimPress = useCallback(() => {
    const cancelButton = request?.buttons.find((b) => b.style === 'cancel');
    if (cancelButton) handlePress(cancelButton);
    else close();
  }, [request, handlePress, close]);

  return (
    <DialogContext.Provider value={{ alert }}>
      {children}
      <DialogHost request={request} onClose={close} onPress={handlePress} onScrimPress={handleScrimPress} />
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog必须在AppDialogProvider内部使用');
  return ctx;
}

/**
 * 软获取版：不在 Provider 里时返回 null，不抛错。
 * 给「可选弹窗」的基础组件用（例如 MoneyText 紧凑格式的长按看全文：
 * 在 App 里能用上弹窗，单独渲染 / 预览页里也不会崩）。
 */
export function useDialogOptional(): DialogContextValue | null {
  return useContext(DialogContext) ?? null;
}

/** 全局弹窗 Host：App.tsx 在 AppDialogProvider 内挂一次即可（Host 已内置于 Provider） */
export function AppDialogHost() {
  return null;
}

function DialogHost({
  request,
  onClose,
  onPress,
  onScrimPress,
}: {
  request: DialogRequest | null;
  onClose: () => void;
  onPress: (btn: DialogButton) => void;
  onScrimPress: () => void;
}) {
  const { semantic, radius, layout, elevation, spacing } = useTheme();
  const tr = useT();
  return (
    <Modal visible={!!request} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={[styles.scrim, { backgroundColor: semantic.scrim, padding: spacing.xxxl }]}
        onPress={onScrimPress}
        // ⚠ 不给遮罩 accessibilityRole="button"：它包着整张卡，角色 button 会让
        //   web 渲染出「button 套 button」的非法结构（读屏用卡里的取消钮做退出路径）
        accessible={false}
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: semantic.surfaceElevated,
              borderRadius: radius.lg,
              padding: layout.card,
            },
            elevation.level2,
          ]}
          // 卡内点击不穿透到遮罩
          onStartShouldSetResponder={() => true}
          accessibilityViewIsModal
        >
          {request && (
            <>
              <AppText variant="headline" align="center">
                {request.title}
              </AppText>
              {!!request.message && (
                <AppText variant="subhead" color={semantic.textSecondary} align="center" style={{ marginTop: spacing.sm }}>
                  {request.message}
                </AppText>
              )}
              {/* 按钮竖排全宽：横排三个时长文案（如「清除二级密码」）会被截断成"清除二…"。
                  顺序按 iOS 习惯（验收退回第 6 条）：主要操作 → 危险操作 → 取消放最下 */}
              <View style={[styles.buttonColumn, { gap: spacing.md, marginTop: spacing.lg }]}>
                {orderedButtons(request.buttons).map((btn, idx) => {
                  const isCancel = btn.style === 'cancel';
                  const isDestructive = btn.style === 'destructive';
                  const label = btn.text || tr('common.confirm');
                  const background = isCancel
                    ? 'transparent'
                    : isDestructive
                      ? withAlpha(semantic.danger, 0.1)
                      : semantic.accent;
                  const foreground = isCancel
                    ? semantic.textPrimary
                    : isDestructive
                      ? semantic.danger
                      : semantic.onAccent;
                  return (
                    <Pressable
                      key={`${idx}-${label}`}
                      style={[
                        styles.button,
                        {
                          backgroundColor: background,
                          borderRadius: radius.md,
                          paddingHorizontal: spacing.lg,
                          paddingVertical: spacing.md,
                          borderColor: isCancel ? semantic.hairline : 'transparent',
                          borderWidth: isCancel ? StyleSheet.hairlineWidth : 0,
                        },
                      ]}
                      onPress={() => onPress(btn)}
                      accessibilityRole="button"
                      accessibilityLabel={label}
                    >
                      <AppText variant="headline" color={foreground} align="center">
                        {label}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // 卡宽上限 320（不写死宽度，窄屏靠 width:'100%' 自适应）
  card: { width: '100%', maxWidth: 320 },
  // 按钮竖排全宽：长文案（"清除二级密码"等）不再截断；取消钮细描边、其余实底
  buttonColumn: { flexDirection: 'column' },
  // 几何下限：按钮高 ≥44（与 ui/Button 的 md 档一致），颜色 / 圆角 / 间距在渲染期取令牌
  button: {
    width: '100%',
    minHeight: BUTTON_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
