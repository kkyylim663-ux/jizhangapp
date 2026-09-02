import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Transaction,
  Category,
  Budget,
  Ledger,
  PeriodPreference,
  Asset,
  AssetType,
  PlannedPayment,
  PlannedPaymentRecurrence,
  DateFormat,
  WeekStartsOn,
  DecimalPlaces,
} from '../types';
import { DEFAULT_CATEGORIES } from '../utils/defaultCategories';
import { getCurrencySymbol } from '../utils/currencies';
import {
  registerForPushNotificationsAsync,
  sendTokenToBackend,
  addNotificationListeners,
} from '../utils/notifications';

const STORAGE_KEYS = {
  transactions: '@jizhang/transactions',
  categories: '@jizhang/categories',
  budgets: '@jizhang/budgets',
  ledgers: '@jizhang/ledgers',
  activeLedgerId: '@jizhang/activeLedgerId',
  currency: '@jizhang/currency',
  periodPreference: '@jizhang/periodPreference',
  assets: '@jizhang/assets',
  plannedPayments: '@jizhang/plannedPayments',
  dateFormat: '@jizhang/dateFormat',
  weekStartsOn: '@jizhang/weekStartsOn',
  decimalPlaces: '@jizhang/decimalPlaces',
  // 现在还没有账号系统，先用一个本地生成、持久化保存的设备ID代替userId来注册推送。
  // 以后做了真实账号系统，把用这个ID的地方换成真实用户ID即可，接口不用改。
  deviceId: '@jizhang/deviceId',
};

const DEFAULT_LEDGER: Ledger = { id: 'default', name: '默认账本', icon: 'book-outline', color: '#4C9AFF', createdAt: Date.now() };
const DEFAULT_PERIOD: PeriodPreference = { type: 'month' };
const DEFAULT_DATE_FORMAT: DateFormat = 'YYYY/MM/DD';
const DEFAULT_WEEK_STARTS_ON: WeekStartsOn = 1;
const DEFAULT_DECIMAL_PLACES: DecimalPlaces = 2;
const FEE_CATEGORY_ID = 'transfer_fee';

