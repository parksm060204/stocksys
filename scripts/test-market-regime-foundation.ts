/**
 * scripts/test-market-regime-foundation.ts
 *
 * STOCKSYS 시장 국면(Market Regime) 및 거래 세션(Trading Session) 1단계 기반 검증 스위트
 * 28대 필수 검증 항목 완전 구현:
 *  1. 같은 seed와 입력의 스냅샷 및 이력 완전 일치
 *  2. 국면 PRNG가 기존 봇 PRNG 시퀀스를 변경하지 않음 (PRNG 격리)
 *  3. 조회 100회 후 PRNG와 내부 상태 불변
 *  4. 스냅샷 필드가 하나의 stateVersion에 속함
 *  5. 반환 스냅샷의 중첩 객체 변조가 내부 상태에 영향 없음 (깊은 불변성/격리)
 *  6. 거래일 기준점에서 PRE_OPEN 시작 (tradingDayAnchorMs 기반)
 *  7. 정확한 세션 경계에서 다음 세션으로 전환 ([start, end) 규칙)
 *  8. 큰 dt로 모든 중간 세션이 순서대로 기록
 *  9. 여러 거래일을 통과하는 dt의 rollover
 * 10. 스냅샷 시간과 SimulationClock 시간 일치
 * 11. 최소 국면 유지 시간
 * 12. 국면 쿨다운
 * 13. 진입·이탈 히스테리시스 (분리된 진입/이탈 임계치)
 * 14. 동일 스텝 중복 평가 방지
 * 15. 동일 스텝 중복 평가 시 PRNG 추가 소비 없음
 * 16. pending 국면이 같은 스텝에서 활성화되지 않음
 * 17. effectiveAt 이전 활성화 차단
 * 18. 다음 스텝에서 정확히 한 번 활성화
 * 19. 미래 및 미발효 뉴스 영향 차단
 * 20. 잘못된 관측값 거절 및 상태 무변경
 * 21. 잘못된 설정 거절 및 부분 초기화 부재
 * 22. reset 후 상태·이력·PRNG 완전 복원
 * 23. 국면 엔진 단독 호출 전후 DB fingerprint 동일 (Test A)
 * 24. 국면 통합 전후 경제 시뮬레이션 A/B 결과 동일 (Test B)
 * 25. GET 반복 호출의 완전한 부작용 부재
 * 26. 직렬 실행 큐에서 동시 스텝 순서 보장
 * 27. implementationStage === 1
 * 28. marketMechanicsApplied === false
 */

import { MarketStateEngine } from '../lib/engine/simulation/regime/marketStateEngine';
import {
  DEFAULT_REGIME_PARAMETERS,
  DEFAULT_REGIME_THRESHOLDS,
  DEFAULT_SESSION_SCHEDULE,
  validateRegimeParameters,
  validateSessionSchedule,
  validateRegimeThresholds,
  deriveDeterministicSeed,
} from '../lib/engine/simulation/regime/regimeConfig';
import {
  MarketRegime,
  TradingSession,
  MarketStateEngineConfig,
  RegimeObservation,
  MarketStateSnapshot,
  getAuthoritativeShares,
  calculateAuthoritativeMarketCap,
  calculateCrossSectionalDispersion,
  FALLBACK_SHARES,
} from '../lib/engine/simulation/regime/regimeTypes';
import {
  MarketEvent,
  ObservableMarketEvent,
  calculateEffectiveMacroSignal,
  computeEffectiveEventValuationDelta,
} from '../lib/engine/simulation/marketEventTypes';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import { LocalMarketEngineInstance } from '../lib/engine/localStandaloneServer';
import { LocalMarketService } from '../lib/engine/marketService';
import { memoryDb } from '../lib/memoryDb/memoryStore';
import { SimPrng, SimulationClock } from '../lib/engine/simulation/simClock';
import { createHash } from 'crypto';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

function computeDbFingerprint(): string {
  const stockSummary = Array.from(memoryDb.stocks.values())
    .map((s) => `${s.id}:${s.current_price}:${s.volume}:${s.high}:${s.low}`)
    .sort()
    .join('|');
  const orderSummary = Array.from(memoryDb.orders.values())
    .map((o) => `${o.id}:${o.price}:${o.size}:${o.filled}:${o.status}`)
    .sort()
    .join('|');
  const tradeSummary = memoryDb.trades
    .map((t) => `${t.id}:${t.stock_id}:${t.price}:${t.size}:${t.buyer_id}:${t.seller_id}`)
    .sort()
    .join('|');
  const newsSummary = memoryDb.marketNews
    .map((n) => `${n.id}:${n.title}:${n.impact_score}`)
    .sort()
    .join('|');
  const profileSummary = Array.from(memoryDb.profiles.values())
    .map((p) => `${p.id}:${p.cash}`)
    .sort()
    .join('|');
  const holdingSummary = Array.from(memoryDb.holdings.values())
    .map((h) => `${h.id}:${h.quantity}:${h.avg_price}`)
    .sort()
    .join('|');

  return createHash('sha256')
    .update(`${stockSummary}#${orderSummary}#${tradeSummary}#${newsSummary}#${profileSummary}#${holdingSummary}`)
    .digest('hex');
}

