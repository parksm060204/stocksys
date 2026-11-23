import { isUsdQuotedAsset } from '@/lib/engine/currency';

export interface TickChartAssetMeta {
  market?: string;
  currency?: string;
  theme_ids?: string[];
}

export function isUsdTickChartAsset(
  ticker: string,
  assetMeta?: TickChartAssetMeta
): boolean {
  if (assetMeta?.currency || assetMeta?.market || assetMeta?.theme_ids) {
    return isUsdQuotedAsset({
      ticker,
      market: assetMeta.market,
      currency: assetMeta.currency,
      theme_ids: assetMeta.theme_ids,
    });
  }
  if (isUsdQuotedAsset({ ticker })) return true;
  const upper = ticker.toUpperCase();
  if (/^\d+$/.test(upper) || upper.startsWith('KODEX') || upper.startsWith('TIGER')) {
    return false;
  }
  return /[A-Z]/.test(upper);
}

export function getStockTickSize(
  price: number,
  ticker: string,
  assetMeta?: TickChartAssetMeta
): number {
  const isUS = isUsdTickChartAsset(ticker, assetMeta);
  if (isUS) return 0.01;
  if (price <= 0) return 1;
  if (price < 2000) return 1;
  if (price < 5000) return 5;
  if (price < 20000) return 10;
  if (price < 50000) return 50;
  if (price < 200000) return 100;
  if (price < 500000) return 500;
  return 1000;
}
