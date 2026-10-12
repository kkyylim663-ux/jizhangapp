import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Keyboard,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Pressable,
  Modal,
  Platform,
} from 'react-native';

/**
 * 玻璃材质（UI V2.1 §2）在 web 上的偏差修正：expo-blur 的 web 实现用「tint 底色」模拟模糊——
 * tint default + intensity 100 → 叠一层 rgba(255,255,255,.30) 的白，夜间玻璃被洗成中紫，
 * 规范里的 text.secondary / income / danger 全部跌破 §4 硬指标（实测 2.7–4.2）。
 * 这里把 web 强度降到 8（白底 2.4%，模糊 1.6px ≈ 不可见），玻璃回到稿里的 rgba(14,10,30,.46) 实色；
 * iOS 仍用 GlassView 默认 100（真材质），Android 本来就没有模糊。
 */
const WEB_GLASS_INTENSITY = Platform.OS === 'web' ? 8 : undefined;
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  NestableDraggableFlatList,
  NestableScrollContainer,
  ScaleDecorator,
  RenderItemParams,
} from 'react-native-draggable-flatlist';
import { useApp } from '../context/AppContext';
import { useDialog } from '../components/AppDialog';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import { EXPENSE_CATEGORY_GROUPS, INCOME_CATEGORY_GROUPS } from '../utils/defaultCategories';
import { Spacing } from '../theme/theme';
import { Category } from '../types';
import { useT } from '../i18n/LanguageContext';
import { getCategoryLabel, getGroupLabel } from '../i18n/categories';
import { hapticWarning, hapticSuccess } from '../utils/haptics';
import PressableScale from '../components/PressableScale';
import SegmentedControl from '../components/SegmentedControl';
import { AppText, GlassView, HeroGradient, IconCircle, ScreenHeader } from '../components/ui';
// 图标/颜色池抽到公共常量（选择类别页的内联添加也用同一份，防两处漂移）
import { CATEGORY_ICON_OPTIONS, CATEGORY_COLOR_OPTIONS, CategoryIconName } from '../constants/categoryAddOptions';

const ICON_OPTIONS: CategoryIconName[] = CATEGORY_ICON_OPTIONS;
const COLOR_OPTIONS = CATEGORY_COLOR_OPTIONS;
const CAT_ORDER_KEY = '@jizhang/categoryOrder';
const GROUP_ORDER_KEY = '@jizhang/categoryGroupOrder';

type CategorySection = { group: string; items: Category[]; custom?: boolean };

/** UI V2.1 玻璃二级页头：ScreenHeader 的返回键是透明 44 触控区，这里在它底下垫一枚 44 玻璃圆钮（稿） */
function GlassBackHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
}) {
  const { spacing } = useTheme();
  const { pagePadding } = useLayout();
  return (
    <View>
      <View pointerEvents="none" style={[glassHeaderStyles.glass, { left: pagePadding, top: spacing.sm }]}>
        <GlassView intensity={WEB_GLASS_INTENSITY} radius={999} style={glassHeaderStyles.glassInner} />
      </View>
      <ScreenHeader variant="compact" title={title} onBack={onBack} right={right} />
    </View>
  );
}

/** 玻璃页头里那枚 44 圆钮的纯几何（与 ScreenHeader 左侧槽位对齐；颜色/材质在 GlassView 内） */
const glassHeaderStyles = StyleSheet.create({
  glass: { position: 'absolute', width: 44, height: 44 },
  glassInner: { width: 44, height: 44 },
});

// 组内排序：按持久化的 order 编号排（没编号的排最后），编号只在本组内比较
function sortByOrder(items: Category[], order: Record<string, number>): Category[] {
  return [...items].sort((a, b) => (order[a.id] ?? 9999) - (order[b.id] ?? 9999));
}

