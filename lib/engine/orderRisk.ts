/**
 * MUMYEONG: Order Risk & Balance Reservation System
 * 미체결(open, partial) 주문에 대한 예수금 및 보유 주식 예약(Reservation) 동적 계산
 */
import type { MemoryDatabase, ProfileRecord } from '../memoryDb/memoryStore';
import { getStockFxRateToKrw, getUsdFxRateFromDb, isUsdQuotedAsset } from './currency';
import { hasActiveFeeBooster } from '../shop/catalog';

export const OPTION_RESERVATION_FEE_RATE = 0.001;
export const STOCK_TAKER_FEE_RATE = 0.0025;

/**
 * 옵션 매수 주문 1건의 총 필요 예약금(체결대금 + 0.1% 예약 수수료)을 서버 정산과 동일하게 계산한다.
 */
export function calculateOptionBuyRequiredCashKrw(
  effectivePrice: number,
  multiplier: number,
  qty: number,
  feeRate: number = OPTION_RESERVATION_FEE_RATE
): number {
  if (!Number.isFinite(effectivePrice) || effectivePrice <= 0 || !Number.isFinite(multiplier) || multiplier <= 0 || !Number.isInteger(qty) || qty <= 0) {
    return 0;
  }
  const notional = Math.round(effectivePrice * multiplier * qty);
  const fee = Math.round(notional * feeRate);
  return notional + fee;
}

/**
 * 가용 예수금(또는 비율 예산) 내에서 0.1% 예약 수수료를 포함해 주문 가능한 최대 옵션 계약 수를 계산한다.
 * 부동소수점 경계 오차(예: 2.9999999999999996) 및 반올림 1원 경계 초과 거절을 방지한다.
 */
export function calculateMaxOptionBuyContracts(
  availableBalanceKrw: number,
  effectivePrice: number,
  multiplier: number,
  pct: number = 100,
  feeRate: number = OPTION_RESERVATION_FEE_RATE
): number {
  if (
    !Number.isFinite(availableBalanceKrw) ||
    availableBalanceKrw <= 0 ||
    !Number.isFinite(effectivePrice) ||
    effectivePrice <= 0 ||
    !Number.isFinite(multiplier) ||
    multiplier <= 0 ||
    !Number.isFinite(pct) ||
    pct <= 0
  ) {
    return 0;
  }
  const budget = Math.floor(availableBalanceKrw * (pct / 100));
  const unitWithFee = effectivePrice * multiplier * (1 + feeRate);
  if (!Number.isFinite(unitWithFee) || unitWithFee <= 0) return 0;

  let qty = Math.max(0, Math.floor((budget + 1) / unitWithFee));
  while (qty > 0 && calculateOptionBuyRequiredCashKrw(effectivePrice, multiplier, qty, feeRate) > budget) {
    qty -= 1;
  }
  while (calculateOptionBuyRequiredCashKrw(effectivePrice, multiplier, qty + 1, feeRate) <= budget) {
    qty += 1;
  }
  return qty;
}

export function getEffectiveStockTakerFeeRate(
  profile?: Pick<ProfileRecord, 'unlocked_features' | 'feature_expiries' | 'acquired_passives'> | null,
  nowMs: number = Date.now()
): number {
  return hasActiveFeeBooster(profile, nowMs) ? STOCK_TAKER_FEE_RATE * 0.5 : STOCK_TAKER_FEE_RATE;
}

export interface CurrencyReservationContext {
  stocks?: ReadonlyMap<string, { market?: string; ticker?: string; currency?: 'KRW' | 'USD' }>;
  exchangeRates?: ReadonlyArray<{ currency_code: string; rate_to_krw: number }>;
  usdToKrwRate?: number;
}

export interface OpenOrderForRisk {
  id?: string;
  user_id?: string | null;
  stock_id: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  filled: number;
  status: string;
}

export interface OptionContractMultiplierLookup {
  has(id: string): boolean;
  get(id: string): { multiplier?: number } | undefined;
}

