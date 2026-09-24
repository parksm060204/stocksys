/**
 * Institutional Participant Types for STOCKSYS
 *
 * Provides domain contracts for institutional mandates, book allocations,
 * and execution styles for future institutional desk integration.
 */

import { ParticipantAccount } from './participantTypes';

export type InstitutionalMandateType =
  | 'PENSION_BENCHMARK'
  | 'BANK_ALM_ARBITRAGE'
  | 'HEDGE_FUND_MACRO_DIRECTIONAL'
  | 'PROP_DESK_HFT'
  | 'LIQUIDITY_PROVISION';

export interface InstitutionalProfile {
  mandateType: InstitutionalMandateType;
  maxLeverage: number;
  targetAUM: number;
  benchmarkTicker?: string;
  executionStyle?: 'AGGRESSIVE_MARKET' | 'HFT_LIMIT' | 'PASSIVE_TWAP';
}

export interface InstitutionalAccount extends ParticipantAccount {
  institutionalProfile: InstitutionalProfile;
}
