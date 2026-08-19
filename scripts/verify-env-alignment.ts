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

  const rootUrl = rootEnv['NEXT_PUBLIC_SUPABASE_URL'] || rootEnv['SUPABASE_URL'];
  const engineUrl = engineEnv['NEXT_PUBLIC_SUPABASE_URL'] || engineEnv['SUPABASE_URL'];

  const rootAnonKey = rootEnv['NEXT_PUBLIC_SUPABASE_ANON_KEY'] || rootEnv['SUPABASE_ANON_KEY'];
  const engineAnonKey = engineEnv['NEXT_PUBLIC_SUPABASE_ANON_KEY'] || engineEnv['SUPABASE_ANON_KEY'];

  const rootServiceKey = rootEnv['SUPABASE_SERVICE_ROLE_KEY'];
  const engineServiceKey = engineEnv['SUPABASE_SERVICE_ROLE_KEY'];

  console.log(`▶ Next.js 루트 환경 (.env.local):`);
  console.log(`  - DB URL: ${rootUrl || 'N/A'}`);
  console.log(`  - Anon Key: ${rootAnonKey ? rootAnonKey.slice(0, 20) + '...' : 'N/A'}`);
  console.log(`  - Service Key: ${rootServiceKey ? rootServiceKey.slice(0, 20) + '...' : 'N/A'}`);

  console.log(`\n▶ engine-server 환경 (engine-server/.env):`);
  console.log(`  - DB URL: ${engineUrl || 'N/A'}`);
  console.log(`  - Anon Key: ${engineAnonKey ? engineAnonKey.slice(0, 20) + '...' : 'N/A'}`);
  console.log(`  - Service Key: ${engineServiceKey ? engineServiceKey.slice(0, 20) + '...' : 'N/A'}`);

  const urlMatches = rootUrl === engineUrl;
  const anonMatches = rootAnonKey === engineAnonKey;
  const serviceMatches = rootServiceKey === engineServiceKey;

  console.log('\n================================================================');
  if (urlMatches && anonMatches && serviceMatches) {
    console.log('🏁 [검증 결과] 프론트엔드와 백엔드 엔진이 동일한 vm-db 인스턴스를 바라보고 있습니다. ✅ (100% 일치)');
  } else {
    console.log('🏁 [검증 결과] ⚠️ 프론트엔드와 engine-server의 DB 연결 정보에 불일치가 있습니다.');
    if (!urlMatches) console.log(`  - URL 불일치: 루트(${rootUrl}) vs 엔진(${engineUrl})`);
    if (!anonMatches) console.log('  - Anon Key 불일치');
    if (!serviceMatches) console.log('  - Service Role Key 불일치');
  }
  console.log('================================================================\n');
}

verifyEnvAlignment().catch(console.error);
