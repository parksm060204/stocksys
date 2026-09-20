/**
 * scripts/test-regime-activation-modes.ts
 *
 * STOCKSYS 시장 국면 운용 모드 최종 안전성 보완 검증 스위트
 *
 * 1단계: Capability 보안 경계 및 reset 감사 이력
 * 2단계: 동일 스냅샷 기반 SHADOW 및 런타임 불변식 진단
 * 3단계: 실제 가격 이력 조회 및 채권 fallback 결정론
 */

import * as fs from 'fs';
import * as path from 'path';
import { memoryDb, OrderRecord, HoldingRecord, TradeRecord } from '../lib/memoryDb/memoryStore';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import {
  ServerRegimeAuthorizationProvider,
  OperationalRegimeCapabilityVerifier,
  isValidRegimeExperimentCapability,
  MAX_CAPABILITY_TTL_MS,
  ALLOWED_CLOCK_SKEW_MS,
} from '../lib/engine/simulation/regime/regimeAuth';
import * as regimeBarrel from '../lib/engine/simulation/regime';
import {
  TestRegimeAuthorizationProvider,
  TestRegimeCapabilityVerifier,
  isValidTestRegimeCapability,
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

  // 1.1 운영 배럴 및 운영 모듈에서 테스트 발급 기능 완전 미노출 검증
  assert(
    !('TestRegimeAuthorizationProvider' in regimeBarrel),
    '1.1-A TestRegimeAuthorizationProvider 운영 배럴(regime/index.ts) 미노출 확인'
  );
  assert(
    !('createTestRegimeCapability' in regimeBarrel),
    '1.1-B createTestRegimeCapability 운영 배럴(regime/index.ts) 미노출 확인'
  );
  assert(
    !('createTestCapabilityForVerifier' in regimeBarrel),
    '1.1-C createTestCapabilityForVerifier 운영 배럴(regime/index.ts) 미노출 확인'
  );
  assert(
    !('_createRegimeCapabilityRaw' in regimeBarrel),
    '1.1-D _createRegimeCapabilityRaw 운영 배럴(regime/index.ts) 미노출 확인'
  );

  // 1.2 운영 코드(lib/, app/)에서 test-support import 없음 정적 검사
  {
    const rootDir = path.resolve(__dirname, '..');
    const checkDirs = ['lib', 'app'];
    let violationCount = 0;

    function scanDir(dirPath: string) {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(dirPath, ent.name);
        if (ent.isDirectory()) {
          scanDir(full);
        } else if (ent.isFile() && (ent.name.endsWith('.ts') || ent.name.endsWith('.tsx'))) {
          const content = fs.readFileSync(full, 'utf8');
          // 주석 제외한 import 구문에서 test-support 또는 testRegimeAuth 참조 검출
          const importMatches = content.match(/import\s+.*?['"].*?(test-support|testRegimeAuth).*?['"]/g);
          if (importMatches) {
            console.error(`[보안 위반] 운영 코드에서 테스트 지원 모듈 import 발견: ${full}`);
            violationCount++;
          }
        }
      }
    }

    for (const d of checkDirs) {
      scanDir(path.join(rootDir, d));
    }
    assert(violationCount === 0, '1.2 운영 코드(lib/, app/)에서 test-support 모듈 import 없음 확인');
  }

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

  // 1.4 운영 vs 테스트 Capability 격리: 올바른 인증 키 capability만 운영 verifier 통과, 테스트 capability는 운영 verifier 거절
  {
    const authKey = 'production-grade-auth-key-for-test-39824';
    process.env.REGIME_EXPERIMENT_AUTH_KEY = authKey;
    const serverProvider = new ServerRegimeAuthorizationProvider();
    const serverRes = serverProvider.issueCapability({ secretKey: authKey });
    assert(serverRes.success && !!serverRes.capability, '1.4-A 올바른 인증 키를 통한 운영 Capability 정상 발급');

    const operationalVerifier = new OperationalRegimeCapabilityVerifier();
    const opNow = Date.now();
    const opVerifyResult = operationalVerifier.verifyAndConsume(serverRes.capability, opNow);
    assert(opVerifyResult.success, '1.4-B 올바른 인증 키를 통한 Capability만 운영 verifier 통과');

    // 테스트용 capability는 운영 verifier에서 엄격히 거절됨 (운영 Symbol 부재)
    const testCap = createTestRegimeCapability('test-authorized-token', 60000, opNow);
    assert(!isValidRegimeExperimentCapability(testCap, opNow), '1.4-C 테스트용 capability는 운영 isValidRegimeExperimentCapability에서 거절됨');
    const testAgainstOp = operationalVerifier.verifyAndConsume(testCap, opNow);
    assert(!testAgainstOp.success, '1.4-D 테스트용 capability는 운영 verifier에서 거절됨');

    // 테스트 capability는 오직 TestRegimeCapabilityVerifier에서만 승인됨
    const testVerifier = new TestRegimeCapabilityVerifier();
    assert(testVerifier.verifyAndConsume(testCap, opNow).success, '1.4-E 테스트용 capability는 TestRegimeCapabilityVerifier에서 정상 승인됨');

    delete process.env.REGIME_EXPERIMENT_AUTH_KEY;
  }

  // 1.5 만료, 클록 스큐, 최대 TTL, 비정상 수치값 및 위조 객체 거절 검증
  {
    const baseNow = 1773500000000;
    const validTestCap = createTestRegimeCapability('test-authorized-token', 60000, baseNow - 10000);
    assert(isValidTestRegimeCapability(validTestCap, baseNow), '1.5-A 정상 테스트 capability 만료 전 유효');
    assert(isValidTestRegimeCapability(validTestCap, validTestCap.expiresAt - 1), '1.5-B 만료 1ms 직전까지 유효');
    assert(!isValidTestRegimeCapability(validTestCap, validTestCap.expiresAt), '1.5-C 만료 시각(nowMs >= expiresAt) 즉시 거절');
    assert(!isValidTestRegimeCapability(validTestCap, validTestCap.expiresAt + 1000), '1.5-D 만료 이후 거절');

    // 미래 발급 (클록 스큐 초과)
    const futureCap = createFutureTestRegimeCapability(ALLOWED_CLOCK_SKEW_MS + 1000, baseNow);
    assert(!isValidTestRegimeCapability(futureCap, baseNow), '1.5-E 미래 발급(허용 클록 스큐 초과) 거절');

    // 최대 TTL 초과
    const excessiveTtlCap = createExcessiveTtlTestRegimeCapability(MAX_CAPABILITY_TTL_MS + 1000, baseNow);
    assert(!isValidTestRegimeCapability(excessiveTtlCap, baseNow), '1.5-F 최대 허용 TTL(5분) 초과 capability 거절');

    // 비정상 수치값 (NaN, Infinity, 음수, 소수) 및 위조 객체 거절
    const forgedNoBrand = { id: 'rcap_test_fake1234567890', issuedAt: baseNow, expiresAt: baseNow + 60000 };
    assert(!isValidTestRegimeCapability(forgedNoBrand, baseNow), '1.5-G 브랜드 없는 위조 객체 거절');
    assert(!isValidRegimeExperimentCapability(forgedNoBrand, baseNow), '1.5-H 브랜드 없는 위조 객체 운영 검증기 거절');

    const capNaN = createTestRegimeCapability('test-authorized-token', NaN as any, baseNow);
    assert(!isValidTestRegimeCapability(capNaN, baseNow), '1.5-I NaN 타임스탬프 거절');
    const capInfinity = createTestRegimeCapability('test-authorized-token', Infinity as any, baseNow);
    assert(!isValidTestRegimeCapability(capInfinity, baseNow), '1.5-J Infinity 타임스탬프 거절');
    const capFloat = createTestRegimeCapability('test-authorized-token', 60000.5, baseNow + 0.1);
    assert(!isValidTestRegimeCapability(capFloat, baseNow), '1.5-K 소수점 타임스탬프(SafeInteger 아님) 거절');
  }

  // 1.6 생성자 직접 활성화 거절 및 프로덕션 환경 커스텀 DI 보호
  {
    memoryDb.resetToSeedData();
    const mgr1 = new AgentManager(42, START_EPOCH_MS, { regimeEffectsMode: 'EXPERIMENTAL_ON' as any });
    assert(mgr1.regimeEffectsMode === 'OFF', '1.6-A 생성자 regimeEffectsMode=EXPERIMENTAL_ON 거절');
    const mgr2 = new AgentManager(42, START_EPOCH_MS, { enableRegimeEffects: true as any });
    assert(mgr2.regimeEffectsMode === 'OFF', '1.6-B 생성자 enableRegimeEffects=true 거절');

    // 프로덕션 환경(NODE_ENV === 'production')에서는 임의 verifier 주입을 무시하고 운영 verifier 강제 적용
    const prevEnv = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'production';
    const dummyTestVerifier = new TestRegimeCapabilityVerifier();
    const prodMgr = new AgentManager(42, START_EPOCH_MS, { capabilityVerifier: dummyTestVerifier });
    const prodCap = createTestRegimeCapability('test-token', 60000, START_EPOCH_MS);
    // 운영 verifier가 강제 적용되었으므로 테스트 capability는 거절되어야 함
    const prodRes = prodMgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: prodCap, nowMs: START_EPOCH_MS });
    assert(!prodRes.success, '1.6-C 프로덕션 환경에서 커스텀 capabilityVerifier 주입 차단 및 운영 검증기 강제 확인');
    (process.env as any).NODE_ENV = prevEnv;
  }

  // 1.7 소비 시점 3대 상태 구분 및 단회용 정책 정밀 검증
  {
    memoryDb.resetToSeedData();
    const baseNow = 1773500000000;
    const testVerifier = new TestRegimeCapabilityVerifier();
    const mgr = new AgentManager(42, START_EPOCH_MS, { capabilityVerifier: testVerifier });

    const cap1 = createTestRegimeCapability('test-authorized-token', 60000, baseNow);
    const cap2 = createTestRegimeCapability('test-authorized-token', 60000, baseNow);

    // [케이스 1] 신규 EXPERIMENTAL_ON 전환 예약 성공 시 정확히 1회 소비
    const res1 = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: cap1, nowMs: baseNow });
    assert(res1.success === true, '1.7-A 신규 EXPERIMENTAL_ON 1차 전환 예약 성공');
    assert(testVerifier.getConsumedCount() === 1, '1.7-B 신규 예약 시 정확히 1회 소비됨');
    assert(testVerifier.isConsumed(cap1.id) === true, '1.7-C cap1 소비 확인');
    assert(mgr.getRegimeModeDiagnostics().pendingMode === 'EXPERIMENTAL_ON', '1.7-D pendingMode === EXPERIMENTAL_ON');

    // [케이스 2] 동일한 모드 전환이 이미 pending 대기 중인 경우 -> 중복 예약 no-op, capability 미소비
    const resDup = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: cap2, nowMs: baseNow });
    assert(resDup.success === true, '1.7-E 동일 모드 대기 중 중복 예약 성공 (no-op)');
    assert(resDup.message.includes('대기 중'), '1.7-F 대기 중 메시지 확인');
    assert(testVerifier.getConsumedCount() === 1, '1.7-G 중복 예약 시 cap2는 소비되지 않음 (소비 건수 1 유지)');
    assert(testVerifier.isConsumed(cap2.id) === false, '1.7-H cap2 미소비 보존 확인');

    // 스텝 진행 -> 모드가 실제로 EXPERIMENTAL_ON으로 적용됨
    await mgr.step(10);
    assert(mgr.regimeEffectsMode === 'EXPERIMENTAL_ON', '1.7-I 현재 모드 EXPERIMENTAL_ON 진입');
    assert(mgr.getRegimeModeDiagnostics().pendingMode === null, '1.7-J pendingMode 해제 (null)');

    // [케이스 3] 현재 모드와 요청 모드가 같고 pending이 없는 경우 -> no-op 응답, capability 미소비
    const resNoop = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: cap2, nowMs: baseNow + 10000 });
    assert(resNoop.success === true, '1.7-K 이미 활성 모드인 경우 no-op 응답 반환');
    assert(resNoop.message.includes('이미'), '1.7-L 이미 활성 메시지 확인');
    assert(testVerifier.getConsumedCount() === 1, '1.7-M 활성 중 no-op 요청 시 cap2 여전히 미소비 (소비 건수 1 유지)');
    assert(testVerifier.isConsumed(cap2.id) === false, '1.7-N cap2 미소비 보존 확인');

    // [케이스 4] 현재 모드는 EXPERIMENTAL_ON이지만 pending OFF가 대기 중인 상태에서 다시 EXPERIMENTAL_ON 요청
    // -> pending OFF를 취소/덮어쓰는 실질적인 권한 상승 요청이므로 capability를 소비해야 함
    const resOff = mgr.setRegimeEffectsMode('OFF');
    assert(resOff.success === true, '1.7-O pending OFF 예약 성공');
    assert(mgr.getRegimeModeDiagnostics().pendingMode === 'OFF', '1.7-P pendingMode === OFF');

    // 이제 cap2로 EXPERIMENTAL_ON 재요청 (pending 취소 및 EXPERIMENTAL_ON 유지)
    const resOverride = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: cap2, nowMs: baseNow + 11000 });
    assert(resOverride.success === true, '1.7-Q pending OFF 취소 및 EXPERIMENTAL_ON 재예약 성공');
    assert(testVerifier.getConsumedCount() === 2, '1.7-R 실질적 전환 덮어쓰기 시 cap2 정상 소비 (소비 건수 2)');
    assert(testVerifier.isConsumed(cap2.id) === true, '1.7-S cap2 소비 확인');
    assert(mgr.getRegimeModeDiagnostics().pendingMode === 'EXPERIMENTAL_ON', '1.7-T pendingMode === EXPERIMENTAL_ON 복원');

    // [케이스 5] 이미 소비된 capability 재사용 거절:
    // pendingMode를 OFF로 설정하여 실질적 전환 상황(pending === 'OFF')을 만든 뒤,
    // 이미 소비된 cap1으로 EXPERIMENTAL_ON 요청 시 verifier에서 ALREADY_CONSUMED로 거절됨
    mgr.setRegimeEffectsMode('OFF');
    const resReuse = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: cap1, nowMs: baseNow + 12000 });
    assert(resReuse.success === false, '1.7-U 이미 소비된 cap1 재사용 거절');
    assert(testVerifier.getConsumedCount() === 2, '1.7-V 거절 시 소비 건수 변화 없음 (2)');

    // [케이스 6] 거절된 요청의 capability는 미소비
    const cap3 = createTestRegimeCapability('test-authorized-token', 60000, baseNow + 13000);
    const fakeRejected = mgr.setRegimeEffectsMode('INVALID_MODE' as any, { capability: cap3, nowMs: baseNow + 13000 });
    assert(fakeRejected.success === false, '1.7-W 유효하지 않은 모드 거절');
    assert(testVerifier.isConsumed(cap3.id) === false, '1.7-X 거절된 요청의 cap3는 소비되지 않음');

    // [케이스 7] reset 후에도 소비된 capability 재사용 차단
    mgr.reset(42);
    const resReuseAfterReset = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: cap1, nowMs: baseNow + 20000 });
    assert(resReuseAfterReset.success === false, '1.7-Y reset 후에도 과거 소비된 cap1 재사용 차단');
  }

  // 1.8 저장소 포화 시 fail-closed 처리 및 만료 정리 검증
  {
    const satVerifier = new TestRegimeCapabilityVerifier();
    const satNow = 1773500000000;

    // 만료될 capability 5개 소비 등록 (과거 시각 등록, satNow 시점에는 만료됨)
    for (let i = 0; i < 5; i++) {
      const expCap = createTestRegimeCapability('test-token', 1000, satNow - 5000 + i * 100, `rcap_test_exp_${i}`);
      const regRes = satVerifier.verifyAndConsume(expCap, satNow - 4800 + i * 50);
      assert(regRes.success, `1.8-A-${i} 과거 시각 등록 성공`);
    }
    assert(satVerifier.getConsumedCount() === 5, '1.8-A 만료 대상 5건 소비 등록');

    // 새 검증 시 pruneExpiredConsumed가 동작하여 만료된 5건이 제거됨
    const newCap = createTestRegimeCapability('test-token', 60000, satNow, 'rcap_test_new_0');
    const newVerifyRes = satVerifier.verifyAndConsume(newCap, satNow);
    assert(newVerifyRes.success, '1.8-B 신규 검증 성공');
    assert(satVerifier.getConsumedCount() === 1, '1.8-C 만료된 5건 정리되고 신규 1건만 유지');

    // 포화 한계(1,000건) 시뮬레이션: 미만료 항목 1,000건 주입
    for (let i = 1; i < 1000; i++) {
      const liveCap = createTestRegimeCapability('test-token', 60000, satNow, `rcap_test_live_${i}`);
      satVerifier.verifyAndConsume(liveCap, satNow);
    }
    assert(satVerifier.getConsumedCount() === 1000, '1.8-D 1,000건 미만료 저장소 포화 도달');

    // 1,001번째 요청 -> 만료 정리 후에도 1,000건이므로 미만료 항목 삭제 없이 fail-closed (거절)
    const overflowCap = createTestRegimeCapability('test-token', 60000, satNow, 'rcap_test_overflow');
    const overflowRes = satVerifier.verifyAndConsume(overflowCap, satNow);
    assert(!overflowRes.success, '1.8-E 저장소 포화 시 신규 capability 거절 (Fail-closed)');
    assert(overflowRes.errorCode === 'CONSUMED_STORE_SATURATED', '1.8-F errorCode === CONSUMED_STORE_SATURATED');
    assert(satVerifier.getConsumedCount() === 1000, '1.8-G 기존 미만료 1,000건은 절대 삭제되지 않고 온전히 보존됨');
  }

  // 1.9 reset 시 감사 이력 시간 역행 방지 및 보존 검증
  {
    memoryDb.resetToSeedData();
    const testVerifier = new TestRegimeCapabilityVerifier();
    const mgr = new AgentManager(42, START_EPOCH_MS, { capabilityVerifier: testVerifier });

    // OFF -> SHADOW 전환
    mgr.setRegimeEffectsMode('SHADOW');
    await mgr.step(10);
    assert(mgr.regimeEffectsMode === 'SHADOW', '1.9-A SHADOW 활성화');

    // SHADOW -> EXPERIMENTAL_ON 전환
    const cap = createTestRegimeCapability('test-authorized-token', 60000, Date.now());
    mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: cap });
    await mgr.step(10);
    assert(mgr.regimeEffectsMode === 'EXPERIMENTAL_ON', '1.9-B EXPERIMENTAL_ON 활성화');

    const historyBefore = mgr.getRegimeModeDiagnostics().modeChangeHistory;
    assert(historyBefore.length >= 2, '1.9-C reset 전 모드 전환 이력 2건 이상 존재');

    // Reset 실행
    mgr.reset(42);
    const diagAfterReset = mgr.getRegimeModeDiagnostics();
    const historyAfter = diagAfterReset.modeChangeHistory;

    assert(diagAfterReset.currentMode === 'OFF', '1.9-D reset 후 currentMode === OFF');
    assert(diagAfterReset.pendingMode === null, '1.9-E reset 후 pendingMode === null');
    assert(diagAfterReset.appliedRegime === null, '1.9-F reset 후 appliedRegime === null');
    assert(Object.keys(diagAfterReset.appliedMultipliers).length === 0, '1.9-G reset 후 appliedMultipliers 빈 객체');

    // 감사 이력이 덮어쓰이지 않고 append 되었는지 검증
    assert(historyAfter.length === historyBefore.length + 1, '1.9-H reset 감사 기록이 기존 이력에 append 됨 (보존)');
    const lastRec = historyAfter[historyAfter.length - 1];
    assert(lastRec.toMode === 'OFF' && lastRec.fromMode === 'EXPERIMENTAL_ON', '1.9-I reset 이벤트 모드 정확');
    assert(lastRec.reason === 'simulation_reset_fail_safe', '1.9-J reset 이벤트 사유 정확');
    assert(lastRec.eventType === 'RESET_FAIL_SAFE', '1.9-K 비-OFF 상태 reset은 RESET_FAIL_SAFE로 기록');
    // 시간 역행 방지 검증: reset 감사 이벤트 timestamp는 reset 이전 시뮬레이션 시각이어야 함
    assert(lastRec.timestamp >= historyBefore[historyBefore.length - 1].timestamp, '1.9-L 감사 이력 시간 역행 없음 (preResetTime 보존)');

    // 이미 OFF 상태에서 reset 재실행 -> 허위 모드 전환 없이 eventType: 'RESET'
    mgr.reset(42);
    const historyAfter2 = mgr.getRegimeModeDiagnostics().modeChangeHistory;
    const lastRec2 = historyAfter2[historyAfter2.length - 1];
    assert(lastRec2.eventType === 'RESET', '1.9-M OFF 상태 reset은 RESET으로 기록');

    // 인증 정보 DTO 미노출 검증
    const diagStr = JSON.stringify(diagAfterReset);
    assert(!diagStr.includes('STOCKSYS_REGIME_ADMIN'), '1.9-N 진단 DTO에 구 기본키 미노출');
    assert(!diagStr.includes('TEST_PERMITTED'), '1.9-O 진단 DTO에 구 테스트키 미노출');
    assert(!diagStr.includes('rcap_'), '1.9-P 진단 DTO에 Capability 식별자 미노출');
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
    // 시나리오 4: DB 조회 오류 시 source === 'error' 반환 (정상 empty와 명확히 구분)
    const failingDb = createMockSupabase('stock_price_history');
    const res4 = await fetchCanonicalPriceHistory({
      db: failingDb,
      assetId: '00000000-0000-4000-8000-000000000101',
      ticker: '0010',
      assetKind: 'stock',
    });
    // 수정된 정책: DB 오류는 source === 'error' (이전 'empty'와 구분)
    assert(res4.source === 'error' && res4.error !== undefined && res4.error.code !== undefined, '3.1-D DB 오류 격리: source === error, 오류 코드 포함');
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
