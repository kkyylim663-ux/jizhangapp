import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
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

import { AppProvider, useApp } from './src/context/AppContext';
import { AuthProvider } from './src/context/AuthContext';
import { AppLockProvider, AppLockOverlay } from './src/context/AppLockContext';
import { AppDialogProvider } from './src/components/AppDialog';
import { useSyncManager } from './src/hooks/useSyncManager';
import { ThemeModeProvider } from './src/context/ThemeModeContext';
import { LanguageProvider, useT } from './src/i18n/LanguageContext';
// ⚠ 组件预览页（T03–T05 起）：只在 __DEV__ + web + ?gallery=1 时生效，不进正式导航。
//   后续每一批都用它做回归截图，**T32 清理任务时才删**（本行 + App() 里的 galleryMode 守卫 + 预览页文件）。
import ComponentGallery from './src/screens/_preview/ComponentGallery';
import { useNotificationSetup } from './src/hooks/useNotificationSetup';
import { usePaymentReminders } from './src/hooks/usePaymentReminders';
import {
  TabBarAutoHideProvider,
  useCreateTabBarAutoHide,
  useTabBarAutoHide,
} from './src/context/TabBarAutoHideContext';
import { useTheme } from './src/theme/useTheme';
import { useSystemColorScheme } from './src/theme/useSystemColorScheme';
// 浮空 Tab 栏的几何常量（全项目唯一来源）：外壳 / 底部留白 / 收起距离共用同一组数
import {
  TAB_BAR_HEIGHT,
  TAB_BAR_GAP,
  TAB_BAR_RAISE,
  TAB_BAR_SHELL_HEIGHT,
  TAB_CENTER_BUTTON_SIZE,
  TAB_CENTER_BUTTON_BOTTOM,
} from './src/hooks/useTabClearance';
// 标签文字走统一文字组件（令牌字号 caption2 = 11pt；英文自动走 Inter）
import { AppText } from './src/components/ui';
// 启动占位页只需要"现有主题底色"这一个令牌：此时 ThemeModeProvider 还没挂载，
// useTheme() 用不了（它会抛错），只能直接引 token
import { lightColors, darkColors } from './src/theme/theme';
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

// 中央「记一笔」圆钮（T06 G3，2026-10-10）：
// 56pt 纯 accent 圆 + 单层柔和阴影 + 白色「+」。旧的 8 段渐变光球 / 球面高光 / 描边 /
// 外光晕 / 水波纹整组退役（用户：简化到纯色）。
// 触摸区：整圆都落在 SlidingTabBar 外壳里（旧版用 top:-25 把大半截露在父容器外，
// Android 收不到父容器外的触摸 → 球的上半截点不中）。
// 铁律：不加任何按压视觉反馈（无缩放 / 无位移 / 无水波），只保留点击震动。
function CenterTabButton({ onPress }: { onPress?: () => void }) {
  const { semantic, elevation } = useTheme();
  const t = useT();

  return (
    <Pressable
      onPressIn={hapticLight}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('nav.add')}
      style={[
        styles.centerButton,
        // 不透明填充 → 阴影可以用 boxShadow（跨平台一致；elevation 令牌的浮层档）
        { backgroundColor: semantic.accent, boxShadow: elevation.level2.boxShadow },
      ]}
    >
      <Ionicons name="add" size={24} color={semantic.onAccent} />
    </Pressable>
  );
}

// 浮空 Tab 栏外壳：几何定位（absolute / 左右缩进 / 距底 / 圆角）与收起展开的 transform 在这里，
// 材质全部交给内层栏自己的 tabBarStyle（不透明 semantic.surfaceElevated + 顶/四周发丝线
// semantic.hairline + elevation.level2 阴影）——旧的多层描边 rim、水滴/托盘指示器、
// 列表渐隐遮罩全部退役（T06 G2 简化）。
// 外壳还负责一件事：**把中央圆钮整个包进可点区域**——外壳高度 = 栏身 + 圆钮凸起 + 触摸余量，
// 这样圆上缘（凸出栏顶的部分）在 Android 上也判得中。
// 注意：v7 会以普通函数方式调用 tabBar（tabBar(props) 而非 <tabBar/>），
// 所以这层不能放 hooks——hooks 全部在 SlidingTabBarInner 组件里。
function SlidingTabBar(props: any) {
  return <SlidingTabBarInner {...props} />;
}

