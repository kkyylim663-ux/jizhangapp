// constants/uncategorized.ts
// 统一"未分类"账目的图标/颜色/名称，避免每个页面各写各的 fallback（之前到处都是
// help-outline 问号图标，看起来很敷衍）。哪个页面要显示未分类账目，就从这里引用。

export const UNCATEGORIZED_ICON = 'receipt-outline'; // Ionicons 里的简笔小票图标，代表"一笔没归类的账"
export const UNCATEGORIZED_NAME = '未分类';
export const UNCATEGORIZED_COLOR = '#9A9AA0'; // 中性灰，浅色/深色主题下都不会太突兀
