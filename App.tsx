import React, { useRef, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Pressable, Animated, Platform, StyleProp, ViewStyle } from 'react-native';
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
// 中央玻璃球用的 SVG 渐变/图形（别名避免和 expo 的 LinearGradient 重名）
import Svg, {
  Circle as SvgCircle,
  Defs as SvgDefs,
  Ellipse as SvgEllipse,
  LinearGradient as SvgLinearGradient,
  Path as SvgPath,
  RadialGradient as SvgRadialGradient,
  Stop as SvgStop,
} from 'react-native-svg';

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

// 中间那个凸起的圆形"记一笔"按钮，盖在底部Tab栏上方。
// 独立函数组件，会被 Tab.Navigator 渲染在 ThemeModeProvider 之下，
// 可以直接自己调用 useTheme() 拿主题色。
//
// 设计（2026-10-06 换版，照用户效果图取值）：玻璃球体 ——
// 上半是亮面玻璃（顶部高光 → 浅薰衣草），向下【平滑渐变】过渡到蓝紫填充
// （用户明确：要颜色渐变、不要双拼硬分界）；球体描边用很淡的垂直渐变
// （顶淡底略亮，收着画）；球面上半一片很轻的渐隐椭圆高光；
// 球外两层光晕（薰衣草大晕 + 偏下的品红光团）用 SVG 径向渐变画，尺寸已收敛。
// 按下仍是水波纹 + 轻触感，行为未动。
function CenterTabButton({
  onPress,
  style,
}: {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, isDark } = useTheme();
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
    <Pressable
      onPressIn={triggerRipple}
      onPress={onPress}
      style={[style, styles.centerButtonPress]}
    >
      <View style={styles.centerButtonWrap}>
        {/* 球外光晕（2026-10-09 修正 24 处方 5）：只保留一圈很淡的同色光晕 ——
            原来的「偏下品红光团」整层删除（用户「去掉粉色外晕」；fabOrbAuraBloom 0 引用保留）。
            渐变 id 带主题指纹（修正 14 铁律：RNSVG 同 id 跨主题不重建定义） */}
        <View style={styles.centerAura} pointerEvents="none">
          <Svg width={AURA_SIZE} height={AURA_SIZE}>
            <SvgDefs>
              <SvgRadialGradient id={`fabAuraHalo${isDark ? 'D' : 'L'}`} cx="50%" cy="50%" r="50%">
                <SvgStop offset="0" stopColor={colors.fabOrbAura} stopOpacity={0.26} />
                <SvgStop offset="0.5" stopColor={colors.fabOrbAura} stopOpacity={0.26} />
                <SvgStop offset="0.72" stopColor={colors.fabOrbAura} stopOpacity={0.14} />
                <SvgStop offset="0.9" stopColor={colors.fabOrbAura} stopOpacity={0.04} />
                <SvgStop offset="1" stopColor={colors.fabOrbAura} stopOpacity={0} />
              </SvgRadialGradient>
            </SvgDefs>
            <SvgCircle cx={52} cy={52} r={47} fill={`url(#fabAuraHalo${isDark ? 'D' : 'L'})`} />
          </Svg>
        </View>

        {/* 点击水波纹：从按钮同尺寸放大并淡出（行为与旧版一致） */}
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
          <View style={styles.centerButton}>
            {/* 球体基底：垂直渐变 —— 顶部高光 → 浅薰衣草玻璃 → 平滑过渡到
                蓝紫填充向下渐深（纯渐变，无硬分界/液面线） */}
            <LinearGradient
              colors={[
                colors.fabOrbGlassTop,
                colors.fabOrbGlassFall,
                colors.fabOrbGlassMid,
                colors.fabOrbGlassLow,
                colors.fabOrbGlassEdge,
                colors.fabOrbFillTop,
                colors.fabOrbFillLow,
                colors.fabOrbFillBottom,
              ]}
              locations={[0, 0.07, 0.22, 0.5, 0.66, 0.8, 0.9, 1]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.centerButtonFace}
            >
              {/* 球面高光 + 球体描边（顶淡底亮）+ 白色加号，叠在基底层上 */}
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <Svg width={CORE_SIZE} height={CORE_SIZE}>
                  <SvgDefs>
                    <SvgRadialGradient id="fabOrbLight" cx="50%" cy="50%" r="50%">
                      <SvgStop offset="0" stopColor="#FFFFFF" stopOpacity={0.22} />
                      <SvgStop offset="0.55" stopColor="#FFFFFF" stopOpacity={0.08} />
                      <SvgStop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
                    </SvgRadialGradient>
                    {/* 白色细亮边（修正 24 处方 5）：整圈 0.45~0.62 的白，细而不虚 */}
                    <SvgLinearGradient id="fabOrbRim" x1="0" y1="0" x2="0" y2="1">
                      <SvgStop offset="0" stopColor="#FFFFFF" stopOpacity={0.45} />
                      <SvgStop offset="0.3" stopColor="#FFFFFF" stopOpacity={0.6} />
                      <SvgStop offset="0.7" stopColor="#FFFFFF" stopOpacity={0.5} />
                      <SvgStop offset="1" stopColor="#FFFFFF" stopOpacity={0.62} />
                    </SvgLinearGradient>
                  </SvgDefs>
                  <SvgEllipse cx={26.7} cy={17.5} rx={22.75} ry={19.25} fill="url(#fabOrbLight)" />
                  <SvgCircle
                    cx={28}
                    cy={28}
                    r={27.3}
                    fill="none"
                    stroke="url(#fabOrbRim)"
                    strokeWidth={1.1}
                  />
                  <SvgPath
                    d="M28 20.34 V35.66 M20.34 28 H35.66"
                    stroke={colors.fabIcon}
                    strokeOpacity={0.1}
                    strokeWidth={4.4}
                    strokeLinecap="round"
                  />
                  <SvgPath
                    d="M28 20.34 V35.66 M20.34 28 H35.66"
                    stroke={colors.fabIcon}
                    strokeWidth={3.1}
                    strokeLinecap="round"
                  />
                </Svg>
              </View>
            </LinearGradient>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// 浮空 Tab 栏的可滑动外壳：几何定位（absolute/左右缩进/距底）在这里，
// 视觉全部由本层负责：底色+圆角+投影在 tabBase（毛玻璃渐变垫在图标下面），
// 描边在渐变描边覆盖层（见下方 outlineD）；内部 BottomTabBar 只留布局、底色透明。
// 注意：v7 会以普通函数方式调用 tabBar（tabBar(props) 而非 <tabBar/>），
// 所以这层不能放 hooks——hooks 全部在 SlidingTabBarInner 组件里。
function SlidingTabBar(props: any) {
  return <SlidingTabBarInner {...props} />;
}

// 选中托（2026-10-09 修正 24 处方 3）：圆角方小托 —— 圆角 15 = 与顶部玻璃按钮一致
const BLOB_W = 54;
const BLOB_H = 46;
const BLOB_RADIUS = 15;
// 栏圆角（处方 6：与首页卡片一致 —— Hero 卡 20）
const BAR_RADIUS = 20;
// 栏缘 9 层柔光的描边宽度（沿用 GlassLift 方案：0.25→2.25 逐层加粗、共用一条竖向白渐变）
const RIM_STROKES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25];
// 列表渐隐遮罩高度（处方 2）：48dp 渐变带；同一数值已计入 useTabClearance 的底部留白
const TAB_FADE_H = 48;

