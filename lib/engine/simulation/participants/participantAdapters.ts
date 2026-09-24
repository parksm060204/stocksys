/**
 * Canonical Participant Adapters for STOCKSYS
 *
 * Pure transformation adapters between legacy types and canonical ParticipantAccount:
 * - AgentAccount (lib/engine/simulation/agentTypes.ts) <-> ParticipantAccount
 * - ParticipantConfigInput / AgentConfig <-> ParticipantAccount
 *
 * Invariant Guarantees:
 * - Immutability: Never mutates input objects. Returns frozen canonical objects.
 * - Strict Validation: Rejects missing IDs, NaNs, infinities, and out-of-range parameters (fail-closed).
 *   - riskTolerance must be in [0, 1]
 *   - urgency must be in [0, 1]
 * - Precise Classification:
 *   - Explicit fields (participantKind, domicile) ALWAYS take precedence.
 *   - Rejects simplistic name-only heuristics (e.g. "헤지펀드" does NOT imply foreign; domestic hedge funds are DOMESTIC_INSTITUTION).
 *   - Preserves actual domiciles (KR, US, EU, etc.).
 *   - Unknown or ambiguous configurations are safely marked as UNKNOWN or fail-closed.
 */

import type { AgentAccount } from '../agentTypes';
import type {
  ParticipantAccount,
  ParticipantIdentity,
  ParticipantKind,
  InformationProfile,
  DecisionProfile
} from './participantTypes';

export interface ParticipantConfigInput {
  readonly id: string;
  readonly name?: string;
  readonly type?: string;
  readonly riskTolerance?: number;
  readonly urgency?: number;
  readonly participantKind?: ParticipantKind;
  readonly domicile?: string;
  readonly executionStyle?: 'AGGRESSIVE_MARKET' | 'HFT_LIMIT' | 'PASSIVE_TWAP';
  readonly traits?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export function assertValidUnitInterval(val: number, name: string): number {
  if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) {
    throw new RangeError(`[ParticipantAdapter] ${name} must be a finite number. Received: ${val}`);
  }
  if (val < 0 || val > 1) {
    throw new RangeError(`[ParticipantAdapter] ${name} must be strictly between 0 and 1. Received: ${val}`);
  }
  return val;
}

export function assertValidNumber(val: number, name: string, min: number = 0, max: number = Infinity): number {
  if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) {
    throw new RangeError(`[ParticipantAdapter] ${name} must be a finite number. Received: ${val}`);
  }
  if (val < min || val > max) {
    throw new RangeError(`[ParticipantAdapter] ${name} must be between ${min} and ${max}. Received: ${val}`);
  }
  return val;
}

export interface ClassifyParticipantOptions {
  explicitKind?: ParticipantKind;
  explicitDomicile?: string;
}

/**
 * Classifies participant kind based on explicit fields first, then strict structural rules.
 */
export function classifyParticipantKind(
  id: string,
  name: string,
  rawType: string,
  options?: ClassifyParticipantOptions
): ParticipantKind {
  // 1. Explicit kind takes highest precedence
  if (options?.explicitKind) {
    return options.explicitKind;
  }

  const lowerId = (id || '').toLowerCase().trim();
  const lowerName = (name || '').toLowerCase().trim();
  const lowerType = (rawType || '').toLowerCase().trim();

  // 2. Human
  if (lowerType === 'human' || lowerId.startsWith('usr_') || lowerId.startsWith('user_')) {
    return 'HUMAN';
  }

  // 3. Retail
  if (
    lowerType === 'retail' ||
    lowerType === 'retail_swarm' ||
    lowerId.includes('retail') ||
    lowerId.includes('swarm') ||
    lowerName.includes('개미') ||
    lowerName.includes('retail swarm')
  ) {
    return 'RETAIL';
  }

  // 4. Liquidity Provider
  if (
    lowerType === 'lp' ||
    lowerType === 'market_maker' ||
    lowerType === 'liquidity_provision' ||
    lowerId.includes('mm_') ||
    lowerId.includes('lp_') ||
    lowerName.includes('유동성공급') ||
    lowerName.includes('유동성 공급') ||
    lowerName.includes('market maker')
  ) {
    return 'LIQUIDITY_PROVIDER';
  }

  // 5. Explicit domicile precedence for institutions
  if (options?.explicitDomicile) {
    const dom = options.explicitDomicile.toUpperCase().trim();
    if (dom === 'KR') return 'DOMESTIC_INSTITUTION';
    if (dom === 'US' || dom === 'EU' || dom === 'GLOBAL' || dom === 'JP' || dom === 'GB') {
      return 'FOREIGN_INSTITUTION';
    }
  }

  // 6. Institutional Classification: distinguish domestic vs foreign without naive keyword pitfalls
  // Domestic keywords (Korean specific institutions)
  const isExplicitDomestic =
    lowerId.startsWith('kr_') ||
    lowerId.includes('domestic') ||
    lowerName.includes('국내') ||
    lowerName.includes('한국') ||
    lowerName.includes('국민연금') ||
    lowerName.includes('신한') ||
    lowerName.includes('삼성') ||
    lowerName.includes('미래에셋') ||
    lowerName.includes('타임폴리오') ||
    lowerName.includes('한국투자') ||
    lowerName.includes('kb') ||
    lowerName.includes('우리');

  if (isExplicitDomestic) {
    return 'DOMESTIC_INSTITUTION';
  }

  // Foreign keywords (explicit global firms or foreign indicators)
  const isExplicitForeign =
    lowerId.startsWith('us_') ||
    lowerId.startsWith('eu_') ||
    lowerId.startsWith('foreign_') ||
    lowerId.startsWith('global_') ||
    lowerType.includes('foreign') ||
    lowerType.includes('global') ||
    lowerName.includes('외국') ||
    lowerName.includes('글로벌') ||
    lowerName.includes('골드만') ||
    lowerName.includes('goldman') ||
    lowerName.includes('모건') ||
    lowerName.includes('morgan') ||
    lowerName.includes('bridgewater') ||
    lowerName.includes('citadel') ||
    lowerName.includes('blackrock') ||
    lowerName.includes('two sigma') ||
    lowerName.includes('jane street') ||
    lowerName.includes('소로스') ||
    lowerName.includes('soros');

  if (isExplicitForeign) {
    return 'FOREIGN_INSTITUTION';
  }

  // If type is explicitly institution and no foreign cues, default domestic if institutional
  if (
    lowerType === 'pension_fund' ||
    lowerType === 'commercial_bank' ||
    lowerType === 'prop_desk' ||
    lowerType === 'hedge_fund' ||
    lowerType === 'quant_fund' ||
    lowerType === 'stat_arb'
  ) {
    return 'DOMESTIC_INSTITUTION';
  }

  // Ambiguous / unclassified
  return 'UNKNOWN';
}

