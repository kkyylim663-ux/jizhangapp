# UI_RULES.md —— 记账 App 画风与写法铁律

> 依据：`C:\Users\senheng\.claude\plans\app-ui-ux-app-zazzy-music.md`（项目内副本：`.zcode/plans/ui-redesign-plan.md`）
> 第 4 节（设计系统）、第 8.2 节第 4 条（布局铁律）、第 9.2 节（中英文不撞）、第 10.1 节（画风统一）。
> 每个页面改动前先读本文件；与本文冲突的写法一律退回重做。
>
> ⚠ **2026-10-10 UI V2 定稿**：颜色 / 形状 / 渐变 / 玻璃 / 字体以 `.zcode/design/UI_V2_SPEC.md` 为准
> （像素参考 `.zcode/design/mockups/*.dc.html`，数值以内联样式为准）；本文与 V2 规范冲突时，以 V2 规范为准。

## 0. 不可越界的三条（功能冻结）

1. **不新增 / 不删除 / 不改变任何业务逻辑、数据结构、计算、导航入口**。只改展示、样式、交互反馈。
   唯一例外：主题改为跟随手机（计划 T01e，用户指定）。
2. 颜色、字号、间距、圆角、阴影、动效**一律取令牌**（`useTheme()`），禁止写死数字与色值。
   金额一律 `formatMoney`，日期一律 `formatDate`。
3. **底部 Tab 按钮不加任何按压视觉反馈、不发生布局位移**（用户明令，保留现有震动）。
4. 新文案必须同时加到 `src/i18n/zh.ts` 和 `src/i18n/en.ts`，键一一对应。

> 主题令牌（`src/theme/theme.ts`）的改动已被用户明确授权（本计划 T01 / T01e）；
> 旧令牌全部保留，页面逐个迁移，不一次性替换。

## 1. 颜色（计划 4.1）

只从 `semantic` 层取色：`const { semantic } = useTheme();`

| 令牌 | 用途 | 日 | 夜 |
|---|---|---|---|
| `bg` | 页面底 | `#F6F5F9` | `#0B0B12` |
| `surface` | 卡片 / 列表组 | `#FFFFFF` | `#15151E` |
| `surfaceElevated` | 抽屉 / 弹层 / 浮动 Tab 栏 | `#FFFFFF` | `#1E1E2A` |
| `hairline` | 分割线 / 卡片描边 | `rgba(17,17,26,0.08)` | `rgba(255,255,255,0.08)` |
| `textPrimary` / `textSecondary` / `textTertiary` | 主 / 次 / 弱文字 | `#111118` / `#5E5E6E` / `#8E8E9A` | `#F4F4F7` / `#A3A3B2` / `#6E6E7E` |
| `accent` | 主按钮、选中、强调填充 | `#6C4DF6` | `#6C4DF6` |
| `accentText` | 紫色文字 / 链接 | `#6C4DF6` | `#A595FF` |
| `accentSoft` | 选中胶囊底、选中图标方块底 | 10% 紫 | 14% 紫 |
| `onAccent` | 紫底上的文字 | `#FFFFFF` | `#FFFFFF` |
| `amountExpense` | 支出金额 = 主文字色 + 「−」 | = textPrimary | = textPrimary |
| `amountIncome` | 收入金额 = 绿 + 「+」 | `#0E9F6E` | `#34D399` |
| `amountTransfer` | 转账金额 = 灰 + ⇄，无正负号 | = textSecondary | = textSecondary |
| `danger` | 超支 / 删除 / 错误（删除图标、滑动删除底） | `#E11D48` | `#FB7185` |
| `warning` | 预算 ≥80% 未超支 | `#D97706` | `#FBBF24` |
| `scrim` | 全 App 唯一遮罩色 | `rgba(10,8,20,0.40)` | `rgba(0,0,0,0.55)` |

**规则**

- 紫色只有 `accent` / `accentText` / `accentSoft` 三档，且只用于主按钮、选中态、链接。其它地方不许出现紫色。
- 支出是**中性色 + 减号**，不是红色也不是紫色；红色只表示超支 / 警告 / 删除 / 出错。
- 类别颜色保留（30 个分类色），只用在「圆形图标托：见第 7 节（UI V2）」，不上大色块。
- 夜间层级靠亮度递进（`bg` < `surface` < `surfaceElevated`），不靠阴影。
- **渐变 / 玻璃（UI V2 定稿，2026-10-10）只出现在规范列出的位置**：页面顶部品牌渐变（`HeroGradient`，首页 580 / 记一笔 400 / 资产 440 / 统计 460 / 设置 360）＋ 落在渐变上的玻璃控件（`GlassView`）＋ 中央「+」/ 完成键 / 选中三选一的 accent 渐变；其余地方仍不用渐变卡面、光晕、emoji。完整清单见 `.zcode/design/UI_V2_SPEC.md`（与本文冲突时以 V2 规范为准）。
- `textTertiary` 只给 ≥13pt（`footnote` 及以上）的文字用。

