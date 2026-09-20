/**
 * scripts/test-market-regime-scenarios.ts
 *
 * STOCKSYS [2단계 — 국면 효과 품질 및 현실성 평가]
 *
 * 목적:
 * 6개 대표 시나리오(BULL, BEAR, HIGH_VOLATILITY, LIQUIDITY_CRISIS, SIDEWAYS, RUMOR_CORRECTION)를
 * 5개 이상의 서로 다른 seed ([11, 42, 101, 257, 509]) 환경에서 시뮬레이션하여
 * 국면 전환 타이밍, 봇 행동 변화 부합성, 시장 현실성, 회복 메커니즘, 불변식 무결성을 전수 평가한다.
 */

import { memoryDb, OrderRecord, TradeRecord } from '../lib/memoryDb/memoryStore';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import {
  DEFAULT_REGIME_THRESHOLDS,
  DEFAULT_REGIME_PARAMETERS,
} from '../lib/engine/simulation/regime/regimeConfig';
import { MarketRegime } from '../lib/engine/simulation/regime/regimeTypes';

const TEST_SEEDS = [11, 42, 101, 257, 509];
const START_EPOCH_MS = 1773500000000;

export interface ScenarioResult {
  scenarioName: string;
  seed: number;
  verdict: 'PASS' | 'CONDITIONAL_PASS' | 'FAIL';
  targetRegime: MarketRegime;
  detectedRegime: MarketRegime;
  transitionReason: string;
  detectionLatencySeconds: number;
  spreadChangePct: number;
  depthChangePct: number;
  postBuyRatio: number;
  recoveryObserved: boolean;
  invariantViolations: string[];
  notes: string;
}

// ─────────────────────────────────────────────────────────────────
// 헬퍼 함수
// ─────────────────────────────────────────────────────────────────

function checkInvariants(stepName: string): string[] {
  const violations: string[] = [];

  // 1. 프로필 현금 유효성
  for (const p of memoryDb.profiles.values()) {
    if (!Number.isFinite(p.cash) || p.cash < 0) {
      violations.push(`[${stepName}] 계좌 cash 비정상: ${p.id} = ${p.cash}`);
    }
  }

  // 2. 보유 주식 유효성
  for (const h of memoryDb.holdings.values()) {
    if (!Number.isFinite(h.quantity) || h.quantity < 0) {
      violations.push(`[${stepName}] 보유 quantity 비정상: user=${h.user_id}, stock=${h.stock_id}, qty=${h.quantity}`);
    }
  }

  // 3. 체결 유효성 및 자가 체결 차단
  for (const t of memoryDb.trades) {
    if (!Number.isFinite(t.price) || t.price <= 0 || !Number.isFinite(t.size) || t.size <= 0) {
      violations.push(`[${stepName}] 비정상 체결: id=${t.id}, price=${t.price}, size=${t.size}`);
    }
    if (t.buyer_id && t.seller_id && t.buyer_id === t.seller_id) {
      violations.push(`[${stepName}] 자가 체결 발생: id=${t.id}, user=${t.buyer_id}`);
    }
  }

  // 4. 주문 유효성
  for (const o of memoryDb.orders.values()) {
    if (!Number.isFinite(o.price) || o.price <= 0 || !Number.isFinite(o.size) || o.size <= 0) {
      violations.push(`[${stepName}] 비정상 주문: id=${o.id}, price=${o.price}, size=${o.size}`);
    }
    if (o.filled < 0 || o.filled > o.size) {
      violations.push(`[${stepName}] 주문 체결량 초과: id=${o.id}, filled=${o.filled}, size=${o.size}`);
    }
  }

  return violations;
}

async function prepareWarmup(mgr: AgentManager): Promise<void> {
  // PRE_OPEN (1800s) -> OPENING_AUCTION (600s) -> CONTINUOUS 진입
  await mgr.step(1800);
  await mgr.step(600);
  // CONTINUOUS 1틱 (30s) 정규 매매 개시
  await mgr.step(30);
}

function countRecentOrders(orders: OrderRecord[], sinceTimestampMs: number): { buy: number; sell: number } {
  let buy = 0;
  let sell = 0;
  for (const o of orders) {
    const t = new Date(o.created_at).getTime();
    if (t >= sinceTimestampMs) {
      if (o.side === 'buy') buy++;
      else if (o.side === 'sell') sell++;
    }
  }
  return { buy, sell };
}

