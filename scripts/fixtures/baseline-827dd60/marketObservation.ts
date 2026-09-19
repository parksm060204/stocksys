/**
 * BASELINE FIXTURE - 827dd6079a11f58cdb2746668cbab7290752b8f4
 * Source Path: lib/engine/simulation/marketObservation.ts
 * Git Blob Hash: 80dba63278189384091592d9cd1c3f43c9f45a6b
 * SHA-256: 9fd056d48430e0d8a51ff1ac4ff9cf1a594816bd4ef63de13bc5d1e159a6eb51
 */

import { OrderRecord } from './agentTypes';

export interface BookLevel {
  price: number;
  size: number;
}

export interface TradeRecord {
  id?: string;
  stock_id: string;
  buyer_id: string | null;
  seller_id: string | null;
  buyer_is_bot?: boolean;
  seller_is_bot?: boolean;
  price: number;
  size: number;
  buyer_fee?: number;
  seller_fee?: number;
  created_at?: string;
  simulation_time?: number;
}

export interface StructuralLiquidity {
  sharesOutstanding: number;
  floatingShares: number;
  sectorId: string;
  themeIds: string[];
  baseLiquidity: number;
  baseSpreadBps: number;
  baseDepthShares: number;
  institutionalFit: number;
  macroExposure: Record<string, number>;
}

export interface WindowStatistics {
  volume: number;
  signedFlow: number;
  vwap: number;
  tradeCount: number;
}

export interface ObservableMarketEvent {
  id: string;
  type: string;
  headline: string;
  content: string;
  effectiveFrom: number;
  severity: string;
}

export interface MarketObservation {
  stockId: string;
  ticker: string;
  bestBid: number | null;
  bestAsk: number | null;
  midPrice: number;
  spread: number | null;
  hasTwoSidedBook: boolean;
  bidsDepth: BookLevel[];
  asksDepth: BookLevel[];
  lastTradePrice: number | null;
  lastTradeVolume: number;
  recentTrades: TradeRecord[];
  priceHistory: number[];
  returns: number[];
  volatility: number;
  isWarmup: boolean;
  simulationTime: number;
  structural?: StructuralLiquidity;
  attentionScore?: number;
  uncertaintyScore?: number;
  recentEvents?: ObservableMarketEvent[];
  effectiveEvents?: ObservableMarketEvent[];
  windowStats?: WindowStatistics;
  account: {
    cash: number;
    holdingQty: number;
    avgPrice: number;
    reservedCash: number;
    reservedHolding: number;
    availableCash: number;
    availableHolding: number;
    totalHoldingsValue?: number;
    nav?: number;
    isPortfolioValuationComplete?: boolean;
  };
  activeOrders: OrderRecord[];
}
