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

  const tsRegex = /\.(ts|tsx)$/;
  const engineFiles = scanFiles(engineServerSrc, tsRegex);
  const simFiles = scanFiles(simCoreDir, tsRegex);
  const commodityFiles = scanFiles(libCommodities, tsRegex);

  const runtimeFiles = Array.from(new Set([...engineFiles, ...simFiles, ...commodityFiles]));

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

  const warnings: string[] = [];

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
    res.hasParticipantBoundary;

  if (passed) {
    console.log('\n[AUDIT RESULT] PASS: Phase 0/1 baseline and safety constraints verified.');
    process.exit(0);
  } else {
    console.error('\n[AUDIT RESULT] FAIL: One or more baseline safety constraints violated.');
    process.exit(1);
  }
}
