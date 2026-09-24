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
  /**
   * 봇 참가자 설정을 등록/갱신한다 (verified participant 원장).
   * 주문 risk 검증은 반드시 이 원장을 기준으로 참가자 종류·현금·한도를 판단한다.
   */
  upsertBotConfigs(configs: readonly Record<string, unknown>[]): Promise<void>;
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
