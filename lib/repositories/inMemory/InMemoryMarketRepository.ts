/**
 * InMemoryMarketRepository
 * Concrete in-memory implementation of MarketRepository backed by MemoryDatabase.
 */

import { MemoryDatabase, OptionContractRecord } from '../../memoryDb/memoryStore';
import type { MarketRepository } from '../marketRepository';
import type {
  MarketSnapshot,
  StockRecord,
  OrderRecord,
  OrderUpdate,
  TradeRecord,
  StockPriceHistoryRecord
} from '../types';

export class InMemoryMarketRepository implements MarketRepository {
  constructor(private readonly db: MemoryDatabase) {}

  public async getMarketSnapshot(): Promise<MarketSnapshot> {
    return {
      stocks: Array.from(this.db.stocks.values()),
      bonds: Array.from(this.db.bonds.values()),
      commodities: Array.from(this.db.commodities.values()),
      exchangeRates: [...this.db.exchangeRates],
      indices: [],
    };
  }

  public async getStocks(): Promise<StockRecord[]> {
    return Array.from(this.db.stocks.values());
  }

  public async getStockById(id: string): Promise<StockRecord | null> {
    return this.db.stocks.get(id) || null;
  }

  public async getStockByTicker(ticker: string): Promise<StockRecord | null> {
    const stockId = this.db.tickerIndex.get(ticker.toUpperCase());
    if (!stockId) return null;
    return this.db.stocks.get(stockId) || null;
  }

  public async updateStockPrices(
    updates: ReadonlyArray<{
      id: string;
      current_price: number;
      high?: number;
      low?: number;
      volume?: number;
      change_rate?: number;
    }>
  ): Promise<void> {
    for (const u of updates) {
      const stock = this.db.stocks.get(u.id);
      if (stock) {
        stock.current_price = u.current_price;
        if (u.high !== undefined) stock.high = Math.max(stock.high || u.current_price, u.high);
        if (u.low !== undefined) stock.low = Math.min(stock.low || u.current_price, u.low);
        if (u.volume !== undefined) stock.volume = u.volume;
        if (u.change_rate !== undefined) stock.change_rate = u.change_rate;
      }
    }
  }

  public async getOpenOrders(stockId?: string): Promise<OrderRecord[]> {
    if (stockId) {
      const orderIds = this.db.orderStockIndex.get(stockId);
      if (!orderIds) return [];
      const result: OrderRecord[] = [];
      for (const id of orderIds) {
        const order = this.db.orders.get(id);
        if (order && (order.status === 'open' || order.status === 'partial')) {
          result.push({ ...order });
        }
      }
      return result;
    }

    const result: OrderRecord[] = [];
    for (const order of this.db.orders.values()) {
      if (order.status === 'open' || order.status === 'partial') {
        result.push({ ...order });
      }
    }
    return result;
  }

  public async getOrderById(orderId: string): Promise<OrderRecord | null> {
    const order = this.db.orders.get(orderId);
    return order ? { ...order } : null;
  }

  public async insertOrders(orders: readonly OrderRecord[]): Promise<void> {
    for (const o of orders) {
      const id = o.id || this.db.generateId('ord');
      const record: OrderRecord = {
        ...o,
        id,
        created_at: o.created_at || this.db.getIsoTimestamp(),
      };
      this.db.orders.set(id, record);
      this.db.addOrderToIndex(record);
    }
  }

  public async updateOrders(updates: readonly OrderUpdate[]): Promise<void> {
    for (const u of updates) {
      const order = this.db.orders.get(u.id);
      if (order) {
        if (u.filled !== undefined) order.filled = u.filled;
        if (u.status !== undefined) order.status = u.status;
        if (u.participantKind !== undefined) (order as any).participantKind = u.participantKind;
        if (u.participantId !== undefined) (order as any).participantId = u.participantId;
        if (u.strategyId !== undefined) (order as any).strategyId = u.strategyId;
      }
    }
  }

  public async cancelOrders(orderIds: readonly string[]): Promise<void> {
    for (const id of orderIds) {
      const order = this.db.orders.get(id);
      if (order) {
        order.status = 'cancelled';
        this.db.removeOrderFromIndex(order);
      }
    }
  }

  public async saveTrades(trades: readonly TradeRecord[]): Promise<void> {
    for (const t of trades) {
      const id = t.id || this.db.generateId('trade');
      const record: TradeRecord = {
        ...t,
        id,
        created_at: t.created_at || this.db.getIsoTimestamp(),
      };
      this.db.trades.push(record);
      this.db.addTradeToIndex(record);
    }
  }

