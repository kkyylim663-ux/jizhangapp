import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabaseClient';
import {
  Asset,
  Budget,
  Category,
  CategoryGroup,
  DateFormat,
  DecimalPlaces,
  Ledger,
  PeriodPreference,
  Transaction,
  WeekStartsOn,
} from '../types';

/**
 * 云端按行同步服务（Part A）。
 *
 * 架构：AsyncStorage 仍是本地主存储（离线照常记账），云端按行备份/恢复。
 * - 推（push）：本地数据变化后防抖触发，diff 出增/改/删的行，分别 upsert / delete 到 Supabase
 * - 拉（pull）：登录或重启恢复会话时拉取云端全部行，与本地合并（同 id 以云端为准，
 *   本机独有行保留），合并结果写回 AsyncStorage 并通知 AppContext 重载
 *   —— 换手机登录同一账号即自动恢复全部资料
 *
 * 本文件不 import 任何 React / Context：与 UI 完全解耦，
 * 通过 onLocalDataReplaced 回调让 AppContext 刷新界面。
 */

// ────────────────────────────── 类型与常量 ──────────────────────────────

/** AppContext 管理的全部本地数据快照（key 名与 AppContext 的 STORAGE_KEYS 对应） */
export interface LocalSnapshot {
  transactions: Transaction[];
  categories: Category[];
  categoryGroups: CategoryGroup[];
  budgets: Budget[];
  ledgers: Ledger[];
  activeLedgerId: string;
  currency: string;
  periodPreference: PeriodPreference;
  assets: Asset[];
  dateFormat: DateFormat;
  weekStartsOn: WeekStartsOn;
  decimalPlaces: DecimalPlaces;
}

/** 数据库行（snake_case，与 supabase/schema.sql 对应） */
type Row = Record<string, unknown>;

const MIRROR_KEY = '@jizhang/syncMirror'; // 最近一次成功同步的数据镜像，用于 diff 出变更行
const LAST_SYNC_KEY = '@jizhang/lastSyncAt';
const LAST_USER_KEY = '@jizhang/lastUserId';

const CHUNK_SIZE = 50; // upsert/delete 分批大小：块越小，一条坏数据拖垮的行越少

export type SyncStatus = 'idle' | 'syncing' | 'error';

/** 同步失败的稳定错误码（界面按码显示中英文提示） */
export type SyncErrorCode =
  | 'network'
  | 'auth'
  | 'constraint'
  | 'server'
  | 'clock_skew'
  | 'local_data_corrupt'
  | 'not_logged_in'
  | 'sync_in_progress'
  | 'unknown';

export interface SyncResult {
  ok: boolean;
  error?: SyncErrorCode | string;
  /** 原始错误信息（弹窗副文里展示，便于反馈定位） */
  detail?: string;
}

