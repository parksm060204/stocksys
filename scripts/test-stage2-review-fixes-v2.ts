/**
 * scripts/test-stage2-review-fixes-v2.ts
 *
 * STOCKSYS 최신 코드 리뷰 2대 이슈 검증 스위트:
 * 1. [Part 1] 효과 OFF에서 발생한 추세 매수 회귀 복원 검증
 *    - urgency < 0.2, 0.2~0.5, >= 0.5 사례
 *    - normTrend > 0.6이지만 urgency < 0.5인 사례
 *    - bestAsk 존재/부재 사례
 *    - 9,900원 limit 1,000주 복원 확인 (10,100원 ioc 987주 회귀 해소)
 *    - 불확실성 위험 축소 매도 및 신규 진입 제한 유지 확인
 *
 * 2. [Part 2] 가격 변경을 동반한 LP 교체의 취소 실패 방어 8대 필수 사례 (A ~ H)
 *    - A. 같은 가격 1,000주 → 200주 축소, 취소 실패
 *    - B. 9,800원 1,000주 → 9,900원 200주 가격 변경 교체, 취소 실패
 *    - C. 다음 스텝 취소 성공 후 최신 목표 재호가
 *    - D. 첫 취소 실패 후 같은 스텝 재시도 성공
 *    - E. 취소 대기 중 부분체결 및 전량체결
 *    - F. 최종 장부 조회 실패 시 신규 제출 보류
 *    - G. 다른 종목의 정상 LP 처리는 지속
 *    - H. 예산 부족 상태에서 유지 가능한 주문의 ID·시간 우선순위 보존
 */

