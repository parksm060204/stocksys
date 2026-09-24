/**
 * InMemorySettlementRepository
 * Concrete in-memory implementation of SettlementRepository backed by MemoryDatabase.
 *
 * Guarantees:
 * - Complete runtime validation of every trade BEFORE any state read/aggregate/write
 * - All-or-nothing batch: a single invalid trade rejects the whole batch with an explicit
 *   error code, and mutates nothing (cash, holdings, trades, indexes, ledger)
 * - Fee rates are converted to fee amounts at this boundary (never trusted as amounts)
 * - Idempotency is stored in the AUTHORITATIVE MemoryDatabase.settlementLedger, so recreating
 *   the repository instance still blocks duplicate settlement
 * - Strict non-negative cash and holding balances
 */

import {
  MemoryDatabase,
  TradeRecord,
  HoldingRecord,
  ProfileRecord,
  SettlementLedgerEntry,
  OptionContractRecord,
  BondRecord,
  OrderRecord,
  StockRecord
} from '../../memoryDb/memoryStore';
import type { SettlementRepository } from '../settlementRepository';
import type {
  TradeSettlementInput,
  SettlementBatchResult,
  MatchedBatchCommitInput,
  OptionExpirySettlementParams,
  BondMaturitySettlementParams,
  NonTradeSettlementResult
} from '../types';
import { roundMoney, validateTradeSettlementInput, SettlementValidationSuccess } from '../settlementPolicy';

function isNonEmptyId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function emptyResult(overrides: Partial<SettlementBatchResult> = {}): SettlementBatchResult {
  return {
    success: true,
    settledTradesCount: 0,
    totalVolume: 0,
    totalAmount: 0,
    totalFeeAmount: 0,
    rollbackOccurred: false,
    settledTradeIds: [],
    ...overrides,
  };
}

export class InMemorySettlementRepository implements SettlementRepository {
  constructor(private readonly db: MemoryDatabase) {}

  /** Authoritative ledger 조회 (인스턴스가 재생성되어도 동일하게 동작) */
  public isTradeSettled(tradeId: string): boolean {
    if (!isNonEmptyId(tradeId)) return false;
    return this.db.settlementLedger.has(tradeId);
  }

  private lastSettlementError: string | null = null;

  public getLastSettlementError(): string | null {
    return this.lastSettlementError;
  }

  public async settleTradeBatchAtomically(
    trades: readonly TradeSettlementInput[]
  ): Promise<SettlementBatchResult> {
    return this.commitMatchedBatchAtomically({ trades });
  }

  public async commitMatchedBatchAtomically(
    batch: MatchedBatchCommitInput
  ): Promise<SettlementBatchResult> {
    const res = await this.executeCommitMatchedBatchAtomically(batch);
    this.lastSettlementError = res.errorCode ?? null;
    return res;
  }

