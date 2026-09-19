/**
 * scripts/test-comparison-827dd60.ts
 *
 * 827dd607 실제 전략 코드와 현재 수정 코드의 효과 OFF 동작 직접 비교 검증
 */

import { evaluateTrendStrategy as currentEvaluateTrendStrategy } from '../lib/engine/simulation/strategies/trendStrategy';
import { MarketObservation } from '../lib/engine/simulation/marketObservation';
import { AgentAccount, TrendStrategyConfig } from '../lib/engine/simulation/agentTypes';
import { SimPrng } from '../lib/engine/simulation/simClock';

// 827dd6079a11f58cdb2746668cbab7290752b8f4 원본 코드 구현
function baselineEvaluateTrendStrategy(
  obs: MarketObservation,
  agent: AgentAccount,
  config: TrendStrategyConfig
) {
  // 1. Warm-up check
  if (obs.isWarmup || obs.priceHistory.length < config.minWarmupSteps) {
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

  // Combined momentum
  const rawSignal = 0.70 * Math.tanh(rollingReturn / config.trendScale) + 0.30 * flowSignal;
  const normTrend = Math.tanh(rawSignal * 1.0);

  // 4. Threshold check
  if (Math.abs(normTrend) < Math.min(Math.abs(config.buyThreshold), Math.abs(config.sellThreshold))) {
    return { action: 'hold', stockId: obs.stockId, reason: 'trend_below_threshold' };
  }

  // 5. Target exposure calculation
  const baseTarget = agent.targetPositions[obs.stockId] ?? 1000;
  const baseAdjustedTarget = normTrend > 0
    ? Math.min(agent.maxPosition, Math.round(baseTarget + (agent.maxPosition - baseTarget) * normTrend))
    : Math.max(0, Math.round(baseTarget * (1 + normTrend)));

  const adjustedTarget = Math.min(agent.maxPosition, Math.max(0, baseAdjustedTarget));
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

    const orderSize = Math.max(1, Math.min(needed, agent.maxOrderSize, participationCap));
    if (orderSize <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'insufficient_size' };
    }

    const isUrgent = normTrend >= config.buyThreshold && agent.urgency >= 0.5 && obs.bestAsk !== null;
    let targetPrice = isUrgent
      ? obs.bestAsk!
      : (obs.bestBid !== null ? obs.bestBid : currentPrice);

    targetPrice = Math.max(tickSize, Math.round(targetPrice / tickSize) * tickSize);

    const costPerShare = targetPrice * 1.0025;
    const maxAffordable = Math.floor(obs.account.availableCash / costPerShare);
    const finalSize = Math.min(orderSize, maxAffordable);

    if (finalSize <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'insufficient_cash' };
    }

    if (!isUrgent) {
      const existing = obs.activeOrders.find(
        (o) => o.side === 'buy' && Math.abs(o.price - targetPrice) <= tickSize
      );
      if (existing) {
        return { action: 'hold', stockId: obs.stockId, reason: 'order_already_resting' };
      }
    }

    return {
      action: 'buy' as const,
      stockId: obs.stockId,
      price: targetPrice,
      size: finalSize,
      orderType: (isUrgent ? 'ioc' : 'limit') as 'ioc' | 'limit',
      reason: `trend_buy: signal=${normTrend.toFixed(3)}, return=${(rollingReturn * 100).toFixed(2)}%`,
    };
  }

  // 7. Bearish Trend -> SELL
  if (normTrend <= config.sellThreshold) {
    const surplus = (currentPos - openSellQty) - adjustedTarget;
    if (surplus <= 0) {
      return { action: 'hold', stockId: obs.stockId, reason: 'trend_target_reached' };
    }

    const orderSize = Math.max(1, Math.min(surplus, agent.maxOrderSize, participationCap));
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
      action: 'sell' as const,
      stockId: obs.stockId,
      price: targetPrice,
      size: availableToSell,
      orderType: (isUrgent ? 'ioc' : 'limit') as 'ioc' | 'limit',
      reason: `trend_sell: signal=${normTrend.toFixed(3)}, return=${(rollingReturn * 100).toFixed(2)}%`,
    };
  }

  return { action: 'hold', stockId: obs.stockId, reason: 'neutral' };
}

