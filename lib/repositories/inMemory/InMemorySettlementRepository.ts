/**
 * InMemorySettlementRepository
 * Concrete in-memory implementation of SettlementRepository backed by MemoryDatabase.
 *
 * Guarantees:
 * - Full atomic batch settlement with pre-validation
 * - Rollback on any validation or execution failure (all-or-nothing)
 * - Strict non-negative cash and holding balances (cash >= 0, quantity >= 0)
 * - Idempotency tracking (processed trade IDs cannot be re-settled)
 */

import { MemoryDatabase, TradeRecord, HoldingRecord, ProfileRecord } from '../../memoryDb/memoryStore';
import type { SettlementRepository } from '../settlementRepository';
import type { TradeSettlementInput, SettlementBatchResult } from '../types';

export class InMemorySettlementRepository implements SettlementRepository {
  private settledTradeIds: Set<string> = new Set();
  private settledEventKeys: Set<string> = new Set();

  constructor(private readonly db: MemoryDatabase) {}

  public isTradeSettled(tradeId: string): boolean {
    return this.settledTradeIds.has(tradeId);
  }

  public async settleTradeBatchAtomically(
    trades: readonly TradeSettlementInput[]
  ): Promise<SettlementBatchResult> {
    if (!trades || trades.length === 0) {
      return {
        success: true,
        settledTradesCount: 0,
        totalVolume: 0,
        totalAmount: 0,
        totalFees: 0,
        rollbackOccurred: false,
        settledTradeIds: [],
      };
    }

    // 1. Idempotency pre-check
    const pendingTrades: TradeSettlementInput[] = [];
    const skippedTradeIds: string[] = [];

    for (const t of trades) {
      if (t.id && this.settledTradeIds.has(t.id)) {
        skippedTradeIds.push(t.id);
      } else {
        pendingTrades.push(t);
      }
    }

    if (pendingTrades.length === 0) {
      // All trades were already settled idempotently
      return {
        success: true,
        settledTradesCount: 0,
        totalVolume: 0,
        totalAmount: 0,
        totalFees: 0,
        rollbackOccurred: false,
        settledTradeIds: [],
        skippedTradeIds,
      };
    }

    // 2. Take Snapshot of state for Rollback
    const profileSnapshots = new Map<string, ProfileRecord>();
    const holdingSnapshots = new Map<string, HoldingRecord | null>();
    const tradesCountBefore = this.db.trades.length;

    const getProfile = (userId: string): ProfileRecord | null => {
      const pid = this.db.profileUserIdIndex.get(userId) || userId;
      return this.db.profiles.get(pid) || null;
    };

    const getHolding = (userId: string, stockId: string): HoldingRecord | null => {
      const hid = `${userId}_${stockId}`;
      return this.db.holdings.get(hid) || null;
    };

    // Aggregate required cash and holdings per user
    const netCashDeltas = new Map<string, number>();
    interface HoldingDelta {
      userId: string;
      stockId: string;
      delta: number;
    }
    const netHoldingDeltas = new Map<string, HoldingDelta>();

    let totalVolume = 0;
    let totalAmount = 0;
    let totalFees = 0;

    for (const t of pendingTrades) {
      const tradeAmount = t.total_amount !== undefined ? t.total_amount : t.price * t.size;
      const buyerFee = t.buyer_fee !== undefined ? t.buyer_fee : Math.round(tradeAmount * 0.00015);
      const sellerFee = t.seller_fee !== undefined ? t.seller_fee : Math.round(tradeAmount * 0.002);

      totalVolume += t.size;
      totalAmount += tradeAmount;
      totalFees += buyerFee + sellerFee;

      // Buyer: pays tradeAmount + buyerFee
      if (t.buyer_id && !t.buyer_is_bot) {
        const current = netCashDeltas.get(t.buyer_id) || 0;
        netCashDeltas.set(t.buyer_id, current - (tradeAmount + buyerFee));

        // Buyer receives shares
        const key = `${t.buyer_id}::${t.stock_id}`;
        const existing = netHoldingDeltas.get(key) || { userId: t.buyer_id, stockId: t.stock_id, delta: 0 };
        existing.delta += t.size;
        netHoldingDeltas.set(key, existing);
      }

      // Seller: receives tradeAmount - sellerFee
      if (t.seller_id && !t.seller_is_bot) {
        const current = netCashDeltas.get(t.seller_id) || 0;
        netCashDeltas.set(t.seller_id, current + (tradeAmount - sellerFee));

        // Seller delivers shares
        const key = `${t.seller_id}::${t.stock_id}`;
        const existing = netHoldingDeltas.get(key) || { userId: t.seller_id, stockId: t.stock_id, delta: 0 };
        existing.delta -= t.size;
        netHoldingDeltas.set(key, existing);
      }
    }

    // 3. Strict Pre-Validation: Validate all buyer cash balances and seller holding quantities
    for (const [userId, cashDelta] of netCashDeltas.entries()) {
      const profile = getProfile(userId);
      if (!profile) {
        return {
          success: false,
          settledTradesCount: 0,
          totalVolume: 0,
          totalAmount: 0,
          totalFees: 0,
          error: `PRE_VALIDATION_FAILED: Profile not found for buyer user_id ${userId}`,
          rollbackOccurred: true,
          settledTradeIds: [],
        };
      }
      if (profile.cash + cashDelta < 0) {
        return {
          success: false,
          settledTradesCount: 0,
          totalVolume: 0,
          totalAmount: 0,
          totalFees: 0,
          error: `PRE_VALIDATION_FAILED: Insufficient cash for user ${userId}. Required delta: ${cashDelta}, Current cash: ${profile.cash}`,
          rollbackOccurred: true,
          settledTradeIds: [],
        };
      }
      profileSnapshots.set(profile.id, { ...profile });
    }

    for (const [key, item] of netHoldingDeltas.entries()) {
      const holding = getHolding(item.userId, item.stockId);
      const currentQty = holding ? holding.quantity : 0;
      if (currentQty + item.delta < 0) {
        return {
          success: false,
          settledTradesCount: 0,
          totalVolume: 0,
          totalAmount: 0,
          totalFees: 0,
          error: `PRE_VALIDATION_FAILED: Insufficient holdings for user ${item.userId} stock ${item.stockId}. Required delta: ${item.delta}, Current qty: ${currentQty}`,
          rollbackOccurred: true,
          settledTradeIds: [],
        };
      }
      holdingSnapshots.set(`${item.userId}_${item.stockId}`, holding ? { ...holding } : null);
    }

    // 4. Execution Boundary: Apply all state changes atomically
    const newlySettledIds: string[] = [];

    try {
      // 4a. Update cash
      for (const [userId, cashDelta] of netCashDeltas.entries()) {
        const profile = getProfile(userId)!;
        profile.cash += cashDelta;
      }

      // 4b. Update holdings
      for (const t of pendingTrades) {
        const tradeAmount = t.total_amount !== undefined ? t.total_amount : t.price * t.size;

        if (t.buyer_id && !t.buyer_is_bot) {
          const hid = `${t.buyer_id}_${t.stock_id}`;
          let h = this.db.holdings.get(hid);
          if (!h) {
            h = {
              id: hid,
              user_id: t.buyer_id,
              stock_id: t.stock_id,
              quantity: 0,
              avg_price: 0,
              created_at: this.db.getIsoTimestamp(),
            };
            this.db.holdings.set(hid, h);
            this.db.addHoldingToIndex(h);
          }
          const prevCost = h.quantity * h.avg_price;
          const newCost = t.size * t.price;
          const totalQty = h.quantity + t.size;
          h.avg_price = totalQty > 0 ? (prevCost + newCost) / totalQty : t.price;
          h.quantity = totalQty;
        }

        if (t.seller_id && !t.seller_is_bot) {
          const hid = `${t.seller_id}_${t.stock_id}`;
          const h = this.db.holdings.get(hid);
          if (h) {
            h.quantity -= t.size;
            if (h.quantity < 0) h.quantity = 0;
          }
        }

        // 4c. Persist Trade Record
        const tradeId = t.id || this.db.generateId('trade');
        const tradeRecord: TradeRecord = {
          id: tradeId,
          stock_id: t.stock_id,
          buyer_id: t.buyer_id,
          seller_id: t.seller_id,
          buyer_is_bot: t.buyer_is_bot,
          seller_is_bot: t.seller_is_bot,
          price: t.price,
          size: t.size,
          buyer_fee: t.buyer_fee,
          seller_fee: t.seller_fee,
          created_at: t.created_at || this.db.getIsoTimestamp(),
          sequence: t.sequence,
          simulation_time: t.simulation_time,
        };

        this.db.trades.push(tradeRecord);
        this.db.addTradeToIndex(tradeRecord);
        this.settledTradeIds.add(tradeId);
        newlySettledIds.push(tradeId);
      }

      return {
        success: true,
        settledTradesCount: pendingTrades.length,
        totalVolume,
        totalAmount,
        totalFees,
        rollbackOccurred: false,
        settledTradeIds: [...skippedTradeIds, ...newlySettledIds],
      };
    } catch (err: any) {
      // 5. Rollback on unexpected failure
      for (const [pid, snap] of profileSnapshots.entries()) {
        const p = this.db.profiles.get(pid);
        if (p) Object.assign(p, snap);
      }

      for (const [hid, snap] of holdingSnapshots.entries()) {
        if (snap === null) {
          this.db.holdings.delete(hid);
        } else {
          const h = this.db.holdings.get(hid);
          if (h) Object.assign(h, snap);
        }
      }

      // Revert trades array and index
      this.db.trades = this.db.trades.slice(0, tradesCountBefore);
      this.db.rebuildIndexes();

      for (const id of newlySettledIds) {
        this.settledTradeIds.delete(id);
      }

      return {
        success: false,
        settledTradesCount: 0,
        totalVolume: 0,
        totalAmount: 0,
        totalFees: 0,
        error: `EXECUTION_FAILED: ${err?.message || String(err)}`,
        rollbackOccurred: true,
        settledTradeIds: [],
      };
    }
  }