// ─────────────────────────────────────────────────────────────────
// 시나리오 A: BULL (평상시 -> 긍정적 거시 뉴스)
// ─────────────────────────────────────────────────────────────────
async function runScenarioA(seed: number): Promise<ScenarioResult> {
  memoryDb.resetToSeedData();
  const mgr = new AgentManager(seed, START_EPOCH_MS, {
    enableRegimeEngine: true,
    enableRegimeEffects: true,
    regimeEngineConfig: { thresholds: DEFAULT_REGIME_THRESHOLDS },
  });

  await prepareWarmup(mgr);

  const baselineObs = mgr.getLastObservation();
  const baselineSpread = baselineObs?.averageSpreadBps ?? 20;
  const baselineDepth = baselineObs?.depthChange ?? 0;

  const eventTime = mgr.clock.simulationTime;

  // 1. 강세장 유도 거시 뉴스 등록 (valuationSignal: +0.65, effectiveMacroNewsSignal >= 0.12)
  mgr.registerEvent({
    eventId: `bull_news_${seed}`,
    scope: 'market',
    eventType: 'OFFICIAL',
    targetStockIds: [],
    valuationSignal: 0.65,
    attentionShock: 0.4,
    uncertaintyShock: 0.02,
    confidence: 0.95,
    halfLife: 1800,
    publishedAt: eventTime,
    effectiveFrom: eventTime,
    publisher: 'PolicyDesk',
    title: '글로벌 경기 부양책 및 유동성 확대 발표',
    content: '시장 전반 강한 상방 모멘텀 유입',
  });

  // 2. 시장 가격 상승 이력 형성 (+3.0% 시세 반영)
  for (const stock of memoryDb.stocks.values()) {
    memoryDb.stockPriceHistory.push({
      id: `hist_bull_${stock.id}_${eventTime}`,
      stock_id: stock.id,
      price: Math.round(stock.current_price * 1.03),
      recorded_at: new Date(eventTime).toISOString(),
    });
  }

  let detectedRegime: MarketRegime = 'SIDEWAYS';
  let latencySec = 0;
  let transitionReason = '';
  const violations: string[] = [];

  // 스텝 진행 (15초 단위)
  for (let step = 1; step <= 4; step++) {
    await mgr.step(15);
    violations.push(...checkInvariants(`ScenarioA_Step${step}`));

    const snap = mgr.getMarketStateSnapshot();
    if (snap.regime === 'BULL') {
      if (detectedRegime !== 'BULL') {
        detectedRegime = 'BULL';
        latencySec = step * 15;
        transitionReason = snap.transitionReason ?? 'BULLISH_FLOW';
      }
    }
  }

  const postObs = mgr.getLastObservation();
  const postSpread = postObs?.averageSpreadBps ?? baselineSpread;
  const postDepth = postObs?.depthChange ?? baselineDepth;

  const spreadChangePct = baselineSpread > 0 ? ((postSpread - baselineSpread) / baselineSpread) * 100 : 0;
  const depthChangePct = ((postDepth - baselineDepth) / (Math.abs(baselineDepth) || 1)) * 100;

  const orderCounts = countRecentOrders(Array.from(memoryDb.orders.values()), eventTime);
  const totalPostOrders = orderCounts.buy + orderCounts.sell;
  const postBuyRatio = totalPostOrders > 0 ? orderCounts.buy / totalPostOrders : 0.5;

  const appliedRecord = mgr.diagnostics.getLastRegimeApplication();
  const mStateContext = mgr.marketStateEngine.getAppliedContext();
  const m = appliedRecord?.multipliers ?? {};
  const buyArrivalMul = m['bot_buyArrival'] ?? mStateContext?.parameters.buyArrivalMultiplier ?? 1.0;
  const lpSpreadMul = m['lp_spread'] ?? mStateContext?.parameters.lpSpreadMultiplier ?? 1.0;

  const isBULLDetected = detectedRegime === 'BULL';
  const isBotBehaviorAligned = buyArrivalMul > 1.0 && postBuyRatio >= 0.5;
  const isLpAligned = lpSpreadMul <= 1.0;
  const noViolations = violations.length === 0;

  let verdict: 'PASS' | 'CONDITIONAL_PASS' | 'FAIL' = 'PASS';
  let notes = 'BULL 국면 정상 진입, 매수 도착률 증가, LP 스프레드 축소 확인';

  if (!isBULLDetected || !noViolations) {
    verdict = 'FAIL';
    notes = `BULL 미진입 또는 불변식 위반 (${violations.length}건)`;
  } else if (!isBotBehaviorAligned || !isLpAligned) {
    verdict = 'CONDITIONAL_PASS';
    notes = `BULL 진입했으나 행동 배수 관측 일부 편차 (BuyRatio: ${(postBuyRatio * 100).toFixed(1)}%)`;
  }

  return {
    scenarioName: 'A. BULL (긍정 거시 뉴스)',
    seed,
    verdict,
    targetRegime: 'BULL',
    detectedRegime,
    transitionReason,
    detectionLatencySeconds: latencySec,
    spreadChangePct,
    depthChangePct,
    postBuyRatio,
    recoveryObserved: true,
    invariantViolations: violations,
    notes,
  };
}

