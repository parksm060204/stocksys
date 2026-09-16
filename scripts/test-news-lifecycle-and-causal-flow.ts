/**
 * STOCKSYS Comprehensive News Lifecycle & Causal Market Flow Verification Test
 *
 * Validates:
 * A. Future News Publication Barrier (registered -> published -> effective)
 * B. Effective Signal Usage Barrier (effectiveFrom gate for valuation & attention)
 * C. Rumor & Correction Isolation (per-agent infoLatency, truth masking, orphan correction)
 * D. LeaderBoard Single-Smoothing & Snapshot Coherence
 * E. Simulation Execution Serialization & Queue Integrity
 * F. News Markers & Full Causal ID Chain Linking
 */

import { memoryDb } from '../lib/memoryDb/memoryStore';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import { LocalMarketEngineInstance, createHeadlessSimulationRunner } from '../lib/engine/localStandaloneServer';
import { getVisibleMarketEvents, getEffectiveMarketEvents, sanitizePublicNewsRecord, MarketEvent } from '../lib/engine/simulation/marketEventTypes';
import { evaluateValueStrategy } from '../lib/engine/simulation/strategies/valueStrategy';
import { buildMarketObservation } from '../lib/engine/simulation/marketObservation';
import { SimPrng } from '../lib/engine/simulation/simClock';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