/** 本地快照里存在但 JSON 解析失败的 key：继续同步会把坏数据当空表推上云（误删云端），必须中止 */
export class LocalDataCorruptError extends Error {
  constructor(keys: string[]) {
    super(`本地数据解析失败：${keys.join(', ')}`);
    this.name = 'LocalDataCorruptError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 把任意同步异常归类成稳定错误码：
 * - network：fetch 失败/超时/DNS（弱网、部分运营商拦 *.supabase.co）
 * - auth：token 失效 / RLS 拒绝（401/403）
 * - constraint：数据库约束拒绝（NOT NULL / 外键 / 唯一冲突，Postgres 23xxx）
 * - server：Supabase 5xx
 */
function classifySyncError(e: unknown): Exclude<SyncErrorCode, 'local_data_corrupt' | 'not_logged_in' | 'sync_in_progress'> {
  const anyE = e as { code?: string; message?: string; details?: string; status?: number } | null;
  const msg = `${anyE?.message ?? ''} ${anyE?.details ?? ''}`;
  const code = anyE?.code ?? '';
  const status = anyE?.status;
  // TASK-026：Supabase 签票/验票两服务间偶发秒级时钟差——JWT 在验票侧看是"未来"签发的（PGRST303）。
  // 与用户手机时钟无关（票是服务器签的），等待+换票重试即可自愈，单独归类便于重试器识别
  if (code === 'PGRST303' || /issued at future/i.test(msg)) return 'clock_skew';
  if (/fetch|network|timeout|timed out|socket|dns|unable to resolve/i.test(msg)) return 'network';
  if (status === 401 || status === 403 || /jwt|row-level security|permission denied/i.test(msg)) return 'auth';
  if (/^23\d{3}$/.test(code) || /violates|duplicate key|null value in column/i.test(msg)) return 'constraint';
  if ((typeof status === 'number' && status >= 500) || /internal error|server error/i.test(msg)) return 'server';
  return 'unknown';
}

/** TASK-026：时钟偏差类错误（PGRST303 / 401 中的 jwt future）——等待+换票重试可自愈 */
function isClockSkewError(e: unknown): boolean {
  const anyE = e as { code?: string; message?: string; details?: string; status?: number } | null;
  const msg = `${anyE?.message ?? ''} ${anyE?.details ?? ''}`;
  const code = anyE?.code ?? '';
  if (code === 'PGRST303' || /issued at future/i.test(msg)) return true;
  // 慢钟手机：SDK 按本地钟判"未过期"但服务器已判过期（401）——刷新 token 后同样自愈
  return anyE?.status === 401 || /jwt expired|invalid claim/i.test(msg);
}

/** 瞬时错误（网络/服务器抖动）值得重试；数据类错误重试没有意义 */
function isTransientError(e: unknown): boolean {
  const c = classifySyncError(e);
  return c === 'network' || c === 'server';
}

/** 瞬时错误重试 2 次（0.8s/1.6s 退避）；非瞬时错误立即抛出。
 *  注意 postgrest-js 出错时 resolve({error}) 而不是 throw，所以这里比较的是 resolved 值 */
async function withRetry<T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> {
  let result = await fn();
  if (!isTransientError(result.error)) return result;
  await sleep(800);
  result = await fn();
  if (!isTransientError(result.error)) return result;
  await sleep(1600);
  return fn();
}

/**
 * TASK-026：时钟偏差自愈包装器——同步主体（pull+push 整体，upsert 幂等可安全重试）。
 * 遇 PGRST303/401 时钟类错误：刷新 session 换新票 → 递增等待（1.5s/3s/4.5s）重试，最多 3 次。
 * 原理：JWT 的 iat 由服务器签出后固定不变，验票服务器的钟持续前进——等待后"未来的票"
 * 自然变有效；换新票则直接绕开旧 iat。手机快/慢/跨时区与该错误无关，此机制对全部机型生效。
 */
async function withClockSkewRetry<T>(fn: () => Promise<T>): Promise<T> {
  // TASK-026 续（用户追问"真到这一步怎么办"）：重试链从 3 次 9 秒加长到 6 次约 63 秒——
  // 平台级秒级偏差通常 10~30 秒内恢复，加长后兜底分支几乎不可能到达
  const delays = [1500, 3000, 4500, 8000, 15000, 30000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === delays.length || !isClockSkewError(e)) throw e;
      console.warn(`同步遇到时间校验偏差，自动换票重试（第 ${attempt + 1}/${delays.length} 次）`, e);
      try {
        // 换一张新票：绕开旧票的 iat；失败（如离线）不阻断，继续走等待重试
        await supabase.auth.refreshSession();
      } catch {
        /* 刷新失败不致命：iat 固定+等待本身就能自愈 */
      }
      await sleep(delays[attempt]);
    }
  }
  throw lastErr;
}

/**
 * TASK-026 续：时钟偏差彻底失败的延迟补推——60 秒后自动再同步一次。
 * 数据本地已落库（零丢失），这里只是把"请用户稍后手动重试"变成 App 自己排队收尾；
 * 期间用户任何新数据变化也会各自触发 schedulePush，多路径汇合到同一次成功同步。
 */
let clockSkewRetimer: ReturnType<typeof setTimeout> | null = null;
function scheduleClockSkewRetryPush(): void {
  if (clockSkewRetimer) return; // 已排队则不重复（多次失败共享同一个补推）
  clockSkewRetimer = setTimeout(() => {
    clockSkewRetimer = null;
    void pushNow().catch(() => {});
  }, 60_000);
}

// ────────────────────────────── 同步状态（供 UI 订阅） ──────────────────────────────

let status: SyncStatus = 'idle';
let lastSyncAt: number | null = null;
const statusListeners = new Set<() => void>();

AsyncStorage.getItem(LAST_SYNC_KEY)
  .then((v) => {
    if (v) lastSyncAt = Number(v);
  })
  .catch(() => {});

function setStatus(next: SyncStatus) {
  status = next;
  statusListeners.forEach((cb) => cb());
}

function setLastSyncAt(t: number) {
  lastSyncAt = t;
  AsyncStorage.setItem(LAST_SYNC_KEY, String(t)).catch(() => {});
  statusListeners.forEach((cb) => cb());
}

export function getSyncState(): { status: SyncStatus; lastSyncAt: number | null } {
  return { status, lastSyncAt };
}

export function subscribeSyncState(cb: () => void): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

// ────────────────────────────── 本地数据被替换的回调（AppContext 重载界面用） ──────────────────────────────

const reloadListeners = new Set<() => void>();

export function onLocalDataReplaced(cb: () => void): () => void {
  reloadListeners.add(cb);
  return () => reloadListeners.delete(cb);
}

function notifyDataReplaced() {
  reloadListeners.forEach((cb) => cb());
}

// ────────────────────────────── 行转换：本地实体 ↔ 数据库行 ──────────────────────────────

function txToRow(t: Transaction, userId: string): Row {
  return {
    id: t.id,
    user_id: userId,
    amount: t.amount,
    type: t.type,
    category_id: t.categoryId ?? '',
    date: t.date,
    note: t.note ?? '',
    display_name: t.displayName ?? null,
    ledger_id: t.ledgerId,
    asset_id: t.assetId ?? null,
    from_asset_id: t.fromAssetId ?? null,
    to_asset_id: t.toAssetId ?? null,
    exchange_rate: t.exchangeRate ?? null,
    converted_amount: t.convertedAmount ?? null,
    fee: t.fee ?? null,
    receipt_path: t.receiptUri ?? null,
    created_at: t.createdAt,
  };
}

