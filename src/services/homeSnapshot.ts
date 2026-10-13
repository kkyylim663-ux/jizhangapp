// homeSnapshot.ts
// 首页「上次看到的样子」快照：冷启动时在本地数据读完之前先给用户看一眼（净资产 / 预算 / 最近 3 笔）。
//
// 只保存数字与文字，不保存颜色（颜色在渲染时取主题令牌）。
// 快照只用于「先看见」：真实数据到达后会平滑过渡到真实值，绝不当作可编辑的真相。
// 存储键独立于大数据（只读这一个小键就能首屏），版本不对 / 损坏一律当作没有快照。
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Asset, Budget, Category, Transaction } from '../types';

const SNAPSHOT_KEY = '@jizhang/homeSnapshot/v1';
const SNAPSHOT_VERSION = 1;
const MAX_RECENT = 3;

export interface SnapshotRow {
  id: string;
  title: string;
  subtitle: string;
  amount: number;
  type: 'expense' | 'income';
  icon: string;
  color: string;
}

export interface HomeSnapshot {
  v: typeof SNAPSHOT_VERSION;
  savedAt: number;
  /** 上一次冷启动「JS 开始 → 本地数据读完」的毫秒数（用来决定下一次滚动动画的快慢） */
  loadMs: number;
  lang: string;
  currency: string;
  decimals: number;
  /** 净资产（当前账本的默认币种） */
  netWorth: number;
  /** 本月总预算 / 本月已花（同一币种） */
  budgetTotal: number;
  budgetSpent: number;
  recent: SnapshotRow[];
}

interface BuildSource {
  transactions: Transaction[];
  assets: Asset[];
  budgets: Budget[];
  categories: Category[];
  activeLedgerId: string;
  currency: string;
  decimals: number;
  lang: string;
  loadMs: number;
  getAssetById: (id: string) => Asset | undefined;
  getAssetBalance: (id: string) => number;
  now?: Date;
}

/** 与首页同口径：净资产 = 当前账本、默认币种（第一个账户的币种）的资产余额合计 */
export function buildHomeSnapshot(src: BuildSource): HomeSnapshot {
  const now = src.now ?? new Date();
  const ledgerAssets = src.assets.filter((a) => a.ledgerId === src.activeLedgerId && !a.archivedAt);
  const curr = ledgerAssets[0]?.currency ?? src.currency;
  const netWorth = ledgerAssets
    .filter((a) => a.currency === curr)
    .reduce((sum, a) => sum + src.getAssetBalance(a.id), 0);

  const txCurrency = (t: Transaction) => (t.assetId ? src.getAssetById(t.assetId)?.currency : undefined) ?? src.currency;
  const ledgerTx = src.transactions.filter((t) => t.ledgerId === src.activeLedgerId && t.type !== 'transfer');

  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const budgetTotal =
    src.budgets.find((b) => b.categoryId === 'total' && (b.currency ?? src.currency) === curr)?.amount ?? 0;
  const budgetSpent = ledgerTx
    .filter((t) => t.type === 'expense' && t.date.startsWith(monthKey) && txCurrency(t) === curr)
    .reduce((sum, t) => sum + t.amount, 0);

  const sorted = ledgerTx
    .filter((t) => txCurrency(t) === curr)
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1))
    .slice(0, MAX_RECENT);
  const recent: SnapshotRow[] = sorted.map((t) => {
    const cat = src.categories.find((c) => c.id === t.categoryId);
    const categoryName = cat?.name ?? '';
    return {
      id: t.id,
      title: t.note || t.displayName || categoryName,
      subtitle: categoryName,
      amount: t.amount,
      type: t.type === 'income' ? 'income' : 'expense',
      icon: cat?.icon ?? 'wallet-outline',
      color: cat?.color ?? '#8E8E9A',
    };
  });

  return {
    v: SNAPSHOT_VERSION,
    savedAt: Date.now(),
    loadMs: src.loadMs,
    lang: src.lang,
    currency: curr,
    decimals: src.decimals,
    netWorth,
    budgetTotal,
    budgetSpent,
    recent,
  };
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** 读快照：任何异常（缺失 / 损坏 / 版本不符）都返回 null，调用方退回骨架屏 */
export async function readHomeSnapshot(): Promise<HomeSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<HomeSnapshot> | null;
    if (!s || s.v !== SNAPSHOT_VERSION) return null;
    if (!isFiniteNumber(s.netWorth) || !isFiniteNumber(s.budgetTotal) || !isFiniteNumber(s.budgetSpent)) return null;
    if (!isFiniteNumber(s.loadMs) || !isFiniteNumber(s.decimals) || typeof s.currency !== 'string') return null;
    if (typeof s.lang !== 'string' || !Array.isArray(s.recent)) return null;
    const recent = s.recent
      .slice(0, MAX_RECENT)
      .filter((r): r is SnapshotRow => !!r && typeof r.id === 'string' && isFiniteNumber(r.amount));
    return { ...(s as HomeSnapshot), recent };
  } catch {
    return null;
  }
}

/** 写快照（调用方负责防抖）。失败静默：快照只是锦上添花，绝不影响记账。 */
export async function writeHomeSnapshot(snap: HomeSnapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
  } catch {
    // 忽略
  }
}

/** 清掉快照（退出登录 / 删除账本 / 归档账户时调用） */
export async function clearHomeSnapshot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    // 忽略
  }
}