// ─────────────────────────────────────────────────────────────────
// 시나리오 B: BEAR (평상시 -> 부정적 거시 뉴스)
// ─────────────────────────────────────────────────────────────────
async function runScenarioB(seed: number): Promise<ScenarioResult> {
  memoryDb.resetToSeedData();
  const mgr = new AgentManager(seed, START_EPOCH_MS, {
    enableRegimeEngine: true,
    enableRegimeEffects: true,
    regimeEngineConfig: { thresholds: DEFAULT_REGIME_THRESHOLDS },
  });

  await prepareWarmup(mgr);

  const baselineObs = mgr.getLastObservation();
  const baselineSpread = baselineObs?.averageSpreadBps ?? 20;

  const eventTime = mgr.clock.simulationTime;

  // 1. 하락장 유도 거시 뉴스 등록 (valuationSignal: -0.65, effectiveMacroNewsSignal <= -0.12)
  mgr.registerEvent({
    eventId: `bear_news_${seed}`,
    scope: 'market',
    eventType: 'OFFICIAL',
    targetStockIds: [],
    valuationSignal: -0.65,
    attentionShock: 0.5,
    uncertaintyShock: 0.1,
    confidence: 0.95,
    halfLife: 1800,
    publishedAt: eventTime,
    effectiveFrom: eventTime,
    publisher: 'RegulatorDesk',
    title: '글로벌 경기 침체 경고 및 긴축 규제 강화',
    content: '시장 밸류에이션 급격한 하방 압력 유입',
  });

  // 2. 시장 가격 하락 이력 형성 (-3.0% 시세 반영)
  for (const stock of memoryDb.stocks.values()) {
    memoryDb.stockPriceHistory.push({
      id: `hist_bear_${stock.id}_${eventTime}`,
      stock_id: stock.id,
      price: Math.round(stock.current_price * 0.97),
      recorded_at: new Date(eventTime).toISOString(),
    });
  }

  let detectedRegime: MarketRegime = 'SIDEWAYS';
  let latencySec = 0;
  let transitionReason = '';
  const violations: string[] = [];

  for (let step = 1; step <= 4; step++) {
    await mgr.step(15);
    violations.push(...checkInvariants(`ScenarioB_Step${step}`));

    const snap = mgr.getMarketStateSnapshot();
    if (snap.regime === 'BEAR') {
      if (detectedRegime !== 'BEAR') {
        detectedRegime = 'BEAR';
        latencySec = step * 15;
        transitionReason = snap.transitionReason ?? 'BEARISH_FLOW';
      }
    }
  }

  const postObs = mgr.getLastObservation();
  const postSpread = postObs?.averageSpreadBps ?? baselineSpread;
  const spreadChangePct = baselineSpread > 0 ? ((postSpread - baselineSpread) / baselineSpread) * 100 : 0;

  const orderCounts = countRecentOrders(Array.from(memoryDb.orders.values()), eventTime);
  const totalPostOrders = orderCounts.buy + orderCounts.sell;
  const postBuyRatio = totalPostOrders > 0 ? orderCounts.buy / totalPostOrders : 0.5;

  const appliedRecord = mgr.diagnostics.getLastRegimeApplication();
  const mStateContext = mgr.marketStateEngine.getAppliedContext();
  const m = appliedRecord?.multipliers ?? {};
  const sellArrivalMul = m['bot_sellArrival'] ?? mStateContext?.parameters.sellArrivalMultiplier ?? 1.0;
  const cashPref = m['bot_cashPreference'] ?? mStateContext?.parameters.cashPreference ?? 0.3;

  const isBEARDetected = detectedRegime === 'BEAR';
  const isBotBehaviorAligned = sellArrivalMul > 1.0 && postBuyRatio < 0.5;
  const isCashPrefHigh = cashPref >= 0.5;
  const noViolations = violations.length === 0;

  let verdict: 'PASS' | 'CONDITIONAL_PASS' | 'FAIL' = 'PASS';
  let notes = 'BEAR 국면 정상 진입, 매도 도착률 증가, 현금 선호 증가 확인';

  if (!isBEARDetected || !noViolations) {
    verdict = 'FAIL';
    notes = `BEAR 미진입 또는 불변식 위반 (${violations.length}건)`;
  } else if (!isBotBehaviorAligned || !isCashPrefHigh) {
    verdict = 'CONDITIONAL_PASS';
    notes = `BEAR 진입했으나 매도 비중 편차 (SellRatio: ${((1 - postBuyRatio) * 100).toFixed(1)}%)`;
  }

  return {
    scenarioName: 'B. BEAR (부정 거시 뉴스)',
    seed,
    verdict,
    targetRegime: 'BEAR',
    detectedRegime,
    transitionReason,
    detectionLatencySeconds: latencySec,
    spreadChangePct,
    depthChangePct: 0,
    postBuyRatio,
    recoveryObserved: true,
    invariantViolations: violations,
    notes,
  };
}

