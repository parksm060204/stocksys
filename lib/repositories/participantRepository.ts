/**
 * ParticipantRepository Interface for STOCKSYS
 */

import type {
  ProfileRecord,
  HoldingRecord,
  InstitutionalPortfolioRecord
} from './types';

export interface ParticipantRepository {
  getBotConfigs(): Promise<any[]>;
  getProfiles(filter?: { maxCash?: number; limit?: number }): Promise<ProfileRecord[]>;
  getProfile(userId: string): Promise<ProfileRecord | null>;
  updateProfile(userId: string, updates: Partial<ProfileRecord>): Promise<void>;
  incrementCash(userId: string, delta: number): Promise<number>;

  getHoldings(userId: string): Promise<HoldingRecord[]>;
  getHolding(userId: string, stockId: string): Promise<HoldingRecord | null>;
  updateHolding(
    userId: string,
    stockId: string,
    quantityDelta: number,
    avgPrice?: number
  ): Promise<void>;

  getPortfolios(): Promise<InstitutionalPortfolioRecord[]>;
  upsertPortfolios(
    portfolios: readonly InstitutionalPortfolioRecord[]
  ): Promise<void>;
}
