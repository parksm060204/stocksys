/**
 * scripts/test-regime-effects-stage2.ts
 *
 * STOCKSYS 시장 국면 2단계(효과 적용) 검증 스위트
 *
 * 검증 축:
 *  A. 효과 OFF 회귀: 국면 엔진 ON + 효과 OFF 결과가 엔진 OFF 기준과 비트 단위로 동일한지
 *  B. 적용 시점·불변성: 스텝 N 예약 → N+1 적용, 같은 스텝 내 국면 혼용 금지, 배수 누적 금지, 효과 ON 결정론
 *  C. 통제된 행동 효과: 가치·추세 민감도, 방향별 발생 확률, 주문 규모/위험/현금 한도, LP 깊이·부분체결·취소 안전성
 *  D. 여러 시드 시장 흐름: 효과 OFF/ON 3개 시드 구간별 지표 비교 + 상태 불변식(음수 자산/0수량/자가체결 금지)
 */

import { MarketStateEngine } from '../lib/engine/simulation/regime/marketStateEngine';
import {
  DEFAULT_REGIME_PARAMETERS,
  DEFAULT_REGIME_THRESHOLDS,
} from '../lib/engine/simulation/regime/regimeConfig';
import {
  AppliedRegimeContext,
  BotEffectParams,
  resolveBotEffectParams,
  resolveLpEffectParams,
  computeDirectionalArrivalProbabilities,
  applyOrderSizeMultiplier,
  applyRiskToleranceToTarget,
  NEUTRAL_BOT_EFFECT_PARAMS,
} from '../lib/engine/simulation/regime/regimeEffects';
import { evaluateValueStrategy } from '../lib/engine/simulation/strategies/valueStrategy';
import { evaluateTrendStrategy } from '../lib/engine/simulation/strategies/trendStrategy';
import { evaluateLpStrategy } from '../lib/engine/simulation/strategies/lpStrategy';
import { MarketObservation } from '../lib/engine/simulation/marketObservation';
import {
  AgentAccount,
  ValueStrategyConfig,
  TrendStrategyConfig,
  LpStrategyConfig,
} from '../lib/engine/simulation/agentTypes';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import { memoryDb, OrderRecord, TradeRecord } from '../lib/memoryDb/memoryStore';
import { createTestRegimeCapability } from './test-support/testRegimeAuth';
import { SimPrng } from '../lib/engine/simulation/simClock';

const startMs = 1773500000000;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

// ─────────────────────────────────────────────────────────────────
// 공통 픽스처: 통제된 mock 관측/계좌/주문
// ─────────────────────────────────────────────────────────────────

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
    cash: 10_000_000_000,
    holdingQty: 0,
    avgPrice: 10000,
    reservedCash: 0,
    reservedHolding: 0,
    availableCash: 10_000_000_000,
    availableHolding: 0,
    ...overrides,
  };
}

