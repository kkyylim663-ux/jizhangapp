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
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ROUTES } from '../navigation/routes';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import { useThemeMode, ThemeMode } from '../context/ThemeModeContext';
import type { Layout, Radius, SemanticColors, Spacing } from '../theme/theme';
import PinSheet, { PinSheetMode } from '../components/PinSheet';
import { useDialog } from '../components/AppDialog';
import { useAuth } from '../context/AuthContext';
import { useAppLock } from '../context/AppLockContext';
import { useLanguage, LangMode } from '../i18n/LanguageContext';
import { useT } from '../i18n/LanguageContext';
import { hapticSelection } from '../utils/haptics';
import PressableScale from '../components/PressableScale';
import { AppText, Badge, Card, GlassView, HeroGradient, IconCircle, StatusBarGlass, Switch } from '../components/ui';

/**
 * 设置各行的图标基色（UI V2 稿取样的行首圆色）。
 * 这些是设置页的装饰色，不是类别 / 账户数据色 —— 统一交给 IconCircle（立体光泽球）。
 * ⚠ 基色深浅是硬指标（UI V2.1 §5）：白图标与球 ≥3:1，本页按 §4 的小字口径取 4.5:1 ——
 *   language / finance / subscribe 三颗是按测量结果加深过的，别再调亮回去。
 * 未列出的行不传基色 = IconCircle 的中性圆。
 */
const ICON_TINTS = {
  darkMode: '#9B5BD6',
  language: '#4379E8',
  finance: '#4ECB8C',
  subscribe: '#7E7A95',
  help: '#FFB06A',
  about: '#C29BFF',
} as const;