## 2. 字号（计划 4.2）

只从 `typography` 取：`const { typography } = useTheme();`。**11 档，最小 11pt，禁止 7–10pt。**

| 令牌 | 字号 / 行高 | 字重 | 用在 |
|---|---|---|---|
| `display` | 40 / 46 | 600 | 净资产金额 |
| `amountEntry` | 44 / 52 | 600 | 记一笔输入金额（自动缩小，下限 28） |
| `title1` | 28 / 34 | 700 | Tab 根页面大标题 |
| `title2` | 22 / 28 | 700 | 卡片大数字 |
| `title3` | 20 / 25 | 600 | 二级页标题 |
| `headline` | 17 / 22 | 600 | 列表行标题、按钮 |
| `body` | 17 / 22 | 400 | 正文 |
| `subhead` | 15 / 20 | 400 | 行副标题、账户名 |
| `footnote` | 13 / 18 | 400 | 日期头、说明 |
| `caption` | 12 / 16 | 500 | 徽章、标签 |
| `caption2` | 11 / 13 | 500 | 最小字号档 |

- 字重只用 400 / 500 / 600 / 700 四档。
- 中文字距为 0（令牌里的负字距是给数字 / 拉丁字母的）。
- 所有金额文字加 `fontVariant: ['tabular-nums']`（等宽数字）。
- 每个档位带 `maxFontSizeMultiplier`（金额 1.15 / 标题 1.2 / 正文 1.35 / 标签 1.3）——尊重系统大字设置又不破版。

## 3. 间距 / 圆角 / 阴影 / 动效（计划 4.3）

- 间距只用 `spacing`：`xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 · xxxl 32 · huge 40`。
- 页面级固定值用 `layout`：`page 16`（页边距）· `card 16`（卡内边距）· `section 24`（分组间距）· `rowMinHeight 56`（列表行最小高）。
- 圆角只用 `radius`：`xs 6`（徽章）· `sm 10`（胶囊 / 输入框）· `md 14`（按钮、图标方块）· `lg 20`（卡片、Hero）· `xl 28`（抽屉顶部）· `full 999`。
- 阴影只用 `elevation`：`level0` 无阴影（用 `hairline` 撑轮廓）· `level1` 卡片（夜间无阴影，靠亮度）· `level2` 浮层（Tab 栏 / 抽屉 / 下拉）。全部是跨平台 `boxShadow` 字符串。
- 动效只用 `src/theme/motion.ts`，经 `useTheme()` 取 `motion`：
  - `motion.spring.default`（350ms，临界阻尼不回弹）——大多数 UI。
  - `motion.spring.sheet`（400ms，0.85 阻尼 + 手势速度传递）——抽屉 / 弹层。
  - `motion.spring.press` + `motion.pressScale`（0.97，按下即响应）——按压反馈。
  - `motion.timing.fade`（150ms ease-out，配 `motion.easing.out`）——只用于淡入淡出。
  - `motion.timing.numberRoll`（600ms）——净资产 / 预算数字变化；首次加载不滚动。
  - 「减弱动态效果」开启时 `motion` 自动变降级档（150ms 交叉淡入、无位移、无回弹、数字跳变）。
- 震动（`src/utils/haptics.ts`）：数字键 = selection；运算符 / 退格 = light；保存成功 = success；超支 / PIN 错误 = warning；切 Tab / 分段 / 选类别 = selection。**滚动、普通导航不震动。**
- 底部 Tab 按钮不震动之外的任何反馈（无缩放、无位移）。

## 4. 布局铁律（计划 8.2 第 4 条）

- 含文字的容器只用 `minHeight + padding`，**禁止固定 `height`**。
- 绝对定位只用于浮层（抽屉、下拉、Toast）。
- 需要尺寸时用 `onLayout` 实测，**不按字符估宽**；屏幕尺寸用 `useWindowDimensions` / `useLayout()`，不用 `Dimensions.get`。
- Android 文字统一 `includeFontPadding: false` + 令牌里的明确 `lineHeight`。
- 安全区只在外壳层算一次，页面统一用 `useTabClearance()`。
- 版型分级（`useLayout()`，计划 8.2 第 2 条）：窄 `<360`（页边距 16 / 键高 48 / 类别 4 列 / Hero 34 / 行高 52）· 常规 `360–419`（16 / 56 / 5 / 40 / 56）· 大 `≥420`（20 / 60 / 5 / 44 / 56）· 矮屏（可用高 <700 叠加：键高 48、Hero −4）· 平板 / 折叠屏展开（`≥600`：内容最大宽 560 居中）。

## 5. 金额与日期（计划 4.4）

