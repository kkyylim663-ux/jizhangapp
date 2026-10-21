// useLayout.ts
// 版型分级钩子（计划 8.2 第 2 条）：只分 3 档宽 + 2 档高，不做等比缩放
// （等比缩放会让大屏变「巨字」、小屏变「蚂蚁字」；Apple / Android 官方做法都是尺寸分级 + 弹性布局）。
//
// 3 档宽（按窗口宽 dp）：
//   compact 窄   < 360     页边距 16 / 键高 48 / 类别 4 列 / Hero 34 / 行最小高 52
//   regular 常规 360–419   页边距 16 / 键高 56 / 类别 5 列 / Hero 40 / 行最小高 56
//   large   大   >= 420    页边距 20 / 键高 60 / 类别 5 列 / Hero 44 / 行最小高 56
// 2 档高：
//   矮屏 short —— 可用高（窗口高 − 顶部安全区 − 底部安全区）< 700：键高降到 48、Hero 字号 −4（叠加在宽度档上）
//   平板 / 折叠屏展开 —— 宽 >= 600：contentMaxWidth = 560，页面内容居中收窄
//
// 尺寸变化（分屏 / 折叠屏展开 / 改系统显示大小 / 旋转）必须实时跟着更新：
// 用 useWindowDimensions()（而不是 Dimensions.get，后者只在启动时取一次，不会随尺寸变化重渲染）。
//
// ==== 4 档尺寸的输出示例 ====
//
// 1) 360×640（低端安卓 / 「显示大小」调到最大）
//    安全区 top 24、bottom 0 → 可用高 616 < 700 → 矮屏叠加生效
//    { width: 360, height: 640, size: 'regular', isShort: true, isTablet: false,
//      pagePadding: 16, keypadKeyHeight: 48, categoryColumns: 5,
//      heroAmountFontSize: 36, rowMinHeight: 56, contentMaxWidth: undefined }
//
// 2) 390×844（iPhone 14 / 常见安卓常规机型）
//    安全区 top 47、bottom 34 → 可用高 763 >= 700 → 非矮屏
//    { width: 390, height: 844, size: 'regular', isShort: false, isTablet: false,
//      pagePadding: 16, keypadKeyHeight: 56, categoryColumns: 5,
//      heroAmountFontSize: 40, rowMinHeight: 56, contentMaxWidth: undefined }
//
// 3) 430×932（iPhone Pro Max / 大屏安卓）
//    安全区 top 59、bottom 34 → 可用高 839 >= 700 → 非矮屏
//    { width: 430, height: 932, size: 'large', isShort: false, isTablet: false,
//      pagePadding: 20, keypadKeyHeight: 60, categoryColumns: 5,
//      heroAmountFontSize: 44, rowMinHeight: 56, contentMaxWidth: undefined }
//
// 4) 平板 768×1024（iPad / 折叠屏展开）
//    安全区 top 24、bottom 20 → 可用高 980 >= 700 → 非矮屏；宽 768 >= 600 → 平板
//    { width: 768, height: 1024, size: 'large', isShort: false, isTablet: true,
//      pagePadding: 20, keypadKeyHeight: 60, categoryColumns: 5,
//      heroAmountFontSize: 44, rowMinHeight: 56, contentMaxWidth: 560 }

import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** 宽度档位（矮屏 / 平板是叠加标记，不单独成档） */
export type LayoutSize = 'compact' | 'regular' | 'large';

/** useLayout() 的返回：当前设备档位与尺寸令牌 */
export interface LayoutTokens {
  /** 窗口宽（dp） */
  width: number;
  /** 窗口高（dp） */
  height: number;
  /** 宽度档位 */
  size: LayoutSize;
  /** 矮屏：可用高（窗口高 − 上下安全区）< 700 */
  isShort: boolean;
  /** 平板 / 折叠屏展开：窗口宽 >= 600 */
  isTablet: boolean;
  /** 页面左右边距 */
  pagePadding: number;
  /** 数字键盘键高 */
  keypadKeyHeight: number;
  /** 类别选择区列数 */
  categoryColumns: number;
  /** 记一笔 Hero 金额字号 */
  heroAmountFontSize: number;
  /** 列表行最小高度 */
  rowMinHeight: number;
  /** 平板内容最大宽（非平板为 undefined，表示不限制） */
  contentMaxWidth: number | undefined;
}

/** 窄屏上界：宽 < 360 为 compact */
const COMPACT_MAX_WIDTH = 360;
/** 大屏下界：宽 >= 420 为 large */
const LARGE_MIN_WIDTH = 420;
/** 平板 / 折叠屏展开下界 */
const TABLET_MIN_WIDTH = 600;
/** 矮屏判定下界：可用高 < 700 叠加矮屏档 */
const SHORT_MAX_HEIGHT = 700;
/** 平板内容最大宽（居中收窄） */
const TABLET_CONTENT_MAX_WIDTH = 560;
/** 矮屏叠加：键高固定降到 48 */
const SHORT_KEYPAD_KEY_HEIGHT = 48;
/** 矮屏叠加：Hero 金额字号下调量 */
const SHORT_HERO_FONT_REDUCTION = 4;

/** 三档宽度的尺寸令牌（矮屏叠加在计算结果上再修正） */
const WIDTH_TIERS: Record<
  LayoutSize,
  Pick<
    LayoutTokens,
    'pagePadding' | 'keypadKeyHeight' | 'categoryColumns' | 'heroAmountFontSize' | 'rowMinHeight'
  >
> = {
  compact: {
    pagePadding: 16,
    keypadKeyHeight: 48,
    categoryColumns: 4,
    heroAmountFontSize: 34,
    rowMinHeight: 52,
  },
  regular: {
    pagePadding: 16,
    keypadKeyHeight: 56,
    categoryColumns: 5,
    heroAmountFontSize: 40,
    rowMinHeight: 56,
  },
  large: {
    pagePadding: 20,
    keypadKeyHeight: 60,
    categoryColumns: 5,
    heroAmountFontSize: 44,
    rowMinHeight: 56,
  },
};

/**
 * 当前设备版型与尺寸令牌。
 * 尺寸变化（分屏 / 折叠屏 / 改显示大小 / 旋转）会自动重算。
 */
export function useLayout(): LayoutTokens {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const insetTop = insets.top;
  const insetBottom = insets.bottom;

  return useMemo<LayoutTokens>(() => {
    const size: LayoutSize =
      width < COMPACT_MAX_WIDTH ? 'compact' : width >= LARGE_MIN_WIDTH ? 'large' : 'regular';
    const tier = WIDTH_TIERS[size];

    // 可用高 = 窗口高 − 顶部安全区 − 底部安全区（三键导航 / 手势条高度不同，必须实测）
    const availableHeight = height - insetTop - insetBottom;
    const isShort = availableHeight < SHORT_MAX_HEIGHT;
    const isTablet = width >= TABLET_MIN_WIDTH;

    return {
      width,
      height,
      size,
      isShort,
      isTablet,
      pagePadding: tier.pagePadding,
      keypadKeyHeight: isShort ? SHORT_KEYPAD_KEY_HEIGHT : tier.keypadKeyHeight,
      categoryColumns: tier.categoryColumns,
      heroAmountFontSize: isShort
        ? tier.heroAmountFontSize - SHORT_HERO_FONT_REDUCTION
        : tier.heroAmountFontSize,
      rowMinHeight: tier.rowMinHeight,
      contentMaxWidth: isTablet ? TABLET_CONTENT_MAX_WIDTH : undefined,
    };
  }, [width, height, insetTop, insetBottom]);
}
