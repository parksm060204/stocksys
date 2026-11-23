import { getUsdFxRateFromDb, isUsdQuotedAsset } from '@/lib/engine/currency';

export interface MyPageProfileRow {
  cash?: number | null;
  margin_debt_krw?: number | null;
  usd_balance?: number | null;
  eur_balance?: number | null;
  jpy_balance?: number | null;
  cny_balance?: number | null;
  gbp_balance?: number | null;
}

export interface MyPageStockInfo {
  id: string;
  ticker: string;
  name: string;
  market: string;
  current_price: number;
}

export interface MyPageHoldingRow {
  stock_id: string;
  quantity: number;
  avg_price: number;
  stocks?: MyPageStockInfo | null;
}

export interface MyPageExchangeRateRow {
  currency_code: string;
  rate_to_krw: number;
}

export interface MyPageOptionContractRow {
  id: string;
  ticker: string;
  type?: 'CALL' | 'PUT' | string;
  option_type?: 'CALL' | 'PUT' | string;
  strike_price: number;
  current_price: number;
  multiplier?: number | null;
  expiry_date?: string;
}

export interface MyPageBondRow {
  id: string;
  ticker: string;
  name: string;
  current_price: number;
  face_value?: number | null;
}

export interface MyPagePortfolioRow {
  stockId: string;
  assetKind: 'OPTION' | 'BOND' | 'STOCK';
  href: string;
  name: string;
  ticker: string;
  market: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  valueDisplay: number;
  pnlDisplay: number;
  valueKrw: number;
  costKrw: number;
  pnlKrw: number;
  pnlPct: number;
}

export interface MyPagePortfolioSummary {
  cash: number;
  marginDebtKrw: number;
  usd: number;
  eur: number;
  jpy: number;
  cny: number;
  gbp: number;
  usdToKrw: number;
  rows: MyPagePortfolioRow[];
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPct: number;
  usdInKrw: number;
  eurInKrw: number;
  jpyInKrw: number;
  cnyInKrw: number;
  gbpInKrw: number;
  totalCurrenciesInKrw: number;
  totalAssetsKrw: number;
}

function normalizeExchangeRates(
  ratesData: ReadonlyArray<MyPageExchangeRateRow> | null | undefined
): MyPageExchangeRateRow[] {
  if (!Array.isArray(ratesData)) return [];
  const normalized: MyPageExchangeRateRow[] = [];
  for (const row of ratesData) {
    if (!row || typeof row !== 'object') continue;
    const code = String(row.currency_code || '').trim().toUpperCase();
    const rate = Number(row.rate_to_krw);
    if (code && Number.isFinite(rate) && rate > 0) {
      normalized.push({ currency_code: code, rate_to_krw: rate });
    }
  }
  return normalized;
}

