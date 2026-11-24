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
    const profile = this.db.resolveProfileByUserId(userId);
    return profile ? { ...profile } : null;
  }

  public async updateProfile(userId: string, updates: Partial<ProfileRecord>): Promise<void> {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new Error('updateProfile requires a non-empty userId');
    }
    let profile = this.db.resolveProfileByUserId(userId);
    if (profile) {
      if (updates.id !== undefined && updates.id !== profile.id) {
        throw new Error(`Profile primary key conflict: cannot reassign PK ${profile.id} to ${updates.id}`);
      }
      const existingOwner = profile.user_id || profile.id;
      if (updates.user_id !== undefined && updates.user_id !== existingOwner) {
        throw new Error(`Profile ownership conflict: row ${profile.id} belongs to ${existingOwner}`);
      }
      Object.assign(profile, updates, { id: profile.id, user_id: profile.user_id ?? (updates.user_id === userId ? userId : undefined) });
      this.db.addProfileToIndex(profile);
    } else {
      if (updates.user_id !== undefined && updates.user_id !== userId) {
        throw new Error(`Profile ownership conflict: updates.user_id (${updates.user_id}) does not match ${userId}`);
      }
      const requestedId = typeof updates.id === 'string' && updates.id.trim() ? updates.id : undefined;
      let pk =
        requestedId &&
        !this.db.profiles.has(requestedId) &&
        (requestedId === userId || !this.db.resolveProfileByUserId(requestedId))
          ? requestedId
          : !this.db.profiles.has(userId)
            ? userId
            : this.db.generateId('prof');
      while (this.db.profiles.has(pk) || (pk !== userId && this.db.resolveProfileByUserId(pk))) {
        pk = this.db.generateId('prof');
      }
      profile = {
        ...updates,
        id: pk,
        user_id: userId,
        username: updates.username ?? userId,
        nickname: updates.nickname ?? userId,
        rank_tier: updates.rank_tier ?? 'RETAIL',
        cash: updates.cash ?? 0,
        net_worth: updates.net_worth ?? 0,
        created_at: updates.created_at ?? this.db.getIsoTimestamp(),
      };
      this.db.profiles.set(pk, profile);
      this.db.addProfileToIndex(profile);
    }
  }

  public async incrementCash(userId: string, delta: number): Promise<number> {
    const profile = this.db.resolveProfileByUserId(userId);
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
