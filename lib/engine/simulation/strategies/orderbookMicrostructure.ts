/**
 * STOCKSYS Order Book Microstructure & Imbalance (OBI) Signal Module
 *
 * Pure deterministic mathematical computation over order book depth, spread,
 * signed taker order flow, and recent execution volatility.
 * Zero Math.random(), zero Date.now(), zero network/IO.
 */

import type { MarketObservation } from '../marketObservation';
import type { TradeRecord } from '../../../memoryDb/memoryStore';

export interface DepthLevelLike {
  price: number;
  size?: number;
  totalSize?: number;
}

export interface MicrostructureSignal {
  obi: number;                 // Weighted Order Book Imbalance in [-1, 1]
  signedFlowPressure: number;  // Tanh-normalized taker flow imbalance in [-1, 1]
  spreadBps: number | null;    // Best bid-ask spread in basis points
  executionVolatility: number; // Realized / intrawindow trade volatility (>= 0)
  compositePressure: number;   // Combined OBI + signed flow in [-1, 1]
  bidDepthWeighted: number;
  askDepthWeighted: number;
}

export interface ExecutionPlacementDecision {
  orderType: 'limit' | 'ioc';
  price: number;
  mode: 'aggressive' | 'passive';
  aggressiveness: number;
}

export function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

