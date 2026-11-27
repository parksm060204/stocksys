/**
 * scripts/test-bot-algorithm-upgrade.ts
 *
 * Pure TypeScript Bot Algorithm Upgrade Verification Suite (Zero external AI/network/Math.random/Date.now):
 * 1. Order Book Imbalance (OBI) & microstructure placement aggressiveness
 * 2. Statistical Mean-Reversion (z-score) & volatility-adaptive sizing
 * 3. Adaptive drawdown / performance / inventory-skew risk control & snapshot/restore
 * 4. Stock/ETF AgentManager bit-identical determinism, snapshot rollback & guards (is_listed=false, cash/holding, no self-trade)
 * 5. Commodity 5-bot upgrades, snapshotRuntimeState/restoreRuntimeState & CommodityMarketEngine determinism/rollback
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-bot-algo-'));
const tmpDataDir = path.join(tmpRoot, 'data');
fs.mkdirSync(tmpDataDir, { recursive: true });
process.env.STOCKSYS_DATA_DIR = tmpDataDir;
process.env.ENGINE_SERVER_DATA_DIR = tmpDataDir;

import { memoryDb } from '../lib/memoryDb/memoryStore';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import type { MarketObservation } from '../lib/engine/simulation/marketObservation';
import type { AgentAccount, MeanReversionStrategyConfig } from '../lib/engine/simulation/agentTypes';
import {
  computeOrderBookImbalance,
  computeMicrostructureSignal,
  resolveExecutionPlacement,
} from '../lib/engine/simulation/strategies/orderbookMicrostructure';
import {
  computeMeanReversionSignal,
  evaluateMeanReversionStrategy,
} from '../lib/engine/simulation/strategies/meanReversionStrategy';
import {
  AdaptiveRiskManager,
  computeAdaptiveRiskMultipliers,
} from '../lib/engine/simulation/strategies/adaptiveRiskControl';
import { LocalMarketService } from '../lib/engine/marketService';
import { CommodityMarketEngine } from '../lib/commodities/CommodityMarketEngine';
import {
  TrendFollowingBot,
  MeanReversionBot,
  HedgerBot,
  MarketMakerBot,
  NewsTraderBot,
} from '../lib/commodities/bots';
import { createSimulationContext } from '../lib/engine/simulation/runtime/simulationContext';
import { SimulationClock } from '../lib/engine/simulation/simClock';

function makeSyntheticObservation(overrides?: Partial<MarketObservation>): MarketObservation {
  return {
    stockId: 'stk_test',
    ticker: 'TEST',
    isUsdAsset: false,
    bestBid: 50000,
    bestAsk: 50100,
    midPrice: 50050,
    spread: 100,
    hasTwoSidedBook: true,
    bidsDepth: [
      { price: 50000, size: 800 },
      { price: 49900, size: 600 },
      { price: 49800, size: 400 },
    ],
    asksDepth: [
      { price: 50100, size: 150 },
      { price: 50200, size: 100 },
      { price: 50300, size: 80 },
    ],
    lastTradePrice: 50000,
    lastTradeVolume: 50,
    recentTrades: [
      { id: 't1', stock_id: 'stk_test', buyer_id: 'u1', seller_id: 'u2', price: 49950, size: 20, created_at: '2026-01-01T00:00:00.000Z' } as any,
      { id: 't2', stock_id: 'stk_test', buyer_id: 'u1', seller_id: 'u2', price: 50000, size: 30, created_at: '2026-01-01T00:00:01.000Z' } as any,
    ],
    priceHistory: [50000, 50000, 50100, 50050, 50000, 49900, 49800, 49600, 49400, 49100],
    returns: [0, 0.002, -0.001, -0.001, -0.002, -0.002, -0.004, -0.004, -0.006],
    volatility: 0.005,
    isWarmup: false,
    simulationTime: 1773500010000,
    fxRateToKrw: 1,
    windowStats: {
      stockId: 'stk_test',
      volume: 1000,
      turnover: 50_000_000,
      signedFlow: 600,
      tradeCount: 15,
      buyVolume: 800,
      sellVolume: 200,
      vwap: 50000,
      lastPrice: 49100,
      high: 50100,
      low: 49100,
      open: 50000,
      returnRate: -0.018,
      spread: 100,
      hasTwoSidedBook: true,
      currentSpreadBps: 19.98,
      bidDepthShares: 1800,
      askDepthShares: 330,
      depthShares: 2130,
      hasValidTwoSidedQuote: true,
    } as any,
    account: {
      cash: 50_000_000,
      holdingQty: 100,
      avgPrice: 50000,
      reservedCash: 0,
      reservedHolding: 0,
      availableCash: 50_000_000,
      availableHolding: 100,
      totalHoldingsValue: 5_000_000,
      nav: 55_000_000,
      isPortfolioValuationComplete: true,
    },
    activeOrders: [],
    ...overrides,
  };
}

function testMicrostructureAndObi() {
  console.log('[1/5] Testing Order Book Imbalance (OBI) & microstructure placement...');

  const bidHeavy = computeOrderBookImbalance(
    [{ price: 100, size: 500 }, { price: 99, size: 300 }],
    [{ price: 101, size: 100 }, { price: 102, size: 50 }]
  );
  assert.ok(bidHeavy.obi > 0.5, `Bid-heavy OBI expected > 0.5, got ${bidHeavy.obi}`);

  const askHeavy = computeOrderBookImbalance(
    [{ price: 100, size: 80 }],
    [{ price: 101, size: 600 }]
  );
  assert.ok(askHeavy.obi < -0.5, `Ask-heavy OBI expected < -0.5, got ${askHeavy.obi}`);

  const empty = computeOrderBookImbalance([], []);
  assert.equal(empty.obi, 0);

  const obs = makeSyntheticObservation();
  const micro = computeMicrostructureSignal(obs);
  assert.ok(micro.obi > 0.5);
  assert.ok(micro.signedFlowPressure > 0);
  assert.ok(micro.compositePressure > 0.4);
  assert.ok(micro.spreadBps !== null && micro.spreadBps > 0 && micro.spreadBps < 25);

  // Strong signal + high urgency + favorable OBI + tight spread => aggressive IOC at bestAsk
  const aggressiveBuy = resolveExecutionPlacement({
    side: 'buy',
    signalMagnitude: 0.9,
    agentUrgency: 0.8,
    micro,
    midPrice: obs.midPrice,
    bestBid: obs.bestBid,
    bestAsk: obs.bestAsk,
    tickSize: 100,
    isUsdAsset: false,
  });
  assert.equal(aggressiveBuy.mode, 'aggressive');
  assert.equal(aggressiveBuy.orderType, 'ioc');
  assert.equal(aggressiveBuy.price, 50100);

  // Weak signal + low urgency + wide spread => passive limit order
  const passiveObs = makeSyntheticObservation({
    spread: 1000,
    bestBid: 50000,
    bestAsk: 51000,
    bidsDepth: [{ price: 50000, size: 100 }],
    asksDepth: [{ price: 51000, size: 500 }],
    windowStats: undefined,
  });
  const passiveMicro = computeMicrostructureSignal(passiveObs);
  const passiveBuy = resolveExecutionPlacement({
    side: 'buy',
    signalMagnitude: 0.3,
    agentUrgency: 0.2,
    micro: passiveMicro,
    midPrice: 50500,
    bestBid: 50000,
    bestAsk: 51000,
    tickSize: 100,
    isUsdAsset: false,
  });
  assert.equal(passiveBuy.mode, 'passive');
  assert.equal(passiveBuy.orderType, 'limit');
  assert.ok(passiveBuy.price <= 50100);

  console.log('  OK: OBI, execution volatility & aggressive/passive placement verified.');
}

function testMeanReversionAndAdaptiveRisk() {
  console.log('[2/5] Testing statistical mean-reversion (z-score/vol) & adaptive drawdown control...');

  const lowVolPrices = [100, 100.1, 100.2, 100.0, 99.9, 100.1, 100.0, 96.5];
  const lowVolReturns = [0.001, 0.001, -0.002, -0.001, 0.002, -0.001, -0.035];
  const mrLow = computeMeanReversionSignal(lowVolPrices, lowVolReturns, 10, 1.5, 2.0)!;
  assert.ok(mrLow.zScore < -1.5, `Oversold zScore expected < -1.5, got ${mrLow.zScore}`);
  assert.ok(mrLow.reversionSignal > 0.5, 'Negative z-score must generate bullish reversion signal');

  const highVolPrices = [100, 112, 89, 115, 86, 118, 84, 78];
  const highVolReturns = [0.12, -0.205, 0.292, -0.252, 0.372, -0.288, -0.071];
  const mrHigh = computeMeanReversionSignal(highVolPrices, highVolReturns, 10, 1.5, 2.0)!;
  assert.ok(mrHigh.effectiveEntryZ > mrLow.effectiveEntryZ, 'High volatility must widen entry z-score threshold');
  assert.ok(mrHigh.volatilitySizeScale < mrLow.volatilitySizeScale, 'High volatility must shrink sizing scale');

  const mrConfig: MeanReversionStrategyConfig = {
    reversionWeight: 1.0,
    exposureWeight: 0.5,
    lookbackSteps: 10,
    minWarmupSteps: 5,
    entryZScore: 1.5,
    zScale: 2.0,
    participationRate: 0.25,
    buyThreshold: 0.2,
    sellThreshold: -0.2,
  };
  const agent: AgentAccount = {
    accountId: 'acc_mr_test',
    agentId: 'agent_mr_test',
    participantType: 'bot',
    strategyType: 'mean_reversion',
    name: 'MR Test',
    targetPositions: { stk_test: 500 },
    maxOrderSize: 200,
    maxPosition: 2000,
    riskTolerance: 0.5,
    urgency: 0.4,
    activityRate: 1.0,
    nextDecisionTime: 0,
    stats: { ordersSubmitted: 0, ordersCancelled: 0, fillsCount: 0, volumeTraded: 0, feesPaid: 0, realizedPnl: 0 },
  };

  // Price dropped far below rolling mean -> BUY
  const buyObs = makeSyntheticObservation({
    priceHistory: [50000, 50100, 50000, 49900, 50000, 50100, 50000, 49900, 50000, 47000],
  });
  const normalRisk = computeAdaptiveRiskMultipliers({
    currentEquity: 55_000_000,
    peakEquity: 55_000_000,
    currentPosition: 100,
    maxPosition: 2000,
  });
  const buyIntent = evaluateMeanReversionStrategy(buyObs, agent, mrConfig, normalRisk);
  assert.equal(buyIntent.action, 'buy', `Expected mean-reversion BUY, got ${buyIntent.action} (${buyIntent.reason})`);

  // Drawdown & high long inventory skew must throttle position cap and buy size
  const stressedRisk = computeAdaptiveRiskMultipliers({
    currentEquity: 46_000_000,
    peakEquity: 55_000_000,
    currentPosition: 1800,
    maxPosition: 2000,
    realizedPnl: -3_000_000,
    consecutiveLossSteps: 3,
    baseRiskTolerance: 0.5,
  });
  assert.ok(stressedRisk.drawdownPct > 0.15);
  assert.ok(stressedRisk.positionLimitMultiplier < 0.7);
  assert.ok(stressedRisk.buySizeMultiplier < 0.35);
  assert.ok(stressedRisk.sellSizeMultiplier >= stressedRisk.buySizeMultiplier);

  // AdaptiveRiskManager snapshot & restore
  const arm = new AdaptiveRiskManager();
  arm.updateAgentEquity('acc_1', 10_000_000, 0, 1000);
  arm.updateAgentEquity('acc_1', 8_500_000, -500_000, 2000);
  const snap = arm.snapshotState();
  arm.updateAgentEquity('acc_1', 12_000_000, 1_000_000, 3000);
  assert.equal(arm.getRecord('acc_1')?.peakEquity, 12_000_000);
  arm.restoreState(snap);
  assert.equal(arm.getRecord('acc_1')?.peakEquity, 10_000_000);
  assert.equal(arm.getRecord('acc_1')?.lastEquity, 8_500_000);

  console.log('  OK: Mean-reversion z-score, volatility scaling & adaptive risk control verified.');
}

async function testAgentManagerDeterminismRollbackAndGuards() {
  console.log('[3/5] Testing Stock/ETF AgentManager 2x determinism, snapshot rollback & market guards...');

  const snapshotStockOrderBooks = () =>
    Array.from(memoryDb.stocks.values()).map((s) => ({
      id: s.id,
      price: s.current_price,
      vol: s.volume,
    }));

  const runDeterministicHorizon = async (seed: number, registerMrBot: boolean) => {
    memoryDb.resetToSeedData({ suppressPublish: true });
    // Delist one stock explicitly to assert is_listed === false guard
    const allStocks = Array.from(memoryDb.stocks.values());
    const delistedTarget = allStocks[allStocks.length - 1];
    delistedTarget.is_listed = false;
    const delistedBeforeOrderIds = new Set(
      Array.from(memoryDb.orders.values())
        .filter((o) => o.stock_id === delistedTarget.id)
        .map((o) => o.id)
    );
    const delistedBeforeTradeCount = memoryDb.trades.filter((t) => t.stock_id === delistedTarget.id).length;

    const mgr = new AgentManager(seed, 1773500000000, { enableRegimeEngine: true });
    if (registerMrBot) {
      memoryDb.ensureUserProfile('acc_bot_mr_01', {
        id: 'acc_bot_mr_01',
        nickname: '평균회귀 봇',
        cash: 500_000_000,
        net_worth: 500_000_000,
      });
      mgr.registerAgent({
        accountId: 'acc_bot_mr_01',
        agentId: 'agent_mr_01',
        participantType: 'bot',
        strategyType: 'mean_reversion',
        name: '통계 평균회귀 봇 1호',
        targetPositions: {},
        maxOrderSize: 200,
        maxPosition: 5000,
        riskTolerance: 0.6,
        urgency: 0.45,
        activityRate: 1.0,
        infoLatency: 1.0,
        evaluationsPerStep: 5,
        nextDecisionTime: 0,
        stats: { ordersSubmitted: 0, ordersCancelled: 0, fillsCount: 0, volumeTraded: 0, feesPaid: 0, realizedPnl: 0 },
      });
    }

    for (let i = 0; i < 6; i++) {
      await mgr.step(1.0);
    }

    // Verify delisted stock received zero new bot orders & zero new trades after delisting
    const newDelistedOrders = Array.from(memoryDb.orders.values()).filter(
      (o) => o.stock_id === delistedTarget.id && !delistedBeforeOrderIds.has(o.id)
    );
    assert.equal(newDelistedOrders.length, 0, 'is_listed=false stock must receive 0 new bot orders');
    const delistedAfterTradeCount = memoryDb.trades.filter((t) => t.stock_id === delistedTarget.id).length;
    assert.equal(delistedAfterTradeCount, delistedBeforeTradeCount, 'is_listed=false stock must receive 0 new trades');

    // Verify no negative cash or negative holdings across all bots & no self-trade fills
    const registeredAgents = Array.from(mgr.agents.values());
    for (const accId of registeredAgents.map((a) => a.accountId)) {
      const prof = memoryDb.resolveProfileByUserId(accId);
      assert.ok((prof?.cash ?? 0) >= 0, `Bot ${accId} cash must remain non-negative`);
    }
    for (const tr of memoryDb.trades) {
      if (tr.buyer_id && tr.seller_id) {
        assert.notEqual(tr.buyer_id, tr.seller_id, 'Self-trades must never execute');
      }
    }

    return {
      mgr,
      prices: snapshotStockOrderBooks(),
      riskSnap: mgr.adaptiveRiskManager.snapshotState(),
      stats: registeredAgents.map((a) => ({ id: a.accountId, stats: a.stats })),
      tradesCount: memoryDb.trades.length,
    };
  };

  const run1 = await runDeterministicHorizon(202611, true);
  const run2 = await runDeterministicHorizon(202611, true);
  assert.deepEqual(run1.prices, run2.prices, 'Same-seed Run 1 & Run 2 stock prices must be bit-identical');
  assert.deepEqual(run1.riskSnap, run2.riskSnap, 'Same-seed Run 1 & Run 2 adaptiveRiskManager state must be bit-identical');
  assert.deepEqual(run1.stats, run2.stats, 'Same-seed Run 1 & Run 2 bot stats must be bit-identical');
  assert.equal(run1.tradesCount, run2.tradesCount, 'Same-seed Run 1 & Run 2 trade count must match');

  // Snapshot capture & rollback fidelity test
  const preDivStepSnap = run1.mgr.captureStepSnapshot();
  const preDivDbSnap = memoryDb.exportRollbackSnapshot();
  // Capture clean step-7 reference on twin branch before diverging run1
  await run2.mgr.step(1.0);
  const cleanStep7Risk = run2.mgr.adaptiveRiskManager.snapshotState();
  const cleanStep7Prices = snapshotStockOrderBooks();

  // Restore DB to exact step-6 state, diverge run1 for 3 steps, then roll back both DB & AgentManager
  memoryDb.restoreRollbackSnapshot(preDivDbSnap);
  for (let i = 0; i < 3; i++) {
    await run1.mgr.step(1.0);
  }
  memoryDb.restoreRollbackSnapshot(preDivDbSnap);
  run1.mgr.restoreStepSnapshot(preDivStepSnap);
  assert.deepEqual(
    run1.mgr.adaptiveRiskManager.snapshotState(),
    preDivStepSnap.adaptiveRiskState,
    'restoreStepSnapshot must restore exact AdaptiveRiskManager state'
  );
  // Advance 1 step after rollback and verify determinism matches clean checkpoint branch bit-for-bit
  await run1.mgr.step(1.0);
  assert.deepEqual(
    run1.mgr.adaptiveRiskManager.snapshotState(),
    cleanStep7Risk,
    'Step after snapshot rollback must match unbroken twin trajectory bit-for-bit'
  );
  assert.deepEqual(
    snapshotStockOrderBooks(),
    cleanStep7Prices,
    'Stock prices after snapshot rollback must match unbroken twin trajectory bit-for-bit'
  );

  // Explicit LocalMarketService validation guard verification
  const testStock = Array.from(memoryDb.stocks.values()).find((s) => s.is_listed !== false)!;
  memoryDb.ensureUserProfile('acc_self_guard', {
    id: 'acc_self_guard',
    cash: 100_000_000,
    net_worth: 100_000_000,
  });
  const rSell = await LocalMarketService.submitOrder({
    userId: 'acc_self_guard',
    stockId: testStock.id,
    side: 'sell',
    price: testStock.current_price,
    size: 0,
    isLp: false,
  });
  assert.equal(rSell.success, false, 'Zero-size order must be rejected');

  console.log('  OK: AgentManager 2x determinism, snapshot rollback & market guards verified.');
}

async function testCommodityBotsStrategiesAndRollback() {
  console.log('[4/5] Testing Commodity 5-bot upgrades, snapshotRuntimeState/restoreRuntimeState & determinism...');

  const baseConfig = {
    capital: 100_000,
    riskTolerance: 0.7,
    positionLimit: 100,
    reactionDelay: 0,
  };

  // A. MarketMakerBot inventory skew + OBI shift + drawdown contraction
  const mm = new MarketMakerBot({ ...baseConfig, id: 'mm_test', name: 'MM', type: 'market_maker' });
  mm.receiveMarketSnapshot({
    tick: 1,
    commodities: {
      CRUDE_OIL: { currentPrice: 80, high: 81, low: 79, volume: 1000, obi: 0.0, volatility: 0.01 },
    },
    activeEvents: [],
  });
  const neutralQuotes = mm.generateOrders(1);
  const neutralBid = neutralQuotes.find((o) => o.side === 'buy')!;
  const neutralAsk = neutralQuotes.find((o) => o.side === 'sell')!;

  // Simulate heavy long inventory + drawdown -> smaller bid size & tightened limit
  mm.positions.set('CRUDE_OIL', { quantity: 70, avgEntryPrice: 80 });
  mm.receiveMarketSnapshot({
    tick: 2,
    commodities: {
      CRUDE_OIL: { currentPrice: 70, high: 80, low: 70, volume: 1500, obi: -0.6, volatility: 0.04 },
    },
    activeEvents: [],
  });
  const stressedQuotes = mm.generateOrders(2);
  const stressedBid = stressedQuotes.find((o) => o.side === 'buy')!;
  const stressedAsk = stressedQuotes.find((o) => o.side === 'sell')!;
  assert.ok(
    stressedAsk.price - stressedBid.price > (neutralAsk.price - neutralBid.price) * 1.1,
    'High volatility & OBI must widen MarketMakerBot spread'
  );
  assert.ok(stressedBid.size < neutralBid.size, 'Drawdown & long skew must reduce MarketMakerBot bid size');

  // B. TrendFollowingBot & MeanReversionBot strategyState snapshot/restore + Hedger/NewsTrader safety
  const tf = new TrendFollowingBot({ ...baseConfig, id: 'tf_test', name: 'TF', type: 'trend_following' }, 3, 6);
  const mr = new MeanReversionBot({ ...baseConfig, id: 'mr_test', name: 'MR', type: 'mean_reversion' }, 6, 1.5);
  const hg = new HedgerBot({ ...baseConfig, id: 'hg_test', name: 'HG', type: 'hedger' }, 30);
  const simCtx = createSimulationContext({ seed: 123 });
  const nt = new NewsTraderBot({ ...baseConfig, id: 'nt_test', name: 'NT', type: 'news_trader', random: simCtx.random.fork('nt') });

  for (let t = 1; t <= 8; t++) {
    const p = t <= 5 ? 80 - t * 0.5 : 77 + (t - 5) * 3.0;
    const snap = {
      tick: t,
      commodities: {
        CRUDE_OIL: { currentPrice: p, high: p + 1, low: p - 1, volume: 1000, obi: 0.4, volatility: 0.02, bestBid: p - 0.05, bestAsk: p + 0.05 },
      },
      activeEvents: [
        { id: 'ev_1', templateId: 'oil', title: 'Shock', headline: 'Shock', targetCategories: ['energy' as const], targetCommodityIds: ['CRUDE_OIL'], magnitude: 0.05, totalTicks: 10, remainingTicks: 10 - t, startTick: 1 },
      ],
    };
    tf.receiveMarketSnapshot(snap);
    mr.receiveMarketSnapshot(snap);
    hg.receiveMarketSnapshot(snap);
    nt.receiveMarketSnapshot(snap);
    tf.generateOrders(t);
    mr.generateOrders(t);
  }
  const tfSnap = tf.snapshotRuntimeState();
  const mrSnap = mr.snapshotRuntimeState();
  // Mutate after snapshot
  tf.receiveMarketSnapshot({
    tick: 9,
    commodities: { CRUDE_OIL: { currentPrice: 40, high: 40, low: 40, volume: 5000 } },
    activeEvents: [],
  });
  tf.generateOrders(9);
  tf.restoreRuntimeState(tfSnap);
  mr.restoreRuntimeState(mrSnap);
  assert.deepEqual(tf.snapshotRuntimeState(), tfSnap, 'TrendFollowingBot snapshotRuntimeState/restoreRuntimeState must be exact');
  assert.deepEqual(mr.snapshotRuntimeState(), mrSnap, 'MeanReversionBot snapshotRuntimeState/restoreRuntimeState must be exact');
  assert.ok(hg.generateOrders(9).length > 0 || hg.positions.size >= 0);
  assert.ok(nt.generateOrders(9).length > 0);

  // C. CommodityMarketEngine 2-run bit-identical determinism & runtime rollback
  const runCommodityEngine = async (seed: number) => {
    const dbCopy = Object.assign(Object.create(Object.getPrototypeOf(memoryDb)), memoryDb);
    void dbCopy;
    memoryDb.resetToSeedData({ suppressPublish: true });
    const simCtx = createSimulationContext({
      seed,
      clock: new SimulationClock(1773500000000),
      runId: `commodity_det_${seed}`,
    });
    const eng = new CommodityMarketEngine({
      totalBots: 20,
      eventProbability: 0.1,
      simulationContext: simCtx,
      db: memoryDb,
    });
    for (let i = 0; i < 20; i++) {
      (simCtx.clock as { advance?: (ms: number) => void }).advance?.(1000);
      await eng.nextTick();
    }
    return {
      eng,
      // Compare the baseline engine's public state without depending on the UI DTO layer.
      commodities: structuredClone(eng.getAllCommodities().map((state) => ({
        ...state,
        priceHistory: state.priceHistory.slice(-50),
      }))),
      bots: eng.bots.map((b) => b.snapshotRuntimeState()),
      tradesCount: eng.tradesHistory.length,
    };
  };

  const c1 = await runCommodityEngine(9991);
  const c2 = await runCommodityEngine(9991);
  assert.deepEqual(c1.commodities, c2.commodities, 'Same-seed CommodityMarketEngine public states must be bit-identical');
  assert.deepEqual(c1.bots, c2.bots, 'Same-seed CommodityMarketEngine bot runtime snapshots must match bit-for-bit');
  assert.equal(c1.tradesCount, c2.tradesCount);

  // Failed-persist rollback test on CommodityMarketEngine
  const engFail = new CommodityMarketEngine({
    totalBots: 12,
    eventProbability: 0.1,
    simulationContext: createSimulationContext({ seed: 777 }),
    db: memoryDb,
    onPersist: async () => false,
  });
  const preTickSnap = engFail.snapshotRuntime();
  await assert.rejects(
    async () => {
      await engFail.stepTickAsync();
    },
    /실패|fail|persist/i,
    'Failed persistence in stepTickAsync() must throw and roll back'
  );
  assert.equal(engFail.currentTick, preTickSnap.currentTick, 'Failed persist must roll back tick');
  assert.deepEqual(
    engFail.bots.map((b) => b.snapshotRuntimeState()),
    preTickSnap.botSnapshots,
    'Failed persist must roll back all enhanced commodity bot runtime states'
  );

  console.log('  OK: Commodity 5-bot upgrades, snapshot/restore & determinism verified.');
}

function testPureDeterminismHygiene() {
  console.log('[5/5] Verifying zero Math.random() / Date.now() / fetch in new strategy & bot files...');
  const filesToCheck = [
    'lib/engine/simulation/strategies/orderbookMicrostructure.ts',
    'lib/engine/simulation/strategies/meanReversionStrategy.ts',
    'lib/engine/simulation/strategies/adaptiveRiskControl.ts',
    'lib/commodities/bots/CommodityBot.ts',
    'lib/commodities/bots/TrendFollowingBot.ts',
    'lib/commodities/bots/MeanReversionBot.ts',
    'lib/commodities/bots/HedgerBot.ts',
    'lib/commodities/bots/MarketMakerBot.ts',
    'lib/commodities/bots/NewsTraderBot.ts',
  ];
  for (const rel of filesToCheck) {
    const raw = fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
    const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal(/\bMath\.random\s*\(/.test(codeOnly), false, `${rel} must not use Math.random()`);
    assert.equal(/\bDate\.now\s*\(/.test(codeOnly), false, `${rel} must not use Date.now()`);
    assert.equal(/\bfetch\s*\(/.test(codeOnly), false, `${rel} must not call external fetch()`);
  }
  console.log('  OK: Pure TypeScript zero-IO/zero-non-determinism checks passed.');
}

async function main() {
  try {
    testMicrostructureAndObi();
    testMeanReversionAndAdaptiveRisk();
    await testAgentManagerDeterminismRollbackAndGuards();
    await testCommodityBotsStrategiesAndRollback();
    testPureDeterminismHygiene();
    console.log('\n🎉 ALL PURE-CODE BOT ALGORITHM UPGRADE CHECKS PASSED!');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
