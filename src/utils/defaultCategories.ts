import { Category } from '../types';

// 支出分类的大类划分：选择类别页按这些组分节展示（顺序即展示顺序）
export const EXPENSE_CATEGORY_GROUPS = ['餐饮购物', '生活居家', '出行娱乐', '健康学习', '财务支出', '工作事业', '节日送礼'] as const;
// 收入分类的大组划分
export const INCOME_CATEGORY_GROUPS = ['收入', '经营收入', '资产处置', '平台收入', '投资', '奖金'] as const;

export const DEFAULT_CATEGORIES: Category[] = [
  // 支出分类（group = 选择类别页的大组）
  // 餐饮购物
  { id: 'food', name: '餐饮', icon: 'restaurant-outline', color: '#FF7A5C', type: 'expense', group: '餐饮购物' },
  { id: 'vegetable', name: '蔬菜', icon: 'leaf-outline', color: '#66BB6A', type: 'expense', group: '餐饮购物' },
  { id: 'fruit', name: '水果', icon: 'nutrition-outline', color: '#EF5350', type: 'expense', group: '餐饮购物' },
  { id: 'snack', name: '零食', icon: 'ice-cream-outline', color: '#EC407A', type: 'expense', group: '餐饮购物' },
  { id: 'tobacco_alcohol', name: '烟酒', icon: 'wine-outline', color: '#8E24AA', type: 'expense', group: '餐饮购物' },
  { id: 'shopping', name: '购物', icon: 'bag-handle-outline', color: '#B983FF', type: 'expense', group: '餐饮购物' },
  { id: 'daily', name: '日用', icon: 'basket-outline', color: '#8D9AAF', type: 'expense', group: '餐饮购物' },
  { id: 'takeout', name: '外卖', icon: 'fast-food-outline', color: '#FF8A65', type: 'expense', group: '餐饮购物' },
  { id: 'drinks', name: '奶茶', icon: 'cafe-outline', color: '#A1887F', type: 'expense', group: '餐饮购物' },
  { id: 'groceries', name: '食材', icon: 'cart-outline', color: '#8BC34A', type: 'expense', group: '餐饮购物' },
  // 生活居家
  { id: 'clothes', name: '服饰', icon: 'shirt-outline', color: '#FFA726', type: 'expense', group: '生活居家' },
  { id: 'beauty', name: '美容', icon: 'sparkles-outline', color: '#F06292', type: 'expense', group: '生活居家' },
  { id: 'rent', name: '住房', icon: 'home-outline', color: '#FF9F43', type: 'expense', group: '生活居家' },
  { id: 'home', name: '居家', icon: 'cube-outline', color: '#8D6E63', type: 'expense', group: '生活居家' },
  { id: 'repair', name: '维修', icon: 'construct-outline', color: '#78909C', type: 'expense', group: '生活居家' },
  { id: 'kids', name: '孩子', icon: 'happy-outline', color: '#FFCA28', type: 'expense', group: '生活居家' },
  { id: 'elders', name: '长辈', icon: 'people-outline', color: '#A1887F', type: 'expense', group: '生活居家' },
  { id: 'pet', name: '宠物', icon: 'paw-outline', color: '#8D6E63', type: 'expense', group: '生活居家' },
  { id: 'utilities', name: '水电', icon: 'flash-outline', color: '#FBC02D', type: 'expense', group: '生活居家' },
  { id: 'internet', name: '网络', icon: 'wifi-outline', color: '#4FC3F7', type: 'expense', group: '生活居家' },
  { id: 'appliance', name: '家电', icon: 'tv-outline', color: '#90A4AE', type: 'expense', group: '生活居家' },
  // 出行娱乐
  { id: 'transport', name: '交通', icon: 'bus-outline', color: '#4C9AFF', type: 'expense', group: '出行娱乐' },
  { id: 'car', name: '汽车', icon: 'car-outline', color: '#3949AB', type: 'expense', group: '出行娱乐' },
  { id: 'travel', name: '旅行', icon: 'airplane-outline', color: '#29B6F6', type: 'expense', group: '出行娱乐' },
  { id: 'entertainment', name: '娱乐', icon: 'game-controller-outline', color: '#AB47BC', type: 'expense', group: '出行娱乐' },
  { id: 'social', name: '社交', icon: 'chatbubbles-outline', color: '#5C6BC0', type: 'expense', group: '出行娱乐' },
  { id: 'subway', name: '公交', icon: 'train-outline', color: '#26C6DA', type: 'expense', group: '出行娱乐' },
  { id: 'movies', name: '电影', icon: 'film-outline', color: '#E91E63', type: 'expense', group: '出行娱乐' },
  { id: 'refuel', name: '加油', icon: 'speedometer-outline', color: '#FF7043', type: 'expense', group: '出行娱乐' },
  // 健康学习
  { id: 'medical', name: '医疗', icon: 'medkit-outline', color: '#66BB6A', type: 'expense', group: '健康学习' },
  { id: 'sport', name: '运动', icon: 'fitness-outline', color: '#26A69A', type: 'expense', group: '健康学习' },
  { id: 'books', name: '书籍', icon: 'book-outline', color: '#7E57C2', type: 'expense', group: '健康学习' },
  { id: 'study', name: '学习', icon: 'school-outline', color: '#26C6DA', type: 'expense', group: '健康学习' },
  { id: 'office', name: '办公', icon: 'briefcase-outline', color: '#607D8B', type: 'expense', group: '健康学习' },
  { id: 'digital', name: '数码', icon: 'hardware-chip-outline', color: '#546E7A', type: 'expense', group: '健康学习' },
  { id: 'medicine', name: '药品', icon: 'medical-outline', color: '#EC407A', type: 'expense', group: '健康学习' },
  { id: 'tuition', name: '学费', icon: 'library-outline', color: '#5C6BC0', type: 'expense', group: '健康学习' },
  { id: 'insurance', name: '保险', icon: 'shield-checkmark-outline', color: '#26A69A', type: 'expense', group: '健康学习' },
  // 财务支出
  { id: 'credit_repayment', name: '信用卡还款', icon: 'card-outline', color: '#5C6BC0', type: 'expense', group: '财务支出' },
  { id: 'loan_repayment', name: '贷款还款', icon: 'business-outline', color: '#3949AB', type: 'expense', group: '财务支出' },
  { id: 'handling_fee', name: '手续费', icon: 'swap-horizontal-outline', color: '#78909C', type: 'expense', group: '财务支出' },
  { id: 'interest_expense', name: '利息', icon: 'stats-chart-outline', color: '#7E57C2', type: 'expense', group: '财务支出' },
  { id: 'tax', name: '税费', icon: 'document-text-outline', color: '#8D6E63', type: 'expense', group: '财务支出' },
  { id: 'investment_principal', name: '投资本金', icon: 'trending-up-outline', color: '#1E88E5', type: 'expense', group: '财务支出' },
  { id: 'certificate', name: '证件办理', icon: 'clipboard-outline', color: '#26C6DA', type: 'expense', group: '财务支出' },
  { id: 'fine', name: '罚款', icon: 'alert-circle-outline', color: '#EF5350', type: 'expense', group: '财务支出' },
  // 工作事业
  { id: 'office_supplies', name: '办公用品', icon: 'build-outline', color: '#607D8B', type: 'expense', group: '工作事业' },
  { id: 'business_meal', name: '商务餐饮', icon: 'restaurant-outline', color: '#FF8A65', type: 'expense', group: '工作事业' },
  { id: 'work_equipment', name: '工作设备', icon: 'desktop-outline', color: '#546E7A', type: 'expense', group: '工作事业' },
  { id: 'business_trip', name: '出差', icon: 'airplane-outline', color: '#29B6F6', type: 'expense', group: '工作事业' },
  { id: 'career_training', name: '职业培训', icon: 'school-outline', color: '#26C6DA', type: 'expense', group: '工作事业' },
  { id: 'business_expense', name: '业务支出', icon: 'briefcase-outline', color: '#78909C', type: 'expense', group: '工作事业' },
  // 节日送礼
  { id: 'gift', name: '礼物', icon: 'gift-outline', color: '#F9A825', type: 'expense', group: '送礼社交' },
  { id: 'cash_gift', name: '礼金', icon: 'wallet-outline', color: '#E53935', type: 'expense', group: '送礼社交' },
  { id: 'wedding', name: '婚庆', icon: 'heart-outline', color: '#F06292', type: 'expense', group: '送礼社交' },
  { id: 'birthday', name: '生日', icon: 'balloon-outline', color: '#FFA726', type: 'expense', group: '送礼社交' },
  { id: 'festival', name: '节日', icon: 'sparkles-outline', color: '#BA68C8', type: 'expense', group: '送礼社交' },
  { id: 'other_expense', name: '其他', icon: 'ellipsis-horizontal-circle-outline', color: '#9E9E9E', type: 'expense', group: '送礼社交' },
  // 不分组（在选择类别页归入尾部"其他"节）
  { id: 'transfer_fee', name: '手续费', icon: 'swap-horizontal-outline', color: '#EF5350', type: 'expense' },
  // 通讯（默认分类里保留，但没有归入任何大类，同样落"其他"节）
  { id: 'communication', name: '通讯', icon: 'call-outline', color: '#42A5F5', type: 'expense' },

  // 收入分类（收入/投资/奖金 三大组）
  // 收入
  { id: 'salary', name: '工资', icon: 'cash-outline', color: '#43A047', type: 'income', group: '收入' },
  { id: 'parttime', name: '兼职', icon: 'time-outline', color: '#00897B', type: 'income', group: '收入' },
  { id: 'other_income', name: '其他收入', icon: 'add-circle-outline', color: '#7CB342', type: 'income', group: '收入' },
  { id: 'refund', name: '退款', icon: 'return-down-back-outline', color: '#66BB6A', type: 'income', group: '收入' },
  { id: 'pension', name: '退休金', icon: 'sunny-outline', color: '#FFB300', type: 'income', group: '收入' },
  { id: 'allowance', name: '零花钱', icon: 'gift-outline', color: '#8BC34A', type: 'income', group: '收入' },
  // 经营收入
  { id: 'business_income', name: '生意收入', icon: 'storefront-outline', color: '#43A047', type: 'income', group: '经营收入' },
  { id: 'sales_income', name: '销售收入', icon: 'cart-outline', color: '#00897B', type: 'income', group: '经营收入' },
  { id: 'service_income', name: '服务收入', icon: 'construct-outline', color: '#7CB342', type: 'income', group: '经营收入' },
  { id: 'project_income', name: '项目收入', icon: 'layers-outline', color: '#1E88E5', type: 'income', group: '经营收入' },
  { id: 'brokerage', name: '佣金', icon: 'ribbon-outline', color: '#F9A825', type: 'income', group: '经营收入' },
  // 资产处置
  { id: 'secondhand_sale', name: '二手物品出售', icon: 'pricetags-outline', color: '#8D6E63', type: 'income', group: '资产处置' },
  { id: 'property_sale', name: '房产出售', icon: 'home-outline', color: '#FF9F43', type: 'income', group: '资产处置' },
  { id: 'vehicle_sale', name: '车辆出售', icon: 'car-sport-outline', color: '#3949AB', type: 'income', group: '资产处置' },
  { id: 'equipment_sale', name: '设备出售', icon: 'hardware-chip-outline', color: '#546E7A', type: 'income', group: '资产处置' },
  { id: 'other_asset_sale', name: '其他资产出售', icon: 'albums-outline', color: '#9E9E9E', type: 'income', group: '资产处置' },
  // 平台收入
  { id: 'ecommerce_income', name: '电商', icon: 'storefront-outline', color: '#EC407A', type: 'income', group: '平台收入' },
  { id: 'livestream_income', name: '直播', icon: 'videocam-outline', color: '#AB47BC', type: 'income', group: '平台收入' },
  { id: 'content_income', name: '内容创作', icon: 'create-outline', color: '#5C6BC0', type: 'income', group: '平台收入' },
  { id: 'ad_income', name: '广告', icon: 'megaphone-outline', color: '#FFA726', type: 'income', group: '平台收入' },
  { id: 'affiliate_income', name: '联盟营销', icon: 'link-outline', color: '#26A69A', type: 'income', group: '平台收入' },
  // 投资
  { id: 'investment', name: '理财', icon: 'trending-up-outline', color: '#1E88E5', type: 'income', group: '投资' },
  { id: 'dividend', name: '股息', icon: 'pie-chart-outline', color: '#26C6DA', type: 'income', group: '投资' },
  { id: 'rental_income', name: '租金收入', icon: 'key-outline', color: '#4C9AFF', type: 'income', group: '投资' },
  { id: 'interest_income', name: '利息', icon: 'calculator-outline', color: '#7E57C2', type: 'income', group: '投资' },
  // 奖金
  { id: 'bonus', name: '奖金', icon: 'trophy-outline', color: '#F9A825', type: 'income', group: '奖金' },
  { id: 'year_end_bonus', name: '年终奖', icon: 'medal-outline', color: '#F4511E', type: 'income', group: '奖金' },
  { id: 'lottery', name: '中奖', icon: 'dice-outline', color: '#FF7043', type: 'income', group: '奖金' },
  { id: 'commission', name: '提成', icon: 'ribbon-outline', color: '#66BB6A', type: 'income', group: '奖金' },
  { id: 'red_packet', name: '红包', icon: 'pricetag-outline', color: '#E53935', type: 'income', group: '奖金' },
];
