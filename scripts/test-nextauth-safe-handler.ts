import { GET, POST } from '../app/api/auth/[...nextauth]/route';

async function main() {
  console.log('================================================================');
  console.log('  🧪 NEXTAUTH SAFE HANDLER STATUS CODE & CONTRACT VERIFICATION');
  console.log('================================================================');

  // TEST 1: 내부 에러 유발 시 200이 아닌 500 JSON 반환 검증
  console.log('\n▶ [TEST 1] Server error simulation must return HTTP 500 JSON (Not 200 OK)');
  const req1 = new Request('http://localhost:3000/api/auth/session', {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  // null context를 전달하여 safeAuthHandler 내부에서 NextAuth 핸들러 예외 유도
  const res1 = await GET(req1, null as any);
  console.log('  Status code:', res1.status);
  const text1 = await res1.text();
  console.log('  Response body:', text1);

  if (res1.status !== 500) {
    throw new Error(`TEST 1 FAILED: Server error must return HTTP 500, but got ${res1.status}`);
  }

  if (text1.startsWith('<!DOCTYPE') || text1.startsWith('<html')) {
    throw new Error('TEST 1 FAILED: Server returned HTML instead of JSON!');
  }

  const json1 = JSON.parse(text1);
  if (json1.error !== 'InternalAuthenticationError') {
    throw new Error(`TEST 1 FAILED: Expected error "InternalAuthenticationError", got "${json1.error}"`);
  }
  if (json1.message !== 'Authentication service is temporarily unavailable.') {
    throw new Error(`TEST 1 FAILED: Internal exception details were leaked: "${json1.message}"`);
  }
  console.log('  ✓ TEST 1 PASS: Returned HTTP 500 JSON with sanitized error message (no 200 disguise)');

  // TEST 2: CSRF 엔드포인트 에러 시 500 JSON 반환 검증
  console.log('\n▶ [TEST 2] CSRF endpoint error must return HTTP 500 JSON');
  const req2 = new Request('http://localhost:3000/api/auth/csrf', {
    method: 'GET',
  });
  const res2 = await GET(req2, null as any);
  console.log('  Status code:', res2.status);
  const text2 = await res2.text();
  console.log('  Response body:', text2);

  if (res2.status !== 500) {
    throw new Error(`TEST 2 FAILED: Expected HTTP 500, got ${res2.status}`);
  }
  const json2 = JSON.parse(text2);
  if (json2.message !== 'Authentication service is temporarily unavailable.') {
    throw new Error(`TEST 2 FAILED: Message leaked: "${json2.message}"`);
  }
  console.log('  ✓ TEST 2 PASS: CSRF error returned HTTP 500 JSON without leaking internals');

  // TEST 3: Providers 엔드포인트 에러 시 500 JSON 반환 검증
  console.log('\n▶ [TEST 3] Providers endpoint error must return HTTP 500 JSON');
  const req3 = new Request('http://localhost:3000/api/auth/providers', {
    method: 'GET',
  });
  const res3 = await GET(req3, null as any);
  if (res3.status !== 500) {
    throw new Error(`TEST 3 FAILED: Expected HTTP 500, got ${res3.status}`);
  }
  console.log('  ✓ TEST 3 PASS: Providers error returned HTTP 500 JSON');

  console.log('\n================================================================');
  console.log('  🎉 ALL NEXTAUTH STATUS CODE VERIFICATION TESTS PASSED');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
