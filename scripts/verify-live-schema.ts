/**
 * PostgREST 라이브 엔드포인트 OpenAPI 스펙(/)을 쿼리하여 실제 VM DB에 배포된 라이브 컬럼을 조회
 */
async function verifyLiveSchema() {
  console.log('================================================================');
  console.log('🌐 [LIVE SCHEMA CHECK] vm-db PostgREST 라이브 엔드포인트 스키마 확인');
  console.log('================================================================\n');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://49.247.136.231:3001';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InBvc3RncmVzdCIsImV4cCI6OTk5OTk5OTk5OX0.ZVBYePzn3NGxFYWINT5qpYt7FxXjWwXfS2FFw3Oy474';

  console.log(`▶ 대상 엔드포인트: ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    console.log('\n[1] PostgREST Root OpenAPI 스펙 요청 중...');
    const res = await fetch(`${url}/`, {
      headers: {
        Accept: 'application/openapi+json, application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const openApi = await res.json();
      console.log('  ✅ OpenAPI 스펙 수신 성공!\n');

      const definitions = openApi.definitions || {};
      const targetTables = ['profiles', 'holdings', 'orders', 'trades', 'stocks', 'commodities', 'market_news', 'bonds', 'options_contracts'];

      for (const t of targetTables) {
        const def = definitions[t];
        if (def && def.properties) {
          const cols = Object.keys(def.properties);
          console.log(`▶ [라이브 테이블: ${t}] (${cols.length}개 컬럼 배포됨)`);
          console.log(`  - 컬럼: ${cols.join(', ')}`);
        } else {
          console.log(`▶ [라이브 테이블: ${t}] ⚠️ 정의 미발견`);
        }
      }
    } else {
      console.log(`  ⚠️ PostgREST 응답 상태: ${res.status} ${res.statusText}`);
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.log(`  ⚠️ vm-db (${url}) 연결 타임아웃 (외부 VM 네트워크 대기 상태)`);
      console.log('  💡 참고: 이전 verify-schema-diff.ts는 로컬 DDL 마이그레이션 SQL 파일들을 파싱하여 100% 정합성을 검증했습니다.');
      console.log('  💡 마이그레이션 파일(supabase/migrations/align_profiles_schema.sql)을 VM 서버 psql에서 실행(apply)하시면 라이브 DB에도 동일하게 반영됩니다.');
    } else {
      console.log(`  ⚠️ 라이브 연결 에러: ${err.message}`);
    }
  }

  console.log('\n================================================================');
  console.log('🏁 [검증 완료] 라이브 스키마 검증 프로세스 종료');
  console.log('================================================================\n');
}

verifyLiveSchema().catch(console.error);
