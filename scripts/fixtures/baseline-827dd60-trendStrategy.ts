/**
 * BASELINE FIXTURE - 827dd6079a11f58cdb2746668cbab7290752b8f4
 * Source Commit: 827dd6079a11f58cdb2746668cbab7290752b8f4
 * Source Path: lib/engine/simulation/strategies/trendStrategy.ts
 * Git Blob Hash: 743aa3b7a66102bcb6d6bf0756b9d4b9becb21f4
 * SHA-256: eb968afdb2f73ad4ed140ec02865c1a1c28424fa3dd12334760c76046da6d596
 * Transformations: ONLY relative import paths changed to resolve from scripts/fixtures/.
 * All algorithm logic, variable bindings, conditions and expressions are 100% UNMODIFIED.
 */

/**
 * STOCKSYS Trend Follower Strategy
 *
 * - Backward-looking momentum from past price history
 * - Strict warm-up enforcement (no action until sufficient history is formed)
 * - Tanh-normalized trend signal with threshold triggers
 * - Order sizing capped by participation rate and available balance
 * - Anti-churning and duplicate order avoidance
 */

import { MarketObservation } from '../../lib/engine/simulation/marketObservation';
import { AgentAccount, AgentOrderIntent, TrendStrategyConfig } from '../../lib/engine/simulation/agentTypes';
import {
  BotEffectParams,
  NEUTRAL_BOT_EFFECT_PARAMS,
  applyOrderSizeMultiplier,
  applyRiskToleranceToTarget,
  applyUncertaintyMultiplier,
  clamp01,
} from '../../lib/engine/simulation/regime/regimeEffects';

