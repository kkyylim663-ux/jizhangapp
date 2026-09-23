import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Transaction,
  Category,
  Budget,
  Ledger,
  PeriodPreference,
  Asset,
  AssetType,
  CategoryGroup,
  DateFormat,
  WeekStartsOn,
  DecimalPlaces,
  PaymentPlan,
} from '../types';
import { DEFAULT_CATEGORIES } from '../utils/defaultCategories';
import { getCurrencySymbol } from '../utils/currencies';
import { computePlanOccurrences } from '../utils/paymentPlans';
import { onLocalDataReplaced, schedulePush } from '../services/syncService';

const STORAGE_KEYS = {
  transactions: '@jizhang/transactions',
  categories: '@jizhang/categories',
  categoryGroups: '@jizhang/categoryGroups',
  budgets: '@jizhang/budgets',
  ledgers: '@jizhang/ledgers',
  activeLedgerId: '@jizhang/activeLedgerId',
  currency: '@jizhang/currency',
  periodPreference: '@jizhang/periodPreference',
  assets: '@jizhang/assets',
  dateFormat: '@jizhang/dateFormat',
  weekStartsOn: '@jizhang/weekStartsOn',
  decimalPlaces: '@jizhang/decimalPlaces',
  paymentPlans: '@jizhang/paymentPlans',
};

const DEFAULT_LEDGER: Ledger = { id: 'default', name: '默认账本', icon: 'book-outline', color: '#4C9AFF', createdAt: Date.now() };
const DEFAULT_PERIOD: PeriodPreference = { type: 'month' };
const DEFAULT_DATE_FORMAT: DateFormat = 'YYYY/MM/DD';
const DEFAULT_WEEK_STARTS_ON: WeekStartsOn = 1;
const DEFAULT_DECIMAL_PLACES: DecimalPlaces = 2;
const FEE_CATEGORY_ID = 'transfer_fee';

function isLegacyIconValue(icon: string | undefined | null): boolean {
  if (!icon) return true;
  if (!/^[a-z0-9-]+$/.test(icon)) return true;
  // 历史上写进本地数据的非法 Ionicons 图标名（渲染时会刷 Console Warning），按 id 映射回默认表
  return icon === 'pills-outline' || icon === 'gas-pump-outline';
}

function migrateCategoryIcons(stored: Category[]): { result: Category[]; changed: boolean } {
  let changed = false;
  const result = stored.map((c) => {
    if (isLegacyIconValue(c.icon)) {
      changed = true;
      const fresh = DEFAULT_CATEGORIES.find((d) => d.id === c.id);
      return { ...c, icon: fresh?.icon ?? 'help-outline' };
    }
    return c;
  });
  return { result, changed };
}

// 大类分组迁移：老数据里的默认分类没有 group 字段，按 id 从默认表补上，
// 用户自建/未知分类不补（在选择类别页自然落"其他"节）
// 大组改名映射：老数据里的旧组名自动改成新组名（含用户自建的分类）
const GROUP_RENAMES: Record<string, string> = { '人情其他': '节日送礼' };

function migrateCategoryGroups(stored: Category[]): { result: Category[]; changed: boolean } {
  let changed = false;
  const result = stored.map((c) => {
    if (c.group) {
      const renamed = GROUP_RENAMES[c.group];
      if (renamed && renamed !== c.group) {
        changed = true;
        return { ...c, group: renamed };
      }
      return c;
    }
    const fresh = DEFAULT_CATEGORIES.find((d) => d.id === c.id);
    if (fresh?.group) {
      changed = true;
      return { ...c, group: fresh.group };
    }
    return c;
  });
  return { result, changed };
}

// 增量补齐新增的默认分类：老用户本地存的是旧版分类列表，App 升级后在
// defaultCategories.ts 里新加的默认分类不会自动出现——这里按 id 把本地缺的
// 默认分类补进列表尾部。用户删过的默认分类也会被补回来（作为"恢复默认"行为，
// 与手续费分类 FEE_CATEGORY_ID 已有的补齐逻辑一致）；用户自建分类不受影响。
function mergeNewDefaultCategories(stored: Category[]): { result: Category[]; changed: boolean } {
  const missing = DEFAULT_CATEGORIES.filter((d) => !stored.some((c) => c.id === d.id));
  if (missing.length === 0) return { result: stored, changed: false };
  return { result: [...stored, ...missing], changed: true };
}