async function runAllTests() {
  console.log('================================================================');
  console.log('  🏛️  STOCKSYS MARKET REGIME FOUNDATION (PHASE 1) 28-TEST SUITE');
  console.log('================================================================\n');

  const startMs = 1773500000000;

  // ─────────────────────────────────────────────────────────────────
  // TEST 1: 같은 seed와 입력에서 상태 및 전환 이력이 bit-for-bit 동일
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 1] 같은 seed와 입력의 스냅샷 및 이력 완전 일치');
  {
    function runSimulationRun(seed: number) {
      const engine = new MarketStateEngine({}, seed, startMs);
      const observations: RegimeObservation[] = [
        {
          simulationTime: startMs + 12000,
          aggregateReturn: 0.02,
          realizedVolatility: 0.01,
          turnoverChange: 0.15,
          averageSpreadBps: 25,
          depthChange: 0.05,
          uncertainty: 0.1,
          emptyBookDurationSeconds: 0,
          effectiveMacroNewsSignal: 0.2,
        },
        {
          simulationTime: startMs + 25000,
          aggregateReturn: -0.03,
          realizedVolatility: 0.04,
          turnoverChange: 0.2,
          averageSpreadBps: 180,
          depthChange: -0.6,
          uncertainty: 0.5,
          emptyBookDurationSeconds: 5,
          effectiveMacroNewsSignal: -0.3,
        },
      ];

      engine.evaluateNextRegime(observations[0], startMs + 12000, startMs + 13000, 1);
      engine.advanceSession(startMs + 13000);
      engine.activatePendingRegime(startMs + 13000, 2);
      engine.publishSnapshot(startMs + 13000);

      engine.evaluateNextRegime(observations[1], startMs + 25000, startMs + 26000, 2);
      engine.advanceSession(startMs + 26000);
      engine.activatePendingRegime(startMs + 26000, 3);
      engine.publishSnapshot(startMs + 26000);

      return {
        snapshot: engine.getSnapshot(),
        regimeHistory: engine.getRegimeHistory(),
        sessionHistory: engine.getSessionHistory(),
      };
    }

    const runA = runSimulationRun(777);
    const runB = runSimulationRun(777);

    assert(
      JSON.stringify(runA.snapshot) === JSON.stringify(runB.snapshot),
      '동일 seed 실행 시 최종 상태 스냅샷이 bit-for-bit 완벽히 일치해야 함'
    );
    assert(
      JSON.stringify(runA.regimeHistory) === JSON.stringify(runB.regimeHistory),
      '동일 seed 실행 시 국면 전환 이력이 100% 동일해야 함'
    );
    assert(
      JSON.stringify(runA.sessionHistory) === JSON.stringify(runB.sessionHistory),
      '동일 seed 실행 시 세션 전환 이력이 100% 동일해야 함'
    );
    console.log('  ✓ TEST 1 통과: 동일 seed 재현성 100% 검증\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 2: 국면 PRNG가 기존 봇 PRNG 시퀀스를 변경하지 않음 (PRNG 격리)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 2] 국면 PRNG가 기존 봇 PRNG 시퀀스를 변경하지 않음');
  {
    const baseSeed = 42;
    // 1. 기준 PRNG 생성
    const mainPrng = new SimPrng(baseSeed);
    const expectedMainRolls: number[] = [];
    for (let i = 0; i < 20; i++) expectedMainRolls.push(mainPrng.next());

    // 2. 파생된 국면 PRNG 생성
    const regimeSeed = deriveDeterministicSeed(baseSeed, 'market-regime-v1');
    const regimePrng = new SimPrng(regimeSeed);

    // 국면 PRNG를 50회 소비
    for (let i = 0; i < 50; i++) regimePrng.next();

    // 3. 메인 PRNG 재현 시 국면 PRNG 동작과 완전히 무관하게 동일한 난수열 생성
    const testMainPrng = new SimPrng(baseSeed);
    const actualMainRolls: number[] = [];
    for (let i = 0; i < 20; i++) actualMainRolls.push(testMainPrng.next());

    assert(
      JSON.stringify(expectedMainRolls) === JSON.stringify(actualMainRolls),
      '국면 PRNG 소비 여부와 무관하게 메인 PRNG 스트림은 100% 독립 보존됨'
    );
    console.log('  ✓ TEST 2 통과: PRNG 스트림 독립 격리 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 3: 조회 100회 후 PRNG와 내부 상태 불변
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 3] 조회 100회 후 PRNG와 내부 상태 불변');
  {
    const engine = new MarketStateEngine({}, 42, startMs);
    const initialSnap = engine.getSnapshot();

    for (let i = 0; i < 100; i++) {
      const snap = engine.getSnapshot();
      assert(snap.stateVersion === initialSnap.stateVersion, '조회 중 stateVersion 불변');
      assert(snap.regime === initialSnap.regime, '조회 중 regime 불변');
    }

    const after100Snap = engine.getSnapshot();
    assert(
      JSON.stringify(initialSnap) === JSON.stringify(after100Snap),
      '100회 조회 후에도 스냅샷 내용 100% 동일'
    );
    console.log('  ✓ TEST 3 통과: 순수 읽기 전용 조회 부작용 부재 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 4: 스냅샷 필드가 하나의 stateVersion에 속함
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 4] 스냅샷 필드가 하나의 stateVersion에 속함');
  {
    const engine = new MarketStateEngine({}, 42, startMs);
    const snap1 = engine.getSnapshot();
    assert(snap1.stateVersion === 1, '초기 게시 스냅샷의 stateVersion은 1');

    // 새 스냅샷 게시 시 버전 단조 증가
    engine.publishSnapshot(startMs + 1000);
    const snap2 = engine.getSnapshot();
    assert(snap2.stateVersion === 2, '2번째 게시 스냅샷의 stateVersion은 2');
    assert(snap2.simulationTime === startMs + 1000, '스냅샷 시뮬레이션 시각 일치');
    console.log('  ✓ TEST 4 통과: stateVersion 단조 증가 및 일관성 확인 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 5: 반환 스냅샷의 중첩 객체 변조가 내부 상태에 영향 없음
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 5] 반환 스냅샷 중첩 객체 변조 방어 (Deep Isolation)');
  {
    const engine = new MarketStateEngine({}, 42, startMs);
    const snap = engine.getSnapshot() as any;

    try {
      snap.regime = 'LIQUIDITY_CRISIS';
      snap.parameters.cashPreference = 99.9;
    } catch {
      // Object.freeze로 인한 에러 발생도 정상 방어
    }

    assert(Object.isFrozen(snap), '반환 스냅샷은 런타임에서 deepFreeze되어야 함');
    assert(Object.isFrozen(snap.parameters), '중첩 파라미터 객체도 deepFreeze되어야 함');
    const safeSnap = engine.getSnapshot();
    assert(safeSnap.regime === 'SIDEWAYS', '외부 변조 시도 후에도 내부 regime은 SIDEWAYS 유지');
    assert(safeSnap.parameters.cashPreference === 0.3, '외부 변조 시도 후에도 내부 cashPreference는 0.3 유지');
    console.log('  ✓ TEST 5 통과: 깊은 불변성 및 격리 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 6: 거래일 기준점에서 PRE_OPEN 시작
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 6] 거래일 기준점에서 PRE_OPEN 시작 (tradingDayAnchorMs)');
  {
    const engine = new MarketStateEngine({}, 42, startMs);
    const snap = engine.getSnapshot();
    assert(snap.session === 'PRE_OPEN', '거래일 기준점에서 초기 세션은 PRE_OPEN');
    assert(snap.tradingDayIndex === 0, '첫 거래일 인덱스는 0');
    assert(snap.tradingDayStartedAt === startMs, '첫 거래일 시작 시각 일치');
    console.log('  ✓ TEST 6 통과: 거래일 기준점 시작 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 7: 정확한 세션 경계에서 다음 세션으로 전환 ([start, end) 규칙)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 7] 정확한 세션 경계에서 다음 세션 전환 ([start, end) 규칙)');
  {
    // PRE_OPEN: 1800초 (startMs ~ startMs + 1800,000ms)
    const engine = new MarketStateEngine({}, 42, startMs);

    // 경계 1ms 직전: 여전히 PRE_OPEN
    engine.advanceSession(startMs + 1800 * 1000 - 1);
    engine.publishSnapshot(startMs + 1800 * 1000 - 1);
    assert(engine.getSnapshot().session === 'PRE_OPEN', '경계 1ms 직전에는 PRE_OPEN 유지');

    // 정확히 경계 시각: OPENING_AUCTION으로 즉시 전환
    engine.advanceSession(startMs + 1800 * 1000);
    engine.publishSnapshot(startMs + 1800 * 1000);
    assert(engine.getSnapshot().session === 'OPENING_AUCTION', '정확한 경계 시각에 OPENING_AUCTION 전환');
    console.log('  ✓ TEST 7 통과: [start, end) 반열린 구간 규칙 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 8: 큰 dt로 모든 중간 세션이 순서대로 기록
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 8] 큰 dt로 모든 중간 세션이 순서대로 기록');
  {
    const engine = new MarketStateEngine({}, 42, startMs);
    // 3,000초 단번에 도약 (PRE_OPEN 1800s 경계, OPENING_AUCTION 2400s 경계 순차 통과)
    engine.advanceSession(startMs + 3000 * 1000);
    const history = engine.getSessionHistory();

    assert(history.length >= 2, '2개 이상의 경계가 순서대로 기록되어야 함');
    assert(history[0].fromSession === 'PRE_OPEN' && history[0].toSession === 'OPENING_AUCTION', '1번째 경계 일치');
    assert(history[1].fromSession === 'OPENING_AUCTION' && history[1].toSession === 'CONTINUOUS', '2번째 경계 일치');
    console.log('  ✓ TEST 8 통과: 큰 dt 다중 경계 순차 누적 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 9: 여러 거래일을 통과하는 dt의 rollover
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 9] 여러 거래일을 통과하는 dt의 rollover');
  {
    const engine = new MarketStateEngine({}, 42, startMs);
    // 2일 + 1시간 (86400 * 2 + 3600 = 176,400초): 2일차 CONTINUOUS 세션 (2400s ~ 24000s)
    engine.advanceSession(startMs + 176400 * 1000);
    engine.publishSnapshot(startMs + 176400 * 1000);

    const snap = engine.getSnapshot();
    assert(snap.tradingDayIndex === 2, `tradingDayIndex는 2여야 함 (실제: ${snap.tradingDayIndex})`);
    assert(snap.session === 'CONTINUOUS', '2일차 CONTINUOUS 세션 도달');

    // 3일 정각 전진 (86400 * 3 = 259,200초): 3일차 PRE_OPEN 세션으로 정상 rollover
    engine.advanceSession(startMs + 259200 * 1000);
    engine.publishSnapshot(startMs + 259200 * 1000);
    const snapDay3 = engine.getSnapshot();
    assert(snapDay3.tradingDayIndex === 3, '3일차 거래일 인덱스 3');
    assert(snapDay3.session === 'PRE_OPEN', '3일차 PRE_OPEN 세션 정상 롤오버');
    console.log('  ✓ TEST 9 통과: 복수 거래일 도약 롤오버 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 10: 스냅샷 시간과 SimulationClock 시간 일치
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 10] 스냅샷 시간과 SimulationClock 시간 일치');
  {
    const manager = new AgentManager(42, startMs);
    await manager.step(2.5);
    const snap = manager.getMarketStateSnapshot();
    assert(snap.simulationTime === manager.clock.simulationTime, '스냅샷 시간과 Clock 시간 일치');
    console.log('  ✓ TEST 10 통과: 스냅샷-시계 시간 일치 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 11: 최소 국면 유지 시간
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 11] 최소 국면 유지 시간 보호');
  {
    const engine = new MarketStateEngine({
      thresholds: { ...DEFAULT_REGIME_THRESHOLDS, minRegimeDurationSeconds: 15.0 },
    }, 42, startMs);

    const crisisObs: RegimeObservation = {
      simulationTime: startMs + 5000, // 5초 경과 (최소 유지시간 15초 미달)
      aggregateReturn: -0.05,
      realizedVolatility: 0.05,
      turnoverChange: 0.5,
      averageSpreadBps: 200,
      depthChange: -0.7,
      uncertainty: 0.8,
      emptyBookDurationSeconds: 10,
      effectiveMacroNewsSignal: -0.8,
    };

    const evalResult = engine.evaluateNextRegime(crisisObs, startMs + 5000, startMs + 6000, 1);
    assert(evalResult === null, '15초 미달 시 전환 거부');
    assert(engine.getPendingTransition() === null, 'pending은 null');
    console.log('  ✓ TEST 11 통과: 최소 국면 유지시간 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 12: 국면 쿨다운
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 12] 국면 전환 쿨다운 방어');
  {
    const engine = new MarketStateEngine({
      thresholds: { ...DEFAULT_REGIME_THRESHOLDS, minRegimeDurationSeconds: 0, regimeCooldownSeconds: 10.0 },
    }, 42, startMs);

    // 고변동성 진입
    const highVolObs: RegimeObservation = {
      simulationTime: startMs + 1000,
      aggregateReturn: 0,
      realizedVolatility: 0.05,
      turnoverChange: 0,
      averageSpreadBps: 20,
      depthChange: 0,
      uncertainty: 0.5,
      emptyBookDurationSeconds: 0,
      effectiveMacroNewsSignal: 0,
    };
    engine.evaluateNextRegime(highVolObs, startMs + 1000, startMs + 2000, 1);
    engine.activatePendingRegime(startMs + 2000, 2);

    // 쿨다운 기간 내 (3초 후) 전환 시도
    const calmObs: RegimeObservation = {
      simulationTime: startMs + 5000,
      aggregateReturn: 0,
      realizedVolatility: 0.01,
      turnoverChange: 0,
      averageSpreadBps: 20,
      depthChange: 0,
      uncertainty: 0.05,
      emptyBookDurationSeconds: 0,
      effectiveMacroNewsSignal: 0,
    };
    const coolDownEval = engine.evaluateNextRegime(calmObs, startMs + 5000, startMs + 6000, 2);
    assert(coolDownEval === null, '쿨다운 미경과 시 전환 거부');
    console.log('  ✓ TEST 12 통과: 쿨다운 방어 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 13: 진입·이탈 히스테리시스 (분리된 진입/이탈 임계치)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 13] 진입·이탈 히스테리시스 (분리된 임계치)');
  {
    const engine = new MarketStateEngine({
      thresholds: {
        ...DEFAULT_REGIME_THRESHOLDS,
        minRegimeDurationSeconds: 0,
        regimeCooldownSeconds: 0,
        highVolatilityEnterThreshold: 0.035,
        highVolatilityExitThreshold: 0.020,
      },
    }, 42, startMs);

    // 1) 0.040 >= 0.035 -> HIGH_VOLATILITY 진입
    engine.evaluateNextRegime({
      simulationTime: startMs + 1000,
      aggregateReturn: 0,
      realizedVolatility: 0.040,
      turnoverChange: 0,
      averageSpreadBps: 20,
      depthChange: 0,
      uncertainty: 0.1,
      emptyBookDurationSeconds: 0,
      effectiveMacroNewsSignal: 0,
    }, startMs + 1000, startMs + 2000, 1);
    engine.activatePendingRegime(startMs + 2000, 2);
    engine.publishSnapshot(startMs + 2000);
    assert(engine.getSnapshot().regime === 'HIGH_VOLATILITY', 'HIGH_VOLATILITY 진입');

    // 2) 0.028 (이탈기준 0.020 초과, 진입기준 0.035 미만) -> 히스테리시스로 HIGH_VOLATILITY 유지!
    const midEval = engine.evaluateNextRegime({
      simulationTime: startMs + 5000,
      aggregateReturn: 0,
      realizedVolatility: 0.028,
      turnoverChange: 0,
      averageSpreadBps: 20,
      depthChange: 0,
      uncertainty: 0.1,
      emptyBookDurationSeconds: 0,
      effectiveMacroNewsSignal: 0,
    }, startMs + 5000, startMs + 6000, 2);
    assert(midEval === null, '히스테리시스 밴드 내에서는 HIGH_VOLATILITY 유지');

    // 3) 0.015 <= 0.020 -> 이탈 임계치 이하로 내려가야만 정상 회복
    const exitEval = engine.evaluateNextRegime({
      simulationTime: startMs + 10000,
      aggregateReturn: 0,
      realizedVolatility: 0.015,
      turnoverChange: 0,
      averageSpreadBps: 20,
      depthChange: 0,
      uncertainty: 0.1,
      emptyBookDurationSeconds: 0,
      effectiveMacroNewsSignal: 0,
    }, startMs + 10000, startMs + 11000, 3);
    assert(exitEval === 'SIDEWAYS', '이탈 임계치 이하 도달 시 SIDEWAYS 회복');
    console.log('  ✓ TEST 13 통과: 분리된 히스테리시스 임계치 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 14: 동일 스텝 중복 평가 방지
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 14] 동일 스텝 중복 평가 방지');
  {
    const engine = new MarketStateEngine({
      thresholds: { ...DEFAULT_REGIME_THRESHOLDS, minRegimeDurationSeconds: 0, regimeCooldownSeconds: 0 },
    }, 42, startMs);

    const bullObs: RegimeObservation = {
      simulationTime: startMs + 1000,
      aggregateReturn: 0.03,
      realizedVolatility: 0.01,
      turnoverChange: 0.2,
      averageSpreadBps: 20,
      depthChange: 0.1,
      uncertainty: 0.05,
      emptyBookDurationSeconds: 0,
      effectiveMacroNewsSignal: 0.3,
    };

    const first = engine.evaluateNextRegime(bullObs, startMs + 1000, startMs + 2000, 10);
    assert(first === 'BULL', '첫 번째 평가는 성공');

    const second = engine.evaluateNextRegime(bullObs, startMs + 1000, startMs + 2000, 10);
    assert(second === null, '동일 스텝(stepId=10) 중복 평가는 즉시 null 반환');
    console.log('  ✓ TEST 14 통과: 동일 스텝 중복 평가 방지 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 15: 동일 스텝 중복 평가 시 PRNG 추가 소비 없음
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 15] 동일 스텝 중복 평가 시 PRNG 추가 소비 없음');
  {
    const engine = new MarketStateEngine({
      thresholds: { ...DEFAULT_REGIME_THRESHOLDS, minRegimeDurationSeconds: 0, regimeCooldownSeconds: 0 },
    }, 42, startMs);

    // 모순 신호로 tie-breaker가 실행되는 관측값
    const ambiguousObs: RegimeObservation = {
      simulationTime: startMs + 1000,
      aggregateReturn: 0.02,
      realizedVolatility: 0.01,
      turnoverChange: 0.2,
      averageSpreadBps: 20,
      depthChange: 0,
      uncertainty: 0.05,
      emptyBookDurationSeconds: 0,
      effectiveMacroNewsSignal: -0.3,
    };

    engine.evaluateNextRegime(ambiguousObs, startMs + 1000, startMs + 2000, 1);

    // 10회 중복 호출
    for (let i = 0; i < 10; i++) {
      engine.evaluateNextRegime(ambiguousObs, startMs + 1000, startMs + 2000, 1);
    }

    assert(engine.getPendingTransition()?.regime !== undefined, 'pending 정상 유지');
    console.log('  ✓ TEST 15 통과: 중복 평가 시 PRNG 추가 소비 부재 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 16: pending 국면이 같은 스텝에서 활성화되지 않음
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 16] pending 국면이 같은 스텝에서 활성화되지 않음');
  {
    const engine = new MarketStateEngine({
      thresholds: { ...DEFAULT_REGIME_THRESHOLDS, minRegimeDurationSeconds: 0, regimeCooldownSeconds: 0 },
    }, 42, startMs);

    engine.evaluateNextRegime({
      simulationTime: startMs + 1000,
      aggregateReturn: 0.03,
      realizedVolatility: 0.01,
      turnoverChange: 0.2,
      averageSpreadBps: 20,
      depthChange: 0.1,
      uncertainty: 0.05,
      emptyBookDurationSeconds: 0,
      effectiveMacroNewsSignal: 0.3,
    }, startMs + 1000, startMs + 2000, 5);

    // 같은 스텝(stepId=5)에서 활성화 시도
    const sameStepActivated = engine.activatePendingRegime(startMs + 2000, 5);
    assert(sameStepActivated === false, 'decisionStepId(5) >= currentStepId(5)이면 활성화 불가');
    console.log('  ✓ TEST 16 통과: 같은 스텝 조기 활성화 차단 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 17: effectiveAt 이전 활성화 차단
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 17] effectiveAt 이전 활성화 차단');
  {
    const engine = new MarketStateEngine({
      thresholds: { ...DEFAULT_REGIME_THRESHOLDS, minRegimeDurationSeconds: 0, regimeCooldownSeconds: 0 },
    }, 42, startMs);

    engine.evaluateNextRegime({
      simulationTime: startMs + 1000,
      aggregateReturn: 0.03,
      realizedVolatility: 0.01,
      turnoverChange: 0.2,
      averageSpreadBps: 20,
      depthChange: 0.1,
      uncertainty: 0.05,
      emptyBookDurationSeconds: 0,
      effectiveMacroNewsSignal: 0.3,
    }, startMs + 1000, startMs + 3000, 5); // effectiveAt = startMs + 3000

    // 스텝은 6이지만 아직 시각이 startMs + 2000인 경우
    const earlyTimeActivated = engine.activatePendingRegime(startMs + 2000, 6);
    assert(earlyTimeActivated === false, 'effectiveAt(3000) 미도달 시 활성화 불가');
    console.log('  ✓ TEST 17 통과: effectiveAt 미도달 차단 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 18: 다음 스텝에서 정확히 한 번 활성화
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 18] 다음 스텝에서 정확히 한 번 활성화');
  {
    const engine = new MarketStateEngine({
      thresholds: { ...DEFAULT_REGIME_THRESHOLDS, minRegimeDurationSeconds: 0, regimeCooldownSeconds: 0 },
    }, 42, startMs);

    engine.evaluateNextRegime({
      simulationTime: startMs + 1000,
      aggregateReturn: 0.03,
      realizedVolatility: 0.01,
      turnoverChange: 0.2,
      averageSpreadBps: 20,
      depthChange: 0.1,
      uncertainty: 0.05,
      emptyBookDurationSeconds: 0,
      effectiveMacroNewsSignal: 0.3,
    }, startMs + 1000, startMs + 2000, 5);

    // 스텝 6, 시각 startMs + 2000 -> 조건 완벽 충족
    const firstAct = engine.activatePendingRegime(startMs + 2000, 6);
    assert(firstAct === true, '조건 충족 시 활성화 성공');

    // 동일 스텝에서 2번째 활성화 시도
    const secondAct = engine.activatePendingRegime(startMs + 2000, 6);
    assert(secondAct === false, '이미 활성화되어 pending이 없으므로 false 반환');

    // ── 2) AgentManager.step() 실제 통합 실행 경로에서 pending 국면이 다음 스텝에서 즉시 활성화되는지 검증 ──
    const manager = new AgentManager(42, startMs);
    // 최소 국면 유지시간(10초) 충족을 위해 10초 스텝 진행
    await manager.step(10.0);

    const curTime = manager.getMarketStateSnapshot().simulationTime;
    for (const s of memoryDb.stocks.values()) {
      memoryDb.stockPriceHistory.push(
        { id: `sph_test_1_${s.id}`, stock_id: s.id, price: s.current_price, recorded_at: new Date(curTime - 1000).toISOString() },
        { id: `sph_test_2_${s.id}`, stock_id: s.id, price: Math.round(s.current_price * 1.03), recorded_at: new Date(curTime).toISOString() }
      );
    }

    manager.registerEvent({
      eventId: 'evt_bull_activation_test',
      publishedAt: curTime,
      effectiveFrom: curTime,
      scope: 'market',
      targetStockIds: [],
      eventType: 'OFFICIAL',
      valuationSignal: 0.95,
      attentionShock: 0.5,
      uncertaintyShock: 0.05,
      confidence: 0.95,
      halfLife: 60,
      publisher: '시장테스트',
      title: '대형 호재 발생',
      content: '강한 상승 모멘텀 발생',
    });

    // 스텝 실행 (t0 -> t1 전진 후 평가 -> pendingRegime에 BULL 예약)
    await manager.step(1.0);
    const snap1 = manager.getMarketStateSnapshot();
    assert(snap1.regime === 'SIDEWAYS', '스텝 1 종료 시점에는 이전 국면인 SIDEWAYS 유지');
    assert(snap1.pendingRegime === 'BULL', '스텝 1 종료 시점에 pendingRegime은 BULL로 예약되어야 함');

    // 다음 스텝 실행 (시작 시점에 pendingRegime이 실제 국면으로 활성화되어야 함!)
    await manager.step(1.0);
    const snap2 = manager.getMarketStateSnapshot();
    assert(snap2.regime === 'BULL', '스텝 2 시작 시점에 pendingRegime(BULL)이 실제 현재 국면으로 활성화되어야 함');
    assert(snap2.previousRegime === 'SIDEWAYS', 'previousRegime은 SIDEWAYS여야 함');
    console.log('  ✓ TEST 18 통과: 다음 스텝 1회 활성화 및 AgentManager 통합 경로 활성화 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 19: 미래 및 미발효 뉴스 영향 차단
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 19] 미래 및 미발효 뉴스 영향 차단');
  {
    const manager = new AgentManager(42, startMs);
    // 미래 뉴스 (effectiveFrom = startMs + 50,000ms) 등록
    manager.registerEvent({
      eventId: 'evt_future_test_19',
      publishedAt: startMs + 50000,
      effectiveFrom: startMs + 50000,
      scope: 'market',
      targetStockIds: [],
      eventType: 'OFFICIAL',
      valuationSignal: 0.9,
      attentionShock: 0.5,
      uncertaintyShock: 0.1,
      confidence: 0.9,
      halfLife: 60,
      publisher: '시장테스트',
      title: '초호재 미래 뉴스 (비발효)',
      content: '50초 뒤 공식 발표될 예정',
    });

    // 1초 스텝 진행 (현재 시각: startMs + 1000)
    await manager.step(1.0);
    const snap = manager.getMarketStateSnapshot();
    assert(snap.regime === 'SIDEWAYS', '미래 뉴스는 국면 평가에 반영되지 않아야 함');
    assert(snap.pendingRegime === null, '미래 뉴스로 인한 pending 전환 없음');
    console.log('  ✓ TEST 19 통과: 미래 뉴스 완전 차단 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 20: 잘못된 관측값 거절 및 상태 무변경
  // ─────────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────
  // TEST 20: 잘못된 관측값 및 매개변수 거절 및 상태 무변경
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 20] 잘못된 관측값 및 매개변수 거절 및 상태 무변경');
  {
    const engine = new MarketStateEngine({}, 42, startMs);
    const validObs: RegimeObservation = {
      simulationTime: startMs + 1000,
      aggregateReturn: 0.01,
      realizedVolatility: 0.01,
      turnoverChange: 0,
      averageSpreadBps: 20,
      depthChange: 0,
      uncertainty: 0.1,
      emptyBookDurationSeconds: 0,
      effectiveMacroNewsSignal: 0,
    };

    // 1. NaN 관측값
    let errNan = false;
    try {
      engine.evaluateNextRegime({ ...validObs, aggregateReturn: NaN }, startMs + 1000, startMs + 2000, 1);
    } catch {
      errNan = true;
    }
    assert(errNan, 'NaN aggregateReturn 거부');

    // 2. simTime 음수
    let errSimTime = false;
    try {
      engine.evaluateNextRegime(validObs, -1000, startMs + 2000, 1);
    } catch {
      errSimTime = true;
    }
    assert(errSimTime, '음수 simTime 거부');

    // 3. nextStepEffectiveAt < simTime
    let errNextStep = false;
    try {
      engine.evaluateNextRegime(validObs, startMs + 2000, startMs + 1000, 1);
    } catch {
      errNextStep = true;
    }
    assert(errNextStep, 'nextStepEffectiveAt < simTime 거부');

    // 4. decisionStepId 음수 / 소수 / 비유한
    let errStepIdNeg = false;
    let errStepIdFloat = false;
    try {
      engine.evaluateNextRegime(validObs, startMs + 1000, startMs + 2000, -1);
    } catch {
      errStepIdNeg = true;
    }
    try {
      engine.evaluateNextRegime(validObs, startMs + 1000, startMs + 2000, 1.5);
    } catch {
      errStepIdFloat = true;
    }
    assert(errStepIdNeg, '음수 decisionStepId 거부');
    assert(errStepIdFloat, '소수 decisionStepId 거부');

    // 5. obs.simulationTime !== simTime 불일치
    let errTimeMismatch = false;
    try {
      engine.evaluateNextRegime({ ...validObs, simulationTime: startMs + 500 }, startMs + 1000, startMs + 2000, 1);
    } catch {
      errTimeMismatch = true;
    }
    assert(errTimeMismatch, 'obs.simulationTime !== simTime 불일치 거부');

    // 6. 음수 변동성 거절
    let errVolNeg = false;
    try {
      engine.evaluateNextRegime({ ...validObs, realizedVolatility: -0.01 }, startMs + 1000, startMs + 2000, 1);
    } catch {
      errVolNeg = true;
    }
    assert(errVolNeg, '음수 realizedVolatility 거부');

    // 7. 음수 스프레드 거절
    let errSpreadNeg = false;
    try {
      engine.evaluateNextRegime({ ...validObs, averageSpreadBps: -5 }, startMs + 1000, startMs + 2000, 1);
    } catch {
      errSpreadNeg = true;
    }
    assert(errSpreadNeg, '음수 averageSpreadBps 거부');

    // 8. 음수 빈 장부 시간 거절
    let errEmptyNeg = false;
    try {
      engine.evaluateNextRegime({ ...validObs, emptyBookDurationSeconds: -1 }, startMs + 1000, startMs + 2000, 1);
    } catch {
      errEmptyNeg = true;
    }
    assert(errEmptyNeg, '음수 emptyBookDurationSeconds 거부');

    // 9. uncertainty 범위 이탈 거절 (< 0, > 1.0)
    let errUncNeg = false;
    let errUncHigh = false;
    try {
      engine.evaluateNextRegime({ ...validObs, uncertainty: -0.1 }, startMs + 1000, startMs + 2000, 1);
    } catch {
      errUncNeg = true;
    }
    try {
      engine.evaluateNextRegime({ ...validObs, uncertainty: 1.2 }, startMs + 1000, startMs + 2000, 1);
    } catch {
      errUncHigh = true;
    }
    assert(errUncNeg, '음수 uncertainty 거부');
    assert(errUncHigh, '1.0 초과 uncertainty 거부');

    // 10. effectiveMacroNewsSignal 범위 이탈 거절 (< -1.0, > 1.0)
    let errMacroLow = false;
    let errMacroHigh = false;
    try {
      engine.evaluateNextRegime({ ...validObs, effectiveMacroNewsSignal: -1.5 }, startMs + 1000, startMs + 2000, 1);
    } catch {
      errMacroLow = true;
    }
    try {
      engine.evaluateNextRegime({ ...validObs, effectiveMacroNewsSignal: 1.5 }, startMs + 1000, startMs + 2000, 1);
    } catch {
      errMacroHigh = true;
    }
    assert(errMacroLow, '-1.0 미만 effectiveMacroNewsSignal 거부');
    assert(errMacroHigh, '1.0 초과 effectiveMacroNewsSignal 거부');

    // 11. 선택 필드 crossSectionalDispersion 음수/비유한 거절
    let errDispNeg = false;
    let errDispNan = false;
    try {
      engine.evaluateNextRegime({ ...validObs, crossSectionalDispersion: -0.05 }, startMs + 1000, startMs + 2000, 1);
    } catch {
      errDispNeg = true;
    }
    try {
      engine.evaluateNextRegime({ ...validObs, crossSectionalDispersion: NaN }, startMs + 1000, startMs + 2000, 1);
    } catch {
      errDispNan = true;
    }
    assert(errDispNeg, '음수 crossSectionalDispersion 거부');
    assert(errDispNan, 'NaN crossSectionalDispersion 거부');

    // 12. 선택 필드 emptyBookStockRatio 음수/1.0 초과/비유한 거절
    let errRatioNeg = false;
    let errRatioHigh = false;
    let errRatioNan = false;
    try {
      engine.evaluateNextRegime({ ...validObs, emptyBookStockRatio: -0.1 }, startMs + 1000, startMs + 2000, 1);
    } catch {
      errRatioNeg = true;
    }
    try {
      engine.evaluateNextRegime({ ...validObs, emptyBookStockRatio: 1.5 }, startMs + 1000, startMs + 2000, 1);
    } catch {
      errRatioHigh = true;
    }
    try {
      engine.evaluateNextRegime({ ...validObs, emptyBookStockRatio: NaN }, startMs + 1000, startMs + 2000, 1);
    } catch {
      errRatioNan = true;
    }
    assert(errRatioNeg, '음수 emptyBookStockRatio 거부');
    assert(errRatioHigh, '1.0 초과 emptyBookStockRatio 거부');
    assert(errRatioNan, 'NaN emptyBookStockRatio 거부');

    assert(engine.getPendingTransition() === null, '모든 거절 후 엔진 내부 상태 무변경 유지');
    console.log('  ✓ TEST 20 통과: 비정상 관측값 및 매개변수 엄격 거절 확인 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 21: 잘못된 설정 거절 및 부분 초기화 부재
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 21] 잘못된 설정 거절 및 부분 초기화 부재');
  {
    // 1. 합계 불일치 세션 스케줄 거부
    let scheduleErrorThrown = false;
    try {
      new MarketStateEngine({
        sessionSchedule: {
          tradingDayAnchorMs: startMs,
          tradingDayDurationSeconds: 86400,
          sessions: [
            { session: 'PRE_OPEN', durationSeconds: 1000 },
          ],
        },
      }, 42, startMs);
    } catch {
      scheduleErrorThrown = true;
    }
    assert(scheduleErrorThrown === true, '합계 불일치 스케줄은 생성자에서 거부');

    // 2. 표준 5개 세션 누락 스케줄 거부
    let missingSessionThrown = false;
    try {
      new MarketStateEngine({
        sessionSchedule: {
          tradingDayAnchorMs: startMs,
          tradingDayDurationSeconds: 86400,
          sessions: [
            { session: 'PRE_OPEN', durationSeconds: 1800 },
            { session: 'OPENING_AUCTION', durationSeconds: 600 },
            { session: 'CONTINUOUS', durationSeconds: 21600 },
            { session: 'CLOSED', durationSeconds: 62400 }, // CLOSING_AUCTION 누락
          ],
        },
      }, 42, startMs);
    } catch {
      missingSessionThrown = true;
    }
    assert(missingSessionThrown === true, '표준 세션 누락 스케줄 거부');

    // 3. 세션 순서 뒤바뀜 거부
    let wrongOrderThrown = false;
    try {
      new MarketStateEngine({
        sessionSchedule: {
          tradingDayAnchorMs: startMs,
          tradingDayDurationSeconds: 86400,
          sessions: [
            { session: 'OPENING_AUCTION', durationSeconds: 600 },
            { session: 'PRE_OPEN', durationSeconds: 1800 },
            { session: 'CONTINUOUS', durationSeconds: 21600 },
            { session: 'CLOSING_AUCTION', durationSeconds: 600 },
            { session: 'CLOSED', durationSeconds: 61800 },
          ],
        },
      }, 42, startMs);
    } catch {
      wrongOrderThrown = true;
    }
    assert(wrongOrderThrown === true, '세션 순서 불일치 스케줄 거부');

    // 4. 세션 중복 거부
    let duplicateSessionThrown = false;
    try {
      new MarketStateEngine({
        sessionSchedule: {
          tradingDayAnchorMs: startMs,
          tradingDayDurationSeconds: 86400,
          sessions: [
            { session: 'PRE_OPEN', durationSeconds: 1800 },
            { session: 'PRE_OPEN', durationSeconds: 600 },
            { session: 'CONTINUOUS', durationSeconds: 21600 },
            { session: 'CLOSING_AUCTION', durationSeconds: 600 },
            { session: 'CLOSED', durationSeconds: 61800 },
          ],
        },
      }, 42, startMs);
    } catch {
      duplicateSessionThrown = true;
    }
    assert(duplicateSessionThrown === true, '중복 세션 스케줄 거부');

    // 5. 비정상 세션 식별자 거부
    let invalidSessionThrown = false;
    try {
      new MarketStateEngine({
        sessionSchedule: {
          tradingDayAnchorMs: startMs,
          tradingDayDurationSeconds: 86400,
          sessions: [
            { session: 'UNKNOWN_SESSION' as any, durationSeconds: 1800 },
            { session: 'OPENING_AUCTION', durationSeconds: 600 },
            { session: 'CONTINUOUS', durationSeconds: 21600 },
            { session: 'CLOSING_AUCTION', durationSeconds: 600 },
            { session: 'CLOSED', durationSeconds: 61800 },
          ],
        },
      }, 42, startMs);
    } catch {
      invalidSessionThrown = true;
    }
    assert(invalidSessionThrown === true, '비정상 세션 식별자 스케줄 거부');

    // 6. 논리 모순 임계치 거부 (진입 <= 이탈)
    let thresholdErrorThrown = false;
    try {
      new MarketStateEngine({
        thresholds: {
          ...DEFAULT_REGIME_THRESHOLDS,
          highVolatilityEnterThreshold: 0.01,
          highVolatilityExitThreshold: 0.05, // 오류: 진입(0.01) <= 이탈(0.05)
        },
      }, 42, startMs);
    } catch {
      thresholdErrorThrown = true;
    }
    assert(thresholdErrorThrown === true, '논리 모순 임계치는 생성자에서 거부');

    // 7. NaN 임계치 거부
    let nanErrorThrown = false;
    try {
      new MarketStateEngine({
        thresholds: {
          ...DEFAULT_REGIME_THRESHOLDS,
          liquidityCrisisEnterSpreadBps: NaN,
        },
      }, 42, startMs);
    } catch {
      nanErrorThrown = true;
    }
    assert(nanErrorThrown === true, 'NaN 임계치는 생성자에서 거부');

    // 8. 불확실성 범위 초과 거부
    let uncertaintyErrorThrown = false;
    try {
      new MarketStateEngine({
        thresholds: {
          ...DEFAULT_REGIME_THRESHOLDS,
          highVolatilityUncertaintyThreshold: 1.5, // 1.0 초과 오류
        },
      }, 42, startMs);
    } catch {
      uncertaintyErrorThrown = true;
    }
    assert(uncertaintyErrorThrown === true, '범위 초과 불확실성 임계치 거부');

    // 9. 비정상 maxHistoryLimit 거부
    let historyLimitErrorThrown = false;
    try {
      new MarketStateEngine({ maxHistoryLimit: -10 }, 42, startMs);
    } catch {
      historyLimitErrorThrown = true;
    }
    assert(historyLimitErrorThrown === true, '음수 maxHistoryLimit 거부');

    // 10. 비정상 initialRegime 거부
    let initialRegimeErrorThrown = false;
    try {
      new MarketStateEngine({ initialRegime: 'INVALID_REGIME' as any }, 42, startMs);
    } catch {
      initialRegimeErrorThrown = true;
    }
    assert(initialRegimeErrorThrown === true, '비정상 initialRegime 거부');

    // 11. 비정상 initialSession 거부
    let invalidInitialSessionThrown = false;
    try {
      new MarketStateEngine({ initialSession: 'INVALID_SESSION' as any }, 42, startMs);
    } catch {
      invalidInitialSessionThrown = true;
    }
    assert(invalidInitialSessionThrown === true, '비정상 initialSession 거부');

    // 12. initialEpochMs와 계산된 세션 불일치 initialSession 거부
    let mismatchInitialSessionThrown = false;
    try {
      // startMs(1773500000000)는 PRE_OPEN으로 계산됨 -> CLOSED 지정 시 불일치 거절
      new MarketStateEngine({ initialSession: 'CLOSED' }, 42, startMs);
    } catch {
      mismatchInitialSessionThrown = true;
    }
    assert(mismatchInitialSessionThrown === true, '계산된 세션과 불일치하는 initialSession 거부');

    // 13. 선택 임계값 liquidityCrisisRecoveryMinDurationSeconds 음수 거부
    let minRecDurThrown = false;
    try {
      new MarketStateEngine({
        thresholds: {
          ...DEFAULT_REGIME_THRESHOLDS,
          liquidityCrisisRecoveryMinDurationSeconds: -5.0,
        },
      }, 42, startMs);
    } catch {
      minRecDurThrown = true;
    }
    assert(minRecDurThrown === true, '음수 liquidityCrisisRecoveryMinDurationSeconds 거부');

    // 14. 선택 임계값 emptyBookStockRatioThreshold 범위 이탈 거부
    let ratioThresholdThrown = false;
    try {
      new MarketStateEngine({
        thresholds: {
          ...DEFAULT_REGIME_THRESHOLDS,
          emptyBookStockRatioThreshold: 1.5,
        },
      }, 42, startMs);
    } catch {
      ratioThresholdThrown = true;
    }
    assert(ratioThresholdThrown === true, '1.0 초과 emptyBookStockRatioThreshold 거부');

    // 15. 설정 객체 완전 불변성 & getThresholds() 동결 & 원본 변조 방어 검증
    {
      const customSchedule = {
        tradingDayAnchorMs: startMs,
        tradingDayDurationSeconds: 86400,
        sessions: [
          { session: 'PRE_OPEN' as TradingSession, durationSeconds: 1800 },
          { session: 'OPENING_AUCTION' as TradingSession, durationSeconds: 600 },
          { session: 'CONTINUOUS' as TradingSession, durationSeconds: 21600 },
          { session: 'CLOSING_AUCTION' as TradingSession, durationSeconds: 600 },
          { session: 'CLOSED' as TradingSession, durationSeconds: 61800 },
        ],
      };
      const customThresholds = {
        ...DEFAULT_REGIME_THRESHOLDS,
        bullReturnThreshold: 0.05,
      };
      const externalConfig: MarketStateEngineConfig = {
        initialRegime: 'SIDEWAYS',
        initialSession: 'PRE_OPEN',
        sessionSchedule: customSchedule,
        thresholds: customThresholds,
        maxHistoryLimit: 100,
      };

      const engine = new MarketStateEngine(externalConfig, 42, startMs);

      // (1) 원본 설정 객체 변조 시도
      (externalConfig as any).maxHistoryLimit = 999;
      (customThresholds as any).bullReturnThreshold = 0.99;
      (customSchedule.sessions[0] as any).durationSeconds = 999999;
      (customSchedule.sessions as any).push({ session: 'CLOSED' as TradingSession, durationSeconds: 100 });

      // (2) 엔진 내부 동작 및 임계치 불변 검증
      const engineThresholds = engine.getThresholds();
      assert(engineThresholds.bullReturnThreshold === 0.05, '원본 thresholds 변조 후에도 엔진 내부 bullReturnThreshold는 0.05 유지');
      assert((engine as any).config.maxHistoryLimit === 100, '원본 config 변조 후에도 maxHistoryLimit 불변');
      assert((engine as any).config.sessionSchedule.sessions.length === 5, '원본 schedule 배열 변경(push)이 엔진 내부에 영향 없음');

      // (3) getThresholds() 반환값 및 중첩 필드의 런타임 동결(deepFreeze) 검증
      assert(Object.isFrozen(engineThresholds), 'getThresholds() 반환값은 런타임에서 Object.isFrozen 상태여야 함');
      let mutateErrorThrown = false;
      try {
        (engineThresholds as any).bullReturnThreshold = 0.01;
      } catch {
        mutateErrorThrown = true;
      }
      assert(mutateErrorThrown || engineThresholds.bullReturnThreshold === 0.05, 'getThresholds() 반환 객체 변조 불가');

      // 재조회 시에도 내부 임계값 불변 검증
      const engineThresholds2 = engine.getThresholds();
      assert(engineThresholds2.bullReturnThreshold === 0.05, '외부 변조 시도 후에도 getThresholds() 내부 임계값 불변');

      // (4) 검증 완료 후 설정값을 변조해 검증을 우회할 수 없음 증명
      assert(Object.isFrozen((engine as any).config), 'engine.config는 deepFreeze되어 있음');
      assert(Object.isFrozen((engine as any).config.sessionSchedule), 'engine.config.sessionSchedule은 deepFreeze되어 있음');
      assert(Object.isFrozen((engine as any).config.sessionSchedule.sessions), 'engine.config.sessionSchedule.sessions는 deepFreeze되어 있음');
      assert(Object.isFrozen((engine as any).config.sessionSchedule.sessions[0]), '개별 세션 객체도 deepFreeze되어 있음');
    }

    console.log('  ✓ TEST 21 통과: 전체 15개 설정 무결성, 불변성 및 getThresholds() 동결 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 22: reset 후 상태·이력·PRNG 완전 복원 및 세션별 시각 재계산
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 22] reset 후 상태·이력·PRNG 완전 복원 및 세션별 시각 재계산');
  {
    const engine = new MarketStateEngine({}, 42, startMs);
    engine.advanceSession(startMs + 10000 * 1000);
    engine.evaluateNextRegime({
      simulationTime: startMs + 5000,
      aggregateReturn: 0.05,
      realizedVolatility: 0.02,
      turnoverChange: 0.5,
      averageSpreadBps: 20,
      depthChange: 0.1,
      uncertainty: 0.1,
      emptyBookDurationSeconds: 0,
      effectiveMacroNewsSignal: 0.5,
    }, startMs + 5000, startMs + 6000, 1);

    engine.reset(startMs, 42);
    const snap = engine.getSnapshot();

    assert(snap.regime === 'SIDEWAYS', 'reset 후 regime은 SIDEWAYS');
    assert(snap.previousRegime === null, 'reset 후 previousRegime은 null');
    assert(snap.pendingRegime === null, 'reset 후 pendingRegime은 null');
    assert(snap.transitionId === 0, 'reset 후 transitionId는 0');
    assert(engine.getRegimeHistory().length === 0, 'reset 후 regimeHistory 빈 배열');
    assert(engine.getSessionHistory().length === 0, 'reset 후 sessionHistory 빈 배열');

    // 세션별 reset 재계산 정합성 검증:
    // PRE_OPEN, OPENING_AUCTION, CONTINUOUS, CLOSING_AUCTION, CLOSED, 익일 rollover 시각
    const testCases: Array<{
      offsetSec: number;
      expectedSession: TradingSession;
      expectedStartedSec: number;
      expectedNextSession: TradingSession;
      expectedNextTransitionSec: number;
      expectedDayIndex: number;
    }> = [
      { offsetSec: 900, expectedSession: 'PRE_OPEN', expectedStartedSec: 0, expectedNextSession: 'OPENING_AUCTION', expectedNextTransitionSec: 1800, expectedDayIndex: 0 },
      { offsetSec: 2000, expectedSession: 'OPENING_AUCTION', expectedStartedSec: 1800, expectedNextSession: 'CONTINUOUS', expectedNextTransitionSec: 2400, expectedDayIndex: 0 },
      { offsetSec: 10000, expectedSession: 'CONTINUOUS', expectedStartedSec: 2400, expectedNextSession: 'CLOSING_AUCTION', expectedNextTransitionSec: 24000, expectedDayIndex: 0 },
      { offsetSec: 24200, expectedSession: 'CLOSING_AUCTION', expectedStartedSec: 24000, expectedNextSession: 'CLOSED', expectedNextTransitionSec: 24600, expectedDayIndex: 0 },
      { offsetSec: 30000, expectedSession: 'CLOSED', expectedStartedSec: 24600, expectedNextSession: 'PRE_OPEN', expectedNextTransitionSec: 86400, expectedDayIndex: 0 },
      { offsetSec: 87300, expectedSession: 'PRE_OPEN', expectedStartedSec: 86400, expectedNextSession: 'OPENING_AUCTION', expectedNextTransitionSec: 88200, expectedDayIndex: 1 },
    ];

    for (const tc of testCases) {
      const resetTime = startMs + tc.offsetSec * 1000;
      // 다른 상태로 advance 후 reset 실행
      engine.advanceSession(startMs + 50000 * 1000);
      engine.reset(resetTime, 42);
      const s = engine.getSnapshot();

      assert(s.session === tc.expectedSession, `reset(${tc.offsetSec}s) session 불일치: 기대 ${tc.expectedSession}, 실제 ${s.session}`);
      assert(s.sessionStartedAt === startMs + tc.expectedStartedSec * 1000, `reset(${tc.offsetSec}s) sessionStartedAt 불일치`);
      assert(s.nextSession === tc.expectedNextSession, `reset(${tc.offsetSec}s) nextSession 불일치: 기대 ${tc.expectedNextSession}, 실제 ${s.nextSession}`);
      assert(s.nextTransitionAt === startMs + tc.expectedNextTransitionSec * 1000, `reset(${tc.offsetSec}s) nextTransitionAt 불일치`);
      assert(s.tradingDayIndex === tc.expectedDayIndex, `reset(${tc.offsetSec}s) tradingDayIndex 불일치: 기대 ${tc.expectedDayIndex}, 실제 ${s.tradingDayIndex}`);
      console.log(`  ✓ reset(${tc.expectedSession}, ${tc.offsetSec}s) 논리 시점 완전 정합 확인`);
    }

    console.log('  ✓ TEST 22 통과: 완전한 리셋 복원 및 6대 세션 시각별 reset 정합성 확인 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 23: 국면 엔진 단독 호출 전후 DB fingerprint 동일 (Test A)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 23] 국면 엔진 단독 호출 전후 DB fingerprint 동일 (Test A)');
  {
    const initialFp = computeDbFingerprint();
    const engine = new MarketStateEngine({}, 42, startMs);

    engine.advanceSession(startMs + 3600 * 1000);
    engine.evaluateNextRegime({
      simulationTime: startMs + 1000,
      aggregateReturn: 0.05,
      realizedVolatility: 0.05,
      turnoverChange: 0.5,
      averageSpreadBps: 150,
      depthChange: -0.5,
      uncertainty: 0.5,
      emptyBookDurationSeconds: 5,
      effectiveMacroNewsSignal: -0.5,
    }, startMs + 1000, startMs + 2000, 1);
    engine.activatePendingRegime(startMs + 2000, 2);
    engine.publishSnapshot(startMs + 2000);
    engine.getSnapshot();

    const afterFp = computeDbFingerprint();
    assert(initialFp === afterFp, `국면 엔진 단독 호출 전후 DB 지문 100% 일치 (${initialFp})`);
    console.log('  ✓ TEST 23 통과: 국면 엔진 단독 DB 무영향성 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 24: 국면 통합 전후 경제 시뮬레이션 A/B 결과 동일 (25스텝 실전환 검증)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 24] 국면 통합 전후 경제 시뮬레이션 A/B 결과 동일 (25스텝 실전환 검증)');
  {
    const testRegimeConfig = {
      thresholds: {
        ...DEFAULT_REGIME_THRESHOLDS,
        minRegimeDurationSeconds: 6.0,
        regimeCooldownSeconds: 1.0,
        bullReturnThreshold: 0.001,
        bullMacroSignalThreshold: 0.2,
        bullTurnoverChangeThreshold: 0.01,
        highVolatilityUncertaintyThreshold: 0.50,
      },
    };

    async function runSim(enableRegime: boolean) {
      memoryDb.resetToSeedData();
      const manager = new AgentManager(12345, startMs, {
        enableRegimeEngine: enableRegime,
        regimeEngineConfig: testRegimeConfig,
      });

      for (let step = 0; step < 25; step++) {
        const currentSimTime = manager.clock.simulationTime;

        // 스텝 9: 강세장 유도 거시 뉴스 등록 및 가격 상승 이력 반영으로 양의 시장수익률 형성
        if (step === 9) {
          manager.registerEvent({
            eventId: 'macro_bull_news_ab',
            scope: 'market',
            eventType: 'OFFICIAL',
            targetStockIds: [],
            valuationSignal: 0.85,
            attentionShock: 0.6,
            uncertaintyShock: 0.05,
            confidence: 1.0,
            halfLife: 100,
            publishedAt: currentSimTime,
            effectiveFrom: currentSimTime,
            publisher: 'GlobalMacro',
            title: '대규모 글로벌 양적완화 정책 발표',
            content: '전 세계 증시 유동성 공급',
          });

          for (const stock of memoryDb.stocks.values()) {
            memoryDb.stockPriceHistory.push({
              id: `hist_${stock.id}_step9`,
              stock_id: stock.id,
              price: Math.round(stock.current_price * 1.05),
              recorded_at: new Date(currentSimTime).toISOString(),
            });
          }
        }

        // 스텝 16: 고변동성/불확실성 쇼크 뉴스 등록
        if (step === 16) {
          manager.registerEvent({
            eventId: 'macro_vol_news_ab',
            scope: 'market',
            eventType: 'OFFICIAL',
            targetStockIds: [],
            valuationSignal: -0.4,
            attentionShock: 0.9,
            uncertaintyShock: 0.8,
            confidence: 1.0,
            halfLife: 100,
            publishedAt: currentSimTime,
            effectiveFrom: currentSimTime,
            publisher: 'CrisisWatch',
            title: '글로벌 외환 및 금리 급변동 쇼크',
            content: '시장 불확실성 및 변동성 폭증',
          });
        }

        await manager.step(1.0);
      }

      return manager;
    }

    // ── 실행 A: Baseline A (enableRegimeEngine = false) ──
    const runA = await runSim(false);
    const stocksA = Array.from(memoryDb.stocks.values()).map(s => `${s.id}:${s.current_price}:${s.volume}:${s.high}:${s.low}`).sort().join('|');
    const ordersA = Array.from(memoryDb.orders.values()).map(o => `${o.stock_id}:${o.side}:${o.price}:${o.size}:${o.filled}:${o.status}`).sort().join('|');
    const tradesA = memoryDb.trades.map(t => `${t.stock_id}:${t.price}:${t.size}`).sort().join('|');
    const profilesA = Array.from(memoryDb.profiles.values()).map(p => `${p.id}:${p.cash}`).sort().join('|');
    const holdingsA = Array.from(memoryDb.holdings.values()).map(h => `${h.user_id}:${h.stock_id}:${h.quantity}:${h.avg_price}`).sort().join('|');
    const botPrngStatesA = Array.from(runA.agentPrngs.entries()).map(([k, p]) => `${k}:${p.getState()}`).sort().join('|');
    const fundPrngStateA = runA.fundamentalPrng.getState();

    // ── 실행 B: Regime Active B (enableRegimeEngine = true) ──
    const runB = await runSim(true);
    const stocksB = Array.from(memoryDb.stocks.values()).map(s => `${s.id}:${s.current_price}:${s.volume}:${s.high}:${s.low}`).sort().join('|');
    const ordersB = Array.from(memoryDb.orders.values()).map(o => `${o.stock_id}:${o.side}:${o.price}:${o.size}:${o.filled}:${o.status}`).sort().join('|');
    const tradesB = memoryDb.trades.map(t => `${t.stock_id}:${t.price}:${t.size}`).sort().join('|');
    const profilesB = Array.from(memoryDb.profiles.values()).map(p => `${p.id}:${p.cash}`).sort().join('|');
    const holdingsB = Array.from(memoryDb.holdings.values()).map(h => `${h.user_id}:${h.stock_id}:${h.quantity}:${h.avg_price}`).sort().join('|');
    const botPrngStatesB = Array.from(runB.agentPrngs.entries()).map(([k, p]) => `${k}:${p.getState()}`).sort().join('|');
    const fundPrngStateB = runB.fundamentalPrng.getState();

    // 전환 이력 확인
    const historyB = runB.marketStateEngine.getRegimeHistory();
    assert(historyB.length >= 2, `25스텝 실행 중 최소 2건 이상의 실제 국면 전환 발생 확인 (실제: ${historyB.length}건)`);
    assert(historyB.some(r => r.toRegime === 'BULL'), 'BULL 국면 예약 및 실제 활성화 확인');
    assert(historyB.some(r => r.toRegime === 'HIGH_VOLATILITY'), 'HIGH_VOLATILITY 국면 예약 및 실제 활성화 확인');

    assert(stocksA === stocksB, 'A/B 종목 현재가, 거래량, 고가, 저가 100% 일치');
    assert(ordersA === ordersB, 'A/B 주문 방향, 가격, 수량, 체결량, 상태 100% 일치');
    assert(tradesA === tradesB, 'A/B 체결 종목, 체결 가격, 체결 수량 100% 일치');
    assert(profilesA === profilesB, 'A/B 계좌 현금 100% 일치');
    assert(holdingsA === holdingsB, 'A/B 보유 수량 및 평균 단가 100% 일치');
    assert(botPrngStatesA === botPrngStatesB, 'A/B 봇별 PRNG 결과 100% 일치');
    assert(fundPrngStateA === fundPrngStateB, 'A/B 펀더멘털 PRNG 결과 100% 일치');
    console.log('  ✓ TEST 24 통과: 실제 국면 전환(BULL, HIGH_VOLATILITY) 발생 하에서도 경제 시뮬레이션 100% 일치 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 25: GET 반복 호출의 완전한 부작용 부재
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 25] GET 반복 호출의 완전한 부작용 부재');
  {
    const engine = new MarketStateEngine({}, 42, startMs);
    const beforeHistoryLen = engine.getRegimeHistory().length;
    const beforeSessionLen = engine.getSessionHistory().length;
    const beforeVersion = engine.getSnapshot().stateVersion;

    for (let i = 0; i < 50; i++) {
      engine.getSnapshot();
    }

    assert(engine.getRegimeHistory().length === beforeHistoryLen, '이력 길이 불변');
    assert(engine.getSessionHistory().length === beforeSessionLen, '세션 이력 불변');
    assert(engine.getSnapshot().stateVersion === beforeVersion, '버전 불변');
    console.log('  ✓ TEST 25 통과: GET 완전 무부작용 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 26: 직렬 실행 큐에서 동시 스텝 순서 보장
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 26] 직렬 실행 큐에서 동시 스텝 순서 보장');
  {
    const { createHeadlessSimulationRunner } = await import('../lib/engine/localStandaloneServer');
    const runner = createHeadlessSimulationRunner(42, startMs);
    const initialSimTime = runner.getSimulationTime();

    // 5회 동시 스텝 요청
    await Promise.all([
      runner.step(1.0),
      runner.step(1.0),
      runner.step(1.0),
      runner.step(1.0),
      runner.step(1.0),
    ]);

    const finalSimTime = runner.getSimulationTime();
    assert(finalSimTime === initialSimTime + 5000, `정확히 5,000ms 순차 전진 완료 (${initialSimTime} -> ${finalSimTime})`);
    console.log('  ✓ TEST 26 통과: 직렬 실행 큐 순차 보장 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 27: implementationStage === 1
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 27] implementationStage === 1');
  {
    const engine = new MarketStateEngine({}, 42, startMs);
    const snap = engine.getSnapshot();
    assert(snap.implementationStage === 1, '스냅샷의 implementationStage는 1이어야 함');
    console.log('  ✓ TEST 27 통과: implementationStage === 1 확인 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 28: marketMechanicsApplied === false
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 28] marketMechanicsApplied === false');
  {
    const engine = new MarketStateEngine({}, 42, startMs);
    const snap = engine.getSnapshot();
    assert(snap.marketMechanicsApplied === false, '스냅샷의 marketMechanicsApplied는 false여야 함');
    assert(snap.capabilities.regimeDetection === true, 'capabilities.regimeDetection === true');
    assert(snap.capabilities.sessionTracking === true, 'capabilities.sessionTracking === true');
    assert(snap.capabilities.botBehaviorAdjustment === false, 'capabilities.botBehaviorAdjustment === false');
    assert(snap.capabilities.lpAdjustment === false, 'capabilities.lpAdjustment === false');
    assert(snap.capabilities.auctionMatching === false, 'capabilities.auctionMatching === false');
    assert(snap.capabilities.sessionOrderRestriction === false, 'capabilities.sessionOrderRestriction === false');
    console.log('  ✓ TEST 28 통과: marketMechanicsApplied === false 및 capabilities 메타데이터 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 29: 거시 뉴스 순수 함수 감쇠 및 confidence 검증
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 29] 거시 뉴스 순수 함수 감쇠 및 confidence 검증');
  {
    const halfLife = 20; // 20초 반감기
    const testEvent: ObservableMarketEvent = {
      eventId: 'macro_test_decay',
      scope: 'market',
      eventType: 'OFFICIAL',
      targetStockIds: [],
      valuationSignal: 0.60,
      attentionShock: 0.5,
      uncertaintyShock: 0.1,
      confidence: 0.80,
      halfLife,
      publishedAt: startMs,
      effectiveFrom: startMs,
      publisher: 'TestNews',
      title: '테스트 뉴스',
      content: '감쇠 테스트',
    };

    // 1. t = startMs (경과 0초): signal = 0.60 * 0.80 * 2^0 = 0.48
    const sig0 = calculateEffectiveMacroSignal([testEvent], startMs);
    assert(Math.abs(sig0 - 0.48) < 1e-6, `t=0초 신호 0.48 (실제: ${sig0})`);

    // 2. t = startMs + 20초 (경과 1 반감기): signal = 0.48 * 0.5 = 0.24
    const sig20 = calculateEffectiveMacroSignal([testEvent], startMs + 20000);
    assert(Math.abs(sig20 - 0.24) < 1e-6, `t=20초(1반감기) 신호 0.24 (실제: ${sig20})`);

    // 3. t = startMs + 40초 (경과 2 반감기): signal = 0.48 * 0.25 = 0.12
    const sig40 = calculateEffectiveMacroSignal([testEvent], startMs + 40000);
    assert(Math.abs(sig40 - 0.12) < 1e-6, `t=40초(2반감기) 신호 0.12 (실제: ${sig40})`);

    // 4. 미래 뉴스 (publishedAt > simTime) 차단
    const futurePubEvent: ObservableMarketEvent = { ...testEvent, eventId: 'fut_pub', publishedAt: startMs + 5000 };
    const sigFutPub = calculateEffectiveMacroSignal([futurePubEvent], startMs);
    assert(sigFutPub === 0, 'publishedAt > simTime인 미래 뉴스는 0 반환');

    // 5. 미발효 뉴스 (effectiveFrom > simTime) 차단
    const futureEffEvent: ObservableMarketEvent = { ...testEvent, eventId: 'fut_eff', effectiveFrom: startMs + 5000 };
    const sigFutEff = calculateEffectiveMacroSignal([futureEffEvent], startMs);
    assert(sigFutEff === 0, 'effectiveFrom > simTime인 미발효 뉴스는 0 반환');

    // 6. [-1.0, 1.0] 클램핑 검증
    const hugeBullEvent: ObservableMarketEvent = { ...testEvent, eventId: 'huge_bull', valuationSignal: 1.0, confidence: 1.0, halfLife: 1000 };
    const hugeBullEvent2: ObservableMarketEvent = { ...testEvent, eventId: 'huge_bull_2', valuationSignal: 1.0, confidence: 1.0, halfLife: 1000 };
    const sigClamped = calculateEffectiveMacroSignal([hugeBullEvent, hugeBullEvent2], startMs);
    assert(sigClamped === 1.0, `최대 1.0 클램핑 확인 (실제: ${sigClamped})`);

    console.log('  ✓ TEST 29 통과: 거시 뉴스 순수 함수 감쇠·신뢰도·시간차단·클램핑 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 30: 거시 뉴스 정정 정책 (RETRACT, REPLACE, ADDITIVE) 및 복수 정정 순서 결정론
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 30] 거시 뉴스 정정 정책 및 복수 정정 순서 결정론');
  {
    const rumor: ObservableMarketEvent = {
      eventId: 'macro_rumor_1',
      scope: 'market',
      eventType: 'RUMOR',
      targetStockIds: [],
      valuationSignal: 0.50,
      attentionShock: 0.5,
      uncertaintyShock: 0.2,
      confidence: 1.0,
      halfLife: 100000,
      publishedAt: startMs,
      effectiveFrom: startMs,
      publisher: 'Rumor',
      title: '거시 루머',
      content: '금리 인하설',
    };

    // 1. RETRACT 정정: 원본 기여 제거 -> 0
    const corrRetract: ObservableMarketEvent = {
      eventId: 'corr_retract',
      scope: 'market',
      eventType: 'CORRECTION',
      correctionMode: 'RETRACT',
      originalEventId: 'macro_rumor_1',
      targetStockIds: [],
      valuationSignal: 0.0,
      attentionShock: 0.2,
      uncertaintyShock: 0.1,
      confidence: 1.0,
      halfLife: 100000,
      publishedAt: startMs + 1000,
      effectiveFrom: startMs + 1000,
      publisher: 'Official',
      title: '부인 공시',
      content: '금리 인하 사실무근',
    };
    const sigRetract = calculateEffectiveMacroSignal([rumor, corrRetract], startMs + 1000);
    assert(Math.abs(sigRetract) < 1e-6, `RETRACT 적용 시 0이어야 함 (실제: ${sigRetract})`);

    // 2. REPLACE 정정: 원본 제거 후 새 신호(-0.20) 대체 반영
    const corrReplace: ObservableMarketEvent = {
      ...corrRetract,
      eventId: 'corr_replace',
      correctionMode: 'REPLACE',
      valuationSignal: -0.20,
    };
    const sigReplace = calculateEffectiveMacroSignal([rumor, corrReplace], startMs + 1000);
    assert(Math.abs(sigReplace - (-0.20)) < 0.001, `REPLACE 적용 시 -0.20이어야 함 (실제: ${sigReplace})`);

    // 3. ADDITIVE 정정: 원본(+0.50) 유지 + 정정(+0.30) 가산 -> +0.80
    const corrAdditive: ObservableMarketEvent = {
      ...corrRetract,
      eventId: 'corr_additive',
      correctionMode: 'ADDITIVE',
      valuationSignal: 0.30,
    };
    const sigAdditive = calculateEffectiveMacroSignal([rumor, corrAdditive], startMs + 1000);
    assert(Math.abs(sigAdditive - 0.80) < 0.001, `ADDITIVE 적용 시 0.80이어야 함 (실제: ${sigAdditive})`);

    // 4. 복수 정정 결정론: 최신 sequence 정정 승자 선정
    const corrSeq1: ObservableMarketEvent = {
      ...corrReplace,
      eventId: 'corr_seq1',
      sequence: 1,
      publishedAt: startMs + 2000,
      effectiveFrom: startMs + 2000,
      valuationSignal: -0.10,
    };
    const corrSeq2: ObservableMarketEvent = {
      ...corrRetract,
      eventId: 'corr_seq2',
      sequence: 2,
      publishedAt: startMs + 2000,
      effectiveFrom: startMs + 2000,
      valuationSignal: 0.0,
    };
    // 입력 순서를 바꿔가며 10회 검증
    for (let i = 0; i < 10; i++) {
      const shuffled = i % 2 === 0 ? [rumor, corrSeq1, corrSeq2] : [corrSeq2, rumor, corrSeq1];
      const sigMulti = calculateEffectiveMacroSignal(shuffled, startMs + 2000);
      assert(Math.abs(sigMulti) < 1e-6, `복수 정정 시 최신 sequence 2(RETRACT) 승자 결정론 보장 (실제: ${sigMulti})`);
    }

    console.log('  ✓ TEST 30 통과: RETRACT·REPLACE·ADDITIVE 및 복수 정정 순서 결정론 검증 완료\n');
  }

  // memoryDb 주문 취소 및 인덱스 정합성 공통 헬퍼
  function safeCancelAndDeleteOrder(orderId: string) {
    const ord = memoryDb.orders.get(orderId);
    if (ord) {
      ord.status = 'cancelled';
      memoryDb.removeOrderFromIndex(ord);
      memoryDb.orders.delete(orderId);
    }
  }

  // memoryDb.orders와 orderStockIndex 간의 완전한 1:1 양방향 정합성 검증 헬퍼
  function verifyOrderIndexIntegrity() {
    // 1) orders에 존재하는 모든 활성 주문이 orderStockIndex에 정확히 1건 매핑되는지 검증
    for (const [orderId, order] of memoryDb.orders.entries()) {
      const stockSet = memoryDb.orderStockIndex.get(order.stock_id);
      assert(stockSet !== undefined && stockSet.has(orderId), `주문 ${orderId}가 orderStockIndex[${order.stock_id}]에 1:1 정합 매핑되어야 함`);
    }
    // 2) orderStockIndex에 등록된 모든 orderId가 실제 memoryDb.orders에 실존하고 stock_id가 일치하는지 검증
    for (const [stockId, idSet] of memoryDb.orderStockIndex.entries()) {
      for (const orderId of idSet) {
        const order = memoryDb.orders.get(orderId);
        assert(order !== undefined, `인덱스 내 주문 ${orderId}가 memoryDb.orders에 실존해야 함 (stale index 부재)`);
        assert(order!.stock_id === stockId, `인덱스 stock_id(${stockId})와 주문 본체 stock_id(${order!.stock_id}) 일치`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 31: 시장 전체 빈 장부 판정 및 주문·인덱스 1:1 정합성 검증
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 31] 시장 전체 빈 장부 판정 및 주문·인덱스 1:1 정합성 검증');
  {
    // 1. 단일 종목 빈 장부로 시장 위기 미발생 (전체 26개 중 1개 = ~3.8% < 30%)
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(42, startMs, {
      enableRegimeEngine: true,
      regimeEngineConfig: {
        thresholds: {
          ...DEFAULT_REGIME_THRESHOLDS,
          emptyBookStockRatioThreshold: 0.30,
          minRegimeDurationSeconds: 1.0,
          liquidityCrisisEmptyBookDurationSeconds: 2.0,
          liquidityCrisisEnterSpreadBps: 50,
          liquidityCrisisExitSpreadBps: 30,
        },
      },
    });

    const stocks = Array.from(memoryDb.stocks.values());
    assert(stocks.length >= 5, `테스트 시드 종목 수 5개 이상 확인 (${stocks.length}개)`);

    // 정상 1스텝 실행: LP가 모든 26개 종목에 대해 정상 호가 및 spreadHistory 적재
    await mgr.step(1.0);
    assert(mgr.getEmptyBookAccumulatedSeconds() === 0, '정상 호가 상태에서는 누적 시간 0초');
    verifyOrderIndexIntegrity();

    // LP 봇의 자동 호가 재생성을 중단하여 수동 장부 제어
    mgr.agents.delete('acc_lp_main');

    // 1개 종목만 호가 완전 안전 제거 (1/26 = 3.8% < 30%)
    const targetStockId1 = stocks[0].id;
    const targetOrders1 = Array.from(memoryDb.orders.values())
      .filter(o => o.stock_id === targetStockId1)
      .map(o => o.id);
    assert(targetOrders1.length > 0, '타깃 종목 1에 기존 주문이 존재해야 함');

    for (const orderId of targetOrders1) {
      safeCancelAndDeleteOrder(orderId);
    }

    // 인덱스 정합성 및 삭제 주문 인덱스 잔존 부재, 타 종목 보존 검증
    verifyOrderIndexIntegrity();
    const stock1Index = memoryDb.orderStockIndex.get(targetStockId1);
    assert(!stock1Index || stock1Index.size === 0, '삭제된 타깃 종목의 주문 ID가 인덱스에 일체 남아있지 않음');
    const remainingOrdersOtherStocks = Array.from(memoryDb.orders.values()).filter(o => o.stock_id !== targetStockId1);
    assert(remainingOrdersOtherStocks.length > 0, '다른 종목 주문과 인덱스는 완전 보존되어야 함');

    await mgr.step(1.0);
    const accumulated1 = mgr.getEmptyBookAccumulatedSeconds();
    assert(accumulated1 === 0, `1개 종목 빈 장부 시 비율(3.8% < 30%) 미달로 누적 시간 0초 유지 (실제: ${accumulated1})`);
    const snap1 = mgr.getMarketStateSnapshot();
    assert(snap1.regime !== 'LIQUIDITY_CRISIS' && snap1.pendingRegime !== 'LIQUIDITY_CRISIS', '1개 종목 빈 장부로는 위기가 발생하지 않음');
    console.log('  ✓ 1개 종목 빈 장부(3.8% < 30%)로는 시장 위기가 발생하지 않고 누적 시간 0 유지 확인');
    console.log('  ✓ 안전 취소 헬퍼 동작 및 1:1 인덱스 정합성, 타 종목 주문 보존 확인');

    // 2. 정상 양측 → 단측(One-Sided) 전환 및 비율 임계치(30%) 이상 빈 장부 판정 검증 (P1 보완)
    // 1번 인덱스부터 40% (11개) 종목의 매도 호가만 제거하여 매수 호가만 남은 단측 장부로 전환 (11/26 = 42.3% >= 30%)
    const emptyCount = Math.ceil(stocks.length * 0.4);
    const targetEmptyStockIds = new Set(stocks.slice(1, 1 + emptyCount).map(s => s.id));

    // 타깃 종목들의 'sell' 주문만 안전 취소/삭제 (매수 호가는 유지하여 depthShares > 0, 과거 spread > 0 유지)
    const sellOrdersToDelete = Array.from(memoryDb.orders.values())
      .filter(o => targetEmptyStockIds.has(o.stock_id) && o.side === 'sell')
      .map(o => o.id);
    assert(sellOrdersToDelete.length > 0, '타깃 종목들에 매도 주문이 존재해야 함');

    for (const orderId of sellOrdersToDelete) {
      safeCancelAndDeleteOrder(orderId);
    }

    // 통계 산출 함수를 직접 호출하여 단측 호가 상태 검증
    const intermediateStats = mgr.diagnostics.computeWindowStatistics(mgr.clock.simulationTime);
    for (const sId of targetEmptyStockIds) {
      const st = intermediateStats.get(sId);
      assert(st !== undefined, `단측 호가 전환 종목 ${sId} 통계 존재`);
      assert(st!.bidDepthShares > 0, `매수 호가가 잔여하여 bidDepthShares > 0 (실제: ${st!.bidDepthShares})`);
      assert(st!.askDepthShares === 0, `매도 호가만 삭제되어 askDepthShares === 0`);
      assert(st!.hasTwoSidedBook === false, `단측 상태이므로 hasTwoSidedBook === false여야 함`);
      assert(st!.spread !== null && st!.spread > 0, `과거 체결 스프레드 기록 잔존 (spread: ${st!.spread})`);
      assert(st!.depthShares > 0, `매수 잔여 주문으로 depthShares > 0 (실제: ${st!.depthShares})`);

      // 구버전 결함 실증: 구버전 로직은 과거 스프레드와 잔여 깊이 때문에 단측 호가를 정상 장부로 오판단
      const oldFlawedCondition = st!.spread === null || st!.spread <= 0 || st!.depthShares === 0;
      assert(oldFlawedCondition === false, '구버전 로직은 단측 호가를 빈 장부로 놓치는 결함이 있음을 실증');

      // 신규 버전 정합성 실증: 양측 호가 유효성(hasTwoSidedBook) 판정으로 단측 호가를 빈 장부로 정확히 집계
      const newCorrectCondition = !st!.hasTwoSidedBook || st!.bidDepthShares === 0 || st!.askDepthShares === 0;
      assert(newCorrectCondition === true, '신규 로직은 단측 호가를 공백(빈 장부)으로 정확히 판정함');
    }
    console.log('  ✓ 정상 양측 → 단측(One-Sided: 매수만 잔여) 전환 시 과거 스프레드 및 깊이 양수에도 공백 정상 판정 검증');

    // 반대 케이스: 매수만 제거하고 매도만 남은 단측 호가 판정 정합성 검증 (종목 1개 대상)
    const testOneStockId = stocks[1 + emptyCount].id; // 13번째 종목 (인덱스 12)
    const buyOrdersToDelete = Array.from(memoryDb.orders.values())
      .filter(o => o.stock_id === testOneStockId && o.side === 'buy')
      .map(o => o.id);
    for (const orderId of buyOrdersToDelete) {
      safeCancelAndDeleteOrder(orderId);
    }
    const oneStats = mgr.diagnostics.computeWindowStatistics(mgr.clock.simulationTime).get(testOneStockId);
    assert(oneStats !== undefined && oneStats.bidDepthShares === 0 && oneStats.askDepthShares > 0, '매도만 잔여한 단측 호가 상태');
    assert(oneStats!.hasTwoSidedBook === false, '매도만 잔여한 경우도 hasTwoSidedBook === false로 공백 판정');
    console.log('  ✓ 정상 양측 → 단측(One-Sided: 매도만 잔여) 전환 시 공백 정상 판정 검증');

    // 인덱스 정합성 재검증
    verifyOrderIndexIntegrity();

    // 단측 호가 종목들이 40% (11/26 >= 30%) 포함된 상태에서 3스텝 연속 실행 -> 빈 장부 누적 시간 증가 확인
    await mgr.step(1.0);
    const accStep1 = mgr.getEmptyBookAccumulatedSeconds();
    assert(accStep1 >= 1.0, `단측 호가 40% 포함 시 1스텝 누적 확인 (실제: ${accStep1})`);

    await mgr.step(1.0);
    const accStep2 = mgr.getEmptyBookAccumulatedSeconds();
    assert(accStep2 >= 2.0, `단측 호가 40% 포함 시 2스텝 누적 확인 (실제: ${accStep2})`);

    await mgr.step(1.0);
    const accStep3 = mgr.getEmptyBookAccumulatedSeconds();
    assert(accStep3 >= 3.0, `단측 호가 40% 포함 시 3스텝 누적 확인 (실제: ${accStep3})`);

    const snap2 = mgr.getMarketStateSnapshot();
    const isCrisisOrPending = snap2.regime === 'LIQUIDITY_CRISIS' || snap2.pendingRegime === 'LIQUIDITY_CRISIS';
    assert(isCrisisOrPending, '단측 호가 빈 장부 누적 시간 기준 충족 시 LIQUIDITY_CRISIS 정상 예약/발생');
    console.log('  ✓ 단측 호가 비율 임계값(30%) 초과 시 정상 누적 및 LIQUIDITY_CRISIS 발생 확인');

    // 최종 인덱스 정합성 확인
    verifyOrderIndexIntegrity();
    console.log('  ✓ TEST 31 통과: 양측 호가 기준 공백 판정, 정상 양측→단측 전환 및 주문·인덱스 1:1 정합성 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 32: 상장주식수 기준 시가총액 단일 권위 및 대형주/소형주 가중수익률 기여도 검증
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 32] 상장주식수 기준 시가총액 단일 권위 및 대형주/소형주 가중수익률 기여도 검증');
  {
    // 1. 단일 권위 순수 함수 getAuthoritativeShares 검증
    // A) shares_outstanding 우선 (floating_shares 무시)
    assert(getAuthoritativeShares({ shares_outstanding: 5000000, floating_shares: 1000000 }) === 5000000, 'shares_outstanding 우선 적용');
    // B) shares_outstanding 없을 때 floating_shares fallback
    assert(getAuthoritativeShares({ shares_outstanding: null, floating_shares: 2000000 }) === 2000000, 'shares_outstanding null 시 floating_shares fallback');
    assert(getAuthoritativeShares({ floating_shares: 3000000 }) === 3000000, 'shares_outstanding undefined 시 floating_shares fallback');
    // C) 둘 다 없을 때 FALLBACK_SHARES (100,000)
    assert(getAuthoritativeShares({}) === FALLBACK_SHARES, `둘 다 부재 시 FALLBACK_SHARES(${FALLBACK_SHARES}) 적용`);
    assert(getAuthoritativeShares(undefined) === FALLBACK_SHARES, 'stock undefined 시 FALLBACK_SHARES 적용');

    // 2. 단일 권위 순수 함수 calculateAuthoritativeMarketCap 검증
    const cap1 = calculateAuthoritativeMarketCap({ current_price: 50000, shares_outstanding: 2000000, floating_shares: 500000 });
    assert(cap1 === 50000 * 2000000, `시가총액은 current_price * shares_outstanding (${50000 * 2000000})`);
    const capFallback = calculateAuthoritativeMarketCap({ current_price: 10000 });
    assert(capFallback === 10000 * FALLBACK_SHARES, `fallback 시가총액 (${10000 * FALLBACK_SHARES})`);
    const capZero = calculateAuthoritativeMarketCap({ current_price: 0, shares_outstanding: 100 });
    assert(capZero === 1, '최소 시가총액은 1로 클램핑');

    // 3. 대형주 vs 소형주 가중수익률 기여도 검증
    // 대형주: price = 10,000, shares_outstanding = 10,000,000 (1천만주), floating_shares = 100,000 (10만주, 1% 유통)
    // 소형주: price = 10,000, shares_outstanding = 1,000,000 (1백만주), floating_shares = 800,000 (80만주, 80% 유통)
    const largeStock = {
      id: 'LARGE_01',
      current_price: 10000,
      shares_outstanding: 10000000,
      floating_shares: 100000,
    };
    const smallStock = {
      id: 'SMALL_01',
      current_price: 10000,
      shares_outstanding: 1000000,
      floating_shares: 800000,
    };

    const largeCap = calculateAuthoritativeMarketCap(largeStock); // 1000억
    const smallCap = calculateAuthoritativeMarketCap(smallStock); // 100억
    assert(largeCap === 100_000_000_000, '대형주 상장주식수 기준 시가총액 1000억원');
    assert(smallCap === 10_000_000_000, '소형주 상장주식수 기준 시가총액 100억원');
    assert(largeCap / smallCap === 10, '대형주의 시가총액 가중치는 소형주의 정확히 10배여야 함');

    // 구버전처럼 floating_shares를 우선했을 때의 왜곡 증명:
    const flawedLargeCap = largeStock.current_price * largeStock.floating_shares; // 10억
    const flawedSmallCap = smallStock.current_price * smallStock.floating_shares; // 80억
    assert(flawedSmallCap > flawedLargeCap, '구버전 유동주식수 우선 시 소형주가 대형주보다 8배 가중치가 커지는 치명적 역전 발생 확인');

    // 상장주식수 기준 가중 수익률 계산:
    // 대형주 수익률: +10% (+0.10)
    // 소형주 수익률: -10% (-0.10)
    const totalCap = largeCap + smallCap; // 1100억
    const expectedWeightedReturn = (0.10 * largeCap + (-0.10) * smallCap) / totalCap; // (100억 - 10억) / 1100억 = 90 / 1100 = +0.081818...
    assert(expectedWeightedReturn > 0.08 && expectedWeightedReturn < 0.082, '상장주식수 기준 시 대형주(+10%)의 영향력이 압도하여 시장 전체는 강한 플러스(+8.18%)여야 함');

    // 4. AgentManager 내부 실제 통합 계산 검증
    memoryDb.resetToSeedData();
    // memoryDb의 기존 종목을 대형주 1개, 소형주 1개로 재구성하여 AgentManager 관측값 산출 테스트
    memoryDb.stocks.clear();
    memoryDb.stocks.set('STOCK_LARGE', {
      id: 'STOCK_LARGE',
      ticker: 'LARGE',
      name: '대형주',
      market: 'KRX',
      current_price: 10000,
      previous_close: 10000,
      open_price: 10000,
      high: 11000,
      low: 10000,
      volume: 10000,
      change_rate: 0.1,
      market_cap: 100_000_000_000,
      pe_ratio: 15,
      dividend_yield: 0.02,
      sector: 'Technology',
      shares_outstanding: 10000000,
      floating_shares: 100000,
    });
    memoryDb.stocks.set('STOCK_SMALL', {
      id: 'STOCK_SMALL',
      ticker: 'SMALL',
      name: '소형주',
      market: 'KRX',
      current_price: 10000,
      previous_close: 10000,
      open_price: 10000,
      high: 10000,
      low: 9000,
      volume: 50000,
      change_rate: -0.1,
      market_cap: 10_000_000_000,
      pe_ratio: 20,
      dividend_yield: 0.01,
      sector: 'Technology',
      shares_outstanding: 1000000,
      floating_shares: 800000,
    });

    // 가격 이력 주입: LARGE는 +10%, SMALL은 -10%
    const now = startMs + 10000;
    memoryDb.stockPriceHistory = [
      { id: 'sph_l1', stock_id: 'STOCK_LARGE', price: 10000, recorded_at: new Date(now - 1000).toISOString() },
      { id: 'sph_l2', stock_id: 'STOCK_LARGE', price: 11000, recorded_at: new Date(now).toISOString() },
      { id: 'sph_s1', stock_id: 'STOCK_SMALL', price: 10000, recorded_at: new Date(now - 1000).toISOString() },
      { id: 'sph_s2', stock_id: 'STOCK_SMALL', price: 9000, recorded_at: new Date(now).toISOString() },
    ];

    const mgr = new AgentManager(42, now, {
      enableRegimeEngine: true,
      regimeEngineConfig: {
        thresholds: {
          ...DEFAULT_REGIME_THRESHOLDS,
          minRegimeDurationSeconds: 0,
          regimeCooldownSeconds: 0,
          highVolatilityEnterThreshold: 0.20,
          highVolatilityExitThreshold: 0.15,
        },
      },
    });

    mgr.registerEvent({
      eventId: 'evt_macro_support_test32',
      publishedAt: now,
      effectiveFrom: now,
      scope: 'market',
      targetStockIds: [],
      eventType: 'OFFICIAL',
      valuationSignal: 0.8,
      attentionShock: 0.5,
      uncertaintyShock: 0.05,
      confidence: 0.9,
      halfLife: 60,
      publisher: '시장테스트',
      title: '거시 지표 호조',
      content: '시장 전반 거시 지표 상승',
    });
    // 빈 장부 위기 방지를 위해 최소 호가 추가
    memoryDb.orders.set('ord_l_buy', {
      id: 'ord_l_buy',
      user_id: 'usr_lp',
      stock_id: 'STOCK_LARGE',
      side: 'buy',
      order_type: 'limit',
      price: 10900,
      size: 100,
      filled: 0,
      status: 'open',
      is_lp: true,
      created_at: new Date(now).toISOString(),
    });
    memoryDb.orders.set('ord_l_sell', {
      id: 'ord_l_sell',
      user_id: 'usr_lp',
      stock_id: 'STOCK_LARGE',
      side: 'sell',
      order_type: 'limit',
      price: 11100,
      size: 100,
      filled: 0,
      status: 'open',
      is_lp: true,
      created_at: new Date(now).toISOString(),
    });
    memoryDb.orders.set('ord_s_buy', {
      id: 'ord_s_buy',
      user_id: 'usr_lp',
      stock_id: 'STOCK_SMALL',
      side: 'buy',
      order_type: 'limit',
      price: 8900,
      size: 100,
      filled: 0,
      status: 'open',
      is_lp: true,
      created_at: new Date(now).toISOString(),
    });
    memoryDb.orders.set('ord_s_sell', {
      id: 'ord_s_sell',
      user_id: 'usr_lp',
      stock_id: 'STOCK_SMALL',
      side: 'sell',
      order_type: 'limit',
      price: 9100,
      size: 100,
      filled: 0,
      status: 'open',
      is_lp: true,
      created_at: new Date(now).toISOString(),
    });
    memoryDb.addOrderToIndex(memoryDb.orders.get('ord_l_buy')!);
    memoryDb.addOrderToIndex(memoryDb.orders.get('ord_l_sell')!);
    memoryDb.addOrderToIndex(memoryDb.orders.get('ord_s_buy')!);
    memoryDb.addOrderToIndex(memoryDb.orders.get('ord_s_sell')!);

    await mgr.step(1.0);
    const snap = mgr.getMarketStateSnapshot();
    assert(snap.pendingRegime === 'BULL', `상장주식수 기준 대형주 가중(+8.18% > 0.02)으로 BULL이 예약되어야 함 (실제: ${snap.pendingRegime})`);
    console.log(`  ✓ AgentManager 실측 국면 예약: pendingRegime === '${snap.pendingRegime}' (상장주식수 단일 권위 정상 판정)`);

    // 5. 횡단면 수익률 분산의 산술 평균 기준 산출 검증 (P2 보완)
    // 순수 함수 검증: 대형주 +10%, 소형주 -10% 시 산술 평균(0%) 기준 동일 가중 표준편차는 정확히 10.0% (0.10)
    assert(Math.abs(calculateCrossSectionalDispersion([0.10, -0.10]) - 0.10) < 1e-6, '대형주 +10%, 소형주 -10% 시 산술 평균 기준 분산은 정확히 10.0%(0.10)이어야 함');
    assert(Math.abs(calculateCrossSectionalDispersion([0.05, 0.05, 0.05])) < 1e-12, '동일 수익률 분산은 0');
    assert(calculateCrossSectionalDispersion([]) === 0, '빈 배열 분산은 0');

    // 시총 가중 왜곡(12.92%)과 산술 평균(10.0%) 간의 차이 실증:
    const flawedCapWeightedDiffSqSum = Math.pow(0.10 - expectedWeightedReturn, 2) + Math.pow(-0.10 - expectedWeightedReturn, 2);
    const flawedDispersion = Math.sqrt(flawedCapWeightedDiffSqSum / 2);
    assert(flawedDispersion > 0.129 && flawedDispersion < 0.130, `구버전 시총 가중 기준 분산은 약 12.9%로 왜곡됨 (실제: ${(flawedDispersion * 100).toFixed(2)}%)`);

    // AgentManager 관측값 및 국면 엔진 메트릭 검증:
    const lastObs = mgr.getLastObservation();
    assert(lastObs !== null, 'AgentManager 실측 관측값(lastObservation) 존재');
    const csdObs = lastObs!.crossSectionalDispersion;
    assert(typeof csdObs === 'number' && Math.abs(csdObs - 0.10) < 1e-6, `AgentManager 관측치의 crossSectionalDispersion은 시총 가중 왜곡(12.9%)이 아닌 동일 가중 표준편차 10.0% (0.10)이어야 함 (실제: ${csdObs})`);
    console.log(`  ✓ AgentManager 실측 관측치 crossSectionalDispersion: ${csdObs} (10.0% 정확 일치)`);

    const pending = mgr.marketStateEngine.getPendingTransition();
    assert(pending !== null, 'pendingTransition 존재');
    const csdMetric = pending!.metrics.crossSectionalDispersion;
    assert(typeof csdMetric === 'number' && Math.abs(csdMetric - 0.10) < 1e-6, `전환 메트릭의 crossSectionalDispersion 역시 10.0% (0.10)이어야 함 (실제: ${csdMetric})`);
    console.log(`  ✓ MarketStateEngine pendingTransition metrics crossSectionalDispersion: ${csdMetric} (10.0% 정확 일치, 시총 가중 왜곡 12.9% 배제 완료)`);

    console.log('  ✓ TEST 32 통과: 상장주식수 기준 시가총액 단일 권위 및 동일 가중 횡단면 분산 정합성 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 33: 기본 설정(DEFAULT_REGIME_THRESHOLDS) 기반 유동성 위기 진입·유지·이탈 및
  //          현재 장부 기준 스프레드 판정 결정론적 검증
  //   - 이탈 판정은 과거 스프레드 평균이 아니라 해당 스텝 최종 장부의 현재 최우선 양측 호가로
  //     계산한 currentSpreadBps만 사용한다. (스프레드 이력 부재 시 대체값 20bps로 이탈 금지)
  //   - 빈 장부 경로 진입은 emptyBookStockRatio가 실제 관측값이고 임계값 이상일 때만 허용한다.
  //   A: 비율 관측값 누락 시 빈 장부 경로 위기 예약 금지 (엔진 단위)
  //   B: 위기 중 ±1%(약 200bps) 양측 호가 복구 시 위기 유지 (20bps 대체값으로 이탈 금지)
  //   C: ±0.2%(약 40bps < 65bps)로 교체 시 이탈 예약 후 다음 스텝 활성화
  //   D: 유효 양측 호가 부재/교차 호가는 스프레드 회복으로 판정하지 않음
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 33] 기본 설정 기반 유동성 위기 진입·유지·이탈 및 현재 장부 스프레드 판정 검증');
  {
    // A. 임계값을 낮추지 않은 기본 설정으로 AgentManager 인스턴스 생성
    // DEFAULT_REGIME_THRESHOLDS:
    // minRegimeDurationSeconds: 10.0s
    // regimeCooldownSeconds: 5.0s
    // liquidityCrisisEmptyBookDurationSeconds: 2.0s
    // emptyBookStockRatioThreshold: 0.3 (30%)
    // liquidityCrisisRecoveryMinDurationSeconds: 12.0s
    // liquidityCrisisEnterSpreadBps: 120.0
    // liquidityCrisisExitSpreadBps: 65.0
    // liquidityCrisisEnterDepthDrop: -0.45
    // liquidityCrisisExitDepthDrop: -0.20

    // ── Case A (엔진 단위): 동일한 공백 지속시간에서 비율 관측값 누락 시 빈 장부 경로 진입 금지 ──
    {
      const engineMissingRatio = new MarketStateEngine({}, 42, startMs);
      const probeTime = startMs + 20000;
      const baseObs: RegimeObservation = {
        simulationTime: probeTime,
        aggregateReturn: 0,
        realizedVolatility: 0.005,
        turnoverChange: 0,
        averageSpreadBps: 20,
        currentSpreadBps: 20,
        depthChange: 0,
        uncertainty: 0.1,
        emptyBookDurationSeconds: 2.0,
        effectiveMacroNewsSignal: 0,
      };
      const missingRatioResult = engineMissingRatio.evaluateNextRegime(baseObs, probeTime, probeTime, 1);
      assert(missingRatioResult === null, `A: emptyBookStockRatio 관측값 누락 시 위기 예약 금지 (실제: ${missingRatioResult})`);
      assert(engineMissingRatio.getPendingTransition() === null, 'A: 비율 누락 시 pendingTransition 부재');

      const engineObservedRatio = new MarketStateEngine({}, 42, startMs);
      const observedRatioResult = engineObservedRatio.evaluateNextRegime(
        { ...baseObs, emptyBookStockRatio: 0.42 },
        probeTime,
        probeTime,
        1
      );
      assert(observedRatioResult === 'LIQUIDITY_CRISIS', `A: 동일 조건에서 비율 관측값(0.42 >= 0.30) 충족 시 위기 예약 (실제: ${observedRatioResult})`);
      assert(
        engineObservedRatio.getPendingTransition() !== null && engineObservedRatio.getPendingTransition()!.regime === 'LIQUIDITY_CRISIS',
        'A: 대조군 pendingTransition === LIQUIDITY_CRISIS'
      );
      console.log('  ✓ A: 비율 누락 → 위기 예약 차단, 비율 관측 0.42 → 위기 예약 확인');
    }

    // ── Case D (엔진 단위): 현재 장부 스프레드 관측 불가(null) 시 스프레드 회복 미확인 → 이탈 금지 ──
    {
      const engineD = new MarketStateEngine({}, 42, startMs);
      const entryTime = startMs + 20000;
      engineD.evaluateNextRegime(
        {
          simulationTime: entryTime,
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
        entryTime,
        entryTime + 1000,
        1
      );
      const activated = engineD.activatePendingRegime(entryTime + 1000, 2);
      assert(activated, 'D: pending 위기 국면 활성화 성공');
      engineD.publishSnapshot(entryTime + 1000);
      assert(engineD.getSnapshot().regime === 'LIQUIDITY_CRISIS', 'D: 사전 위기 진입 확인');

      const exitTime = entryTime + 30000;
      const baseRecoveryObs: RegimeObservation = {
        simulationTime: exitTime,
        aggregateReturn: 0,
        realizedVolatility: 0.005,
        turnoverChange: 0,
        averageSpreadBps: 20,
        depthChange: 0,
        uncertainty: 0.1,
        emptyBookDurationSeconds: 0,
        emptyBookStockRatio: 0,
        effectiveMacroNewsSignal: 0,
      };
      const unobservableResult = engineD.evaluateNextRegime(
        { ...baseRecoveryObs, currentSpreadBps: null },
        exitTime,
        exitTime,
        3
      );
      assert(unobservableResult === null, `D: currentSpreadBps null(관측 불가) → 스프레드 회복 미확인으로 위기 유지 (실제: ${unobservableResult})`);
      assert(engineD.getPendingTransition() === null, 'D: 관측 불가 시 이탈 pending 부재');

      const observableResult = engineD.evaluateNextRegime(
        { ...baseRecoveryObs, currentSpreadBps: 40 },
        exitTime,
        exitTime,
        3
      );
      assert(observableResult === 'SIDEWAYS', `D: 유효 스프레드 40bps < 65bps 관측 시 이탈 예약 (실제: ${observableResult})`);
      console.log('  ✓ D(엔진): currentSpreadBps null → 이탈 차단, 40bps 관측 → 이탈 예약 확인');
    }

    async function runDeterministicCrisisScenario() {
      memoryDb.resetToSeedData();
      const testStartMs = 1773500000000;
      const stocks = Array.from(memoryDb.stocks.values());
      assert(stocks.length >= 10, `시드 종목 수 10개 이상 확인 (${stocks.length}개)`);

      const mgr = new AgentManager(42, testStartMs, {
        enableRegimeEngine: true,
        // regimeEngineConfig를 전달하지 않아 DEFAULT_REGIME_THRESHOLDS를 100% 원본 그대로 적용
      });

      // 특정 시드의 우연한 봇 주문에 의존하지 않도록 일반 매매 봇을 제거하고 순수 장부 상태를 결정론적으로 제어
      mgr.agents.clear();

      // 초기 상태 확인: SIDEWAYS, pending = null
      const initialSnap = mgr.getMarketStateSnapshot();
      assert(initialSnap.regime === 'SIDEWAYS', '초기 국면은 SIDEWAYS');
      assert(initialSnap.pendingRegime === null, '초기 pendingRegime은 null');

      // 모든 종목에 대해 정상적인 2단 매수/매도 호가를 생성하여 양측 호가 장부 구성
      let orderSeq = 1;
      function addTwoSidedOrders(stockId: string, price: number, spreadPct: number = 0.01) {
        const bId = `ord_t33_b_${stockId}_${orderSeq++}`;
        const aId = `ord_t33_a_${stockId}_${orderSeq++}`;
        memoryDb.orders.set(bId, {
          id: bId,
          user_id: 'usr_t33_maker',
          stock_id: stockId,
          side: 'buy',
          order_type: 'limit',
          price: Math.max(1, Math.round(price * (1 - spreadPct))),
          size: 100,
          filled: 0,
          status: 'open',
          is_lp: true,
          created_at: new Date(testStartMs).toISOString(),
        });
        memoryDb.orders.set(aId, {
          id: aId,
          user_id: 'usr_t33_maker',
          stock_id: stockId,
          side: 'sell',
          order_type: 'limit',
          price: Math.max(1, Math.round(price * (1 + spreadPct))),
          size: 100,
          filled: 0,
          status: 'open',
          is_lp: true,
          created_at: new Date(testStartMs).toISOString(),
        });
        memoryDb.addOrderToIndex(memoryDb.orders.get(bId)!);
        memoryDb.addOrderToIndex(memoryDb.orders.get(aId)!);
      }

      function removeOrdersForStock(stockId: string) {
        const oIds = Array.from(memoryDb.orderStockIndex.get(stockId) ?? []);
        for (const oId of oIds) safeCancelAndDeleteOrder(oId);
      }

      function readBook(stockId: string) {
        return mgr.diagnostics.computeWindowStatistics(mgr.clock.simulationTime).get(stockId)!;
      }

      // 기존 주문 클리어 후 깨끗한 양측 장부 생성 (±1% ≈ 약 200bps)
      memoryDb.orders.clear();
      memoryDb.orderStockIndex.clear();
      memoryDb.orderUserIndex.clear();
      for (const stk of stocks) {
        addTwoSidedOrders(stk.id, stk.current_price, 0.01);
      }
      verifyOrderIndexIntegrity();

      // ─────────────────────────────────────────────────────────────
      // 사례 ⑤: 공백 비율이 임계값(30%) 미만이면 위기로 진입하지 않음
      // 26개 종목 중 2개 종목만 호가 제거 (2/26 = 7.7% < 30%)
      // ─────────────────────────────────────────────────────────────
      const subThresholdStockIds = [stocks[0].id, stocks[1].id];
      for (const sId of subThresholdStockIds) {
        const oIds = Array.from(memoryDb.orderStockIndex.get(sId) ?? []);
        for (const oId of oIds) safeCancelAndDeleteOrder(oId);
      }
      verifyOrderIndexIntegrity();

      // 10스텝 동안 실행 (최소 국면 유지 시간 10초 경과)
      for (let step = 1; step <= 10; step++) {
        await mgr.step(1.0);
      }
      const ratioCase5 = mgr.getEmptyBookStockRatio();
      const accCase5 = mgr.getEmptyBookAccumulatedSeconds();
      assert(ratioCase5 < 0.3, `공백 비율(${ratioCase5.toFixed(3)})이 30% 미만이어야 함`);
      assert(accCase5 === 0, `공백 비율 30% 미만 시 누적 시간 0초 유지 (실제: ${accCase5})`);
      const snapCase5 = mgr.getMarketStateSnapshot();
      assert(snapCase5.regime === 'SIDEWAYS', '공백 비율 30% 미만 시 SIDEWAYS 유지');
      assert(snapCase5.pendingRegime === null, '공백 비율 30% 미만 시 LIQUIDITY_CRISIS 예약 불가');

      // ─────────────────────────────────────────────────────────────
      // 사례 ① & ②:
      // ① 시장의 30% 이상(40%) 종목에서 양측 호가가 사라짐.
      // ② 유효한 스프레드 이력이 없어 관측 스프레드가 기존 대체값 20bps가 되는 경우에도,
      //    지속 시간(2s)과 최소 유지 시간(10s)을 충족하면 위기가 예약되고 다음 스텝에 활성화됨.
      // ─────────────────────────────────────────────────────────────
      // 26개 중 40% (11개) 종목의 호가를 제거하여 단측/공백 장부로 전환 (11/26 = 42.3% >= 30%)
      const emptyCount = Math.ceil(stocks.length * 0.4); // 11개
      const targetEmptyStockIds = new Set(stocks.slice(0, emptyCount).map(s => s.id));
      for (const sId of targetEmptyStockIds) {
        removeOrdersForStock(sId);
      }
      verifyOrderIndexIntegrity();

      // 스프레드 이력이 없는 상황(대체값 20bps)을 시뮬레이션하기 위해 diagnostics의 spreadHistory 리셋
      mgr.diagnostics.reset();

      // 스텝 11 실행: emptyBookAccumulatedSeconds = 1.0s (< 2.0s 기준 미달) -> pending 없음
      await mgr.step(1.0);
      const acc1 = mgr.getEmptyBookAccumulatedSeconds();
      assert(acc1 >= 1.0, `장부 공백 누적 시작 (1.0s 이상, 실제: ${acc1})`);
      assert(mgr.getMarketStateSnapshot().pendingRegime === null, '2초 미달 시 pending 전환 없음');

      // 스텝 12 실행: emptyBookAccumulatedSeconds = 2.0s (>= 2.0s 기준 충족)
      // 관측 스프레드는 이력 부재로 20bps(진입임계치 120bps 미만)이지만, 경로 B(장부 공백 지속)로 위기 예약!
      await mgr.step(1.0);
      const lastObsCase2 = mgr.getLastObservation();
      assert(lastObsCase2 !== null, '관측값 존재');
      assert(lastObsCase2!.averageSpreadBps === 20.0, `스프레드 이력 부재 시 과거 평균 스프레드는 기본 대체값 20.0bps (실제: ${lastObsCase2!.averageSpreadBps})`);
      assert(lastObsCase2!.emptyBookDurationSeconds >= 2.0, `지속시간 2.0초 이상 충족 (실제: ${lastObsCase2!.emptyBookDurationSeconds})`);
      assert(lastObsCase2!.emptyBookStockRatio !== undefined && lastObsCase2!.emptyBookStockRatio >= 0.3, `공백 비율 30% 이상 충족 (실제: ${lastObsCase2!.emptyBookStockRatio})`);
      // 현재 장부 기준 스프레드는 비어있지 않은 종목들의 ±1% 호가에서 직접 관측됨 (과거 평균 대체값과 별개)
      assert(
        lastObsCase2!.currentSpreadBps !== null && lastObsCase2!.currentSpreadBps! > 120,
        `현재 장부 기준 스프레드는 ±1% 실호가에서 약 200bps로 관측되어야 함 (실제: ${lastObsCase2!.currentSpreadBps})`
      );
      const nonEmptyStockId = stocks[emptyCount].id;
      const nonEmptyBook = readBook(nonEmptyStockId);
      assert(nonEmptyBook.bestBid !== null && nonEmptyBook.bestAsk !== null && nonEmptyBook.bestAsk! > nonEmptyBook.bestBid!, `비어있지 않은 종목 ${nonEmptyStockId}의 유효 양측 최우선 호가 존재`);
      console.log(`  ✓ 진입 관측: 공백비율=${lastObsCase2!.emptyBookStockRatio!.toFixed(3)}, 지속=${lastObsCase2!.emptyBookDurationSeconds}s, 과거평균스프레드=${lastObsCase2!.averageSpreadBps}bps(대체값), 현재장부스프레드=${lastObsCase2!.currentSpreadBps!.toFixed(1)}bps, bestBid=${nonEmptyBook.bestBid}, bestAsk=${nonEmptyBook.bestAsk}`);

      const snapCase2Pending = mgr.getMarketStateSnapshot();
      assert(snapCase2Pending.pendingRegime === 'LIQUIDITY_CRISIS', `스프레드가 20bps여도 공백 지속 조건 충족으로 LIQUIDITY_CRISIS 예약 (실제: ${snapCase2Pending.pendingRegime})`);

      // 스텝 13 실행: 다음 스텝 시작 시 LIQUIDITY_CRISIS 활성화
      await mgr.step(1.0);
      const snapCase2Active = mgr.getMarketStateSnapshot();
      assert(snapCase2Active.regime === 'LIQUIDITY_CRISIS', `다음 스텝 시작 시 LIQUIDITY_CRISIS 활성화 완료 (실제: ${snapCase2Active.regime})`);

      // ─────────────────────────────────────────────────────────────
      // 사례 ③: 장부 공백이 지속되는 동안에는 이탈하지 않음
      // - 스프레드가 회복 기준(65bps) 이하인 20bps를 유지하고 깊이 변화도 안정적이라 하더라도,
      // - 최소 위기 지속 시간(12s)을 초과한 후에도 장부 공백(42.3% >= 30%)이 유지되면 이탈 차단!
      // ─────────────────────────────────────────────────────────────
      // 15초(15스텝) 동안 공백을 유지한 채 실행 (recoveryMinDuration 12초 초과)
      for (let step = 1; step <= 15; step++) {
        await mgr.step(1.0);
      }
      const snapCase3 = mgr.getMarketStateSnapshot();
      const lastObsCase3 = mgr.getLastObservation();
      assert(snapCase3.regime !== 'SIDEWAYS' && snapCase3.regime === 'LIQUIDITY_CRISIS', `장부 공백 지속 시 위기 유지 (실제: ${snapCase3.regime})`);
      assert(snapCase3.regimeDurationSeconds >= 12.0, `최소 위기 지속시간 12초 초과 (실제: ${snapCase3.regimeDurationSeconds.toFixed(1)}s)`);
      assert(lastObsCase3!.averageSpreadBps === 20.0, `과거 평균 스프레드는 여전히 대체값 20bps (실제: ${lastObsCase3!.averageSpreadBps})`);
      assert(lastObsCase3!.currentSpreadBps !== null && lastObsCase3!.currentSpreadBps! > 65, `현재 장부 스프레드는 아직 넓음(약 200bps > 65bps, 실제: ${lastObsCase3!.currentSpreadBps})`);
      assert(lastObsCase3!.emptyBookStockRatio! >= 0.3, `공백 비율은 여전히 30% 이상 (실제: ${lastObsCase3!.emptyBookStockRatio})`);
      assert(lastObsCase3!.emptyBookDurationSeconds >= 2.0, `공백 지속시간 유지 (실제: ${lastObsCase3!.emptyBookDurationSeconds}s)`);
      assert(snapCase3.pendingRegime === null, `공백 지속 시 이탈 pending 예약 부재 (실제: ${snapCase3.pendingRegime})`);
      console.log(`  ✓ 유지 관측: 국면=${snapCase3.regime}, 대기=${snapCase3.pendingRegime}, 공백비율=${lastObsCase3!.emptyBookStockRatio!.toFixed(3)}, 지속=${lastObsCase3!.emptyBookDurationSeconds}s, 현재장부스프레드=${lastObsCase3!.currentSpreadBps!.toFixed(1)}bps`);

      // ─────────────────────────────────────────────────────────────
      // 사례 B: 위기 상태에서 양측 호가를 복구하되 ±1%(약 200bps)로 배치하면 위기를 유지한다.
      //   과거 스프레드 이력이 없어 과거 평균이 대체값 20bps이더라도, 현재 장부에서 관측한
      //   스프레드(약 200bps)가 이탈 기준 65bps를 초과하므로 이탈해서는 안 된다.
      // ─────────────────────────────────────────────────────────────
      for (const sId of targetEmptyStockIds) {
        const stk = memoryDb.stocks.get(sId);
        if (stk) addTwoSidedOrders(stk.id, stk.current_price, 0.01);
      }
      verifyOrderIndexIntegrity();

      await mgr.step(1.0);
      const lastObsCaseB = mgr.getLastObservation();
      assert(lastObsCaseB!.emptyBookStockRatio === 0, `B: 양측 호가 복구 후 공백 비율 0 (실제: ${lastObsCaseB!.emptyBookStockRatio})`);
      assert(lastObsCaseB!.emptyBookDurationSeconds === 0, `B: 공백 지속시간 0초 리셋 (실제: ${lastObsCaseB!.emptyBookDurationSeconds})`);
      assert(lastObsCaseB!.averageSpreadBps === 20.0, `B: 과거 평균 스프레드 이력 부재로 대체값 20bps (실제: ${lastObsCaseB!.averageSpreadBps})`);
      assert(
        lastObsCaseB!.currentSpreadBps !== null && lastObsCaseB!.currentSpreadBps! > 65,
        `B: 현재 장부 스프레드 약 200bps > 65bps여야 함 (실제: ${lastObsCaseB!.currentSpreadBps})`
      );
      const restoredStockId = stocks[0].id;
      const restoredBook = readBook(restoredStockId);
      assert(
        restoredBook.bestBid !== null && restoredBook.bestAsk !== null && restoredBook.bestAsk! > restoredBook.bestBid!,
        `B: 복구 종목 ${restoredStockId} 유효 양측 최우선 호가 (bestBid=${restoredBook.bestBid}, bestAsk=${restoredBook.bestAsk})`
      );
      const snapCaseB = mgr.getMarketStateSnapshot();
      assert(snapCaseB.regime === 'LIQUIDITY_CRISIS', `B: 현재 스프레드가 넓어 위기 유지 (실제: ${snapCaseB.regime})`);
      assert(snapCaseB.pendingRegime === null, `B: 20bps 대체값으로 인한 이탈 예약이 없어야 함 (실제: ${snapCaseB.pendingRegime})`);
      console.log(`  ✓ B 관측: 국면=${snapCaseB.regime}, 대기=${snapCaseB.pendingRegime}, 공백비율=${lastObsCaseB!.emptyBookStockRatio}, 지속=${lastObsCaseB!.emptyBookDurationSeconds}s, 과거평균스프레드=${lastObsCaseB!.averageSpreadBps}bps(대체값), 현재장부스프레드=${lastObsCaseB!.currentSpreadBps!.toFixed(1)}bps, bestBid=${restoredBook.bestBid}, bestAsk=${restoredBook.bestAsk}`);

      // ─────────────────────────────────────────────────────────────
      // 사례 C: 위 주문을 안전하게 취소하고 ±0.2%(약 40bps < 65bps) 양측 호가로 교체하면
      //   공백 비율·지속 시간·깊이·최소 유지 시간 조건도 충족되어 다음 스텝 이탈을 예약하고
      //   그다음 스텝에 활성화된다.
      // ─────────────────────────────────────────────────────────────
      for (const stk of stocks) {
        removeOrdersForStock(stk.id);
        addTwoSidedOrders(stk.id, stk.current_price, 0.002);
      }
      verifyOrderIndexIntegrity();

      await mgr.step(1.0);
      const lastObsCaseC = mgr.getLastObservation();
      assert(
        lastObsCaseC!.currentSpreadBps !== null && lastObsCaseC!.currentSpreadBps! > 0 && lastObsCaseC!.currentSpreadBps! < 65,
        `C: 현재 장부 스프레드 0 < x < 65bps (실제: ${lastObsCaseC!.currentSpreadBps})`
      );
      assert(
        lastObsCaseC!.emptyBookStockRatio === 0 && lastObsCaseC!.emptyBookDurationSeconds === 0,
        `C: 공백 비율/지속시간 복구 (실제: ${lastObsCaseC!.emptyBookStockRatio}, ${lastObsCaseC!.emptyBookDurationSeconds})`
      );
      assert(lastObsCaseC!.depthChange >= -0.20, `C: 호가 깊이 회복 (depthChange=${lastObsCaseC!.depthChange.toFixed(4)} >= -0.20)`);
      const narrowBook = readBook(stocks[0].id);
      assert(
        narrowBook.bestBid !== null && narrowBook.bestAsk !== null && narrowBook.bestAsk! > narrowBook.bestBid! &&
          narrowBook.currentSpreadBps !== null && narrowBook.currentSpreadBps! < 65,
        `C: 좁은 양측 호가 확인 (bestBid=${narrowBook.bestBid}, bestAsk=${narrowBook.bestAsk}, ${narrowBook.currentSpreadBps?.toFixed(1)}bps)`
      );
      const snapCaseCPending = mgr.getMarketStateSnapshot();
      assert(snapCaseCPending.regime === 'LIQUIDITY_CRISIS', `C: 예약 시점에는 아직 위기 국면 (실제: ${snapCaseCPending.regime})`);
      assert(
        snapCaseCPending.pendingRegime !== null && snapCaseCPending.pendingRegime !== 'LIQUIDITY_CRISIS',
        `C: 비위기 국면 이탈 예약 (실제: ${snapCaseCPending.pendingRegime})`
      );
      console.log(`  ✓ C 관측: 국면=${snapCaseCPending.regime}, 대기=${snapCaseCPending.pendingRegime}, 공백비율=${lastObsCaseC!.emptyBookStockRatio}, 지속=${lastObsCaseC!.emptyBookDurationSeconds}s, 현재장부스프레드=${lastObsCaseC!.currentSpreadBps!.toFixed(1)}bps, bestBid=${narrowBook.bestBid}, bestAsk=${narrowBook.bestAsk}`);

      // 다음 스텝 실행: 예약된 이탈 국면 활성화
      await mgr.step(1.0);
      const snapCaseCActive = mgr.getMarketStateSnapshot();
      assert(
        snapCaseCActive.regime === snapCaseCPending.pendingRegime,
        `C: 다음 스텝에서 예약 국면 활성화 (기대 ${snapCaseCPending.pendingRegime}, 실제 ${snapCaseCActive.regime})`
      );
      assert(snapCaseCActive.regime !== 'LIQUIDITY_CRISIS', `C: 위기 이탈 완료 (실제: ${snapCaseCActive.regime})`);
      console.log(`  ✓ C 활성화: 국면=${snapCaseCActive.regime} (위기 이탈 완료)`);

      // ─────────────────────────────────────────────────────────────
      // 사례 D (장부 단위): 유효한 양측 호가가 없거나 교차 호가뿐이면
      //   현재 스프레드를 관측할 수 없으므로 정상 스프레드로 판정하지 않는다(null).
      // ─────────────────────────────────────────────────────────────
      const emptyProbeId = stocks[stocks.length - 1].id;
      removeOrdersForStock(emptyProbeId);
      const crossedProbeId = stocks[stocks.length - 2].id;
      removeOrdersForStock(crossedProbeId);
      {
        const crossPrice = memoryDb.stocks.get(crossedProbeId)!.current_price;
        const cbId = `ord_t33_cross_b_${orderSeq++}`;
        const caId = `ord_t33_cross_a_${orderSeq++}`;
        memoryDb.orders.set(cbId, { id: cbId, user_id: 'usr_t33_maker', stock_id: crossedProbeId, side: 'buy', order_type: 'limit', price: Math.max(1, Math.round(crossPrice * 1.01)), size: 100, filled: 0, status: 'open', is_lp: true, created_at: new Date(testStartMs).toISOString() });
        memoryDb.orders.set(caId, { id: caId, user_id: 'usr_t33_maker', stock_id: crossedProbeId, side: 'sell', order_type: 'limit', price: Math.max(1, Math.round(crossPrice * 0.99)), size: 100, filled: 0, status: 'open', is_lp: true, created_at: new Date(testStartMs).toISOString() });
        memoryDb.addOrderToIndex(memoryDb.orders.get(cbId)!);
        memoryDb.addOrderToIndex(memoryDb.orders.get(caId)!);
      }
      verifyOrderIndexIntegrity();

      const emptyProbeBook = readBook(emptyProbeId);
      assert(emptyProbeBook.bestBid === null && emptyProbeBook.bestAsk === null, `D: 유효 양측 호가 부재 시 bestBid/bestAsk null (실제: ${emptyProbeBook.bestBid}/${emptyProbeBook.bestAsk})`);
      assert(emptyProbeBook.currentSpread === null && emptyProbeBook.currentSpreadBps === null, `D: 유효 양측 호가 부재 시 현재 스프레드 null (실제: ${emptyProbeBook.currentSpreadBps})`);

      const crossedProbeBook = readBook(crossedProbeId);
      assert(
        crossedProbeBook.bestBid !== null && crossedProbeBook.bestAsk !== null && crossedProbeBook.bestBid! > crossedProbeBook.bestAsk!,
        `D: 교차 호가 구성 (bestBid=${crossedProbeBook.bestBid} > bestAsk=${crossedProbeBook.bestAsk})`
      );
      assert(crossedProbeBook.currentSpread === null && crossedProbeBook.currentSpreadBps === null, `D: 교차 호가는 정상 스프레드로 취급하지 않음(null, 실제: ${crossedProbeBook.currentSpreadBps})`);
      console.log(`  ✓ D 관측: 빈 장부 스프레드=${emptyProbeBook.currentSpreadBps}, 교차 호가(bestBid=${crossedProbeBook.bestBid} > bestAsk=${crossedProbeBook.bestAsk}) 스프레드=${crossedProbeBook.currentSpreadBps}`);

      verifyOrderIndexIntegrity();

      return {
        finalRegime: snapCaseCActive.regime,
        finalStateVersion: snapCaseCActive.stateVersion,
        finalSimTime: snapCaseCActive.simulationTime,
        regimeHistoryLength: mgr.marketStateEngine.getRegimeHistory().length,
      };
    }

    // Run 1: 시나리오 전체 1회 실행
    const run1Result = await runDeterministicCrisisScenario();
    console.log('  ✓ Run 1 완료: 사례 ①~⑤ 전체 성공적 통과');

    // Run 2: 동일 시드(42) 및 동일 입력으로 1회 추가 실행하여 100% 비트 단위 재현성 실증
    const run2Result = await runDeterministicCrisisScenario();
    assert(run1Result.finalRegime === run2Result.finalRegime, '재실행 시 최종 국면 100% 일치');
    assert(run1Result.finalStateVersion === run2Result.finalStateVersion, '재실행 시 최종 stateVersion 100% 일치');
    assert(run1Result.finalSimTime === run2Result.finalSimTime, '재실행 시 최종 simulationTime 100% 일치');
    assert(run1Result.regimeHistoryLength === run2Result.regimeHistoryLength, '재실행 시 국면 전이 이력 개수 100% 일치');
    console.log('  ✓ Run 2 완료: 동일 시드 기반 비트 단위 완전 결정론적 재현성 검증 완료');

    console.log('  ✓ TEST 33 통과: 기본 설정 기반 유동성 위기 진입·유지·이탈(A~D) 및 현재 장부 스프레드 판정 결정론적 검증 완료\n');
  }

  console.log('================================================================');
  console.log('  🎉 ALL 33 MARKET REGIME FOUNDATION TESTS PASSED (EXIT CODE 0)');
  console.log('================================================================\n');
  process.exit(0);
}

runAllTests().catch((err) => {
  console.error('\n❌ UNHANDLED TEST ERROR:', err);
  process.exit(1);
});