function main() {
  console.log('================================================================');
  console.log('  827dd60 vs 현재 수정 코드 효과 OFF 1:1 직접 비교 검증');
  console.log('================================================================');

  const config: TrendStrategyConfig = {
    trendWeight: 1.0,
    exposureWeight: 1.0,
    lookbackSteps: 3,
    minWarmupSteps: 4,
    trendScale: 0.05,
    participationRate: 0.5,
    buyThreshold: 0.25,
    sellThreshold: -0.25,
  };

  const urgencies = [0.1, 0.2, 0.35, 0.5, 0.75, 0.9];
  const priceProfiles = [
    [9500, 9600, 9700, 9800, 10000],  // 상승 추세
    [10500, 10400, 10300, 10200, 10000], // 하락 추세
    [9950, 10050, 10000, 9980, 10000], // 횡보
    [9000, 9200, 9500, 9800, 10500], // 강한 상승 (normTrend > 0.6)
  ];
  const bookProfiles: { bestBid: number | null; bestAsk: number | null }[] = [
    { bestBid: 9900, bestAsk: 10100 },
    { bestBid: 9900, bestAsk: null },
    { bestBid: null, bestAsk: 10100 },
    { bestBid: null, bestAsk: null },
  ];

  let testCount = 0;
  for (const urgency of urgencies) {
    for (const prices of priceProfiles) {
      for (const book of bookProfiles) {
        testCount++;
        const currentP = prices[prices.length - 1];
        const obs: MarketObservation = {
          stockId: 'test_stock',
          ticker: '005930',
          midPrice: currentP,
          bestBid: book.bestBid,
          bestAsk: book.bestAsk,
          spread: book.bestBid && book.bestAsk ? book.bestAsk - book.bestBid : null,
          hasTwoSidedBook: book.bestBid !== null && book.bestAsk !== null,
          bidsDepth: book.bestBid ? [{ price: book.bestBid, size: 5000 }] : [],
          asksDepth: book.bestAsk ? [{ price: book.bestAsk, size: 5000 }] : [],
          lastTradePrice: currentP,
          lastTradeVolume: 1000,
          recentTrades: [{ id: 't', stock_id: 'test_stock', price: currentP, size: 5000, buyer_id: 'b', seller_id: 's', buyer_is_bot: false, seller_is_bot: false, sequence: 1, created_at: '' }],
          priceHistory: prices,
          returns: [0.01],
          volatility: 0.02,
          isWarmup: false,
          simulationTime: 1000,
          account: {
            cash: 20000000,
            holdingQty: 500,
            avgPrice: 10000,
            reservedCash: 0,
            reservedHolding: 0,
            availableCash: 20000000,
            availableHolding: 500,
            totalHoldingsValue: 5000000,
            nav: 25000000,
            isPortfolioValuationComplete: true,
          },
          activeOrders: [],
        };

        const agent: AgentAccount = {
          accountId: 'acc_test',
          agentId: 'ag_test',
          name: 'Test',
          participantType: 'bot',
          strategyType: 'trend',
          targetPositions: { test_stock: 1000 },
          maxOrderSize: 500,
          maxPosition: 5000,
          riskTolerance: 0.5,
          urgency,
          activityRate: 1.0,
          nextDecisionTime: 0,
          stats: { ordersSubmitted: 0, ordersCancelled: 0, fillsCount: 0, volumeTraded: 0, feesPaid: 0, realizedPnl: 0 },
        };

        const baselinePlan = baselineEvaluateTrendStrategy(obs, agent, config);
        const currentPlan = currentEvaluateTrendStrategy(obs, agent, config, undefined); // 효과 OFF

        if (
          baselinePlan.action !== currentPlan.action ||
          baselinePlan.price !== currentPlan.price ||
          baselinePlan.size !== currentPlan.size ||
          baselinePlan.orderType !== currentPlan.orderType
        ) {
          console.error(`\n❌ MISMATCH at test #${testCount}:`);
          console.error('Urgency:', urgency, 'Book:', book);
          console.error('Baseline Plan:', baselinePlan);
          console.error('Current Plan:', currentPlan);
          process.exit(1);
        }
      }
    }
  }

  console.log(`✓ 총 ${testCount}개 조합에서 827dd60 기준 코드와 현재 수정 코드의 효과 OFF 결과가 100% 정확히 일치함 (action, price, size, orderType)`);
  process.exit(0);
}

main();
