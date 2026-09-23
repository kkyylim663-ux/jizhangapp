import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Keyboard,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Pressable,
  Modal,
} from 'react-native';
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
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import { EXPENSE_CATEGORY_GROUPS, INCOME_CATEGORY_GROUPS } from '../utils/defaultCategories';
import { ThemeColors } from '../theme/theme';
import { Category } from '../types';
import { useT } from '../i18n/LanguageContext';
import { getCategoryLabel, getGroupLabel } from '../i18n/categories';
import { hapticWarning, hapticSuccess } from '../utils/haptics';
import PressableScale from '../components/PressableScale';
// 图标/颜色池抽到公共常量（选择类别页的内联添加也用同一份，防两处漂移）
import { CATEGORY_ICON_OPTIONS, CATEGORY_COLOR_OPTIONS, CategoryIconName } from '../constants/categoryAddOptions';

const ICON_OPTIONS: CategoryIconName[] = CATEGORY_ICON_OPTIONS;
const COLOR_OPTIONS = CATEGORY_COLOR_OPTIONS;
const CAT_ORDER_KEY = '@jizhang/categoryOrder';
const GROUP_ORDER_KEY = '@jizhang/categoryGroupOrder';

type CategorySection = { group: string; items: Category[]; custom?: boolean };

// 组内排序：按持久化的 order 编号排（没编号的排最后），编号只在本组内比较
function sortByOrder(items: Category[], order: Record<string, number>): Category[] {
  return [...items].sort((a, b) => (order[a.id] ?? 9999) - (order[b.id] ?? 9999));
}