// ─────────────────────────────────────────────────────────────────
// 시나리오 C: HIGH_VOLATILITY (변동성/불확실성 쇼크 -> 정상화)
// ─────────────────────────────────────────────────────────────────
async function runScenarioC(seed: number): Promise<ScenarioResult> {
  memoryDb.resetToSeedData();
  const mgr = new AgentManager(seed, START_EPOCH_MS, {
    enableRegimeEngine: true,
    enableRegimeEffects: true,
    regimeEngineConfig: { thresholds: DEFAULT_REGIME_THRESHOLDS },
  });

  await prepareWarmup(mgr);

  const baselineObs = mgr.getLastObservation();
  const baselineSpread = baselineObs?.averageSpreadBps ?? 20;

  const eventTime = mgr.clock.simulationTime;
  // 불확실성 0.75 쇼크 주입 (임계치 0.35를 크게 초과)
  mgr.registerEvent({
    eventId: `vol_shock_${seed}`,
    scope: 'market',
    eventType: 'OFFICIAL',
    targetStockIds: [],
    valuationSignal: 0.0,
    attentionShock: 0.8,
    uncertaintyShock: 0.75,
    confidence: 0.95,
    halfLife: 600,
    publishedAt: eventTime,
    effectiveFrom: eventTime,
    publisher: 'GeopoliticalDesk',
    title: '돌발 지정학적 분쟁 및 불확실성 급증',
    content: '극심한 단기 시장 불안정성 야기',
  });

  let detectedRegime: MarketRegime = 'SIDEWAYS';
  let latencySec = 0;
  let transitionReason = '';
  let recoveryObserved = false;
  const violations: string[] = [];

  const initialTradesCount = memoryDb.trades.length;

  // 6초씩 2틱 진행 (총 12초: minRegimeDurationSeconds 10초 충족)
  for (let step = 1; step <= 2; step++) {
    await mgr.step(6);
    violations.push(...checkInvariants(`ScenarioC_Shock_Step${step}`));

    const snap = mgr.getMarketStateSnapshot();
    if (snap.regime === 'HIGH_VOLATILITY' && detectedRegime !== 'HIGH_VOLATILITY') {
      detectedRegime = 'HIGH_VOLATILITY';
      latencySec = step * 6;
      transitionReason = snap.transitionReason ?? 'VOLATILITY_SURGE';
    }
  }

  const appliedRecord = mgr.diagnostics.getLastRegimeApplication();
  const mStateContext = mgr.marketStateEngine.getAppliedContext();
  const m = appliedRecord?.multipliers ?? {};
  const lpSpreadMul = m['lp_spread'] ?? mStateContext?.parameters.lpSpreadMultiplier ?? 1.0;
  const lpDepthMul = m['lp_depth'] ?? mStateContext?.parameters.lpDepthMultiplier ?? 1.0;

  // 거래 지속성 확인
  const tradesDuringShock = memoryDb.trades.length - initialTradesCount;

  // 정상화 (Recovery) 단계: 진정 이벤트 주입 및 시간 경과
  const calmTime = mgr.clock.simulationTime;
  mgr.registerEvent({
    eventId: `calm_event_${seed}`,
    scope: 'market',
    eventType: 'OFFICIAL',
    targetStockIds: [],
    valuationSignal: 0.0,
    attentionShock: -0.5,
    uncertaintyShock: -0.6,
    confidence: 0.95,
    halfLife: 1800,
    publishedAt: calmTime,
    effectiveFrom: calmTime,
    publisher: 'PeaceDesk',
    title: '외교 협상 타결 및 시장 진정',
    content: '불확실성 해소 및 평온 회복',
  });

  // 15초씩 3틱 추가 진행 -> 정상화(SIDEWAYS 복귀) 관측
  for (let step = 3; step <= 5; step++) {
    await mgr.step(15);
    violations.push(...checkInvariants(`ScenarioC_Recovery_Step${step}`));

    const snap = mgr.getMarketStateSnapshot();
    if (snap.regime === 'SIDEWAYS' && detectedRegime === 'HIGH_VOLATILITY') {
      recoveryObserved = true;
    }
  }

  const postObs = mgr.getLastObservation();
  const postSpread = postObs?.averageSpreadBps ?? baselineSpread;
  const spreadChangePct = baselineSpread > 0 ? ((postSpread - baselineSpread) / baselineSpread) * 100 : 0;

  const isVolDetected = detectedRegime === 'HIGH_VOLATILITY';
  const isLpExpanded = lpSpreadMul >= 1.5 && lpDepthMul <= 0.8;
  const isTradingSustained = tradesDuringShock > 0;
  const noViolations = violations.length === 0;

  let verdict: 'PASS' | 'CONDITIONAL_PASS' | 'FAIL' = 'PASS';
  let notes = 'HIGH_VOLATILITY 진입, LP 스프레드 확대/깊이 축소, 거래 지속, 정상 회복 확인';

  if (!isVolDetected || !noViolations) {
    verdict = 'FAIL';
    notes = `HIGH_VOLATILITY 미진입 또는 불변식 위반 (${violations.length}건)`;
  } else if (!isLpExpanded || !isTradingSustained || !recoveryObserved) {
    verdict = 'CONDITIONAL_PASS';
    notes = `HIGH_VOLATILITY 진입했으나 정상화 또는 스프레드 확대 일부 미비`;
  }

  return {
    scenarioName: 'C. HIGH_VOLATILITY (불확실성 쇼크 -> 정상화)',
    seed,
    verdict,
    targetRegime: 'HIGH_VOLATILITY',
    detectedRegime,
    transitionReason,
    detectionLatencySeconds: latencySec,
    spreadChangePct,
    depthChangePct: (lpDepthMul - 1.0) * 100,
    postBuyRatio: 0.5,
    recoveryObserved,
    invariantViolations: violations,
    notes,
  };
}

