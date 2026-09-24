/**
 * SettlementRepository Interface for STOCKSYS
 */

import type {
  TradeSettlementInput,
  SettlementBatchResult
} from './types';

export interface SettlementRepository {
  /**
   * Atomically settles a batch of trades with full pre-validation,
   * rollback on failure, fee accounting, and idempotency.
   */
  settleTradeBatchAtomically(
    trades: readonly TradeSettlementInput[]
  ): Promise<SettlementBatchResult>;

  /**
   * Check if a trade ID was already processed.
   */
  isTradeSettled(tradeId: string): boolean;

  /**
   * Settle option payout to user cash.
   */
  settleOptionPayout(
    userId: string,
    optionId: string,
    payoutAmount: number,
    idempotencyKey: string
  ): Promise<boolean>;

  /**
   * Settle bond coupon payout to user cash.
   */
  settleBondCoupon(
    userId: string,
    bondId: string,
    couponAmount: number,
    idempotencyKey: string
  ): Promise<boolean>;

  /**
   * Settle bond principal redemption.
   */
  settleBondRedemption(
    userId: string,
    bondId: string,
    principalAmount: number,
    idempotencyKey: string
  ): Promise<boolean>;
}
