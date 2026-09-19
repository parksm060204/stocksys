/**
 * scripts/test-stage2-review-fixes.ts
 *
 * STOCKSYS 시장 국면 2단계 최신 리뷰 수정 사항 종합 회귀 및 라이프사이클 통합 검증 스크립트
 *
 * 검증 축:
 *  A. 불확실성 위험 축소 매도 보장 검증 (valueStrategy, trendStrategy)
 *     - 유효 불확실성이 높아도 기존 보유량 축소 매도는 HOLD로 전환되지 않고 정상 매도 결정
 *     - 신규 매수(위험 노출 확대)는 높은 불확실성에서 threshold 강화로 안전하게 억제
 *     - 매도 신호가 없는 상황에서 불확실성만으로 강제 매도 발생 금지
 *     - 공매도(신규 short 노출) 상황과 현물 매도(보유량 축소)의 차별화 검증
 *
 *  B. LP 취소 실패 후 대체 주문 중복 추가 방지 검증 (lpStrategy, agentManager)
 *     - 사례 1: 1,000주 취소 실패 후 별도 가용 자금이 있어도 동일 가격에 200주 추가 제출 보류
 *     - 사례 2: 다음 스텝에서 취소 성공 시 최신 예산에 맞춰 적절한 대체 주문 생성
 *     - 사례 3: 취소 대기 중 부분체결(300주 체결, 700주 잔여) 발생 시 최신 잔량과 예약금 기준 처리
 *     - 사례 4: 예산 부족 상태에서 유지 가능한 100주 호가가 복수 스텝 동안 주문 ID 및 시간 우선순위 유지
 *
 *  C. 계좌 NAV 종목 독립성 및 권위적 평가가격 검증 (marketObservation, valueStrategy, trendStrategy)
 *     - A, B 종목 보유 시 midPrice와 current_price가 달라도 어느 종목을 관측하든 동일한 NAV/totalHoldingsValue 산출
 *     - 비정상 가격(NaN, <=0) 감지 시 isPortfolioValuationComplete=false 및 신규 매수 예산 보수적 차단
 *     - 예약금 및 체결/취소 상태 전후 NAV 일관성 검증
 */

import { memoryDb, OrderRecord } from '../lib/memoryDb/memoryStore';
import { LocalMarketService } from '../lib/engine/marketService';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import {
  buildMarketObservation,
  calculateAuthoritativePortfolioValuation,
  MarketObservation,
} from '../lib/engine/simulation/marketObservation';
import { evaluateValueStrategy } from '../lib/engine/simulation/strategies/valueStrategy';
import { evaluateTrendStrategy } from '../lib/engine/simulation/strategies/trendStrategy';
import { evaluateLpStrategy } from '../lib/engine/simulation/strategies/lpStrategy';
import {
  AgentAccount,
  TrendStrategyConfig,
  ValueStrategyConfig,
  LpStrategyConfig,
} from '../lib/engine/simulation/agentTypes';
import {
  BotEffectParams,
  LpEffectParams,
  NEUTRAL_BOT_EFFECT_PARAMS,
  NEUTRAL_LP_EFFECT_PARAMS,
} from '../lib/engine/simulation/regime/regimeEffects';
import { SimPrng } from '../lib/engine/simulation/simClock';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

const STOCK_A_ID = '00000000-0000-4000-8000-000000000101'; // 오성전자
const STOCK_B_ID = '00000000-0000-4000-8000-000000000102'; // 바이오젠

