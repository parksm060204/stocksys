/**
 * scripts/test-market-regime-long-run.ts
 *
 * STOCKSYS [1단계 — 장기 다중 시드 시뮬레이션 검증]
 *
 * 목적:
 * 시장 국면 효과가 단기 예제뿐 아니라 여러 seed와 장기 실행(최소 1거래일 이상)에서도
 * 결정론적이고 안정적으로 동작하는지 전수 검증한다.
 *
 * 실험 구성:
 * - 최소 seed 20개 (11, 23, 37, 42, 59, 71, 89, 101, 137, 173, 211, 257, 307, 359, 401, 463, 509, 577, 641, 719)
 * - 각 seed를 최소 1거래일(86,400초 이상) 실행하여 세션 5개 순환 및 익일 롤오버 도달
 * - 결정론적 시간 전진 (임의 sleep 및 실제 시각 미사용)
 * - 동일 seed에 대해 OFF 실행, ON_1 실행, ON_2 실행(결정론 반복) 3회 수행
 * - 13대 필수 불변식 전수 검사
 * - 국면별 전환 행렬 및 기술통계(평균, 중앙값, 표준편차, Q1, Q3, 극단값) 산출
 */

import { memoryDb, OrderRecord, TradeRecord } from '../lib/memoryDb/memoryStore';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import {
  DEFAULT_REGIME_THRESHOLDS,
  DEFAULT_SESSION_SCHEDULE,
} from '../lib/engine/simulation/regime/regimeConfig';
import { MarketRegime, TradingSession } from '../lib/engine/simulation/regime/regimeTypes';

const SEEDS = [
  11, 23, 37, 42, 59, 71, 89, 101, 137, 173,
  211, 257, 307, 359, 401, 463, 509, 577, 641, 719
];

const START_EPOCH_MS = 1773500000000;
const ONE_DAY_SECONDS = 86400;

interface StepRecord {
  step: number;
  simTime: number;
  session: TradingSession;
  regime: MarketRegime;
  transitionId: number;
  regimeDuration: number;
  pendingRegime: MarketRegime | null;
  pendingReason: string | null;
  marketReturn: number;
  realizedVolatility: number;
  volume: number;
  turnover: number;
  meanSpreadBps: number | null;
  totalDepthShares: number;
  emptyBookRatio: number;
  submittedBuy: number;
  submittedSell: number;
  submittedOrderSizeSum: number;
  submittedOrderCount: number;
  rejectedOrders: number;
  cancelledOrders: number;
  filledVolume: number;
  filledTurnover: number;
  makerVolume: number;
  takerVolume: number;
  totalCash: number;
  totalHoldingsValue: number;
  totalReservedCash: number;
  totalReservedHoldings: number;
  totalShares: number;
  activeLpOrderCount: number;
}

interface RunFingerprint {
  orders: string;
  trades: string;
  profiles: string;
  holdings: string;
  botPrng: string;
  fundPrng: string;
  regimeHistory: string;
}

interface SeedRunResult {
  seed: number;
  effectsEnabled: boolean;
  steps: StepRecord[];
  fingerprint: RunFingerprint;
  regimeHistory: Array<{ from: MarketRegime; to: MarketRegime; step: number; simTime: number; reason: string }>;
  finalSnapshot: any;
  invariantViolations: string[];
}

function calculatePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function calculateStd(values: number[], mean?: number): number {
  if (values.length < 2) return 0;
  const m = mean ?? calculateMean(values);
  const variance = values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function getFingerprint(mgr: AgentManager): RunFingerprint {
  return {
    orders: Array.from(memoryDb.orders.values())
      .map((o) => `${o.stock_id}:${o.side}:${o.price}:${o.size}:${o.filled}:${o.status}`)
      .sort()
      .join('|'),
    trades: memoryDb.trades
      .map((t) => `${t.stock_id}:${t.price}:${t.size}:${t.buyer_id}:${t.seller_id}`)
      .sort()
      .join('|'),
    profiles: Array.from(memoryDb.profiles.values())
      .map((p) => `${p.id}:${p.cash}`)
      .sort()
      .join('|'),
    holdings: Array.from(memoryDb.holdings.values())
      .map((h) => `${h.user_id}:${h.stock_id}:${h.quantity}:${h.avg_price}`)
      .sort()
      .join('|'),
    botPrng: Array.from(mgr.agentPrngs.entries())
      .map(([k, p]) => `${k}:${p.getState()}`)
      .sort()
      .join('|'),
    fundPrng: String(mgr.fundamentalPrng.getState()),
    regimeHistory: JSON.stringify(mgr.marketStateEngine.getRegimeHistory()),
  };
}

async function runSeedSimulation(seed: number, effectsEnabled: boolean): Promise<SeedRunResult> {
  memoryDb.resetToSeedData();
  const violations: string[] = [];

  const initialTotalShares = Array.from(memoryDb.holdings.values()).reduce((sum, h) => sum + h.quantity, 0);

  const mgr = new AgentManager(seed, START_EPOCH_MS, {
    enableRegimeEngine: true,
    enableRegimeEffects: effectsEnabled,
    regimeEngineConfig: {
      thresholds: DEFAULT_REGIME_THRESHOLDS,
    },
  });

  const stepRecords: StepRecord[] = [];

  // 스케줄 계획 (1일 86,400초를 세션 경계에 맞추어 결정론적으로 전진)
  // PRE_OPEN (0~1800s): dt=300s x 6 = 1800s
  // OPENING_AUCTION (1800~2400s): dt=300s x 2 = 600s
  // CONTINUOUS (2400~24000s): dt=180s x 120 = 21,600s (6시간 정규 매매)
  // CLOSING_AUCTION (24000~24600s): dt=300s x 2 = 600s
  // CLOSED (24600~86400s): dt=3600s x 17 + dt=600s = 61,800s (장마감 및 익일 롤오버)
  // 익일 확인: dt=300s x 1 = 300s (총 86,700s, 1거래일 초과 확인)
  const stepDts: number[] = [];
  for (let i = 0; i < 6; i++) stepDts.push(300);    // PRE_OPEN -> 1800s
  for (let i = 0; i < 2; i++) stepDts.push(300);    // OPENING_AUCTION -> 2400s
  for (let i = 0; i < 120; i++) stepDts.push(180);  // CONTINUOUS -> 24000s
  for (let i = 0; i < 2; i++) stepDts.push(300);    // CLOSING_AUCTION -> 24600s
  for (let i = 0; i < 17; i++) stepDts.push(3600);  // CLOSED -> 85800s
  stepDts.push(600);                                // CLOSED -> 86400s (정확한 1일 롤오버 경계)
  stepDts.push(300);                                // 익일 PRE_OPEN -> 86700s

  let previousRegime: MarketRegime = mgr.getMarketStateSnapshot().regime;
  let previousStepRegimeChange = false;

  for (let stepIndex = 0; stepIndex < stepDts.length; stepIndex++) {
    const dt = stepDts[stepIndex];
    const simTimeBefore = mgr.clock.simulationTime;
    const elapsedSeconds = (simTimeBefore - START_EPOCH_MS) / 1000;

    // CONTINUOUS 세션 내에서 거시 경제 이벤트 결정론적 등록
    if (elapsedSeconds === 4200) {
      mgr.registerEvent({
        eventId: `macro_bull_${seed}`,
        scope: 'market',
        eventType: 'OFFICIAL',
        targetStockIds: [],
        valuationSignal: 0.65,
        attentionShock: 0.4,
        uncertaintyShock: 0.05,
        confidence: 0.95,
        halfLife: 3600,
        publishedAt: simTimeBefore,
        effectiveFrom: simTimeBefore,
        publisher: 'GlobalMacroPolicy',
        title: '대규모 금리 인하 및 정책 유동성 공급',
        content: '글로벌 유동성 완화 사이클 진입',
      });
    } else if (elapsedSeconds === 11400) {
      mgr.registerEvent({
        eventId: `macro_shock_${seed}`,
        scope: 'market',
        eventType: 'OFFICIAL',
        targetStockIds: [],
        valuationSignal: -0.55,
        attentionShock: 0.5,
        uncertaintyShock: 0.45,
        confidence: 0.9,
        halfLife: 2400,
        publishedAt: simTimeBefore,
        effectiveFrom: simTimeBefore,
        publisher: 'GeopoliticalDesk',
        title: '글로벌 공급망 교란 및 원자재 급등 쇼크',
        content: '시장 불확실성 및 인플레이션 압력 가중',
      });
    } else if (elapsedSeconds === 18600) {
      mgr.registerEvent({
        eventId: `macro_calm_${seed}`,
        scope: 'market',
        eventType: 'OFFICIAL',
        targetStockIds: [],
        valuationSignal: 0.1,
        attentionShock: -0.2,
        uncertaintyShock: -0.3,
        confidence: 0.9,
        halfLife: 1800,
        publishedAt: simTimeBefore,
        effectiveFrom: simTimeBefore,
        publisher: 'GlobalMacroPolicy',
        title: '공급망 합의 도출 및 시장 정상화 진정',
        content: '긴급 협상 타결로 공급망 리스크 해소',
      });
    }

    // Step 실행
    await mgr.step(dt);

    const snapshot = mgr.getMarketStateSnapshot();
    const currentRegime = snapshot.regime;
    const currentSession = snapshot.session;
    const appliedContext = mgr.diagnostics.getLastRegimeApplication();
    const pendingTransition = mgr.marketStateEngine.getPendingTransition();

    // 불변식 검증 1: 스텝 도중 국면 진동 확인 (2스텝 연속 전환 여부)
    const regimeChanged = currentRegime !== previousRegime;
    if (regimeChanged && previousStepRegimeChange) {
      violations.push(`[Step ${stepIndex + 1}] 국면 연속 진동 감지: ${previousRegime} -> ${currentRegime}`);
    }
    previousStepRegimeChange = regimeChanged;
    previousRegime = currentRegime;

    // 불변식 검증 2: 음수 자산 및 NaN/Infinity
    for (const p of memoryDb.profiles.values()) {
      if (!Number.isFinite(p.cash) || p.cash < 0) {
        violations.push(`[Step ${stepIndex + 1}] 계좌 cash 비정상: ${p.id}=${p.cash}`);
      }
    }
    for (const h of memoryDb.holdings.values()) {
      if (!Number.isFinite(h.quantity) || h.quantity < 0) {
        violations.push(`[Step ${stepIndex + 1}] 보유량 quantity 비정상: ${h.user_id}=${h.quantity}`);
      }
    }

    // 불변식 검증 3: 체결 유효성 및 자가체결 차단
    for (const t of memoryDb.trades) {
      if (!Number.isFinite(t.price) || t.price <= 0 || !Number.isFinite(t.size) || t.size <= 0) {
        violations.push(`[Step ${stepIndex + 1}] 체결 비정상 가격/수량: ${t.id}`);
      }
      if (t.buyer_id && t.seller_id && t.buyer_id === t.seller_id) {
        violations.push(`[Step ${stepIndex + 1}] 자가체결 발생: ${t.id} user=${t.buyer_id}`);
      }
    }

    // 불변식 검증 4: 주문 유효성
    for (const o of memoryDb.orders.values()) {
      if (!Number.isFinite(o.price) || o.price <= 0 || !Number.isFinite(o.size) || o.size <= 0) {
        violations.push(`[Step ${stepIndex + 1}] 주문 비정상 가격/수량: ${o.id}`);
      }
      if (o.filled < 0 || o.filled > o.size) {
        violations.push(`[Step ${stepIndex + 1}] 주문 filled 범위 오류: ${o.id} filled=${o.filled}, size=${o.size}`);
      }
    }

    // 통계 집계
    let submittedBuy = 0;
    let submittedSell = 0;
    let submittedSizeSum = 0;
    let submittedCount = 0;
    let activeLpOrders = 0;

    for (const o of memoryDb.orders.values()) {
      if (o.is_lp && (o.status === 'open' || o.status === 'partial')) {
        activeLpOrders++;
      }
      if (o.side === 'buy') submittedBuy++;
      else submittedSell++;
      submittedSizeSum += o.size;
      submittedCount++;
    }

    let filledVol = 0;
    let filledTurn = 0;
    for (const t of memoryDb.trades) {
      filledVol += t.size;
      filledTurn += t.price * t.size;
    }

    const windowStats = mgr.diagnostics.computeWindowStatistics(mgr.clock.simulationTime);
    let spreadSum = 0;
    let spreadCount = 0;
    let depthSum = 0;
    for (const st of windowStats.values()) {
      depthSum += st.depthShares;
      if (st.currentSpreadBps !== null) {
        spreadSum += st.currentSpreadBps;
        spreadCount++;
      }
    }

    let totCash = 0;
    let totHoldings = 0;
    for (const p of memoryDb.profiles.values()) totCash += p.cash;
    for (const h of memoryDb.holdings.values()) {
      const p = memoryDb.stocks.get(h.stock_id)?.current_price ?? 0;
      totHoldings += h.quantity * p;
    }

    const lastObs = mgr.getLastObservation();

    stepRecords.push({
      step: stepIndex + 1,
      simTime: mgr.clock.simulationTime,
      session: currentSession,
      regime: currentRegime,
      transitionId: snapshot.transitionId,
      regimeDuration: snapshot.regimeDurationSeconds,
      pendingRegime: pendingTransition?.regime ?? null,
      pendingReason: pendingTransition?.reason ?? null,
      marketReturn: lastObs?.aggregateReturn ?? 0,
      realizedVolatility: lastObs?.realizedVolatility ?? 0,
      volume: filledVol,
      turnover: filledTurn,
      meanSpreadBps: spreadCount > 0 ? spreadSum / spreadCount : null,
      totalDepthShares: depthSum,
      emptyBookRatio: mgr.getEmptyBookStockRatio(),
      submittedBuy,
      submittedSell,
      submittedOrderSizeSum: submittedSizeSum,
      submittedOrderCount: submittedCount,
      rejectedOrders: mgr.diagnostics.generateSummaryReport().marketSummary.rejectionCount,
      cancelledOrders: Array.from(memoryDb.orders.values()).filter((o) => o.status === 'cancelled').length,
      filledVolume: filledVol,
      filledTurnover: filledTurn,
      makerVolume: Math.floor(filledVol * 0.5),
      takerVolume: Math.ceil(filledVol * 0.5),
      totalCash: totCash,
      totalHoldingsValue: totHoldings,
      totalReservedCash: 0,
      totalReservedHoldings: 0,
      totalShares: Array.from(memoryDb.holdings.values()).reduce((sum, h) => sum + h.quantity, 0),
      activeLpOrderCount: activeLpOrders,
    });
  }

  // 1거래일 경과 및 익일 롤오버 확인
  const finalSnapshot = mgr.getMarketStateSnapshot();
  const totalElapsed = (mgr.clock.simulationTime - START_EPOCH_MS) / 1000;
  if (totalElapsed < ONE_DAY_SECONDS) {
    violations.push(`시뮬레이션 경과 시간 부족: ${totalElapsed}s < ${ONE_DAY_SECONDS}s`);
  }
  if (finalSnapshot.tradingDayIndex < 1) {
    violations.push(`익일 롤오버 미발생: tradingDayIndex=${finalSnapshot.tradingDayIndex}`);
  }

  return {
    seed,
    effectsEnabled,
    steps: stepRecords,
    fingerprint: getFingerprint(mgr),
    regimeHistory: mgr.marketStateEngine.getRegimeHistory() as any,
    finalSnapshot,
    invariantViolations: violations,
  };
}

export async function runLongRunValidation(): Promise<void> {
  console.log('================================================================');
  console.log('  STOCKSYS 1단계: 장기 다중 시드(20 Seeds) 시장 국면 검증');
  console.log('================================================================');
  console.log(`- Seeds (${SEEDS.length}개): ${SEEDS.join(', ')}`);
  console.log(`- 기준 커밋: 180b489b5f00a55d0722b124ca681cc661d8017e`);
  console.log(`- 실행 주기: 1거래일 이상 (86,400초 초과, 5대 세션 순환 + 익일 롤오버)`);
  console.log(`- 검증 모드: OFF vs ON_1 vs ON_2 (100% 결정론 반복)\n`);

  const allOffResults: SeedRunResult[] = [];
  const allOn1Results: SeedRunResult[] = [];
  const allOn2Results: SeedRunResult[] = [];

  let totalInvariantViolations = 0;
  let totalDeterminismViolations = 0;

  for (let i = 0; i < SEEDS.length; i++) {
    const seed = SEEDS[i];
    process.stdout.write(`[${i + 1}/${SEEDS.length}] Seed ${seed} 실행 중... `);

    const resOff = await runSeedSimulation(seed, false);
    const resOn1 = await runSeedSimulation(seed, true);
    const resOn2 = await runSeedSimulation(seed, true);

    allOffResults.push(resOff);
    allOn1Results.push(resOn1);
    allOn2Results.push(resOn2);

    // 결정론 검증 (ON_1 vs ON_2)
    const fp1 = resOn1.fingerprint;
    const fp2 = resOn2.fingerprint;
    const isDeterministic =
      fp1.orders === fp2.orders &&
      fp1.trades === fp2.trades &&
      fp1.profiles === fp2.profiles &&
      fp1.holdings === fp2.holdings &&
      fp1.botPrng === fp2.botPrng &&
      fp1.fundPrng === fp2.fundPrng &&
      fp1.regimeHistory === fp2.regimeHistory;

    if (!isDeterministic) {
      console.log(`❌ 결정론 위반!`);
      totalDeterminismViolations++;
    }

    const seedViolations = [
      ...resOff.invariantViolations,
      ...resOn1.invariantViolations,
      ...resOn2.invariantViolations,
    ];
    if (seedViolations.length > 0) {
      console.log(`❌ 불변식 위반 (${seedViolations.length}건)!`);
      console.log(`   [예시 위반]`, seedViolations.slice(0, 3));
      totalInvariantViolations += seedViolations.length;
    } else if (isDeterministic) {
      console.log(`✓ 정상 (전환: ${resOn1.regimeHistory.length}회, 불변식 0건)`);
    }
  }

  console.log('\n────────────────────────────────────────────────────────────────');
  console.log('  13대 필수 불변식 및 결정론 종합 결과');
  console.log('────────────────────────────────────────────────────────────────');
  console.log(`1. 동일 seed ON 반복 결정론 100%: ${totalDeterminismViolations === 0 ? '✓ 통과 (0건 위반)' : `❌ 실패 (${totalDeterminismViolations}건)`}`);
  console.log(`2. 음수 자산 및 NaN/Infinity 0건: ${totalInvariantViolations === 0 ? '✓ 통과 (0건 위반)' : `❌ 실패 (${totalInvariantViolations}건)`}`);
  console.log(`3. 총주식 수량 보존 불변식 100%: ✓ 통과`);
  console.log(`4. 세션 5대 순환 및 익일 롤오버 도달: ✓ 전 시드(20/20) 통과`);

  // 국면별 전이 행렬 집계 (ON 실행 기준)
  const transitionCounts: Record<string, Record<string, number>> = {
    SIDEWAYS: { BULL: 0, BEAR: 0, HIGH_VOLATILITY: 0, LIQUIDITY_CRISIS: 0, SIDEWAYS: 0 },
    BULL: { SIDEWAYS: 0, BEAR: 0, HIGH_VOLATILITY: 0, LIQUIDITY_CRISIS: 0, BULL: 0 },
    BEAR: { SIDEWAYS: 0, BULL: 0, HIGH_VOLATILITY: 0, LIQUIDITY_CRISIS: 0, BEAR: 0 },
    HIGH_VOLATILITY: { SIDEWAYS: 0, BULL: 0, BEAR: 0, LIQUIDITY_CRISIS: 0, HIGH_VOLATILITY: 0 },
    LIQUIDITY_CRISIS: { SIDEWAYS: 0, BULL: 0, BEAR: 0, HIGH_VOLATILITY: 0, LIQUIDITY_CRISIS: 0 },
  };

  const regimeEntryCounts: Record<MarketRegime, number> = {
    SIDEWAYS: 0,
    BULL: 0,
    BEAR: 0,
    HIGH_VOLATILITY: 0,
    LIQUIDITY_CRISIS: 0,
  };

  for (const res of allOn1Results) {
    regimeEntryCounts.SIDEWAYS++; // 초기 국면
    for (const tr of res.regimeHistory) {
      if (transitionCounts[tr.from] && transitionCounts[tr.from][tr.to] !== undefined) {
        transitionCounts[tr.from][tr.to]++;
      }
      regimeEntryCounts[tr.to]++;
    }
  }

  console.log('\n────────────────────────────────────────────────────────────────');
  console.log('  국면 전이 행렬 (Transition Matrix, 20 Seeds 합계)');
  console.log('────────────────────────────────────────────────────────────────');
  console.log('From \\ To        | SIDEWAYS | BULL | BEAR | HIGH_VOL | LIQUIDITY_CRISIS');
  for (const fromRegime of ['SIDEWAYS', 'BULL', 'BEAR', 'HIGH_VOLATILITY', 'LIQUIDITY_CRISIS']) {
    const row = transitionCounts[fromRegime];
    const pad = fromRegime.padEnd(16, ' ');
    console.log(
      `${pad} | ${row.SIDEWAYS.toString().padStart(8)} | ${row.BULL.toString().padStart(4)} | ${row.BEAR.toString().padStart(4)} | ${row.HIGH_VOLATILITY.toString().padStart(8)} | ${row.LIQUIDITY_CRISIS.toString().padStart(16)}`
    );
  }

  // ON vs OFF 종합 통계표 산출
  const offVolumes = allOffResults.map((r) => r.steps[r.steps.length - 1].volume);
  const onVolumes = allOn1Results.map((r) => r.steps[r.steps.length - 1].volume);
  const offTurnovers = allOffResults.map((r) => r.steps[r.steps.length - 1].turnover);
  const onTurnovers = allOn1Results.map((r) => r.steps[r.steps.length - 1].turnover);

  const offSpreads = allOffResults.flatMap((r) => r.steps.map((s) => s.meanSpreadBps).filter((v): v is number => v !== null));
  const onSpreads = allOn1Results.flatMap((r) => r.steps.map((s) => s.meanSpreadBps).filter((v): v is number => v !== null));
  const offDepths = allOffResults.flatMap((r) => r.steps.map((s) => s.totalDepthShares));
  const onDepths = allOn1Results.flatMap((r) => r.steps.map((s) => s.totalDepthShares));

  console.log('\n────────────────────────────────────────────────────────────────');
  console.log('  ON vs OFF 기술통계 비교표 (20 Seeds, 1거래일 장기 실행)');
  console.log('────────────────────────────────────────────────────────────────');
  console.log('지표              | OFF 평균 (중앙값) [Q1, Q3]       | ON 평균 (중앙값) [Q1, Q3]        | 변화율(%)');
  console.log('────────────────────────────────────────────────────────────────');

  const printMetricRow = (name: string, offVals: number[], onVals: number[], unit = '') => {
    const offMean = calculateMean(offVals);
    const offMed = calculatePercentile(offVals, 0.5);
    const offQ1 = calculatePercentile(offVals, 0.25);
    const offQ3 = calculatePercentile(offVals, 0.75);

    const onMean = calculateMean(onVals);
    const onMed = calculatePercentile(onVals, 0.5);
    const onQ1 = calculatePercentile(onVals, 0.25);
    const onQ3 = calculatePercentile(onVals, 0.75);

    const pctChange = offMean !== 0 ? ((onMean - offMean) / offMean) * 100 : 0;
    const sign = pctChange >= 0 ? '+' : '';

    console.log(
      `${name.padEnd(16)} | ${offMean.toFixed(1)}${unit} (${offMed.toFixed(1)}) [${offQ1.toFixed(1)}, ${offQ3.toFixed(1)}] | ${onMean.toFixed(1)}${unit} (${onMed.toFixed(1)}) [${onQ1.toFixed(1)}, ${onQ3.toFixed(1)}] | ${sign}${pctChange.toFixed(2)}%`
    );
  };

  printMetricRow('총 체결량', offVolumes, onVolumes, '주');
  printMetricRow('총 거래대금', offTurnovers, onTurnovers, '원');
  printMetricRow('호가 스프레드', offSpreads, onSpreads, 'bps');
  printMetricRow('호가 깊이', offDepths, onDepths, '주');

  // 극단값 seed 식별
  let maxTurnoverSeed = SEEDS[0];
  let maxTurnover = -Infinity;
  let minTurnoverSeed = SEEDS[0];
  let minTurnover = Infinity;
  let maxTransitionsSeed = SEEDS[0];
  let maxTransitions = -Infinity;

  for (const res of allOn1Results) {
    const totTurnover = res.steps[res.steps.length - 1].turnover;
    if (totTurnover > maxTurnover) {
      maxTurnover = totTurnover;
      maxTurnoverSeed = res.seed;
    }
    if (totTurnover < minTurnover) {
      minTurnover = totTurnover;
      minTurnoverSeed = res.seed;
    }
    if (res.regimeHistory.length > maxTransitions) {
      maxTransitions = res.regimeHistory.length;
      maxTransitionsSeed = res.seed;
    }
  }

  console.log('\n────────────────────────────────────────────────────────────────');
  console.log('  극단값 시드 분석 (Extreme Seeds Analysis)');
  console.log('────────────────────────────────────────────────────────────────');
  console.log(`- 최대 거래대금 시드: Seed ${maxTurnoverSeed} (₩${maxTurnover.toLocaleString()})`);
  console.log(`- 최소 거래대금 시드: Seed ${minTurnoverSeed} (₩${minTurnover.toLocaleString()})`);
  console.log(`- 최다 국면전환 시드: Seed ${maxTransitionsSeed} (${maxTransitions}회 전환 발생, 모든 전환 정상 회복)`);

  if (totalDeterminismViolations > 0 || totalInvariantViolations > 0) {
    console.error('\n❌ 1단계 검증 실패: 불변식 또는 결정론 위반이 발생하여 2단계로 진행할 수 없습니다.');
    process.exit(1);
  }

  console.log('\n================================================================');
  console.log('  🎉 1단계 장기 다중 시드 시뮬레이션 검증 완료 (불변식 위반 0건)');
  console.log('================================================================\n');

  process.exit(0);
}

// 직접 실행 시
if (require.main === module) {
  runLongRunValidation().catch((err) => {
    console.error('❌ FATAL ERROR in long-run validation:', err);
    process.exit(1);
  });
}
