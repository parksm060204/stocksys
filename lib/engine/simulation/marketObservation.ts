/**
 * STOCKSYS Read-Only Market Observation Builder
 *
 * Provides agents with a clean, strictly read-only snapshot of market conditions,
 * order book depth, rolling volatility, and single-authority account asset status.
 * Prevents lookahead bias and handles empty/one-sided books cleanly.
 */

import { memoryDb, OrderRecord, TradeRecord } from '../../memoryDb/memoryStore';
import { calculateReservedCash, calculateReservedQty, OpenOrderForRisk } from '../orderRisk';
import { MarketEvent, getEffectiveMarketEvents } from './marketEventTypes';
import { WindowStatistics } from './marketDiagnostics';

export interface BookLevel {
  price: number;
  size: number;
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

export interface MarketObservation {
  stockId: string;
  ticker: string;
  bestBid: number | null;
  bestAsk: number | null;
  midPrice: number;            // If one-sided/empty, falls back to reference price (for observation only)
  spread: number | null;       // null if book is empty or one-sided
  hasTwoSidedBook: boolean;
  bidsDepth: BookLevel[];
  asksDepth: BookLevel[];
  lastTradePrice: number | null;
  lastTradeVolume: number;
  recentTrades: TradeRecord[];
  priceHistory: number[];      // Close prices
  returns: number[];           // Historical return series
  volatility: number;          // Standard deviation of returns
  isWarmup: boolean;
  simulationTime: number;
  // 구조적 유동성 메타데이터 (하위 호환 및 fallback 지원)
  structural?: StructuralLiquidity;
  // 뉴스 및 동적 시장 상태
  attentionScore?: number;      // 0.0 ~ 1.0 (Bounded attention)
  uncertaintyScore?: number;    // 0.0 ~ 1.0 (Uncertainty shock)
  recentEvents?: MarketEvent[]; // Visible events for this agent
  effectiveEvents?: MarketEvent[]; // Visible AND economically effective events (effectiveFrom <= simulationTime)
  windowStats?: WindowStatistics;
  // Single-authority account state
  account: {
    cash: number;
    holdingQty: number;
    avgPrice: number;
    reservedCash: number;
    reservedHolding: number;
    availableCash: number;
    availableHolding: number;
  };
  activeOrders: OrderRecord[]; // Agent's current open/partial orders for this stock
}

export function buildMarketObservation(
  stockId: string,
  accountId: string,
  simulationTime: number,
  lookbackWindow: number = 20,
  attentionMap?: Map<string, number>,
  uncertaintyMap?: Map<string, number>,
  visibleEvents?: MarketEvent[],
  windowStats?: WindowStatistics
): MarketObservation | null {
  const stock = memoryDb.stocks.get(stockId);
  if (!stock) return null;

  // 1. Order book aggregation
  const stockOrderIds = memoryDb.orderStockIndex.get(stockId);
  const bidsMap = new Map<number, number>();
  const asksMap = new Map<number, number>();
  const activeOrders: OrderRecord[] = [];

  if (stockOrderIds) {
    for (const oId of stockOrderIds) {
      const ord = memoryDb.orders.get(oId);
      if (!ord || (ord.status !== 'open' && ord.status !== 'partial')) continue;

      const remaining = Math.max(0, ord.size - (ord.filled || 0));
      if (remaining <= 0) continue;

      if (ord.side === 'buy') {
        bidsMap.set(ord.price, (bidsMap.get(ord.price) || 0) + remaining);
      } else {
        asksMap.set(ord.price, (asksMap.get(ord.price) || 0) + remaining);
      }

      if (ord.user_id === accountId) {
        activeOrders.push(ord);
      }
    }
  }

  // Sort Bids descending (highest price first), Asks ascending (lowest price first)
  const bidsDepth: BookLevel[] = Array.from(bidsMap.entries())
    .map(([price, size]) => ({ price, size }))
    .sort((a, b) => b.price - a.price)
    .slice(0, 10);

  const asksDepth: BookLevel[] = Array.from(asksMap.entries())
    .map(([price, size]) => ({ price, size }))
    .sort((a, b) => a.price - b.price)
    .slice(0, 10);

  const bestBid = bidsDepth.length > 0 ? bidsDepth[0].price : null;
  const bestAsk = asksDepth.length > 0 ? asksDepth[0].price : null;
  const hasTwoSidedBook = bestBid !== null && bestAsk !== null;

  let midPrice = stock.current_price;
  let spread: number | null = null;
  if (hasTwoSidedBook) {
    midPrice = (bestBid! + bestAsk!) / 2.0;
    spread = Math.max(0, bestAsk! - bestBid!);
  }

  // 2. Recent trades and price history
  const allStockTrades = memoryDb.tradeStockIndex.get(stockId) || [];
  const recentTrades = allStockTrades.slice(-lookbackWindow);
  const lastTrade = allStockTrades.length > 0 ? allStockTrades[allStockTrades.length - 1] : null;

  // Extract prices from stockPriceHistory
  const allHistory = memoryDb.stockPriceHistory
    .filter((h) => h.stock_id === stockId)
    .slice(-lookbackWindow);

  const priceHistory: number[] = allHistory.map((h) => Number(h.price));
  if (priceHistory.length === 0) {
    priceHistory.push(stock.current_price);
  }

  // Compute returns
  const returns: number[] = [];
  for (let i = 1; i < priceHistory.length; i++) {
    const prev = priceHistory[i - 1];
    const curr = priceHistory[i];
    if (prev > 0) {
      returns.push((curr - prev) / prev);
    }
  }

  // Compute standard deviation (volatility)
  let volatility = 0.005; // Fallback minimal volatility
  if (returns.length >= 2) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
    volatility = Math.max(0.001, Math.sqrt(variance));
  }

