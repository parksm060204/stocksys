import type { StockRecord } from '@/lib/memoryDb/memoryStore';

export const DEFAULT_USD_TO_KRW_RATE = 1380;

export const USD_ETF_TICKERS = new Set([
  'SPY',
  'QQQ',
  'TQQQ',
  'TSLL',
  'NVDL',
  'EWJ',
  'FXI',
]);

export function isUsdQuotedAsset(asset?: {
  currency?: string;
  market?: string;
  ticker?: string;
  theme_ids?: string[];
} | null): boolean {
  if (!asset) return false;
  if (asset.currency === 'USD') return true;
  if (asset.currency === 'KRW') return false;
  const m = asset.market;
  if (m === 'overseas' || m === 'europe' || m === 'us' || m === 'commodities') {
    return true;
  }
  const tickerUpper = asset.ticker ? asset.ticker.toUpperCase() : '';
  if (m === 'etf') {
    if (tickerUpper && USD_ETF_TICKERS.has(tickerUpper)) return true;
    if (Array.isArray(asset.theme_ids) && asset.theme_ids.some((t) => t === 'us' || t === 'global')) {
      return true;
    }
    return false;
  }
  if (!m && tickerUpper && USD_ETF_TICKERS.has(tickerUpper)) {
    return true;
  }
  return false;
}

export function getStockSettlementCurrency(stock?: Partial<StockRecord> | null): 'USD' | 'KRW' {
  return isUsdQuotedAsset(stock) ? 'USD' : 'KRW';
}

export function getUsdFxRateFromDb(
  db?: { exchangeRates?: ReadonlyArray<{ currency_code: string; rate_to_krw: number }> } | null
): number {
  const rates = db?.exchangeRates;
  if (rates) {
    const usd = rates.find((r) => String(r.currency_code || '').toUpperCase() === 'USD');
    if (usd && Number.isFinite(usd.rate_to_krw) && usd.rate_to_krw > 0) {
      return Number(usd.rate_to_krw);
    }
  }
  return DEFAULT_USD_TO_KRW_RATE;
}

export function getStockFxRateToKrw(
  db?: {
    stocks?: ReadonlyMap<string, StockRecord>;
    exchangeRates?: ReadonlyArray<{ currency_code: string; rate_to_krw: number }>;
  } | null,
  stockOrId?: Partial<StockRecord> | string | null
): number {
  if (!stockOrId) return 1;
  const stock =
    typeof stockOrId === 'string'
      ? db?.stocks?.get(stockOrId)
      : stockOrId;
  if (!stock) return 1;
  return getStockSettlementCurrency(stock) === 'USD' ? getUsdFxRateFromDb(db) : 1;
}