  public async getRecentTrades(stockId?: string, limit?: number): Promise<TradeRecord[]> {
    if (stockId) {
      const list = this.db.tradeStockIndex.get(stockId) || [];
      return typeof limit === 'number' ? list.slice(-limit).map((t) => ({ ...t })) : list.map((t) => ({ ...t }));
    }
    return typeof limit === 'number' ? this.db.trades.slice(-limit).map((t) => ({ ...t })) : this.db.trades.map((t) => ({ ...t }));
  }

  public async savePriceHistory(records: readonly StockPriceHistoryRecord[]): Promise<void> {
    for (const r of records) {
      const id = r.id || this.db.generateId('sph');
      this.db.stockPriceHistory.push({
        ...r,
        id,
        recorded_at: r.recorded_at || this.db.getIsoTimestamp(),
      });
    }
  }

  public async getPriceHistory(stockId?: string, limit: number = 300): Promise<StockPriceHistoryRecord[]> {
    if (stockId) {
      return this.db.stockPriceHistory
        .filter((h) => h.stock_id === stockId)
        .slice(-limit)
        .map((h) => ({ ...h }));
    }
    return this.db.stockPriceHistory.slice(-limit).map((h) => ({ ...h }));
  }

  public async upsertStocks(stocks: readonly Partial<StockRecord>[]): Promise<void> {
    for (const s of stocks) {
      if (!s.id) continue;
      const existing = this.db.stocks.get(s.id);
      if (existing) {
        this.db.stocks.set(s.id, { ...existing, ...s });
      } else {
        this.db.stocks.set(s.id, s as StockRecord);
      }
    }
  }

  public async upsertBonds(bonds: readonly any[]): Promise<void> {
    for (const b of bonds) {
      if (!b.id) continue;
      const existing = this.db.bonds.get(b.id);
      if (existing) {
        this.db.bonds.set(b.id, { ...existing, ...b });
      } else {
        this.db.bonds.set(b.id, b);
      }
    }
  }

  public async upsertCommodities(commodities: readonly any[]): Promise<void> {
    for (const c of commodities) {
      const key = c.id || c.commodity_id;
      if (!key) continue;
      const existing = this.db.commodities.get(key);
      if (existing) {
        this.db.commodities.set(key, { ...existing, ...c });
      } else {
        this.db.commodities.set(key, c);
      }
    }
  }

  public async getExchangeRates(): Promise<any[]> {
    return this.db.exchangeRates.map((r) => ({ ...r }));
  }

  public async upsertExchangeRates(rates: readonly any[]): Promise<void> {
    for (const r of rates) {
      const idx = this.db.exchangeRates.findIndex((x) => x.currency === r.currency || x.id === r.id);
      if (idx >= 0) {
        this.db.exchangeRates[idx] = { ...this.db.exchangeRates[idx], ...r };
      } else {
        this.db.exchangeRates.push({ ...r });
      }
    }
  }

  public async deleteOrders(orderIds: readonly string[]): Promise<void> {
    for (const id of orderIds) {
      this.db.orders.delete(id);
    }
  }

  /** Option settlement: batch current prices for underlying stocks. */
  public getUnderlyingPrices(stockIds: readonly string[]): Record<string, number> {
    const prices: Record<string, number> = {};
    for (const id of stockIds) {
      const stock = this.db.stocks.get(id);
      if (stock && Number.isFinite(stock.current_price)) {
        prices[id] = stock.current_price;
      }
    }
    return prices;
  }

  /** Option settlement: fetch option contracts by id. */
  public getOptionContracts(optionIds: readonly string[]): OptionContractRecord[] {
    if (optionIds.length === 0) return [];
    const wanted = new Set(optionIds);
    return Array.from(this.db.optionsContracts.values()).filter((c) => wanted.has(c.id));
  }

  public async trimOldData(
    maxTrades: number,
    maxPriceHistory: number
  ): Promise<{ tradesTrimmed: number; historyTrimmed: number }> {
    const safeMaxTrades = Math.max(1000, maxTrades);
    const safeMaxHistory = Math.max(1000, maxPriceHistory);

    let tradesTrimmed = 0;
    let historyTrimmed = 0;

    if (this.db.trades.length > safeMaxTrades) {
      tradesTrimmed = this.db.trades.length - safeMaxTrades;
      this.db.trades = this.db.trades.slice(-safeMaxTrades);
      this.db.rebuildIndexes();
    }

    if (this.db.stockPriceHistory.length > safeMaxHistory) {
      historyTrimmed = this.db.stockPriceHistory.length - safeMaxHistory;
      this.db.stockPriceHistory = this.db.stockPriceHistory.slice(-safeMaxHistory);
    }

    return { tradesTrimmed, historyTrimmed };
  }
}
