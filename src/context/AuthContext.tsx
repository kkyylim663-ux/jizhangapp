import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';
import { INACTIVITY_LIMIT_MS } from '../config/supabaseConfig';
import { fullSync, getSyncState, subscribeSyncState, SyncStatus } from '../services/syncService';

// 距上次"上线"（打开 App）超过该时长 → 会话作废，要求重新登录
const LAST_ACTIVE_KEY = '@jizhang/lastActiveAt';

export interface AuthActionResult {
  ok: boolean;
  /** 失败原因：常见错误给稳定错误码（界面按码显示中英文），否则是原始错误消息 */
  error?: string;
  /** 原始错误详情（同步类错误弹窗副文展示，便于反馈定位） */
  detail?: string;
  /** 注册成功但项目开了"邮箱验证"：需要用户先去邮箱点验证链接再登录 */
  needsConfirm?: boolean;
}

interface AuthContextValue {
  user: User | null;
  /** App 启动时正在恢复上次登录态（期间界面不要急着显示未登录） */
  authInitializing: boolean;
  /** 因连续 14 天未打开 App 被自动登出（AuthScreen 显示横幅提示） */
  sessionExpired: boolean;
  signIn: (email: string, password: string) => Promise<AuthActionResult>;
  signUp: (email: string, password: string) => Promise<AuthActionResult>;
  signOut: () => Promise<void>;
  syncStatus: SyncStatus;
  lastSyncAt: number | null;
  /** 手动"立即同步"：拉取云端并合并 → 推送本地 */
  syncNow: () => Promise<AuthActionResult>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Supabase 原始报错是英文，映射成稳定错误码让界面做中英文提示
function mapAuthError(message: string): string {
  const m = (message || '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'invalid_credentials';
  if (m.includes('already registered') || m.includes('already been registered')) return 'email_taken';
  if (m.includes('email not confirmed')) return 'email_not_confirmed';
  if (m.includes('email logins are disabled') || m.includes('signups not allowed')) return 'email_provider_disabled';
  if (m.includes('at least 6') || m.includes('password should be')) return 'weak_password';
  if (m.includes('rate limit') || m.includes('too many')) return 'rate_limited';
  if (m.includes('fetch failed') || m.includes('network') || m.includes('timeout')) return 'network';
  return message;
}

/**
 * 账号认证 Context：注册 / 登录 / 退出 / 重启自动恢复登录态。
 * 登录态变化后的数据同步由 useSyncManager 触发，这里只管身份。
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authInitializing, setAuthInitializing] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [syncState, setSyncState] = useState(getSyncState());
  // AppState 回调里判断"当前是否登录"用的最新会话引用
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    const markActive = () => AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())).catch(() => {});

    // 恢复上次登录态（会话存在 AsyncStorage 里）
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        // 安全要求：连续 14 天没打开过 App → 会话作废，要求重新登录。
        // lastActiveAt 缺失 = 本次更新前登录的老会话，宽限一次（记为现在），不把人踢下线
        const last = await AsyncStorage.getItem(LAST_ACTIVE_KEY).catch(() => null);
        if (last != null && Date.now() - Number(last) > INACTIVITY_LIMIT_MS) {
          await supabase.auth.signOut();
          setSessionExpired(true);
        } else {
          await markActive();
        }
      }
      setSession(data.session);
      setAuthInitializing(false);
    })();

    // 登录 / 退出 / token 刷新等所有认证状态变化统一走这里
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    // 每次回到 App（上线）都刷新活跃时间；
    // 前后台启停 token 自动刷新（RN 无页面聚焦概念，官方推荐模式）：
    // 后台 JS timer 可能被系统冻结，刷新请求发不出去 → 回前台先补一次刷新再放行同步
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (sessionRef.current) void markActive();
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    });

    const unsubSync = subscribeSyncState(() => setSyncState(getSyncState()));
    return () => {
      subscription.unsubscribe();
      appStateSub.remove();
      unsubSync();
    };
  }, []);

  const user = session?.user ?? null;

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { ok: false, error: mapAuthError(error.message) };
    await AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())).catch(() => {});
    setSessionExpired(false);
    return { ok: true };
  };

  const signUp: AuthContextValue['signUp'] = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) return { ok: false, error: mapAuthError(error.message) };
    // 没有返回会话 = Supabase 开了邮箱验证，注册成功但要先去邮箱点验证链接
    if (!data.session) return { ok: true, needsConfirm: true };
    await AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())).catch(() => {});
    setSessionExpired(false);
    return { ok: true };
  };

  const signOut: AuthContextValue['signOut'] = async () => {
    // 只退出登录，本机数据保留（离线照常用）；下次登录同账号会自动合并
    await supabase.auth.signOut();
    setSessionExpired(false);
  };

  const syncNow: AuthContextValue['syncNow'] = async () => {
    const r = await fullSync();
    return r.ok ? { ok: true } : { ok: false, error: r.error, detail: r.detail };
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        authInitializing,
        sessionExpired,
        signIn,
        signUp,
        signOut,
        syncStatus: syncState.status,
        lastSyncAt: syncState.lastSyncAt,
        syncNow,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth必须在AuthProvider内部使用');
  return ctx;
}
