/**
 * Canonical Participant Adapters for STOCKSYS
 *
 * Pure transformation adapters between legacy types and canonical ParticipantAccount:
 * - AgentAccount (lib/engine/simulation/agentTypes.ts) <-> ParticipantAccount
 * - AgentConfig (engine-server/src/types.ts) <-> ParticipantAccount
 *
 * Invariant Guarantees:
 * - Immutability: Never mutates input objects. Returns frozen canonical objects.
 * - Validation: Rejects missing IDs, NaNs, infinities, and out-of-range parameters (fail-closed).
 * - Classification: Accurately classifies DOMESTIC_INSTITUTION vs FOREIGN_INSTITUTION vs LIQUIDITY_PROVIDER vs RETAIL.
 */

import type { AgentAccount } from '../agentTypes';
import type {
  ParticipantAccount,
  ParticipantIdentity,
  ParticipantKind,
  InformationProfile,
  DecisionProfile
} from './participantTypes';

interface MinimalAgentConfig {
  id: string;
  name: string;
  type: string;
  riskTolerance: number;
  executionStyle?: 'AGGRESSIVE_MARKET' | 'HFT_LIMIT' | 'PASSIVE_TWAP';
  [key: string]: any;
}

function assertValidNumber(val: number, name: string, min: number = 0, max: number = Infinity): number {
  if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) {
    throw new RangeError(`[ParticipantAdapter] ${name} must be a finite number. Received: ${val}`);
  }
  if (val < min || val > max) {
    throw new RangeError(`[ParticipantAdapter] ${name} must be between ${min} and ${max}. Received: ${val}`);
  }
  return val;
}

export function classifyParticipantKind(
  id: string,
  name: string,
  rawType: string
): ParticipantKind {
  const lowerId = (id || '').toLowerCase();
  const lowerName = (name || '').toLowerCase();
  const lowerType = (rawType || '').toLowerCase();

  if (lowerType === 'human' || lowerId.startsWith('usr_') || lowerId.startsWith('user_')) {
    return 'HUMAN';
  }

  if (lowerType === 'retail' || lowerType === 'retail_swarm' || lowerId.includes('retail') || lowerId.includes('swarm') || lowerName.includes('개미')) {
    return 'RETAIL';
  }

  if (
    lowerType === 'lp' ||
    lowerType === 'market_maker' ||
    lowerType === 'liquidity_provision' ||
    lowerId.includes('mm_') ||
    lowerId.includes('lp_') ||
    lowerName.includes('유동성') ||
    lowerName.includes('마켓메이커')
  ) {
    return 'LIQUIDITY_PROVIDER';
  }

  const isForeign =
    lowerType.includes('foreign') ||
    lowerType.includes('global') ||
    lowerId.includes('foreign') ||
    lowerId.includes('global') ||
    lowerId.includes('us_') ||
    lowerId.includes('eu_') ||
    lowerName.includes('외국') ||
    lowerName.includes('글로벌') ||
    lowerName.includes('골드만') ||
    lowerName.includes('모건') ||
    lowerName.includes('소로스') ||
    lowerName.includes('헤지펀드');

  if (isForeign) {
    return 'FOREIGN_INSTITUTION';
  }

  return 'DOMESTIC_INSTITUTION';
}

/**
 * Pure adapter from deterministic core AgentAccount to canonical ParticipantAccount.
 */
