/**
 * Canonical Participant Domain Types for STOCKSYS
 *
 * Establishes a unified participant domain boundary across:
 * - Deterministic core simulation (`lib/engine/simulation`)
 * - Live execution engine (`engine-server/src`)
 */

export type ParticipantKind =
  | 'HUMAN'
  | 'RETAIL'
  | 'DOMESTIC_INSTITUTION'
  | 'FOREIGN_INSTITUTION'
  | 'LIQUIDITY_PROVIDER'
  | 'UNKNOWN';

export interface ParticipantIdentity {
  participantId: string;
  participantKind: ParticipantKind;
  displayName: string;
  domicile?: string;
}

export interface InformationProfile {
  headlineLatencyMs: number;
  fullTextLatencyMs: number;
  macroDataLatencyMs: number;
  analysisDepth: number;
  headlineSensitivity: number;
  fundamentalSensitivity: number;
  herdSensitivity: number;
  contrarianTendency: number;
  signalNoise: number;
}

export interface DecisionProfile {
  investmentHorizonMs: number;
  activityRate: number;
  riskTolerance: number;
  urgency: number;
}

export interface ParticipantAccount {
  identity: ParticipantIdentity;
  informationProfile: InformationProfile;
  decisionProfile: DecisionProfile;
}
