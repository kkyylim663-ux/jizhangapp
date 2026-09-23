import React, { useRef, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Pressable, Animated, Platform } from 'react-native';
import { NavigationContainer, CommonActions, DarkTheme, DefaultTheme, useNavigation } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BottomTabBar } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type {
  MainTabParamList,
  HomeStackParamList,
  ProfileStackParamList,
  AddTransactionStackParamList,
  AssetStackParamList,
} from './src/navigation/routes';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { AppProvider, useApp } from './src/context/AppContext';
import { AuthProvider } from './src/context/AuthContext';
import { AppLockProvider, AppLockOverlay } from './src/context/AppLockContext';
import { AppDialogProvider } from './src/components/AppDialog';
import { useSyncManager } from './src/hooks/useSyncManager';
import { ThemeModeProvider } from './src/context/ThemeModeContext';
import { LanguageProvider, useT } from './src/i18n/LanguageContext';
import { useNotificationSetup } from './src/hooks/useNotificationSetup';
import { usePaymentReminders } from './src/hooks/usePaymentReminders';
import {
  TabBarAutoHideProvider,
  useCreateTabBarAutoHide,
  useTabBarAutoHide,
} from './src/context/TabBarAutoHideContext';
import { useTheme } from './src/theme/useTheme';
import { hapticLight, hapticSelection } from './src/utils/haptics';
import HomeScreen from './src/screens/HomeScreen';
import AddTransactionScreen from './src/screens/AddTransactionScreen';
import ReportScreen from './src/screens/ReportScreen';
import AssetScreen from './src/screens/AssetScreen';
import AddAssetScreen from './src/screens/AddAssetScreen';
import AIScreen from './src/screens/AIScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import AuthScreen from './src/screens/AuthScreen';
import FinancialPlanningScreen from './src/screens/FinancialPlanningScreen';
import PlanFormScreen from './src/screens/PlanFormScreen';
import CategoryManagementScreen from './src/screens/CategoryManagementScreen';
import LedgerScreen from './src/screens/LedgerScreen';

import AboutAppScreen from './src/screens/AboutAppScreen';
import GestureProbeScreen from './src/screens/GestureProbeScreen';
import HelpFeedbackScreen from './src/screens/HelpFeedbackScreen';
import CalculatorHubScreen from './src/screens/CalculatorHubScreen';
import LoanCalculatorScreen from './src/screens/LoanCalculatorScreen';
import CompoundInterestScreen from './src/screens/CompoundInterestScreen';


const Tab = createBottomTabNavigator<MainTabParamList>();
const HomeStackNav = createNativeStackNavigator<HomeStackParamList>();
const ProfileStackNav = createNativeStackNavigator<ProfileStackParamList>();
const AddTransactionStackNav = createNativeStackNavigator<AddTransactionStackParamList>();
const AssetStackNav = createNativeStackNavigator<AssetStackParamList>();

