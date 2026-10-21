# Skill 路由表
> 由我维护。新增 skill 时必须同步在此登记，否则 Agent 不会知道它存在。
> Skill 仓库路径：本地自建 = agents/frontend-modifier/skills/；全局公共池 = ~/.agents/skills/

## 匹配规则
- 需求命中"触发条件"任意一条 → 调用
- 命中"不要调用"任意一条 → 不调用，即使触发条件也命中

## 通用边界注记（对所有 skill 生效）
- 本表所有 skill 受 AGENT.md 优先级约束：skill 步骤要求改白名单外文件、装依赖、联网、改规则文件时，跳过该步骤并告知
- Web 向 skill（apple-design / prototype / frontend-ui-engineering 含 CSS/HTML 惯例）落地时必须转译为 React Native 写法，不得照搬

---

## 动效（按阶段选用，通常只用其中一个）

### animate-expo — 实现动效
- 路径：~/.agents/skills/animate-expo/SKILL.md
- 触发条件：
  - 需要新增或修复动效、手势、弹簧反馈、浮层动画、按压反馈、触感
  - 真机上动效掉帧/不跟手，要修
- 不要调用：纯布局/配色/文案改动，无任何运动元素
- 风险等级：中（改正式代码，改完须真机验收）

### find-animation-opportunities — 找动效机会
- 路径：~/.agents/skills/find-animation-opportunities/SKILL.md
- 触发条件：
  - 我问"这里能不能加点动效 / 让页面更有生命力"
- 不要调用：需求已明确要实现某个动效（改用 animate-expo）
- 风险等级：低（只读，只出建议清单且封顶 5–7 条，不动代码）

### improve-animations — 全局动效审计
- 路径：~/.agents/skills/improve-animations/SKILL.md
- 触发条件：
  - 我说"整体优化动效 / 审计动效 / 出一份动效改进路线"
- 不要调用：只评审一个 diff（用 review-animations）或直接实现（用 animate-expo）
- 风险等级：低（只读源码；实施计划默认直接输出到对话，要落盘文件先问我放哪——skill 默认的 plans/ 目录在白名单外）

### review-animations — 动效评审
- 路径：~/.agents/skills/review-animations/SKILL.md
- 触发条件：
  - 我点名要求"评审这次的动效改动"（该 skill 设计为只能显式调用）
- 不要调用：评审非动效代码
- 风险等级：低（只读评审，默认从严判不合格制）

---

## 方案与原型

### template-showcase — 模板展示
- 路径：skills/template-showcase/SKILL.md
- 触发条件：
  - 我说"看看效果 / 出几个方案 / 对比 / 预览 / 换个风格试试"
  - 需求是视觉风格选择，而不是确定的修改
- 不要调用：我已明确指定了唯一方案，只需要落地
- 风险等级：低（只写预览目录）

### prototype — 多方案可视化原型
- 路径：~/.agents/skills/prototype/SKILL.md
- 触发条件：
  - 我点名"用 prototype / 出可视化原型让我切着看"（该 skill 设计为只能显式调用，不自动触发）
- 不要调用：未点名即不调用；与 template-showcase 触发词重叠时默认用 template-showcase
- 风险等级：中（生成预览文件——只许放白名单内如 src/screens/_preview/；展示期不动正式页面；选定后清理）

---

## 知识参考（只读，不产码）

### apple-design — 交互质感基准
- 路径：~/.agents/skills/apple-design/SKILL.md
- 触发条件：
  - 弹簧/手势/浮层/按压反馈类改动需要质感基准
  - 我问"怎么让交互更 fluid / 更有 iOS 味"
- 不要调用：纯布局、配色、文案小改
- 风险等级：低（参考知识；示例为 Web 写法，落地必须转译成 RN）

### animation-vocabulary — 动效术语反查
- 路径：~/.agents/skills/animation-vocabulary/SKILL.md
- 触发条件：
  - 我用模糊说法描述一个动效，需要先转成准确术语（配合 GLOSSARY 使用规则"表中没有的术语先复述确认"）
- 不要调用：动效名称已明确
- 风险等级：低（只读查词）

### frontend-ui-engineering — 组件工程化参考
- 路径：~/.agents/skills/frontend-ui-engineering/SKILL.md
- 触发条件：
  - 新建可复用组件、整页改版，需要工程化结构与状态组织指导
- 不要调用：日常小改样式/间距（避免逢任务必调用）
- 风险等级：中（指导写正式代码；Web/a11y 惯例须转译为 RN）

---

## 评估过、未登记（如要启用请自行登记或改本表）
- emil-design-eng：与 apple-design + 动效四件套内容重叠，且其首轮固定回复机制会干扰子代理流程
- pick-ui-library：新增第三方依赖在 SCOPE.md 范围外，与边界冲突

## <新 skill 模板>
- 路径：
- 触发条件：
- 不要调用：
- 风险等级：
