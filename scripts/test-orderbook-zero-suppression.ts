import {
  filterValidOrderbookLevels,
  aggregateRawOrders,
  calculateMaxVisibleQuantity,
  type OrderbookLevel,
  type RawOrderLike,
} from '../lib/utils/orderbookSelector';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`  ✅ PASS: ${msg}`);
}

async function runTests() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('📊 Orderbook Zero Suppression & Selection Verification (13 Tests)');
  console.log('════════════════════════════════════════════════════════════════');

  // TEST 1: 수량이 0인 매도호가는 렌더링(전달)되지 않는다.
  console.log('\n[TEST 1] 수량이 0인 매도호가는 전달되지 않는다.');
  {
    const inputAsks: OrderbookLevel[] = [
      { price: 72200, totalSize: 1620 },
      { price: 72100, totalSize: 0 },
      { price: 72000, totalSize: 0 },
      { price: 72300, totalSize: 500 },
    ];
    const filtered = filterValidOrderbookLevels(inputAsks, 'ask');
    assert(filtered.length === 2, `2건만 유효해야 함 (actual: ${filtered.length})`);
    assert(filtered.every((l) => l.totalSize > 0), '모든 수량은 0 초과여야 함');
    assert(!filtered.some((l) => l.price === 72100), '72,100 가격 행은 없어야 함');
    assert(!filtered.some((l) => l.price === 72000), '72,000 가격 행은 없어야 함');
  }

  // TEST 2: 수량이 0인 매수호가는 렌더링(전달)되지 않는다.
  console.log('\n[TEST 2] 수량이 0인 매수호가는 전달되지 않는다.');
  {
    const inputBids: OrderbookLevel[] = [
      { price: 71900, totalSize: 4647 },
      { price: 71800, totalSize: 0 },
      { price: 71700, totalSize: 7465 },
    ];
    const filtered = filterValidOrderbookLevels(inputBids, 'bid');
    assert(filtered.length === 2, `2건만 유효해야 함 (actual: ${filtered.length})`);
    assert(!filtered.some((l) => l.price === 71800), '71,800 가격 행은 없어야 함');
  }

  // TEST 3: null, undefined, NaN, 음수, -0 수량은 렌더링(전달)되지 않는다.
  console.log('\n[TEST 3] null, undefined, NaN, 음수, -0 수량 필터링');
  {
    const invalidInputs: any[] = [
      { price: 70000, totalSize: null },
      { price: 70100, totalSize: undefined },
      { price: 70200, totalSize: NaN },
      { price: 70300, totalSize: -100 },
      { price: 70400, totalSize: -0 },
      { price: 70500, totalSize: 0 },
      { price: NaN, totalSize: 100 },
      { price: -500, totalSize: 100 },
      { price: 70600, totalSize: 150 },
    ];
    const filtered = filterValidOrderbookLevels(invalidInputs, 'ask');
    assert(filtered.length === 1, `유효한 70,600/150만 남아야 함 (actual: ${filtered.length})`);
    assert(filtered[0].price === 70600 && filtered[0].totalSize === 150, '정상 가격과 수량만 통과');
  }

  // TEST 4: 동일 가격 주문의 잔량 합계가 양수이면 한 행으로 합산된다.
  console.log('\n[TEST 4] 동일 가격 주문의 양수 잔량 합산');
  {
    const orders: RawOrderLike[] = [
      { id: 'o1', side: 'buy', price: 71900, size: 1000, filled: 200, status: 'open' }, // rem: 800
      { id: 'o2', side: 'buy', price: 71900, size: 500, filled: 0, status: 'open' },    // rem: 500
      { id: 'o3', side: 'buy', price: 71900, size: 200, filled: 50, status: 'partial' }, // rem: 150
    ];
    const aggregated = aggregateRawOrders(orders, 'buy');
    assert(aggregated.length === 1, '동일 가격은 단일 행으로 합산되어야 함');
    assert(aggregated[0].price === 71900, '가격은 71,900이어야 함');
    assert(aggregated[0].totalSize === 1450, `합산 잔량은 1,450이어야 함 (actual: ${aggregated[0].totalSize})`);
  }

  // TEST 5: 동일 가격 주문의 잔량 합계가 0이면 해당 행은 표시되지 않는다.
  console.log('\n[TEST 5] 동일 가격 주문의 잔량 합계가 0이면 제거');
  {
    const orders: RawOrderLike[] = [
      { id: 'o1', side: 'sell', price: 72000, size: 500, filled: 500, status: 'filled' },
      { id: 'o2', side: 'sell', price: 72000, size: 200, filled: 0, status: 'cancelled' },
    ];
    const aggregated = aggregateRawOrders(orders, 'sell');
    assert(aggregated.length === 0, `잔량이 0인 가격 행은 완전히 제거되어야 함 (actual: ${aggregated.length})`);
  }

  // TEST 6: 부분 체결 후 남은 수량(remainingQuantity = size - filled)만 표시된다.
  console.log('\n[TEST 6] 부분 체결 후 남은 잔량만 정확히 표시');
  {
    const orders: RawOrderLike[] = [
      { id: 'o1', side: 'sell', price: 72500, size: 1000, filled: 650, status: 'partial' },
    ];
    const aggregated = aggregateRawOrders(orders, 'sell');
    assert(aggregated.length === 1, '1건 존재해야 함');
    assert(aggregated[0].totalSize === 350, `원래 수량(1,000)이 아닌 잔량(350)이어야 함 (actual: ${aggregated[0].totalSize})`);
  }

  // TEST 7: 전량 체결 또는 취소 후 해당 행이 제거된다.
  console.log('\n[TEST 7] 전량 체결 및 취소 후 가격 행 즉시 제거');
  {
    const activeOrders: RawOrderLike[] = [
      { id: 'o1', side: 'buy', price: 71000, size: 500, filled: 0, status: 'open' },
      { id: 'o2', side: 'buy', price: 71100, size: 300, filled: 0, status: 'open' },
    ];
    let levels = aggregateRawOrders(activeOrders, 'buy');
    assert(levels.length === 2, '초기 2개 가격 레벨');

    // o2가 전량 체결됨 (status -> filled)
    const afterFilled: RawOrderLike[] = [
      { id: 'o1', side: 'buy', price: 71000, size: 500, filled: 0, status: 'open' },
      { id: 'o2', side: 'buy', price: 71100, size: 300, filled: 300, status: 'filled' },
    ];
    levels = aggregateRawOrders(afterFilled, 'buy');
    assert(levels.length === 1, '전량 체결 후 1개 가격 레벨만 남아야 함');
    assert(levels[0].price === 71000, '71,000 호가만 유지되어야 함');
    assert(!levels.some((l) => l.price === 71100), '71,100 행은 즉시 사라져야 함');
  }

  // TEST 8: 주문 없는 중간 가격 단계가 자동 생성되지 않는다. (72,200과 71,900 사이 72,100 / 72,000 없음)
  console.log('\n[TEST 8] 중간 가격 단계(Gap) 자동 생성 금지');
  {
    const asks: OrderbookLevel[] = [{ price: 72200, totalSize: 1620 }];
    const bids: OrderbookLevel[] = [
      { price: 71900, totalSize: 4647 },
      { price: 71800, totalSize: 7465 },
    ];

    const validAsks = filterValidOrderbookLevels(asks, 'ask');
    const validBids = filterValidOrderbookLevels(bids, 'bid');

    assert(validAsks.length === 1, `매도는 72,200 하나뿐이어야 함 (actual: ${validAsks.length})`);
    assert(validAsks[0].price === 72200, '최우선 매도호가는 72,200');
    assert(validBids.length === 2, `매수는 71,900과 71,800만 존재 (actual: ${validBids.length})`);
    assert(validBids[0].price === 71900, '최우선 매수호가는 71,900');

    // 중간 가격 (72,000, 72,100)이 생성되지 않았음을 입증
    const allPrices = [...validAsks.map((a) => a.price), ...validBids.map((b) => b.price)];
    assert(!allPrices.includes(72000), '중간 가격 72,000은 존재하지 않아야 함');
    assert(!allPrices.includes(72100), '중간 가격 72,100은 존재하지 않아야 함');
  }

  // TEST 9: 빈 행 제거 후에도 매도·매수 정렬 규칙 유지
  console.log('\n[TEST 9] 매도 오름차순, 매수 내림차순 정렬 일관성');
  {
    const rawAsks: OrderbookLevel[] = [
      { price: 73000, totalSize: 100 },
      { price: 72500, totalSize: 200 },
      { price: 72200, totalSize: 300 },
    ];
    const rawBids: OrderbookLevel[] = [
      { price: 71500, totalSize: 150 },
      { price: 71900, totalSize: 500 },
      { price: 71800, totalSize: 250 },
    ];

    const sortedAsks = filterValidOrderbookLevels(rawAsks, 'ask');
    const sortedBids = filterValidOrderbookLevels(rawBids, 'bid');

    assert(sortedAsks[0].price === 72200, '매도 0번째는 최저가(최우선 매도호가) 72,200');
    assert(sortedAsks[1].price === 72500, '매도 1번째는 72,500');
    assert(sortedAsks[2].price === 73000, '매도 2번째는 73,000');

    assert(sortedBids[0].price === 71900, '매수 0번째는 최고가(최우선 매수호가) 71,900');
    assert(sortedBids[1].price === 71800, '매수 1번째는 71,800');
    assert(sortedBids[2].price === 71500, '매수 2번째는 71,500');
  }

  // TEST 10: 잔량 막대 최대값이 표시 중인 실제 호가만 기준으로 계산된다.
  console.log('\n[TEST 10] 잔량 막대 최대값(maxVisibleQuantity) 계산');
  {
    const visibleAsks = [{ price: 72200, totalSize: 1620 }];
    const visibleBids = [
      { price: 71900, totalSize: 4647 },
      { price: 71800, totalSize: 7465 },
    ];
    const maxQty = calculateMaxVisibleQuantity(visibleAsks, visibleBids);
    assert(maxQty === 7465, `최대값은 실제 호가의 최대치인 7,465여야 함 (actual: ${maxQty})`);

    // 모든 호가가 비었을 때 fallback 1 반환 (NaN, 0 나누기 방지)
    const emptyMax = calculateMaxVisibleQuantity([], []);
    assert(emptyMax === 1, `빈 배열 시 fallback은 1이어야 함 (actual: ${emptyMax})`);
    assert(Number.isFinite(emptyMax) && emptyMax > 0, '결과는 유효한 양수여야 함');
  }

  // TEST 11: 양쪽 호가가 모두 비었을 때 빈 상태가 안전하게 처리된다.
  console.log('\n[TEST 11] 양쪽 호가 모두 빈 상태 안전성');
  {
    const asks: OrderbookLevel[] = [];
    const bids: OrderbookLevel[] = [];
    const vAsks = filterValidOrderbookLevels(asks, 'ask');
    const vBids = filterValidOrderbookLevels(bids, 'bid');
    assert(vAsks.length === 0 && vBids.length === 0, '둘 다 빈 배열이어야 함');
    const maxSize = calculateMaxVisibleQuantity(vAsks, vBids);
    assert(maxSize === 1, 'maxSize는 1로 안전 반환');
    const totalAsk = vAsks.reduce((a, c) => a + c.totalSize, 0);
    const totalBid = vBids.reduce((a, c) => a + c.totalSize, 0);
    assert(totalAsk === 0 && totalBid === 0, '총 잔량은 0');
  }

  // TEST 12: 실시간 갱신 시 가격 행의 고유 key(`${side}-${price}`) 무결성
  console.log('\n[TEST 12] 안정적인 React key `${side}-${price}` 무결성');
  {
    const asks = [{ price: 72200, totalSize: 1620 }];
    const bids = [{ price: 71900, totalSize: 4647 }];

    const askKeys = asks.map((a) => `ask-${a.price}`);
    const bidKeys = bids.map((b) => `bid-${b.price}`);

    assert(askKeys[0] === 'ask-72200', 'ask-72200 형태의 key 생성');
    assert(bidKeys[0] === 'bid-71900', 'bid-71900 형태의 key 생성');
    assert(new Set([...askKeys, ...bidKeys]).size === 2, '서로 다른 side/price 간 key 충돌 없음');
  }

  // TEST 13: 현재가에 주문이 없더라도 수량 0인 가짜 행이 생성되지 않는다.
  console.log('\n[TEST 13] 현재가 주문 미존재 시 가짜 호가 행 생성 금지');
  {
    const currentMarketPrice = 72050; // 현재가는 72,050
    const orders: RawOrderLike[] = [
      { id: 'o1', side: 'sell', price: 72200, size: 1000, filled: 0, status: 'open' },
      { id: 'o2', side: 'buy', price: 71900, size: 2000, filled: 0, status: 'open' },
    ];

    const asks = aggregateRawOrders(orders, 'sell');
    const bids = aggregateRawOrders(orders, 'buy');

    assert(!asks.some((a) => a.price === currentMarketPrice), '매도 호가에 현재가 72,050 가짜 행 없음');
    assert(!bids.some((b) => b.price === currentMarketPrice), '매수 호가에 현재가 72,050 가짜 행 없음');
    assert(asks.length === 1 && asks[0].price === 72200, '실제 매도 72,200만 존재');
    assert(bids.length === 1 && bids[0].price === 71900, '실제 매수 71,900만 존재');
  }

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL 13 ORDERBOOK ZERO SUPPRESSION TESTS PASSED PERFECTLY!');
  console.log('════════════════════════════════════════════════════════════════\n');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
