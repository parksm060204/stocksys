/**
 * STOCKSYS Statistical Mean-Reversion & Volatility-Adaptive Strategy
 *
 * - Rolling SMA, sample standard deviation, and z-score deviation
 * - Volatility-adaptive entry thresholds & position scaling
 * - OBI microstructure placement integration & adaptive drawdown risk controls
 * - Strictly deterministic (zero Math.random(), zero Date.now(), zero network)
 */

import type { MarketObservation } from '../marketObservation';
import type { AgentAccount, AgentOrderIntent, MeanReversionStrategyConfig } from '../agentTypes';
import type { BotEffectParams } from '../regime/regimeEffects';
import {
  NEUTRAL_BOT_EFFECT_PARAMS,
  applyOrderSizeMultiplier,
  applyRiskToleranceToTarget,
  applyUncertaintyMultiplier,
  clamp01,
} from '../regime/regimeEffects';
import type { CrossAssetSignal } from '../crossAsset/crossAssetTypes';
import {
  clamp,
  computeMicrostructureSignal,
  resolveExecutionPlacement,
} from './orderbookMicrostructure';
import type { DrawdownRiskOutput } from './adaptiveRiskControl';

export interface MeanReversionSignal {
  mean: number;
  stdDev: number;
  zScore: number;               // (currentPrice - mean) / stdDev
  realizedVolatility: number;   // Return stdDev across lookback window
  effectiveEntryZ: number;      // Volatility-widened z-score entry threshold
  reversionSignal: number;      // Contrarian directional intensity in [-1, 1]
  volatilitySizeScale: number;  // Dynamic sizing scale in [0.25, 1.0]
}

/**
 * Pure statistical mean-reversion & volatility-adaptive signal calculator.
 */
export function computeMeanReversionSignal(
  priceHistory: ReadonlyArray<number>,
  returns: ReadonlyArray<number>,
  lookbackSteps: number = 20,
  entryZScore: number = 1.5,
  zScale: number = 2.0
): MeanReversionSignal | null {
  if (!Array.isArray(priceHistory) || priceHistory.length < 3) {
    return null;
  }

  const windowLen = Math.max(3, Math.floor(lookbackSteps));
  const slice = priceHistory.slice(-windowLen).filter((p) => Number.isFinite(p) && p > 0);
  if (slice.length < 3) {
    return null;
  }

  const currentPrice = slice[slice.length - 1];
  const mean = slice.reduce((acc, p) => acc + p, 0) / slice.length;
  if (mean <= 0) return null;

  const variance = slice.reduce((acc, p) => acc + (p - mean) * (p - mean), 0) / slice.length;
  const stdDev = Math.sqrt(variance);
  const denom = Math.max(stdDev, mean * 1e-4);
  const zScore = (currentPrice - mean) / denom;

  let realizedVolatility = 0;
  const validReturns = (Array.isArray(returns) ? returns : [])
    .slice(-windowLen)
    .filter((r) => Number.isFinite(r));
  if (validReturns.length >= 2) {
    const avgR = validReturns.reduce((a, b) => a + b, 0) / validReturns.length;
    const varR = validReturns.reduce((acc, r) => acc + (r - avgR) * (r - avgR), 0) / validReturns.length;
    realizedVolatility = Math.sqrt(varR);
  } else {
    realizedVolatility = clamp(stdDev / mean, 0, 0.5);
  }

  // High volatility regime requires wider z-score dislocation and shrinks position size
  const effectiveEntryZ = Math.max(0.5, entryZScore) * (1 + Math.min(1.5, realizedVolatility / 0.02));
  const reversionSignal = Math.tanh(-zScore / Math.max(0.5, zScale));
  const volatilitySizeScale = clamp(1.0 / (1.0 + realizedVolatility * 20.0), 0.25, 1.0);

  return {
    mean,
    stdDev,
    zScore,
    realizedVolatility,
    effectiveEntryZ,
    reversionSignal,
    volatilitySizeScale,
  };
}