// "首页"Tab内部堆栈：仪表盘首页 → 记一笔（编辑/从今日账单点进来）
// 这里的"记一笔"和下面底部Tab里的"记一笔"是同一个组件，注册两次：
// - 这里用于"编辑已有记录"这种场景，走Stack的push/back，体验更顺
// - 底部Tab那个用于"点击中间圆按钮直接开始记一笔"，每次都是全新的
function HomeStack() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  return (
    <HomeStackNav.Navigator
      screenOptions={{
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: colors.headerTint },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { color: colors.textPrimary },
        headerShadowVisible: false,
      }}
    >
      <HomeStackNav.Screen name="首页主页" component={HomeScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="记一笔" component={AddTransactionScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="类别分类" component={CategoryManagementScreen} options={{ headerShown: false, animation: 'slide_from_right', animationDuration: 220 }} />
      {/* 跟 ProfileStack 里的"开设账本"是同一个组件注册两次：这样从首页进来 push 到的是
          HomeStack 自己的栈，系统返回箭头 goBack() 天然回首页；从设置项进来同理天然回设置 */}
      <HomeStackNav.Screen name="开设账本" component={LedgerScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="关于应用" component={AboutAppScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="帮助与反馈" component={HelpFeedbackScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="计算器" component={CalculatorHubScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="贷款计算器" component={LoanCalculatorScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="复利计算器" component={CompoundInterestScreen} options={{ headerShown: false }} />
      {/* AI专区双注册（与 ProfileStack 同一组件）：从首页侧进 AI专区（如 AI专区→记一笔 的往返）
          时 push 的是 HomeStack 自己的实例，goBack 天然回记一笔/首页，不会串到设置项 Tab */}
      <HomeStackNav.Screen name="AI专区" component={AIScreen} options={{ headerShown: false }} />
      {/* 添加资产账户双注册（与 AssetStack 同一组件）：首页编辑记一笔时选择账户弹窗的
          "添加新账户" push 本栈实例，goBack 天然回记一笔，不会切去资产 Tab */}
      <HomeStackNav.Screen name="添加资产账户" component={AddAssetScreen} options={{ headerShown: false }} />
    </HomeStackNav.Navigator>
  );
}

// "设置项"Tab内部堆栈：我的主页（预算） → 设置 → 各设置子页面 + AI专区
function ProfileStack() {
  const { colors } = useTheme();
  return (
    <ProfileStackNav.Navigator
      screenOptions={{
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: colors.headerTint },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { color: colors.textPrimary },
        headerShadowVisible: false,
      }}
    >
      <ProfileStackNav.Screen name="我的主页" component={ProfileScreen} options={{ headerShown: false }} />
      <ProfileStackNav.Screen name="类别分类" component={CategoryManagementScreen} options={{ headerShown: false, animation: 'slide_from_right', animationDuration: 220 }} />
      <ProfileStackNav.Screen name="开设账本" component={LedgerScreen} options={{ headerShown: false }} />
      {/* AI专区改用与其他二级页一致的自绘头部（圆框返回键），原生头部关闭 */}
      <ProfileStackNav.Screen name="AI专区" component={AIScreen} options={{ headerShown: false }} />
      {/* 登录 / 注册独立页面（未登录时从"账号与同步"进入；已登录显示个人中心内容+退出登录。
          "我的账户"入口也指向这里——一个页面两种状态 */}
      <ProfileStackNav.Screen name="登录注册" component={AuthScreen} options={{ headerShown: false }} />
      {/* 财务规划（计划付款：固定支出自动扣账）——从设置项"财务规划"进入 */}
      <ProfileStackNav.Screen name="财务规划" component={FinancialPlanningScreen} options={{ headerShown: false }} />
      {/* 财务规划-新增/编辑计划（整页表单；planId 有值 = 编辑） */}
      <ProfileStackNav.Screen name="财务规划编辑" component={PlanFormScreen} options={{ headerShown: false }} />
      {/* 原侧拉菜单的入口现在从设置项列表跳转，同样注册到 ProfileStack：
          goBack 天然回"我的主页"（与 HomeStack 的同名页面互不干扰） */}
      <ProfileStackNav.Screen name="关于应用" component={AboutAppScreen} options={{ headerShown: false }} />
      <ProfileStackNav.Screen name="帮助与反馈" component={HelpFeedbackScreen} options={{ headerShown: false }} />
      {/* 手势诊断页（临时）：定位账本弹层上滑滚不动的坏点，诊断完删除 */}
      <ProfileStackNav.Screen name="手势诊断" component={GestureProbeScreen} options={{ headerShown: false }} />
      <ProfileStackNav.Screen name="计算器" component={CalculatorHubScreen} options={{ headerShown: false }} />
      {/* 计算器 Hub 的两个子页也要注册到 ProfileStack：从设置项进来的计算器 Hub
          navigate('贷款计算器'/'复利计算器') 才有目标（否则报 NAVIGATE not handled） */}
      <ProfileStackNav.Screen name="贷款计算器" component={LoanCalculatorScreen} options={{ headerShown: false }} />
      <ProfileStackNav.Screen name="复利计算器" component={CompoundInterestScreen} options={{ headerShown: false }} />
      {/* 记一笔双注册（与 HomeStack 同一组件）：AI专区→"扫描小票自动记账" push 的是
          ProfileStack 自己的记一笔实例，goBack 天然回 AI专区，不会跳去首页 Tab */}
      <ProfileStackNav.Screen name="记一笔" component={AddTransactionScreen} options={{ headerShown: false }} />
      {/* 添加资产账户双注册（与 AssetStack 同一组件）：AI专区→记一笔选择账户弹窗的
          "添加新账户" push 本栈实例，goBack 天然回记一笔，不会切去资产 Tab */}
      <ProfileStackNav.Screen name="添加资产账户" component={AddAssetScreen} options={{ headerShown: false }} />
    </ProfileStackNav.Navigator>
  );
}

// "资产"Tab内部堆栈：总资产 → 添加资产账户（整页表单，返回键 goBack 回资产页）
function AssetStack() {
  const { colors } = useTheme();
  return (
    <AssetStackNav.Navigator
      screenOptions={{
        headerShown: false,
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: colors.headerTint },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { color: colors.textPrimary },
        headerShadowVisible: false,
      }}
    >
      <AssetStackNav.Screen name="资产主页" component={AssetScreen} />
      <AssetStackNav.Screen name="添加资产账户" component={AddAssetScreen} />
    </AssetStackNav.Navigator>
  );
}

// 中间圆按钮"记一笔"专属堆栈：只是为了让它能 push「类别分类」并正确 goBack 回到记一笔本身，
// 跟 HomeStack/ProfileStack 里各自的「类别分类」是同一个组件注册第三次
function AddTransactionStack() {
  const { colors } = useTheme();
  return (
    <AddTransactionStackNav.Navigator
      screenOptions={{
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: colors.headerTint },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { color: colors.textPrimary },
        headerShadowVisible: false,
      }}
    >
      <AddTransactionStackNav.Screen name="记一笔主页" component={AddTransactionScreen} options={{ headerShown: false }} />
      <AddTransactionStackNav.Screen name="类别分类" component={CategoryManagementScreen} options={{ headerShown: false, animation: 'slide_from_right', animationDuration: 220 }} />
      {/* 添加资产账户双注册（与 AssetStack 同一组件）：记一笔 Tab 选择账户弹窗的
          "添加新账户" push 本栈实例，goBack 天然回记一笔，不会切去资产 Tab */}
      <AddTransactionStackNav.Screen name="添加资产账户" component={AddAssetScreen} options={{ headerShown: false }} />
    </AddTransactionStackNav.Navigator>
  );
}

// 中间那个凸起的圆形"记一笔"按钮，盖在底部Tab栏上方。
// 独立函数组件，会被 Tab.Navigator 渲染在 ThemeModeProvider 之下，
// 可以直接自己调用 useTheme() 拿主题色。
//
// 设计：外面套一圈静态光晕（两层描边圆），按下时触发从按钮尺寸放大到
// 2 倍多、同时淡出的水波纹，松手前就会自己收尾；按钮面用三段渐变
// （亮 → 本色 → 暗）做出球面受光的立体感，顶部再叠一片渐隐椭圆高光。
function CenterTabButton({ onPress }: { onPress?: () => void }) {
  const { colors } = useTheme();
  const ripple = useRef(new Animated.Value(0)).current;

  const triggerRipple = () => {
    ripple.setValue(0);
    hapticLight();
    Animated.timing(ripple, {
      toValue: 1,
      duration: 550,
      useNativeDriver: true,
    }).start();
  };

  const rippleScale = ripple.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] });
  const rippleOpacity = ripple.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.35, 0.18, 0] });

  return (
    <Pressable onPressIn={triggerRipple} onPress={onPress}>
      <View style={styles.centerButtonWrap}>
        {/* 外圈光晕：两层半透明描边圆，营造发光质感 */}
        <View style={[styles.glowRingOuter, { borderColor: colors.fabBg + '33' }]} />
        <View style={[styles.glowRingInner, { borderColor: colors.fabBg + '66' }]} />

        {/* 点击水波纹：从按钮同尺寸放大并淡出 */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ripple,
            {
              backgroundColor: colors.fabRipple,
              opacity: rippleOpacity,
              transform: [{ scale: rippleScale }],
            },
          ]}
        />

        <View style={[styles.centerButtonShadow, { shadowColor: colors.fabShadow }]}>
          <View style={[styles.centerButton, { borderColor: colors.fabBorder }]}>
            {/* 三段渐变：亮 → 本色 → 暗，拉开对比才有球面受光的立体感 */}
            <LinearGradient
              colors={[colors.fabHighlight, colors.fabBg, colors.fabShadow]}
              locations={[0, 0.55, 1]}
              start={{ x: 0.3, y: 0 }}
              end={{ x: 0.7, y: 1 }}
              style={styles.centerButtonFace}
            >
              {/* 顶部高光：渐隐的椭圆，看起来像玻璃反光而不是贴纸 */}
              <LinearGradient
                colors={[colors.fabShine, 'transparent']}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={styles.centerButtonShine}
                pointerEvents="none"
              />
              <Ionicons name="add" size={28} color={colors.fabIcon} />
            </LinearGradient>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// 浮空 Tab 栏的可滑动外壳：几何定位（absolute/左右缩进/距底）在这里，
