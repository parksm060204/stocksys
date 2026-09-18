import { spawn, ChildProcess } from 'child_process';
import http from 'http';

const TEST_PORT = 3098;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${msg}`);
    throw new Error(msg);
  }
  console.log(`  ✓ ${msg}`);
}

async function waitForServerReady(url: string, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/auth/csrf`);
      if (res.status === 200) {
        return true;
      }
    } catch {
      // wait and retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function runHttpIntegrationTests() {
  console.log('================================================================');
  console.log('  🌐 NEXTAUTH LIVE HTTP SERVER INTEGRITY SUITE');
  console.log(`  Starting Next.js production server on port ${TEST_PORT}...`);
  console.log('================================================================\n');

  let serverProcess: ChildProcess | null = null;

  try {
    // 1. 프로덕션 Next.js 서버를 테스트 전용 포트 3098에서 시작
    serverProcess = spawn('npx', ['next', 'start', '-p', String(TEST_PORT)], {
      cwd: process.cwd(),
      shell: true,
      stdio: 'pipe',
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        NEXTAUTH_URL: BASE_URL,
      },
    });

    serverProcess.stdout?.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Ready') || msg.includes('started')) {
        console.log(`  [NextServer] ${msg.trim()}`);
      }
    });

    serverProcess.stderr?.on('data', (data) => {
      // Suppress noisy output
    });

    console.log(`  Waiting for Next.js server on ${BASE_URL}...`);
    const ready = await waitForServerReady(BASE_URL, 35000);
    assert(ready, `Server responded on port ${TEST_PORT}`);

    // ─────────────────────────────────────────────────────────────────
    // 경로 1: GET /api/auth/session (정상 비로그인 세션)
    // ─────────────────────────────────────────────────────────────────
    console.log('\n▶ [TEST 1] GET /api/auth/session');
    const resSession = await fetch(`${BASE_URL}/api/auth/session`, {
      headers: { accept: 'application/json' },
    });
    assert(resSession.status === 200, `상태 코드는 200이어야 함 (실제: ${resSession.status})`);
    const ctSession = resSession.headers.get('content-type') || '';
    assert(ctSession.includes('application/json'), `Content-Type은 application/json이어야 함 (실제: ${ctSession})`);
    const bodySessionText = await resSession.text();
    let jsonSession;
    try {
      jsonSession = JSON.parse(bodySessionText);
    } catch (e) {
      throw new Error(`Session 응답이 JSON으로 파싱되지 않음: ${bodySessionText}`);
    }
    // 비로그인 상태는 null 또는 빈 객체
    assert(jsonSession === null || Object.keys(jsonSession).length === 0, `비로그인 상태는 null 또는 빈 세션 객체여야 함 (실제: ${JSON.stringify(jsonSession)})`);

    // ─────────────────────────────────────────────────────────────────
    // 경로 2: GET /api/auth/csrf (CSRF 토큰 발급)
    // ─────────────────────────────────────────────────────────────────
    console.log('\n▶ [TEST 2] GET /api/auth/csrf');
    const resCsrf = await fetch(`${BASE_URL}/api/auth/csrf`);
    assert(resCsrf.status === 200, `상태 코드는 200이어야 함 (실제: ${resCsrf.status})`);
    const ctCsrf = resCsrf.headers.get('content-type') || '';
    assert(ctCsrf.includes('application/json'), `Content-Type은 application/json이어야 함 (실제: ${ctCsrf})`);
    const jsonCsrf = await resCsrf.json();
    assert(typeof jsonCsrf.csrfToken === 'string' && jsonCsrf.csrfToken.length > 0, `유효한 csrfToken 문자열이 존재해야 함`);

    // ─────────────────────────────────────────────────────────────────
    // 경로 3: GET /api/auth/providers (프로바이더 목록)
    // ─────────────────────────────────────────────────────────────────
    console.log('\n▶ [TEST 3] GET /api/auth/providers');
    const resProviders = await fetch(`${BASE_URL}/api/auth/providers`);
    assert(resProviders.status === 200, `상태 코드는 200이어야 함 (실제: ${resProviders.status})`);
    const ctProviders = resProviders.headers.get('content-type') || '';
    assert(ctProviders.includes('application/json'), `Content-Type은 application/json이어야 함 (실제: ${ctProviders})`);
    const jsonProviders = await resProviders.json();
    assert(typeof jsonProviders === 'object' && jsonProviders !== null, `프로바이더 목록 객체 반환 확인`);

    // ─────────────────────────────────────────────────────────────────
    // 경로 4: GET /api/auth/signin (로그인 화면 또는 redirect)
    // ─────────────────────────────────────────────────────────────────
    console.log('\n▶ [TEST 4] GET /api/auth/signin (HTML / Redirect 계약 보존)');
    const resSignin = await fetch(`${BASE_URL}/api/auth/signin`, {
      redirect: 'manual', // 리다이렉트 자동 추적 안 함
    });
    console.log(`  Signin status: ${resSignin.status}`);
    const ctSignin = resSignin.headers.get('content-type') || '';
    const locSignin = resSignin.headers.get('location') || '';
    console.log(`  Signin Content-Type: ${ctSignin}, Location: ${locSignin}`);
    // NextAuth pages.signIn = "/" 설정으로 인해 "/"로 302 리다이렉트되거나 200 HTML 반환
    assert(
      (resSignin.status === 302 && locSignin.length > 0) || (resSignin.status === 200 && ctSignin.includes('text/html')),
      `signin은 302 redirect(Location 헤더 포함) 또는 200 HTML이어야 하며 JSON으로 위장되지 않아야 함`
    );

    // ─────────────────────────────────────────────────────────────────
    // 경로 5: POST /api/auth/signout (로그아웃 요청)
    // ─────────────────────────────────────────────────────────────────
    console.log('\n▶ [TEST 5] POST /api/auth/signout (Redirect 계약 보존)');
    const resSignout = await fetch(`${BASE_URL}/api/auth/signout`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: `csrfToken=${encodeURIComponent(jsonCsrf.csrfToken)}`,
    });
    console.log(`  Signout status: ${resSignout.status}`);
    const locSignout = resSignout.headers.get('location') || '';
    console.log(`  Signout Location: ${locSignout}`);
    assert(
      resSignout.status === 302 && locSignout.length > 0,
      `signout은 302 redirect(Location 헤더 포함)여야 하며 JSON으로 위장되지 않아야 함`
    );

    // ─────────────────────────────────────────────────────────────────
    // 경로 6: GET /api/auth/callback/google (OAuth 콜백 에러 처리)
    // ─────────────────────────────────────────────────────────────────
    console.log('\n▶ [TEST 6] GET /api/auth/callback/google without code (OAuth Callback Error Redirect)');
    const resCallback = await fetch(`${BASE_URL}/api/auth/callback/google`, {
      redirect: 'manual',
    });
    console.log(`  Callback status: ${resCallback.status}`);
    const locCallback = resCallback.headers.get('location') || '';
    console.log(`  Callback Location: ${locCallback}`);
    assert(
      resCallback.status === 302 && (locCallback.includes('error') || locCallback.includes('/')),
      `비정상 콜백은 302 redirect로 error 페이지 또는 홈페이지로 리다이렉트되어야 함`
    );

    console.log('\n================================================================');
    console.log('  🎉 ALL 6 LIVE HTTP NEXTAUTH INTEGRATION TESTS PASSED (EXIT 0)');
    console.log('================================================================');
  } finally {
    if (serverProcess) {
      console.log('\n  Shutting down Next.js test server...');
      serverProcess.kill('SIGTERM');
      // Windows child process tree cleanup
      if (process.platform === 'win32' && serverProcess.pid) {
        try {
          spawn('taskkill', ['/pid', String(serverProcess.pid), '/f', '/t']);
        } catch {}
      }
    }
  }
  process.exit(0);
}

runHttpIntegrationTests().catch((err) => {
  console.error('\nHTTP INTEGRATION TEST SUITE FAILED:', err);
  process.exit(1);
});