function getOrderFxRateToKrw(stockId: string, currencyContext?: CurrencyReservationContext): number {
  if (!currencyContext?.stocks) return 1;
  const stock = currencyContext.stocks.get(stockId);
  if (!stock || !isUsdQuotedAsset(stock)) return 1;
  if (typeof currencyContext.usdToKrwRate === 'number' && Number.isFinite(currencyContext.usdToKrwRate) && currencyContext.usdToKrwRate > 0) {
    return currencyContext.usdToKrwRate;
  }
  return getUsdFxRateFromDb({ exchangeRates: currencyContext.exchangeRates });
}

/**
 * 단일 매수 주문의 잔여 예약 예수금(KRW 환산 + 정산 수수료 포함) 계산
 * - 옵션: 계약별 승수 + 0.1% 수수료
 * - 일반 주식/ETF: KRW 환산(해외/USD ETF는 환율 적용) + 최대 테이커 수수료(0.25%)
 */
export function calculateSingleBuyOrderReservedCash(
  order: OpenOrderForRisk,
  optionsContracts?: OptionContractMultiplierLookup,
  currencyContext?: CurrencyReservationContext,
  stockTakerFeeRate: number = STOCK_TAKER_FEE_RATE
): number {
  if (order.side !== 'buy' || (order.status !== 'open' && order.status !== 'partial')) {
    return 0;
  }
  const remainingQty = Math.max(0, Number(order.size) - Number(order.filled || 0));
  if (remainingQty <= 0) return 0;

  const contract = optionsContracts?.get(order.stock_id);
  if (contract) {
    const multiplier = Number(contract.multiplier ?? 250000);
    const notional = Math.round(Number(order.price) * multiplier * remainingQty);
    const fee = Math.round(notional * OPTION_RESERVATION_FEE_RATE);
    return notional + fee;
  }

  const fxRate = getOrderFxRateToKrw(order.stock_id, currencyContext);
  const quoteNotional = remainingQty * Number(order.price);
  const notionalKrw = fxRate === 1 ? Math.round(quoteNotional) : Math.round(quoteNotional * fxRate);
  const feeKrw = Math.round(notionalKrw * stockTakerFeeRate);
  return notionalKrw + feeKrw;
}

/**
 * 유저의 미체결 매수 주문으로 인해 예약된 총 예수금 계산
 * (이미 현금에서 차감된 원자재 증거금은 이중 차감하지 않는다.)
 * @param orders 유저의 open/partial 주문 목록
 * @param excludeOrderId 수정/취소 대상인 경우 제외할 주문 ID
 * @param optionsContracts 옵션 계약 승수 조회 맵 (지정 시 옵션 계약별 승수·수수료 반영)
 * @param currencyContext USD 종목/ETF 환율 변환용 컨텍스트
 */
export function calculateReservedCash(
  orders: OpenOrderForRisk[],
  excludeOrderId?: string,
  optionsContracts?: OptionContractMultiplierLookup,
  currencyContext?: CurrencyReservationContext,
  stockTakerFeeRate: number = STOCK_TAKER_FEE_RATE
): number {
  let reserved = 0;
  for (const o of orders) {
    if (excludeOrderId && o.id === excludeOrderId) continue;
    reserved += calculateSingleBuyOrderReservedCash(o, optionsContracts, currencyContext, stockTakerFeeRate);
  }
  return reserved;
}

/**
 * MemoryDatabase 기준 계좌의 미체결(주식/ETF/옵션) 매수 예약 총액 계산.
 * 원자재 증거금은 주문 등록 시 profile.cash에서 이미 차감되므로 중복 차감하지 않는다.
 */
