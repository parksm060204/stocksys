import type { StockRecord, BondRecord } from '@/lib/memoryDb/memoryStore';

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

/**
 * 채권 호가(예: 액면 100 기준 99.80)를 1계약당 원화 기준 액면(예: 10,000원)으로 환산하는 승수를 반환한다.
 * quote_base가 명시되었거나, 액면가(>=1000) 대비 시세가 액면 100 기준 구간(<500)이면 face_value / 100을 적용한다.
 */
export function getBondQuoteMultiplierToKrw(bond?: Partial<BondRecord> | null): number {
  if (!bond) return 1;
  const faceValue = Number(bond.face_value ?? 0);
  if (!Number.isFinite(faceValue) || faceValue <= 0) return 1;
  if (typeof bond.quote_base === 'number' && Number.isFinite(bond.quote_base) && bond.quote_base > 0) {
    return faceValue / bond.quote_base;
  }
  const curPrice = Number(bond.current_price ?? 0);
  if (faceValue >= 1000 && Number.isFinite(curPrice) && curPrice > 0 && curPrice < 500) {
    return faceValue / 100;
  }
  return 1;
}

export function getAssetSettlementPriceMultiplierToKrw(
  db?: {
    stocks?: ReadonlyMap<string, StockRecord>;
    bonds?: ReadonlyMap<string, BondRecord>;
    exchangeRates?: ReadonlyArray<{ currency_code: string; rate_to_krw: number }>;
  } | null,
  assetId?: string | null
): number {
  if (!assetId || !db) return 1;
  const stock = db.stocks?.get(assetId);
  if (stock) {
    return getStockFxRateToKrw(db, stock);
  }
  const bond = db.bonds?.get(assetId);
  if (bond) {
    return getBondQuoteMultiplierToKrw(bond);
  }
  return 1;
}
