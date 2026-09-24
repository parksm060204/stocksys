/**
 * MarketRepository Interface for STOCKSYS
 */

import type {
  MarketSnapshot,
  StockRecord,
  OrderRecord,
  OrderUpdate,
  TradeRecord,
  StockPriceHistoryRecord,
  OptionContractRecord
} from './types';

export interface MarketRepository {
  getMarketSnapshot(): Promise<MarketSnapshot>;
  getStocks(): Promise<StockRecord[]>;
  getStockById(id: string): Promise<StockRecord | null>;
  getStockByTicker(ticker: string): Promise<StockRecord | null>;
  updateStockPrices(
    updates: ReadonlyArray<{
      id: string;
      current_price: number;
      high?: number;
      low?: number;
      volume?: number;
      change_rate?: number;
    }>
  ): Promise<void>;

  getOpenOrders(stockId?: string): Promise<OrderRecord[]>;
  getOrderById(orderId: string): Promise<OrderRecord | null>;
  insertOrders(orders: readonly OrderRecord[]): Promise<void>;
  updateOrders(updates: readonly OrderUpdate[]): Promise<void>;
  cancelOrders(orderIds: readonly string[]): Promise<void>;

  saveTrades(trades: readonly TradeRecord[]): Promise<void>;
  getRecentTrades(stockId?: string, limit?: number): Promise<TradeRecord[]>;

  savePriceHistory(records: readonly StockPriceHistoryRecord[]): Promise<void>;
  getPriceHistory(stockId?: string, limit?: number): Promise<StockPriceHistoryRecord[]>;

  upsertStocks(stocks: readonly Partial<StockRecord>[]): Promise<void>;
  upsertBonds(bonds: readonly any[]): Promise<void>;
  upsertCommodities(commodities: readonly any[]): Promise<void>;
  getExchangeRates(): Promise<any[]>;
  upsertExchangeRates(rates: readonly any[]): Promise<void>;

  /** Option settlement: batch current prices for underlying stocks. Missing ids are omitted. */
  getUnderlyingPrices(stockIds: readonly string[]): Record<string, number>;
  /** Option settlement: fetch option contracts by id. */
  getOptionContracts(optionIds: readonly string[]): OptionContractRecord[];

  trimOldData(
    maxTrades: number,
    maxPriceHistory: number
  ): Promise<{ tradesTrimmed: number; historyTrimmed: number }>;
  deleteOrders(orderIds: readonly string[]): Promise<void>;
}
