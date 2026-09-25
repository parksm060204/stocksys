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
  readonly participantKind?: string;
  readonly participantId?: string;
  readonly strategyId?: string;
}

/**
 * 수수료 "비율"(rate) — 외부가 계산된 금액을 넘겨주지 못하도록 금액 필드와 타입을 분리한다.
 * 정책: 양수 rate = 수수료 차감, 음수 rate = 리베이트 지급. 0 = 무료.
 * maker rebate = -0.001, taker fee = +0.0025
 */
export interface TradeFeeRates {
  readonly buyerFeeRate: number;
  readonly sellerFeeRate: number;
}

/** 정산 경계에서 rate로부터 계산된 실제 수수료 "금액". */
export interface CalculatedTradeFees {
  readonly buyerFeeAmount: number;
  readonly sellerFeeAmount: number;
}

export interface TradeSettlementInput {
  /** 정산 식별자. 선택값이 아닌 필수값이며, 매칭 직후 정산 이전에 결정론적으로 생성된다. */
  readonly id: string;
  readonly stock_id: string;
  readonly buyer_id?: string | null;
  readonly seller_id?: string | null;
  readonly buy_order_id: string;
  readonly sell_order_id: string;
  readonly buyer_is_bot: boolean;
  readonly seller_is_bot: boolean;
  readonly price: number;
  readonly size: number;
  /** 수수료는 비율로만 전달한다. 금액은 정산 경계에서 계산한다. */
  readonly fee_rates: TradeFeeRates;
  readonly created_at?: string;
  readonly sequence?: number;
  readonly simulation_time?: number;
}

export interface SettlementBatchResult {
  readonly success: boolean;
  readonly settledTradesCount: number;
  readonly totalVolume: number;
  readonly totalAmount: number;
  /**
   * 순 수수료 금액 합계(양수=비용, 음수=리베이트 순 지급).
   * 순이익이 아니라 "수수료" 의미로 고정한다.
   */
  readonly totalFeeAmount: number;
  /** 실패 시 명시적 오류 코드 (예: TRADE_ID_MISSING, TRADE_PRICE_NOT_FINITE) */
  readonly errorCode?: string;
  /** 실패 시 오류 메시지 */
  readonly error?: string;
  /** 검증에 실패하여 batch 전체가 거부된 거래 ID 목록 */
  readonly rejectedTradeIds?: readonly string[];
  readonly rollbackOccurred: boolean;
  readonly settledTradeIds: readonly string[];
  readonly skippedTradeIds?: readonly string[];
}

export interface CanonicalOrderQuantities {
  readonly originalQuantity: number;
  readonly filledQuantity: number;
  readonly remainingQuantity: number;
}

export function normalizeOrderQuantities(order: {
  size: number;
  filled?: number;
  originalQuantity?: number;
  filledQuantity?: number;
  remainingQuantity?: number;
}): CanonicalOrderQuantities {
  const origRaw = order.originalQuantity !== undefined ? order.originalQuantity : order.size;
  if (typeof origRaw !== 'number' || !Number.isFinite(origRaw) || !Number.isSafeInteger(origRaw) || origRaw <= 0) {
    throw new RangeError(`originalQuantity must be a positive safe integer, got ${origRaw}`);
  }

  const filledRaw = order.filledQuantity !== undefined ? order.filledQuantity : (order.filled ?? 0);
  if (typeof filledRaw !== 'number' || !Number.isFinite(filledRaw) || !Number.isSafeInteger(filledRaw) || filledRaw < 0) {
    throw new RangeError(`filledQuantity must be a non-negative safe integer, got ${filledRaw}`);
  }

  if (filledRaw > origRaw) {
    throw new RangeError(`filledQuantity (${filledRaw}) cannot exceed originalQuantity (${origRaw})`);
  }

  const remRaw = order.remainingQuantity !== undefined ? order.remainingQuantity : (origRaw - filledRaw);
  if (typeof remRaw !== 'number' || !Number.isFinite(remRaw) || !Number.isSafeInteger(remRaw) || remRaw < 0) {
    throw new RangeError(`remainingQuantity must be a non-negative safe integer, got ${remRaw}`);
  }

  if (filledRaw + remRaw !== origRaw) {
    throw new RangeError(`filledQuantity (${filledRaw}) + remainingQuantity (${remRaw}) !== originalQuantity (${origRaw})`);
  }

  return {
    originalQuantity: origRaw,
    filledQuantity: filledRaw,
    remainingQuantity: remRaw,
  };
}

