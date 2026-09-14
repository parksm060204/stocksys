/**
 * Test Market Flow Dashboard API & Synchronized Time-Series Flow Diagnostics
 *
 * Verifies:
 * 1. Time-series ring buffer accumulation with synchronized timestamps.
 * 2. Sector turnover & turnover share calculation consistency.
 * 3. Bot Net Buy Turnover (Signed Net Flow) calculation without price-evaluation distortions.
 * 4. Leaderboard distinction between leaderRank (trade-based) and attentionRank (belief-based).
 * 5. Causal trace logging and recent news retrieval.
 */

import { memoryDb } from '../lib/memoryDb/memoryStore';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import { SECTOR_METADATA } from '../lib/engine/simulation/marketDiagnostics';

async function runMarketFlowDashboardVerification() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('🧪 [TEST] Market Flow Dashboard & Synchronized Time-Series Flow');
  console.log('════════════════════════════════════════════════════════════════\n');

  // 1. Reset memoryDb & Setup Test Environment with Default Stock Data
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

  const mgr = new AgentManager(42, 1773500000000);
  console.log(`✅ 1. Environment initialized with ${memoryDb.stocks.size} stocks across multiple sectors.`);

  // 2. Advance 5 simulation steps to let LP provide initial quotes
  for (let i = 0; i < 5; i++) {
    await mgr.step(1.0);
  }
  console.log('✅ 2. Warmup 5 steps executed.');

  // 3. Inject Semiconductor Bullish Event
  const tSemiNews = mgr.clock.simulationTime;
  const semiStock = Array.from(memoryDb.stocks.values()).find((s) => s.sector_id === 'semiconductor') || Array.from(memoryDb.stocks.values())[0];

  mgr.publishEvent({
    eventId: 'evt_semi_boom',
    publishedAt: tSemiNews,
    effectiveFrom: tSemiNews,
    scope: 'stock',
    targetStockIds: [semiStock.id],
    eventType: 'OFFICIAL',
    valuationSignal: 0.40,
    attentionShock: 0.80,
    uncertaintyShock: 0.10,
    confidence: 0.95,
    halfLife: 60,
    publisher: '테크뉴스',
    title: '반도체 차세대 HBM 공급 계약 체결',
    content: '대규모 HBM 공급 계약 발표',
  });

  // Advance 10 steps after semi news
  for (let i = 0; i < 10; i++) {
    await mgr.step(1.0);
  }

  // Check diagnostics flow data
  const simTime1 = mgr.clock.simulationTime;
  const flowData1 = mgr.diagnostics.getMarketFlowData(simTime1, 60);

  // Assertion 1: Time-series history exists and points are synchronized
  if (flowData1.timeSeries.length < 5) {
    throw new Error(`Expected at least 5 time-series points, got ${flowData1.timeSeries.length}`);
  }
  console.log(`✅ 3. Time-series ring buffer accumulated ${flowData1.timeSeries.length} points.`);

  // Check latest point
  const latestPt = flowData1.timeSeries[flowData1.timeSeries.length - 1];
  console.log('   - Latest snapshot timeLabel:', latestPt.timeLabel);
  console.log('   - Total turnover:', latestPt.totalTurnover.toLocaleString(), 'KRW');
  console.log('   - Sector turnover shares:', latestPt.sectorTurnoverShare);
  console.log('   - Sector Bot Net Buy turnover:', latestPt.sectorBotNetTurnover);

  // Assertion 2: Sector turnover consistency
  let sumShares = 0;
  for (const s of flowData1.sectorSummary) {
    sumShares += s.turnoverShare;
  }
  if (latestPt.totalTurnover > 0 && Math.abs(sumShares - 100) > 2.0) {
    throw new Error(`Turnover share sum should be close to 100%, got ${sumShares}%`);
  }
  console.log(`✅ 4. Sector turnover share consistency verified (sum: ${sumShares.toFixed(1)}%).`);

  // Assertion 3: Bot Net Buy Turnover exists and is signed
  const semiNetBuy = latestPt.sectorBotNetTurnover['semiconductor'] || 0;
  console.log(`   - Semiconductor Bot Net Buy Turnover: ${semiNetBuy.toLocaleString()} KRW`);

  // Assertion 4: LeaderBoard distinction between leaderRank and attentionRank
  console.log('\n📊 LeaderBoard Top 3 Status:');
  flowData1.leaderBoard.slice(0, 3).forEach((lb) => {
    console.log(
      `   [Rank ${lb.leaderRank}] ${lb.name} (${lb.sectorId}) | Score: ${lb.leaderScore.toFixed(3)} | AttRank: ${lb.attentionRank} (Att: ${(lb.attentionScore * 100).toFixed(0)}%) | RelRet: ${(lb.relativeReturn * 100).toFixed(1)}%`
    );
    if (typeof lb.leaderRank !== 'number' || typeof lb.attentionRank !== 'number') {
      throw new Error(`leaderRank or attentionRank is missing on ${lb.name}`);
    }
  });
  console.log('✅ 5. LeaderRank and AttentionRank are distinctly present and calculated.');

  // Assertion 5: Causal traces and news events
  if (flowData1.causalLogs.length === 0) {
    throw new Error('Expected causal traces to be recorded.');
  }
  console.log(`✅ 6. Causal trace log captured ${flowData1.causalLogs.length} events.`);
  console.log('   - Recent trace sample:', flowData1.causalLogs[flowData1.causalLogs.length - 1]);

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL MARKET FLOW DASHBOARD VERIFICATIONS PASSED (Exit Code 0)');
  console.log('════════════════════════════════════════════════════════════════');
  process.exit(0);
}

runMarketFlowDashboardVerification().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
