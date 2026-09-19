import {
  applyOrderSizeMultiplier,
  applyRiskToleranceToTarget,
  applyUncertaintyMultiplier,
  resolveBotEffectParams,
  NEUTRAL_BOT_EFFECT_PARAMS,
  BotEffectParams,
} from '../lib/engine/simulation/regime/regimeEffects';
import { evaluateValueStrategy } from '../lib/engine/simulation/strategies/valueStrategy';
import { evaluateTrendStrategy } from '../lib/engine/simulation/strategies/trendStrategy';
import { buildMarketObservation, MarketObservation } from '../lib/engine/simulation/marketObservation';
import { memoryDb, OrderRecord, TradeRecord } from '../lib/memoryDb/memoryStore';
import { SimPrng } from '../lib/engine/simulation/simClock';
import { AgentAccount, ValueStrategyConfig, TrendStrategyConfig } from '../lib/engine/simulation/agentTypes';
import { LocalMarketService } from '../lib/engine/marketService';

const startMs = 1773500000000;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

function makeTrade(size: number, price = 10000): TradeRecord {
  return {
    id: `tr_${size}_${price}`,
    stock_id: 'MOCK',
    buyer_id: 'acc_x',
    seller_id: 'acc_y',
    buyer_is_bot: true,
    seller_is_bot: true,
    price,
    size,
    created_at: new Date(startMs).toISOString(),
  };
}

function makeAccount(overrides: Partial<MarketObservation['account']> = {}): MarketObservation['account'] {
  return {
    cash: 10_000_000,
    holdingQty: 0,
    avgPrice: 10000,
    reservedCash: 0,
    reservedHolding: 0,
    availableCash: 10_000_000,
    availableHolding: 0,
    totalHoldingsValue: 0,
    nav: 10_000_000,
    ...overrides,
  };
}