// 视觉（背景/圆角/描边/投影）仍由 screenOptions.tabBarStyle 提供给内部的 BottomTabBar。
// 注意：v7 会以普通函数方式调用 tabBar（tabBar(props) 而非 <tabBar/>），
// 所以这层不能放 hooks——hooks 全部在 SlidingTabBarInner 组件里。
function SlidingTabBar(props: any) {
  return <SlidingTabBarInner {...props} />;
}

// 水滴指示器尺寸：主滴在当前 tab 后面
const BLOB_W = 60;
const BLOB_H = 50;
// 液滴颜色浓度：跟在 colors.link 后面的十六进制透明度，越大越明显（'33'=20%, '4D'=30%, '66'=40%）
const BLOB_ALPHA = '4D';

function SlidingTabBarInner(props: any) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { translateY, opacity } = useTabBarAutoHide();
  const { state } = props;

  // 外壳宽度 → 每个 tab 槽位宽 → 指示器目标位置
  const [barW, setBarW] = useState(0);
  const blobX = useRef(new Animated.Value(0)).current;
  const blobOpacity = useRef(new Animated.Value(0)).current;
  // 移动时的"液体挤压"：滑动的瞬间先压扁（scaleY 0.82 / scaleX 1.1），到位后弹回
  const squashY = useRef(new Animated.Value(1)).current;
  const squashX = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!barW) return;
    const slot = barW / state.routes.length;
    const target = slot * state.index + slot / 2 - BLOB_W / 2;
    const isActionTab = state.routes[state.index].name === '记一笔';
    Animated.parallel([
      // 主滴：快一点、带回弹
      Animated.spring(blobX, { toValue: target, friction: 7, tension: 90, useNativeDriver: true }),
      Animated.timing(blobOpacity, { toValue: isActionTab ? 0 : 1, duration: 150, useNativeDriver: true }),
      // 液体挤压：走的时候压扁，到位弹回
      Animated.sequence([
        Animated.timing(squashY, { toValue: 0.82, duration: 110, useNativeDriver: true }),
        Animated.spring(squashY, { toValue: 1, friction: 4, tension: 80, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(squashX, { toValue: 1.1, duration: 110, useNativeDriver: true }),
        Animated.spring(squashX, { toValue: 1, friction: 4, tension: 80, useNativeDriver: true }),
      ]),
    ]).start();
  }, [barW, state.index, state.routes, blobX, blobOpacity, squashX, squashY]);

  return (
    <Animated.View
      onLayout={(e) => setBarW(e.nativeEvent.layout.width)}
      style={[
        styles.floatingTabShell,
        // 导航条区域已由 AppContent 外层垫色并裁掉（内层 marginBottom: insets.bottom），
        // 这里只需留 2px 缝隙，栏卡片紧贴导航条上沿
        { bottom: 2 },
        { transform: [{ translateY }], opacity },
      ]}
    >
      {/* 水滴指示器：画在按钮层【上面】（玻璃水珠罩在当前 tab 上）。
          之前画在 BottomTabBar 前面会被白色胶囊整个盖住——这就是看不见的原因 */}
      <BottomTabBar {...props} style={styles.innerTabBar} />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.tabBlob,
          {
            width: BLOB_W,
            height: BLOB_H,
            transform: [{ translateX: blobX }, { scaleX: squashX }, { scaleY: squashY }],
            backgroundColor: colors.link + BLOB_ALPHA,
            opacity: blobOpacity,
            shadowColor: colors.link,
            shadowOpacity: 0.3,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 3 },
            elevation: 4,
          },
        ]}
      />
    </Animated.View>
  );
}

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  首页: 'home-outline',
  资产: 'wallet-outline',
  统计: 'bar-chart-outline',
  设置项: 'settings-outline',
};

