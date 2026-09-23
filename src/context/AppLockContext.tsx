import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { AppState, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { useT } from '../i18n/LanguageContext';
import { useAuth } from './AuthContext';
import { hashPin, verifyPin } from '../utils/pinCrypto';

/**
 * Bio Lock（生物识别锁）：
 * - 开关持久化在 @jizhang/bioLock，只有"已登录"才生效（退出登录自动解除）
 * - 锁定时机：打开 App 时、切到后台再回来时
 * - 解锁：指纹/面容（authenticateAsync），设备允许时也可回退锁屏密码
 *
 * 注意：这是客户端便捷锁（防止旁人随手翻看），不是加密——数据本身仍在 AsyncStorage。
 *
 * 二级密码（6 位 PIN）：独立于 Bio Lock，专用于敏感操作确认（当前：删除账本）。
 * - 哈希（SHA-256+盐）存 @jizhang/secondPin；忘记 PIN 无自助找回（清除后重设）
 * - 创建/修改不再要求生物识别前置（用户定版）
 * - Bio Lock 解锁失败时，锁屏上出现「用二级密码解锁」入口（用户定版兜底）
 */

const BIO_LOCK_KEY = '@jizhang/bioLock';
const SECOND_PIN_KEY = '@jizhang/secondPin';

// 解锁结果分类：
// - 'success'：认证通过
// - 'userCancel'：用户主动取消（点系统的"取消"/锁屏密码返回）→ 不计失败、不自动重弹
// - 'fail'：真实认证失败（指纹/面容不匹配）→ 计失败次数
// - 'unavailable'：系统级静默失败（Activity 未就绪被吞、not_enrolled 等）→ 稍后自动补弹
type UnlockResult = 'success' | 'userCancel' | 'fail' | 'unavailable';

interface AppLockContextValue {
  /** 用户开关（已持久化） */
  bioEnabled: boolean;
  /** 设备支持生物识别且已录入（两个条件都满足才能开启开关） */
  bioReady: boolean;
  /** 正在检测设备能力 */
  checkingBio: boolean;
  /** 当前是否处于锁定态（LockOverlay 据此显示） */
  locked: boolean;
  setBioEnabled: (v: boolean) => Promise<void>;
  /** 弹出生物识别解锁（结果：success / userCancel / fail / unavailable） */
  unlock: () => Promise<UnlockResult>;
  /** 生物识别连续失败次数（3 次后锁屏只剩二级密码入口） */
  bioFailCount: number;
  /** 生物识别失败次数达上限：本次锁定期间只允许二级密码解锁 */
  bioOnlyPin: boolean;
  /** 手动解锁路径的真实失败计数递增（与自动弹链路共用） */
  bumpBioFail: () => void;
  /** 是否已设置二级密码 */
  hasPin: boolean;
  /** 设置/更换二级密码（传入明文，内部加盐哈希后落盘） */
  setPin: (pin: string) => Promise<void>;
  /** 校验二级密码 */
  verifyPin: (pin: string) => Promise<boolean>;
  /** 清除二级密码 */
  clearPin: () => Promise<void>;
  /** 解除锁定态（AppLockOverlay 的 PIN 兜底验证通过后调用） */
  dismissLock: () => void;
}

const AppLockContext = createContext<AppLockContextValue | undefined>(undefined);

export function AppLockProvider({ children }: { children: ReactNode }) {
  const { user, authInitializing } = useAuth();
  const tr = useT();

  const [bioEnabled, setBioEnabledState] = useState(false);
  const [bioReady, setBioReady] = useState(false);
  const [checkingBio, setCheckingBio] = useState(true);
  const [locked, setLocked] = useState(false);
  // 解锁请求去重：自动弹窗进行中时，重复调用不再弹第二个系统框
  const promptingRef = useRef(false);
  // 二级密码：启动时读存储的哈希（null = 未设置）
  const [pinHash, setPinHash] = useState<string | null>(null);
  // 生物识别连续失败计数：达 BIO_FAIL_LIMIT 后本次锁定期间只剩 PIN 解锁（不持久化，解锁即清零）
  const [bioFailCount, setBioFailCount] = useState(0);
  const BIO_FAIL_LIMIT = 3;
  // 「只剩 PIN」的前提是 PIN 存在：若用户开了生物锁后又清除了二级密码（clearPin 不联动关锁），
  // 无 PIN 时不满次数限制、保持生物识别可重试（否则 3 次失败后会话内无任何可用解锁方式，死锁）
  const bioOnlyPin = bioFailCount >= BIO_FAIL_LIMIT && !!pinHash;
  // 持有最新的 locked/bioEnabled/user 供 AppState 监听器读取（避免闭包旧值）
  const lockedRef = useRef(false);
  const bioEnabledRef = useRef(false);
  const userRef = useRef(user);
  const bioOnlyPinRef = useRef(false);
  lockedRef.current = locked;
  bioEnabledRef.current = bioEnabled;
  userRef.current = user;
  bioOnlyPinRef.current = bioOnlyPin;
  // 自动补弹计数（系统级静默失败时最多补弹 2 次）
  const retryCountRef = useRef(0);

  // 启动：读开关 + 检测设备能力 + 读 PIN 哈希
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(BIO_LOCK_KEY);
        if (stored === '1') setBioEnabledState(true);
        const [hasHardware, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        setBioReady(hasHardware && enrolled);
        const savedPin = await AsyncStorage.getItem(SECOND_PIN_KEY);
        if (savedPin) setPinHash(savedPin);
      } catch {
        setBioReady(false);
      } finally {
        setCheckingBio(false);
      }
    })();
  }, []);

  // 锁定时机①：打开 App（登录态恢复完成且开关开启）
  useEffect(() => {
    if (authInitializing || checkingBio) return;
    if (bioEnabled && user) setLocked(true);
  }, [authInitializing, checkingBio, bioEnabled, user]);

  // 锁定时机②：切到后台再回来（前台活跃瞬间保持已锁状态）
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && bioEnabled && user) setLocked(true);
    });
    return () => sub.remove();
  }, [bioEnabled, user]);

  // 解锁成功或重新锁定时清零失败计数与补弹计数（retryCountRef 声明于下方 ref 区，此处仅复位）
  useEffect(() => {
    if (!locked) {
      retryCountRef.current = 0;
      setBioFailCount(0);
    }
  }, [locked]);

  // 退出登录自动解除锁定（"登录后才用 Bio Lock"的语义）
  useEffect(() => {
    if (!user) setLocked(false);
  }, [user]);

  const setBioEnabled = useCallback(async (v: boolean) => {
    setBioEnabledState(v);
    await AsyncStorage.setItem(BIO_LOCK_KEY, v ? '1' : '0').catch(() => {});
  }, []);

  const unlock = useCallback(async (): Promise<UnlockResult> => {
    if (promptingRef.current) return 'unavailable';
    promptingRef.current = true;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: tr('lock.prompt'),
        cancelLabel: tr('common.cancel'),
        disableDeviceFallback: false, // 生物识别不可用时允许退回设备锁屏密码
      });
      if (result.success) {
        setLocked(false);
        setBioFailCount(0);
        return 'success';
      }
      // authenticateAsync 不抛异常：error 属性区分取消与失败
      const code = (result as { error?: string }).error;
      if (code === 'user_cancel' || code === 'app_cancel' || code === 'system_cancel' || code === 'lockout') {
        return 'userCancel';
      }
      // 有 error 但不是取消类（如 not_enrolled/unknown），或无 error 的失败：
      // unknown 多见于部分安卓机型在转场中被系统吞掉的场景 → 归为 unavailable 可补弹
      return code === 'unknown' || !code ? 'unavailable' : 'fail';
    } catch {
      // 罕见：promise 层面异常，按不可用处理（不惩罚用户）
      return 'unavailable';
    } finally {
      promptingRef.current = false;
    }
  }, [tr]);

  // 自动弹生物认证：锁定刚生效（locked 变 true）与回到前台时触发。
  // 冷启动的关键时序：authInitializing/checkingBio/登录态恢复完成后 locked 才变 true，
  // 此时 ref 已同步为最新值——此前只靠 AppState 初跑触发，而 effect 挂载时 locked 还是
  // false（锁定时机①尚未跑），冷启动永远不自动弹（必须手点）的根因，故改挂 locked 转换。
  // 延迟 400ms：部分安卓机型在 Activity 转场未完成时调用 authenticateAsync 会被系统静默吞掉
  // （这就是"必须手点解锁"的根因），留足转场时间再弹。
  const autoPrompt = useCallback(() => {
    if (!lockedRef.current || !bioEnabledRef.current || !userRef.current) return;
    if (bioOnlyPinRef.current) return; // 失败次数已满：不再弹生物，只剩 PIN
    setTimeout(() => {
      // 已退到后台（切后台瞬间也会触发锁定）：不空弹，等回前台的 change 事件再试
      if (AppState.currentState !== 'active') return;
      if (!lockedRef.current || promptingRef.current) return;
      void unlock().then((r) => {
        if (r === 'fail') setBioFailCount((c) => Math.min(c + 1, 99));
        if (r === 'unavailable' && lockedRef.current) {
          // 系统级静默失败：800ms 后补弹（最多 2 次，由 retryCountRef 控制）
          retryCountRef.current += 1;
          if (retryCountRef.current <= 2) setTimeout(autoPrompt, 800);
        }
      });
    }, 400);
  }, [unlock]);

  // 锁定生效（冷启动锁定 / 切后台锁定 / 登录后开启开关）→ 自动弹一次
  useEffect(() => {
    if (locked) autoPrompt();
  }, [locked, autoPrompt]);

  // 回到前台（后台切回）：重置补弹计数并再试
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        retryCountRef.current = 0;
        autoPrompt();
      }
    });
    return () => sub.remove();
    // unlock 依赖 tr（语言变化重挂无碍）；locked/bioEnabled/user 走 ref 读最新值
  }, [autoPrompt]);

  const setPin = useCallback(async (pin: string) => {
    const hashed = hashPin(pin);
    setPinHash(hashed);
    await AsyncStorage.setItem(SECOND_PIN_KEY, hashed).catch(() => {});
  }, []);

  const verifyPinFn = useCallback(
    async (pin: string): Promise<boolean> => {
      if (!pinHash) return false;
      return verifyPin(pin, pinHash);
    },
    [pinHash]
  );

  const clearPin = useCallback(async () => {
    setPinHash(null);
    await AsyncStorage.removeItem(SECOND_PIN_KEY).catch(() => {});
  }, []);

  const dismissLock = useCallback(() => {
    setLocked(false);
  }, []);

  return (
    <AppLockContext.Provider
      value={{
        bioEnabled,
        bioReady,
        checkingBio,
        locked,
        setBioEnabled,
        unlock,
        bioFailCount,
        bioOnlyPin,
        bumpBioFail: () => setBioFailCount((c) => Math.min(c + 1, 99)),
        hasPin: !!pinHash,
        setPin,
        verifyPin: verifyPinFn,
        clearPin,
        dismissLock,
      }}
    >
      {children}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error('useAppLock必须在AppLockProvider内部使用');
  return ctx;
}

