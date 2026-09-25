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

  private mutex: Promise<void> = Promise.resolve();

  public async commitMatchedBatchAtomically(
    batch: MatchedBatchCommitInput
  ): Promise<SettlementBatchResult> {
    let release: () => void;
    const nextLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prevLock = this.mutex;
    this.mutex = prevLock.then(() => nextLock);

    await prevLock;
    try {
      const res = await this.executeCommitMatchedBatchAtomically(batch);
      this.lastSettlementError = res.errorCode ?? null;
      return res;
    } finally {
      release!();
    }
  }

  private async executeCommitMatchedBatchAtomically(
    batch: MatchedBatchCommitInput
  ): Promise<SettlementBatchResult> {
    const trades = batch.trades || [];
    const idGenSnapshot = (this.db as any).snapshotIdGenerator?.() ?? null;

    // ── Pre-check: newOrders must be insert-only, no duplicates in batch or DB ──
    if (batch.newOrders && batch.newOrders.length > 0) {
      const seenBatchOrderIds = new Set<string>();
      for (const ord of batch.newOrders) {
        if (!isNonEmptyId(ord.id)) {
          return emptyResult({
            success: false,
            errorCode: 'ORDER_ID_MISSING',
            error: 'New order has empty id',
            rollbackOccurred: false,
          });
        }
        if (seenBatchOrderIds.has(ord.id) || this.db.orders.has(ord.id)) {
          return emptyResult({
            success: false,
            errorCode: 'ORDER_ALREADY_EXISTS',
            error: `ORDER_ALREADY_EXISTS: Order ${ord.id} already exists or is duplicated in batch`,
            rollbackOccurred: false,
          });
        }
        seenBatchOrderIds.add(ord.id);
        const origQty = Math.round(Number(ord.originalQuantity ?? ord.size ?? 0));
        const filledQty = Math.round(Number(ord.filledQuantity ?? ord.filled ?? 0));
        const remainingQty = Math.round(Number(ord.remainingQuantity ?? (origQty - filledQty)));
        if (!Number.isFinite(origQty) || origQty <= 0) {
          return emptyResult({
            success: false,
            errorCode: 'INVALID_ORDER_QUANTITY',
            error: `INVALID_ORDER_QUANTITY: Order ${ord.id} originalQuantity must be positive integer: ${origQty}`,
            rollbackOccurred: false,
          });
        }
        if (!Number.isFinite(filledQty) || filledQty < 0 || !Number.isFinite(remainingQty) || remainingQty < 0 || (filledQty + remainingQty !== origQty)) {
          return emptyResult({
            success: false,
            errorCode: 'INVALID_ORDER_QUANTITY',
            error: `INVALID_ORDER_QUANTITY: Order ${ord.id} quantity mismatch: orig=${origQty}, filled=${filledQty}, remaining=${remainingQty}`,
            rollbackOccurred: false,
          });
        }
      }
    }

    // ── Pre-check: lpQuoteUpserts must be authorized LP quotes ──
    if (batch.lpQuoteUpserts && batch.lpQuoteUpserts.length > 0) {
      for (const lpOrd of batch.lpQuoteUpserts) {
        const isLp = Boolean(lpOrd.is_lp || (lpOrd as any).participantKind === 'LIQUIDITY_PROVIDER' || (lpOrd as any).orderRole === 'LP_QUOTE');
        if (!isLp) {
          return emptyResult({
            success: false,
            errorCode: 'REJECTED_UNAUTHORIZED_LP',
            error: `Order ${lpOrd.id} is not an authorized LP quote`,
            rollbackOccurred: false,
          });
        }
      }
    }

    // 거래가 없는 경우: 주문/시세/가격이력만 있는 배치 처리
    if (trades.length === 0) {
      if (
        (!batch.newOrders || batch.newOrders.length === 0) &&
        (!batch.lpQuoteUpserts || batch.lpQuoteUpserts.length === 0) &&
        (!batch.orderUpdates || batch.orderUpdates.length === 0) &&
        (!batch.marketPriceUpdates || batch.marketPriceUpdates.length === 0) &&
        (!batch.priceHistory || batch.priceHistory.length === 0)
      ) {
        return emptyResult();
      }

      // 주문/시세만 원자적으로 반영
      const ordersSnapshot = new Map<string, OrderRecord>();
      const newlyInsertedOrderIds = new Set<string>();
      const stocksSnapshot = new Map<string, StockRecord>();
      const priceHistoryCountBefore = this.db.stockPriceHistory.length;

      try {
        if (batch.newOrders) {
          for (const ord of batch.newOrders) {
            newlyInsertedOrderIds.add(ord.id);
            const origQty = Math.round(Number(ord.originalQuantity ?? ord.size));
            const filledQty = Math.round(Number(ord.filledQuantity ?? ord.filled ?? 0));
            const remainingQty = Math.round(Number(ord.remainingQuantity ?? (origQty - filledQty)));
            const normalizedOrd: OrderRecord = {
              ...ord,
              originalQuantity: origQty,
              filledQuantity: filledQty,
              remainingQuantity: remainingQty,
              size: remainingQty,
              filled: filledQty,
              status: remainingQty === 0 ? 'filled' : (filledQty > 0 ? 'partial' : 'open'),
              version: ord.version ?? 1,
            };
            this.db.orders.set(ord.id, normalizedOrd);
            this.db.addOrderToIndex(normalizedOrd);
          }
        }
        if (batch.lpQuoteUpserts) {
          for (const ord of batch.lpQuoteUpserts) {
            if (!this.db.orders.has(ord.id)) {
              newlyInsertedOrderIds.add(ord.id);
            } else if (!ordersSnapshot.has(ord.id)) {
              ordersSnapshot.set(ord.id, { ...this.db.orders.get(ord.id)! });
            }
            const normalizedOrd: OrderRecord = {
              ...ord,
              version: (ord.version ?? 1) + 1,
            };
            this.db.orders.set(ord.id, normalizedOrd);
            this.db.addOrderToIndex(normalizedOrd);
          }
        }
        if (batch.orderUpdates) {
          for (const upd of batch.orderUpdates) {
            const ord = this.db.orders.get(upd.id);
            if (ord) {
              if (!ordersSnapshot.has(upd.id)) {
                ordersSnapshot.set(upd.id, { ...ord });
              }
              if (upd.expectedVersion !== undefined && (ord.version || 1) !== upd.expectedVersion) {
                throw new Error(`ORDER_CAS_MISMATCH: Version mismatch for ${upd.id}`);
              }
              if (upd.size !== undefined) {
                ord.size = upd.size;
                ord.remainingQuantity = upd.size;
              }
              if (upd.status) {
                if (ord.status === 'filled' && (upd.status === 'open' || upd.status === 'partial')) {
                  // Do not reopen filled orders
                } else {
                  ord.status = upd.status;
                }
              }
              ord.version = (ord.version || 1) + 1;
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
        for (const id of newlyInsertedOrderIds) {
          const ord = this.db.orders.get(id);
          if (ord) this.db.removeOrderFromIndex(ord);
          this.db.orders.delete(id);
        }
        for (const [id, snap] of ordersSnapshot.entries()) {
          this.db.orders.set(id, snap);
        }
        for (const [id, snap] of stocksSnapshot.entries()) {
          this.db.stocks.set(id, snap);
        }
        this.db.stockPriceHistory = this.db.stockPriceHistory.slice(0, priceHistoryCountBefore);
        this.db.rebuildIndexes();
        (this.db as any).restoreIdGenerator?.(idGenSnapshot);
        return emptyResult({
          success: false,
          errorCode: 'EXECUTION_FAILED',
          error: `EXECUTION_FAILED: ${err instanceof Error ? err.message : String(err)}`,
          rollbackOccurred: true,
        });
      }
    }

    // ── Phase 0: 멱등성 사전 분류 ──
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

    // ── Phase 1: 완전 검증 (순수 검증 단계) ──
    const seenIds = new Set<string>();
    const validated: SettlementValidationSuccess[] = [];

    for (const raw of pendingInputs) {
      const result = validateTradeSettlementInput(raw, seenIds, () => false);
      if (!result.ok) {
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

    // ── Phase 1.5: 신규 주문 staging 및 참조 주문의 권위 상태·잔량 검증 (과체결/중복정산 차단) ──
    const newlyInsertedOrderIds = new Set<string>();
    const originalOrdersBeforeBatch = new Map<string, OrderRecord>();
    const newlyCreatedProfileIds = new Set<string>();

    if (batch.newOrders && batch.newOrders.length > 0) {
      for (const ord of batch.newOrders) {
        newlyInsertedOrderIds.add(ord.id);
        const origQty = Math.round(Number(ord.originalQuantity ?? ord.size));
        const filledQty = Math.round(Number(ord.filledQuantity ?? ord.filled ?? 0));
        const remainingQty = Math.round(Number(ord.remainingQuantity ?? (origQty - filledQty)));
        const normalizedOrd: OrderRecord = {
          ...ord,
          originalQuantity: origQty,
          filledQuantity: filledQty,
          remainingQuantity: remainingQty,
          size: remainingQty,
          filled: filledQty,
          status: remainingQty === 0 ? 'filled' : (filledQty > 0 ? 'partial' : 'open'),
          version: ord.version ?? 1,
        };
        this.db.orders.set(ord.id, normalizedOrd);
        this.db.addOrderToIndex(normalizedOrd);
      }
    }

    if (batch.lpQuoteUpserts && batch.lpQuoteUpserts.length > 0) {
      for (const ord of batch.lpQuoteUpserts) {
        if (!this.db.orders.has(ord.id)) {
          newlyInsertedOrderIds.add(ord.id);
        } else if (!originalOrdersBeforeBatch.has(ord.id)) {
          originalOrdersBeforeBatch.set(ord.id, { ...this.db.orders.get(ord.id)! });
        }
        const normalizedOrd: OrderRecord = {
          ...ord,
          version: (ord.version ?? 1) + 1,
        };
        this.db.orders.set(ord.id, normalizedOrd);
        this.db.addOrderToIndex(normalizedOrd);
      }
    }

    const failBatch = (res: { errorCode: string; error: string; rejectedTradeIds?: readonly string[] }) => {
      for (const id of newlyInsertedOrderIds) {
        const ord = this.db.orders.get(id);
        if (ord) this.db.removeOrderFromIndex(ord);
        this.db.orders.delete(id);
      }
      for (const [id, snap] of originalOrdersBeforeBatch.entries()) {
        this.db.orders.set(id, snap);
      }
      for (const id of newlyCreatedProfileIds) {
        this.db.profiles.delete(id);
        this.db.profileUserIdIndex.delete(id);
      }
      if (newlyInsertedOrderIds.size > 0 || originalOrdersBeforeBatch.size > 0) {
        this.db.rebuildIndexes();
      }
      (this.db as any).restoreIdGenerator?.(idGenSnapshot);
      return emptyResult({
        success: false,
        errorCode: res.errorCode,
        error: res.error,
        rejectedTradeIds: res.rejectedTradeIds ?? [],
        rollbackOccurred: true,
      });
    };

    const allocatedPerOrder = new Map<string, number>();

    for (let i = 0; i < validated.length; i++) {
      const trade = pendingInputs[i];

      if (!isNonEmptyId(trade.buy_order_id) || !isNonEmptyId(trade.sell_order_id)) {
        return failBatch({
          errorCode: 'ORDER_ID_MISSING',
          error: `ORDER_ID_MISSING: Trade ${trade.id} is missing buy or sell order id`,
        });
      }

      const buyOrder = this.db.orders.get(trade.buy_order_id);
      if (!buyOrder) {
        return failBatch({
          errorCode: 'ORDER_NOT_FOUND',
          error: `ORDER_NOT_FOUND: Buy order ${trade.buy_order_id} not found in authoritative orders store`,
        });
      }

      const sellOrder = this.db.orders.get(trade.sell_order_id);
      if (!sellOrder) {
        return failBatch({
          errorCode: 'ORDER_NOT_FOUND',
          error: `ORDER_NOT_FOUND: Sell order ${trade.sell_order_id} not found in authoritative orders store`,
        });
      }

      if (buyOrder.side !== 'buy') {
        return failBatch({
          errorCode: 'ORDER_SIDE_MISMATCH',
          error: `ORDER_SIDE_MISMATCH: Order ${trade.buy_order_id} side is ${buyOrder.side}, expected buy`,
        });
      }
      if (sellOrder.side !== 'sell') {
        return failBatch({
          errorCode: 'ORDER_SIDE_MISMATCH',
          error: `ORDER_SIDE_MISMATCH: Order ${trade.sell_order_id} side is ${sellOrder.side}, expected sell`,
        });
      }

      if (buyOrder.stock_id !== trade.stock_id || sellOrder.stock_id !== trade.stock_id) {
        return failBatch({
          errorCode: 'ORDER_STOCK_MISMATCH',
          error: `ORDER_STOCK_MISMATCH: Trade stock ${trade.stock_id} does not match order stocks`,
        });
      }

      const expectedBuyer = buyOrder.participantId || buyOrder.user_id;
      if (trade.buyer_id && expectedBuyer && trade.buyer_id !== expectedBuyer) {
        return failBatch({
          errorCode: 'ORDER_PARTICIPANT_MISMATCH',
          error: `ORDER_PARTICIPANT_MISMATCH: Trade buyer ${trade.buyer_id} does not match order buyer ${expectedBuyer}`,
        });
      }
      const expectedSeller = sellOrder.participantId || sellOrder.user_id;
      if (trade.seller_id && expectedSeller && trade.seller_id !== expectedSeller) {
        return failBatch({
          errorCode: 'ORDER_PARTICIPANT_MISMATCH',
          error: `ORDER_PARTICIPANT_MISMATCH: Trade seller ${trade.seller_id} does not match order seller ${expectedSeller}`,
        });
      }

      if (buyOrder.status !== 'open' && buyOrder.status !== 'partial') {
        return failBatch({
          errorCode: 'ORDER_INVALID_STATUS',
          error: `ORDER_INVALID_STATUS: Buy order ${buyOrder.id} status is ${buyOrder.status}`,
        });
      }
      if (sellOrder.status !== 'open' && sellOrder.status !== 'partial') {
        return failBatch({
          errorCode: 'ORDER_INVALID_STATUS',
          error: `ORDER_INVALID_STATUS: Sell order ${sellOrder.id} status is ${sellOrder.status}`,
        });
      }

      if (buyOrder.price < trade.price || sellOrder.price > trade.price) {
        return failBatch({
          errorCode: 'ORDER_PRICE_MISMATCH',
          error: `ORDER_PRICE_MISMATCH: Trade price ${trade.price} outside limits (buy: ${buyOrder.price}, sell: ${sellOrder.price})`,
        });
      }

      allocatedPerOrder.set(
        trade.buy_order_id,
        (allocatedPerOrder.get(trade.buy_order_id) || 0) + trade.size
      );
      allocatedPerOrder.set(
        trade.sell_order_id,
        (allocatedPerOrder.get(trade.sell_order_id) || 0) + trade.size
      );
    }

    for (const [orderId, allocated] of allocatedPerOrder.entries()) {
      const ord = this.db.orders.get(orderId)!;
      const original = ord.originalQuantity ?? ord.size;
      const filled = ord.filledQuantity ?? ord.filled ?? 0;
      const remaining = Math.max(0, original - filled);
      if (allocated > remaining) {
        return failBatch({
          errorCode: 'ORDER_OVERFILL',
          error: `ORDER_OVERFILL: Order ${orderId} remaining qty is ${remaining}, but batch requests ${allocated}`,
        });
      }
    }

    // CAS 검증
    if (batch.orderCas) {
      for (const cas of batch.orderCas) {
        const ord = this.db.orders.get(cas.id);
        if (!ord) {
          return failBatch({
            errorCode: 'ORDER_CAS_MISMATCH',
            error: `ORDER_CAS_MISMATCH: Order ${cas.id} not found`,
          });
        }
        const original = ord.originalQuantity ?? ord.size;
        const filled = ord.filledQuantity ?? ord.filled ?? 0;
        const remaining = Math.max(0, original - filled);
        if (cas.expectedRemaining !== undefined && cas.expectedRemaining !== remaining) {
          return failBatch({
            errorCode: 'ORDER_CAS_MISMATCH',
            error: `ORDER_CAS_MISMATCH: Order ${cas.id} remaining ${remaining} !== expected ${cas.expectedRemaining}`,
          });
        }
        if (cas.expectedFilled !== undefined && cas.expectedFilled !== filled) {
          return failBatch({
            errorCode: 'ORDER_CAS_MISMATCH',
            error: `ORDER_CAS_MISMATCH: Order ${cas.id} filled ${filled} !== expected ${cas.expectedFilled}`,
          });
        }
        if (cas.expectedVersion !== undefined && cas.expectedVersion !== (ord.version || 1)) {
          return failBatch({
            errorCode: 'ORDER_CAS_MISMATCH',
            error: `ORDER_CAS_MISMATCH: Order ${cas.id} version ${ord.version || 1} !== expected ${cas.expectedVersion}`,
          });
        }
      }
    }

    // ── Phase 2: 순 합계 산출 (권위 있는 모든 참가자 대상) ──
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

      // Buyer: pays tradeAmount + buyerFeeAmount
      if (buyerId !== null) {
        netCashDeltas.set(buyerId, (netCashDeltas.get(buyerId) || 0) - (v.tradeAmount + v.fees.buyerFeeAmount));
        const key = `${buyerId}::${trade.stock_id}`;
        const existing = netHoldingDeltas.get(key) || { userId: buyerId, stockId: trade.stock_id, delta: 0 };
        existing.delta += trade.size;
        netHoldingDeltas.set(key, existing);
      }

      // Seller: receives tradeAmount - sellerFeeAmount
      if (sellerId !== null) {
        netCashDeltas.set(sellerId, (netCashDeltas.get(sellerId) || 0) + (v.tradeAmount - v.fees.sellerFeeAmount));
        const sellOrder = this.db.orders.get(trade.sell_order_id);
        const isLp = Boolean(sellOrder?.is_lp || (sellOrder as any)?.participantKind === 'LIQUIDITY_PROVIDER');
        if (!isLp) {
          const key = `${sellerId}::${trade.stock_id}`;
          const existing = netHoldingDeltas.get(key) || { userId: sellerId, stockId: trade.stock_id, delta: 0 };
          existing.delta -= trade.size;
          netHoldingDeltas.set(key, existing);
        }
      }
    }

    interface AuthoritativeAccountView {
      id: string;
      cash: number;
      netWorth: number;
      isInstitution: boolean;
      needsProfileCreation: boolean;
      institutionName?: string;
    }
    const getAccountView = (userId: string): AuthoritativeAccountView | null => {
      const pid = this.db.profileUserIdIndex.get(userId) || userId;
      const p = this.db.profiles.get(pid);
      if (p) {
        return {
          id: p.id,
          cash: p.cash,
          netWorth: p.net_worth,
          isInstitution: p.rank_tier === 'INSTITUTION',
          needsProfileCreation: false,
        };
      }
      const port = this.db.institutionalPortfolios.get(userId);
      if (port) {
        return {
          id: userId,
          cash: port.current_cash,
          netWorth: port.total_capital ?? port.current_cash,
          isInstitution: true,
          needsProfileCreation: true,
          institutionName: port.name || userId,
        };
      }
      return null;
    };
    const getHolding = (userId: string, stockId: string): HoldingRecord | null => {
      return this.db.holdings.get(`${userId}_${stockId}`) || null;
    };

    // ── Phase 3: 잔액/보유 사전 검증 + 전체 스냅샷 (단일 롤백 경계, 순수 read-only) ──
    const profileSnapshots = new Map<string, ProfileRecord>();
    const holdingSnapshots = new Map<string, HoldingRecord | null>();
    const portfolioSnapshots = new Map<string, any>();
    const tradesCountBefore = this.db.trades.length;
    const ledgerEntriesBefore = new Map(this.db.settlementLedger);
    const ordersSnapshot = new Map<string, OrderRecord>();
    const stocksSnapshot = new Map<string, StockRecord>();
    const priceHistoryCountBefore = this.db.stockPriceHistory.length;

    for (const [userId, cashDelta] of netCashDeltas.entries()) {
      const view = getAccountView(userId);
      if (!view) {
        return failBatch({
          errorCode: 'PRE_VALIDATION_FAILED',
          error: `PRE_VALIDATION_FAILED: Profile not found for user ${userId}`,
        });
      }
      if (!Number.isFinite(view.cash) || !Number.isFinite(cashDelta)) {
        return failBatch({
          errorCode: 'PRE_VALIDATION_FAILED',
          error: `PRE_VALIDATION_FAILED: Non-finite cash balance for user ${userId}`,
        });
      }
      if (view.cash + cashDelta < 0) {
        return failBatch({
          errorCode: 'PRE_VALIDATION_FAILED',
          error: `PRE_VALIDATION_FAILED: Insufficient cash for user ${userId}. Required delta: ${cashDelta}, Current cash: ${view.cash}`,
        });
      }
      const existingProfile = this.db.profiles.get(this.db.profileUserIdIndex.get(userId) || userId);
      if (existingProfile) {
        profileSnapshots.set(existingProfile.id, { ...existingProfile });
      }

      const port = this.db.institutionalPortfolios.get(userId);
      if (port) {
        portfolioSnapshots.set(userId, { ...port });
      }
    }

    for (const [key, item] of netHoldingDeltas.entries()) {
      const holding = getHolding(item.userId, item.stockId);
      const currentQty = holding ? holding.quantity : 0;
      if (!Number.isFinite(currentQty) || !Number.isFinite(item.delta) || currentQty + item.delta < 0) {
        return failBatch({
          errorCode: 'PRE_VALIDATION_FAILED',
          error: `PRE_VALIDATION_FAILED: Insufficient holdings for user ${item.userId} stock ${item.stockId}. Required delta: ${item.delta}, Current qty: ${currentQty}`,
        });
      }
      holdingSnapshots.set(key, holding ? { ...holding } : null);
    }

    for (const orderId of allocatedPerOrder.keys()) {
      const ord = this.db.orders.get(orderId);
      if (ord) ordersSnapshot.set(orderId, { ...ord });
    }

    if (batch.orderUpdates) {
      for (const upd of batch.orderUpdates) {
        const ord = this.db.orders.get(upd.id);
        if (ord && !ordersSnapshot.has(upd.id)) {
          ordersSnapshot.set(upd.id, { ...ord });
        }
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
        const view = getAccountView(userId)!;
        const nextCash = roundMoney(view.cash + cashDelta);
        if (view.needsProfileCreation) {
          const newProfile: ProfileRecord = {
            id: userId,
            user_id: userId,
            username: view.institutionName || userId,
            nickname: view.institutionName || userId,
            cash: nextCash,
            net_worth: view.netWorth,
            rank_tier: 'INSTITUTION',
            created_at: this.db.getIsoTimestamp(),
          };
          this.db.profiles.set(userId, newProfile);
          this.db.profileUserIdIndex.set(userId, userId);
          newlyCreatedProfileIds.add(userId);
        } else {
          const profile = this.db.profiles.get(this.db.profileUserIdIndex.get(userId) || userId)!;
          profile.cash = nextCash;
        }
        const port = this.db.institutionalPortfolios.get(userId);
        if (port) {
          port.current_cash = nextCash;
        }
      }

      for (let i = 0; i < validated.length; i++) {
        const v = validated[i];
        const trade = pendingInputs[i];
        const buyerId = isNonEmptyId(trade.buyer_id) ? trade.buyer_id : null;
        const sellerId = isNonEmptyId(trade.seller_id) ? trade.seller_id : null;

        if (buyerId !== null) {
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

          const port = this.db.institutionalPortfolios.get(buyerId);
          if (port) {
            port.current_stock = (port.current_stock || 0) + trade.size;
          }
        }

        if (sellerId !== null) {
          const hid = `${sellerId}_${trade.stock_id}`;
          const h = this.db.holdings.get(hid);
          if (h) {
            h.quantity = Math.max(0, h.quantity - trade.size);
          }
          const port = this.db.institutionalPortfolios.get(sellerId);
          if (port) {
            port.current_stock = Math.max(0, (port.current_stock || 0) - trade.size);
          }
        }

        const tradeRecord: TradeRecord = {
          id: v.tradeId,
          stock_id: trade.stock_id,
          buyer_id: buyerId,
          seller_id: sellerId,
          buy_order_id: trade.buy_order_id,
          sell_order_id: trade.sell_order_id,
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

      // 체결 주문 상태 일괄 갱신
      for (const [orderId, allocated] of allocatedPerOrder.entries()) {
        const ord = this.db.orders.get(orderId)!;
        const origQty = ord.originalQuantity ?? ord.size;
        const prevFilled = ord.filledQuantity ?? ord.filled ?? 0;
        const nextFilled = prevFilled + allocated;
        const nextRemaining = Math.max(0, origQty - nextFilled);
        ord.originalQuantity = origQty;
        ord.filledQuantity = nextFilled;
        ord.remainingQuantity = nextRemaining;
        ord.filled = nextFilled;
        ord.size = nextRemaining;
        ord.status = nextRemaining === 0 ? 'filled' : 'partial';
        ord.version = (ord.version || 1) + 1;
      }

      // 명시적 orderUpdates 반영 (allocated 외 주문)
      if (batch.orderUpdates) {
        for (const upd of batch.orderUpdates) {
          const ord = this.db.orders.get(upd.id);
          if (ord) {
            if (!allocatedPerOrder.has(upd.id)) {
              if (upd.expectedVersion !== undefined && (ord.version || 1) !== upd.expectedVersion) {
                throw new Error(`ORDER_CAS_MISMATCH: Version mismatch for ${upd.id}`);
              }
              if (upd.size !== undefined) {
                ord.size = upd.size;
                ord.remainingQuantity = upd.size;
              }
              if (upd.status) {
                if (ord.status === 'filled' && (upd.status === 'open' || upd.status === 'partial')) {
                  // Do not reopen filled orders
                } else {
                  ord.status = upd.status;
                }
              }
              ord.version = (ord.version || 1) + 1;
            }
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
      // ── Phase 5: 완전 롤백 ──
      for (const id of newlyCreatedProfileIds) {
        this.db.profiles.delete(id);
        this.db.profileUserIdIndex.delete(id);
      }
      for (const [pid, snap] of profileSnapshots.entries()) {
        const p = this.db.profiles.get(pid);
        if (p) Object.assign(p, snap);
      }
      for (const [botId, snap] of portfolioSnapshots.entries()) {
        const port = this.db.institutionalPortfolios.get(botId);
        if (port) Object.assign(port, snap);
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
      for (const id of newlyInsertedOrderIds) {
        const ord = this.db.orders.get(id);
        if (ord) this.db.removeOrderFromIndex(ord);
        this.db.orders.delete(id);
      }
      for (const [id, snap] of originalOrdersBeforeBatch.entries()) {
        this.db.orders.set(id, snap);
      }
      for (const [id, snap] of ordersSnapshot.entries()) {
        this.db.orders.set(id, snap);
      }
      for (const [id, snap] of stocksSnapshot.entries()) {
        this.db.stocks.set(id, snap);
      }
      this.db.stockPriceHistory = this.db.stockPriceHistory.slice(0, priceHistoryCountBefore);
      this.db.rebuildIndexes();
      (this.db as any).restoreIdGenerator?.(idGenSnapshot);

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

    const hid = `${params.userId}_${params.optionId}`;
    const holding = this.db.holdings.get(hid);
    if (!holding) {
      return { success: false, errorCode: 'POSITION_NOT_FOUND', error: `Position not found for ${hid}` };
    }
    if (holding.stock_id !== params.optionId) {
      return { success: false, errorCode: 'POSITION_ASSET_MISMATCH', error: `Holding asset ${holding.stock_id} does not match option ${params.optionId}` };
    }
    if (typeof holding.quantity !== 'number' || !Number.isFinite(holding.quantity) || holding.quantity <= 0) {
      return { success: false, errorCode: 'INVALID_POSITION_QUANTITY', error: `Invalid position quantity: ${holding.quantity}` };
    }
    if (params.expectedQuantity !== undefined && holding.quantity !== params.expectedQuantity) {
      return { success: false, errorCode: 'POSITION_QUANTITY_MISMATCH', error: `Position quantity ${holding.quantity} does not match expected ${params.expectedQuantity}` };
    }

    const contract = this.db.optionsContracts.get(params.optionId);
    if (!contract) {
      return { success: false, errorCode: 'CONTRACT_NOT_FOUND', error: `Option contract ${params.optionId} not found` };
    }
    const expiryTime = Date.parse(contract.expiry_date);
    const now = params.now ?? this.db.getNowMs();
    if (Number.isFinite(expiryTime) && expiryTime > now) {
      return { success: false, errorCode: 'EXPIRY_DATE_NOT_REACHED', error: `Option has not expired: ${contract.expiry_date}` };
    }

    const closePrice = params.underlyingClosePrice;
    if (closePrice === undefined || closePrice === null) {
      return { success: false, errorCode: 'HELD_MISSING_UNDERLYING_PRICE', error: 'Underlying close price missing' };
    }
    if (typeof closePrice !== 'number' || !Number.isFinite(closePrice) || closePrice <= 0) {
      return { success: false, errorCode: 'HELD_INVALID_PRICE', error: `Invalid underlying close price: ${closePrice}` };
    }

    const pid = this.db.profileUserIdIndex.get(params.userId) || params.userId;
    const profile = this.db.profiles.get(pid);
    if (!profile) {
      return { success: false, errorCode: 'USER_NOT_FOUND', error: `User profile not found: ${params.userId}` };
    }

    // Authoritative payout calculated inside trust boundary
    const optType = (contract.type || contract.option_type || 'CALL').toUpperCase();
    let diffPerUnit = 0;
    if (optType === 'CALL') {
      if (closePrice > contract.strike_price) {
        diffPerUnit = closePrice - contract.strike_price;
      }
    } else if (contract.strike_price > closePrice) {
      diffPerUnit = contract.strike_price - closePrice;
    }
    const multiplier = 250000;
    const payoutAmount = roundMoney(diffPerUnit * holding.quantity * multiplier);

    const profileSnapshot = { ...profile };
    const holdingSnapshot = { ...holding };
    const historyCountBefore = this.db.optionSettlements.length;

    try {
      if (payoutAmount > 0) {
        const nextCash = roundMoney(profile.cash + payoutAmount);
        if (!Number.isFinite(nextCash)) throw new Error('Cash calculation overflow');
        profile.cash = nextCash;
      }

      this.db.optionSettlements.push({
        id: params.idempotencyKey,
        user_id: params.userId,
        option_id: params.optionId,
        payout_amount: payoutAmount,
        settled_at: this.db.getIsoTimestamp(),
      });

      if (params.faultInjection === 'FAIL_AT_CLOSE') {
        throw new Error('FAULT_INJECTION_FAIL_AT_CLOSE');
      }

      this.db.removeHoldingFromIndex(holding);
      this.db.holdings.delete(hid);

      if (params.faultInjection === 'FAIL_AT_LEDGER') {
        throw new Error('FAULT_INJECTION_FAIL_AT_LEDGER');
      }

      this.db.settlementLedger.set(params.idempotencyKey, {
        trade_id: params.idempotencyKey,
        stock_id: params.optionId,
        price: 0,
        size: 0,
        total_amount: payoutAmount,
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
      this.db.holdings.set(hid, holdingSnapshot);
      this.db.addHoldingToIndex(holdingSnapshot);
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

    const hid = `${params.userId}_${params.bondId}`;
    const holding = this.db.holdings.get(hid);
    if (!holding) {
      return { success: false, errorCode: 'POSITION_NOT_FOUND', error: `Bond holding not found for ${hid}` };
    }
    if (holding.stock_id !== params.bondId) {
      return { success: false, errorCode: 'POSITION_ASSET_MISMATCH', error: `Holding asset ${holding.stock_id} does not match bond ${params.bondId}` };
    }
    if (typeof holding.quantity !== 'number' || !Number.isFinite(holding.quantity) || holding.quantity <= 0) {
      return { success: false, errorCode: 'INVALID_POSITION_QUANTITY', error: `Invalid position quantity: ${holding.quantity}` };
    }
    if (params.expectedQuantity !== undefined && holding.quantity !== params.expectedQuantity) {
      return { success: false, errorCode: 'POSITION_QUANTITY_MISMATCH', error: `Position quantity ${holding.quantity} does not match expected ${params.expectedQuantity}` };
    }

    const bond = this.db.bonds.get(params.bondId);
    if (!bond) {
      return { success: false, errorCode: 'BOND_NOT_FOUND', error: `Bond ${params.bondId} not found` };
    }
    const maturityTime = Date.parse(bond.maturity_date || bond.maturity);
    const now = params.now ?? this.db.getNowMs();
    if (Number.isFinite(maturityTime) && maturityTime > now) {
      return { success: false, errorCode: 'MATURITY_DATE_NOT_REACHED', error: 'Bond has not reached maturity' };
    }

    const pid = this.db.profileUserIdIndex.get(params.userId) || params.userId;
    const profile = this.db.profiles.get(pid);
    if (!profile) {
      return { success: false, errorCode: 'USER_NOT_FOUND', error: `User profile not found: ${params.userId}` };
    }

    const authoritativePrincipal = roundMoney(bond.face_value * holding.quantity);
    const authoritativeCoupon = roundMoney(bond.face_value * (bond.coupon_rate ?? 0) * holding.quantity);

    if (params.principalAmount !== undefined && Math.abs(params.principalAmount - authoritativePrincipal) > 0.01) {
      return {
        success: false,
        errorCode: 'INVALID_PRINCIPAL_AMOUNT',
        error: `Principal amount mismatch: expected ${authoritativePrincipal}, got ${params.principalAmount}`,
      };
    }
    if (params.couponAmount !== undefined && Math.abs(params.couponAmount - authoritativeCoupon) > 0.01) {
      return {
        success: false,
        errorCode: 'INVALID_COUPON_AMOUNT',
        error: `Coupon amount mismatch: expected ${authoritativeCoupon}, got ${params.couponAmount}`,
      };
    }

    const totalPayout = roundMoney(authoritativePrincipal + authoritativeCoupon);
    const profileSnapshot = { ...profile };
    const holdingSnapshot = { ...holding };
    const historyCountBefore = this.db.bondCouponPayments.length;

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
        principal_amount: authoritativePrincipal,
        coupon_amount: authoritativeCoupon,
        payment_type: 'MATURITY_REDEMPTION',
        paid_at: this.db.getIsoTimestamp(),
      });

      if (params.faultInjection === 'FAIL_AT_CLOSE') {
        throw new Error('FAULT_INJECTION_FAIL_AT_CLOSE');
      }

      this.db.removeHoldingFromIndex(holding);
      this.db.holdings.delete(hid);

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
      this.db.holdings.set(hid, holdingSnapshot);
      this.db.addHoldingToIndex(holdingSnapshot);
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
