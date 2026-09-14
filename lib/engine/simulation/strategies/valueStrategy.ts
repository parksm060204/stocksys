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
import { SimPrng } from '../simClock';

export function evaluateValueStrategy(
  obs: MarketObservation,
  agent: AgentAccount,
  config: ValueStrategyConfig,
  trueFundamental: number,
  prng: SimPrng
): AgentOrderIntent {
  // 1. Latent fundamental observation with agent-specific estimation error & observable news signals
  let newsValuationDelta = 0;
  if (obs.recentEvents && obs.recentEvents.length > 0) {
    // Build the set of rumor eventIds this agent has already seen corrected (via its visible CORRECTION events)
    const agentCorrectedIds = new Set<string>();
    for (const ev of obs.recentEvents) {
      if (ev.eventType === 'CORRECTION' && ev.originalEventId) {
        agentCorrectedIds.add(ev.originalEventId);
      }
    }

    for (const ev of obs.recentEvents) {
      if (ev.targetStockIds.includes(obs.stockId)) {
        // If this agent has already received a CORRECTION that nullifies this rumor, treat confidence as 0
        const effectiveConfidence = agentCorrectedIds.has(ev.eventId) ? 0 : ev.confidence;
        const elapsed = Math.max(0, obs.simulationTime - ev.publishedAt);
        const decay = Math.pow(2, -elapsed / Math.max(1, ev.halfLife));
        newsValuationDelta += ev.valuationSignal * effectiveConfidence * decay;
      }
    }
  }

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
