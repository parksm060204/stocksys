import { GET, POST } from '../app/api/auth/[...nextauth]/route';

async function main() {
  console.log('================================================================');
  console.log('  🧪 NEXTAUTH SAFE HANDLER INTEGRITY VERIFICATION');
  console.log('================================================================');

  // TEST 1: 정상적인 세션 조회 요청
  console.log('\n▶ [TEST 1] Standard /api/auth/session simulation');
  const req1 = new Request('http://localhost:3000/api/auth/session', {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  const res1 = await GET(req1, { params: Promise.resolve({ nextauth: ['session'] }) });
  console.log('  Status code:', res1.status);
  const text1 = await res1.text();
  console.log('  Response body:', text1);
  
  if (text1.startsWith('<!DOCTYPE') || text1.startsWith('<html')) {
    throw new Error('TEST 1 FAILED: Server returned HTML instead of JSON!');
  }
  
  const json1 = JSON.parse(text1);
  console.log('  ✓ TEST 1 PASS: Valid JSON response returned (parsed successfully)');

  // TEST 2: 내부 에러 유발 시 fallback JSON 검증
  console.log('\n▶ [TEST 2] Internal error simulation (Graceful JSON fallback)');
  const req2 = new Request('http://localhost:3000/api/auth/session', {
    method: 'GET',
  });
  // null context를 전달하여 핸들러 내부에서 예외를 유도
  const res2 = await GET(req2, null as any);
  console.log('  Fallback status code:', res2.status);
  const text2 = await res2.text();
  console.log('  Fallback body:', text2);

  if (text2.startsWith('<!DOCTYPE') || text2.startsWith('<html')) {
    throw new Error('TEST 2 FAILED: Fallback returned HTML instead of JSON!');
  }

  const json2 = JSON.parse(text2);
  console.log('  ✓ TEST 2 PASS: Fallback returned valid JSON without throwing HTML error');

  // TEST 3: 임의의 액션 요청 에러 시 JSON 검증
  console.log('\n▶ [TEST 3] Arbitrary auth action error (Non-session)');
  const req3 = new Request('http://localhost:3000/api/auth/csrf', {
    method: 'GET',
  });
  const res3 = await GET(req3, null as any);
  const text3 = await res3.text();
  console.log('  Non-session fallback body:', text3);
  const json3 = JSON.parse(text3);
  if (!json3.error) {
    throw new Error('TEST 3 FAILED: Expected error field in response');
  }
  console.log('  ✓ TEST 3 PASS: Error JSON returned with status 200/safe');

  console.log('\n================================================================');
  console.log('  🎉 ALL NEXTAUTH VERIFICATION TESTS PASSED (EXIT CODE 0)');
  console.log('================================================================');
}

main().catch(err => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