export function computeMyPagePortfolioSummary(params: {
  profile: MyPageProfileRow | null | undefined;
  holdingsData: ReadonlyArray<MyPageHoldingRow> | null | undefined;
  ratesData: ReadonlyArray<MyPageExchangeRateRow> | null | undefined;
  optionsContractsData: ReadonlyArray<MyPageOptionContractRow> | null | undefined;
  bondsData: ReadonlyArray<MyPageBondRow> | null | undefined;
}): MyPagePortfolioSummary {
  const { profile, holdingsData, ratesData, optionsContractsData, bondsData } = params;

  const cash = Number(profile?.cash || 0);
  const marginDebtKrw = Math.max(0, Number(profile?.margin_debt_krw || 0));
  const usd = Number(profile?.usd_balance || 0);
  const eur = Number(profile?.eur_balance || 0);
  const jpy = Number(profile?.jpy_balance || 0);
  const cny = Number(profile?.cny_balance || 0);
  const gbp = Number(profile?.gbp_balance || 0);

  const exchangeRates = normalizeExchangeRates(ratesData);
  const ratesMap = new Map<string, number>(
    exchangeRates.map((r) => [r.currency_code, r.rate_to_krw])
  );
  const usdToKrw = getUsdFxRateFromDb({ exchangeRates });
  const getRate = (code: string): number => {
    const normalizedCode = code.toUpperCase();
    if (normalizedCode === 'USD') return usdToKrw;
    const found = ratesMap.get(normalizedCode);
    return found !== undefined && Number.isFinite(found) && found > 0 ? found : 1;
  };

  const optionById = new Map<string, MyPageOptionContractRow>(
    (optionsContractsData || []).map((o) => [o.id, o])
  );
  const bondById = new Map<string, MyPageBondRow>(
    (bondsData || []).map((b) => [b.id, b])
  );

  const rows: MyPagePortfolioRow[] = (holdingsData || []).map((h) => {
    const stock = h.stocks;
    const opt = !stock ? optionById.get(h.stock_id) : null;
    const bond = !stock && !opt ? bondById.get(h.stock_id) : null;
    const quantity = Number(h.quantity || 0);
    const avgPrice = Number(h.avg_price || 0);

    if (opt) {
      const currentPrice = Number(opt.current_price ?? avgPrice);
      const multiplier = Number(opt.multiplier ?? 250000);
      const valueKrw = Math.round(currentPrice * quantity * multiplier);
      const costKrw = Math.round(avgPrice * quantity * multiplier);
      const pnlKrw = valueKrw - costKrw;
      const pnlPct = costKrw !== 0 ? (pnlKrw / costKrw) * 100 : 0;
      const optType = opt.option_type || opt.type || 'OPTION';
      return {
        stockId: h.stock_id,
        assetKind: 'OPTION' as const,
        href: '/options',
        name: `${opt.ticker} (${optType})`,
        ticker: `승수 ₩${multiplier.toLocaleString()} · 행사가 ${Number(opt.strike_price || 0).toLocaleString()}`,
        market: 'domestic',
        quantity,
        avgPrice,
        currentPrice,
        valueDisplay: valueKrw,
        pnlDisplay: pnlKrw,
        valueKrw,
        costKrw,
        pnlKrw,
        pnlPct,
      };
    }

    if (bond) {
      const currentPrice = Number(bond.current_price ?? avgPrice);
      const faceValue = Number(bond.face_value ?? 10000);
      const unitFactor = faceValue / 100;
      const valueKrw = Math.round(currentPrice * unitFactor * quantity);
      const costKrw = Math.round(avgPrice * unitFactor * quantity);
      const pnlKrw = valueKrw - costKrw;
      const pnlPct = costKrw !== 0 ? (pnlKrw / costKrw) * 100 : 0;
      return {
        stockId: h.stock_id,
        assetKind: 'BOND' as const,
        href: `/stocks/${h.stock_id}`,
        name: bond.name || bond.ticker || '채권',
        ticker: bond.ticker || 'BOND',
        market: 'domestic',
        quantity,
        avgPrice,
        currentPrice,
        valueDisplay: valueKrw,
        pnlDisplay: pnlKrw,
        valueKrw,
        costKrw,
        pnlKrw,
        pnlPct,
      };
    }

    const currentPrice = Number(stock?.current_price || h.avg_price);
    const market = stock?.market || 'domestic';
    const ticker = stock?.ticker || 'UNKN';
    const isUsd = Boolean(stock && isUsdQuotedAsset({ market, ticker }));
    const fxRate = isUsd ? usdToKrw : 1;

    const valueDisplay = currentPrice * quantity;
    const costDisplay = avgPrice * quantity;
    const pnlDisplay = valueDisplay - costDisplay;
    const valueKrw = isUsd ? Math.round(valueDisplay * fxRate) : Math.round(valueDisplay);
    const costKrw = isUsd ? Math.round(costDisplay * fxRate) : Math.round(costDisplay);
    const pnlKrw = valueKrw - costKrw;
    const pnlPct = costKrw !== 0 ? (pnlKrw / costKrw) * 100 : 0;

    return {
      stockId: h.stock_id,
      assetKind: 'STOCK' as const,
      href: `/stocks/${h.stock_id}`,
      name: stock?.name || '알 수 없는 종목',
      ticker,
      market,
      quantity,
      avgPrice,
      currentPrice,
      valueDisplay,
      pnlDisplay,
      valueKrw,
      costKrw,
      pnlKrw,
      pnlPct,
    };
  });

  const totalValue = rows.reduce((a, r) => a + Number(r.valueKrw || 0), 0);
  const totalCost = rows.reduce((a, r) => a + Number(r.costKrw || 0), 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost !== 0 ? (totalPnl / totalCost) * 100 : 0;

  const usdInKrw = usd * usdToKrw;
  const eurInKrw = eur * getRate('EUR');
  const jpyInKrw = jpy * getRate('JPY');
  const cnyInKrw = cny * getRate('CNY');
  const gbpInKrw = gbp * getRate('GBP');
  const totalCurrenciesInKrw =
    cash + usdInKrw + eurInKrw + jpyInKrw + cnyInKrw + gbpInKrw - marginDebtKrw;
  const totalAssetsKrw = totalValue + totalCurrenciesInKrw;

  return {
    cash,
    marginDebtKrw,
    usd,
    eur,
    jpy,
    cny,
    gbp,
    usdToKrw,
    rows,
    totalValue,
    totalCost,
    totalPnl,
    totalPnlPct,
    usdInKrw,
    eurInKrw,
    jpyInKrw,
    cnyInKrw,
    gbpInKrw,
    totalCurrenciesInKrw,
    totalAssetsKrw,
  };
}
