/**
 * Domain types and models for STOCKSYS Repository Layer
 */

import type {
  StockRecord,
  CommodityRecord,
  ProfileRecord,
  HoldingRecord,
  OrderRecord,
  TradeRecord,
  StockPriceHistoryRecord,
  MarketNewsRecord,
  BondRecord,
  OptionContractRecord
} from '../memoryDb/memoryStore';

export interface PlayerEventRecord {
  id: string;
  user_id?: string;
  event_id?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ActiveManipulationRecord {
  id: string;
  stock_id: string;
  target_direction?: string;
  status: string;
  [key: string]: unknown;
}

export interface InstitutionalPortfolioRecord {
  id?: string;
  bot_id: string;
  name?: string;
  total_capital?: number;
  current_cash: number;
  current_stock: number;
  current_kr_equity?: number;
  current_us_equity?: number;
  current_eu_equity?: number;
  current_bond?: number;
  current_commodity?: number;
  current_derivatives?: number;
  target_weights?: any;
  updated_at?: string;
  [key: string]: unknown;
}

export interface MarketIndexRecord {
  id?: string;
  ticker?: string;
  name?: string;
  current_price?: number;
  [key: string]: unknown;
}

export interface ExchangeRateRecord {
  currency_code: string;
  currency_name?: string;
  rate_to_krw: number;
  updated_at?: string;
  [key: string]: unknown;
}

export type {
  StockRecord,
  CommodityRecord,
  ProfileRecord,
  HoldingRecord,
  OrderRecord,
  TradeRecord,
  StockPriceHistoryRecord,
  MarketNewsRecord,
  BondRecord,
  OptionContractRecord
};

export interface MarketSnapshot {
  readonly stocks: readonly StockRecord[];
  readonly bonds: readonly BondRecord[];
  readonly commodities: readonly CommodityRecord[];
  readonly exchangeRates: readonly ExchangeRateRecord[];
  readonly indices: readonly MarketIndexRecord[];
  readonly options_contracts?: readonly OptionContractRecord[];
  readonly adminSettings?: any;
}

export interface OrderUpdate {
  readonly id: string;
  readonly filled?: number;
  readonly status?: 'open' | 'partial' | 'filled' | 'cancelled' | 'expired';
}

export interface TradeSettlementInput {
  readonly id?: string;
  readonly stock_id: string;
  readonly buyer_id?: string | null;
  readonly seller_id?: string | null;
  readonly buy_order_id?: string;
  readonly sell_order_id?: string;
  readonly buyer_is_bot: boolean;
  readonly seller_is_bot: boolean;
  readonly price: number;
  readonly size: number;
  readonly total_amount?: number;
  readonly buyer_fee?: number;
  readonly seller_fee?: number;
  readonly created_at?: string;
  readonly sequence?: number;
  readonly simulation_time?: number;
  readonly settled?: boolean;
}

export interface SettlementBatchResult {
  readonly success: boolean;
  readonly settledTradesCount: number;
  readonly totalVolume: number;
  readonly totalAmount: number;
  readonly totalFees: number;
  readonly error?: string;
  readonly rollbackOccurred: boolean;
  readonly settledTradeIds: readonly string[];
  readonly skippedTradeIds?: readonly string[];
}
