/**
 * STOCKSYS Value Investor Strategy
 *
 * - Symmetric undervalued buy & overvalued sell based on estimated fundamental value
 * - Information latency and individual noise injection: V_hat = F * (1 + epsilon)
 * - Deadband (hysteresis) to avoid rapid flip-flopping
 * - Expected profit check against spread, fees, and slippage
 * - Exposure gap damping and participation rate caps
 */

import { MarketObservation } from '../marketObservation';
import { AgentAccount, AgentOrderIntent, ValueStrategyConfig } from '../agentTypes';
import { millisecondsToSeconds, SimPrng } from '../simClock';

import { computeEffectiveEventValuationDelta, ObservableMarketEvent } from '../marketEventTypes';
import {
  BotEffectParams,
  NEUTRAL_BOT_EFFECT_PARAMS,
  applyOrderSizeMultiplier,
  applyRiskToleranceToTarget,
  applyUncertaintyMultiplier,
  clamp01,
} from '../regime/regimeEffects';

/**
 * 순수 함수: 관측 가능한 시장 이벤트 목록으로부터 특정 종목의 유효 뉴스 가치평가 신호(delta)를 산출합니다.
 * - 특정 종목(stockId)을 대상(targetStockIds)으로 하는 이벤트만 반영
 * - 정정 이벤트 역시 targetStockIds에 stockId가 포함된 경우에만 해당 종목의 원본 루머를 정정
 * - 동일 원본에 복수 정정이 존재하는 경우 결정론적 정렬 정책 적용:
 *   1) effectiveFrom 오름차순
 *   2) publishedAt 오름차순
 *   3) sequence 오름차순
 *   4) eventId 오름차순 (tie-breaker)
 *   가장 최신 정정을 선별하여 적용 (입력 배열 shuffle에 무관한 결정론 보장)
 * - CorrectionMode (RETRACT, REPLACE, ADDITIVE) 정책 반영
 * - 반감기(decay) 적용
 * - 중복 수신된 이벤트 멱등성 보장 (eventId 기반)
 */
export function computeEffectiveNewsValuation(
  events: ObservableMarketEvent[],
  stockId: string,
  simulationTime: number,
  halfLifeMultiplier: number = 1.0
): number {
  if (!events || events.length === 0 || !stockId) return 0;
  return computeEffectiveEventValuationDelta(
    events,
    (e) => Array.isArray(e.targetStockIds) && e.targetStockIds.includes(stockId),
    simulationTime,
    halfLifeMultiplier
  );
}


