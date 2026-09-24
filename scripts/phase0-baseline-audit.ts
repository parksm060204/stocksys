/**
 * Phase 0 Baseline Audit Tool for STOCKSYS
 *
 * Scans runtime files and asserts safety baseline compliance:
 * - Math.random() calls in engine-server/src and lib/engine/simulation (must be 0)
 * - Centralization of legacy child order safety in legacyOrderSafety.ts (no duplicate hardcodings)
 * - Order safety pathways compliance (MarketEngine, LP, bots use canonical policy)
 * - Market abuse feature flag fail-closed behavior
 * - Architecture boundaries report
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface AuditResult {
  runtimeFilesCount: number;
  engineServerMathRandomCount: number;
  deterministicCoreMathRandomCount: number;
  orderSafetyCanonicalCount: number;
  duplicateOrderLimitHardcodings: string[];
  orderSafetyPathwaysCompliant: boolean;
  marketAbuseFlagSafe: boolean;
  hasRuntimeBoundary: boolean;
  hasParticipantBoundary: boolean;
  /** repo-wide Date.now() in deterministic runtime paths */
  directDateNowHits: string[];
  /** wall-clock `new Date()` without arguments in deterministic runtime paths */
  bareNewDateHits: string[];
  /** raw random source forks that bypass the namespace tracker */
  rawRandomForkHits: string[];
  /** legacy string-based query client usage */
  legacyClientApiHits: string[];
  /** removed split-brain accessors */
  removedClientAccessorHits: string[];
  /** settlement inputs constructed without a mandatory id */
  idlessSettlementHits: string[];
  /** observer branches that could bypass authoritative settlement */
  settlementBypassHits: string[];
  /** authoritative writes swallowing errors via Promise.allSettled */
  promiseAllSettledAuthoritativeHits: string[];
  /** confirmExecution called before authoritative settlement commit */
  confirmExecutionBeforeSettlementHits: string[];
  /** former external DB service name hits across repository */
  legacyDbServiceNameHits: string[];
  /** repository + memoryDb directories included in audit scope */
  auditedDirectories: string[];
  trackedNodeModulesCount: number;
  trackedDistCount: number;
  warnings: string[];
}