  const isWarmup = returns.length < 5;

  // 3. Single-authority account asset status (derived directly from authoritative orders and profiles)
  const profile = memoryDb.profiles.get(accountId);
  const holdingKey = `${accountId}_${stockId}`;
  const holding = memoryDb.holdings.get(holdingKey);

  const rawCash = Number(profile?.cash || 0);
  const rawHolding = Number(holding?.quantity || 0);
  const avgPrice = Number(holding?.avg_price || stock.current_price);

  // Collect all open orders for this user across all stocks to accurately reserve cash
  const userOpenOrders: OpenOrderForRisk[] = [];
  const userOrderIds = memoryDb.orderUserIndex.get(accountId);
  if (userOrderIds) {
    for (const oId of userOrderIds) {
      const o = memoryDb.orders.get(oId);
      if (o && (o.status === 'open' || o.status === 'partial')) {
        userOpenOrders.push(o as OpenOrderForRisk);
      }
    }
  }

  const reservedCash = calculateReservedCash(userOpenOrders);
  const reservedHolding = calculateReservedQty(userOpenOrders, stockId);
  const availableCash = Math.max(0, rawCash - reservedCash);
  const availableHolding = Math.max(0, rawHolding - reservedHolding);

  return {
    stockId,
    ticker: stock.ticker,
    bestBid,
    bestAsk,
    midPrice,
    spread,
    hasTwoSidedBook,
    bidsDepth,
    asksDepth,
    lastTradePrice: lastTrade ? lastTrade.price : stock.current_price,
    lastTradeVolume: lastTrade ? lastTrade.size : 0,
    recentTrades,
    priceHistory,
    returns,
    volatility,
    isWarmup,
    simulationTime,
    structural: {
      sharesOutstanding: stock.shares_outstanding || 100000000,
      floatingShares: stock.floating_shares || 50000000,
      sectorId: stock.sector_id || 'general',
      themeIds: stock.theme_ids || [],
      baseLiquidity: stock.base_liquidity ?? 0.5,
      baseSpreadBps: stock.base_spread_bps ?? 20,
      baseDepthShares: stock.base_depth_shares ?? 200,
      institutionalFit: stock.institutional_fit ?? 0.5,
      macroExposure: stock.macro_exposure || {},
    },
    attentionScore: attentionMap?.get(stockId) ?? (stock.base_liquidity ?? 0.5),
    uncertaintyScore: uncertaintyMap?.get(stockId) ?? 0.1,
    recentEvents: visibleEvents || [],
    effectiveEvents: getEffectiveMarketEvents(visibleEvents || [], simulationTime),
    windowStats,
    account: {
      cash: rawCash,
      holdingQty: rawHolding,
      avgPrice,
      reservedCash,
      reservedHolding,
      availableCash,
      availableHolding,
    },
    activeOrders,
  };
}