import { memoryDb, OrderRecord } from '../lib/memoryDb/memoryStore';
import { LocalMarketService } from '../lib/engine/marketService';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import * as MarketObservationModule from '../lib/engine/simulation/marketObservation';
import {
  buildMarketObservation,
  MarketObservation,
} from '../lib/engine/simulation/marketObservation';
import { evaluateTrendStrategy } from '../lib/engine/simulation/strategies/trendStrategy';
import { evaluateLpStrategy } from '../lib/engine/simulation/strategies/lpStrategy';
import {
  AgentAccount,
  TrendStrategyConfig,
  LpStrategyConfig,
} from '../lib/engine/simulation/agentTypes';
import {
  BotEffectParams,
  NEUTRAL_BOT_EFFECT_PARAMS,
  NEUTRAL_LP_EFFECT_PARAMS,
} from '../lib/engine/simulation/regime/regimeEffects';

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
// [PART 1] 추세 매수 회귀 복원 검증
// ─────────────────────────────────────────────────────────────────
async function runPart1_TrendBuyRegressionTests() {
  console.log('\n================================================================');
  console.log('  [PART 1] 추세 매수 회귀 복원 검증 (827dd60 기준 비교)');
  console.log('================================================================');

  const baseObs: MarketObservation = {
    stockId: STOCK_A_ID,
    ticker: '005930',
    midPrice: 10000,
    bestBid: 9900,
    bestAsk: 10100,
    spread: 200,
    hasTwoSidedBook: true,
    bidsDepth: [{ price: 9900, size: 5000 }],
    asksDepth: [{ price: 10100, size: 5000 }],
    lastTradePrice: 10000,
    lastTradeVolume: 1000,
    recentTrades: [
      { id: 't1', stock_id: STOCK_A_ID, price: 10000, size: 5000, buyer_id: 'b', seller_id: 's', buyer_is_bot: false, seller_is_bot: false, sequence: 1, created_at: '' }
    ],
    // 4스텝 전 9,500원 → 현재 10,000원 (+5.26% 수익률 -> normTrend ~ +0.655)
    priceHistory: [9500, 9600, 9700, 9800, 10000],
    returns: [0.0526],
    volatility: 0.02,
    uncertaintyScore: 0.5,
    isWarmup: false,
    simulationTime: 1773500000000,
    account: {
      cash: 10000000, // 1,000만원
      holdingQty: 0,
      avgPrice: 0,
      reservedCash: 0,
      reservedHolding: 0,
      availableCash: 10000000,
      availableHolding: 0,
      totalHoldingsValue: 0,
      nav: 10000000,
      isPortfolioValuationComplete: true,
    },
    activeOrders: [],
  };

  const trendConfig: TrendStrategyConfig = {
    trendWeight: 1.0,
    exposureWeight: 1.0,
    lookbackSteps: 3,
    minWarmupSteps: 4,
    trendScale: 0.05, // return / 0.05 -> rawTrend ~ 0.73 -> normTrend ~ 0.62
    participationRate: 0.5,
    buyThreshold: 0.25,
    sellThreshold: -0.25,
  };

  const makeAgent = (urgency: number): AgentAccount => ({
    agentId: `trend_agent_${urgency}`,
    accountId: 'acc_trend_test',
    name: 'Trend Test Bot',
    participantType: 'bot',
    strategyType: 'trend',
    riskTolerance: 0.5,
    urgency,
    activityRate: 1.0,
    nextDecisionTime: 0,
    targetPositions: { [STOCK_A_ID]: 1000 },
    maxPosition: 5000,
    maxOrderSize: 1000,
    stats: { ordersSubmitted: 0, ordersCancelled: 0, fillsCount: 0, volumeTraded: 0, feesPaid: 0, realizedPnl: 0 },
  });

  // [1-1] 사용자 보고 사례 직접 재현 및 복원 확인: urgency=0.3, normTrend > 0.6
  console.log('\n  [1-1] 사용자 직접 재현 사례: normTrend > 0.6, urgency=0.3');
  const agent03 = makeAgent(0.3);
  const plan03 = evaluateTrendStrategy(baseObs, agent03, trendConfig, undefined); // 효과 OFF
  console.log(`    -> 결과: ${plan03.price}원 / ${plan03.size}주 / ${plan03.orderType} (사유: ${plan03.reason})`);

  assert(plan03.action === 'buy', '매수 신호 생성');
  assert(
    plan03.price === 9900,
    `긴급도가 0.3(< 0.5)이므로 bestAsk(10,100원)가 아닌 bestBid(9,900원)로 가격 결정 복원됨 (현재: ${plan03.price}원)`
  );
  assert(
    plan03.size === 1000,
    `9,900원 기준 1,000주 전액 매수 수량 복원됨 (현재: ${plan03.size}주)`
  );
  assert(
    plan03.orderType === 'limit',
    `긴급도가 낮으므로 IOC가 아닌 limit 주문으로 정상 복원됨 (현재: ${plan03.orderType})`
  );

  // [1-2] 긴급도 구간별 검증: urgency < 0.2, 0.2 <= urgency < 0.5, urgency >= 0.5
  console.log('\n  [1-2] 긴급도 구간별 주문 유형 및 가격 검증');
  const agent01 = makeAgent(0.1); // < 0.2
  const plan01 = evaluateTrendStrategy(baseObs, agent01, trendConfig, undefined);
  assert(plan01.orderType === 'limit' && plan01.price === 9900, 'urgency=0.1 (< 0.2): 9,900원 limit 주문');

  const agent02 = makeAgent(0.2); // 0.2 <= urgency < 0.5
  const plan02 = evaluateTrendStrategy(baseObs, agent02, trendConfig, undefined);
  assert(plan02.orderType === 'limit' && plan02.price === 9900, 'urgency=0.2 (0.2 <= u < 0.5): 9,900원 limit 주문 (회귀 수정 전 ioc였음)');

  const agent04 = makeAgent(0.4); // 0.2 <= urgency < 0.5
  const plan04 = evaluateTrendStrategy(baseObs, agent04, trendConfig, undefined);
  assert(plan04.orderType === 'limit' && plan04.price === 9900, 'urgency=0.4 (0.2 <= u < 0.5): 9,900원 limit 주문');

  const agent05 = makeAgent(0.5); // >= 0.5
  const plan05 = evaluateTrendStrategy(baseObs, agent05, trendConfig, undefined);
  assert(plan05.orderType === 'ioc' && plan05.price === 10100, 'urgency=0.5 (>= 0.5): 10,100원 bestAsk ioc 주문');

  const agent08 = makeAgent(0.8); // >= 0.5
  const plan08 = evaluateTrendStrategy(baseObs, agent08, trendConfig, undefined);
  assert(plan08.orderType === 'ioc' && plan08.price === 10100, 'urgency=0.8 (>= 0.5): 10,100원 bestAsk ioc 주문');

  // [1-3] bestAsk 존재/부재 처리 검증
  console.log('\n  [1-3] bestAsk 부재(null) 시 fallback 처리 검증');
  const obsNoAsk: MarketObservation = {
    ...baseObs,
    bestAsk: null,
    spread: null,
    hasTwoSidedBook: false,
    asksDepth: [],
  };
  const planNoAskHighUrgency = evaluateTrendStrategy(obsNoAsk, agent08, trendConfig, undefined);
  assert(
    planNoAskHighUrgency.orderType === 'limit',
    'bestAsk가 null이면 높은 긴급도(0.8)여도 IOC가 아닌 limit 주문으로 안전하게 전환됨'
  );
  assert(
    planNoAskHighUrgency.price === 9900,
    `bestAsk가 null이면 bestBid(9,900원)로 가격 fallback됨 (현재: ${planNoAskHighUrgency.price})`
  );

  const obsNoBidNoAsk: MarketObservation = {
    ...obsNoAsk,
    bestBid: null,
    bidsDepth: [],
  };
  const planNoBook = evaluateTrendStrategy(obsNoBidNoAsk, agent08, trendConfig, undefined);
  assert(
    planNoBook.price === 10000,
    `호가창이 완전히 비어있으면 currentPrice(10,000원)로 fallback됨 (현재: ${planNoBook.price})`
  );

  // [1-4] 불확실성 위험 축소 매도 및 신규 진입 제한 보존 확인
  console.log('\n  [1-4] 불확실성 신규 진입 차단 및 위험 축소 매도 허용 로직 보존 확인');
  const highUncertaintyParams: BotEffectParams = {
    ...NEUTRAL_BOT_EFFECT_PARAMS,
    uncertaintyMultiplier: 1.0,
  };

  // 경계 상승 시 높은 불확실성에서 신규 매수 차단
  const mildRisingObs: MarketObservation = {
    ...baseObs,
    priceHistory: [9700, 9700, 9800, 9900, 10000], // normTrend ~ 0.38
  };
  const planUncBuy = evaluateTrendStrategy(mildRisingObs, agent08, trendConfig, highUncertaintyParams);
  assert(
    planUncBuy.action === 'hold' && planUncBuy.reason === 'trend_below_threshold_uncertainty',
    `신규 매수는 높은 불확실성에서 안전하게 차단(HOLD)됨 (${planUncBuy.reason})`
  );

  // 하락 추세에서 기존 보유량 축소 매도는 불확실성이 높아도 정상 매도
  const fallingObs: MarketObservation = {
    ...baseObs,
    priceHistory: [10500, 10400, 10300, 10200, 10000], // 하락 추세
    account: {
      ...baseObs.account,
      holdingQty: 1000,
      availableHolding: 1000,
    },
  };
  const planUncSell = evaluateTrendStrategy(fallingObs, agent03, trendConfig, highUncertaintyParams);
  assert(
    planUncSell.action === 'sell',
    `기존 보유 위험 축소 매도는 높은 불확실성에서도 정상 매도 실행됨 (${planUncSell.action})`
  );
  assert(
    Boolean(planUncSell.reason?.includes('(risk_reduction)')),
    `매도 사유에 risk_reduction 태그 포함됨 (${planUncSell.reason})`
  );
}

