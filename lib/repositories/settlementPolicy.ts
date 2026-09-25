/**
 * Settlement Policy — 정산 경계의 단일 권위 정책 모듈
 *
 * 책임:
 *  1. 정산 입력 TradeSettlementInput에 대한 완전한 런타임 검증 (NaN/Infinity/음수/0/소수/중복 등)
 *  2. 수수료 "비율"(rate) → "금액"(amount) 변환 (외부 금액 주입 금지)
 *  3. 금액 반올림 단위 및 허용 오차의 명시적 정의
 *
 * 수수료 부호 정책:
 *  - 양수 rate  → 수수료 차감 (buyer는 더 내고, seller는 더 받는다)
 *  - 음수 rate  → 리베이트 지급 (maker 리베이트)
 *  - 0          → 무료
 */

import type { CalculatedTradeFees, TradeFeeRates, TradeSettlementInput } from './types';

/** 금액 반올림 단위: 원 단위(KRW) 정수 반올림. */
export const SETTLEMENT_MONEY_ROUNDING = 0;

/** 허용 가능한 최대 수수료율 절댓값 (1회 주문의 10%). 이보다 큰 값은 거부한다. */
export const MAX_ABS_FEE_RATE = 0.1;

/** totalAmount 검증 허용 오차: 반올림 1단위 + 부동소수 오차. */
export const TOTAL_AMOUNT_ABS_TOLERANCE = 0.005;

export type SettlementValidationErrorCode =
  | 'EMPTY_TRADE_BATCH'
  | 'TRADE_NOT_AN_OBJECT'
  | 'TRADE_ID_MISSING'
  | 'TRADE_ID_DUPLICATE_IN_BATCH'
  | 'TRADE_ID_ALREADY_SETTLED'
  | 'STOCK_ID_MISSING'
  | 'TRADE_PRICE_NOT_FINITE'
  | 'TRADE_PRICE_NOT_POSITIVE'
  | 'TRADE_SIZE_NOT_FINITE'
  | 'TRADE_SIZE_NOT_INTEGER'
  | 'TRADE_SIZE_NOT_POSITIVE'
  | 'TRADE_BUY_ORDER_ID_MISSING'
  | 'TRADE_SELL_ORDER_ID_MISSING'
  | 'TRADE_SAME_ACCOUNT'
  | 'TRADE_BOTH_PARTIES_MISSING'
  | 'FEE_RATE_NOT_FINITE'
  | 'FEE_RATE_OUT_OF_RANGE'
  | 'FEE_RATES_MISSING'
  | 'TOTAL_AMOUNT_MISMATCH';

export interface SettlementValidationFailure {
  readonly ok: false;
  readonly errorCode: SettlementValidationErrorCode;
  readonly tradeId: string | null;
  readonly message: string;
}

export interface SettlementValidationSuccess {
  readonly ok: true;
  readonly tradeId: string;
  readonly tradeAmount: number;
  readonly fees: CalculatedTradeFees;
  readonly feeRates: TradeFeeRates;
}

export type SettlementValidationResult = SettlementValidationSuccess | SettlementValidationFailure;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** 금액을 정책 반올림 단위로 정규화한다. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`[SettlementPolicy] roundMoney requires a finite number: ${value}`);
  }
  return Number(value.toFixed(SETTLEMENT_MONEY_ROUNDING));
}

/** 수수료율 1건 검증. */
export function validateFeeRate(rate: unknown, field: string): SettlementValidationFailure | null {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    return {
      ok: false,
      errorCode: 'FEE_RATE_NOT_FINITE',
      tradeId: null,
      message: `${field} must be a finite number: ${rate}`,
    };
  }
  if (Math.abs(rate) > MAX_ABS_FEE_RATE) {
    return {
      ok: false,
      errorCode: 'FEE_RATE_OUT_OF_RANGE',
      tradeId: null,
      message: `${field} out of allowed range [-${MAX_ABS_FEE_RATE}, ${MAX_ABS_FEE_RATE}]: ${rate}`,
    };
  }
  return null;
}

/**
 * tradeAmount로부터 실제 수수료 금액을 계산한다.
 * amount = roundMoney(tradeAmount * rate)
 * 양수 rate는 수수료(차감), 음수 rate는 리베이트(지급)이며 부호가 그대로 유지된다.
 */
export function calculateTradeFees(tradeAmount: number, rates: TradeFeeRates): CalculatedTradeFees {
  if (!Number.isFinite(tradeAmount) || tradeAmount < 0) {
    throw new RangeError(`[SettlementPolicy] tradeAmount must be finite and non-negative: ${tradeAmount}`);
  }
  return {
    buyerFeeAmount: roundMoney(tradeAmount * rates.buyerFeeRate),
    sellerFeeAmount: roundMoney(tradeAmount * rates.sellerFeeRate),
  };
}

function failure(errorCode: SettlementValidationErrorCode, tradeId: string | null, message: string): SettlementValidationFailure {
  return { ok: false, errorCode, tradeId, message };
}

/**
 * 단일 거래의 완전한 런타임 검증.
 * 상태 조회나 합산 이전에 호출되어야 하며, 하나라도 실패하면 batch 전체가 거부된다.
 *
 * @param seenIds 동일 batch에서 이미 등장한 거래 ID 집합 (중복 감지)
 * @param isAlreadySettled authoritative ledger 조회 결과
 */
