import * as fs from 'fs';
import * as path from 'path';

function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return result;

  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        result[key] = val;
      }
    }
  }
  return result;
}

async function verifyEnvAlignment() {
  console.log('================================================================');
  console.log('🔗 [ENV ALIGNMENT] engine-server ↔ Next.js 환경변수 일치 점검');
  console.log('================================================================\n');

  const rootEnvPath = path.resolve(process.cwd(), '.env.local');
  const engineEnvPath = path.resolve(process.cwd(), 'engine-server/.env');

  const rootEnv = parseEnvFile(rootEnvPath);
  const engineEnv = parseEnvFile(engineEnvPath);

  const rootUrl = rootEnv['NEXT_PUBLIC_ENGINE_DB_URL'] || rootEnv['ENGINE_DB_URL'];
  const engineUrl = engineEnv['NEXT_PUBLIC_ENGINE_DB_URL'] || engineEnv['ENGINE_DB_URL'];

  const rootAnonKey = rootEnv['NEXT_PUBLIC_ENGINE_DB_ANON_KEY'] || rootEnv['ENGINE_DB_ANON_KEY'];
  const engineAnonKey = engineEnv['NEXT_PUBLIC_ENGINE_DB_ANON_KEY'] || engineEnv['ENGINE_DB_ANON_KEY'];

  const rootServiceKey = rootEnv['ENGINE_DB_SERVICE_ROLE_KEY'];
  const engineServiceKey = engineEnv['ENGINE_DB_SERVICE_ROLE_KEY'];

  console.log(`▶ Next.js 루트 환경 (.env.local):`);
  console.log(`  - DB URL: ${rootUrl || 'N/A'}`);
  console.log(`  - Anon Key: ${rootAnonKey ? '설정됨 (값 비공개)' : 'N/A'}`);
  console.log(`  - Service Key: ${rootServiceKey ? '설정됨 (값 비공개)' : 'N/A'}`);

  console.log(`\n▶ engine-server 환경 (engine-server/.env):`);
  console.log(`  - DB URL: ${engineUrl || 'N/A'}`);
  console.log(`  - Anon Key: ${engineAnonKey ? '설정됨 (값 비공개)' : 'N/A'}`);
  console.log(`  - Service Key: ${engineServiceKey ? '설정됨 (값 비공개)' : 'N/A'}`);

  const urlMatches = rootUrl === engineUrl;
  const anonMatches = rootAnonKey === engineAnonKey;
  const serviceMatches = rootServiceKey === engineServiceKey;

  console.log('\n================================================================');
  const isStandalone = (rootEnv['NEXT_PUBLIC_USE_IN_MEMORY'] ?? 'true') !== 'false';
  if (isStandalone && !rootUrl) {
    console.log('ℹ️ [모드 안내] 현재 루트는 Local Standalone Mode로 동작 중입니다.');
    if (engineUrl) {
      console.log(`⚠️ [비활성 레거시 경고] engine-server/.env에 레거시 원격 DB URL(${engineUrl})이 남아 있습니다 (로컬 실행에서는 미사용).`);
    }
    console.log('🏁 [검증 결과] Local Standalone Mode 기준 환경 점검 완료 ✅');
  } else if (!isStandalone) {
    console.log('🏁 [검증 결과] ❌ NEXT_PUBLIC_USE_IN_MEMORY=false 설정이 감지되었으나 현재 활성 서버(localDevMode.ts)는 Local Standalone Mode만 지원합니다.');
    if (rootUrl && !rootUrl.startsWith('https://')) {
      console.log(`  - ❌ 원격 DB URL(${rootUrl})이 HTTPS가 아닙니다 (sharedRateLimiter.ts는 https:// 필수).`);
    }
    process.exitCode = 1;
  } else if (urlMatches && anonMatches && serviceMatches) {
    console.log('🏁 [검증 결과] 프론트엔드와 백엔드 엔진이 동일한 DB 인스턴스를 바라보고 있습니다. ✅ (100% 일치)');
  } else {
    console.log('🏁 [검증 결과] ❌ 프론트엔드와 engine-server의 DB 연결 정보에 불일치가 있습니다.');
    if (!urlMatches) console.log(`  - URL 불일치: 루트(${rootUrl}) vs 엔진(${engineUrl})`);
    if (!anonMatches) console.log('  - Anon Key 불일치');
    if (!serviceMatches) console.log('  - Service Role Key 불일치');
    process.exitCode = 1;
  }
  console.log('================================================================\n');
}

verifyEnvAlignment().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