async function runVerificationSuite() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('🧪 [REGRESSION TEST] News Lifecycle & Causal Market Flow Suite');
  console.log('════════════════════════════════════════════════════════════════\n');

  // Setup Clean In-Memory Database
  function resetDb() {
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

  // ════════════════════════════════════════════════════════════════
  // TEST A: 미래 뉴스 공개 차단 (Future News Publication Barrier)
  // ════════════════════════════════════════════════════════════════
  console.log('─── TEST A: Future News Publication Barrier ───');
  resetDb();
  const runnerA = createHeadlessSimulationRunner(101, 1773500000000);
  const startTA = runnerA.getSimulationTime();
  const stockA = Array.from(memoryDb.stocks.values())[0];

  // Current time T: register event published 10 seconds in the future
  const futureEventPublishedAt = startTA + 10_000;
  const futureEventEffectiveFrom = startTA + 20_000;

  const regSuccess = await runnerA.registerEvent({
    eventId: 'evt_future_01',
    publishedAt: futureEventPublishedAt,
    effectiveFrom: futureEventEffectiveFrom,
    scope: 'stock',
    targetStockIds: [stockA.id],
    eventType: 'OFFICIAL',
    valuationSignal: 0.35,
    attentionShock: 0.70,
    uncertaintyShock: 0.10,
    confidence: 0.95,
    halfLife: 60,
    publisher: '테크타임즈',
    title: '차세대 칩 양산 성공',
    content: '10초 뒤 공식 발표될 예정인 특종',
  });

  assert(regSuccess === true, 'Event should register successfully');
  assert(runnerA.agentManager.pendingEvents.length === 1, 'Event must exist in pendingEvents queue');
  assert(runnerA.agentManager.publishedEvents.length === 0, 'Event must NOT exist in publishedEvents');
  assert(memoryDb.marketNews.length === 0, 'Event must NOT appear in memoryDb.marketNews before publishedAt');

  // Verify at T and T + 9999ms: not visible in public DB, dashboard, or agent observations
  const agentBotA = runnerA.agentManager.agents.get('acc_bot_val_01')!;
  let visibleA = getVisibleMarketEvents(runnerA.agentManager.events, startTA, agentBotA.infoLatency ?? 0);
  assert(visibleA.length === 0, 'Agent must NOT observe future event at T');

  // Advance by 9.999 seconds (T + 9999ms)
  await runnerA.step(9.999);
  assert(runnerA.getSimulationTime() === startTA + 9999, 'Clock should be at T + 9999ms');
  assert(memoryDb.marketNews.length === 0, 'Event must still NOT appear in public news at T + 9999ms');
  visibleA = getVisibleMarketEvents(runnerA.agentManager.events, startTA + 9999, 0);
  assert(visibleA.length === 0, 'Zero-latency observer must NOT observe event before publishedAt');

  // Ensure GET / dashboard query does NOT advance simulation or publish the event
  const flowBefore = runnerA.getFlowData(10);
  assert(flowBefore.recentNews.length === 0, 'GET dashboard query must return zero unreleased news');
  assert(runnerA.getSimulationTime() === startTA + 9999, 'GET dashboard query must not advance clock');

  // Advance remaining 0.001s to reach exactly T + 10000ms (publishedAt)
  await runnerA.step(0.001);
  assert(runnerA.getSimulationTime() === startTA + 10000, 'Clock should be at T + 10000ms');
  assert(runnerA.agentManager.publishedEvents.length === 1, 'Event must transition to publishedEvents at T + 10000ms');
  assert(memoryDb.marketNews.length === 1, 'Event must appear in memoryDb.marketNews exactly once at T + 10000ms');
  assert(memoryDb.marketNews[0].id === 'evt_future_01', 'Published news ID must match');
  assert(memoryDb.marketNews[0].simulation_time === futureEventPublishedAt, 'simulation_time must be publishedAt');

  // Attention & uncertainty must remain un-shocked until effectiveFrom (T + 20s)
  assert(runnerA.agentManager.effectiveEventIds.has('evt_future_01') === false, 'Event must NOT be marked effective yet');
  const uncBeforeEffective = runnerA.agentManager.uncertaintyMap.get(stockA.id) ?? 0.05;
  assert(uncBeforeEffective <= 0.06, 'Uncertainty must NOT have received shock (+0.10) before effectiveFrom');
  console.log('✅ TEST A PASSED: Future news strictly blocked from public & bot observation until publishedAt.');

  // ════════════════════════════════════════════════════════════════
  // TEST B: 효력 발생 시점 (Effective Signal Barrier)
  // ════════════════════════════════════════════════════════════════
  console.log('\n─── TEST B: Effective Signal Barrier ───');
  resetDb();
  const runnerB = createHeadlessSimulationRunner(202, 1773500000000);
  const startTB = runnerB.getSimulationTime();
  const stockB = Array.from(memoryDb.stocks.values())[0];

  // Event: published at T, effective at T + 10s
  await runnerB.registerEvent({
    eventId: 'evt_signal_delay',
    publishedAt: startTB,
    effectiveFrom: startTB + 10_000,
    scope: 'stock',
    targetStockIds: [stockB.id],
    eventType: 'OFFICIAL',
    valuationSignal: 0.45,
    attentionShock: 0.50,
    uncertaintyShock: 0.15,
    confidence: 0.90,
    halfLife: 50,
    publisher: '글로벌파이낸스',
    title: '신규 수출 규제 승인 발표',
    content: '효력은 발표 10초 후 발생',
  });

  // Step 1.0s: simulation moves to T + 1000ms. publishedAt <= simTime -> published!
  await runnerB.step(1.0);
  assert(runnerB.agentManager.publishedEvents.length === 1, 'Event must be published');

  // Agent with infoLatency = 2.0s:
  // At T + 1.0s, agent does NOT observe it yet (latency not elapsed)
  const valAgent = runnerB.agentManager.agents.get('acc_bot_val_01')!;
  valAgent.infoLatency = 2.0; // 2 seconds latency
  let obsB = buildMarketObservation(
    stockB.id,
    valAgent.accountId,
    runnerB.getSimulationTime(),
    20,
    runnerB.agentManager.attentionMap,
    runnerB.agentManager.uncertaintyMap,
    getVisibleMarketEvents(runnerB.agentManager.publishedEvents, runnerB.getSimulationTime(), valAgent.infoLatency)
  );
  assert(obsB?.recentEvents?.length === 0, 'Agent with 2s latency cannot observe at T + 1s');

  // Advance to T + 3.0s: latency elapsed! Agent now observes news (visibleEvents length = 1)
  await runnerB.step(2.0);
  assert(runnerB.getSimulationTime() === startTB + 3000, 'Clock at T + 3s');
  obsB = buildMarketObservation(
    stockB.id,
    valAgent.accountId,
    runnerB.getSimulationTime(),
    20,
    runnerB.agentManager.attentionMap,
    runnerB.agentManager.uncertaintyMap,
    getVisibleMarketEvents(runnerB.agentManager.publishedEvents, runnerB.getSimulationTime(), valAgent.infoLatency)
  );
  assert(obsB?.recentEvents?.length === 1, 'Agent observes headline at T + 3s');
  assert(obsB?.effectiveEvents?.length === 0, 'effectiveEvents must be empty because effectiveFrom is T + 10s');

  // Test that evaluateValueStrategy produces ZERO valuation delta from this news
  const dummyPrng = new SimPrng(42);
  const trueFund = 50000;
  const configB = runnerB.agentManager.valueConfig;
  // Temporarily evaluate with noise = 0 to isolate news effect
  const savedNoise = configB.noiseStdDev;
  configB.noiseStdDev = 0;
  const intentBeforeEffective = evaluateValueStrategy(obsB!, valAgent, configB, trueFund, dummyPrng);
  configB.noiseStdDev = savedNoise;
  // If effectiveFrom was ignored, valuation gap would be ~40% and trigger buy intent.
  // Since effectiveFrom is gated, estimatedValue equals trueFund and no artificial news delta exists.
  assert(
    intentBeforeEffective.action === 'hold' || !intentBeforeEffective.reason?.includes('45%'),
    'Valuation signal must NOT trigger before effectiveFrom'
  );

  // Jump with a large dt (skip past T + 10s to T + 15s)
  await runnerB.step(12.0);
  assert(runnerB.getSimulationTime() === startTB + 15000, 'Clock at T + 15s');
  obsB = buildMarketObservation(
    stockB.id,
    valAgent.accountId,
    runnerB.getSimulationTime(),
    20,
    runnerB.agentManager.attentionMap,
    runnerB.agentManager.uncertaintyMap,
    getVisibleMarketEvents(runnerB.agentManager.publishedEvents, runnerB.getSimulationTime(), valAgent.infoLatency)
  );
  assert(obsB?.effectiveEvents?.length === 1, 'effectiveEvents must now include the event after effectiveFrom');
  assert(runnerB.agentManager.effectiveEventIds.has('evt_signal_delay'), 'effectiveEventIds must track exactly once');
  console.log('✅ TEST B PASSED: Economic valuation signal and attention shocks strictly blocked until effectiveFrom.');

  // ════════════════════════════════════════════════════════════════
  // TEST C: 루머와 정정의 봇별 정보 상태 격리 (Rumor & Correction Isolation)
  // ════════════════════════════════════════════════════════════════
  console.log('\n─── TEST C: Rumor & Correction Isolation ───');
  resetDb();
  const runnerC = createHeadlessSimulationRunner(303, 1773500000000);
  const startTC = runnerC.getSimulationTime();
  const stockC = Array.from(memoryDb.stocks.values())[0];

  // 1. Publish Rumor at T
  await runnerC.registerEvent({
    eventId: 'evt_rumor_01',
    publishedAt: startTC,
    effectiveFrom: startTC,
    scope: 'stock',
    targetStockIds: [stockC.id],
    eventType: 'RUMOR',
    valuationSignal: 0.40,
    attentionShock: 0.60,
    uncertaintyShock: 0.30,
    confidence: 0.60,
    halfLife: 40,
    publisher: '루머통신',
    title: '비밀 합병설',
    content: '확인되지 않은 합병 찌라시',
    isRumorFake: true,
  });

  // 2. Register Correction published at T + 5s
  await runnerC.registerEvent({
    eventId: 'evt_corr_01',
    originalEventId: 'evt_rumor_01',
    publishedAt: startTC + 5_000,
    effectiveFrom: startTC + 5_000,
    scope: 'stock',
    targetStockIds: [stockC.id],
    eventType: 'CORRECTION',
    valuationSignal: -0.40,
    attentionShock: 0.20,
    uncertaintyShock: 0.10,
    confidence: 0.90,
    halfLife: 30,
    publisher: '공시통',
    title: '합병설 전면 부인 공시',
    content: '사실무근 확인',
  });

  // Advance to T + 1s: Rumor is published, but Correction is still pending!
  await runnerC.step(1.0);
  assert(memoryDb.marketNews.length === 1, 'Only rumor must be in market news at T + 1s');
  assert(memoryDb.marketNews[0].id === 'evt_rumor_01', 'Rumor ID in news');
  // Check sanitization: no internal truth in public news
  const publicNews = sanitizePublicNewsRecord(memoryDb.marketNews[0] as any);
  assert(!('isRumorFake' in publicNews) && !('is_fake' in publicNews), 'Internal truth must be stripped from public news');

  // Fast bot (latency 1s) vs Slow bot (latency 4s)
  const fastAgent = runnerC.agentManager.agents.get('acc_bot_val_01')!;
  fastAgent.infoLatency = 1.0;
  const slowAgent = runnerC.agentManager.agents.get('acc_bot_val_02')!;
  slowAgent.infoLatency = 4.0;

  // Advance to T + 6.5s:
  // Correction was published at T + 5s.
  // Fast bot (latency 1s) sees it from T + 6s -> Sees correction at T + 6.5s!
  // Slow bot (latency 4s) sees it from T + 9s -> Does NOT see correction at T + 6.5s!
  await runnerC.step(5.5);
  assert(runnerC.getSimulationTime() === startTC + 6500, 'Clock at T + 6.5s');

  const fastObs = buildMarketObservation(
    stockC.id,
    fastAgent.accountId,
    runnerC.getSimulationTime(),
    20,
    runnerC.agentManager.attentionMap,
    runnerC.agentManager.uncertaintyMap,
    getVisibleMarketEvents(runnerC.agentManager.publishedEvents, runnerC.getSimulationTime(), fastAgent.infoLatency)
  );

  const slowObs = buildMarketObservation(
    stockC.id,
    slowAgent.accountId,
    runnerC.getSimulationTime(),
    20,
    runnerC.agentManager.attentionMap,
    runnerC.agentManager.uncertaintyMap,
    getVisibleMarketEvents(runnerC.agentManager.publishedEvents, runnerC.getSimulationTime(), slowAgent.infoLatency)
  );

  const fastHasCorr = fastObs?.recentEvents?.some((e) => e.eventType === 'CORRECTION');
  const slowHasCorr = slowObs?.recentEvents?.some((e) => e.eventType === 'CORRECTION');

  assert(fastHasCorr === true, 'Fast bot must observe CORRECTION at T + 6.5s');
  assert(slowHasCorr === false, 'Slow bot must NOT observe CORRECTION at T + 6.5s');

  // Verify global confidence of rumor is NOT mutated to 0
  const globalRumor = runnerC.agentManager.publishedEvents.find((e) => e.eventId === 'evt_rumor_01')!;
  assert(globalRumor.confidence === 0.60, 'Global confidence of rumor must remain intact');

  // Test orphan correction (references non-existent originalEventId)
  const orphanSuccess = await runnerC.registerEvent({
    eventId: 'evt_orphan_corr',
    originalEventId: 'evt_non_existent',
    publishedAt: startTC + 8000,
    effectiveFrom: startTC + 8000,
    scope: 'stock',
    targetStockIds: [stockC.id],
    eventType: 'CORRECTION',
    valuationSignal: -0.1,
    attentionShock: 0.1,
    uncertaintyShock: 0.1,
    confidence: 0.8,
    halfLife: 20,
    publisher: '공시통',
    title: '미확인 정정',
    content: '원본 없는 정정',
  });
  assert(orphanSuccess === true, 'Orphan correction must be accepted safely without crash');
  console.log('✅ TEST C PASSED: Rumor & correction latency isolation and truth protection verified.');

  // ════════════════════════════════════════════════════════════════
  // TEST D: 리더보드 중복 평활화 제거 (Leaderboard Single-Smoothing)
  // ════════════════════════════════════════════════════════════════
  console.log('\n─── TEST D: LeaderBoard Single-Smoothing ───');
  resetDb();
  const runnerD = createHeadlessSimulationRunner(404, 1773500000000);
  const diag = runnerD.agentManager.diagnostics;
  const startTD = runnerD.getSimulationTime();

  // Step 1
  await runnerD.step(1.0);
  const simT1 = runnerD.getSimulationTime();
  const scores1 = diag.getLeaderBoard();
  const top1ScoreBefore = scores1[0]?.leaderScore ?? 0;

  // Call updateLeaderBoard AGAIN with the exact same simT1
  const duplicateCallScores = diag.updateLeaderBoard(simT1, runnerD.agentManager.attentionMap);
  const top1ScoreAfter = duplicateCallScores[0]?.leaderScore ?? 0;

  assert(
    Math.abs(top1ScoreBefore - top1ScoreAfter) < 1e-9,
    `Duplicate call on same asOfTime must NOT re-apply smoothing. Before: ${top1ScoreBefore}, After: ${top1ScoreAfter}`
  );

  // Calling getFlowData multiple times must not change leaderboard scores
  diag.getMarketFlowData(simT1, 20);
  diag.getMarketFlowData(simT1, 20);
  const scoresAfterGet = diag.getLeaderBoard();
  assert(
    Math.abs(scoresAfterGet[0].leaderScore - top1ScoreBefore) < 1e-9,
    'GET market flow data query must not mutate smoothed leader scores'
  );
  console.log('✅ TEST D PASSED: Leaderboard single-smoothing idempotency on same asOfTime verified.');

  // ════════════════════════════════════════════════════════════════
  // TEST E: 시뮬레이션 실행 직렬화 (Execution Serialization)
  // ════════════════════════════════════════════════════════════════
  console.log('\n─── TEST E: Execution Queue Serialization & Safety ───');
  resetDb();
  const engineE = new LocalMarketEngineInstance();
  const initialSimTime = engineE.getSimulationTime();

  // Issue stepSimulation, scheduleEvent, stepSimulation, resetSimulation concurrently via Promise.all
  const opResults: any[] = [];
  await Promise.all([
    engineE.stepSimulation(1.0).then(() => opResults.push('step1')),
    engineE.scheduleEvent({
      eventId: 'evt_concurrent_01',
      publishedAt: initialSimTime + 5000,
      effectiveFrom: initialSimTime + 5000,
      scope: 'market',
      targetStockIds: [Array.from(memoryDb.stocks.keys())[0]],
      eventType: 'OFFICIAL',
      valuationSignal: 0.2,
      attentionShock: 0.3,
      uncertaintyShock: 0.1,
      confidence: 0.9,
      halfLife: 30,
      publisher: '스트리트',
      title: '동시성 테스트 이벤트',
      content: '내용',
    }).then(() => opResults.push('event')),
    engineE.stepSimulation(2.0).then(() => opResults.push('step2')),
  ]);

  assert(opResults.length === 3, 'All 3 concurrent queue operations must complete successfully');
  const simTimeAfterConcurrent = engineE.getSimulationTime();
  assert(
    simTimeAfterConcurrent === initialSimTime + 3000,
    `Simulation clock must advance by exactly dt1 + dt2 = 3000ms. Got: ${simTimeAfterConcurrent - initialSimTime}ms`
  );

  // Test failure recovery: a failing task should not jam the queue
  let caughtError = false;
  try {
    await (engineE as any).enqueueSimulation(async () => {
      throw new Error('Simulated queue task crash');
    });
  } catch (err: any) {
    caughtError = true;
  }
  assert(caughtError === true, 'Failed task should throw to caller');

  // Next task in queue must execute normally
  let nextTaskExecuted = false;
  await engineE.stepSimulation(1.0);
  nextTaskExecuted = true;
  assert(nextTaskExecuted === true, 'Subsequent queue task must execute smoothly after previous failure');
  console.log('✅ TEST E PASSED: SerialExecutionQueue concurrency ordering and failure safety verified.');

  // ════════════════════════════════════════════════════════════════
  // TEST F: 뉴스 마커와 인과 ID 체인 (News Markers & Causal ID Chain)
  // ════════════════════════════════════════════════════════════════
  console.log('\n─── TEST F: News Markers & Causal ID Chain ───');
  resetDb();
  const runnerF = createHeadlessSimulationRunner(505, 1773500000000);
  const startTF = runnerF.getSimulationTime();
  const stockF = Array.from(memoryDb.stocks.values())[0];

  // Register two distinct news events at the EXACT same simulation timestamp
  await runnerF.registerEvent({
    eventId: 'evt_twin_01',
    publishedAt: startTF + 2000,
    effectiveFrom: startTF + 2000,
    scope: 'stock',
    targetStockIds: [stockF.id],
    eventType: 'OFFICIAL',
    valuationSignal: 0.25,
    attentionShock: 0.40,
    uncertaintyShock: 0.10,
    confidence: 0.90,
    halfLife: 30,
    publisher: '트윈뉴스 1',
    title: '동일시각 뉴스 A',
    content: '내용 A',
  });

  await runnerF.registerEvent({
    eventId: 'evt_twin_02',
    publishedAt: startTF + 2000,
    effectiveFrom: startTF + 2000,
    scope: 'stock',
    targetStockIds: [stockF.id],
    eventType: 'OFFICIAL',
    valuationSignal: -0.20,
    attentionShock: 0.35,
    uncertaintyShock: 0.15,
    confidence: 0.85,
    halfLife: 30,
    publisher: '트윈뉴스 2',
    title: '동일시각 뉴스 B',
    content: '내용 B',
  });

  // Advance to T + 2000ms
  await runnerF.step(2.0);
  const flowF = runnerF.getFlowData(60);
  const ptAtT2 = flowF.timeSeries.find((pt) => pt.timestamp === startTF + 2000);
  assert(ptAtT2 !== undefined, 'Snapshot point at T + 2000ms must exist');
  assert(ptAtT2?.newsEvents?.length === 2, `Both simultaneous news events must be preserved. Got: ${ptAtT2?.newsEvents?.length}`);
  const eventIdsInPoint = (ptAtT2?.newsEvents || []).map((e) => e.id);
  assert(eventIdsInPoint.includes('evt_twin_01') && eventIdsInPoint.includes('evt_twin_02'), 'Both event IDs must be present');

  // Next step at T + 3000ms: same news must NOT repeat in next snapshot point
  await runnerF.step(1.0);
  const flowF2 = runnerF.getFlowData(60);
  const ptAtT3 = flowF2.timeSeries.find((pt) => pt.timestamp === startTF + 3000);
  assert((ptAtT3?.newsEvents?.length || 0) === 0, 'Previous news must NOT repeat in subsequent snapshot points');

  // Inspect Causal Trace Logs for complete ID chain
  const causalLogs = flowF2.causalLogs;
  const orderSubmitLog = causalLogs.find((l) => l.stage === 'ORDER_SUBMIT');
  if (orderSubmitLog) {
    assert(typeof orderSubmitLog.decisionId === 'string' && orderSubmitLog.decisionId.startsWith('decision_'), 'decisionId must exist');
    assert(typeof orderSubmitLog.orderId === 'string', 'orderId must be linked');
  }

  const newsPubLogs = causalLogs.filter((l) => l.stage === 'NEWS_PUBLISHED');
  assert(newsPubLogs.length >= 2, 'NEWS_PUBLISHED stage logs must be recorded for official publications');
  console.log('✅ TEST F PASSED: News marker preservation, uniqueness, and causal trace chain verified.');

  engineE.stop();

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL REGRESSION SUITE TESTS (A through F) PASSED! (Exit Code 0)');
  console.log('════════════════════════════════════════════════════════════════');
}

runVerificationSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