export interface MatchedBatchCommitInput {
  readonly trades: readonly TradeSettlementInput[];
  /** Insert-only new orders. If any ID already exists in repository, batch rejects with ORDER_ALREADY_EXISTS. */
  readonly newOrders?: readonly OrderRecord[];
  /** Dedicated LP quote upserts, separate from general orders. */
  readonly lpQuoteUpserts?: readonly OrderRecord[];
  readonly orderUpdates?: readonly {
    readonly id: string;
    readonly size?: number;
    readonly remainingQuantity?: number;
    readonly filledQuantity?: number;
    readonly status?: 'open' | 'partial' | 'filled' | 'cancelled' | 'expired';
    readonly expectedVersion?: number;
  }[];
  readonly marketPriceUpdates?: readonly {
    readonly stock_id: string;
    readonly price: number;
  }[];
  readonly priceHistory?: readonly {
    readonly stock_id: string;
    readonly price: number;
    readonly recorded_at: string;
  }[];
  readonly orderCas?: readonly {
    readonly id: string;
    readonly expectedRemaining?: number;
    readonly expectedFilled?: number;
    readonly expectedVersion?: number;
  }[];
  readonly faultInjection?: 'FAIL_AFTER_TRADES_INSERTED' | 'FAIL_AFTER_HOLDINGS_UPDATED' | 'FAIL_BEFORE_LEDGER';
}

export interface RefreshLpQuotesParams {
  readonly quotes: readonly OrderRecord[];
  readonly expectedGeneration?: number;
  readonly nextGeneration: number;
  readonly staleSlotIdsToCancel?: readonly string[];
  readonly faultInjection?: 'FAIL_AFTER_FIRST_CHUNK' | 'FAIL_DURING_STALE_CANCEL' | 'FAIL_BEFORE_GENERATION_UPDATE';
}

export interface RefreshLpQuotesResult {
  readonly success: boolean;
  readonly updatedQuotesCount: number;
  readonly cancelledQuotesCount: number;
  readonly newGeneration: number;
  readonly errorCode?: string;
  readonly error?: string;
}

export interface PostCommitWarning {
  readonly stage: string;
  readonly message: string;
  readonly error?: unknown;
}

export interface TickResult {
  readonly success: boolean;
  readonly tickCount: number;
  readonly commitStatus: 'NOT_COMMITTED' | 'COMMITTED';
  readonly errorCode?: string;
  readonly error?: string;
  readonly diagnostics?: readonly any[];
  readonly postCommitWarnings?: readonly PostCommitWarning[];
}

export interface OptionExpirySettlementParams {
  readonly userId: string;
  readonly optionId: string;
  readonly underlyingClosePrice?: number;
  readonly expectedQuantity?: number;
  readonly now?: number;
  readonly payoutAmount?: number;
  readonly idempotencyKey: string;
  readonly faultInjection?: 'FAIL_AT_CLOSE' | 'FAIL_AT_LEDGER';
}

export interface BondMaturitySettlementParams {
  readonly userId: string;
  readonly bondId: string;
  readonly now?: number;
  readonly expectedQuantity?: number;
  readonly principalAmount?: number;
  readonly couponAmount?: number;
  readonly idempotencyKey: string;
  readonly faultInjection?: 'FAIL_AT_CLOSE' | 'FAIL_AT_LEDGER';
}

export interface NonTradeSettlementResult {
  readonly success: boolean;
  readonly errorCode?: string;
  readonly error?: string;
  readonly rollbackOccurred?: boolean;
}

