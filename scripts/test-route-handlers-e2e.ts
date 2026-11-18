import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MarketEvent } from '../lib/engine/simulation/marketEventTypes';

const ISOLATED_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-route-e2e-'));
process.env.STOCKSYS_DATA_DIR = ISOLATED_DATA_DIR;
process.env.ALLOW_DEV_GUEST_AUTH = 'true';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`  ✅ PASS: ${msg}`);
}

async function main() {
  const { GET: marketFlowGET, POST: marketFlowPOST } = await import('../app/api/market-flow/route');
  const { POST: adminScenarioPOST } = await import('../app/api/admin/scenarios/route');
  const { POST: localDbPOST } = await import('../app/api/local-db/route');
  const { GET: commoditiesGET, POST: commoditiesPOST } = await import('../app/api/commodities/route');
  const { POST: ordersPOST } = await import('../app/api/orders/route');
  const {
    ensureLocalStandaloneReady,
    getLocalStandaloneEngine,
    stopLocalStandaloneEngine,
  } = await import('../lib/engine/localStandaloneServer');
  const { memoryDb, GUEST_USER_ID, STOCK_UUID_MAP } = await import('../lib/memoryDb/memoryStore');

  function resetDb(): void {
    memoryDb.resetToSeedData();
    memoryDb.orders.clear();
    memoryDb.marketNews = [];
    memoryDb.rebuildIndexes();
  }

  console.log('════════════════════════════════════════════════════════════════');
  console.log('🌐 Direct Route Handler & API Integration Verification');
  console.log('════════════════════════════════════════════════════════════════');

  await ensureLocalStandaloneReady();
  resetDb();
  const engine = getLocalStandaloneEngine()!;
  assert(Boolean(engine), 'Local standalone engine must be initialized after ensureLocalStandaloneReady()');
  engine.stop(); // run deterministically in manual mode

  // 1. 비관리자의 수동 전진 거절 (403 Forbidden)
  console.log('\n[TEST 1] Non-admin manual step rejection (403)');
  delete process.env.ALLOW_DEV_ADMIN;
  const unauthReq = new Request('http://localhost:3000/api/market-flow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'step', dt: 1.0 }),
  });
  const unauthRes = await marketFlowPOST(unauthReq);
  assert(unauthRes.status === 403, `Non-admin request must be rejected with 403 (actual: ${unauthRes.status})`);
  const unauthJson = await unauthRes.json();
  assert(unauthJson.success === false, 'Non-admin response success must be false');

  // 2. GET 요청만으로 시장 시간이 전진하지 않음
  console.log('\n[TEST 2] GET request idempotency & no time advance');
  const initialTime = engine.getSimulationTime();
  for (let i = 0; i < 5; i++) {
    const getReq = new Request('http://localhost:3000/api/market-flow');
    const getRes = await marketFlowGET(getReq);
    assert(getRes.status === 200, `GET response status must be 200 (actual: ${getRes.status})`);
    const getJson = await getRes.json();
    assert(getJson.success === true, 'GET response must be success');
    assert(getJson.data.asOfTime === initialTime, `GET response asOfTime must match initial time ${initialTime} (actual: ${getJson.data.asOfTime})`);
  }
  assert(engine.getSimulationTime() === initialTime, `Engine simulation time must remain untouched (${initialTime})`);

  // 3. 미래 뉴스 주입 후 공개 API/대시보드 노출 차단
  console.log('\n[TEST 3] Future news strictly blocked from API & dashboard before publishedAt');
  const simTime = engine.getSimulationTime();
  const futurePubTime = simTime + 10000;
  const targetStock = Array.from(memoryDb.stocks.values())[0];

  const futureNews1: MarketEvent = {
    eventId: 'ev_future_api_001',
    publishedAt: futurePubTime,
    effectiveFrom: futurePubTime,
    scope: 'stock',
    targetStockIds: [targetStock.id],
    eventType: 'OFFICIAL',
    valuationSignal: 0.15,
    attentionShock: 0.5,
    uncertaintyShock: 0.2,
    confidence: 0.9,
    halfLife: 50,
    publisher: '테스트 언론사 1',
    title: '미래 뉴스 1',
    content: '10초 뒤 공개 예정인 뉴스',
  };

  const futureNews2: MarketEvent = {
    eventId: 'ev_future_api_002',
    publishedAt: futurePubTime,
    effectiveFrom: futurePubTime,
    scope: 'stock',
    targetStockIds: [targetStock.id],
    eventType: 'OFFICIAL',
    valuationSignal: -0.15,
    attentionShock: 0.5,
    uncertaintyShock: 0.2,
    confidence: 0.9,
    halfLife: 50,
    publisher: '테스트 언론사 2',
    title: '미래 뉴스 2 (동일 시각)',
    content: '동일 시각에 공개 예정인 두 번째 뉴스',
  };

  process.env.ALLOW_DEV_ADMIN = 'true';
  const injectReq1 = new Request('http://localhost:3000/api/admin/scenarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'inject_news_event', event: futureNews1 }),
  });
  const injectRes1 = await adminScenarioPOST(injectReq1);
  const injectJson1 = await injectRes1.json();
  assert(injectRes1.status === 200 && injectJson1.success === true, `Admin injectNews 1 must succeed (status: ${injectRes1.status})`);

  const injectReq2 = new Request('http://localhost:3000/api/admin/scenarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'inject_news_event', event: futureNews2 }),
  });
  const injectRes2 = await adminScenarioPOST(injectReq2);
  const injectJson2 = await injectRes2.json();
  assert(injectRes2.status === 200 && injectJson2.success === true, `Admin injectNews 2 must succeed (status: ${injectRes2.status})`);

  const getBeforePub = await marketFlowGET(new Request('http://localhost:3000/api/market-flow'));
  const dataBeforePub = (await getBeforePub.json()).data;
  const allMarkersBefore = dataBeforePub.timeSeries.flatMap((pt: any) => pt.newsEvents || (pt.newsEvent ? [pt.newsEvent] : []));
  assert(allMarkersBefore.length === 0, `Future news must NOT appear in timeSeries markers before publishedAt (got ${allMarkersBefore.length})`);
  assert(!dataBeforePub.recentNews.some((n: any) => n.id === 'ev_future_api_001' || n.id === 'ev_future_api_002'), 'Future news must NOT exist in recentNews before publishedAt');
  assert(!memoryDb.marketNews.some((n: any) => n.id === 'ev_future_api_001' || n.id === 'ev_future_api_002'), 'Future news must NOT exist in memoryDb.marketNews before publishedAt');

  // 4. 관리자 수동 전진 시 차트·순위·시간 갱신 및 동일 시각 복수 뉴스 공개 확인
  console.log('\n[TEST 4] Admin manual step: Clock advances, simultaneous news published, markers preserved');
  const adminStepReq = new Request('http://localhost:3000/api/market-flow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'step', dt: 10.0 }),
  });
  const adminStepRes = await marketFlowPOST(adminStepReq);
  assert(adminStepRes.status === 200, `Admin step request must succeed (actual: ${adminStepRes.status})`);
  const adminStepJson = await adminStepRes.json();
  assert(adminStepJson.success === true, 'Admin step response success must be true');
  assert(adminStepJson.data.asOfTime === futurePubTime, `asOfTime must advance to ${futurePubTime} (actual: ${adminStepJson.data.asOfTime})`);
  assert(adminStepJson.data.leaderBoard.length > 0, 'Leaderboard must be calculated');

  const getAfterPub = await marketFlowGET(new Request('http://localhost:3000/api/market-flow'));
  const dataAfterPub = (await getAfterPub.json()).data;
  const allMarkersAfter = dataAfterPub.timeSeries.flatMap((pt: any) => pt.newsEvents || (pt.newsEvent ? [pt.newsEvent] : []));
  assert(allMarkersAfter.length === 2, `Both simultaneous news must appear as markers at publishedAt (actual: ${allMarkersAfter.length})`);
  assert(allMarkersAfter.some((m: any) => m.id === 'ev_future_api_001'), 'Marker 1 must be present');
  assert(allMarkersAfter.some((m: any) => m.id === 'ev_future_api_002'), 'Marker 2 must be present');

  // 5. 다음 스냅샷 전진 시 동일 마커 중복 추가 방지 확인
  console.log('\n[TEST 5] Subsequent step maintains marker uniqueness');
  await marketFlowPOST(new Request('http://localhost:3000/api/market-flow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'step', dt: 2.0 }),
  }));
  const getAfterStep2 = await marketFlowGET(new Request('http://localhost:3000/api/market-flow'));
  const dataStep2 = (await getAfterStep2.json()).data;
  const allMarkersStep2 = dataStep2.timeSeries.flatMap((pt: any) => pt.newsEvents || (pt.newsEvent ? [pt.newsEvent] : []));
  const event1Count = allMarkersStep2.filter((m: any) => m.id === 'ev_future_api_001').length;
  assert(event1Count === 1, `Marker must appear exactly once across snapshots, no duplicates (actual count: ${event1Count})`);

  // 6. /api/local-db orders 일괄 취소 (.in('id', ...)) 및 타인 주문 혼입 차단
  console.log('\n[TEST 6] /api/local-db batch cancel (.in) & ownership check');
  const stock0010 = STOCK_UUID_MAP['0010'];
  const ord1 = { id: 'e2e_ord_1', stock_id: stock0010, user_id: GUEST_USER_ID, side: 'buy' as const, price: 70000, size: 2, filled: 0, status: 'open' as const, is_lp: false, created_at: memoryDb.getIsoTimestamp() };
  const ord2 = { id: 'e2e_ord_2', stock_id: stock0010, user_id: GUEST_USER_ID, side: 'buy' as const, price: 70000, size: 3, filled: 0, status: 'open' as const, is_lp: false, created_at: memoryDb.getIsoTimestamp() };
  const otherOrd = { id: 'e2e_ord_other', stock_id: stock0010, user_id: 'other_user_e2e', side: 'buy' as const, price: 70000, size: 1, filled: 0, status: 'open' as const, is_lp: false, created_at: memoryDb.getIsoTimestamp() };
  [ord1, ord2, otherOrd].forEach((o) => {
    memoryDb.orders.set(o.id, o);
    memoryDb.addOrderToIndex(o);
  });

  const hijackBatchRes = await localDbPOST(new Request('http://localhost:3000/api/local-db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'execute',
      tableName: 'orders',
      query: {
        action: 'update',
        payloadData: { status: 'cancelled' },
        filters: [
          { col: 'id', op: 'in', val: ['e2e_ord_1', 'e2e_ord_other'] },
          { col: 'user_id', op: 'eq', val: GUEST_USER_ID },
        ],
      },
    }),
  }));
  assert(hijackBatchRes.status === 403, `Batch containing another user's order must be rejected 403 (got ${hijackBatchRes.status})`);
  assert(memoryDb.orders.get('e2e_ord_1')?.status === 'open', 'Ord1 must remain open when batch is rejected');

  const okBatchRes = await localDbPOST(new Request('http://localhost:3000/api/local-db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'execute',
      tableName: 'orders',
      query: {
        action: 'update',
        payloadData: { status: 'cancelled' },
        filters: [
          { col: 'id', op: 'in', val: ['e2e_ord_1', 'e2e_ord_2'] },
          { col: 'user_id', op: 'eq', val: GUEST_USER_ID },
        ],
      },
    }),
  }));
  assert(okBatchRes.status === 200, `Batch cancel of owned orders must succeed (got ${okBatchRes.status})`);
  assert(memoryDb.orders.get('e2e_ord_1')?.status === 'cancelled', 'e2e_ord_1 cancelled');
  assert(memoryDb.orders.get('e2e_ord_2')?.status === 'cancelled', 'e2e_ord_2 cancelled');

  // 7. /api/local-db market_news 서버 구독 권한 강제 및 profiles SELECT 비변이 검증
  console.log('\n[TEST 7] /api/local-db server RUMOR gating & lock-free SELECT non-mutation');
  const guestProf = memoryDb.profiles.get(GUEST_USER_ID)!;
  guestProf.is_admin = false;
  guestProf.news_subscriptions = { expired_outlet: new Date(Date.now() - 60_000).toISOString() };
  memoryDb.marketNews.push({
    id: 'e2e_rumor_1',
    title: '비밀 루머 테스트',
    content: 'SECRET_INSIDER_ALPHA_CONTENT',
    category: 'RUMOR',
    news_type: 'RUMOR',
    sentiment: 'negative',
    publisher: '루머스',
    impact_score: 0.9,
    created_at: new Date().toISOString(),
  } as any);

  const newsLockedRes = await localDbPOST(new Request('http://localhost:3000/api/local-db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'execute', tableName: 'market_news', query: { action: 'select', filters: [] } }),
  }));
  const newsLockedJson = await newsLockedRes.json();
  const rumorRow = (newsLockedJson.data || []).find((n: any) => n.id === 'e2e_rumor_1');
  assert(Boolean(rumorRow) && rumorRow.locked === true, 'Unsubscribed user must receive locked=true on RUMOR');
  assert(!String(rumorRow.content).includes('SECRET_INSIDER_ALPHA_CONTENT'), 'Unsubscribed user must NOT receive raw RUMOR body');

  // profiles SELECT must NOT mutate live memoryDb profile
  await localDbPOST(new Request('http://localhost:3000/api/local-db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'execute',
      tableName: 'profiles',
      query: { action: 'select', isSingle: true, filters: [{ col: 'id', op: 'eq', val: GUEST_USER_ID }] },
    }),
  }));
  assert('expired_outlet' in (guestProf.news_subscriptions || {}), 'profiles SELECT must NOT mutate live memoryDb.profiles');

  // Active subscription grants RUMOR body
  guestProf.news_subscriptions = { outlet_1: new Date(Date.now() + 86_400_000).toISOString() };
  const newsUnlockedRes = await localDbPOST(new Request('http://localhost:3000/api/local-db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'execute', tableName: 'market_news', query: { action: 'select', filters: [] } }),
  }));
  const newsUnlockedJson = await newsUnlockedRes.json();
  const rumorUnlocked = (newsUnlockedJson.data || []).find((n: any) => n.id === 'e2e_rumor_1');
  assert(rumorUnlocked?.locked === false && rumorUnlocked?.content === 'SECRET_INSIDER_ALPHA_CONTENT', 'Active subscriber receives unlocked RUMOR body');

  // 8. /api/commodities 동적 환율 & 원자재 주문 취소 API
  console.log('\n[TEST 8] /api/commodities dynamic USD rate & atomic cancel_order');
  guestProf.cash = 20_000_000;
  const commGetRes = await commoditiesGET(new Request('http://localhost:3000/api/commodities?id=CRUDE_OIL'));
  const commGetJson = await commGetRes.json();
  assert(commGetJson.success === true && commGetJson.usdToKrwRate === 1380, `GET /api/commodities must expose server usdToKrwRate=1380 (got ${commGetJson.usdToKrwRate})`);

  const submitCommRes = await commoditiesPOST(new Request('http://localhost:3000/api/commodities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'submit_order',
      order: { commodityId: 'CRUDE_OIL', side: 'buy', type: 'limit', price: 10, size: 1 },
    }),
  }));
  const submitCommJson = await submitCommRes.json();
  assert(submitCommRes.status === 200 && submitCommJson.success === true, 'Commodity order submission succeeded');
  const cashAfterCommOrder = guestProf.cash;
  assert(cashAfterCommOrder < 20_000_000, 'Cash deducted for commodity order margin');

  const cancelCommRes = await commoditiesPOST(new Request('http://localhost:3000/api/commodities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cancel_order', orderId: submitCommJson.order.id }),
  }));
  const cancelCommJson = await cancelCommRes.json();
  assert(cancelCommRes.status === 200 && cancelCommJson.success === true, 'Commodity cancel_order succeeded');
  assert(guestProf.cash === 20_000_000, `Full commodity margin refunded on cancel (${guestProf.cash} === 20000000)`);

  // 9. /api/orders USD ETF(SPY) 원화 환산 정산 검증
  console.log('\n[TEST 9] /api/orders USD ETF FX settlement in KRW');
  const spyId = STOCK_UUID_MAP['SPY'];
  const botSellerId = 'spy_seller_e2e';
  memoryDb.profiles.set(botSellerId, { id: botSellerId, user_id: botSellerId, username: 'spysell', nickname: 'spysell', cash: 0, net_worth: 0, rank_tier: 'Silver', created_at: memoryDb.getIsoTimestamp() });
  memoryDb.profileUserIdIndex.set(botSellerId, botSellerId);
  const sellerHolding = { id: `${botSellerId}_${spyId}`, user_id: botSellerId, stock_id: spyId, quantity: 10, avg_price: 500, created_at: memoryDb.getIsoTimestamp() };
  memoryDb.holdings.set(sellerHolding.id, sellerHolding);
  memoryDb.addHoldingToIndex(sellerHolding);
  const spySellOrd = { id: 'spy_sell_1', stock_id: spyId, user_id: botSellerId, side: 'sell' as const, price: 500, size: 2, filled: 0, status: 'open' as const, is_lp: false, created_at: memoryDb.getIsoTimestamp() };
  memoryDb.orders.set(spySellOrd.id, spySellOrd);
  memoryDb.addOrderToIndex(spySellOrd);

  guestProf.cash = 2_000_000;
  const spyBuyRes = await ordersPOST(new Request('http://localhost:3000/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stock_id: spyId, side: 'buy', price: 500, size: 1 }),
  }));
  const spyBuyJson = await spyBuyRes.json();
  assert(spyBuyRes.status === 200 && spyBuyJson.success === true && spyBuyJson.filledQty === 1, 'SPY USD ETF order filled via /api/orders');
  const expectedKrwCost = Math.round(500 * 1380 * 1.0025);
  const actualCashAfterSpy = memoryDb.profiles.get(GUEST_USER_ID)!.cash;
  assert(actualCashAfterSpy === 2_000_000 - expectedKrwCost, `SPY KRW deduction includes FX 1380 & 0.25% fee (${actualCashAfterSpy} === ${2_000_000 - expectedKrwCost})`);

  stopLocalStandaloneEngine();
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL ROUTE HANDLER VERIFICATIONS PASSED PERFECTLY!');
  console.log('════════════════════════════════════════════════════════════════');
}

main()
  .finally(() => {
    fs.rmSync(ISOLATED_DATA_DIR, { recursive: true, force: true });
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error in route handler test:', err);
    process.exit(1);
  });
