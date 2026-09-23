// 一次性迁移脚本（阶段2第三批）：共享组件 + 小页面 → i18n（跑完即删）
const fs = require('fs');
let count = 0;

function migrate(p, reps) {
  let s = fs.readFileSync(p, 'utf8');
  for (const [from, to] of reps) {
    if (s.includes(from)) {
      s = s.split(from).join(to);
      count++;
    } else {
      console.log(`MISS ${p}:`, from.slice(0, 70));
    }
  }
  fs.writeFileSync(p, s);
}

// ---------- AmountCalculatorKeypad（共享键盘） ----------
migrate('src/components/AmountCalculatorKeypad.tsx', [
  ["import { useTheme } from '../theme/useTheme';", "import { useTheme } from '../theme/useTheme';\nimport { useT } from '../i18n/LanguageContext';"],
  ["const { colors } = useTheme();", "const { colors } = useTheme();\n  const t = useT();"],
  ["placeholder={notePlaceholder ?? '添加备注（选填）...'}", "placeholder={notePlaceholder ?? t('addTx.keypadNotePlaceholder')}"],
  ["<Text style={[styles.smallChipText, { color: colors.link }]}>收据</Text>", "<Text style={[styles.smallChipText, { color: colors.link }]}>{t('addTx.keypadReceipt')}</Text>"],
  ["{isToday ? '今天' : '日期'}", "{isToday ? t('addTx.keypadToday') : t('addTx.keypadDate')}"],
  ["<Text style={[styles.keyText, { color: colors.fabIcon, fontWeight: '600' }]}>完成</Text>", "<Text style={[styles.keyText, { color: colors.fabIcon, fontWeight: '600' }]}>{t('addTx.keypadConfirm')}</Text>"],
  ["<Text style={[styles.confirmHint, { color: colors.fabIcon }]}>长按连续记</Text>", "<Text style={[styles.confirmHint, { color: colors.fabIcon }]}>{t('addTx.keypadConfirmHint')}</Text>"],
]);

// ---------- DateRangePickerSheet（共享日期弹窗） ----------
migrate('src/components/DateRangePickerSheet.tsx', [
  ["import { useTheme } from '../theme/useTheme';", "import { useTheme } from '../theme/useTheme';\nimport { useT } from '../i18n/LanguageContext';"],
  ["const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];", "// 周表头与快捷标签在组件内用 t() 翻译（zh/en 字典 addTx.*）\nconst QUICK_KEYS: Record<string, string> = {\n  '今天': 'addTx.quickToday',\n  '昨天': 'addTx.quickYesterday',\n  '本星期': 'addTx.quickThisWeek',\n  '上星期': 'addTx.quickLastWeek',\n  '本月': 'addTx.quickThisMonth',\n  '上月': 'addTx.quickLastMonth',\n  '今年': 'addTx.quickThisYear',\n};"],
  ["{ label: '今天', range: (now) => ({ start: fmt(now), end: fmt(now) }) },", "{ label: '今天', range: (now) => ({ start: fmt(now), end: fmt(now) }) }, // label 走 QUICK translate"],
  ["{mode !== 'single' && <Text style={s.title}>选择日期范围</Text>}", "{mode !== 'single' && <Text style={s.title}>{t('addTx.dateSheetTitle')}</Text>}"],
  ["<Text style={s.calTitle}>{viewMonth.getFullYear()}年{viewMonth.getMonth() + 1}月</Text>\n      <Ionicons", "<Text style={s.calTitle}>{t('addTx.calTitle', { y: viewMonth.getFullYear(), m: viewMonth.getMonth() + 1 })}</Text>\n      <Ionicons"],
  ["<Text style={s.calTitle}>{viewMonth.getFullYear()}年{viewMonth.getMonth() + 1}月</Text>\n          <Ionicons", "<Text style={s.calTitle}>{t('addTx.calTitle', { y: viewMonth.getFullYear(), m: viewMonth.getMonth() + 1 })}</Text>\n          <Ionicons"],
  ["{selStart && selEnd ? `应用 ${selStart} ~ ${selEnd}` : '选择结束日期'}", "{selStart && selEnd ? t('addTx.dateSheetApply', { range: `${selStart} ~ ${selEnd}` }) : t('addTx.dateSheetSelectEnd')}"],
]);

