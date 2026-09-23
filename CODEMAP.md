# CODEMAP.md — 代码导航地图（jizhang-app）

> 本文件是给 AI / 新成员用的"先看地图再动刀"导航页。内容与当前代码逐文件核对过。
> 配套阅读：`PROJECT.md`（功能与技术栈）、`AGENTS.md`(开发规则)、`UI_RULES.md` / `ARCHITECTURE.md` / `DATABASE.md`（如存在）。

---

## 一、安全编辑工作流（动任何文件之前必须遵守）

### 1. 编辑前 —— 先勘察，不要立刻重写

1. **禁止直接重写目标文件**。先用 Read/搜索通读相关实现，弄清现状。
2. 用本地图定位"主文件 + 关联文件"，至少确认：
   - 有没有**可复用**的组件 / hooks / 工具 / 类型（优先扩展，禁止复制粘贴造重复轮子）
   - 同一组件是否在**多个 Stack 里注册了两次**（见下文"双注册陷阱"）
3. 数据结构变更时，必须追踪 `AppContext.tsx` 里的持久化读写和所有消费该字段的屏幕。

### 2. 编辑中 —— 守住现有功能

- 不静默删除功能；UI 重做必须保留原信息、业务逻辑、导航、数据加载与计算。
- 不引入新框架/状态库/UI 库，除非有明确架构理由。
- TypeScript：复用 `src/types/index.ts` 既有类型，避免 `any`，改完自己消掉类型错误。
- UI：统一用 `src/theme/theme.ts` 的设计令牌（间距/圆角/字号/颜色），单屏不得自创设计语言。

### 3. 编辑后 —— 验证才算完成

```bash
npx tsc --noEmit        # 本项目无 lint/测试，类型检查是唯一自动化验证手段
```

再人工核对：imports 可解析、受影响屏幕能渲染、空/加载/错误状态、导航路径没断。

---

## 二、目录地图

```
App.tsx                     # 入口：Provider 层级 + 全部导航（Tab + 两个 Stack）
app.json / eas.json         # Expo & EAS 配置
src/
├─ config/aiConfig.ts       # OpenRouter API 配置（模型名、密钥）
├─ constants/uncategorized.ts
├─ context/
│  ├─ AppContext.tsx        # ★ 单一全局 Context：全部业务数据 + AsyncStorage 持久化
│  ├─ ThemeModeContext.tsx  # 深色模式偏好（跟随系统 + 手动覆盖）
│  └─ TabBarAutoHideContext.tsx  # 滚动时浮空 TabBar 自动收起
├─ hooks/
│  ├─ useAmountExpression.ts    # 金额四则表达式
│  ├─ useMoneyCentsInput.ts     # 金额输入（分单位）
│  ├─ useNotificationSetup.ts   # 推送注册
│  ├─ usePaymentReminders.ts    # 财务规划付款提醒（13:00/18:30 检查 7 天内到期）
│  └─ useTabClearance.ts        # 内容底部避开浮空 TabBar
├─ components/              # 可复用组件（改 UI 先来这里找）
│  ├─ AmountCalculatorKeypad.tsx / AmountEntryPanel.tsx / MoneyInput.tsx
│  ├─ ChainedTextInput.tsx / FieldChainProvider.tsx
│  ├─ DateRangePickerSheet.tsx
│  ├─ DonutChart.tsx        # SVG 环形图
│  ├─ PressableScale.tsx    # 按压缩放反馈
│  └─ ReceiptCameraModal.tsx    # 拍小票
├─ screens/                 # 18 个屏幕（见下文导航树）
├─ theme/
│  ├─ theme.ts              # ★ 全部设计令牌：颜色/间距/圆角/字号
│  └─ useTheme.ts           # 取当前主题色（深色模式联动）
├─ types/index.ts           # ★ 共享类型，改数据结构先改这里
└─ utils/
   ├─ amountExpression.ts   # 四则表达式求值
   ├─ creditCard.ts         # 信用卡：可用额度 vs 欠费金额两套算法
   ├─ currencies.ts         # 内置 12 种货币
   ├─ defaultCategories.ts  # 预置 30 支出 + 6 收入分类
   ├─ haptics.ts            # 震动反馈封装
   ├─ notifications.ts      # expo-notifications 封装
   ├─ scanReceipt.ts        # AI 小票识别（OpenRouter 视觉模型）
   └─ voiceAccounting.ts    # AI 语音记账（ASR + LLM 解析）
```

★ = 高扇出文件：改它们会影响几乎所有屏幕，必须全项目核对。

---

## 三、导航树（`App.tsx`）