export function calculateUserReservedCashKrw(
  db: MemoryDatabase,
  userId: string,
  excludeOrderId?: string
): number {
  const orderIds = db.orderUserIndex.get(userId);
  if (!orderIds || orderIds.size === 0) return 0;
  const openOrders: OpenOrderForRisk[] = [];
  for (const oid of orderIds) {
    const ord = db.orders.get(oid);
    if (!ord) continue;
    if (ord.status === 'open' || ord.status === 'partial') {
      openOrders.push(ord);
    }
  }
  const stockFeeRate = getEffectiveStockTakerFeeRate(db.resolveProfileByUserId(userId), db.getNowMs());
  return calculateReservedCash(openOrders, excludeOrderId, db.optionsContracts, {
    stocks: db.stocks,
    exchangeRates: db.exchangeRates,
  }, stockFeeRate);
}

/**
 * 계좌의 현재 가용 KRW 현금(profile.cash - 미체결 주식/옵션 매수 예약금) 계산.
 */
export function getAvailableCashKrw(
  db: MemoryDatabase,
  userId: string,
  excludeOrderId?: string
): { cash: number; reservedCash: number; availableCash: number } {
  const profile = db.resolveProfileByUserId(userId);
  const cash = Number(profile?.cash ?? 0);
  const marginDebt = Math.max(0, Number(profile?.margin_debt_krw ?? 0));
  const reservedCash = calculateUserReservedCashKrw(db, userId, excludeOrderId);
  return {
    cash,
    reservedCash,
    availableCash: Number.isFinite(cash) && marginDebt <= 0 ? Math.max(0, cash - reservedCash) : 0,
  };
}

/**
 * 특정 종목의 미체결 매도 주문으로 인해 예약된 총 주식 수량 계산
 * @param orders 유저의 open/partial 주문 목록
 * @param stockId 검증할 대상 종목 ID
 * @param excludeOrderId 수정/취소 대상인 경우 제외할 주문 ID
 */
export function calculateReservedQty(
  orders: OpenOrderForRisk[],
  stockId: string,
  excludeOrderId?: string
): number {
  let reserved = 0;
  for (const o of orders) {
    if (excludeOrderId && o.id === excludeOrderId) continue;
    if (o.side === 'sell' && o.stock_id === stockId && (o.status === 'open' || o.status === 'partial')) {
      const remainingQty = Math.max(0, Number(o.size) - Number(o.filled || 0));
      reserved += remainingQty;
    }
  }
  return reserved;
}

export function applyCashCreditWithMarginDebt(
  profile: { cash: number; margin_debt_krw?: number },
  creditAmount: number
): void {
  if (!Number.isFinite(creditAmount) || creditAmount <= 0) return;
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const currentDebt = Math.max(0, round2(Number(profile.margin_debt_krw ?? 0)));
  if (currentDebt > 0) {
    const repay = Math.min(creditAmount, currentDebt);
    const nextDebt = round2(currentDebt - repay);
    if (nextDebt > 0) profile.margin_debt_krw = nextDebt;
    else delete profile.margin_debt_krw;
    const remainder = round2(creditAmount - repay);
    if (remainder > 0) {
      profile.cash = round2(profile.cash + remainder);
    }
  } else {
    profile.cash = round2(profile.cash + creditAmount);
  }
}

export interface ValidateOrderCapacityParams {
  userId: string;
  stockId: string;
  side: 'buy' | 'sell';
  incomingPrice: number;
  incomingSize: number;
  currentCash: number;
  currentHoldingQty: number;
  openOrders: OpenOrderForRisk[];
  excludeOrderId?: string;
  optionsContracts?: OptionContractMultiplierLookup;
  currencyContext?: CurrencyReservationContext;
  stockTakerFeeRate?: number;
  marginDebtKrw?: number;
}

export interface OrderCapacityResult {
  valid: boolean;
  availableBalance: number;
  required: number;
  reserved: number;
  message?: string;
}

/**
 * 신규 주문 제출 가능 여부 검증 (이중 주문 및 자산 초과 원천 차단)
 */
