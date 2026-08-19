/**
 * 정산 엔진 종합 검증 스위트 v2 (실제 DB 트랜잭션 기반)
 * STEP 1: 50명 병렬 Race Condition → SUM(cash) 오차 0원 증명
 * STEP 2: 마진콜 → LIQUIDATION 시장가 주문 DB Insert 증명
 * STEP 3: 롤오버 원자적 트랜잭션 (SUCCESS + FAIL 케이스) DB 증명
 */

import { runStep1RaceConditionProof } from './step1_zerosum';
import { runStep2LiquidationProof } from './step2_margincall';
import { runStep3RolloverAtomicityProof } from './step3_option_expiry';

async function main() {
  console.log('\n' + '█'.repeat(64));
  console.log('  🏦 정산 엔진 실전 검증 스위트 v2 (실DB 트랜잭션 기반)');
  console.log('  타겟: http://49.247.136.231:3001 (PostgreSQL/PostgREST)');
  console.log('  날짜:', new Date().toISOString());
  console.log('█'.repeat(64));

  const startTime = Date.now();
  let step1Pass = false, step2Pass = false, step3Pass = false;

  // ══ STEP 1 ══════════════════════════════════════════════════════
  try {
    const s1 = await runStep1RaceConditionProof();
    step1Pass = s1.passed;
  } catch (e: unknown) {
    console.error(`\n❌ STEP 1 실행 오류: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ══ STEP 2 ══════════════════════════════════════════════════════
  try {
    const s2 = await runStep2LiquidationProof();
    step2Pass = s2.passed;
  } catch (e: unknown) {
    console.error(`\n❌ STEP 2 실행 오류: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ══ STEP 3 ══════════════════════════════════════════════════════
  try {
    const s3 = await runStep3RolloverAtomicityProof();
    step3Pass = s3.passed;
  } catch (e: unknown) {
    console.error(`\n❌ STEP 3 실행 오류: ${e instanceof Error ? e.message : String(e)}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '█'.repeat(64));
  console.log('  📋 최종 종합 판정');
  console.log('█'.repeat(64));
  console.log(`  STEP 1 Race Condition 방어 (50명 병렬 RPC): ${step1Pass ? '🟢 PASS' : '🔴 FAIL'}`);
  console.log(`  STEP 2 마진콜 → LIQUIDATION DB Insert    : ${step2Pass ? '🟢 PASS' : '🔴 FAIL'}`);
  console.log(`  STEP 3 롤오버 원자성 (SUCCESS + FAIL)    : ${step3Pass ? '🟢 PASS' : '🔴 FAIL'}`);
  console.log(`  총 소요 시간                              : ${elapsed}s`);

  const allPass = step1Pass && step2Pass && step3Pass;
  console.log(`\n  종합 결과: ${allPass ? '✅ ALL PASS — 정산 엔진 100% 무결성 증명 완료' : '⚠️  일부 실패 — 위 리포트 확인 필요'}`);
  console.log('█'.repeat(64) + '\n');

  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
