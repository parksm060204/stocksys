import { memoryDb, StockRecord, OrderRecord } from '../lib/memoryDb/memoryStore';
import { LocalMarketService, acquireStockLock } from '../lib/engine/marketService';
import { ensureLocalStandaloneEngine, stopLocalStandaloneEngine, getLocalStandaloneEngine } from '../lib/engine/localStandaloneServer';
import { POST as ordersPostHandler, DELETE as ordersDeleteHandler } from '../app/api/orders/route';
import { POST as localDbPostHandler } from '../app/api/local-db/route';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`❌ FAIL: ${msg}`);
  }
  console.log(`  ✅ PASS: ${msg}`);
}

async function runConcurrencyAndStaleRefTests() {
  console.log('================================================================');
  console.log('🔒 STOCKSYS CONCURRENCY & STALE REFERENCE REGRESSION TESTS');
  console.log('================================================================\n');

  ensureLocalStandaloneEngine();
  const engine = getLocalStandaloneEngine()!;

  try {
    // ----------------------------------------------------------------
    // [CONCURRENCY TEST 1]
    // 거래가 종목 락을 보유한 상태에서 취소 요청을 대기시키고,
    // 거래 롤백으로 주문 객체를 교체한 뒤 취소가 현재(최신) 주문에 정확히 적용되는지 검증
    // ----------------------------------------------------------------
    console.log('[CONCURRENCY TEST 1] Order cancel awaits lock, order object replaced by rollback, cancel applies to latest object');
    const stockId1 = '00000000-0000-4000-8000-000000003001';
    memoryDb.stocks.set(stockId1, {
      id: stockId1, ticker: 'CONC01', name: 'Concurrency Stock 1', market: 'KRX',
      current_price: 50_000, previous_close: 50_000, open_price: 50_000,
      high: 50_000, low: 50_000, volume: 0, change_rate: 0, market_cap: 1_000_000_000, pe_ratio: 10, dividend_yield: 0, sector: 'IT',
    });

    const user1 = 'user_conc_1';
    memoryDb.profiles.set(user1, {
      id: user1, user_id: user1, username: user1, nickname: user1,
      cash: 1_000_000, net_worth: 1_000_000, rank_tier: 'Bronze', created_at: new Date().toISOString(),
    });

    // 1. 주문 생성
    const order1Id = 'ord_conc_test_1';
    const originalOrder1: OrderRecord = {
      id: order1Id,
      stock_id: stockId1,
      user_id: user1,
      side: 'buy',
      price: 50_000,
      size: 10,
      filled: 0,
      status: 'open',
      is_lp: false,
      created_at: new Date(Date.now() - 10_000).toISOString(),
    };
    memoryDb.orders.set(order1Id, originalOrder1);
    memoryDb.addOrderToIndex(originalOrder1);

    // 2. 인위적으로 종목 락을 획득하여 취소 요청을 대기 상태로 만듦
    const lock1 = acquireStockLock(stockId1);
    await lock1.wait;

    // 3. 취소 요청 발송 (락을 기다리며 대기 중인 비동기 Promise)
    let cancelPromiseResolved = false;
    const cancelPromise = LocalMarketService.cancelOrder({ orderId: order1Id, userId: user1 }).then((res) => {
      cancelPromiseResolved = true;
      return res;
    });

    // 짧은 microtask 대기 후 취소 요청이 아직 락을 얻지 못하고 대기 중인지 확인
    await new Promise((r) => setImmediate(r));
    assert(cancelPromiseResolved === false, 'Cancel request must be waiting for stock lock');

    // 4. 락을 쥐고 있는 동안 주문 객체가 롤백/교체됨을 모사:
    // 메모리 DB 상의 주문 객체를 새로운 참조(스냅샷 복원 객체)로 교체
    const replacedOrder1: OrderRecord = {
      ...originalOrder1,
      price: 50_000,
      size: 10,
      filled: 2, // 롤백으로 부분체결 상태가 복원된 객체라 가정
      status: 'partial',
    };
    memoryDb.orders.set(order1Id, replacedOrder1);

    // 5. 이제 락 해제 -> 대기 중이던 cancelOrder가 락을 획득
    lock1.release();

    const cancelRes = await cancelPromise;
    assert(cancelRes.success === true, 'Cancel request must succeed');
    assert(cancelRes.statusCode === 200, 'Status code must be 200');

    // 검증: 취소는 교체된 최신 객체(replacedOrder1)에 적용되어야 하며, 오래된 originalOrder1이 장부를 덮어써서는 안 됨
    const currentOrderInDb = memoryDb.orders.get(order1Id);
    assert(currentOrderInDb !== undefined, 'Order must exist in DB');
    assert(currentOrderInDb?.status === 'cancelled', 'Order status must be cancelled');
    assert(currentOrderInDb?.filled === 2, `Order filled quantity must preserve current object value 2 (actual: ${currentOrderInDb?.filled})`);
    assert(originalOrder1.status === 'open', 'Old object reference must NOT have been mutated or resurrected to open');

    // ----------------------------------------------------------------
    // [CONCURRENCY TEST 2]
    // 취소 대기 중 주문이 삭제되거나 시장이 리셋된 경우 오래된 주문이 되살아나지 않는지 검증
    // ----------------------------------------------------------------
    console.log('\n[CONCURRENCY TEST 2] Order deleted or market reset while cancel awaits lock -> must not resurrect');
    const order2Id = 'ord_conc_test_2';
    const originalOrder2: OrderRecord = {
      id: order2Id,
      stock_id: stockId1,
      user_id: user1,
      side: 'buy',
      price: 49_000,
      size: 5,
      filled: 0,
      status: 'open',
      is_lp: false,
      created_at: new Date().toISOString(),
    };
    memoryDb.orders.set(order2Id, originalOrder2);
    memoryDb.addOrderToIndex(originalOrder2);

    // 락 획득
    const lock2 = acquireStockLock(stockId1);
    await lock2.wait;

    // 취소 요청 대기
    const cancelPromise2 = LocalMarketService.cancelOrder({ orderId: order2Id, userId: user1 });

    // 락 보유 중 주문 삭제 (시장 리셋 모사)
    memoryDb.orders.delete(order2Id);
    memoryDb.removeOrderFromIndex(originalOrder2);

    // 락 해제
    lock2.release();

    const cancelRes2 = await cancelPromise2;
    assert(cancelRes2.success === false, 'Cancel request must fail when order was deleted during wait');
    assert(cancelRes2.statusCode === 404, `Status code must be 404 (actual: ${cancelRes2.statusCode})`);
    assert(memoryDb.orders.get(order2Id) === undefined, 'Deleted order must NOT be resurrected into memoryDb');

    // ----------------------------------------------------------------
    // [CONCURRENCY TEST 3]
    // 자동 매칭 또는 LP 갱신 대기 중 종목 객체가 교체된 경우 현재 종목에만 결과가 반영되는지 검증
    // ----------------------------------------------------------------
    console.log('\n[CONCURRENCY TEST 3] Stock object replaced while LP refresh/matching awaits lock -> applies only to current stock');
    const stockId3 = '00000000-0000-4000-8000-000000003003';
    const oldStockObj: StockRecord = {
      id: stockId3, ticker: 'STALE03', name: 'Old Stock Object', market: 'KRX',
      current_price: 100_000, previous_close: 100_000, open_price: 100_000,
      high: 100_000, low: 100_000, volume: 0, change_rate: 0, market_cap: 1_000_000_000, pe_ratio: 10, dividend_yield: 0, sector: 'IT',
    };
    memoryDb.stocks.set(stockId3, oldStockObj);

    // 락 획득
    const lock3 = acquireStockLock(stockId3);
    await lock3.wait;

    // LP 갱신 실행 (stockId3에 대해 락 대기 상태 진입)
    const lpRefreshPromise = engine.refreshLpOrders();

    // 락 보유 중에 종목 객체가 새로 교체됨 (시장 리셋이나 롤백 스냅샷 복원)
    const newStockObj: StockRecord = {
      id: stockId3, ticker: 'STALE03', name: 'New Replaced Stock Object', market: 'KRX',
      current_price: 120_000, previous_close: 100_000, open_price: 100_000,
      high: 120_000, low: 100_000, volume: 50, change_rate: 20, market_cap: 1_200_000_000, pe_ratio: 12, dividend_yield: 0, sector: 'IT',
    };
    memoryDb.stocks.set(stockId3, newStockObj);

    // 락 해제
    lock3.release();
    await lpRefreshPromise;

    // LP 호가 가격은 교체된 newStockObj의 current_price (120,000)를 기준으로 생성되어야 함
    const lpBid1 = memoryDb.orders.get(`lp_${stockId3}_bid_1`);
    assert(lpBid1 !== undefined, 'LP bid 1 order must exist');
    assert(lpBid1!.price < 120_000 && lpBid1!.price > 100_000, `LP bid price (${lpBid1?.price}) must be based on new price 120,000, not old 100,000`);

    // ----------------------------------------------------------------
    // [CONCURRENCY TEST 4]
    // 정상 체결된 주문이 취소 요청으로 다시 미체결 상태가 되거나 중복 체결되지 않는지 검증
    // ----------------------------------------------------------------
    console.log('\n[CONCURRENCY TEST 4] Order fully filled while cancel awaits lock -> cancel rejected, order remains filled');
    const order4Id = 'ord_conc_test_4';
    const order4: OrderRecord = {
      id: order4Id,
      stock_id: stockId1,
      user_id: user1,
      side: 'buy',
      price: 50_000,
      size: 5,
      filled: 0,
      status: 'open',
      is_lp: false,
      created_at: new Date().toISOString(),
    };
    memoryDb.orders.set(order4Id, order4);
    memoryDb.addOrderToIndex(order4);

    // 락 획득
    const lock4 = acquireStockLock(stockId1);
    await lock4.wait;

    // 취소 요청 대기
    const cancelPromise4 = LocalMarketService.cancelOrder({ orderId: order4Id, userId: user1 });

    // 락 보유 중 해당 주문이 완전 체결('filled')로 변경됨
    order4.filled = 5;
    order4.status = 'filled';

    // 락 해제
    lock4.release();

    const cancelRes4 = await cancelPromise4;
    assert(cancelRes4.success === false, 'Cancel request must be rejected for filled order');
    assert(cancelRes4.statusCode === 400, `Status code must be 400 (actual: ${cancelRes4.statusCode})`);
    assert(memoryDb.orders.get(order4Id)?.status === 'filled', 'Order must remain filled and NOT be reverted to cancelled');
    assert(memoryDb.orders.get(order4Id)?.filled === 5, 'Order filled quantity must remain 5');

    // ----------------------------------------------------------------
    // [CONCURRENCY TEST 5]
    // 현금, 보유량, 주문 상태, 종목 통계와 보조 인덱스 일관성 종합 검증
    // ----------------------------------------------------------------
    console.log('\n[CONCURRENCY TEST 5] Asset, order, and index consistency verification');
    for (const [orderId, ord] of memoryDb.orders.entries()) {
      // orderStockIndex 일치 확인
      const stockOrders = memoryDb.orderStockIndex.get(ord.stock_id);
      assert(stockOrders !== undefined && stockOrders.has(orderId), `orderStockIndex must contain order ${orderId}`);

      // orderUserIndex 일치 확인 (user_id 존재하는 경우)
      if (ord.user_id) {
        const userOrders = memoryDb.orderUserIndex.get(ord.user_id);
        assert(userOrders !== undefined && userOrders.has(orderId), `orderUserIndex must contain order ${orderId} for user ${ord.user_id}`);
      }

      // filled <= size 불변식 확인
      assert((ord.filled || 0) <= ord.size, `Order ${orderId} filled (${ord.filled}) must not exceed size (${ord.size})`);
    }

    for (const [stockId, stk] of memoryDb.stocks.entries()) {
      assert(stk.current_price > 0, `Stock ${stockId} current_price must be > 0`);
      assert(Number(stk.high || 0) >= Number(stk.low || 0), `Stock ${stockId} high must be >= low`);
      assert(Number(stk.volume || 0) >= 0, `Stock ${stockId} volume must be >= 0`);
    }

    console.log('\n================================================================');
    console.log('🎉 ALL CONCURRENCY & STALE REF TESTS PASSED SUCCESSFULLY!');
    console.log('================================================================\n');
  } finally {
    stopLocalStandaloneEngine();
  }
}

runConcurrencyAndStaleRefTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Concurrency test failed:', err);
    stopLocalStandaloneEngine();
    process.exit(1);
  });
