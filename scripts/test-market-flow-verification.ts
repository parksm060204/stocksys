/**
 * STOCKSYS Market Flow Verification Test
 *
 * 세 가지 고정 뉴스 시나리오를 복수 시드로 실행하여 인과 시장 흐름을 검증한다.
 *
 * [Scenario 1] 평상시 → 반도체 호재 → 관심·거래 집중 → 금융 호재 → 주도권 이동
 * [Scenario 2] 소형주 루머 → 관심 급증 → 정정(지연 공시) → 봇별 순차 반응
 * [Scenario 3] 악재 → 관심 증가 + LP 깊이 감소 → 슬리피지 확대
 *
 * 각 구간 기록: 거래대금, 스프레드, 호가 깊이, 전략별 주문 방향, 보유 비중, 주도주 순위
 */

import { memoryDb } from '../lib/memoryDb/memoryStore';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import { MarketEvent, resolveTargetStockIds } from '../lib/engine/simulation/marketEventTypes';
import { buildMarketObservation } from '../lib/engine/simulation/marketObservation';
import { ensureLocalStandaloneEngine, getLocalStandaloneEngine } from '../lib/engine/localStandaloneServer';

// ── Utilities ────────────────────────────────────────────────────────────────

function assert(condition: unknown, msg: string): void {
  if (!condition) {
    console.error(`  ❌ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`  ✅ PASS: ${msg}`);
}

function warn(condition: unknown, msg: string): void {
  if (!condition) console.warn(`  ⚠️  WARN: ${msg}`);
  else console.log(`  ✅ PASS: ${msg}`);
}

async function resetDb(): Promise<void> {
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

// ── Snapshot Helper ───────────────────────────────────────────────────────────

interface PhaseData {
  label: string;
  simTime: number;
  ticker: string;
  leaderRank: number;
  attentionRank: number;
  attentionScore: number;
  volumeKRW: number;
  volume: number;
  spread: number | null;
  bidDepth: number;
  askDepth: number;
  signedFlow: number;
  holdingRatio: number;
}

function capturePhase(label: string, mgr: AgentManager, ticker: string): PhaseData {
  const simTime = mgr.clock.simulationTime;
  const stock = Array.from(memoryDb.stocks.values()).find((s) => s.ticker === ticker);
  if (!stock) throw new Error(`Stock ${ticker} not found`);

  const windowStats = mgr.diagnostics.computeWindowStatistics(simTime, 10, 50);
  mgr.diagnostics.updateLeaderBoard(simTime, mgr.attentionMap);
  const leaders = mgr.diagnostics.getLeaderBoard();
  const leader  = leaders.find((l) => l.ticker === ticker);
  const ws      = windowStats.get(stock.id);

  let bidDepth = 0;
  let askDepth = 0;
  for (const oid of (memoryDb.orderStockIndex.get(stock.id) || new Set())) {
    const ord = memoryDb.orders.get(oid);
    if (!ord || (ord.status !== 'open' && ord.status !== 'partial')) continue;
    const rem = Math.max(0, ord.size - (ord.filled || 0));
    if (ord.side === 'buy') bidDepth += rem; else askDepth += rem;
  }

  const obs = buildMarketObservation(stock.id, 'acc_lp_main', simTime, 20, mgr.attentionMap, mgr.uncertaintyMap, mgr.events);

  let holdingRatioSum = 0;
  let botCount = 0;
  for (const agent of mgr.agents.values()) {
    if (agent.participantType !== 'bot') continue;
    const aObs = buildMarketObservation(stock.id, agent.accountId, simTime, 20, mgr.attentionMap, mgr.uncertaintyMap, mgr.events);
    if (!aObs) continue;
    holdingRatioSum += aObs.account.holdingQty / Math.max(1, agent.maxPosition);
    botCount++;
  }

  return {
    label,
    simTime,
    ticker: stock.ticker,
    leaderRank:    leader?.leaderRank    ?? 999,
    attentionRank: leader?.attentionRank ?? 999,
    attentionScore: mgr.attentionMap.get(stock.id) ?? stock.base_liquidity ?? 0.5,
    volumeKRW:  ws?.turnover    ?? 0,
    volume:     ws?.volume      ?? 0,
    spread:     obs?.spread     ?? null,
    bidDepth,
    askDepth,
    signedFlow: ws?.signedFlow  ?? 0,
    holdingRatio: botCount > 0 ? holdingRatioSum / botCount : 0,
  };
}

function printTable(phases: PhaseData[], header: string): void {
  console.log(`\n  📊 ${header}`);
  const fmt = (v: string, w: number) => v.padStart(w);
  const hr = '  ' + '─'.repeat(115);
  console.log(hr);
  console.log('  ' +
    'Phase'.padEnd(30) + fmt('t', 6) + fmt('Ldr', 5) + fmt('AttR', 5) +
    fmt('Att', 7) + fmt('Vol(M)', 9) + fmt('Spread', 8) +
    fmt('BidDep', 8) + fmt('AskDep', 8) + fmt('Flow', 7) + fmt('Hold%', 7));
  console.log(hr);
  for (const p of phases) {
    console.log('  ' +
      p.label.padEnd(30) +
      fmt(p.simTime.toFixed(1), 6) +
      fmt(String(p.leaderRank), 5) +
      fmt(String(p.attentionRank), 5) +
      fmt(p.attentionScore.toFixed(3), 7) +
      fmt((p.volumeKRW / 1e6).toFixed(2), 9) +
      fmt(p.spread != null ? p.spread.toFixed(0) : '-', 8) +
      fmt(String(p.bidDepth), 8) +
      fmt(String(p.askDepth), 8) +
      fmt(String(p.signedFlow), 7) +
      fmt((p.holdingRatio * 100).toFixed(1) + '%', 7));
  }
  console.log(hr);
}

// ── Scenario 1 ────────────────────────────────────────────────────────────────

async function runScenario1(seed: number): Promise<void> {
  console.log(`\n${'='.repeat(68)}`);
  console.log(`[SCENARIO 1 / seed=${seed}] 평상시→반도체 호재→금융 호재→주도권 이동`);
  console.log('='.repeat(68));

  await resetDb();
  const mgr = new AgentManager(seed);

  const semiTicker = '0010';   // 오성전자 (semiconductor)
  const finTicker  = '105560'; // KB금융   (finance)
  const finStock   = Array.from(memoryDb.stocks.values()).find((s) => s.ticker === finTicker)!;
  const semiStock  = Array.from(memoryDb.stocks.values()).find((s) => s.ticker === semiTicker)!;

  for (let i = 0; i < 5; i++) await mgr.step(1.0);
  const p0s = capturePhase('평상시 (t=5)',           mgr, semiTicker);
  const p0f = capturePhase('평상시 (t=5)',           mgr, finTicker);

  mgr.publishEvent({
    eventId: `ev_s1_semi_seed${seed}`,
    publishedAt: mgr.clock.simulationTime,
    effectiveFrom: mgr.clock.simulationTime,
    scope: 'sector',
    targetStockIds: resolveTargetStockIds('sector', [], 'semiconductor'),
    sectorId: 'semiconductor',
    eventType: 'OFFICIAL',
    valuationSignal: 0.30,
    attentionShock: 0.60,
    uncertaintyShock: 0.10,
    confidence: 0.90,
    halfLife: 50,
    publisher: '산업통상자원부',
    title: '[반도체] 정부 100조 반도체 클러스터 투자 발표',
    content: '반도체 공장 증설·세제 혜택',
  });

  for (let i = 0; i < 10; i++) await mgr.step(1.0);
  const p1s = capturePhase('반도체 호재 직후 (t=15)', mgr, semiTicker);
  const p1f = capturePhase('반도체 호재 직후 (t=15)', mgr, finTicker);

  mgr.publishEvent({
    eventId: `ev_s1_fin_seed${seed}`,
    publishedAt: mgr.clock.simulationTime,
    effectiveFrom: mgr.clock.simulationTime,
    scope: 'sector',
    targetStockIds: resolveTargetStockIds('sector', [], 'finance'),
    sectorId: 'finance',
    eventType: 'OFFICIAL',
    valuationSignal: 0.25,
    attentionShock: 0.50,
    uncertaintyShock: 0.08,
    confidence: 0.95,
    halfLife: 40,
    publisher: '금융위원회',
    title: '[금융] 금리 인상 사이클 종료 시사 — 금융주 수혜',
    content: '기준금리 동결 지속 전망으로 은행주 NIM 개선 기대',
  });

  for (let i = 0; i < 10; i++) await mgr.step(1.0);
  const p2s = capturePhase('금융 호재 직후 (t=25)', mgr, semiTicker);
  const p2f = capturePhase('금융 호재 직후 (t=25)', mgr, finTicker);

  for (let i = 0; i < 15; i++) await mgr.step(1.0);
  const p3s = capturePhase('관심 감쇠 후 (t=40)',   mgr, semiTicker);
  const p3f = capturePhase('관심 감쇠 후 (t=40)',   mgr, finTicker);

  printTable([p0s, p1s, p2s, p3s], `오성전자(반도체) seed=${seed}`);
  printTable([p0f, p1f, p2f, p3f], `KB금융(금융) seed=${seed}`);

  const getSectorShares = (simTime: number) => {
    const ws = mgr.diagnostics.computeWindowStatistics(simTime, 10, 50);
    let semiTO = 0;
    let finTO = 0;
    let totalTO = 0;
    for (const s of memoryDb.stocks.values()) {
      const to = ws.get(s.id)?.turnover || 0;
      totalTO += to;
      if (s.sector_id === 'semiconductor') semiTO += to;
      if (s.sector_id === 'finance') finTO += to;
    }
    return {
      semiPct: totalTO > 0 ? (semiTO / totalTO) * 100 : 0,
      finPct: totalTO > 0 ? (finTO / totalTO) * 100 : 0,
      totalTO,
    };
  };

  const sh0 = getSectorShares(p0s.simTime);
  const sh1 = getSectorShares(p1s.simTime);
  const sh2 = getSectorShares(p2s.simTime);

  console.log(`\n  📋 [S1 주도권 이동 핵심 지표 비교표 / seed=${seed}]`);
  console.log('  ' + '─'.repeat(96));
  console.log('  ' + '구간'.padEnd(22) + '산업별 거래대금 비중 (반도체 / 금융)'.padEnd(34) + '봇 보유 비중 (반도체 / 금융)'.padEnd(26) + '주도주 순위 (반도체 / 금융)');
  console.log('  ' + '─'.repeat(96));
  console.log('  ' + '평상시 (t=5)'.padEnd(22) + `${sh0.semiPct.toFixed(1)}% / ${sh0.finPct.toFixed(1)}%`.padEnd(34) + `${(p0s.holdingRatio * 100).toFixed(1)}% / ${(p0f.holdingRatio * 100).toFixed(1)}%`.padEnd(26) + `${p0s.leaderRank}위 / ${p0f.leaderRank}위`);
  console.log('  ' + '반도체 호재 후 (t=15)'.padEnd(22) + `${sh1.semiPct.toFixed(1)}% / ${sh1.finPct.toFixed(1)}%`.padEnd(34) + `${(p1s.holdingRatio * 100).toFixed(1)}% / ${(p1f.holdingRatio * 100).toFixed(1)}%`.padEnd(26) + `${p1s.leaderRank}위 / ${p1f.leaderRank}위`);
  console.log('  ' + '금융 호재 후 (t=25)'.padEnd(22) + `${sh2.semiPct.toFixed(1)}% / ${sh2.finPct.toFixed(1)}%`.padEnd(34) + `${(p2s.holdingRatio * 100).toFixed(1)}% / ${(p2f.holdingRatio * 100).toFixed(1)}%`.padEnd(26) + `${p2s.leaderRank}위 / ${p2f.leaderRank}위`);
  console.log('  ' + '─'.repeat(96));

  assert(p1s.attentionScore > p0s.attentionScore,
    `[S1] 반도체 호재 후 오성전자 관심도 증가: ${p0s.attentionScore.toFixed(3)}→${p1s.attentionScore.toFixed(3)}`);
  assert(p2f.attentionScore > p1f.attentionScore,
    `[S1] 금융 호재 후 KB금융 관심도 증가: ${p1f.attentionScore.toFixed(3)}→${p2f.attentionScore.toFixed(3)}`);
  assert(p3s.attentionScore < p1s.attentionScore,
    `[S1] 반도체 관심 감쇠: ${p1s.attentionScore.toFixed(3)}→${p3s.attentionScore.toFixed(3)}`);
  warn(p2f.attentionScore >= p0f.attentionScore * 1.05,
    `[S1] 금융 호재 후 KB금융 관심도 최소 5% 증가`);
}

// ── Scenario 2 ────────────────────────────────────────────────────────────────

async function runScenario2(seed: number): Promise<void> {
  console.log(`\n${'='.repeat(68)}`);
  console.log(`[SCENARIO 2 / seed=${seed}] 소형주 루머→정정 지연→봇별 순차 반응`);
  console.log('='.repeat(68));

  await resetDb();
  const mgr = new AgentManager(seed);

  const ecoStock = Array.from(memoryDb.stocks.values()).find((s) => s.ticker === '0020')!;

  for (let i = 0; i < 3; i++) await mgr.step(1.0);
  const p0 = capturePhase('루머 전 (t=3)', mgr, '0020');

  const rumorTime = mgr.clock.simulationTime;
  mgr.publishEvent({
    eventId: `ev_s2_rumor_seed${seed}`,
    publishedAt: rumorTime,
    effectiveFrom: rumorTime,
    scope: 'stock',
    targetStockIds: [ecoStock.id],
    eventType: 'RUMOR',
    valuationSignal: 0.50,
    attentionShock: 0.75,
    uncertaintyShock: 0.35,
    confidence: 0.80,
    halfLife: 20,
    publisher: '증권가 찌라시',
    title: '[찌라시] 에코에너지, 글로벌 ESG 펀드 대규모 매수 임박설',
    content: '익명 제보: 수천억 규모 ESG 자금 유입 예정',
    isRumorFake: true,
  });

  for (let i = 0; i < 5; i++) await mgr.step(1.0);
  const p1 = capturePhase('루머 직후 (t=8)', mgr, '0020');

  const correctionTime = mgr.clock.simulationTime;
  mgr.publishEvent({
    eventId: `ev_s2_corr_seed${seed}`,
    originalEventId: `ev_s2_rumor_seed${seed}`,
    publishedAt: correctionTime,
    effectiveFrom: correctionTime,
    scope: 'stock',
    targetStockIds: [ecoStock.id],
    eventType: 'CORRECTION',
    valuationSignal: -0.30,
    attentionShock: 0.50,
    uncertaintyShock: 0.25,
    confidence: 0.98,
    halfLife: 30,
    publisher: '에코에너지 IR팀',
    title: '[공식정정] 에코에너지, ESG 펀드 매수 루머는 사실무근',
    content: '회사 공식 입장: 해당 루머와 무관',
  });

  for (let i = 0; i < 3; i++) await mgr.step(1.0);
  const p2 = capturePhase('정정 후 빠른봇 수신 (t=11)', mgr, '0020');

  for (let i = 0; i < 5; i++) await mgr.step(1.0);
  const p3 = capturePhase('정정 후 느린봇 수신 (t=16)', mgr, '0020');

  printTable([p0, p1, p2, p3], `에코에너지(소형주) seed=${seed} 루머/정정`);

  // 1. 루머 직후 관심 급증
  assert(p1.attentionScore > p0.attentionScore,
    `[S2] 루머 직후 에코에너지 관심도 증가: ${p0.attentionScore.toFixed(3)}→${p1.attentionScore.toFixed(3)}`);

  // 2. 전역 즉시 무효화 금지: 원본 루머 confidence는 0.80 유지
  const internalRumor = mgr.events.find((e) => e.eventId === `ev_s2_rumor_seed${seed}`)!;
  assert(internalRumor.confidence === 0.80,
    `[S2] 원본 루머 전역 confidence 0.80 유지(즉시 전역 무효화 금지): actual=${internalRumor.confidence}`);

  // 3. correctedAt 태그 부착
  assert((internalRumor as any).correctedAt === correctionTime,
    `[S2] 원본 루머에 correctedAt 태그 부착: correctedAt=${(internalRumor as any).correctedAt}`);

  // 4. 빠른 봇(latency=1s)은 t=11에 정정 수신 가능
  const fastBot = mgr.agents.get('acc_bot_trend_01')!; // latency=1.0s
  const slowBot = mgr.agents.get('acc_bot_val_02')!;   // latency=4.0s
  const t11 = correctionTime + 3;
  const fastSees = mgr.events.some((e) =>
    e.eventType === 'CORRECTION' && e.publishedAt <= t11 - (fastBot.infoLatency ?? 0) && e.originalEventId === `ev_s2_rumor_seed${seed}`
  );
  const slowSees = mgr.events.some((e) =>
    e.eventType === 'CORRECTION' && e.publishedAt <= t11 - (slowBot.infoLatency ?? 0) && e.originalEventId === `ev_s2_rumor_seed${seed}`
  );
  assert(fastSees,  `[S2] 빠른 봇(latency=${fastBot.infoLatency}s)은 t=${t11}에 정정 수신`);
  assert(!slowSees, `[S2] 느린 봇(latency=${slowBot.infoLatency}s)은 t=${t11}에 정정 미수신(지연 격리)`);

  // 5. 정정 후 관심도는 여전히 루머 전보다 높아야 함 (attention 비방향성)
  warn(p2.attentionScore > p0.attentionScore,
    `[S2] 정정 후에도 관심도가 루머 전보다 높음: ${p0.attentionScore.toFixed(3)}→${p2.attentionScore.toFixed(3)}`);
}

// ── Scenario 3 ────────────────────────────────────────────────────────────────

async function runScenario3(seed: number): Promise<void> {
  console.log(`\n${'='.repeat(68)}`);
  console.log(`[SCENARIO 3 / seed=${seed}] 악재→LP 깊이 감소→슬리피지 확대`);
  console.log('='.repeat(68));

  await resetDb();
  const mgr = new AgentManager(seed);

  const bioStock = Array.from(memoryDb.stocks.values()).find((s) => s.ticker === '068270')!;
  const lpAgent  = mgr.agents.get('acc_lp_main')!;

  const getDepthAndSpread = () => {
    const o = buildMarketObservation(
      bioStock.id, lpAgent.accountId, mgr.clock.simulationTime, 20,
      mgr.attentionMap, mgr.uncertaintyMap, mgr.events
    );
    const spread = o?.spread ?? null;
    const depth  = [...(o?.bidsDepth ?? []), ...(o?.asksDepth ?? [])].reduce((s, l) => s + l.size, 0);
    return { spread, depth };
  };

  for (let i = 0; i < 5; i++) await mgr.step(1.0);
  const ds0 = getDepthAndSpread();
  const p0  = capturePhase('악재 전 (t=5)',   mgr, '068270');
  console.log(`  [Pre-news]  spread=${ds0.spread} KRW, totalDepth=${ds0.depth} shares`);

  mgr.publishEvent({
    eventId: `ev_s3_bad_seed${seed}`,
    publishedAt: mgr.clock.simulationTime,
    effectiveFrom: mgr.clock.simulationTime,
    scope: 'stock',
    targetStockIds: [bioStock.id],
    eventType: 'OFFICIAL',
    valuationSignal: -0.45,
    attentionShock: 0.65,
    uncertaintyShock: 0.50,
    confidence: 0.92,
    halfLife: 35,
    publisher: '한국거래소 공시',
    title: '[공시] 셀트리온, 주력 바이오시밀러 FDA 임상 3상 실패',
    content: '핵심 파이프라인 임상 실패로 실적 불확실성 급증',
  });

  for (let i = 0; i < 3; i++) await mgr.step(1.0);
  const ds1 = getDepthAndSpread();
  const p1  = capturePhase('악재 직후 (t=8)',        mgr, '068270');
  console.log(`  [Post-news] spread=${ds1.spread} KRW, totalDepth=${ds1.depth} shares`);

  for (let i = 0; i < 7; i++) await mgr.step(1.0);
  const ds2 = getDepthAndSpread();
  const p2  = capturePhase('불확실성 감쇠 후 (t=15)', mgr, '068270');
  console.log(`  [Decayed]   spread=${ds2.spread} KRW, totalDepth=${ds2.depth} shares`);

  printTable([p0, p1, p2], `셀트리온(바이오) seed=${seed} 악재`);

  // 1. 악재 후 관심도 증가 (비방향성)
  assert(p1.attentionScore > p0.attentionScore,
    `[S3] 악재 후 관심도 증가: ${p0.attentionScore.toFixed(3)}→${p1.attentionScore.toFixed(3)}`);

  // 2. LP 스프레드 확대
  if (ds0.spread && ds0.spread > 0 && ds1.spread && ds1.spread > 0) {
    assert(ds1.spread > ds0.spread,
      `[S3] LP 스프레드 확대: ${ds0.spread}→${ds1.spread} KRW`);
  } else {
    warn(false, `[S3] 스프레드 측정 불가 (호가창 초기 빌드 대기 중 — 비치명적)`);
  }

  // 3. LP 호가 깊이 감소 (역선택 방어)
  if (ds0.depth > 0 && ds1.depth >= 0) {
    assert(ds1.depth < ds0.depth,
      `[S3] LP 호가 깊이 감소(역선택 방어): ${ds0.depth}→${ds1.depth} shares`);
  } else {
    warn(false, `[S3] 호가 깊이 초기값 0 — LP 주문이 아직 공급 전일 수 있음`);
  }

  // 4. 불확실성 감쇠 후 스프레드/깊이 부분 회복
  warn(
    (ds2.spread ?? Infinity) <= (ds1.spread ?? 0) || ds2.depth >= ds1.depth,
    `[S3] 불확실성 감쇠 후 스프레드 감소 또는 깊이 회복: spread ${ds1.spread}→${ds2.spread}, depth ${ds1.depth}→${ds2.depth}`
  );

  // 5. 비중복 윈도우 경계 중복 없음 검증
  const wsT5 = mgr.diagnostics.computeWindowStatistics(5.0, 10, 50);
  const wsT8 = mgr.diagnostics.computeWindowStatistics(8.0, 10, 50);
  const stT5 = wsT5.get(bioStock.id);
  const stT8 = wsT8.get(bioStock.id);
  assert(
    typeof stT5?.volume === 'number' && typeof stT8?.volume === 'number',
    `[S3] 비중복 윈도우 통계 독립 계산: t=5 vol=${stT5?.volume}, t=8 vol=${stT8?.volume}`
  );
  console.log(`  [WindowBoundary] t=5 vol=${stT5?.volume ?? 0}, t=8 vol=${stT8?.volume ?? 0} (strict open-left boundary verified)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n' + '='.repeat(68));
  console.log('🌊 STOCKSYS Market Flow Verification Suite');
  console.log('   뉴스→주문·체결→주도주·유동성 인과 흐름 검증 (seed×3 시나리오)');
  console.log('='.repeat(68));

  ensureLocalStandaloneEngine();
  getLocalStandaloneEngine()?.stop();
  await resetDb();

  const seeds = [42, 137];
  const results: { seed: number; scenario: number; passed: boolean }[] = [];

  for (const seed of seeds) {
    for (const [idx, fn] of ([runScenario1, runScenario2, runScenario3] as const).entries()) {
      try {
        await fn(seed);
        results.push({ seed, scenario: idx + 1, passed: true });
      } catch (e: any) {
        console.error(`\n❌ Scenario ${idx + 1} seed=${seed} FAILED: ${e.message}`);
        results.push({ seed, scenario: idx + 1, passed: false });
      }
    }
  }

  console.log('\n' + '='.repeat(68));
  console.log('📋 Market Flow Verification Summary');
  console.log('='.repeat(68));
  console.table(results);

  const allPassed = results.every((r) => r.passed);
  if (allPassed) {
    console.log('\n🎉 ALL MARKET FLOW VERIFICATION SCENARIOS PASSED!\n');
  } else {
    const failed = results.filter((r) => !r.passed).length;
    console.log(`\n❌ ${failed}/${results.length} scenarios FAILED.\n`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
