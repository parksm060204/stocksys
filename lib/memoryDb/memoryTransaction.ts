/**
 * STOCKSYS Local Transaction — Lightweight Snapshot / Rollback
 *
 * Covers only the 6 trading-relevant state collections and their 4 associated indexes.
 * Intentionally excludes non-trading tables (stockPriceHistory, marketNews, commodities, etc.)
 * to keep the snapshot small and fast.
 *
 * Usage:
 *   const snap = snapshotTradingState(stockId);
 *   try {
 *     // ... all mutations ...
 *     // commit: do nothing — live state is already the new state
 *   } catch (err) {
 *     rollbackTradingState(snap);
 *     throw err;
 *   }
 *
 * Covered state:
 *   - profiles (Map entries for affected users)
 *   - holdings (Map entries for affected holdings)
 *   - orders   (Map entries for affected orders)
 *   - trades   (array length + all entries added since snapshot)
 *   - stocks   (single stock record by stockId)
 *
 * Covered indexes:
 *   - holdingUserIndex  (Set<string> per userId)
 *   - orderStockIndex   (Set<string> for stockId)
 *   - orderUserIndex    (Set<string> per userId)
 *   - tradeStockIndex   (TradeRecord[] for stockId)
 */

import {
  memoryDb,
  ProfileRecord,
  HoldingRecord,
  OrderRecord,
  TradeRecord,
  StockRecord,
} from './memoryStore';

export interface TradingSnapshot {
  /** stockId this snapshot covers */
  stockId: string;
  /** Involved user IDs (buyer, seller, incoming user) */
  userIds: string[];

  // ── Primary state snapshots ──
  profiles: Map<string, ProfileRecord>;
  /** holdingId → HoldingRecord */
  holdings: Map<string, HoldingRecord>;
  /** orderId → OrderRecord (only orders that existed before this tx) */
  orders: Map<string, OrderRecord>;
  /** trade array length before tx — used to trim new trades on rollback */
  tradeCountBefore: number;
  /** trade array contents before tx (deep copy for correctness) */
  tradesBefore: TradeRecord[];
  /** stock record before tx */
  stockBefore: StockRecord | undefined;

  // ── Index snapshots ──
  /** userId → copy of Set<holdingId> */
  holdingUserIndexBefore: Map<string, Set<string>>;
  /** stockId → copy of Set<orderId> */
  orderStockIndexBefore: Set<string>;
  /** userId → copy of Set<orderId> */
  orderUserIndexBefore: Map<string, Set<string>>;
  /** stock_id → TradeRecord[] (copy) */
  tradeStockIndexBefore: TradeRecord[];

  /** orderId of any new incoming order inserted during this tx — tracked for rollback */
  insertedOrderId: string | null;
}

/**
 * Take a snapshot of all trading-relevant state for the given stock and user IDs.
 * Must be called BEFORE any state mutation in the matching/settlement pipeline.
 */