// 首页/设置项这两个 Tab 底下套了 Stack，切走再切回来时 React Navigation 默认会
// 保留你当时停在 Stack 第几层，不会自动回到根页面。
// 这个函数生成一个 tabPress 监听：每次点这个 Tab，都强制把它内层 Stack 重置回根页面。
//
// 注意：判断"要不要重置"必须在 dispatch 之前用 navigation.getState() 做完，
// 不能写在 dispatch(updaterFn) 的回调里再 return state 当"不用处理"的信号——
// 那样等于把整个导航 state（自带 type: 'tab' 字段）当成一个 action 派发出去，
// 会报 "The action 'tab' was not handled by any navigator" 这个错。
function resetToRootOnTabPress(tabName: string) {
  return ({ navigation }: any) => ({
    tabPress: () => {
      // Tab 切换触感：轻"咔哒"（selection），与水滴指示器动画同帧
      hapticSelection();
      const state = navigation.getState();
      const tabIndex = state.routes.findIndex((r: any) => r.name === tabName);
      const tabRoute = state.routes[tabIndex];
      // 已经在根页面（没有嵌套 state，或者嵌套 index 就是 0），什么都不用做，直接返回
      if (!tabRoute?.state || tabRoute.state.index === 0) return;
      const newRoutes = state.routes.map((r: any) => (r.name === tabName ? { ...r, state: undefined } : r));
      // reset 显式带上 index：重置与"切换到该 tab"合并为同一个确定性动作，不和默认切换竞态
      navigation.dispatch(CommonActions.reset({ ...state, index: tabIndex, routes: newRoutes }));
    },
  });
}