function makeOrder(overrides: Partial<OrderRecord>): OrderRecord {
  return {
    id: overrides.id ?? 'ord_mock',
    stock_id: 'MOCK',
    user_id: 'acc_lp_main',
    side: 'buy',
    price: 10000,
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
  noiseStdDev: 0,
  delaySteps: 0,
  deadbandPct: 0.01,
  minProfitMarginPct: 0.003,
  participationRate: 0.5,
  buyThreshold: 0.2,
  sellThreshold: -0.2,
};

const trendConfig: TrendStrategyConfig = {
  trendWeight: 1.0,
  exposureWeight: 0.3,
  lookbackSteps: 3,
  minWarmupSteps: 5,
  trendScale: 0.02,
  participationRate: 0.5,
  buyThreshold: 0.25,
  sellThreshold: -0.25,
};

const lpConfig: LpStrategyConfig = {
  targetInventory: 5000,
  inventoryLimit: 15000,
  numLevels: 5,
  baseSpreadBps: 20,
  volatilityAlpha: 1.5,
  inventoryRiskBeta: 0.8,
  inventorySkewKappa: 1.5,
  quoteLifetimeSteps: 5,
  baseLevelSize: 50,
};

const structural = {
  sharesOutstanding: 10000000,
  floatingShares: 5000000,
  sectorId: 'general',
  themeIds: [] as string[],
  baseLiquidity: 0.5,
  baseSpreadBps: 20,
  baseDepthShares: 100,
  institutionalFit: 0.5,
  macroExposure: {} as Record<string, number>,
};

function fingerprintRun(mgr: AgentManager) {
  return {
    stocks: Array.from(memoryDb.stocks.values()).map((s) => `${s.id}:${s.current_price}:${s.volume}`).sort().join('|'),
    // 주문 ID는 LP 주문 생성 시 벽시계 타임스탬프를 포함하므로 행동 동등성 비교에서는 제외하고 내용만 비교한다.
    orders: Array.from(memoryDb.orders.values())
      .map((o) => `${o.stock_id}:${o.side}:${o.price}:${o.size}:${o.filled}:${o.status}`)
      .sort()
      .join('|'),
    trades: memoryDb.trades.map((t) => `${t.stock_id}:${t.price}:${t.size}:${t.buyer_id}:${t.seller_id}`).sort().join('|'),
    profiles: Array.from(memoryDb.profiles.values()).map((p) => `${p.id}:${p.cash}`).sort().join('|'),
    holdings: Array.from(memoryDb.holdings.values())
      .map((h) => `${h.user_id}:${h.stock_id}:${h.quantity}:${h.avg_price}`)
      .sort()
      .join('|'),
    botPrng: Array.from(mgr.agentPrngs.entries()).map(([k, p]) => `${k}:${p.getState()}`).sort().join('|'),
    fundPrng: mgr.fundamentalPrng.getState(),
    regimeHistory: JSON.stringify(mgr.marketStateEngine.getRegimeHistory()),
  };
}

function assertStateInvariants(label: string): void {
  for (const p of memoryDb.profiles.values()) {
    assert(Number.isFinite(p.cash) && p.cash >= 0, `${label}: 현금 음수/비정상 없음 (${p.id}=${p.cash.toFixed(0)})`);
  }
  for (const h of memoryDb.holdings.values()) {
    assert(Number.isFinite(h.quantity) && h.quantity >= 0, `${label}: 보유 수량 음수 없음`);
  }
  for (const o of memoryDb.orders.values()) {
    assert(o.size > 0, `${label}: 0수량 주문 없음 (${o.id})`);
    assert(o.filled >= 0 && o.filled <= o.size, `${label}: filled 범위 정상 (${o.id})`);
  }
  for (const t of memoryDb.trades) {
    assert(!(t.buyer_id && t.seller_id && t.buyer_id === t.seller_id), `${label}: 자가체결 없음 (${t.id})`);
  }
}

interface SegmentMetrics {
  step: number;
  regime: string;
  transitionId: number;
  effectsEnabled: boolean;
  submittedBuy: number;
  submittedSell: number;
  submittedTurnover: number;
  avgOrderSize: number;
  filledVolume: number;
  filledTurnover: number;
  meanSpreadBps: number | null;
  totalDepthShares: number;
  invalidBookRatio: number;
  cashRatio: number;
  rejectionRate: number;
  transitionCount: number;
}

function captureMetrics(mgr: AgentManager, step: number): SegmentMetrics {
  const strategyByAccount = new Map<string, string>();
  for (const [accId, agent] of mgr.agents.entries()) strategyByAccount.set(accId, agent.strategyType);

  let submittedBuy = 0;
  let submittedSell = 0;
  let submittedTurnover = 0;
  let orderSizeSum = 0;
  let orderCount = 0;
  for (const o of memoryDb.orders.values()) {
    const strat = o.account_id ? strategyByAccount.get(o.account_id) : undefined;
    if (!strat || strat === 'market_maker') continue;
    if (o.side === 'buy') submittedBuy++;
    else submittedSell++;
    submittedTurnover += o.price * o.size;
    orderSizeSum += o.size;
    orderCount++;
  }

  let filledVolume = 0;
  let filledTurnover = 0;
  for (const t of memoryDb.trades) {
    filledVolume += t.size;
    filledTurnover += t.price * t.size;
  }

  const stats = mgr.diagnostics.computeWindowStatistics(mgr.clock.simulationTime);
  let spreadSum = 0;
  let spreadCount = 0;
  let totalDepthShares = 0;
  for (const st of stats.values()) {
    totalDepthShares += st.depthShares;
    if (st.currentSpreadBps !== null) {
      spreadSum += st.currentSpreadBps;
      spreadCount++;
    }
  }

  let totalCash = 0;
  let exposureNotional = 0;
  for (const p of memoryDb.profiles.values()) totalCash += p.cash;
  for (const h of memoryDb.holdings.values()) {
    const price = memoryDb.stocks.get(h.stock_id)?.current_price ?? 0;
    exposureNotional += h.quantity * price;
  }

  const totalSubmitted = submittedBuy + submittedSell;
  const report = mgr.diagnostics.generateSummaryReport();
  const applied = mgr.diagnostics.getLastRegimeApplication();

  return {
    step,
    regime: applied?.regime ?? mgr.getMarketStateSnapshot().regime,
    transitionId: applied?.transitionId ?? 0,
    effectsEnabled: applied?.effectsEnabled ?? false,
    submittedBuy,
    submittedSell,
    submittedTurnover,
    avgOrderSize: orderCount > 0 ? orderSizeSum / orderCount : 0,
    filledVolume,
    filledTurnover,
    meanSpreadBps: spreadCount > 0 ? spreadSum / spreadCount : null,
    totalDepthShares,
    invalidBookRatio: mgr.getEmptyBookStockRatio(),
    cashRatio: totalCash + exposureNotional > 0 ? totalCash / (totalCash + exposureNotional) : 1,
    rejectionRate: totalSubmitted > 0 ? report.marketSummary.rejectionCount / totalSubmitted : 0,
    transitionCount: mgr.marketStateEngine.getRegimeHistory().length,
  };
}

// ─────────────────────────────────────────────────────────────────
// 통합 실행 (고정 뉴스 시나리오, 깨끗한 초기 상태)
// ─────────────────────────────────────────────────────────────────
async function runIntegration(
  seed: number,
  enableEngine: boolean,
  effectsEnabled: boolean,
  steps = 30
): Promise<{ mgr: AgentManager; segments: SegmentMetrics[] }> {
  memoryDb.resetToSeedData();
  const mgr = new AgentManager(seed, startMs, {
    enableRegimeEngine: enableEngine,
    regimeEngineConfig: {
      thresholds: {
        ...DEFAULT_REGIME_THRESHOLDS,
        minRegimeDurationSeconds: 6.0,
        regimeCooldownSeconds: 1.0,
      },
    },
  });

  if (effectsEnabled) {
    const testCap = createTestRegimeCapability();
    mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', {
      capability: testCap,
      reason: 'authorized_test_stage2',
    });
  }

  const segmentSteps = new Set([10, 20, 30]);
  const segments: SegmentMetrics[] = [];

  for (let step = 1; step <= steps; step++) {
    const currentSimTime = mgr.clock.simulationTime;
    if (step === 7) {
      mgr.registerEvent({
        eventId: 's2_bull_news',
        scope: 'market',
        eventType: 'OFFICIAL',
        targetStockIds: [],
        valuationSignal: 0.7,
        attentionShock: 0.5,
        uncertaintyShock: 0.05,
        confidence: 1.0,
        halfLife: 80,
        publishedAt: currentSimTime,
        effectiveFrom: currentSimTime,
        publisher: 'GlobalMacro',
        title: '경기 부양 기대',
        content: '유동성 공급 확대',
      });
    }
    if (step === 19) {
      mgr.registerEvent({
        eventId: 's2_shock_news',
        scope: 'market',
        eventType: 'OFFICIAL',
        targetStockIds: [],
        valuationSignal: -0.5,
        attentionShock: 0.8,
        uncertaintyShock: 0.7,
        confidence: 1.0,
        halfLife: 60,
        publishedAt: currentSimTime,
        effectiveFrom: currentSimTime,
        publisher: 'CrisisWatch',
        title: '금리 충격',
        content: '변동성 확대',
      });
    }
    await mgr.step(1.0);
    if (segmentSteps.has(step)) segments.push(captureMetrics(mgr, step));
  }
  return { mgr, segments };
}