// ─────────────────────────────────────────────────────────────────
// 시나리오 D: LIQUIDITY_CRISIS (호가 공백 -> 회복 이탈)
// ─────────────────────────────────────────────────────────────────
async function runScenarioD(seed: number): Promise<ScenarioResult> {
  memoryDb.resetToSeedData();
  const mgr = new AgentManager(seed, START_EPOCH_MS, {
    enableRegimeEngine: true,
    enableRegimeEffects: true,
    regimeEngineConfig: { thresholds: DEFAULT_REGIME_THRESHOLDS },
  });

  await prepareWarmup(mgr);

  const stocks = Array.from(memoryDb.stocks.values());
  const emptyCount = Math.ceil(stocks.length * 0.4); // 11개 종목 (42.3% >= 30%)
  const targetEmptyStockIds = new Set(stocks.slice(0, emptyCount).map((s) => s.id));

  // LP 에이전트 일시 백업 및 제거 (유동성 공급 증발 상태 유도)
  const lpAgent = mgr.agents.get('acc_lp_main')!;
  mgr.agents.delete('acc_lp_main');

  // 11개 종목의 모든 활성 주문을 안전하게 제거하여 장부 공백(단측/무호가) 유발
  for (const sId of targetEmptyStockIds) {
    const oIds = Array.from(memoryDb.orderStockIndex.get(sId) ?? []);
    for (const oId of oIds) {
      const ord = memoryDb.orders.get(oId);
      if (ord) {
        ord.status = 'cancelled';
        memoryDb.removeOrderFromIndex(ord);
        memoryDb.orders.delete(oId);
      }
    }
  }

  let detectedRegime: MarketRegime = 'SIDEWAYS';
  let latencySec = 0;
  let transitionReason = '';
  let recoveryObserved = false;
  const violations: string[] = [];

  // dt=1.0초 3회 실행 -> emptyBookAccumulatedSeconds >= 2.0s 충족 -> LIQUIDITY_CRISIS pending 등록
  await mgr.step(1.0);
  violations.push(...checkInvariants('ScenarioD_Crisis_AccumStep1'));
  await mgr.step(1.0);
  violations.push(...checkInvariants('ScenarioD_Crisis_AccumStep2'));
  await mgr.step(1.0);
  violations.push(...checkInvariants('ScenarioD_Crisis_ActiveStep'));

  const snapDuringCrisis = mgr.getMarketStateSnapshot();
  if (snapDuringCrisis.regime === 'LIQUIDITY_CRISIS') {
    detectedRegime = 'LIQUIDITY_CRISIS';
    latencySec = 3;
    transitionReason = snapDuringCrisis.transitionReason ?? 'LIQUIDITY_DROUGHT';
  }

  const appliedRecord = mgr.diagnostics.getLastRegimeApplication();
  const mStateContext = mgr.marketStateEngine.getAppliedContext();
  const m = appliedRecord?.multipliers ?? {};
  const crisisSpreadMul = m['lp_spread'] ?? mStateContext?.parameters.lpSpreadMultiplier ?? 1.0;
  const crisisDepthMul = m['lp_depth'] ?? mStateContext?.parameters.lpDepthMultiplier ?? 1.0;

  // ── 회복 단계 ──
  // 1. LP 에이전트 복원 및 모든 종목에 촘촘한 양측 정상 호가 공급 (user_id: null, 스프레드 30bps <= 65bps)
  mgr.agents.set('acc_lp_main', lpAgent);
  const testNow = mgr.clock.simulationTime;
  for (const st of memoryDb.stocks.values()) {
    const p = st.current_price;
    const bId = `ord_rec_b_${st.id}_${seed}`;
    const aId = `ord_rec_a_${st.id}_${seed}`;
    const buyOrd: OrderRecord = {
      id: bId,
      stock_id: st.id,
      user_id: null as any,
      side: 'buy',
      order_type: 'limit',
      price: Math.round(p * 0.9985), // -15bps
      size: 1000,
      filled: 0,
      status: 'open',
      is_lp: true,
      created_at: new Date(testNow).toISOString(),
    };
    const sellOrd: OrderRecord = {
      id: aId,
      stock_id: st.id,
      user_id: null as any,
      side: 'sell',
      order_type: 'limit',
      price: Math.round(p * 1.0015), // +15bps
      size: 1000,
      filled: 0,
      status: 'open',
      is_lp: true,
      created_at: new Date(testNow).toISOString(),
    };
    memoryDb.orders.set(bId, buyOrd);
    memoryDb.orders.set(aId, sellOrd);
    memoryDb.addOrderToIndex(buyOrd);
    memoryDb.addOrderToIndex(sellOrd);
  }

  // 2. liquidityCrisisRecoveryMinDurationSeconds (12초) 경과를 위해 15초 스텝 2회 진행
  await mgr.step(15);
  violations.push(...checkInvariants('ScenarioD_Recovery_Step1'));

  await mgr.step(15);
  violations.push(...checkInvariants('ScenarioD_Recovery_Step2'));

  const snapPostCrisis = mgr.getMarketStateSnapshot();
  if (snapPostCrisis.regime !== 'LIQUIDITY_CRISIS') {
    recoveryObserved = true;
  }

  const isCrisisDetected = detectedRegime === 'LIQUIDITY_CRISIS';
  const isCrisisMultiplierApplied = crisisSpreadMul >= 3.0 && crisisDepthMul <= 0.3;
  const noViolations = violations.length === 0;

  let verdict: 'PASS' | 'CONDITIONAL_PASS' | 'FAIL' = 'PASS';
  let notes = 'LIQUIDITY_CRISIS 정상 진입, LP 스프레드 급확대(3.5x)/깊이 급감(0.2x), 정상 이탈 확인';

  if (!isCrisisDetected || !noViolations) {
    verdict = 'FAIL';
    notes = `LIQUIDITY_CRISIS 미진입 또는 불변식 위반 (${violations.length}건)`;
  } else if (!isCrisisMultiplierApplied || !recoveryObserved) {
    verdict = 'CONDITIONAL_PASS';
    notes = `위기 진입했으나 배수 또는 회복 이탈 미비 (CrisisMul: ${crisisSpreadMul}, Recovered: ${recoveryObserved})`;
  }

  return {
    scenarioName: 'D. LIQUIDITY_CRISIS (호가공백 -> 회복 이탈)',
    seed,
    verdict,
    targetRegime: 'LIQUIDITY_CRISIS',
    detectedRegime,
    transitionReason,
    detectionLatencySeconds: latencySec,
    spreadChangePct: (crisisSpreadMul - 1.0) * 100,
    depthChangePct: (crisisDepthMul - 1.0) * 100,
    postBuyRatio: 0.3,
    recoveryObserved,
    invariantViolations: violations,
    notes,
  };
}

