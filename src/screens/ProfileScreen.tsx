import React, { useEffect, useMemo, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ROUTES } from '../navigation/routes';
import { useTheme } from '../theme/useTheme';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import { useThemeMode, ThemeMode } from '../context/ThemeModeContext';
import { ThemeColors } from '../theme/theme';
import SegmentedControl from '../components/SegmentedControl';
import PinSheet, { PinSheetMode } from '../components/PinSheet';
import { useDialog } from '../components/AppDialog';
import { useAuth } from '../context/AuthContext';
import { useAppLock } from '../context/AppLockContext';
import { useLanguage, LangMode } from '../i18n/LanguageContext';
import { useT } from '../i18n/LanguageContext';
import { hapticSelection } from '../utils/haptics';
import PressableScale from '../components/PressableScale';

type IconName = keyof typeof Ionicons.glyphMap;

export default function ProfileScreen({ navigation }: any) {
  const goBackToHome = () => {
    navigation.getParent()?.navigate(ROUTES.TAB_HOME);
  };

  const { colors } = useTheme();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  const { themeMode, setThemeMode } = useThemeMode();
  const { langMode, setLangMode } = useLanguage();
  const tr = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // ── 账号与同步 ──
  const { user, authInitializing, syncStatus, lastSyncAt } = useAuth();

  // 同步状态一句话：同步中 / 上次同步时间 / 尚未同步 / 失败
  // (错误文案 authErrorText 与 退出登录/立即同步 都已搬进"我的账户"账号页 AuthScreen)
  const syncText = !user
    ? tr('auth.syncHint')
    : syncStatus === 'syncing'
      ? tr('auth.syncing')
      : syncStatus === 'error'
        ? tr('auth.syncFailed')
        : lastSyncAt
          ? `${tr('auth.lastSync')} ${new Date(lastSyncAt).toLocaleString()}`
          : tr('auth.neverSynced');

  // 退出登录/立即同步已搬进"我的账户"账号页(AuthScreen)

  // ── Bio Lock（生物识别锁）：仅登录后可开启 ──
  const { bioEnabled, bioReady, setBioEnabled, hasPin, clearPin } = useAppLock();
  const dialog = useDialog();

  const applyBio = async (v: boolean) => {
    if (v && !bioReady) {
      dialog.alert({ title: tr('lock.bioToggle'), message: tr('lock.notReadyMsg') });
      return;
    }
    // 开启生物锁必须已有二级密码：没有就先走 PinSheet 创建，成功后自动开启（用户定版）
    if (v && !hasPin) {
      dialog.alert({ title: tr('lock.bioToggle'), message: tr('lock.needPinFirst') });
      bioPendingEnableRef.current = true;
      setPinSheetMode('create');
      setPinSheetVisible(true);
      return;
    }
    await setBioEnabled(v);
  };

  // ── 二级密码（6 位 PIN）：设置 / 更改 / 清除，统一走 PinSheet ──
  const [pinSheetVisible, setPinSheetVisible] = useState(false);
  const [pinSheetMode, setPinSheetMode] = useState<PinSheetMode>('create');
  // 「清除」意图标记：change 流程旧 PIN 验证通过后（onVerified）直接清除而非创建新 PIN
  const pinClearModeRef = useRef(false);
  // 「为开生物锁而创建 PIN」标记：PinSheet 创建成功后自动开启生物锁
  const bioPendingEnableRef = useRef(false);

  // 二级密码行：未设 → 直接进 create；已设 → 主题化弹窗选择「更改 / 清除」（用户定版）
  const handlePinRowPress = () => {
    if (!hasPin) {
      setPinSheetMode('create');
      setPinSheetVisible(true);
      return;
    }
    dialog.alert({
      title: tr('pin.settingsTitle'),
      message: tr('pin.chooseAction'),
      // 竖排按钮顺序（Verify 建议）：取消在上、常规操作居中、危险的红/清除放最下
      buttons: [
        { text: tr('common.cancel'), style: 'cancel' },
        { text: tr('pin.change'), style: 'default', onPress: openPinChange },
        {
          text: tr('pin.clear'),
          style: 'destructive',
          onPress: () => {
            // 清除前需验证原身份：走 change 流程（先验旧 PIN），验证通过后直接清除
            pinClearModeRef.current = true;
            setPinSheetMode('change');
            setPinSheetVisible(true);
          },
        },
      ],
    });
  };
  const openPinChange = () => {
    setPinSheetMode('change');
    setPinSheetVisible(true);
  };

  // 版本号读 app.json 的 expo.version，不硬编码
  const appVersion = (Constants.expoConfig?.version as string | undefined) ?? '1.0.0';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        {/* 返回键:与 AddTransaction 顶栏同款圆框设计(40×40、1.5px link 描边) */}
        <PressableScale
          onPress={goBackToHome}
          style={styles.backButton}
          activeScale={0.92}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </PressableScale>

        <Text style={styles.headerTitle}>{tr('profile.title')}</Text>

        <View style={styles.headerPlaceholder} />
      </View>

      {/* 加了账号登录表单后内容可能超过一屏，改成 ScrollView；
          keyboardShouldPersistTaps 让输入邮箱密码时点"登录"不 requiring 两次点击；
          onScroll 接滚动隐藏：下滑内容时底部菜单栏照常收起（之前漏接导致设置页不隐藏） */}
      <ScrollView
        style={{ flex: 1 }}
        onScroll={onTabScroll ?? undefined}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ padding: 20, paddingTop: 15, paddingBottom: tabClearance + 40 }}>
          {/* 0. 账户:邮箱入口 + 生物锁 + 语言 + 订阅,全部连在一张卡片里 */}
          <Text style={styles.firstSectionTitle}>{tr('auth.title')}</Text>
          <View style={styles.groupCard}>
            {authInitializing ? (
              // App 启动时正在恢复上次登录态，先不显示登录入口（避免闪一下"未登录"）
              <View style={styles.authPad}>
                <Text style={styles.rowSubtitle}>{tr('auth.busy')}</Text>
              </View>
            ) : user ? (
              <>
                {/* 邮箱行 = "我的账户"入口:点击进入账号页(头像/使用情况/立即同步/退出登录) */}
                <PressableScale
                  style={[styles.settingsRow, styles.settingsRowDivider]}
                  onPress={() => navigation.navigate(ROUTES.AUTH)}
                  activeScale={0.98}
                >
                  <View style={styles.iconChip}>
                    <Ionicons name="person-circle-outline" size={22} color={colors.link} />
                  </View>
                  <View style={styles.rowTextWrap}>
                    <Text style={styles.settingsRowText} numberOfLines={1}>
                      {user.email}
                    </Text>
                    <Text style={styles.rowSubtitle}>{syncText}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                </PressableScale>
                {/* Bio Lock：登录后可开启，开 App / 切后台回来时要求生物识别解锁。
                    TASK-021：行下展开选择改成行内分段开关（开启 | 关闭），applyBio 的
                    PIN 前置流程不变——点「开启」仍然先校验设备支持 + 已设二级密码 */}
                <View style={[styles.settingsRow, styles.settingsRowDivider]}>
                  <View style={styles.iconChip}>
                    <Ionicons name="finger-print-outline" size={22} color={colors.link} />
                  </View>
                  <View style={styles.rowTextWrap}>
                    <Text style={styles.settingsRowText}>{tr('lock.bioToggle')}</Text>
                  </View>
                  <SegmentedControl
                    options={[
                      { label: tr('lock.on'), value: '1' },
                      { label: tr('lock.off'), value: '0' },
                    ]}
                    selected={bioEnabled ? '1' : '0'}
                    onSelect={(v) => {
                      void applyBio(v === '1');
                    }}
                  />
                </View>

                {/* 二级密码（6 位 PIN）：删除账本等敏感操作前需验证。
                    单行入口：未设→直接设置；已设→主题化弹窗选择「更改/清除」（用户定版） */}
                <SettingsRow
                  icon="key-outline"
                  title={tr('pin.settingsTitle')}
                  value={hasPin ? tr('pin.setup') : tr('pin.none')}
                  onPress={handlePinRowPress}
                  colors={colors}
                />

                {/* 退出登录已搬进"我的账户"账号页(AuthScreen),这里不再重复 */}
                {/* 语言：行内分段开关（中 | 英，英文界面显示 CN | EN）——跟随系统选项去除，
                    旧存档 system 已在 LanguageProvider 启动时按设备语言迁移定死 */}
                <View style={[styles.settingsRow, styles.settingsRowDivider]}>
                  <View style={styles.iconChip}>
                    <Ionicons name="language-outline" size={22} color={colors.link} />
                  </View>
                  <View style={styles.rowTextWrap}>
                    <Text style={styles.settingsRowText}>{tr("profile.language")}</Text>
                  </View>
                  <SegmentedControl
                    options={[
                      { label: tr('lang.segZh'), value: 'zh' },
                      { label: tr('lang.segEn'), value: 'en' },
                    ]}
                    selected={langMode === 'system' ? 'zh' : langMode}
                    onSelect={(v) => {
                      setLangMode(v as LangMode);
                    }}
                  />
                </View>
                {/* 订阅：占位行，功能暂不开放（以后接 RevenueCat 时把 onPress 换成打开 Paywall） */}
                <SettingsRow
                  icon="star-outline"
                  title={tr("profile.subscribe")}
                  subtitle={tr("profile.subscribeSub")}
                  onPress={() => {}}
                  colors={colors}
                  isLast
                />
              </>
            ) : (
              // 未登录：跳转独立的登录/注册页面
              <SettingsRow
                icon="person-circle-outline"
                title={tr('auth.signInOrUp')}
                subtitle={tr('auth.subtitle')}
                onPress={() => navigation.navigate(ROUTES.AUTH)}
                colors={colors}
              />
            )}

            {/* 语言行的分段开关(未登录分支也会用到)——同登录分支，跟随系统已去除 */}
            {!user && !authInitializing && (
              <>
                <View style={[styles.settingsRow, styles.settingsRowDivider]}>
                  <View style={styles.iconChip}>
                    <Ionicons name="language-outline" size={22} color={colors.link} />
                  </View>
                  <View style={styles.rowTextWrap}>
                    <Text style={styles.settingsRowText}>{tr("profile.language")}</Text>
                  </View>
                  <SegmentedControl
                    options={[
                      { label: tr('lang.segZh'), value: 'zh' },
                      { label: tr('lang.segEn'), value: 'en' },
                    ]}
                    selected={langMode === 'system' ? 'zh' : langMode}
                    onSelect={(v) => {
                      setLangMode(v as LangMode);
                    }}
                  />
                </View>
                <SettingsRow
                  icon="star-outline"
                  title={tr("profile.subscribe")}
                  subtitle={tr("profile.subscribeSub")}
                  onPress={() => {}}
                  colors={colors}
                  isLast
                />
              </>
            )}
          </View>

          {/* 6. 深色模式：行内分段开关（日间 | 夜间）——跟随系统选项去除，
              旧存档 system 已在 ThemeModeProvider 启动时按设备外观迁移定死 */}
          <Text style={styles.sectionTitle}>{tr('profile.appearance')}</Text>
          <View style={styles.groupCard}>
            <View style={styles.settingsRow}>
              <View style={styles.iconChip}>
                <Ionicons name="moon-outline" size={22} color={colors.link} />
              </View>
              <View style={styles.rowTextWrap}>
                <Text style={styles.settingsRowText}>{tr("profile.darkMode")}</Text>
              </View>
              <SegmentedControl
                options={[
                  { label: tr('theme.segLight'), value: 'light' },
                  { label: tr('theme.segDark'), value: 'dark' },
                ]}
                selected={themeMode === 'system' ? 'light' : themeMode}
                onSelect={(v) => {
                  hapticSelection();
                  setThemeMode(v as ThemeMode);
                }}
              />
            </View>
          </View>

          {/* 财务规划：计划付款（固定支出自动扣账）入口 */}
          <Text style={styles.sectionTitle}>{tr('finance.title')}</Text>
          <View style={styles.groupCard}>
            <SettingsRow
              icon="pie-chart-outline"
              title={tr('finance.title')}
              onPress={() => navigation.navigate(ROUTES.FINANCE_PLAN)}
              colors={colors}
              isLast
            />
          </View>

          {/* 7. 支持：帮助与反馈 / 关于应用 */}
          <Text style={styles.sectionTitle}>{tr('profile.support')}</Text>
          <View style={styles.groupCard}>
            <SettingsRow
              icon="chatbubble-ellipses-outline"
              title={tr("profile.help")}
              onPress={() => navigation.navigate(ROUTES.FEEDBACK)}
              colors={colors}
            />
            {/* 手势诊断入口（临时）：定位账本弹层上滑滚不动，诊断完删除 */}
            <SettingsRow
              icon="build-outline"
              title="手势诊断（临时）"
              onPress={() => navigation.navigate('手势诊断' as never)}
              colors={colors}
            />
            <SettingsRow
              icon="information-circle-outline"
              title={tr("profile.about")}
              onPress={() => navigation.navigate(ROUTES.ABOUT)}
              colors={colors}
              isLast
            />
          </View>

          <Text style={styles.footerVersion}>Version {appVersion}</Text>
        </View>
      </ScrollView>

      {/* 二级密码键盘弹层：create=首次设置（不再要求生物识别前置）；change=先验旧 PIN（onVerified）再创建；
          验证通过且处于清除模式时直接清除 */}
      <PinSheet
        visible={pinSheetVisible}
        mode={pinSheetMode}
        onClose={() => {
          setPinSheetVisible(false);
          pinClearModeRef.current = false;
          bioPendingEnableRef.current = false;
        }}
        onSuccess={() => {
          // create/change 完成后无需额外处理（PinSheet 内部已 setPin）；
          // 若本轮是"为开生物锁而建 PIN"，建完自动开启
          if (bioPendingEnableRef.current) {
            bioPendingEnableRef.current = false;
            void setBioEnabled(true);
          }
        }}
        onVerified={() => {
          // change 模式旧 PIN 已验证：若本轮是「清除」意图则先同步关弹层，再异步清除存储
          if (pinClearModeRef.current) {
            pinClearModeRef.current = false;
            setPinSheetVisible(false);
            void (async () => {
              await clearPin();
              dialog.alert({ title: tr('pin.settingsTitle'), message: tr('pin.cleared') });
            })();
          }
        }}
      />
    </SafeAreaView>
  );
}