export function validateOrderCapacity(
  params: ValidateOrderCapacityParams
): OrderCapacityResult {
  const {
    side,
    incomingPrice,
    incomingSize,
    currentCash,
    currentHoldingQty,
    openOrders,
    stockId,
    excludeOrderId,
    optionsContracts,
    currencyContext,
    stockTakerFeeRate = STOCK_TAKER_FEE_RATE,
    marginDebtKrw = 0,
  } = params;

  if (incomingPrice <= 0 || incomingSize <= 0) {
    return {
      valid: false,
      availableBalance: 0,
      required: 0,
      reserved: 0,
      message: '주문 가격 및 수량은 0보다 커야 합니다.',
    };
  }

  if (side === 'buy') {
    const reservedCash = calculateReservedCash(openOrders, excludeOrderId, optionsContracts, currencyContext, stockTakerFeeRate);
    const marginDebt = Math.max(0, Number(marginDebtKrw ?? 0));
    const availableCash = marginDebt > 0 ? 0 : Math.max(0, currentCash - reservedCash);
    const requiredCash = calculateSingleBuyOrderReservedCash(
      {
        stock_id: stockId,
        side: 'buy',
        price: incomingPrice,
        size: incomingSize,
        filled: 0,
        status: 'open',
      },
      optionsContracts,
      currencyContext,
      stockTakerFeeRate
    );
    if (marginDebt > 0) {
      return {
        valid: false,
        availableBalance: 0,
        required: requiredCash,
        reserved: reservedCash,
        message: `미수금(마진 부채 ₩${Math.round(marginDebt).toLocaleString()}) 상환 전에는 신규 매수 주문을 제출할 수 없습니다.`,
      };
    }

    if (availableCash < requiredCash) {
      return {
        valid: false,
        availableBalance: availableCash,
        required: requiredCash,
        reserved: reservedCash,
        message: `주문 가능 예수금이 부족합니다. (필요: ₩${requiredCash.toLocaleString()}, 가능: ₩${availableCash.toLocaleString()}, 예약금: ₩${reservedCash.toLocaleString()})`,
      };
    }

    return {
      valid: true,
      availableBalance: availableCash,
      required: requiredCash,
      reserved: reservedCash,
    };
  } else {
    const reservedQty = calculateReservedQty(openOrders, stockId, excludeOrderId);
    const availableQty = Math.max(0, currentHoldingQty - reservedQty);

    if (availableQty < incomingSize) {
      return {
        valid: false,
        availableBalance: availableQty,
        required: incomingSize,
        reserved: reservedQty,
        message: `주문 가능 주식 수량이 부족합니다. (필요: ${incomingSize.toLocaleString()}주, 가능: ${availableQty.toLocaleString()}주, 예약수량: ${reservedQty.toLocaleString()}주)`,
      };
    }

    return {
      valid: true,
      availableBalance: availableQty,
      required: incomingSize,
      reserved: reservedQty,
    };
  }
}

/**
 * 주문 취소 등으로 예약금이 해제된 직후, 미수 부채(margin_debt_krw)가 남아있다면
 * 미예약 가용 현금(cash - reservedCash)으로 부채를 우선 상환(스윕)한다.
 */
export function sweepUnencumberedCashToMarginDebt(
  db: MemoryDatabase,
  profile: ProfileRecord
): number {
  const currentDebt = Math.max(0, Math.round(Number(profile.margin_debt_krw ?? 0) * 100) / 100);
  if (currentDebt <= 0) return 0;
  const reservedCash = calculateUserReservedCashKrw(db, profile.id);
  const unencumbered = Math.max(0, Math.round((Number(profile.cash ?? 0) - reservedCash) * 100) / 100);
  const repay = Math.min(currentDebt, unencumbered);
  if (repay <= 0) return 0;

  profile.cash = Math.round((profile.cash - repay) * 100) / 100;
  const nextDebt = Math.round((currentDebt - repay) * 100) / 100;
  if (nextDebt > 0) {
    profile.margin_debt_krw = nextDebt;
  } else {
    delete profile.margin_debt_krw;
  }
  return repay;
}
