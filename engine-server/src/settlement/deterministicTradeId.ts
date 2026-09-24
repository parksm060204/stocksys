/**
 * Deterministic Trade ID Builder
 *
 * 정책:
 *  - 간단한 timestamp나 UUID v4를 사용하지 않는다.
 *  - 동일 체결(같은 run/tick/stock/주문 쌍/partial index/가격/수량)은 항상 동일 ID를 생성한다.
 *  - 동일 주문 쌍의 partial fill은 partialFillSequence로 구분된다.
 *  - repository 재생성·엔진 재시작을 모사해도 같은 체결 ID가 재사용되므로
 *    authoritative settlement ledger가 중복 정산을 차단할 수 있다.
 */

export interface DeterministicTradeIdParams {
  /** 시뮬레이션 run 식별자 (결정론적) */
  readonly runId: string;
  /** tick 순번 */
  readonly tickSequence: number;
  readonly stockId: string;
  readonly buyOrderId: string;
  readonly sellOrderId: string;
  /** 동일 주문 쌍의 부분 체결 구분자 */
  readonly partialFillSequence: number;
  readonly price: number;
  readonly size: number;
}

function assertFinitePositiveInt(value: number, field: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new RangeError(`[DeterministicTradeId] ${field} must be a non-negative integer: ${value}`);
  }
}

function assertFinitePositive(value: number, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`[DeterministicTradeId] ${field} must be a finite number > 0: ${value}`);
  }
}

/**
 * 결정론적 trade ID를 생성한다.
 * 형식: trade_{runId}_t{tick}_s{stockId}_{buy}~{sell}_f{partialFill}
 * 가격/수량은 ID에 포함하지 않아 문자열이 과도하게 길어지지 않으며,
 * 동일 주문 쌍/틱/부분체결 인덱스는 이미 유일하므로 ID 충돌이 없다.
 */
export function buildDeterministicTradeId(params: DeterministicTradeIdParams): string {
  if (!params.runId) {
    throw new RangeError('[DeterministicTradeId] runId must be a non-empty string');
  }
  if (!params.stockId) {
    throw new RangeError('[DeterministicTradeId] stockId must be a non-empty string');
  }
  if (!params.buyOrderId) {
    throw new RangeError('[DeterministicTradeId] buyOrderId must be a non-empty string');
  }
  if (!params.sellOrderId) {
    throw new RangeError('[DeterministicTradeId] sellOrderId must be a non-empty string');
  }
  assertFinitePositiveInt(params.tickSequence, 'tickSequence');
  assertFinitePositiveInt(params.partialFillSequence, 'partialFillSequence');
  assertFinitePositive(params.price, 'price');
  assertFinitePositive(params.size, 'size');

  // 주문 ID/종목 ID에 구분자 문자가 섞여도 ID가 모호해지지 않도록 인코딩한다.
  const safeStock = encodeURIComponent(params.stockId);
  const safeBuy = encodeURIComponent(params.buyOrderId);
  const safeSell = encodeURIComponent(params.sellOrderId);

  return `trade_${encodeURIComponent(params.runId)}_t${params.tickSequence}_s${safeStock}_${safeBuy}~${safeSell}_f${params.partialFillSequence}`;
}
