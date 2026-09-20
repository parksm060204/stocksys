/**
 * scripts/test-regime-activation-modes.ts
 *
 * STOCKSYS [3단계 — 안전한 실험 활성화 준비 검증 스위트]
 *
 * 목적:
 * 1. 기본 실행 시 regimeEffectsMode === 'OFF' 및 비활성화 기본값 엄격 보존 확인
 * 2. 잘못된 모드 값 및 비인가 요청 거절 정책 검증
 * 3. OFF -> SHADOW -> EXPERIMENTAL_ON -> OFF 전이 및 스텝 경계 적용 정책 검증
 * 4. SHADOW 모드 무영향성(Zero-Impact): 동일 시드 OFF 대비 주문·체결·PRNG 100% 비트 단위 일치 검증
 * 5. EXPERIMENTAL_ON 모드에서만 실제 효과 배수 반영 및 진단 정보 분리 검증
 * 6. 불변식 위반 0건 확인
 */

import { memoryDb } from '../lib/memoryDb/memoryStore';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import { DEFAULT_REGIME_THRESHOLDS } from '../lib/engine/simulation/regime/regimeConfig';
import { RegimeEffectsMode } from '../lib/engine/simulation/regime/regimeTypes';

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

async function testRegimeActivationModes(): Promise<void> {
  console.log('================================================================');
  console.log('  STOCKSYS [3단계] 안전한 실험 활성화 모드 검증 스위트');
  console.log('================================================================\n');

  // ─────────────────────────────────────────────────────────────────
  // TEST 1: 기본 실행 시 OFF 기본값 엄격 보존 확인
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 1] 기본 실행 시 OFF 기본값 엄격 보존 확인');
  {
    memoryDb.resetToSeedData();
    const mgrDefault = new AgentManager(42, START_EPOCH_MS);

    assert(mgrDefault.regimeEffectsMode === 'OFF', '기본 생성 시 regimeEffectsMode === "OFF"');
    assert(mgrDefault.enableRegimeEffects === false, '기본 생성 시 enableRegimeEffects === false');

    const diag = mgrDefault.getRegimeModeDiagnostics();
    assert(diag.currentMode === 'OFF', '진단 정보 currentMode === "OFF"');
    assert(diag.pendingMode === null, '진단 정보 pendingMode === null');
    assert(diag.appliedRegime === null, '기본 OFF 상태에서는 appliedRegime === null');
    assert(Object.keys(diag.appliedMultipliers).length === 0, '기본 OFF 상태에서는 appliedMultipliers 비어있음');
    assert(diag.invariantViolationCount === 0, '불변식 위반 0건');
    console.log('  ✓ TEST 1 통과: 기본값 OFF 엄격 보존 확인\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 2: 잘못된 모드 값 및 비인가 요청 거절 정책 검증
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 2] 잘못된 모드 값 및 비인가 요청 거절 정책 검증');
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(42, START_EPOCH_MS);

    // 2-1: 잘못된 문자열 모드 거절
    const resInvalid1 = mgr.setRegimeEffectsMode('TURBO' as any);
    assert(resInvalid1.success === false, '잘못된 모드 "TURBO" 거절 확인');

    const resInvalid2 = mgr.setRegimeEffectsMode('' as any);
    assert(resInvalid2.success === false, '빈 문자열 모드 거절 확인');

    const resInvalid3 = mgr.setRegimeEffectsMode(123 as any);
    assert(resInvalid3.success === false, '숫자형 모드 거절 확인');

    // 2-2: 인가 키 없는 EXPERIMENTAL_ON 활성화 시도 거절
    const resUnauthorized = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON');
    assert(resUnauthorized.success === false, '인가 키 없는 EXPERIMENTAL_ON 전환 시도 거절 확인');
    assert(mgr.regimeEffectsMode === 'OFF', '거절 후 현재 모드는 계속 OFF 유지');

    // 2-3: 올바른 인가 키 전달 시 성공
    const resAuthorized = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { authKey: 'TEST_PERMITTED' });
    assert(resAuthorized.success === true, '올바른 인가 키 제공 시 전환 예약 성공');
    assert(mgr.getRegimeModeDiagnostics().pendingMode === 'EXPERIMENTAL_ON', 'pendingMode가 EXPERIMENTAL_ON으로 예약됨');

    console.log('  ✓ TEST 2 통과: 인가 검증 및 유효성 검사 차단 완벽\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 3: OFF -> SHADOW -> EXPERIMENTAL_ON -> OFF 스텝 경계 전이 및 이력 기록 검증
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 3] OFF -> SHADOW -> EXPERIMENTAL_ON -> OFF 스텝 경계 전이 검증');
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(42, START_EPOCH_MS);

    // Step 1 실행 (OFF 모드)
    await mgr.step(30);
    assert(mgr.regimeEffectsMode === 'OFF', 'Step 1: OFF 모드 유지');

    // SHADOW 모드 전환 예약
    const resShadow = mgr.setRegimeEffectsMode('SHADOW');
    assert(resShadow.success === true, 'SHADOW 모드 예약 성공');
    // 예약 직후에는 아직 적용되지 않음 (즉시 변경 금지 정책)
    assert(mgr.regimeEffectsMode === 'OFF', '예약 직후: 이전 모드 OFF 유지 (즉시 변경 금지)');
    assert(mgr.getRegimeModeDiagnostics().pendingMode === 'SHADOW', 'pendingMode === "SHADOW"');

    // Step 2 실행 -> 스텝 경계에서 SHADOW 적용
    await mgr.step(30);
    assert(mgr.regimeEffectsMode === 'SHADOW', 'Step 2 경계에서 SHADOW 모드 정상 적용');
    assert(mgr.enableRegimeEffects === false, 'SHADOW 모드에서도 enableRegimeEffects는 false');
    assert(mgr.getRegimeModeDiagnostics().pendingMode === null, '적용 후 pendingMode 해소');

    // EXPERIMENTAL_ON 모드 전환 예약
    const resExp = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { authKey: 'TEST_PERMITTED' });
    assert(resExp.success === true, 'EXPERIMENTAL_ON 예약 성공');
    assert(mgr.regimeEffectsMode === 'SHADOW', '예약 직후: 이전 모드 SHADOW 유지');

    // Step 3 실행 -> 스텝 경계에서 EXPERIMENTAL_ON 적용
    await mgr.step(30);
    assert(mgr.regimeEffectsMode === 'EXPERIMENTAL_ON', 'Step 3 경계에서 EXPERIMENTAL_ON 정상 적용');
    assert(mgr.enableRegimeEffects === true, 'EXPERIMENTAL_ON 모드에서 enableRegimeEffects === true');

    // OFF 모드 전환 예약
    const resOff = mgr.setRegimeEffectsMode('OFF');
    assert(resOff.success === true, 'OFF 모드 예약 성공');

    // Step 4 실행 -> 스텝 경계에서 OFF 적용
    await mgr.step(30);
    assert(mgr.regimeEffectsMode === 'OFF', 'Step 4 경계에서 OFF 모드 정상 복귀');
    assert(mgr.enableRegimeEffects === false, 'OFF 모드에서 enableRegimeEffects === false');

    // 모드 전환 이력 검증
    const diag = mgr.getRegimeModeDiagnostics();
    assert(diag.modeChangeHistory.length === 3, `전환 이력 3건 기록 확인 (실제: ${diag.modeChangeHistory.length})`);
    assert(diag.modeChangeHistory[0].fromMode === 'OFF' && diag.modeChangeHistory[0].toMode === 'SHADOW', '이력 1: OFF -> SHADOW');
    assert(diag.modeChangeHistory[1].fromMode === 'SHADOW' && diag.modeChangeHistory[1].toMode === 'EXPERIMENTAL_ON', '이력 2: SHADOW -> EXPERIMENTAL_ON');
    assert(diag.modeChangeHistory[2].fromMode === 'EXPERIMENTAL_ON' && diag.modeChangeHistory[2].toMode === 'OFF', '이력 3: EXPERIMENTAL_ON -> OFF');

    console.log('  ✓ TEST 3 통과: 스텝 경계 무중단 모드 전환 및 이력 추적 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 4: SHADOW 모드 무영향성 (Zero Impact) 검증
  //  - OFF 실행 vs SHADOW 실행 시 동일 Seed에서 지문이 비트 단위 100% 일치하는지 확인
  //  - SHADOW 모드에서 detectedRegime은 정상 탐지되나 appliedRegime은 null인지 확인
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 4] SHADOW 모드 무영향성 (Zero Impact: OFF vs SHADOW 비트 일치) 검증');
  {
    const TEST_SEED = 101;

    async function runWithMode(mode: 'OFF' | 'SHADOW'): Promise<{ fingerprint: string; detectedRegime: string; appliedRegime: string | null }> {
      memoryDb.resetToSeedData();
      const mgr = new AgentManager(TEST_SEED, START_EPOCH_MS, {
        regimeEffectsMode: mode,
      });

      // Warmup
      await mgr.step(1800);
      await mgr.step(600);
      await mgr.step(30);

      // 동일 거시 이벤트 주입
      const eventTime = mgr.clock.simulationTime;
      mgr.registerEvent({
        eventId: `test4_bull_${mode}`,
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

      // 동일 시장 가격 상승 이력 주입
      for (const stock of memoryDb.stocks.values()) {
        memoryDb.stockPriceHistory.push({
          id: `hist_t4_${stock.id}_${mode}`,
          stock_id: stock.id,
          price: Math.round(stock.current_price * 1.03),
          recorded_at: new Date(eventTime).toISOString(),
        });
      }

      // 4스텝 실행
      for (let s = 1; s <= 4; s++) {
        await mgr.step(15);
        checkInvariants(`Test4_${mode}_Step${s}`);
      }

      const diag = mgr.getRegimeModeDiagnostics();
      return {
        fingerprint: getFingerprint(mgr),
        detectedRegime: diag.detectedRegime,
        appliedRegime: diag.appliedRegime,
      };
    }

    const runOff = await runWithMode('OFF');
    const runShadow = await runWithMode('SHADOW');

    assert(runOff.fingerprint === runShadow.fingerprint, 'OFF와 SHADOW 모드의 장부·체결·프로필·PRNG 지문 100% 비트 단위 일치');
    assert(runShadow.detectedRegime === 'BULL', `SHADOW 모드에서 국면 정상 탐지 확인 (detectedRegime: ${runShadow.detectedRegime})`);
    assert(runShadow.appliedRegime === null, `SHADOW 모드에서는 실제 봇/LP에 적용 안 됨 (appliedRegime === null)`);
    assert(runOff.appliedRegime === null, 'OFF 모드에서도 appliedRegime === null');

    console.log('  ✓ TEST 4 통과: SHADOW 모드 무영향성 및 관측/적용 분리 100% 검증 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 5: EXPERIMENTAL_ON 모드에서만 실제 효과 배수 반영 및 차이 발생 확인
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 5] EXPERIMENTAL_ON 모드 실제 효과 배수 반영 확인');
  {
    const TEST_SEED = 101;
    memoryDb.resetToSeedData();
    const mgrExp = new AgentManager(TEST_SEED, START_EPOCH_MS, {
      regimeEffectsMode: 'EXPERIMENTAL_ON',
    });

    await mgrExp.step(1800);
    await mgrExp.step(600);
    await mgrExp.step(30);

    const eventTime = mgrExp.clock.simulationTime;
    mgrExp.registerEvent({
      eventId: `test5_bull_exp`,
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
        id: `hist_t5_${stock.id}`,
        stock_id: stock.id,
        price: Math.round(stock.current_price * 1.03),
        recorded_at: new Date(eventTime).toISOString(),
      });
    }

    for (let s = 1; s <= 4; s++) {
      await mgrExp.step(15);
      checkInvariants(`Test5_EXP_Step${s}`);
    }

    const diag = mgrExp.getRegimeModeDiagnostics();
    assert(diag.currentMode === 'EXPERIMENTAL_ON', '현재 모드 EXPERIMENTAL_ON');
    assert(diag.detectedRegime === 'BULL', 'BULL 국면 탐지');
    assert(diag.appliedRegime === 'BULL', 'EXPERIMENTAL_ON 모드에서는 appliedRegime === "BULL"');
    assert(diag.appliedMultipliers['bot_buyArrival'] === 1.3, 'BULL 매수 도착 배수 1.3 적용 확인');
    assert(diag.appliedMultipliers['lp_spread'] === 0.9, 'BULL LP 스프레드 배수 0.9 적용 확인');
    assert(diag.invariantViolationCount === 0, '불변식 위반 0건');

    console.log('  ✓ TEST 5 통과: EXPERIMENTAL_ON 모드 실제 효과 적용 확인 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // TEST 6: 진단 정보 및 API 출력 형태 검증
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 6] getRegimeModeDiagnostics API 정합성 검증');
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(42, START_EPOCH_MS);
    const diag = mgr.getRegimeModeDiagnostics();

    assert('currentMode' in diag, 'currentMode 필드 존재');
    assert('pendingMode' in diag, 'pendingMode 필드 존재');
    assert('detectedRegime' in diag, 'detectedRegime 필드 존재');
    assert('appliedRegime' in diag, 'appliedRegime 필드 존재');
    assert('appliedMultipliers' in diag, 'appliedMultipliers 필드 존재');
    assert('recentDeferrals' in diag, 'recentDeferrals 필드 존재');
    assert('invariantViolationCount' in diag, 'invariantViolationCount 필드 존재');
    assert('modeChangeHistory' in diag, 'modeChangeHistory 필드 존재');

    console.log('  ✓ 진단 출력 예시:', JSON.stringify(diag, null, 2));
    console.log('  ✓ TEST 6 통과: 진단 API 출력 형태 검증 완료\n');
  }

  console.log('================================================================');
  console.log('  🎉 3단계 안전한 실험 활성화 준비 검증 완료 (모든 테스트 통과)');
  console.log('================================================================\n');

  process.exit(0);
}

if (require.main === module) {
  testRegimeActivationModes().catch((err) => {
    console.error('❌ FATAL ERROR in testRegimeActivationModes:', err);
    process.exit(1);
  });
}
