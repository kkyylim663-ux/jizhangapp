// ComponentGallery.tsx
// ⚠ 组件预览页（T03–T05 起），**不进正式导航**：
//    App.tsx 里只在 __DEV__ + web + URL 带 ?gallery=1 时用它替换 <AppContent />。
//    后续每一批都用它做回归截图；**T32 清理任务时才删**（连同 App.tsx 那段守卫）。
//
// 用途：在 360×640 / 430×932 × 日/夜 × 中/英 下逐个截图，检查
// 默认 · 按下 · 禁用 · 加载 · 选中 · 长文案不重叠/不截断/不缩字。
//
// 页面（p1–p4）用 URL 无关的 Chip 开关切换，Playwright 用 data-testid 点：
//   g-page-p1 … g-page-p4 · g-theme-light/dark/system · g-lang-zh/en

import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { useThemeMode } from '../../context/ThemeModeContext';
import { useLanguage } from '../../i18n/LanguageContext';
import {
  AppText,
  Badge,
  BottomSheet,
  Button,
  Card,
  Chip,
  EmptyState,
  GlassView,
  HeroGradient,
  IconCircle,
  IconButton,
  ListRow,
  ListSection,
  MoneyText,
  ScreenHeader,
  Switch,
  TransactionRow,
} from '../../components/ui';
import PressableScale from '../../components/PressableScale';
import SegmentedControl from '../../components/SegmentedControl';
import { useDialog } from '../../components/AppDialog';
import { Ionicons } from '@expo/vector-icons';

type PageKey = 'p1' | 'p2' | 'p3' | 'p4' | 'p5';

const PAGES: { key: PageKey; label: string }[] = [
  { key: 'p1', label: 'P1 页头' },
  { key: 'p2', label: 'P2 金额' },
  { key: 'p3', label: 'P3 列表' },
  { key: 'p4', label: 'P4 交互' },
  { key: 'p5', label: 'P5 地基' },
];

const noop = () => {};

/** 小节标题 */
function Section({ title, children, ...rest }: { title: string; children: React.ReactNode; testID?: string }) {
  const { semantic, spacing } = useTheme();
  return (
    <View style={{ marginBottom: spacing.xl, gap: spacing.sm }} {...rest}>
      <AppText variant="footnote" color={semantic.textTertiary}>
        {title}
      </AppText>
      {children}
    </View>
  );
}