export function adaptAgentAccountToParticipantAccount(account: AgentAccount): Readonly<ParticipantAccount> {
  if (!account || typeof account !== 'object') {
    throw new TypeError('[ParticipantAdapter] account must be an object.');
  }

  const id = account.accountId || account.agentId;
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('[ParticipantAdapter] Missing required identifier (accountId/agentId).');
  }

  const name = account.name || id;
  const kind = account.participantType === 'human'
    ? 'HUMAN'
    : account.participantType === 'lp'
    ? 'LIQUIDITY_PROVIDER'
    : classifyParticipantKind(id, name, account.strategyType);

  const riskTolerance = assertValidNumber(account.riskTolerance, 'riskTolerance', 0, 10);
  const urgency = assertValidNumber(account.urgency, 'urgency', 0, 10);
  const activityRate = assertValidNumber(account.activityRate, 'activityRate', 0, 1000);
  const latencySec = assertValidNumber(account.infoLatency ?? 0, 'infoLatency', 0, 3600);
  const latencyMs = latencySec * 1000;

  const identity: ParticipantIdentity = Object.freeze({
    participantId: id,
    participantKind: kind,
    displayName: name,
    domicile: kind === 'FOREIGN_INSTITUTION' ? 'US' : 'KR'
  });

  const informationProfile: InformationProfile = Object.freeze({
    headlineLatencyMs: latencyMs,
    fullTextLatencyMs: latencyMs * 1.5,
    macroDataLatencyMs: latencyMs * 2.0,
    analysisDepth: account.strategyType === 'value' ? 1.0 : 0.5,
    headlineSensitivity: account.strategyType === 'trend' ? 0.8 : 0.4,
    fundamentalSensitivity: account.strategyType === 'value' ? 0.9 : 0.2,
    herdSensitivity: account.strategyType === 'trend' ? 0.85 : 0.1,
    contrarianTendency: account.strategyType === 'value' ? 0.3 : 0.0,
    signalNoise: 0.05
  });

  const decisionProfile: DecisionProfile = Object.freeze({
    investmentHorizonMs: account.strategyType === 'value' ? 86400000 : 3600000,
    activityRate,
    riskTolerance,
    urgency
  });

  return Object.freeze({
    identity,
    informationProfile,
    decisionProfile
  });
}

/**
 * Pure adapter from engine-server AgentConfig to canonical ParticipantAccount.
 */
export function adaptAgentConfigToParticipantAccount(config: MinimalAgentConfig): Readonly<ParticipantAccount> {
  if (!config || typeof config !== 'object') {
    throw new TypeError('[ParticipantAdapter] config must be an object.');
  }

  const id = config.id;
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('[ParticipantAdapter] Missing required identifier (config.id).');
  }

  const name = config.name || id;
  const rawType = config.type || 'INSTITUTION';
  const kind = classifyParticipantKind(id, name, rawType);

  const riskTolerance = assertValidNumber(config.riskTolerance, 'riskTolerance', 0, 10);

  let activityRate = 1.0;
  let urgency = 0.5;
  if (config.executionStyle === 'AGGRESSIVE_MARKET') {
    activityRate = 5.0;
    urgency = 0.9;
  } else if (config.executionStyle === 'HFT_LIMIT') {
    activityRate = 10.0;
    urgency = 0.7;
  } else if (config.executionStyle === 'PASSIVE_TWAP') {
    activityRate = 0.5;
    urgency = 0.2;
  }

  const identity: ParticipantIdentity = Object.freeze({
    participantId: id,
    participantKind: kind,
    displayName: name,
    domicile: kind === 'FOREIGN_INSTITUTION' ? 'US' : 'KR'
  });

  const informationProfile: InformationProfile = Object.freeze({
    headlineLatencyMs: kind === 'LIQUIDITY_PROVIDER' ? 50 : 500,
    fullTextLatencyMs: kind === 'LIQUIDITY_PROVIDER' ? 100 : 1000,
    macroDataLatencyMs: 1500,
    analysisDepth: 0.8,
    headlineSensitivity: 0.7,
    fundamentalSensitivity: 0.6,
    herdSensitivity: kind === 'RETAIL' ? 0.9 : 0.2,
    contrarianTendency: 0.1,
    signalNoise: 0.05
  });

  const decisionProfile: DecisionProfile = Object.freeze({
    investmentHorizonMs: 7200000,
    activityRate,
    riskTolerance,
    urgency
  });

  return Object.freeze({
    identity,
    informationProfile,
    decisionProfile
  });
}
