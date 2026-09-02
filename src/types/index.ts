export type TransactionType = 'expense' | 'income' | 'transfer';

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: 'expense' | 'income';
}

export interface Transaction {
  id: string;
  amount: number;
  categoryId: string;
  type: TransactionType;
  date: string;
  note: string;
  // 没有分类时用来当标题显示的名字（比如计划付款的"房租"）。
  // 跟 note 分开存，这样列表标题和备注不会挤成一句话、也不用互相判断该不该重复显示。
  displayName?: string;
  createdAt: number;
  ledgerId: string;
  assetId?: string;
  receiptUri?: string;
  fromAssetId?: string;
  toAssetId?: string;
  exchangeRate?: number;
  convertedAmount?: number;
  fee?: number;
}

export interface Budget {
  categoryId: string;
  amount: number;
}

export interface Ledger {
  id: string;
  name: string;
  icon: string;
  color?: string;
  createdAt: number;
}

export type PeriodType = 'day' | 'week' | 'month' | 'year' | 'custom';

export interface PeriodPreference {
  type: PeriodType;
  customStart?: string;
  customEnd?: string;
}

// 记账设定：日期显示格式
export type DateFormat = 'YYYY/MM/DD' | 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY';

// 记账设定：一周的第一天，0 = 星期日，1 = 星期一
export type WeekStartsOn = 0 | 1;

// 记账设定：金额小数位数
export type DecimalPlaces = 0 | 1 | 2;

export type AssetType = 'cash' | 'bank' | 'credit' | 'ewallet' | 'investment' | 'other';

export interface Asset {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: AssetType;
  currency: string;
  initialBalance: number;
  ledgerId: string;
  createdAt: number;
  // 以下字段仅信用卡类型使用
  creditLimit?: number; // 额度
  statementDay?: number; // 账单日，1-28
  dueDay?: number; // 还款日，1-28（若小于等于账单日，视为下个月的这一天）
  interestRate?: number; // 年利率(%)，逾期未还时用于估算利息
  // 默认账户：记一笔时自动带出这个账户。同一时间最多一个资产是默认（由 setDefaultAsset 保证）
  isDefault?: boolean;
}

// 计划付款的周期性：一次性 / 每月 / 每年
export type PlannedPaymentRecurrence = 'once' | 'monthly' | 'yearly';

// 计划付款：即将到期、还没实际记账的账目（房租、车贷、订阅等固定支出）
export interface PlannedPayment {
  id: string;
  name: string;
  categoryId?: string; // 类型，复用支出分类
  amount: number;
  assetId?: string; // 从哪个资产账户出账（选填）
  dueDate: string; // YYYY-MM-DD
  recurrence: PlannedPaymentRecurrence;
  autoDeduct: boolean; // 是否到期自动扣账
  note?: string;
  ledgerId: string;
  createdAt: number;
  isPaid: boolean;
}