function txFromRow(r: Row): Transaction {
  return {
    id: r.id as string,
    amount: Number(r.amount),
    type: r.type as Transaction['type'],
    categoryId: (r.category_id as string) ?? '',
    date: r.date as string,
    note: (r.note as string) ?? '',
    displayName: (r.display_name as string) ?? undefined,
    createdAt: Number(r.created_at),
    ledgerId: r.ledger_id as string,
    assetId: (r.asset_id as string) ?? undefined,
    receiptUri: (r.receipt_path as string) ?? undefined,
    fromAssetId: (r.from_asset_id as string) ?? undefined,
    toAssetId: (r.to_asset_id as string) ?? undefined,
    exchangeRate: r.exchange_rate != null ? Number(r.exchange_rate) : undefined,
    convertedAmount: r.converted_amount != null ? Number(r.converted_amount) : undefined,
    fee: r.fee != null ? Number(r.fee) : undefined,
  };
}

function assetToRow(a: Asset, userId: string): Row {
  return {
    id: a.id,
    user_id: userId,
    name: a.name,
    icon: a.icon,
    color: a.color,
    type: a.type,
    currency: a.currency,
    initial_balance: a.initialBalance,
    ledger_id: a.ledgerId,
    credit_limit: a.creditLimit ?? null,
    statement_day: a.statementDay ?? null,
    due_day: a.dueDay ?? null,
    interest_rate: a.interestRate ?? null,
    is_default: a.isDefault ?? null,
    created_at: a.createdAt,
  };
}

function assetFromRow(r: Row): Asset {
  return {
    id: r.id as string,
    name: r.name as string,
    icon: r.icon as string,
    color: r.color as string,
    type: r.type as Asset['type'],
    currency: r.currency as string,
    initialBalance: Number(r.initial_balance),
    ledgerId: r.ledger_id as string,
    creditLimit: r.credit_limit != null ? Number(r.credit_limit) : undefined,
    statementDay: r.statement_day != null ? Number(r.statement_day) : undefined,
    dueDay: r.due_day != null ? Number(r.due_day) : undefined,
    interestRate: r.interest_rate != null ? Number(r.interest_rate) : undefined,
    isDefault: r.is_default != null ? Boolean(r.is_default) : undefined,
    createdAt: Number(r.created_at),
  };
}

function categoryToRow(c: Category, userId: string): Row {
  return {
    id: c.id,
    user_id: userId,
    name: c.name,
    icon: c.icon,
    color: c.color,
    type: c.type,
    group_name: c.group ?? null,
  };
}

function categoryFromRow(r: Row): Category {
  return {
    id: r.id as string,
    name: r.name as string,
    icon: r.icon as string,
    color: (r.color as string) ?? '',
    type: r.type as Category['type'],
    group: (r.group_name as string) ?? undefined,
  };
}

// App 端大类以 name 为唯一键，云端 id 直接用 name
function groupToRow(g: CategoryGroup, userId: string): Row {
  return {
    id: g.name,
    user_id: userId,
    name: g.name,
    color: g.color ?? null,
    icon: g.icon ?? null,
    type: g.type,
  };
}

function groupFromRow(r: Row): CategoryGroup {
  return {
    name: r.name as string,
    color: (r.color as string) ?? undefined,
    icon: (r.icon as string) ?? undefined,
    type: r.type as CategoryGroup['type'],
  };
}

// App 端预算没有 id：用 分类id+币种 生成确定性 id，多端一致
function budgetId(b: Budget): string {
  return `${b.categoryId}|${b.currency ?? ''}`;
}

function budgetToRow(b: Budget, userId: string): Row {
  return {
    id: budgetId(b),
    user_id: userId,
    category_id: b.categoryId,
    amount: b.amount,
    currency: b.currency ?? null,
  };
}

function budgetFromRow(r: Row): Budget {
  return {
    categoryId: r.category_id as string,
    amount: Number(r.amount),
    currency: (r.currency as string) ?? undefined,
  };
}

function ledgerToRow(l: Ledger, userId: string): Row {
  return {
    id: l.id,
    user_id: userId,
    name: l.name,
    icon: l.icon,
    color: l.color ?? null,
    created_at: l.createdAt,
  };
}

function ledgerFromRow(r: Row): Ledger {
  return {
    id: r.id as string,
    name: r.name as string,
    icon: r.icon as string,
    color: (r.color as string) ?? undefined,
    createdAt: Number(r.created_at),
  };
}

function profileToRow(s: LocalSnapshot, userId: string): Row {
  return {
    user_id: userId,
    currency: s.currency,
    date_format: s.dateFormat,
    week_starts_on: s.weekStartsOn,
    decimal_places: s.decimalPlaces,
    period_preference: s.periodPreference,
    active_ledger_id: s.activeLedgerId,
  };
}

