/**
 * 记账 App 后端（部署在 Hostinger VPS，Nginx 反向代理到本服务）
 *
 * 职责（对应基础设施清单 Part B）：
 *  1. POST /api/register-push-token   接收 App 端推送 token（用登录会话验签，按 auth.uid() 归档）
 *  2. POST /api/unregister-push-token 删除 token（登出/换设备时）
 *  3. GET  /api/rates                 汇率查询（带 Supabase 缓存，超过 24 小时自动抓新）
 *  4. 定时任务：每日抓汇率入库；可选每日记账提醒推播（Expo Push API）
 *  5. 预留：RevenueCat webhook 接收端点（订阅功能上线时扩展）
 *
 * 安全：
 *  - 对外只经 Nginx HTTPS；本服务只监听 127.0.0.1
 *  - service_role key 只存在于本机 .env，绝不进 git、绝不进 App
 *  - 出站请求都是代码里写死的 https 常量地址（er-api / expo push），不接受客户端传 URL
 *  - 所有数据库操作走 supabase-js（PostgREST 参数化），无字符串拼 SQL
 */

require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RATES_BASE = (process.env.RATES_BASE || 'MYR').toUpperCase();
const RATES_REFRESH_CRON = process.env.RATES_REFRESH_CRON || '0 7 * * *';
const PUSH_REMINDER_ENABLED = process.env.PUSH_REMINDER_ENABLED === 'true';
const PUSH_REMINDER_CRON = process.env.PUSH_REMINDER_CRON || '0 14 * * *';
const RATES_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 缓存超过 24 小时视为过期

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，请检查 .env');
  process.exit(1);
}

// service_role 客户端：只在本机使用；不做会话持久化
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

// ─── 简单内存限流：同一 IP 每分钟最多 30 次 ───────────────────────────
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const hits = new Map();

function rateLimit(req, res, next) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let entry = hits.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    entry = { count: 0, start: now };
    hits.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count > RATE_MAX) return res.status(429).json({ error: 'Too many requests' });
  next();
}

// ─── 身份校验：Authorization: Bearer <Supabase access_token> ─────────
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data || !data.user) return res.status(401).json({ error: 'Invalid token' });
  req.user = data.user;
  next();
}

// Expo push token 形如 ExpoPushToken[xxxxxxxx-xxxx-...]
const EXPO_TOKEN_RE = /^ExpoPushToken\[[A-Za-z0-9_-]+\]$/;

// ─── 健康检查（监控用，如 UptimeRobot）────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ─── 推送 token 注册 ──────────────────────────────────────────────────
app.post('/api/register-push-token', rateLimit, requireAuth, async (req, res) => {
  try {
    const { token, platform } = req.body || {};
    if (typeof token !== 'string' || !EXPO_TOKEN_RE.test(token)) {
      return res.status(400).json({ error: 'Invalid expo push token' });
    }
    if (platform !== undefined && !['ios', 'android'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }
    // 用户身份以验签结果为准，不信任请求体里自带的 userId
    const row = { token, user_id: req.user.id, platform: platform ?? null };
    const { error } = await supabaseAdmin.from('push_tokens').upsert(row);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error('[register-push-token]', e.message);
    res.status(500).json({ error: 'Failed to save token' });
  }
});

// ─── 推送 token 注销（登出/换设备）────────────────────────────────────
app.post('/api/unregister-push-token', rateLimit, requireAuth, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (typeof token !== 'string' || !EXPO_TOKEN_RE.test(token)) {
      return res.status(400).json({ error: 'Invalid expo push token' });
    }
    await supabaseAdmin.from('push_tokens').delete().eq('token', token).eq('user_id', req.user.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[unregister-push-token]', e.message);
    res.status(500).json({ error: 'Failed to remove token' });
  }
});