function isLegacyIconValue(icon: string | undefined | null): boolean {
  if (!icon) return true;
  return !/^[a-z0-9-]+$/.test(icon);
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

// 老数据里 recurrence/autoDeduct 字段可能不存在（这次改动之前存的），读取时给一个安全默认值
function migratePlannedPayments(stored: PlannedPayment[]): PlannedPayment[] {
  return stored.map((p) => ({
    ...p,
    recurrence: p.recurrence ?? 'once',
    autoDeduct: p.autoDeduct ?? false,
  }));
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
  plannedPayments: PlannedPayment[];
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
  addCategory: (c: Omit<Category, 'id'>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  setBudget: (categoryId: string, amount: number) => Promise<void>;
  getCategoryById: (id: string) => Category | undefined;
  addLedger: (name: string, icon: string, color?: string) => Promise<void>;
  deleteLedger: (id: string) => Promise<void>;
  setActiveLedgerId: (id: string) => Promise<void>;
  setCurrency: (code: string) => Promise<void>;
  setPeriodPreference: (p: PeriodPreference) => Promise<void>;
  setDateFormat: (f: DateFormat) => Promise<void>;
  setWeekStartsOn: (d: WeekStartsOn) => Promise<void>;
  setDecimalPlaces: (n: DecimalPlaces) => Promise<void>;
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
  }) => Promise<void>;
  addPlannedPayment: (p: {
    name: string;
    categoryId?: string;
    amount: number;
    assetId?: string;
    dueDate: string;
    recurrence: PlannedPaymentRecurrence;
    autoDeduct: boolean;
    note?: string;
  }) => Promise<void>;
  updatePlannedPayment: (
    id: string,
    updates: Partial<Omit<PlannedPayment, 'id' | 'createdAt' | 'ledgerId'>>
  ) => Promise<void>;
  deletePlannedPayment: (id: string) => Promise<void>;
  markPlannedPaymentPaid: (id: string) => Promise<void>;
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
  const [activeLedgerId, setActiveLedgerIdState] = useState<string>(DEFAULT_LEDGER.id);
  const [currency, setCurrencyState] = useState<string>('CNY');
  const [periodPreference, setPeriodPreferenceState] = useState<PeriodPreference>(DEFAULT_PERIOD);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [plannedPayments, setPlannedPayments] = useState<PlannedPayment[]>([]);
  const [dateFormat, setDateFormatState] = useState<DateFormat>(DEFAULT_DATE_FORMAT);
  const [weekStartsOn, setWeekStartsOnState] = useState<WeekStartsOn>(DEFAULT_WEEK_STARTS_ON);
  const [decimalPlaces, setDecimalPlacesState] = useState<DecimalPlaces>(DEFAULT_DECIMAL_PLACES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [
          txRaw,
          catRaw,
          budRaw,
          ledRaw,
          activeLedRaw,
          currRaw,
          periodRaw,
          assetRaw,
          planRaw,
          dateFormatRaw,
          weekStartsOnRaw,
          decimalPlacesRaw,
        ] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.transactions),
          AsyncStorage.getItem(STORAGE_KEYS.categories),
          AsyncStorage.getItem(STORAGE_KEYS.budgets),
          AsyncStorage.getItem(STORAGE_KEYS.ledgers),
          AsyncStorage.getItem(STORAGE_KEYS.activeLedgerId),
          AsyncStorage.getItem(STORAGE_KEYS.currency),
          AsyncStorage.getItem(STORAGE_KEYS.periodPreference),
          AsyncStorage.getItem(STORAGE_KEYS.assets),
          AsyncStorage.getItem(STORAGE_KEYS.plannedPayments),
          AsyncStorage.getItem(STORAGE_KEYS.dateFormat),
          AsyncStorage.getItem(STORAGE_KEYS.weekStartsOn),
          AsyncStorage.getItem(STORAGE_KEYS.decimalPlaces),
        ]);
        if (txRaw) {
          const parsedTx: Transaction[] = JSON.parse(txRaw);
          setTransactions(parsedTx.map((t) => (t.ledgerId ? t : { ...t, ledgerId: DEFAULT_LEDGER.id })));
        }
        if (catRaw) {
          const parsedCat: Category[] = JSON.parse(catRaw);
          const hasFee = parsedCat.some((c) => c.id === FEE_CATEGORY_ID);
          const withFee = hasFee ? parsedCat : [...parsedCat, DEFAULT_CATEGORIES.find((c) => c.id === FEE_CATEGORY_ID)!];
          const { result: migratedCat, changed: catChanged } = migrateCategoryIcons(withFee);
          setCategories(migratedCat);
          if (catChanged) {
            AsyncStorage.setItem(STORAGE_KEYS.categories, JSON.stringify(migratedCat));
          }
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
        if (planRaw) {
          const parsedPlan: PlannedPayment[] = JSON.parse(planRaw);
          setPlannedPayments(migratePlannedPayments(parsedPlan));
        }
        if (dateFormatRaw) setDateFormatState(dateFormatRaw as DateFormat);
        if (weekStartsOnRaw) setWeekStartsOnState(Number(weekStartsOnRaw) as WeekStartsOn);
        if (decimalPlacesRaw) setDecimalPlacesState(Number(decimalPlacesRaw) as DecimalPlaces);
      } catch (e) {
        console.warn('读取本地数据失败', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 注册推送通知：现在没有账号系统，先用本地持久化的设备ID当userId用。
  // registerForPushNotificationsAsync 在 Expo Go 里跑不了（拿不到有效token），
  // 要等打了 development build 之后才会真正生效，在 Expo Go 里只会安静地跳过。
  useEffect(() => {
    (async () => {
      try {
        let deviceId = await AsyncStorage.getItem(STORAGE_KEYS.deviceId);
        if (!deviceId) {
          deviceId = genId();
          await AsyncStorage.setItem(STORAGE_KEYS.deviceId, deviceId);
        }
        const token = await registerForPushNotificationsAsync();
        if (token) {
          await sendTokenToBackend(token, deviceId);
        }
      } catch (e) {
        console.warn('推送通知注册失败', e);
      }
    })();

    const cleanup = addNotificationListeners(
      (notification) => console.log('收到通知', notification),
      (response) => console.log('用户点击了通知', response)
    );
    return cleanup;
  }, []);

  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.transactions, JSON.stringify(transactions));
  }, [transactions, loading]);
  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.categories, JSON.stringify(categories));
  }, [categories, loading]);
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
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.plannedPayments, JSON.stringify(plannedPayments));
  }, [plannedPayments, loading]);
  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.dateFormat, dateFormat);
  }, [dateFormat, loading]);
  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.weekStartsOn, String(weekStartsOn));
  }, [weekStartsOn, loading]);
  useEffect(() => {
    if (!loading) AsyncStorage.setItem(STORAGE_KEYS.decimalPlaces, String(decimalPlaces));
  }, [decimalPlaces, loading]);

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
    setTransactions((prev) => prev.filter((item) => item.id !== id));
  };

  const addCategory: AppContextValue['addCategory'] = async (c) => {
    setCategories((prev) => [...prev, { ...c, id: genId() }]);
  };

  const deleteCategory: AppContextValue['deleteCategory'] = async (id) => {
    setCategories((prev) => prev.filter((item) => item.id !== id));
  };

  const setBudget: AppContextValue['setBudget'] = async (categoryId, amount) => {
    setBudgets((prev) => {
      const exists = prev.find((b) => b.categoryId === categoryId);
      if (exists) return prev.map((b) => (b.categoryId === categoryId ? { ...b, amount } : b));
      return [...prev, { categoryId, amount }];
    });
  };

  const getCategoryById = (id: string) => categories.find((c) => c.id === id);

  const addLedger: AppContextValue['addLedger'] = async (name, icon, color) => {
    setLedgers((prev) => [...prev, { id: genId(), name, icon, color: color ?? '#4C9AFF', createdAt: Date.now() }]);
  };

  const deleteLedger: AppContextValue['deleteLedger'] = async (id) => {
    if (id === DEFAULT_LEDGER.id) return;
    setLedgers((prev) => prev.filter((l) => l.id !== id));
    setActiveLedgerIdState((prevActive) => (prevActive === id ? DEFAULT_LEDGER.id : prevActive));
  };

  const setActiveLedgerId: AppContextValue['setActiveLedgerId'] = async (id) => {
    setActiveLedgerIdState(id);
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

  const addPlannedPayment: AppContextValue['addPlannedPayment'] = async ({
    name,
    categoryId,
    amount,
    assetId,
    dueDate,
    recurrence,
    autoDeduct,
    note,
  }) => {
    const newPlan: PlannedPayment = {
      id: genId(),
      name,
      categoryId,
      amount,
      assetId,
      dueDate,
      recurrence,
      autoDeduct,
      note,
      ledgerId: activeLedgerId,
      createdAt: Date.now(),
      isPaid: false,
    };
    setPlannedPayments((prev) => [...prev, newPlan]);
  };

  const updatePlannedPayment: AppContextValue['updatePlannedPayment'] = async (id, updates) => {
    setPlannedPayments((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const deletePlannedPayment: AppContextValue['deletePlannedPayment'] = async (id) => {
    setPlannedPayments((prev) => prev.filter((p) => p.id !== id));
  };

  const markPlannedPaymentPaid: AppContextValue['markPlannedPaymentPaid'] = async (id) => {
    setPlannedPayments((prev) => prev.map((p) => (p.id === id ? { ...p, isPaid: true } : p)));
  };

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
        plannedPayments,
        dateFormat,
        weekStartsOn,
        decimalPlaces,
        loading,
        addTransaction,
        updateTransaction,
        deleteTransaction,
        addCategory,
        deleteCategory,
        setBudget,
        getCategoryById,
        addLedger,
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
        addPlannedPayment,
        updatePlannedPayment,
        deletePlannedPayment,
        markPlannedPaymentPaid,
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