/** 把云端 profiles 行套到本地快照的设置字段上（云端为 null 的字段保留本地值） */
function applyProfileRow(s: LocalSnapshot, r: Row | null): LocalSnapshot {
  if (!r) return s;
  return {
    ...s,
    currency: (r.currency as string) ?? s.currency,
    dateFormat: (r.date_format as DateFormat) ?? s.dateFormat,
    weekStartsOn: (r.week_starts_on as WeekStartsOn) ?? s.weekStartsOn,
    decimalPlaces: (r.decimal_places as DecimalPlaces) ?? s.decimalPlaces,
    periodPreference: (r.period_preference as PeriodPreference) ?? s.periodPreference,
    activeLedgerId: (r.active_ledger_id as string) ?? s.activeLedgerId,
  };
}

// ────────────────────────────── 镜像（最近一次成功同步的数据，用于 diff） ──────────────────────────────

interface SyncMirror {
  ledgers: Row[];
  assets: Row[];
  category_groups: Row[];
  categories: Row[];
  transactions: Row[];
  budgets: Row[];
  profile: Row | null;
}

async function loadMirror(): Promise<SyncMirror> {
  try {
    const raw = await AsyncStorage.getItem(MIRROR_KEY);
    if (raw) return JSON.parse(raw) as SyncMirror;
  } catch {}
  return { ledgers: [], assets: [], category_groups: [], categories: [], transactions: [], budgets: [], profile: null };
}

function saveMirror(m: SyncMirror): Promise<void> {
  return AsyncStorage.setItem(MIRROR_KEY, JSON.stringify(m)).catch(() => {});
}

/** 把当前快照按表转成数据库行（canonical 形状，diff 用） */
function buildAllRows(s: LocalSnapshot, userId: string): SyncMirror {
  return {
    ledgers: s.ledgers.map((l) => ledgerToRow(l, userId)),
    assets: s.assets.map((a) => assetToRow(a, userId)),
    category_groups: s.categoryGroups.map((g) => groupToRow(g, userId)),
    categories: s.categories.map((c) => categoryToRow(c, userId)),
    transactions: s.transactions.map((t) => txToRow(t, userId)),
    budgets: s.budgets.map((b) => budgetToRow(b, userId)),
    profile: profileToRow(s, userId),
  };
}

// ────────────────────────────── 本地读写 ──────────────────────────────

const KEYS = {
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
};

function emptySnapshot(): LocalSnapshot {
  return {
    transactions: [],
    categories: [],
    categoryGroups: [],
    budgets: [],
    ledgers: [],
    activeLedgerId: 'default',
    currency: 'MYR',
    periodPreference: { type: 'month' },
    assets: [],
    dateFormat: 'YYYY/MM/DD',
    weekStartsOn: 1,
    decimalPlaces: 2,
  };
}

async function readLocalSnapshot(): Promise<LocalSnapshot> {
  const [tx, cat, grp, bud, led, activeLed, curr, per, ast, df, wk, dp] = await Promise.all([
    AsyncStorage.getItem(KEYS.transactions),
    AsyncStorage.getItem(KEYS.categories),
    AsyncStorage.getItem(KEYS.categoryGroups),
    AsyncStorage.getItem(KEYS.budgets),
    AsyncStorage.getItem(KEYS.ledgers),
    AsyncStorage.getItem(KEYS.activeLedgerId),
    AsyncStorage.getItem(KEYS.currency),
    AsyncStorage.getItem(KEYS.periodPreference),
    AsyncStorage.getItem(KEYS.assets),
    AsyncStorage.getItem(KEYS.dateFormat),
    AsyncStorage.getItem(KEYS.weekStartsOn),
    AsyncStorage.getItem(KEYS.decimalPlaces),
  ]);
  // key 存在但解析失败 = 本地数据损坏。静默回退空数组会把坏表当"空表"推上云
  // （diff 出全量 delete，误删云端），所以这里直接中止同步保护数据。
  const corrupt: string[] = [];
  const parseStrict = <T,>(raw: string | null, key: string, fallback: T): T => {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      corrupt.push(key);
      return fallback;
    }
  };
  const transactions = parseStrict<Transaction[]>(tx, KEYS.transactions, []);
  const categories = parseStrict<Category[]>(cat, KEYS.categories, []);
  const categoryGroups = parseStrict<CategoryGroup[]>(grp, KEYS.categoryGroups, []);
  const budgets = parseStrict<Budget[]>(bud, KEYS.budgets, []);
  const ledgers = parseStrict<Ledger[]>(led, KEYS.ledgers, []);
  const periodPreference = parseStrict<PeriodPreference>(per, KEYS.periodPreference, { type: 'month' });
  const assets = parseStrict<Asset[]>(ast, KEYS.assets, []);
  if (corrupt.length) throw new LocalDataCorruptError(corrupt);
  return {
    transactions,
    categories,
    categoryGroups,
    budgets,
    ledgers,
    activeLedgerId: activeLed ?? 'default',
    currency: curr ?? 'MYR',
    periodPreference,
    assets,
    dateFormat: (df as DateFormat) ?? 'YYYY/MM/DD',
    // 注意不能用 || 兜底：weekStartsOn 合法值包含 0（周日），会被 falsy 判断吞掉
    weekStartsOn: wk != null ? (Number(wk) as WeekStartsOn) : 1,
    decimalPlaces: dp != null ? (Number(dp) as DecimalPlaces) : 2,
  };
}

