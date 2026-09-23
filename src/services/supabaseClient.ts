import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/supabaseConfig';

/**
 * Supabase 客户端（全局唯一实例）。
 * - 登录会话持久化到 AsyncStorage：App 重启后自动恢复登录状态
 * - autoRefreshToken：token 过期前自动刷新，长期不打开 app 也不会掉登录
 * - detectSessionInUrl：App 内没有网页跳转回流的场景，关掉
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