// ─── 汇率查询（?base=USD 可选，默认 MYR）──────────────────────────────
app.get('/api/rates', rateLimit, requireAuth, async (req, res) => {
  try {
    const base = String(req.query.base || RATES_BASE).toUpperCase().slice(0, 3);
    if (!/^[A-Z]{3}$/.test(base) || !ALLOWED_CURRENCIES.has(base)) {
      return res.status(400).json({ error: 'Invalid base currency' });
    }

    const { data } = await supabaseAdmin
      .from('exchange_rates')
      .select('*')
      .eq('base', base)
      .maybeSingle();

    const isFresh = data && Date.now() - new Date(data.fetched_at).getTime() < RATES_MAX_AGE_MS;
    if (isFresh) {
      return res.json({ base: data.base, rates: data.rates, fetched_at: data.fetched_at, cached: true });
    }
    const rates = await fetchAndStoreRates(base);
    res.json({ base, rates, fetched_at: new Date().toISOString(), cached: false });
  } catch (e) {
    console.error('[rates]', e.message);
    res.status(502).json({ error: 'Rate fetch failed' });
  }
});

// ─── SSRF 防护：出站请求目标完全固定 ──────────────────────────────────
// 1) 汇率源 host 是代码常量；path 里的货币码必须命中白名单（纯字母 ISO 4217 子集），
//    任何含 : / @ . ? # 的输入都进不来，无法改写 host 或跳到内网
// 2) fetch 禁止跟随重定向（redirect: 'manual'），防止被 30x 引到别处
const ALLOWED_CURRENCIES = new Set([
  'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP',
  'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR',
  'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'RUB', 'SEK', 'SGD', 'THB', 'TRY',
  'TWD', 'USD', 'VND', 'ZAR',
]);

if (!ALLOWED_CURRENCIES.has(RATES_BASE)) {
  console.error(`RATES_BASE=${RATES_BASE} 不在白名单内，请检查 .env`);
  process.exit(1);
}

// 抓汇率（固定 https 源 + 白名单货币码 + 禁止重定向）
async function fetchAndStoreRates(base) {
  const res = await fetch(`https://open.er-api.com/v6/latest/${base}`, { redirect: 'manual' });
  if (!res.ok) throw new Error(`rates http ${res.status}`);
  const json = await res.json();
  if (json.result !== 'success' || !json.rates) throw new Error('rates payload invalid');
  const fetchedAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('exchange_rates')
    .upsert({ base, rates: json.rates, fetched_at: fetchedAt });
  if (error) throw error;
  return json.rates;
}

// ─── 定时任务 ─────────────────────────────────────────────────────────

async function ratesJob() {
  try {
    await fetchAndStoreRates(RATES_BASE);
    console.log(`[cron] 汇率已刷新 (${RATES_BASE})`);
  } catch (e) {
    console.error('[cron] 汇率刷新失败:', e.message);
  }
}

// 每日记账提醒：给所有注册过 token 的设备推一条通知
async function pushReminderJob() {
  try {
    const { data: tokens, error } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .limit(10000);
    if (error) throw error;
    if (!tokens || tokens.length === 0) return;

    const messages = tokens.map((t) => ({
      to: t.token,
      title: '记账提醒',
      body: '今天记过账了吗？花一分钟把今天的收支记下来吧 💰',
      channelId: 'default',
    }));
    // Expo Push API 每次最多 100 条
    for (let i = 0; i < messages.length; i += 100) {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
      if (!res.ok) throw new Error(`expo push http ${res.status}`);
    }
    console.log(`[cron] 记账提醒已推送给 ${messages.length} 台设备`);
  } catch (e) {
    console.error('[cron] 记账提醒失败:', e.message);
  }
}

cron.schedule(RATES_REFRESH_CRON, ratesJob, { timezone: process.env.TZ || 'UTC' });
if (PUSH_REMINDER_ENABLED) {
  cron.schedule(PUSH_REMINDER_CRON, pushReminderJob, { timezone: process.env.TZ || 'UTC' });
}

// 启动后先刷一次汇率（有缓存命中也不会有开销问题）
setTimeout(ratesJob, 5000);

app.listen(PORT, '127.0.0.1', () => {
  console.log(`jizhang-backend 已启动: http://127.0.0.1:${PORT} (TZ=${process.env.TZ || 'UTC'})`);
  console.log(`汇率定时任务: ${RATES_REFRESH_CRON} | 记账提醒: ${PUSH_REMINDER_ENABLED ? PUSH_REMINDER_CRON : '关闭'}`);
});