// ────────────────────────────── 老数据兜底（防止 NOT NULL 拒写卡死同步） ──────────────────────────────

const FALLBACK_COLOR = '#4C9AFF'; // 与 AppContext.DEFAULT_LEDGER 一致的主题蓝
const FALLBACK_ICON = 'book-outline';

function toFiniteNumber(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 修复历史遗留的不完整数据，避免推云时被数据库 NOT NULL 约束整块拒绝：
 * - 资产缺 color/currency/icon/ledgerId/createdAt（每资产币种上线前的老设备数据）
 * - 交易缺 ledgerId/createdAt/date、金额非法（NaN 会变成 Postgres 拒绝的 NaN 字面量）
 * - 账本缺 icon/createdAt
 * 返回 (快照, 是否有修复)：有修复时调用方把结果写回本地自愈，下次不再触发。
 */
function normalizeSnapshot(s: LocalSnapshot): { snapshot: LocalSnapshot; changed: boolean } {
  let changed = false;
  const currencyFallback = s.currency || 'MYR';
  const ledgerFallback = s.activeLedgerId || 'default';

  const assets = s.assets.map((a) => {
    const patch: Partial<Asset> = {};
    if (!a.color) patch.color = FALLBACK_COLOR;
    if (!a.currency) patch.currency = currencyFallback;
    if (!a.icon) patch.icon = FALLBACK_ICON;
    if (!a.ledgerId) patch.ledgerId = ledgerFallback;
    if (!Number.isFinite(Number(a.createdAt)) || !a.createdAt) patch.createdAt = Date.now();
    if (!Object.keys(patch).length) return a;
    changed = true;
    return { ...a, ...patch } as Asset;
  });

  const transactions = s.transactions.map((t) => {
    const patch: Partial<Transaction> = {};
    if (!t.ledgerId) patch.ledgerId = ledgerFallback;
    if (!Number.isFinite(Number(t.createdAt)) || !t.createdAt) patch.createdAt = Date.now();
    if (!t.date) patch.date = new Date().toISOString().slice(0, 10);
    if (!Number.isFinite(Number(t.amount))) patch.amount = 0;
    if (!Object.keys(patch).length) return t;
    changed = true;
    return { ...t, ...patch } as Transaction;
  });

  const ledgers = s.ledgers.map((l) => {
    const patch: Partial<Ledger> = {};
    if (!l.icon) patch.icon = FALLBACK_ICON;
    if (!Number.isFinite(Number(l.createdAt)) || !l.createdAt) patch.createdAt = Date.now();
    if (!Object.keys(patch).length) return l;
    changed = true;
    return { ...l, ...patch } as Ledger;
  });

  return {
    snapshot: changed ? { ...s, assets, transactions, ledgers } : s,
    changed,
  };
}

/** 合并结果写回 AsyncStorage（AppContext 通过 onLocalDataReplaced 重载进内存） */
async function writeLocalSnapshot(s: LocalSnapshot): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(KEYS.transactions, JSON.stringify(s.transactions)),
    AsyncStorage.setItem(KEYS.categories, JSON.stringify(s.categories)),
    AsyncStorage.setItem(KEYS.categoryGroups, JSON.stringify(s.categoryGroups)),
    AsyncStorage.setItem(KEYS.budgets, JSON.stringify(s.budgets)),
    AsyncStorage.setItem(KEYS.ledgers, JSON.stringify(s.ledgers)),
    AsyncStorage.setItem(KEYS.activeLedgerId, s.activeLedgerId),
    AsyncStorage.setItem(KEYS.currency, s.currency),
    AsyncStorage.setItem(KEYS.periodPreference, JSON.stringify(s.periodPreference)),
    AsyncStorage.setItem(KEYS.assets, JSON.stringify(s.assets)),
    AsyncStorage.setItem(KEYS.dateFormat, s.dateFormat),
    AsyncStorage.setItem(KEYS.weekStartsOn, String(s.weekStartsOn)),
    AsyncStorage.setItem(KEYS.decimalPlaces, String(s.decimalPlaces)),
  ]);
}

// ────────────────────────────── 云端读写 ──────────────────────────────

const PULL_PAGE_SIZE = 1000; // Supabase 默认 max_rows=1000，超过会被静默截断，必须翻页拉全

/** 翻页拉全一张表（按 id 排序保证翻页稳定；数据量小，两三页内拉完） */
async function fetchAllRows(table: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PULL_PAGE_SIZE) {
    const { data, error } = await withRetry(() =>
      supabase.from(table).select('*').order('id').range(from, from + PULL_PAGE_SIZE - 1)
    );
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PULL_PAGE_SIZE) return out;
  }
}