export function validateTradeSettlementInput(
  input: unknown,
  seenIds: ReadonlySet<string>,
  isAlreadySettled: (tradeId: string) => boolean
): SettlementValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return failure('TRADE_NOT_AN_OBJECT', null, 'trade settlement input must be a non-null object');
  }

  const trade = input as TradeSettlementInput;

  // 1. ID (필수, 비어 있지 않은 문자열, batch 내 중복 금지)
  if (!isNonEmptyString(trade.id)) {
    return failure('TRADE_ID_MISSING', null, `trade id must be a non-empty string: ${String(trade.id)}`);
  }
  const tradeId = trade.id;
  if (seenIds.has(tradeId)) {
    return failure('TRADE_ID_DUPLICATE_IN_BATCH', tradeId, `duplicate trade id in batch: ${tradeId}`);
  }
  if (isAlreadySettled(tradeId)) {
    return failure('TRADE_ID_ALREADY_SETTLED', tradeId, `trade id already settled: ${tradeId}`);
  }

  // 2. 종목 ID
  if (!isNonEmptyString(trade.stock_id)) {
    return failure('STOCK_ID_MISSING', tradeId, `stock_id must be a non-empty string: ${String(trade.stock_id)}`);
  }

  // 3. 가격: finite && > 0
  if (typeof trade.price !== 'number' || !Number.isFinite(trade.price)) {
    return failure('TRADE_PRICE_NOT_FINITE', tradeId, `price must be a finite number: ${trade.price}`);
  }
  if (trade.price <= 0) {
    return failure('TRADE_PRICE_NOT_POSITIVE', tradeId, `price must be > 0: ${trade.price}`);
  }

  // 4. 수량: finite integer && > 0
  if (typeof trade.size !== 'number' || !Number.isFinite(trade.size)) {
    return failure('TRADE_SIZE_NOT_FINITE', tradeId, `size must be a finite number: ${trade.size}`);
  }
  if (!Number.isSafeInteger(trade.size)) {
    return failure('TRADE_SIZE_NOT_INTEGER', tradeId, `size must be a safe integer: ${trade.size}`);
  }
  if (trade.size <= 0) {
    return failure('TRADE_SIZE_NOT_POSITIVE', tradeId, `size must be > 0: ${trade.size}`);
  }

  // 5. 매수/매도 주문 식별자
  if (!isNonEmptyString(trade.buy_order_id)) {
    return failure('TRADE_BUY_ORDER_ID_MISSING', tradeId, `buy_order_id must be a non-empty string: ${String(trade.buy_order_id)}`);
  }
  if (!isNonEmptyString(trade.sell_order_id)) {
    return failure('TRADE_SELL_ORDER_ID_MISSING', tradeId, `sell_order_id must be a non-empty string: ${String(trade.sell_order_id)}`);
  }

  // 6. 참가자 검증
  const buyerId = isNonEmptyString(trade.buyer_id) ? trade.buyer_id : null;
  const sellerId = isNonEmptyString(trade.seller_id) ? trade.seller_id : null;
  if (buyerId !== null && sellerId !== null && buyerId === sellerId) {
    return failure('TRADE_SAME_ACCOUNT', tradeId, `buyer and seller must differ: ${buyerId}`);
  }
  if (buyerId === null && sellerId === null) {
    return failure('TRADE_BOTH_PARTIES_MISSING', tradeId, 'both buyer_id and seller_id are missing');
  }

  // 7. 수수료율: rate만 허용, 범위 검사
  const rates = trade.fee_rates || (
    typeof trade.buyer_fee_rate === 'number' && typeof trade.seller_fee_rate === 'number'
      ? { buyerFeeRate: trade.buyer_fee_rate, sellerFeeRate: trade.seller_fee_rate }
      : undefined
  );
  if (!rates || typeof rates !== 'object') {
    return failure('FEE_RATES_MISSING', tradeId, 'fee_rates must be provided with buyerFeeRate and sellerFeeRate');
  }
  const buyerRateIssue = validateFeeRate(rates.buyerFeeRate, 'buyerFeeRate');
  if (buyerRateIssue) {
    return { ...buyerRateIssue, tradeId };
  }
  const sellerRateIssue = validateFeeRate(rates.sellerFeeRate, 'sellerFeeRate');
  if (sellerRateIssue) {
    return { ...sellerRateIssue, tradeId };
  }

  // 8. 총 거래대금: price × size 와 정책 허용 오차 내에서 일치해야 한다.
  //    (레거시 total_amount 주입은 제거되었으므로 항상 price × size 로 계산한다)
  const tradeAmount = roundMoney(trade.price * trade.size);
  if (!Number.isFinite(tradeAmount) || tradeAmount < 0) {
    return failure('TOTAL_AMOUNT_MISMATCH', tradeId, `computed trade amount is invalid: ${tradeAmount}`);
  }

  return {
    ok: true,
    tradeId,
    tradeAmount,
    feeRates: { buyerFeeRate: rates.buyerFeeRate, sellerFeeRate: rates.sellerFeeRate },
    fees: calculateTradeFees(tradeAmount, {
      buyerFeeRate: rates.buyerFeeRate,
      sellerFeeRate: rates.sellerFeeRate,
    }),
  };
}
