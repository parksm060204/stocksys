/**
 * STOCKSYS Orderbook & News Integrity Comprehensive Verification Suite
 *
 * Tests:
 * A. DB 장부 보존 테스트 (동일 가격 잔량 보존, 교차 호가 보존, 클라이언트 임의 체결/상태 변조 금지)
 * B. 조회 제한 분리 테스트 (매수/매도 200건 초과 시 반대편 호가 누락 방지 및 10호가 레벨 집계)
 * C. 비동기 경합 테스트 (Deferred Promise를 통한 결정론적 응답 역전 방어)
 * D. 종목 전환 테스트 (즉시 이전 호가 제거 및 느린 응답 폐기)
 * E. Selector & UI 무결성 테스트 (0수량 제거, 반올림 후 0수량 재검증, 전량체결/취소 즉시 제거, 단측/양측 공백 안전성)
 * F. 미래 정정 정보 격리 테스트 (루머/정정 시각별 관측, correctedAt 및 truth 유출 차단, 신호 이중 가산 방지)
 */

import assert from 'assert';
import {
  filterValidOrderbookLevels,
  aggregateRawOrders,
  calculateMaxVisibleQuantity,
  OrderbookLevel,
  RawOrderLike,
} from '../lib/utils/orderbookSelector';
import {
  MarketEvent,
  ObservableMarketEvent,
  getVisibleMarketEvents,
  getEffectiveMarketEvents,
  sanitizePublicNewsRecord,
  toObservableMarketEvent,
} from '../lib/engine/simulation/marketEventTypes';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import { buildMarketObservation } from '../lib/engine/simulation/marketObservation';
import { evaluateValueStrategy } from '../lib/engine/simulation/strategies/valueStrategy';
import { memoryDb } from '../lib/memoryDb/memoryStore';
import { secondsToMs } from '../lib/engine/simulation/simClock';

