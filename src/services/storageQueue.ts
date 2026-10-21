/**
 * 本地 AsyncStorage 读写串行化队列。
 *
 * AppContext 的持久化 effect 会把整张数组整体写回；云同步的「读本地 → 与云端合并 → 写回本地」
 * 如果与之交错执行，就会互相覆盖（用户在同步网络请求期间的编辑被旧快照盖掉）。
 * 所有需要互斥的存储操作都经 runStorageExclusive 排队，按入队顺序一个接一个执行。
 *
 * 注意：任务内部不能再嵌套调用 runStorageExclusive（会死锁）。
 */
let tail: Promise<void> = Promise.resolve();

export function runStorageExclusive<T>(task: () => Promise<T>): Promise<T> {
  const next = tail.then(task);
  // 队列尾部永远是 resolved 的，单个任务失败不会阻塞后面的任务
  tail = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}
