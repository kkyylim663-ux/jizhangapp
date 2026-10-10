// ProfileScreen.tsx —— 设置页（T22 / 计划 5.6 P1–P4）
//
// 本次只改展示与交互反馈（功能冻结：登录、PIN、生物识别、语言、外观、财务规划、
// 帮助、关于的入口与跳转全部照旧；二级密码流程、生物锁前置校验、同步文案计算一字未动）：
//   P1 页头改 Tab 根页大标题「设置」（去掉返回键）+ 顶部账户卡（头像 + 邮箱/登录入口 + 同步状态）
//   P2 整页改 ListSection / ListRow 分组：安全（生物识别锁 Switch + 二级密码）、
//      外观（深色模式三选一，整行）、通用（语言 中/EN）、订阅、财务规划、支持
//   P3 订阅改不可点的灰色行 +「即将推出」Badge（去掉 chevron）
//   P4 页脚版本号改 caption 档、居中

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ROUTES } from '../navigation/routes';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import { useThemeMode, ThemeMode } from '../context/ThemeModeContext';
import type { Layout, Radius, SemanticColors, Spacing } from '../theme/theme';
import SegmentedControl from '../components/SegmentedControl';
import PinSheet, { PinSheetMode } from '../components/PinSheet';
import { useDialog } from '../components/AppDialog';
import { useAuth } from '../context/AuthContext';
import { useAppLock } from '../context/AppLockContext';
import { useLanguage, LangMode } from '../i18n/LanguageContext';
import { useT } from '../i18n/LanguageContext';
import { hapticSelection } from '../utils/haptics';
import { AppText, Badge, Card, ListRow, ListSection, ScreenHeader, Switch } from '../components/ui';

