import { evaluateLpStrategy, LpQuotePlan } from '../lib/engine/simulation/strategies/lpStrategy';
import { MarketObservation, buildMarketObservation } from '../lib/engine/simulation/marketObservation';
import { AgentAccount, LpStrategyConfig } from '../lib/engine/simulation/agentTypes';
import { OrderRecord, TradeRecord, memoryDb } from '../lib/memoryDb/memoryStore';
import { NEUTRAL_LP_EFFECT_PARAMS, LpEffectParams } from '../lib/engine/simulation/regime/regimeEffects';
import { LocalMarketService } from '../lib/engine/marketService';

const startMs = 1773500000000;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

function makeOrder(overrides: Partial<OrderRecord>): OrderRecord {
  return {
    id: overrides.id ?? 'ord_mock',
    stock_id: 'MOCK',
    user_id: 'acc_lp_main',
    side: 'buy',
    price: 9900,
    size: 100,
    filled: 0,
    status: 'open',
    is_lp: true,
    created_at: new Date(startMs).toISOString(),
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
    recentTrades: [],
    priceHistory: [10000, 10000, 10000, 10000, 10000, 10000],
    returns: [0, 0, 0, 0, 0],
    volatility: 0.0,
    isWarmup: false,
    simulationTime: startMs,
    attentionScore: 0.5,
    uncertaintyScore: 0.0,
    recentEvents: [],
    effectiveEvents: [],
    structural: {
      sharesOutstanding: 100000000,
      floatingShares: 50000000,
      sectorId: 'general',
      themeIds: [],
      baseLiquidity: 0.5,
      baseSpreadBps: 200, // 200 bps = 2.0% -> spread 200 (bid 9900, ask 10100)
      baseDepthShares: 1000, // 구조적 기본 깊이 1000주!
      institutionalFit: 0.5,
      macroExposure: {},
    },
    account: {
      cash: 992_475, // 100주 매수 분량 (100 * 9900 * 1.0025 = 992,475)
      holdingQty: 100, // 100주 매도 분량
      avgPrice: 10000,
      reservedCash: 0,
      reservedHolding: 0,
      availableCash: 992_475,
      availableHolding: 100,
    },
    activeOrders: [],
    ...overrides,
  };
}

const lpAgent: AgentAccount = {
  accountId: 'acc_lp_main',
  agentId: 'agent_lp_01',
  participantType: 'lp',
  strategyType: 'market_maker',
  name: '유동성공급자(LP)',
  targetPositions: {},
  maxOrderSize: 5000,
  maxPosition: 30000,
  riskTolerance: 0.5,
  urgency: 0.1,
  activityRate: 1.0,
  infoLatency: 0,
  evaluationsPerStep: 20,
  sectorPreferences: {},
  nextDecisionTime: 0,
  stats: { ordersSubmitted: 0, ordersCancelled: 0, fillsCount: 0, volumeTraded: 0, feesPaid: 0, realizedPnl: 0 },
};

const lpConfig: LpStrategyConfig = {
  targetInventory: 100, // 현재 재고와 일치하여 inventory skew 0
  inventoryLimit: 15000,
  numLevels: 1, // 1개 레벨 집중 테스트
  baseSpreadBps: 200, // spread 200 -> bestBid 9900, bestAsk 10100
  volatilityAlpha: 0.0,
  inventoryRiskBeta: 0.0,
  inventorySkewKappa: 0.0,
  quoteLifetimeSteps: 5,
  baseLevelSize: 1000, // 구조적 1000주
};

const lpEffectParamsOn: LpEffectParams = {
  lpSpreadMultiplier: 1.0,
  lpDepthMultiplier: 1.0,
  uncertaintyMultiplier: 1.0,
  enforceDepthTarget: true,
};