function makeObservation(overrides: Partial<MarketObservation>): MarketObservation {
  return {
    stockId: 'MOCK',
    ticker: 'MOCK',
    bestBid: 9900,
    bestAsk: 10100,
    midPrice: 10000,
    spread: 200,
    hasTwoSidedBook: true,
    bidsDepth: [{ price: 9900, size: 500 }],
    asksDepth: [{ price: 10100, size: 500 }],
    lastTradePrice: 10000,
    lastTradeVolume: 0,
    recentTrades: [makeTrade(1_000_000)],
    priceHistory: [10000, 10000, 10000, 10000, 10000, 10000],
    returns: [0, 0, 0, 0, 0],
    volatility: 0.005,
    isWarmup: false,
    simulationTime: startMs,
    attentionScore: 0.5,
    uncertaintyScore: 0.05,
    recentEvents: [],
    effectiveEvents: [],
    account: makeAccount(),
    activeOrders: [],
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentAccount>): AgentAccount {
  return {
    accountId: 'acc_bot_test',
    agentId: 'agent_test',
    participantType: 'bot',
    strategyType: 'value',
    name: 'test bot',
    targetPositions: { MOCK: 1000 },
    maxOrderSize: 2_000_000,
    maxPosition: 1_000_000,
    riskTolerance: 0.5,
    urgency: 0.1,
    activityRate: 0.8,
    infoLatency: 0,
    evaluationsPerStep: 4,
    sectorPreferences: {},
    nextDecisionTime: 0,
    stats: { ordersSubmitted: 0, ordersCancelled: 0, fillsCount: 0, volumeTraded: 0, feesPaid: 0, realizedPnl: 0 },
    ...overrides,
  };
}

const valueConfig: ValueStrategyConfig = {
  valueWeight: 1.0,
  exposureWeight: 0.4,
  noiseStdDev: 0.0,
  delaySteps: 2,
  deadbandPct: 0.01,
  minProfitMarginPct: 0.003,
  participationRate: 0.20,
  buyThreshold: 0.2,
  sellThreshold: -0.2,
};

const trendConfig: TrendStrategyConfig = {
  trendWeight: 1.0,
  exposureWeight: 0.3,
  lookbackSteps: 10,
  minWarmupSteps: 5,
  trendScale: 0.02,
  participationRate: 0.25,
  buyThreshold: 0.25,
  sellThreshold: -0.25,
};

async function runStage1Verification() {
  console.log('================================================================');
  console.log('  🧪 STAGE 1 VERIFICATION (Order Size, Cash Pref, Uncertainty)');
  console.log('================================================================\n');

  // ─────────────────────────────────────────────────────────────────
  // A. 주문 크기 배수 (Order Size Multiplier)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [Part A] 주문 크기 배수 검증');
  {
    // 1. 순수 함수 applyOrderSizeMultiplier: 한도 여유 조건에서 0.5x, 1.0x, 1.5x 검증
    const baseDesired = 400;
    const needed = 1000;
    const maxOrder = 2000;
    const participation = 1000;

    const size05 = applyOrderSizeMultiplier(baseDesired, 0.5, needed, maxOrder, participation);
    const size10 = applyOrderSizeMultiplier(baseDesired, 1.0, needed, maxOrder, participation);
    const size15 = applyOrderSizeMultiplier(baseDesired, 1.5, needed, maxOrder, participation);

    assert(size05 === 200, `여유 조건 0.5x 배수: 200주 (실제: ${size05})`);
    assert(size10 === 400, `여유 조건 1.0x 기준: 400주 (실제: ${size10})`);
    assert(size15 === 600, `여유 조건 1.5x 배수: 600주 (실제: ${size15})`);
    assert(size05 < size10 && size10 < size15, '여유 조건에서 0.5 < 1.0 < 1.5 감소·기준·증가 확인');

    // 2. 한도 구속 조건: 참여율 또는 잔여 수량이 작을 때 배수가 커져도 초과 불가
    const constrainedPart = 250;
    const sizeConstrained10 = applyOrderSizeMultiplier(baseDesired, 1.0, needed, maxOrder, constrainedPart);
    const sizeConstrained15 = applyOrderSizeMultiplier(baseDesired, 1.5, needed, maxOrder, constrainedPart);
    const sizeConstrained50 = applyOrderSizeMultiplier(baseDesired, 50.0, needed, maxOrder, constrainedPart);

    assert(sizeConstrained10 === 250, `참여율 한도 250주 구속 (실제: ${sizeConstrained10})`);
    assert(sizeConstrained15 === 250, `배수 1.5x에서도 참여율 한도 250주 미초과 (실제: ${sizeConstrained15})`);
    assert(sizeConstrained50 === 250, `배수 50.0x에서도 참여율 한도 250주 미초과 (실제: ${sizeConstrained50})`);

    // 잔여 수량(needed) 구속 조건
    const sizeNeededConstrained = applyOrderSizeMultiplier(400, 1.5, 300, maxOrder, 1000);
    assert(sizeNeededConstrained === 300, `잔여 수량(300주) 한도 구속 확인 (실제: ${sizeNeededConstrained})`);

    // 3. 전략 수준에서 매수 및 매도 양방향 배수 작동 확인
    const obsBuy = makeObservation({ account: makeAccount({ availableCash: 100_000_000 }) });
    const agent = makeAgent({ maxPosition: 100_000, maxOrderSize: 50_000, targetPositions: { MOCK: 2000 } });
    const trueF_Buy = 11000; // 저평가 -> BUY

    const buyIntent05 = evaluateValueStrategy(obsBuy, agent, valueConfig, trueF_Buy, new SimPrng(1), {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      orderSizeMultiplier: 0.5,
    });
    const buyIntent10 = evaluateValueStrategy(obsBuy, agent, valueConfig, trueF_Buy, new SimPrng(1), {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      orderSizeMultiplier: 1.0,
    });
    const buyIntent15 = evaluateValueStrategy(obsBuy, agent, valueConfig, trueF_Buy, new SimPrng(1), {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      orderSizeMultiplier: 1.5,
    });

    assert(buyIntent05.action === 'buy' && buyIntent10.action === 'buy' && buyIntent15.action === 'buy', '모두 매수 판단');
    assert(
      (buyIntent05.size ?? 0) < (buyIntent10.size ?? 0) && (buyIntent10.size ?? 0) < (buyIntent15.size ?? 0),
      `가치 매수 주문 수량 배수별 단조 증가 (${buyIntent05.size} < ${buyIntent10.size} < ${buyIntent15.size})`
    );

    // 매도 테스트 (고평가 -> SELL)
    const obsSell = makeObservation({
      account: makeAccount({ holdingQty: 2000, availableHolding: 2000 }),
    });
    const agentSell = makeAgent({ maxPosition: 100_000, maxOrderSize: 50_000, targetPositions: { MOCK: 0 } });
    const trueF_Sell = 9000; // 고평가 -> SELL

    const sellIntent05 = evaluateValueStrategy(obsSell, agentSell, valueConfig, trueF_Sell, new SimPrng(1), {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      orderSizeMultiplier: 0.5,
    });
    const sellIntent10 = evaluateValueStrategy(obsSell, agentSell, valueConfig, trueF_Sell, new SimPrng(1), {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      orderSizeMultiplier: 1.0,
    });
    const sellIntent15 = evaluateValueStrategy(obsSell, agentSell, valueConfig, trueF_Sell, new SimPrng(1), {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      orderSizeMultiplier: 1.5,
    });

    assert(sellIntent05.action === 'sell' && sellIntent10.action === 'sell' && sellIntent15.action === 'sell', '모두 매도 판단');
    assert(
      (sellIntent05.size ?? 0) < (sellIntent10.size ?? 0) && (sellIntent10.size ?? 0) < (sellIntent15.size ?? 0),
      `가치 매도 주문 수량 배수별 단조 증가 (${sellIntent05.size} < ${sellIntent10.size} < ${sellIntent15.size})`
    );

    // 4. 효과 OFF는 기존 계산 보존
    const buyIntentOff = evaluateValueStrategy(obsBuy, agent, valueConfig, trueF_Buy, new SimPrng(1), undefined);
    assert(buyIntentOff.action === 'buy', '효과 OFF 매수 확인');
    // 효과 OFF에서는 neededShares = 3928 (valGap 10% tanh 확장치), maxOrderSize = 50000, participationCap = 200000 -> 3928
    assert(buyIntentOff.size === 3928, `효과 OFF는 변경 전 100% gap(=3928) 보존 (실제: ${buyIntentOff.size})`);

    // 5. 1주 미만 0 반환 확인
    const zeroSize = applyOrderSizeMultiplier(0.4, 1.0, 10, 100, 100);
    assert(zeroSize === 0, `1주 미만(0.4주)은 0 반환 (실제: ${zeroSize})`);
    console.log('  ✓ Part A 통과: 주문 크기 배수 정상 작동·한도 구속·양방향 대칭·OFF 보존 확인\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // B. 계좌 전체 현금 선호도 (Portfolio NAV Cash Preference)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [Part B] 계좌 전체 현금 선호도 검증');
  {
    const trueF_Buy = 11000;
    const agent = makeAgent({ maxPosition: 100_000, maxOrderSize: 50_000, targetPositions: { MOCK: 10000 } });

    // 1. 경계 동작: cashPreference = 0 vs 1
    // cash = 10,000,000, holdings = 0, midPrice = 10,000, costPerShare = 10025
    const obsBase = makeObservation({
      account: makeAccount({ cash: 10_000_000, availableCash: 10_000_000, totalHoldingsValue: 0, nav: 10_000_000 }),
    });

    const pref0 = evaluateValueStrategy(obsBase, agent, valueConfig, trueF_Buy, new SimPrng(1), {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      cashPreference: 0,
    });
    assert(pref0.action === 'buy' && (pref0.size ?? 0) > 0, 'cashPreference=0: 전액 매수 가능');

    const pref1 = evaluateValueStrategy(obsBase, agent, valueConfig, trueF_Buy, new SimPrng(1), {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      cashPreference: 1.0,
    });
    assert(pref1.action === 'hold' && pref1.reason === 'insufficient_cash', 'cashPreference=1: 목표 현금 100%로 신규 매수 차단');

    // 2. 기존 보유 종목 및 매수 예약금이 있는 계좌
    // cash = 5,000,000, reservedCash = 1,000,000 -> availableCash = 4,000,000
    // totalHoldingsValue = 5,000,000 -> NAV = 10,000,000
    // cashPreference = 0.3 -> targetCash = 10,000,000 * 0.3 = 3,000,000
    // spendableCash = max(0, availableCash - targetCash) = 4,000,000 - 3,000,000 = 1,000,000
    const obsWithReserved = makeObservation({
      account: makeAccount({
        cash: 5_000_000,
        reservedCash: 1_000_000,
        availableCash: 4_000_000,
        totalHoldingsValue: 5_000_000,
        nav: 10_000_000,
      }),
    });
    const pref03 = evaluateValueStrategy(obsWithReserved, agent, valueConfig, trueF_Buy, new SimPrng(1), {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      cashPreference: 0.3,
    });
    assert(pref03.action === 'buy', 'spendableCash > 0 일 때 매수 허용');
    const actualCostPerShare = (pref03.price ?? 10000) * 1.0025;
    const expectedMaxAffordable = Math.floor(1_000_000 / actualCostPerShare);
    assert(
      pref03.size === expectedMaxAffordable,
      `spendableCash(1,000,000원) 한도 내 매수 수량 일치 (기대: ${expectedMaxAffordable}, 실제: ${pref03.size})`
    );

    // 3. 이미 목표 미달인 계좌에서 불필요한 강제 매도 없음
    // cash = 2,000,000, availableCash = 2,000,000, totalHoldings = 8,000,000 -> NAV = 10,000,000
    // targetCash = 3,000,000 -> 현재 cash (20%) < target (30%)
    const obsBelowTarget = makeObservation({
      account: makeAccount({
        cash: 2_000_000,
        availableCash: 2_000_000,
        totalHoldingsValue: 8_000_000,
        nav: 10_000_000,
      }),
    });
    const belowIntent = evaluateValueStrategy(obsBelowTarget, agent, valueConfig, trueF_Buy, new SimPrng(1), {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      cashPreference: 0.3,
    });
    assert(
      belowIntent.action === 'hold' && belowIntent.reason === 'insufficient_cash',
      '목표 미달 계좌에서 매수만 차단되고 강제 매도 발생하지 않음 (hold)'
    );

    // 4. 추세 전략에서도 동일하게 spendableCash 한도 작동
    const trendObs = makeObservation({
      priceHistory: [10000, 10050, 10150, 10250, 10350, 10500],
      account: makeAccount({
        cash: 5_000_000,
        reservedCash: 1_000_000,
        availableCash: 4_000_000,
        totalHoldingsValue: 5_000_000,
        nav: 10_000_000,
      }),
    });
    const trendAgent = makeAgent({ strategyType: 'trend', maxOrderSize: 50_000, maxPosition: 100_000 });
    const trendPref03 = evaluateTrendStrategy(trendObs, trendAgent, trendConfig, {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      cashPreference: 0.3,
    });
    if (trendPref03.action === 'buy') {
      const trendCost = (trendPref03.price ?? 10000) * 1.0025;
      const maxPossible = Math.floor(1_000_000 / trendCost);
      assert((trendPref03.size ?? 0) <= maxPossible, '추세 매수에서도 spendableCash 초과 없음');
    }
    console.log('  ✓ Part B 통과: 계좌 전체 NAV 기반 목표 현금액·spendableCash·강제 매도 방지 확인\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // C. 봇 불확실성 배수 (Uncertainty Multiplier)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [Part C] 봇 불확실성 배수 검증');
  {
    // 1. 유효 불확실성 계산 순수성
    const unc1 = applyUncertaintyMultiplier(0.1, 1.0);
    const unc2 = applyUncertaintyMultiplier(0.1, 2.5);
    const uncMax = applyUncertaintyMultiplier(0.5, 5.0);
    assert(unc1 === 0.1, `불확실성 1.0x: 0.1 (실제: ${unc1})`);
    assert(unc2 === 0.25, `불확실성 2.5x: 0.25 (실제: ${unc2})`);
    assert(uncMax === 1.0, `불확실성 상한 clamp01: 1.0 (실제: ${uncMax})`);

    // 2. 가치 전략: 불확실성이 높을 때 요구 안전 마진(minProfitMarginPct) 확대
    // deadbandPct = 0.01 (1.0%). spread = 200 -> halfSpreadPct = 0.010. estimatedRoundTripCost = 0.003 + 0.010 = 0.013.
    // minProfitMarginPct = 0.003.
    // lowUnc(0): hurdle = 0.013 + 0.003 = 0.016 (1.6%).
    // highUnc(1.0): hurdle = 0.013 + 0.006 = 0.019 (1.9%).
    // trueF = 10180 -> valGap = 0.018 (1.8%):
    // 1.8% > 1.6% (lowUnc -> BUY)
    // 1.8% < 1.9% (highUnc -> HOLD with insufficient_profit_margin)
    const obsMarginal = makeObservation({
      spread: 200,
      midPrice: 10000,
      uncertaintyScore: 0.5,
      account: makeAccount({ availableCash: 10_000_000 }),
    });
    const agent = makeAgent({ maxPosition: 100_000, maxOrderSize: 50_000, targetPositions: { MOCK: 2000 } });
    const trueF_Marginal = 10180; // ~1.8% 저평가

    const intentLowUnc = evaluateValueStrategy(obsMarginal, agent, valueConfig, trueF_Marginal, new SimPrng(1), {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      uncertaintyMultiplier: 0.0, // effectiveUncertainty = 0
    });
    const intentHighUnc = evaluateValueStrategy(obsMarginal, agent, valueConfig, trueF_Marginal, new SimPrng(1), {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      uncertaintyMultiplier: 2.0, // effectiveUncertainty = 1.0
    });

    assert(intentLowUnc.action === 'buy', '낮은 불확실성에서는 1.8% 괴리에서 매수 진입');
    assert(
      intentHighUnc.action === 'hold' && intentHighUnc.reason === 'insufficient_profit_margin',
      '높은 불확실성에서는 요구 마진 확대로 신중하게 보류(hold) 전환'
    );

    // 3. 방향 왜곡 없음: 고평가 상황에서 높은 불확실성으로 인해 매수로 바뀌지 않음
    const trueF_Overval = 9900; // 고평가
    const intentOvervalHighUnc = evaluateValueStrategy(obsMarginal, agent, valueConfig, trueF_Overval, new SimPrng(1), {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      uncertaintyMultiplier: 2.0,
    });
    assert(intentOvervalHighUnc.action !== 'buy', '불확실성이 매매 방향을 반대로 왜곡하지 않음');

    // 4. 추세 전략: 불확실성이 높을 때 진입 임계치 확대
    const trendObsMarginal = makeObservation({
      priceHistory: [10000, 10050, 10100, 10150, 10200, 10260],
      uncertaintyScore: 0.4,
      account: makeAccount({ availableCash: 10_000_000 }),
    });
    const trendAgent = makeAgent({ strategyType: 'trend', maxOrderSize: 50_000, maxPosition: 100_000 });

    const trendLowUnc = evaluateTrendStrategy(trendObsMarginal, trendAgent, trendConfig, {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      uncertaintyMultiplier: 0.0,
    });
    const trendHighUnc = evaluateTrendStrategy(trendObsMarginal, trendAgent, trendConfig, {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      uncertaintyMultiplier: 2.0,
    });

    // 높은 불확실성은 진입 임계치를 높이므로 신규 매수 수량을 증가시킬 수 없음
    const sizeLow = trendLowUnc.action === 'buy' ? (trendLowUnc.size ?? 0) : 0;
    const sizeHigh = trendHighUnc.action === 'buy' ? (trendHighUnc.size ?? 0) : 0;
    assert(sizeHigh <= sizeLow, `높은 불확실성이 신규 위험 노출을 증가시키지 않음 (${sizeHigh} <= ${sizeLow})`);

    // 5. 효과 OFF 결과는 변경 전과 동일
    const offIntent = evaluateValueStrategy(obsMarginal, agent, valueConfig, trueF_Marginal, new SimPrng(1), undefined);
    assert(offIntent.action === intentLowUnc.action, '효과 OFF는 중립(unc=0)과 동일한 행동');
    console.log('  ✓ Part C 통과: 봇 불확실성 배수 연결·안전마진 확대·방향 보존·위험 노출 미증가 확인\n');
  }

  console.log('================================================================');
  console.log('  🎉 STAGE 1 VERIFICATION TESTS ALL PASSED (EXIT CODE 0)');
  console.log('================================================================\n');
}

runStage1Verification().catch((err) => {
  console.error('\n❌ STAGE 1 TEST ERROR:', err);
  process.exit(1);
});