export function snapshotTradingState(stockId: string, userIds: string[]): TradingSnapshot {
  const db = memoryDb;

  // Snapshot profiles for all potentially affected users
  const profilesSnap = new Map<string, ProfileRecord>();
  for (const uid of userIds) {
    const p = db.profiles.get(uid);
    if (p) profilesSnap.set(uid, { ...p });
  }

  // Snapshot all holdings for affected users (scan by user index)
  const holdingsSnap = new Map<string, HoldingRecord>();
  const holdingIndexSnap = new Map<string, Set<string>>();
  for (const uid of userIds) {
    const ids = db.holdingUserIndex.get(uid);
    holdingIndexSnap.set(uid, ids ? new Set(ids) : new Set());
    if (ids) {
      for (const hId of ids) {
        const h = db.holdings.get(hId);
        if (h) holdingsSnap.set(hId, { ...h });
      }
    }
  }

  // Snapshot orders for this stock (from stock index)
  const ordersSnap = new Map<string, OrderRecord>();
  const stockOrderSet = db.orderStockIndex.get(stockId);
  const orderStockSnap = stockOrderSet ? new Set(stockOrderSet) : new Set<string>();
  if (stockOrderSet) {
    for (const oId of stockOrderSet) {
      const o = db.orders.get(oId);
      if (o) ordersSnap.set(oId, { ...o });
    }
  }

  // Snapshot order user index for affected users
  const orderUserSnap = new Map<string, Set<string>>();
  for (const uid of userIds) {
    const ids = db.orderUserIndex.get(uid);
    orderUserSnap.set(uid, ids ? new Set(ids) : new Set());
  }

  // Snapshot trades
  const tradeCountBefore = db.trades.length;
  const tradesBefore = db.trades.map((t) => ({ ...t }));

  // Snapshot trade stock index for this stock
  const tradeStockArr = db.tradeStockIndex.get(stockId);
  const tradeStockSnap = tradeStockArr ? tradeStockArr.map((t) => ({ ...t })) : [];

  // Snapshot stock record
  const stock = db.stocks.get(stockId);
  const stockBefore = stock ? { ...stock } : undefined;

  return {
    stockId,
    userIds: [...userIds],
    profiles: profilesSnap,
    holdings: holdingsSnap,
    orders: ordersSnap,
    tradeCountBefore,
    tradesBefore,
    stockBefore,
    holdingUserIndexBefore: holdingIndexSnap,
    orderStockIndexBefore: orderStockSnap,
    orderUserIndexBefore: orderUserSnap,
    tradeStockIndexBefore: tradeStockSnap,
    insertedOrderId: null,
  };
}

/**
 * Roll back all trading-relevant state to the pre-transaction snapshot.
 * Synchronous — must be called in a catch block.
 */
export function rollbackTradingState(snap: TradingSnapshot): void {
  const db = memoryDb;

  // ── Restore profiles ──
  for (const [uid, record] of snap.profiles.entries()) {
    db.profiles.set(uid, record);
  }

  // ── Restore holdings ──
  // 1. Remove any newly inserted holdings that weren't in the snapshot
  for (const uid of snap.userIds) {
    const currentIds = db.holdingUserIndex.get(uid);
    if (currentIds) {
      for (const hId of currentIds) {
        if (!snap.holdings.has(hId)) {
          db.holdings.delete(hId);
        }
      }
    }
  }
  // 2. Restore original holding values (including those that were decremented to 0 and deleted)
  for (const [hId, record] of snap.holdings.entries()) {
    db.holdings.set(hId, record);
  }

  // ── Restore orders ──
  // 1. Remove any newly inserted order (incoming order inserted during this tx)
  if (snap.insertedOrderId && !snap.orders.has(snap.insertedOrderId)) {
    db.orders.delete(snap.insertedOrderId);
  }
  // 2. Restore maker order states to pre-tx values
  for (const [oId, record] of snap.orders.entries()) {
    db.orders.set(oId, record);
  }

  // ── Restore trades array ──
  // Trim any trades appended after snapshot
  db.trades.splice(snap.tradeCountBefore);
  // Restore original values (for any that were mutated in-place — defensive)
  for (let i = 0; i < snap.tradesBefore.length; i++) {
    db.trades[i] = snap.tradesBefore[i];
  }

  // ── Restore stock record ──
  if (snap.stockBefore !== undefined) {
    db.stocks.set(snap.stockId, snap.stockBefore);
  }

  // ── Restore indexes ──
  // holdingUserIndex
  for (const [uid, idSet] of snap.holdingUserIndexBefore.entries()) {
    db.holdingUserIndex.set(uid, new Set(idSet));
  }

  // orderStockIndex
  db.orderStockIndex.set(snap.stockId, new Set(snap.orderStockIndexBefore));

  // orderUserIndex
  for (const [uid, idSet] of snap.orderUserIndexBefore.entries()) {
    db.orderUserIndex.set(uid, new Set(idSet));
  }

  // tradeStockIndex
  db.tradeStockIndex.set(snap.stockId, snap.tradeStockIndexBefore.map((t) => ({ ...t })));
}