// Tab 导航 + 状态栏，拆成 ThemeModeProvider 下面的内层组件，
// 这样才能在这里调用 useTheme() 读到用户在设置项里选的深色模式偏好。
// App() 自己不行——ThemeModeProvider 是 App() 渲染出来的，
// useTheme() 得在它渲染出的子孙组件里调用才能读到值。
function AppContent() {
  const { isDark, colors } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const tabAutoHide = useCreateTabBarAutoHide();

  // 底部 Tab 显示名随语言切换；路由内部名保持中文（见 routes.ts 注释），
  // 所以这里按「中文路由名 → 当前语言标签」做映射，跳转逻辑完全不受影响
  const tabLabels: Record<string, string> = {
    首页: t('nav.home'),
    资产: t('nav.assets'),
    记一笔: t('nav.add'),
    统计: t('nav.stats'),
    设置项: t('nav.settings'),
  };

  // 推送注册（Expo Go 内自动跳过）
  useNotificationSetup();

  // 云同步：登录成功 / 重启恢复登录态后做一次完整同步（拉取云端 → 合并 → 推送）
  useSyncManager();

  // 财务规划-付款提醒:每天 13:00/18:30 检查 7 天内到期的计划(仅"提醒不扣账"的计划)
  usePaymentReminders();

  // web 端根节点底部有约 12px 布局偏移区，不垫色会露出白色；
  // 顺带把浏览器滚动溢出区也染成应用底色
  useEffect(() => {
    if (Platform.OS === 'web') {
      document.body.style.backgroundColor = colors.bg;
      document.documentElement.style.backgroundColor = colors.bg;
    }
  }, [colors.bg]);

  // 导航容器主题：背景跟应用底色一致——TabShell 预留的悬空条带、
  // 浮空栏圆角的缺口都由它上色，深色模式下才不会露出导航默认的浅灰
  const baseTheme = isDark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      background: colors.bg,
      card: colors.card,
      border: colors.dividerHair,
      text: colors.textPrimary,
      primary: colors.link,
      notification: colors.expenseOver,
    },
  };

  return (
    <>
      <TabBarAutoHideProvider value={tabAutoHide}>
      {/* edge-to-edge 下导航键（□○◁）区域是透明的，App 根视图延伸到它后面；
          外层 View 垫满全屏应用底色，内层 margin 掉导航条高度并裁剪——
          页面内容/弹层从此画不进导航条区域，那一条显示纯色底，不再透出滚动内容 */}
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, marginBottom: insets.bottom, overflow: 'hidden' }}>
      <NavigationContainer
        theme={navTheme}
        // 任何导航变化（切 Tab、push、pop）都让栏回到可见——
        // 新页面从顶部开始，收着栏会让人迷失
        onStateChange={tabAutoHide.reset}
      >
        {/* 应用底色打底：淡紫渐变（夜间等效纯色）。TabShell 预留的悬空条带、
            浮空栏圆角的缺口都由它上色；屏幕容器是透明的，渐变从这里透出来 */}
        <LinearGradient
          colors={[colors.bgGradientFrom, colors.bgGradientTo]}
          style={{ flex: 1, backgroundColor: colors.bg }}
        >
        <Tab.Navigator
          initialRouteName="首页"
          // 注意：tabBar 必须挂在 Navigator 本身（v7 经 ...rest 传进 BottomTabView），
          // 放在 screenOptions 里只会进 descriptors、不会被消费
          tabBar={SlidingTabBar}
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor: colors.textPrimary,
            tabBarInactiveTintColor: colors.textTertiary,
            // 显示名随语言切换（"记一笔"Tab 在下面单独覆盖为无文字的凸起圆按钮）
            tabBarLabel: tabLabels[route.name] ?? route.name,
            tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
            // 只放视觉样式：几何（absolute/左右缩进/距底）由 SlidingTabBar 外壳负责，
            // 内部 BottomTabBar 会把它自己的 absolute-bottom 锚在外壳里
            tabBarStyle: {
              height: 54,
              // 关键:覆盖 BottomTabBar 内部默认的 paddingBottom: insets.bottom——
              // 外壳已经用 bottom: insets.bottom+2 避开过安全区,库内部再 pad 一次
              // 会把 54px 栏高的内容区压到 ~30px,导致 Tab 文字下半截被挤出卡片
              paddingBottom: 0,
              backgroundColor: colors.card,
              borderRadius: 24,
              borderTopWidth: 0,
              borderWidth: 1,
              borderColor: colors.cardBorder,
              shadowColor: '#1B1040',
              shadowOpacity: 0.18,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 8 },
              elevation: 8,
              overflow: 'visible',
            },
            // 自定义 tab 按钮：去掉 Android 默认的灰色水波纹（和紫色水滴叠在一起很脏），
            // 按压反馈改为轻微透明度
            // 严格静态的 tab 按钮：无波纹、无按压遮罩/高亮，点击只切换选中状态
            tabBarButton: (props: any) => (
              <PlatformPressable
                {...props}
                pressColor="transparent"
                android_ripple={undefined}
                style={props.style}
              />
            ),
            tabBarIcon: ({ color, focused }) => {
              const icon = TAB_ICONS[route.name];
              if (!icon) return null;
              // 层次感：选中图标从描线切换为实底（Ionicons -outline ↔ 实底名），
              // 避免再叠一层芯片底与水滴指示器叠出"好几层"的脏效果
              let name: keyof typeof Ionicons.glyphMap = icon;
              if (focused && icon.endsWith('-outline')) {
                const solid = icon.replace('-outline', '') as keyof typeof Ionicons.glyphMap;
                if (solid in Ionicons.glyphMap) name = solid;
              }
              return <Ionicons name={name} size={24} color={color} />;
            },
          })}
        >
          <Tab.Screen
            name="首页"
            component={HomeStack}
            options={{ tabBarLabel: t('tabs.home') }}
            listeners={resetToRootOnTabPress('首页')}
          />
          <Tab.Screen
            name="资产"
            component={AssetStack}
            options={{ tabBarLabel: t('tabs.assets') }}
            listeners={resetToRootOnTabPress('资产')}
          />
          <Tab.Screen
            name="记一笔"
            component={AddTransactionStack}
            options={{
              tabBarLabel: () => null,
              tabBarButton: (props) => <CenterTabButton onPress={props.onPress as any} />,
            }}
            listeners={resetToRootOnTabPress('记一笔')}
          />
          <Tab.Screen
            name="统计"
            options={{ tabBarLabel: t('tabs.stats') }}
          >
            {() => <ReportScreen />}
          </Tab.Screen>
          <Tab.Screen
            name="设置项"
            component={ProfileStack}
            options={{ tabBarLabel: t('tabs.settings') }}
            listeners={resetToRootOnTabPress('设置项')}
          />
        </Tab.Navigator>
        </LinearGradient>
      </NavigationContainer>
      </View>
      </View>
      </TabBarAutoHideProvider>
      {/* 'auto' 只跟随系统外观，不认用户在设置里选的"始终亮色/暗色"；
          改成根据 isDark 显式指定，才能和应用内其他地方的主题联动一致 */}
      <AppLockOverlay />
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeModeProvider>
          <LanguageProvider>
            <AuthProvider>
              {/* Bio Lock：登录后可开启，开 App / 切后台回来时要求生物识别解锁 */}
              <AppLockProvider>
                <AppDialogProvider>
                  <AppProvider>
                    <AppContent />
                    {/* 全局主题化弹窗 Host 已内置于 AppDialogProvider：
                        <AppDialog /> 的 DialogHost 随 Provider 渲染 */}
                  </AppProvider>
                </AppDialogProvider>
              </AppLockProvider>
            </AuthProvider>
          </LanguageProvider>
        </ThemeModeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const CORE_SIZE = 56;