```
Tab.Navigator（自定义浮空 TabBar + 中央凸起"+"按钮；切 Tab 自动 reset 回根页面）
├─ 首页   → HomeStack（native-stack）
│    ├─ 首页 HomeScreen（仪表盘，headerShown:false）
│    ├─ 记一笔 AddTransactionScreen（编辑场景入口，headerShown:false）
│    ├─ 账单明细 TransactionListScreen
│    ├─ 开设账本 LedgerScreen          ← 与 ProfileStack 里同名路由双注册
│    ├─ 个人中心 PersonalCenterScreen（headerShown:false）
│    ├─ 关于应用 AboutAppScreen（headerShown:false）
│    ├─ 帮助与反馈 HelpFeedbackScreen（headerShown:false）
│    ├─ 计算器 CalculatorHubScreen（headerShown:false）
│    ├─ 贷款计算器 LoanCalculatorScreen（headerShown:false）
│    └─ 复利计算器 CompoundInterestScreen（headerShown:false）
├─ 资产   → AssetScreen（直接挂 Tab，无 Stack）
├─ 记一笔 → CenterTabButton（凸起圆按钮，非真实 Tab.Screen 组件页）
│           onPress 直接跳 AddTransactionScreen，每次全新
├─ 统计   → ReportScreen（直接挂 Tab，无 Stack）
└─ 设置项 → ProfileStack（native-stack）
     ├─ 我的主页 ProfileScreen（预算，headerShown:false）
     ├─ 设置 SettingsScreen
     ├─ 类别分类 CategoryManagementScreen
     ├─ 选择货币 CurrencyScreen
     ├─ 自定义周期 PeriodScreen
     ├─ 开设账本 LedgerScreen          ← 与 HomeStack 里同名路由双注册
     └─ AI专区 AIScreen
```

### ⚠️ 双注册陷阱

**同一个组件在两个 Stack 里各注册一次**（`记一笔`、`开设账本`），这是有意设计：
push 进的是**当前所在 Stack** 自己的栈，`goBack()` 天然回到正确来源页（首页或设置）。
因此：

- 改这两个屏幕的**导航参数/跳转逻辑**时，两处注册都要核对；
- 新增**全局可达**的页面时，决定它挂在哪个 Stack（决定返回行为），必要时两边都注册；
- 路由 `name` 是**中文字符串**，跳转代码里写的就是中文（如 `navigation.navigate('账单明细')`），改名要全局搜索。

---

## 四、"要改 X → 看 Y"速查表

| 想改什么 | 主文件 | 必查关联 |
| --- | --- | --- |
| 金额输入 / 计算器键盘 | `AmountCalculatorKeypad` `AmountEntryPanel` `MoneyInput` | `useAmountExpression` `useMoneyCentsInput` `amountExpression.ts` |
| 交易类型/转账/手续费逻辑 | `AddTransactionScreen` | `AppContext.tsx`（类型定义+持久化）、`types/index.ts` |
| 首页卡片 / 预算进度 / 月份切换 | `HomeScreen` | `AppContext.tsx`、`DonutChart`（若涉及图表） |
| 账单明细分组 | `TransactionListScreen` | `AppContext.tsx` |
| 资产账户 / 信用卡字段 | `AssetScreen` | `creditCard.ts`（可用额度≠欠费金额）、`AppContext.tsx` |
| 统计图表 | `ReportScreen` `DonutChart` | `AppContext.tsx`、月份切换逻辑 |
| 分类（预置/自定义） | `CategoryManagementScreen` | `defaultCategories.ts`、`constants/uncategorized.ts` |
| 多账本 | `LedgerScreen` | `AppContext.tsx`（所有数据带 `ledgerId`，默认账本 `default` 不可删） |
| 货币 / 汇率 | `CurrencyScreen` | `currencies.ts`、转账跨币种 `convertedAmount` 逻辑 |
| 统计周期 | `PeriodScreen` | `AppContext.tsx` |
| 深色模式 / 颜色 | `ThemeModeContext.tsx` `theme.ts` | 所有 `useTheme()` 消费者；新颜色必须进 `theme.ts` |
| 财务规划 / 计划付款 / 提醒 | `FinancialPlanningScreen` | `AppContext.tsx`（paymentPlans CRUD+补账）`paymentPlans.ts` 引擎 `usePaymentReminders.ts` `notifications.ts` |
| AI 小票扫描 | `scanReceipt.ts` `ReceiptCameraModal` | `aiConfig.ts`、`AddTransactionScreen` 回填表单 |
| AI 语音记账 | `voiceAccounting.ts` `AIScreen` | `aiConfig.ts` |
| 计算器合集 | `CalculatorHubScreen` → `LoanCalculatorScreen` / `CompoundInterestScreen` | 双注册问题：目前只挂 HomeStack |
| TabBar 样式 / 凸起按钮 / 自动收起 | `App.tsx`（`CenterTabButton`、自定义 TabBar） | `TabBarAutoHideContext` `useTabClearance` |
| 设置项列表 | `SettingsScreen` | 各子页面（货币/周期/类别/账本） |

---

## 五、数据流一句话

所有读写都走 `src/context/AppContext.tsx`（React Context + 多个 `useState`），持久化到
AsyncStorage（键前缀 `@jizhang/`）作为本地主存储；登录用户的数据另由
`src/services/syncService.ts` 按行同步到 Supabase（建表 SQL 见 `supabase/schema.sql`），账号在
`src/context/AuthContext.tsx`。未登录时行为与纯本地完全一致。**任何屏幕需要业务数据，都从 `useApp()` 取**；
改数据结构 = 改 `types/index.ts` → 改 `AppContext.tsx` 的存取与迁移 → 全局搜索消费点逐一核对。