function resolveLevelSize(level?: DepthLevelLike | null): number {
  const raw = Number(level?.size ?? level?.totalSize ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/**
 * Computes exponentially level-decayed Order Book Imbalance (OBI) in [-1, 1].
 * Positive values indicate stronger bid depth (buying pressure);
 * negative values indicate stronger ask depth (selling pressure).
 */
export function computeOrderBookImbalance(
  bidsDepth: ReadonlyArray<DepthLevelLike>,
  asksDepth: ReadonlyArray<DepthLevelLike>,
  maxLevels: number = 5
): { obi: number; bidDepthWeighted: number; askDepthWeighted: number } {
  const levels = Math.max(1, Math.floor(maxLevels));
  let bidWeighted = 0;
  let askWeighted = 0;

  for (let i = 0; i < Math.min(levels, bidsDepth.length); i++) {
    const qty = resolveLevelSize(bidsDepth[i]);
    if (qty > 0) {
      bidWeighted += qty / (1 + i * 0.5);
    }
  }
  for (let i = 0; i < Math.min(levels, asksDepth.length); i++) {
    const qty = resolveLevelSize(asksDepth[i]);
    if (qty > 0) {
      askWeighted += qty / (1 + i * 0.5);
    }
  }

  const total = bidWeighted + askWeighted;
  const obi = total > 0 ? clamp((bidWeighted - askWeighted) / total, -1, 1) : 0;
  return { obi, bidDepthWeighted: bidWeighted, askDepthWeighted: askWeighted };
}

/**
 * Estimates short-horizon execution volatility from recent trade prints and historical returns.
 */
export function computeExecutionVolatility(
  returns: ReadonlyArray<number>,
  recentTrades: ReadonlyArray<Pick<TradeRecord, 'price'>>,
  referenceVolatility: number,
  midPrice: number
): number {
  let tradeVol = 0;
  if (recentTrades.length >= 2 && midPrice > 0) {
    const slice = recentTrades.slice(-20);
    const prices = slice.map((t) => Number(t.price)).filter((p) => Number.isFinite(p) && p > 0);
    if (prices.length >= 2) {
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
      const variance = prices.reduce((acc, p) => acc + Math.pow((p - mean) / Math.max(1e-8, mean), 2), 0) / prices.length;
      tradeVol = Math.sqrt(variance);
    }
  }

  let returnVol = Number.isFinite(referenceVolatility) && referenceVolatility >= 0 ? referenceVolatility : 0;
  if (returnVol === 0 && returns.length >= 2) {
    const slice = returns.slice(-20);
    const meanR = slice.reduce((a, b) => a + b, 0) / slice.length;
    const varR = slice.reduce((acc, r) => acc + (r - meanR) * (r - meanR), 0) / slice.length;
    returnVol = Math.sqrt(varR);
  }

  return Math.max(returnVol, tradeVol);
}

/**
 * Computes comprehensive pure-math microstructure signals for a stock/ETF MarketObservation.
 */
export function computeMicrostructureSignal(obs: MarketObservation): MicrostructureSignal {
  const { obi, bidDepthWeighted, askDepthWeighted } = computeOrderBookImbalance(
    obs.bidsDepth || [],
    obs.asksDepth || [],
    5
  );

  let signedFlowPressure = 0;
  if (obs.windowStats && obs.windowStats.volume > 0) {
    signedFlowPressure = Math.tanh(
      obs.windowStats.signedFlow / Math.max(10, obs.windowStats.volume * 0.5)
    );
  }

  const mid = obs.midPrice > 0 ? obs.midPrice : 0;
  const spreadBps =
    obs.hasTwoSidedBook && obs.spread !== null && obs.spread >= 0 && mid > 0
      ? (obs.spread / mid) * 10000
      : null;

  const executionVolatility = computeExecutionVolatility(
    obs.returns || [],
    obs.recentTrades || [],
    obs.volatility ?? 0,
    mid
  );

  const hasBook = bidDepthWeighted + askDepthWeighted > 0;
  const compositePressure = hasBook
    ? clamp(0.55 * obi + 0.45 * signedFlowPressure, -1, 1)
    : clamp(signedFlowPressure, -1, 1);

  return {
    obi,
    signedFlowPressure,
    spreadBps,
    executionVolatility,
    compositePressure,
    bidDepthWeighted,
    askDepthWeighted,
  };
}

export function alignStockTickPrice(rawPrice: number, tickSize: number, isUsdAsset: boolean): number {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
    return isUsdAsset ? 0.01 : Math.max(1, tickSize);
  }
  if (isUsdAsset) {
    return Math.max(0.01, Math.round(rawPrice * 100) / 100);
  }
  return Math.max(tickSize, Math.round(rawPrice / tickSize) * tickSize);
}

/**
 * Chooses passive limit vs aggressive IOC/touch execution based on signal strength,
 * agent urgency, spread width, and directional microstructure alignment.
 */
export function resolveExecutionPlacement(params: {
  side: 'buy' | 'sell';
  signalMagnitude: number;
  agentUrgency: number;
  micro: MicrostructureSignal;
  midPrice: number;
  bestBid: number | null;
  bestAsk: number | null;
  tickSize: number;
  isUsdAsset: boolean;
  urgencyThreshold?: number;
}): ExecutionPlacementDecision {
  const {
    side,
    signalMagnitude,
    agentUrgency,
    micro,
    midPrice,
    bestBid,
    bestAsk,
    tickSize,
    isUsdAsset,
    urgencyThreshold = 0.62,
  } = params;

  const dirSign = side === 'buy' ? 1 : -1;
  const directionalObi = dirSign * micro.obi;
  const directionalFlow = dirSign * micro.signedFlowPressure;
  const spreadPenalty = micro.spreadBps !== null ? clamp((micro.spreadBps - 35) / 150, 0, 0.35) : 0.2;
  const volPenalty = clamp(micro.executionVolatility * 4, 0, 0.25);

  const rawAgg =
    0.45 * clamp(agentUrgency, 0, 1) +
    0.30 * clamp(signalMagnitude, 0, 1) +
    0.15 * clamp((directionalObi + 1) / 2, 0, 1) +
    0.10 * clamp((directionalFlow + 1) / 2, 0, 1) -
    spreadPenalty -
    volPenalty;
  const aggressiveness = clamp(rawAgg, 0, 1);

  const canCrossBuy = side === 'buy' && bestAsk !== null && bestAsk > 0;
  const canCrossSell = side === 'sell' && bestBid !== null && bestBid > 0;

  if (aggressiveness >= urgencyThreshold && (canCrossBuy || canCrossSell)) {
    const rawPrice = side === 'buy' ? bestAsk! : bestBid!;
    return {
      orderType: 'ioc',
      price: alignStockTickPrice(rawPrice, tickSize, isUsdAsset),
      mode: 'aggressive',
      aggressiveness,
    };
  }

  // Passive placement: quote on own top-of-book or slightly inside spread if moderate aggressiveness
  let rawPassivePrice: number;
  if (side === 'buy') {
    if (bestBid !== null && bestBid > 0) {
      const stepInside = aggressiveness >= 0.45 && bestAsk !== null && bestAsk - bestBid > tickSize * 1.5;
      rawPassivePrice = stepInside ? bestBid + tickSize : bestBid;
    } else {
      rawPassivePrice = Math.max(tickSize, midPrice - tickSize);
    }
  } else {
    if (bestAsk !== null && bestAsk > 0) {
      const stepInside = aggressiveness >= 0.45 && bestBid !== null && bestAsk - bestBid > tickSize * 1.5;
      rawPassivePrice = stepInside ? bestAsk - tickSize : bestAsk;
    } else {
      rawPassivePrice = midPrice + tickSize;
    }
  }

  return {
    orderType: 'limit',
    price: alignStockTickPrice(rawPassivePrice, tickSize, isUsdAsset),
    mode: 'passive',
    aggressiveness,
  };
}