/**
 * Resolves domicile code based on explicit configuration or classified kind.
 */
export function resolveDomicile(
  kind: ParticipantKind,
  explicitDomicile?: string,
  id: string = '',
  name: string = ''
): string {
  if (explicitDomicile && explicitDomicile.trim().length > 0) {
    return explicitDomicile.toUpperCase().trim();
  }

  if (kind === 'DOMESTIC_INSTITUTION' || kind === 'RETAIL' || kind === 'HUMAN') {
    return 'KR';
  }

  if (kind === 'FOREIGN_INSTITUTION') {
    const lower = `${id} ${name}`.toLowerCase();
    if (lower.includes('eu_') || lower.includes('europe') || lower.includes('유로')) {
      return 'EU';
    }
    return 'US';
  }

  return 'KR';
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

  // Strict [0, 1] validation for riskTolerance and urgency
  const riskTolerance = assertValidUnitInterval(account.riskTolerance, 'riskTolerance');
  const urgency = assertValidUnitInterval(account.urgency, 'urgency');
  const activityRate = assertValidNumber(account.activityRate, 'activityRate', 0, 1000);
  const latencySec = assertValidNumber(account.infoLatency ?? 0, 'infoLatency', 0, 3600);
  const latencyMs = latencySec * 1000;

  const kind = account.participantType === 'human'
    ? 'HUMAN'
    : account.participantType === 'lp'
    ? 'LIQUIDITY_PROVIDER'
    : classifyParticipantKind(id, name, account.strategyType);

  const domicile = resolveDomicile(kind, undefined, id, name);

  const identity: ParticipantIdentity = Object.freeze({
    participantId: id,
    participantKind: kind,
    displayName: name,
    domicile
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
 * Pure adapter from engine-server AgentConfig / ParticipantConfigInput to canonical ParticipantAccount.
 */
export function adaptAgentConfigToParticipantAccount(config: ParticipantConfigInput): Readonly<ParticipantAccount> {
  if (!config || typeof config !== 'object') {
    throw new TypeError('[ParticipantAdapter] config must be an object.');
  }

  const id = config.id;
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('[ParticipantAdapter] Missing required identifier (config.id).');
  }

  const name = config.name || id;
  const rawType = config.type || 'INSTITUTION';

  // Strict [0, 1] validation for riskTolerance
  const rawRiskTolerance = config.riskTolerance !== undefined ? config.riskTolerance : 0.5;
  const riskTolerance = assertValidUnitInterval(rawRiskTolerance, 'riskTolerance');

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

  if (config.urgency !== undefined) {
    urgency = assertValidUnitInterval(config.urgency, 'urgency');
  }

  const kind = classifyParticipantKind(id, name, rawType, {
    explicitKind: config.participantKind,
    explicitDomicile: config.domicile
  });

  if (kind === 'UNKNOWN') {
    throw new Error(`[ParticipantAdapter] Failed to classify participant kind for id="${id}", name="${name}". Fail-closed.`);
  }

  const domicile = resolveDomicile(kind, config.domicile, id, name);

  const identity: ParticipantIdentity = Object.freeze({
    participantId: id,
    participantKind: kind,
    displayName: name,
    domicile
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

/**
 * Isolated legacy adapter for backwards compatibility with un-normalized historical configs.
 */
export function adaptLegacyParticipantConfig(raw: Record<string, unknown>): Readonly<ParticipantAccount> {
  const id = String(raw.id || raw.accountId || '');
  if (!id) throw new Error('[LegacyParticipantAdapter] Missing id.');

  const rawRisk = Number(raw.riskTolerance ?? 0.5);
  // Scale down legacy 0..10 values if necessary
  const normalizedRisk = rawRisk > 1 ? Math.min(1, rawRisk / 10) : Math.max(0, rawRisk);

  const rawUrgency = Number(raw.urgency ?? 0.5);
  const normalizedUrgency = rawUrgency > 1 ? Math.min(1, rawUrgency / 10) : Math.max(0, rawUrgency);

  return adaptAgentConfigToParticipantAccount({
    id,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    type: typeof raw.type === 'string' ? raw.type : undefined,
    riskTolerance: normalizedRisk,
    urgency: normalizedUrgency,
    participantKind: raw.participantKind as ParticipantKind | undefined,
    domicile: typeof raw.domicile === 'string' ? raw.domicile : undefined,
  });
}
