export interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
}

export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: 'CNY', name: '人民币', symbol: '¥' },
  { code: 'USD', name: '美元', symbol: '$' },
  { code: 'EUR', name: '欧元', symbol: '€' },
  { code: 'GBP', name: '英镑', symbol: '£' },
  { code: 'JPY', name: '日元', symbol: '¥' },
  { code: 'MYR', name: '马来西亚令吉', symbol: 'RM' },
  { code: 'SGD', name: '新加坡元', symbol: 'S$' },
  { code: 'HKD', name: '港币', symbol: 'HK$' },
  { code: 'TWD', name: '新台币', symbol: 'NT$' },
  { code: 'AUD', name: '澳元', symbol: 'A$' },
  { code: 'CAD', name: '加元', symbol: 'C$' },
  { code: 'THB', name: '泰铢', symbol: '฿' },
];

export function getCurrencySymbol(code: string): string {
  return CURRENCY_OPTIONS.find((c) => c.code === code)?.symbol ?? '¥';
}