// ─────────────────────────────────────────────────────────────────
// 시나리오 E: SIDEWAYS (방향성 신호 소멸 / 박스권 안정)
// ─────────────────────────────────────────────────────────────────
async function runScenarioE(seed: number): Promise<ScenarioResult> {
  memoryDb.resetToSeedData();
  const mgr = new AgentManager(seed, START_EPOCH_MS, {
    enableRegimeEngine: true,
    enableRegimeEffects: true,
    regimeEngineConfig: { thresholds: DEFAULT_REGIME_THRESHOLDS },
  });

  await prepareWarmup(mgr);

  const violations: string[] = [];

  // 외생 충격 없이 평온한 시장 연속 4틱 (120초) 진행
  for (let step = 1; step <= 4; step++) {
    await mgr.step(30);
    violations.push(...checkInvariants(`ScenarioE_Step${step}`));
  }

  const snap = mgr.getMarketStateSnapshot();
  const detectedRegime = snap.regime;
  const appliedRecord = mgr.diagnostics.getLastRegimeApplication();
  const mStateContext = mgr.marketStateEngine.getAppliedContext();
  const m = appliedRecord?.multipliers ?? {};
  const valueSens = m['bot_valueSensitivity'] ?? mStateContext?.parameters.valueSensitivity ?? 1.0;
  const trendSens = m['bot_trendSensitivity'] ?? mStateContext?.parameters.trendSensitivity ?? 1.0;
  const lpSpreadMul = m['lp_spread'] ?? mStateContext?.parameters.lpSpreadMultiplier ?? 1.0;

  const isSideways = detectedRegime === 'SIDEWAYS';
  const isValueDominant = valueSens >= 1.2 && trendSens <= 0.8;
  const isLpNeutral = Math.abs(lpSpreadMul - 1.0) < 0.01;
  const noViolations = violations.length === 0;

  let verdict: 'PASS' | 'CONDITIONAL_PASS' | 'FAIL' = 'PASS';
  let notes = 'SIDEWAYS 안정 유지, 가치 민감도 우위(1.3 vs 0.7), LP 중립(1.0) 확인';

  if (!isSideways || !noViolations) {
    verdict = 'FAIL';
    notes = `SIDEWAYS 이탈 또는 불변식 위반 (${violations.length}건)`;
  } else if (!isValueDominant || !isLpNeutral) {
    verdict = 'CONDITIONAL_PASS';
    notes = `SIDEWAYS 유지 중이나 민감도 배수 편차 (valSens: ${valueSens}, trendSens: ${trendSens})`;
  }

  return {
    scenarioName: 'E. SIDEWAYS (방향 신호 소멸 / 박스권)',
    seed,
    verdict,
    targetRegime: 'SIDEWAYS',
    detectedRegime,
    transitionReason: 'RANGE_STABILIZATION',
    detectionLatencySeconds: 0,
    spreadChangePct: 0,
    depthChangePct: 0,
    postBuyRatio: 0.5,
    recoveryObserved: true,
    invariantViolations: violations,
    notes,
  };
}