// 设置行：紫色图标芯片 + 标题 + 副标题 + 可选当前值 + ›（与原设置页同款视觉）
function SettingsRow({
  icon,
  title,
  subtitle,
  value,
  onPress,
  colors,
  isLast,
  expanded,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  value?: string;
  onPress: () => void;
  colors: ThemeColors;
  isLast?: boolean;
  /** 行下有内联展开内容时箭头朝上 */
  expanded?: boolean;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    /* PressableScale：按下整行微缩（0.98），activeOpacity=1 的原变暗反馈由缩放取代，视觉其余不变 */
    <PressableScale
      style={[styles.settingsRow, !isLast && styles.settingsRowDivider]}
      onPress={onPress}
      activeScale={0.98}
    >
      {!!icon && (
        <View style={[styles.iconChip, !!subtitle && styles.iconChipBoxed]}>
          <Ionicons name={icon} size={22} color={colors.link} />
        </View>
      )}
      <View style={styles.rowTextWrap}>
        <Text style={styles.settingsRowText}>{title}</Text>
        {!!subtitle && <Text style={styles.rowSubtitle}>{subtitle}</Text>}
      </View>
      {!!value && <Text style={styles.rowValue}>{value}</Text>}
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-forward'} size={16} color={colors.textTertiary} />
    </PressableScale>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1 },

    header: {
      // 与个人中心头部同款定位:高 56、左右 20,返回键位置完全一致
      height: 56,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
    },

    // 返回键:与 AddTransaction 顶栏同款圆框(40×40、1.5px link 描边、card 底)
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

    groupCard: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden' },
    // 小节标题：纯文字，下面直接跟一张组卡
    sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginTop: 20, marginBottom: 8 },
    // 页面第一个小节（账号与同步）不带额外上边距，紧贴内容区顶部的 20px padding
    firstSectionTitle: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 8 },
    // 行首紫色图标芯片（紫 8% 透明底 + 主题紫图标）
    iconChip: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.link + '14',
      marginRight: 12,
    },
    // 副标题行的芯片加同色描边框
    iconChipBoxed: {
      backgroundColor: colors.link + '14',
      borderWidth: 1.5,
      borderColor: colors.link + '55',
    },
    settingsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    settingsRowDivider: {
      borderBottomWidth: 1,
      borderBottomColor: colors.dividerHair,
    },
    rowTextWrap: { flex: 1 },
    settingsRowText: { fontSize: 15, color: colors.textPrimary, fontWeight: '600' },
    rowSubtitle: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
    // 行当前值：限宽 + 单行省略，长英文值（如 "Personal Finance"）不把 › 推出卡片
    rowValue: { fontSize: 13, color: colors.textSecondary, marginRight: 6, maxWidth: 130, flexShrink: 1 },

    footerVersion: { fontSize: 12, color: colors.textTertiary, textAlign: 'center', marginTop: 28 },

    // 账号区块：恢复登录态时的"请稍候"行内边距
    // 财务预算区块：标题行 + 进度/输入内容块（嵌在账号组卡内，位于生物识别与语言之间）
    barTrack: { height: 8, backgroundColor: colors.track, borderRadius: 4, overflow: 'hidden' },
    barFill: { height: 8, borderRadius: 4 },
    overBudget: { color: colors.expenseOver, fontSize: 12, marginTop: 6 },
    input: {
      backgroundColor: colors.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      padding: 10,
      fontSize: 14,
      color: colors.textPrimary,
    },
    smallSaveBtn: {
      backgroundColor: colors.textPrimary,
      borderRadius: 10,
      paddingHorizontal: 16,
      justifyContent: 'center',
      marginLeft: 8,
    },
    smallSaveBtnText: { color: colors.bg, fontWeight: '700', fontSize: 13 },
    authPad: { paddingHorizontal: 14, paddingVertical: 14 },
  });
}