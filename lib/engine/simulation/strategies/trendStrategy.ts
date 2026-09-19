/**
 * STOCKSYS Trend Follower Strategy
 *
 * - Backward-looking momentum from past price history
 * - Strict warm-up enforcement (no action until sufficient history is formed)
 * - Tanh-normalized trend signal with threshold triggers
 * - Order sizing capped by participation rate and available balance
 * - Anti-churning and duplicate order avoidance
 */

import { MarketObservation } from '../marketObservation';
import { AgentAccount, AgentOrderIntent, TrendStrategyConfig } from '../agentTypes';
import {
  BotEffectParams,
  NEUTRAL_BOT_EFFECT_PARAMS,
  applyOrderSizeMultiplier,
  applyRiskToleranceToTarget,
  applyUncertaintyMultiplier,
  clamp01,
} from '../regime/regimeEffects';

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

  const currentPos = obs.account.holdingQty;

  // 국면 uncertaintyMultiplier: 원본 불확실성 관측에 배수를 1회 적용하여 [0, 1] 유효 불확실성 산출
  // 진입에 필요한 최소 신호 강도(추세 임계치)에 적용하여 높은 불확실성에서 섣부른 신규 위험 노출 진입을 방지한다.
  const baseUncertainty = obs.uncertaintyScore ?? 0.05;
  const effectiveUncertainty = effectParams
    ? applyUncertaintyMultiplier(baseUncertainty, effects.uncertaintyMultiplier)
    : 0;

  // 신규 위험 노출 확대(BUY)와 기존 보유 위험 축소(SELL) 분리:
  // - BUY: 신규 매수는 위험 노출 확대이므로 불확실성이 높을 때 진입 임계치(effectiveBuyThreshold)를 상향 강화.
  // - SELL: 현재 현물(Spot) 시장에서 기존 보유량(currentPos > 0) 축소는 위험을 줄이는 회피 매도이므로 불확실성 가중 없는 기본 임계치(config.sellThreshold)를 적용.
  //   (향후 무차입 공매도 지원 시 currentPos <= 0 인 신규 숏 진입은 위험 확대이므로 그때는 effectiveSellThreshold 적용 필요)
  const effectiveBuyThreshold = effectParams
    ? config.buyThreshold * (1 + effectiveUncertainty)
    : config.buyThreshold;
  const isRiskReductionSell = currentPos > 0;
  const activeSellThreshold = effectParams
    ? (isRiskReductionSell ? config.sellThreshold : config.sellThreshold * (1 + effectiveUncertainty))
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

  // 4. Directional Threshold & Strategy Execution
  const isBuySignal = normTrend >= effectiveBuyThreshold;
  const isSellSignal = normTrend <= activeSellThreshold;

  if (!isBuySignal && !isSellSignal) {
    const isUncertaintyBlocked =
      (normTrend > 0 && normTrend >= config.buyThreshold) ||
      (normTrend < 0 && normTrend <= config.sellThreshold);
    const reason = isUncertaintyBlocked
      ? 'trend_below_threshold_uncertainty'
      : 'trend_below_threshold';
    return { action: 'hold', stockId: obs.stockId, reason };
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
  if (isBuySignal) {
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

    // Pricing
    const isUrgent = agent.urgency >= 0.2 || normTrend > 0.6;
    let targetPrice = isUrgent
      ? (obs.bestAsk || currentPrice)
      : (obs.bestBid || currentPrice);

    targetPrice = Math.max(tickSize, Math.round(targetPrice / tickSize) * tickSize);

    const costPerShare = targetPrice * 1.0025;
    let maxAffordable: number;
    if (!effectParams || cashPreference <= 0) {
      // 효과 OFF 또는 cashPreference=0: 기존 가용 현금(availableCash) 기준 계산 보존
      maxAffordable = Math.floor(obs.account.availableCash / costPerShare);
    } else {
      if (obs.account.isPortfolioValuationComplete === false) {
        return { action: 'hold', stockId: obs.stockId, reason: 'incomplete_portfolio_valuation' };
      }
      const totalHoldingsVal = obs.account.totalHoldingsValue ?? 0;
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
  if (isSellSignal) {
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

    const isUrgent = normTrend <= activeSellThreshold && agent.urgency >= 0.5 && obs.bestBid !== null;
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
      reason: `trend_sell: signal=${normTrend.toFixed(3)}, return=${(rollingReturn * 100).toFixed(2)}%` + (isRiskReductionSell ? ' (risk_reduction)' : '') + (effectParams ? `, unc=${effectiveUncertainty.toFixed(3)}` : ''),
    };
  }

  return { action: 'hold', stockId: obs.stockId, reason: 'neutral' };
}
