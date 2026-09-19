/**
 * STOCKSYS Read-Only Market Observation Builder
 *
 * Provides agents with a clean, strictly read-only snapshot of market conditions,
 * order book depth, rolling volatility, and single-authority account asset status.
 * Prevents lookahead bias and handles empty/one-sided books cleanly.
 */

import { memoryDb, OrderRecord, TradeRecord } from '../../memoryDb/memoryStore';
import { calculateReservedCash, calculateReservedQty, OpenOrderForRisk } from '../orderRisk';
import { ObservableMarketEvent, getEffectiveMarketEvents } from './marketEventTypes';
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
  recentEvents?: ObservableMarketEvent[]; // Visible events for this agent (strictly sanitized allowlist DTO)
  effectiveEvents?: ObservableMarketEvent[]; // Visible AND economically effective events (effectiveFrom <= simulationTime)
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
    totalHoldingsValue?: number; // 전체 보유 종목 평가액 (단일 권위 current_price 기준)
    nav?: number;                // 계좌 전체 순자산 가치 (장부 현금 + 전체 보유 주식 평가액)
    isPortfolioValuationComplete?: boolean; // 포트폴리오 평가 완전성 여부
    incompleteReasons?: string[];
  };
  activeOrders: OrderRecord[]; // Agent's current open/partial orders for this stock
}

export interface PortfolioValuationResult {
  totalHoldingsValue: number;
  nav: number;
  isComplete: boolean;
  incompleteReasons: string[];
}

/**
 * 계좌 전체 포트폴리오의 총 보유 주식 평가액과 NAV를 단일 권위 가격 정책으로 계산한다.
 *
 * 선택 근거 및 정책:
 * 1. 단일 권위 가격(current_price) 일관 적용:
 *    - 종목별 호가창 중간값(midPrice)은 스프레드나 호가 제출 상황에 따라 변동하며, 조회 종목에 따라 달라지는 비대칭성을 유발한다.
 *    - 반면 memoryDb.stocks의 current_price는 체결 시점마다 갱신되는 단일 권위 체결가(Last Trade Price)이므로,
 *      조회 대상 stockId에 전혀 의존하지 않고 계좌 전체 포트폴리오를 동일 기준시점의 단일 척도로 평가할 수 있다.
 * 2. 동일 시각/동일 장부 버전에서는 어느 종목을 조회하든 100% 동일한 NAV와 totalHoldingsValue를 보장한다.
 * 3. 비정상 가격(NaN, Infinity, 0 이하, 종목 부재) 처리:
 *    - 1차: stock.current_price (유효한 양의 유한수)
 *    - 2차: h.avg_price (평균 매입 단가)
 *    - 둘 다 유효하지 않은 경우, NAV를 조용히 과소평가하지 않고 isComplete = false 플래그를 설정하고 원인을 기록한다.
 *    - isComplete === false 인 경우 전략 레이어에서 신규 매수 예산을 보수적으로 차단한다.
 */
export function calculateAuthoritativePortfolioValuation(
  accountId: string,
  rawCash: number
): PortfolioValuationResult {
  let totalHoldingsValue = 0;
  let isComplete = true;
  const incompleteReasons: string[] = [];

  const userHoldingIds = memoryDb.holdingUserIndex.get(accountId);
  if (userHoldingIds) {
    for (const hId of userHoldingIds) {
      const h = memoryDb.holdings.get(hId);
      const qty = Number(h?.quantity ?? 0);
      if (h && qty > 0) {
        const hStock = memoryDb.stocks.get(h.stock_id);
        const curP = Number(hStock?.current_price);
        const avgP = Number(h.avg_price);

        let validPrice: number | null = null;
        if (Number.isFinite(curP) && curP > 0) {
          validPrice = curP;
        } else if (Number.isFinite(avgP) && avgP > 0) {
          validPrice = avgP;
        }

        if (validPrice !== null) {
          totalHoldingsValue += qty * validPrice;
        } else {
          isComplete = false;
          incompleteReasons.push(
            `invalid_price_for_stock_${h.stock_id}(cur=${hStock?.current_price},avg=${h.avg_price})`
          );
        }
      }
    }
  }

  const nav = rawCash + totalHoldingsValue;
  return {
    totalHoldingsValue,
    nav,
    isComplete,
    incompleteReasons,
  };
}

export function buildMarketObservation(
  stockId: string,
  accountId: string,
  simulationTime: number,
  lookbackWindow: number = 20,
  attentionMap?: Map<string, number>,
  uncertaintyMap?: Map<string, number>,
  visibleEvents?: ObservableMarketEvent[],
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

  // 4. Calculate total portfolio holdings value across all stocks for account NAV
  // 조회 대상 종목(stockId)에 무관하게 모든 보유 종목을 단일 권위 current_price로 일관 평가한다.
  const valuation = calculateAuthoritativePortfolioValuation(accountId, rawCash);
  const totalHoldingsValue = valuation.totalHoldingsValue;
  const nav = valuation.nav;
  const isPortfolioValuationComplete = valuation.isComplete;
  const incompleteReasons = valuation.incompleteReasons;

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
      totalHoldingsValue,
      nav,
      isPortfolioValuationComplete,
      incompleteReasons,
    },
    activeOrders,
  };
}
