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
  events: import('../marketEventTypes').ObservableMarketEvent[],
  stockId: string,
  simulationTime: number
): number {
  if (!events || events.length === 0 || !stockId) return 0;

  // 1. 이벤트 중복 방지 (멱등성 보장)
  const uniqueEventsMap = new Map<string, import('../marketEventTypes').ObservableMarketEvent>();
  for (const ev of events) {
    if (ev && typeof ev.eventId === 'string' && !uniqueEventsMap.has(ev.eventId)) {
      uniqueEventsMap.set(ev.eventId, ev);
    }
  }
  const uniqueEvents = Array.from(uniqueEventsMap.values());

  // 2. 유효 시점 필터링 (effectiveFrom <= simulationTime)
  const effectiveEvents = uniqueEvents.filter((e) => Number.isFinite(e.effectiveFrom) && e.effectiveFrom <= simulationTime);
  if (effectiveEvents.length === 0) return 0;

  // 3. 대상 종목(stockId) 필터링: 해당 종목을 명시적으로 포함하는 이벤트만 참여
  const stockEvents = effectiveEvents.filter((e) => Array.isArray(e.targetStockIds) && e.targetStockIds.includes(stockId));
  if (stockEvents.length === 0) return 0;

  // 4. 해당 종목에 적용되는 정정 이벤트(CORRECTION) 추출 및 결정론적 정렬
  const correctionsByOriginalId = new Map<string, import('../marketEventTypes').ObservableMarketEvent[]>();
  const presentRumorIds = new Set<string>();

  for (const ev of stockEvents) {
    if (ev.eventType === 'RUMOR') {
      presentRumorIds.add(ev.eventId);
    } else if (ev.eventType === 'CORRECTION' && ev.originalEventId) {
      const list = correctionsByOriginalId.get(ev.originalEventId) ?? [];
      list.push(ev);
      correctionsByOriginalId.set(ev.originalEventId, list);
    }
  }

  // 결정론적 정렬: effectiveFrom ASC -> publishedAt ASC -> sequence ASC -> eventId ASC
  const winningCorrectionByOriginalId = new Map<string, import('../marketEventTypes').ObservableMarketEvent>();
  for (const [origId, corrList] of correctionsByOriginalId.entries()) {
    corrList.sort((a, b) => {
      if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom - b.effectiveFrom;
      if (a.publishedAt !== b.publishedAt) return a.publishedAt - b.publishedAt;
      const seqA = a.sequence ?? 0;
      const seqB = b.sequence ?? 0;
      if (seqA !== seqB) return seqA - seqB;
      return a.eventId.localeCompare(b.eventId);
    });
    // 가장 최신 정정 1건을 승자로 선정
    winningCorrectionByOriginalId.set(origId, corrList[corrList.length - 1]);
  }

  let newsValuationDelta = 0;

  for (const ev of stockEvents) {
    // 1. 원본 루머 처리
    if (ev.eventType === 'RUMOR') {
      const winningCorr = winningCorrectionByOriginalId.get(ev.eventId);
      if (winningCorr) {
        const mode = winningCorr.correctionMode ?? 'RETRACT';
        // RETRACT, REPLACE 모드: 정정 수신 이후 미래 의사결정에서 원본 루머의 가치평가 기여도 제거
        if (mode === 'RETRACT' || mode === 'REPLACE') {
          continue;
        }
        // ADDITIVE 모드: 원본 루머의 가치평가 기여도를 그대로 유지하며 아래에서 감쇠 계산 진행
      }
    }

    // 2. 정정 이벤트(CORRECTION) 처리
    if (ev.eventType === 'CORRECTION') {
      // 복수 정정 중 최신으로 선별된 정정이 아니라면 이전 정정은 무시(최신 정정 승자독식)
      if (ev.originalEventId) {
        const winningCorr = winningCorrectionByOriginalId.get(ev.originalEventId);
        if (winningCorr && winningCorr.eventId !== ev.eventId) {
          continue;
        }
      }

      const mode = ev.correctionMode ?? 'RETRACT';
      if (ev.originalEventId && presentRumorIds.has(ev.originalEventId)) {
        if (mode === 'RETRACT') {
          // RETRACT 모드: 원본 루머 무효화만 수행하고 자체 valuationSignal은 미반영 (이중 계산 방지)
          continue;
        }
        // REPLACE 모드: 원본은 무효화되었고, 정정 이벤트의 새로운 valuationSignal을 대체 반영
        // ADDITIVE 모드: 원본도 유지되고, 정정 이벤트의 신호도 추가 가산 반영
      }
    }

    const elapsed = millisecondsToSeconds(Math.max(0, simulationTime - ev.effectiveFrom));
    const decay = Math.pow(2, -elapsed / ev.halfLife);
    newsValuationDelta += ev.valuationSignal * ev.confidence * decay;
  }

  return newsValuationDelta;
}

export function evaluateValueStrategy(
  obs: MarketObservation,
  agent: AgentAccount,
  config: ValueStrategyConfig,
  trueFundamental: number,
  prng: SimPrng
): AgentOrderIntent {
  // 1. Latent fundamental observation with agent-specific estimation error & observable news signals
  const rawEvents = obs.effectiveEvents ?? obs.recentEvents ?? [];
  const newsValuationDelta = computeEffectiveNewsValuation(rawEvents, obs.stockId, obs.simulationTime);

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

  if (Math.abs(valGap) <= estimatedRoundTripCost + config.minProfitMarginPct) {
    return { action: 'hold', stockId: obs.stockId, reason: 'insufficient_profit_margin' };
  }

  // 5. Position & Exposure Gap
  const baseTarget = agent.targetPositions[obs.stockId] ?? 1000;
  const normValGap = Math.tanh(valGap / 0.05); // Scales 5% gap to ~0.76

  // Target position dynamically adjusted based on valuation gap
  const adjustedTarget = Math.max(0, Math.min(agent.maxPosition, Math.round(baseTarget * (1 + normValGap))));
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

    const orderSize = Math.max(1, Math.min(neededShares, agent.maxOrderSize, participationCap));

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
    const maxAffordable = Math.floor(obs.account.availableCash / costPerShare);
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
      reason: `value_buy: gap=${(valGap * 100).toFixed(2)}%`,
    };
  }

  // 7. SELL Logic (Overvalued - Symmetric)
  if (valGap < 0) {
    const surplusShares = (currentPos - openSellQty) - adjustedTarget;
    if (surplusShares <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'target_position_reached' };
    }

    const orderSize = Math.max(1, Math.min(surplusShares, agent.maxOrderSize, participationCap));
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
      reason: `value_sell: gap=${(valGap * 100).toFixed(2)}%`,
    };
  }

  return { action: 'hold', stockId: obs.stockId, reason: 'neutral' };
}