export default function CategoryManagementScreen({ navigation, route }: any) {
  const { categories, categoryGroups, addCategory, addCategoryGroup, updateCategory, deleteCategory, deleteCategoryGroup } = useApp();
  const { colors } = useTheme();
  const t = useT();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  // 样式表记忆化：转场期间 blur/focus 重渲染不再重建 60+ 条样式
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
        <View style={[styles.reorderIconCircle, { backgroundColor: c.color + '22' }]}>
          <Ionicons name={c.icon as CategoryIconName} size={20} color={c.color} />
        </View>
        <Text style={styles.reorderLabel}>{getCategoryLabel(c, t)}</Text>
        <TouchableOpacity
          style={styles.reorderDeleteBadge}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          onPress={() => handleDeleteCategory(c.id, c.name)}
        >
          <Ionicons name="remove-circle" size={16} color={colors.expense} />
        </TouchableOpacity>
        <Ionicons name="reorder-three-outline" size={22} color={colors.textTertiary} />
      </TouchableOpacity>
    </ScaleDecorator>
  );

  // 编辑排列模式下的大分组卡片：长按标题栏拖动整组排序，组内再用嵌套的拖拽列表排子分类
  const renderGroupReorderCard = ({ item, drag, isActive }: RenderItemParams<CategorySection>) => {
    const { group, items, custom } = item;
    return (
      <ScaleDecorator>
        <View style={[styles.groupCard, isActive && styles.groupCardActive]}>
          <TouchableOpacity
            style={styles.groupHeader}
            activeOpacity={0.8}
            onLongPress={drag}
            delayLongPress={150}
          >
            <Ionicons name="reorder-three-outline" size={16} color={colors.textTertiary} style={styles.groupDragHandle} />
            <Text style={styles.groupTitle}>{getGroupLabel(group, t)}</Text>
            {custom && (
              <TouchableOpacity
                style={styles.groupDeleteBtn}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                onPress={() => handleDeleteGroup(group, items)}
              >
                <Ionicons name="trash-outline" size={15} color={colors.expense} />
              </TouchableOpacity>
            )}
            <Text style={styles.groupCount}>{t('addTx.itemsUnit', { count: items.length })}</Text>
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
            <Text style={styles.groupEmpty}>{t('addTx.emptySubcats')}</Text>
          )}
        </View>
      </ScaleDecorator>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}
    >
      {/* 顶栏与"记一笔"同款：圆环返回键 + 标题 + 右侧编辑切换（原生 header 已关闭） */}
      <View style={styles.topBar}>
        <PressableScale
          style={styles.topBackBtn}
          activeScale={0.92}
          onPress={() => navigation?.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={22} color={colors.icon} />
        </PressableScale>
        <Text style={styles.topBarTitle}>
          {/* 选择模式进来（财务规划/记一笔添加分类）显示"选择类别"，与设置项管理入口区分 */}
          {selectMode ? t('addTx.selectCategory') : t('addTx.categoryMgmt')}
        </Text>
        <PressableScale
          style={[styles.editToggleBtn, reorderMode && styles.editToggleBtnActive]}
          activeScale={0.92}
          onPress={() => setReorderMode((prev) => !prev)}
        >
          <Ionicons name={reorderMode ? 'checkmark-outline' : 'reorder-three-outline'} size={15} color={reorderMode ? colors.fabIcon : colors.link} />
          <Text style={[styles.editToggleText, reorderMode && { color: colors.fabIcon }]}>{reorderMode ? t('common.done') : t('addTx.edit')}</Text>
        </PressableScale>
      </View>
      {reorderMode ? (
        // 编辑排列模式：整页变成一个可拖拽列表，长按组标题拖大分组、长按组内条目拖子分类
        <NestableScrollContainer
          onScroll={onTabScroll ?? undefined}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: tabClearance }}
        >
          <Text style={styles.reorderHint}>{t('addTx.reorderHint')}</Text>
          <NestableDraggableFlatList
            data={sections}
            keyExtractor={(s) => s.group}
            onDragEnd={({ data }) => handleGroupsReorder(data)}
            renderItem={renderGroupReorderCard}
          />
        </NestableScrollContainer>
      ) : (
        <ScrollView onScroll={onTabScroll ?? undefined} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: tabClearance, paddingTop: 2 }}>
          {/* 顶部 支出/收入 切换：分别编辑对应类型的大组和组内分类（紧贴顶栏，减少顶部留白）。
              TASK-020 纠偏：selectMode 下隐藏——类型由表单 initialType 定死（进来只显示该类型的类别），
              管理模式保留切换 */}
          {!selectMode && (
            <View style={styles.typeSegRow}>
              {[['expense', t('addTx.expenseTab')], ['income', t('addTx.incomeTab')]].map(([k, label]) => (
                <PressableScale
                  key={k}
                  style={[styles.typeSegBtn, manageType === k && styles.typeSegBtnActive]}
                  activeScale={0.95}
                  onPress={() => {
                    setManageType(k as 'expense' | 'income');
                    setReorderMode(false);
                  }}
                >
                  <Text style={[styles.typeSegText, manageType === k && styles.typeSegTextActive]}>{label}</Text>
                </PressableScale>
              ))}
            </View>
          )}

          {/* 每张大组一张卡片：组内成员 + 该组自己的添加入口；自定义组可删除 */}
          {sections.map(({ group, items, custom }) => {
            const isAdding = addingGroupName === group;
            // TASK-020③：selectMode 照搬记一笔——折叠状态在 Set 里，点头部行收/展（管理模式不受影响）
            const expanded = !selectMode || !collapsedGroups.has(group);
            return (
            <View key={group} style={styles.groupCard}>
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
                  <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.link} />
                  <Text style={styles.groupTitle}>{getGroupLabel(group, t)}</Text>
                  {/* ＋入口移入标题行（记一笔同款药丸）：点开组内两步小卡 */}
                  <PressableScale
                    style={styles.catHeaderAddBtn}
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
                    <Ionicons name={isAdding ? 'remove' : 'add'} size={13} color={colors.fabIcon} />
                    <Text style={styles.catHeaderAddText}>{isAdding ? t('addTx.headerCollapse') : t('addTx.headerAdd')}</Text>
                  </PressableScale>
                  <Text style={styles.groupCount}>{t('addTx.itemsUnit', { count: items.length })}</Text>
                  {/* 整组删除入口（记一笔同款：垃圾桶贴数量胶囊右侧；默认组自定义组都可删） */}
                  <PressableScale
                    style={styles.catHeaderDeleteBtn}
                    activeScale={0.90}
                    onPress={() => handleDeleteGroup(group, items)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="trash-outline" size={15} color={colors.expense} />
                  </PressableScale>
                </Pressable>
              ) : (
              <View style={styles.groupHeader}>
                <Text style={styles.groupTitle}>{getGroupLabel(group, t)}</Text>
                <PressableScale
                  style={styles.groupDeleteBtn}
                  activeScale={0.90}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  onPress={() => handleDeleteGroup(group, items)}
                >
                  <Ionicons name="trash-outline" size={15} color={colors.expense} />
                </PressableScale>
                <Text style={styles.groupCount}>{t('addTx.itemsUnit', { count: items.length })}</Text>
              </View>
              )}

              {/* TASK-020③：selectMode 折叠时组内容不渲染（记一笔同款）；管理模式永远显示 */}
              {(expanded || !selectMode) && (items.length > 0 ? (
                <View style={styles.groupGrid} removeClippedSubviews>
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
                          <View style={[styles.gridIconCircle, { backgroundColor: c.color + '22' }]}>
                            <Ionicons name={c.icon as CategoryIconName} size={22} color={c.color} />
                          </View>
                          <Text style={styles.gridLabel} numberOfLines={1} adjustsFontSizeToFit>{getCategoryLabel(c, t)}</Text>
                        </PressableScale>
                      ) : (
                        <>
                          <View style={[styles.gridIconCircle, { backgroundColor: c.color + '22' }]}>
                            <Ionicons name={c.icon as CategoryIconName} size={22} color={c.color} />
                          </View>
                          <PressableScale
                            style={styles.gridDeleteBadge}
                            activeScale={0.90}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            onPress={() => handleDeleteCategory(c.id, c.name)}
                          >
                            <Ionicons name="remove-circle" size={16} color={colors.expense} />
                          </PressableScale>
                          <Text style={styles.gridLabel} numberOfLines={1} adjustsFontSizeToFit>{getCategoryLabel(c, t)}</Text>
                        </>
                      )}
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.groupEmpty}>{t('addTx.noCatsAddHint')}</Text>
              ))}

              {/* 该组的添加入口：TASK-020③ selectMode 照搬记一笔两步小卡（图标预览+名称+✓ + 16 色格，
                  图标在弹层里选）；管理模式保持原长表单不变 */}
              {isAdding && selectMode ? (
                <View style={styles.catInlineCard}>
                  <View style={styles.catInlineNameRow}>
                    <PressableScale
                      style={styles.catIconPreviewBtn}
                      activeScale={0.94}
                      onPress={() => setIconPickerOpen(true)}
                    >
                      <Ionicons name={inlineIcon} size={22} color={colors.textPrimary} />
                    </PressableScale>
                    <TextInput
                      style={styles.catInlineInput}
                      value={inlineName}
                      onChangeText={setInlineName}
                      placeholder={t('addTx.inlineAddPlaceholder', { group })}
                      placeholderTextColor={colors.textTertiary}
                      maxLength={10}
                      autoFocus
                    />
                    <PressableScale
                      style={[styles.catInlineSaveSquare, !inlineName.trim() && { opacity: 0.35 }]}
                      activeScale={0.94}
                      disabled={!inlineName.trim()}
                      onPress={() => handleInlineAdd(group)}
                    >
                      <Ionicons name="checkmark" size={20} color={colors.fabIcon} />
                    </PressableScale>
                  </View>
                  {/* 16 色直接铺 2 排（每排 8 个）——记一笔同款 */}
                  <View style={styles.catMiniColorsGrid}>
                    {COLOR_OPTIONS.map((color) => (
                      <TouchableOpacity
                        key={color}
                        style={[
                          styles.catMiniColorDot,
                          { backgroundColor: color },
                          inlineColor === color && styles.catMiniColorDotActive,
                        ]}
                        onPress={() => setInlineColor(color)}
                      />
                    ))}
                  </View>
                </View>
              ) : isAdding ? (
                <View style={styles.inlineAddCard}>
                  <TextInput
                    style={styles.input}
                    value={inlineName}
                    onChangeText={setInlineName}
                    placeholder={t('addTx.inlineAddPlaceholder', { group })}
                    placeholderTextColor={colors.textTertiary}
                    maxLength={10}
                    autoFocus
                  />
                  <Text style={styles.pickerLabel}>{t('ledger.iconLabel')}</Text>
                  <View style={styles.pickerRow}>
                    {ICON_OPTIONS.map((icon) => (
                      <PressableScale
                        key={icon}
                        style={[styles.iconOption, inlineIcon === icon && styles.iconOptionActive]}
                        activeScale={0.92}
                        onPress={() => setInlineIcon(icon)}
                      >
                        <Ionicons name={icon} size={16} color={colors.textPrimary} />
                      </PressableScale>
                    ))}
                  </View>
                  <Text style={styles.pickerLabel}>{t('ledger.colorLabel')}</Text>
                  <View style={styles.pickerRow}>
                    {COLOR_OPTIONS.map((color) => (
                      <TouchableOpacity
                        key={color}
                        style={[styles.colorOption, { backgroundColor: color }, inlineColor === color && styles.colorOptionActive]}
                        onPress={() => setInlineColor(color)}
                      />
                    ))}
                  </View>
                  <View style={styles.inlineBtnRow}>
                    <PressableScale style={styles.cancelBtn} activeScale={0.94} onPress={() => setAddingGroupName(null)}>
                      <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
                    </PressableScale>
                    <PressableScale
                      style={[styles.saveBtn, { flex: 1 }, !inlineName.trim() && { opacity: 0.4 }]}
                      activeScale={0.94}
                      disabled={!inlineName.trim()}
                      onPress={() => handleInlineAdd(group)}
                    >
                      <Text style={styles.saveBtnText}>{t('addTx.addToGroup', { group })}</Text>
                    </PressableScale>
                  </View>
                </View>
              ) : (
                /* TASK-020 纠偏：selectMode 不再渲染底部「添加」入口行——添加入口已在组卡标题行＋里
                    （长表单分支只在管理模式出现，selectMode 到这里就是收尾，不渲染任何东西） */
                !selectMode && (
                  <PressableScale
                    style={styles.inlineAddEntry}
                    activeScale={0.97}
                    onPress={() => {
                      setInlineName('');
                      setAddingGroupName(group);
                    }}
                  >
                    <Ionicons name="add-circle-outline" size={17} color={colors.link} />
                    <Text style={styles.inlineAddEntryText}>{t('common.add')}</Text>
                  </PressableScale>
                )
              )}
            </View>
          );
          })
          }
          {/* 新增大分类 */}
          {newGroupFormOpen ? (
            <View style={[styles.groupCard, styles.newGroupCard]}>
              <Text style={styles.newCatTitle}>{t('addTx.addGroup')}</Text>
              <TextInput
                style={styles.input}
                value={newGroupName}
                onChangeText={setNewGroupName}
                placeholder={t('addTx.groupNamePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                maxLength={10}
                autoFocus
              />
              <View style={styles.inlineBtnRow}>
                <PressableScale style={styles.cancelBtn} activeScale={0.94} onPress={() => setNewGroupFormOpen(false)}>
                  <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
                </PressableScale>
                <PressableScale
                  style={[styles.saveBtn, { flex: 1 }, !newGroupName.trim() && { opacity: 0.4 }]}
                  activeScale={0.94}
                  disabled={!newGroupName.trim()}
                  onPress={() => {
                    const name = newGroupName.trim();
                    if (!name) return;
                    addCategoryGroup({ name, icon: 'folder-outline', type: 'expense' });
                    setNewGroupName('');
                    setNewGroupFormOpen(false);
                  }}
                >
                  <Text style={styles.saveBtnText}>{t('addTx.createGroup')}</Text>
                </PressableScale>
              </View>
            </View>
          ) : (
            <PressableScale style={[styles.groupCard, styles.newGroupCard]} activeScale={0.97} onPress={() => setNewGroupFormOpen(true)}>
              <View style={styles.newGroupEntry}>
                <Ionicons name="add-circle-outline" size={18} color={colors.link} />
                <Text style={styles.newGroupEntryText}>{t('addTx.addGroup')}</Text>
              </View>
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
          <Pressable style={styles.iconPickerSheet} onPress={() => {}}>
            <View style={styles.iconPickerHeader}>
              <Text style={styles.iconPickerTitle}>{t('addTx.pickIconTitle')}</Text>
              <PressableScale
                style={styles.iconPickerClose}
                activeScale={0.92}
                onPress={() => setIconPickerOpen(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </PressableScale>
            </View>
            <ScrollView style={styles.iconPickerGrid} keyboardShouldPersistTaps="handled">
              <View style={styles.iconPickerGridInner}>
                {ICON_OPTIONS.map((icon) => (
                  <PressableScale
                    key={icon}
                    style={[styles.iconPickerCell, inlineIcon === icon && styles.iconPickerCellActive]}
                    activeScale={0.9}
                    onPress={() => {
                      setInlineIcon(icon);
                      setIconPickerOpen(false);
                    }}
                  >
                    <Ionicons name={icon} size={22} color={inlineIcon === icon ? colors.link : colors.textPrimary} />
                  </PressableScale>
                ))}
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1 },
    editToggleBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    editToggleBtnActive: { backgroundColor: colors.fabBg, borderColor: colors.fabBg },
    // 顶栏：与"记一笔"同款——圆环返回键 + 居中标题 + 右侧编辑切换
    topBar: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
    topBackBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: colors.link,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    topBarTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.textPrimary },
    editToggleText: { color: colors.link, fontSize: 13, fontWeight: '700', marginLeft: 4 },
    // 顶部 支出/收入 分段切换：贴紧顶栏（上移），条本身加高一点更好点
    typeSegRow: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: 10, padding: 2, marginBottom: 10 },
    typeSegBtn: { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 8 },
    typeSegBtnActive: { backgroundColor: colors.fabBg },
    typeSegText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
    typeSegTextActive: { color: colors.fabIcon, fontWeight: '700' },
    groupCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      marginHorizontal: 20,
      marginBottom: 12,
      paddingBottom: 6,
      overflow: 'hidden',
    },
    groupCardActive: { opacity: 0.85, borderColor: colors.fabBg },
    groupHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11 },
    groupDragHandle: { marginRight: 6 },
    groupTitle: { fontSize: 13, fontWeight: '700', color: colors.link },
    groupDeleteBtn: { marginLeft: 8 },
    groupCount: { marginLeft: 'auto', fontSize: 10, color: colors.textTertiary },
    reorderHint: { fontSize: 11, color: colors.textTertiary, paddingHorizontal: 20, paddingBottom: 8 },
    groupGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, paddingTop: 4 },
    gridItem: { width: '33.33%', alignItems: 'center', marginBottom: 16 },
    // 选择模式下包住图标+文字的可点区域（覆盖整格宽度，方便点按）
    gridSelectWrap: { alignItems: 'center', width: '100%' },
    gridIconCircle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
    gridDeleteBadge: { position: 'absolute', top: -4, right: 8 },
    gridLabel: { fontSize: 12, color: colors.textPrimary, marginTop: 5 },
    groupEmpty: { fontSize: 11, color: colors.textTertiary, paddingHorizontal: 14, paddingBottom: 10 },
    // ---------- TASK-020③：selectMode 照搬记一笔的两步小卡 + 图标弹层样式（原样搬，防两处漂移） ----------
    catInlineCard: { paddingHorizontal: 14, paddingBottom: 12, paddingTop: 2 },
    catInlineInput: {
      flex: 1,
      minWidth: 0,
      backgroundColor: colors.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 14,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    catIconPreviewBtn: {
      width: 44,
      height: 44,
      borderRadius: 11,
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 8,
    },
    catInlineSaveSquare: {
      marginLeft: 8,
      width: 38,
      height: 38,
      borderRadius: 11,
      backgroundColor: colors.fabBg,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    catInlineNameRow: { flexDirection: 'row', alignItems: 'center' },
    catMiniColorsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 10,
      paddingHorizontal: 2,
    },
    catMiniColorDot: { width: 26, height: 26, borderRadius: 13, marginRight: 10, marginBottom: 8 },
    catMiniColorDotActive: { borderWidth: 2, borderColor: colors.textPrimary },
    // 标题行药丸「新增」键 + 垃圾桶（记一笔同款规格）
    catHeaderAddBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.fabBg,
      paddingHorizontal: 9,
      marginLeft: 8,
      gap: 2,
      shadowColor: colors.fabBg,
      shadowOpacity: 0.35,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    catHeaderAddText: { color: colors.fabIcon, fontSize: 11, fontWeight: '700' },
    catHeaderDeleteBtn: { marginLeft: 8, padding: 2 },
    iconPickerOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    iconPickerSheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: 520,
      paddingBottom: 16,
    },
    iconPickerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 8,
    },
    iconPickerTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    iconPickerClose: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: colors.bg,
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
    iconPickerCellActive: { backgroundColor: colors.link + '1A' },
    // 编辑排列模式条目
    reorderWrap: { paddingHorizontal: 10 },
    reorderItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bg,
      borderRadius: 12,
      paddingVertical: 8,
      paddingHorizontal: 12,
      marginBottom: 8,
    },
    reorderIconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    reorderLabel: { flex: 1, fontSize: 13, color: colors.textPrimary, fontWeight: '600', marginLeft: 10 },
    reorderDeleteBadge: { marginRight: 10 },
    // 组内联添加
    inlineAddCard: { paddingHorizontal: 14, paddingBottom: 8 },
    inlineBtnRow: { flexDirection: 'row', marginTop: 12 },
    // 添加入口胶囊行：与记一笔选择类别页的 catAddTile 同观感（link 22% 圆底 + link 文字）
    inlineAddEntry: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'center',
      marginHorizontal: 14,
      marginBottom: 10,
      marginTop: 2,
      paddingVertical: 9,
      paddingHorizontal: 18,
      borderRadius: 18,
      backgroundColor: colors.link + '14',
      borderWidth: 1,
      borderColor: colors.link + '33',
    },
    inlineAddEntryText: { color: colors.link, fontSize: 13, fontWeight: '700', marginLeft: 6 },
    cancelBtn: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18, marginRight: 8 },
    cancelBtnText: { color: colors.textSecondary, fontSize: 14 },
    // 新增大分类
    newGroupCard: { marginTop: 4, padding: 14 },
    newCatTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 10 },
    newGroupEntry: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'center',
      paddingVertical: 9,
      paddingHorizontal: 18,
      borderRadius: 18,
      backgroundColor: colors.link + '14',
      borderWidth: 1,
      borderColor: colors.link + '33',
    },
    newGroupEntryText: { color: colors.link, fontSize: 14, fontWeight: '700', marginLeft: 6 },
    input: {
      backgroundColor: colors.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      padding: 10,
      fontSize: 14,
      color: colors.textPrimary,
      marginBottom: 12,
    },
    pickerLabel: { fontSize: 12, color: colors.textTertiary, marginBottom: 8 },
    pickerRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
    iconOption: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 6,
      marginBottom: 6,
    },
    iconOptionActive: { borderColor: colors.fabBg, borderWidth: 2 },
    colorOption: { width: 26, height: 26, borderRadius: 13, marginRight: 8, marginBottom: 6 },
    colorOptionActive: { borderWidth: 2, borderColor: colors.textPrimary },
    saveBtn: { backgroundColor: colors.fabBg, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
    saveBtnText: { color: colors.fabIcon, fontWeight: '700', fontSize: 14 },
  });
}
