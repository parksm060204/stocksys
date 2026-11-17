/**
 * MUMYEONG: Order Risk & Balance Reservation System
 * 미체결(open, partial) 주문에 대한 예수금 및 보유 주식 예약(Reservation) 동적 계산
 */
import type { MemoryDatabase } from '../memoryDb/memoryStore';

export const OPTION_RESERVATION_FEE_RATE = 0.001;

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

/**
 * 단일 매수 주문의 잔여 예약 예수금(옵션인 경우 계약별 승수 및 0.1% 수수료 포함) 계산
 */
export function calculateSingleBuyOrderReservedCash(
  order: OpenOrderForRisk,
  optionsContracts?: OptionContractMultiplierLookup
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

  return remainingQty * Number(order.price);
}

/**
 * 유저의 미체결 매수 주문으로 인해 예약된 총 예수금 계산
 * (이미 현금에서 차감된 원자재 증거금은 이중 차감하지 않는다.)
 * @param orders 유저의 open/partial 주문 목록
 * @param excludeOrderId 수정/취소 대상인 경우 제외할 주문 ID
 * @param optionsContracts 옵션 계약 승수 조회 맵 (지정 시 옵션 계약별 승수·수수료 반영)
 */
export function calculateReservedCash(
  orders: OpenOrderForRisk[],
  excludeOrderId?: string,
  optionsContracts?: OptionContractMultiplierLookup
): number {
  let reserved = 0;
  for (const o of orders) {
    if (excludeOrderId && o.id === excludeOrderId) continue;
    reserved += calculateSingleBuyOrderReservedCash(o, optionsContracts);
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
  return calculateReservedCash(openOrders, excludeOrderId, db.optionsContracts);
}

/**
 * 계좌의 현재 가용 KRW 현금(profile.cash - 미체결 주식/옵션 매수 예약금) 계산.
 */
export function getAvailableCashKrw(
  db: MemoryDatabase,
  userId: string,
  excludeOrderId?: string
): { cash: number; reservedCash: number; availableCash: number } {
  const profile = db.profiles.get(userId);
  const cash = Number(profile?.cash ?? 0);
  const reservedCash = calculateUserReservedCashKrw(db, userId, excludeOrderId);
  return {
    cash,
    reservedCash,
    availableCash: Number.isFinite(cash) ? Math.max(0, cash - reservedCash) : 0,
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
    const reservedCash = calculateReservedCash(openOrders, excludeOrderId, optionsContracts);
    const availableCash = Math.max(0, currentCash - reservedCash);
    const requiredCash = incomingPrice * incomingSize;

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