export function evaluateTrendStrategy(
  obs: MarketObservation,
  agent: AgentAccount,
  config: TrendStrategyConfig,
  effectParams?: BotEffectParams
): AgentOrderIntent {
  const effects = effectParams ?? NEUTRAL_BOT_EFFECT_PARAMS;
  const trendSensitivity = effects.trendSensitivity;
  const riskToleranceMultiplier = effects.riskToleranceMultiplier;
  const orderSizeMultiplier = effects.orderSizeMultiplier;
  const cashPreference = clamp01(effects.cashPreference);

  // 국면 uncertaintyMultiplier: 원본 불확실성 관측에 배수를 1회 적용하여 [0, 1] 유효 불확실성 산출
  // 진입에 필요한 최소 신호 강도(추세 임계치)에 1회 적용하여 높은 불확실성에서 섣부른 진입을 방지한다.
  const baseUncertainty = obs.uncertaintyScore ?? 0.05;
  const effectiveUncertainty = effectParams
    ? applyUncertaintyMultiplier(baseUncertainty, effects.uncertaintyMultiplier)
    : 0;

  const effectiveBuyThreshold = effectParams
    ? config.buyThreshold * (1 + effectiveUncertainty)
    : config.buyThreshold;
  const effectiveSellThreshold = effectParams
    ? config.sellThreshold * (1 + effectiveUncertainty)
    : config.sellThreshold;

  // 1. Warm-up check: require sufficient historical trade/price data points
  if (obs.priceHistory.length < config.minWarmupSteps) {
    return { action: 'hold', stockId: obs.stockId, reason: 'warmup_insufficient_history' };
  }

  // 2. Compute backward-looking return over lookback window
  const history = obs.priceHistory;
  const lookbackIndex = Math.max(0, history.length - 1 - config.lookbackSteps);
  const pastPrice = history[lookbackIndex];
  const currentPrice = history[history.length - 1] || obs.midPrice;

  if (pastPrice <= 0 || currentPrice <= 0) {
    return { action: 'hold', stockId: obs.stockId, reason: 'invalid_price_data' };
  }

  const rollingReturn = (currentPrice - pastPrice) / pastPrice;

  // 3. Incorporate price return + taker signed order flow into trend signal
  let flowSignal = 0;
  if (obs.windowStats && obs.windowStats.volume > 0) {
    flowSignal = Math.tanh(obs.windowStats.signedFlow / Math.max(10, obs.windowStats.volume * 0.5));
  }

  // Combined momentum: 70% price return + 30% signed taker order flow
  const rawSignal = 0.70 * Math.tanh(rollingReturn / config.trendScale) + 0.30 * flowSignal;
  // 국면 trendSensitivity: 추세 신호 반응 강도 (원본 가격/체결 데이터는 변경하지 않음)
  const normTrend = Math.tanh(rawSignal * trendSensitivity);

  // 4. Threshold check
  if (Math.abs(normTrend) < Math.min(Math.abs(effectiveBuyThreshold), Math.abs(effectiveSellThreshold))) {
    return { action: 'hold', stockId: obs.stockId, reason: 'trend_below_threshold' };
  }

  // 5. Target exposure calculation
  const baseTarget = agent.targetPositions[obs.stockId] ?? 1000;
  // Upward trend: expand target up to maxPosition
  // Downward trend: scale target down towards 0
  const baseAdjustedTarget = normTrend > 0
    ? Math.min(agent.maxPosition, Math.round(baseTarget + (agent.maxPosition - baseTarget) * normTrend))
    : Math.max(0, Math.round(baseTarget * (1 + normTrend))); // normTrend is negative
  // 국면 riskToleranceMultiplier: 목표 노출에 적용하되 절대 상한(maxPosition)은 상향하지 않음
  const adjustedTarget = applyRiskToleranceToTarget(baseAdjustedTarget, riskToleranceMultiplier, agent.maxPosition);

  const currentPos = obs.account.holdingQty;

  let openBuyQty = 0;
  let openSellQty = 0;
  for (const ord of obs.activeOrders) {
    const rem = Math.max(0, ord.size - (ord.filled || 0));
    if (ord.side === 'buy') openBuyQty += rem;
    else openSellQty += rem;
  }

  const tickSize = currentPrice < 2000 ? 1 : currentPrice < 5000 ? 5 : currentPrice < 20000 ? 10 : currentPrice < 50000 ? 50 : currentPrice < 200000 ? 100 : 500;
  const recentVol = obs.recentTrades.reduce((sum, t) => sum + t.size, 0);
  const participationCap = Math.max(10, Math.floor(recentVol * config.participationRate));

  // 6. Bullish Trend -> BUY
  if (normTrend >= effectiveBuyThreshold) {
    const needed = adjustedTarget - (currentPos + openBuyQty);
    if (needed <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'trend_target_reached' };
    }

    let orderSize: number;
    if (!effectParams) {
      // 효과 OFF: 변경 전 수량 계산 보존 (절대 한도 최솟값)
      orderSize = Math.max(1, Math.min(needed, agent.maxOrderSize, participationCap));
    } else {
      // 효과 ON: 전략의 기본 희망 수량(분할 실행 계수 exposureWeight 반영)에 국면 배수를 1회 곱한 뒤 절대 한도로 제한
      const executionIntensity = Math.max(0.01, Math.min(1.0, config.exposureWeight ?? 1.0));
      const baseDesiredShares = Math.round(needed * executionIntensity);
      orderSize = applyOrderSizeMultiplier(
        baseDesiredShares,
        orderSizeMultiplier,
        needed,
        agent.maxOrderSize,
        participationCap
      );
    }

    if (orderSize <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'insufficient_size' };
    }

    // Urgency pricing: if trend is confirmed and urgency high, take liquidity at best ask (IOC)
    const isUrgent = normTrend >= effectiveBuyThreshold && agent.urgency >= 0.5 && obs.bestAsk !== null;
    let targetPrice = isUrgent
      ? obs.bestAsk!
      : (obs.bestBid !== null ? obs.bestBid : currentPrice);

    targetPrice = Math.max(tickSize, Math.round(targetPrice / tickSize) * tickSize);

    const costPerShare = targetPrice * 1.0025;
    let maxAffordable: number;
    if (!effectParams || cashPreference <= 0) {
      // 효과 OFF 또는 cashPreference=0: 기존 가용 현금(availableCash) 기준 계산 보존
      maxAffordable = Math.floor(obs.account.availableCash / costPerShare);
    } else {
      // 효과 ON: 계좌 전체 NAV = 장부 현금 + 전체 보유 주식 평가액
      // targetCash = NAV * cashPreference
      // spendableCash = max(0, 장부 현금 - 전체 매수 예약금 - targetCash) = max(0, availableCash - targetCash)
      const totalHoldingsVal = obs.account.totalHoldingsValue ?? (obs.account.holdingQty * currentPrice);
      const nav = obs.account.nav ?? (obs.account.cash + totalHoldingsVal);
      const targetCash = nav * cashPreference;
      const spendableCash = Math.max(0, obs.account.availableCash - targetCash);
      maxAffordable = Math.floor(spendableCash / costPerShare);
    }

    const finalSize = Math.min(orderSize, maxAffordable);

    if (finalSize <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'insufficient_cash' };
    }

    // Check duplicate order
    if (!isUrgent) {
      const existing = obs.activeOrders.find(
        (o) => o.side === 'buy' && Math.abs(o.price - targetPrice) <= tickSize
      );
      if (existing) {
        return { action: 'hold', stockId: obs.stockId, reason: 'order_already_resting' };
      }
    }

    return {
      action: 'buy',
      stockId: obs.stockId,
      price: targetPrice,
      size: finalSize,
      orderType: isUrgent ? 'ioc' : 'limit',
      reason: `trend_buy: signal=${normTrend.toFixed(3)}, return=${(rollingReturn * 100).toFixed(2)}%` + (effectParams ? `, unc=${effectiveUncertainty.toFixed(3)}` : ''),
    };
  }

  // 7. Bearish Trend -> SELL
  if (normTrend <= effectiveSellThreshold) {
    const surplus = (currentPos - openSellQty) - adjustedTarget;
    if (surplus <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'trend_target_reached' };
    }

    let orderSize: number;
    if (!effectParams) {
      // 효과 OFF: 변경 전 수량 계산 보존
      orderSize = Math.max(1, Math.min(surplus, agent.maxOrderSize, participationCap));
    } else {
      // 효과 ON: 기본 희망 수량에 배수 적용 후 절대 한도로 제한
      const executionIntensity = Math.max(0.01, Math.min(1.0, config.exposureWeight ?? 1.0));
      const baseDesiredShares = Math.round(surplus * executionIntensity);
      orderSize = applyOrderSizeMultiplier(
        baseDesiredShares,
        orderSizeMultiplier,
        surplus,
        agent.maxOrderSize,
        participationCap
      );
    }

    if (orderSize <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'insufficient_size' };
    }
    const availableToSell = Math.min(orderSize, obs.account.availableHolding);

    if (availableToSell <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'insufficient_holding' };
    }

    const isUrgent = normTrend <= effectiveSellThreshold && agent.urgency >= 0.5 && obs.bestBid !== null;
    let targetPrice = isUrgent
      ? obs.bestBid!
      : (obs.bestAsk !== null ? obs.bestAsk : currentPrice);

    targetPrice = Math.max(tickSize, Math.round(targetPrice / tickSize) * tickSize);

    if (!isUrgent) {
      const existing = obs.activeOrders.find(
        (o) => o.side === 'sell' && Math.abs(o.price - targetPrice) <= tickSize
      );
      if (existing) {
        return { action: 'hold', stockId: obs.stockId, reason: 'order_already_resting' };
      }
    }

    return {
      action: 'sell',
      stockId: obs.stockId,
      price: targetPrice,
      size: availableToSell,
      orderType: isUrgent ? 'ioc' : 'limit',
      reason: `trend_sell: signal=${normTrend.toFixed(3)}, return=${(rollingReturn * 100).toFixed(2)}%` + (effectParams ? `, unc=${effectiveUncertainty.toFixed(3)}` : ''),
    };
  }

  return { action: 'hold', stockId: obs.stockId, reason: 'neutral' };
}
