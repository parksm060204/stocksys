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
  if (Math.abs(normTrend) < Math.min(Math.abs(config.buyThreshold), Math.abs(config.sellThreshold))) {
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
  if (normTrend >= config.buyThreshold) {
    const needed = adjustedTarget - (currentPos + openBuyQty);
    if (needed <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'trend_target_reached' };
    }

    // 국면 orderSizeMultiplier: 희망 수량에 1회 적용 후 주문상한/참여율/노출 한도로 최종 제한
    const orderSize = applyOrderSizeMultiplier(needed, orderSizeMultiplier, agent.maxOrderSize, participationCap);
    if (orderSize <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'insufficient_size' };
    }

    // Urgency pricing: if trend is confirmed and urgency high, take liquidity at best ask (IOC)
    const isUrgent = normTrend >= config.buyThreshold && agent.urgency >= 0.5 && obs.bestAsk !== null;
    let targetPrice = isUrgent
      ? obs.bestAsk!
      : (obs.bestBid !== null ? obs.bestBid : currentPrice);

    targetPrice = Math.max(tickSize, Math.round(targetPrice / tickSize) * tickSize);

    const costPerShare = targetPrice * 1.0025;
    // 국면 cashPreference: 전체 계좌 기준 목표 현금 비중. availableCash는 이미 예약 현금을 차감했으므로 중복 차감하지 않는다.
    const investableCash = obs.account.availableCash * (1 - cashPreference);
    const maxAffordable = Math.floor(investableCash / costPerShare);
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
      reason: `trend_buy: signal=${normTrend.toFixed(3)}, return=${(rollingReturn * 100).toFixed(2)}%`,
    };
  }

  // 7. Bearish Trend -> SELL
  if (normTrend <= config.sellThreshold) {
    const surplus = (currentPos - openSellQty) - adjustedTarget;
    if (surplus <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'trend_target_reached' };
    }

    // 국면 orderSizeMultiplier: 희망 수량에 1회 적용 후 주문상한/참여율/노출 한도로 최종 제한
    const orderSize = applyOrderSizeMultiplier(surplus, orderSizeMultiplier, agent.maxOrderSize, participationCap);
    if (orderSize <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'insufficient_size' };
    }
    const availableToSell = Math.min(orderSize, obs.account.availableHolding);

    if (availableToSell <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'insufficient_holding' };
    }

    const isUrgent = normTrend <= config.sellThreshold && agent.urgency >= 0.5 && obs.bestBid !== null;
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
      reason: `trend_sell: signal=${normTrend.toFixed(3)}, return=${(rollingReturn * 100).toFixed(2)}%`,
    };
  }

  return { action: 'hold', stockId: obs.stockId, reason: 'neutral' };
}
