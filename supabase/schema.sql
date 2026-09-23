-- ============================================================
-- 记账 App 云端数据库（Part A）
-- 执行方式：Supabase Dashboard → SQL Editor → New query →
--           粘贴本文件全部内容 → Run
-- 可重复执行（幂等）：表和策略都用 IF NOT EXISTS / DROP POLICY IF EXISTS 处理
-- 安全：每张表都启用 RLS，策略统一限定 user_id = auth.uid()，
--       即每个登录用户只能读写自己的数据；anon key 泄露也读不到别人数据。
-- ============================================================

-- updated_at 自动维护用的扩展（Supabase 内置）
create extension if not exists moddatetime;

-- ------------------------------------------------------------
-- profiles：用户补充资料 + 显示设置（AppContext 里的偏好项）
-- ------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  currency text,                       -- 全局货币，如 'MYR'
  date_format text,                    -- 'YYYY/MM/DD' 等
  week_starts_on smallint,             -- 0=周日 1=周一
  decimal_places smallint,             -- 0/1/2
  period_preference jsonb,             -- {type, customStart?, customEnd?}
  active_ledger_id text,               -- 当前使用的账本 id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- ledgers：账本
-- ------------------------------------------------------------
create table if not exists public.ledgers (
  id text primary key,                 -- 沿用 App 生成的字符串 id（离线可建、上云不错乱）
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text not null,
  color text,
  created_at bigint not null,          -- App 端 Date.now() 毫秒，原样保存
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- assets：资产账户（现金/银行/信用卡/电子钱包/投资/其他）
-- ------------------------------------------------------------
create table if not exists public.assets (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text not null,
  color text not null,
  type text not null,                  -- cash|bank|credit|ewallet|investment|other
  currency text not null,
  initial_balance numeric not null default 0,
  ledger_id text not null,
  credit_limit numeric,                -- 以下字段仅信用卡用
  statement_day smallint,
  due_day smallint,
  interest_rate numeric,
  is_default boolean,
  created_at bigint not null,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- category_groups：用户自定义收支大类
-- App 端大类以 name 为唯一键（同类名不重复），故 id 直接用 name
-- ------------------------------------------------------------
create table if not exists public.category_groups (
  id text primary key,                 -- = name
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text,
  icon text,
  type text not null,                  -- expense|income
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- categories：收支分类（group_name 对应 App 端 Category.group，
-- 存大类名而不是外键，与 App 数据模型一致，避免删除大类时约束报错）
-- ------------------------------------------------------------
create table if not exists public.categories (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text not null,
  color text,
  type text not null,                  -- expense|income
  group_name text,                     -- 所属大类名（空 = 无分组）
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- transactions：记账流水（支出/收入/转账/汇兑）
-- ------------------------------------------------------------
create table if not exists public.transactions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric not null,
  type text not null,                  -- expense|income|transfer
  category_id text not null default '',
  date text not null,                  -- App 端原始日期字符串（YYYY-MM-DD）
  note text not null default '',
  display_name text,                   -- 无分类时的显示标题（如计划付款"房租"）
  ledger_id text not null,
  asset_id text,                       -- 单资产交易
  from_asset_id text,                  -- 转账/汇兑：转出账户
  to_asset_id text,                    -- 转账/汇兑：转入账户
  exchange_rate numeric,               -- 汇率
  converted_amount numeric,            -- 转入金额
  fee numeric,                         -- 手续费
  receipt_path text,                   -- 小票图片（Part B 接 Storage 上传，先存路径）
  created_at bigint not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_transactions_user_date
  on public.transactions (user_id, date desc);

-- ------------------------------------------------------------
-- budgets：预算（同一分类可按币种各一条）
-- App 端预算没有 id，id 由 分类id+币种 确定性生成，保证多端一致
-- ------------------------------------------------------------
create table if not exists public.budgets (
  id text primary key,                 -- = categoryId + '|' + (currency ?? '')
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id text not null,
  amount numeric not null,
  currency text,                       -- 空 = 跟随全局货币
  updated_at timestamptz not null default now()
);

-- ============================================================
-- RLS：全部启用，策略统一"只能操作自己的行"
-- ============================================================
alter table public.profiles        enable row level security;
alter table public.ledgers         enable row level security;
alter table public.assets          enable row level security;
alter table public.category_groups enable row level security;
alter table public.categories      enable row level security;
alter table public.transactions    enable row level security;
alter table public.budgets         enable row level security;

do $$
declare tbl text;
begin
  foreach tbl in array array['profiles','ledgers','assets','category_groups','categories','transactions','budgets']
  loop
    execute format('drop policy if exists "own_rows_all" on public.%I', tbl);
    execute format(
      'create policy "own_rows_all" on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', tbl);
  end loop;
end $$;

-- updated_at 自动更新触发器（update 时刷新）
do $$
declare tbl text;
begin
  foreach tbl in array array['profiles','ledgers','assets','category_groups','categories','transactions','budgets']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', tbl);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute procedure moddatetime(updated_at)', tbl);
  end loop;
end $$;

-- ============================================================
-- Storage：小票图片桶（私有）。按 user_id 一级目录隔离：
-- 上传路径必须是 `{user_id}/文件名`，策略限制只能访问自己目录
-- （图片上传功能 Part B 接入，这里先把桶和权限建好）
-- ============================================================
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists "receipts_select_own" on storage.objects;
drop policy if exists "receipts_insert_own" on storage.objects;
drop policy if exists "receipts_update_own" on storage.objects;
drop policy if exists "receipts_delete_own" on storage.objects;

create policy "receipts_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "receipts_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "receipts_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "receipts_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