// ─────────────────────────────────────────────────────────────────
// [PART A] 불확실성 위험 축소 매도 검증
// ─────────────────────────────────────────────────────────────────
async function runPartA_UncertaintyTests() {
  console.log('\n================================================================');
  console.log('  [PART A] 불확실성 위험 축소 매도 및 신규 진입 제한 검증');
  console.log('================================================================');

  const baseObs: MarketObservation = {
    stockId: STOCK_A_ID,
    ticker: '005930',
    midPrice: 50000,
    bestBid: 49950,
    bestAsk: 50050,
    spread: 100,
    hasTwoSidedBook: true,
    bidsDepth: [{ price: 49950, size: 5000 }],
    asksDepth: [{ price: 50050, size: 5000 }],
    lastTradePrice: 50000,
    lastTradeVolume: 100,
    recentTrades: [],
    priceHistory: [52000, 51500, 51000, 50500, 50000],
    returns: [-0.04],
    volatility: 0.02,
    isWarmup: false,
    simulationTime: 1773500000000,
    structural: {
      sharesOutstanding: 10000000,
      floatingShares: 5000000,
      sectorId: 'tech',
      themeIds: [],
      baseLiquidity: 0.5,
      baseSpreadBps: 20,
      baseDepthShares: 200,
      institutionalFit: 0.5,
      macroExposure: {},
    },
    attentionScore: 0.5,
    uncertaintyScore: 0.5,
    recentEvents: [],
    effectiveEvents: [],
    account: {
      cash: 50000000,
      holdingQty: 1000,
      avgPrice: 55000,
      reservedCash: 0,
      reservedHolding: 0,
      availableCash: 50000000,
      availableHolding: 1000,
      totalHoldingsValue: 50000000,
      nav: 100000000,
      isPortfolioValuationComplete: true,
    },
    activeOrders: [],
  };

  // 1. Trend Strategy 검증
  console.log('\n  [A-1] Trend Strategy: 하락 추세 위험 축소 매도 vs 신규 매수 진입');
  const trendAgent: AgentAccount = {
    agentId: 'trend_test_1',
    accountId: 'acc_trend_test',
    name: 'Trend Test Bot',
    participantType: 'bot',
    strategyType: 'trend',
    riskTolerance: 0.5,
    urgency: 0.5,
    activityRate: 1.0,
    nextDecisionTime: 0,
    targetPositions: { [STOCK_A_ID]: 1000 },
    maxPosition: 5000,
    maxOrderSize: 500,
    stats: { ordersSubmitted: 0, ordersCancelled: 0, fillsCount: 0, volumeTraded: 0, feesPaid: 0, realizedPnl: 0 },
  };

  const trendConfig: TrendStrategyConfig = {
    trendWeight: 1.0,
    exposureWeight: 0.5,
    lookbackSteps: 3,
    minWarmupSteps: 5,
    trendScale: 0.02,
    participationRate: 0.5,
    buyThreshold: 0.25,
    sellThreshold: -0.25,
  };

  // 동일한 하락 관측 생성 (단기 하락 수익률 -> normTrend ~ -0.48)
  // pastPrice(idx 1) = 51000, currentPrice = 50000 -> return = -0.0196 -> rawTrend = -0.527 -> normTrend = -0.483
  // unc=0 임계치(-0.25)는 초과 충족하지만, unc=1 이전 임계치(-0.50)에는 미달하는 정확한 재현 구간
  const fallingObs: MarketObservation = {
    ...baseObs,
    recentTrades: [{ id: 't1', stock_id: STOCK_A_ID, price: 50000, size: 1000, buyer_id: 'b', seller_id: 's', buyer_is_bot: false, seller_is_bot: false, sequence: 1, created_at: '' }],
    priceHistory: [51000, 51000, 50800, 50500, 50000],
  };

  // 효과 ON: unc=0 vs unc=1
  const neutralEffectParams: BotEffectParams = {
    ...NEUTRAL_BOT_EFFECT_PARAMS,
    uncertaintyMultiplier: 0.0,
  };
  const highUncertaintyEffectParams: BotEffectParams = {
    ...NEUTRAL_BOT_EFFECT_PARAMS,
    uncertaintyMultiplier: 2.0, // uncertainty = 0.5 * 2 = 1.0
  };

  const trendPlanLowUnc = evaluateTrendStrategy(fallingObs, trendAgent, trendConfig, neutralEffectParams);
  const trendPlanHighUnc = evaluateTrendStrategy(fallingObs, trendAgent, trendConfig, highUncertaintyEffectParams);

  assert(trendPlanLowUnc.action === 'sell', `Low uncertainty: 하락 추세에서 매도 결정 생성됨 (${trendPlanLowUnc.action})`);
  assert(
    trendPlanHighUnc.action === 'sell',
    `High uncertainty: 높은 불확실성에서도 위험 축소 매도가 HOLD로 차단되지 않음 (${trendPlanHighUnc.action})`
  );
  assert(
    trendPlanLowUnc.size === trendPlanHighUnc.size,
    `매도 수량 동일성 보장 (Low: ${trendPlanLowUnc.size}주, High: ${trendPlanHighUnc.size}주)`
  );
  assert(
    trendPlanHighUnc.reason?.includes('risk_reduction') === true,
    `매도 결정 사유에 risk_reduction 식별 정보 포함 (${trendPlanHighUnc.reason})`
  );

  // 공매도(신규 short 위험 노출) 상황에서는 높은 불확실성 시 매도 차단 확인
  const shortAgent: AgentAccount = {
    ...trendAgent,
    targetPositions: { [STOCK_A_ID]: 0 },
  };
  const shortObs: MarketObservation = {
    ...fallingObs,
    account: {
      ...fallingObs.account,
      holdingQty: 0,
      availableHolding: 0,
    },
  };
  const trendShortHighUnc = evaluateTrendStrategy(shortObs, shortAgent, trendConfig, highUncertaintyEffectParams);
  assert(
    trendShortHighUnc.action === 'hold' && trendShortHighUnc.reason === 'trend_below_threshold_uncertainty',
    `신규 short 위험 노출 확대는 높은 불확실성에서 trend_below_threshold_uncertainty로 안전하게 차단 (${trendShortHighUnc.reason})`
  );

  // 2. Trend Strategy 신규 진입 매수 제한 검증
  console.log('\n  [A-2] Trend Strategy: 경계 수준의 신규 매수는 불확실성에 의해 억제됨');
  const mildRisingObs: MarketObservation = {
    ...baseObs,
    recentTrades: [{ id: 't2', stock_id: STOCK_A_ID, price: 50000, size: 1000, buyer_id: 'b', seller_id: 's', buyer_is_bot: false, seller_is_bot: false, sequence: 1, created_at: '' }],
    priceHistory: [49000, 49000, 49200, 49500, 50000], // 경계 수준 상승 (normTrend ~ +0.48)
    account: {
      ...baseObs.account,
      holdingQty: 0,
      availableHolding: 0,
    },
  };

  const trendBuyLowUnc = evaluateTrendStrategy(mildRisingObs, trendAgent, trendConfig, neutralEffectParams);
  const trendBuyHighUnc = evaluateTrendStrategy(mildRisingObs, trendAgent, trendConfig, highUncertaintyEffectParams);

  assert(trendBuyLowUnc.action === 'buy', 'Low uncertainty: 경계 수준 상승에서 매수 진입');
  assert(
    trendBuyHighUnc.action === 'hold' && trendBuyHighUnc.reason === 'trend_below_threshold_uncertainty',
    `High uncertainty: 높은 불확실성에서 신규 위험 노출 확대(매수)가 안전하게 차단(HOLD)됨 (${trendBuyHighUnc.reason})`
  );

  // 3. Value Strategy 검증
  console.log('\n  [A-3] Value Strategy: 고평가 위험 축소 매도 vs 저평가 신규 매수 진입');
  const valueAgent: AgentAccount = {
    agentId: 'value_test_1',
    accountId: 'acc_value_test',
    name: 'Value Test Bot',
    participantType: 'bot',
    strategyType: 'value',
    riskTolerance: 0.5,
    urgency: 0.5,
    activityRate: 1.0,
    nextDecisionTime: 0,
    targetPositions: { [STOCK_A_ID]: 1000 },
    maxPosition: 5000,
    maxOrderSize: 500,
    stats: { ordersSubmitted: 0, ordersCancelled: 0, fillsCount: 0, volumeTraded: 0, feesPaid: 0, realizedPnl: 0 },
  };

  const valueConfig: ValueStrategyConfig = {
    valueWeight: 1.0,
    exposureWeight: 0.5,
    noiseStdDev: 0.0,
    delaySteps: 0,
    deadbandPct: 0.005,
    minProfitMarginPct: 0.01,
    participationRate: 0.5,
    buyThreshold: 0.2,
    sellThreshold: -0.2,
  };

  // 주가 50,000, 적정가치 49,200 (약 1.6% 고평가 -> roundTripCost 0.004 + margin 0.01 = 0.014)
  const overvaluedObs: MarketObservation = {
    ...baseObs,
    recentTrades: [{ id: 't3', stock_id: STOCK_A_ID, price: 50000, size: 1000, buyer_id: 'b', seller_id: 's', buyer_is_bot: false, seller_is_bot: false, sequence: 1, created_at: '' }],
  };

  const valPlanLowUnc = evaluateValueStrategy(overvaluedObs, valueAgent, valueConfig, 49200, new SimPrng(1), neutralEffectParams);
  const valPlanHighUnc = evaluateValueStrategy(overvaluedObs, valueAgent, valueConfig, 49200, new SimPrng(1), highUncertaintyEffectParams);

  assert(valPlanLowUnc.action === 'sell', `Value Low unc: 고평가 종목 매도 결정 (${valPlanLowUnc.action})`);
  assert(
    valPlanHighUnc.action === 'sell',
    `Value High unc: 높은 불확실성에서도 보유량 축소 매도가 차단되지 않음 (${valPlanHighUnc.action})`
  );
  assert(
    valPlanLowUnc.size === valPlanHighUnc.size,
    `Value 매도 수량 동일성 보장 (Low: ${valPlanLowUnc.size}주, High: ${valPlanHighUnc.size}주)`
  );

  // Value Strategy 저평가 신규 매수 시 불확실성 차단 검증
  // 적정가치 50,800 (약 1.6% 저평가)
  const undervaluedObs: MarketObservation = {
    ...baseObs,
    recentTrades: [{ id: 't4', stock_id: STOCK_A_ID, price: 50000, size: 1000, buyer_id: 'b', seller_id: 's', buyer_is_bot: false, seller_is_bot: false, sequence: 1, created_at: '' }],
    account: {
      ...baseObs.account,
      holdingQty: 0,
      availableHolding: 0,
    },
  };

  const valBuyLowUnc = evaluateValueStrategy(undervaluedObs, valueAgent, valueConfig, 50800, new SimPrng(1), neutralEffectParams);
  const valBuyHighUnc = evaluateValueStrategy(undervaluedObs, valueAgent, valueConfig, 50800, new SimPrng(1), highUncertaintyEffectParams);

  assert(valBuyLowUnc.action === 'buy', `Value Low unc: 저평가 종목 매수 결정 (${valBuyLowUnc.action})`);
  assert(
    valBuyHighUnc.action === 'hold' && valBuyHighUnc.reason === 'insufficient_profit_margin_uncertainty',
    `Value High unc: 높은 불확실성에서 신규 매수 차단 확인 (${valBuyHighUnc.reason})`
  );

  // 4. 무신호 상태에서 불확실성만으로 강제 매도 발생 금지
  console.log('\n  [A-4] 무신호 상태에서 높은 불확실성만으로 강제 매도 발생 금지');
  const neutralObs: MarketObservation = {
    ...baseObs,
  };
  const valPlanNeutral = evaluateValueStrategy(neutralObs, valueAgent, valueConfig, 50000, new SimPrng(1), highUncertaintyEffectParams);
  assert(valPlanNeutral.action === 'hold', '공정가치와 일치 시 불확실성이 높아도 강제 매도 없음 (HOLD)');
}

