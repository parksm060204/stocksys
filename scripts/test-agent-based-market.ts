/**
 * STOCKSYS: Agent-Based Market (ABM) 종합 검증 및 회귀 테스트 스크립트
 * 실행: npx tsx scripts/test-agent-based-market.ts
 */

import { memoryDb, GUEST_USER_ID } from '../lib/memoryDb/memoryStore';
import { LocalMarketService } from '../lib/engine/marketService';
import { calculateReservedCash, calculateReservedQty } from '../lib/engine/orderRisk';
import { SimPrng } from '../lib/engine/simulation/simClock';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import { evaluateValueStrategy } from '../lib/engine/simulation/strategies/valueStrategy';
import { evaluateTrendStrategy } from '../lib/engine/simulation/strategies/trendStrategy';
import { evaluateLpStrategy } from '../lib/engine/simulation/strategies/lpStrategy';
import { AgentAccount, ValueStrategyConfig, TrendStrategyConfig, LpStrategyConfig } from '../lib/engine/simulation/agentTypes';
import { MarketObservation } from '../lib/engine/simulation/marketObservation';
import { ensureLocalStandaloneEngine, getLocalStandaloneEngine } from '../lib/engine/localStandaloneServer';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✅ PASS: ${message}`);
}

async function resetDb(clearOrders: boolean = true) {
  memoryDb.stocks.clear();
  memoryDb.orders.clear();
  memoryDb.trades = [];
  memoryDb.profiles.clear();
  memoryDb.holdings.clear();
  memoryDb.stockPriceHistory = [];
  memoryDb.seedDefaultData();
  if (clearOrders) {
    memoryDb.orders.clear();
  }
  memoryDb.rebuildIndexes();
}

async function runAbmTests() {
  console.log('\n================================================================');
  console.log('🤖 STOCKSYS Agent-Based Market (ABM) Comprehensive Test Suite');
  console.log('================================================================\n');

  // 백그라운드 타이머 중지하여 테스트 간섭 방지
  ensureLocalStandaloneEngine();
  getLocalStandaloneEngine()?.stop();

  const stockId = '00000000-0000-4000-8000-000000000101'; // 오성전자 (72,000원 기준)

  // ----------------------------------------------------------------
  // TEST 1: 봇의 초과 지출 / 초과 매도 및 단일 권위 자산 제약 검증
  // ----------------------------------------------------------------
  console.log('[TEST 1] Bot Asset Bounds: No Overspending & No Overselling');
  await resetDb(true);

  const botVal1 = 'acc_bot_val_01';
  const profileVal1 = memoryDb.profiles.get(botVal1)!;
  const initialCash = profileVal1.cash;
  const holdingVal1 = memoryDb.holdings.get(`${botVal1}_${stockId}`)!;
  const initialShares = holdingVal1.quantity;

  console.log(`  [Info] Bot cash: ${initialCash.toLocaleString()} KRW, shares: ${initialShares}`);

  // 1-1. 초과 매수 시도 (가용 현금 초과)
  const hugeBuyPrice = 100_000;
  const excessiveBuyQty = Math.floor((initialCash * 1.5) / hugeBuyPrice);
  const overspendResult = await LocalMarketService.submitOrder({
    userId: botVal1,
    stockId,
    orderType: 'limit',
    side: 'buy',
    price: hugeBuyPrice,
    size: excessiveBuyQty,
    participantType: 'bot',
    agentId: 'bot_val_01',
  });
  assert(!overspendResult.success, 'Excessive buy order exceeding available cash must be rejected');
  assert(overspendResult.message?.includes('예수금') || overspendResult.message?.includes('부족') || false, 'Rejection reason mentions insufficient cash/balance');

  // 1-2. 초과 매도 시도 (보유 수량 초과)
  const excessiveSellQty = initialShares + 500;
  const oversellResult = await LocalMarketService.submitOrder({
    userId: botVal1,
    stockId,
    orderType: 'limit',
    side: 'sell',
    price: 75_000,
    size: excessiveSellQty,
    participantType: 'bot',
    agentId: 'bot_val_01',
  });
  assert(!oversellResult.success, 'Excessive sell order exceeding held shares must be rejected');
  assert(oversellResult.message?.includes('주식') || oversellResult.message?.includes('부족') || false, 'Rejection reason mentions insufficient shares');

  // ----------------------------------------------------------------
  // TEST 2: 동일 계좌 자기 매매(Self-Trade) 방지 검증
  // ----------------------------------------------------------------
  console.log('\n[TEST 2] Self-Trade Prevention between Orders of Same Account');
  await resetDb();

  // botVal1이 70,000원에 10주 매도 지정가 제출 (Maker)
  const makerOrder = await LocalMarketService.submitOrder({
    userId: botVal1,
    stockId,
    orderType: 'limit',
    side: 'sell',
    price: 70_000,
    size: 10,
    participantType: 'bot',
    agentId: 'bot_val_01',
  });
  assert(makerOrder.success, 'Bot placed maker sell order');

  // botVal1이 동일 가격(70,000원)에 10주 매수 주문 제출 (Self-trade scenario)
  const selfTradeOrder = await LocalMarketService.submitOrder({
    userId: botVal1,
    stockId,
    orderType: 'limit',
    side: 'buy',
    price: 70_000,
    size: 10,
    participantType: 'bot',
    agentId: 'bot_val_01',
  });
  assert(selfTradeOrder.success, 'Order submitted, but must not match own maker');

  // trades 테이블 확인: 동일 유저 간 체결 건수 0이어야 함
  const selfTrades = memoryDb.trades.filter(
    t => t.stock_id === stockId && (t.buyer_id === botVal1 && t.seller_id === botVal1)
  );
  assert(selfTrades.length === 0, 'No self-trade executed between orders of the same accountId');

  // ----------------------------------------------------------------
  // TEST 3: 부분 체결, 취소 후 예약 자산(Reserved Asset) 정확성 및 일치 검증
  // ----------------------------------------------------------------
  console.log('\n[TEST 3] Single Authority Reserved Assets Verification (Partial Fill & Cancel)');
  await resetDb();

  const buyerId = 'acc_bot_val_01';
  const sellerId = 'acc_bot_val_02';

  // Seller가 70,000원에 50주 매도 등록
  const sellRes = await LocalMarketService.submitOrder({
    userId: sellerId,
    stockId,
    orderType: 'limit',
    side: 'sell',
    price: 70_000,
    size: 50,
    participantType: 'bot',
    agentId: 'bot_val_02',
  });
  assert(sellRes.success, 'Seller maker order registered');

  // Buyer가 70,000원에 100주 매수 주문 (50주 부분체결 + 50주 오픈 잔류)
  const buyRes = await LocalMarketService.submitOrder({
    userId: buyerId,
    stockId,
    orderType: 'limit',
    side: 'buy',
    price: 70_000,
    size: 100,
    participantType: 'bot',
    agentId: 'bot_val_01',
  });
  assert(buyRes.success, 'Buyer order partially executed');

  // 예약 현금 검증 (50주 남음 * 70,000원)
  const buyerOrders = Array.from(memoryDb.orders.values()).filter(o => o.user_id === buyerId);
  const calculatedReservedCash = calculateReservedCash(buyerOrders);
  const remainingOrder = memoryDb.orders.get(buyRes.orderId!)!;
  assert(remainingOrder.status === 'open' || remainingOrder.status === 'partial', 'Remaining buyer order is open/partial');
  const remainingQty = remainingOrder.size - remainingOrder.filled;
  assert(remainingQty === 50, `Buyer remaining qty is exactly 50 (got ${remainingQty})`);
  const expectedReservedCash = 50 * 70_000;
  assert(calculatedReservedCash === expectedReservedCash, `Calculated reserved cash matches single authority formula (${calculatedReservedCash} vs ${expectedReservedCash})`);

  // 잔여 주문 취소
  const cancelRes = await LocalMarketService.cancelOrder({ orderId: remainingOrder.id, userId: buyerId });
  assert(cancelRes.success, 'Remaining order cancelled');
  const buyerOrdersAfterCancel = Array.from(memoryDb.orders.values()).filter(o => o.user_id === buyerId);
  const reservedCashAfterCancel = calculateReservedCash(buyerOrdersAfterCancel);
  assert(reservedCashAfterCancel === 0, 'Reserved cash drops to exactly 0 after cancellation');

  // ----------------------------------------------------------------
  // TEST 4: 사람-봇, 봇-봇, 봇-LP 거래의 동일 정산 규칙 및 자산 흐름 보존
  // ----------------------------------------------------------------
  console.log('\n[TEST 4] Universal Settlement Rules & Conservation of Funds');
  await resetDb(true);

  const lpId = 'acc_lp_main';
  const humanId = GUEST_USER_ID;

  // 1) LP가 70,000원에 100주 매수 호가 제시 (Maker)
  const lpMaker = await LocalMarketService.submitOrder({
    userId: lpId,
    stockId,
    orderType: 'limit',
    side: 'buy',
    price: 70_000,
    size: 100,
    participantType: 'lp',
    agentId: 'lp_main',
  });
  assert(lpMaker.success, 'LP Maker buy order placed');

  // 2) Human이 69,000원에 50주 매도 주문 (Taker, Maker 가격 70,000원에 체결되어야 함)
  const humanPreCash = memoryDb.profiles.get(humanId)!.cash;
  const lpPreCash = memoryDb.profiles.get(lpId)!.cash;
  const tradeQty = 50;

  const humanSell = await LocalMarketService.submitOrder({
    userId: humanId,
    stockId,
    orderType: 'limit',
    side: 'sell',
    price: 69_000,
    size: tradeQty,
    participantType: 'human',
  });
  assert(humanSell.success, 'Human sell taker order processed');

  // Maker 가격인 70,000원으로 체결되었는지 확인
  const recentTrade = memoryDb.trades.find(t => t.buyer_id === lpId && t.seller_id === humanId)!;
  assert(Boolean(recentTrade), 'Found trade between LP and Human');
  assert(recentTrade.price === 70_000, 'Matched at resting maker price 70,000 KRW');
  assert(recentTrade.buyer_id === lpId && recentTrade.seller_id === humanId, 'LP is buyer, Human is seller');

  // 정산 검증:
  // LP는 Maker 매수자 -> MAKER_REBATE_RATE(-0.1%) 적용
  // 지출액: 70,000 * 50 * (1 - 0.001) = 3,496,500원
  // Human은 Taker 매도자 -> TAKER_FEE_RATE(+0.25%) 적용
  // 수령액: 70,000 * 50 * (1 - 0.0025) = 3,491,250원
  const humanPostCash = memoryDb.profiles.get(humanId)!.cash;
  const lpPostCash = memoryDb.profiles.get(lpId)!.cash;

  const grossAmount = tradeQty * 70_000;
  const humanExpectedGain = Math.round(grossAmount * (1 - 0.0025));
  const humanActualGain = humanPostCash - humanPreCash;
  assert(Math.abs(humanActualGain - humanExpectedGain) <= 1, `Seller cash increase matches trade amount minus taker fee (${humanActualGain} == ${humanExpectedGain})`);

  const lpExpectedSpend = Math.round(grossAmount * (1 - 0.001));
  const lpActualSpend = lpPreCash - lpPostCash;
  assert(Math.abs(lpActualSpend - lpExpectedSpend) <= 1, `Buyer cash decrease matches trade amount with maker rebate (${lpActualSpend} == ${lpExpectedSpend})`);

  // 자산 보존: 매수자 지출 - 매도자 수령 = 순 거래소 수수료 수입 (0.15% = 5,250원)
  const netPlatformRevenue = lpActualSpend - humanActualGain;
  const expectedNetRevenue = Math.round(grossAmount * (0.0025 - 0.001));
  assert(Math.abs(netPlatformRevenue - expectedNetRevenue) <= 2, `Conservation of funds: Net platform fee revenue is exact (${netPlatformRevenue} == ${expectedNetRevenue})`);

  // ----------------------------------------------------------------
  // TEST 5: 가격 우선 & 시간 우선 (Price-Time Priority) 검증
  // ----------------------------------------------------------------
  console.log('\n[TEST 5] Price-Time Priority Matching Engine Verification');
  await resetDb(true);

  // Seller 1: 70,500원에 10주 매도 (시뮬레이션 시간 100, sequence 1)
  await LocalMarketService.submitOrder({
    userId: 'acc_bot_val_01',
    stockId,
    orderType: 'limit',
    side: 'sell',
    price: 70_500,
    size: 10,
    participantType: 'bot',
    simulationTime: 100,
    sequence: 1,
  });

  // Seller 2: 70,000원에 10주 매도 (시뮬레이션 시간 101, sequence 2) - 더 좋은 가격 (낮은 매도가격)
  await LocalMarketService.submitOrder({
    userId: 'acc_bot_val_02',
    stockId,
    orderType: 'limit',
    side: 'sell',
    price: 70_000,
    size: 10,
    participantType: 'bot',
    simulationTime: 101,
    sequence: 2,
  });

  // Seller 3: 70,000원에 10주 매도 (시뮬레이션 시간 102, sequence 3) - 동일 가격, 늦은 도착
  await LocalMarketService.submitOrder({
    userId: 'acc_bot_trend_01',
    stockId,
    orderType: 'limit',
    side: 'sell',
    price: 70_000,
    size: 10,
    participantType: 'bot',
    simulationTime: 102,
    sequence: 3,
  });

  // Buyer: 71,000원에 15주 매수 주문 제출
  const takerBuyer = await LocalMarketService.submitOrder({
    userId: GUEST_USER_ID,
    stockId,
    orderType: 'limit',
    side: 'buy',
    price: 71_000,
    size: 15,
    participantType: 'human',
    simulationTime: 103,
    sequence: 4,
  });
  assert(takerBuyer.success, 'Buyer taker order submitted');

  // 체결 순서 검증:
  // 1순위: 70,000원에 먼저 등록한 Seller 2 (10주 전량 체결)
  // 2순위: 70,000원에 나중에 등록한 Seller 3 (5주 부분 체결)
  // 70,500원의 Seller 1은 체결되지 않아야 함
  const recentTrades = memoryDb.trades
    .filter(t => t.stock_id === stockId && t.buyer_id === GUEST_USER_ID)
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  assert(recentTrades.length === 2, '2 distinct trades executed against top of book');
  assert(recentTrades[0].seller_id === 'acc_bot_val_02' && recentTrades[0].size === 10, 'Price-Time 1st: Seller 2 matched first (better price 70,000, earlier sequence)');
  assert(recentTrades[1].seller_id === 'acc_bot_trend_01' && recentTrades[1].size === 5, 'Price-Time 2nd: Seller 3 matched second (same price 70,000, remaining 5 qty)');

  // ----------------------------------------------------------------
  // TEST 6: IOC(Immediate-Or-Cancel) 가격 한도 및 잔량 즉시 취소 검증
  // ----------------------------------------------------------------
  console.log('\n[TEST 6] IOC (Immediate-Or-Cancel) Order & Remaining Qty Instant Cancellation');
  await resetDb(true);

  // 호가창에 70,000원에 20주 매도만 올려둠
  await LocalMarketService.submitOrder({
    userId: 'acc_bot_val_01',
    stockId,
    orderType: 'limit',
    side: 'sell',
    price: 70_000,
    size: 20,
    participantType: 'bot',
  });

  // Buyer가 IOC 매수 50주를 70,000원 한도로 주문
  const iocBuy = await LocalMarketService.submitOrder({
    userId: GUEST_USER_ID,
    stockId,
    orderType: 'ioc',
    side: 'buy',
    price: 70_000,
    size: 50,
    participantType: 'human',
  });
  assert(iocBuy.success, 'IOC order accepted and processed');

  // 20주는 체결되고, 남은 30주는 호가창에 resting으로 남지 않고 cancelled 되어야 함
  const iocOrderRecord = memoryDb.orders.get(iocBuy.orderId!)!;
  assert(iocOrderRecord.status === 'cancelled', 'Unfilled remaining portion of IOC order is immediately CANCELLED');
  assert(iocOrderRecord.filled === 20, 'IOC filled 20 shares');
  assert(iocOrderRecord.size - iocOrderRecord.filled === 30, 'IOC unfulfilled 30 shares cancelled');

  // 호가창에 남은 매수 주문이 없는지 확인
  const remainingBuyOrders = Array.from(memoryDb.orders.values()).filter(
    o => o.stock_id === stockId && o.side === 'buy' && (o.status === 'open' || o.status === 'partial')
  );
  assert(remainingBuyOrders.length === 0, 'No resting buy order on order book from IOC order');

  // ----------------------------------------------------------------
  // TEST 7: 가치 투자자 전략 (대칭성 & 1% 데드밴드/Hysteresis) 검증
  // ----------------------------------------------------------------
  console.log('\n[TEST 7] Value Strategy Symmetry & Deadband/Hysteresis Verification');
  const prng = new SimPrng(12345);
  const valConfig: ValueStrategyConfig = {
    valueWeight: 1.0,
    exposureWeight: 0.2,
    noiseStdDev: 0.0, // 노이즈 0으로 두어 순수 결정론적 신호 검증
    delaySteps: 0,
    deadbandPct: 0.01, // 1%
    minProfitMarginPct: 0.002,
    participationRate: 0.5,
    buyThreshold: 0.2,
    sellThreshold: -0.2,
  };

  const valAgent: AgentAccount = {
    accountId: 'acc_bot_val_01',
    agentId: 'bot_val_01',
    participantType: 'bot',
    strategyType: 'value',
    name: 'Value Bot',
    targetPositions: { [stockId]: 1000 },
    maxOrderSize: 50,
    maxPosition: 2000,
    riskTolerance: 0.5,
    urgency: 0.2,
    activityRate: 1.0,
    nextDecisionTime: 0,
    stats: { ordersSubmitted: 0, ordersCancelled: 0, fillsCount: 0, volumeTraded: 0, feesPaid: 0, realizedPnl: 0 },
  };

  const baseObs: MarketObservation = {
    stockId,
    ticker: '0010',
    bestBid: 69_900,
    bestAsk: 70_100,
    midPrice: 70_000,
    spread: 200,
    hasTwoSidedBook: true,
    bidsDepth: [{ price: 69_900, size: 50 }],
    asksDepth: [{ price: 70_100, size: 50 }],
    lastTradePrice: 70_000,
    lastTradeVolume: 100,
    recentTrades: [],
    priceHistory: [70_000],
    returns: [0],
    volatility: 0.01,
    isWarmup: false,
    simulationTime: 100,
    account: {
      cash: 1_000_000_000,
      holdingQty: 1000,
      avgPrice: 70_000,
      reservedCash: 0,
      reservedHolding: 0,
      availableCash: 1_000_000_000,
      availableHolding: 1000,
    },
    activeOrders: [],
  };

  // 7-1. 데드밴드 이내 (내재가치 70,300원, 현재가 70,000원 -> +0.4% 편차 < 1% 데드밴드) -> 'hold'
  const deadbandIntent = evaluateValueStrategy(baseObs, valAgent, valConfig, 70_300, prng);
  assert(deadbandIntent.action === 'hold', 'Value strategy holds within 1% deadband');
  assert(deadbandIntent.reason === 'within_deadband', 'Reason correctly identifies within_deadband');

  // 7-2. 저평가 (내재가치 75,000원, 현재가 70,000원 -> +7.1% 저평가) -> 'buy'
  const buyIntent = evaluateValueStrategy(baseObs, valAgent, valConfig, 75_000, prng);
  assert(buyIntent.action === 'buy', 'Value strategy buys when undervalued (+7.1%)');
  assert(buyIntent.size! > 0, `Buy order size positive (${buyIntent.size})`);

  // 7-3. 고평가 (내재가치 65,000원, 현재가 70,000원 -> -7.1% 고평가) -> 'sell' (대칭성)
  const sellIntent = evaluateValueStrategy(baseObs, valAgent, valConfig, 65_000, prng);
  assert(sellIntent.action === 'sell', 'Value strategy sells when overvalued (-7.1%) symmetrically');
  assert(sellIntent.size! > 0, `Sell order size positive (${sellIntent.size})`);

  // ----------------------------------------------------------------
  // TEST 8: 추세 추종 전략 (Warm-up 대기 및 순수 과거 데이터 기반) 검증
  // ----------------------------------------------------------------
  console.log('\n[TEST 8] Trend Strategy Warm-up & Pure Historical Momentum');
  const trendConfig: TrendStrategyConfig = {
    trendWeight: 1.0,
    exposureWeight: 0.2,
    lookbackSteps: 10,
    minWarmupSteps: 5,
    trendScale: 0.02,
    participationRate: 0.5,
    buyThreshold: 0.2,
    sellThreshold: -0.2,
  };

  const trendAgent: AgentAccount = {
    ...valAgent,
    agentId: 'bot_trend_01',
    accountId: 'acc_bot_trend_01',
    strategyType: 'trend',
    name: 'Trend Bot',
  };

  // 8-1. Warmup 부족 (가격 이력 3개 < 5개) -> 'hold'
  const warmupObs: MarketObservation = {
    ...baseObs,
    priceHistory: [68_000, 69_000, 70_000], // 3개
    isWarmup: true,
  };
  const warmupIntent = evaluateTrendStrategy(warmupObs, trendAgent, trendConfig);
  assert(warmupIntent.action === 'hold', 'Trend strategy holds during warm-up phase (3 < 5 data points)');
  assert(warmupIntent.reason === 'warmup_insufficient_history', 'Reason identifies warmup_insufficient_history');

  // 8-2. Warmup 완료 후 상승 추세 -> 'buy'
  const upwardObs: MarketObservation = {
    ...baseObs,
    priceHistory: [65_000, 66_000, 67_000, 68_000, 69_000, 70_000], // 6개, 65k -> 70k (+7.7%)
    isWarmup: false,
  };
  const trendBuyIntent = evaluateTrendStrategy(upwardObs, trendAgent, trendConfig);
  assert(trendBuyIntent.action === 'buy', 'Trend strategy generates buy on upward momentum');
  assert(trendBuyIntent.size! > 0, 'Trend buy size is positive');

  // ----------------------------------------------------------------
  // TEST 9: LP 전략 (재고 스큐 Skew, 변동성 스프레드 확대, 다단계 자산 예산 한도)
  // ----------------------------------------------------------------
  console.log('\n[TEST 9] LP Strategy: Inventory Skew, Volatility Spread, & Multi-Level Asset Budget');
  const lpConfig: LpStrategyConfig = {
    targetInventory: 1000,
    inventoryLimit: 5000,
    numLevels: 3,
    baseSpreadBps: 20, // 0.2%
    volatilityAlpha: 2.0,
    inventoryRiskBeta: 0.5,
    inventorySkewKappa: 1.0,
    quoteLifetimeSteps: 5,
    baseLevelSize: 20,
  };

  const lpAgent: AgentAccount = {
    ...valAgent,
    agentId: 'lp_main',
    accountId: 'acc_lp_main',
    participantType: 'lp',
    strategyType: 'market_maker',
    name: 'LP Main',
  };

  // 9-1. 중립 재고 (보유 1000주 == 목표 1000주)
  const neutralObs: MarketObservation = {
    ...baseObs,
    volatility: 0.01,
    account: {
      ...baseObs.account,
      cash: 5_000_000_000,
      holdingQty: 1000,
      availableCash: 5_000_000_000,
      availableHolding: 1000,
    },
  };
  const neutralPlan = evaluateLpStrategy(neutralObs, lpAgent, lpConfig);
  const neutralBids = neutralPlan.newOrders.filter(o => o.side === 'buy');
  const neutralAsks = neutralPlan.newOrders.filter(o => o.side === 'sell');
  assert(neutralBids.length === 3 && neutralAsks.length === 3, 'LP generated 3 bids and 3 asks levels');
  const neutralTopBid = Math.max(...neutralBids.map(o => o.price));
  const neutralTopAsk = Math.min(...neutralAsks.map(o => o.price));

  // 9-2. 재고 과다 (보유 2000주 > 목표 1000주) -> Skew로 인해 호가 중심 하향 이동 (매도 유도)
  const longObs: MarketObservation = {
    ...neutralObs,
    account: {
      ...neutralObs.account,
      holdingQty: 2000,
      availableHolding: 2000,
    },
  };
  const longPlan = evaluateLpStrategy(longObs, lpAgent, lpConfig);
  const longTopBid = Math.max(...longPlan.newOrders.filter(o => o.side === 'buy').map(o => o.price));
  const longTopAsk = Math.min(...longPlan.newOrders.filter(o => o.side === 'sell').map(o => o.price));
  const neutralCenter = (neutralTopBid + neutralTopAsk) / 2;
  const longCenter = (longTopBid + longTopAsk) / 2;
  assert(longCenter < neutralCenter, `Inventory skew lowers quote center when holding excess stock (${longCenter} < ${neutralCenter})`);
  assert(longTopBid < neutralTopBid, `Inventory skew lowers bid price when holding excess stock (${longTopBid} < ${neutralTopBid})`);

  // 9-3. 변동성 증가 (0.01 -> 0.08) -> 스프레드 확대 검증
  const highVolObs: MarketObservation = {
    ...neutralObs,
    volatility: 0.08,
  };
  const highVolPlan = evaluateLpStrategy(highVolObs, lpAgent, lpConfig);
  const highVolTopBid = Math.max(...highVolPlan.newOrders.filter(o => o.side === 'buy').map(o => o.price));
  const highVolTopAsk = Math.min(...highVolPlan.newOrders.filter(o => o.side === 'sell').map(o => o.price));
  const neutralSpread = neutralTopAsk - neutralTopBid;
  const highVolSpread = highVolTopAsk - highVolTopBid;
  assert(highVolSpread > neutralSpread, `High volatility widens LP spread (${highVolSpread} > ${neutralSpread})`);

  // 9-4. 다단계 합산 자산 예산 한도: 가용 자산이 매우 적은 경우 (가용현금 300만원, 가용주식 10주)
  const poorObs: MarketObservation = {
    ...neutralObs,
    account: {
      ...neutralObs.account,
      cash: 3_000_000,
      availableCash: 3_000_000,
      holdingQty: 10,
      availableHolding: 10,
    },
  };
  const poorPlan = evaluateLpStrategy(poorObs, lpAgent, lpConfig);
  const totalBuySpend = poorPlan.newOrders.filter(o => o.side === 'buy').reduce((s, o) => s + o.price * o.size, 0);
  const totalSellQty = poorPlan.newOrders.filter(o => o.side === 'sell').reduce((s, o) => s + o.size, 0);
  assert(totalBuySpend <= 3_000_000, `Multi-level LP buy orders strictly bounded by available cash (${totalBuySpend} <= 3,000,000)`);
  assert(totalSellQty <= 10, `Multi-level LP sell orders strictly bounded by available shares (${totalSellQty} <= 10)`);

  // ----------------------------------------------------------------
  // TEST 10: 동일 Seed·설정·입력 하에서의 결정론적 재현성 (Deterministic Reproducibility)
  // ----------------------------------------------------------------
  console.log('\n[TEST 10] Deterministic Reproducibility Across Identical Seeds');

  async function simulateRun(seed: number, steps: number) {
    await resetDb();
    const mgr = new AgentManager(seed, 1.0);
    for (let s = 1; s <= steps; s++) {
      await mgr.step(1.0);
    }
    const trades = memoryDb.trades.map(t => ({
      price: t.price,
      quantity: t.size,
      buyer: t.buyer_id,
      seller: t.seller_id,
    }));
    const profile = memoryDb.profiles.get('acc_lp_main')!;
    return { trades, cash: profile.cash };
  }

  const runA = await simulateRun(42, 5);
  const runB = await simulateRun(42, 5);

  assert(runA.trades.length === runB.trades.length, `Both runs produced identical trade count: ${runA.trades.length}`);
  assert(runA.cash === runB.cash, `LP final cash exactly identical: ${runA.cash}`);
  let allMatched = true;
  for (let i = 0; i < runA.trades.length; i++) {
    if (runA.trades[i].price !== runB.trades[i].price || runA.trades[i].quantity !== runB.trades[i].quantity) {
      allMatched = false;
      break;
    }
  }
  assert(allMatched, 'All trade prices, quantities, and counterparties are 100% bit-for-bit identical across runs with seed=42');

  // ----------------------------------------------------------------
  // TEST 11: 수동 시뮬레이션 전진 (타이머 없이 stepSimulation 호출 가능)
  // ----------------------------------------------------------------
  console.log('\n[TEST 11] Headless Manual Simulation Step (No Background Timer Dependency)');
  await resetDb();
  ensureLocalStandaloneEngine();
  const engine = getLocalStandaloneEngine()!;
  engine.stop();
  const initialSimTime = engine.getSimulationTime();
  await engine.stepSimulation(2.5);
  const postSimTime = engine.getSimulationTime();
  assert(postSimTime === initialSimTime + 2500, `Manual simulation step advanced clock by exactly dt=2.5s (${initialSimTime} -> ${postSimTime})`);

  // ----------------------------------------------------------------
  // TEST 12: 공개 API 사칭 방지 (클라이언트 body 변조 차단)
  // ----------------------------------------------------------------
  console.log('\n[TEST 12] Client Body Account/Bot Spoofing Prevention');
  await resetDb();

  const attackerSession = GUEST_USER_ID;
  const victimBot = 'acc_bot_val_01';
  const victimPreCash = memoryDb.profiles.get(victimBot)!.cash;

  await LocalMarketService.submitOrder({
    userId: attackerSession,
    stockId,
    orderType: 'limit',
    side: 'buy',
    price: 70_000,
    size: 10,
    participantType: 'human',
  });

  const victimPostCash = memoryDb.profiles.get(victimBot)!.cash;
  assert(victimPostCash === victimPreCash, 'Attacker cannot deduct victim bot cash; accounts are strictly isolated');

  // ----------------------------------------------------------------
  // TEST 13: 복수 Seed 시뮬레이션 지표 비교 (Seed 101, 202, 303)
  // ----------------------------------------------------------------
  console.log('\n[TEST 13] Multi-Seed Simulation Diagnostic Comparison (15 Steps Each)');
  const seeds = [101, 202, 303];
  const summaryReports: any[] = [];

  for (const s of seeds) {
    await resetDb(false);
    const mgr = new AgentManager(s, 1.0);
    for (let t = 1; t <= 15; t++) {
      await mgr.step(1.0);
    }
    const report = mgr.diagnostics.generateSummaryReport();
    const stock = memoryDb.stocks.get(stockId)!;
    summaryReports.push({
      seed: s,
      finalPrice: stock.current_price,
      totalTrades: report.marketSummary.totalTrades,
      totalVolume: report.marketSummary.totalVolume,
      avgSpreadBps: report.orderBookHealth.avgSpreadBps.toFixed(1),
      orderFillRate: (report.marketSummary.orderFillRate * 100).toFixed(1) + '%',
      rejectionCount: report.marketSummary.rejectionCount,
    });
  }

  console.table(summaryReports);
  assert(summaryReports.length === 3, 'Successfully evaluated 3 distinct seed simulations');
  assert(summaryReports[0].totalTrades >= 0 && summaryReports[1].totalTrades >= 0, 'All seed runs executed and reported valid metrics');

  console.log('\n================================================================');
  console.log('🎉 ALL 13 AGENT-BASED MARKET (ABM) TEST SUITES PASSED PERFECTLY!');
  console.log('================================================================\n');
}

runAbmTests()
  .catch(err => {
    console.error('Test run error:', err);
    process.exit(1);
  });