async function fetchAll(userId: string): Promise<{ cloud: SyncMirror; cloudRows: Record<string, Row[]> }> {
  const [ledgers, assets, groups, cats, txs, buds, prof] = await Promise.all([
    fetchAllRows('ledgers'),
    fetchAllRows('assets'),
    fetchAllRows('category_groups'),
    fetchAllRows('categories'),
    fetchAllRows('transactions'),
    fetchAllRows('budgets'),
    supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
  ] as const);
  const profError = prof.error;
  if (profError) throw profError;

  const cloudRows: Record<string, Row[]> = {
    ledgers,
    assets,
    category_groups: groups,
    categories: cats,
    transactions: txs,
    budgets: buds,
  };
  // 镜像统一转成 canonical 形状（toRow(fromRow(row))），这样推送 diff 时键序一致；
  // profiles 行也走一次 applyProfileRow → profileToRow 归一化，避免带着数据库的
  // created_at/updated_at 等额外列导致每次启动都误判"有变化"而多做一次 upsert
  const cloud: SyncMirror = {
    ledgers: cloudRows.ledgers.map((r) => ledgerToRow(ledgerFromRow(r), userId)),
    assets: cloudRows.assets.map((r) => assetToRow(assetFromRow(r), userId)),
    category_groups: cloudRows.category_groups.map((r) => groupToRow(groupFromRow(r), userId)),
    categories: cloudRows.categories.map((r) => categoryToRow(categoryFromRow(r), userId)),
    transactions: cloudRows.transactions.map((r) => txToRow(txFromRow(r), userId)),
    budgets: cloudRows.budgets.map((r) => budgetToRow(budgetFromRow(r), userId)),
    profile: prof.data ? profileToRow(applyProfileRow(emptySnapshot(), prof.data as Row), userId) : null,
  };
  return { cloud, cloudRows };
}
/** 单行推送失败记录：constraint 类失败跳过坏行、其余照常上云，失败行不入镜像（下次同步重试） */
interface RowFailure {
  table: string;
  id: string;
  op: 'upsert' | 'delete';
  reason: string;
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

async function upsertChunked(table: string, rows: Row[], failedRows: RowFailure[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await withRetry(() => supabase.from(table).upsert(chunk));
    if (!error) continue;
    // 数据类失败（NOT NULL/外键等 23xxx）：退到逐行推送隔离坏行，不让一条脏数据卡死全表
    if (classifySyncError(error) !== 'constraint') throw error;
    for (const row of chunk) {
      const { error: rowError } = await supabase.from(table).upsert(row);
      // 网络/服务器抖动不能标成坏行（会误报"数据不兼容"且中断其余行），直接上抛
      if (rowError) {
        if (classifySyncError(rowError) !== 'constraint') throw rowError;
        failedRows.push({ table, id: String(row.id), op: 'upsert', reason: rowError.message });
      }
    }
  }
}

async function deleteByIds(table: string, ids: string[], failedRows: RowFailure[]): Promise<void> {
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const { error } = await withRetry(() => supabase.from(table).delete().in('id', chunk));
    if (!error) continue;
    if (classifySyncError(error) !== 'constraint') throw error;
    for (const id of chunk) {
      const { error: rowError } = await supabase.from(table).delete().eq('id', id);
      if (rowError) {
        if (classifySyncError(rowError) !== 'constraint') throw rowError;
        failedRows.push({ table, id, op: 'delete', reason: rowError.message });
      }
    }
  }
}

function formatRowFailures(failedRows: RowFailure[]): string {
  const shown = failedRows
    .slice(0, 3)
    .map((f) => `${f.table}/${f.id}: ${f.reason}`);
  return failedRows.length > shown.length
    ? `${shown.join('；')}（共 ${failedRows.length} 条失败）`
    : shown.join('；');
}

