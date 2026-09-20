/**
 * scripts/test-regime-activation-modes.ts
 *
 * STOCKSYS 시장 국면 운용 모드 최종 안전성 보완 검증 스위트
 *
 * 1단계: Capability 보안 경계 및 reset 감사 이력
 * 2단계: 동일 스냅샷 기반 SHADOW 및 런타임 불변식 진단
 * 3단계: 실제 가격 이력 조회 및 채권 fallback 결정론
 */

import { memoryDb, OrderRecord, HoldingRecord, TradeRecord } from '../lib/memoryDb/memoryStore';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import {
  ServerRegimeAuthorizationProvider,
  isValidRegimeExperimentCapability,
  MAX_CAPABILITY_TTL_MS,
  ALLOWED_CLOCK_SKEW_MS,
} from '../lib/engine/simulation/regime/regimeAuth';
import * as regimeBarrel from '../lib/engine/simulation/regime';
import {
  TestRegimeAuthorizationProvider,
  createTestRegimeCapability,
  createExpiredTestRegimeCapability,
  createFutureTestRegimeCapability,
  createExcessiveTtlTestRegimeCapability,
} from './test-support/testRegimeAuth';
import {
  fetchCanonicalPriceHistory,
  createDeterministicBondHistory,
  DEFAULT_BOND_FALLBACK_EPOCH_MS,
} from '../lib/services/priceHistoryService';

const START_EPOCH_MS = 1773500000000;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

function checkInvariants(stepName: string): void {
  for (const p of memoryDb.profiles.values()) {
    if (!Number.isFinite(p.cash) || p.cash < 0) {
      throw new Error(`[${stepName}] 계좌 cash 비정상: ${p.id}=${p.cash}`);
    }
  }
  for (const h of memoryDb.holdings.values()) {
    if (!Number.isFinite(h.quantity) || h.quantity < 0) {
      throw new Error(`[${stepName}] 보유 quantity 비정상: user=${h.user_id}, qty=${h.quantity}`);
    }
  }
  for (const t of memoryDb.trades) {
    if (!Number.isFinite(t.price) || t.price <= 0 || !Number.isFinite(t.size) || t.size <= 0) {
      throw new Error(`[${stepName}] 체결 비정상 가격/수량: ${t.id}`);
    }
    if (t.buyer_id && t.seller_id && t.buyer_id === t.seller_id) {
      throw new Error(`[${stepName}] 자가 체결 발생: ${t.id}`);
    }
  }
  for (const o of memoryDb.orders.values()) {
    if (!Number.isFinite(o.price) || o.price <= 0 || !Number.isFinite(o.size) || o.size <= 0) {
      throw new Error(`[${stepName}] 주문 비정상 가격/수량: ${o.id}`);
    }
    if (o.filled < 0 || o.filled > o.size) {
      throw new Error(`[${stepName}] 주문 체결량 범위 오류: ${o.id}`);
    }
  }
}

function getFingerprint(mgr: AgentManager): string {
  const orders = Array.from(memoryDb.orders.values())
    .map((o) => `${o.stock_id}:${o.side}:${o.price}:${o.size}:${o.filled}:${o.status}`)
    .sort()
    .join('|');
  const trades = memoryDb.trades
    .map((t) => `${t.stock_id}:${t.price}:${t.size}:${t.buyer_id}:${t.seller_id}`)
    .sort()
    .join('|');
  const profiles = Array.from(memoryDb.profiles.values())
    .map((p) => `${p.id}:${p.cash}`)
    .sort()
    .join('|');
  const holdings = Array.from(memoryDb.holdings.values())
    .map((h) => `${h.user_id}:${h.stock_id}:${h.quantity}:${h.avg_price}`)
    .sort()
    .join('|');
  const botPrng = Array.from(mgr.agentPrngs.entries())
    .map(([k, p]) => `${k}:${p.getState()}`)
    .sort()
    .join('|');
  const fundPrng = mgr.fundamentalPrng.getState();

  return `ORDERS[${orders}]__TRADES[${trades}]__PROFILES[${profiles}]__HOLDINGS[${holdings}]__PRNG[${botPrng}#${fundPrng}]`;
}

