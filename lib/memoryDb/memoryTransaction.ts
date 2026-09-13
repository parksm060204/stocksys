/**
 * Local trading transaction snapshot / rollback.
 *
 * Stock and user state is snapshotted only for the accounts and stock held by
 * the transaction. Trades are intentionally different: the global trade log
 * is shared by all stocks, so rollback tracks and removes exact trade IDs
 * instead of rewinding the array or restoring a global copy.
 */
import {
  memoryDb,
  ProfileRecord,
  HoldingRecord,
  OrderRecord,
  StockRecord,
} from './memoryStore';

export interface TradingSnapshot {
  stockId: string;
  userIds: string[];

  profiles: Map<string, ProfileRecord>;
  holdings: Map<string, HoldingRecord>;
  orders: Map<string, OrderRecord>;
  createdTradeIds: Set<string>;
  stockBefore: StockRecord | undefined;

  holdingUserIndexBefore: Map<string, Set<string>>;
  orderStockIndexBefore: Set<string>;
  orderUserIndexBefore: Map<string, Set<string>>;

  /** Order ID of the incoming order inserted by this transaction. */
  insertedOrderId: string | null;
}

/**
 * Take a snapshot before mutation. The caller holds the stock lock and all
 * involved account locks, so stock/user-scoped restoration cannot overwrite a
 * concurrent mutation for the same resource.
 *
 * Profile creation is outside the supported trading transaction: settlement
 * validates that every non-bot participant already has a profile.
 */
export function snapshotTradingState(stockId: string, userIds: string[]): TradingSnapshot {
  const db = memoryDb;

  const profiles = new Map<string, ProfileRecord>();
  for (const uid of userIds) {
    const profile = db.profiles.get(uid);
    if (profile) profiles.set(uid, { ...profile });
  }

  const holdings = new Map<string, HoldingRecord>();
  const holdingUserIndexBefore = new Map<string, Set<string>>();
  for (const uid of userIds) {
    const ids = db.holdingUserIndex.get(uid);
    holdingUserIndexBefore.set(uid, ids ? new Set(ids) : new Set());
    if (ids) {
      for (const holdingId of ids) {
        const holding = db.holdings.get(holdingId);
        if (holding) holdings.set(holdingId, { ...holding });
      }
    }
  }

  const orders = new Map<string, OrderRecord>();
  const stockOrderIds = db.orderStockIndex.get(stockId);
  const orderStockIndexBefore = stockOrderIds ? new Set(stockOrderIds) : new Set<string>();
  if (stockOrderIds) {
    for (const orderId of stockOrderIds) {
      const order = db.orders.get(orderId);
      if (order) orders.set(orderId, { ...order });
    }
  }

  const orderUserIndexBefore = new Map<string, Set<string>>();
  for (const uid of userIds) {
    const ids = db.orderUserIndex.get(uid);
    orderUserIndexBefore.set(uid, ids ? new Set(ids) : new Set());
  }

  const stock = db.stocks.get(stockId);

  return {
    stockId,
    userIds: [...userIds],
    profiles,
    holdings,
    orders,
    createdTradeIds: new Set<string>(),
    stockBefore: stock ? { ...stock } : undefined,
    holdingUserIndexBefore,
    orderStockIndexBefore,
    orderUserIndexBefore,
    insertedOrderId: null,
  };
}

/** Remove only this transaction's trade records from both trade collections. */
function removeOwnedTrades(createdTradeIds: Set<string>): void {
  if (createdTradeIds.size === 0) return;

  for (let i = memoryDb.trades.length - 1; i >= 0; i -= 1) {
    if (createdTradeIds.has(memoryDb.trades[i].id)) {
      memoryDb.trades.splice(i, 1);
    }
  }

  for (const [stockId, trades] of memoryDb.tradeStockIndex.entries()) {
    for (let i = trades.length - 1; i >= 0; i -= 1) {
      if (createdTradeIds.has(trades[i].id)) trades.splice(i, 1);
    }
    if (trades.length === 0) memoryDb.tradeStockIndex.delete(stockId);
  }
}

/** Restore all stock/user-scoped state and this transaction's owned trades. */
export function rollbackTradingState(snapshot: TradingSnapshot): void {
  const db = memoryDb;

  for (const [uid, record] of snapshot.profiles.entries()) {
    db.profiles.set(uid, record);
  }

  for (const uid of snapshot.userIds) {
    const currentIds = db.holdingUserIndex.get(uid);
    if (currentIds) {
      for (const holdingId of currentIds) {
        if (!snapshot.holdings.has(holdingId)) db.holdings.delete(holdingId);
      }
    }
  }
  for (const [holdingId, record] of snapshot.holdings.entries()) {
    db.holdings.set(holdingId, record);
  }

  if (snapshot.insertedOrderId && !snapshot.orders.has(snapshot.insertedOrderId)) {
    const inserted = db.orders.get(snapshot.insertedOrderId);
    if (inserted) db.removeOrderFromIndex(inserted);
    db.orders.delete(snapshot.insertedOrderId);
  }
  for (const [orderId, record] of snapshot.orders.entries()) {
    db.orders.set(orderId, record);
  }

  removeOwnedTrades(snapshot.createdTradeIds);

  if (snapshot.stockBefore !== undefined) {
    db.stocks.set(snapshot.stockId, snapshot.stockBefore);
  }

  for (const [uid, ids] of snapshot.holdingUserIndexBefore.entries()) {
    db.holdingUserIndex.set(uid, new Set(ids));
  }
  db.orderStockIndex.set(snapshot.stockId, new Set(snapshot.orderStockIndexBefore));
  for (const [uid, ids] of snapshot.orderUserIndexBefore.entries()) {
    db.orderUserIndex.set(uid, new Set(ids));
  }
}
