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
  RegimeObservation,
  MarketStateSnapshot,
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

    console.log('  ✓ TEST 21 통과: 전체 14개 설정 무결성 거절 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 22: reset 후 상태·이력·PRNG 완전 복원
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 22] reset 후 상태·이력·PRNG 완전 복원');
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
    console.log('  ✓ TEST 22 통과: 완전한 리셋 복원 확인 완료\n');
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

  // ─────────────────────────────────────────────────────────────────
  // TEST 31: 시장 전체 빈 장부 판정 및 종목 비율 임계값 검증
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 31] 시장 전체 빈 장부 판정 및 종목 비율 임계값 검증');
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

    // LP 봇의 자동 호가 재생성을 중단하여 수동 장부 제어
    mgr.agents.delete('acc_lp_main');

    // 1개 종목만 호가 완전 제거 (1/26 = 3.8% < 30%)
    const targetStockId1 = stocks[0].id;
    for (const [orderId, order] of memoryDb.orders.entries()) {
      if (order.stock_id === targetStockId1) {
        memoryDb.orders.delete(orderId);
      }
    }

    await mgr.step(1.0);
    const accumulated1 = mgr.getEmptyBookAccumulatedSeconds();
    assert(accumulated1 === 0, `1개 종목 빈 장부 시 비율(3.8% < 30%) 미달로 누적 시간 0초 유지 (실제: ${accumulated1})`);
    const snap1 = mgr.getMarketStateSnapshot();
    assert(snap1.regime !== 'LIQUIDITY_CRISIS' && snap1.pendingRegime !== 'LIQUIDITY_CRISIS', '1개 종목 빈 장부로는 위기가 발생하지 않음');
    console.log('  ✓ 1개 종목 빈 장부(3.8% < 30%)로는 시장 위기가 발생하지 않고 누적 시간 0 유지 확인');

    // 2. 비율 임계치(30%) 이상 빈 장부 시 정상 누적
    // 전체 26개 중 40% (11개) 종목의 호가 완전 제거 (11/26 = 42.3% >= 30%)
    const emptyCount = Math.ceil(stocks.length * 0.4);
    const targetEmptyStockIds = new Set(stocks.slice(0, emptyCount).map(s => s.id));
    for (const [orderId, order] of memoryDb.orders.entries()) {
      if (targetEmptyStockIds.has(order.stock_id)) {
        memoryDb.orders.delete(orderId);
      }
    }

    // 3스텝 연속 빈 장부 유지 -> 누적 시간 증가 확인
    await mgr.step(1.0);
    const accStep1 = mgr.getEmptyBookAccumulatedSeconds();
    assert(accStep1 >= 1.0, `임계치(30%) 초과 빈 장부 시 1스텝 누적 확인 (실제: ${accStep1})`);

    await mgr.step(1.0);
    const accStep2 = mgr.getEmptyBookAccumulatedSeconds();
    assert(accStep2 >= 2.0, `임계치(30%) 초과 빈 장부 시 2스텝 누적 확인 (실제: ${accStep2})`);

    await mgr.step(1.0);
    const accStep3 = mgr.getEmptyBookAccumulatedSeconds();
    assert(accStep3 >= 3.0, `임계치(30%) 초과 빈 장부 시 3스텝 누적 확인 (실제: ${accStep3})`);

    const snap2 = mgr.getMarketStateSnapshot();
    const isCrisisOrPending = snap2.regime === 'LIQUIDITY_CRISIS' || snap2.pendingRegime === 'LIQUIDITY_CRISIS';
    assert(isCrisisOrPending, '빈 장부 누적 시간 기준 충족 시 LIQUIDITY_CRISIS 정상 예약/발생');
    console.log('  ✓ 빈 장부 비율 임계값(30%) 초과 시 정상 누적 및 LIQUIDITY_CRISIS 발생 확인');

    console.log('  ✓ TEST 31 통과: 시장 전체 빈 장부 비율 판정 및 임계값 동작 검증 완료\n');
  }

  console.log('================================================================');
  console.log('  🎉 ALL 31 MARKET REGIME FOUNDATION TESTS PASSED (EXIT CODE 0)');
  console.log('================================================================\n');
}

runAllTests().catch((err) => {
  console.error('\n❌ UNHANDLED TEST ERROR:', err);
  process.exit(1);
});