  public async settleOptionPayout(
    userId: string,
    optionId: string,
    payoutAmount: number,
    idempotencyKey: string
  ): Promise<boolean> {
    if (this.settledEventKeys.has(idempotencyKey)) {
      return false; // Idempotently skipped
    }

    const pid = this.db.profileUserIdIndex.get(userId) || userId;
    const profile = this.db.profiles.get(pid);
    if (!profile) return false;

    profile.cash += payoutAmount;
    this.settledEventKeys.add(idempotencyKey);
    this.db.optionSettlements.push({
      id: idempotencyKey,
      user_id: userId,
      option_id: optionId,
      payout_amount: payoutAmount,
      settled_at: this.db.getIsoTimestamp(),
    });

    return true;
  }

  public async settleBondCoupon(
    userId: string,
    bondId: string,
    couponAmount: number,
    idempotencyKey: string
  ): Promise<boolean> {
    if (this.settledEventKeys.has(idempotencyKey)) {
      return false;
    }

    const pid = this.db.profileUserIdIndex.get(userId) || userId;
    const profile = this.db.profiles.get(pid);
    if (!profile) return false;

    profile.cash += couponAmount;
    this.settledEventKeys.add(idempotencyKey);
    this.db.bondCouponPayments.push({
      id: idempotencyKey,
      user_id: userId,
      bond_id: bondId,
      coupon_amount: couponAmount,
      paid_at: this.db.getIsoTimestamp(),
    });

    return true;
  }

  public async settleBondRedemption(
    userId: string,
    bondId: string,
    principalAmount: number,
    idempotencyKey: string
  ): Promise<boolean> {
    if (this.settledEventKeys.has(idempotencyKey)) {
      return false;
    }

    const pid = this.db.profileUserIdIndex.get(userId) || userId;
    const profile = this.db.profiles.get(pid);
    if (!profile) return false;

    profile.cash += principalAmount;
    this.settledEventKeys.add(idempotencyKey);
    return true;
  }
}
