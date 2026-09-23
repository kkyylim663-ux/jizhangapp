import React, { useEffect, useMemo, useRef, useState } from 'react';
import {View, Text, StyleSheet, TouchableOpacity, TextInput, Image, ScrollView, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../theme/useTheme';
import { ThemeColors } from '../theme/theme';
import { useT } from '../i18n/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { useDialog } from '../components/AppDialog';
import PressableScale from '../components/PressableScale';

type Mode = 'signin' | 'signup';

const AVATAR_STORAGE_KEY = '@jizhang/avatar';
const FIRST_USE_STORAGE_KEY = '@jizhang/firstUseDate';

// Supabase 错误码 → 当前语言提示（错误码来自 AuthContext.mapAuthError）
function authErrorText(code: string | undefined, tr: (k: string) => string): string {
  switch (code) {
    case 'invalid_credentials':
      return tr('auth.errInvalidCredentials');
    case 'email_taken':
      return tr('auth.errEmailTaken');
    case 'email_not_confirmed':
      return tr('auth.errEmailNotConfirmed');
    case 'email_provider_disabled':
      return tr('auth.errEmailProviderDisabled');
    case 'weak_password':
      return tr('auth.errWeakPassword');
    case 'rate_limited':
      return tr('auth.errRateLimited');
    case 'network':
      return tr('auth.errNetwork');
    default:
      return code || tr('auth.errUnknown');
  }
}

// 云同步错误码 → 当前语言提示（错误码来自 syncService 的稳定错误码）
function syncErrorText(code: string | undefined, tr: (k: string) => string): string {
  switch (code) {
    case 'network':
      return tr('sync.errNetwork');
    case 'auth':
      return tr('sync.errAuth');
    case 'constraint':
      return tr('sync.errConstraint');
    case 'server':
      return tr('sync.errServer');
    case 'local_data_corrupt':
      return tr('sync.errCorrupt');
    case 'not_logged_in':
      return tr('sync.errNotLoggedIn');
    default:
      return tr('sync.errUnknown');
  }
}

/**
 * 我的账户页（原"登录/注册"页升级）：
 * - 未登录 → 显示登录/注册表单；
 * - 已登录 → 显示个人中心内容（头像/邮箱/使用情况），底部"退出登录"按钮。
 * 从设置项的「我的账户」或「账号与同步」进入。
 */
export default function AuthScreen({ navigation }: any) {
  const { colors } = useTheme();
  const tr = useT();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { signIn, signUp, signOut, sessionExpired, user, syncStatus, lastSyncAt, syncNow } = useAuth();
  const { transactions, ledgers, activeLedgerId } = useApp();

  // 立即同步(自设置页"账号与同步"迁入):手动触发一次云端备份
  const [syncBusy, setSyncBusy] = useState(false);
  const handleSyncNow = async () => {
    if (syncBusy || syncStatus === 'syncing') return;
    setSyncBusy(true);
    const r = await syncNow();
    setSyncBusy(false);
    if (!r.ok) {
      if (r.error === 'sync_in_progress') return; // 已在同步中，不打扰
      dialog.alert({
        title: tr('sync.errTitle'),
        message: syncErrorText(r.error, tr) + (r.detail ? `\n\n${String(r.detail).slice(0, 160)}` : ''),
      });
    }
  };

  // 同步状态一句话:同步中 / 上次同步时间 / 尚未同步 / 失败
  const syncText =
    syncStatus === 'syncing'
      ? tr('auth.syncing')
      : syncStatus === 'error'
        ? tr('auth.syncFailed')
        : lastSyncAt
          ? `${tr('auth.lastSync')} ${new Date(lastSyncAt).toLocaleString()}`
          : tr('auth.neverSynced');

  // ---------------------------------------------------------
  // 已登录：个人中心内容（头像/使用情况,自 PersonalCenterScreen 迁移）
  // ---------------------------------------------------------

  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [useDays, setUseDays] = useState<number | null>(null);
  const avatarLoadedRef = useRef(false);

  // 头像（base64 存 AsyncStorage）+ 首次使用日期（算"使用天数"）
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(AVATAR_STORAGE_KEY);
        if (saved) setAvatarUri(saved);
        let firstUse = await AsyncStorage.getItem(FIRST_USE_STORAGE_KEY);
        if (!firstUse) {
          firstUse = new Date().toISOString().slice(0, 10);
          await AsyncStorage.setItem(FIRST_USE_STORAGE_KEY, firstUse);
        }
        const days = Math.floor((Date.now() - new Date(`${firstUse}T00:00:00`).getTime()) / 86400000) + 1;
        setUseDays(Math.max(days, 1));
        avatarLoadedRef.current = true;
      } catch (e) {
        console.warn('个人中心数据读取失败', e);
        avatarLoadedRef.current = true;
      }
    })();
  }, []);

  // 点头像 → 相册选一张 → 裁成方形 → base64 持久化
  const pickAvatar = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        dialog.alert({ title: tr('addTx.pcPhotoTitle'), message: tr('addTx.pcPhotoMsg') });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.4,
        base64: true,
      });
      if (result.canceled || !result.assets[0]?.base64) return;
      const uri = `data:image/jpeg;base64,${result.assets[0].base64}`;
      await AsyncStorage.setItem(AVATAR_STORAGE_KEY, uri);
      setAvatarUri(uri);
    } catch (e) {
      dialog.alert({ title: tr('addTx.pickPhotoFailed'), message: tr('addTx.pickPhotoMsg') });
    }
  };

  // 记账天数：当前账本里出现过交易记录的去重日期数
  const bookkeepingDays = useMemo(() => {
    const days = new Set(
      transactions.filter((t) => t.ledgerId === activeLedgerId).map((t) => t.date)
    );
    return days.size;
  }, [transactions, activeLedgerId]);

  const handleSignOut = () => {
    dialog.alert({
      title: tr('auth.logout'),
      message: tr('auth.logoutConfirmMsg'),
      buttons: [
        { text: tr('common.cancel'), style: 'cancel' },
        { text: tr('auth.logout'), style: 'destructive', onPress: () => void signOut() },
      ],
    });
  };

  // ---------------------------------------------------------
  // 未登录：登录/注册表单
  // ---------------------------------------------------------

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // Supabase 密码最低 6 位；登录时同样要求（真密码不可能短于 6 位）
  const canSubmit = !!email.trim() && password.length >= 6 && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const r = mode === 'signin' ? await signIn(email, password) : await signUp(email, password);
    setBusy(false);
    if (!r.ok) {
      dialog.alert({ title: authErrorText(r.error, tr) });
      return;
    }
    if (r.needsConfirm) {
      // 兜底：以后若在 Supabase 重新开启邮箱验证，注册后会走到这里
      dialog.alert({ title: tr('auth.signedUpNeedsConfirm') });
      return;
    }
    // 成功：留在本页,user 状态切换后自动变为"个人中心"视图
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}
    >
      <View style={styles.header}>
        {/* 返回键:与设置项/记一笔同款圆框设计(40×40、1.5px link 描边) */}
        <PressableScale onPress={() => navigation.goBack()} style={styles.backButton} activeScale={0.92}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </PressableScale>
        <Text style={styles.headerTitle}>
          {user ? tr('addTx.pageMyAccount') : tr('auth.pageTitle')}
        </Text>
        <View style={styles.headerPlaceholder} />
      </View>

      {user ? (
        // ============ 已登录:个人中心内容 ============
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.profileWrap} showsVerticalScrollIndicator={false}>
          {/* 头像：点击换自己的照片 */}
          <PressableScale
            style={[styles.avatar, { backgroundColor: colors.avatarBg }]}
            activeScale={0.95}
            onPress={pickAvatar}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <Ionicons name="person-outline" size={42} color={colors.icon} />
            )}
            <View style={[styles.avatarEditBadge, { backgroundColor: colors.fabBg, borderColor: colors.card }]}>
              <Ionicons name="camera-outline" size={13} color={colors.fabIcon} />
            </View>
          </PressableScale>
          <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>
            {user.email}
          </Text>
          <Text style={[styles.sub, { color: colors.textTertiary }]}>Personal Finance</Text>

          <Text style={[styles.section, { color: colors.textTertiary }]}>{tr('addTx.usage')}</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.dividerHair }]}>
            <Info label={tr('addTx.bookkeepingDays')} value={tr('addTx.daysUnit', { n: bookkeepingDays })} colors={colors} styles={styles} />
            <Info label={tr('addTx.usedDays')} value={useDays !== null ? tr('addTx.daysUnit', { n: useDays }) : '--'} colors={colors} styles={styles} />
            <Info label={tr('addTx.ledgerCount')} value={tr('addTx.countUnit', { n: ledgers.length })} colors={colors} styles={styles} />
          </View>

          {/* 云同步:状态与"立即同步"合并成一行——显示状态一句话,点击即触发同步;选择框与退出登录按钮同尺寸 */}
          <Text style={[styles.section, { color: colors.textTertiary }]}>{tr('auth.title')}</Text>
          <View style={styles.syncCard}>
            <PressableScale
              style={styles.syncNowRow}
              activeScale={0.97}
              onPress={handleSyncNow}
              disabled={syncBusy || syncStatus === 'syncing'}
            >
              <Ionicons name="cloud-upload-outline" size={18} color={colors.link} />
              <View style={styles.syncNowTextWrap}>
                <Text style={[styles.infoLabel, { color: colors.textPrimary }]}>
                  {syncBusy || syncStatus === 'syncing' ? tr('auth.syncing') : tr('auth.syncNow')}
                </Text>
                <Text style={{ color: colors.textTertiary, fontSize: 12 }} numberOfLines={1}>
                  {syncText}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
            </PressableScale>
          </View>

          {/* 退出登录:红色整宽按钮,点击确认后登出(登出后自动切回登录表单视图) */}
          <PressableScale style={styles.logoutBtn} activeScale={0.95} onPress={handleSignOut}>
            <Ionicons name="log-out-outline" size={18} color={colors.expenseOver} />
            <Text style={[styles.logoutBtnText, { color: colors.expenseOver }]}>{tr('auth.logout')}</Text>
          </PressableScale>
        </ScrollView>
      ) : (
        // ============ 未登录:登录/注册表单 ============
        <View style={{ padding: 20 }}>
          {/* 14 天未上线被强制登出后的提示横幅 */}
          {sessionExpired && (
            <View style={styles.expiredBanner}>
              <Ionicons name="time-outline" size={18} color={colors.expenseOver} />
              <Text style={styles.expiredBannerText}>{tr('auth.expiredBanner')}</Text>
            </View>
          )}

          {/* 登录 / 注册模式切换 */}
          <View style={styles.modeSwitch}>
            {(['signin', 'signup'] as Mode[]).map((m) => (
              <PressableScale
                key={m}
                style={[styles.modeOption, mode === m && styles.modeOptionActive]}
                activeScale={0.97}
                onPress={() => setMode(m)}
              >
                <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>
                  {m === 'signin' ? tr('auth.modeSignIn') : tr('auth.modeSignUp')}
                </Text>
              </PressableScale>
            ))}
          </View>

          <Text style={styles.subtitle}>{tr('auth.subtitle')}</Text>

          <TextInput
            style={styles.authInput}
            value={email}
            onChangeText={setEmail}
            placeholder={tr('auth.emailPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.authInput}
            value={password}
            onChangeText={setPassword}
            placeholder={tr('auth.passwordPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            autoCapitalize="none"
          />

          <PressableScale
            style={[styles.primaryBtn, !canSubmit && styles.primaryBtnDisabled]}
            activeScale={0.97}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            <Text style={styles.primaryBtnText}>
              {busy ? tr('auth.busy') : mode === 'signin' ? tr('auth.signIn') : tr('auth.signUp')}
            </Text>
          </PressableScale>

          <PressableScale
            style={styles.switchModeBtn}
            activeScale={0.95}
            onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          >
            <Text style={styles.switchModeText}>
              {mode === 'signin' ? tr('auth.switchToSignUp') : tr('auth.switchToSignIn')}
            </Text>
          </PressableScale>
        </View>
      )}
    </SafeAreaView>
  );
}

function Info({ label, value, colors, styles }: any) {
  return (
    <View style={styles.info}>
      <Text style={[styles.infoLabel, { color: colors.textPrimary }]}>{label}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 14 }}>{value}</Text>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1 },

    header: {
      height: 56,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: colors.link,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 8,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    headerPlaceholder: {
      width: 40,
    },

    // ============ 已登录:个人中心 ============
    profileWrap: {
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 24,
      paddingBottom: 40,
    },
    avatar: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImage: { width: 88, height: 88 },
    avatarEditBadge: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
    },
    name: { fontSize: 20, fontWeight: '700', marginTop: 14, maxWidth: '90%' },
    sub: { fontSize: 13, marginTop: 5 },
    section: { width: '100%', fontSize: 12, fontWeight: '600', marginTop: 28, marginBottom: 9 },
    card: { width: '100%', borderWidth: 1, borderRadius: 16, paddingHorizontal: 16 },
    info: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    infoLabel: { fontSize: 15, fontWeight: '500' },
    // 立即同步行:一行合并状态+动作——图标 + 标题/状态 + 箭头,点击即同步
    // 外框与"退出登录"按钮同尺寸(minHeight 52、圆角 14、1px 描边、card 底)
    syncCard: {
      width: '100%',
      minHeight: 52,
      justifyContent: 'center',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    syncNowRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    syncNowTextWrap: { flex: 1 },

    logoutBtn: {
      width: '100%',
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.expenseOver + '55',
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 14,
      marginTop: 20,
    },
    logoutBtnText: { fontSize: 15, fontWeight: '700' },

    // ============ 未登录:登录/注册表单 ============
    // 14 天未登录横幅：暖色底 + 描边
    expiredBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.expenseOver + '14',
      borderWidth: 1,
      borderColor: colors.expenseOver + '55',
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 16,
    },
    expiredBannerText: { flex: 1, fontSize: 12, color: colors.expenseOver, lineHeight: 17 },

    // 登录/注册 分段切换
    modeSwitch: {
      flexDirection: 'row',
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 4,
      marginBottom: 14,
    },
    modeOption: {
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      borderRadius: 9,
      borderWidth: 1.5,
      borderColor: 'transparent',
    },
    modeOptionActive: {
      backgroundColor: colors.link + '14',
      borderColor: colors.link,
    },
    modeText: { fontSize: 15, fontWeight: '700', color: colors.textTertiary },
    modeTextActive: { color: colors.link },

    subtitle: { fontSize: 12, color: colors.textTertiary, marginBottom: 14, lineHeight: 17 },

    authInput: {
      borderWidth: 1,
      borderColor: colors.dividerHair,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.textPrimary,
      marginBottom: 10,
    },

    primaryBtn: {
      backgroundColor: colors.link,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 2,
    },
    primaryBtnDisabled: { opacity: 0.45 },
    primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

    switchModeBtn: { alignItems: 'center', paddingVertical: 12 },
    switchModeText: { color: colors.link, fontSize: 14, fontWeight: '600' },
  });
}
