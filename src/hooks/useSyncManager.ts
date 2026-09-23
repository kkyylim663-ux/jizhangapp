import { useEffect } from 'react';
import { fullSync } from '../services/syncService';
import { useAuth } from '../context/AuthContext';

/**
 * 同步管理器：挂在 AppContent（同时能拿到登录态）。
 * 登录成功或重启后恢复了登录态 → 做一次完整同步：
 * 云端拉取 → 与本地合并 → 写回本地并刷新界面 → 合并结果推上云。
 * 未登录时什么也不做，App 保持纯本地行为。
 *
 * 后续的数据变化推送不走这里：AppContext 数据变化后直接调 syncService.schedulePush()。
 */
export function useSyncManager() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    void fullSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
}