const ASSET_TYPE_FALLBACK_ICON: Record<AssetType, string> = {
  cash: 'cash-outline',
  bank: 'card-outline',
  credit: 'wallet-outline',
  ewallet: 'phone-portrait-outline',
  investment: 'trending-up-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

function migrateAssetIcons(stored: Asset[]): { result: Asset[]; changed: boolean } {
  let changed = false;
  const result = stored.map((a) => {
    if (isLegacyIconValue(a.icon)) {
      changed = true;
      return { ...a, icon: ASSET_TYPE_FALLBACK_ICON[a.type] ?? 'help-outline' };
    }
    return a;
  });
  return { result, changed };
}

// 老账本数据可能还是 emoji 图标（比如默认账本以前的 '📒'），迁移成线框图标名
function migrateLedgerIcons(stored: Ledger[]): { result: Ledger[]; changed: boolean } {
  let changed = false;
  const result = stored.map((l) => {
    if (isLegacyIconValue(l.icon)) {
      changed = true;
      return { ...l, icon: l.id === DEFAULT_LEDGER.id ? DEFAULT_LEDGER.icon : 'book-outline' };
    }
    return l;
  });
  return { result, changed };
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface AppContextValue {
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  ledgers: Ledger[];
  activeLedgerId: string;
  currency: string;
  currencySymbol: string;
  periodPreference: PeriodPreference;
  assets: Asset[];
  dateFormat: DateFormat;
  weekStartsOn: WeekStartsOn;
  decimalPlaces: DecimalPlaces;
  loading: boolean;
  addTransaction: (t: {
    amount: number;
    categoryId: string;
    type: 'expense' | 'income';
    date: string;
    note: string;
    assetId?: string;
    receiptUri?: string;
  }) => Promise<void>;
  updateTransaction: (
    id: string,
    updates: Partial<Omit<Transaction, 'id' | 'createdAt' | 'ledgerId'>>
  ) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  addCategory: (c: Omit<Category, 'id'>) => Promise<Category>;
  addCategoryGroup: (g: CategoryGroup) => Promise<void>;
  deleteCategoryGroup: (name: string) => Promise<void>;
  categoryGroups: CategoryGroup[];
  updateCategory: (id: string, updates: Partial<Omit<Category, 'id'>>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  setBudget: (categoryId: string, amount: number, currency?: string) => Promise<void>;
  getCategoryById: (id: string) => Category | undefined;
  addLedger: (name: string, icon: string, color?: string) => Promise<void>;
  renameLedger: (id: string, name: string) => Promise<void>;
  deleteLedger: (id: string) => Promise<void>;
  setActiveLedgerId: (id: string) => Promise<void>;
  setCurrency: (code: string) => Promise<void>;
  setPeriodPreference: (p: PeriodPreference) => Promise<void>;
  setDateFormat: (f: DateFormat) => Promise<void>;
  setWeekStartsOn: (d: WeekStartsOn) => Promise<void>;
  setDecimalPlaces: (n: DecimalPlaces) => Promise<void>;
  /** 财务规划:计划付款 CRUD(存储/云同步/自动扣账游标都由 AppContext 管理) */
  paymentPlans: PaymentPlan[];
  addPaymentPlan: (p: Omit<PaymentPlan, 'id' | 'createdAt' | 'lastProcessedDate'>) => Promise<void>;
  updatePaymentPlan: (id: string, updates: Partial<Omit<PaymentPlan, 'id' | 'ledgerId' | 'createdAt'>>) => Promise<void>;
  deletePaymentPlan: (id: string) => Promise<void>;
  addAsset: (a: {
    name: string;
    icon: string;
    color: string;
    type: AssetType;
    currency: string;
    initialBalance: number;
    creditLimit?: number;
    statementDay?: number;
    dueDay?: number;
    interestRate?: number;
  }) => Promise<void>;
  updateAsset: (id: string, updates: Partial<Omit<Asset, 'id' | 'createdAt' | 'ledgerId'>>) => Promise<void>;
  deleteAsset: (id: string) => Promise<void>;
  getAssetById: (id: string) => Asset | undefined;
  getAssetBalance: (assetId: string) => number;
  // 把某个资产设为默认（记一笔时自动带出）；传 null 表示"不要任何默认账户"。
  // 同一时间只能有一个默认，设置新的会自动把其它资产的 isDefault 清掉，不用调用方自己处理。
  setDefaultAsset: (id: string | null) => Promise<void>;
  addTransfer: (p: {
    fromAssetId: string;
    toAssetId: string;
    amount: number;
    exchangeRate: number;
    fee: number;
    date: string;
    note: string;
    receiptUri?: string;
  }) => Promise<void>;
  /** 重新从 AsyncStorage 读取全部本地数据（云同步写回后自动调用；也可手动刷新） */
  reloadFromStorage: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([DEFAULT_LEDGER]);
  // 同步 ledgers 最新值的 ref：deleteLedger 在同一帧内做「删除+回落」时读最新列表
  const ledgersRef = useRef<Ledger[]>([DEFAULT_LEDGER]);
  useEffect(() => {
    ledgersRef.current = ledgers;
  }, [ledgers]);
  const [activeLedgerId, setActiveLedgerIdState] = useState<string>(DEFAULT_LEDGER.id);
  const [currency, setCurrencyState] = useState<string>('MYR'); // 默认货币：RM（马来西亚林吉特）
  const [periodPreference, setPeriodPreferenceState] = useState<PeriodPreference>(DEFAULT_PERIOD);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
  const [dateFormat, setDateFormatState] = useState<DateFormat>(DEFAULT_DATE_FORMAT);
  const [weekStartsOn, setWeekStartsOnState] = useState<WeekStartsOn>(DEFAULT_WEEK_STARTS_ON);
  const [decimalPlaces, setDecimalPlacesState] = useState<DecimalPlaces>(DEFAULT_DECIMAL_PLACES);
  const [paymentPlans, setPaymentPlans] = useState<PaymentPlan[]>([]);
  const [loading, setLoading] = useState(true);

  // 启动时读取本地数据；抽成函数是因为云同步把"云端合并结果"写回 AsyncStorage 后
  // 会回调 onLocalDataReplaced → loadFromStorage，把恢复/换机登录拉回来的数据刷进内存 state
  const loadFromStorage = useCallback(async () => {
    await (async () => {
      try {
        const [
          txRaw,
          catRaw,
          catGroupRaw,
          budRaw,
          ledRaw,
          activeLedRaw,
          currRaw,
          periodRaw,
          assetRaw,
          dateFormatRaw,
          weekStartsOnRaw,
          decimalPlacesRaw,
          planRaw,
        ] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.transactions),
          AsyncStorage.getItem(STORAGE_KEYS.categories),
          AsyncStorage.getItem(STORAGE_KEYS.categoryGroups),
          AsyncStorage.getItem(STORAGE_KEYS.budgets),
          AsyncStorage.getItem(STORAGE_KEYS.ledgers),
          AsyncStorage.getItem(STORAGE_KEYS.activeLedgerId),
          AsyncStorage.getItem(STORAGE_KEYS.currency),
          AsyncStorage.getItem(STORAGE_KEYS.periodPreference),
          AsyncStorage.getItem(STORAGE_KEYS.assets),
          AsyncStorage.getItem(STORAGE_KEYS.dateFormat),
          AsyncStorage.getItem(STORAGE_KEYS.weekStartsOn),
          AsyncStorage.getItem(STORAGE_KEYS.decimalPlaces),
          AsyncStorage.getItem(STORAGE_KEYS.paymentPlans),
        ]);
        if (txRaw) {
          const parsedTx: Transaction[] = JSON.parse(txRaw);
          setTransactions(parsedTx.map((t) => (t.ledgerId ? t : { ...t, ledgerId: DEFAULT_LEDGER.id })));
        }
        if (catRaw) {
          const parsedCat: Category[] = JSON.parse(catRaw);
          const hasFee = parsedCat.some((c) => c.id === FEE_CATEGORY_ID);
          const withFee = hasFee ? parsedCat : [...parsedCat, DEFAULT_CATEGORIES.find((c) => c.id === FEE_CATEGORY_ID)!];
          const { result: iconMigrated, changed: iconChanged } = migrateCategoryIcons(withFee);
          const { result: groupMigrated, changed: groupChanged } = migrateCategoryGroups(iconMigrated);
          const { result: migratedCat, changed: mergedNew } = mergeNewDefaultCategories(groupMigrated);
          setCategories(migratedCat);
          if (iconChanged || groupChanged || mergedNew) {
            AsyncStorage.setItem(STORAGE_KEYS.categories, JSON.stringify(migratedCat));
          }
        }
        if (catGroupRaw) {
          const parsedGroups: CategoryGroup[] = JSON.parse(catGroupRaw);
          if (Array.isArray(parsedGroups)) setCategoryGroups(parsedGroups);
        }
        if (budRaw) setBudgets(JSON.parse(budRaw));
        if (ledRaw) {
          const parsedLed: Ledger[] = JSON.parse(ledRaw);
          const { result: migratedLed, changed: ledChanged } = migrateLedgerIcons(parsedLed);
          setLedgers(migratedLed);
          if (ledChanged) {
            AsyncStorage.setItem(STORAGE_KEYS.ledgers, JSON.stringify(migratedLed));
          }
        }
        if (activeLedRaw) setActiveLedgerIdState(activeLedRaw);
        if (currRaw) setCurrencyState(currRaw);
        if (periodRaw) setPeriodPreferenceState(JSON.parse(periodRaw));
        if (assetRaw) {
          const parsedAsset: Asset[] = JSON.parse(assetRaw);
          const { result: migratedAsset, changed: assetChanged } = migrateAssetIcons(parsedAsset);
          setAssets(migratedAsset);
          if (assetChanged) {
            AsyncStorage.setItem(STORAGE_KEYS.assets, JSON.stringify(migratedAsset));
          }
        }
        if (dateFormatRaw) setDateFormatState(dateFormatRaw as DateFormat);
        if (weekStartsOnRaw) setWeekStartsOnState(Number(weekStartsOnRaw) as WeekStartsOn);
        if (decimalPlacesRaw) setDecimalPlacesState(Number(decimalPlacesRaw) as DecimalPlaces);
        if (planRaw) setPaymentPlans(JSON.parse(planRaw));
      } catch (e) {
        console.warn('读取本地数据失败', e);
      }
    })();
  }, []);

  // 首次加载完成前 loading=true，压住所有"state 一变就写 AsyncStorage"的副作用
  useEffect(() => {
    void loadFromStorage().finally(() => setLoading(false));
  }, [loadFromStorage]);

  // ── 云同步挂钩 ──────────────────────────────────────────────
  // 1) 本地任一数据变化 → 防抖推送到云端（未登录时 syncService 内部直接跳过，行为同纯本地）
  useEffect(() => {
    if (loading) return;
    schedulePush();
  }, [
    transactions,
    categories,
    categoryGroups,
    budgets,
    ledgers,
    activeLedgerId,
    currency,
    periodPreference,
    assets,
    dateFormat,
    weekStartsOn,
    decimalPlaces,
    paymentPlans,
    loading,
  ]);

  // 2) 云同步合并结果写回本地后 → 重新加载进内存（登录恢复 / 换新手机登录恢复资料）
  useEffect(() => {
    return onLocalDataReplaced(() => {
      void loadFromStorage();
    });
  }, [loadFromStorage]);

  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.transactions, JSON.stringify(transactions));
  }, [transactions, loading]);
  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.categories, JSON.stringify(categories));
  }, [categories, loading]);
  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.categoryGroups, JSON.stringify(categoryGroups));
  }, [categoryGroups, loading]);
  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.budgets, JSON.stringify(budgets));
  }, [budgets, loading]);
  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.ledgers, JSON.stringify(ledgers));
  }, [ledgers, loading]);
  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.activeLedgerId, activeLedgerId);
  }, [activeLedgerId, loading]);
  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.currency, currency);
  }, [currency, loading]);
  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.periodPreference, JSON.stringify(periodPreference));
  }, [periodPreference, loading]);
  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.assets, JSON.stringify(assets));
  }, [assets, loading]);
  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.dateFormat, dateFormat);
  }, [dateFormat, loading]);
  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.weekStartsOn, String(weekStartsOn));
  }, [weekStartsOn, loading]);
  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.decimalPlaces, String(decimalPlaces));
  }, [decimalPlaces, loading]);
  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.paymentPlans, JSON.stringify(paymentPlans));
  }, [paymentPlans, loading]);

  const addTransaction: AppContextValue['addTransaction'] = async (t) => {
    const newTx: Transaction = {
      ...t,
      id: genId(),
      createdAt: Date.now(),
      ledgerId: activeLedgerId,
    };
    setTransactions((prev) => [newTx, ...prev]);
  };

  const updateTransaction: AppContextValue['updateTransaction'] = async (id, updates) => {
    setTransactions((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  };

  const deleteTransaction: AppContextValue['deleteTransaction'] = async (id) => {
    setTransactions((prev) => prev.filter((item) => (item.id !== id)));
  };

  const addCategory: AppContextValue['addCategory'] = async (c) => {
    const created: Category = { ...c, id: genId() };
    setCategories((prev) => [...prev, created]);
    return created;
  };

  // 更新分类（当前只用于编辑模式里拖拽换大类）：按 id 合并更新，其余字段不动
  const updateCategory: AppContextValue['updateCategory'] = async (id, updates) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  };

  const addCategoryGroup: AppContextValue['addCategoryGroup'] = async (g) => {
    setCategoryGroups((prev) => (prev.some((x) => x.name === g.name) ? prev : [...prev, g]));
  };

  // 删除自定义大类：组内分类的 group 字段保留不动（它们会自动归入选择页的"其他"节）
  const deleteCategoryGroup: AppContextValue['deleteCategoryGroup'] = async (name) => {
    setCategoryGroups((prev) => prev.filter((g) => g.name !== name));
  };

  const deleteCategory: AppContextValue['deleteCategory'] = async (id) => {
    setCategories((prev) => prev.filter((item) => item.id !== id));
  };

  const setBudget: AppContextValue['setBudget'] = async (categoryId, amount, currency) => {
    // amount <= 0 = 清除该条预算；同一 categoryId 可以按币种各存一条（总预算多币种各设各的）
    setBudgets((prev) => {
      if (amount <= 0) return prev.filter((b) => !(b.categoryId === categoryId && b.currency === currency));
      const exists = prev.find((b) => b.categoryId === categoryId && b.currency === currency);
      if (exists) return prev.map((b) => (b === exists ? { ...b, amount } : b));
      return [...prev, { categoryId, amount, currency }];
    });
  };

  const getCategoryById = (id: string) => categories.find((c) => c.id === id);

  const addLedger: AppContextValue['addLedger'] = async (name, icon, color) => {
    setLedgers((prev) => [...prev, { id: genId(), name, icon, color: color ?? '#4C9AFF', createdAt: Date.now() }]);
  };

  const renameLedger: AppContextValue['renameLedger'] = async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLedgers((prev) => prev.map((l) => (l.id === id ? { ...l, name: trimmed } : l)));
  };

  const deleteLedger: AppContextValue['deleteLedger'] = async (id) => {
    // 用户定版：默认账本也可删除（其数据一并清除），但至少要留一个账本。
    // 删的是当前账本时回落：优先回落到剩下的第一个账本，一个都没有则回落 'default'
    // （'default' 是运行时兜底账本，不在 ledgers 数组里也会正常显示/工作）。
    const remaining = ledgersRef.current.filter((l) => l.id !== id);
    setActiveLedgerIdState((prevActive) =>
      prevActive === id ? (remaining[0]?.id ?? DEFAULT_LEDGER.id) : prevActive
    );
    // 级联删除：账本名下的交易/资产/缴费计划一并清除（用户定版：删除即连同数据删除，
    // 不留孤儿数据）。云同步按快照 diff 自动删除对应云端行。
    setTransactions((prev) => prev.filter((t) => t.ledgerId !== id));
    setAssets((prev) => prev.filter((a) => a.ledgerId !== id));
    setPaymentPlans((prev) => prev.filter((p) => p.ledgerId !== id));
    setLedgers((prev) => prev.filter((l) => l.id !== id));
  };

  const setActiveLedgerId: AppContextValue['setActiveLedgerId'] = async (id) => {
    setActiveLedgerIdState(id);
    // MRU：记录最近使用时间，账本弹层按它把最常用的排到最上面
    setLedgers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, lastUsedAt: Date.now() } : l))
    );
  };

  const setCurrency: AppContextValue['setCurrency'] = async (code) => {
    setCurrencyState(code);
  };

  const setPeriodPreference: AppContextValue['setPeriodPreference'] = async (p) => {
    setPeriodPreferenceState(p);
  };

  const setDateFormat: AppContextValue['setDateFormat'] = async (f) => {
    setDateFormatState(f);
  };

  const setWeekStartsOn: AppContextValue['setWeekStartsOn'] = async (d) => {
    setWeekStartsOnState(d);
  };

  const setDecimalPlaces: AppContextValue['setDecimalPlaces'] = async (n) => {
    setDecimalPlacesState(n);
  };

  const addAsset: AppContextValue['addAsset'] = async (a) => {
    const newAsset: Asset = { ...a, id: genId(), ledgerId: activeLedgerId, createdAt: Date.now() };
    setAssets((prev) => [...prev, newAsset]);
  };

  const updateAsset: AppContextValue['updateAsset'] = async (id, updates) => {
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)));
  };

  const deleteAsset: AppContextValue['deleteAsset'] = async (id) => {
    setAssets((prev) => prev.filter((a) => a.id !== id));
  };

  const getAssetById = (id: string) => assets.find((a) => a.id === id);

  const setDefaultAsset: AppContextValue['setDefaultAsset'] = async (id) => {
    setAssets((prev) => prev.map((a) => ({ ...a, isDefault: id !== null && a.id === id })));
  };

  const getAssetBalance: AppContextValue['getAssetBalance'] = (assetId) => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return 0;
    let balance = asset.initialBalance;
    transactions.forEach((t) => {
      if (t.type === 'transfer') {
        if (t.fromAssetId === assetId) balance -= t.amount + (t.fee ?? 0);
        if (t.toAssetId === assetId) balance += t.convertedAmount ?? t.amount;
        return;
      }
      if (t.assetId !== assetId) return;
      if (t.type === 'income') balance += t.amount;
      if (t.type === 'expense') balance -= t.amount;
    });
    return balance;
  };

  const addTransfer: AppContextValue['addTransfer'] = async ({
    fromAssetId,
    toAssetId,
    amount,
    exchangeRate,
    fee,
    date,
    note,
    receiptUri,
  }) => {
    const convertedAmount = amount * exchangeRate;
    const transferTx: Transaction = {
      id: genId(),
      amount,
      categoryId: '',
      type: 'transfer',
      date,
      note,
      createdAt: Date.now(),
      ledgerId: activeLedgerId,
      fromAssetId,
      toAssetId,
      exchangeRate,
      convertedAmount,
      fee,
      receiptUri,
    };
    const newTxs = [transferTx];

    if (fee > 0) {
      const fromAsset = assets.find((a) => a.id === fromAssetId);
      newTxs.push({
        id: genId(),
        amount: fee,
        categoryId: FEE_CATEGORY_ID,
        type: 'expense',
        date,
        note: `转账手续费${fromAsset ? `（${fromAsset.name}）` : ''}`,
        createdAt: Date.now() + 1,
        ledgerId: activeLedgerId,
      });
    }

    setTransactions((prev) => [...newTxs, ...prev]);
  };

  // ── 财务规划:计划付款 CRUD ──
  const addPaymentPlan: AppContextValue['addPaymentPlan'] = async (p) => {
    const plan: PaymentPlan = { ...p, id: genId(), createdAt: Date.now() };
    setPaymentPlans((prev) => [...prev, plan]);
  };

  const updatePaymentPlan: AppContextValue['updatePaymentPlan'] = async (id, updates) => {
    setPaymentPlans((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const deletePaymentPlan: AppContextValue['deletePaymentPlan'] = async (id) => {
    setPaymentPlans((prev) => prev.filter((p) => p.id !== id));
  };

  // ── 自动扣账引擎(启动补账):对每个到期的计划逐期生成交易并推进游标 ──
  // 数据加载完成后跑一次;云同步写回数据(loadFromStorage)后也会再跑一次,
  // 保证换机恢复/多设备登录后同样把缺的期数补上。上限 24 期在引擎内控制。
  const processedPlansRef = useRef<string>('');
  useEffect(() => {
    if (loading) return;
    const fingerprint = JSON.stringify(paymentPlans) + activeLedgerId;
    if (processedPlansRef.current === fingerprint) return;
    processedPlansRef.current = fingerprint;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const plans = paymentPlans.filter((p) => p.ledgerId === activeLedgerId);
    if (plans.length === 0) return;

    const newTxs: Transaction[] = [];
    const planUpdates: { id: string; lastProcessedDate: string }[] = [];
    plans.forEach((plan) => {
      const { dueDates, newCursor } = computePlanOccurrences(plan, today);
      if (newCursor && newCursor !== plan.lastProcessedDate) {
        planUpdates.push({ id: plan.id, lastProcessedDate: newCursor });
      }
      dueDates.forEach((d) => {
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        newTxs.push({
          id: genId(),
          amount: plan.amount,
          categoryId: plan.categoryId ?? '',
          type: plan.type,
          date: dateStr,
          // note 留空:计划名已在 displayName,首页显示"类别 · 计划名"不会重复
          note: '',
          displayName: plan.name,
          createdAt: Date.now(),
          ledgerId: plan.ledgerId,
          assetId: plan.assetId,
        });
      });
    });

    if (newTxs.length > 0) setTransactions((prev) => [...newTxs, ...prev]);
    if (planUpdates.length > 0) {
      setPaymentPlans((prev) =>
        prev.map((p) => {
          const u = planUpdates.find((x) => x.id === p.id);
          return u ? { ...p, lastProcessedDate: u.lastProcessedDate } : p;
        })
      );
    }
  }, [loading, paymentPlans, activeLedgerId]);

  return (
    <AppContext.Provider
      value={{
        transactions,
        categories,
        budgets,
        ledgers,
        activeLedgerId,
        currency,
        currencySymbol: getCurrencySymbol(currency),
        periodPreference,
        assets,
        dateFormat,
        weekStartsOn,
        decimalPlaces,
        loading,
        paymentPlans,
        addPaymentPlan,
        updatePaymentPlan,
        deletePaymentPlan,
        addTransaction,
        updateTransaction,
        deleteTransaction,
        addCategory,
        addCategoryGroup,
        deleteCategoryGroup,
        updateCategory,
        categoryGroups,
        deleteCategory,
        setBudget,
        getCategoryById,
        addLedger,
        renameLedger,
        deleteLedger,
        setActiveLedgerId,
        setCurrency,
        setPeriodPreference,
        setDateFormat,
        setWeekStartsOn,
        setDecimalPlaces,
        addAsset,
        updateAsset,
        deleteAsset,
        getAssetById,
        getAssetBalance,
        setDefaultAsset,
        addTransfer,
        reloadFromStorage: loadFromStorage,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp必须在AppProvider内部使用');
  return ctx;
}