async function runStage2Verification() {
  console.log('================================================================');
  console.log('  🧪 STAGE 2 VERIFICATION (LP Budget, Retention, Multi-Step)');
  console.log('================================================================\n');

  // ─────────────────────────────────────────────────────────────────
  // TEST 1: 목표 1000주 대비 예산 100주 조건에서 연속 스텝 실행 시
  //         주문 ID 유지 및 불필요한 반복 취소 방지 검증
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 1] 예산 100주 제약 하 연속 스텝 주문 ID 유지 (Churn 0)');
  {
    // Step 0: 초기 주문 생성
    const obs0 = makeObservation({});
    const plan0 = evaluateLpStrategy(obs0, lpAgent, lpConfig, lpEffectParamsOn);

    assert(plan0.cancels.length === 0, 'Step 0: 초기 취소 0건');
    const newBid = plan0.newOrders.find((o) => o.side === 'buy');
    assert(newBid !== undefined && newBid.size === 100, `Step 0: 예산 제약(100주)으로 100주 신규 매수 호가 생성 (실제: ${newBid?.size})`);

    // 주문이 등록된 상태를 모의: 주문 ID 'ord_lp_bid_step1'
    const restingBidOrder = makeOrder({
      id: 'ord_lp_bid_step1',
      price: newBid!.price,
      size: 100,
      filled: 0,
      side: 'buy',
    });

    // Step 1: 동일 가격·자산 상태에서 다음 스텝 평가
    // activeOrders에 기존 주문 포함, availableCash는 주문 예약으로 0원
    const obs1 = makeObservation({
      activeOrders: [restingBidOrder],
      account: {
        cash: 992_475,
        holdingQty: 100,
        avgPrice: 10000,
        reservedCash: 992_475, // 예약금 100% 잠김
        reservedHolding: 0,
        availableCash: 0,       // 가용 현금 0
        availableHolding: 100,
      },
    });

    const plan1 = evaluateLpStrategy(obs1, lpAgent, lpConfig, lpEffectParamsOn);
    assert(plan1.cancels.length === 0, 'Step 1: 취소 0건! (기존 100주 주문 유지)');
    assert(!plan1.newOrders.some((o) => o.side === 'buy'), 'Step 1: 불필요한 신규 매수 호가 생성 없음');

    // Step 2, Step 3, Step 4 반복 시뮬레이션
    let churnCount = 0;
    for (let step = 2; step <= 5; step++) {
      const planN = evaluateLpStrategy(obs1, lpAgent, lpConfig, lpEffectParamsOn);
      if (planN.cancels.some((o) => o.id === 'ord_lp_bid_step1')) {
        churnCount++;
      }
    }
    assert(churnCount === 0, `Step 2~5 반복 시 주문 ID 유지, 취소 발생 횟수 0건 (실제 churn: ${churnCount})`);
    console.log('  ✓ TEST 1 통과: 구조적 목표(1000) vs 예산 목표(100) 분리로 주문 유지 및 Churn 0 확인\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 2: 매도 측(Ask) 보유량 부족 시에도 동일하게 유지 검증
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 2] 매도 호가 보유량 부족 시 지속 가능 목표 유지');
  {
    // Step 0에서 산출된 호가 가격과 일치하는 매도 주문 모의
    const obs0 = makeObservation({});
    const plan0 = evaluateLpStrategy(obs0, lpAgent, lpConfig, lpEffectParamsOn);
    const targetAskPrice = plan0.newOrders.find((o) => o.side === 'sell')?.price ?? 10020;

    const restingAskOrder = makeOrder({
      id: 'ord_lp_ask_step1',
      price: targetAskPrice,
      size: 100,
      filled: 0,
      side: 'sell',
    });

    // holdingQty = 100, reservedHolding = 100 -> availableHolding = 0
    const obsAsk = makeObservation({
      activeOrders: [restingAskOrder],
      account: {
        cash: 10_000_000,
        holdingQty: 100,
        avgPrice: 10000,
        reservedCash: 0,
        reservedHolding: 100, // 전량 예약됨
        availableCash: 10_000_000,
        availableHolding: 0, // 매도 가능 주수 0
      },
    });

    const planAsk = evaluateLpStrategy(obsAsk, lpAgent, lpConfig, lpEffectParamsOn);
    assert(!planAsk.cancels.some((o) => o.id === 'ord_lp_ask_step1'), '매도 호가 보유량 부족 시 기존 주문 유지 (취소 없음)');
    assert(!planAsk.newOrders.some((o) => o.side === 'sell'), '매도 호가 신규 중복 주문 생성 없음');
    console.log('  ✓ TEST 2 통과: 매도 가능 수량 부족 조건에서도 주문 ID 유지 확인\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 3: 부분 체결 후 추가 예산 없을 때 불필요한 재호가 방지
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 3] 부분체결 후 보충 자산 부족 시 불필요한 취소 방지');
  {
    // 원래 100주 주문 중 10주가 부분체결되어 잔량이 90주인 상태
    // 추가 가용 현금 0원 (보충 불가)
    const partialOrder = makeOrder({
      id: 'ord_partial_90',
      price: 9900,
      size: 100,
      filled: 10,
      status: 'partial',
      side: 'buy',
    });

    const obsPartialNoCash = makeObservation({
      activeOrders: [partialOrder],
      account: {
        cash: 900_000,
        holdingQty: 10,
        avgPrice: 9900,
        reservedCash: 900_000,
        reservedHolding: 0,
        availableCash: 0, // 보충 자산 없음!
        availableHolding: 10,
      },
    });

    const planPartial = evaluateLpStrategy(obsPartialNoCash, lpAgent, lpConfig, lpEffectParamsOn);
    assert(!planPartial.cancels.some((o) => o.id === 'ord_partial_90'), '보충 자산이 없을 때 부분체결 주문(90주) 유지 (불필요한 취소 방지)');
    assert(!planPartial.newOrders.some((o) => o.side === 'buy'), '매수 측 신규 주문 없음 (보충 불가로 기존 90주 유지)');
    console.log('  ✓ TEST 3 통과: 부분체결 후 보충 불가능 시 기존 잔량 유지 확인\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 4: 국면 변경으로 목표 깊이 축소 시 적법한 취소·재호가
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 4] 국면 변경(깊이 배수 축소) 시 적법한 취소·재호가');
  {
    // 기존에 1000주 호가가 걸려있음
    const resting1000 = makeOrder({
      id: 'ord_deep_1000',
      price: 9900,
      size: 1000,
      filled: 0,
      side: 'buy',
    });

    const obs1000 = makeObservation({
      activeOrders: [resting1000],
      account: {
        cash: 100_000_000,
        holdingQty: 1000,
        avgPrice: 10000,
        reservedCash: 1000 * 9900 * 1.0025,
        reservedHolding: 0,
        availableCash: 50_000_000,
        availableHolding: 1000,
      },
    });

    // 위기 국면 등으로 lpDepthMultiplier = 0.2로 축소 (목표 깊이 200주)
    const planShrink = evaluateLpStrategy(obs1000, lpAgent, lpConfig, {
      ...lpEffectParamsOn,
      lpDepthMultiplier: 0.2,
    });

    assert(planShrink.cancels.some((o) => o.id === 'ord_deep_1000'), '목표 깊이 축소(1000->200) 시 기존 과잉 호가 취소 대상 선정');
    console.log('  ✓ TEST 4 통과: 국면 깊이 축소 시 정상적인 취소 대상 선정 확인\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 5: 가격 변경 시 적법한 취소·재호가
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 5] 가격 변경(미드 가격 이동) 시 적법한 취소·재호가');
  {
    // 기존 호가 가격 9900
    const restingOldPrice = makeOrder({
      id: 'ord_old_price',
      price: 9900,
      size: 100,
      filled: 0,
      side: 'buy',
    });

    // 미드 가격이 10000 -> 12000으로 상승하여 새로운 호가 가격이 11900이 된 관측
    const obsPriceMoved = makeObservation({
      midPrice: 12000,
      bestBid: 11900,
      bestAsk: 12100,
      activeOrders: [restingOldPrice],
    });

    const planPriceMoved = evaluateLpStrategy(obsPriceMoved, lpAgent, lpConfig, lpEffectParamsOn);
    assert(planPriceMoved.cancels.some((o) => o.id === 'ord_old_price'), '가격이 변동된 기존 호가는 취소 대상');
    assert(planPriceMoved.newOrders.some((o) => o.side === 'buy' && o.price !== 9900), '새로운 가격의 신규 호가 산출');
    console.log('  ✓ TEST 5 통과: 가격 변동 시 적법한 취소·재호가 확인\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 6: 효과 OFF의 기존 LP 동작 보존
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 6] 효과 OFF 시 기존 LP 호가 유지 동작 100% 보존');
  {
    const restingOff = makeOrder({
      id: 'ord_off_test',
      price: 9900,
      size: 100,
      filled: 0,
      side: 'buy',
    });
    const obsOff = makeObservation({
      activeOrders: [restingOff],
    });

    const planOff = evaluateLpStrategy(obsOff, lpAgent, lpConfig); // effects undefined
    assert(!planOff.cancels.some((o) => o.id === 'ord_off_test'), '효과 OFF: 가격 일치 시 기존 주문 무조건 유지');
    console.log('  ✓ TEST 6 통과: 효과 OFF 시 기존 LP 동작 100% 보존 확인\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 7: 다단계 호가 총 예약 자산의 계좌 한도 비초과 검증
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 7] 다단계 호가 총 자산 배정 한도 검증 (No Double Allocation)');
  {
    const multiLevelConfig: LpStrategyConfig = {
      ...lpConfig,
      numLevels: 5,
    };
    const totalCash = 1_000_000;
    const obsMulti = makeObservation({
      account: {
        cash: totalCash,
        holdingQty: 50,
        avgPrice: 10000,
        reservedCash: 0,
        reservedHolding: 0,
        availableCash: totalCash,
        availableHolding: 50,
      },
    });

    const planMulti = evaluateLpStrategy(obsMulti, lpAgent, multiLevelConfig, lpEffectParamsOn);
    let totalBidNotional = 0;
    for (const b of planMulti.newOrders.filter((o) => o.side === 'buy')) {
      totalBidNotional += b.price * b.size * 1.0025;
    }
    assert(totalBidNotional <= totalCash, `모든 레벨 매수 주문 총액(${totalBidNotional.toFixed(0)}) <= 가용 현금(${totalCash})`);

    let totalAskShares = 0;
    for (const a of planMulti.newOrders.filter((o) => o.side === 'sell')) {
      totalAskShares += a.size;
    }
    assert(totalAskShares <= 50, `모든 레벨 매도 주문 총 수량(${totalAskShares}) <= 가용 주식(50)`);
    console.log('  ✓ TEST 7 통과: 복수 호가 레벨 자산 중복 배정 없음 및 한도 엄격 준수\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 8: 취소 실패 시 예약금 보존 및 타 사용자 주문 배제
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 8] 취소 실패 시 예약금 보존 및 타 사용자 주문 배제');
  {
    // 1. 타 사용자 주문 배제
    const otherUserOrd = makeOrder({
      id: 'ord_user_other_123',
      user_id: 'acc_other_user',
      is_lp: false,
      price: 9900,
      size: 500,
    });
    const obsWithOther = makeObservation({
      activeOrders: [otherUserOrd],
    });
    const planOther = evaluateLpStrategy(obsWithOther, lpAgent, lpConfig, lpEffectParamsOn);
    assert(!planOther.cancels.some((o) => o.id === 'ord_user_other_123'), '타 사용자 주문은 LP 취소 대상에 일체 포함되지 않음');

    // 2. 취소 실패 시 자산 보존: memoryDb를 통한 단일 권위 상태 검증
    memoryDb.resetToSeedData();
    const stock = Array.from(memoryDb.stocks.values())[0];
    const accountId = 'acc_lp_main';
    const profile = memoryDb.profiles.get(accountId);
    const initialCash = profile ? Number(profile.cash) : 10_000_000;

    // LP 주문 1건 등록
    const submitRes = await LocalMarketService.submitOrder({
      userId: accountId,
      stockId: stock.id,
      side: 'buy',
      price: 10000,
      size: 100,
      isLp: true,
      orderType: 'limit',
      simulationTime: startMs,
      createdAt: new Date(startMs).toISOString(),
      sequence: 1,
      participantType: 'lp',
      accountId: accountId,
      agentId: 'agent_lp_01',
    });
    assert(submitRes.success && !!submitRes.orderId, 'LP 주문 제출 및 예약 성공');

    // 관측 조회: 100주에 대한 현금이 예약되어 availableCash 감소
    const obsAfterSubmit = buildMarketObservation(stock.id, accountId, startMs);
    assert(obsAfterSubmit !== null, '관측 생성 성공');
    const reservedExpected = 100 * 10000; // calculateReservedCash는 remainingQty * price
    assert(
      obsAfterSubmit!.account.reservedCash === reservedExpected,
      `주문 예약금 정확히 반영 (${obsAfterSubmit!.account.reservedCash} === ${reservedExpected})`
    );

    // 존재하지 않는 주문 또는 실패한 취소 시도
    const failedCancelRes = await LocalMarketService.cancelOrder({
      orderId: 'non_existent_order_id',
      userId: accountId,
    });
    assert(!failedCancelRes.success, '존재하지 않는 주문 취소는 실패');

    // 취소 실패 후 최신 관측 재조회: 예약 자산이 전혀 해제되지 않고 보존됨 확인
    const obsAfterFailedCancel = buildMarketObservation(stock.id, accountId, startMs);
    assert(
      obsAfterFailedCancel!.account.reservedCash === reservedExpected,
      '취소 실패 후에도 예약금은 해제되지 않고 엄격히 보존됨'
    );
    assert(
      obsAfterFailedCancel!.account.availableCash === initialCash - reservedExpected,
      '취소 실패 후 가용 현금이 잘못 증가하지 않음'
    );
    console.log('  ✓ TEST 8 통과: 취소 실패 시 예약금 보존 및 타 사용자 주문 배제 확인\n');
  }

  console.log('================================================================');
  console.log('  🎉 STAGE 2 VERIFICATION TESTS ALL PASSED (EXIT CODE 0)');
  console.log('================================================================\n');
  process.exit(0);
}

runStage2Verification().catch((err) => {
  console.error('\n❌ STAGE 2 TEST ERROR:', err);
  process.exit(1);
});