/**
 * 全屏锁定层：盖在导航之上（含底部 Tab 栏）。
 * 生物认证的自动弹出由 Provider 负责（锁定生效时与回前台 400ms 后弹，
 * 系统级静默失败自动补弹）；用户取消/失败后可点按钮手动重试，
 * 也可以点「用二级密码解锁」输入 6 位 PIN 兜底（已设 PIN 时显示，用户定版）。
 * 生物识别连续失败 3 次后：本次锁定期间只剩 PIN 解锁（bioOnlyPin，用户定版）。
 */
export function AppLockOverlay() {
  const { locked, unlock, bioOnlyPin, bumpBioFail, hasPin, verifyPin, dismissLock } = useAppLock();
  const { colors } = useTheme();
  const tr = useT();
  // TASK-021：锁屏不再有"解锁"按钮——认证由 Provider 的 autoPrompt 自动链路承担
  // （锁定生效/回前台 400ms 弹 + unavailable 补弹 2 次）。用户取消系统弹窗后停在蒙层，
  // 点蒙层任意位置可重新触发认证（unlock 内部 promptingRef 去重，不会弹双框）；
  // 生物 3 次失败 → bioOnlyPin 自动进 PIN 圆点态（出路保留）
  const handleOverlayPress = () => {
    if (showPinEntryRef.current) return;
    void unlock().then((r) => {
      if (r === 'fail') bumpBioFail();
    });
  };
  // showPinEntry 在下方 if(locked) 之后才计算——用 ref 让容器 onPress 能读最新值
  const showPinEntryRef = useRef(false);
  showPinEntryRef.current = false;
  // PIN 兜底输入状态（就地实现，不引 PinSheet——避免 PinSheet↔本组件的循环依赖）
  const [pinEntry, setPinEntry] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState(false);

  useEffect(() => {
    // 失败次数达上限：自动切到 PIN 输入态（锁屏上不再显示"解锁"按钮）
    if (locked && bioOnlyPin) setPinEntry(true);
    if (!locked) {
      setPinEntry(false);
      setPinValue('');
      setPinError(false);
    }
  }, [locked, bioOnlyPin]);

  if (!locked) return null;

  // 达上限后本次锁定【只剩】PIN 解锁：即使 PIN 输入态被取消（pinEntry=false），
  // 也不回落到带"解锁"按钮的分支——否则 3 次上限可被"取消→手点解锁"绕过
  const showPinEntry = pinEntry || bioOnlyPin;
  showPinEntryRef.current = showPinEntry;

  const submitPin = async (pin: string) => {
    if (await verifyPin(pin)) {
      dismissLock();
      setPinEntry(false);
      setPinValue('');
      setPinError(false);
    } else {
      setPinError(true);
      setPinValue('');
    }
  };

  const handlePinDigit = (d: string) => {
    setPinError(false);
    const next = pinValue + d;
    if (next.length >= 6) {
      setPinValue(next);
      void submitPin(next);
    } else {
      setPinValue(next);
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={1}
      // TASK-021 终版（用户定版）：纯蒙面——不加 Logo/标题，双层半透明叠加让后方更模糊；
      // 点蒙层任意位置重新触发生物认证（PIN 态除外）
      onPress={handleOverlayPress}
      style={[StyleSheet.absoluteFill, styles.overlay]}
    >
      {/* 蒙面第 1 层：主题遮罩色（暗化） */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} pointerEvents="none" />
      {/* 蒙面第 2 层：bg 色半透（叠上去后方内容只剩隐约色块，等效更模糊） */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg + '99' }]} pointerEvents="none" />
      {showPinEntry ? (
        /* PIN 兜底输入：6 位圆点 + 隐形 TextInput 收系统数字键盘 */
        <View style={styles.pinBlock}>
          {bioOnlyPin && (
            <Text style={styles.pinOnlyHint}>{tr('lock.tooManyAttempts')}</Text>
          )}
          <View style={styles.pinDots}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.pinDot,
                  { borderColor: colors.link },
                  i < pinValue.length && { backgroundColor: colors.link },
                ]}
              />
            ))}
          </View>
          {pinError && <Text style={styles.pinError}>{tr('pin.wrong')}</Text>}
          <PinFallbackInput
            value={pinValue}
            onChange={(v) => {
              setPinError(false);
              setPinValue(v);
              if (v.length >= 6) void submitPin(v);
            }}
          />
          {!bioOnlyPin && hasPin && (
            <TouchableOpacity
              style={[styles.pinCancel, { borderColor: colors.dividerHair }]}
              onPress={() => {
                setPinEntry(false);
                setPinValue('');
                setPinError(false);
              }}
            >
              <Text style={[styles.pinCancelText, { color: colors.textSecondary }]}>{tr('common.cancel')}</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        /* 无按钮态：标题+Logo 已在容器头部（不透明遮罩页），生物认证弹窗由自动链路承担；
            用户取消系统弹窗后点蒙层任意位置重弹（容器 onPress） */
        <View />
      )}
    </TouchableOpacity>
  );
}

