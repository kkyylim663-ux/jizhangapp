# jizhang-backend 部署指南（Hostinger VPS + Ubuntu 22.04+）

对应《基础设施搭建指南》Part B。App 端只需要在部署完成后把域名填进
`src/config/supabaseConfig.ts` 的 `BACKEND_URL`。

## 前提

- Hostinger **KVM VPS**（不是 Shared Hosting），系统 **Ubuntu 22.04/24.04**
- 一个域名（如 `api.example.com`），在域名 DNS 里加一条 **A 记录** 指向 VPS 的公网 IP
- Supabase 的 **service_role key**：Dashboard → Project Settings → API Keys → `service_role` / `secret`
  ⚠️ 这是管理员密钥，只放服务器 `.env`，绝不提交 git、绝不放进 App

## 一、服务器基础环境（SSH 进 VPS 后逐条执行）

```bash
# 更新系统 + 基础工具
apt update && apt upgrade -y
apt install -y nginx git curl

# Node.js 20（NodeSource 源）
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# pm2（进程守护，开机自启用）
npm install -g pm2
```

## 二、部署代码

```bash
mkdir -p /var/www && cd /var/www
# 方式1：git clone 本仓库；方式2：SFTP 直接把 backend/ 文件夹上传
cd /var/www/jizhang-backend   # = 仓库里的 backend/ 目录

npm install
cp .env.example .env
nano .env      # 填入 SUPABASE_SERVICE_ROLE_KEY，确认 SUPABASE_URL 正确
```

启动并设置开机自启：

```bash
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup      # 按它输出的最后一条命令复制执行一遍
```

验证：`curl http://127.0.0.1:3000/api/health` 应返回 `{"ok":true,...}`

## 三、Nginx 反向代理 + HTTPS

```bash
nano /etc/nginx/sites-available/jizhang
```

写入（把 `api.example.com` 换成你的域名）：

```nginx
server {
    listen 80;
    server_name api.example.com;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用并申请免费 SSL 证书：

```bash
ln -s /etc/nginx/sites-available/jizhang /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.example.com     # 自动改写为 HTTPS + 自动续期
```

外网验证：浏览器打开 `https://api.example.com/api/health` → `{"ok":true,...}`

## 四、Supabase 侧（1 分钟）

Dashboard → SQL Editor → 粘贴执行本仓库的 `supabase/push_tokens.sql`
（创建 push_tokens 表 + exchange_rates 缓存表，幂等可重复执行）

## 五、App 端接入（1 分钟）

1. `src/config/supabaseConfig.ts` → `BACKEND_URL = 'https://api.example.com'`
2. Metro reload；App 打开时若已登录且通知权限已授予，token 自动注册到后端
3. 后台验证：`pm2 logs jizhang-backend` 能看到请求日志；
   Supabase Table Editor → push_tokens 出现设备记录

## 六、监控（可选但建议）

- UptimeRobot（免费）：监控 `https://api.example.com/api/health`，挂了发邮件
- `pm2 logs jizhang-backend` / `pm2 monit` 看运行状态

## 接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/health | 健康检查（无需登录） |
| POST | /api/register-push-token | 注册推送 token，body: `{ token, platform? }`，Header 带 Supabase access_token |
| POST | /api/unregister-push-token | 注销 token，body: `{ token }` |
| GET | /api/rates?base=MYR | 最新汇率（24h 缓存） |

定时任务：每日按 `RATES_REFRESH_CRON` 抓汇率入库；
`PUSH_REMINDER_ENABLED=true` 时按 `PUSH_REMINDER_CRON` 给所有设备发记账提醒。

## 常见问题

- **502 Bad Gateway**：pm2 没起来 → `pm2 logs` 看报错（多半是 .env 没填对）
- **curl 本机通、外网不通**：Hostinger 面板防火墙放行 80/443 端口
- **证书续期**：certbot 装好后自动续期，`certbot renew --dry-run` 可手动验证