function SlidingTabBarInner(props: any) {
  const { colors, isDark } = useTheme();
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

  // 胶囊描边路径：整圈圆角矩形（描边画在内容之下，球体自然遮住穿越处，无需留缺口）
  const O_ROUND = BAR_RADIUS - 0.6; // 描边路径圆角半径（= 栏圆角 − 内缩 0.6，与栏边线严丝合缝）
  const outlineD =
    barW > O_ROUND * 2 + 2
      ? [
          `M ${O_ROUND + 0.6} 0.6`,
          `H ${barW - 0.6 - O_ROUND}`,
          `A ${O_ROUND} ${O_ROUND} 0 0 1 ${barW - 0.6} ${O_ROUND + 0.6}`,
          `V ${54 - O_ROUND - 0.6}`,
          `A ${O_ROUND} ${O_ROUND} 0 0 1 ${barW - 0.6 - O_ROUND} ${54 - 0.6}`,
          `H ${O_ROUND + 0.6}`,
          `A ${O_ROUND} ${O_ROUND} 0 0 1 0.6 ${54 - O_ROUND - 0.6}`,
          `V ${O_ROUND + 0.6}`,
          `A ${O_ROUND} ${O_ROUND} 0 0 1 ${O_ROUND + 0.6} 0.6`,
          'Z',
        ].join(' ')
      : '';

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
      {/* 列表渐隐遮罩（2026-10-09 修正 24 处方 2）：栏上方 48dp，从「背景渐变的末端色 · 透明」
          渐到不透明 → 列表滚到栏附近时柔和淡出，不会被栏硬切、也不会透进栏里。
          左右 -12 出血到屏幕边（外壳本身左右各缩进 12）；pointerEvents none 不挡操作；
          颜色取 bgGradientTo（= 栏顶区域的本地色，避免与页面渐变出现接缝），日/夜实时切换 */}
      <LinearGradient
        colors={[colors.bgGradientTo + '00', colors.bgGradientTo + 'B3', colors.bgGradientTo]}
        locations={[0, 0.6, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.tabFadeMask}
        pointerEvents="none"
      />

      {/* 栏体（2026-10-09 修正 24 处方 1；修正 25 日间金属化）：**完全不透明**的同色系竖向渐变，
          背后内容彻底不透出来（用户：「背后的内容完全不透出来，画面干净」）；
          日间档 = 与顶部按钮同一「银紫拉丝金属」3 段（亮 → 略暗 → 中间调，见 lightColors.tabGlass*）；
          外投影深紫、向下偏移柔和扩散 —— 填充不透明，这里可以走 elevation
          （半透明填充才必须禁 elevation；当年那条"白条"= 库内层栏自带 elevation:8，
          已在 tabBarStyle / innerTabBar 里清零，别再动那两处） */}
      <LinearGradient
        colors={[colors.tabGlassFrom, colors.tabGlassMid, colors.tabGlassTo]}
        locations={[0, 0.5, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[
          styles.tabBaseFill,
          {
            shadowColor: colors.tabShadow,
            shadowOffset: { width: 0, height: 8 },
            shadowRadius: 18,
            shadowOpacity: isDark ? 0.4 : 0.26,
            elevation: 8,
          },
        ]}
      />

      {/* 栏缘（2026-10-09 修正 24 处方 1；修正 25 日间金属化）：夜间＝白色细边（1px 0.22）
          + 顶缘柔光（沿用 GlassLift 的 9 层描边方案：同一白竖向渐变、逐层 0.25→2.25 加粗，
          顶最亮、往下渐暗；绝不做 per-path opacity 台阶）。
          日间＝与顶部按钮同一「金属倒角」：单层 1px 描边 + 竖向渐变（顶白 0.95 锐利高光 →
          0.7 处仍近白 → 底 rgb(60,40,120) 0.22 深紫灰）= 顶部/两侧亮棱、底部暗边；
          日间不再画那 9 层柔光（用户：去掉柔和发光，边缘要锐利）。
          原来那条对角 X 型粉红描边（tabOutline*）整层删除（用户：去掉所有粉红/粉紫描边）。
          ⚠ 渐变 id 必须带主题指纹（修正 14 铁律：RNSVG 同 id 跨主题不重建定义）；
          ⚠ RNSVG 的 Stop 不读 stopColor 的 rgba alpha（修正 13）→ 底部色拆 rgb + stopOpacity
          （值 = lightColors.glassEdgeShade rgba(60,40,120,0.22)，两处改动要同步） */}
      {outlineD ? (
        <View style={styles.tabRim} pointerEvents="none">
          <Svg width={barW} height={54}>
            <SvgDefs>
              {isDark ? (
                <SvgLinearGradient id="tabRimGradD" x1="0" y1="0" x2="0" y2="1">
                  <SvgStop offset="0" stopColor="#FFFFFF" stopOpacity={0.017} />
                  <SvgStop offset="0.5" stopColor="#FFFFFF" stopOpacity={0.0131} />
                  <SvgStop offset="1" stopColor="#FFFFFF" stopOpacity={0.0105} />
                </SvgLinearGradient>
              ) : (
                <SvgLinearGradient id="tabChamferL" x1="0" y1="0" x2="0" y2="1">
                  <SvgStop offset="0" stopColor="#FFFFFF" stopOpacity={0.95} />
                  <SvgStop offset="0.7" stopColor="#FFFFFF" stopOpacity={0.8} />
                  <SvgStop offset="1" stopColor="rgb(60,40,120)" stopOpacity={0.22} />
                </SvgLinearGradient>
              )}
            </SvgDefs>
            {isDark ? (
              <>
                {RIM_STROKES.map((w) => (
                  <SvgPath
                    key={w}
                    d={outlineD}
                    stroke="url(#tabRimGradD)"
                    strokeWidth={w}
                    fill="none"
                  />
                ))}
                <SvgPath d={outlineD} stroke={colors.tabEdge} strokeWidth={1} fill="none" />
              </>
            ) : (
              <SvgPath d={outlineD} stroke="url(#tabChamferL)" strokeWidth={1} fill="none" />
            )}
          </Svg>
        </View>
      ) : null}

      {/* 选中托（2026-10-09 修正 24 处方 3）：圆角方小托（圆角 15 = 顶部玻璃按钮同值）——
          白填充（夜 0.10 / 日 0.7）+ 白细边；**画在按钮层之前 = 在图标/文字之下**（"托"在背后，
          日间 0.7 的白才不会把图标洗掉；内层栏底色已透明，不会再像旧版那样被白胶囊盖住）；
          切换 Tab 由 spring 滑过去（复用原 blobX spring + 液体挤压，行为未动）。
          ⚠ 半透明填充 → 阴影只能 boxShadow（外部专用），禁用 elevation（会透出内框，既有铁律） */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.tabBlob,
          {
            width: BLOB_W,
            height: BLOB_H,
            transform: [{ translateX: blobX }, { scaleX: squashX }, { scaleY: squashY }],
            backgroundColor: colors.tabBlobBg,
            borderWidth: 1,
            borderColor: colors.tabEdge,
            boxShadow: isDark ? '0px 3px 10px rgba(18,8,43,0.45)' : '0px 3px 10px rgba(61,42,122,0.22)',
            opacity: blobOpacity,
          },
        ]}
      />

      <BottomTabBar {...props} style={styles.innerTabBar} />
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
          外层 View 垫满全屏，内层 margin 掉导航条高度并裁剪——页面内容/弹层画不进
          导航键区域，那一条显示纯色底。⚠垫色必须用背景渐变的【末端色】而不是主题底色：
          它是渐变正下方的一整条，颜色不一致时会在底部显出一条贯穿全宽的"长方横条"
          （日间淡紫 vs 近白最明显，夜间深蓝 vs 近黑偶尔可见） */}
      <View style={{ flex: 1, backgroundColor: colors.bgGradientTo }}>
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
            tabBarActiveTintColor: colors.homeIconColor,
            // 未选中 = 同色 45% 透明（处方 4；homeIconColor 是 6 位 hex，拼 '73' = alpha 0.45）
            tabBarInactiveTintColor: colors.homeIconColor + '73',
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
              // 底色/圆角/投影全部下放到外壳的 tabBase（毛玻璃渐变垫底），这里透明即可
              backgroundColor: 'transparent',
              borderTopWidth: 0,
              // ⚠库的 BottomTabBar 自带 styles.bottom.elevation: 8（安卓默认"黑"阴影）——
              // 栏身透明后这条阴影直接透出来，成一条横贯全宽的中性暗带（=用户一直追的
              // "白条"对比里的暗半；Web 不渲染 elevation，所以只有手机看得出来）。清零，
              // 阴影统一交给外壳/球/水滴自己画
              elevation: 0,
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
              tabBarButton: (props) => (
                <CenterTabButton onPress={props.onPress as any} style={props.style} />
              ),
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
// 球外光晕画布：比球径 56 大一圈（104），容纳两层径向渐变的衰减尾巴（光晕已收小）
const AURA_SIZE = 104;

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
    // 同上：清掉库默认 elevation: 8 的安卓阴影（否则透明栏身上会浮出一条暗带）
    elevation: 0,
    overflow: 'visible',
  },
  // 栏底渐变层（2026-10-09 修正 24）：不透明竖向渐变 + 自己裁圆角（圆角 = Hero 卡 20）；
  // 投影在 JSX 内联给（深紫、向下 8、柔和扩散、elevation 8 —— 填充不透明才允许走 elevation）
  tabBaseFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 54,
    borderRadius: BAR_RADIUS,
  },
  // 列表渐隐遮罩（2026-10-09 修正 24 处方 2）：栏上方 48dp；左右 -12 出血到屏幕边
  tabFadeMask: {
    position: 'absolute',
    left: -12,
    right: -12,
    bottom: 54,
    height: TAB_FADE_H,
  },
  // 栏缘覆盖层（白细边 + 9 层顶缘柔光）：铺满外壳（54 高），画在栏体之上、选中托/内容之下
  tabRim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 54,
  },
  // 选中托（修正 24 处方 3）：圆角方小托，圆角 15 与顶部玻璃按钮一致；54×46 垂直居中
  tabBlob: {
    position: 'absolute',
    top: (54 - BLOB_H) / 2,
    left: 0,
    borderRadius: BLOB_RADIUS,
  },
  // 记一笔按钮根节点：接住 react-navigation 给按钮的容器 style（其余 4 个 tab 同款，
  // 其中带 alignItems:'center'）；再清掉图标按钮的 5px 内边距——球体包壳 80 宽比槽位
  // 宽，本来靠左会右偏 ~6px（缺口就对不中），这层居中后球心=槽心=胶囊中心
  centerButtonPress: {
    padding: 0,
    alignItems: 'center',
  },
  centerButtonWrap: {
    // 往上抬出 tab bar（保持原有凸出高度,再抬高 3px）
    top: -25,
    width: RING_OUTER_SIZE,
    height: RING_OUTER_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // 光晕画布定位：口径取整让画布中心对准球心（圆心坐标见组件内 circle 的 cx/cy）
  centerAura: {
    position: 'absolute',
    left: (RING_OUTER_SIZE - AURA_SIZE) / 2,
    top: (RING_OUTER_SIZE - AURA_SIZE) / 2 - 2.6,
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
  // 描边/裁剪拆层的老规矩不变：这层只负责裁出圆形渐变面，描边改由球内 SVG 画
  centerButton: {
    flex: 1,
    borderRadius: CORE_SIZE / 2,
    overflow: 'hidden',
  },
  centerButtonFace: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