export default function CategoryManagementScreen({ navigation, route }: any) {
  const { categories, categoryGroups, addCategory, addCategoryGroup, updateCategory, deleteCategory, deleteCategoryGroup } = useApp();
  const { semantic, spacing, gradients, isDark } = useTheme();
  const { pagePadding } = useLayout();
  // 玻璃卡上的次要字色（§4 硬指标）：夜间玻璃被 web BlurView 洗亮，70% 白的 text.secondary 只有 ~4.2
  const t = useT();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  // 样式表记忆化：转场期间 blur/focus 重渲染不再重建 60+ 条样式
  const styles = useMemo(() => makeStyles(semantic, spacing), [semantic, spacing]);
  // 选择模式：财务规划的计划表单跳进来时带 selectMode=true——此时点分类是"选中并返回"，
  // 不进入管理交互（删除徽章隐藏、添加入口保留），选中后 navigate 回传 pickedCategoryId
  const selectMode = !!(route?.params && route.params.selectMode);
  // 编辑排列模式：点右上角"编辑"进入，组内出现拖拽排序的三横手柄
  const [reorderMode, setReorderMode] = useState(false);
  // 顶部支出/收入切换：只显示并编辑对应类型的大组；跳转方可带 initialType 直接落到对应类型
  const [manageType, setManageType] = useState<'expense' | 'income'>(
    route?.params?.initialType === 'income' ? 'income' : 'expense'
  );
  // 组内排序编号（按分类 id 存，跟资产页 assetOrder 同一套思路）
  const [catOrder, setCatOrder] = useState<Record<string, number>>({});
  // 大分组排列顺序（按组名存）
  const [groupOrder, setGroupOrder] = useState<Record<string, number>>({});
  // 每张大组卡片自带内联添加：正在添加的组名 + 输入的名称 + 选择的图标/颜色
  const [addingGroupName, setAddingGroupName] = useState<string | null>(null);
  const [inlineName, setInlineName] = useState('');
  const [inlineIcon, setInlineIcon] = useState<CategoryIconName>(ICON_OPTIONS[0]);
  const [inlineColor, setInlineColor] = useState(COLOR_OPTIONS[0]);
  // 新增大分类（底部）
  const [newGroupFormOpen, setNewGroupFormOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  // TASK-020③（selectMode 照搬记一笔整套交互）：折叠的组名集合（默认全展开，点头部行收/展）
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // 两步小卡第二步：119 图标选择底部弹层开关
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

    // 编辑/完成 按钮：改到页面自定义顶栏右侧（顶栏样式与"记一笔"一致：圆环返回键 + 标题 + 编辑）

  // 载入组内排序编号 + 大分组排列顺序
  useEffect(() => {
    AsyncStorage.getItem(CAT_ORDER_KEY)
      .then((raw) => {
        if (raw) setCatOrder(JSON.parse(raw) as Record<string, number>);
      })
      .catch(() => {});
    AsyncStorage.getItem(GROUP_ORDER_KEY)
      .then((raw) => {
        if (raw) setGroupOrder(JSON.parse(raw) as Record<string, number>);
      })
      .catch(() => {});
  }, []);

  const persistCatOrder = (next: Record<string, number>) => {
    setCatOrder(next);
    AsyncStorage.setItem(CAT_ORDER_KEY, JSON.stringify(next)).catch(() => {});
  };

  const persistGroupOrder = (next: Record<string, number>) => {
    setGroupOrder(next);
    AsyncStorage.setItem(GROUP_ORDER_KEY, JSON.stringify(next)).catch(() => {});
  };

  // 某个大组内拖拽结束：按新顺序把 0..n-1 写回该组这些分类的编号
  const handleCatGroupReorder = (groupName: string, groupItems: { id: string }[]) => {
    const next = { ...catOrder };
    groupItems.forEach((item, index) => {
      next[item.id] = index;
    });
    persistCatOrder(next);
  };

  // 大分组本身拖拽结束：按新顺序把 0..n-1 写回每个大分组的编号
  const handleGroupsReorder = (newSections: CategorySection[]) => {
    const next: Record<string, number> = {};
    newSections.forEach((s, index) => {
      next[s.group] = index;
    });
    persistGroupOrder(next);
  };

  // 组列表：默认5组 + 自定义组（空组也显示，方便直接往里加），组内按排序编号排列
  const sections = useMemo(() => {
    const pool = categories.filter((c) => c.type === manageType);
    const isExpense = manageType === 'expense';
    const defaultGroups: string[] = isExpense ? [...EXPENSE_CATEGORY_GROUPS] : [...INCOME_CATEGORY_GROUPS];
    const customGroups = categoryGroups.filter((g) => g.type === manageType);
    const known = [...defaultGroups, ...customGroups.map((g) => g.name)];
    const out: CategorySection[] = defaultGroups.map((group) => ({
      group,
      items: sortByOrder(
        pool.filter((c) => c.group === group),
        catOrder
      ),
    }));
    customGroups.forEach((cg) => {
      out.push({
        group: cg.name,
        items: sortByOrder(
          pool.filter((c) => c.group === cg.name),
          catOrder
        ),
        custom: true,
      });
    });
    const rest = pool.filter((c) => !known.includes(c.group as any));
    if (rest.length) out.push({ group: isExpense ? t('group.other') : t('cat.other_income'), items: sortByOrder(rest, catOrder) });

    // 大分组按持久化的排列顺序排（没编号的排最后，保持原有相对顺序）
    return out.sort((a, b) => (groupOrder[a.group] ?? 9999) - (groupOrder[b.group] ?? 9999));
  }, [categories, categoryGroups, catOrder, groupOrder, manageType]);

  const handleInlineAdd = async (groupName: string) => {
    const name = inlineName.trim();
    if (!name) return;
    // 当前管理页在哪个类型下，添加的就是哪个类型的分类
    await addCategory({ name, icon: inlineIcon, color: inlineColor, type: manageType, group: groupName });
    // TASK-020③：选择模式照搬记一笔——加完静默收起（新分类立即可见可选，不弹窗打断）；
    // 管理模式保留原弹窗反馈
    if (selectMode) {
      hapticSuccess();
      setInlineName('');
      setInlineIcon(ICON_OPTIONS[0]);
      setInlineColor(COLOR_OPTIONS[0]);
      setAddingGroupName(null);
      return;
    }
    // 明确反馈，并收起输入区
    dialog.alert({ title: t('addTx.addSuccess'), message: t('addTx.addedToGroup', { name: groupName }) });
    setInlineName('');
    setInlineIcon(ICON_OPTIONS[0]);
    setInlineColor(COLOR_OPTIONS[0]);
    setAddingGroupName(null);
  };

  const handleDeleteCategory = (id: string, name: string) => {
    dialog.alert({
      title: t('addTx.deleteCategoryConfirm', { name }),
      message: t('addTx.deleteCategoryKeepMsg'),
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => { hapticWarning(); deleteCategory(id); } },
      ],
    });
  };

  const handleDeleteGroup = (groupName: string, items: Category[]) => {
    const isCustom = categoryGroups.some((g) => g.name === groupName);
    dialog.alert({
      title: t('addTx.deleteGroupTitle', { name: groupName }),
      message: items.length > 0 ? t('addTx.deleteGroupMoveMsg', { count: items.length }) : t('addTx.emptyGroup'),
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            hapticWarning();
            if (isCustom) {
              deleteCategoryGroup(groupName);
            } else {
              // 默认大组：保留分类，只把它们的 group 清空（归入"其他"节）
              items.forEach((c) => updateCategory(c.id, { group: undefined }));
            }
          },
        },
      ],
    });
  };

  // 编辑排列模式下的组内条目：三横手柄长按拖动排序 + 删除角标
  const renderReorderItem = ({ item: c, drag, isActive }: RenderItemParams<Category>) => (
    <ScaleDecorator>
      <TouchableOpacity
        style={[styles.reorderItem, isActive && { opacity: 0.85 }]}
        activeOpacity={0.8}
        onLongPress={drag}
        delayLongPress={150}
      >
        {/* UI V2.1 §5：立体光泽球 */}
        <IconCircle size={36} color={c.color} icon={c.icon as CategoryIconName} />
        <AppText variant="subhead" weight="600" numberOfLines={1} style={styles.reorderLabel}>
          {getCategoryLabel(c, t)}
        </AppText>
        <TouchableOpacity
          style={styles.reorderDeleteBadge}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          onPress={() => handleDeleteCategory(c.id, c.name)}
        >
          <Ionicons name="remove-circle" size={18} color={semantic.danger} />
        </TouchableOpacity>
        <Ionicons name="reorder-three-outline" size={22} color={semantic.textTertiary} />
      </TouchableOpacity>
    </ScaleDecorator>
  );

  // 编辑排列模式下的大分组卡片：长按标题栏拖动整组排序，组内再用嵌套的拖拽列表排子分类
  const renderGroupReorderCard = ({ item, drag, isActive }: RenderItemParams<CategorySection>) => {
    const { group, items, custom } = item;
    return (
      <ScaleDecorator>
        <GlassView intensity={WEB_GLASS_INTENSITY} radius={26} style={isActive ? [styles.groupCard, { opacity: 0.85 }] : styles.groupCard}>
          <TouchableOpacity
            style={styles.groupHeader}
            activeOpacity={0.8}
            onLongPress={drag}
            delayLongPress={150}
          >
            <Ionicons name="reorder-three-outline" size={16} color={semantic.textTertiary} style={styles.groupDragHandle} />
            <AppText variant="subhead" weight="600" style={styles.groupTitle}>{getGroupLabel(group, t)}</AppText>
            {custom && (
              <TouchableOpacity
                style={styles.groupDeleteBtn}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                onPress={() => handleDeleteGroup(group, items)}
              >
                <Ionicons name="trash-outline" size={18} color={semantic.danger} />
              </TouchableOpacity>
            )}
            <AppText variant="caption2" color={semantic.textSecondary} style={styles.groupCount}>
              {t('addTx.itemsUnit', { count: items.length })}
            </AppText>
          </TouchableOpacity>

          {items.length > 0 ? (
            <View style={styles.reorderWrap}>
              <NestableDraggableFlatList
                data={items}
                keyExtractor={(c) => c.id}
                onDragEnd={({ data }) => handleCatGroupReorder(group, data)}
                renderItem={renderReorderItem}
              />
            </View>
          ) : (
            <AppText variant="footnote" color={semantic.textSecondary} style={styles.groupEmpty}>
              {t('addTx.emptySubcats')}
            </AppText>
          )}
        </GlassView>
      </ScaleDecorator>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: semantic.bg }]} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}
    >
      {/* UI V2.1 §1：渐变铺满整页，一切卡片浮在渐变上 */}
      <HeroGradient fill />
      {/* 玻璃二级页头：返回 + 居中标题 + 右侧「编辑 / 完成」玻璃胶囊 */}
      <GlassBackHeader
        title={selectMode ? t('addTx.selectCategory') : t('addTx.categoryMgmt')}
        onBack={() => navigation?.goBack()}
        right={
          <PressableScale
            activeScale={0.95}
            onPress={() => setReorderMode((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel={reorderMode ? t('common.done') : t('addTx.edit')}
          >
            <GlassView intensity={WEB_GLASS_INTENSITY} radius={999} style={styles.editPill}>
              <Ionicons
                name={reorderMode ? 'checkmark-outline' : 'reorder-three-outline'}
                size={15}
                color={semantic.textPrimary}
              />
              <AppText variant="caption" weight="600" color={semantic.textPrimary}>
                {reorderMode ? t('common.done') : t('addTx.edit')}
              </AppText>
            </GlassView>
          </PressableScale>
        }
      />
      {reorderMode ? (
        // 编辑排列模式：整页变成一个可拖拽列表，长按组标题拖大分组、长按组内条目拖子分类
        <NestableScrollContainer
          onScroll={onTabScroll ?? undefined}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: tabClearance, paddingHorizontal: pagePadding }}
        >
          <AppText variant="footnote" color={semantic.textSecondary} style={styles.reorderHint}>
            {t('addTx.reorderHint')}
          </AppText>
          <NestableDraggableFlatList
            data={sections}
            keyExtractor={(s) => s.group}
            onDragEnd={({ data }) => handleGroupsReorder(data)}
            renderItem={renderGroupReorderCard}
          />
        </NestableScrollContainer>
      ) : (
        <ScrollView
          onScroll={onTabScroll ?? undefined}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: tabClearance, paddingTop: 2, paddingHorizontal: pagePadding }}
        >
          {/* 顶部 支出/收入 切换：玻璃分段控件（V2.1 §2：夜白胶囊 / 日紫胶囊），带各自类别数（稿） */}
          {!selectMode && (
            <View style={styles.typeSegWrap}>
              <SegmentedControl
                stretch
                appearance="glass"
                options={[
                  { label: t('addTx.expenseTabCount', { count: categories.filter((c) => c.type === 'expense').length }), value: 'expense' },
                  { label: t('addTx.incomeTabCount', { count: categories.filter((c) => c.type === 'income').length }), value: 'income' },
                ]}
                selected={manageType}
                onSelect={(v) => {
                  setManageType(v as 'expense' | 'income');
                  setReorderMode(false);
                }}
              />
            </View>
          )}

          {/* 每张大组一张玻璃卡：组内成员 + 该组自己的添加入口；自定义组可删除 */}
          {sections.map(({ group, items, custom }) => {
            const isAdding = addingGroupName === group;
            // TASK-020③：selectMode 照搬记一笔——折叠状态在 Set 里，点头部行收/展（管理模式不受影响）
            const expanded = !selectMode || !collapsedGroups.has(group);
            return (
            <GlassView intensity={WEB_GLASS_INTENSITY} key={group} radius={26} style={styles.groupCard}>
              {/* TASK-020③：selectMode 头部行照搬记一笔组卡（箭头+组名+＋药丸+🗑+数量胶囊，整行可点收展）；
                  管理模式保持原头部不变 */}
              {selectMode ? (
                <Pressable
                  style={styles.groupHeader}
                  onPress={() => {
                    setCollapsedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group)) next.delete(group);
                      else next.add(group);
                      return next;
                    });
                  }}
                  hitSlop={{ top: 6, bottom: 6 }}
                >
                  <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={14} color={semantic.textPrimary} />
                  <AppText variant="subhead" weight="600" style={styles.groupTitle}>{getGroupLabel(group, t)}</AppText>
                  {/* ＋入口移入标题行（记一笔同款药丸）：点开组内两步小卡 */}
                  <PressableScale
                    style={[styles.catHeaderAddBtn, { backgroundColor: semantic.accentSoft }]}
                    activeScale={0.92}
                    onPress={() => {
                      if (isAdding) {
                        setAddingGroupName(null);
                        setInlineName('');
                      } else {
                        setInlineName('');
                        setInlineIcon(ICON_OPTIONS[0]);
                        setInlineColor(COLOR_OPTIONS[0]);
                        setAddingGroupName(group);
                      }
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name={isAdding ? 'remove' : 'add'} size={13} color={semantic.textPrimary} />
                    <AppText variant="caption2" weight="700" color={semantic.textPrimary}>
                      {isAdding ? t('addTx.headerCollapse') : t('addTx.headerAdd')}
                    </AppText>
                  </PressableScale>
                  <AppText variant="caption2" color={semantic.textSecondary} style={styles.groupCount}>
                    {t('addTx.itemsUnit', { count: items.length })}
                  </AppText>
                  {/* 整组删除入口（记一笔同款：垃圾桶贴数量胶囊右侧；默认组自定义组都可删） */}
                  <PressableScale
                    style={styles.catHeaderDeleteBtn}
                    activeScale={0.90}
                    onPress={() => handleDeleteGroup(group, items)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="trash-outline" size={18} color={semantic.danger} />
                  </PressableScale>
                </Pressable>
              ) : (
              <View style={styles.groupHeader}>
                <AppText variant="subhead" weight="600" style={styles.groupTitle}>{getGroupLabel(group, t)}</AppText>
                <PressableScale
                  style={styles.groupDeleteBtn}
                  activeScale={0.90}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  onPress={() => handleDeleteGroup(group, items)}
                >
                  <Ionicons name="trash-outline" size={18} color={semantic.danger} />
                </PressableScale>
                <AppText variant="caption2" color={semantic.textSecondary} style={styles.groupCount}>
                  {t('addTx.itemsUnit', { count: items.length })}
                </AppText>
              </View>
              )}

              {/* TASK-020③：selectMode 折叠时组内容不渲染（记一笔同款）；管理模式永远显示 */}
              {(expanded || !selectMode) && (items.length > 0 ? (
                <View style={styles.groupGrid}>
                  {items.map((c) => (
                    <View key={c.id} style={styles.gridItem}>
                      {/* 选择模式下整格可点：选中分类并返回表单；管理模式保持纯展示 */}
                      {selectMode ? (
                        <PressableScale
                          style={styles.gridSelectWrap}
                          activeScale={0.97}
                          onPress={() => {
                            // 选择模式：回调把选中 id 交回表单 + goBack 弹栈返回——
                            // 之前用 navigate(merge:true) 跳转，跨栈找不到目标时会再压一个新页面，反复点就无限套娃
                            const pick = route?.params?.onPickCategory;
                            if (typeof pick === 'function') pick(c.id);
                            navigation.goBack();
                          }}
                        >
                          <IconCircle size={52} color={c.color} icon={c.icon as CategoryIconName} />
                          <AppText variant="caption" numberOfLines={1} style={styles.gridLabel}>
                            {getCategoryLabel(c, t)}
                          </AppText>
                        </PressableScale>
                      ) : (
                        <>
                          <IconCircle size={52} color={c.color} icon={c.icon as CategoryIconName} />
                          <PressableScale
                            style={styles.gridDeleteBadge}
                            activeScale={0.90}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            onPress={() => handleDeleteCategory(c.id, c.name)}
                          >
                            <Ionicons name="remove-circle" size={18} color={semantic.danger} />
                          </PressableScale>
                          <AppText variant="caption" numberOfLines={1} style={styles.gridLabel}>
                            {getCategoryLabel(c, t)}
                          </AppText>
                        </>
                      )}
                    </View>
                  ))}
                </View>
              ) : (
                <AppText variant="footnote" color={semantic.textSecondary} style={styles.groupEmpty}>
                  {t('addTx.noCatsAddHint')}
                </AppText>
              ))}

              {/* 该组的添加入口：TASK-020③ selectMode 照搬记一笔两步小卡（图标预览+名称+✓ + 16 色格，
                  图标在弹层里选）；管理模式保持原长表单不变 */}
              {isAdding && selectMode ? (
                <View style={styles.catInlineCard}>
                  <View style={styles.catInlineNameRow}>
                    <PressableScale
                      style={[styles.catIconPreviewBtn, { backgroundColor: semantic.accentSoft }]}
                      activeScale={0.94}
                      onPress={() => setIconPickerOpen(true)}
                    >
                      <Ionicons name={inlineIcon} size={22} color={semantic.textPrimary} />
                    </PressableScale>
                    <TextInput
                      style={[styles.catInlineInput, { backgroundColor: semantic.accentSoft, color: semantic.textPrimary }]}
                      value={inlineName}
                      onChangeText={setInlineName}
                      placeholder={t('addTx.inlineAddPlaceholder', { group })}
                      placeholderTextColor={semantic.textSecondary}
                      maxLength={10}
                      autoFocus
                    />
                    {/* 保存方键 = accent 渐变（§3：渐变实心按钮保持白字） */}
                    <PressableScale
                      activeScale={0.94}
                      disabled={!inlineName.trim()}
                      onPress={() => handleInlineAdd(group)}
                      accessibilityRole="button"
                      accessibilityLabel={t('common.done')}
                    >
                      <LinearGradient
                        colors={gradients.accent.colors}
                        locations={gradients.accent.locations as [number, number, ...number[]]}
                        start={gradients.accent.start}
                        end={gradients.accent.end}
                        style={[styles.catInlineSaveSquare, !inlineName.trim() && { opacity: 0.45 }]}
                      >
                        <Ionicons name="checkmark" size={20} color={semantic.onAccent} />
                      </LinearGradient>
                    </PressableScale>
                  </View>
                  {/* 16 色直接铺 2 排（每排 8 个）——记一笔同款 */}
                  <View style={styles.catMiniColorsGrid}>
                    {COLOR_OPTIONS.map((color) => (
                      <PressableScale
                        key={color}
                        style={[
                          styles.catMiniColorDot,
                          { backgroundColor: color },
                          inlineColor === color && {
                            boxShadow: `0px 0px 0px 2px ${semantic.bg}, 0px 0px 0px 4px ${color}`,
                          },
                        ]}
                        activeScale={0.92}
                        onPress={() => setInlineColor(color)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: inlineColor === color }}
                        accessibilityLabel={color}
                      />
                    ))}
                  </View>
                </View>
              ) : isAdding ? (
                <View style={styles.inlineAddCard}>
                  <TextInput
                    style={[styles.input, { backgroundColor: semantic.accentSoft, color: semantic.textPrimary }]}
                    value={inlineName}
                    onChangeText={setInlineName}
                    placeholder={t('addTx.inlineAddPlaceholder', { group })}
                    placeholderTextColor={semantic.textSecondary}
                    maxLength={10}
                    autoFocus
                  />
                  <AppText variant="caption" color={semantic.textSecondary} style={styles.pickerLabel}>
                    {t('ledger.iconLabel')}
                  </AppText>
                  <View style={styles.pickerRow}>
                    {ICON_OPTIONS.map((icon) => (
                      <PressableScale
                        key={icon}
                        style={[
                          styles.iconOption,
                          { backgroundColor: semantic.accentSoft },
                          inlineIcon === icon && { borderWidth: 2, borderColor: semantic.accentText },
                        ]}
                        activeScale={0.92}
                        onPress={() => setInlineIcon(icon)}
                      >
                        <Ionicons name={icon} size={16} color={semantic.textPrimary} />
                      </PressableScale>
                    ))}
                  </View>
                  <AppText variant="caption" color={semantic.textSecondary} style={styles.pickerLabel}>
                    {t('ledger.colorLabel')}
                  </AppText>
                  <View style={styles.pickerRow}>
                    {COLOR_OPTIONS.map((color) => (
                      <PressableScale
                        key={color}
                        style={[
                          styles.colorOption,
                          { backgroundColor: color },
                          inlineColor === color && {
                            boxShadow: `0px 0px 0px 2px ${semantic.bg}, 0px 0px 0px 4px ${color}`,
                          },
                        ]}
                        activeScale={0.92}
                        onPress={() => setInlineColor(color)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: inlineColor === color }}
                        accessibilityLabel={color}
                      />
                    ))}
                  </View>
                  <View style={styles.inlineBtnRow}>
                    <PressableScale style={styles.cancelBtn} activeScale={0.94} onPress={() => setAddingGroupName(null)}>
                      <AppText variant="subhead" color={semantic.textSecondary}>{t('common.cancel')}</AppText>
                    </PressableScale>
                    <PressableScale
                      style={{ flex: 1, opacity: !inlineName.trim() ? 0.45 : 1 }}
                      activeScale={0.97}
                      disabled={!inlineName.trim()}
                      onPress={() => handleInlineAdd(group)}
                      accessibilityRole="button"
                      accessibilityLabel={t('addTx.addToGroup', { group })}
                    >
                      <LinearGradient
                        colors={gradients.accent.colors}
                        locations={gradients.accent.locations as [number, number, ...number[]]}
                        start={gradients.accent.start}
                        end={gradients.accent.end}
                        style={styles.saveBtnFill}
                      >
                        <AppText variant="subhead" weight="600" color={semantic.onAccent} numberOfLines={1}>
                          {t('addTx.addToGroup', { group })}
                        </AppText>
                      </LinearGradient>
                    </PressableScale>
                  </View>
                </View>
              ) : (
                /* TASK-020 纠偏：selectMode 不再渲染底部「添加」入口行——添加入口已在组卡标题行＋里
                   （长表单分支只在管理模式出现，selectMode 到这里就是收尾，不渲染任何东西） */
                !selectMode && (
                  <PressableScale
                    style={[styles.inlineAddEntry, { backgroundColor: semantic.accentSoft }]}
                    activeScale={0.97}
                    onPress={() => {
                      setInlineName('');
                      setAddingGroupName(group);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.add')}
                  >
                    <Ionicons name="add-circle-outline" size={17} color={semantic.textPrimary} />
                    <AppText variant="footnote" weight="600" color={semantic.textPrimary} style={styles.inlineAddEntryText}>
                      {t('common.add')}
                    </AppText>
                  </PressableScale>
                )
              )}
            </GlassView>
          );
          })
          }
          {/* 新增大分类 */}
          {newGroupFormOpen ? (
            <GlassView intensity={WEB_GLASS_INTENSITY} radius={26} style={[styles.groupCard, styles.newGroupCard]}>
              <AppText variant="subhead" weight="600" style={styles.newCatTitle}>
                {t('addTx.addGroup')}
              </AppText>
              <TextInput
                style={[styles.input, { backgroundColor: semantic.accentSoft, color: semantic.textPrimary }]}
                value={newGroupName}
                onChangeText={setNewGroupName}
                placeholder={t('addTx.groupNamePlaceholder')}
                placeholderTextColor={semantic.textSecondary}
                maxLength={10}
                autoFocus
              />
              <View style={styles.inlineBtnRow}>
                <PressableScale style={styles.cancelBtn} activeScale={0.94} onPress={() => setNewGroupFormOpen(false)}>
                  <AppText variant="subhead" color={semantic.textSecondary}>{t('common.cancel')}</AppText>
                </PressableScale>
                <PressableScale
                  style={{ flex: 1, opacity: !newGroupName.trim() ? 0.45 : 1 }}
                  activeScale={0.97}
                  disabled={!newGroupName.trim()}
                  onPress={() => {
                    const name = newGroupName.trim();
                    if (!name) return;
                    addCategoryGroup({ name, icon: 'folder-outline', type: 'expense' });
                    setNewGroupName('');
                    setNewGroupFormOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('addTx.createGroup')}
                >
                  <LinearGradient
                    colors={gradients.accent.colors}
                    locations={gradients.accent.locations as [number, number, ...number[]]}
                    start={gradients.accent.start}
                    end={gradients.accent.end}
                    style={styles.saveBtnFill}
                  >
                    <AppText variant="subhead" weight="600" color={semantic.onAccent} numberOfLines={1}>
                      {t('addTx.createGroup')}
                    </AppText>
                  </LinearGradient>
                </PressableScale>
              </View>
            </GlassView>
          ) : (
            <PressableScale
              activeScale={0.97}
              onPress={() => setNewGroupFormOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('addTx.addGroup')}
            >
              <GlassView intensity={WEB_GLASS_INTENSITY} radius={26} style={[styles.groupCard, styles.newGroupCard]}>
                <View style={styles.newGroupEntry}>
                  <Ionicons name="add-circle-outline" size={18} color={semantic.textPrimary} />
                  <AppText variant="subhead" weight="600" color={semantic.textPrimary} style={styles.newGroupEntryText}>
                    {t('addTx.addGroup')}
                  </AppText>
                </View>
              </GlassView>
            </PressableScale>
          )}
        </ScrollView>
      )}

      {/* TASK-020③：图标选择底部弹层（两步小卡第二步）——119 个图标 6 列网格，
          点选回填小卡预览方块；记一笔同款（JSX 与样式整套照搬，防两处漂移） */}
      <Modal
        visible={iconPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIconPickerOpen(false)}
      >
        <Pressable style={styles.iconPickerOverlay} onPress={() => setIconPickerOpen(false)}>
          <Pressable style={{ width: '100%' }} onPress={() => {}}>
            {/* 弹层面板用不透明卡色（Android 无模糊，玻璃 fill 会透出底下内容） */}
            <GlassView intensity={WEB_GLASS_INTENSITY} radius={0} fill={semantic.homeCard} style={styles.iconPickerSheet}>
              <View style={styles.iconPickerHeader}>
                <AppText variant="headline">{t('addTx.pickIconTitle')}</AppText>
                <PressableScale
                  style={[styles.iconPickerClose, { backgroundColor: semantic.accentSoft }]}
                  activeScale={0.92}
                  onPress={() => setIconPickerOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.close')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={18} color={semantic.textSecondary} />
                </PressableScale>
              </View>
              <ScrollView style={styles.iconPickerGrid} keyboardShouldPersistTaps="handled">
                <View style={styles.iconPickerGridInner}>
                  {ICON_OPTIONS.map((icon) => (
                    <PressableScale
                      key={icon}
                      style={[
                        styles.iconPickerCell,
                        inlineIcon === icon && { backgroundColor: semantic.accentSoft },
                      ]}
                      activeScale={0.9}
                      onPress={() => {
                        setInlineIcon(icon);
                        setIconPickerOpen(false);
                      }}
                    >
                      <Ionicons name={icon} size={22} color={inlineIcon === icon ? semantic.accentText : semantic.textPrimary} />
                    </PressableScale>
                  ))}
                </View>
              </ScrollView>
            </GlassView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(semantic: ReturnType<typeof useTheme>['semantic'], spacing: Spacing) {
  return StyleSheet.create({
    container: { flex: 1 },
    // 玻璃页头：透明返回键底下那枚 44 玻璃圆钮（与 ScreenHeader 左侧槽位对齐）
    headerGlass: { position: 'absolute', width: 44, height: 44 },
    headerGlassInner: { width: 44, height: 44 },
    // 右侧「编辑 / 完成」玻璃胶囊（稿：高 40 / padding 0 14 / radius 999）
    editPill: {
      height: 40,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    // 顶部 支出/收入 分段：贴紧页头（上移），玻璃槽自带圆角
    typeSegWrap: { marginBottom: spacing.md },
    groupCard: {
      marginBottom: spacing.md,
      paddingBottom: spacing.xs + 2,
    },
    groupHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 3 },
    groupDragHandle: { marginRight: spacing.xs + 2 },
    groupTitle: { flexShrink: 1 },
    groupDeleteBtn: { marginLeft: spacing.sm },
    groupCount: { marginLeft: 'auto' },
    reorderHint: { paddingBottom: spacing.sm },
    groupGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.sm, paddingTop: spacing.xs },
    gridItem: { width: '33.33%', alignItems: 'center', marginBottom: spacing.lg },
    // 选择模式下包住图标+文字的可点区域（覆盖整格宽度，方便点按）
    gridSelectWrap: { alignItems: 'center', width: '100%' },
    gridDeleteBadge: { position: 'absolute', top: -4, right: 8 },
    gridLabel: { marginTop: 5, textAlign: 'center' },
    groupEmpty: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
    // ---------- TASK-020③：selectMode 照搬记一笔的两步小卡 + 图标弹层样式（原样搬，防两处漂移） ----------
    catInlineCard: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, paddingTop: spacing.xs },
    catInlineInput: {
      flex: 1,
      minWidth: 0,
      borderRadius: 999,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 14,
      textAlign: 'center',
    },
    catIconPreviewBtn: {
      width: 44,
      height: 44,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.sm,
    },
    catInlineSaveSquare: {
      marginLeft: spacing.sm,
      width: 38,
      height: 38,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      overflow: 'hidden',
    },
    catInlineNameRow: { flexDirection: 'row', alignItems: 'center' },
    catMiniColorsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: spacing.sm + 2,
      paddingHorizontal: 2,
    },
    catMiniColorDot: { width: 26, height: 26, borderRadius: 999, marginRight: 10, marginBottom: spacing.sm },
    // 标题行药丸「新增」键 + 垃圾桶（记一笔同款规格）
    catHeaderAddBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 24,
      borderRadius: 12,
      paddingHorizontal: 9,
      marginLeft: spacing.sm,
      gap: 2,
    },
    catHeaderDeleteBtn: { marginLeft: spacing.sm, padding: 2 },
    iconPickerOverlay: {
      flex: 1,
      backgroundColor: semantic.scrim,
      justifyContent: 'flex-end',
    },
    iconPickerSheet: {
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      maxHeight: 520,
      paddingBottom: spacing.lg,
    },
    iconPickerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md + 2,
      paddingBottom: spacing.sm,
    },
    iconPickerClose: {
      width: 30,
      height: 30,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconPickerGrid: { paddingHorizontal: 10 },
    iconPickerGridInner: { flexDirection: 'row', flexWrap: 'wrap' },
    iconPickerCell: {
      width: `${100 / 6}%` as unknown as `${number}%`,
      aspectRatio: 1.15,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
    },
    // 编辑排列模式条目
    reorderWrap: { paddingHorizontal: 10 },
    reorderItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: semantic.accentSoft,
      borderRadius: 16,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.sm,
    },
    reorderLabel: { flex: 1, marginLeft: spacing.sm + 2 },
    reorderDeleteBadge: { marginRight: 10 },
    // 组内联添加
    inlineAddCard: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    inlineBtnRow: { flexDirection: 'row', marginTop: spacing.md, alignItems: 'center' },
    // 添加入口胶囊行：与记一笔选择类别页的 catAddTile 同观感（accentSoft 圆底 + accentText 文字）
    inlineAddEntry: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'center',
      marginHorizontal: spacing.lg,
      marginBottom: 10,
      marginTop: spacing.xs,
      paddingVertical: 9,
      paddingHorizontal: 18,
      borderRadius: 999,
    },
    inlineAddEntryText: { marginLeft: spacing.xs + 2 },
    cancelBtn: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18, marginRight: spacing.sm },
    // 新增大分类
    newGroupCard: { marginTop: spacing.xs, padding: spacing.lg },
    newCatTitle: { marginBottom: 10 },
    newGroupEntry: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'center',
      paddingVertical: 9,
      paddingHorizontal: 18,
      borderRadius: 999,
    },
    newGroupEntryText: { marginLeft: spacing.xs + 2 },
    input: {
      borderRadius: 999,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      fontSize: 14,
      marginBottom: spacing.md,
    },
    pickerLabel: { marginBottom: spacing.sm },
    pickerRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
    iconOption: {
      width: 32,
      height: 32,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.sm - 2,
      marginBottom: spacing.sm - 2,
    },
    colorOption: { width: 26, height: 26, borderRadius: 999, marginRight: spacing.sm, marginBottom: spacing.sm - 2 },
    // 渐变主按钮的填充层（圆角 999 胶囊；文字白字压在上面）
    saveBtnFill: {
      minHeight: 44,
      borderRadius: 999,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
    },
  });
}