  private async executeCommitMatchedBatchAtomically(
    batch: MatchedBatchCommitInput
  ): Promise<SettlementBatchResult> {
    const trades = batch.trades || [];

    // 거래가 없는 경우: 주문/시세/가격이력만 있는 배치 처리
    if (trades.length === 0) {
      if (
        (!batch.orderUpdates || batch.orderUpdates.length === 0) &&
        (!batch.marketPriceUpdates || batch.marketPriceUpdates.length === 0) &&
        (!batch.priceHistory || batch.priceHistory.length === 0)
      ) {
        return emptyResult();
      }

      // 주문/시세만 원자적으로 반영
      const ordersSnapshot = new Map<string, OrderRecord>();
      const stocksSnapshot = new Map<string, StockRecord>();
      const priceHistoryCountBefore = this.db.stockPriceHistory.length;

      try {
        if (batch.orderUpdates) {
          for (const upd of batch.orderUpdates) {
            const ord = this.db.orders.get(upd.id);
            if (ord) {
              ordersSnapshot.set(upd.id, { ...ord });
              ord.size = upd.size;
              ord.status = upd.status;
            }
          }
        }
        if (batch.marketPriceUpdates) {
          for (const upd of batch.marketPriceUpdates) {
            const stk = this.db.stocks.get(upd.stock_id);
            if (stk) {
              stocksSnapshot.set(upd.stock_id, { ...stk });
              stk.current_price = upd.price;
            }
          }
        }
        if (batch.priceHistory) {
          for (const h of batch.priceHistory) {
            this.db.stockPriceHistory.push({
              id: this.db.generateId('sph'),
              stock_id: h.stock_id,
              price: h.price,
              recorded_at: h.recorded_at,
            });
          }
        }
        return emptyResult({ success: true });
      } catch (err) {
        for (const [id, snap] of ordersSnapshot.entries()) {
          this.db.orders.set(id, snap);
        }
        for (const [id, snap] of stocksSnapshot.entries()) {
          this.db.stocks.set(id, snap);
        }
        this.db.stockPriceHistory = this.db.stockPriceHistory.slice(0, priceHistoryCountBefore);
        return emptyResult({
          success: false,
          errorCode: 'EXECUTION_FAILED',
          error: `EXECUTION_FAILED: ${err instanceof Error ? err.message : String(err)}`,
          rollbackOccurred: true,
        });
      }
    }

    // ── Phase 0: 멱등성 사전 분류 ──
    // 이미 authoritative ledger에 정산된 ID는 어떤 상태도 변경하지 않고 skip한다.
    // batch 내부 중복(new trade)은 아래 검증 단계에서 거부된다.
    const skippedTradeIds: string[] = [];
    const pendingInputs: TradeSettlementInput[] = [];
    for (const t of trades) {
      if (isNonEmptyId(t.id) && this.isTradeSettled(t.id)) {
        skippedTradeIds.push(t.id);
      } else {
        pendingInputs.push(t);
      }
    }

    if (pendingInputs.length === 0) {
      return emptyResult({ skippedTradeIds });
    }

    // ── Phase 1: 완전 검증 (아무 상태도 읽거나 변경하지 않은 순수 단계) ──
    const seenIds = new Set<string>();
    const validated: SettlementValidationSuccess[] = [];

    for (const raw of pendingInputs) {
      const result = validateTradeSettlementInput(raw, seenIds, () => false);
      if (!result.ok) {
        // batch 전체 거부. 현금/보유/거래/인덱스/원장 어떤 것도 변경하지 않는다.
        return emptyResult({
          success: false,
          errorCode: result.errorCode,
          error: result.message,
          rejectedTradeIds: result.tradeId ? [result.tradeId] : [],
          rollbackOccurred: true,
        });
      }
      seenIds.add(result.tradeId);
      validated.push(result);
    }

    // ── Phase 2: 순 합계 산출 (validated 결과만 사용) ──
    const netCashDeltas = new Map<string, number>();
    interface HoldingDelta {
      userId: string;
      stockId: string;
      delta: number;
    }
    const netHoldingDeltas = new Map<string, HoldingDelta>();

    let totalVolume = 0;
    let totalAmount = 0;
    let totalFeeAmount = 0;

    for (let i = 0; i < validated.length; i++) {
      const v = validated[i];
      const trade = pendingInputs[i];
      const buyerId = isNonEmptyId(trade.buyer_id) ? trade.buyer_id : null;
      const sellerId = isNonEmptyId(trade.seller_id) ? trade.seller_id : null;

      totalVolume += trade.size;
      totalAmount += v.tradeAmount;
      totalFeeAmount += v.fees.buyerFeeAmount + v.fees.sellerFeeAmount;

      // Buyer: pays tradeAmount + buyerFeeAmount (feeAmount may be negative => rebate credit)
      if (buyerId !== null && !trade.buyer_is_bot) {
        netCashDeltas.set(buyerId, (netCashDeltas.get(buyerId) || 0) - (v.tradeAmount + v.fees.buyerFeeAmount));
        const key = `${buyerId}::${trade.stock_id}`;
        const existing = netHoldingDeltas.get(key) || { userId: buyerId, stockId: trade.stock_id, delta: 0 };
        existing.delta += trade.size;
        netHoldingDeltas.set(key, existing);
      }

      // Seller: receives tradeAmount - sellerFeeAmount
      if (sellerId !== null && !trade.seller_is_bot) {
        netCashDeltas.set(sellerId, (netCashDeltas.get(sellerId) || 0) + (v.tradeAmount - v.fees.sellerFeeAmount));
        const key = `${sellerId}::${trade.stock_id}`;
        const existing = netHoldingDeltas.get(key) || { userId: sellerId, stockId: trade.stock_id, delta: 0 };
        existing.delta -= trade.size;
        netHoldingDeltas.set(key, existing);
      }
    }

    const getProfile = (userId: string): ProfileRecord | null => {
      const pid = this.db.profileUserIdIndex.get(userId) || userId;
      return this.db.profiles.get(pid) || null;
    };
    const getHolding = (userId: string, stockId: string): HoldingRecord | null => {
      return this.db.holdings.get(`${userId}_${stockId}`) || null;
    };

    // ── Phase 3: 잔액/보유 사전 검증 + 전체 스냅샷 (단일 롤백 경계) ──
    const profileSnapshots = new Map<string, ProfileRecord>();
    const holdingSnapshots = new Map<string, HoldingRecord | null>();
    const tradesCountBefore = this.db.trades.length;
    const ledgerEntriesBefore = new Map(this.db.settlementLedger);
    const ordersSnapshot = new Map<string, OrderRecord>();
    const stocksSnapshot = new Map<string, StockRecord>();
    const priceHistoryCountBefore = this.db.stockPriceHistory.length;

    for (const [userId, cashDelta] of netCashDeltas.entries()) {
      const profile = getProfile(userId);
      if (!profile) {
        return emptyResult({
          success: false,
          errorCode: 'PRE_VALIDATION_FAILED',
          error: `PRE_VALIDATION_FAILED: Profile not found for user ${userId}`,
          rollbackOccurred: true,
        });
      }
      if (!Number.isFinite(profile.cash) || !Number.isFinite(cashDelta)) {
        return emptyResult({
          success: false,
          errorCode: 'PRE_VALIDATION_FAILED',
          error: `PRE_VALIDATION_FAILED: Non-finite cash balance for user ${userId}`,
          rollbackOccurred: true,
        });
      }
      if (profile.cash + cashDelta < 0) {
        return emptyResult({
          success: false,
          errorCode: 'PRE_VALIDATION_FAILED',
          error: `PRE_VALIDATION_FAILED: Insufficient cash for user ${userId}. Required delta: ${cashDelta}, Current cash: ${profile.cash}`,
          rollbackOccurred: true,
        });
      }
      profileSnapshots.set(profile.id, { ...profile });
    }

    for (const [key, item] of netHoldingDeltas.entries()) {
      const holding = getHolding(item.userId, item.stockId);
      const currentQty = holding ? holding.quantity : 0;
      if (!Number.isFinite(currentQty) || !Number.isFinite(item.delta) || currentQty + item.delta < 0) {
        return emptyResult({
          success: false,
          errorCode: 'PRE_VALIDATION_FAILED',
          error: `PRE_VALIDATION_FAILED: Insufficient holdings for user ${item.userId} stock ${item.stockId}. Required delta: ${item.delta}, Current qty: ${currentQty}`,
          rollbackOccurred: true,
        });
      }
      holdingSnapshots.set(key, holding ? { ...holding } : null);
    }

    if (batch.orderUpdates) {
      for (const upd of batch.orderUpdates) {
        const ord = this.db.orders.get(upd.id);
        if (ord) ordersSnapshot.set(upd.id, { ...ord });
      }
    }
    if (batch.marketPriceUpdates) {
      for (const upd of batch.marketPriceUpdates) {
        const stk = this.db.stocks.get(upd.stock_id);
        if (stk) stocksSnapshot.set(upd.stock_id, { ...stk });
      }
    }

    // ── Phase 4: 원자적 커밋 ──
    const newlySettledIds: string[] = [];

    try {
      for (const [userId, cashDelta] of netCashDeltas.entries()) {
        const profile = getProfile(userId)!;
        profile.cash = roundMoney(profile.cash + cashDelta);
      }

      for (let i = 0; i < validated.length; i++) {
        const v = validated[i];
        const trade = pendingInputs[i];
        const buyerId = isNonEmptyId(trade.buyer_id) ? trade.buyer_id : null;
        const sellerId = isNonEmptyId(trade.seller_id) ? trade.seller_id : null;

        if (buyerId !== null && !trade.buyer_is_bot) {
          const hid = `${buyerId}_${trade.stock_id}`;
          let h = this.db.holdings.get(hid);
          if (!h) {
            h = {
              id: hid,
              user_id: buyerId,
              stock_id: trade.stock_id,
              quantity: 0,
              avg_price: 0,
              created_at: this.db.getIsoTimestamp(),
            };
            this.db.holdings.set(hid, h);
            this.db.addHoldingToIndex(h);
          }
          const prevCost = h.quantity * h.avg_price;
          const newCost = v.tradeAmount;
          const totalQty = h.quantity + trade.size;
          h.avg_price = totalQty > 0 ? (prevCost + newCost) / totalQty : trade.price;
          h.quantity = totalQty;
        }

        if (sellerId !== null && !trade.seller_is_bot) {
          const hid = `${sellerId}_${trade.stock_id}`;
          const h = this.db.holdings.get(hid);
          if (h) {
            h.quantity = Math.max(0, h.quantity - trade.size);
          }
        }

        const tradeRecord: TradeRecord = {
          id: v.tradeId,
          stock_id: trade.stock_id,
          buyer_id: buyerId,
          seller_id: sellerId,
          buyer_is_bot: trade.buyer_is_bot,
          seller_is_bot: trade.seller_is_bot,
          price: trade.price,
          size: trade.size,
          buyer_fee: v.fees.buyerFeeAmount,
          seller_fee: v.fees.sellerFeeAmount,
          created_at: trade.created_at || this.db.getIsoTimestamp(),
          sequence: trade.sequence,
          simulation_time: trade.simulation_time,
        };
        this.db.trades.push(tradeRecord);
        this.db.addTradeToIndex(tradeRecord);

        const ledgerEntry: SettlementLedgerEntry = {
          trade_id: v.tradeId,
          stock_id: trade.stock_id,
          price: trade.price,
          size: trade.size,
          total_amount: v.tradeAmount,
          buyer_fee_rate: v.feeRates.buyerFeeRate,
          seller_fee_rate: v.feeRates.sellerFeeRate,
          buyer_fee_amount: v.fees.buyerFeeAmount,
          seller_fee_amount: v.fees.sellerFeeAmount,
          settled_at: this.db.getIsoTimestamp(),
          simulation_time: trade.simulation_time,
          sequence: trade.sequence,
        };
        this.db.settlementLedger.set(v.tradeId, ledgerEntry);
        newlySettledIds.push(v.tradeId);
      }

      // 주문 상태 일괄 커밋
      if (batch.orderUpdates) {
        for (const upd of batch.orderUpdates) {
          const ord = this.db.orders.get(upd.id);
          if (ord) {
            ord.size = upd.size;
            ord.status = upd.status;
          }
        }
      }

      // 시세 일괄 커밋
      if (batch.marketPriceUpdates) {
        for (const upd of batch.marketPriceUpdates) {
          const stk = this.db.stocks.get(upd.stock_id);
          if (stk) {
            stk.current_price = upd.price;
          }
        }
      }

      // 가격 이력 일괄 커밋
      if (batch.priceHistory) {
        for (const h of batch.priceHistory) {
          this.db.stockPriceHistory.push({
            id: this.db.generateId('sph'),
            stock_id: h.stock_id,
            price: h.price,
            recorded_at: h.recorded_at,
          });
        }
      }

      return emptyResult({
        success: true,
        settledTradesCount: validated.length,
        totalVolume: roundMoney(totalVolume),
        totalAmount: roundMoney(totalAmount),
        totalFeeAmount: roundMoney(totalFeeAmount),
        rollbackOccurred: false,
        settledTradeIds: newlySettledIds,
        skippedTradeIds,
      });
    } catch (err) {
      // ── Phase 5: 완전 롤백 (현금/보유/거래/인덱스/원장/주문/시세/가격이력) ──
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
      this.db.trades = this.db.trades.slice(0, tradesCountBefore);
      this.db.rebuildIndexes();
      for (const [id, entry] of ledgerEntriesBefore.entries()) {
        if (!this.db.settlementLedger.has(id)) this.db.settlementLedger.set(id, entry);
      }
      for (const id of newlySettledIds) {
        this.db.settlementLedger.delete(id);
      }
      for (const [id, snap] of ordersSnapshot.entries()) {
        this.db.orders.set(id, snap);
      }
      for (const [id, snap] of stocksSnapshot.entries()) {
        this.db.stocks.set(id, snap);
      }
      this.db.stockPriceHistory = this.db.stockPriceHistory.slice(0, priceHistoryCountBefore);

      return emptyResult({
        success: false,
        errorCode: 'EXECUTION_FAILED',
        error: `EXECUTION_FAILED: ${err instanceof Error ? err.message : String(err)}`,
        rollbackOccurred: true,
      });
    }
  }