async function runAllTests(): Promise<void> {
  console.log('================================================================');
  console.log('  STOCKSYS 시장 국면 운용 모드 최종 안전성 보완 검증 스위트');
  console.log('================================================================\n');

  // ═════════════════════════════════════════════════════════════════
  // 1단계: Capability 보안 경계 및 reset 감사 이력
  // ═════════════════════════════════════════════════════════════════
  console.log('▶ [1단계] Capability 보안 경계 및 reset 감사 이력 검증');

  // 1.1 운영 배럴에서 테스트 기능 미노출 검증
  assert(
    !('TestRegimeAuthorizationProvider' in regimeBarrel),
    '1.1 TestRegimeAuthorizationProvider 운영 배럴(regime/index.ts) 미노출 확인'
  );
  assert(
    !('createTestRegimeCapability' in regimeBarrel),
    '1.1 createTestRegimeCapability 운영 배럴(regime/index.ts) 미노출 확인'
  );

  // 1.2 Capability 만료, 클록 스큐, 최대 TTL 검증 (nowMs 주입)
  const baseNow = 1773500000000;
  const validCap = createTestRegimeCapability('test-authorized-token', 60000, baseNow - 10000);
  assert(isValidRegimeExperimentCapability(validCap, baseNow), '1.2-A 정상 capability 만료 전 유효');
  assert(isValidRegimeExperimentCapability(validCap, validCap.expiresAt - 1), '1.2-B 만료 1ms 직전까지 유효');
  assert(!isValidRegimeExperimentCapability(validCap, validCap.expiresAt), '1.2-C 만료 시각(nowMs >= expiresAt) 즉시 거절');
  assert(!isValidRegimeExperimentCapability(validCap, validCap.expiresAt + 1000), '1.2-D 만료 이후 거절');

  // 미래 발급 (클록 스큐 초과)
  const futureCap = createFutureTestRegimeCapability(ALLOWED_CLOCK_SKEW_MS + 1000, baseNow);
  assert(!isValidRegimeExperimentCapability(futureCap, baseNow), '1.2-E 미래 발급(허용 클록 스큐 초과) 거절');

  // 최대 TTL 초과
  const excessiveTtlCap = createExcessiveTtlTestRegimeCapability(MAX_CAPABILITY_TTL_MS + 1000, baseNow);
  assert(!isValidRegimeExperimentCapability(excessiveTtlCap, baseNow), '1.2-F 최대 허용 TTL(5분) 초과 capability 거절');

  // 비정상 수치값 (NaN, Infinity, 음수, 소수) 및 위조 객체 거절
  const forgedNoBrand = { id: 'rcap_fake1234567890', issuedAt: baseNow, expiresAt: baseNow + 60000 };
  assert(!isValidRegimeExperimentCapability(forgedNoBrand, baseNow), '1.2-G 브랜드 없는 위조 객체 거절');
  const capNaN = createTestRegimeCapability('test-authorized-token', NaN as any, baseNow);
  assert(!isValidRegimeExperimentCapability(capNaN, baseNow), '1.2-H NaN 타임스탬프 거절');
  const capInfinity = createTestRegimeCapability('test-authorized-token', Infinity as any, baseNow);
  assert(!isValidRegimeExperimentCapability(capInfinity, baseNow), '1.2-I Infinity 타임스탬프 거절');
  const capFloat = createTestRegimeCapability('test-authorized-token', 60000.5, baseNow + 0.1);
  assert(!isValidRegimeExperimentCapability(capFloat, baseNow), '1.2-J 소수점 타임스탬프(SafeInteger 아님) 거절');

  // 1.3 환경변수 미설정 및 과거/테스트 키 거절 (Fail-closed)
  {
    const oldKey = process.env.REGIME_EXPERIMENT_AUTH_KEY;
    delete process.env.REGIME_EXPERIMENT_AUTH_KEY;
    const provider = new ServerRegimeAuthorizationProvider();
    assert(!provider.issueCapability({ secretKey: 'any' }).success, '1.3-A 환경변수 미설정 시 발급 거절');
    assert(!provider.issueCapability({ secretKey: 'STOCKSYS_REGIME_ADMIN' }).success, '1.3-B 과거 기본키 거절');
    assert(!provider.issueCapability({ secretKey: 'TEST_PERMITTED' }).success, '1.3-C 과거 테스트키 거절');
    if (oldKey !== undefined) process.env.REGIME_EXPERIMENT_AUTH_KEY = oldKey;
  }

  // 1.4 생성자 직접 활성화 거절
  {
    memoryDb.resetToSeedData();
    const mgr1 = new AgentManager(42, START_EPOCH_MS, { regimeEffectsMode: 'EXPERIMENTAL_ON' as any });
    assert(mgr1.regimeEffectsMode === 'OFF', '1.4-A 생성자 regimeEffectsMode=EXPERIMENTAL_ON 거절');
    const mgr2 = new AgentManager(42, START_EPOCH_MS, { enableRegimeEffects: true as any });
    assert(mgr2.regimeEffectsMode === 'OFF', '1.4-B 생성자 enableRegimeEffects=true 거절');
  }

  // 1.5 단회용(Single-Use) 정책 및 재사용 거절, 거절 시 미소비 검증
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(42, START_EPOCH_MS);
    const oneTimeCap = createTestRegimeCapability('test-authorized-token', 60000, baseNow);

    // 유효한 전환 예약 성공
    const res1 = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: oneTimeCap, nowMs: baseNow });
    assert(res1.success === true, '1.5-A 유효한 Capability로 1차 전환 예약 성공');

    // 동일 capability 재사용 시 거절
    const res2 = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: oneTimeCap, nowMs: baseNow + 1000 });
    assert(res2.success === false, '1.5-B 동일 Capability 재사용 거절 (단회용 소비 정책)');

    // 거절된 요청은 capability를 소비하지 않음
    const unconsumedCap = createTestRegimeCapability('test-authorized-token', 60000, baseNow);
    const fakeRejected = mgr.setRegimeEffectsMode('INVALID_MODE' as any, { capability: unconsumedCap, nowMs: baseNow });
    assert(fakeRejected.success === false, '1.5-C 유효하지 않은 요청 거절');
    // 여전히 유효하게 사용 가능해야 함
    const validAfterReject = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: unconsumedCap, nowMs: baseNow });
    assert(validAfterReject.success === true, '1.5-D 거절된 요청의 Capability는 소비되지 않고 사용 가능');

    // 1.6 reset 후에도 사용했던 capability 재사용 불가
    mgr.reset(42);
    const resReuseAfterReset = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: oneTimeCap, nowMs: baseNow + 2000 });
    assert(resReuseAfterReset.success === false, '1.6 reset 후에도 과거 소비된 Capability 재사용 차단');
  }

  // 1.7 reset 시 감사 이력 보존 및 이벤트 타입 구분 검증
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(42, START_EPOCH_MS);

    // OFF -> SHADOW 전환
    mgr.setRegimeEffectsMode('SHADOW');
    await mgr.step(10);
    assert(mgr.regimeEffectsMode === 'SHADOW', '1.7-A SHADOW 활성화');

    // SHADOW -> EXPERIMENTAL_ON 전환
    const cap = createTestRegimeCapability('test-authorized-token', 60000, Date.now());
    mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: cap });
    await mgr.step(10);
    assert(mgr.regimeEffectsMode === 'EXPERIMENTAL_ON', '1.7-B EXPERIMENTAL_ON 활성화');

    // 이전 이력 확인
    const historyBefore = mgr.getRegimeModeDiagnostics().modeChangeHistory;
    assert(historyBefore.length >= 2, '1.7-C reset 전 모드 전환 이력 2건 이상 존재');

    // Reset 실행
    mgr.reset(42);
    const diagAfterReset = mgr.getRegimeModeDiagnostics();
    const historyAfter = diagAfterReset.modeChangeHistory;

    assert(diagAfterReset.currentMode === 'OFF', '1.7-D reset 후 currentMode === OFF');
    assert(diagAfterReset.pendingMode === null, '1.7-E reset 후 pendingMode === null');
    assert(diagAfterReset.appliedRegime === null, '1.7-F reset 후 appliedRegime === null');
    assert(Object.keys(diagAfterReset.appliedMultipliers).length === 0, '1.7-G reset 후 appliedMultipliers 빈 객체');

    // 감사 이력이 덮어쓰이지 않고 append 되었는지 검증
    assert(historyAfter.length === historyBefore.length + 1, '1.7-H reset 감사 기록이 기존 이력에 append 됨 (보존)');
    const lastRec = historyAfter[historyAfter.length - 1];
    assert(lastRec.toMode === 'OFF' && lastRec.fromMode === 'EXPERIMENTAL_ON', '1.7-I reset 이벤트 모드 정확');
    assert(lastRec.reason === 'simulation_reset_fail_safe', '1.7-J reset 이벤트 사유 정확');
    assert(lastRec.eventType === 'RESET_FAIL_SAFE', '1.7-K 비-OFF 상태 reset은 RESET_FAIL_SAFE로 기록');

    // 이미 OFF 상태에서 reset 재실행 -> 허위 모드 전환 없이 eventType: 'RESET'
    mgr.reset(42);
    const historyAfter2 = mgr.getRegimeModeDiagnostics().modeChangeHistory;
    const lastRec2 = historyAfter2[historyAfter2.length - 1];
    assert(lastRec2.eventType === 'RESET', '1.7-L OFF 상태 reset은 RESET으로 기록');

    // 1.8 인증 정보 DTO 미노출 검증
    const diagStr = JSON.stringify(diagAfterReset);
    assert(!diagStr.includes('STOCKSYS_REGIME_ADMIN'), '1.8-A 진단 DTO에 구 기본키 미노출');
    assert(!diagStr.includes('TEST_PERMITTED'), '1.8-B 진단 DTO에 구 테스트키 미노출');
    assert(!diagStr.includes('rcap_'), '1.8-C 진단 DTO에 Capability 식별자 미노출');
  }
  console.log('  ✓ [1단계] Capability 보안 경계 및 reset 감사 이력 검증 100% 통과!\n');

  // ═════════════════════════════════════════════════════════════════
  // 2단계: 동일 스냅샷 기반 SHADOW 및 런타임 불변식 진단
  // ═════════════════════════════════════════════════════════════════
  console.log('▶ [2단계] 동일 스냅샷 기반 SHADOW 및 런타임 불변식 진단 검증');

  // 2.1 & 2.2: OFF와 SHADOW의 실제 장부·체결·가격·잔고·PRNG 지문 100% 비트 단위 일치
  {
    const TEST_SEED = 2026;

    async function runSim(mode: 'OFF' | 'SHADOW') {
      memoryDb.resetToSeedData();
      const mgr = new AgentManager(TEST_SEED, START_EPOCH_MS, { regimeEffectsMode: mode });

      await mgr.step(1800);
      await mgr.step(600);
      await mgr.step(30);

      const eventTime = mgr.clock.simulationTime;
      mgr.registerEvent({
        eventId: `test2_bull_${mode}`,
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
        publisher: 'GovPolicy',
        title: '글로벌 유동성 공급',
        content: '시장 호재 유입',
      });

      for (const stock of memoryDb.stocks.values()) {
        memoryDb.stockPriceHistory.push({
          id: `hist_t2_${stock.id}_${mode}`,
          stock_id: stock.id,
          price: Math.round(stock.current_price * 1.03),
          recorded_at: new Date(eventTime).toISOString(),
        });
      }

      for (let s = 1; s <= 5; s++) {
        await mgr.step(15);
        checkInvariants(`Test2_${mode}_Step${s}`);
      }

      return {
        mgr,
        fingerprint: getFingerprint(mgr),
        diagnostics: mgr.getRegimeModeDiagnostics(),
        shadowHistory: mgr.getShadowDiagnosticsHistory(),
      };
    }

    const resOff = await runSim('OFF');
    const resShadow = await runSim('SHADOW');

    assert(
      resOff.fingerprint === resShadow.fingerprint,
      '2.1 & 2.2 OFF와 SHADOW 모드의 실제 장부·체결·가격·잔고·PRNG 지문 100% 비트 단위 일치'
    );

    // 2.3 SHADOW 진단 상태 COMPLETED 확인
    const shadowRec = resShadow.diagnostics.shadowDiagnostics;
    assert(shadowRec !== null, '2.3-A SHADOW 최신 진단 레코드 존재');
    assert(shadowRec?.shadowCalculationStatus === 'COMPLETED', '2.3-B shadowCalculationStatus === "COMPLETED"');
    assert(Object.keys(shadowRec?.virtualMultipliers || {}).length > 0, '2.3-C 가상 배수 산출 확인');

    // 2.4 Idempotent Read 및 방어적 복사본 검증
    const diag1 = resShadow.mgr.getRegimeModeDiagnostics();
    const diag2 = resShadow.mgr.getRegimeModeDiagnostics();
    assert(JSON.stringify(diag1) === JSON.stringify(diag2), '2.4-A getRegimeModeDiagnostics() 2회 호출 전후 일치');
    // 반환 객체 변조 시 내부 상태 보호 확인
    (diag1 as any).modeChangeHistory.push({ fake: true });
    const diag3 = resShadow.mgr.getRegimeModeDiagnostics();
    assert(diag3.modeChangeHistory.length !== (diag1 as any).modeChangeHistory.length, '2.4-B 내부 배열 직접 참조 미노출 (방어적 복사)');
    if (diag1.shadowDiagnostics) {
      (diag1.shadowDiagnostics as any).virtualMultipliers['fake_key'] = 999;
      const diag4 = resShadow.mgr.getRegimeModeDiagnostics();
      assert(diag4.shadowDiagnostics?.virtualMultipliers['fake_key'] === undefined, '2.4-C shadowDiagnostics 가상 배수 객체 직접 변조 방어');
    }

    // 2.5 동일 시드 재현
    const resShadow2 = await runSim('SHADOW');
    assert(
      JSON.stringify(resShadow.shadowHistory) === JSON.stringify(resShadow2.shadowHistory),
      '2.5 동일 seed SHADOW 결과 bit-for-bit 완벽 재현'
    );
  }

  // 2.6 불변식 검사 강화 및 위반 주입 검증
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(42, START_EPOCH_MS);
    await mgr.step(10);

    // 정상 상태에서는 invariantViolationCount === 0
    assert(mgr.getRegimeModeDiagnostics().invariantViolationCount === 0, '2.6-A 정상 상태 invariantViolationCount === 0');

    // 불변식 검사 전후 PRNG 불변 검증
    const prngBefore = mgr.agentPrngs.get('acc_bot_val_01')?.getState();
    mgr.checkRuntimeInvariants(mgr.clock.simulationTime, mgr.clock.simulationStep, false);
    const prngAfter = mgr.agentPrngs.get('acc_bot_val_01')?.getState();
    assert(prngBefore === prngAfter, '2.6-B 불변식 검사 수행 전후 실제 PRNG 상태 보존');

    // 위반 주입 1: 예약 현금 > 실제 잔고 (RESERVED_CASH_EXCEEDS_BALANCE)
    const testUser = 'acc_bot_val_01';
    const prof = memoryDb.profiles.get(testUser);
    const firstStock = Array.from(memoryDb.stocks.values())[0];
    if (prof && firstStock) {
      const origCash = prof.cash;
      const fakeBuyOrder: OrderRecord = {
        id: 'fake_buy_order_res',
        stock_id: firstStock.id,
        user_id: testUser,
        side: 'buy',
        price: 50000,
        size: 100,
        filled: 0,
        status: 'open',
        is_lp: false,
        created_at: new Date(mgr.clock.simulationTime).toISOString(),
      };
      memoryDb.orders.set(fakeBuyOrder.id, fakeBuyOrder);
      memoryDb.addOrderToIndex(fakeBuyOrder);

      prof.cash = 10; // 잔고를 10원으로 대폭 축소하여 열린 주문의 예약 현금보다 작게 만듦
      mgr.checkRuntimeInvariants(mgr.clock.simulationTime, mgr.clock.simulationStep + 1, false);
      const diagInjected = mgr.getRegimeModeDiagnostics();
      assert(
        Boolean(diagInjected.violations?.some((v) => v.code === 'RESERVED_CASH_EXCEEDS_BALANCE')),
        '2.6-C 예약 현금 > 실제 잔고 위반(RESERVED_CASH_EXCEEDS_BALANCE) 탐지'
      );
      prof.cash = origCash;
      memoryDb.orders.delete(fakeBuyOrder.id);
      memoryDb.removeOrderFromIndex(fakeBuyOrder);
    }

    // 위반 주입 2: 예약 매도량 > 실제 보유량 (RESERVED_HOLDING_EXCEEDS_QUANTITY)
    if (firstStock) {
      const userHids = memoryDb.holdingUserIndex.get(testUser);
      let targetHolding: HoldingRecord | undefined;
      if (userHids) {
        for (const hid of userHids) {
          const h = memoryDb.holdings.get(hid);
          if (h && h.stock_id === firstStock.id) {
            targetHolding = h;
            break;
          }
        }
      }
      if (!targetHolding) {
        targetHolding = {
          id: `holding_${testUser}_${firstStock.id}`,
          user_id: testUser,
          stock_id: firstStock.id,
          quantity: 10,
          avg_price: 50000,
          created_at: new Date().toISOString(),
        };
        memoryDb.holdings.set(targetHolding.id, targetHolding);
        memoryDb.addHoldingToIndex(targetHolding);
      }

      const fakeSellOrder: OrderRecord = {
        id: 'fake_sell_order_res',
        stock_id: firstStock.id,
        user_id: testUser,
        side: 'sell',
        price: 50000,
        size: 500,
        filled: 0,
        status: 'open',
        is_lp: false,
        created_at: new Date(mgr.clock.simulationTime).toISOString(),
      };
      memoryDb.orders.set(fakeSellOrder.id, fakeSellOrder);
      memoryDb.addOrderToIndex(fakeSellOrder);

      const origQty = targetHolding.quantity;
      targetHolding.quantity = 0; // 보유량을 0으로 만들어 기존 활성 매도 주문의 예약량(500)보다 작게 만듦
      mgr.checkRuntimeInvariants(mgr.clock.simulationTime, mgr.clock.simulationStep + 2, false);
      const diagHolding = mgr.getRegimeModeDiagnostics();
      assert(
        Boolean(diagHolding.violations?.some((v) => v.code === 'RESERVED_HOLDING_EXCEEDS_QUANTITY')),
        '2.6-D 예약 매도량 > 실제 보유량 위반(RESERVED_HOLDING_EXCEEDS_QUANTITY) 탐지'
      );
      targetHolding.quantity = origQty;
      memoryDb.orders.delete(fakeSellOrder.id);
      memoryDb.removeOrderFromIndex(fakeSellOrder);
    }

    // 위반 주입 3: Zombie Order 탐지 (인덱스에만 존재하고 orders 맵에 없음)
    const zombieOrderId = 'zombie_order_9999';
    const firstStockId = Array.from(memoryDb.stocks.keys())[0];
    memoryDb.orderStockIndex.get(firstStockId)?.add(zombieOrderId);
    mgr.checkRuntimeInvariants(mgr.clock.simulationTime, mgr.clock.simulationStep + 3, false);
    const diagZombie = mgr.getRegimeModeDiagnostics();
    assert(
      Boolean(diagZombie.violations?.some((v) => v.code === 'ZOMBIE_ORDER_IN_STOCK_INDEX')),
      '2.6-E 인덱스에만 남은 Zombie 주문(ZOMBIE_ORDER_IN_STOCK_INDEX) 탐지'
    );
    memoryDb.orderStockIndex.get(firstStockId)?.delete(zombieOrderId);

    // 위반 주입 4: Missing Order Index 탐지 (orders에는 존재하지만 인덱스에 누락)
    const testOrder = Array.from(memoryDb.orders.values())[0];
    if (testOrder) {
      memoryDb.orderStockIndex.get(testOrder.stock_id)?.delete(testOrder.id);
      mgr.checkRuntimeInvariants(mgr.clock.simulationTime, mgr.clock.simulationStep + 4, false);
      const diagMissing = mgr.getRegimeModeDiagnostics();
      assert(
        Boolean(diagMissing.violations?.some((v) => v.code === 'MISSING_ORDER_STOCK_INDEX')),
        '2.6-F 인덱스 누락 주문(MISSING_ORDER_STOCK_INDEX) 탐지'
      );
      memoryDb.orderStockIndex.get(testOrder.stock_id)?.add(testOrder.id);
    }
  }
  console.log('  ✓ [2단계] 동일 스냅샷 기반 SHADOW 및 런타임 불변식 진단 검증 100% 통과!\n');

  // ═════════════════════════════════════════════════════════════════
  // 3단계: 실제 가격 이력 조회 및 채권 fallback 결정론
  // ═════════════════════════════════════════════════════════════════
  console.log('▶ [3단계] 실제 가격 이력 조회 및 채권 fallback 결정론 검증');

  // 3.1 실제 운영 함수 fetchCanonicalPriceHistory 검증
  {
    const mockDbStore: Record<string, any[]> = {
      stock_price_history: [
        { id: 'h1', stock_id: '00000000-0000-4000-8000-000000000101', price: 72000, volume: 1000, created_at: '2026-03-01T10:00:00Z' },
        { id: 'h2', stock_id: '0015', price: 85000, volume: 2000, created_at: '2026-03-01T10:00:00Z' }, // 구버전 ticker 기준
      ],
    };

    const createMockSupabase = (failOnTable?: string) => ({
      from: (tableName: string) => ({
        select: (_cols: string) => ({
          eq: (col: string, val: any) => ({
            order: (_ordCol: string, _opts: any) => ({
              limit: (n: number) => {
                if (tableName === failOnTable) {
                  return Promise.resolve({ data: null, error: { message: `Simulated DB error on ${tableName}` } });
                }
                const rows = (mockDbStore[tableName] || []).filter((r) => r[col] === val).slice(0, n);
                return Promise.resolve({ data: rows, error: null });
              },
            }),
          }),
        }),
      }),
    });

    const mockDb = createMockSupabase();

    // 시나리오 1: UUID로 주식 상세 접근 (canonical 결과 존재 -> ticker fallback 미호출)
    const res1 = await fetchCanonicalPriceHistory({
      db: mockDb,
      assetId: '00000000-0000-4000-8000-000000000101',
      ticker: '0010',
      assetKind: 'stock',
    });
    assert(res1.source === 'canonical' && res1.data.length === 1 && res1.data[0].price === 72000, '3.1-A canonical ID로 정상 조회 및 ticker fallback 미호출');

    // 시나리오 2: canonical 결과 없고 구버전 ticker 기준 결과 존재 -> ticker fallback 호출
    const res2 = await fetchCanonicalPriceHistory({
      db: mockDb,
      assetId: '00000000-0000-4000-8000-000000000102',
      ticker: '0015',
      assetKind: 'stock',
    });
    assert(res2.source === 'ticker_fallback' && res2.data.length === 1 && res2.data[0].price === 85000, '3.1-B canonical 부재 시 ticker fallback 정상 조회');

    // 시나리오 3: canonical 및 ticker 결과 모두 부재
    const res3 = await fetchCanonicalPriceHistory({
      db: mockDb,
      assetId: '00000000-0000-4000-8000-000000000999',
      ticker: '9999',
      assetKind: 'stock',
    });
    assert(res3.source === 'empty' && res3.data.length === 0, '3.1-C 양쪽 모두 부재 시 정상 빈 결과 반환');

    // 시나리오 4: DB 조회 오류 시 정상 빈 배열 반환 및 error 객체 포착
    const failingDb = createMockSupabase('stock_price_history');
    const res4 = await fetchCanonicalPriceHistory({
      db: failingDb,
      assetId: '00000000-0000-4000-8000-000000000101',
      ticker: '0010',
      assetKind: 'stock',
    });
    assert(res4.source === 'empty' && res4.error !== null, '3.1-D DB 오류 격리 및 graceful 처리');
  }

  // 3.2 채권 synthetic price history 결정론 검증 (Date.now 미사용)
  {
    const bondAsset = {
      id: 'bond_kr_10y_01',
      currentPrice: 10150,
      previousClose: 10120,
      volume: 25000,
      updated_at: '2026-03-01T12:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
    };

    // 1순위: 명시적 시뮬레이션 시각 기준
    const simTimeMs = 1773500500000;
    const history1A = createDeterministicBondHistory(bondAsset, simTimeMs);
    const history1B = createDeterministicBondHistory(bondAsset, simTimeMs);
    assert(JSON.stringify(history1A) === JSON.stringify(history1B), '3.2-A 동일 입력 시 채권 synthetic history 100% 결정론적 일치');
    assert(history1A[0].created_at === new Date(simTimeMs).toISOString(), '3.2-B 1순위: 시뮬레이션 시각 기준 타임스탬프 산출');
    assert(history1A[1].created_at === new Date(simTimeMs - 60000).toISOString(), '3.2-C 60초 전 과거 포인트 생성');

    // 2순위: updated_at 기준
    const history2 = createDeterministicBondHistory(bondAsset);
    assert(history2[0].created_at === new Date('2026-03-01T12:00:00.000Z').toISOString(), '3.2-D 2순위: updated_at 기준 타임스탬프 산출');

    // 3순위: created_at 기준
    const bondOnlyCreated = { ...bondAsset, updated_at: undefined };
    const history3 = createDeterministicBondHistory(bondOnlyCreated);
    assert(history3[0].created_at === new Date('2026-01-01T00:00:00.000Z').toISOString(), '3.2-E 3순위: created_at 기준 타임스탬프 산출');

    // 4순위: 고정 fallback epoch 기준
    const bondNoDates = { ...bondAsset, updated_at: undefined, created_at: undefined };
    const history4 = createDeterministicBondHistory(bondNoDates);
    assert(history4[0].created_at === new Date(DEFAULT_BOND_FALLBACK_EPOCH_MS).toISOString(), '3.2-F 4순위: 고정 fallback epoch 기준 타임스탬프 산출');
  }
  console.log('  ✓ [3단계] 실제 가격 이력 조회 및 채권 fallback 결정론 검증 100% 통과!\n');

  console.log('================================================================');
  console.log('  🎉 7대 결함 보완 검증 스위트 모든 항목 100% 통과 완료!');
  console.log('================================================================\n');

  process.exit(0);
}

if (require.main === module) {
  runAllTests().catch((err) => {
    console.error('❌ FATAL ERROR in test-regime-activation-modes:', err);
    process.exit(1);
  });
}