// ---------- PersonalCenterScreen ----------
migrate('src/screens/PersonalCenterScreen.tsx', [
  ["import { useTheme } from '../theme/useTheme';", "import { useTheme } from '../theme/useTheme';\nimport { useT } from '../i18n/LanguageContext';"],
  ["const { colors } = useTheme();", "const { colors } = useTheme();\n  const t = useT();"],
  ["Alert.alert('需要相册权限', '请在系统设置里允许访问相册后重试');", "Alert.alert(t('addTx.pcPhotoTitle'), t('addTx.pcPhotoMsg'));"],
  ["Alert.alert('选择照片失败', '请重试一次');", "Alert.alert(t('addTx.pickPhotoFailed'), t('addTx.pickPhotoMsg'));"],
  ["<Text style={[s.title, { color: colors.textPrimary }]}>个人中心</Text>", "<Text style={[s.title, { color: colors.textPrimary }]}>{t('addTx.pagePersonalCenter')}</Text>"],
  ["<Text style={[s.name, { color: colors.textPrimary }]}>我的账户</Text>", "<Text style={[s.name, { color: colors.textPrimary }]}>{t('addTx.pageMyAccount')}</Text>"],
  ["<Text style={[s.section, { color: colors.textTertiary }]}>使用情况</Text>", "<Text style={[s.section, { color: colors.textTertiary }]}>{t('addTx.usage')}</Text>"],
  ["<Info label=\"记账天数\" value={`${bookkeepingDays} 天`} colors={colors} />", "<Info label={t('addTx.bookkeepingDays')} value={t('addTx.daysUnit', { n: bookkeepingDays })} colors={colors} />"],
  ["<Info label=\"已使用天数\" value={useDays !== null ? `${useDays} 天` : '-- 天'} colors={colors} />", "<Info label={t('addTx.usedDays')} value={useDays !== null ? t('addTx.daysUnit', { n: useDays }) : '--'} colors={colors} />"],
  ["<Info label=\"账本数量\" value={`${ledgers.length} 个`} colors={colors} />", "<Info label={t('addTx.ledgerCount')} value={t('addTx.countUnit', { n: ledgers.length })} colors={colors} />"],
]);

// ---------- AboutAppScreen ----------
migrate('src/screens/AboutAppScreen.tsx', [
  ["import { useTheme } from '../theme/useTheme';", "import { useTheme } from '../theme/useTheme';\nimport { useT } from '../i18n/LanguageContext';"],
  ["<Text style={[styles.title, { color: colors.textPrimary }]}>关于应用</Text>", "<Text style={[styles.title, { color: colors.textPrimary }]}>{t('addTx.aboutTitle')}</Text>"],
  ["<Row label=\"当前版本\" value={APP_VERSION} colors={colors} />", "<Row label={t('addTx.currentVersion')} value={APP_VERSION} colors={colors} />"],
  ["label=\"更新内容\"", "label={t('addTx.whatsNew')}"],
  ["value=\"基础记账 · 预算 · 资产统计\"", "value={t('addTx.whatsNewValue')}"],
  ["<Text style={[styles.rowLabel, { color: colors.textSecondary }]}>检查更新</Text>", "<Text style={[styles.rowLabel, { color: colors.textSecondary }]}>{t('addTx.checkUpdate')}</Text>"],
]);

// ---------- HelpFeedbackScreen ----------
migrate('src/screens/HelpFeedbackScreen.tsx', [
  ["import { useTheme } from '../theme/useTheme';", "import { useTheme } from '../theme/useTheme';\nimport { useT } from '../i18n/LanguageContext';"],
  ["const { colors } = useTheme();", "const { colors } = useTheme();\n  const t = useT();"],
  ["Alert.alert('请输入反馈内容');", "Alert.alert(t('addTx.enterFeedback'));"],
  ["Alert.alert('提交成功', '感谢你的反馈');", "Alert.alert(t('addTx.submitOk'), t('addTx.submitThanks'));"],
  ["<Text style={[styles.title, { color: colors.textPrimary }]}>帮助与反馈</Text>", "<Text style={[styles.title, { color: colors.textPrimary }]}>{t('addTx.helpTitle')}</Text>"],
  ["<Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>常见问题</Text>", "<Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>{t('addTx.faq')}</Text>"],
  ["<Row label=\"如何新增一笔账单？\" colors={colors} />", "<Row label={t('addTx.faqAdd')} colors={colors} />"],
  ["<Row label=\"如何切换账本？\" colors={colors} />", "<Row label={t('addTx.faqSwitch')} colors={colors} />"],
  ["<Row label=\"如何管理资产账户？\" colors={colors} />", "<Row label={t('addTx.faqAssets')} colors={colors} />"],
  ["<Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>意见反馈</Text>", "<Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>{t('addTx.feedbackSection')}</Text>"],
  ['placeholder="告诉我们你遇到的问题或建议"', "placeholder={t('addTx.feedbackPlaceholder')}"],
  ["<Text style={[styles.buttonText, { color: colors.bg }]}>提交反馈</Text>", "<Text style={[styles.buttonText, { color: colors.bg }]}>{t('addTx.submitFeedback')}</Text>"],
]);

// ---------- CalculatorHubScreen ----------
migrate('src/screens/CalculatorHubScreen.tsx', [
  ["import { useTheme } from '../theme/useTheme';", "import { useTheme } from '../theme/useTheme';\nimport { useT } from '../i18n/LanguageContext';"],
  ["<Text style={[s.title, { color: colors.textPrimary }]}>计算器</Text>", "<Text style={[s.title, { color: colors.textPrimary }]}>{t('addTx.calcTitle')}</Text>"],
  ["{ name: '贷款计算器', sub: '本金 / 利率 / 年限 → 每月供款',", "// 名称改为运行时翻译 key（zh/en 字典 addTx.loanCalc*）\n  { name: 'addTx.loanCalc', sub: 'addTx.loanCalcSub',"],
  ["{ name: '复利计算器', sub: '本金 / 利率 / 定投 → 到期总额',", "{ name: 'addTx.compoundCalc', sub: 'addTx.compoundCalcSub',"],
  ["{c.name}", "{t(c.name)}"],
  ["{c.sub}", "{t(c.sub)}"],
]);
console.log('applied', count);
