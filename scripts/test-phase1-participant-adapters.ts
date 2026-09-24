/**
 * Test Suite: Phase 1-C Participant Domain Adapters & Safety Invariants
 *
 * Verifies:
 * 1. AgentAccount -> ParticipantAccount pure transformation
 * 2. AgentConfig -> ParticipantAccount pure transformation
 * 3. Accurate classification of DOMESTIC_INSTITUTION, FOREIGN_INSTITUTION, LIQUIDITY_PROVIDER, RETAIL
 * 4. Input immutability & returned object frozen
 * 5. Fail-closed rejection of NaN, negative, infinity, or out-of-bounds parameters
 * 6. Fail-closed rejection of missing identifiers
 */

import assert from 'assert';
import {
  adaptAgentAccountToParticipantAccount,
  adaptAgentConfigToParticipantAccount,
  classifyParticipantKind
} from '../lib/engine/simulation/participants';

function testAgentAccountAdaptation() {
  const originalAccount = {
    accountId: 'acc_val_001',
    agentId: 'strat_val',
    participantType: 'bot' as const,
    strategyType: 'value' as const,
    name: '국민연금 가치형',
    targetPositions: { '0010': 100 },
    maxOrderSize: 50,
    maxPosition: 500,
    riskTolerance: 0.4,
    urgency: 0.2,
    activityRate: 2.5,
    infoLatency: 1.5,
    nextDecisionTime: 1773500000000,
    stats: {
      ordersSubmitted: 0,
      ordersCancelled: 0,
      fillsCount: 0,
      volumeTraded: 0,
      feesPaid: 0,
      realizedPnl: 0
    }
  };

  const adapted = adaptAgentAccountToParticipantAccount(originalAccount);

  // Verification
  assert.strictEqual(adapted.identity.participantId, 'acc_val_001');
  assert.strictEqual(adapted.identity.participantKind, 'DOMESTIC_INSTITUTION');
  assert.strictEqual(adapted.identity.displayName, '국민연금 가치형');
  assert.strictEqual(adapted.informationProfile.headlineLatencyMs, 1500);
  assert.strictEqual(adapted.decisionProfile.riskTolerance, 0.4);
  assert.strictEqual(adapted.decisionProfile.urgency, 0.2);
  assert.strictEqual(adapted.decisionProfile.activityRate, 2.5);

  // Immutability: adapted should be frozen
  assert(Object.isFrozen(adapted), 'ParticipantAccount must be frozen');
  assert(Object.isFrozen(adapted.identity), 'ParticipantIdentity must be frozen');
  assert(Object.isFrozen(adapted.informationProfile), 'InformationProfile must be frozen');
  assert(Object.isFrozen(adapted.decisionProfile), 'DecisionProfile must be frozen');
}

function testAgentConfigAdaptation() {
  const originalConfig = {
    id: 'bot_foreign_hedge_01',
    name: 'Citadel Global Macro',
    type: 'GLOBAL_MACRO',
    riskTolerance: 0.85,
    baseWeights: { kr_equity: 0.2, us_equity: 0.6, bond: 0.1, commodity: 0.1, cash: 0.0 },
    executionStyle: 'AGGRESSIVE_MARKET' as const,
    regimeShifts: {}
  };

  const adapted = adaptAgentConfigToParticipantAccount(originalConfig);

  assert.strictEqual(adapted.identity.participantId, 'bot_foreign_hedge_01');
  assert.strictEqual(adapted.identity.participantKind, 'FOREIGN_INSTITUTION');
  assert.strictEqual(adapted.decisionProfile.riskTolerance, 0.85);
  assert.strictEqual(adapted.decisionProfile.urgency, 0.9);
  assert.strictEqual(adapted.decisionProfile.activityRate, 5.0);
}

function testParticipantClassification() {
  assert.strictEqual(classifyParticipantKind('usr_123', 'Hong Gildong', 'human'), 'HUMAN');
  assert.strictEqual(classifyParticipantKind('bot_retail_01', '개미 군집', 'retail'), 'RETAIL');
  assert.strictEqual(classifyParticipantKind('lp_main', '키움증권 LP', 'market_maker'), 'LIQUIDITY_PROVIDER');
  assert.strictEqual(classifyParticipantKind('bot_goldman', 'Goldman Sachs US', 'GLOBAL_MACRO'), 'FOREIGN_INSTITUTION');
  assert.strictEqual(classifyParticipantKind('bot_pension', '국민연금기금', 'PENSION_FUND'), 'DOMESTIC_INSTITUTION');
}

function testFailClosedValidation() {
  // 1. Missing identifier
  assert.throws(
    () => adaptAgentAccountToParticipantAccount({} as any),
    /Missing required identifier/,
    'Should throw on missing accountId/agentId'
  );

  // 2. NaN risk tolerance
  assert.throws(
    () => adaptAgentAccountToParticipantAccount({ accountId: 'acc_1', riskTolerance: NaN } as any),
    /must be a finite number/,
    'Should throw on NaN riskTolerance'
  );

  // 3. Negative urgency
  assert.throws(
    () => adaptAgentAccountToParticipantAccount({ accountId: 'acc_1', riskTolerance: 0.5, urgency: -1 } as any),
    /must be between/,
    'Should throw on negative urgency'
  );

  // 4. Infinite activity rate
  assert.throws(
    () => adaptAgentAccountToParticipantAccount({ accountId: 'acc_1', riskTolerance: 0.5, urgency: 0.5, activityRate: Infinity } as any),
    /must be a finite number/,
    'Should throw on Infinite activityRate'
  );
}

function runAll() {
  console.log('Running testAgentAccountAdaptation...');
  testAgentAccountAdaptation();
  console.log('Running testAgentConfigAdaptation...');
  testAgentConfigAdaptation();
  console.log('Running testParticipantClassification...');
  testParticipantClassification();
  console.log('Running testFailClosedValidation...');
  testFailClosedValidation();
  console.log('✅ All Phase 1 Participant Adapter tests passed!');
}

runAll();