// 栏圆角（与首页 Hero 卡一致：radius.lg = 20）
const BAR_RADIUS = 20;

function SlidingTabBarInner(props: any) {
  const insets = useSafeAreaInsets();
  const { translateY, opacity } = useTabBarAutoHide();
  const { state, navigation } = props;

  // 中央「+」的按压：与 react-navigation 内层 BottomTabItem 的行为逐字一致
  // （先 emit tabPress，没被阻止才 navigate）——这样 resetToRootOnTabPress 的
  // 「回根页 + 震动」监听照常生效；「记一笔」已聚焦时只 emit（回它自己的根页）
  const addIndex = state.routes.findIndex((r: any) => r.name === '记一笔');
  const onPressAdd = () => {
    const route = state.routes[addIndex];
    if (!route) return;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (state.index !== addIndex && !event.defaultPrevented) {
      navigation.dispatch({ ...CommonActions.navigate(route.name, route.params), target: state.key });
    }
  };

  return (
    <Animated.View
      // box-none：外壳本身不吃触摸（透明区域让页面照常点击），子元素（栏 / 圆钮）正常接收
      pointerEvents="box-none"
      style={[
        styles.tabShell,
        {
          // 栏底距安全区上沿留一道缝隙（浮空观感）；外壳向上多出「圆钮凸起 + 触摸余量」
          bottom: TAB_BAR_GAP + insets.bottom,
          height: TAB_BAR_SHELL_HEIGHT,
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      {/* 内层栏（react-navigation 自带）：底色 / 发丝线 / 圆角 / 阴影全在 screenOptions 的
          tabBarStyle 里（库内部把 tabBarStyle 排在样式数组最后，能压过它自带的底色/描边）；
          这里只把它的 54pt 内容区摆到外壳下缘（上缘留给凸起的圆钮） */}
      <View style={styles.tabBarRow}>
        <BottomTabBar {...props} />
      </View>

      {/* 中央「+」：绝对定位在外壳之内（整圆都在可点区里），横向居中对齐五个槽位的中缝 */}
      <View style={styles.centerButtonSlot} pointerEvents="box-none">
        <CenterTabButton onPress={onPressAdd} />
      </View>
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
  const { isDark, colors, semantic, spacing, elevation } = useTheme();
  const t = useT();
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
  // 顺带把浏览器滚动溢出区也染成应用底色（T06 G1：跟随语义底色 semantic.bg）
  useEffect(() => {
    if (Platform.OS === 'web') {
      document.body.style.backgroundColor = semantic.bg;
      document.documentElement.style.backgroundColor = semantic.bg;
    }
  }, [semantic.bg]);

  // 导航容器主题：背景跟应用底色一致（T06 G1：纯色 semantic.bg，不再跟薰衣草渐变）——
  // TabShell 预留的悬空条带、浮空栏圆角的缺口都由它上色，深色模式下才不会露出导航默认的浅灰
  const baseTheme = isDark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      background: semantic.bg,
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
      {/* T06 G1：全 App 页面底 = 纯色 semantic.bg（旧的薰衣草渐变退役；Hero 卡的紫色渐变
          是 HomeScreen 自己的事，不在这里）；屏幕容器透明，这一层就是全局底色画布。
          T07：根视图不再 marginBottom: insets.bottom + overflow: hidden 裁剪 ——
          抽屉 / 弹层可以正常贴到屏幕底边，页面内容也能画进导航条区域（edge-to-edge 正常行为） */}
      <View style={{ flex: 1, backgroundColor: semantic.bg }}>
      <NavigationContainer
        theme={navTheme}
        // 任何导航变化（切 Tab、push、pop）都让栏回到可见——
        // 新页面从顶部开始，收着栏会让人迷失
        onStateChange={tabAutoHide.reset}
      >
        <Tab.Navigator
          initialRouteName="首页"
          // 注意：tabBar 必须挂在 Navigator 本身（v7 经 ...rest 传进 BottomTabView），
          // 放在 screenOptions 里只会进 descriptors、不会被消费
          tabBar={SlidingTabBar}
          screenOptions={({ route }) => ({
            headerShown: false,
            // 选中 = 实心图标 + accent；未选中 = 线框图标 + 次要文字色（T06 G2）
            tabBarActiveTintColor: semantic.accent,
            tabBarInactiveTintColor: semantic.textSecondary,
            // 无障碍读屏名（标签改成函数式渲染后，库不再自动拼「x, tab, n of m」，显式给名字）
            tabBarAccessibilityLabel: tabLabels[route.name] ?? route.name,
            // 标签走统一文字组件：令牌字号 caption2 = 11pt（旧的 13pt 让英文「Settings」
            // 贴住选中托的边缘）+ 系统大字上限 1.3 + 英文自动 Inter
            tabBarLabel: ({ color, position }: { color: string; position: 'beside-icon' | 'below-icon' }) => (
              <AppText
                variant="caption2"
                color={color}
                numberOfLines={1}
                style={position === 'beside-icon' ? { marginStart: spacing.xs } : undefined}
              >
                {tabLabels[route.name] ?? route.name}
              </AppText>
            ),
            // 栏身材质（T06 G2）：不透明语义表面 + 发丝线 + 浮层阴影；
            // 旧的多层描边 rim / 水滴托盘 / 列表渐隐遮罩已随 SlidingTabBar 重做退役。
            // 几何（左右缩进 / 距底 / 圆角外的定位）由 SlidingTabBar 外壳负责
            tabBarStyle: {
              height: TAB_BAR_HEIGHT,
              // 关键:覆盖 BottomTabBar 内部默认的 paddingBottom: insets.bottom——
              // 外壳已经用 bottom: TAB_BAR_GAP + insets.bottom 避开过安全区，库内部再 pad 一次
              // 会把 54px 栏高的内容区压到 ~30px，导致 Tab 文字下半截被挤出卡片
              paddingBottom: 0,
              backgroundColor: semantic.surfaceElevated,
              // 发丝线：整圈 hairline（顶边就是列表与栏之间那道分隔线）
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: semantic.hairline,
              borderRadius: BAR_RADIUS,
              // 圆角要裁掉内容（历史上按渐变出血的装饰层会漏出来出直角）
              overflow: 'hidden',
              // 浮层阴影统一用跨平台 boxShadow（iOS / Android 一致），不再用 elevation
              boxShadow: elevation.level2.boxShadow,
              // ⚠库的 BottomTabBar 自带 styles.bottom.elevation: 8（安卓默认"黑"阴影）——
              // 半透明/浅色栏身上会透出一条中性暗带（=用户追过的"白条"暗半）；清零，
              // 阴影统一交给这里的 boxShadow
              elevation: 0,
            },
            // 自定义 tab 按钮：去掉 Android 默认的灰色水波纹（和紫色水滴叠在一起很脏）。
            // 铁律：底部 Tab 按钮不加任何按压视觉反馈、不发生布局位移（保留震动）
            tabBarButton: (props: any) => (
              <PlatformPressable
                {...props}
                pressColor="transparent"
                android_ripple={undefined}
                // 水平内边距收到 4：给 11pt 英文标签（Settings 等）多留一点排版余量
                style={[props.style, { paddingHorizontal: 4 }]}
              />
            ),
            tabBarIcon: ({ color, focused }) => {
              const icon = TAB_ICONS[route.name];
              if (!icon) return null;
              // 层次感：选中图标从描线切换为实底（Ionicons -outline ↔ 实底名）
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
            listeners={resetToRootOnTabPress('首页')}
          />
          <Tab.Screen
            name="资产"
            component={AssetStack}
            listeners={resetToRootOnTabPress('资产')}
          />
          <Tab.Screen
            name="记一笔"
            component={AddTransactionStack}
            options={{
              // 中央凸起圆钮由 SlidingTabBar 外壳自己画（这里让库只保留槽位，不渲染按钮/文字），
              // 圆钮横向居中对齐五个槽位的中缝
              tabBarLabel: () => null,
              tabBarButton: () => null,
            }}
            listeners={resetToRootOnTabPress('记一笔')}
          />
          <Tab.Screen name="统计">
            {() => <ReportScreen />}
          </Tab.Screen>
          <Tab.Screen
            name="设置项"
            component={ProfileStack}
            listeners={resetToRootOnTabPress('设置项')}
          />
        </Tab.Navigator>
      </NavigationContainer>
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
  // ⚠ 组件预览页开关（仅 __DEV__ + web + ?gallery=1；后续批次回归测试用，T32 清理时删）
  const galleryMode =
    Platform.OS === 'web' && typeof window !== 'undefined' && /[?&]gallery=1/.test(window.location.search);

  // 打包字体（计划 8.2 第 1 条 / T01b）：4 档 Inter 静态字重随包发，只覆盖数字 / 拉丁字形，
  // 中文继续走系统字体。键名 = 字体内部 PostScript 名，必须与 src/theme/theme.ts 的
  // fontFamily 令牌保持一致（改一处要同步另一处）。
  const [fontsLoaded, fontError] = useFonts({
    'Inter-Regular': require('./assets/fonts/Inter-Regular.ttf'),
    'Inter-Medium': require('./assets/fonts/Inter-Medium.ttf'),
    'Inter-SemiBold': require('./assets/fonts/Inter-SemiBold.ttf'),
    'Inter-Bold': require('./assets/fonts/Inter-Bold.ttf'),
  });
  // 占位页底色：ThemeModeProvider 还没挂载（它在下面才渲染），读不到用户在设置项里选的
  // 深色偏好，只能按系统外观取 theme.ts 的既有底色令牌——只影响字体加载这一瞬间的画面。
  // ⚠ 用自研的 useSystemColorScheme（RN 自带 useColorScheme 在 web 上不跟随系统变化，见该文件头注释）
  const systemScheme = useSystemColorScheme();

  // 字体未就绪：先铺满屏幕一层纯底色（不写任何文字）——不给用户看白屏，也不会闪一下
  // 系统字体再切换；加载失败（fontError 非空）照常往下渲染 App，退回系统字体，绝不卡死。
  // 不引 expo-splash-screen：app.json 现在没有任何 splash 插件配置，加它要动 app.json
  // 和原生工程，超出本任务边界。
  if (!fontsLoaded && !fontError) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: systemScheme === 'dark' ? darkColors.bg : lightColors.bg,
        }}
      />
    );
  }

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
                    {/* ⚠ 组件预览页（后续批次回归测试用，T32 清理时删）：
                        只在 __DEV__ + web + URL 带 ?gallery=1 时替换真实 App，不进正式导航。 */}
                    {__DEV__ && galleryMode ? <ComponentGallery /> : <AppContent />}
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

const styles = StyleSheet.create({
  // 浮空 Tab 栏外壳：只负责几何定位 + 承载收起/展开的 transform。
  // 高度 / 距底 / 圆钮槽位在外壳内联给（都要读 insets 与令牌常量）。
  // 中央圆钮凸出栏顶的部分也落在这个外壳里（高度 = TAB_BAR_SHELL_HEIGHT），
  // 这样 Android 才会把圆的上半截的触摸判给圆钮；overflow 必须 visible（圆钮投影画到外壳之外）。
  // 左右 12px：比 16 略窄，让每个 tab 的点击槽位更宽（与 Hero 卡右缘一致）
  tabShell: {
    position: 'absolute',
    left: 12,
    right: 12,
    overflow: 'visible',
  },
  // 内层栏的内容区（54pt）：紧贴外壳下缘，上缘留给凸出的圆钮
  tabBarRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: TAB_BAR_SHELL_HEIGHT - TAB_BAR_HEIGHT,
    height: TAB_BAR_HEIGHT,
  },
  // 中央圆钮槽：整圆都在槽内（槽高 = 圆径），横向居中 → 圆钮对准五个槽位的中缝
  centerButtonSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: TAB_CENTER_BUTTON_BOTTOM,
    height: TAB_CENTER_BUTTON_SIZE,
    alignItems: 'center',
  },
  // 中央圆钮本体：56pt 纯色圆（accent 底 + level2 阴影 + 白色「+」在 JSX 内联给）
  centerButton: {
    width: TAB_CENTER_BUTTON_SIZE,
    height: TAB_CENTER_BUTTON_SIZE,
    borderRadius: TAB_CENTER_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