export default function ComponentGallery() {
  const { semantic, spacing, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { themeMode, setThemeMode } = useThemeMode();
  const { langMode, setLangMode } = useLanguage();
  const dialog = useDialog();

  const [page, setPage] = useState<PageKey>('p1');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [switchVal, setSwitchVal] = useState(true);
  const [seg2, setSeg2] = useState('zh');
  const [seg3, setSeg3] = useState('light');
  const [seg4, setSeg4] = useState('expense');
  const [lastAction, setLastAction] = useState('（未操作）');

  return (
    <View style={[styles.root, { backgroundColor: semantic.bg, paddingTop: insets.top }]}>
      {/* 预览台开关（不进正式版） */}
      <View style={[styles.console, { borderBottomColor: semantic.hairline, paddingHorizontal: spacing.lg }]}>
        <View style={styles.consoleRow}>
          {PAGES.map((p) => (
            <Chip key={p.key} label={p.label} selected={page === p.key} onPress={() => setPage(p.key)} testID={`g-page-${p.key}`} />
          ))}
        </View>
        <View style={styles.consoleRow}>
          <Chip label="日" selected={themeMode === 'light'} onPress={() => setThemeMode('light')} testID="g-theme-light" />
          <Chip label="夜" selected={themeMode === 'dark'} onPress={() => setThemeMode('dark')} testID="g-theme-dark" />
          <Chip label="跟随系统" selected={themeMode === 'system'} onPress={() => setThemeMode('system')} testID="g-theme-system" />
          <Chip label="中" selected={langMode === 'zh'} onPress={() => setLangMode('zh')} testID="g-lang-zh" />
          <Chip label="EN" selected={langMode === 'en'} onPress={() => setLangMode('en')} testID="g-lang-en" />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
        testID="g-scroll"
      >
        {page === 'p1' ? <PageHeaderAndText /> : null}
        {page === 'p2' ? <PageMoneyAndButtons isDark={isDark} /> : null}
        {page === 'p3' ? <PageLists switchVal={switchVal} setSwitchVal={setSwitchVal} /> : null}
        {page === 'p4' ? (
          <PageInteractions
            seg2={seg2}
            setSeg2={setSeg2}
            seg3={seg3}
            setSeg3={setSeg3}
            seg4={seg4}
            setSeg4={setSeg4}
            onOpenSheet={() => setSheetOpen(true)}
            onOpenDialog={() =>
              dialog.alert({
                title: '删除账户',
                message: '删除后该账户下的 12 笔记录仍会保留，但不再计入余额。',
                buttons: [
                  { text: '取消', style: 'cancel', onPress: () => setLastAction('点了：取消（遮罩也算）') },
                  { text: '仅移除账户', style: 'default', onPress: () => setLastAction('点了：仅移除账户') },
                  { text: '删除账户和记录', style: 'destructive', onPress: () => setLastAction('点了：删除') },
                ],
              })
            }
            lastAction={lastAction}
          />
        ) : null}
        {page === 'p5' ? <PageFoundation seg3={seg3} setSeg3={setSeg3} /> : null}
      </ScrollView>

      <BottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="选择账本"
        accessibilityLabel="选择账本"
        testID="g-sheet"
      >
        {/* 抽屉内容贴边：裸 ListRow + 自带分隔线（不套四角圆角的卡，否则像浮起的卡片） */}
        <ListRow title="默认账本" subtitle="个人" value={<MoneyText value={28797.59} variant="subhead" />} separator onPress={() => { setLastAction('选了：默认账本'); setSheetOpen(false); }} />
        <ListRow title="旅行账本 Travel fund long name" subtitle="2026 日本" value={<MoneyText value={1200} variant="subhead" />} separator onPress={() => { setLastAction('选了：旅行账本'); setSheetOpen(false); }} />
        <ListRow title="家庭账本" value={<MoneyText value={0} variant="subhead" />} onPress={() => { setLastAction('选了：家庭账本'); setSheetOpen(false); }} />
      </BottomSheet>
    </View>
  );
}

/* ------------------------------------------------------------------ P1 */

function PageHeaderAndText() {
  const { typography, semantic, spacing } = useTheme();
  const variants = Object.keys(typography) as (keyof typeof typography)[];
  return (
    <>
      <Section title="ScreenHeader · Tab 根页（左对齐大标题，无返回键）" testID="g-header-root">
        <ScreenHeader variant="root" title="设置项" subtitle="账户 · 安全 · 外观" padded={false} />
      </Section>

      <Section title="ScreenHeader · 二级页（返回 + 居中标题 + 右侧动作）" testID="g-header-compact">
        <Card>
          <ScreenHeader variant="compact" title="编辑账户" onBack={noop} padded={false} right={<IconButton icon="ellipsis-horizontal" accessibilityLabel="更多" />} />
        </Card>
      </Section>

      <Section title="ScreenHeader · 长标题必须换行不截断（中 / 英）" testID="g-header-long">
        <Card>
          <ScreenHeaderTitleCase onBack={noop} />
        </Card>
      </Section>

      <Section title="AppText · 11 档（数字 / 英文走 Inter，中文回退系统字体）" testID="g-text">
        <Card>
          <View style={{ gap: spacing.sm }}>
            {variants.map((v) => (
              <View key={v} style={styles.variantRow}>
                <AppText variant="caption2" color={semantic.textTertiary}>
                  {v}
                </AppText>
                <AppText variant={v}>28,797.59</AppText>
                <AppText variant={v}>Aa Bb</AppText>
                <AppText variant={v}>账本</AppText>
              </View>
            ))}
          </View>
        </Card>
      </Section>
    </>
  );
}

/** 长标题用例：先给常见的「中等长度」两条，再给两条极端长句（验证换行不截断） */
function ScreenHeaderTitleCase({ onBack }: { onBack: () => void }) {
  return (
    <View>
      <ScreenHeader
        variant="compact"
        title="月度统计"
        onBack={onBack}
        padded={false}
        right={<IconButton icon="share-outline" accessibilityLabel="分享" />}
      />
      <ScreenHeader
        variant="compact"
        title="Financial planning"
        onBack={onBack}
        padded={false}
        right={
          <View style={styles.actions}>
            <IconButton icon="star-outline" accessibilityLabel="收藏" />
            <IconButton icon="share-outline" accessibilityLabel="分享" />
          </View>
        }
      />
      <ScreenHeader
        variant="compact"
        title="月度支出与收入的详细统计报告（长标题换行测试）"
        onBack={onBack}
        padded={false}
        right={<IconButton icon="share-outline" accessibilityLabel="分享" />}
      />
      <ScreenHeader
        variant="compact"
        title="Monthly expense and income breakdown by category"
        onBack={onBack}
        padded={false}
        right={
          <View style={styles.actions}>
            <IconButton icon="star-outline" accessibilityLabel="收藏" />
            <IconButton icon="share-outline" accessibilityLabel="分享" />
          </View>
        }
      />
    </View>
  );
}

/* ------------------------------------------------------------------ P2 */

function PageMoneyAndButtons({ isDark }: { isDark: boolean }) {
  const { spacing, semantic } = useTheme();
  return (
    <>
      <Section title="MoneyText · 收支色 / 币种 / 隐藏 / 紧凑 / 超大降级" testID="g-money">
        <Card>
          <View style={{ gap: spacing.md }}>
            <View style={styles.moneyRow}>
              <AppText variant="subhead" color={semantic.textSecondary}>支出</AppText>
              <MoneyText value={172.72} kind="expense" variant="body" />
            </View>
            <View style={styles.moneyRow}>
              <AppText variant="subhead" color={semantic.textSecondary}>收入</AppText>
              <MoneyText value={6800} kind="income" variant="body" />
            </View>
            <View style={styles.moneyRow}>
              <AppText variant="subhead" color={semantic.textSecondary}>转账</AppText>
              <MoneyText value={5200} kind="transfer" variant="body" />
            </View>
            <View style={styles.moneyRow}>
              <AppText variant="subhead" color={semantic.textSecondary}>余额（负）</AppText>
              <MoneyText value={-402.29} variant="body" />
            </View>
            <View style={styles.moneyRow}>
              <AppText variant="subhead" color={semantic.textSecondary}>币种前缀</AppText>
              <MoneyText value={28797.59} currency="MYR" showCurrency variant="title2" />
            </View>
            <View style={styles.moneyRow}>
              <AppText variant="subhead" color={semantic.textSecondary}>币种后缀</AppText>
              <MoneyText value={5200} currency="USD" showCurrency currencyPosition="suffix" variant="subhead" />
            </View>
            <View style={styles.moneyRow}>
              <AppText variant="subhead" color={semantic.textSecondary}>隐藏</AppText>
              <MoneyText value={1234.5} hidden variant="body" />
            </View>
            <View style={styles.moneyRow}>
              <AppText variant="subhead" color={semantic.textSecondary}>紧凑</AppText>
              <MoneyText value={1500} compact variant="footnote" />
            </View>
          </View>
        </Card>
      </Section>

      <Section title="MoneyText · 超大金额按实测宽度降级（40 → 34 → 28 → 22 → 18；再放不下走紧凑格式）" testID="g-money-shrink">
        <Card>
          <View style={{ gap: spacing.sm }}>
            <MoneyText value={28797.59} variant="display" />
            <MoneyText value={1234567890} variant="display" />
            <MoneyText value={12345678901234} variant="display" />
            {/* 15 位整数 + 正负号 + 币种前缀/后缀：360 宽下必须单行完整显示（验收点名的用例） */}
            <MoneyText value={123456789012345} variant="display" kind="income" currency="MYR" showCurrency />
            <MoneyText value={123456789012345} variant="display" currency="MYR" showCurrency />
            <MoneyText value={-123456789012345} variant="display" currency="USD" showCurrency currencyPosition="suffix" />
            {/* 20 位 + 后缀币种（约 19em）：连 18pt 都放不下 → 紧凑格式 + 长按看全文 */}
            <MoneyText value={12345678901234567890} variant="display" kind="income" currency="USD" showCurrency currencyPosition="suffix" />
          </View>
          <AppText variant="caption2" color={semantic.textTertiary} style={{ marginTop: spacing.sm }}>
            最后一条（20 位 + USD 后缀）：屏上是紧凑格式，读屏读完整金额，长按可看全文
          </AppText>
        </Card>
      </Section>

      <Section title="IconButton · plain / soft / solid / 禁用（触控区 44）" testID="g-iconbutton">
        <Card>
          <View style={styles.actions}>
            <IconButton icon="chevron-back" accessibilityLabel="返回" onPress={noop} />
            <IconButton icon="ellipsis-horizontal" accessibilityLabel="更多" variant="soft" onPress={noop} />
            <IconButton icon="add" accessibilityLabel="添加" variant="solid" onPress={noop} />
            <IconButton icon="calendar-outline" accessibilityLabel="日历" size={20} onPress={noop} />
            <IconButton icon="notifications-outline" accessibilityLabel="通知" disabled />
          </View>
        </Card>
      </Section>

      <Section title="Button · primary / secondary / destructive / ghost / 禁用 / 加载中" testID="g-button">
        <View style={{ gap: spacing.sm }}>
          <Button title="保存" onPress={noop} testID="g-btn-primary" />
          <Button title="次要操作" variant="secondary" onPress={noop} />
          <Button title="删除账户" variant="destructive" onPress={noop} />
          <Button title="取消" variant="ghost" onPress={noop} />
          <Button title="已禁用" disabled testID="g-btn-disabled" />
          <Button title="提交中" loading testID="g-btn-loading" />
          <View style={styles.actions}>
            <Button title="小按钮" size="sm" fullWidth={false} onPress={noop} />
            <Button title="Add account" size="sm" icon="add" fullWidth={false} />
          </View>
          <Button title="很长的按钮文案也要正常换行不截断 / A very long button label" onPress={noop} />
        </View>
      </Section>

      <Section title="PressableScale · 按下缩放（Playwright 按住截图）" testID="g-pressable">
        <PressableScale
          onPress={() => {}}
          testID="g-pressable-target"
          style={[styles.tapBox, { backgroundColor: semantic.accentSoft, borderRadius: 14 }]}
        >
          <AppText variant="headline" color={semantic.accentText}>
            按住我看缩放（0.97）
          </AppText>
        </PressableScale>
        <AppText variant="caption2" color={semantic.textTertiary}>
          当前主题：{isDark ? '夜间' : '日间'}
        </AppText>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ P3 */

function PageLists({ switchVal, setSwitchVal }: { switchVal: boolean; setSwitchVal: (v: boolean) => void }) {
  const { spacing, semantic } = useTheme();
  return (
    <>
      <Section title="Card · 普通卡（surface + lg + level1）" testID="g-card">
        <Card>
          <AppText variant="headline">普通卡片</AppText>
          <AppText variant="subhead" color={semantic.textSecondary} style={{ marginTop: 4 }}>
            卡内边距 16、圆角 20；夜间靠亮度分层 + 发丝描边
          </AppText>
        </Card>
      </Section>

      <Section title="ListSection + ListRow · 图标 / 副标题 / 数值 / chevron / 开关 / 禁用" testID="g-list">
        <ListSection title="账户" footer="列表行最小高 56，行内分割线由 ListSection 自动插入">
          <ListRow title="现金钱包" value="RM1,234.56" chevron onPress={noop} />
          <ListRow title="Maybank Visa" subtitle="信用卡 · 尾号 8801" value={<MoneyText value={-402.29} variant="body" />} onPress={noop} />
          <ListRow icon="wallet-outline" title="默认账户" trailing={<Switch value={switchVal} onValueChange={setSwitchVal} accessibilityLabel="默认账户" />} />
          <ListRow title="禁用行" value="—" disabled />
        </ListSection>
      </Section>

      <Section title="ListRow · 标签 + 数值放不下时自动换行（英文最坏情况）" testID="g-list-wrap">
        <ListSection>
          <ListRow title="Total balance across all accounts in this currency group" value="1,234,567.89" />
          <ListRow title="这个账户的完整名称非常长用来测试换行" subtitle="副标题也会很长很长很长很长" value={<MoneyText value={1234567.89} variant="body" currency="MYR" showCurrency />} />
        </ListSection>
      </Section>

      <Section title="Switch · 开 / 关 / 禁用" testID="g-switch">
        <Card>
          <View style={{ gap: spacing.sm }}>
            <ListRow title="生物锁" trailing={<Switch value={switchVal} onValueChange={setSwitchVal} accessibilityLabel="生物锁" />} />
            <ListRow title="自动月结" trailing={<Switch value={!switchVal} onValueChange={(v) => setSwitchVal(!v)} accessibilityLabel="自动月结" />} />
            <ListRow title="禁用" trailing={<Switch value={false} disabled accessibilityLabel="禁用开关" />} />
          </View>
        </Card>
      </Section>

      <Section title="Chip · 选中 / 未选中 / 图标 / 禁用" testID="g-chip">
        <Card>
          <View style={styles.actions}>
            <Chip label="全部" selected onPress={noop} />
            <Chip label="支出" onPress={noop} />
            <Chip label="Income" icon="arrow-down-outline" onPress={noop} />
            <Chip label="禁用" disabled />
            <Chip label="Long chip label 20" onPress={noop} />
          </View>
        </Card>
      </Section>

      <Section title="Badge · 5 档（文字 11pt）" testID="g-badge">
        <Card>
          <View style={styles.actions}>
            <Badge label="中性" />
            <Badge label="已同步" tone="accent" />
            <Badge label="已还清" tone="success" dot />
            <Badge label="接近上限" tone="warning" />
            <Badge label="已超支" tone="danger" />
          </View>
        </Card>
      </Section>

      <Section title="TransactionRow · 备注/类别兜底 · 类别 · 账户 · 金额" testID="g-txrow">
        <ListSection>
          <TransactionRow note="午餐" categoryName="餐饮" categoryIcon="restaurant-outline" categoryColor="#F97316" accountName="现金" amount={32.5} kind="expense" onPress={noop} />
          <TransactionRow categoryName="交通" categoryIcon="bus-outline" categoryColor="#38BDF8" accountName="Maybank" amount={4.2} kind="expense" onPress={noop} />
          <TransactionRow note="工资" categoryName="工资收入" categoryIcon="cash-outline" categoryColor="#22C55E" accountName="储蓄" amount={6800} kind="income" onPress={noop} />
          <TransactionRow note="一笔备注特别长特别长的支出用来验证最多两行不截断不断行" categoryName="购物" categoryIcon="cart-outline" categoryColor="#A855F7" accountName="信用卡" amount={1288.88} kind="expense" onPress={noop} />
          <TransactionRow note="转账" categoryName="转账" categoryIcon="swap-horizontal-outline" categoryColor="#64748B" accountName="现金 → 储蓄" amount={500} kind="transfer" hideAmount />
        </ListSection>
      </Section>

      <Section title="EmptyState · 图标 + 一句话 + 按钮" testID="g-empty">
        <Card>
          <EmptyState
            icon="receipt-outline"
            title="还没有任何记录"
            description="记下第一笔，账本会自动按日期分组"
            actionLabel="记一笔"
            onAction={noop}
          />
        </Card>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ P4 */

function PageInteractions({
  seg2,
  setSeg2,
  seg3,
  setSeg3,
  seg4,
  setSeg4,
  onOpenSheet,
  onOpenDialog,
  lastAction,
}: {
  seg2: string;
  setSeg2: (v: string) => void;
  seg3: string;
  setSeg3: (v: string) => void;
  seg4: string;
  setSeg4: (v: string) => void;
  onOpenSheet: () => void;
  onOpenDialog: () => void;
  lastAction: string;
}) {
  const { spacing, semantic } = useTheme();
  return (
    <>
      <Section title="SegmentedControl · 高 36 / 弹簧滑块 / 触控 44" testID="g-seg">
        <Card>
          <View style={{ gap: spacing.lg }}>
            <View>
              <AppText variant="caption2" color={semantic.textTertiary}>两段（中 / 英）</AppText>
              <SegmentedControl
                options={[
                  { label: '中', value: 'zh' },
                  { label: 'EN', value: 'en' },
                ]}
                selected={seg2}
                onSelect={setSeg2}
              />
            </View>
            <View>
              <AppText variant="caption2" color={semantic.textTertiary}>三段（跟随系统 / 日间 / 夜间）</AppText>
              <SegmentedControl
                options={[
                  { label: '跟随系统', value: 'system' },
                  { label: '日间', value: 'light' },
                  { label: '夜间', value: 'dark' },
                ]}
                selected={seg3}
                onSelect={setSeg3}
              />
            </View>
            <View>
              <AppText variant="caption2" color={semantic.textTertiary}>四段 · 英文最坏情况（9.2 长度预算）</AppText>
              <SegmentedControl
                options={[
                  { label: 'Expense', value: 'expense' },
                  { label: 'Income', value: 'income' },
                  { label: 'Transfer', value: 'transfer' },
                  { label: 'Exchange', value: 'exchange' },
                ]}
                selected={seg4}
                onSelect={setSeg4}
              />
            </View>
            <View>
              <AppText variant="caption2" color={semantic.textTertiary}>超长段文案（中文）</AppText>
              <SegmentedControl
                options={[
                  { label: '本月支出合计', value: 'a' },
                  { label: '本月收入合计', value: 'b' },
                ]}
                selected={seg4 === 'b' ? 'b' : 'a'}
                onSelect={setSeg4}
              />
            </View>
          </View>
        </Card>
      </Section>

      <Section title="BottomSheet · 遮罩 / 把手 / 下拉关闭（速度传递）/ 安全区" testID="g-sheet-trigger">
        <View style={{ gap: spacing.sm }}>
          <Button title="打开底部抽屉" onPress={onOpenSheet} testID="g-open-sheet" />
          <AppText variant="caption2" color={semantic.textTertiary}>
            点遮罩 / 关闭键 / 选项任意一种都会播出场动画；打开时底部 Tab 栏强制收起
          </AppText>
        </View>
      </Section>

      <Section title="AppDialog · 新样式 + 点遮罩 = 取消" testID="g-dialog-trigger">
        <View style={{ gap: spacing.sm }}>
          <Button title="打开确认对话框" variant="secondary" onPress={onOpenDialog} testID="g-open-dialog" />
          <AppText variant="caption2" color={semantic.textTertiary}>
            最近一次操作：{lastAction}
          </AppText>
        </View>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ P5 */

/**
 * UI V2 地基件（2026-10-10）：HeroGradient / GlassView / IconCircle /
 * 分段控件的玻璃与 accent 变体 / MoneyText hero 样式。
 * 顶部渐变块按首页稿排了一屏（全出血、可日夜切换）方便对照。
 */
function PageFoundation({ seg3, setSeg3 }: { seg3: string; setSeg3: (v: string) => void }) {
  const { spacing, semantic } = useTheme();
  const [segMonth, setSegMonth] = useState('month');
  const [segIncome, setSegIncome] = useState('expense');

  return (
    <>
      <Section title="HeroGradient · 160° 主渐变 + 2 光斑 + 网格 + 底部淡出（跟随日/夜）" testID="g-herogradient">
        <View style={styles.heroDemo}>
          <HeroGradient height={560} grid />
          {/* 顶部：账本玻璃胶囊 + 右两个 44 玻璃圆钮（首页稿排法） */}
          <View style={styles.heroRow}>
            <GlassView radius={999} style={styles.heroPill}>
              <AppText variant="subhead" weight="500" color="#FFFFFF">
                默认账本
              </AppText>
              <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.7)" />
            </GlassView>
            <View style={[styles.heroRow, styles.heroRowRight]}>
              <GlassView radius={999} style={styles.heroRound}>
                <Ionicons name="notifications-outline" size={20} color="#FFFFFF" />
              </GlassView>
              <GlassView radius={999} style={styles.heroRound}>
                <Ionicons name="calendar-outline" size={20} color="#FFFFFF" />
              </GlassView>
            </View>
          </View>

          {/* 净资产 + MYR 玻璃小胶囊 + Hero 金额（MoneyText hero 58） */}
          <View style={styles.heroNetRow}>
            <AppText variant="footnote" color="rgba(255,255,255,0.8)">
              净资产
            </AppText>
            <GlassView radius={999} style={styles.heroCurrencyPill}>
              <AppText variant="caption2" weight="500" color="#FFFFFF">
                MYR
              </AppText>
              <Ionicons name="swap-vertical" size={12} color="#FFFFFF" />
            </GlassView>
          </View>
          <View style={styles.heroAmountRow}>
            <MoneyText
              value={17061.15}
              hero
              heroSize={58}
              currency="MYR"
              showCurrency
              kind="transfer"
              color="#FFFFFF"
              roll={false}
            />
            {/* 「隐藏金额」眼睛 = 36 圆钮（稿）；金额可用宽由布局自动扣掉它 + 间距 10，组件内不再扣第二次 */}
            <PressableScale style={styles.heroEyeBtn}>
              <Ionicons name="eye-outline" size={20} color="rgba(255,255,255,0.75)" />
            </PressableScale>
          </View>

          {/* 预算玻璃卡 + 8dp 白色进度条 */}
          <GlassView radius={24} style={styles.heroBudget}>
            <View style={styles.heroBudgetTop}>
              <AppText variant="footnote" weight="500" color="#FFFFFF">
                本月预算
              </AppText>
              <AppText variant="footnote" color="rgba(255,255,255,0.9)">
                剩余 2,338.60
              </AppText>
            </View>
            <View style={styles.heroBudgetTrack}>
              <View style={styles.heroBudgetFill} />
            </View>
            <View style={styles.heroBudgetFoot}>
              <AppText variant="caption" color="rgba(255,255,255,0.8)">
                已用 1,161.40 / 3,500.00
              </AppText>
              <AppText variant="caption" color="rgba(255,255,255,0.8)">
                33%
              </AppText>
            </View>
          </GlassView>

          {/* 账单卡（surface 从渐变下沿接上）+ 42 圆图标行 */}
          <View style={[styles.heroListCard, { backgroundColor: semantic.surface }]}>
            <View style={styles.heroListRow}>
              <IconCircle color="#FF7A59" icon="restaurant-outline" />
              <View style={{ flex: 1 }}>
                <AppText variant="subhead" weight="500">Nasi lemak 早餐</AppText>
                <AppText variant="caption" color={semantic.textSecondary}>餐饮 · CIMB Visa</AppText>
              </View>
              <MoneyText value={8.5} kind="expense" variant="subhead" roll={false} />
            </View>
            <View style={[styles.heroListRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: semantic.hairline }]}>
              <IconCircle color="#4F8BFF" icon="car-outline" />
              <View style={{ flex: 1 }}>
                <AppText variant="subhead" weight="500">Grab 去公司</AppText>
                <AppText variant="caption" color={semantic.textSecondary}>交通 · Maybank 储蓄</AppText>
              </View>
              <MoneyText value={15.2} kind="expense" variant="subhead" roll={false} />
            </View>
          </View>
        </View>
      </Section>

      <Section title="GlassView · 玻璃（填充 + 1px 亮边 + 顶部内高光；iOS/Web 叠模糊）" testID="g-glassview">
        <View style={styles.heroDemoMini}>
          <HeroGradient height={220} />
          <View style={styles.glassDemoRow}>
            <GlassView radius={999} style={styles.heroPill}>
              <AppText variant="subhead" weight="500" color="#FFFFFF">默认账本</AppText>
              <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.7)" />
            </GlassView>
            <GlassView radius={999} style={styles.heroRound}>
              <Ionicons name="calendar-outline" size={20} color="#FFFFFF" />
            </GlassView>
            <GlassView radius={24} style={{ padding: 16, width: 120 }}>
              <AppText variant="caption" color="#FFFFFF">圆角 24 玻璃卡</AppText>
            </GlassView>
          </View>
        </View>
      </Section>

      <Section title="IconCircle · 42 圆（有色 / 中性）/ 48 圆选中（两层外圈）" testID="g-iconcircle">
        <Card>
          <View style={styles.actions}>
            <IconCircle color="#FF7A59" icon="restaurant-outline" />
            <IconCircle color="#4F8BFF" icon="car-outline" />
            <IconCircle color="#35C27A" icon="cash-outline" />
            <IconCircle color="#B07CFF" icon="pricetag-outline" />
            <IconCircle color="#FFB020" icon="cafe-outline" />
            <IconCircle icon="grid-outline" />
            <IconCircle size={48} color="#FF7A59" icon="restaurant-outline" selected />
          </View>
        </Card>
      </Section>

      <Section title="SegmentedControl · 玻璃底 + 白胶囊（运动/收支）/ accent 渐变（深色模式）" testID="g-seg-glass">
        <View style={styles.heroDemoMini}>
          <HeroGradient height={160} />
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <SegmentedControl
              options={[
                { label: '年', value: 'year' },
                { label: '月', value: 'month' },
                { label: '周', value: 'week' },
              ]}
              selected={segMonth}
              onSelect={setSegMonth}
              appearance="glass"
            />
            <SegmentedControl
              options={[
                { label: '支出', value: 'expense' },
                { label: '收入', value: 'income' },
              ]}
              selected={segIncome}
              onSelect={setSegIncome}
              appearance="glass"
            />
            <SegmentedControl
              options={[
                { label: '跟随系统', value: 'system' },
                { label: '日间', value: 'light' },
                { label: '夜间', value: 'dark' },
              ]}
              selected={seg3}
              onSelect={setSeg3}
              appearance="glass"
              thumb="accent"
            />
          </View>
        </View>
      </Section>

      <Section title="MoneyText · hero 样式（整数 500 大、RM 与小数为 300 且淡）：58 / 42 / 64" testID="g-money-hero">
        <View style={styles.heroDemoMini}>
          <HeroGradient height={240} />
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <MoneyText value={17061.15} hero heroSize={58} currency="MYR" showCurrency kind="transfer" color="#FFFFFF" roll={false} />
            <MoneyText value={28797.59} hero heroSize={42} currency="MYR" showCurrency kind="transfer" color="#FFFFFF" roll={false} />
            <MoneyText value={1234567.89} hero heroSize={64} currency="MYR" showCurrency kind="transfer" color="#FFFFFF" roll={false} />
            {/* 降级阶梯演示：58 放不下时依次 50 → 42 → 34，四档全放不下才用紧凑格式 */}
            <MoneyText value={1234567.89} hero heroSize={58} currency="MYR" showCurrency kind="transfer" color="#FFFFFF" roll={false} />
            <MoneyText value={123456789.12} hero heroSize={58} currency="MYR" showCurrency kind="transfer" color="#FFFFFF" roll={false} />
          </View>
        </View>
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  console: { paddingVertical: 8, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  consoleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scroll: { flex: 1 },
  variantRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  moneyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  tapBox: { minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  // ── P5 地基演示：全出血渐变块（-16 抵消 ScrollView 的 padding，像真实页面一样通栏）──
  heroDemo: {
    marginHorizontal: -16,
    height: 560,
    overflow: 'hidden',
  },
  heroDemoMini: {
    marginHorizontal: -16,
    overflow: 'hidden',
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 14, paddingHorizontal: 16 },
  heroRowRight: { marginLeft: 'auto', paddingTop: 0, paddingHorizontal: 0 },
  heroPill: { height: 44, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroRound: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  heroNetRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 34, paddingHorizontal: 16 },
  heroCurrencyPill: { height: 26, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 3 },
  heroAmountRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, paddingHorizontal: 16, minHeight: 64 },
  // 「隐藏金额」眼睛圆钮（稿：36 × 36 透明底、20 号图标）
  heroEyeBtn: { width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  heroBudget: { marginTop: 22, marginHorizontal: 16, borderRadius: 24, padding: 16 },
  heroBudgetTop: { flexDirection: 'row', justifyContent: 'space-between' },
  heroBudgetTrack: { marginTop: 10, height: 8, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  heroBudgetFill: { width: '33%', height: '100%', borderRadius: 99, backgroundColor: '#FFFFFF' },
  heroBudgetFoot: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
  heroListCard: { marginTop: 16, borderRadius: 26, paddingVertical: 4 },
  heroListRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, minHeight: 60 },
  glassDemoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, flexWrap: 'wrap' },
});
