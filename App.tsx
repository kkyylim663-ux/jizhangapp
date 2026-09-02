import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { NavigationContainer, CommonActions } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';

import { AppProvider } from './src/context/AppContext';
import { ThemeModeProvider } from './src/context/ThemeModeContext';
import { useTheme } from './src/theme/useTheme';
import HomeScreen from './src/screens/HomeScreen';
import AddTransactionScreen from './src/screens/AddTransactionScreen';
import TransactionListScreen from './src/screens/TransactionListScreen';
import ReportScreen from './src/screens/ReportScreen';
import AssetScreen from './src/screens/AssetScreen';
import AIScreen from './src/screens/AIScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import CategoryManagementScreen from './src/screens/CategoryManagementScreen';
import CurrencyScreen from './src/screens/CurrencyScreen';
import PeriodScreen from './src/screens/PeriodScreen';
import LedgerScreen from './src/screens/LedgerScreen';
import PersonalCenterScreen from './src/screens/PersonalCenterScreen';
import AboutAppScreen from './src/screens/AboutAppScreen';
import HelpFeedbackScreen from './src/screens/HelpFeedbackScreen';
import CalculatorHubScreen from './src/screens/CalculatorHubScreen';
import LoanCalculatorScreen from './src/screens/LoanCalculatorScreen';
import CompoundInterestScreen from './src/screens/CompoundInterestScreen';


const Tab = createBottomTabNavigator();
const HomeStackNav = createNativeStackNavigator();
const ProfileStackNav = createNativeStackNavigator();

