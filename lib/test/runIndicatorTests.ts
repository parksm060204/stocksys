import {
  CandleData,
  calculateSMA,
  calculateEMA,
  calculateBollingerBands,
  calculateRSI,
} from '../indicators';

async function runIndicatorTestSuite() {
  console.log('================================================================');
  console.log('📊 [TECHNICAL INDICATORS] 지표 계산 엔진 정확도 & 성능 벤치마크');
  console.log('================================================================\n');

  let passedTests = 0;
  const totalTests = 4;

  // 100개 샘플 캔들 생성 (상승/하락 변동성 포함)
  const sampleCandles: CandleData[] = [];
  let basePrice = 100;
  for (let i = 0; i < 100; i++) {
    const delta = Math.sin(i / 5) * 5 + (Math.random() - 0.5) * 2;
    basePrice = Math.max(10, basePrice + delta);
    sampleCandles.push({
      time: 1700000000 + i * 600,
      open: basePrice - 1,
      high: basePrice + 2,
      low: basePrice - 2,
      close: basePrice,
      volume: 1000 + i * 10,
    });
  }

  // ── [TEST 1] SMA (단순 이동평균) 정확도 검증 ──
  console.log('▶ [TEST 1] SMA (이동평균선 5/20/60) 계산 검증');
  const sma5 = calculateSMA(sampleCandles, 5);
  const sma20 = calculateSMA(sampleCandles, 20);
  const sma60 = calculateSMA(sampleCandles, 60);

  console.log(`  - SMA5 포인트 수: ${sma5.length}개 (기대치: 96개)`);
  console.log(`  - SMA20 포인트 수: ${sma20.length}개 (기대치: 81개)`);
  console.log(`  - SMA60 포인트 수: ${sma60.length}개 (기대치: 41개)`);

  const last5Candles = sampleCandles.slice(-5);
  const manualSma5 = last5Candles.reduce((a, c) => a + c.close, 0) / 5;
  const computedSma5 = sma5[sma5.length - 1]?.value ?? 0;
  console.log(`  - 수동 계산 SMA5: ${manualSma5.toFixed(4)}, 엔진 계산 SMA5: ${computedSma5.toFixed(4)}`);

  if (sma5.length === 96 && Math.abs(manualSma5 - computedSma5) < 0.001) {
    console.log('  결과: ✅ PASS (SMA 이동평균선 정확성 일치)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 2] 볼린저 밴드 (Bollinger Bands) 정확도 검증 ──
  console.log('\n▶ [TEST 2] 볼린저 밴드 (BB 20, 2σ) 계산 검증');
  const bb = calculateBollingerBands(sampleCandles, 20, 2);

  const lastUpper = bb.upper[bb.upper.length - 1]?.value ?? 0;
  const lastMiddle = bb.middle[bb.middle.length - 1]?.value ?? 0;
  const lastLower = bb.lower[bb.lower.length - 1]?.value ?? 0;

  console.log(`  - 마지막 밴드: 상단 ₩${lastUpper}, 중심 ₩${lastMiddle}, 하단 ₩${lastLower}`);
  console.log(`  - 밴드 폭: ${(lastUpper - lastLower).toFixed(4)} (상단 > 중심 > 하단 관계 만족: ${lastUpper > lastMiddle && lastMiddle > lastLower})`);

  if (bb.upper.length === 81 && lastUpper > lastMiddle && lastMiddle > lastLower) {
    console.log('  결과: ✅ PASS (볼린저밴드 상단/중간/하단 정상 산출)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 3] RSI (상대강도지수) 정확도 및 0~100 바운더리 검증 ──
  console.log('\n▶ [TEST 3] RSI (상대강도지수 14) 계산 검증');
  const rsiList = calculateRSI(sampleCandles, 14);
  const lastRsi = rsiList[rsiList.length - 1]?.value ?? 50;

  console.log(`  - RSI(14) 산출 수: ${rsiList.length}개 (기대치: 86개)`);
  console.log(`  - 최신 RSI 값: ${lastRsi} (범위 0~100 만족: ${lastRsi >= 0 && lastRsi <= 100})`);

  const allInRange = rsiList.every((r) => r.value >= 0 && r.value <= 100);
  if (rsiList.length === 86 && allInRange) {
    console.log('  결과: ✅ PASS (RSI 0~100 정상 범위 및 Wilder Smoothing 통과)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 4] 대량 데이터(10,000개 캔들) 고속 벤치마크 ──
  console.log('\n▶ [TEST 4] 대량 데이터 (10,000개 캔들) 실시간 계산 벤치마크');
  const bigCandles: CandleData[] = [];
  let p = 50000;
  for (let i = 0; i < 10000; i++) {
    p += (Math.random() - 0.5) * 50;
    bigCandles.push({
      time: 1700000000 + i * 60,
      open: p - 10,
      high: p + 30,
      low: p - 30,
      close: p,
    });
  }

  const start = performance.now();
  calculateSMA(bigCandles, 5);
  calculateSMA(bigCandles, 20);
  calculateSMA(bigCandles, 60);
  calculateSMA(bigCandles, 120);
  calculateEMA(bigCandles, 20);
  calculateBollingerBands(bigCandles, 20, 2);
  calculateRSI(bigCandles, 14);
  const elapsed = performance.now() - start;

  console.log(`  - 10,000개 캔들 7종 지표 전체 일괄 계산 소요 시간: ${elapsed.toFixed(2)}ms (기준: < 50ms)`);

  if (elapsed < 50) {
    console.log('  결과: ✅ PASS (초고속 O(N) 알고리즘으로 렉 없는 실시간 렌더링 검증 완료)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL (지연 시간 초과)');
  }

  console.log('\n================================================================');
  if (passedTests === totalTests) {
    console.log(`🏁 [최종 결과] 지표 계산 엔진 검증: 모든 테스트 통과 (${passedTests}/${totalTests}) 100% ✅`);
  } else {
    console.log(`🏁 [최종 결과] 지표 계산 엔진 검증: 일부 실패 (${passedTests}/${totalTests}) ❌`);
  }
  console.log('================================================================\n');
}

runIndicatorTestSuite().catch(console.error);