- `formatMoney()`（`src/utils/formatMoney.ts`）：千分位一律加（`1,234.56`）；支出 `−12.50`（真减号 U+2212）/ 收入 `+6,800.00` / 转账无符号；紧凑格式 `1.5k`；隐藏金额统一 `••••••`。
- **币种只在「看不出是什么钱」的地方标**：净资产大数字 `RM28,797.59`、资产页币种分组头、跨币种转账 / 兑换 / 账本分币种余额、某行币种与页面不同（后缀 `−5,200.00 USD`）。账单行、日期头合计、预算数字、统计排行、日历小数字**不标**。
- 金额**永不截断、永不换行**；超大数字按字号档位降一级（40 → 34 → 28），不做连续压缩。这是唯一允许变小的文字。
- 用户自己输入的超长备注在列表最多 2 行。
- `formatDate()`（`src/utils/formatDate.ts`）：`今天` / `昨天` / `10月7日 周三`；英文 `Today` / `Yesterday` / `Oct 7, Wed`。全 App 只有这一套日期写法（修「这里 9/10、首页 10/9」的混乱）。

## 6. 中英文不相撞（计划 9.2）

**只用四招，不用「缩字」和「省略号」：**

1. **给空间** —— 挤的控件挪到单独一行，或删掉多余控件。
2. **自动换行** —— 左右两块用 `flexDirection:'row' + flexWrap:'wrap' + justifyContent:'space-between' + gap`：放不下右边自动掉第二行（纯样式，不用测量）。
3. **允许变高** —— 标题 / 标签允许 2 行，容器用 `minHeight`；文字 `flexShrink:1`，金额 `flexShrink:0`。
4. **写短文案** —— 英文按长度预算写，放不下就加 `xxx.short`。

**长度预算（360dp 宽、正文字号）**

| 位置 | 英文上限 | 示例 |
|---|---|---|
| Tab 标签 | 8 字符 | Home · Assets · Stats · Settings |
| 分段控件（4 段） | 9 字符 | Expense · Income · Transfer · Exchange |
| 主按钮 | 16 字符 | Add account |
| 类别名（图标下 2 行） | 每行约 9 字符 | Tobacco & / Alcohol |
| 胶囊 / 徽章 | 10 字符 | Reminder · Paused |

最差组合必测：**英文 + 360 宽 + 系统字体 130% + 夜间**。四个条件同时满足仍不撞，才算通过。

## 7. 画风统一（计划 10.1）

Hero 净资产卡是画风母版：**只借它的颜色和细节，不复制它的特效。**

| 元素 | 统一规定 |
|---|---|
| 颜色 | 只用第 1 节令牌 |
| 卡片 | 全 App 只有 2 种：普通卡（`surface` + `radius.lg` + `elevation.level1`）与「渐变 / 玻璃件」（`HeroGradient` / `GlassView`，只出现在第 1 节列出的位置） |
| 图标 | 只用 Ionicons；未选中 = 线框，选中 = 实心；尺寸只有 20 / 24 两档；**不用 emoji** |
| 类别 / 账户 / 列表图标托（UI V2） | 一律**圆形** `IconCircle`：42 圆（列表行、账户行）· 48 圆（记一笔类别格）；夜间 = 类别色 15% 底 + 类别色图标，日间 = 类别色混白 86% 淡底 + 同色系压实图标；「全部」等中性圆 = 夜 surfaceSunken / 日 surface + 轻投影 |
| 列表行 | 全部用 `ListRow` / `TransactionRow` |
| 页头 | 只有 2 种：Tab 根页大标题（无返回键）、二级页紧凑标题（返回 + 标题 + 右侧动作） |
| 按钮 | 只有 4 种：主（实心紫）、次（`accentSoft` 底紫字）、危险（红字）、文字按钮 |
| 弹出层 | 只有 2 种：底部抽屉 `BottomSheet`、确认对话框 `AppDialog` |
| 空状态 | 同一种：Ionicons 大图标（48）放在 `accentSoft` 圆里 + 一句话 + 一个按钮 |
| 动效 | 只用 `motion.ts` 的这几种 |
| 金属细节 | 只在 Hero 卡；其它卡片顶部最多一条 1px 极淡高光（夜间） |

**形状（UI V2 定稿）**：按钮 / 分段控件 / Chip / 输入框一律 `999` 全圆角；内容卡 `26`；悬浮 Tab 栏 = 全圆角胶囊（高 68 / 左右 16 / 距底 18，中央「+」54 圆在胶囊内部）。

**禁止私自造新样式**：页面里出现令牌以外的颜色 / 字号 / 圆角，或 `src/components/ui/` 以外的新卡片、按钮、行组件，一律退回重做。

## 8. 交互状态（每个可点元素都要过）

默认 · 按下（底部 Tab 除外，按下瞬间就有反馈）· 选中（读屏能读出「已选中」）· 禁用（变灰且点了没反应）· 加载中（不闪空状态）· 空状态（图标 + 一句话 + 一个按钮）· 出错（就地提示）· 键盘弹出（不遮挡输入框和保存按钮）· 打断（动画中再点再拖不卡死）· 返回（不残留弹层、不丢数据）
