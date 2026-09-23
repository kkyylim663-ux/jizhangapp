// 分类显示名翻译层：内置分类的 id 是稳定英文 slug（food/salary...），直接当翻译 key 用；
// 用户自建分类没有 key，回退显示数据库里存的原文（不迁移存量数据，纯显示层翻译）。
import { Category } from '../types';
import { DEFAULT_CATEGORIES, EXPENSE_CATEGORY_GROUPS, INCOME_CATEGORY_GROUPS } from '../utils/defaultCategories';
import { TranslateFunction } from './index';

// 内置分类 id → 翻译 key（与 zh/en 字典里 cat.* 一一对应）
export const CATEGORY_I18N_KEYS: Record<string, string> = {
  food: 'cat.food',
  vegetable: 'cat.vegetable',
  fruit: 'cat.fruit',
  snack: 'cat.snack',
  tobacco_alcohol: 'cat.tobacco_alcohol',
  shopping: 'cat.shopping',
  daily: 'cat.daily',
  clothes: 'cat.clothes',
  beauty: 'cat.beauty',
  rent: 'cat.rent',
  home: 'cat.home',
  repair: 'cat.repair',
  kids: 'cat.kids',
  elders: 'cat.elders',
  pet: 'cat.pet',
  transport: 'cat.transport',
  car: 'cat.car',
  travel: 'cat.travel',
  entertainment: 'cat.entertainment',
  social: 'cat.social',
  medical: 'cat.medical',
  sport: 'cat.sport',
  books: 'cat.books',
  study: 'cat.study',
  office: 'cat.office',
  digital: 'cat.digital',
  gift: 'cat.gift',
  cash_gift: 'cat.cash_gift',
  other_expense: 'cat.other_expense',
  transfer_fee: 'cat.transfer_fee',
  communication: 'cat.communication',
  salary: 'cat.salary',
  parttime: 'cat.parttime',
  other_income: 'cat.other_income',
  investment: 'cat.investment',
  bonus: 'cat.bonus',
  red_packet: 'cat.red_packet',
  takeout: 'cat.takeout',
  drinks: 'cat.drinks',
  groceries: 'cat.groceries',
  utilities: 'cat.utilities',
  internet: 'cat.internet',
  appliance: 'cat.appliance',
  subway: 'cat.subway',
  movies: 'cat.movies',
  refuel: 'cat.refuel',
  medicine: 'cat.medicine',
  tuition: 'cat.tuition',
  insurance: 'cat.insurance',
  wedding: 'cat.wedding',
  birthday: 'cat.birthday',
  festival: 'cat.festival',
  refund: 'cat.refund',
  pension: 'cat.pension',
  allowance: 'cat.allowance',
  dividend: 'cat.dividend',
  rental_income: 'cat.rental_income',
  interest_income: 'cat.interest_income',
  year_end_bonus: 'cat.year_end_bonus',
  lottery: 'cat.lottery',
  commission: 'cat.commission',
  credit_repayment: 'cat.credit_repayment',
  loan_repayment: 'cat.loan_repayment',
  handling_fee: 'cat.handling_fee',
  interest_expense: 'cat.interest_expense',
  tax: 'cat.tax',
  investment_principal: 'cat.investment_principal',
  certificate: 'cat.certificate',
  fine: 'cat.fine',
  office_supplies: 'cat.office_supplies',
  business_meal: 'cat.business_meal',
  work_equipment: 'cat.work_equipment',
  business_trip: 'cat.business_trip',
  career_training: 'cat.career_training',
  business_expense: 'cat.business_expense',
  business_income: 'cat.business_income',
  sales_income: 'cat.sales_income',
  service_income: 'cat.service_income',
  project_income: 'cat.project_income',
  brokerage: 'cat.brokerage',
  secondhand_sale: 'cat.secondhand_sale',
  property_sale: 'cat.property_sale',
  vehicle_sale: 'cat.vehicle_sale',
  equipment_sale: 'cat.equipment_sale',
  other_asset_sale: 'cat.other_asset_sale',
  ecommerce_income: 'cat.ecommerce_income',
  livestream_income: 'cat.livestream_income',
  content_income: 'cat.content_income',
  ad_income: 'cat.ad_income',
  affiliate_income: 'cat.affiliate_income',
};

// 大分组名（存储的是中文字符串，含历史迁移产生的别名）→ 翻译 key
const GROUP_I18N_KEYS: Record<string, string> = {
  餐饮购物: 'group.food_shopping',
  生活居家: 'group.life_home',
  出行娱乐: 'group.travel_fun',
  健康学习: 'group.health_study',
  节日送礼: 'group.gift_social',
  送礼社交: 'group.gift_social',
  收入: 'group.income',
  经营收入: 'group.business',
  资产处置: 'group.asset_disposal',
  平台收入: 'group.platform',
  投资: 'group.investment',
  奖金: 'group.bonus',
};

/** 分类的显示名：内置分类按当前语言返回译文，用户自建分类回退存储的原文 */
export function getCategoryLabel(cat: Category, t: TranslateFunction): string {
  const key = CATEGORY_I18N_KEYS[cat.id];
  if (key) return t(key);
  return cat.name;
}

/** 分组名的显示翻译：固定分组集合按语言返回译文，用户自建分组回退原文 */
export function getGroupLabel(group: string, t: TranslateFunction): string {
  const key = GROUP_I18N_KEYS[group];
  if (key) return t(key);
  return group;
}

/**
 * 小票扫描的 AI 返回的中文分类名 → 内置分类 id。
 * AI 提示词固定中文，返回的 suggestedCategory 是中文名；用中文名→id 的映射做匹配，
 * 这样界面无论什么语言都能正确命中内置分类。
 */
export function findCategoryIdByChineseName(name: string): string | undefined {
  return (name && DEFAULT_CATEGORIES.find((c) => c.name === name)?.id) || undefined;
}