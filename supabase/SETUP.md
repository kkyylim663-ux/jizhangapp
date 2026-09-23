# Supabase 数据库上线指引（Part A）

App 端代码已全部接好。你只需要完成下面 3 步网页操作（约 2 分钟）。

## 第 1 步：执行建表 SQL

1. 打开 https://supabase.com 登录，进入你的项目（sratnkxbwsbvrewkdeii）
2. 左侧边栏点 **SQL Editor**（图标像终端）
3. 点 **New query**（新建查询）
4. 把本仓库 `supabase/schema.sql` 的全部内容复制进去，点 **Run**（右下角）
5. 显示 `Success. No rows returned` 即成功

执行后可以在左侧 **Table Editor** 看到 7 张表：profiles、ledgers、assets、
category_groups、categories、transactions、budgets。

## 第 2 步：关闭邮箱验证（建议，可跳过）

1. 左下角 **Project Settings**（齿轮）→ **Authentication**
2. 找到 **Sign In / Providers → Email** 里的 **Confirm email** 开关
3. 关掉它 → 注册后无需去邮箱点验证，直接登录

> 不关也能用：注册后 App 会提示"请先到邮箱点击验证链接再回来登录"。

## 第 3 步：在 App 里验证

1. 重新启动 App（如果 Metro 在跑，按 `r` reload）
2. 设置项 → 最上方「账号与同步」→ 输入邮箱和密码（≥6 位）→ **注册账号**
3. 随便记几笔账、加个资产账户 → 等 2 秒（自动防抖备份）
4. 打开 Supabase **Table Editor → transactions**，应能看到刚记的流水（user_id 是你的账号 ID）
5. **模拟换手机**：手机上清除 App 数据（或卸载重装）→ 打开 App → 设置项里用同一邮箱**登录**
6. 首页/资产/统计里应出现你之前的全部资料

## 同步规则速查

- 登录状态下每次数据变化 2 秒后自动备份到云端（离线时记的账，联网后自动补传）
- 未登录 = 纯本地行为，一切照旧
- 换新手机：本地是空的，登录后自动从云端恢复
- 老用户首次绑定账号：本地已有数据原样上传
- 两边都有数据：按行合并（同一条记录以云端为准，各自独有记录都保留），不会静默丢数据
- 退出登录：本机数据保留，只是暂停同步

## 安全说明

- App 里只放 `anon key`（公开密钥）+ 数据库 RLS 行级安全：每行都有 `user_id`，
  策略限定用户只能读写自己的数据，拿到 anon key 也读不到别人的账
- `service_role key`（管理员密钥）从未进入 App 代码；Part B 的 Hostinger 后端才会用它，只放服务器 `.env`

## Part B 待办（下一轮）

- Hostinger VPS 部署 Node.js 后端：推送通知注册接口（替换 `notifications.ts` 里的占位 URL）、每日汇率、HTTPS + 域名
- 收据图片上传 Supabase Storage（bucket `receipts` 和权限已建好）
- 隐私政策页面（上架前必须）