// "首页"Tab内部堆栈：仪表盘首页 → 记一笔（编辑/从今日账单点进来）→ 账单明细
// 这里的"记一笔"和下面底部Tab里的"记一笔"是同一个组件，注册两次：
// - 这里用于"编辑已有记录"这种场景，走Stack的push/back，体验更顺
// - 底部Tab那个用于"点击中间圆按钮直接开始记一笔"，每次都是全新的
function HomeStack() {
  const { colors } = useTheme();
  return (
    <HomeStackNav.Navigator
      screenOptions={{
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { color: colors.textPrimary },
        headerShadowVisible: false,
      }}
    >
      <HomeStackNav.Screen name="首页" component={HomeScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="记一笔" component={AddTransactionScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="账单明细" component={TransactionListScreen} />
      {/* 跟 ProfileStack 里的"开设账本"是同一个组件注册两次：这样从首页进来 push 到的是
          HomeStack 自己的栈，系统返回箭头 goBack() 天然回首页；从设置项进来同理天然回设置 */}
      <HomeStackNav.Screen name="开设账本" component={LedgerScreen} />
      <HomeStackNav.Screen name="个人中心" component={PersonalCenterScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="关于应用" component={AboutAppScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="帮助与反馈" component={HelpFeedbackScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="计算器" component={CalculatorHubScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="贷款计算器" component={LoanCalculatorScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="复利计算器" component={CompoundInterestScreen} options={{ headerShown: false }} />
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
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { color: colors.textPrimary },
        headerShadowVisible: false,
      }}
    >
      <ProfileStackNav.Screen name="我的主页" component={ProfileScreen} options={{ headerShown: false }} />
      <ProfileStackNav.Screen name="设置" component={SettingsScreen} />
      <ProfileStackNav.Screen name="类别分类" component={CategoryManagementScreen} />
      <ProfileStackNav.Screen name="选择货币" component={CurrencyScreen} />
      <ProfileStackNav.Screen name="自定义周期" component={PeriodScreen} />
      <ProfileStackNav.Screen name="开设账本" component={LedgerScreen} />
      {/* AI专区先挂在这个堆栈里，入口按钮要等 SettingsScreen/ProfileScreen 确认版本后再加 */}
      <ProfileStackNav.Screen name="AI专区" component={AIScreen} />
    </ProfileStackNav.Navigator>
  );
}

// 中间那个凸起的圆形"记一笔"按钮，盖在底部Tab栏上方
// 这是独立的函数组件，会被 Tab.Navigator 渲染在 ThemeModeProvider 之下，
// 所以可以直接自己调用 useTheme() 拿主题色，不用从外面一层层传 props。
function CenterTabButton({ onPress }: { onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity style={styles.centerButtonWrap} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.centerButton, { backgroundColor: colors.fabBg }]}>
        <Ionicons name="add" size={28} color={colors.fabIcon} />
      </View>
    </TouchableOpacity>
  );
}

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  首页: 'home-outline',
  资产: 'wallet-outline',
  统计: 'bar-chart-outline',
  设置项: 'settings-outline',
};

// 首页/设置项这两个 Tab 底下套了 Stack，切走再切回来时 React Navigation 默认会
// 保留你当时停在 Stack 第几层（比如还停在"账单明细"），不会自动回到根页面。
// 这个函数生成一个 tabPress 监听：每次点这个 Tab，都强制把它内层 Stack 重置回根页面。
//
// 注意：判断"要不要重置"必须在 dispatch 之前用 navigation.getState() 做完，
// 不能写在 dispatch(updaterFn) 的回调里再 return state 当"不用处理"的信号——
// 那样等于把整个导航 state（自带 type: 'tab' 字段）当成一个 action 派发出去，
// 会报 "The action 'tab' was not handled by any navigator" 这个错。
function resetToRootOnTabPress(tabName: string) {
  return ({ navigation }: any) => ({
    tabPress: () => {
      const state = navigation.getState();
      const tabRoute = state.routes.find((r: any) => r.name === tabName);
      // 已经在根页面（没有嵌套 state，或者嵌套 index 就是 0），什么都不用做，直接返回
      if (!tabRoute?.state || tabRoute.state.index === 0) return;
      const newRoutes = state.routes.map((r: any) => (r.name === tabName ? { ...r, state: undefined } : r));
      navigation.dispatch(CommonActions.reset({ ...state, routes: newRoutes }));
    },
  });
}

// Tab 导航 + 状态栏，拆成 ThemeModeProvider 下面的内层组件，
// 这样才能在这里调用 useTheme() 读到用户在设置项里选的深色模式偏好。
// App() 自己不行——ThemeModeProvider 是 App() 渲染出来的，
// useTheme() 得在它渲染出的子孙组件里调用才能读到值。
function AppContent() {
  const { isDark, colors } = useTheme();

  return (
    <>
      <NavigationContainer>
        <Tab.Navigator
          initialRouteName="首页"
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor: colors.textPrimary,
            tabBarInactiveTintColor: colors.textTertiary,
            tabBarStyle: {
              backgroundColor: colors.card,
              borderTopColor: colors.dividerHair,
            },
            tabBarIcon: ({ color }) =>
              TAB_ICONS[route.name] ? <Ionicons name={TAB_ICONS[route.name]} size={22} color={color} /> : null,
          })}
        >
          <Tab.Screen name="首页" component={HomeStack} listeners={resetToRootOnTabPress('首页')} />
          <Tab.Screen name="资产" component={AssetScreen} />
          <Tab.Screen
            name="记一笔"
            component={AddTransactionScreen}
            options={{
              tabBarLabel: () => null,
              tabBarButton: (props) => <CenterTabButton onPress={props.onPress as any} />,
            }}
          />
          <Tab.Screen name="统计" component={ReportScreen} />
          <Tab.Screen name="设置项" component={ProfileStack} listeners={resetToRootOnTabPress('设置项')} />
        </Tab.Navigator>
      </NavigationContainer>
      {/* 'auto' 只跟随系统外观，不认用户在设置里选的"始终亮色/暗色"；
          改成根据 isDark 显式指定，才能和应用内其他地方的主题联动一致 */}
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeModeProvider>
          <AppProvider>
            <AppContent />
          </AppProvider>
        </ThemeModeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  centerButtonWrap: {
    top: -18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
});
