import { GET as marketFlowGET, POST as marketFlowPOST } from '../app/api/market-flow/route';
import { POST as adminScenarioPOST } from '../app/api/admin/scenarios/route';
import { ensureLocalStandaloneEngine, getLocalStandaloneEngine } from '../lib/engine/localStandaloneServer';
import { memoryDb } from '../lib/memoryDb/memoryStore';
import { MarketEvent } from '../lib/engine/simulation/marketEventTypes';

function resetDb(): void {
  memoryDb.stocks.clear();
  memoryDb.orders.clear();
  memoryDb.trades = [];
  memoryDb.profiles.clear();
  memoryDb.holdings.clear();
  memoryDb.stockPriceHistory = [];
  memoryDb.marketNews = [];
  memoryDb.seedDefaultData();
  memoryDb.orders.clear();
  memoryDb.rebuildIndexes();
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`  ✅ PASS: ${msg}`);
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('🌐 Direct Route Handler & API Integration Verification');
  console.log('════════════════════════════════════════════════════════════════');

  await resetDb();
  ensureLocalStandaloneEngine();
  const engine = getLocalStandaloneEngine()!;
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

  // 관리자 권한 모의
  process.env.ALLOW_DEV_ADMIN = 'true';
  const injectReq1 = new Request('http://localhost:3000/api/admin/scenarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'inject_news_event', event: futureNews1 }),
  });
  const injectRes1 = await adminScenarioPOST(injectReq1);
  const injectJson1 = await injectRes1.json();
  console.log('  [Debug] injectJson1:', injectJson1);
  assert(injectRes1.status === 200 && injectJson1.success === true, `Admin injectNews 1 must succeed (status: ${injectRes1.status})`);

  const injectReq2 = new Request('http://localhost:3000/api/admin/scenarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'inject_news_event', event: futureNews2 }),
  });
  const injectRes2 = await adminScenarioPOST(injectReq2);
  const injectJson2 = await injectRes2.json();
  console.log('  [Debug] injectJson2:', injectJson2);
  assert(injectRes2.status === 200 && injectJson2.success === true, `Admin injectNews 2 must succeed (status: ${injectRes2.status})`);

  // 공개 API GET 조회: 미래 뉴스는 전혀 보이지 않아야 함
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
    body: JSON.stringify({ action: 'step', dt: 10.0 }), // step by 10s -> exactly reaches publishedAt
  });
  const adminStepRes = await marketFlowPOST(adminStepReq);
  assert(adminStepRes.status === 200, `Admin step request must succeed (actual: ${adminStepRes.status})`);
  const adminStepJson = await adminStepRes.json();
  assert(adminStepJson.success === true, 'Admin step response success must be true');
  assert(adminStepJson.data.asOfTime === futurePubTime, `asOfTime must advance to ${futurePubTime} (actual: ${adminStepJson.data.asOfTime})`);
  assert(adminStepJson.data.leaderBoard.length > 0, 'Leaderboard must be calculated');

  // 공개 뉴스 확인
  const getAfterPub = await marketFlowGET(new Request('http://localhost:3000/api/market-flow'));
  const dataAfterPub = (await getAfterPub.json()).data;
  const allMarkersAfter = dataAfterPub.timeSeries.flatMap((pt: any) => pt.newsEvents || (pt.newsEvent ? [pt.newsEvent] : []));
  assert(allMarkersAfter.length === 2, `Both simultaneous news must appear as markers at publishedAt (actual: ${allMarkersAfter.length})`);
  assert(allMarkersAfter.some((m: any) => m.id === 'ev_future_api_001'), 'Marker 1 must be present');
  assert(allMarkersAfter.some((m: any) => m.id === 'ev_future_api_002'), 'Marker 2 must be present');

  // 5. 다음 스냅샷 전진 시 동일 마커 중복 추가 방지 확인
  console.log('\n[TEST 5] Subsequent step maintains marker uniqueness');
  const step2Req = new Request('http://localhost:3000/api/market-flow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'step', dt: 2.0 }),
  });
  await marketFlowPOST(step2Req);
  const getAfterStep2 = await marketFlowGET(new Request('http://localhost:3000/api/market-flow'));
  const dataStep2 = (await getAfterStep2.json()).data;
  const allMarkersStep2 = dataStep2.timeSeries.flatMap((pt: any) => pt.newsEvents || (pt.newsEvent ? [pt.newsEvent] : []));
  const event1Count = allMarkersStep2.filter((m: any) => m.id === 'ev_future_api_001').length;
  assert(event1Count === 1, `Marker must appear exactly once across snapshots, no duplicates (actual count: ${event1Count})`);

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL ROUTE HANDLER VERIFICATIONS PASSED PERFECTLY!');
  console.log('════════════════════════════════════════════════════════════════');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error in route handler test:', err);
  process.exit(1);
});