export function evaluateValueStrategy(
  obs: MarketObservation,
  agent: AgentAccount,
  config: ValueStrategyConfig,
  trueFundamental: number,
  prng: SimPrng,
  effectParams?: BotEffectParams
): AgentOrderIntent {
  const effects = effectParams ?? NEUTRAL_BOT_EFFECT_PARAMS;
  const valueSensitivity = effects.valueSensitivity;
  const riskToleranceMultiplier = effects.riskToleranceMultiplier;
  const orderSizeMultiplier = effects.orderSizeMultiplier;
  const cashPreference = clamp01(effects.cashPreference);

  // 1. Latent fundamental observation with agent-specific estimation error & observable news signals
  const rawEvents = obs.effectiveEvents ?? obs.recentEvents ?? [];
  const newsValuationDelta = computeEffectiveNewsValuation(
    rawEvents,
    obs.stockId,
    obs.simulationTime,
    effects.newsHalfLifeMultiplier
  );

  // Cap combined news shock to reasonable range (-50% ~ +50%)
  const clampedShock = Math.max(-0.5, Math.min(0.5, newsValuationDelta));
  const baseF = trueFundamental * (1.0 + clampedShock);
  const noise = prng.nextNormal(0, config.noiseStdDev);
  const estimatedValue = baseF * (1.0 + noise);

  // 2. Valuation gap relative to current mid price
  const midPrice = obs.midPrice;
  if (midPrice <= 0) {
    return { action: 'hold', stockId: obs.stockId, reason: 'invalid_mid_price' };
  }

  const valGap = (estimatedValue - midPrice) / midPrice;

  // 3. Deadband (hysteresis) check: ignore small deviations
  if (Math.abs(valGap) < config.deadbandPct) {
    return { action: 'hold', stockId: obs.stockId, reason: 'within_deadband' };
  }

  // 4. Expected profit vs estimated round-trip transaction costs
  // Maker/taker fee ~0.25% each side, half-spread, plus estimated slippage
  const halfSpreadPct = obs.spread ? (obs.spread / (2 * midPrice)) : 0.0015;
  const estimatedRoundTripCost = 0.003 + halfSpreadPct; // fee + half-spread + buffer

  // 국면 uncertaintyMultiplier: 원본 불확실성 관측에 배수를 1회 적용하여 [0, 1] 유효 불확실성 산출
  // 진입에 필요한 최소 신호 강도(요구 안전 마진)에 1회 적용하여 높은 불확실성에서 섣부른 진입을 방지한다.
  const baseUncertainty = obs.uncertaintyScore ?? 0.05;
  const effectiveUncertainty = effectParams
    ? applyUncertaintyMultiplier(baseUncertainty, effects.uncertaintyMultiplier)
    : 0;
  const effectiveMinProfitMargin = effectParams
    ? config.minProfitMarginPct * (1 + effectiveUncertainty)
    : config.minProfitMarginPct;

  if (Math.abs(valGap) <= estimatedRoundTripCost + effectiveMinProfitMargin) {
    return { action: 'hold', stockId: obs.stockId, reason: 'insufficient_profit_margin' };
  }

  // 5. Position & Exposure Gap
  const baseTarget = agent.targetPositions[obs.stockId] ?? 1000;
  // 국면 valueSensitivity: 가치 괴리에 대한 반응 강도 (원본 펀더멘털/시장가격은 변경하지 않음)
  const normValGap = Math.tanh((valGap * valueSensitivity) / 0.05); // Scales 5% gap to ~0.76

  // Target position dynamically adjusted based on valuation gap
  const baseAdjustedTarget = Math.max(0, Math.min(agent.maxPosition, Math.round(baseTarget * (1 + normValGap))));
  // 국면 riskToleranceMultiplier: 목표 노출에 적용하되 절대 상한(maxPosition)은 상향하지 않음
  const adjustedTarget = applyRiskToleranceToTarget(baseAdjustedTarget, riskToleranceMultiplier, agent.maxPosition);
  const currentPos = obs.account.holdingQty;

  // Open buy/sell commitments
  let openBuyQty = 0;
  let openSellQty = 0;
  for (const ord of obs.activeOrders) {
    const rem = Math.max(0, ord.size - (ord.filled || 0));
    if (ord.side === 'buy') openBuyQty += rem;
    else openSellQty += rem;
  }

  // Tick size calculation
  const tickSize = midPrice < 2000 ? 1 : midPrice < 5000 ? 5 : midPrice < 20000 ? 10 : midPrice < 50000 ? 50 : midPrice < 200000 ? 100 : 500;

  // Participation rate limit based on recent volume (min floor 10 shares)
  const recentVol = obs.recentTrades.reduce((sum, t) => sum + t.size, 0);
  const participationCap = Math.max(10, Math.floor(recentVol * config.participationRate));

  // 6. BUY Logic (Undervalued)
  if (valGap > 0) {
    const neededShares = adjustedTarget - (currentPos + openBuyQty);
    if (neededShares <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'target_position_reached' };
    }

    let orderSize: number;
    if (!effectParams) {
      // 효과 OFF: 변경 전 수량 계산 보존 (절대 한도 최솟값)
      orderSize = Math.max(1, Math.min(neededShares, agent.maxOrderSize, participationCap));
    } else {
      // 효과 ON: 전략의 기본 희망 수량(분할 실행 계수 exposureWeight 반영)에 국면 배수를 1회 곱한 뒤 절대 한도로 제한
      const executionIntensity = Math.max(0.01, Math.min(1.0, config.exposureWeight ?? 1.0));
      const baseDesiredShares = Math.round(neededShares * executionIntensity);
      orderSize = applyOrderSizeMultiplier(
        baseDesiredShares,
        orderSizeMultiplier,
        neededShares,
        agent.maxOrderSize,
        participationCap
      );
    }

    if (orderSize <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'insufficient_size' };
    }

    // Pricing:
    // If valuation is clearly above bestAsk and agent has urgency or large valuation gap,
    // take available liquidity at best ask (marketable limit / IOC).
    // Otherwise, place a passive maker limit order at best bid.
    const canCrossSpread = obs.bestAsk !== null && estimatedValue >= obs.bestAsk;
    const shouldTakeLiquidity = canCrossSpread && (agent.urgency >= 0.2 || valGap >= 0.05);

    const idealPrice = shouldTakeLiquidity
      ? obs.bestAsk!
      : (obs.bestBid !== null 
          ? Math.min(obs.bestBid, Math.floor(estimatedValue / tickSize) * tickSize)
          : Math.floor((midPrice - tickSize) / tickSize) * tickSize);

    const alignedPrice = Math.max(tickSize, Math.round(idealPrice / tickSize) * tickSize);

    // Capital check
    const costPerShare = alignedPrice * 1.0025;
    let maxAffordable: number;
    if (!effectParams || cashPreference <= 0) {
      // 효과 OFF 또는 cashPreference=0: 기존 가용 현금(availableCash) 기준 계산 보존
      maxAffordable = Math.floor(obs.account.availableCash / costPerShare);
    } else {
      // 효과 ON: 계좌 전체 NAV = 장부 현금 + 전체 보유 주식 평가액
      // targetCash = NAV * cashPreference
      // spendableCash = max(0, 장부 현금 - 전체 매수 예약금 - targetCash) = max(0, availableCash - targetCash)
      const totalHoldingsVal = obs.account.totalHoldingsValue ?? (obs.account.holdingQty * midPrice);
      const nav = obs.account.nav ?? (obs.account.cash + totalHoldingsVal);
      const targetCash = nav * cashPreference;
      const spendableCash = Math.max(0, obs.account.availableCash - targetCash);
      maxAffordable = Math.floor(spendableCash / costPerShare);
    }

    const finalSize = Math.min(orderSize, maxAffordable);

    if (finalSize <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'insufficient_cash' };
    }

    // Check if existing open order already matches this side and price (no duplicates)
    if (!shouldTakeLiquidity) {
      const existingMatchingOrder = obs.activeOrders.find(
        (o) => o.side === 'buy' && Math.abs(o.price - alignedPrice) <= tickSize
      );
      if (existingMatchingOrder) {
        return { action: 'hold', stockId: obs.stockId, reason: 'order_already_resting' };
      }
    }

    return {
      action: 'buy',
      stockId: obs.stockId,
      price: alignedPrice,
      size: finalSize,
      orderType: shouldTakeLiquidity ? 'ioc' : 'limit',
      reason: `value_buy: gap=${(valGap * 100).toFixed(2)}%` + (effectParams ? `, unc=${effectiveUncertainty.toFixed(3)}` : ''),
    };
  }

  // 7. SELL Logic (Overvalued - Symmetric)
  if (valGap < 0) {
    const surplusShares = (currentPos - openSellQty) - adjustedTarget;
    if (surplusShares <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'target_position_reached' };
    }

    let orderSize: number;
    if (!effectParams) {
      // 효과 OFF: 변경 전 수량 계산 보존
      orderSize = Math.max(1, Math.min(surplusShares, agent.maxOrderSize, participationCap));
    } else {
      // 효과 ON: 기본 희망 수량에 배수 적용 후 절대 한도로 제한
      const executionIntensity = Math.max(0.01, Math.min(1.0, config.exposureWeight ?? 1.0));
      const baseDesiredShares = Math.round(surplusShares * executionIntensity);
      orderSize = applyOrderSizeMultiplier(
        baseDesiredShares,
        orderSizeMultiplier,
        surplusShares,
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

    // Pricing:
    // If valuation is clearly below bestBid and agent has urgency or large valuation gap,
    // take available liquidity at best bid (marketable limit / IOC).
    // Otherwise, place a passive maker limit order at best ask.
    const canCrossSpreadSell = obs.bestBid !== null && estimatedValue <= obs.bestBid;
    const shouldTakeLiquiditySell = canCrossSpreadSell && (agent.urgency >= 0.2 || valGap <= -0.05);

    const idealPrice = shouldTakeLiquiditySell
      ? obs.bestBid!
      : (obs.bestAsk !== null
          ? Math.max(obs.bestAsk, Math.ceil(estimatedValue / tickSize) * tickSize)
          : Math.ceil((midPrice + tickSize) / tickSize) * tickSize);

    const alignedPrice = Math.max(tickSize, Math.round(idealPrice / tickSize) * tickSize);

    // Check if existing open order already matches this side and price (no duplicates)
    if (!shouldTakeLiquiditySell) {
      const existingMatchingOrder = obs.activeOrders.find(
        (o) => o.side === 'sell' && Math.abs(o.price - alignedPrice) <= tickSize
      );
      if (existingMatchingOrder) {
        return { action: 'hold', stockId: obs.stockId, reason: 'order_already_resting' };
      }
    }

    return {
      action: 'sell',
      stockId: obs.stockId,
      price: alignedPrice,
      size: availableToSell,
      orderType: shouldTakeLiquiditySell ? 'ioc' : 'limit',
      reason: `value_sell: gap=${(valGap * 100).toFixed(2)}%` + (effectParams ? `, unc=${effectiveUncertainty.toFixed(3)}` : ''),
    };
  }

  return { action: 'hold', stockId: obs.stockId, reason: 'neutral' };
}