export default function ProfileScreen({ navigation }: any) {
  const { semantic, spacing, layout, glass } = useTheme();
  const { pagePadding, contentMaxWidth, rowMinHeight } = useLayout();
  const insets = useSafeAreaInsets();
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
    // 全出血（同首页 / 资产页 / 统计页）：渐变通到屏幕顶，内容自己用 insets.top 让开状态栏
    <SafeAreaView style={styles.container} edges={[]}>
      {/* UI V2.1 §1：品牌渐变铺满整页（fill），卡片 / 列表直接浮在渐变上 */}
      <HeroGradient fill />
      {/* C1：顶部安全区挡板 —— 滚动时内容不从状态栏文字下穿过 */}
      <StatusBarGlass />
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
        <View style={{ paddingHorizontal: pagePadding, paddingTop: insets.top + 14 }}>
          {/* P1 页头（UI V2 稿）：大标题 30/600（text.primary，§3：渐变上不再用白字；
              无返回键 —— 根页不该有返回） */}
          <AppText
            variant="title1"
            weight="600"
            color={semantic.textPrimary}
            style={styles.heroTitle}
            testID="profile-header"
          >
            {tr('profile.title')}
          </AppText>

          {/* P1 顶部账户卡（UI V2 稿）：渐变上的玻璃卡（radius 24 / 内衬 14-16）；
              48 圆头像 + 标题 + 副行 + ›；点击仍进原账号页 */}
          <PressableScale
            onPress={authInitializing ? undefined : () => navigation.navigate(ROUTES.AUTH)}
            disabled={authInitializing}
            activeScale={0.99}
            hitSlop={0}
            style={styles.accountCardTouch}
            accessibilityRole="button"
            accessibilityLabel={
              authInitializing
                ? tr('auth.busy')
                : user
                  ? `${tr('auth.title')} ${user.email}`
                  : tr('auth.signInOrUp')
            }
            testID="profile-account-card"
          >
            <GlassView radius={24} style={styles.accountCard}>
              <View style={[styles.avatar, { backgroundColor: glass.fill }]}>
                <Ionicons name="person" size={24} color={semantic.textPrimary} />
              </View>
              <View style={styles.accountTextBlock}>
                <AppText variant="headline" color={semantic.textPrimary} numberOfLines={2}>
                  {authInitializing ? tr('auth.busy') : user ? user.email : tr('auth.signInOrUp')}
                </AppText>
                {/* 副行：登录后是同步状态一句话；未登录是登录说明。说明文字随内容换行（不截断） */}
                {!authInitializing && (
                  <AppText variant="footnote" color={semantic.textPrimary} style={styles.accountSub}>
                    {user ? syncText : tr('auth.subtitle')}
                  </AppText>
                )}
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={semantic.textPrimary}
                style={styles.accountChevron}
              />
            </GlassView>
          </PressableScale>

          {/* P2 安全分组（登录后可见）：生物识别锁改 Switch；二级密码保留「当前值 + chevron」 */}
          {!authInitializing && user && (
            <SettingsSection title={tr('profile.security')}>
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
              <SettingsRow
                icon="key-outline"
                title={tr('pin.settingsTitle')}
                trailing={
                  <AppText variant="subhead" color={semantic.textSecondary}>
                    {hasPin ? tr('pin.setup') : tr('pin.none')}
                  </AppText>
                }
                chevron
                onPress={handlePinRowPress}
                testID="profile-pin-row"
              />
            </SettingsSection>
          )}

          {/* 外观分组：只放深色模式（语言不属于外观，见下「通用」分组） */}
          <SettingsSection title={tr('profile.appearance')}>
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
          </SettingsSection>

          {/* 通用分组：语言（中 / EN 分段在行右侧）+ 财务规划 › + 订阅（灰 + 即将推出） */}
          <SettingsSection title={tr('profile.general')}>
            <SettingsRow
              icon="language-outline"
              iconColor={ICON_TINTS.language}
              title={tr('profile.language')}
              trailing={
                <LanguageSegments
                  options={[
                    { label: tr('lang.segZh'), value: 'zh' },
                    { label: tr('lang.segEn'), value: 'en' },
                  ]}
                  selected={langMode === 'system' ? 'zh' : langMode}
                  onSelect={(v) => setLangMode(v as LangMode)}
                  testID="profile-language-segments"
                />
              }
              testID="profile-language-row"
            />
            <SettingsRow
              icon="pie-chart-outline"
              iconColor={ICON_TINTS.finance}
              title={tr('finance.title')}
              chevron
              onPress={() => navigation.navigate(ROUTES.FINANCE_PLAN)}
              testID="profile-finance-row"
            />
            <SettingsRow
              icon="star-outline"
              iconColor={ICON_TINTS.subscribe}
              title={tr('profile.subscribe')}
              trailing={<Badge label={tr('profile.subscribeSub')} />}
              disabled
              testID="profile-subscribe-row"
            />
          </SettingsSection>

          {/* 支持：帮助与反馈 / 关于应用 */}
          <SettingsSection title={tr('profile.support')}>
            <SettingsRow
              icon="chatbubble-ellipses-outline"
              iconColor={ICON_TINTS.help}
              title={tr('profile.help')}
              chevron
              onPress={() => navigation.navigate(ROUTES.FEEDBACK)}
            />
            <SettingsRow
              icon="information-circle-outline"
              iconColor={ICON_TINTS.about}
              title={tr('profile.about')}
              chevron
              onPress={() => navigation.navigate(ROUTES.ABOUT)}
            />
          </SettingsSection>

          {/* P4 页脚版本号：caption 档、居中（中文写「版本 1.0.0」，英文 Version 1.0.0）；
              色走 textSecondary —— §3 规定 textTertiary 只给 ≥13pt，caption 12pt 用它只有 4.35:1 */}
          <AppText variant="caption" color={semantic.textSecondary} align="center" style={styles.footer}>
            {tr('profile.version', { version: appVersion })}
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
  const { semantic, radius, motion, gradients } = useTheme();
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
        <Animated.View style={[segStyles.thumb, thumbStyle]} pointerEvents="none">
          {/* 选中块 = accent 渐变 + 白字（UI V2 稿的「深色模式」三选一） */}
          <LinearGradient
            colors={gradients.accent.colors}
            locations={gradients.accent.locations as [number, number, ...number[]]}
            start={gradients.accent.start}
            end={gradients.accent.end}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
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
      // 槽底：稿里的卡片配色（夜 #1E1E27 / 日 #F1F0F6）→ 令牌的「凹底」档 surfaceSunken
      backgroundColor: semantic.surfaceSunken,
      borderRadius: radius.full,
      padding: SEG_TRACK_PADDING,
      minHeight: SEG_TRACK_HEIGHT,
      alignItems: 'center',
    },
    // 滑块底色由 accent 渐变子层自绘（见 JSX），这里只管位置与圆角
    thumb: {
      position: 'absolute',
      top: SEG_TRACK_PADDING,
      bottom: SEG_TRACK_PADDING,
      left: 0,
      borderRadius: radius.full,
      overflow: 'hidden',
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
 * 设置分组卡（UI V2 稿）：分组标签 12.5 次要色 + 卡内行间发丝线（左缩进 62 = 图标 34 + 间距 12 + 内衬 16）。
 * 为什么不用 ListSection：它的卡圆角固定 radius.lg（稿里是 24）、行间分割线左右都缩进 layout.card
 * （稿里只缩进左边、右侧通到卡边），这两个都改不了，所以在页面内按同一套令牌拼一张卡。
 */
function SettingsSection({
  title,
  children,
  testID,
}: {
  title?: string;
  children: React.ReactNode;
  testID?: string;
}) {
  const { semantic, spacing, layout } = useTheme();
  const items = React.Children.toArray(children);
  return (
    <View style={{ marginTop: layout.section }} testID={testID}>
      {!!title && (
        <AppText
          variant="footnote"
          color={semantic.textSecondary}
          style={{ paddingHorizontal: 6, marginBottom: 6 }}
        >
          {title}
        </AppText>
      )}
      {/* 卡圆角按稿 24（Card 默认 radius.lg 20） */}
      <Card padded={false} style={{ borderRadius: 24 }}>
        {items.map((child, i) => (
          <View key={i}>
            {i > 0 && (
              <View
                style={{ height: StyleSheet.hairlineWidth, backgroundColor: semantic.hairline, marginLeft: 62 }}
              />
            )}
            {child}
          </View>
        ))}
      </Card>
    </View>
  );
}

/** 设置行左侧圆形图标直径（稿：34 圆 + 17 图标）。
 *  ⚠ 直径与图标尺寸是硬指标（UI V2.1 §4/§5）：球面是高光球，图标正好压在最亮的一档上 ——
 *  34 圆只派生 16pt 图标，白图标对球面的最亮档量出来 3.8–4.4 < 4.5；38 圆派生 18pt 图标，
 *  按 §4 的「大字 3:1」口径达标。改小回去就会让设置行的三个球重新不达标。 */
const ROW_ICON_SIZE = 38;

/**
 * 设置行（UI V2 稿）：左侧 34 圆图标 + 标题 15 + 行尾控件 / chevron。
 * 为什么不用 ListRow：稿里的行首是 34 圆（ListRow 是 40 方块 + 20 图标）、行高 ≥56（不是 rowMinHeight），
 * 且「语言」行尾要挂分段控件、副标题一长就把行尾控件挤到下一行（T22 已实测过），
 * 所以按 T22 立的口径在页内用令牌自建（文字块 flex:1 + 行尾 flexShrink:0）。
 */
function SettingsRow({
  icon,
  iconColor,
  title,
  subtitle,
  trailing,
  chevron,
  onPress,
  disabled,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** 图标底色 / 图标色的基色（未传 = 中性圆，走 IconCircle 的「全部」档） */
  iconColor?: string;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { semantic, spacing, layout } = useTheme();
  const rowStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    minHeight: 56,
    paddingHorizontal: layout.card,
    columnGap: spacing.md,
  };
  const body = (
    <>
      <IconCircle size={ROW_ICON_SIZE} color={iconColor} icon={icon} />
      <View style={{ flexGrow: 1, flexShrink: 1 }}>
        <AppText variant="subhead" weight="500" color={disabled ? semantic.textTertiary : undefined} numberOfLines={2}>
          {title}
        </AppText>
        {!!subtitle && (
          <AppText variant="footnote" color={semantic.textSecondary}>
            {subtitle}
          </AppText>
        )}
      </View>
      {trailing != null && <View style={{ flexShrink: 0 }}>{trailing}</View>}
      {chevron && (
        <Ionicons name="chevron-forward" size={18} color={semantic.textTertiary} style={{ flexShrink: 0 }} />
      )}
    </>
  );

  if (onPress && !disabled) {
    return (
      <PressableScale
        onPress={onPress}
        activeScale={0.99}
        hitSlop={0}
        style={rowStyle}
        accessibilityRole="button"
        accessibilityLabel={title}
        testID={testID}
      >
        {body}
      </PressableScale>
    );
  }
  return (
    <View
      style={rowStyle}
      testID={testID}
      // ⚠ 不给「行尾挂了可点控件」的行加 role=button：语言行的分段控件本身就是 button，
      //   外层再加一层 button 会形成嵌套按钮（web 控制台报 hydration 警告）
      {...(disabled
        ? { accessibilityRole: 'button', accessibilityLabel: title, accessibilityState: { disabled: true } }
        : null)}
    >
      {body}
    </View>
  );
}

/**
 * 语言中 / EN 二选一（UI V2 稿：**自然宽度**的胶囊，右侧贴在行尾）。
 * 为什么不用共享 SegmentedControl：稿里这一档的选中块是「夜 = #F2F2F7 黑字 / 日 = #15141C 白字」
 * （= 令牌 textPrimary 底 + 页面底色字），共享件的选中块固定是「白底 + 深紫字」，改不了；
 * 槽底也要求用卡片配色（surfaceSunken），共享件的 solid 档是 hairline 底。
 * 规格与 SegmentedControl 完全同款：槽 36 高 / 内衬 3、滑块贴槽内缘、触控 ≥44、切档 selection 震动、
 * 首帧不播动画，只是「段宽 = 内容宽」并把颜色按稿换成令牌组合。
 */
function LanguageSegments({
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
  const [frames, setFrames] = useState<Record<string, { x: number; width: number }>>({});
  const active = options.find((o) => o.value === selected) ?? options[0];
  const frame = active ? frames[active.value] : undefined;

  const thumbX = useSharedValue(0);
  const thumbWidth = useSharedValue(0);
  const thumbOpacity = useSharedValue(0);
  const positioned = useRef(false);

  useEffect(() => {
    if (!frame) return;
    // 首帧（几何未测到）：不播动画直接落位再淡入，避免滑块从 0 位滑过去
    if (!positioned.current) {
      positioned.current = true;
      thumbX.value = frame.x;
      thumbWidth.value = frame.width;
      thumbOpacity.value = withTiming(1, { duration: motion.timing.fade, easing: motion.easing.out });
      return;
    }
    thumbX.value = withSpring(frame.x, motion.spring.default);
    thumbWidth.value = withSpring(frame.width, motion.spring.default);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame?.x, frame?.width]);

  const thumbStyle = useAnimatedStyle(() => ({
    width: thumbWidth.value,
    opacity: thumbOpacity.value,
    transform: [{ translateX: thumbX.value }],
  }));

  return (
    <View style={{ paddingVertical: (SEG_TOUCH_HEIGHT - SEG_TRACK_HEIGHT) / 2 }} testID={testID}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: SEG_TRACK_PADDING,
          borderRadius: radius.full,
          backgroundColor: semantic.surfaceSunken,
        }}
      >
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: SEG_TRACK_PADDING,
              bottom: SEG_TRACK_PADDING,
              left: 0,
              borderRadius: radius.full,
              // 选中块：令牌 textPrimary（夜 #F2F2F7 / 日 #15141C）
              backgroundColor: semantic.textPrimary,
            },
            thumbStyle,
          ]}
          pointerEvents="none"
        />
        {options.map((opt) => {
          const isActive = opt.value === active?.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={{ minHeight: 30, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' }}
              activeOpacity={0.75}
              onLayout={(e) => {
                const { x, width } = e.nativeEvent.layout;
                setFrames((prev) =>
                  prev[opt.value]?.x === x && prev[opt.value]?.width === width
                    ? prev
                    : { ...prev, [opt.value]: { x, width } }
                );
              }}
              hitSlop={{ top: SEG_TRACK_PADDING, bottom: SEG_TRACK_PADDING, left: 0, right: 0 }}
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
                // 选中时字色 = 页面底色（夜黑 / 日白），与选中块形成反差
                color={isActive ? semantic.bg : semantic.textSecondary}
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

/**
 * 外观行（页面内自建 —— 验收口径第 1 条允许在 ListRow 表达不了布局时页内用令牌自建行）。
 * 为什么不用 ListRow：ListRow 的三块结构是「同一行的左中右」，表达不了这里要求的两行结构
 * （标签一行 + 控件另起一行占满整行，见 UI V2 稿「深色模式」格）。行规格与稿一致：
 * 34 圆图标 + 15 标题（左内衬 14 + 行内 2）、控件与标签间距 10。
 */
function AppearanceRow({ label, children }: { label: string; children: React.ReactNode }) {
  const { spacing } = useTheme();
  return (
    <View style={{ paddingHorizontal: 14, paddingTop: spacing.md, paddingBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: spacing.md, paddingBottom: 10 }}>
        <IconCircle size={ROW_ICON_SIZE} color={ICON_TINTS.darkMode} icon="moon-outline" />
        <AppText variant="subhead" weight="500">
          {label}
        </AppText>
      </View>
      {/* 控件层：竖排容器 —— 整行三选一自己撑满（见 FullWidthSegments 注释） */}
      <View>{children}</View>
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
      {/* 行首换 V2 的 34 圆图标（中性档：安全组的锁 / 密码不是彩色分类） */}
      <IconCircle size={ROW_ICON_SIZE} icon={icon} />
      <View style={styles.switchRowText}>
        {/* 标题最多 2 行（与 ListRow 同规则），副标题不设上限：宁可行变高也不省略 */}
        <AppText variant="subhead" weight="500" numberOfLines={2}>
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

/** 令牌进、StyleSheet 出（禁止写死色值 / 字号 / 间距；几何常量只留纯图形尺寸与稿内联数值） */
function makeStyles(semantic: SemanticColors, spacing: Spacing, layout: Layout, rowMinHeight: number) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: semantic.bg },
    // 大标题（渐变上的白字）：稿为 30 / 600（token title1 是 28/700，字号按稿覆盖）
    heroTitle: { fontSize: 30, lineHeight: 36, marginTop: 6 },

    // 账户卡触碰层（整卡可点）：与卡同宽，卡自身给玻璃材质
    accountCardTouch: { marginTop: 14 },
    // 账户玻璃卡：稿为 radius 24 / 内衬 14-16 / 三块间距 14
    accountCard: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: layout.card,
      paddingVertical: 14,
      columnGap: 14,
    },
    // 头像：稿为 48 圆 + 半透明白底（= 玻璃填充档）+ 白色 person 图标
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    accountTextBlock: { flexShrink: 1, flexGrow: 1 },
    accountSub: { marginTop: 2 },
    // 行尾 chevron：稿为 18 图标、70% 不透明度
    accountChevron: { opacity: 0.7 },

    // 开关行（见 SwitchRow 注释）：文字块自己换行，Switch 永远贴右
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 56,
      paddingHorizontal: layout.card,
      paddingVertical: spacing.md,
      columnGap: spacing.md,
    },
    switchRowText: { flex: 1, minWidth: 0 },

    // 页脚版本号：caption 档、居中
    footer: { marginTop: spacing.xxl },
  });
}
