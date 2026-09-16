/**
 * Orderbook Level Filtering & Aggregation Selectors
 *
 * STOCKSYS 호가창 UI의 데이터 무결성을 보장하기 위한 순수 선택자(Selector) 유틸리티입니다.
 * - 실제 미체결 잔량이 존재하는 호가만 남기고, 0 및 비정상 수치(음수, -0, NaN, null, undefined)를 엄격히 필터링합니다.
 * - 빈 가격 간격을 유지하기 위한 가상 행이나 0 수량 행 생성을 완전히 차단합니다.
 */

export interface RawOrderLike {
  id?: string;
  side?: string;
  price?: number | string | null;
  size?: number | string | null;
  filled?: number | string | null;
  status?: string | null;
}

export interface OrderbookLevel {
  price: number;
  totalSize: number;
  isSynthetic?: boolean;
  actualDbSize?: number;
}

/**
 * 주어진 호가 레벨 목록에서 유효한 수량(> 0)을 가진 호가만 정제 및 정렬하여 반환합니다.
 *
 * 유효성 기준:
 * - Number.isFinite(price) && price > 0
 * - Number.isFinite(quantity) && quantity > 0
 * - 0, -0, 음수, null, undefined, NaN 은 모두 제외
 * - 동일 가격 호가가 여러 개일 경우 양수 잔량을 합산
 * - 최종 집계 결과가 0이면 해당 가격 레벨 완전 제거
 *
 * 정렬 기준:
 * - ask: 가격 오름차순 (낮은 가격 = 최우선 매도호가가 앞쪽)
 * - bid: 가격 내림차순 (높은 가격 = 최우선 매수호가가 앞쪽)
 */
export function filterValidOrderbookLevels(
  levels: OrderbookLevel[] | null | undefined,
  side: 'ask' | 'bid',
): OrderbookLevel[] {
  if (!levels || !Array.isArray(levels) || levels.length === 0) {
    return [];
  }

  const priceMap = new Map<number, number>();

  for (const level of levels) {
    if (!level) continue;
    const price = Number(level.price);
    const quantity = Number(level.totalSize);

    // 유효성 검사: 유한수이며 0보다 커야 함 (-0, 0, 음수, NaN 제외)
    if (
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      Object.is(quantity, -0)
    ) {
      continue;
    }

    const current = priceMap.get(price) ?? 0;
    priceMap.set(price, current + quantity);
  }

  const result: OrderbookLevel[] = [];
  for (const [price, totalSize] of priceMap.entries()) {
    if (Number.isFinite(totalSize) && totalSize > 0) {
      result.push({
        price,
        totalSize: Math.round(totalSize),
      });
    }
  }

  if (side === 'ask') {
    // 매도호가: 오름차순 (최우선 매도호가가 0번째)
    result.sort((a, b) => a.price - b.price);
  } else {
    // 매수호가: 내림차순 (최우선 매수호가가 0번째)
    result.sort((a, b) => b.price - a.price);
  }

  return result;
}

/**
 * 원시 주문 목록(Raw Orders)에서 특정 side의 미체결 잔량을 가격별로 합산하여 유효한 호가 레벨 배열을 생성합니다.
 *
 * - status: 'open', 'partial'만 포함 (취소/전량체결 상태 제외)
 * - remaining = max(0, size - filled)
 */
export function aggregateRawOrders(
  orders: RawOrderLike[] | null | undefined,
  targetSide: 'buy' | 'sell',
  alignPriceFn?: (price: number) => number,
): OrderbookLevel[] {
  if (!orders || !Array.isArray(orders) || orders.length === 0) {
    return [];
  }

  const sideNorm = targetSide.toLowerCase();
  const priceMap = new Map<number, number>();

  for (const o of orders) {
    if (!o) continue;

    // Side 일치 확인
    const orderSide = (o.side || '').toLowerCase();
    if (orderSide !== sideNorm) continue;

    // 상태 확인 (취소 또는 전량 체결 주문 제외)
    if (o.status && !['open', 'partial'].includes(o.status.toLowerCase())) {
      continue;
    }

    const rawPrice = Number(o.price);
    if (!Number.isFinite(rawPrice) || rawPrice <= 0) continue;

    const size = Number(o.size);
    const filled = Number(o.filled || 0);
    if (!Number.isFinite(size) || !Number.isFinite(filled)) continue;

    const remaining = Math.max(0, size - filled);
    if (!Number.isFinite(remaining) || remaining <= 0 || Object.is(remaining, -0)) {
      continue;
    }

    const price = alignPriceFn ? alignPriceFn(rawPrice) : rawPrice;
    if (!Number.isFinite(price) || price <= 0) continue;

    priceMap.set(price, (priceMap.get(price) ?? 0) + remaining);
  }

  const levels: OrderbookLevel[] = Array.from(priceMap.entries()).map(
    ([price, totalSize]) => ({ price, totalSize }),
  );

  return filterValidOrderbookLevels(levels, targetSide === 'sell' ? 'ask' : 'bid');
}

/**
 * 최종 표시용 호가 배열에 존재하는 실제 호가들만을 기준으로 잔량 막대 최대값을 계산합니다.
 *
 * - 유효한 호가가 없어도 NaN, Infinity, 0 나누기가 발생하지 않도록 최소 1을 반환합니다.
 * - 제거된 0 수량 행은 계산에 포함되지 않습니다.
 */
export function calculateMaxVisibleQuantity(
  visibleAsks: Array<{ totalSize: number }> | null | undefined,
  visibleBids: Array<{ totalSize: number }> | null | undefined,
): number {
  const askSizes = (visibleAsks || [])
    .map((l) => Number(l.totalSize))
    .filter((s) => Number.isFinite(s) && s > 0);

  const bidSizes = (visibleBids || [])
    .map((l) => Number(l.totalSize))
    .filter((s) => Number.isFinite(s) && s > 0);

  const allSizes = [...askSizes, ...bidSizes];
  if (allSizes.length === 0) {
    return 1;
  }

  const maxVal = Math.max(...allSizes);
  return Number.isFinite(maxVal) && maxVal > 0 ? maxVal : 1;
}