export default function ProfileScreen({ navigation }: any) {
  const { semantic, spacing, layout } = useTheme();
  const { pagePadding, contentMaxWidth, rowMinHeight } = useLayout();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  const { themeMode, setThemeMode } = useThemeMode();
  const { langMode, setLangMode } = useLanguage();
  const tr = useT();
  const styles = useMemo(
    () => makeStyles(semantic, spacing, layout, rowMinHeight),
    [semantic, spacing, layout, rowMinHeight]
  );
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
      <ScrollView
        onScroll={onTabScroll ?? undefined}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={
          contentMaxWidth ? { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' } : undefined
        }
        contentContainerStyle={{ paddingBottom: tabClearance + spacing.huge }}
      >
        <View style={{ paddingHorizontal: pagePadding }}>
          {/* P1 页头：Tab 根页大标题（无返回键 —— 根页不该有返回） */}
          <ScreenHeader variant="root" title={tr('profile.title')} padded={false} testID="profile-header" />

          {/* P1 顶部账户卡：头像 + 邮箱（未登录时是「登录 / 注册」）+ 同步状态；点击仍进原账号页 */}
          <Card
            padded={false}
            onPress={authInitializing ? undefined : () => navigation.navigate(ROUTES.AUTH)}
            accessibilityLabel={
              authInitializing
                ? tr('auth.busy')
                : user
                  ? `${tr('auth.title')} ${user.email}`
                  : tr('auth.signInOrUp')
            }
            testID="profile-account-card"
          >
            <View style={styles.accountRow}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={24} color={semantic.accentText} />
              </View>
              <View style={styles.accountTextBlock}>
                <AppText variant="headline" numberOfLines={2}>
                  {authInitializing ? tr('auth.busy') : user ? user.email : tr('auth.signInOrUp')}
                </AppText>
                {/* 副行：登录后是同步状态一句话；未登录是登录说明。说明文字随内容换行（不截断） */}
                {!authInitializing && (
                  <AppText variant="footnote" color={semantic.textSecondary} style={styles.accountSub}>
                    {user ? syncText : tr('auth.subtitle')}
                  </AppText>
                )}
              </View>
              <Ionicons name="chevron-forward" size={16} color={semantic.textTertiary} />
            </View>
          </Card>

          {/* P2 安全分组（登录后可见）：生物识别锁改 Switch；二级密码保留「当前值 + chevron」 */}
          {!authInitializing && user && (
            <ListSection title={tr('profile.security')} style={styles.section}>
              <SwitchRow
                icon="finger-print-outline"
                title={tr('lock.bioToggle')}
                subtitle={tr('lock.bioHint')}
                value={bioEnabled}
                onValueChange={(v) => {
                  void applyBio(v);
                }}
                testID="profile-bio-row"
              />
              <ListRow
                icon="key-outline"
                title={tr('pin.settingsTitle')}
                value={hasPin ? tr('pin.setup') : tr('pin.none')}
                chevron
                onPress={handlePinRowPress}
                testID="profile-pin-row"
              />
            </ListSection>
          )}

          {/* 外观分组：只放深色模式（语言不属于外观，见下「通用」分组） */}
          <ListSection title={tr('profile.appearance')} style={styles.section}>
            <AppearanceRow label={tr('profile.darkMode')}>
              <FullWidthSegments
                options={[
                  { label: tr('theme.segSystem'), value: 'system' },
                  { label: tr('theme.segLight'), value: 'light' },
                  { label: tr('theme.segDark'), value: 'dark' },
                ]}
                selected={themeMode}
                // 震动由控件内部发（切档时 selection 一次），这里不再重复触发
                onSelect={(v) => setThemeMode(v as ThemeMode)}
                testID="profile-theme-segments"
              />
            </AppearanceRow>
          </ListSection>

          {/* 通用分组：语言（中 / EN 分段在行右侧） */}
          <ListSection title={tr('profile.general')} style={styles.section}>
            <ListRow
              icon="language-outline"
              title={tr('profile.language')}
              trailing={
                <SegmentedControl
                  options={[
                    { label: tr('lang.segZh'), value: 'zh' },
                    { label: tr('lang.segEn'), value: 'en' },
                  ]}
                  selected={langMode === 'system' ? 'zh' : langMode}
                  onSelect={(v) => setLangMode(v as LangMode)}
                />
              }
              testID="profile-language-row"
            />
          </ListSection>

          {/* 无标题分组：订阅（不可点，P3）+ 财务规划入口（跳转不变）。
              财务规划不再单独起同名分组标题（验收退回第 2 条：标题与唯一一行同名 = 重复） */}
          <ListSection style={styles.section}>
            <ListRow
              icon="star-outline"
              title={tr('profile.subscribe')}
              trailing={<Badge label={tr('profile.subscribeSub')} />}
              disabled
              testID="profile-subscribe-row"
            />
            <ListRow
              icon="pie-chart-outline"
              title={tr('finance.title')}
              chevron
              onPress={() => navigation.navigate(ROUTES.FINANCE_PLAN)}
              testID="profile-finance-row"
            />
          </ListSection>

          {/* 支持：帮助与反馈 / 关于应用 */}
          <ListSection title={tr('profile.support')} style={styles.section}>
            <ListRow
              icon="chatbubble-ellipses-outline"
              title={tr('profile.help')}
              chevron
              onPress={() => navigation.navigate(ROUTES.FEEDBACK)}
            />
            <ListRow
              icon="information-circle-outline"
              title={tr('profile.about')}
              chevron
              onPress={() => navigation.navigate(ROUTES.ABOUT)}
            />
          </ListSection>

          {/* P4 页脚版本号：caption 档、居中 */}
          <AppText variant="caption" color={semantic.textTertiary} align="center" style={styles.footer}>
            Version {appVersion}
          </AppText>
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

/**
 * 外观行整行三选一（页面内自建 —— 验收退回「撑满整行」+ 验收口径第 1 条）。
 * 为什么不用 SegmentedControl：它的 touchWrap 是 `alignSelf: 'flex-start'`（内容宽度），
 * 父级怎么包 flex 都撑不开（align-self 覆盖父级 align-items，已实测：三种包法都无效）；
 * 撑满要靠组件自己的 stretch 档，而该档在车道 B（ui/add）分支、尚未合并，本车道又不改该文件。
 * 所以这里按同一套规格自建一个「整行三等分」版本：
 *   槽 hairline 底 + radius.full + 36 高 + 内衬 3、滑块 accent 实底、文字 footnote
 *   （选中 onAccent/600、未选中 textSecondary/400）、触控高 44、首帧不播动画、
 *   切档 selection 震动、读屏报「已选中」—— 与 SegmentedControl 逐项一致，只多一个「段等分撑满」。
 * ⚠ 车道 B 的 stretch 合并后，本组件可以删掉、换回 <SegmentedControl stretch … />。
 */
/** 槽内边距（与 SegmentedControl 同规格：滑块贴槽内缘 3） */
const SEG_TRACK_PADDING = 3;
/** 槽高（与 SegmentedControl 同规格） */
const SEG_TRACK_HEIGHT = 36;
/** 触控区高度下限（UI_RULES：可点元素 ≥44pt） */
const SEG_TOUCH_HEIGHT = 44;

function FullWidthSegments({
  options,
  selected,
  onSelect,
  testID,
}: {
  options: { label: string; value: string }[];
  selected: string;
  onSelect: (value: string) => void;
  testID?: string;
}) {
  const { semantic, radius, motion } = useTheme();
  const segStyles = useMemo(() => makeSegStyles(semantic, radius), [semantic, radius]);

  // 段宽靠槽实测宽等分（每段 flex:1，等宽是结构决定的，不需要逐段实测）
  const [trackWidth, setTrackWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === selected)
  );
  const segWidth = trackWidth > 0 ? (trackWidth - SEG_TRACK_PADDING * 2) / options.length : 0;
  const ready = segWidth > 0;

  const thumbX = useSharedValue(0);
  const thumbWidth = useSharedValue(0);
  const thumbOpacity = useSharedValue(0);
  const positioned = useRef(false);

  useEffect(() => {
    if (!ready) return;
    const targetX = SEG_TRACK_PADDING + index * segWidth;
    // 首帧（槽宽刚测到）：不播动画直接落位再淡入，避免滑块从 0 位滑过去
    if (!positioned.current) {
      positioned.current = true;
      thumbX.value = targetX;
      thumbWidth.value = segWidth;
      thumbOpacity.value = withTiming(1, { duration: motion.timing.fade, easing: motion.easing.out });
      return;
    }
    // 动画中再点：withSpring 直接改目标（Reanimated 重定向），不卡死、不重复触发
    thumbX.value = withSpring(targetX, motion.spring.default);
    thumbWidth.value = withSpring(segWidth, motion.spring.default);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, index, segWidth]);

  const thumbStyle = useAnimatedStyle(() => ({
    width: thumbWidth.value,
    opacity: thumbOpacity.value,
    transform: [{ translateX: thumbX.value }],
  }));

  return (
    <View style={segStyles.touch} testID={testID}>
      <View
        style={segStyles.track}
        onLayout={(e) => {
          const w = Math.round(e.nativeEvent.layout.width);
          if (w !== trackWidth) setTrackWidth(w);
        }}
      >
        <Animated.View style={[segStyles.thumb, thumbStyle]} pointerEvents="none" />
        {options.map((opt) => {
          const isActive = opt.value === selected;
          return (
            <TouchableOpacity
              key={opt.value}
              style={segStyles.segment}
              activeOpacity={0.75}
              onPress={() => {
                if (!isActive) hapticSelection();
                onSelect(opt.value);
              }}
              accessibilityRole="button"
              accessibilityLabel={opt.label}
              accessibilityState={{ selected: isActive }}
            >
              <AppText
                variant="footnote"
                weight={isActive ? '600' : '400'}
                color={isActive ? semantic.onAccent : semantic.textSecondary}
                align="center"
                numberOfLines={1}
              >
                {opt.label}
              </AppText>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/** 分段控件外观（与 SegmentedControl 同规格；颜色 / 圆角全部取令牌） */
function makeSegStyles(semantic: SemanticColors, radius: Radius) {
  return StyleSheet.create({
    // 外侧留白：把触控区从 36 撑到 44，视觉轨道仍是 36（同 SegmentedControl）
    touch: { paddingVertical: (SEG_TOUCH_HEIGHT - SEG_TRACK_HEIGHT) / 2 },
    track: {
      flexDirection: 'row',
      backgroundColor: semantic.hairline,
      borderRadius: radius.full,
      padding: SEG_TRACK_PADDING,
      minHeight: SEG_TRACK_HEIGHT,
      alignItems: 'center',
    },
    thumb: {
      position: 'absolute',
      top: SEG_TRACK_PADDING,
      bottom: SEG_TRACK_PADDING,
      left: 0,
      borderRadius: radius.full,
      backgroundColor: semantic.accent,
    },
    // 段等分撑满：3 档各占槽宽 1/3（共享件的 stretch 档同款写法）
    segment: {
      flex: 1,
      minHeight: SEG_TRACK_HEIGHT - SEG_TRACK_PADDING * 2,
      paddingHorizontal: SEG_TRACK_PADDING,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}

/**
 * 外观行（页面内自建 —— 验收口径第 1 条允许在 ListRow 表达不了布局时页内用令牌自建行）。
 * 为什么不用 ListRow：ListRow 的三块结构是「同一行的左中右」，表达不了这里要求的两行结构
 * （标签一行 + 控件另起一行占满整行）。行规格与 ListRow 完全一致：
 * minHeight = useLayout().rowMinHeight、内边距 layout.card / spacing.md、20pt 图标 + headline 标题。
 */
function AppearanceRow({ label, children }: { label: string; children: React.ReactNode }) {
  const { semantic, spacing, layout } = useTheme();
  const { rowMinHeight } = useLayout();
  const styles = useMemo(
    () => makeStyles(semantic, spacing, layout, rowMinHeight),
    [semantic, spacing, layout, rowMinHeight]
  );
  return (
    <View style={styles.appearanceRow}>
      <View style={styles.appearanceHeader}>
        <Ionicons name="moon-outline" size={20} color={semantic.accentText} />
        <AppText variant="headline">{label}</AppText>
      </View>
      {/* 控件层：竖排容器 —— 整行三选一自己撑满（见 FullWidthSegments 注释） */}
      <View style={styles.appearanceControl}>{children}</View>
    </View>
  );
}

/**
 * 开关行（页面内自建 —— 验收口径第 1 条：ListRow 表达不了布局时页内用令牌自建行）。
 * 为什么不用 ListRow：ListRow 的三块排布是「一行 flexWrap + space-between」——
 * 副标题一长（英文 "Require fingerprint/face when opening the app" 在 360 宽超过一行所能容纳），
 * 整块右侧内容会被挤到下一行，Switch 掉到左对齐的第四行，观感是坏的。
 * 这里改成「文字块 flex:1（自己换行、允许变高）+ Switch flexShrink:0（永远贴右）」，
 * 与 TransactionRow 的中栏同思路；行规格与 ListRow 一致（minHeight / layout.card / spacing.md、
 * 20pt 行首图标）。窄屏 + 英文 + 系统大字下都不会错位。
 */
function SwitchRow({
  icon,
  title,
  subtitle,
  value,
  onValueChange,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  testID?: string;
}) {
  const { semantic, spacing, layout } = useTheme();
  const { rowMinHeight } = useLayout();
  const styles = useMemo(
    () => makeStyles(semantic, spacing, layout, rowMinHeight),
    [semantic, spacing, layout, rowMinHeight]
  );
  return (
    <View style={styles.switchRow} testID={testID}>
      <Ionicons name={icon} size={20} color={semantic.accentText} />
      <View style={styles.switchRowText}>
        {/* 标题最多 2 行（与 ListRow 同规则），副标题不设上限：宁可行变高也不省略 */}
        <AppText variant="headline" numberOfLines={2}>
          {title}
        </AppText>
        {!!subtitle && (
          <AppText variant="footnote" color={semantic.textSecondary}>
            {subtitle}
          </AppText>
        )}
      </View>
      <Switch value={value} onValueChange={onValueChange} accessibilityLabel={title} />
    </View>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 字号 / 间距；几何常量只留纯图形尺寸） */
function makeStyles(semantic: SemanticColors, spacing: Spacing, layout: Layout, rowMinHeight: number) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: semantic.bg },
    // 分组间距：layout.section（24）—— ListSection 自带组标题与卡面
    section: { marginTop: layout.section },

    // 账户卡：整卡可点（Card onPress），行规格与列表行一致
    accountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: rowMinHeight,
      paddingHorizontal: layout.card,
      paddingVertical: spacing.md,
      columnGap: spacing.md,
    },
    // 头像：accentSoft 圆底 + 紫色 person 图标（不用 emoji；图标只有 20 / 24 两档）
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: semantic.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    accountTextBlock: { flexShrink: 1, flexGrow: 1 },
    accountSub: { marginTop: spacing.xs },

    // 外观行：标签一行 + 控件一行（两行结构，见 AppearanceRow 注释）
    appearanceRow: {
      minHeight: rowMinHeight,
      paddingHorizontal: layout.card,
      paddingVertical: spacing.md,
      justifyContent: 'center',
    },
    appearanceHeader: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.sm },
    appearanceControl: { marginTop: spacing.md },

    // 开关行（见 SwitchRow 注释）：文字块自己换行，Switch 永远贴右
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: rowMinHeight,
      paddingHorizontal: layout.card,
      paddingVertical: spacing.md,
      columnGap: spacing.sm,
    },
    switchRowText: { flex: 1, minWidth: 0 },

    // 页脚版本号：caption 档、居中
    footer: { marginTop: spacing.xxl },
  });
}