/** 把快照 diff 后推送到云端：只上传有变化的行、删除云端多余行，最后更新镜像 */
async function pushSnapshot(s: LocalSnapshot, userId: string): Promise<RowFailure[]> {
  const current = buildAllRows(s, userId);
  const mirror = await loadMirror();
  const failedRows: RowFailure[] = [];

  const tablePairs: Array<[string, Row[]]> = [
    ['ledgers', current.ledgers],
    ['assets', current.assets],
    ['category_groups', current.category_groups],
    ['categories', current.categories],
    ['transactions', current.transactions],
    ['budgets', current.budgets],
  ];
  const mirrorMap: Record<string, Row[]> = {
    ledgers: mirror.ledgers,
    assets: mirror.assets,
    category_groups: mirror.category_groups,
    categories: mirror.categories,
    transactions: mirror.transactions,
    budgets: mirror.budgets,
  };

  for (const [table, rows] of tablePairs) {
    const prevRows = mirrorMap[table];
    const prev = new Map(prevRows.map((r) => [r.id as string, r]));
    const idsNow = new Set(rows.map((r) => r.id as string));
    const upserts = rows.filter((r) => {
      const old = prev.get(r.id as string);
      return !old || JSON.stringify(old) !== JSON.stringify(r);
    });
    const deletes = prevRows.filter((r) => !idsNow.has(r.id as string)).map((r) => r.id as string);
    if (upserts.length) await upsertChunked(table, upserts, failedRows);
    if (deletes.length) await deleteByIds(table, deletes, failedRows);
  }

  // profiles 行：整行 upsert（只写我们管理的列，不影响 display_name 等）
  if (current.profile && (!mirror.profile || JSON.stringify(mirror.profile) !== JSON.stringify(current.profile))) {
    const { error } = await supabase.from('profiles').upsert(current.profile);
    if (error && classifySyncError(error) !== 'constraint') throw error;
    if (error) failedRows.push({ table: 'profiles', id: userId, op: 'upsert', reason: error.message });
  }

  // 镜像 = 本次成功上云的状态：失败的 upsert 行不入镜像（下次同步重试），
  // 失败的 delete 保留旧行（下次同步再删）。网络/服务器中断则整次不落镜像。
  const failedUpsertKeys = new Set(
    failedRows.filter((f) => f.op === 'upsert').map((f) => `${f.table}:${f.id}`)
  );
  const failedDeleteIds = new Set(
    failedRows.filter((f) => f.op === 'delete').map((f) => `${f.table}:${f.id}`)
  );
  const nextMirror: SyncMirror = {
    ledgers: [],
    assets: [],
    category_groups: [],
    categories: [],
    transactions: [],
    budgets: [],
    profile: failedUpsertKeys.has(`profiles:${userId}`) ? mirror.profile : current.profile,
  };
  for (const [table, rows] of tablePairs) {
    const prevMap = new Map(mirrorMap[table].map((r) => [r.id as string, r]));
    const kept: Row[] = [];
    // 当前本地行：推送成功才入镜像；失败的 upsert 保留旧镜像行
    // （若之后本地把该行删了，旧镜像行才能触发下次的 delete，否则云端坏行会复活循环）
    for (const r of rows as Row[]) {
      if (!failedUpsertKeys.has(`${table}:${r.id as string}`)) {
        kept.push(r);
      } else if (prevMap.has(r.id as string)) {
        kept.push(prevMap.get(r.id as string) as Row);
      }
    }
    // 失败的 delete 保留旧行，下次同步再删
    for (const r of mirrorMap[table]) {
      if (failedDeleteIds.has(`${table}:${r.id as string}`)) kept.push(r);
    }
    (nextMirror as unknown as Record<string, Row[]>)[table] = kept;
  }

  await saveMirror(nextMirror);
  setLastSyncAt(Date.now());
  return failedRows;
}

// ────────────────────────────── 合并 ──────────────────────────────

/**
 * 按 id 合并一张表的本地行与云端行：
 * - 同 id：云端为准（后同步者覆盖，MVP 策略）
 * - 本机独有：保留（稍后被推上云）
 * - 云端独有：追加（transactions 按 createdAt 倒序排在后面，其他保持云端顺序）
 */
function mergeById<T extends { id: string }>(localRows: T[], cloudRows: T[]): T[] {
  const cloudMap = new Map(cloudRows.map((r) => [r.id, r]));
  const out = localRows.map((r) => cloudMap.get(r.id) ?? r);
  const localIds = new Set(localRows.map((r) => r.id));
  const cloudOnly = cloudRows.filter((r) => !localIds.has(r.id));
  return [...out, ...cloudOnly];
}

/**
 * 云端数据与本地合并：
 * - cloudWinsAll = true（切换到另一个账号登录）：本机遗留数据丢弃，以云端为准
 * - 否则（首次绑定账号 / 同账号重登 / 换新手机）：按行合并，绝不静默丢数据
 */
function mergeSnapshots(local: LocalSnapshot, cloud: SyncMirror, cloudRows: Record<string, Row[]>, cloudWinsAll: boolean): LocalSnapshot {
  if (cloudWinsAll) {
    const base = emptySnapshot();
    const withSettings = applyProfileRow(base, cloud.profile);
    return {
      transactions: cloudRows.transactions.map(txFromRow),
      categories: cloudRows.categories.map(categoryFromRow),
      categoryGroups: cloudRows.category_groups.map(groupFromRow),
      budgets: cloudRows.budgets.map(budgetFromRow),
      ledgers: cloudRows.ledgers.map(ledgerFromRow),
      assets: cloudRows.assets.map(assetFromRow),
      activeLedgerId: withSettings.activeLedgerId,
      currency: withSettings.currency,
      periodPreference: withSettings.periodPreference,
      dateFormat: withSettings.dateFormat,
      weekStartsOn: withSettings.weekStartsOn,
      decimalPlaces: withSettings.decimalPlaces,
    };
  }

  const merged: LocalSnapshot = {
    transactions: mergeById(local.transactions, cloudRows.transactions.map(txFromRow)).sort(
      (a, b) => b.createdAt - a.createdAt
    ),
    categories: mergeById(local.categories, cloudRows.categories.map(categoryFromRow)),
    categoryGroups: mergeById(
      local.categoryGroups.map((g) => ({ ...g, id: g.name })),
      cloudRows.category_groups.map((r) => ({ ...groupFromRow(r), id: r.name as string }))
    ).map((g) => ({ name: g.name, color: g.color, icon: g.icon, type: g.type })),
    budgets: mergeById(
      local.budgets.map((b) => ({ ...b, id: budgetId(b) })),
      cloudRows.budgets.map((r) => ({ ...budgetFromRow(r), id: r.id as string }))
    ).map((b) => ({ categoryId: b.categoryId, amount: b.amount, currency: b.currency })),
    ledgers: mergeById(local.ledgers, cloudRows.ledgers.map(ledgerFromRow)),
    assets: mergeById(local.assets, cloudRows.assets.map(assetFromRow)),
    activeLedgerId: local.activeLedgerId,
    currency: local.currency,
    periodPreference: local.periodPreference,
    dateFormat: local.dateFormat,
    weekStartsOn: local.weekStartsOn,
    decimalPlaces: local.decimalPlaces,
  };
  return applyProfileRow(merged, cloud.profile);
}

