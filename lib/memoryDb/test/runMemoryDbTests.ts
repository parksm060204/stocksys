import { createMockSupabaseClient } from '../mockSupabaseClient';
import { memoryDb } from '../memoryStore';

async function runMemoryDbTestSuite() {
  console.log('================================================================');
  console.log('⚡ [IN-MEMORY STORE] 인메모리 독립 데이터베이스 검증 테스트');
  console.log('================================================================\n');

  let passedTests = 0;
  const totalTests = 5;

  const supabase = createMockSupabaseClient();

  // ── [TEST 1] 주식 및 원자재 마스터 데이터 조회 검증 ──
  console.log('▶ [TEST 1] 주식 & 원자재 마스터 목록 조회 (.select)');
  const { data: stocks, error: stockErr } = await supabase
    .from('stocks')
    .select('*')
    .order('current_price', { ascending: false });

  const { data: commodities, error: commErr } = await supabase
    .from('commodities')
    .select('*');

  console.log(`  - 시드 주식 수: ${stocks?.length}개 (1위: ${stocks?.[0]?.name} ₩${stocks?.[0]?.current_price.toLocaleString()})`);
  console.log(`  - 시드 원자재 수: ${commodities?.length}개 (1위: ${commodities?.[0]?.name})`);

  if (!stockErr && !commErr && stocks && stocks.length >= 10 && commodities && commodities.length === 12) {
    console.log('  결과: ✅ PASS (주식 및 원자재 시드 데이터 완벽 로드)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 2] 단일 종목 필터링 및 single() 검증 ──
  console.log('\n▶ [TEST 2] 삼성전자(005930) 단일 조회 (.eq & .single)');
  const { data: samsung, error: samErr } = await supabase
    .from('stocks')
    .select('*')
    .eq('ticker', '005930')
    .single();

  console.log(`  - 조회된 종목: ${samsung?.name} (${samsung?.ticker}), 현재가: ₩${samsung?.current_price.toLocaleString()}`);

  if (!samErr && samsung && samsung.ticker === '005930') {
    console.log('  결과: ✅ PASS (단일 종목 조회 및 필터링 정상)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 3] 사용자 주문 생성 (.insert) 및 체결 (.trades) 검증 ──
  console.log('\n▶ [TEST 3] 사용자 매수 주문 생성 및 체결 기록');
  const { data: newOrder, error: orderErr } = await supabase
    .from('orders')
    .insert({
      stock_id: 'stock_005930',
      user_id: 'guest_user',
      side: 'buy',
      price: 74200,
      size: 10,
      filled: 0,
      status: 'open',
      is_lp: false,
    });

  const { data: newTrade, error: tradeErr } = await supabase
    .from('trades')
    .insert({
      stock_id: 'stock_005930',
      buyer_id: 'guest_user',
      seller_id: 'lp_bot_01',
      buyer_is_bot: false,
      seller_is_bot: true,
      price: 74200,
      size: 10,
    });

  console.log(`  - 생성된 주문 ID: ${newOrder?.id}, 체결 ID: ${newTrade?.id}`);

  if (!orderErr && !tradeErr && newOrder && newTrade) {
    console.log('  결과: ✅ PASS (주문 생성 및 체결 내역 기록 정상)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 4] 보유 자산 Upsert & 조회 검증 ──
  console.log('\n▶ [TEST 4] 보유 자산 (.holdings) Upsert 및 조회');
  await supabase.from('holdings').upsert({
    user_id: 'guest_user',
    stock_id: 'stock_005930',
    quantity: 10,
    avg_price: 74200,
  });

  const { data: myHoldings } = await supabase
    .from('holdings')
    .select('*')
    .eq('user_id', 'guest_user');

  console.log(`  - 보유 종목 수: ${myHoldings?.length}건 (수량: ${myHoldings?.[0]?.quantity}주, 평단: ₩${myHoldings?.[0]?.avg_price.toLocaleString()})`);

  if (myHoldings && myHoldings.length === 1 && myHoldings[0]?.quantity === 10) {
    console.log('  결과: ✅ PASS (보유 자산 Upsert 및 조회 정상)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 5] RPC 잔고 갱신 (increment_user_cash) 검증 ──
  console.log('\n▶ [TEST 5] RPC 잔고 증감 (.rpc("increment_user_cash"))');
  const initialCash = memoryDb.profiles.get('guest_user')?.cash ?? 0;
  console.log(`  - 초기 잔고: ₩${initialCash.toLocaleString()}`);

  const delta = -742000; // 매수 대금 차감
  const { data: updatedCash } = await supabase.rpc('increment_user_cash', {
    p_user_id: 'guest_user',
    p_delta: delta,
  });

  console.log(`  - 변경 후 잔고: ₩${updatedCash?.toLocaleString()} (차감액: ₩${Math.abs(delta).toLocaleString()})`);

  if (updatedCash === initialCash + delta) {
    console.log('  결과: ✅ PASS (RPC 원자적 잔고 갱신 정상)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  console.log('\n================================================================');
  if (passedTests === totalTests) {
    console.log(`🏁 [최종 결과] 인메모리 독립 DB 검증: 모든 테스트 통과 (${passedTests}/${totalTests}) 100% ✅`);
  } else {
    console.log(`🏁 [최종 결과] 인메모리 독립 DB 검증: 일부 실패 (${passedTests}/${totalTests}) ❌`);
  }
  console.log('================================================================\n');
}

runMemoryDbTestSuite().catch(console.error);