// ─────────────────────────────────────────────────────────────────
// [PART 2] 가격 변경을 동반한 LP 교체의 취소 실패 방어 8대 필수 사례 (A ~ H)
// ─────────────────────────────────────────────────────────────────
async function runPart2_LpCancelDefenseTests() {
  console.log('\n================================================================');
  console.log('  [PART 2] LP 취소 실패 방어 8대 필수 사례 검증 (A ~ H)');
  console.log('================================================================');

  const seed = 42;
  const startMs = 1773500000000;
  memoryDb.resetToSeedData();
  const mgr = new AgentManager(seed, startMs, { enableRegimeEngine: true, enableRegimeEffects: true });
  const lpAgent = Array.from(mgr.agents.values()).find((a) => a.participantType === 'lp');
  if (!lpAgent) throw new Error('LP Agent not found');
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

  // 다른 봇 activityRate 0으로 통제
  for (const ag of mgr.agents.values()) {
    if (ag.participantType !== 'lp') ag.activityRate = 0;
  }

  // 기본 LP 설정: 1개 레벨, 200주
  const singleLevelLpConfig: LpStrategyConfig = {
    ...mgr.lpConfig,
    baseLevelSize: 200,
    numLevels: 1,
  };
  mgr.lpConfig = singleLevelLpConfig;

  const stockA = memoryDb.stocks.get(STOCK_A_ID);
  if (stockA) {
    stockA.base_depth_shares = 200;
  }

  // ── [사례 A] 같은 가격에서 1,000주 → 200주 축소, 취소 실패
  console.log('\n  [Case A] 같은 가격에서 1,000주 → 200주 축소, 취소 실패');
  // 1. 기존 1,000주 주문 등록 (가격 71,700)
  const priceA = 71700;
  const ordARes = await LocalMarketService.submitOrder({
    userId: lpAgent.accountId,
    stockId: STOCK_A_ID,
    side: 'buy',
    price: priceA,
    size: 1000,
    isLp: true,
    orderType: 'limit',
    simulationTime: startMs,
    createdAt: new Date(startMs).toISOString(),
  });
  assert(ordARes.success && ordARes.orderId !== undefined, '기존 1,000주 주문 등록 성공');
  const ordAId = ordARes.orderId!;

  const origCancel = LocalMarketService.cancelOrder;
  try {
    // 취소 실패 주입
    LocalMarketService.cancelOrder = async (params) => {
      if (params.orderId === ordAId) {
        return { success: false, statusCode: 500, message: 'Simulated Cancel Failure A' };
      }
      return origCancel.call(LocalMarketService, params);
    };

    await mgr.step(1.0);

    const activeBidsA = Array.from(memoryDb.orders.values()).filter(
      (o) => o.user_id === lpAgent.accountId && o.stock_id === STOCK_A_ID && o.side === 'buy' && (o.status === 'open' || o.status === 'partial')
    );
    const totalBidQtyA = activeBidsA.reduce((sum, o) => sum + (o.size - (o.filled || 0)), 0);

    assert(activeBidsA.length === 1 && activeBidsA[0].id === ordAId, '활성 주문은 기존 1,000주 1개만 존재 (새 200주 주문 미생성)');
    assert(totalBidQtyA === 1000, `총 매수 잔량이 1,200주로 팽창하지 않고 1,000주 유지됨 (현재: ${totalBidQtyA})`);
    assert(mgr.lpDeferrals.has(STOCK_A_ID), 'LP 제출 보류(lpDeferrals)가 진단 맵에 기록됨');
  } finally {
    LocalMarketService.cancelOrder = origCancel;
  }

  // ── [사례 B] 9,800원 1,000주 → 9,900원 200주 가격 변경 교체, 취소 실패
  console.log('\n  [Case B] 9,800원 1,000주 → 9,900원 200주 가격 변경 교체, 취소 실패');
  // 기존 주문 정리
  for (const oId of Array.from(memoryDb.orders.keys())) {
    if (memoryDb.orders.get(oId)?.user_id === lpAgent.accountId) memoryDb.orders.delete(oId);
  }
  mgr.lpDeferrals.clear();

  // 기존 1,000주 주문을 다른 가격(71,000원)에 등록
  const oldPriceB = 71000;
  const ordBRes = await LocalMarketService.submitOrder({
    userId: lpAgent.accountId,
    stockId: STOCK_A_ID,
    side: 'buy',
    price: oldPriceB,
    size: 1000,
    isLp: true,
    orderType: 'limit',
    simulationTime: startMs,
    createdAt: new Date(startMs).toISOString(),
  });
  assert(ordBRes.success && ordBRes.orderId !== undefined, '71,000원 1,000주 기존 주문 등록 성공');
  const ordBId = ordBRes.orderId!;

  try {
    // 71,000원 주문 취소 실패 주입
    LocalMarketService.cancelOrder = async (params) => {
      if (params.orderId === ordBId) {
        return { success: false, statusCode: 500, message: 'Simulated Cancel Failure B' };
      }
      return origCancel.call(LocalMarketService, params);
    };

    await mgr.step(1.0);

    const allActiveBidsB = Array.from(memoryDb.orders.values()).filter(
      (o) => o.user_id === lpAgent.accountId && o.stock_id === STOCK_A_ID && o.side === 'buy' && (o.status === 'open' || o.status === 'partial')
    );
    const totalBidQtyB = allActiveBidsB.reduce((sum, o) => sum + (o.size - (o.filled || 0)), 0);

    assert(allActiveBidsB.length === 1 && allActiveBidsB[0].id === ordBId, '가격이 달라도 신규 대체 주문 제출이 보류되어 71,000원 주문 1개만 유지');
    assert(totalBidQtyB === 1000, `새 가격 주문과 기존 주문이 공존하지 않고 총 잔량 1,000주 유지 (현재: ${totalBidQtyB})`);
    assert(mgr.lpDeferrals.get(STOCK_A_ID)?.reason === 'unresolved_active_cancel_orders', '보류 사유 unresolved_active_cancel_orders 기록 확인');
    assert(mgr.lpDeferrals.get(STOCK_A_ID)?.unresolvedOrderIds.includes(ordBId) === true, '미해결 주문 ID 기록 확인');
  } finally {
    LocalMarketService.cancelOrder = origCancel;
  }

  // ── [사례 C] 다음 스텝에서 취소 성공 후 최신 목표로 재호가
  console.log('\n  [Case C] 다음 스텝에서 취소 성공 후 최신 목표로 재호가');
  // 취소 실패 주입이 해제된 상태에서 다음 스텝 실행
  await mgr.step(1.0);

  const activeBidsAfterSuccess = Array.from(memoryDb.orders.values()).filter(
    (o) => o.user_id === lpAgent.accountId && o.stock_id === STOCK_A_ID && o.side === 'buy' && (o.status === 'open' || o.status === 'partial')
  );
  assert(memoryDb.orders.get(ordBId)?.status === 'cancelled', '기존 주문 정상 취소 확인');
  assert(activeBidsAfterSuccess.length === 1, `정상 취소 후 새로운 호가 1개 등록됨 (${activeBidsAfterSuccess[0].price}원, ${activeBidsAfterSuccess[0].size}주)`);
  assert(activeBidsAfterSuccess[0].size <= 200, '신규 호가 수량이 목표 수량(200주)에 부합함');
  assert(!mgr.lpDeferrals.has(STOCK_A_ID), '정상 호가 완료 후 보류 상태 해제 확인');

  // ── [사례 D] 첫 취소 실패 후 같은 스텝의 재시도 성공
  console.log('\n  [Case D] 첫 취소 실패 후 같은 스텝의 재시도 성공');
  for (const oId of Array.from(memoryDb.orders.keys())) {
    if (memoryDb.orders.get(oId)?.user_id === lpAgent.accountId) memoryDb.orders.delete(oId);
  }
  mgr.lpDeferrals.clear();

  const ordDRes = await LocalMarketService.submitOrder({
    userId: lpAgent.accountId,
    stockId: STOCK_A_ID,
    side: 'buy',
    price: 70000,
    size: 1000,
    isLp: true,
    orderType: 'limit',
    simulationTime: startMs,
    createdAt: new Date(startMs).toISOString(),
  });
  const ordDId = ordDRes.orderId!;

  let attemptCountD = 0;
  try {
    LocalMarketService.cancelOrder = async (params) => {
      if (params.orderId === ordDId) {
        attemptCountD++;
        if (attemptCountD === 1) {
          // 1차 시도 실패
          return { success: false, statusCode: 500, message: 'First attempt failure' };
        }
        // 2차 재시도 성공
        return origCancel.call(LocalMarketService, params);
      }
      return origCancel.call(LocalMarketService, params);
    };

    await mgr.step(1.0);

    assert(attemptCountD >= 2, `1차 실패 후 동일 스텝 내 재시도가 실제로 발생함 (시도 횟수: ${attemptCountD})`);
    assert(memoryDb.orders.get(ordDId)?.status === 'cancelled', '재시도로 기존 주문이 취소 완료됨');
    const activeBidsD = Array.from(memoryDb.orders.values()).filter(
      (o) => o.user_id === lpAgent.accountId && o.stock_id === STOCK_A_ID && o.side === 'buy' && (o.status === 'open' || o.status === 'partial')
    );
    assert(activeBidsD.length === 1 && activeBidsD[0].id !== ordDId, '재시도 성공으로 동일 스텝 내에서 신규 대체 주문이 정상 제출됨');
  } finally {
    LocalMarketService.cancelOrder = origCancel;
  }

  // ── [사례 E] 취소 대기 중 부분체결 및 전량체결
  console.log('\n  [Case E] 취소 대기 중 부분체결 및 전량체결');
  for (const oId of Array.from(memoryDb.orders.keys())) {
    if (memoryDb.orders.get(oId)?.user_id === lpAgent.accountId) memoryDb.orders.delete(oId);
  }
  mgr.lpDeferrals.clear();

  // E-1: 전량체결 시 -> 미해결 주문이 없으므로 신규 호가 정상 제출
  console.log('    [E-1] 취소 대기 중 전량체결: 미해결 잔량 0 -> 신규 제출 정상 허용');
  const ordE1Res = await LocalMarketService.submitOrder({
    userId: lpAgent.accountId,
    stockId: STOCK_A_ID,
    side: 'buy',
    price: 70000,
    size: 100,
    isLp: true,
    orderType: 'limit',
    simulationTime: startMs,
    createdAt: new Date(startMs).toISOString(),
  });
  const ordE1Id = ordE1Res.orderId!;

  try {
    LocalMarketService.cancelOrder = async (params) => {
      if (params.orderId === ordE1Id) {
        // 취소 시도 직전에 테이커 매도로 전량 체결 발생
        const ord = memoryDb.orders.get(ordE1Id)!;
        ord.filled = 100;
        ord.status = 'filled';
        return { success: false, statusCode: 400, message: 'Order already filled' };
      }
      return origCancel.call(LocalMarketService, params);
    };

    await mgr.step(1.0);

    const ordE1 = memoryDb.orders.get(ordE1Id);
    assert(ordE1?.status === 'filled', '주문 상태 filled 확인');
    assert(!mgr.lpDeferrals.has(STOCK_A_ID), '전량 체결되어 잔량이 0이므로 신규 호가가 차단되지 않고 정상 제출됨');
  } finally {
    LocalMarketService.cancelOrder = origCancel;
  }

  // E-2: 부분체결(200체결, 800잔여) 후 취소 실패 -> 800주 잔여가 있으므로 신규 호가 보류
  console.log('    [E-2] 취소 대기 중 부분체결(800주 잔여) 후 취소 실패 -> 신규 호가 안전 보류');
  for (const oId of Array.from(memoryDb.orders.keys())) {
    if (memoryDb.orders.get(oId)?.user_id === lpAgent.accountId) memoryDb.orders.delete(oId);
  }
  mgr.lpDeferrals.clear();

  const ordE2Res = await LocalMarketService.submitOrder({
    userId: lpAgent.accountId,
    stockId: STOCK_A_ID,
    side: 'buy',
    price: 70000,
    size: 1000,
    isLp: true,
    orderType: 'limit',
    simulationTime: startMs,
    createdAt: new Date(startMs).toISOString(),
  });
  const ordE2Id = ordE2Res.orderId!;

  try {
    LocalMarketService.cancelOrder = async (params) => {
      if (params.orderId === ordE2Id) {
        const ord = memoryDb.orders.get(ordE2Id)!;
        ord.filled = 200;
        ord.status = 'partial';
        return { success: false, statusCode: 500, message: 'Partial cancel failure' };
      }
      return origCancel.call(LocalMarketService, params);
    };

    await mgr.step(1.0);

    const ordE2 = memoryDb.orders.get(ordE2Id);
    assert(ordE2?.status === 'partial' && (ordE2.size - (ordE2.filled || 0)) === 800, '800주 잔여 partial 상태 확인');
    assert(mgr.lpDeferrals.has(STOCK_A_ID), '잔여 800주 활성 주문이 남아있으므로 신규 호가 제출이 안전하게 보류됨');
  } finally {
    LocalMarketService.cancelOrder = origCancel;
  }

  // ── [사례 F] 최종 장부 조회 실패 시 신규 제출 보류
  console.log('\n  [Case F] 최종 장부 재조회 실패 시 신규 제출 보류');
  for (const oId of Array.from(memoryDb.orders.keys())) {
    if (memoryDb.orders.get(oId)?.user_id === lpAgent.accountId) memoryDb.orders.delete(oId);
  }
  mgr.lpDeferrals.clear();

  // 종목 A에 취소 대상 주문 1개 등록
  const ordFRes = await LocalMarketService.submitOrder({
    userId: lpAgent.accountId,
    stockId: STOCK_A_ID,
    side: 'buy',
    price: 70000,
    size: 1000,
    isLp: true,
    orderType: 'limit',
    simulationTime: startMs,
    createdAt: new Date(startMs).toISOString(),
  });
  const ordFId = ordFRes.orderId!;

  const savedStockA = memoryDb.stocks.get(STOCK_A_ID);
  try {
    LocalMarketService.cancelOrder = async (params) => {
      // Phase 1 취소 시점에 종목을 일시 제거하여 Phase 2 freshObs 재조회 시 null 반환 유도
      memoryDb.stocks.delete(STOCK_A_ID);
      return origCancel.call(LocalMarketService, params);
    };

    await mgr.step(1.0);

    const activeOrdersF = Array.from(memoryDb.orders.values()).filter(
      (o) => o.user_id === lpAgent.accountId && o.stock_id === STOCK_A_ID && o.id !== ordFId
    );
    assert(activeOrdersF.length === 0, '관측 재조회 실패 시 오래된 계획이 제출되지 않고 신규 제출이 전면 보류됨');
    assert(mgr.lpDeferrals.get(STOCK_A_ID)?.reason === 'fresh_observation_failed', 'fresh_observation_failed 보류 사유 기록 확인');
  } finally {
    if (savedStockA) memoryDb.stocks.set(STOCK_A_ID, savedStockA);
    LocalMarketService.cancelOrder = origCancel;
  }

  // ── [사례 G] 다른 종목의 정상 LP 처리는 지속
  console.log('\n  [Case G] 종목 A 보류 시에도 종목 B 정상 LP 처리 지속');
  for (const oId of Array.from(memoryDb.orders.keys())) {
    if (memoryDb.orders.get(oId)?.user_id === lpAgent.accountId) memoryDb.orders.delete(oId);
  }
  mgr.lpDeferrals.clear();

  // 종목 A에 취소 실패할 주문 등록
  const ordGRes = await LocalMarketService.submitOrder({
    userId: lpAgent.accountId,
    stockId: STOCK_A_ID,
    side: 'buy',
    price: 70000,
    size: 1000,
    isLp: true,
    orderType: 'limit',
    simulationTime: startMs,
    createdAt: new Date(startMs).toISOString(),
  });
  const ordGId = ordGRes.orderId!;

  try {
    LocalMarketService.cancelOrder = async (params) => {
      if (params.orderId === ordGId) {
        return { success: false, statusCode: 500, message: 'Stock A cancel failure' };
      }
      return origCancel.call(LocalMarketService, params);
    };

    await mgr.step(1.0);

    assert(mgr.lpDeferrals.has(STOCK_A_ID), '종목 A는 취소 실패로 인해 보류됨');
    assert(!mgr.lpDeferrals.has(STOCK_B_ID), '종목 B는 보류되지 않음');

    const activeBidsB = Array.from(memoryDb.orders.values()).filter(
      (o) => o.user_id === lpAgent.accountId && o.stock_id === STOCK_B_ID && (o.status === 'open' || o.status === 'partial')
    );
    assert(activeBidsB.length > 0, `종목 B에는 정상적으로 LP 호가가 제출됨 (활성 주문: ${activeBidsB.length}개)`);
  } finally {
    LocalMarketService.cancelOrder = origCancel;
  }

  // ── [사례 H] 예산 부족 상태에서 유지 가능한 주문의 ID·시간 우선순위 보존
  console.log('\n  [Case H] 예산 부족 상태에서 유지 가능한 주문의 ID 및 시간 우선순위 다중 스텝 보존');
  memoryDb.resetToSeedData();
  const mgrH = new AgentManager(seed, startMs, { enableRegimeEngine: true, enableRegimeEffects: true });
  const lpH = Array.from(mgrH.agents.values()).find((a) => a.participantType === 'lp')!;
  for (const ag of mgrH.agents.values()) {
    if (ag.participantType !== 'lp') ag.activityRate = 0;
  }
  mgrH.lpConfig = singleLevelLpConfig;
  const stockAH = memoryDb.stocks.get(STOCK_A_ID);
  if (stockAH) stockAH.base_depth_shares = 200;

  // Step 1 실행하여 정상 호가 생성
  await mgrH.step(1.0);
  const activeBidsH = Array.from(memoryDb.orders.values()).filter(
    (o) => o.user_id === lpH.accountId && o.stock_id === STOCK_A_ID && o.side === 'buy' && (o.status === 'open' || o.status === 'partial')
  );
  assert(activeBidsH.length === 1, '정상 호가 생성 확인');
  const restingPriceH = activeBidsH[0].price;

  // 기존 호가 정리 후, 정확히 100주 매수 가능한 자금만 입금하여 100주 주문 등록
  for (const [oId, ord] of memoryDb.orders.entries()) {
    if (ord.user_id === lpH.accountId) memoryDb.orders.delete(oId);
  }
  const exactCostH = Math.ceil(100 * restingPriceH * 1.0025);
  const lpProfH = memoryDb.profiles.get(lpH.accountId);
  if (lpProfH) lpProfH.cash = exactCostH;

  const ordHRes = await LocalMarketService.submitOrder({
    userId: lpH.accountId,
    stockId: STOCK_A_ID,
    side: 'buy',
    price: restingPriceH,
    size: 100,
    isLp: true,
    orderType: 'limit',
    simulationTime: mgrH.clock.simulationTime,
    createdAt: new Date(mgrH.clock.simulationTime).toISOString(),
  });
  assert(ordHRes.success, `Case H: 100주 지속 가능 주문 등록 성공 (가격: ${restingPriceH})`);
  const ordHId = ordHRes.orderId!;

  // 3스텝 연속 실행하여 주문 ID 및 시간 우선순위 보존 확인
  for (let s = 1; s <= 3; s++) {
    await mgrH.step(1.0);
    const ordH = memoryDb.orders.get(ordHId);
    assert(ordH !== undefined && (ordH.status === 'open' || ordH.status === 'partial'), `스텝 ${s}: 주문 ID ${ordHId} 유지 (status: ${ordH?.status})`);
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  STOCKSYS 최신 코드 리뷰 수정 종합 검증 스위트 (v2)           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  await runPart1_TrendBuyRegressionTests();
  await runPart2_LpCancelDefenseTests();

  console.log('\n================================================================');
  console.log('  🎉 ALL STAGE 2 REVIEW V2 VERIFICATION TESTS PASSED (EXIT 0)');
  console.log('================================================================\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED WITH ERROR:', err);
  process.exit(1);
});