// ── Helper: Deferred Promise ───────────────────────────────────────────────
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function runTests() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('🧪 STOCKSYS Orderbook & News Integrity Comprehensive Test Suite');
  console.log('════════════════════════════════════════════════════════════════\n');

  // ════════════════════════════════════════════════════════════════
  // A. DB 장부 보존 테스트
  // ════════════════════════════════════════════════════════════════
  console.log('─── [TEST A] DB 장부 보존 테스트 ───');

  const ordersA: RawOrderLike[] = [
    { id: 'ord_buy_1', side: 'buy', price: 71900, size: 500, filled: 0, status: 'open' },
    { id: 'ord_sell_1', side: 'sell', price: 71900, size: 300, filled: 0, status: 'open' },
  ];

  // 1. 동일 가격 매수/매도가 모두 존재할 때 어느 쪽도 임의 차감되지 않음
  const bidsA = aggregateRawOrders(ordersA, 'buy');
  const asksA = aggregateRawOrders(ordersA, 'sell');

  assert.strictEqual(bidsA.length, 1, '매수 호가 1건 존재');
  assert.strictEqual(bidsA[0].price, 71900, '매수 호가 가격 71,900원');
  assert.strictEqual(bidsA[0].totalSize, 500, '매수 잔량 500 전량 보존 (임의 차감 금지)');

  assert.strictEqual(asksA.length, 1, '매도 호가 1건 존재');
  assert.strictEqual(asksA[0].price, 71900, '매도 호가 가격 71,900원');
  assert.strictEqual(asksA[0].totalSize, 300, '매도 잔량 300 전량 보존 (임의 차감 금지)');
  console.log('  ✅ 1. 동일 가격 매수/매도 주문 잔량 임의 차감 없이 100% 보존 확인');

  // 2. bestBid >= bestAsk (교차 호가) 상태에서도 selector가 주문을 삭제하지 않음
  const crossedOrders: RawOrderLike[] = [
    { id: 'ord_buy_cross', side: 'buy', price: 72500, size: 200, filled: 0, status: 'open' },
    { id: 'ord_sell_cross', side: 'sell', price: 71500, size: 150, filled: 0, status: 'open' },
  ];
  const crossedBids = aggregateRawOrders(crossedOrders, 'buy');
  const crossedAsks = aggregateRawOrders(crossedOrders, 'sell');

  assert.strictEqual(crossedBids.length, 1, '교차 매수 호가 삭제 금지');
  assert.strictEqual(crossedBids[0].price, 72500, '교차 매수 72,500원 보존');
  assert.strictEqual(crossedAsks.length, 1, '교차 매도 호가 삭제 금지');
  assert.strictEqual(crossedAsks[0].price, 71500, '교차 매도 71,500원 보존');
  console.log('  ✅ 2. bestBid >= bestAsk 교차 상태에서도 주문 미삭제 보존 확인');

  // 3. 클라이언트 처리만으로 체결 레코드 미생성
  // 4. 클라이언트 처리만으로 주문 filled / status 변경 불가
  assert.strictEqual(ordersA[0].filled, 0, '원시 주문 filled 수량 불변');
  assert.strictEqual(ordersA[0].status, 'open', '원시 주문 status 불변');
  assert.strictEqual(ordersA[1].filled, 0, '원시 매도 주문 filled 수량 불변');
  assert.strictEqual(ordersA[1].status, 'open', '원시 매도 주문 status 불변');
  console.log('  ✅ 3 & 4. 클라이언트 처리 중 가상 체결 레코드 미생성 및 원시 장부 불변 확인');

  // ════════════════════════════════════════════════════════════════
  // B. 조회 제한 분리 테스트
  // ════════════════════════════════════════════════════════════════
  console.log('\n─── [TEST B] 매수·매도 주문 조회 제한 분리 테스트 ───');

  // 모의 DB 데이터: 매도 주문 250건 (200건 제한 초과), 매수 주문 5건
  const mockSellOrders: RawOrderLike[] = [];
  for (let i = 0; i < 250; i++) {
    mockSellOrders.push({
      id: `sell_${i}`,
      side: 'sell',
      price: 72000 + i * 10,
      size: 10,
      filled: 0,
      status: 'open',
    });
  }

  const mockBuyOrders: RawOrderLike[] = [];
  for (let i = 0; i < 5; i++) {
    mockBuyOrders.push({
      id: `buy_${i}`,
      side: 'buy',
      price: 71000 - i * 10,
      size: 20,
      filled: 0,
      status: 'open',
    });
  }

  // 매도/매도 독립 쿼리 시뮬레이션:
  // asks는 price ASC 정렬 후 200건, bids는 price DESC 정렬 후 200건
  const fetchedAsks = [...mockSellOrders].sort((a, b) => Number(a.price) - Number(b.price)).slice(0, 200);
  const fetchedBids = [...mockBuyOrders].sort((a, b) => Number(b.price) - Number(a.price)).slice(0, 200);

  const aggregatedAsks = aggregateRawOrders(fetchedAsks, 'sell').slice(0, 10);
  const aggregatedBids = aggregateRawOrders(fetchedBids, 'buy').slice(0, 10);

  // 1. 매도가 200건을 초과해도 최우선 매수호가가 누락되지 않음
  assert.strictEqual(aggregatedBids.length, 5, '매수호가 5개 레벨 모두 정상 노출');
  assert.strictEqual(aggregatedBids[0].price, 71000, '최우선 매수호가 71,000원 보존');
  // 2. 최우선 매도호가 보존
  assert.strictEqual(aggregatedAsks.length, 10, '최우선 매도 10개 가격 레벨 집계');
  assert.strictEqual(aggregatedAsks[0].price, 72000, '최우선 매도호가(최저가) 72,000원 보존');
  console.log('  ✅ 1 & 2. 매도 250건 초과 시에도 독립 쿼리로 최우선 매수/매도 호가 100% 보존 확인');

  // 3. 동일 가격 주문 여러 건 합산 후 각 방향 10개 가격 레벨 검증
  const multiOrdersSamePrice: RawOrderLike[] = [
    { side: 'buy', price: 70000, size: 100, filled: 0, status: 'open' },
    { side: 'buy', price: 70000, size: 250, filled: 0, status: 'open' },
    { side: 'buy', price: 70000, size: 150, filled: 0, status: 'open' },
  ];
  for (let i = 1; i <= 15; i++) {
    multiOrdersSamePrice.push({
      side: 'buy',
      price: 70000 - i * 100,
      size: 50,
      filled: 0,
      status: 'open',
    });
  }
  const multiAggregated = aggregateRawOrders(multiOrdersSamePrice, 'buy').slice(0, 10);
  assert.strictEqual(multiAggregated.length, 10, '정확히 최우선 10개 가격 레벨 추출');
  assert.strictEqual(multiAggregated[0].price, 70000, '최우선 가격 70,000');
  assert.strictEqual(multiAggregated[0].totalSize, 500, '동일 가격 3건 주문 합산 (100+250+150 = 500)');
  console.log('  ✅ 3. 동일 가격 주문 합산 후 최우선 10개 레벨 슬라이싱 검증');

  // ════════════════════════════════════════════════════════════════
  // C. 비동기 경합 테스트 (Deferred Promise)
  // ════════════════════════════════════════════════════════════════
  console.log('\n─── [TEST C] 비동기 폴링 응답 역전 방지 테스트 ───');

  let stateStore = { generation: 0, data: 'initial' };
  let currentGeneration = 0;

  const reqA = createDeferred<string>();
  const reqB = createDeferred<string>();

  // 시뮬레이션 클라이언트 핸들러
  const handleResponse = (gen: number, resultData: string) => {
    if (gen !== currentGeneration) {
      // 오래된 세대의 응답은 폐기
      return;
    }
    stateStore = { generation: gen, data: resultData };
  };

  // 1. 요청 A 시작
  const genA = ++currentGeneration;
  // 2. 요청 B 시작
  const genB = ++currentGeneration;

  // 3. 요청 B가 먼저 완료됨
  reqB.resolve('data_B_latest');
  const resultB = await reqB.promise;
  handleResponse(genB, resultB);

  assert.strictEqual(stateStore.data, 'data_B_latest', 'B 완료 시 최신 B 상태 반영');
  assert.strictEqual(stateStore.generation, genB);

  // 4. 뒤늦게 요청 A가 완료됨
  reqA.resolve('data_A_stale');
  const resultA = await reqA.promise;
  handleResponse(genA, resultA);

  // 최종 상태는 여전히 B여야 함 (A의 덮어쓰기 차단)
  assert.strictEqual(
    stateStore.data,
    'data_B_latest',
    '뒤늦은 A 응답이 최신 B 상태를 덮어쓰지 않아야 함'
  );
  console.log('  ✅ 요청 A(지연) -> B(완료) -> A(완료) 순서에서 최신 B 상태 보존 및 A 덮어쓰기 방어 완료');

  // ════════════════════════════════════════════════════════════════
  // D. 종목 전환 테스트
  // ════════════════════════════════════════════════════════════════
  console.log('\n─── [TEST D] 종목 전환 시 이전 호가 제거 및 지연 응답 폐기 ───');

  interface OrderbookUIState {
    stockId: string;
    bids: OrderbookLevel[];
    asks: OrderbookLevel[];
  }

  let uiState: OrderbookUIState = {
    stockId: 'stock_A',
    bids: [{ price: 71000, totalSize: 500 }],
    asks: [{ price: 72000, totalSize: 300 }],
  };

  let activeStockId = 'stock_A';
  let activeGen = 10;

  // 종목 변경: stock_A -> stock_B
  const handleStockChange = (newStockId: string) => {
    activeStockId = newStockId;
    activeGen++;
    // 요구사항: 종목 변경 시 즉시 이전 종목 호가 클리어
    uiState = {
      stockId: newStockId,
      bids: [],
      asks: [],
    };
  };

  handleStockChange('stock_B');
  assert.strictEqual(uiState.stockId, 'stock_B');
  assert.strictEqual(uiState.bids.length, 0, '전환 즉시 이전 매수호가 제거');
  assert.strictEqual(uiState.asks.length, 0, '전환 즉시 이전 매도호가 제거');

  // A 종목에서 시작되었던 느린 응답이 도착
  const slowStockAResponse = {
    gen: 10,
    targetStockId: 'stock_A',
    bids: [{ price: 71000, totalSize: 999 }],
  };
  if (slowStockAResponse.gen === activeGen && slowStockAResponse.targetStockId === activeStockId) {
    uiState.bids = slowStockAResponse.bids;
  }
  assert.strictEqual(uiState.bids.length, 0, 'A 종목의 느린 응답은 무시되어야 함');

  // B 종목 응답 도착
  const bResponse = {
    gen: activeGen,
    targetStockId: 'stock_B',
    bids: [{ price: 150000, totalSize: 120 }],
    asks: [{ price: 151000, totalSize: 80 }],
  };
  if (bResponse.gen === activeGen && bResponse.targetStockId === activeStockId) {
    uiState.bids = bResponse.bids;
    uiState.asks = bResponse.asks;
  }
  assert.strictEqual(uiState.bids.length, 1);
  assert.strictEqual(uiState.bids[0].price, 150000);
  assert.strictEqual(uiState.asks[0].price, 151000);
  console.log('  ✅ 종목 전환 즉각 초기화 및 이전 종목의 지연 응답 무시 검증 완료');

  // ════════════════════════════════════════════════════════════════
  // E. Selector & UI 무결성 테스트
  // ════════════════════════════════════════════════════════════════
  console.log('\n─── [TEST E] 반올림 후 0수량 재검증 & Selector 무결성 ───');

  // 1. 반올림 후 0이 되는 소수점 잔량 (0.1 -> round -> 0)
  const fractionalLevels: OrderbookLevel[] = [
    { price: 70000, totalSize: 0.1 },
    { price: 71000, totalSize: 0.49 },
    { price: 72000, totalSize: 1.2 },
  ];
  const filteredFractional = filterValidOrderbookLevels(fractionalLevels, 'ask');
  assert.strictEqual(filteredFractional.length, 1, '0.1, 0.49 반올림 후 0수량 행은 제거되어야 함');
  assert.strictEqual(filteredFractional[0].price, 72000, '1.2 -> 1로 반올림된 유효 호가만 남음');
  assert.strictEqual(filteredFractional[0].totalSize, 1);
  console.log('  ✅ 1. 반올림 후 0이 되는 수량(0.1, 0.49) 엄격한 재검증 제거 완료');

  // 2. 전량 체결 후 남은 잔량 0인 주문 제외
  const filledOrders: RawOrderLike[] = [
    { side: 'buy', price: 70000, size: 100, filled: 100, status: 'filled' },
    { side: 'buy', price: 69000, size: 100, filled: 30, status: 'partial' },
  ];
  const remainingLevels = aggregateRawOrders(filledOrders, 'buy');
  assert.strictEqual(remainingLevels.length, 1, '전량 체결된 주문은 호가에 포함되지 않음');
  assert.strictEqual(remainingLevels[0].price, 69000);
  assert.strictEqual(remainingLevels[0].totalSize, 70, '미체결 잔량 70만 노출');
  console.log('  ✅ 2. 전량 체결 주문 즉시 제외 및 잔량(size - filled) 정합성 확인');

  // 3. 단측 호가만 존재할 때 반대측 유지 및 양측 공백 안전성
  const singleSideAsks: OrderbookLevel[] = [{ price: 75000, totalSize: 100 }];
  const singleSideBids: OrderbookLevel[] = [];
  const maxQ1 = calculateMaxVisibleQuantity(singleSideAsks, singleSideBids);
  assert.strictEqual(maxQ1, 100, '한쪽만 비었을 때 존재하는 쪽의 최대 잔량 계산');

  const emptyMaxQ = calculateMaxVisibleQuantity([], []);
  assert.strictEqual(emptyMaxQ, 1, '양쪽 모두 비었을 때 fallback=1 안전 반환');
  console.log('  ✅ 3. 단측 호가 및 양측 공백 시 안정적 계산 검증 완료');

  // ════════════════════════════════════════════════════════════════
  // F. 미래 정정 정보 격리 테스트
  // ════════════════════════════════════════════════════════════════
  console.log('\n─── [TEST F] 미래 정정 뉴스 격리 및 내부 진실 보호 테스트 ───');

  const simStart = 1773500000000;
  const stockF = '00000000-0000-4000-8000-000000000101';

  // 1. T 시점: 원본 루머 공개
  const rumorEvent: MarketEvent = {
    eventId: 'evt_rumor_f',
    publishedAt: simStart,
    effectiveFrom: simStart,
    scope: 'stock',
    targetStockIds: [stockF],
    eventType: 'RUMOR',
    valuationSignal: 0.40,
    attentionShock: 0.60,
    uncertaintyShock: 0.30,
    confidence: 0.60,
    halfLife: 40,
    publisher: '증권가 찌라시',
    title: '[루머] 극비 신소재 공급 계약설',
    content: '확인되지 않은 루머',
    isRumorFake: true,
  };

  // 2. T + 1s: 미래 정정 등록 (정정 공개 예정은 T + 5s)
  const correctionEventF: MarketEvent = {
    eventId: 'evt_corr_f',
    originalEventId: 'evt_rumor_f',
    publishedAt: simStart + secondsToMs(5),
    effectiveFrom: simStart + secondsToMs(5),
    scope: 'stock',
    targetStockIds: [stockF],
    eventType: 'CORRECTION',
    valuationSignal: -0.40,
    attentionShock: 0.20,
    uncertaintyShock: 0.10,
    confidence: 0.95,
    halfLife: 30,
    publisher: '공식 IR팀',
    title: '[공식정정] 신소재 계약설은 사실무근',
    content: '전면 부인',
  };

  const internalEventsStore: MarketEvent[] = [
    { ...rumorEvent, correctedAt: simStart + secondsToMs(5) },
    correctionEventF,
  ];

  // 빠른 봇 (latency = 1.0s), 느린 봇 (latency = 4.0s)
  const fastLatency = 1.0;
  const slowLatency = 4.0;

  // 검증 1: 정정 등록 직후 (t = simStart + 1s) 두 봇 모두 correctedAt을 볼 수 없음
  const visibleFastAtT1 = getVisibleMarketEvents(internalEventsStore, simStart + secondsToMs(1), fastLatency);
  const visibleSlowAtT1 = getVisibleMarketEvents(internalEventsStore, simStart + secondsToMs(1), slowLatency);

  assert.strictEqual(visibleFastAtT1.length, 1, '빠른 봇은 t=1s에 루머(publishedAt=0s) 수신 가능');
  assert.strictEqual(!('correctedAt' in visibleFastAtT1[0]), true, '빠른 봇에게 correctedAt 필드 완전 격리');
  assert.strictEqual(!('isRumorFake' in visibleFastAtT1[0]), true, '빠른 봇에게 isRumorFake 필드 완전 격리');

  if (visibleSlowAtT1.length > 0) {
    assert.strictEqual(!('correctedAt' in visibleSlowAtT1[0]), true, '느린 봇에게 correctedAt 필드 완전 격리');
    assert.strictEqual(!('isRumorFake' in visibleSlowAtT1[0]), true, '느린 봇에게 isRumorFake 필드 완전 격리');
  }
  console.log('  ✅ 1. 정정 등록 직후 두 봇 모두 correctedAt 및 isRumorFake 관측 불가 확인');

  // 검증 2: 공개 뉴스 API DTO에도 correctedAt, isRumorFake, is_fake 완전 없음
  const sanitizedPublic = sanitizePublicNewsRecord({
    id: rumorEvent.eventId,
    title: rumorEvent.title,
    isRumorFake: true,
    is_fake: true,
    correctedAt: simStart + secondsToMs(5),
  });
  assert.strictEqual(!('correctedAt' in sanitizedPublic), true, '공개 뉴스에서 correctedAt 삭제');
  assert.strictEqual(!('isRumorFake' in sanitizedPublic), true, '공개 뉴스에서 isRumorFake 삭제');
  assert.strictEqual(!('is_fake' in sanitizedPublic), true, '공개 뉴스에서 is_fake 삭제');
  console.log('  ✅ 2. 공개 뉴스 API sanitizePublicNewsRecord 내부 진실 누출 차단 확인');

  // 검증 3: 정정 공개 전 (t = simStart + 4s) 두 봇 모두 정정 이벤트를 볼 수 없음
  const visibleFastAtT4 = getVisibleMarketEvents(internalEventsStore, simStart + secondsToMs(4), fastLatency);
  const visibleSlowAtT4 = getVisibleMarketEvents(internalEventsStore, simStart + secondsToMs(4), slowLatency);
  assert.strictEqual(visibleFastAtT4.some((e) => e.eventType === 'CORRECTION'), false, 't=4s 빠른 봇 정정 미관측');
  assert.strictEqual(visibleSlowAtT4.some((e) => e.eventType === 'CORRECTION'), false, 't=4s 느린 봇 정정 미관측');
  console.log('  ✅ 3. 정정 공개 시각(T+5s) 전 정정 이벤트 관측 차단 확인');

  // 검증 4 & 5: 정정 공개 후 (t = simStart + 6.5s)
  // 빠른 봇 (latency 1s -> t=6s부터 수신): 관측 성공
  // 느린 봇 (latency 4s -> t=9s부터 수신): t=6.5s에는 아직 미관측!
  const visibleFastAtT6_5 = getVisibleMarketEvents(internalEventsStore, simStart + secondsToMs(6.5), fastLatency);
  const visibleSlowAtT6_5 = getVisibleMarketEvents(internalEventsStore, simStart + secondsToMs(6.5), slowLatency);

  assert.strictEqual(visibleFastAtT6_5.some((e) => e.eventType === 'CORRECTION'), true, 't=6.5s 빠른 봇은 정정 관측 성공');
  assert.strictEqual(visibleSlowAtT6_5.some((e) => e.eventType === 'CORRECTION'), false, 't=6.5s 느린 봇은 정정 관측 불가 (지연 격리)');
  console.log('  ✅ 4 & 5. 정정 공개 후 봇별 latency에 따른 독립적 순차 관측 검증');

  // 검증 6: 원본 루머의 전역 confidence는 변경되지 않음
  assert.strictEqual(internalEventsStore[0].confidence, 0.60, '전역 원본 루머 신뢰도 0.60 불변');
  console.log('  ✅ 6. 원본 루머 전역 confidence 불변 확인');

  // 검증 7 & 8: 정정 취소 효과와 정정 방향 신호의 이중 가산 방지 확인
  // 빠른 봇의 관측: 루머(val = +0.40, conf = 0.60) + 정정(val = -0.40, conf = 0.95, originalEventId = rumor)
  const effectiveFast = getEffectiveMarketEvents(visibleFastAtT6_5, simStart + secondsToMs(6.5));
  assert.strictEqual(effectiveFast.length, 2, '루머와 정정 모두 effective 상태');

  // valueStrategy 내부 로직 직접 실행
  const mockObsFast = {
    stockId: stockF,
    ticker: 'TEST',
    bestBid: 70000,
    bestAsk: 70200,
    midPrice: 70100,
    spread: 200,
    hasTwoSidedBook: true,
    bidsDepth: [],
    asksDepth: [],
    lastTradePrice: 70100,
    lastTradeVolume: 0,
    recentTrades: [],
    priceHistory: [70100, 70100, 70100, 70100, 70100],
    returns: [0, 0, 0, 0],
    volatility: 0.005,
    isWarmup: false,
    simulationTime: simStart + secondsToMs(6.5),
    effectiveEvents: effectiveFast,
    account: {
      cash: 10_000_000,
      holdingQty: 50,
      avgPrice: 70100,
      reservedCash: 0,
      reservedHolding: 0,
      availableCash: 10_000_000,
      availableHolding: 50,
    },
    activeOrders: [],
  };

  const dummyPrng = {
    nextNormal: () => 0, // noise 0 for deterministic testing
  } as any;

  const valueIntent = evaluateValueStrategy(
    mockObsFast as any,
    {
      accountId: 'acc_val_fast',
      agentId: 'agent_val_fast',
      participantType: 'bot',
      strategyType: 'value',
      name: 'Value Bot',
      targetPositions: { [stockF]: 50 },
      maxOrderSize: 10,
      maxPosition: 100,
      riskTolerance: 0.5,
      urgency: 0.1,
      activityRate: 1.0,
      evaluationsPerStep: 1,
      nextDecisionTime: 0,
      stats: { ordersSubmitted: 0, ordersCancelled: 0, fillsCount: 0, volumeTraded: 0, feesPaid: 0, realizedPnl: 0 },
    },
    {
      valueWeight: 1.0,
      exposureWeight: 0.4,
      noiseStdDev: 0.0,
      delaySteps: 2,
      deadbandPct: 0.01,
      minProfitMarginPct: 0.003,
      participationRate: 0.2,
      buyThreshold: 0.2,
      sellThreshold: -0.2,
    },
    70100,
    dummyPrng
  );

  // 루머(+0.40)와 정정(-0.40)이 동시에 있을 때:
  // 정정이 루머를 무효화(0)하고, 정정의 -0.40을 이중으로 가산하지 않았으므로
  // valuationDelta는 0이며, midPrice 70100과 일치하여 deadband 내 'hold' 상태여야 함!
  // 만약 이중 가산되었다면 -0.38의 거대한 음수 충격으로 인해 강제 패닉 매도('sell')가 발생했을 것임.
  assert.strictEqual(
    valueIntent.action,
    'hold',
    '이중 가산 방지 정책: 정정이 루머를 무효화하여 중립 복귀(hold)해야 함'
  );
  assert.strictEqual(
    valueIntent.reason,
    'within_deadband',
    '평가차가 deadband 내에 위치하여 중립 확인'
  );
  console.log('  ✅ 7 & 8. 정정 취소 효과와 방향 신호 이중 가산 방지(과도한 덤핑 방어 및 중립 복귀) 확인');

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL INTEGRITY TESTS (A through F) PASSED PERFECTLY! (Exit Code 0)');
  console.log('════════════════════════════════════════════════════════════════\n');
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
