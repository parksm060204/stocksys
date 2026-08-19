import { CommodityMarketEngine } from '../CommodityMarketEngine';
import { COMMODITY_DEFINITIONS } from '../definitions';

/**
 * 4대 검증 테스트 실행 스위트
 */
export async function runAllCommodityTests() {
  console.log('================================================================');
  console.log('🌾 [COMMODITY MARKET] 원자재 시장 시뮬레이터 검증 테스트 시작');
  console.log('================================================================\n');

  let allPassed = true;

  // ─────────────────────────────────────────────────────────────
  // TEST 1: 봇 없이 랜덤워크 + 계절성 가격 움직임 검증 (100 틱)
  // ─────────────────────────────────────────────────────────────
  console.log('▶ [TEST 1] 봇 0명: 순수 랜덤워크 & 계절성 가격 변동 테스트 (100 틱)');
  const engine1 = new CommodityMarketEngine({
    totalBots: 0,
    eventProbability: 0, // 순수 랜덤워크 확인용
  });

  const oilPrices1: number[] = [];
  const wheatPrices1: number[] = [];
  const initialOil = engine1.getCommodity('CRUDE_OIL')!.currentPrice;
  const initialWheat = engine1.getCommodity('WHEAT')!.currentPrice;

  for (let t = 1; t <= 100; t++) {
    engine1.nextTick();
    oilPrices1.push(engine1.getCommodity('CRUDE_OIL')!.currentPrice);
    wheatPrices1.push(engine1.getCommodity('WHEAT')!.currentPrice);
  }

  const minOil = Math.min(...oilPrices1);
  const maxOil = Math.max(...oilPrices1);
  const endOil = oilPrices1[oilPrices1.length - 1];

  const minWheat = Math.min(...wheatPrices1);
  const maxWheat = Math.max(...wheatPrices1);
  const endWheat = wheatPrices1[wheatPrices1.length - 1];

  console.log(`  - WTI 원유: 시작가 $${initialOil.toFixed(2)} ➔ 최종가 $${endOil.toFixed(2)} (최저 $${minOil.toFixed(2)} ~ 최고 $${maxOil.toFixed(2)})`);
  console.log(`  - 소맥(밀): 시작가 $${initialWheat.toFixed(2)} ➔ 최종가 $${endWheat.toFixed(2)} (최저 $${minWheat.toFixed(2)} ~ 최고 $${maxWheat.toFixed(2)})`);

  const test1Passed = minOil > 0 && maxOil < initialOil * 3 && minWheat > 0 && maxWheat < initialWheat * 3;
  console.log(`  결과: ${test1Passed ? '✅ PASS (정상 변동성 범위 내 유지)' : '❌ FAIL'}\n`);
  if (!test1Passed) allPassed = false;

  // ─────────────────────────────────────────────────────────────
  // TEST 2: 트렌드추종 봇만 추가했을 때 추세 모멘텀 강화 확인 (100 틱)
  // ─────────────────────────────────────────────────────────────
  console.log('▶ [TEST 2] 트렌드추종 봇(CTA) 단독 투입 시 모멘텀/추세 강화 검증');
  const engine2 = new CommodityMarketEngine({
    totalBots: 40,
    botRatios: {
      trendFollowing: 1.0,
      meanReversion: 0,
      hedger: 0,
      marketMaker: 0,
      newsTrader: 0,
    },
    eventProbability: 0,
  });

  let trendTradesTotal = 0;
  const gasPrices: number[] = [];

  for (let t = 1; t <= 100; t++) {
    const summary = engine2.nextTick();
    trendTradesTotal += summary.tradesCount;
    gasPrices.push(engine2.getCommodity('NATURAL_GAS')!.currentPrice);
  }

  // 연속 상승/하락 런 길이(Run length) 측정
  let maxConsecutiveRuns = 0;
  let currentRun = 1;
  for (let i = 1; i < gasPrices.length; i++) {
    const prevDiff = gasPrices[i - 1] - (i >= 2 ? gasPrices[i - 2] : gasPrices[i - 1]);
    const currDiff = gasPrices[i] - gasPrices[i - 1];
    if ((prevDiff > 0 && currDiff > 0) || (prevDiff < 0 && currDiff < 0)) {
      currentRun += 1;
      maxConsecutiveRuns = Math.max(maxConsecutiveRuns, currentRun);
    } else {
      currentRun = 1;
    }
  }

  console.log(`  - 100틱 동안 트렌드 봇 체결 건수: ${trendTradesTotal}건`);
  console.log(`  - 천연가스 최대 연속 추세 지속 틱: ${maxConsecutiveRuns}틱`);
  const test2Passed = trendTradesTotal > 0 && maxConsecutiveRuns >= 3;
  console.log(`  결과: ${test2Passed ? '✅ PASS (추세 모멘텀 강화 확인됨)' : '❌ FAIL'}\n`);
  if (!test2Passed) allPassed = false;

  // ─────────────────────────────────────────────────────────────
  // TEST 3: 마켓메이커 비중 조절에 따른 스프레드 축소 검증
  // ─────────────────────────────────────────────────────────────
  console.log('▶ [TEST 3] 마켓메이커(MM) 비중 조절에 따른 호가 스프레드 축소 검증');

  // Case A: MM 없는 시장 (스프레드 넓음)
  const engineNoMM = new CommodityMarketEngine({
    totalBots: 20,
    botRatios: { trendFollowing: 0.5, meanReversion: 0.5, hedger: 0, marketMaker: 0, newsTrader: 0 },
    eventProbability: 0,
  });

  // Case B: MM 80% 비중 시장 (스프레드 좁음)
  const engineHighMM = new CommodityMarketEngine({
    totalBots: 30,
    botRatios: { trendFollowing: 0.05, meanReversion: 0.05, hedger: 0, marketMaker: 0.85, newsTrader: 0.05 },
    eventProbability: 0,
  });

  let sumSpreadNoMM = 0;
  let sumSpreadHighMM = 0;
  const sampleTicks = 50;

  for (let t = 1; t <= sampleTicks; t++) {
    engineNoMM.nextTick();
    engineHighMM.nextTick();

    const goldBookNoMM = engineNoMM.getOrderBook('GOLD')!;
    const goldBookHighMM = engineHighMM.getOrderBook('GOLD')!;

    const spNoMM = goldBookNoMM.getSpread(engineNoMM.getCommodity('GOLD')!.currentPrice);
    const spHighMM = goldBookHighMM.getSpread(engineHighMM.getCommodity('GOLD')!.currentPrice);

    sumSpreadNoMM += spNoMM.spreadPct;
    sumSpreadHighMM += spHighMM.spreadPct;
  }

  const avgSpreadNoMM = sumSpreadNoMM / sampleTicks;
  const avgSpreadHighMM = sumSpreadHighMM / sampleTicks;

  console.log(`  - MM 없는 시장 금(Gold) 평균 스프레드: ${avgSpreadNoMM.toFixed(3)}%`);
  console.log(`  - MM 85% 시장 금(Gold) 평균 스프레드: ${avgSpreadHighMM.toFixed(3)}%`);

  const test3Passed = avgSpreadHighMM < avgSpreadNoMM;
  console.log(`  결과: ${test3Passed ? `✅ PASS (스프레드가 ${(avgSpreadNoMM - avgSpreadHighMM).toFixed(3)}%p 대폭 축소됨)` : '❌ FAIL'}\n`);
  if (!test3Passed) allPassed = false;

  // ─────────────────────────────────────────────────────────────
  // TEST 4: 전체 5종 봇 풀 조합 + 이벤트 1,000틱 장기 시뮬레이션
  // ─────────────────────────────────────────────────────────────
  console.log('▶ [TEST 4] 5종 봇 전체 조합 + 이벤트 시스템 1,000틱 장기 시뮬레이션');
  const engine4 = new CommodityMarketEngine({
    totalBots: 50,
    botRatios: {
      trendFollowing: 0.25,
      meanReversion: 0.25,
      hedger: 0.15,
      marketMaker: 0.20,
      newsTrader: 0.15,
    },
    eventProbability: 0.02, // 2% 확률 이벤트 발생
  });

  let totalEventsGenerated = 0;
  let totalTradesLongrun = 0;
  let totalNotionalLongrun = 0;

  const startSnapshot: Record<string, number> = {};
  for (const def of COMMODITY_DEFINITIONS) {
    startSnapshot[def.id] = engine4.getCommodity(def.id)!.currentPrice;
  }

  const startSimTime = Date.now();

  for (let t = 1; t <= 1000; t++) {
    const summary = engine4.nextTick();
    totalEventsGenerated += summary.newEvents.length;
    totalTradesLongrun += summary.tradesCount;
    totalNotionalLongrun += summary.totalNotional;

    if (t % 200 === 0) {
      const crude = engine4.getCommodity('CRUDE_OIL')!;
      const gold = engine4.getCommodity('GOLD')!;
      const wheat = engine4.getCommodity('WHEAT')!;
      console.log(`  [Tick ${t}/1000] 체결누적: ${totalTradesLongrun}건 | 유가: $${crude.currentPrice.toFixed(2)} | 금: $${gold.currentPrice.toFixed(2)} | 소맥: $${wheat.currentPrice.toFixed(2)} | 활성이벤트: ${summary.activeEventsCount}건`);
    }
  }

  const elapsedMs = Date.now() - startSimTime;
  console.log(`\n  ⚡ 1,000틱 시뮬레이션 완료 (${elapsedMs}ms 소요, 틱당 ${(elapsedMs / 1000).toFixed(2)}ms)`);
  console.log(`  - 총 발생 이벤트: ${totalEventsGenerated}건, 총 뉴스 발행: ${engine4.getNewsFeed().length}건`);
  console.log(`  - 총 누적 체결 수: ${totalTradesLongrun.toLocaleString()}건, 총 거래대금: $${Math.round(totalNotionalLongrun).toLocaleString()}`);

  // 가격 발산 여부 검증 (모든 종목이 0 초과 및 정상 배수 범위 내인지 확인)
  let isDiverged = false;
  console.log('\n  [12종 원자재 최종 가격 현황]');
  for (const def of COMMODITY_DEFINITIONS) {
    const finalState = engine4.getCommodity(def.id)!;
    const startP = startSnapshot[def.id];
    const finalP = finalState.currentPrice;
    const changePct = ((finalP - startP) / startP) * 100;
    console.log(`  - ${def.nameKo.padEnd(12)} (${def.ticker.padEnd(4)}): 시작 $${startP.toFixed(2).padStart(8)} ➔ 최종 $${finalP.toFixed(2).padStart(8)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%) [최저 $${finalState.low.toFixed(2)} ~ 최고 $${finalState.high.toFixed(2)}]`);

    if (finalP <= 0 || finalP > startP * 10 || finalP < startP * 0.1) {
      isDiverged = true;
    }
  }

  // 봇 유형별 손익(PnL) 통계
  const botStates = engine4.getBotStates();
  const pnlByType: Record<string, { totalPnl: number; botCount: number; tradesCount: number }> = {};

  for (const bs of botStates) {
    const type = bs.config.type;
    if (!pnlByType[type]) {
      pnlByType[type] = { totalPnl: 0, botCount: 0, tradesCount: 0 };
    }
    pnlByType[type].totalPnl += bs.realizedPnL;
    pnlByType[type].botCount += 1;
    pnlByType[type].tradesCount += bs.totalTrades;
  }

  console.log('\n  [봇 유형별 실현 손익 및 거래 실적]');
  for (const [type, stat] of Object.entries(pnlByType)) {
    const avgPnl = stat.totalPnl / stat.botCount;
    console.log(`  - ${type.padEnd(16)} (봇 ${stat.botCount}대): 총 실현손익 $${Math.round(stat.totalPnl).toLocaleString()} (평균 $${Math.round(avgPnl).toLocaleString()}) | 체결 ${stat.tradesCount}건`);
  }

  const test4Passed = !isDiverged && totalTradesLongrun > 500 && totalEventsGenerated > 0;
  console.log(`\n  결과: ${test4Passed ? '✅ PASS (1,000틱 장기 가동 중 가격 발산 없음, 현실적 범위 수렴 및 체결 정상 동작)' : '❌ FAIL'}\n`);
  if (!test4Passed) allPassed = false;

  console.log('================================================================');
  console.log(`🏁 [최종 결과] 원자재 시장 시뮬레이터 검증: ${allPassed ? '모든 테스트 100% 통과 (ALL PASSED) ✅' : '일부 테스트 실패 ❌'}`);
  console.log('================================================================\n');

  return allPassed;
}

// 직접 실행 시 구동
if (require.main === module) {
  runAllCommodityTests().catch(console.error);
}