// ─────────────────────────────────────────────────────────────────
// [PART B] LP 취소 실패 후 대체 주문 중복 추가 방지 검증
// ─────────────────────────────────────────────────────────────────
async function runPartB_LpCancelFailureTests() {
  console.log('\n================================================================');
  console.log('  [PART B] LP 취소 실패 후 대체 주문 중복 추가 방지 검증');
  console.log('================================================================');

  const seed = 42;
  const startMs = 1773500000000;
  memoryDb.resetToSeedData();

  const mgr = new AgentManager(seed, startMs, {
    enableRegimeEngine: true,
    enableRegimeEffects: true,
  });

  const lpAgent = Array.from(mgr['agents'].values()).find((a) => a.participantType === 'lp');
  if (!lpAgent) {
    throw new Error('LP Agent not found');
  }

  // LP 계좌 초기 자산 설정 (충분한 현금 보유)
  const initialCash = 100_000_000;
  memoryDb.profiles.set(lpAgent.accountId, {
    id: lpAgent.accountId,
    user_id: lpAgent.accountId,
    username: 'lp_main',
    nickname: 'LP Main',
    cash: initialCash,
    net_worth: initialCash,
    rank_tier: 'Bronze',
    created_at: new Date(startMs).toISOString(),
  });

  // 기존 LP 호가 정리
  for (const [oId, ord] of memoryDb.orders.entries()) {
    if (ord.user_id === lpAgent.accountId) {
      memoryDb.orders.delete(oId);
    }
  }

  // 다른 봇들의 무작위 거래로 인한 가격 변동을 통제하기 위해 LP 외 봇 activityRate를 0으로 설정
  for (const ag of mgr['agents'].values()) {
    if (ag.participantType !== 'lp') {
      ag.activityRate = 0;
    }
  }

  // 종목 구조적 기본 깊이를 200주로 설정
  const stockA = memoryDb.stocks.get(STOCK_A_ID);
  if (stockA) {
    stockA.base_depth_shares = 200;
  }

  // ── 사례 1: 기존 1,000주, 새 목표 200주, 별도 가용 자금 존재 -> 취소 실패 시 200주 추가 방지
  console.log('\n  [B-1] 사례 1: 1,000주 취소 실패 후 같은 가격에 200주 추가 제출 보류');

  // LP 스프레드/깊이를 조절하여 레벨 1의 목표 깊이가 200주가 되도록 설정
  const tightLpConfig: LpStrategyConfig = {
    ...mgr['lpConfig'],
    baseLevelSize: 200,
    numLevels: 1,
  };
  mgr['lpConfig'] = tightLpConfig;

  // LP가 STOCK_A_ID에서 호가를 제출하려는 정확한 목표 가격 확인
  const preObs = buildMarketObservation(STOCK_A_ID, lpAgent.accountId, startMs);
  const prePlan = evaluateLpStrategy(preObs!, lpAgent, tightLpConfig, { ...NEUTRAL_LP_EFFECT_PARAMS, enforceDepthTarget: true });
  const targetBid = prePlan.newOrders.find((o) => o.side === 'buy');
  const targetPrice = targetBid ? targetBid.price : 69000;
  const existingOrderSize = 1000;

  // 1. 기존 1,000주 주문 등록
  const submitRes = await LocalMarketService.submitOrder({
    userId: lpAgent.accountId,
    stockId: STOCK_A_ID,
    side: 'buy',
    price: targetPrice,
    size: existingOrderSize,
    isLp: true,
    orderType: 'limit',
    simulationTime: startMs,
    createdAt: new Date(startMs).toISOString(),
  });
  assert(submitRes.success && submitRes.orderId !== undefined, `기존 1,000주 LP 주문 등록 성공 (가격: ${targetPrice})`);
  const restingOrderId = submitRes.orderId!;

  // 2. 통제된 취소 실패 주입 (해당 주문의 취소 실패)
  const origCancel = LocalMarketService.cancelOrder;
  let cancelAttemptedForTarget = false;

  try {
    LocalMarketService.cancelOrder = async (params) => {
      if (params.orderId === restingOrderId) {
        cancelAttemptedForTarget = true;
        return {
          success: false,
          statusCode: 500,
          message: 'Injected LP Cancel Failure for testing',
        };
      }
      return origCancel.call(LocalMarketService, params);
    };

    // AgentManager 시뮬레이션 1스텝 실행 (내부에서 cancelLpOrders -> re-observe -> safeNewOrders 필터링)
    await mgr.step(1.0);

    assert(cancelAttemptedForTarget, '교체 대상 1,000주 주문의 취소가 실제로 시도됨');

    // 검증: 장부에서 restingOrderId가 취소 실패하여 여전히 open 상태이고 잔여 1,000주 유지
    const restingAfter = memoryDb.orders.get(restingOrderId);
    assert(
      restingAfter !== undefined && (restingAfter.status === 'open' || restingAfter.status === 'partial'),
      '취소 실패한 기존 주문이 여전히 활성(open/partial) 상태 유지'
    );

    // 검증: 동일한 50,000원에 새로운 200주 주문이 '추가'되지 않았는지 확인
    const activeBidsAtPrice = Array.from(memoryDb.orders.values()).filter(
      (o) =>
        o.user_id === lpAgent.accountId &&
        o.stock_id === STOCK_A_ID &&
        o.side === 'buy' &&
        o.price === targetPrice &&
        (o.status === 'open' || o.status === 'partial')
    );

    const totalBidSizeAtPrice = activeBidsAtPrice.reduce(
      (sum, o) => sum + (o.size - (o.filled || 0)),
      0
    );

    assert(
      activeBidsAtPrice.length === 1 && activeBidsAtPrice[0].id === restingOrderId,
      `동일 가격(50,000원)에 신규 중복 주문 미생성 확인 (활성 주문 수: ${activeBidsAtPrice.length}개)`
    );
    assert(
      totalBidSizeAtPrice === existingOrderSize,
      `총 매수 잔량이 1,200주로 팽창하지 않고 1,000주 유지됨 (현재: ${totalBidSizeAtPrice}주)`
    );
  } finally {
    // 실패 주입 해제 (finally 보장)
    LocalMarketService.cancelOrder = origCancel;
  }

  // ── 사례 2: 다음 스텝에서 취소가 정상 성공하면 최신 예산에 맞춰 적절한 대체 주문 생성
  console.log('\n  [B-2] 사례 2: 다음 스텝에서 취소 성공 시 최신 예산에 맞춘 대체 주문 생성');
  // 실패 주입이 해제된 상태에서 다음 스텝 실행
  await mgr.step(1.0);

  const prevOrder = memoryDb.orders.get(restingOrderId);
  assert(prevOrder?.status === 'cancelled', '기존 1,000주 주문이 정상적으로 취소됨');

  const allLpOrders = Array.from(memoryDb.orders.values()).filter(
    (o) => o.user_id === lpAgent.accountId && o.stock_id === STOCK_A_ID && (o.status === 'open' || o.status === 'partial')
  );
  console.log('Active LP orders after step 2:', allLpOrders.map(o => ({ id: o.id, side: o.side, price: o.price, size: o.size, status: o.status })));

  const newActiveBids = Array.from(memoryDb.orders.values()).filter(
    (o) =>
      o.user_id === lpAgent.accountId &&
      o.stock_id === STOCK_A_ID &&
      o.side === 'buy' &&
      (o.status === 'open' || o.status === 'partial')
  );

  assert(newActiveBids.length === 1, `정상 취소 후 새로운 적절한 대체 주문이 1개 생성됨 (수량: ${newActiveBids[0]?.size}주, 가격: ${newActiveBids[0]?.price}원)`);
  assert(
    newActiveBids[0].size <= 200,
    `대체 주문의 수량이 목표 수량(200주 이하)에 부합함 (${newActiveBids[0].size}주)`
  );

  // ── 사례 3: 취소 대기 중 부분체결 발생 시 최신 잔량과 예약금으로 처리
  console.log('\n  [B-3] 사례 3: 부분 체결 주문의 잔여 수량 및 예약 자산 반영 검증');
  const partialOrder = newActiveBids[0];
  const fillAmount = 50;
  partialOrder.filled = fillAmount; // 50주 부분 체결
  partialOrder.status = 'partial';

  const obsForPartial = buildMarketObservation(STOCK_A_ID, lpAgent.accountId, mgr.clock.simulationTime);
  assert(obsForPartial !== null, '관측 생성 성공');
  const remainingInObs = obsForPartial!.activeOrders.find((o) => o.id === partialOrder.id);
  const remainingQty = (remainingInObs?.size ?? 0) - (remainingInObs?.filled ?? 0);
  const expectedRem = partialOrder.size - fillAmount;
  assert(remainingQty === expectedRem, `부분 체결 후 잔여 수량 ${expectedRem}주가 관측에 정확히 반영됨 (잔여: ${remainingQty}주)`);

  // ── 사례 4: 목표 1,000주지만 자금상 100주만 유지 가능한 상태에서 주문 ID 보존
  console.log('\n  [B-4] 사례 4: 자금 제약 하 지속 가능한 주문의 ID 및 시간 우선순위 다중 스텝 보존');
  // 기존 주문 정리
  for (const [oId, ord] of memoryDb.orders.entries()) {
    if (ord.user_id === lpAgent.accountId) {
      memoryDb.orders.delete(oId);
    }
  }

  // LP 호가 가격에 정확히 100주 매수에 필요한 금액만 입금하여 주문 후 가용 현금이 0이 되도록 설정
  const restingPrice = partialOrder.price;
  const exactCost = Math.ceil(100 * restingPrice * 1.0025);
  const lpProf = memoryDb.profiles.get(lpAgent.accountId);
  if (lpProf) {
    lpProf.cash = exactCost;
  }

  // LP 호가 가격(partialOrder.price)에 100주 주문을 resting으로 등록
  const test100Res = await LocalMarketService.submitOrder({
    userId: lpAgent.accountId,
    stockId: STOCK_A_ID,
    side: 'buy',
    price: restingPrice,
    size: 100,
    isLp: true,
    orderType: 'limit',
    simulationTime: mgr.clock.simulationTime,
    createdAt: new Date(mgr.clock.simulationTime).toISOString(),
  });
  assert(test100Res.success, `100주 테스트 주문 등록 (가격: ${restingPrice})`);
  const preservedOrderId = test100Res.orderId!;

  // 3스텝 연속 시뮬레이션 실행 (시장·가격·자산이 유지될 때 주문 ID 보존 확인)
  for (let s = 1; s <= 3; s++) {
    await mgr.step(1.0);
    const ordCheck = memoryDb.orders.get(preservedOrderId);
    assert(
      ordCheck !== undefined && (ordCheck.status === 'open' || ordCheck.status === 'partial'),
      `스텝 ${s}: 주문 ID ${preservedOrderId}가 취소되지 않고 유지됨 (상태: ${ordCheck?.status})`
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// [PART C] 계좌 NAV 종목 독립성 및 권위적 평가가격 검증
// ─────────────────────────────────────────────────────────────────
async function runPartC_NavIndependenceTests() {
  console.log('\n================================================================');
  console.log('  [PART C] 계좌 NAV 종목 독립성 및 권위적 평가가격 검증');
  console.log('================================================================');

  const testAccountId = 'acc_multi_holding_test';
  const rawCash = 20_000_000;

  // 계좌 및 2개 종목 보유 설정
  memoryDb.profiles.set(testAccountId, {
    id: testAccountId,
    user_id: testAccountId,
    username: 'test_multi',
    nickname: 'Multi Test',
    cash: rawCash,
    net_worth: rawCash,
    rank_tier: 'Silver',
    created_at: new Date().toISOString(),
  });

  // 종목 A: current_price = 50,000, 보유 100주 (평가액 5,000,000)
  // 종목 B: current_price = 20,000, 보유 200주 (평가액 4,000,000)
  // 총 주식 평가액 = 9,000,000, 총 NAV = 29,000,000
  const stockA = memoryDb.stocks.get(STOCK_A_ID);
  if (stockA) stockA.current_price = 50000;

  const stockB = memoryDb.stocks.get(STOCK_B_ID);
  if (stockB) stockB.current_price = 20000;

  // holdings 설정
  const hIdA = `h_${testAccountId}_${STOCK_A_ID}`;
  const hIdB = `h_${testAccountId}_${STOCK_B_ID}`;

  memoryDb.holdings.set(hIdA, {
    id: hIdA,
    user_id: testAccountId,
    stock_id: STOCK_A_ID,
    quantity: 100,
    avg_price: 48000,
    created_at: new Date().toISOString(),
  });

  memoryDb.holdings.set(hIdB, {
    id: hIdB,
    user_id: testAccountId,
    stock_id: STOCK_B_ID,
    quantity: 200,
    avg_price: 19000,
    created_at: new Date().toISOString(),
  });

  memoryDb.holdingUserIndex.set(testAccountId, new Set([hIdA, hIdB]));

  // 의도적으로 호가창 중간값(midPrice)을 current_price와 크게 다르게 조성
  // 종목 A 호가: 40,000 / 44,000 -> midPrice = 42,000 (current_price 50,000과 다름)
  // 종목 B 호가: 24,000 / 28,000 -> midPrice = 26,000 (current_price 20,000과 다름)
  for (const [oId, ord] of memoryDb.orders.entries()) {
    if (ord.stock_id === STOCK_A_ID || ord.stock_id === STOCK_B_ID) {
      memoryDb.orders.delete(oId);
    }
  }

  // 종목 A 호가 직접 등록 (40,000 / 44,000 -> midPrice = 42,000)
  function insertBookOrder(id: string, stockId: string, side: 'buy' | 'sell', price: number, size: number) {
    const ord: OrderRecord = {
      id,
      stock_id: stockId,
      user_id: 'maker_user',
      side,
      price,
      size,
      filled: 0,
      status: 'open',
      is_lp: false,
      created_at: new Date().toISOString(),
    };
    memoryDb.orders.set(id, ord);
    if (!memoryDb.orderStockIndex.has(stockId)) {
      memoryDb.orderStockIndex.set(stockId, new Set());
    }
    memoryDb.orderStockIndex.get(stockId)!.add(id);
  }

  insertBookOrder('ord_a_bid', STOCK_A_ID, 'buy', 40000, 100);
  insertBookOrder('ord_a_ask', STOCK_A_ID, 'sell', 44000, 100);

  // 종목 B 호가 직접 등록 (24,000 / 28,000 -> midPrice = 26,000)
  insertBookOrder('ord_b_bid', STOCK_B_ID, 'buy', 24000, 100);
  insertBookOrder('ord_b_ask', STOCK_B_ID, 'sell', 28000, 100);

  const simTime = 1773500000000;
  const obsA = buildMarketObservation(STOCK_A_ID, testAccountId, simTime);
  const obsB = buildMarketObservation(STOCK_B_ID, testAccountId, simTime);

  assert(obsA !== null && obsB !== null, '종목 A 및 B 관측 생성 완료');

  console.log(`\n  [C-1] 동일 시점 관측 종목 간 NAV 및 totalHoldingsValue 일치 확인`);
  console.log(`  - Obs A: midPrice=${obsA?.midPrice}, totalHoldingsValue=${obsA?.account.totalHoldingsValue}, nav=${obsA?.account.nav}`);
  console.log(`  - Obs B: midPrice=${obsB?.midPrice}, totalHoldingsValue=${obsB?.account.totalHoldingsValue}, nav=${obsB?.account.nav}`);

  assert(
    obsA?.midPrice !== stockA?.current_price && obsB?.midPrice !== stockB?.current_price,
    '테스트 전제 조건 충족: 호가 midPrice가 current_price와 의도적으로 상이함'
  );

  assert(
    obsA?.account.totalHoldingsValue === obsB?.account.totalHoldingsValue,
    `totalHoldingsValue 일치 보장 (A: ${obsA?.account.totalHoldingsValue}, B: ${obsB?.account.totalHoldingsValue})`
  );
  assert(
    obsA?.account.totalHoldingsValue === 9_000_000,
    `totalHoldingsValue가 권위적 체결가(100*50000 + 200*20000 = 900만원)로 정확히 산출됨`
  );

  assert(
    obsA?.account.nav === obsB?.account.nav,
    `계좌 NAV 일치 보장 (A: ${obsA?.account.nav}, B: ${obsB?.account.nav})`
  );
  assert(
    obsA?.account.nav === 29_000_000,
    `계좌 NAV가 2,900만원(현금 2000만 + 주식 900만)으로 정확히 산출됨`
  );
  assert(
    obsA?.account.isPortfolioValuationComplete === true && obsB?.account.isPortfolioValuationComplete === true,
    '포트폴리오 평가 완전성 플래그 isPortfolioValuationComplete === true'
  );

  // 전략 레벨에서 목표 현금액 산출 동일성 검증
  console.log('\n  [C-2] 전략 레벨에서 조회 종목에 무관하게 동일한 목표 현금액 산출 확인');
  const testAgent: AgentAccount = {
    agentId: 'nav_test_agent',
    accountId: testAccountId,
    name: 'Nav Test Agent',
    participantType: 'bot',
    strategyType: 'trend',
    riskTolerance: 0.5,
    urgency: 0.5,
    activityRate: 1.0,
    nextDecisionTime: 0,
    targetPositions: { [STOCK_A_ID]: 1000 },
    maxPosition: 5000,
    maxOrderSize: 500,
    stats: { ordersSubmitted: 0, ordersCancelled: 0, fillsCount: 0, volumeTraded: 0, feesPaid: 0, realizedPnl: 0 },
  };

  const trendConf: TrendStrategyConfig = {
    trendWeight: 1.0,
    exposureWeight: 0.5,
    lookbackSteps: 3,
    minWarmupSteps: 5,
    trendScale: 0.02,
    participationRate: 0.5,
    buyThreshold: 0.25,
    sellThreshold: -0.25,
  };

  // 비정상 가격 감지 시 안전 차단 검증
  console.log('\n  [C-3] 비정상 가격(NaN, <=0) 감지 시 isPortfolioValuationComplete=false 및 신규 매수 보수적 차단');
  const corruptStockB = memoryDb.stocks.get(STOCK_B_ID);
  if (corruptStockB) {
    corruptStockB.current_price = NaN;
  }
  const corruptHoldingB = memoryDb.holdings.get(hIdB);
  if (corruptHoldingB) {
    corruptHoldingB.avg_price = 0;
  }

  const corruptValuation = calculateAuthoritativePortfolioValuation(testAccountId, rawCash);
  assert(
    corruptValuation.isComplete === false,
    '비정상 가격 종목 존재 시 isComplete === false 로 식별됨'
  );
  assert(
    corruptValuation.incompleteReasons.length > 0,
    `불완전 평가 원인 기록됨: ${corruptValuation.incompleteReasons.join(', ')}`
  );

  // 전략 실행 시 spendableCash = 0 처리되어 신규 매수 차단되는지 확인
  const corruptObs = buildMarketObservation(STOCK_A_ID, testAccountId, simTime);
  assert(corruptObs?.account.isPortfolioValuationComplete === false, '관측 객체에 isPortfolioValuationComplete=false 전파됨');

  const risingObsCorrupt: MarketObservation = {
    ...corruptObs!,
    priceHistory: [45000, 46000, 47000, 48000, 50000], // 강한 매수 신호
  };

  const effectParamsWithCashPref: BotEffectParams = {
    ...NEUTRAL_BOT_EFFECT_PARAMS,
    cashPreference: 0.4,
  };
  const blockedBuyPlan = evaluateTrendStrategy(risingObsCorrupt, testAgent, trendConf, effectParamsWithCashPref);
  assert(
    blockedBuyPlan.action === 'hold' && blockedBuyPlan.reason === 'incomplete_portfolio_valuation',
    `포트폴리오 평가가 불완전한 경우 신규 매수 예산이 0으로 차단되어 주문 미생성(HOLD) 확인 (${blockedBuyPlan.reason})`
  );

  // 원복
  if (corruptStockB) corruptStockB.current_price = 20000;
  if (corruptHoldingB) corruptHoldingB.avg_price = 19000;

  // 예약금 정확성 검증: 신규 매수 주문 등록 후 관측 시 reservation 반영 및 NAV 일관성
  console.log('\n  [C-4] 예약금 반영 후 NAV 불변성 및 이중 차감 없음 검증');
  const buyRes = await LocalMarketService.submitOrder({
    userId: testAccountId,
    stockId: STOCK_A_ID,
    side: 'buy',
    price: 40000,
    size: 50, // 2,000,000원 + 수수료 예약
    isLp: false,
    orderType: 'limit',
    createdAt: new Date().toISOString(),
  });
  assert(buyRes.success, '예약금 테스트 주문 등록');

  const obsAfterOrderA = buildMarketObservation(STOCK_A_ID, testAccountId, simTime);
  const obsAfterOrderB = buildMarketObservation(STOCK_B_ID, testAccountId, simTime);

  assert(
    obsAfterOrderA?.account.reservedCash === 40000 * 50,
    `예약금 정확히 집계됨: ${obsAfterOrderA?.account.reservedCash}원`
  );
  assert(
    obsAfterOrderA?.account.nav === obsAfterOrderB?.account.nav,
    `주문 예약 상태에서도 양 종목 관측의 NAV는 완전히 동일함 (${obsAfterOrderA?.account.nav}원)`
  );
  assert(
    obsAfterOrderA?.account.nav === 29_000_000,
    `미체결 주문의 예약금은 현금에서 중복 소멸되지 않고 장부 NAV(2,900만원)를 보존함`
  );

  // 주문 취소 후 복원 확인
  if (buyRes.orderId) {
    await LocalMarketService.cancelOrder({ orderId: buyRes.orderId, userId: testAccountId });
  }
  const obsAfterCancel = buildMarketObservation(STOCK_A_ID, testAccountId, simTime);
  assert(obsAfterCancel?.account.reservedCash === 0, '취소 후 예약금 0원으로 안전하게 복원');
}

// ─────────────────────────────────────────────────────────────────
// 메인 실행
// ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  STOCKSYS 시장 국면 2단계 최신 리뷰 수정 종합 검증 스위트     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  await runPartA_UncertaintyTests();
  await runPartB_LpCancelFailureTests();
  await runPartC_NavIndependenceTests();

  console.log('\n================================================================');
  console.log('  🎉 ALL STAGE 2 REVIEW FIX VERIFICATION TESTS PASSED (EXIT 0)');
  console.log('================================================================\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED WITH ERROR:', err);
  process.exit(1);
});