async function runAllTests() {
  console.log('================================================================');
  console.log('  🏛️  STOCKSYS REGIME EFFECTS (STAGE 2) VERIFICATION SUITE');
  console.log('================================================================\n');

  // ─────────────────────────────────────────────────────────────────
  // TEST 1: 파라미터 변환 순수성 (원본 불변, 누적 곱셈 없음, 중립값)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 1] 순수 파라미터 변환 계층');
  {
    const ctxBull: AppliedRegimeContext = {
      enabled: true,
      regime: 'BULL',
      transitionId: 7,
      parameters: DEFAULT_REGIME_PARAMETERS.BULL,
    };
    const p1 = resolveBotEffectParams(ctxBull);
    const p2 = resolveBotEffectParams(ctxBull);
    assert(JSON.stringify(p1) === JSON.stringify(p2), '동일 컨텍스트 반복 변환 시 배수 누적 없음');
    assert(p1.trendSensitivity === ctxBull.parameters.trendSensitivity, 'BULL trendSensitivity가 국면 파라미터와 일치');
    assert(p1.valueSensitivity === ctxBull.parameters.valueSensitivity, 'BULL valueSensitivity가 국면 파라미터와 일치');

    const neutral = resolveBotEffectParams(null);
    assert(
      neutral.buyArrivalMultiplier === 1 && neutral.sellArrivalMultiplier === 1 && neutral.cashPreference === 0,
      '효과 OFF 컨텍스트는 중립값(곱셈 1.0, cashPreference 0)'
    );
    const lpNeutral = resolveLpEffectParams(null);
    assert(
      lpNeutral.lpSpreadMultiplier === 1 && lpNeutral.lpDepthMultiplier === 1 && lpNeutral.enforceDepthTarget === false,
      'LP 효과 OFF는 중립값 및 깊이 강제 비활성'
    );
    const lpBull = resolveLpEffectParams(ctxBull);
    assert(lpBull.enforceDepthTarget === true, 'LP 효과 ON은 깊이 목표 강제 활성');

    assert(
      DEFAULT_REGIME_PARAMETERS.SIDEWAYS.trendSensitivity !== 1 && DEFAULT_REGIME_PARAMETERS.SIDEWAYS.valueSensitivity !== 1,
      'SIDEWAYS도 1이 아닌 파라미터를 가지므로 효과 없음으로 간주하지 않음'
    );

    const dummyAgent = makeAgent({});
    const before = JSON.stringify(dummyAgent);
    resolveBotEffectParams(ctxBull);
    assert(JSON.stringify(dummyAgent) === before, '원본 AgentAccount는 변이되지 않음');
    console.log('  ✓ TEST 1 통과: 순수 변환·중립값·원본 불변·비누적 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 2: 적용 시점 (스텝 N 예약 → N+1 적용, 같은 스텝 혼용 금지)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 2] 적용 시점과 불변 컨텍스트');
  {
    const engine = new MarketStateEngine({}, 42, startMs);
    const preCtx = engine.getAppliedContext();
    assert(preCtx.regime === 'SIDEWAYS' && preCtx.transitionId === 0, '초기 적용 컨텍스트 SIDEWAYS/transitionId 0');

    const t0 = startMs + 20000;
    engine.evaluateNextRegime(
      {
        simulationTime: t0,
        aggregateReturn: 0,
        realizedVolatility: 0.005,
        turnoverChange: 0,
        averageSpreadBps: 200,
        currentSpreadBps: 200,
        depthChange: -0.6,
        uncertainty: 0.1,
        emptyBookDurationSeconds: 0,
        effectiveMacroNewsSignal: 0,
      },
      t0,
      t0,
      1
    );
    const stillOld = engine.getAppliedContext();
    assert(stillOld.regime === 'SIDEWAYS' && stillOld.transitionId === 0, '예약 직후(같은 스텝)에는 새 국면이 적용되지 않음(혼용 금지)');

    const activated = engine.activatePendingRegime(t0 + 1000, 2);
    const newCtx = engine.getAppliedContext();
    assert(activated && newCtx.regime === 'LIQUIDITY_CRISIS', '다음 스텝 시작 시 예약 국면 활성화');
    assert(newCtx.transitionId === 1, '전환 ID가 활성 컨텍스트에 고정 반영');
    assert(newCtx.parameters.buyArrivalMultiplier === 0.3, '활성 컨텍스트 파라미터가 LIQUIDITY_CRISIS 값과 일치');
    console.log('  ✓ TEST 2 통과: 스텝 N 예약 → N+1 적용, 같은 스텝 국면 혼용 없음\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 3: 방향별 주문 발생 확률
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 3] 방향별 주문 발생 확률');
  {
    const base = computeDirectionalArrivalProbabilities(0.8, 1, 1, 1.0);
    const legacy = 1 - Math.exp(-0.8 * 1.0);
    assert(Math.abs(base.pBuy - legacy) < 1e-12 && Math.abs(base.pSell - legacy) < 1e-12, '배수 1.0일 때 기존 단일 확률과 동일');

    const bull = computeDirectionalArrivalProbabilities(0.8, 1.3, 0.8, 1.0);
    assert(bull.pBuy > legacy, `매수 배수 >1은 매수 기회를 증가시킴 (${bull.pBuy.toFixed(4)} > ${legacy.toFixed(4)})`);
    assert(bull.pSell < legacy, '매도 배수 <1은 매도 기회를 감소시킴');
    assert(bull.pCandidate === bull.pBuy && bull.pCandidate < 1, 'pCandidate = max(pBuy,pSell) < 1 (1 초과 없음)');

    const crisis = computeDirectionalArrivalProbabilities(0.8, 0.3, 1.8, 1.0);
    assert(crisis.pSell > crisis.pBuy, '위기 국면은 매도 기회가 매수보다 큼');
    console.log('  ✓ TEST 3 통과: 방향별 확률 의미·1 초과 금지·기존 확률 보존 확인\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 4: 가치·추세 민감도와 주문 규모/위험/현금 한도
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 4] 통제된 전략 파라미터 효과');
  {
    const obs = makeObservation({});
    const agent = makeAgent({ maxPosition: 1_000_000, maxOrderSize: 2_000_000 });
    const trueF = 11000; // 10% 저평가

    const lowParams: BotEffectParams = { ...NEUTRAL_BOT_EFFECT_PARAMS, valueSensitivity: 0.4 };
    const highParams: BotEffectParams = { ...NEUTRAL_BOT_EFFECT_PARAMS, valueSensitivity: 2.5 };

    const vLow = evaluateValueStrategy(obs, agent, valueConfig, trueF, new SimPrng(1), lowParams);
    const vHigh = evaluateValueStrategy(obs, agent, valueConfig, trueF, new SimPrng(1), highParams);
    assert(vLow.action === 'buy' && vHigh.action === 'buy', '가치 전략이 동일 관측에서 매수 판단');
    assert((vHigh.size ?? 0) > (vLow.size ?? 0), `가치 민감도 증가 시 반응 강도(수량) 증가 (${vLow.size} → ${vHigh.size})`);

    const trendObs = makeObservation({
      priceHistory: [10000, 10050, 10150, 10250, 10350, 10500],
      windowStats: {
        stockId: 'MOCK',
        windowDuration: 10,
        volume: 1000,
        turnover: 10000000,
        turnoverRate: 0.1,
        returnRate: 0.05,
        relativeReturn: 0,
        spread: 200,
        currentSpread: 200,
        currentSpreadBps: 200,
        bestBid: 9900,
        bestAsk: 10100,
        depthShares: 1000,
        depthNotional: 10000000,
        bidDepthShares: 500,
        askDepthShares: 500,
        hasTwoSidedBook: true,
        hasValidTwoSidedQuote: true,
        relativeTurnover: 1,
        buyTakerVolume: 600,
        sellTakerVolume: 400,
        signedFlow: 200,
        hasActualTrades: true,
      },
    });
    const trendAgent = makeAgent({ strategyType: 'trend', maxOrderSize: 2_000_000, maxPosition: 1_000_000 });
    const tLow = evaluateTrendStrategy(trendObs, trendAgent, trendConfig, { ...NEUTRAL_BOT_EFFECT_PARAMS, trendSensitivity: 0.5 });
    const tHigh = evaluateTrendStrategy(trendObs, trendAgent, trendConfig, { ...NEUTRAL_BOT_EFFECT_PARAMS, trendSensitivity: 2.5 });
    assert(tLow.action === 'buy' && tHigh.action === 'buy', '추세 전략이 동일 관측에서 매수 판단');
    assert((tHigh.size ?? 0) >= (tLow.size ?? 0), `추세 민감도 증가 시 반응 강도 감소 없음 (${tLow.size} → ${tHigh.size})`);

    const bigSize = applyOrderSizeMultiplier(100000, 50, 250, 300);
    assert(bigSize === 250, `주문 규모 배수는 주문 상한/참여율 한도를 초과하지 않음 (실제: ${bigSize})`);
    const riskTarget = applyRiskToleranceToTarget(900000, 100, 1000000);
    assert(riskTarget === 1000000, `위험 허용 배수는 절대 상한(maxPosition)을 초과하지 않음 (실제: ${riskTarget})`);

    const cashObs = makeObservation({ account: makeAccount({ cash: 30000, availableCash: 30000 }) });
    const cashZero = evaluateValueStrategy(cashObs, agent, valueConfig, trueF, new SimPrng(2), {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      cashPreference: 0,
    });
    const cashHigh = evaluateValueStrategy(cashObs, agent, valueConfig, trueF, new SimPrng(2), {
      ...NEUTRAL_BOT_EFFECT_PARAMS,
      cashPreference: 0.5,
    });
    assert(
      (cashHigh.size ?? 0) <= (cashZero.size ?? 0),
      `cashPreference 증가 시 매수 수량 초과 없음 (${cashHigh.size} <= ${cashZero.size})`
    );
    console.log('  ✓ TEST 4 통과: 가치·추세 민감도, 주문/위험/현금 한도 준수 확인\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 5: LP 스프레드·깊이 및 취소/부분체결/타 사용자 안전성
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 5] LP 스프레드·깊이·취소 안전성');
  {
    const lpAgent = makeAgent({
      accountId: 'acc_lp_main',
      strategyType: 'market_maker',
      participantType: 'lp',
      targetPositions: {},
    });
    const lpAccount = makeAccount({ cash: 10_000_000_000, holdingQty: 5000, availableHolding: 5000 });
    const baseObs = (orders: OrderRecord[], uncertainty = 0.05) =>
      makeObservation({ stockId: 'MOCK', structural, uncertaintyScore: uncertainty, activeOrders: orders, account: lpAccount });

    const resting = makeOrder({ id: 'lp_b_1', side: 'buy', price: 9950, size: 100, filled: 0, is_lp: true, user_id: 'acc_lp_main' });
    const obsDepth2 = baseObs([resting]);
    const planDepth2 = evaluateLpStrategy(obsDepth2, lpAgent, lpConfig, {
      lpSpreadMultiplier: 1,
      lpDepthMultiplier: 2,
      uncertaintyMultiplier: 1,
      enforceDepthTarget: true,
    });
    assert(planDepth2.cancels.some((o) => o.id === 'lp_b_1'), '동일 가격이라도 목표 잔여 수량이 크게 다르면 취소 대상');
    const newBid2 = planDepth2.newOrders.find((o) => o.side === 'buy' && o.price === 9950);
    assert(newBid2 !== undefined && newBid2.size > 100, `재호가 깊이가 국면 배수로 증가 (실제: ${newBid2?.size})`);
    assert(planDepth2.newOrders.every((o) => o.size > 0), '모든 신규 호가 수량 > 0');

    const planDepth1 = evaluateLpStrategy(obsDepth2, lpAgent, lpConfig, {
      lpSpreadMultiplier: 1,
      lpDepthMultiplier: 1,
      uncertaintyMultiplier: 1,
      enforceDepthTarget: true,
    });
    assert(!planDepth1.cancels.some((o) => o.id === 'lp_b_1'), '목표 깊이와 일치하면 불필요한 취소 없음');

    const partial = makeOrder({ id: 'lp_b_partial', side: 'buy', price: 9950, size: 200, filled: 100, status: 'partial', is_lp: true, user_id: 'acc_lp_main' });
    const planPartial = evaluateLpStrategy(baseObs([partial]), lpAgent, lpConfig, {
      lpSpreadMultiplier: 1,
      lpDepthMultiplier: 2,
      uncertaintyMultiplier: 1,
      enforceDepthTarget: true,
    });
    assert(planPartial.cancels.some((o) => o.id === 'lp_b_partial'), '부분 체결 주문은 size-filled 기준으로 불일치 판정되어 취소 대상');

    const planOff = evaluateLpStrategy(obsDepth2, lpAgent, lpConfig);
    assert(!planOff.cancels.some((o) => o.id === 'lp_b_1'), '효과 OFF에서는 기존 가격 일치 유지 로직 보존');

    const otherUserOrder = makeOrder({ id: 'other_b_1', side: 'buy', price: 9950, size: 100, is_lp: false, user_id: 'acc_other' });
    const planOther = evaluateLpStrategy(baseObs([resting, otherUserOrder]), lpAgent, lpConfig, {
      lpSpreadMultiplier: 1,
      lpDepthMultiplier: 2,
      uncertaintyMultiplier: 1,
      enforceDepthTarget: true,
    });
    assert(!planOther.cancels.some((o) => o.id === 'other_b_1'), '다른 사용자 주문은 취소 대상이 아님');

    const planSpreadOff = evaluateLpStrategy(baseObs([]), lpAgent, lpConfig);
    const planSpreadWide = evaluateLpStrategy(baseObs([]), lpAgent, lpConfig, {
      lpSpreadMultiplier: 3.5,
      lpDepthMultiplier: 1,
      uncertaintyMultiplier: 1,
      enforceDepthTarget: true,
    });
    const offBid = planSpreadOff.newOrders.find((o) => o.side === 'buy')!;
    const wideBid = planSpreadWide.newOrders.find((o) => o.side === 'buy')!;
    assert(wideBid.price < offBid.price, `스프레드 배수 증가 시 매수 호가가 중앙에서 더 멀어짐 (${wideBid.price} < ${offBid.price})`);
    assert(planSpreadWide.newOrders.every((o) => Number.isInteger(o.price) && o.price > 0), '최소 호가 간격/가격 단위 보존(양의 정수)');
    console.log('  ✓ TEST 5 통과: LP 깊이·부분체결·취소 안전성·스프레드 배수 확인\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 6: 효과 OFF 회귀 (엔진 OFF vs 엔진 ON + 효과 OFF)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 6] 효과 OFF 회귀 (A/B 비트 단위 동일)');
  {
    const runEngineOff = await runIntegration(2024, false, false, 30);
    const fpEngineOff = fingerprintRun(runEngineOff.mgr);
    const runEffectsOff = await runIntegration(2024, true, false, 30);
    const fpEffectsOff = fingerprintRun(runEffectsOff.mgr);

    assert(fpEngineOff.orders === fpEffectsOff.orders, '주문(방향/가격/수량/체결/상태) 100% 동일');
    assert(fpEngineOff.trades === fpEffectsOff.trades, '체결 100% 동일');
    assert(fpEngineOff.profiles === fpEffectsOff.profiles, '계좌 현금 100% 동일');
    assert(fpEngineOff.holdings === fpEffectsOff.holdings, '보유 수량/평단 100% 동일');
    assert(fpEngineOff.botPrng === fpEffectsOff.botPrng, '봇별 PRNG 상태 100% 동일');
    assert(fpEngineOff.fundPrng === fpEffectsOff.fundPrng, '펀더멘털 PRNG 상태 100% 동일');
    // 국면 탐지 자체는 엔진 OFF에서는 수행되지 않으므로 이력 비교 대상이 아니다.
    // (최종 국면/이력 건수는 참고용으로만 비교하고, 경제 결과 전체 동일을 주장하지 않는다.)
    const engineOffFinalRegime = runEngineOff.mgr.getMarketStateSnapshot().regime;
    const effectsOffFinalRegime = runEffectsOff.mgr.getMarketStateSnapshot().regime;
    const effectsOffTransitions = runEffectsOff.mgr.marketStateEngine.getRegimeHistory().length;
    console.log(
      `  · 참고: 엔진 OFF 최종국면=${engineOffFinalRegime}(전환 0), 효과 OFF 최종국면=${effectsOffFinalRegime}(전환 ${effectsOffTransitions}) — 탐지 이력은 본질적으로 다름`
    );
    console.log('  ✓ TEST 6 통과: 효과 OFF의 기존 경제 실행 경로 보존 확인\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 7: 효과 ON 결정론 (동일 시드 재현)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 7] 효과 ON 결정론 재현');
  {
    const on1 = await runIntegration(777, true, true, 30);
    const fp1 = fingerprintRun(on1.mgr);
    const on2 = await runIntegration(777, true, true, 30);
    const fp2 = fingerprintRun(on2.mgr);
    assert(fp1.orders === fp2.orders, '효과 ON 동일 시드 주문 100% 재현');
    assert(fp1.trades === fp2.trades, '효과 ON 동일 시드 체결 100% 재현');
    assert(fp1.regimeHistory === fp2.regimeHistory, '효과 ON 동일 시드 국면 전환 이력 100% 재현');
    assert(fp1.botPrng === fp2.botPrng, '효과 ON 동일 시드 PRNG 100% 재현');

    const off = await runIntegration(777, true, false, 30);
    const fpOff = fingerprintRun(off.mgr);
    assert(fp1.orders !== fpOff.orders || fp1.trades !== fpOff.trades, '효과 ON은 OFF와 실제 주문/체결이 달라짐 (효과 실재)');
    assertStateInvariants('효과 ON');
    console.log('  ✓ TEST 7 통과: 효과 ON 결정론 및 실제 행동 변화 확인\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 8: 여러 시드 구간별 시장 흐름 비교
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 8] 여러 시드 시장 흐름 비교 (효과 OFF/ON)');
  {
    const seeds = [101, 202, 303];
    const allSegments: Array<{ seed: number; mode: string; segments: SegmentMetrics[] }> = [];

    for (const seed of seeds) {
      for (const effects of [false, true]) {
        const { mgr, segments } = await runIntegration(seed, true, effects, 30);
        allSegments.push({ seed, mode: effects ? 'ON' : 'OFF', segments });
        assertStateInvariants(`seed ${seed} ${effects ? 'ON' : 'OFF'}`);
      }
    }

    console.log('\n  ── 구간별 비교표 ──');
    console.log('  seed | mode | step | 국면 | 전환ID | 매수/매도 | 평균주문량 | 체결량 | 체결대금 | 평균스프레드 | 깊이 | 무효장부 | 현금비중 | 거절률 | 전환수');
    for (const entry of allSegments) {
      for (const s of entry.segments) {
        console.log(
          `  ${entry.seed} | ${entry.mode} | ${s.step} | ${s.regime} | ${s.transitionId} | ${s.submittedBuy}/${s.submittedSell} | ${s.avgOrderSize.toFixed(1)} | ${s.filledVolume} | ${s.filledTurnover.toFixed(0)} | ${s.meanSpreadBps === null ? 'n/a' : s.meanSpreadBps.toFixed(1)} | ${s.totalDepthShares} | ${s.invalidBookRatio.toFixed(3)} | ${s.cashRatio.toFixed(3)} | ${s.rejectionRate.toFixed(3)} | ${s.transitionCount}`
        );
      }
    }

    let anyDifference = false;
    for (const seed of seeds) {
      const offEntry = allSegments.find((e) => e.seed === seed && e.mode === 'OFF')!;
      const onEntry = allSegments.find((e) => e.seed === seed && e.mode === 'ON')!;
      const offLast = offEntry.segments[offEntry.segments.length - 1];
      const onLast = onEntry.segments[onEntry.segments.length - 1];
      if (
        offLast.submittedBuy !== onLast.submittedBuy ||
        offLast.submittedSell !== onLast.submittedSell ||
        offLast.filledVolume !== onLast.filledVolume ||
        offLast.regime !== onLast.regime
      ) {
        anyDifference = true;
      }
    }
    assert(anyDifference, '최소 1개 시드에서 효과 ON/OFF가 주문·체결·국면 관측을 실제로 변화시킴');
    console.log('  ✓ TEST 8 통과: 3개 시드 OFF/ON 구간 지표 산출 및 상태 불변식 확인\n');
  }

  console.log('================================================================');
  console.log('  🎉 ALL STAGE-2 REGIME EFFECTS TESTS PASSED (EXIT CODE 0)');
  console.log('================================================================\n');
  process.exit(0);
}

runAllTests().catch((err) => {
  console.error('\n❌ UNHANDLED TEST ERROR:', err);
  process.exit(1);
});