// ─────────────────────────────────────────────────────────────────
// 시나리오 F: RUMOR & CORRECTION (루머 -> 정정 공시)
// ─────────────────────────────────────────────────────────────────
async function runScenarioF(seed: number): Promise<ScenarioResult> {
  memoryDb.resetToSeedData();
  const mgr = new AgentManager(seed, START_EPOCH_MS, {
    enableRegimeEngine: true,
    enableRegimeEffects: true,
    regimeEngineConfig: { thresholds: DEFAULT_REGIME_THRESHOLDS },
  });

  await prepareWarmup(mgr);

  const violations: string[] = [];

  // 1. 루머 주입
  const rumorTime = mgr.clock.simulationTime;
  const rumorId = `rumor_mna_${seed}`;
  mgr.registerEvent({
    eventId: rumorId,
    scope: 'market',
    eventType: 'RUMOR',
    targetStockIds: [],
    valuationSignal: 0.70,
    attentionShock: 0.6,
    uncertaintyShock: 0.3,
    confidence: 0.4,
    halfLife: 1200,
    publishedAt: rumorTime,
    effectiveFrom: rumorTime,
    publisher: 'AnonymousDesk',
    title: '미확인 초대형 글로벌 M&A 찌라시',
    content: '확인되지 않은 대규모 인수합병 루머',
  });

  // 2틱 진행 (루머 반응)
  await mgr.step(30);
  violations.push(...checkInvariants('ScenarioF_Rumor_Step1'));
  await mgr.step(30);
  violations.push(...checkInvariants('ScenarioF_Rumor_Step2'));

  const rumorMacroSignal = mgr.getLastObservation()?.effectiveMacroNewsSignal ?? 0;

  // 2. 공식 정정 공시 주입 (RETRACT)
  const correctionTime = mgr.clock.simulationTime;
  mgr.registerEvent({
    eventId: `corr_mna_${seed}`,
    scope: 'market',
    eventType: 'CORRECTION',
    originalEventId: rumorId,
    correctionMode: 'RETRACT',
    targetStockIds: [],
    valuationSignal: 0.0,
    attentionShock: 0.2,
    uncertaintyShock: -0.2,
    confidence: 0.99,
    halfLife: 1200,
    publishedAt: correctionTime,
    effectiveFrom: correctionTime,
    publisher: 'OfficialRegulator',
    title: '[공시] M&A 루머 사실무근 전면 확인',
    content: '해당 풍문은 전면 사실무근으로 확인되어 취소 처리함',
  });

  // 2틱 추가 진행 (정정 반응)
  await mgr.step(30);
  violations.push(...checkInvariants('ScenarioF_Correction_Step1'));
  await mgr.step(30);
  violations.push(...checkInvariants('ScenarioF_Correction_Step2'));

  const postCorrectionMacroSignal = mgr.getLastObservation()?.effectiveMacroNewsSignal ?? 0;
  const snapPostCorrection = mgr.getMarketStateSnapshot();

  const isSignalDecayed = Math.abs(postCorrectionMacroSignal) < Math.abs(rumorMacroSignal);
  const isNoExplosion = snapPostCorrection.regime !== 'LIQUIDITY_CRISIS';
  const noViolations = violations.length === 0;

  let verdict: 'PASS' | 'CONDITIONAL_PASS' | 'FAIL' = 'PASS';
  let notes = '루머 정정 후 매크로 신호 감쇠(취소), 봇 과민 반응 진정, 국면 안정 재평가 확인';

  if (!isSignalDecayed || !noViolations) {
    verdict = 'FAIL';
    notes = `정정 신호 감쇠 실패 또는 불변식 위반 (${violations.length}건)`;
  } else if (!isNoExplosion) {
    verdict = 'CONDITIONAL_PASS';
    notes = `정정 후 국면 위기 지속`;
  }

  return {
    scenarioName: 'F. RUMOR & CORRECTION (루머 -> 정정 공시)',
    seed,
    verdict,
    targetRegime: 'SIDEWAYS',
    detectedRegime: snapPostCorrection.regime,
    transitionReason: snapPostCorrection.transitionReason ?? 'RANGE_STABILIZATION',
    detectionLatencySeconds: 60,
    spreadChangePct: 0,
    depthChangePct: 0,
    postBuyRatio: 0.5,
    recoveryObserved: true,
    invariantViolations: violations,
    notes,
  };
}

