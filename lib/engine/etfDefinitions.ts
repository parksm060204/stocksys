import { createClient } from '@/lib/supabase/client';
import { ETFDefinition } from './etfTypes';

export interface ExtendedETFDefinition extends ETFDefinition {
  category: 'KOREA' | 'US' | 'GLOBAL' | 'LEVERAGE' | 'SECTOR';
  basePrice: number;
}

export const ETF_CATALOG: ExtendedETFDefinition[] = [
  // 1) 한국 대표 ETF
  {
    etfTicker: 'KODEX200',
    name: 'KODEX 200',
    category: 'KOREA',
    underlyingType: 'EQUITY',
    leverageFactor: 1,
    basePrice: 35000,
    cuSize: 50000,
    cashComponent: 10000,
    pdf: [
      { ticker: 'SAMSUNG_ELEC', sharesPerCU: 150, weight: 30 },
      { ticker: 'SK_HYNIX', sharesPerCU: 50, weight: 20 },
      { ticker: 'HYUNDAI_MOTOR', sharesPerCU: 30, weight: 15 }
    ],
    totalOutstandingUnits: 10000000
  },
  {
    etfTicker: 'KODEXLEV',
    name: 'KODEX 레버리지 (+2X)',
    category: 'LEVERAGE',
    underlyingType: 'DERIVATIVE',
    leverageFactor: 2,
    basePrice: 17000,
    cuSize: 50000,
    cashComponent: 15000,
    pdf: [
      { ticker: 'KOSPI200_FUTURES', sharesPerCU: 10, weight: 80 },
      { ticker: 'SAMSUNG_ELEC', sharesPerCU: 100, weight: 20 }
    ],
    totalOutstandingUnits: 8000000
  },
  {
    etfTicker: 'KODEXINV2X',
    name: 'KODEX 200선물인버스2X (곱버스 -2X)',
    category: 'LEVERAGE',
    underlyingType: 'DERIVATIVE',
    leverageFactor: -2,
    basePrice: 2500,
    cuSize: 50000,
    cashComponent: 5000,
    pdf: [
      { ticker: 'KOSPI200_FUTURES', sharesPerCU: 10, weight: 100 }
    ],
    totalOutstandingUnits: 12000000
  },
  {
    etfTicker: 'KODEXSEMI',
    name: 'KODEX 반도체',
    category: 'SECTOR',
    underlyingType: 'EQUITY',
    leverageFactor: 1,
    basePrice: 32000,
    cuSize: 50000,
    cashComponent: 8000,
    pdf: [
      { ticker: 'SAMSUNG_ELEC', sharesPerCU: 200, weight: 60 },
      { ticker: 'SK_HYNIX', sharesPerCU: 100, weight: 40 }
    ],
    totalOutstandingUnits: 3000000
  },
  {
    etfTicker: 'TIGERBAT',
    name: 'TIGER 2차전지테마',
    category: 'SECTOR',
    underlyingType: 'EQUITY',
    leverageFactor: 1,
    basePrice: 25000,
    cuSize: 50000,
    cashComponent: 6000,
    pdf: [
      { ticker: 'LG_ENERGY', sharesPerCU: 50, weight: 50 },
      { ticker: 'POSCO_HOLDINGS', sharesPerCU: 40, weight: 50 }
    ],
    totalOutstandingUnits: 4000000
  },

  // 2) 미국 대표 ETF
  {
    etfTicker: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    category: 'US',
    underlyingType: 'EQUITY',
    leverageFactor: 1,
    basePrice: 500,
    cuSize: 50000,
    cashComponent: 1000,
    pdf: [
      { ticker: 'AAPL', sharesPerCU: 100, weight: 35 },
      { ticker: 'MSFT', sharesPerCU: 80, weight: 35 },
      { ticker: 'NVDA', sharesPerCU: 50, weight: 30 }
    ],
    totalOutstandingUnits: 50000000
  },
  {
    etfTicker: 'QQQ',
    name: 'Invesco QQQ Trust (나스닥 100)',
    category: 'US',
    underlyingType: 'EQUITY',
    leverageFactor: 1,
    basePrice: 430,
    cuSize: 50000,
    cashComponent: 800,
    pdf: [
      { ticker: 'NVDA', sharesPerCU: 120, weight: 40 },
      { ticker: 'AAPL', sharesPerCU: 100, weight: 30 },
      { ticker: 'TSLA', sharesPerCU: 80, weight: 30 }
    ],
    totalOutstandingUnits: 30000000
  },
  {
    etfTicker: 'TQQQ',
    name: 'ProShares UltraPro QQQ (+3X)',
    category: 'LEVERAGE',
    underlyingType: 'DERIVATIVE',
    leverageFactor: 3,
    basePrice: 60,
    cuSize: 50000,
    cashComponent: 200,
    pdf: [
      { ticker: 'NDX_FUTURES', sharesPerCU: 15, weight: 100 }
    ],
    totalOutstandingUnits: 20000000
  },
  {
    etfTicker: 'TSLL',
    name: 'Direxion Daily TSLA Bull 2X (테슬라 2X)',
    category: 'LEVERAGE',
    underlyingType: 'DERIVATIVE',
    leverageFactor: 2,
    basePrice: 10,
    cuSize: 50000,
    cashComponent: 50,
    pdf: [
      { ticker: 'TSLA', sharesPerCU: 200, weight: 100 }
    ],
    totalOutstandingUnits: 15000000
  },
  {
    etfTicker: 'NVDL',
    name: 'GraniteShares 2x Long NVDA (엔비디아 2X)',
    category: 'LEVERAGE',
    underlyingType: 'DERIVATIVE',
    leverageFactor: 2,
    basePrice: 45,
    cuSize: 50000,
    cashComponent: 150,
    pdf: [
      { ticker: 'NVDA', sharesPerCU: 150, weight: 100 }
    ],
    totalOutstandingUnits: 10000000
  },

  // 3) 글로벌 국가 ETF
  {
    etfTicker: 'EWJ',
    name: 'iShares MSCI Japan ETF (일본)',
    category: 'GLOBAL',
    underlyingType: 'EQUITY',
    leverageFactor: 1,
    basePrice: 70,
    cuSize: 50000,
    cashComponent: 250,
    pdf: [
      { ticker: 'TOYOTA', sharesPerCU: 100, weight: 50 },
      { ticker: 'SONY', sharesPerCU: 80, weight: 50 }
    ],
    totalOutstandingUnits: 5000000
  },
  {
    etfTicker: 'FXI',
    name: 'iShares China Large-Cap ETF (중국)',
    category: 'GLOBAL',
    underlyingType: 'EQUITY',
    leverageFactor: 1,
    basePrice: 25,
    cuSize: 50000,
    cashComponent: 100,
    pdf: [
      { ticker: 'TENCENT', sharesPerCU: 120, weight: 60 },
      { ticker: 'ALIBABA', sharesPerCU: 100, weight: 40 }
    ],
    totalOutstandingUnits: 6000000
  }
];

/**
 * Seed ETF stocks directly into Supabase `stocks` DB table (market = 'etf')
 */
export async function seedETFStocksToDatabase() {
  try {
    const supabase = createClient();
    const etfRows = ETF_CATALOG.map(e => ({
      ticker: e.etfTicker,
      name: e.name,
      market: 'etf',
      sector: e.category === 'LEVERAGE' ? 'Leverage ETF' : (e.category === 'SECTOR' ? 'Sector ETF' : 'Index ETF'),
      description: `${e.name} (${e.leverageFactor > 0 ? `+${e.leverageFactor}` : e.leverageFactor}X)`,
      current_price: e.basePrice,
      previous_close: e.basePrice,
      open_price: e.basePrice,
      volume: 50000,
      market_cap: e.basePrice * e.totalOutstandingUnits,
      is_listed: true
    }));

    await supabase.from('stocks').upsert(etfRows, { onConflict: 'ticker' });
  } catch (err) {
    console.error("Failed to seed ETF stocks:", err);
  }
}
