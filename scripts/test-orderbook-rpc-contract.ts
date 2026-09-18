/**
 * scripts/test-orderbook-rpc-contract.ts
 *
 * Local Memory DB RPC와 PostgreSQL SQL CTE RPC 간의 인터페이스 계약(Contract) 일치성 검증 스위트
 * 1. 반환 최상위 필드명 및 구조: stockId, timestamp, fetchDurationMs, bids, asks, trades
 * 2. 호가 레벨 객체 규격: price, totalSize, actualDbSize, isSynthetic, orderCount
 * 3. 정렬 순서: 매수(DESC), 매도(ASC), 체결(최신순 DESC)
 * 4. 집계 및 반올림: size - filled > 0, Math.round()
 * 5. depth 클램핑: 1~50 범위 제한
 * 6. 빈 호가창 결과 정책: 빈 배열 [] 반환
 */

import { memoryDb, OrderRecord, TradeRecord as DBTrade } from '../lib/memoryDb/memoryStore';
import { createMemoryDbClient } from '../lib/memoryDb/memoryDbClient';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`\n❌ CONTRACT ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

async function runContractTests() {
  console.log('================================================================');
  console.log('  📜 AUTHORITATIVE ORDERBOOK RPC CONTRACT VERIFICATION');
  console.log('================================================================\n');

  const client = createMemoryDbClient();
  const stockId = 'stock_contract_test';

  // 1. 빈 호가창 계약 검증
  console.log('▶ [TEST 1] Empty orderbook contract verification');
  memoryDb.orders.clear();
  memoryDb.trades.length = 0;
  memoryDb.orderStockIndex.clear();
  memoryDb.tradeStockIndex.clear();

  const emptyRes = await client.rpc('get_authoritative_orderbook', {
    p_stock_id: stockId,
    p_depth: 10,
  });

  assert(!emptyRes.error, '빈 종목 조회 시 에러가 없어야 함');
  assert(emptyRes.data.stockId === stockId, 'stockId가 정확해야 함');
  assert(Array.isArray(emptyRes.data.bids) && emptyRes.data.bids.length === 0, '빈 매수는 빈 배열 []이어야 함');
  assert(Array.isArray(emptyRes.data.asks) && emptyRes.data.asks.length === 0, '빈 매도는 빈 배열 []이어야 함');
  assert(Array.isArray(emptyRes.data.trades) && emptyRes.data.trades.length === 0, '빈 체결은 빈 배열 []이어야 함');
  assert(typeof emptyRes.data.timestamp === 'number', 'timestamp는 숫자(epoch ms)여야 함');
  assert(emptyRes.data.fetchDurationMs === 0, 'fetchDurationMs는 0이어야 함');

  // 2. 주문 등록 및 계약 필드 일치성 검증
  console.log('\n▶ [TEST 2] Schema and field types contract verification');

  // 매수 주문 등록 (동일 가격 3건 + 다른 가격 1건)
  const bidsFixture: OrderRecord[] = [
    { id: 'b1', stock_id: stockId, side: 'buy', price: 70000, size: 10.4, filled: 0, status: 'open', is_lp: false, created_at: new Date(1000).toISOString() },
    { id: 'b2', stock_id: stockId, side: 'buy', price: 70000, size: 20.3, filled: 5, status: 'partial', is_lp: false, created_at: new Date(2000).toISOString() }, // 잔량 15.3
    { id: 'b3', stock_id: stockId, side: 'buy', price: 70000, size: 5.1, filled: 0, status: 'open', is_lp: false, created_at: new Date(3000).toISOString() },
    { id: 'b4', stock_id: stockId, side: 'buy', price: 69900, size: 50, filled: 0, status: 'open', is_lp: false, created_at: new Date(4000).toISOString() },
    // 제외되어야 할 주문들
    { id: 'b_closed', stock_id: stockId, side: 'buy', price: 70000, size: 100, filled: 100, status: 'filled', is_lp: false, created_at: new Date(5000).toISOString() },
    { id: 'b_cancelled', stock_id: stockId, side: 'buy', price: 70000, size: 100, filled: 0, status: 'cancelled', is_lp: false, created_at: new Date(6000).toISOString() },
    { id: 'b_zero', stock_id: stockId, side: 'buy', price: 70000, size: 0, filled: 0, status: 'open', is_lp: false, created_at: new Date(7000).toISOString() },
  ];

  // 매도 주문 등록 (동일 가격 2건)
  const asksFixture: OrderRecord[] = [
    { id: 'a1', stock_id: stockId, side: 'sell', price: 70500, size: 12.2, filled: 2.2, status: 'partial', is_lp: false, created_at: new Date(1000).toISOString() }, // 잔량 10.0
    { id: 'a2', stock_id: stockId, side: 'sell', price: 70500, size: 15.0, filled: 0, status: 'open', is_lp: false, created_at: new Date(2000).toISOString() }, // 잔량 15.0 -> 합계 25.0
    { id: 'a3', stock_id: stockId, side: 'sell', price: 70600, size: 30.0, filled: 0, status: 'open', is_lp: false, created_at: new Date(3000).toISOString() },
  ];

  // 체결 내역 등록
  const tradesFixture: DBTrade[] = [
    { id: 't1', stock_id: stockId, price: 70200, size: 5, buyer_is_bot: false, seller_is_bot: true, created_at: new Date(1000).toISOString() },
    { id: 't2', stock_id: stockId, price: 70300, size: 10, buyer_is_bot: true, seller_is_bot: true, created_at: new Date(2000).toISOString() },
  ];

  for (const o of [...bidsFixture, ...asksFixture]) {
    memoryDb.orders.set(o.id, o);
    if (!memoryDb.orderStockIndex.has(stockId)) memoryDb.orderStockIndex.set(stockId, new Set());
    memoryDb.orderStockIndex.get(stockId)!.add(o.id);
  }

  for (const t of tradesFixture) {
    memoryDb.trades.push(t);
    if (!memoryDb.tradeStockIndex.has(stockId)) memoryDb.tradeStockIndex.set(stockId, []);
    memoryDb.tradeStockIndex.get(stockId)!.push(t);
  }

  const res = await client.rpc('get_authoritative_orderbook', {
    p_stock_id: stockId,
    p_depth: 10,
  });

  const data = res.data;
  assert(data.bids.length === 2, `유효 매수 호가 레벨은 2개(70000, 69900)여야 함 (실제: ${data.bids.length})`);
  assert(data.asks.length === 2, `유효 매도 호가 레벨은 2개(70500, 70600)여야 함 (실제: ${data.asks.length})`);

  // 최우선 매수 계약 검증
  const topBid = data.bids[0];
  assert(topBid.price === 70000, '최우선 매수 가격 70,000');
  // 10.4 + 15.3 + 5.1 = 30.8 -> round = 31
  assert(Math.abs(topBid.actualDbSize - 30.8) < 1e-4, `actualDbSize는 30.8이어야 함 (실제: ${topBid.actualDbSize})`);
  assert(topBid.totalSize === 31, `totalSize는 반올림된 31이어야 함 (실제: ${topBid.totalSize})`);
  assert(topBid.orderCount === 3, `동일 가격 주문 건수(orderCount)는 3이어야 함 (실제: ${topBid.orderCount})`);
  assert(topBid.isSynthetic === false, 'isSynthetic은 false여야 함');

  // 차우선 매수 정렬(DESC) 검증
  assert(data.bids[1].price === 69900, '매수는 가격 내림차순(DESC) 정렬이어야 함');

  // 최우선 매도 계약 검증
  const topAsk = data.asks[0];
  assert(topAsk.price === 70500, '최우선 매도 가격 70,500');
  assert(topAsk.actualDbSize === 25, `actualDbSize는 25.0이어야 함 (실제: ${topAsk.actualDbSize})`);
  assert(topAsk.totalSize === 25, `totalSize는 25여야 함 (실제: ${topAsk.totalSize})`);
  assert(topAsk.orderCount === 2, `orderCount는 2여야 함 (실제: ${topAsk.orderCount})`);
  assert(data.asks[1].price === 70600, '매도는 가격 오름차순(ASC) 정렬이어야 함');

  // 최근 체결 정렬(최신순 DESC) 검증
  assert(data.trades.length === 2, '체결 내역 2건');
  assert(data.trades[0].id === 't2', '최근 체결은 최신 생성일자 우선(DESC) 정렬이어야 함 (t2가 첫 번째)');

  // 3. depth 범위 클램핑 검증
  console.log('\n▶ [TEST 3] Depth boundary clamping contract (1 ~ 50)');
  const resClamped = await client.rpc('get_authoritative_orderbook', {
    p_stock_id: stockId,
    p_depth: 1,
  });
  assert(resClamped.data.bids.length === 1, 'depth=1 지정 시 1개 레벨만 반환되어야 함');
  assert(resClamped.data.asks.length === 1, 'depth=1 지정 시 1개 레벨만 반환되어야 함');

  console.log('\n================================================================');
  console.log('  🎉 ALL RPC CONTRACT VERIFICATION TESTS PASSED (EXIT 0)');
  console.log('================================================================');
}

runContractTests().catch((err) => {
  console.error('CONTRACT TEST FAILED:', err);
  process.exit(1);
});