/** 隐形 PIN 收集输入框：进入兜底模式自动聚焦弹数字键盘，视觉上只显示圆点 */
function PinFallbackInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<TextInput>(null);
  useEffect(() => {
    // 等 Modal/覆盖层挂载完成后再聚焦
    const t = setTimeout(() => ref.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);
  return (
    <TextInput
      ref={ref}
      value={value}
      onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, 6))}
      keyboardType="number-pad"
      secureTextEntry
      textContentType="oneTimeCode"
      autoFocus
      style={styles.hiddenTextInput}
      accessibilityLabel="PIN input"
    />
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  // TASK-021 终版：lockLogoCircle/overlayTitle/overlaySubtitle 死样式已随 Logo+标题一并移除
  // TASK-021：unlockBtn/pinUnlockBtn 死样式已随"解锁"按钮一并移除
  pinBlock: { alignItems: 'center', marginTop: 28 },
  pinOnlyHint: {
    color: '#FB7185',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  pinDots: { flexDirection: 'row', gap: 14 },
  pinDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
  pinError: { color: '#FB7185', fontSize: 12, marginTop: 10 },
  pinCancel: {
    marginTop: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  pinCancelText: { fontSize: 13, fontWeight: '600' },
  // 隐形输入框：不占布局空间但可聚焦收键盘（视觉只显示圆点）
  hiddenTextInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