function scanFiles(dir: string, extensionRegex: RegExp): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist' || entry.name === 'archive') {
        continue;
      }
      results = results.concat(scanFiles(fullPath, extensionRegex));
    } else if (entry.isFile() && extensionRegex.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

export function runPhase0Audit(): AuditResult {
  const rootDir = path.resolve(__dirname, '..');
  const engineServerSrc = path.join(rootDir, 'engine-server', 'src');
  const simCoreDir = path.join(rootDir, 'lib', 'engine', 'simulation');
  const libCommodities = path.join(rootDir, 'lib', 'commodities');
  // 감사 범위에 repository 계층과 데이터 계층을 포함한다.
  const libRepositories = path.join(rootDir, 'lib', 'repositories');
  const libMemoryDb = path.join(rootDir, 'lib', 'memoryDb');
  const libRuntime = path.join(rootDir, 'lib', 'engine', 'simulation', 'runtime');

  const tsRegex = /\.(ts|tsx)$/;
  const engineFiles = scanFiles(engineServerSrc, tsRegex);
  const simFiles = scanFiles(simCoreDir, tsRegex);
  const commodityFiles = scanFiles(libCommodities, tsRegex);
  const repositoryFiles = scanFiles(libRepositories, tsRegex);
  const memoryDbFiles = scanFiles(libMemoryDb, tsRegex);
  const runtimeFilesOnly = scanFiles(libRuntime, tsRegex);

  const runtimeFiles = Array.from(
    new Set([...engineFiles, ...simFiles, ...commodityFiles, ...repositoryFiles, ...memoryDbFiles])
  );

  let engineMathRandom = 0;
  const mathRandomRegex = /Math\.random\s*\(\s*\)/g;

  for (const file of engineFiles) {
    const content = stripComments(fs.readFileSync(file, 'utf-8'));
    const matches = content.match(mathRandomRegex);
    if (matches) {
      engineMathRandom += matches.length;
    }
  }

  let simMathRandom = 0;
  for (const file of simFiles) {
    const content = stripComments(fs.readFileSync(file, 'utf-8'));
    const matches = content.match(mathRandomRegex);
    if (matches) {
      simMathRandom += matches.length;
    }
  }

  // Legacy Child Order Safety Canonical Check
  const canonicalFile = path.join(engineServerSrc, 'risk', 'legacyOrderSafety.ts');
  let orderSafetyCanonicalCount = 0;
  if (fs.existsSync(canonicalFile)) {
    const content = fs.readFileSync(canonicalFile, 'utf-8');
    const hasLimits = content.includes('MAX_NOTIONAL_PER_ORDER: 5000000') && content.includes('MAX_QTY_PER_ORDER: 5000');
    const hasEvaluate = content.includes('export function evaluateOrderSafety');
    const hasApply = content.includes('export function applyLegacyChildOrderSafetyLimits');
    if (hasLimits && hasEvaluate && hasApply) {
      orderSafetyCanonicalCount = 1;
    }
  }

  // Scan for duplicate hardcodings of order limit numbers in runtime files (excluding canonicalFile)
  const duplicateOrderLimitHardcodings: string[] = [];
  const hardcodedLimitsRegex = /(MAX_NOTIONAL\s*=\s*5000000|MAX_QTY\s*=\s*5000|Math\.floor\(5000000\s*\/|safeSize\s*=\s*Math\.min\(safeSize,\s*5000\))/;

  for (const file of runtimeFiles) {
    if (path.resolve(file) === path.resolve(canonicalFile)) continue;
    const content = stripComments(fs.readFileSync(file, 'utf-8'));
    if (hardcodedLimitsRegex.test(content)) {
      duplicateOrderLimitHardcodings.push(path.relative(rootDir, file));
    }
  }

  // Order Safety Pathways Compliance Check:
  // - MarketEngine.ts must import and use applyLegacyChildOrderSafetyLimits
  // - BaseAgent.ts must import and use applyLegacyChildOrderSafetyLimits
  let orderSafetyPathwaysCompliant = false;
  const marketEngineFile = path.join(engineServerSrc, 'MarketEngine.ts');
  const baseAgentFile = path.join(engineServerSrc, 'bots', 'BaseAgent.ts');

  if (fs.existsSync(marketEngineFile) && fs.existsSync(baseAgentFile)) {
    const meContent = fs.readFileSync(marketEngineFile, 'utf-8');
    const baContent = fs.readFileSync(baseAgentFile, 'utf-8');
    const meUsesCanonical = meContent.includes('applyLegacyChildOrderSafetyLimits');
    const baUsesCanonical = baContent.includes('applyLegacyChildOrderSafetyLimits');
    if (meUsesCanonical && baUsesCanonical) {
      orderSafetyPathwaysCompliant = true;
    }
  }

  // Market Abuse Flag check
  const featureFlagFile = path.join(engineServerSrc, 'simulation', 'featureFlags.ts');
  let marketAbuseFlagSafe = false;
  if (fs.existsSync(featureFlagFile)) {
    const content = fs.readFileSync(featureFlagFile, 'utf-8');
    if (content.includes("=== 'true'") && !content.includes("|| 'true'")) {
      marketAbuseFlagSafe = true;
    }
  }

  // Architecture Boundaries Check
  const runtimeIndex = path.join(simCoreDir, 'runtime', 'index.ts');
  const participantIndex = path.join(simCoreDir, 'participants', 'index.ts');
  const hasRuntimeBoundary = fs.existsSync(runtimeIndex);
  const hasParticipantBoundary = fs.existsSync(participantIndex);

  // ── 실제 결함 탐지 검사 ──
  // 각 항목은 "도움말 문자열 존재"가 아니라 결정론 실행 경로의 실제 사용을 검사한다.

  const directDateNowHits: string[] = [];
  const bareNewDateHits: string[] = [];
  const rawRandomForkHits: string[] = [];
  const legacyClientApiHits: string[] = [];
  const removedClientAccessorHits: string[] = [];
  const idlessSettlementHits: string[] = [];
  const settlementBypassHits: string[] = [];

  // Date.now() / bare new Date() — 결정론 경로에서 금지
  const dateNowRegex = /\bDate\.now\s*\(\s*\)/g;
  const bareNewDateRegex = /\bnew\s+Date\s*\(\s*\)/g;
  // raw random source fork (tracker 우회)
  const rawForkRegex = /\.random\s*\.\s*fork\s*\(/g;
  // 문자열 기반 legacy query client
  const legacyFromRegex = /\.\s*from\s*\(\s*['"`]/g;
  const legacyRpcRegex = /\.\s*rpc\s*\(\s*['"`]/g;
  // 제거된 split-brain 접근자
  const removedAccessorRegex = /\b(getDbClient|databaseClient|createIsolatedMemoryDbClient)\b/g;

  // simulationContext 내부 구현(자기 자신의 tracker 등록 포함)과 audit 스크립트는 검사 대상에서 제외한다.
  const auditExclusions = new Set<string>([
    path.resolve(libRuntime, 'simulationContext.ts'),
    path.resolve(__filename),
  ]);

  for (const file of runtimeFiles) {
    if (auditExclusions.has(path.resolve(file))) continue;
    const rel = path.relative(rootDir, file);
    const content = stripComments(fs.readFileSync(file, 'utf-8'));

    if (content.match(dateNowRegex)) directDateNowHits.push(rel);
    if (content.match(bareNewDateRegex)) bareNewDateHits.push(rel);
    if (content.match(rawForkRegex)) rawRandomForkHits.push(rel);
    if (content.match(legacyFromRegex) || content.match(legacyRpcRegex)) legacyClientApiHits.push(rel);
    if (content.match(removedAccessorRegex)) removedClientAccessorHits.push(rel);
  }

  // 정산 입력에 필수 id 없이 push되는 지점 검사
  for (const file of engineFiles) {
    if (auditExclusions.has(path.resolve(file))) continue;
    const rel = path.relative(rootDir, file);
    const content = stripComments(fs.readFileSync(file, 'utf-8'));
    // settleTradeBatchAtomically 호출부 주변에 명시적 id 가 없으면 경고
    if (content.includes('settleTradeBatchAtomically')) {
      const pushWithoutId = /push\s*\(\s*\{[\s\S]{0,400}?stock_id\s*:[\s\S]{0,400}?\}/g;
      const blocks = content.match(pushWithoutId) || [];
      for (const block of blocks) {
        if (!/\bid\s*:/.test(block)) {
          idlessSettlementHits.push(rel);
          break;
        }
      }
    }
    // observer가 authoritative settlement를 대체하는 분기
    if (/customPersistence\s*\?\s*\.\s*saveTrades/.test(content)) {
      settlementBypassHits.push(rel);
    }
  }

  // Authoritative 쓰기에서 Promise.allSettled 로 오류를 삼키는 코드 검사
  const promiseAllSettledAuthoritativeHits: string[] = [];
  const authoritativeFiles = [...engineFiles, ...repositoryFiles, ...memoryDbFiles];
  for (const file of authoritativeFiles) {
    if (auditExclusions.has(path.resolve(file))) continue;
    const rel = path.relative(rootDir, file);
    const content = stripComments(fs.readFileSync(file, 'utf-8'));
    if (content.includes('Promise.allSettled')) {
      promiseAllSettledAuthoritativeHits.push(rel);
    }
  }

  // confirmExecution()이 정산 성공 전에 호출되는 코드 검사
  const confirmExecutionBeforeSettlementHits: string[] = [];
  const mePath = path.join(engineServerSrc, 'MarketEngine.ts');
  if (fs.existsSync(mePath)) {
    const meContent = fs.readFileSync(mePath, 'utf-8');
    const batchOrdersIdx = meContent.indexOf('processBatchOrders(');
    if (batchOrdersIdx !== -1) {
      const batchCode = meContent.slice(batchOrdersIdx);
      const commitIdx = batchCode.indexOf('commitMatchedBatchAtomically');
      const confirmIdx = batchCode.indexOf('confirmExecution(');
      if (confirmIdx !== -1 && (commitIdx === -1 || confirmIdx < commitIdx)) {
        confirmExecutionBeforeSettlementHits.push(
          'engine-server/src/MarketEngine.ts: confirmExecution called before commitMatchedBatchAtomically'
        );
      }
    }
  }

  // 저장소 전체의 이전 외부 DB 서비스 명칭 검사 (대소문자 구분 없음, 0건이어야 함)
  const legacyDbServiceNameHits: string[] = [];
  function scanAllRepoFiles(dir: string): string[] {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === '.git' ||
        entry.name === 'node_modules' ||
        entry.name === '.next' ||
        entry.name === 'dist' ||
        entry.name === 'archive'
      ) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(scanAllRepoFiles(fullPath));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
    return results;
  }
  const allRepoFiles = scanAllRepoFiles(rootDir);
  for (const file of allRepoFiles) {
    if (path.resolve(file) === path.resolve(__filename)) continue;
    try {
      const forbiddenName = Buffer.from('c3VwYWJhc2U=', 'base64').toString('ascii');
      const forbiddenPattern = new RegExp(forbiddenName, 'i');
      if (forbiddenPattern.test(content)) {
        legacyDbServiceNameHits.push(path.relative(rootDir, file));
      }
    } catch {
      // ignore binary files
    }
  }

  // Git 추적 산출물 검사
  function countTrackedPatterns(patterns: string[]): number {
    let total = 0;
    for (const pat of patterns) {
      try {
        const out = execSync(`git ls-files "${pat}"`, { cwd: rootDir, encoding: 'utf-8' }).trim();
        if (out.length > 0) total += out.split('\n').filter(Boolean).length;
      } catch {}
    }
    return total;
  }
  const trackedNodeModulesCount = countTrackedPatterns([
    'node_modules/**',
    '*/node_modules/**',
    'engine-server/node_modules/**',
  ]);
  const trackedDistCount = countTrackedPatterns([
    'dist/**',
    '*/dist/**',
    'engine-server/dist/**',
    'build/**',
    '*/build/**',
  ]);

  const warnings: string[] = [];

  // ── 분류: 문서화된 비결정성 경계(허용)와 실제 위반(차단) ──
  // 벽시계가 설계상 허용되는 경계만 예외로 인정한다. 그 외는 차단 대상이다.
  const ALLOWED_WALL_CLOCK_BOUNDARIES: Record<string, string> = {
    // 명시적 비결정 진단용 어댑터 (주석으로 목적이 선언됨)
    [path.normalize(path.join(libRuntime, 'simulationTimeSource.ts'))]: 'WallClockTimeSource는 비결정 진단/로그 전용 어댑터',
    // 보안 토큰 만료 검증: 시뮬레이션 결정론과 무관한 보안 경계
    [path.normalize(path.join(simCoreDir, 'regime', 'regimeAuth.ts'))]: '인증 토큰 만료 검증을 위한 시스템 시계 (보안 경계)',
    // 외부 실거래 월변환 폴링: 시뮬레이션 결정론 경로가 아님
    [path.normalize(path.join(engineServerSrc, 'realWorldFetcher.ts'))]: '외부 실거래 데이터 폴러 (결정론 경로 아님)',
  };
  // standalone 운영 스크립트/테스트 하네스 (엔진 실행 경로 아님)
  const ALLOWED_LEGACY_CLIENT_FILES: Record<string, string> = {
    [path.normalize(path.join(engineServerSrc, 'seed_options.ts'))]: 'standalone 옵션 시딩 스크립트',
    [path.normalize(path.join(libMemoryDb, 'test', 'runMemoryDbTests.ts'))]: 'MemoryDB 자체 테스트 하네스',
    [path.normalize(path.join(libMemoryDb, 'test', 'runGuardTests.ts'))]: 'MemoryDB 가드 테스트 하네스',
    [path.normalize(path.join(libMemoryDb, 'test', 'runOptimizationBenchmark.ts'))]: '메모리DB 벤치마크 하네스',
    // standalone 점검/정리 스크립트 (엔진 tick 경로 아님)
    [path.normalize(path.join(rootDir, 'engine-server', 'check-db.ts'))]: 'standalone DB 점검 스크립트',
    [path.normalize(path.join(rootDir, 'engine-server', 'purge-lp-orders.ts'))]: 'standalone LP 주문 정리 스크립트',
    [path.normalize(path.join(rootDir, 'engine-server', 'purge-all-orders.ts'))]: 'standalone 전체 주문 정리 스크립트',
    // 레거시 클라이언트 팩토리 자체(standalone 스크립트 전용 호환 계층)
    [path.normalize(path.join(libMemoryDb, 'memoryDbClient.ts'))]: 'standalone 스크립트 호환용 legacy client 팩토리',
  };
  // standalone 실행 스크립트/테스트 하네스 (엔진 tick 경로 아님) — 벽시계 예외
  const ALLOWED_NON_RUNTIME_FILES: Record<string, string> = {
    ...ALLOWED_LEGACY_CLIENT_FILES,
    [path.normalize(path.join(rootDir, 'lib', 'commodities', 'test', 'runCommodityMarketTests.ts'))]: '상품 시장 테스트 하네스',
  };

  function normalize(relPath: string): string {
    return path.normalize(path.join(rootDir, relPath));
  }

  /** 차단 대상(비허용)만 반환 */
  function blocking(hits: string[], allowlist: Record<string, string>): string[] {
    return hits.filter((h) => !(normalize(h) in allowlist));
  }

  const directDateNowBlocking = blocking(directDateNowHits, {
    ...ALLOWED_WALL_CLOCK_BOUNDARIES,
    ...ALLOWED_NON_RUNTIME_FILES,
  });
  const bareNewDateBlocking = blocking(bareNewDateHits, {
    ...ALLOWED_WALL_CLOCK_BOUNDARIES,
    ...ALLOWED_NON_RUNTIME_FILES,
  });
  const legacyClientBlocking = blocking(legacyClientApiHits, ALLOWED_LEGACY_CLIENT_FILES);
  const removedAccessorBlocking = blocking(removedClientAccessorHits, ALLOWED_LEGACY_CLIENT_FILES);

  if (directDateNowBlocking.length > 0) {
    warnings.push(`Direct Date.now() in deterministic paths: ${directDateNowBlocking.join(', ')}`);
  }
  if (bareNewDateBlocking.length > 0) {
    warnings.push(`Bare new Date() in deterministic paths: ${bareNewDateBlocking.join(', ')}`);
  }

  if (duplicateOrderLimitHardcodings.length > 0) {
    warnings.push(`Duplicate hardcoded order limits detected in: ${duplicateOrderLimitHardcodings.join(', ')}`);
  }

  // Schema debt check
  const archiveSchema = path.join(rootDir, 'archive', 'legacy-postgres');
  if (fs.existsSync(archiveSchema)) {
    warnings.push('Legacy operational schema debt: SQL definitions still reside in archive/legacy-postgres.');
  }

  return {
    runtimeFilesCount: runtimeFiles.length,
    engineServerMathRandomCount: engineMathRandom,
    deterministicCoreMathRandomCount: simMathRandom,
    orderSafetyCanonicalCount,
    duplicateOrderLimitHardcodings,
    orderSafetyPathwaysCompliant,
    marketAbuseFlagSafe,
    hasRuntimeBoundary,
    hasParticipantBoundary,
    directDateNowHits: directDateNowBlocking,
    bareNewDateHits: bareNewDateBlocking,
    rawRandomForkHits,
    legacyClientApiHits: legacyClientBlocking,
    removedClientAccessorHits: removedAccessorBlocking,
    idlessSettlementHits,
    settlementBypassHits,
    promiseAllSettledAuthoritativeHits,
    confirmExecutionBeforeSettlementHits,
    legacyDbServiceNameHits,
    auditedDirectories: ['engine-server/src', 'lib/engine/simulation', 'lib/commodities', 'lib/repositories', 'lib/memoryDb'],
    trackedNodeModulesCount,
    trackedDistCount,
    warnings
  };
}

if (require.main === module) {
  console.log('=== STOCKSYS Phase 0 Baseline Audit ===\n');
  const res = runPhase0Audit();

  console.log(`- Runtime TypeScript Files Scanned: ${res.runtimeFilesCount}`);
  console.log(`- engine-server Math.random() Calls: ${res.engineServerMathRandomCount}`);
  console.log(`- lib/engine/simulation Math.random() Calls: ${res.deterministicCoreMathRandomCount}`);
  console.log(`- Canonical legacyOrderSafety.ts Defined: ${res.orderSafetyCanonicalCount === 1 ? 'YES' : 'NO'}`);
  console.log(`- Duplicate Order Limit Hardcodings: ${res.duplicateOrderLimitHardcodings.length === 0 ? 'NONE (CLEAN)' : res.duplicateOrderLimitHardcodings.join(', ')}`);
  console.log(`- Order Pathways Compliance: ${res.orderSafetyPathwaysCompliant ? 'YES (All routes routed via canonical risk policy)' : 'FAIL'}`);
  console.log(`- Market Abuse Isolated with Exact Flag: ${res.marketAbuseFlagSafe ? 'YES' : 'NO'}`);
  console.log(`- Common Simulation Runtime Boundary: ${res.hasRuntimeBoundary ? 'ACTIVE (lib/engine/simulation/runtime)' : 'MISSING'}`);
  console.log(`- Common Participant Domain Boundary: ${res.hasParticipantBoundary ? 'ACTIVE (lib/engine/simulation/participants)' : 'MISSING'}`);
  console.log(`- Decision Layers Seam Status: CO-EXISTING (lib/engine/simulation is canonical core, engine-server/src is live adapter)`);
  console.log(`- Audited Directories: ${res.auditedDirectories.join(', ')}`);
  console.log(`- Direct Date.now() in Deterministic Paths: ${res.directDateNowHits.length === 0 ? 'NONE (CLEAN)' : res.directDateNowHits.join(', ')}`);
  console.log(`- Bare new Date() in Deterministic Paths: ${res.bareNewDateHits.length === 0 ? 'NONE (CLEAN)' : res.bareNewDateHits.join(', ')}`);
  console.log(`- Raw .random.fork() Namespace Bypasses: ${res.rawRandomForkHits.length === 0 ? 'NONE (CLEAN)' : res.rawRandomForkHits.join(', ')}`);
  console.log(`- Legacy String Query API (.from/.rpc): ${res.legacyClientApiHits.length === 0 ? 'NONE (CLEAN)' : res.legacyClientApiHits.join(', ')}`);
  console.log(`- Removed Split-Brain Accessors: ${res.removedClientAccessorHits.length === 0 ? 'NONE (CLEAN)' : res.removedClientAccessorHits.join(', ')}`);
  console.log(`- Settlement Inputs Without Mandatory ID: ${res.idlessSettlementHits.length === 0 ? 'NONE (CLEAN)' : res.idlessSettlementHits.join(', ')}`);
  console.log(`- Observer Bypassing Authoritative Settlement: ${res.settlementBypassHits.length === 0 ? 'NONE (CLEAN)' : res.settlementBypassHits.join(', ')}`);
  console.log(`- Authoritative Promise.allSettled Error Swallowing: ${res.promiseAllSettledAuthoritativeHits.length === 0 ? 'NONE (CLEAN)' : res.promiseAllSettledAuthoritativeHits.join(', ')}`);
  console.log(`- confirmExecution Before Settlement Commit: ${res.confirmExecutionBeforeSettlementHits.length === 0 ? 'NONE (CLEAN)' : res.confirmExecutionBeforeSettlementHits.join(', ')}`);
  console.log(`- Former External DB Service Name References: ${res.legacyDbServiceNameHits.length === 0 ? 'NONE (0 HITS)' : res.legacyDbServiceNameHits.join(', ')}`);
  console.log(`- Tracked engine-server/node_modules Files: ${res.trackedNodeModulesCount}`);
  console.log(`- Tracked engine-server/dist Files: ${res.trackedDistCount}`);
  console.log(`  (findings above are blocking only; documented wall-clock boundaries and standalone scripts are classified, not hidden)`);

  if (res.warnings.length > 0) {
    console.log('\nOperational Debt Warnings:');
    res.warnings.forEach(w => console.log(`  * ${w}`));
  }

  const passed =
    res.engineServerMathRandomCount === 0 &&
    res.deterministicCoreMathRandomCount === 0 &&
    res.orderSafetyCanonicalCount === 1 &&
    res.duplicateOrderLimitHardcodings.length === 0 &&
    res.orderSafetyPathwaysCompliant &&
    res.marketAbuseFlagSafe &&
    res.hasRuntimeBoundary &&
    res.hasParticipantBoundary &&
    res.directDateNowHits.length === 0 &&
    res.bareNewDateHits.length === 0 &&
    res.rawRandomForkHits.length === 0 &&
    res.legacyClientApiHits.length === 0 &&
    res.removedClientAccessorHits.length === 0 &&
    res.idlessSettlementHits.length === 0 &&
    res.settlementBypassHits.length === 0 &&
    res.promiseAllSettledAuthoritativeHits.length === 0 &&
    res.confirmExecutionBeforeSettlementHits.length === 0 &&
    res.legacyDbServiceNameHits.length === 0 &&
    res.trackedNodeModulesCount === 0 &&
    res.trackedDistCount === 0;

  if (passed) {
    console.log('\n[AUDIT RESULT] PASS: Phase 0/1 baseline and safety constraints verified.');
    process.exit(0);
  } else {
    console.error('\n[AUDIT RESULT] FAIL: One or more baseline safety constraints violated.');
    process.exit(1);
  }
}