const RING_OUTER_SIZE = CORE_SIZE + 24;
const RING_INNER_SIZE = CORE_SIZE + 12;

const styles = StyleSheet.create({
  // 浮空 Tab 栏外壳：只负责几何定位 + 承载收起/展开的 transform。
  // 中间凸起的 + 按钮上半部分在外面，overflow 必须 visible。
  // 左右 12px：比 16 略窄，让每个 tab 的点击槽位更宽
  floatingTabShell: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 54,
    overflow: 'visible',
  },
  // 内部 BottomTabBar：去掉自带背景/描边/投影，视觉由 tabBarStyle 提供；
  // 关键:显式清零库默认的 insets 安全区 padding——外壳已经用 bottom: insets.bottom+2 避开过
  // 安全区,内部再 padding 一次会把 54px 栏高里的内容区压到 ~30px,导致 Tab 文字下半截被裁
  innerTabBar: {
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    paddingBottom: 0,
    paddingTop: 0,
    overflow: 'visible',
  },
  // 水滴指示器：absolute 圆片，translateX 动画滑到当前 tab 槽位（栏高 68 → 垂直居中）
  tabBlob: {
    position: 'absolute',
    top: 2,
    left: 0,
    borderRadius: 25,
  },
  centerButtonWrap: {
    // 往上抬出 tab bar（保持原有凸出高度,再抬高 3px）
    top: -25,
    width: RING_OUTER_SIZE,
    height: RING_OUTER_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  glowRingOuter: {
    position: 'absolute',
    width: RING_OUTER_SIZE,
    height: RING_OUTER_SIZE,
    borderRadius: RING_OUTER_SIZE / 2,
    borderWidth: 1.5,
  },
  glowRingInner: {
    position: 'absolute',
    width: RING_INNER_SIZE,
    height: RING_INNER_SIZE,
    borderRadius: RING_INNER_SIZE / 2,
    borderWidth: 1,
  },
  ripple: {
    position: 'absolute',
    width: CORE_SIZE,
    height: CORE_SIZE,
    borderRadius: CORE_SIZE / 2,
  },
  centerButtonShadow: {
    width: CORE_SIZE,
    height: CORE_SIZE,
    borderRadius: CORE_SIZE / 2,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  // 边框 + 裁剪单独拆一层：overflow:hidden 会把同一个 View 上的阴影也裁掉，
  // 所以阴影放外层 centerButtonShadow，这层只负责描边和裁出圆形渐变面
  centerButton: {
    flex: 1,
    borderRadius: CORE_SIZE / 2,
    borderWidth: 2,
    overflow: 'hidden',
  },
  centerButtonFace: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerButtonShine: {
    // 偏椭圆的渐隐高光（宽度更窄、更靠上），像玻璃球面反光而不是贴纸
    position: 'absolute',
    top: 4,
    left: CORE_SIZE * 0.24,
    width: CORE_SIZE * 0.52,
    height: CORE_SIZE * 0.34,
    borderRadius: CORE_SIZE * 0.3,
  },
});
