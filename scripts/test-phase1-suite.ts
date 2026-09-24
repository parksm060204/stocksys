/**
 * Comprehensive Test Suite Runner for Phase 1 Refactoring
 */

import { execSync } from 'child_process';
import * as path from 'path';

const tests = [
  'test-phase1-db-isolation.ts',
  'test-phase1-live-engine-determinism.ts',
  'test-phase1-order-risk-centralization.ts',
  'test-phase1-namespace-registry.ts',
  'test-phase1-participant-adapters.ts',
  'test-phase1-simulation-context.ts',
  'test-phase1-market-abuse-safety.ts',
  'test-phase1-settlement-integrity.ts',
  'test-phase1-strategic-order-engine.ts',
];

console.log('=== Running STOCKSYS Phase 1 Test Suite ===\n');

for (const testFile of tests) {
  const fullPath = path.join(__dirname, testFile);
  console.log(`\n▶ [Executing] ${testFile}`);
  try {
    execSync(`node --import tsx "${fullPath}"`, { stdio: 'inherit' });
  } catch (_e) {
    console.error(`❌ Test failed: ${testFile}`);
    process.exit(1);
  }
}

console.log('\n===========================================');
console.log('🎉 All Phase 1 Test Suites Passed Successfully!');
console.log('===========================================\n');
