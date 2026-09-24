/**
 * Test Suite: Phase 1-C Participant Domain Adapters & Safety Invariants
 *
 * Verifies:
 * 1. AgentAccount -> ParticipantAccount pure transformation
 * 2. AgentConfig -> ParticipantAccount pure transformation
 * 3. Strict [0, 1] range validation for riskTolerance and urgency (rejecting out-of-bounds, fail-closed)
 * 4. Accurate classification:
 *    - Domestic Hedge Funds ("타임폴리오 헤지펀드") -> DOMESTIC_INSTITUTION, domicile: KR
 *    - US Institutions ("Bridgewater Associates", "Citadel Securities") -> FOREIGN_INSTITUTION, domicile: US
 *    - EU Institutions -> FOREIGN_INSTITUTION, domicile: EU
 *    - Explicit participantKind and domicile take highest precedence
 * 5. Input immutability & returned object frozen
 * 6. Fail-closed rejection of missing identifiers and ambiguous/unclassified configs
 */

import assert from 'assert';
import {
  adaptAgentAccountToParticipantAccount,
  adaptAgentConfigToParticipantAccount,
  classifyParticipantKind,
  resolveDomicile
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
  assert.strictEqual(adapted.identity.domicile, 'KR');
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
    urgency: 0.9,
    baseWeights: { kr_equity: 0.2, us_equity: 0.6, bond: 0.1, commodity: 0.1, cash: 0.0 },
    executionStyle: 'AGGRESSIVE_MARKET' as const,
    regimeShifts: {}
  };

  const adapted = adaptAgentConfigToParticipantAccount(originalConfig);

  assert.strictEqual(adapted.identity.participantId, 'bot_foreign_hedge_01');
  assert.strictEqual(adapted.identity.participantKind, 'FOREIGN_INSTITUTION');
  assert.strictEqual(adapted.identity.domicile, 'US');
  assert.strictEqual(adapted.decisionProfile.riskTolerance, 0.85);
  assert.strictEqual(adapted.decisionProfile.urgency, 0.9);
  assert.strictEqual(adapted.decisionProfile.activityRate, 5.0);
}

function testDomesticHedgeFundAndForeignInstitutions() {
  // 1. Domestic Hedge Fund must NOT be misclassified as foreign
  const domesticHfConfig = {
    id: 'bot_domestic_hf_01',
    name: '타임폴리오 헤지펀드 액티브',
    type: 'HEDGE_FUND',
    riskTolerance: 0.7
  };
  const adaptedDomestic = adaptAgentConfigToParticipantAccount(domesticHfConfig);
  assert.strictEqual(adaptedDomestic.identity.participantKind, 'DOMESTIC_INSTITUTION');
  assert.strictEqual(adaptedDomestic.identity.domicile, 'KR');

  // 2. US Institutions
  const usConfig1 = {
    id: 'bot_bw_01',
    name: 'Bridgewater Associates Pure Alpha',
    type: 'GLOBAL_MACRO',
    riskTolerance: 0.8
  };
  const adaptedUs1 = adaptAgentConfigToParticipantAccount(usConfig1);
  assert.strictEqual(adaptedUs1.identity.participantKind, 'FOREIGN_INSTITUTION');
  assert.strictEqual(adaptedUs1.identity.domicile, 'US');

  const usConfig2 = {
    id: 'bot_citadel_01',
    name: 'Citadel Securities HFT',
    type: 'QUANT_FUND',
    riskTolerance: 0.9
  };
  const adaptedUs2 = adaptAgentConfigToParticipantAccount(usConfig2);
  assert.strictEqual(adaptedUs2.identity.participantKind, 'FOREIGN_INSTITUTION');
  assert.strictEqual(adaptedUs2.identity.domicile, 'US');

  // 3. European Institution
  const euConfig = {
    id: 'eu_bot_quant_01',
    name: 'European Alpha Partners',
    type: 'QUANT_FUND',
    riskTolerance: 0.65,
    domicile: 'EU'
  };
  const adaptedEu = adaptAgentConfigToParticipantAccount(euConfig);
  assert.strictEqual(adaptedEu.identity.participantKind, 'FOREIGN_INSTITUTION');
  assert.strictEqual(adaptedEu.identity.domicile, 'EU');

  // 4. Explicit participantKind and domicile precedence
  const overrideConfig = {
    id: 'custom_bot_99',
    name: 'Any Generic Name',
    type: 'UNKNOWN_TYPE',
    participantKind: 'FOREIGN_INSTITUTION' as const,
    domicile: 'GB',
    riskTolerance: 0.5
  };
  const adaptedOverride = adaptAgentConfigToParticipantAccount(overrideConfig);
  assert.strictEqual(adaptedOverride.identity.participantKind, 'FOREIGN_INSTITUTION');
  assert.strictEqual(adaptedOverride.identity.domicile, 'GB');
}

function testParticipantClassification() {
  assert.strictEqual(classifyParticipantKind('usr_123', 'Hong Gildong', 'human'), 'HUMAN');
  assert.strictEqual(classifyParticipantKind('bot_retail_01', '개미 군집', 'retail'), 'RETAIL');
  assert.strictEqual(classifyParticipantKind('lp_main', '키움증권 LP', 'market_maker'), 'LIQUIDITY_PROVIDER');
  assert.strictEqual(classifyParticipantKind('bot_goldman', 'Goldman Sachs US', 'GLOBAL_MACRO'), 'FOREIGN_INSTITUTION');
  assert.strictEqual(classifyParticipantKind('bot_pension', '국민연금기금', 'PENSION_FUND'), 'DOMESTIC_INSTITUTION');
  assert.strictEqual(classifyParticipantKind('kr_hf_01', '타임폴리오 헤지펀드', 'HEDGE_FUND'), 'DOMESTIC_INSTITUTION');
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
    /strictly between 0 and 1/,
    'Should throw on negative urgency'
  );

  // 4. Exceeding 1.0 (strict unit interval check)
  assert.throws(
    () => adaptAgentAccountToParticipantAccount({ accountId: 'acc_1', riskTolerance: 1.5, urgency: 0.5 } as any),
    /strictly between 0 and 1/,
    'Should throw on riskTolerance > 1.0'
  );
  assert.throws(
    () => adaptAgentConfigToParticipantAccount({ id: 'bot_1', riskTolerance: 2.0 }),
    /strictly between 0 and 1/,
    'Should throw on config riskTolerance > 1.0'
  );

  // 5. Infinite activity rate
  assert.throws(
    () => adaptAgentAccountToParticipantAccount({ accountId: 'acc_1', riskTolerance: 0.5, urgency: 0.5, activityRate: Infinity } as any),
    /must be a finite number/,
    'Should throw on Infinite activityRate'
  );

  // 6. Ambiguous / unclassified config fails closed
  assert.throws(
    () => adaptAgentConfigToParticipantAccount({ id: 'ambiguous_999', name: 'Unknown Mystery Agent', type: 'XYZ_RANDOM' }),
    /Failed to classify participant kind/,
    'Should throw on unclassifiable participant'
  );
}

function runAll() {
  console.log('Running testAgentAccountAdaptation...');
  testAgentAccountAdaptation();
  console.log('Running testAgentConfigAdaptation...');
  testAgentConfigAdaptation();
  console.log('Running testDomesticHedgeFundAndForeignInstitutions...');
  testDomesticHedgeFundAndForeignInstitutions();
  console.log('Running testParticipantClassification...');
  testParticipantClassification();
  console.log('Running testFailClosedValidation...');
  testFailClosedValidation();
  console.log('✅ All Phase 1 Participant Adapter tests passed!');
}

runAll();