// ────────────────────────────── 对外 API ──────────────────────────────

let syncing = false;

async function currentUserId(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

/** 统一出口：把异常归类成稳定错误码 + 原始信息 */
function toSyncResult(e: unknown): SyncResult {
  if (e instanceof LocalDataCorruptError) {
    return { ok: false, error: 'local_data_corrupt', detail: e.message };
  }
  // TASK-026：时钟偏差彻底失败（6 次重试约 63 秒仍未自愈 = 平台级偏差）——
  // 数据已在本地零丢失，App 已自动排队 60 秒后补推；文案按用户定版用「同步记录」表述
  if (isClockSkewError(e)) {
    scheduleClockSkewRetryPush();
    return {
      ok: false,
      error: 'clock_skew',
      detail: '已保存在同步记录，服务器暂时未响应；稍后会自动同步上云，无需任何操作',
    };
  }
  return { ok: false, error: classifySyncError(e), detail: errorMessage(e) };
}

/**
 * 完整同步（登录成功 / 重启恢复会话时调用）：
 * 拉取云端 → 与本地合并 → 写回本地 → 把合并结果推上云。
 */
export async function fullSync(): Promise<SyncResult> {
  if (syncing) return { ok: false, error: 'sync_in_progress' };
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'not_logged_in' };

  syncing = true;
  setStatus('syncing');
  try {
    // TASK-026：同步主体整体套时钟偏差自愈（pull+push 幂等，重试安全）——
    // PGRST303/401 类错误自动换票+等待重试，手机快/慢/跨时区与 Supabase 内部秒级偏差均无感通过
    const run = async () => {
      const { cloud, cloudRows } = await fetchAll(userId);
      const local = await readLocalSnapshot();
      const lastUserId = await AsyncStorage.getItem(LAST_USER_KEY);
      const cloudWinsAll = lastUserId != null && lastUserId !== userId;
      const merged = mergeSnapshots(local, cloud, cloudRows, cloudWinsAll);
      // 推送前兜底修复老数据（缺币种/颜色/时间戳等），并写回本地自愈
      const { snapshot: normalized } = normalizeSnapshot(merged);
      await writeLocalSnapshot(normalized);
      // 必须无条件通知重载：合并可能只追加了云端行（normalize 无改动），
      // 若跳过通知，React 状态停在旧数据，下次本地写回会把合并结果覆盖掉，
      // 再下一次推送就会把"消失"的行当成删除发上云 —— 云端数据被误删
      notifyDataReplaced();
      const failedRows = await pushSnapshot(normalized, userId);
      await AsyncStorage.setItem(LAST_USER_KEY, userId);
      return failedRows;
    };
    const failedRows = await withClockSkewRetry(run);
    setStatus('idle');
    if (failedRows.length) {
      return { ok: false, error: 'constraint', detail: formatRowFailures(failedRows) };
    }
    return { ok: true };
  } catch (e) {
    console.warn('云端同步失败', e);
    setStatus('error');
    return toSyncResult(e);
  } finally {
    syncing = false;
  }
}

/**
 * 防抖推送（AppContext 数据变化时调用）。
 * 未登录时是空操作，所以本地功能完全不受影响。
 */
let pushTimer: ReturnType<typeof setTimeout> | null = null;

export function schedulePush(delayMs = 2000): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushNow();
  }, delayMs);
}

/** 立即推送当前本地数据（设置页"立即同步"按钮用：拉+推走 fullSync 更稳妥） */
export async function pushNow(): Promise<SyncResult> {
  if (syncing) return { ok: false, error: 'sync_in_progress' };
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'not_logged_in' };

  syncing = true;
  setStatus('syncing');
  try {
    // TASK-026：与时钟偏差自愈同款包装（push 幂等，重试安全）
    const failedRows = await withClockSkewRetry(async () => {
      const snap = await readLocalSnapshot();
      const { snapshot: normalized, changed } = normalizeSnapshot(snap);
      if (changed) {
        await writeLocalSnapshot(normalized);
        notifyDataReplaced();
      }
      return pushSnapshot(normalized, userId);
    });
    await AsyncStorage.setItem(LAST_USER_KEY, userId);
    setStatus('idle');
    if (failedRows.length) {
      return { ok: false, error: 'constraint', detail: formatRowFailures(failedRows) };
    }
    return { ok: true };
  } catch (e) {
    console.warn('云端备份失败', e);
    setStatus('error');
    return toSyncResult(e);
  } finally {
    syncing = false;
  }
}