export function evaluateMeanReversionStrategy(
  obs: MarketObservation,
  agent: AgentAccount,
  config: MeanReversionStrategyConfig,
  riskAdjustment?: DrawdownRiskOutput,
  effectParams?: BotEffectParams,
  crossAssetSignal?: CrossAssetSignal
): AgentOrderIntent {
  const effects = effectParams ?? NEUTRAL_BOT_EFFECT_PARAMS;
  const riskToleranceMultiplier = effects.riskToleranceMultiplier;
  const regimeSizeMult = effects.orderSizeMultiplier;
  const cashPreference = clamp01(effects.cashPreference);

  if (obs.priceHistory.length < config.minWarmupSteps) {
    return { action: 'hold', stockId: obs.stockId, reason: 'mr_warmup_insufficient' };
  }

  const mrSignal = computeMeanReversionSignal(
    obs.priceHistory,
    obs.returns,
    config.lookbackSteps,
    config.entryZScore,
    config.zScale
  );
  if (!mrSignal) {
    return { action: 'hold', stockId: obs.stockId, reason: 'mr_invalid_history' };
  }

  const midPrice = obs.midPrice;
  if (!Number.isFinite(midPrice) || midPrice <= 0) {
    return { action: 'hold', stockId: obs.stockId, reason: 'invalid_mid_price' };
  }

  const micro = computeMicrostructureSignal(obs);
  const currentPos = obs.account.holdingQty;
  const baseUncertainty = obs.uncertaintyScore ?? 0.05;
  const effectiveUncertainty = effectParams
    ? applyUncertaintyMultiplier(baseUncertainty, effects.uncertaintyMultiplier)
    : baseUncertainty;

  // Blend contrarian z-score reversion (80%) with stabilizing microstructure pressure (20%)
  let combinedSignal = 0.80 * mrSignal.reversionSignal + 0.20 * micro.compositePressure;
  if (crossAssetSignal && agent.macroProfile) {
    const macroDir = crossAssetSignal.direction * crossAssetSignal.confidence;
    const totalSens = agent.macroProfile.macroSensitivity + agent.macroProfile.microSensitivity;
    const normMacro = totalSens > 0 ? agent.macroProfile.macroSensitivity / totalSens : 0.35;
    const normMicro = totalSens > 0 ? agent.macroProfile.microSensitivity / totalSens : 0.65;
    combinedSignal = combinedSignal * normMicro + macroDir * normMacro;
  }

  const normSignal = Math.tanh(combinedSignal * effects.valueSensitivity);
  const effectiveBuyThreshold = config.buyThreshold * (1 + effectiveUncertainty * 0.5);
  const isRiskReductionSell = currentPos > 0;
  const activeSellThreshold = isRiskReductionSell
    ? config.sellThreshold
    : config.sellThreshold * (1 + effectiveUncertainty * 0.5);

  const absZ = Math.abs(mrSignal.zScore);
  if (absZ < mrSignal.effectiveEntryZ * 0.65) {
    return { action: 'hold', stockId: obs.stockId, reason: 'mr_within_band' };
  }

  const isBuy = normSignal >= effectiveBuyThreshold && mrSignal.zScore < 0;
  const isSell = normSignal <= activeSellThreshold && mrSignal.zScore > 0;
  if (!isBuy && !isSell) {
    return { action: 'hold', stockId: obs.stockId, reason: 'mr_below_threshold' };
  }

  const effectiveMaxPosition = Math.max(
    1,
    Math.round(agent.maxPosition * (riskAdjustment?.positionLimitMultiplier ?? 1.0))
  );
  const baseTarget = Math.min(effectiveMaxPosition, agent.targetPositions[obs.stockId] ?? 1000);
  const baseAdjustedTarget =
    normSignal > 0
      ? Math.min(effectiveMaxPosition, Math.round(baseTarget + (effectiveMaxPosition - baseTarget) * normSignal))
      : Math.max(0, Math.round(baseTarget * (1 + normSignal)));

  const adjustedTarget = applyRiskToleranceToTarget(
    baseAdjustedTarget,
    riskToleranceMultiplier,
    effectiveMaxPosition
  );

  let openBuyQty = 0;
  let openSellQty = 0;
  for (const ord of obs.activeOrders) {
    const rem = Math.max(0, ord.size - (ord.filled || 0));
    if (ord.side === 'buy') openBuyQty += rem;
    else openSellQty += rem;
  }

  const isUsdAsset = Boolean(obs.isUsdAsset);
  const fxRate = Number.isFinite(obs.fxRateToKrw) && (obs.fxRateToKrw as number) > 0 ? (obs.fxRateToKrw as number) : 1;
  const tickSize = isUsdAsset
    ? 0.01
    : (midPrice < 2000 ? 1 : midPrice < 5000 ? 5 : midPrice < 20000 ? 10 : midPrice < 50000 ? 50 : midPrice < 200000 ? 100 : 500);
  const recentVol = obs.recentTrades.reduce((sum, t) => sum + t.size, 0);
  const participationCap = Math.max(10, Math.floor(recentVol * config.participationRate));

  if (isBuy) {
    const needed = adjustedTarget - (currentPos + openBuyQty);
    if (needed <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'mr_target_reached' };
    }

    const riskSideMult = riskAdjustment ? riskAdjustment.buySizeMultiplier : 1.0;
    const adaptiveMult = mrSignal.volatilitySizeScale * riskSideMult;
    const baseDesired = Math.max(1, Math.round(needed * clamp(config.exposureWeight, 0.05, 1.0) * adaptiveMult));
    const orderSize = effectParams
      ? applyOrderSizeMultiplier(baseDesired, regimeSizeMult, needed, agent.maxOrderSize, participationCap)
      : Math.max(1, Math.min(baseDesired, needed, agent.maxOrderSize, participationCap));

    const placement = resolveExecutionPlacement({
      side: 'buy',
      signalMagnitude: Math.abs(normSignal),
      agentUrgency: agent.urgency,
      micro,
      midPrice,
      bestBid: obs.bestBid,
      bestAsk: obs.bestAsk,
      tickSize,
      isUsdAsset,
    });

    const costPerShare = placement.price * fxRate * 1.0025;
    let maxAffordable: number;
    if (!effectParams || cashPreference <= 0) {
      maxAffordable = Math.floor(obs.account.availableCash / costPerShare);
    } else {
      if (obs.account.isPortfolioValuationComplete === false) {
        return { action: 'hold', stockId: obs.stockId, reason: 'incomplete_portfolio_valuation' };
      }
      const totalHoldingsVal = obs.account.totalHoldingsValue ?? 0;
      const nav = obs.account.nav ?? (obs.account.cash + totalHoldingsVal);
      const spendableCash = Math.max(0, obs.account.availableCash - nav * cashPreference);
      maxAffordable = Math.floor(spendableCash / costPerShare);
    }

    const finalSize = Math.min(orderSize, maxAffordable);
    if (finalSize <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'insufficient_cash' };
    }

    if (placement.orderType === 'limit') {
      const existing = obs.activeOrders.find(
        (o) => o.side === 'buy' && Math.abs(o.price - placement.price) <= tickSize
      );
      if (existing) {
        return { action: 'hold', stockId: obs.stockId, reason: 'order_already_resting' };
      }
    }

    return {
      action: 'buy',
      stockId: obs.stockId,
      price: placement.price,
      size: finalSize,
      orderType: placement.orderType,
      reason: `mr_buy: z=${mrSignal.zScore.toFixed(2)}, obi=${micro.obi.toFixed(2)}, dd=${((riskAdjustment?.drawdownPct ?? 0) * 100).toFixed(1)}%`,
    };
  }

  if (isSell) {
    const surplus = (currentPos - openSellQty) - adjustedTarget;
    if (surplus <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'mr_target_reached' };
    }

    const riskSideMult = riskAdjustment ? riskAdjustment.sellSizeMultiplier : 1.0;
    const adaptiveMult = mrSignal.volatilitySizeScale * riskSideMult;
    const baseDesired = Math.max(1, Math.round(surplus * clamp(config.exposureWeight, 0.05, 1.0) * adaptiveMult));
    const orderSize = effectParams
      ? applyOrderSizeMultiplier(baseDesired, regimeSizeMult, surplus, agent.maxOrderSize, participationCap)
      : Math.max(1, Math.min(baseDesired, surplus, agent.maxOrderSize, participationCap));

    const availableToSell = Math.min(orderSize, obs.account.availableHolding);
    if (availableToSell <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'insufficient_holding' };
    }

    const placement = resolveExecutionPlacement({
      side: 'sell',
      signalMagnitude: Math.abs(normSignal),
      agentUrgency: agent.urgency,
      micro,
      midPrice,
      bestBid: obs.bestBid,
      bestAsk: obs.bestAsk,
      tickSize,
      isUsdAsset,
    });

    if (placement.orderType === 'limit') {
      const existing = obs.activeOrders.find(
        (o) => o.side === 'sell' && Math.abs(o.price - placement.price) <= tickSize
      );
      if (existing) {
        return { action: 'hold', stockId: obs.stockId, reason: 'order_already_resting' };
      }
    }

    return {
      action: 'sell',
      stockId: obs.stockId,
      price: placement.price,
      size: availableToSell,
      orderType: placement.orderType,
      reason: `mr_sell: z=${mrSignal.zScore.toFixed(2)}, obi=${micro.obi.toFixed(2)}, dd=${((riskAdjustment?.drawdownPct ?? 0) * 100).toFixed(1)}%`,
    };
  }

  return { action: 'hold', stockId: obs.stockId, reason: 'neutral' };
}
