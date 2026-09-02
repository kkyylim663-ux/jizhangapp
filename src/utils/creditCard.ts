import { Asset } from '../types';

// 信用卡列表/选择器里应该显示"还剩多少能刷"，而不是"欠了多少钱"——
// 这两个数分别是 (额度 - 已用) 和 (已用)，是反过来的关系，别搞混。
// 其它类型的账户（现金/银行卡等）没有额度这回事，直接原样返回余额。
//
// 注意：这里只需要 creditLimit，不需要账单日/还款日/交易记录——
// 那些是 AssetScreen 里"信用卡详情"弹窗才要算的逾期利息之类的更细信息，
// 跟这里"要不要显示可用额度"是两回事，别把这个函数写复杂了。
export function getAssetDisplayBalance(asset: Pick<Asset, 'type' | 'creditLimit'>, balance: number): number {
  if (asset.type === 'credit') {
    const totalOwed = Math.max(0, -balance); // balance 是负数代表欠款
    return (asset.creditLimit ?? 0) - totalOwed;
  }
  return balance;
}

// 转账/兑换场景关心的是另一个数：信用卡这时候要么是"借出去会欠多少"（作为转出账户），
// 要么是"这次要还多少债"（作为转入账户，即还款）——这两种场景都是在跟"欠费"打交道，
// 跟"支出/收入"场景里"这张卡还能刷多少"（可用额度）是两码事，不能共用同一个数字。
// 其它类型账户没有"欠费"这个概念，转账场景下就还是看余额本身。
export function getAssetTransferBalance(asset: Pick<Asset, 'type'>, balance: number): number {
  if (asset.type === 'credit') {
    return Math.max(0, -balance); // 欠费金额，balance 是负数代表欠款
  }
  return balance;
}