  /**
   * 범용 현금 지급 헬퍼 (옵션/채권 정산 공통).
   * 멱등성 키를 authoritative ledger에 기록하며, 금액이 유한하지 않으면 아무것도 변경하지 않고 false.
   */
  private commitCashPayout(
    idempotencyKey: string,
    userId: string,
    amount: number,
    writeHistory: () => void
  ): boolean {
    if (!isNonEmptyId(idempotencyKey)) return false;
    if (this.db.settlementLedger.has(idempotencyKey)) return false; // Idempotently skipped
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      // 금액이 유효하지 않으면 원장/현금을 전혀 변경하지 않는다.
      return false;
    }
    const pid = this.db.profileUserIdIndex.get(userId) || userId;
    const profile = this.db.profiles.get(pid);
    if (!profile) return false;

    const nextCash = roundMoney(profile.cash + amount);
    if (!Number.isFinite(nextCash) || nextCash < 0) return false;

    profile.cash = nextCash;
    writeHistory();
    // authoritative ledger에 멱등성 기록 (인스턴스 재생성 후에도 중복 차단)
    this.db.settlementLedger.set(idempotencyKey, {
      trade_id: idempotencyKey,
      stock_id: 'NON_TRADE_SETTLEMENT',
      price: 0,
      size: 0,
      total_amount: 0,
      buyer_fee_rate: 0,
      seller_fee_rate: 0,
      buyer_fee_amount: 0,
      seller_fee_amount: 0,
      settled_at: this.db.getIsoTimestamp(),
    });
    return true;
  }

  public getExpiredOptionContracts(now: number): readonly OptionContractRecord[] {
    if (!Number.isFinite(now)) {
      throw new RangeError(`[InMemorySettlementRepository] getExpiredOptionContracts requires a finite now: ${now}`);
    }
    return Array.from(this.db.optionsContracts.values()).filter((contract) => {
      const expiry = Date.parse(contract.expiry_date);
      return Number.isFinite(expiry) && expiry <= now;
    });
  }

  public getPositionsForAssetIds(assetIds: readonly string[]): readonly HoldingRecord[] {
    if (assetIds.length === 0) return [];
    const wanted = new Set(assetIds);
    return Array.from(this.db.holdings.values()).filter(
      (h) => wanted.has(h.stock_id) && Number.isFinite(h.quantity) && h.quantity > 0
    );
  }

  public getBonds(now: number): readonly BondRecord[] {
    if (!Number.isFinite(now)) {
      throw new RangeError(`[InMemorySettlementRepository] getBonds requires a finite now: ${now}`);
    }
    return Array.from(this.db.bonds.values());
  }

  /**
   * 만기 포지션 제거. 멱등성 키가 ledger에 이미 있으면 아무것도 하지 않고 false.
   * (지급/상환과 동일 ledger를 공유하므로 지급 성공 + 청산이 하나의 멱등 단위가 된다)
   */
  private closePosition(userId: string, stockId: string, closeKey: string): boolean {
    if (!isNonEmptyId(closeKey)) return false;
    if (this.db.settlementLedger.has(closeKey)) return false;
    const hid = `${userId}_${stockId}`;
    const holding = this.db.holdings.get(hid);
    if (!holding) return false;
    this.db.removeHoldingFromIndex(holding);
    this.db.holdings.delete(hid);
    this.db.settlementLedger.set(closeKey, {
      trade_id: closeKey,
      stock_id: stockId,
      price: 0,
      size: 0,
      total_amount: 0,
      buyer_fee_rate: 0,
      seller_fee_rate: 0,
      buyer_fee_amount: 0,
      seller_fee_amount: 0,
      settled_at: this.db.getIsoTimestamp(),
    });
    return true;
  }

  public closeExpiredOptionPosition(userId: string, optionId: string, idempotencyKey: string): boolean {
    return this.closePosition(userId, optionId, idempotencyKey);
  }

  public closeMaturedBondPosition(userId: string, bondId: string, idempotencyKey: string): boolean {
    return this.closePosition(userId, bondId, idempotencyKey);
  }

  public async settleOptionPayout(
    userId: string,
    optionId: string,
    payoutAmount: number,
    idempotencyKey: string
  ): Promise<boolean> {
    return this.commitCashPayout(idempotencyKey, userId, payoutAmount, () => {
      this.db.optionSettlements.push({
        id: idempotencyKey,
        user_id: userId,
        option_id: optionId,
        payout_amount: payoutAmount,
        settled_at: this.db.getIsoTimestamp(),
      });
    });
  }

  public async settleBondCoupon(
    userId: string,
    bondId: string,
    couponAmount: number,
    idempotencyKey: string
  ): Promise<boolean> {
    return this.commitCashPayout(idempotencyKey, userId, couponAmount, () => {
      this.db.bondCouponPayments.push({
        id: idempotencyKey,
        user_id: userId,
        bond_id: bondId,
        coupon_amount: couponAmount,
        paid_at: this.db.getIsoTimestamp(),
      });
    });
  }

  public async settleBondRedemption(
    userId: string,
    bondId: string,
    principalAmount: number,
    idempotencyKey: string
  ): Promise<boolean> {
    return this.commitCashPayout(idempotencyKey, userId, principalAmount, () => {
      this.db.bondCouponPayments.push({
        id: idempotencyKey,
        user_id: userId,
        bond_id: bondId,
        principal_amount: principalAmount,
        payment_type: 'MATURITY_REDEMPTION',
        paid_at: this.db.getIsoTimestamp(),
      });
    });
  }

  public async settleOptionExpiryAtomically(
    params: OptionExpirySettlementParams
  ): Promise<NonTradeSettlementResult> {
    if (!isNonEmptyId(params.idempotencyKey)) {
      return { success: false, errorCode: 'INVALID_IDEMPOTENCY_KEY', error: 'Invalid idempotency key' };
    }
    if (this.db.settlementLedger.has(params.idempotencyKey)) {
      return { success: true, errorCode: 'ALREADY_SETTLED' };
    }
    if (typeof params.payoutAmount !== 'number' || !Number.isFinite(params.payoutAmount) || params.payoutAmount < 0) {
      return {
        success: false,
        errorCode: 'INVALID_PAYOUT_AMOUNT',
        error: `Payout amount must be a finite non-negative number: ${params.payoutAmount}`,
      };
    }
    const pid = this.db.profileUserIdIndex.get(params.userId) || params.userId;
    const profile = this.db.profiles.get(pid);
    if (!profile) {
      return { success: false, errorCode: 'USER_NOT_FOUND', error: `User profile not found: ${params.userId}` };
    }

    const hid = `${params.userId}_${params.optionId}`;
    const holding = this.db.holdings.get(hid);

    const profileSnapshot = { ...profile };
    const holdingSnapshot = holding ? { ...holding } : null;
    const historyCountBefore = this.db.optionSettlements.length;

    try {
      if (params.payoutAmount > 0) {
        const nextCash = roundMoney(profile.cash + params.payoutAmount);
        if (!Number.isFinite(nextCash)) throw new Error('Cash calculation overflow');
        profile.cash = nextCash;
      }

      this.db.optionSettlements.push({
        id: params.idempotencyKey,
        user_id: params.userId,
        option_id: params.optionId,
        payout_amount: params.payoutAmount,
        settled_at: this.db.getIsoTimestamp(),
      });

      if (params.faultInjection === 'FAIL_AT_CLOSE') {
        throw new Error('FAULT_INJECTION_FAIL_AT_CLOSE');
      }

      if (holding) {
        this.db.removeHoldingFromIndex(holding);
        this.db.holdings.delete(hid);
      }

      if (params.faultInjection === 'FAIL_AT_LEDGER') {
        throw new Error('FAULT_INJECTION_FAIL_AT_LEDGER');
      }

      this.db.settlementLedger.set(params.idempotencyKey, {
        trade_id: params.idempotencyKey,
        stock_id: params.optionId,
        price: 0,
        size: 0,
        total_amount: params.payoutAmount,
        buyer_fee_rate: 0,
        seller_fee_rate: 0,
        buyer_fee_amount: 0,
        seller_fee_amount: 0,
        settled_at: this.db.getIsoTimestamp(),
      });

      return { success: true };
    } catch (err) {
      Object.assign(profile, profileSnapshot);
      this.db.optionSettlements = this.db.optionSettlements.slice(0, historyCountBefore);
      if (holdingSnapshot) {
        this.db.holdings.set(hid, holdingSnapshot);
        this.db.addHoldingToIndex(holdingSnapshot);
      }
      this.db.settlementLedger.delete(params.idempotencyKey);
      return {
        success: false,
        errorCode: 'EXECUTION_FAILED',
        error: err instanceof Error ? err.message : String(err),
        rollbackOccurred: true,
      };
    }
  }

  public async settleBondMaturityAtomically(
    params: BondMaturitySettlementParams
  ): Promise<NonTradeSettlementResult> {
    if (!isNonEmptyId(params.idempotencyKey)) {
      return { success: false, errorCode: 'INVALID_IDEMPOTENCY_KEY', error: 'Invalid idempotency key' };
    }
    if (this.db.settlementLedger.has(params.idempotencyKey)) {
      return { success: true, errorCode: 'ALREADY_SETTLED' };
    }
    if (typeof params.principalAmount !== 'number' || !Number.isFinite(params.principalAmount) || params.principalAmount < 0) {
      return {
        success: false,
        errorCode: 'INVALID_PRINCIPAL_AMOUNT',
        error: `Principal amount must be a finite non-negative number: ${params.principalAmount}`,
      };
    }
    if (params.couponAmount !== undefined && (typeof params.couponAmount !== 'number' || !Number.isFinite(params.couponAmount) || params.couponAmount < 0)) {
      return {
        success: false,
        errorCode: 'INVALID_COUPON_AMOUNT',
        error: `Coupon amount must be a finite non-negative number: ${params.couponAmount}`,
      };
    }

    const pid = this.db.profileUserIdIndex.get(params.userId) || params.userId;
    const profile = this.db.profiles.get(pid);
    if (!profile) {
      return { success: false, errorCode: 'USER_NOT_FOUND', error: `User profile not found: ${params.userId}` };
    }

    const hid = `${params.userId}_${params.bondId}`;
    const holding = this.db.holdings.get(hid);

    const profileSnapshot = { ...profile };
    const holdingSnapshot = holding ? { ...holding } : null;
    const historyCountBefore = this.db.bondCouponPayments.length;
    const totalPayout = roundMoney(params.principalAmount + (params.couponAmount ?? 0));

    try {
      if (totalPayout > 0) {
        const nextCash = roundMoney(profile.cash + totalPayout);
        if (!Number.isFinite(nextCash)) throw new Error('Cash calculation overflow');
        profile.cash = nextCash;
      }

      this.db.bondCouponPayments.push({
        id: params.idempotencyKey,
        user_id: params.userId,
        bond_id: params.bondId,
        principal_amount: params.principalAmount,
        coupon_amount: params.couponAmount ?? 0,
        payment_type: 'MATURITY_REDEMPTION',
        paid_at: this.db.getIsoTimestamp(),
      });

      if (params.faultInjection === 'FAIL_AT_CLOSE') {
        throw new Error('FAULT_INJECTION_FAIL_AT_CLOSE');
      }

      if (holding) {
        this.db.removeHoldingFromIndex(holding);
        this.db.holdings.delete(hid);
      }

      if (params.faultInjection === 'FAIL_AT_LEDGER') {
        throw new Error('FAULT_INJECTION_FAIL_AT_LEDGER');
      }

      this.db.settlementLedger.set(params.idempotencyKey, {
        trade_id: params.idempotencyKey,
        stock_id: params.bondId,
        price: 0,
        size: 0,
        total_amount: totalPayout,
        buyer_fee_rate: 0,
        seller_fee_rate: 0,
        buyer_fee_amount: 0,
        seller_fee_amount: 0,
        settled_at: this.db.getIsoTimestamp(),
      });

      return { success: true };
    } catch (err) {
      Object.assign(profile, profileSnapshot);
      this.db.bondCouponPayments = this.db.bondCouponPayments.slice(0, historyCountBefore);
      if (holdingSnapshot) {
        this.db.holdings.set(hid, holdingSnapshot);
        this.db.addHoldingToIndex(holdingSnapshot);
      }
      this.db.settlementLedger.delete(params.idempotencyKey);
      return {
        success: false,
        errorCode: 'EXECUTION_FAILED',
        error: err instanceof Error ? err.message : String(err),
        rollbackOccurred: true,
      };
    }
  }
}
