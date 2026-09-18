/**
 * scripts/test-news-correction-determinism.ts
 *
 * 정정 뉴스의 종목별 타겟 격리, 복수 정정 결정론적 정책, 및 MarketEvent 런타임 검증 스위트
 */

import { computeEffectiveNewsValuation } from '../lib/engine/simulation/strategies/valueStrategy';
import { ObservableMarketEvent, validateMarketEvent, MarketEvent } from '../lib/engine/simulation/marketEventTypes';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

async function runTests() {
  console.log('================================================================');
  console.log('  🧪 NEWS CORRECTION DETERMINISM & STOCK ISOLATION SUITE');
  console.log('================================================================\n');

  const stockA = 'stock_A';
  const stockB = 'stock_B';
  const stockC = 'stock_C';

  // ─────────────────────────────────────────────────────────────────
  // PART 1: 종목별 타겟 격리 검증 (Stock Isolation)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [PART 1] Stock Isolation: Specific stock correction must not pollute other stocks');

  // 1.1: 원본 대상 [A, B], 정정 대상 [A]
  const rumorAB: ObservableMarketEvent = {
    eventId: 'ev_rumor_ab',
    scope: 'stock',
    eventType: 'RUMOR',
    targetStockIds: [stockA, stockB],
    valuationSignal: 0.30,
    attentionShock: 0.5,
    uncertaintyShock: 0.2,
    confidence: 1.0,
    halfLife: 100000,
    publishedAt: 1000,
    effectiveFrom: 1000,
    publisher: 'MarketNews',
    title: 'A와 B의 합작 투자 루머',
    content: '대규모 합작 계획 소문',
  };

  const corrA: ObservableMarketEvent = {
    eventId: 'ev_corr_a_only',
    scope: 'stock',
    eventType: 'CORRECTION',
    correctionMode: 'RETRACT',
    originalEventId: 'ev_rumor_ab',
    targetStockIds: [stockA], // A에만 정정 적용
    valuationSignal: 0.0,
    attentionShock: 0.2,
    uncertaintyShock: 0.1,
    confidence: 1.0,
    halfLife: 100000,
    publishedAt: 2000,
    effectiveFrom: 2000,
    publisher: 'OfficialA',
    title: 'A사 부인 공시',
    content: 'A사는 해당 합작에 불참',
  };

  const valA = computeEffectiveNewsValuation([rumorAB, corrA], stockA, 2000);
  const valB = computeEffectiveNewsValuation([rumorAB, corrA], stockB, 2000);
  assert(Math.abs(valA) < 1e-9, `A: 정정 대상이므로 원본 루머 무효화되어 0이어야 함 (실제: ${valA})`);
  assert(Math.abs(valB - 0.30) < 0.001, `B: 정정 대상이 아니므로 원본 루머 신호(+0.30)가 그대로 유지되어야 함 (실제: ${valB})`);

  // 1.2: 원본 대상 [A], 정정 대상 [B]
  const rumorA: ObservableMarketEvent = {
    eventId: 'ev_rumor_a',
    scope: 'stock',
    eventType: 'RUMOR',
    targetStockIds: [stockA],
    valuationSignal: 0.30,
    attentionShock: 0.5,
    uncertaintyShock: 0.2,
    confidence: 1.0,
    halfLife: 100000,
    publishedAt: 1000,
    effectiveFrom: 1000,
    publisher: 'Rumor',
    title: 'A사 루머',
    content: 'A사 단독 호재',
  };

  const corrB: ObservableMarketEvent = {
    eventId: 'ev_corr_b',
    scope: 'stock',
    eventType: 'CORRECTION',
    correctionMode: 'RETRACT',
    originalEventId: 'ev_rumor_a',
    targetStockIds: [stockB], // 무관한 B 대상 정정
    valuationSignal: 0.0,
    attentionShock: 0.2,
    uncertaintyShock: 0.1,
    confidence: 1.0,
    halfLife: 100000,
    publishedAt: 2000,
    effectiveFrom: 2000,
    publisher: 'Official',
    title: 'B사 관련 공시',
    content: 'B사 내용',
  };

  const valA2 = computeEffectiveNewsValuation([rumorA, corrB], stockA, 2000);
  const valB2 = computeEffectiveNewsValuation([rumorA, corrB], stockB, 2000);
  assert(Math.abs(valA2 - 0.30) < 0.001, `A: B 대상 정정에 영향받지 않고 원본 유지(+0.30) (실제: ${valA2})`);
  assert(Math.abs(valB2) < 1e-9, `B: 원본 루머 대상이 아니므로 0 (실제: ${valB2})`);

  // 1.3: 시장/섹터 전체 루머 중 특정 종목만 정정
  const marketRumor: ObservableMarketEvent = {
    eventId: 'ev_market_rumor',
    scope: 'market',
    eventType: 'RUMOR',
    targetStockIds: [stockA, stockB, stockC],
    valuationSignal: -0.25,
    attentionShock: 0.7,
    uncertaintyShock: 0.3,
    confidence: 1.0,
    halfLife: 100000,
    publishedAt: 1000,
    effectiveFrom: 1000,
    publisher: 'Macro',
    title: '시장 전반 규제 악재 루머',
    content: '업계 전반 규제 소문',
  };

  const exemptCorrC: ObservableMarketEvent = {
    eventId: 'ev_corr_exempt_c',
    scope: 'stock',
    eventType: 'CORRECTION',
    correctionMode: 'RETRACT',
    originalEventId: 'ev_market_rumor',
    targetStockIds: [stockC], // C 종목만 규제 면제 정정
    valuationSignal: 0.0,
    attentionShock: 0.3,
    uncertaintyShock: 0.1,
    confidence: 1.0,
    halfLife: 100000,
    publishedAt: 2000,
    effectiveFrom: 2000,
    publisher: 'Ministry',
    title: 'C사 규제 대상 제외 확인',
    content: 'C사는 규제 대상 아님',
  };

  const valMarketA = computeEffectiveNewsValuation([marketRumor, exemptCorrC], stockA, 2000);
  const valMarketC = computeEffectiveNewsValuation([marketRumor, exemptCorrC], stockC, 2000);
  assert(Math.abs(valMarketA - (-0.25)) < 0.001, `A: 악재 루머 유지(-0.25) (실제: ${valMarketA})`);
  assert(Math.abs(valMarketC) < 1e-9, `C: 면제 정정으로 악재 해소(0.0) (실제: ${valMarketC})`);

  // 1.4: 빈 배열 또는 존재하지 않는 종목 안전 처리
  const valEmpty = computeEffectiveNewsValuation([], stockA, 2000);
  const valNonExistent = computeEffectiveNewsValuation([rumorA], 'stock_non_existent', 2000);
  assert(valEmpty === 0, '빈 이벤트 배열 시 0 반환');
  assert(valNonExistent === 0, '종목이 이벤트 대상에 없을 때 0 반환');

  // ─────────────────────────────────────────────────────────────────
  // PART 2: 복수 정정 결정론적 정책 (Multiple Corrections Determinism)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n▶ [PART 2] Multiple Corrections Determinism & Order Independence');

  // 동일 원본 루머에 대해 두 개의 정정 이벤트 발생:
  // 정정 1 (1500ms): REPLACE (-0.10)
  // 정정 2 (2000ms): RETRACT (0.00)
  const corr1_replace: ObservableMarketEvent = {
    eventId: 'ev_corr_step1',
    scope: 'stock',
    eventType: 'CORRECTION',
    correctionMode: 'REPLACE',
    originalEventId: 'ev_rumor_a',
    targetStockIds: [stockA],
    valuationSignal: -0.10,
    attentionShock: 0.3,
    uncertaintyShock: 0.2,
    confidence: 1.0,
    halfLife: 100000,
    publishedAt: 1500,
    effectiveFrom: 1500,
    sequence: 1,
    publisher: 'News',
    title: '1차 축소 정정',
    content: '1차 축소',
  };

  const corr2_retract: ObservableMarketEvent = {
    eventId: 'ev_corr_step2',
    scope: 'stock',
    eventType: 'CORRECTION',
    correctionMode: 'RETRACT',
    originalEventId: 'ev_rumor_a',
    targetStockIds: [stockA],
    valuationSignal: 0.0,
    attentionShock: 0.2,
    uncertaintyShock: 0.1,
    confidence: 1.0,
    halfLife: 100000,
    publishedAt: 2000,
    effectiveFrom: 2000,
    sequence: 2,
    publisher: 'DART',
    title: '2차 전면 취소 정정',
    content: '2차 취소',
  };

  // 2.1: 정방향 순서 [루머, 정정1, 정정2] -> 최신 정정2(RETRACT)가 이겨야 하므로 최종 0
  const valForward = computeEffectiveNewsValuation([rumorA, corr1_replace, corr2_retract], stockA, 2500);
  assert(Math.abs(valForward) < 1e-9, `최신 정정2(RETRACT)가 반영되어 최종 신호는 0이어야 함 (실제: ${valForward})`);

  // 2.2: 역방향 순서 [정정2, 루머, 정정1] -> 입력 순서가 뒤바뀌어도 동일하게 0이어야 함 (결정론)
  const valBackward = computeEffectiveNewsValuation([corr2_retract, rumorA, corr1_replace], stockA, 2500);
  assert(Math.abs(valBackward) < 1e-9, `입력 순서가 역방향이어도 동일하게 0이어야 함 (실제: ${valBackward})`);

  // 2.3: 동일 시각(effectiveFrom 동일) 복수 정정 시 sequence 우선순위
  const corrTie1: ObservableMarketEvent = {
    ...corr1_replace,
    eventId: 'ev_corr_tie_seq1',
    effectiveFrom: 2000,
    publishedAt: 2000,
    sequence: 1,
    valuationSignal: -0.10,
    correctionMode: 'REPLACE',
  };
  const corrTie2: ObservableMarketEvent = {
    ...corr2_retract,
    eventId: 'ev_corr_tie_seq2',
    effectiveFrom: 2000,
    publishedAt: 2000,
    sequence: 2, // 높은 sequence가 최종 반영
    valuationSignal: 0.05,
    correctionMode: 'REPLACE',
  };

  const valTieSeq = computeEffectiveNewsValuation([rumorA, corrTie1, corrTie2], stockA, 2000);
  assert(Math.abs(valTieSeq - 0.05) < 1e-9, `동일 시각 정정 시 sequence 2가 최종 반영되어 0.05여야 함 (실제: ${valTieSeq})`);

  // 2.4: 100회 무작위 Shuffle에도 완벽히 동일한 결과 반환 검증
  const testArray = [rumorA, corr1_replace, corr2_retract, corrTie1, corrTie2];
  const baseline = computeEffectiveNewsValuation(testArray, stockA, 2500);
  let shuffleConsistent = true;

  for (let i = 0; i < 100; i++) {
    const shuffled = [...testArray].sort(() => Math.random() - 0.5);
    const res = computeEffectiveNewsValuation(shuffled, stockA, 2500);
    if (Math.abs(res - baseline) > 1e-9) {
      shuffleConsistent = false;
      break;
    }
  }
  assert(shuffleConsistent, '100회 무작위 배열 Shuffle에도 100% 동일한 결정론적 계산 결과 유지');

  // ─────────────────────────────────────────────────────────────────
  // PART 3: MarketEvent 런타임 유효성 검증 (validateMarketEvent)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n▶ [PART 3] Runtime Validation (validateMarketEvent)');

  // 3.1: CORRECTION 이벤트에 originalEventId 누락 시 거절
  const invalidCorr1: MarketEvent = {
    ...corr1_replace,
    originalEventId: '',
  };
  assert(validateMarketEvent(invalidCorr1) !== null, 'originalEventId가 빈 문자열이면 검증 실패해야 함');

  // 3.2: 비정정 이벤트에 correctionMode가 존재하면 거절
  const invalidOfficial: MarketEvent = {
    ...rumorA,
    eventType: 'OFFICIAL',
    correctionMode: 'RETRACT',
  };
  assert(validateMarketEvent(invalidOfficial) !== null, 'OFFICIAL 이벤트에 correctionMode가 있으면 거절되어야 함');

  // 3.3: targetStockIds에 중복된 ID가 포함되면 거절
  const duplicateStocksEvent: MarketEvent = {
    ...rumorA,
    targetStockIds: [stockA, stockA],
  };
  assert(validateMarketEvent(duplicateStocksEvent) !== null, 'targetStockIds에 중복이 있으면 거절되어야 함');

  // 3.4: 잘못된 correctionMode 거절
  const invalidModeCorr: MarketEvent = {
    ...corr1_replace,
    correctionMode: 'INVALID_MODE' as any,
  };
  assert(validateMarketEvent(invalidModeCorr) !== null, '비정상 correctionMode는 거절되어야 함');

  // 3.5: 정상 이벤트는 null (통과) 반환
  assert(validateMarketEvent(rumorA as MarketEvent) === null, '정상 이벤트는 null 반환 (통과)');

  console.log('\n================================================================');
  console.log('  🎉 ALL NEWS CORRECTION DETERMINISM TESTS PASSED (EXIT 0)');
  console.log('================================================================');
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