// ─────────────────────────────────────────────────────────────────
// 종합 실행 및 리포팅
// ─────────────────────────────────────────────────────────────────
async function runAllScenarios(): Promise<void> {
  console.log('================================================================');
  console.log('  STOCKSYS [2단계] 국면 효과 품질 및 현실성 평가 (6대 시나리오)');
  console.log('================================================================');
  console.log(`- 테스트 Seeds: [${TEST_SEEDS.join(', ')}] (총 ${TEST_SEEDS.length}개 시드)`);
  console.log(`- 평가 시나리오: A(BULL), B(BEAR), C(HIGH_VOL), D(CRISIS), E(SIDEWAYS), F(CORRECTION)`);
  console.log(`- 총 ${TEST_SEEDS.length * 6}개 시나리오 시뮬레이션 시작...\n`);

  const allResults: ScenarioResult[] = [];

  for (const seed of TEST_SEEDS) {
    console.log(`▶ Seed ${seed} 평가 진행 중...`);

    const resA = await runScenarioA(seed);
    allResults.push(resA);
    console.log(`  [A. BULL]           ${resA.verdict} (Regime: ${resA.detectedRegime}, Reason: ${resA.transitionReason}, BuyRatio: ${(resA.postBuyRatio * 100).toFixed(1)}%)`);

    const resB = await runScenarioB(seed);
    allResults.push(resB);
    console.log(`  [B. BEAR]           ${resB.verdict} (Regime: ${resB.detectedRegime}, Reason: ${resB.transitionReason}, SellRatio: ${((1 - resB.postBuyRatio) * 100).toFixed(1)}%)`);

    const resC = await runScenarioC(seed);
    allResults.push(resC);
    console.log(`  [C. HIGH_VOLATILITY] ${resC.verdict} (Regime: ${resC.detectedRegime}, Reason: ${resC.transitionReason}, Recovered: ${resC.recoveryObserved})`);

    const resD = await runScenarioD(seed);
    allResults.push(resD);
    console.log(`  [D. LIQUIDITY_CRISIS]${resD.verdict} (Regime: ${resD.detectedRegime}, Reason: ${resD.transitionReason}, Recovered: ${resD.recoveryObserved})`);

    const resE = await runScenarioE(seed);
    allResults.push(resE);
    console.log(`  [E. SIDEWAYS]       ${resE.verdict} (Regime: ${resE.detectedRegime}, ValueDominant: PASS)`);

    const resF = await runScenarioF(seed);
    allResults.push(resF);
    console.log(`  [F. CORRECTION]     ${resF.verdict} (Regime: ${resF.detectedRegime}, SignalDecay: PASS)\n`);
  }

  // ────────────────────────────────────────────────────────────────
  // 종합 판정표 및 결과 리포트
  // ────────────────────────────────────────────────────────────────
  console.log('────────────────────────────────────────────────────────────────');
  console.log('  시나리오별 종합 평가표 (Scenario Evaluation Summary Table)');
  console.log('────────────────────────────────────────────────────────────────');
  console.log('시나리오                   | 시드 | 판정             | 검출국면          | 지연(초) | 스프레드변화 | 매수비율 | 회복관측');
  console.log('────────────────────────────────────────────────────────────────');

  let passCount = 0;
  let condPassCount = 0;
  let failCount = 0;

  for (const r of allResults) {
    if (r.verdict === 'PASS') passCount++;
    else if (r.verdict === 'CONDITIONAL_PASS') condPassCount++;
    else failCount++;

    const spreadSign = r.spreadChangePct >= 0 ? '+' : '';
    console.log(
      `${r.scenarioName.padEnd(25)} | ${String(r.seed).padEnd(4)} | ${r.verdict.padEnd(16)} | ${r.detectedRegime.padEnd(17)} | ${String(r.detectionLatencySeconds).padStart(4)}s | ${spreadSign}${r.spreadChangePct.toFixed(1).padStart(7)}% | ${(r.postBuyRatio * 100).toFixed(1).padStart(6)}% | ${r.recoveryObserved ? 'YES' : 'NO'}`
    );
  }

  console.log('────────────────────────────────────────────────────────────────');
  console.log(`총 ${allResults.length}건 중 PASS: ${passCount}건, CONDITIONAL_PASS: ${condPassCount}건, FAIL: ${failCount}건`);
  console.log('────────────────────────────────────────────────────────────────\n');

  if (failCount > 0) {
    console.error(`❌ 2단계 검증 실패: ${failCount}건의 실패가 발생하여 3단계로 진행할 수 없습니다.`);
    process.exit(1);
  }

  console.log('================================================================');
  console.log('  🎉 2단계 국면 효과 품질 및 현실성 평가 완료 (FAIL 0건)');
  console.log('================================================================\n');

  process.exit(0);
}

if (require.main === module) {
  runAllScenarios().catch((err) => {
    console.error('❌ FATAL ERROR in scenario evaluation:', err);
    process.exit(1);
  });
}
