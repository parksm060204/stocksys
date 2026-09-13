/**
 * MUMYEONG: Order Risk & Balance Reservation System
 * 미체결(open, partial) 주문에 대한 예수금 및 보유 주식 예약(Reservation) 동적 계산
 */

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

/**
 * 유저의 미체결 매수 주문으로 인해 예약된 총 예수금 계산
 * @param orders 유저의 open/partial 주문 목록
 * @param excludeOrderId 수정/취소 대상인 경우 제외할 주문 ID
 */
export function calculateReservedCash(
  orders: OpenOrderForRisk[],
  excludeOrderId?: string
): number {
  let reserved = 0;
  for (const o of orders) {
    if (excludeOrderId && o.id === excludeOrderId) continue;
    if (o.side === 'buy' && (o.status === 'open' || o.status === 'partial')) {
      const remainingQty = Math.max(0, Number(o.size) - Number(o.filled || 0));
      reserved += remainingQty * Number(o.price);
    }
  }
  return reserved;
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
    const reservedCash = calculateReservedCash(openOrders, excludeOrderId);
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
