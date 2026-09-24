/**
 * InMemoryParticipantRepository
 * Concrete in-memory implementation of ParticipantRepository backed by MemoryDatabase.
 */

import { MemoryDatabase } from '../../memoryDb/memoryStore';
import type { ParticipantRepository } from '../participantRepository';
import type {
  ProfileRecord,
  HoldingRecord,
  InstitutionalPortfolioRecord
} from '../types';

export class InMemoryParticipantRepository implements ParticipantRepository {
  constructor(private readonly db: MemoryDatabase) {}

  public async getBotConfigs(): Promise<any[]> {
    return [...this.db.botsConfig];
  }

  public async upsertBotConfigs(configs: readonly Record<string, unknown>[]): Promise<void> {
    for (const cfg of configs) {
      const id = String(cfg.bot_id ?? cfg.id ?? '');
      if (!id) continue;
      const existing = this.db.botsConfig.find((b: any) => (b.bot_id ?? b.id) === id);
      if (existing) {
        Object.assign(existing, cfg);
      } else {
        this.db.botsConfig.push({ ...cfg, bot_id: id, id });
      }
    }
  }

  public async getProfiles(filter?: { maxCash?: number; limit?: number }): Promise<ProfileRecord[]> {
    let list = Array.from(this.db.profiles.values()).map((p) => ({ ...p }));
    if (filter?.maxCash !== undefined) {
      list = list.filter((p) => p.cash < filter.maxCash!);
    }
    if (filter?.limit !== undefined) {
      list = list.slice(0, filter.limit);
    }
    return list;
  }

  public async getProfile(userId: string): Promise<ProfileRecord | null> {
    const profileId = this.db.profileUserIdIndex.get(userId) || userId;
    const profile = this.db.profiles.get(profileId);
    return profile ? { ...profile } : null;
  }

  public async updateProfile(userId: string, updates: Partial<ProfileRecord>): Promise<void> {
    const profileId = this.db.profileUserIdIndex.get(userId) || userId;
    const profile = this.db.profiles.get(profileId);
    if (profile) {
      Object.assign(profile, updates);
    }
  }

  public async incrementCash(userId: string, delta: number): Promise<number> {
    const profileId = this.db.profileUserIdIndex.get(userId) || userId;
    const profile = this.db.profiles.get(profileId);
    if (!profile) {
      throw new Error(`Profile not found for user: ${userId}`);
    }
    profile.cash += delta;
    return profile.cash;
  }

  public async getHoldings(userId: string): Promise<HoldingRecord[]> {
    const holdingIds = this.db.holdingUserIndex.get(userId);
    if (!holdingIds) return [];
    const result: HoldingRecord[] = [];
    for (const hid of holdingIds) {
      const h = this.db.holdings.get(hid);
      if (h && h.quantity > 0) {
        result.push({ ...h });
      }
    }
    return result;
  }

  public async getHolding(userId: string, stockId: string): Promise<HoldingRecord | null> {
    const holdingId = `${userId}_${stockId}`;
    const h = this.db.holdings.get(holdingId);
    return h ? { ...h } : null;
  }

  public async updateHolding(
    userId: string,
    stockId: string,
    quantityDelta: number,
    avgPrice?: number
  ): Promise<void> {
    const holdingId = `${userId}_${stockId}`;
    let h = this.db.holdings.get(holdingId);
    if (!h) {
      h = {
        id: holdingId,
        user_id: userId,
        stock_id: stockId,
        quantity: 0,
        avg_price: avgPrice || 0,
        created_at: this.db.getIsoTimestamp(),
      };
      this.db.holdings.set(holdingId, h);
      this.db.addHoldingToIndex(h);
    }

    if (quantityDelta > 0 && avgPrice !== undefined && avgPrice > 0) {
      const currentCost = h.quantity * h.avg_price;
      const additionalCost = quantityDelta * avgPrice;
      const totalQuantity = h.quantity + quantityDelta;
      h.avg_price = totalQuantity > 0 ? (currentCost + additionalCost) / totalQuantity : avgPrice;
    }

    h.quantity += quantityDelta;

    if (h.quantity <= 0) {
      h.quantity = 0;
    }
  }

  public async getPortfolios(): Promise<InstitutionalPortfolioRecord[]> {
    return Array.from(this.db.institutionalPortfolios.values()).map((p) => ({ ...p }));
  }

  public async upsertPortfolios(
    portfolios: readonly InstitutionalPortfolioRecord[]
  ): Promise<void> {
    for (const p of portfolios) {
      const id = p.id || p.bot_id || this.db.generateId('port');
      this.db.institutionalPortfolios.set(id, { ...p, id });
    }
  }
}
