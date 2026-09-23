// Supabase 云端配置。
// URL 和 anon key 是"公开密钥"（配合数据库 RLS 行级安全使用，本来就要打进 app 包），可以放心放在前端；
// service_role key 是管理员密钥，绝对不能出现在这里或任何前端代码里，将来只放在后端服务器 .env 中。
export const SUPABASE_URL = 'https://sratnkxbwsbvrewkdeii.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNyYXRua3hid3NidnJld2tkZWlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjU3ODcsImV4cCI6MjEwNTA0MTc4N30.0tPREbDqy5Vzigdk7wjxtdycIhcEqdDUO4fJP5WVXVg';

// 登录有效期：连续多少天没有打开过 App，就需要重新登录（安全要求：14 天）
// App 启动恢复会话时检查"距上次活跃是否超期"，超期自动登出并提示重新登录
export const INACTIVITY_LIMIT_MS = 14 * 24 * 60 * 60 * 1000;

// Hostinger 后端地址（Part B）：服务器部署好、域名解析生效后填 'https://你的域名'
// 留空 = 推送 token 不注册（推送功能整体停用），其余功能不受影响
export const BACKEND_URL: string = '';
