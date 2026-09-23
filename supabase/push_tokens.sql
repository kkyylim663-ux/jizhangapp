-- ============================================================
-- Part B：推送 token 表 + 汇率缓存表
-- 执行方式：Supabase Dashboard → SQL Editor → 粘贴 → Run（幂等，可重复执行）
-- ============================================================

create extension if not exists moddatetime;

-- push_tokens：每台设备一个 Expo Push Token，后端用 service_role 写入
create table if not exists public.push_tokens (
  token text primary key,              -- ExpoPushToken[xxxxxx]
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text,                       -- ios | android
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_push_tokens_user
  on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- 用户只能管理自己的 token（后端用 service_role 绕过 RLS 统一写入）
drop policy if exists "own_tokens_all" on public.push_tokens;
create policy "own_tokens_all" on public.push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists set_updated_at on public.push_tokens;
create trigger set_updated_at before update on public.push_tokens
  for each row execute procedure moddatetime(updated_at);

-- exchange_rates：每日定时抓取的汇率缓存（公开数据，登录用户可读）
create table if not exists public.exchange_rates (
  base text primary key,               -- 基准货币，如 'MYR'
  rates jsonb not null,                -- {"USD":0.21,"SGD":0.28,...}
  fetched_at timestamptz not null default now()
);

alter table public.exchange_rates enable row level security;

drop policy if exists "rates_read_authenticated" on public.exchange_rates;
create policy "rates_read_authenticated" on public.exchange_rates
  for select to authenticated using (true);
