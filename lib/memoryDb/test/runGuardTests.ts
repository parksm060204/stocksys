import { createClient } from '../../supabase/client';

async function runGuardTestSuite() {
  console.log('================================================================');
  console.log('🛡️ [PRODUCTION GUARD TEST] 환경 분기 가드 & Fail-Fast 검증');
  console.log('================================================================\n');

  let passedTests = 0;
  const totalTests = 3;

  const originalEnv = { ...process.env };

  // ── [TEST 1] NODE_ENV=production + NEXT_PUBLIC_USE_IN_MEMORY=true 시 차단 검증 ──
  console.log('▶ [TEST 1] 프로덕션 환경에서 인메모리 플래그 활성화 시 Fail-Fast 에러 차단');
  try {
    (process.env as any).NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_USE_IN_MEMORY = 'true';

    // 캐시 클리어
    createClient();
    console.error('  결과: ❌ FAIL (프로덕션에서 에러 없이 인메모리로 진입함)');
  } catch (err: any) {
    if (err.message.includes('[SECURITY CRITICAL]')) {
      console.log(`  - 포착된 에러: ${err.message}`);
      console.log('  결과: ✅ PASS (프로덕션 인메모리 진입 100% 차단 성공)');
      passedTests++;
    } else {
      console.error('  결과: ❌ FAIL (예상치 못한 에러):', err);
    }
  }

  // ── [TEST 2] NODE_ENV=production + DB URL 부재 시 Silent Fallback 차단 검증 ──
  console.log('\n▶ [TEST 2] 프로덕션 환경에서 vm-db URL 부재 시 Silent Fallback 차단');
  try {
    (process.env as any).NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_USE_IN_MEMORY = 'false';
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    createClient();
    console.error('  결과: ❌ FAIL (프로덕션에서 조용히 Mock으로 폴백됨)');
  } catch (err: any) {
    if (err.message.includes('[CONFIGURATION ERROR]')) {
      console.log(`  - 포착된 에러: ${err.message}`);
      console.log('  결과: ✅ PASS (Silent Fallback 완전 차단 성공)');
      passedTests++;
    } else {
      console.error('  결과: ❌ FAIL (예상치 못한 에러):', err);
    }
  }

  // ── [TEST 3] NODE_ENV=development 환경에서 인메모리 정상 동작 회귀 검증 ──
  console.log('\n▶ [TEST 3] 개발 모드(NODE_ENV=development)에서 인메모리 정상 구동 확인');
  try {
    (process.env as any).NODE_ENV = 'development';
    process.env.NEXT_PUBLIC_USE_IN_MEMORY = 'true';

    const client = createClient();
    const { data: stocks } = await client.from('stocks').select('*').limit(3);

    console.log(`  - 조회된 주식 수: ${stocks?.length}개`);
    if (stocks && stocks.length > 0) {
      console.log('  결과: ✅ PASS (개발 환경에서 인메모리 데모 모드 정상 작동)');
      passedTests++;
    } else {
      console.error('  결과: ❌ FAIL');
    }
  } catch (err: any) {
    console.error('  결과: ❌ FAIL (개발 환경 에러):', err);
  }

  // 환경변수 복원
  process.env = originalEnv;

  console.log('\n================================================================');
  if (passedTests === totalTests) {
    console.log(`🏁 [최종 결과] 프로덕션 가드 검증: 모든 테스트 통과 (${passedTests}/${totalTests}) 100% ✅`);
  } else {
    console.log(`🏁 [최종 결과] 프로덕션 가드 검증: 일부 실패 (${passedTests}/${totalTests}) ❌`);
  }
  console.log('================================================================\n');
}

runGuardTestSuite().catch(console.error);
