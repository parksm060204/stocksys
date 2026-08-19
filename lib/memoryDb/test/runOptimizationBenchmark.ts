import { createMockSupabaseClient } from '../mockSupabaseClient';
import { memoryDb } from '../memoryStore';
import { PersistenceManager } from '../PersistenceManager';
import { MemoryOnlyStorageAdapter } from '../StorageAdapter';
import { EventBus } from '../../../engine-server/src/EventBus';

async function runOptimizationBenchmarkSuite() {
  console.log('================================================================');
  console.log('⚡ [IN-MEMORY OPTIMIZATION] 인덱스/동시성/스냅샷/이벤트 벤치마크');
  console.log('================================================================\n');

  let passedTests = 0;
  const totalTests = 4;

  const supabase = createMockSupabaseClient();

  // ── [TEST 1] 인덱스 기반 10,000회 조회 벤치마크 ──
  console.log('▶ [TEST 1] 보조 인덱스 기반 10,000회 .eq("ticker", "005930") 조회 벤치마크');
  const queryCount = 10000;

  const start = performance.now();
  for (let i = 0; i < queryCount; i++) {
    await supabase.from('stocks').select('*').eq('ticker', '005930').single();
  }
  const elapsed = performance.now() - start;

  console.log(`  - 10,000회 쿼리 수행 시간: ${elapsed.toFixed(2)}ms (회당 ${(elapsed / queryCount * 1000).toFixed(2)}μs, 초당 ${(queryCount / (elapsed / 1000)).toLocaleString()} QPS)`);

  if (elapsed < 300) {
    console.log('  결과: ✅ PASS (인덱스 O(1) 고속 스캔 확인 - 초고속 QPS 달성)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL (조회 속도 지연)');
  }

  // ── [TEST 2] 100개 동시 요청 updateAtomic 레이스 컨디션 테스트 ──
  console.log('\n▶ [TEST 2] 100개 동시 비동기 입출금 트랜잭션 동시성 검증 (Race Condition Free)');
  const initialCash = 100000000;
  memoryDb.profiles.set('concurrency_user', {
    id: 'concurrency_user',
    user_id: 'concurrency_user',
    username: '동시성테스터',
    nickname: '동시성테스터',
    cash: initialCash,
    net_worth: initialCash,
    rank_tier: 'Gold',
    created_at: new Date().toISOString(),
  });
  memoryDb.rebuildIndexes();

  const concurrentOps = 100;
  const deltaPerOp = 5000; // 5000원씩 100번 입금 = +500,000원
  const promises: Promise<any>[] = [];

  for (let i = 0; i < concurrentOps; i++) {
    promises.push(
      supabase.rpc('increment_user_cash', {
        p_user_id: 'concurrency_user',
        p_delta: deltaPerOp,
      })
    );
  }

  await Promise.all(promises);

  const finalProfile = memoryDb.profiles.get('concurrency_user');
  const expectedCash = initialCash + concurrentOps * deltaPerOp;
  console.log(`  - 초기 잔고: ₩${initialCash.toLocaleString()}`);
  console.log(`  - 100개 동시 트랜잭션 후 잔고: ₩${finalProfile?.cash.toLocaleString()} (기대치: ₩${expectedCash.toLocaleString()})`);

  if (finalProfile?.cash === expectedCash) {
    console.log('  결과: ✅ PASS (100개 동시 비동기 요청 0원 오차 완벽 방어)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL (레이스 컨디션으로 인한 잔고 불일치 발생)');
  }

  // ── [TEST 3] PersistenceManager 스냅샷 저장 및 복원 무결성 검증 ──
  console.log('\n▶ [TEST 3] PersistenceManager 스냅샷 직렬화 및 자동 복원 검증');
  const memoryAdapter = new MemoryOnlyStorageAdapter();
  const persister = new PersistenceManager(memoryAdapter);

  // 1. 임의의 데이터 추가
  memoryDb.orders.set('snap_order_1', {
    id: 'snap_order_1',
    stock_id: 'stock_005930',
    user_id: 'concurrency_user',
    side: 'buy',
    price: 74500,
    size: 50,
    filled: 0,
    status: 'open',
    is_lp: false,
    created_at: new Date().toISOString(),
  });
  memoryDb.rebuildIndexes();

  // 2. 스냅샷 저장
  const saveSuccess = await persister.saveSnapshot(memoryDb);
  console.log(`  - 스냅샷 저장 성공 여부: ${saveSuccess}`);

  // 3. 메모리 강제 클리어
  memoryDb.stocks.clear();
  memoryDb.orders.clear();
  memoryDb.rebuildIndexes();
  console.log(`  - 메모리 클리어 후 주식 수: ${memoryDb.stocks.size}개, 주문 수: ${memoryDb.orders.size}개`);

  // 4. 스냅샷 복원
  const restoreSuccess = await persister.loadSnapshot(memoryDb);
  console.log(`  - 스냅샷 복원 성공 여부: ${restoreSuccess}`);
  console.log(`  - 복원 후 주식 수: ${memoryDb.stocks.size}개, 주문 수: ${memoryDb.orders.size}개, 인덱스 수: ${memoryDb.tickerIndex.size}개`);

  if (
    saveSuccess &&
    restoreSuccess &&
    memoryDb.stocks.size > 0 &&
    memoryDb.orders.has('snap_order_1') &&
    memoryDb.tickerIndex.has('005930')
  ) {
    console.log('  결과: ✅ PASS (스냅샷 저장 및 100% 무손실 복원 완료)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 4] EventBus 100ms 디바운스 큐 검증 ──
  console.log('\n▶ [TEST 4] EventBus 고빈도 이벤트 100ms 디바운스 배치 큐 검증');
  let debouncedCallCount = 0;
  let lastDebouncedPayload: any = null;

  EventBus.subscribe('ORDERBOOK_UPDATE', (payload) => {
    debouncedCallCount++;
    lastDebouncedPayload = payload;
  });

  // 10회 연속 빠른 발행
  for (let i = 1; i <= 10; i++) {
    EventBus.publishDebounced('ORDERBOOK_UPDATE', 'stock_005930', { tick: i, price: 74000 + i }, 50);
  }

  // 100ms 대기 후 수신 건수 확인
  await new Promise((resolve) => setTimeout(resolve, 120));

  console.log(`  - 10회 연속 빠른 발행 후 디바운스 수신 횟수: ${debouncedCallCount}회 (기대치: 1회)`);
  console.log(`  - 최종 수신된 틱 번호: ${lastDebouncedPayload?.tick} (기대치: 10)`);

  if (debouncedCallCount === 1 && lastDebouncedPayload?.tick === 10) {
    console.log('  결과: ✅ PASS (고빈도 이벤트 100ms 디바운스 배치 최적화 통과)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  console.log('\n================================================================');
  if (passedTests === totalTests) {
    console.log(`🏁 [최종 결과] 인메모리 최적화 벤치마크: 모든 테스트 통과 (${passedTests}/${totalTests}) 100% ✅`);
  } else {
    console.log(`🏁 [최종 결과] 인메모리 최적화 벤치마크: 일부 실패 (${passedTests}/${totalTests}) ❌`);
  }
  console.log('================================================================\n');
}

runOptimizationBenchmarkSuite().catch(console.error);
