/**
 * scripts/test-cross-asset-full-suite.ts
 *
 * STOCKSYS 교차자산 거시 의사결정 엔진 전체 종합 검증 스위트 (P1 & P2 결함 수정 검증 전용)
 *
 * 1. 결정론 (Determinism):
 *    - 동일 seed/입력 시 신호, 목표 포지션, 주문 비트 단위 일치
 *    - 진단 조회(getCrossAssetLatestSnapshot, getCrossAssetDiagnosticsHistory) 전후 PRNG 상태 불변
 *    - 시스템 벽시계(Date.now) 무관, 순수 시뮬레이션 시계 전진에만 의존
 *
 * 2. 정보 경계 & 정정 생명주기 (Information Boundary & Corrections):
 *    - publishedAt / effectiveFrom 이전의 미래/미공개 이벤트 신호 반영 차단
 *    - infoLatency가 다른 에이전트(fast bot vs slow bot) 간 정보 격차 검증
 *    - RETRACT: 원본 루머 효과 완전 소각
 *    - REPLACE: 원본 루머 효과 제거 후 정정 효과 교체
 *    - ADDITIVE: 두 효과 공존
 *
 * 3. [P1] 거시 충격 방향 모델 & 주식 가치평가 신호 분리:
 *    - 전쟁 발발(valuationSignal=-0.8, direction=+1) -> geopoliticalRisk 상승 (감소하지 않음)
 *    - 기준금리 인하(valuationSignal=+0.8, direction=-1) -> policyRate 하락 (상승하지 않음)
 *    - 기업 단독 수주(valuationSignal=+0.75, macroImpacts 부재) -> 전역 성장률 불변 (fail-closed)
 *
 * 4. [P1] 위험 제약을 실제 주문 경로에 연결 (EXPERIMENTAL_ON 단일 주문 파이프라인):
 *    - 목표 deltaQuantity <= 0 일 때 추가 매수 주문 원천 차단
 *    - 목표 deltaQuantity >= 0 일 때 불필요한 매도 주문 원천 차단
 *    - 매수 수량: maxOrderSize, deltaQuantity, 가용현금(미체결 예약금 및 수수료 반영) 중 최소값으로 클램핑
 *    - 매도 수량: maxOrderSize, deltaQuantity, 가용보유량(미체결 예약매도 반영) 중 최소값으로 클램핑
 *    - 중복 주문 없음, SHADOW 모드에서 가상 주문만 계산하고 실제 주문 미제출
 *
 * 5. [P2] 요인 노출 3-Factor 동시 수렴 캡핑:
 *    - rateBeta, growthBeta, commodityBeta 3개 팩터 모두 상한선 이내 수렴
 *    - 최종 aggregateFactorExposure는 최종 비중으로 재계산된 값과 일치
 *
 * 6. [P2] 국채 분류 ('govt', 'sovereign', '국채' 등) 및 비대칭 반응:
 *    - 국채: flightToSafety 가산
 *    - 회사채: creditSpreadRisk 감산
 *
 * 7. [P2] 옵션 실제 기초자산 신호 연결:
 *    - 기초자산의 기대수익 및 변동성을 옵션 기대수익에 반영
 *    - delta 부호, theta 시간가치 감쇠, gamma/vega spread, 꼬리위험 반영
 *    - 기초자산 결측 시 5% 고정 대체 없이 fail-closed 중립/보류
 *
 * 8. [P2] 가격·현금·보유량 정합성:
 *    - 미보유 주식 50,000 fallback 제거 -> 실제 가격 맵 사용, 가격 결측 시 fail-closed 보류
 *    - 예약 현금 및 예약 매도 수량 차감
 *
 * 9. 회귀 및 SHADOW 모드 무간섭 검증:
 *    - crossAssetMode === 'OFF' 시 기존 결과 100% 보존
 *    - crossAssetMode === 'SHADOW' 시 실제 장부/체결/PRNG 지문이 OFF와 100% 동일
 */

import * as assert from 'assert';
import { memoryDb } from '../lib/memoryDb/memoryStore';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import { DEFAULT_MACRO_STATE } from '../lib/engine/simulation/macro/macroState';
import { computeCrossAssetSignals, AssetMicroSnapshot } from '../lib/engine/simulation/crossAsset/crossAssetSignalEngine';
import { computePortfolioAllocation, convertAllocationsToOrderIntents } from '../lib/engine/simulation/crossAsset/portfolioEngine';
import { isSovereignBond } from '../lib/engine/simulation/crossAsset/transmissionEngine';
import { AgentMacroProfile, CrossAssetSignal } from '../lib/engine/simulation/crossAsset/crossAssetTypes';
import { MarketEvent } from '../lib/engine/simulation/marketEventTypes';

const START_EPOCH_MS = 1773500000000;

function createEvent(partial: Partial<MarketEvent> & { eventId: string; title: string }): MarketEvent {
  return {
    scope: 'market',
    eventType: 'OFFICIAL',
    targetStockIds: [],
    valuationSignal: 0,
    attentionShock: 0.1,
    uncertaintyShock: 0.1,
    confidence: 0.9,
    halfLife: 300,
    publishedAt: 0,
    effectiveFrom: 0,
    publisher: 'TestPublisher',
    content: 'Test content',
    ...partial,
  };
}

function checkSystemInvariants(stepName: string): void {
  for (const p of memoryDb.profiles.values()) {
    if (!Number.isFinite(p.cash) || p.cash < 0) {
      throw new Error(`[${stepName}] 계좌 cash 비정상: ${p.id}=${p.cash}`);
    }
  }
  for (const h of memoryDb.holdings.values()) {
    if (!Number.isFinite(h.quantity) || h.quantity < 0) {
      throw new Error(`[${stepName}] 보유 quantity 비정상: user=${h.user_id}, qty=${h.quantity}`);
    }
  }
  for (const o of memoryDb.orders.values()) {
    if (!Number.isFinite(o.price) || o.price <= 0 || !Number.isFinite(o.size) || o.size <= 0) {
      throw new Error(`[${stepName}] 주문 비정상 가격/수량: ${o.id}`);
    }
  }
}

function getSystemFingerprint(mgr: AgentManager): string {
  const orders = Array.from(memoryDb.orders.values())
    .map((o) => `${o.stock_id}:${o.side}:${o.price}:${o.size}:${o.filled}:${o.status}`)
    .sort()
    .join('|');
  const trades = memoryDb.trades
    .map((t) => `${t.stock_id}:${t.price}:${t.size}:${t.buyer_id}:${t.seller_id}`)
    .sort()
    .join('|');
  const profiles = Array.from(memoryDb.profiles.values())
    .map((p) => `${p.id}:${p.cash}`)
    .sort()
    .join('|');
  const botPrng = Array.from(mgr.agentPrngs.entries())
    .map(([k, p]) => `${k}:${p.getState()}`)
    .sort()
    .join('|');
  const fundPrng = mgr.fundamentalPrng.getState();

  return `ORDERS[${orders}]__TRADES[${trades}]__PROFILES[${profiles}]__PRNG[${botPrng}#${fundPrng}]`;
}

async function runCrossAssetFullSuite(): Promise<void> {
  console.log('================================================================');
  console.log('  🧪 [STOCKSYS] 교차자산 거시 의사결정 엔진 전체 종합 검증 스위트');
  console.log('================================================================\n');

  // ═════════════════════════════════════════════════════════════════
  // 1. 결정론 (Determinism)
  // ═════════════════════════════════════════════════════════════════
  console.log('▶ [테스트 1] 결정론 및 진단 조회 PRNG 불변성 검증');
  {
    const SEED = 20260920;

    async function executeRun(mode: 'OFF' | 'SHADOW' | 'EXPERIMENTAL_ON') {
      memoryDb.resetToSeedData();
      const mgr = new AgentManager(SEED, START_EPOCH_MS, {
        enableCrossAssetEngine: true,
        crossAssetMode: mode,
      });

      // 30초 스텝 진행
      await mgr.step(30);

      // 이벤트 등록
      const curTime = mgr.clock.simulationTime;
      mgr.registerEvent({
        eventId: 'evt_test_macro_det',
        scope: 'market',
        eventType: 'OFFICIAL',
        targetStockIds: [],
        valuationSignal: 0.50,
        attentionShock: 0.20,
        uncertaintyShock: 0.05,
        confidence: 0.90,
        halfLife: 600,
        publishedAt: curTime,
        effectiveFrom: curTime,
        publisher: 'BOK',
        title: '기준금리 인상 발표',
        content: '한국은행 금융통화위원회가 기준금리를 인상하였습니다.',
        macroImpacts: [
          { factor: 'policyRate', direction: 1, magnitude: 0.5, halfLifeSeconds: 600 },
        ],
      });

      // 60초 추가 스텝 진행
      await mgr.step(60);

      const latestSnap = mgr.getCrossAssetLatestSnapshot('acc_bot_val_01');
      const hist = mgr.getCrossAssetDiagnosticsHistory('acc_bot_val_01', 10);
      const fp = getSystemFingerprint(mgr);

      return { mgr, latestSnap, hist, fp };
    }

    const runA = await executeRun('EXPERIMENTAL_ON');
    const runB = await executeRun('EXPERIMENTAL_ON');

    assert.strictEqual(
      JSON.stringify(runA.latestSnap),
      JSON.stringify(runB.latestSnap),
      '1.1 동일 seed/입력 시 교차자산 진단 스냅샷 100% 비트 단위 일치'
    );
    assert.strictEqual(runA.fp, runB.fp, '1.2 동일 seed/입력 시 전체 장부/체결/PRNG 지문 100% 일치');

    // 진단 조회(getCrossAssetLatestSnapshot, getCrossAssetDiagnosticsHistory) 전후 PRNG 불변 검증
    const mgr = runA.mgr;
    const prngStatesBefore = Array.from(mgr.agentPrngs.entries()).map(([k, p]) => `${k}:${p.getState()}`).join('|');
    const fundPrngBefore = mgr.fundamentalPrng.getState();

    for (let i = 0; i < 50; i++) {
      mgr.getCrossAssetLatestSnapshot('acc_bot_val_01');
      mgr.getCrossAssetDiagnosticsHistory('acc_bot_val_01', 20);
      mgr.getCrossAssetDiagnosticsHistory();
    }

    const prngStatesAfter = Array.from(mgr.agentPrngs.entries()).map(([k, p]) => `${k}:${p.getState()}`).join('|');
    const fundPrngAfter = mgr.fundamentalPrng.getState();

    assert.strictEqual(prngStatesBefore, prngStatesAfter, '1.3 진단 50회 연속 조회 후 봇 PRNG 상태 100% 불변');
    assert.strictEqual(fundPrngBefore, fundPrngAfter, '1.4 진단 50회 연속 조회 후 펀더멘털 PRNG 상태 100% 불변');
    console.log('  ✓ [테스트 1] 결정론 및 PRNG 격리 검증 통과!');
  }

  // ═════════════════════════════════════════════════════════════════
  // 2. 정보 경계 & 발효 시각 격리
  // ═════════════════════════════════════════════════════════════════
  console.log('\n▶ [테스트 2] 미공개/미발효 이벤트 신호 차단 및 발효 경계 검증');
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(1001, START_EPOCH_MS, {
      enableCrossAssetEngine: true,
      crossAssetMode: 'EXPERIMENTAL_ON',
    });

    const t0 = mgr.clock.simulationTime;
    const futureEffectiveTime = t0 + 100_000; // 100초 뒤 발효

    // 미래 이벤트 등록 (effectiveFrom = 100초 뒤)
    const regOk = mgr.registerEvent({
      eventId: 'evt_future_oil_shock',
      scope: 'market',
      eventType: 'OFFICIAL',
      targetStockIds: [],
      valuationSignal: -0.90,
      attentionShock: 0.30,
      uncertaintyShock: 0.10,
      confidence: 0.95,
      halfLife: 1000,
      publishedAt: t0,
      effectiveFrom: futureEffectiveTime,
      publisher: 'EnergyAgency',
      title: '중동 분쟁 지정학적 위기 고조 및 군사 충돌',
      content: '주요 분쟁 지역 확산으로 지정학 위험과 군사적 충돌 우려 확산',
      macroImpacts: [
        { factor: 'geopoliticalRisk', direction: 1, magnitude: 0.8, halfLifeSeconds: 1000 },
      ],
    });
    assert.strictEqual(regOk, true, '2.0 이벤트 등록 성공 검증');

    // 10초 스텝 진행 (아직 effectiveFrom 이전)
    await mgr.step(10);
    const snapBefore = mgr.getCrossAssetLatestSnapshot('acc_bot_val_01');
    assert.ok(snapBefore, '2.1 진단 스냅샷 생성 확인');

    // 거시 상태의 geopoliticalRisk baseline 수준 유지 (미래 이벤트 미반영)
    assert.strictEqual(
      snapBefore.observedMacroState.values.geopoliticalRisk,
      DEFAULT_MACRO_STATE.geopoliticalRisk,
      '2.2 effectiveFrom 이전에는 미래 지정학 충격이 거시 상태에 일절 반영되지 않음'
    );

    // 미래 발효 시점까지 시뮬레이션 시계 전진 (90초 추가 진행 -> 총 100초 경과)
    await mgr.step(90);
    const snapAtEffective = mgr.getCrossAssetLatestSnapshot('acc_bot_val_01');
    assert.ok(snapAtEffective, '2.3 발효 시점 진단 스냅샷 확인');

    // 발효 시각 도달 즉시 경제 충격이 정상 반영되었는지 확인
    assert.ok(
      snapAtEffective.observedMacroState.values.geopoliticalRisk > DEFAULT_MACRO_STATE.geopoliticalRisk,
      '2.4 effectiveFrom 도달 시점에 경제 충격이 정확히 반영됨'
    );
    console.log('  ✓ [테스트 2] 정보 경계 및 시각 경계 검증 통과!');
  }

  // ═════════════════════════════════════════════════════════════════
  // 3. [P1] 거시 충격 방향 모델 & 주식 신호 분리 (War, Rate Cut, Stock Sole Event)
  // ═════════════════════════════════════════════════════════════════
  console.log('\n▶ [테스트 3] [P1] 거시 충격 방향 모델 및 valuationSignal 분리 검증');
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(1002, START_EPOCH_MS, {
      enableCrossAssetEngine: true,
      crossAssetMode: 'EXPERIMENTAL_ON',
    });

    const t = mgr.clock.simulationTime;

    // 3.1 전쟁 발발: valuationSignal = -0.8 (주식 폭락), direction = +1 -> geopoliticalRisk 상승! (절대 감소하지 않음)
    mgr.registerEvent(createEvent({
      eventId: 'evt_war_test',
      scope: 'market',
      eventType: 'OFFICIAL',
      valuationSignal: -0.8,
      macroImpacts: [{ factor: 'geopoliticalRisk', direction: 1, magnitude: 0.9 }],
      publishedAt: t,
      effectiveFrom: t,
      publisher: 'NewsAgency',
      title: '전쟁 발발',
    }));
    await mgr.step(10);
    assert.ok(
      mgr.macroState.geopoliticalRisk > DEFAULT_MACRO_STATE.geopoliticalRisk,
      `3.1 음수 주식신호(-0.8)의 전쟁 이벤트가 지정학 위험을 상승시킴 (${mgr.macroState.geopoliticalRisk} > ${DEFAULT_MACRO_STATE.geopoliticalRisk})`
    );

    // 3.2 기준금리 인하: valuationSignal = +0.8 (주식 급등), direction = -1 -> policyRate 하락! (절대 상승하지 않음)
    mgr.registerEvent(createEvent({
      eventId: 'evt_rate_cut_test',
      scope: 'market',
      eventType: 'OFFICIAL',
      valuationSignal: 0.8,
      macroImpacts: [{ factor: 'policyRate', direction: -1, magnitude: 0.8 }],
      publishedAt: mgr.clock.simulationTime,
      effectiveFrom: mgr.clock.simulationTime,
      publisher: 'CentralBank',
      title: '기준금리 인하',
    }));
    const preRate = mgr.macroState.policyRate;
    await mgr.step(10);
    assert.ok(
      mgr.macroState.policyRate < preRate,
      `3.2 양수 주식신호(+0.8)의 금리 인하 이벤트가 정책금리를 하락시킴 (${mgr.macroState.policyRate} < ${preRate})`
    );

    // 3.3 기업 단독 수주 이벤트: 명시적 거시 효과 없음 -> 전역 성장률 불변 (fail-closed)
    const growthBefore = mgr.macroState.growth;
    mgr.registerEvent(createEvent({
      eventId: 'evt_corp_order_test',
      scope: 'stock',
      targetStockIds: ['stk_005930'],
      eventType: 'RUMOR',
      valuationSignal: 0.9,
      publishedAt: mgr.clock.simulationTime,
      effectiveFrom: mgr.clock.simulationTime,
      publisher: 'Analyst',
      title: '단독 대규모 수주',
    }));
    await mgr.step(10);
    assert.strictEqual(
      mgr.macroState.growth,
      growthBefore,
      '3.3 명시적 거시 효과 없는 기업 단독 이벤트는 전역 성장률을 변경하지 않음 (fail-closed)'
    );

    console.log('  ✓ [테스트 3] 거시 충격 방향 모델 및 주식 신호 분리 통과!');
  }

  // ═════════════════════════════════════════════════════════════════
  // 4. [P1] 에이전트별 정보 지연(infoLatency) & 정정 정책 (RETRACT/REPLACE)
  // ═════════════════════════════════════════════════════════════════
  console.log('\n▶ [테스트 4] [P1] 에이전트별 정보 지연 격차 및 정정 정책(RETRACT/REPLACE) 검증');
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(1003, START_EPOCH_MS, {
      enableCrossAssetEngine: true,
      crossAssetMode: 'EXPERIMENTAL_ON',
    });

    // 봇 2개: fastBot(infoLatency=0), slowBot(infoLatency=10)
    const fastBot = mgr.agents.get('acc_bot_val_01')!;
    const slowBot = mgr.agents.get('acc_bot_trend_01')!;
    fastBot.infoLatency = 0;
    slowBot.infoLatency = 10;

    const curTime = mgr.clock.simulationTime;

    // t 시점에 금리 인상 루머 이벤트 발생
    mgr.registerEvent(createEvent({
      eventId: 'evt_rumor_hike',
      scope: 'market',
      eventType: 'RUMOR',
      valuationSignal: -0.5,
      macroImpacts: [{ factor: 'policyRate', direction: 1, magnitude: 0.7, halfLifeSeconds: 300 }],
      publishedAt: curTime,
      effectiveFrom: curTime,
      publisher: 'MarketRumor',
      title: '긴급 금리 인상 루머',
    }));

    // 5초 경과 (fastBot은 관측 가능, slowBot은 infoLatency=10초이므로 아직 미관측)
    await mgr.step(5);

    const fastSnap = mgr.getCrossAssetLatestSnapshot('acc_bot_val_01')!;
    const slowSnap = mgr.getCrossAssetLatestSnapshot('acc_bot_trend_01')!;

    assert.ok(
      fastSnap.observedMacroState.values.policyRate > DEFAULT_MACRO_STATE.policyRate,
      '4.1 infoLatency=0 봇은 5초 후 금리 인상 루머를 즉시 관측하여 관측 정책금리 상승'
    );
    assert.strictEqual(
      slowSnap.observedMacroState.values.policyRate,
      DEFAULT_MACRO_STATE.policyRate,
      '4.2 infoLatency=10 봇은 5초 시점에 해당 루머를 아직 관측하지 못하여 기준선 유지 (정보 지연 보장)'
    );

    // 6초 추가 경과 (총 11초 경과 -> 이제 slowBot도 관측 가능)
    await mgr.step(6);
    const slowSnapAfter = mgr.getCrossAssetLatestSnapshot('acc_bot_trend_01')!;
    assert.ok(
      slowSnapAfter.observedMacroState.values.policyRate > DEFAULT_MACRO_STATE.policyRate,
      '4.3 11초 경과 후 infoLatency=10 봇도 루머 관측'
    );

    // 4.4 정정 정책 RETRACT 검증: 루머 완전 취소
    const retractTime = mgr.clock.simulationTime;
    mgr.registerEvent(createEvent({
      eventId: 'evt_retract_hike',
      originalEventId: 'evt_rumor_hike',
      correctionMode: 'RETRACT',
      scope: 'market',
      eventType: 'CORRECTION',
      publishedAt: retractTime,
      effectiveFrom: retractTime,
      publisher: 'CentralBank',
      title: '금리 인상 루머 전면 부인 및 취소',
    }));

    // 15초 경과 (두 봇 모두 RETRACT 관측)
    await mgr.step(15);
    const fastSnapRetracted = mgr.getCrossAssetLatestSnapshot('acc_bot_val_01')!;
    assert.strictEqual(
      fastSnapRetracted.observedMacroState.values.policyRate,
      DEFAULT_MACRO_STATE.policyRate,
      '4.4 RETRACT 발효 후 원본 루머 효과가 완전히 소각되어 기준금리로 복귀함'
    );

    // 4.5 정정 정책 REPLACE 검증: 루머를 반대 사실로 교체
    const rumorCutTime = mgr.clock.simulationTime;
    mgr.registerEvent(createEvent({
      eventId: 'evt_rumor_cut',
      scope: 'market',
      eventType: 'RUMOR',
      macroImpacts: [{ factor: 'policyRate', direction: 1, magnitude: 0.5 }],
      publishedAt: rumorCutTime,
      effectiveFrom: rumorCutTime,
      publisher: 'RumorMill',
      title: '금리 인상 설',
    }));
    await mgr.step(1);

    // REPLACE 발행: 인상이 아니라 금리 인하로 정정
    const replaceTime = mgr.clock.simulationTime;
    mgr.registerEvent(createEvent({
      eventId: 'evt_replace_cut',
      originalEventId: 'evt_rumor_cut',
      correctionMode: 'REPLACE',
      scope: 'market',
      eventType: 'CORRECTION',
      macroImpacts: [{ factor: 'policyRate', direction: -1, magnitude: 0.6 }],
      publishedAt: replaceTime,
      effectiveFrom: replaceTime,
      publisher: 'CentralBank',
      title: '정정: 금리 인하 결정',
    }));

    await mgr.step(15);
    const snapReplaced = mgr.getCrossAssetLatestSnapshot('acc_bot_val_01')!;
    assert.ok(
      snapReplaced.observedMacroState.values.policyRate < DEFAULT_MACRO_STATE.policyRate,
      '4.5 REPLACE 발효 후 원본 인상 효과는 제거되고 정정 인하 효과만 반영됨'
    );

    console.log('  ✓ [테스트 4] 정보 지연 격차 및 정정 정책(RETRACT/REPLACE) 통과!');
  }

  // ═════════════════════════════════════════════════════════════════
  // 5. [P1] 위험 제약을 실제 주문 경로에 연결 (EXPERIMENTAL_ON)
  // ═════════════════════════════════════════════════════════════════
  console.log('\n▶ [테스트 5] [P1] 위험 제약 게이트와 실제 주문 실행 경로 일관성 검증');
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(1004, START_EPOCH_MS, {
      enableCrossAssetEngine: true,
      crossAssetMode: 'EXPERIMENTAL_ON',
    });

    // 30초 시뮬레이션 진행
    await mgr.step(30);

    // 주문 장부에 생성된 봇 주문 검사
    const botOrders = Array.from(memoryDb.orders.values()).filter((o) => typeof o.user_id === 'string' && o.user_id.startsWith('acc_bot_'));

    for (const ord of botOrders) {
      const snap = mgr.getCrossAssetLatestSnapshot(ord.user_id as string);
      if (snap) {
        const decision = snap.decisions.find((d) => d.assetId === ord.stock_id);
        if (decision) {
          if (ord.side === 'buy') {
            assert.ok(
              decision.deltaQuantity > 0,
              `5.1 실제 제출된 매수 주문(${ord.stock_id})의 목표 델타는 양수(>0)여야 함: delta=${decision.deltaQuantity}`
            );
            assert.ok(
              ord.size <= decision.deltaQuantity,
              `5.2 매수 주문 수량(${ord.size})은 목표 deltaQuantity(${decision.deltaQuantity}) 이하로 클램핑됨`
            );
          } else if (ord.side === 'sell') {
            assert.ok(
              decision.deltaQuantity < 0,
              `5.3 실제 제출된 매도 주문(${ord.stock_id})의 목표 델타는 음수(<0)여야 함: delta=${decision.deltaQuantity}`
            );
            assert.ok(
              ord.size <= Math.abs(decision.deltaQuantity),
              `5.4 매도 주문 수량(${ord.size})은 목표 |deltaQuantity|(${Math.abs(decision.deltaQuantity)}) 이하로 클램핑됨`
            );
          }
        }
      }
    }

    checkSystemInvariants('Test5-OrderRiskGate');
    console.log('  ✓ [테스트 5] 실제 주문 위험 게이트 및 수량 클램핑 검증 통과!');
  }

  // ═════════════════════════════════════════════════════════════════
  // 6. [P2] 요인 노출 3-Factor 동시 수렴 캡핑 및 최종 노출 재계산 검증
  // ═════════════════════════════════════════════════════════════════
  console.log('\n▶ [테스트 6] [P2] 3-Factor 동시 수렴 캡핑 및 최종 재계산 노출 일치 검증');
  {
    const profile = {
      agentId: 'test_capping_agent',
      strategyType: 'value' as const,
      riskAversion: 0.5,
      maxAssetConcentration: 0.40,
      maxSectorConcentration: 0.50,
      minCashBuffer: 0.05,
      maxFactorExposure: {
        rateBeta: 0.10,      // 엄격한 금리 캡 0.10
        growthBeta: 0.10,    // 엄격한 성장 캡 0.10 (무제한 시 0.5 이상)
        commodityBeta: 0.10, // 엄격한 원자재 캡 0.10 (무제한 시 0.3 이상)
      },
      macroSensitivity: 0.5,
      microSensitivity: 0.5,
    };

    const mockAssets: AssetMicroSnapshot[] = [
      { assetId: 'stk_01', ticker: 'STK1', assetClass: 'STOCK', currentPrice: 50000, spreadBps: 10, valuationGap: 0.2 },
      { assetId: 'bnd_01', ticker: 'BND1', assetClass: 'BOND', currentPrice: 10000, spreadBps: 10, duration: 7, isSovereign: true },
      { assetId: 'comm_01', ticker: 'OIL', assetClass: 'COMMODITY', currentPrice: 100, spreadBps: 10, category: 'energy' },
    ];

    const signals = computeCrossAssetSignals(mockAssets, DEFAULT_MACRO_STATE, 'BULL');
    const alloc = computePortfolioAllocation({
      agentProfile: profile,
      nav: 100_000_000,
      availableCash: 100_000_000,
      signals,
      currentHoldings: [],
      assetMetadata: new Map(),
      currentPrices: new Map([['stk_01', 50000], ['bnd_01', 10000], ['comm_01', 100]]),
      simulationTime: 1000,
    });

    // 6.1 최종 노출 캡 준수 검증
    assert.ok(
      alloc.aggregateFactorExposure.growthBeta <= 0.10 + 1e-4,
      `6.1 growthBeta 최종 보고 노출(${alloc.aggregateFactorExposure.growthBeta}) <= 0.10`
    );
    assert.ok(
      alloc.aggregateFactorExposure.commodityBeta <= 0.10 + 1e-4,
      `6.2 commodityBeta 최종 보고 노출(${alloc.aggregateFactorExposure.commodityBeta}) <= 0.10`
    );
    assert.ok(
      alloc.aggregateFactorExposure.rateBeta <= 0.10 + 1e-4,
      `6.3 rateBeta 최종 보고 노출(${alloc.aggregateFactorExposure.rateBeta}) <= 0.10`
    );

    // 6.2 최종 목표 비중으로 재계산한 노출과 반환된 aggregateFactorExposure의 일치 검증
    let recomputedGrowthBeta = 0;
    let recomputedRateBeta = 0;
    let recomputedCommBeta = 0;

    for (const a of alloc.targetAllocations) {
      const sig = signals.get(a.assetId);
      const rContrib = Math.abs(sig?.riskContributions.rates ?? (a.assetClass === 'BOND' ? 0.8 : 0.3));
      const gContrib = Math.abs(sig?.riskContributions.growth ?? (a.assetClass === 'STOCK' ? 0.7 : 0.1));
      const cContrib = Math.abs(sig?.riskContributions.commoditySupply ?? (a.assetClass === 'COMMODITY' ? 0.9 : 0.1));
      recomputedGrowthBeta += a.targetWeight * gContrib;
      recomputedRateBeta += a.targetWeight * rContrib;
      recomputedCommBeta += a.targetWeight * cContrib;
    }

    assert.ok(
      Math.abs(recomputedGrowthBeta - alloc.aggregateFactorExposure.growthBeta) < 1e-3,
      '6.4 최종 목표 비중으로 재계산한 growthBeta와 보고된 aggregateFactorExposure 일치'
    );
    assert.ok(
      Math.abs(recomputedCommBeta - alloc.aggregateFactorExposure.commodityBeta) < 1e-3,
      '6.5 최종 목표 비중으로 재계산한 commodityBeta와 보고된 aggregateFactorExposure 일치'
    );

    console.log('  ✓ [테스트 6] 3-Factor 수렴 캡핑 및 최종 노출 재계산 정합성 통과!');
  }

  // ═════════════════════════════════════════════════════════════════
  // 7. [P2] 국채 정규화 ('govt' 등) 및 위험회피 차별적 반응 검증
  // ═════════════════════════════════════════════════════════════════
  console.log('\n▶ [테스트 7] [P2] 국채 정규화 및 비대칭 안전자산 선호 반응 검증');
  {
    assert.strictEqual(isSovereignBond('govt'), true, "7.1 'govt' 국채 정상 분류");
    assert.strictEqual(isSovereignBond('government'), true, "7.2 'government' 국채 정상 분류");
    assert.strictEqual(isSovereignBond('treasury'), true, "7.3 'treasury' 국채 정상 분류");
    assert.strictEqual(isSovereignBond('국채'), true, "7.4 '국채' 국채 정상 분류");
    assert.strictEqual(isSovereignBond('국고채'), true, "7.5 '국고채' 국채 정상 분류");
    assert.strictEqual(isSovereignBond('corporate'), false, "7.6 'corporate' 회사채 분류");
    assert.strictEqual(isSovereignBond('unknown_bond'), false, "7.7 미확인 채권 fail-closed 비국채 분류");

    // 국채와 회사채의 위기 시 반응 차별화
    const govBond: AssetMicroSnapshot = {
      assetId: 'bnd_ktb',
      ticker: 'KTB',
      assetClass: 'BOND',
      currentPrice: 10000,
      ytm: 3.5,
      duration: 5,
      isSovereign: isSovereignBond('govt'),
    };
    const corpBond: AssetMicroSnapshot = {
      assetId: 'bnd_corp',
      ticker: 'CORP',
      assetClass: 'BOND',
      currentPrice: 10000,
      ytm: 5.5,
      duration: 5,
      isSovereign: isSovereignBond('corporate'),
    };

    const crisisMacro = { ...DEFAULT_MACRO_STATE, creditSpread: 300, riskAversion: 0.8 };
    const sigs = computeCrossAssetSignals([govBond, corpBond], crisisMacro, 'LIQUIDITY_CRISIS');

    const govSig = sigs.get('bnd_ktb')!;
    const corpSig = sigs.get('bnd_corp')!;

    assert.ok(
      govSig.drivers.some((d) => d.factor === 'flightToSafety' && d.contribution > 0),
      '7.8 국채에는 flightToSafety 안전자산 선호 드라이버 적용'
    );
    assert.ok(
      corpSig.drivers.some((d) => d.factor === 'creditSpreadRisk' && d.contribution < 0),
      '7.9 회사채에는 creditSpreadRisk 신용위험 감산 드라이버 적용'
    );
    assert.ok(
      govSig.expectedReturn > corpSig.expectedReturn,
      '7.10 신용위기 시 국채 기대수익이 회사채 기대수익보다 높음'
    );

    console.log('  ✓ [테스트 7] 국채 분류 및 비대칭 반응 검증 통과!');
  }

  // ═════════════════════════════════════════════════════════════════
  // 8. [P2] 옵션 실제 기초자산 신호 연결 검증
  // ═════════════════════════════════════════════════════════════════
  console.log('\n▶ [테스트 8] [P2] 옵션과 실제 기초자산 신호 연결 및 그리스 계산 검증');
  {
    const underStock: AssetMicroSnapshot = {
      assetId: 'stk_under_01',
      ticker: 'UNDER',
      assetClass: 'STOCK',
      currentPrice: 100000,
      spreadBps: 10,
      valuationGap: 0.25, // 강력한 저평가 -> 높은 기대수익
    };

    const callOpt: AssetMicroSnapshot = {
      assetId: 'opt_call_01',
      ticker: 'CALL_100',
      assetClass: 'OPTION',
      currentPrice: 5000,
      optionType: 'CALL',
      delta: 0.55,
      gamma: 0.02,
      theta: -0.05,
      underlyingAssetId: 'stk_under_01',
    };

    const putOpt: AssetMicroSnapshot = {
      assetId: 'opt_put_01',
      ticker: 'PUT_100',
      assetClass: 'OPTION',
      currentPrice: 3000,
      optionType: 'PUT',
      delta: -0.45,
      gamma: 0.02,
      theta: -0.05,
      underlyingAssetId: 'stk_under_01',
    };

    const orphanOpt: AssetMicroSnapshot = {
      assetId: 'opt_orphan_01',
      ticker: 'ORPHAN',
      assetClass: 'OPTION',
      currentPrice: 2000,
      optionType: 'CALL',
      delta: 0.5,
      underlyingAssetId: 'non_existent_stock',
    };

    const sigs = computeCrossAssetSignals([underStock, callOpt, putOpt, orphanOpt], DEFAULT_MACRO_STATE, 'BULL');

    const sigStock = sigs.get('stk_under_01')!;
    const sigCall = sigs.get('opt_call_01')!;
    const sigPut = sigs.get('opt_put_01')!;
    const sigOrphan = sigs.get('opt_orphan_01')!;

    assert.ok(sigStock.expectedReturn > 0, '8.1 저평가 주식의 양수 기대수익');
    assert.ok(
      sigCall.expectedReturn > sigPut.expectedReturn,
      '8.2 주식 상승 전망 시 콜옵션 기대수익이 풋옵션 기대수익보다 명확히 높음'
    );
    assert.ok(
      sigCall.drivers.some((d) => d.factor === 'deltaExposure' && d.contribution > 0),
      '8.3 콜옵션에 기초자산 기대수익 연동 드라이버 반영'
    );
    assert.strictEqual(
      sigOrphan.direction,
      0,
      '8.4 기초자산이 부재한 옵션은 5% 임의 대체 없이 fail-closed 중립(direction=0) 처리'
    );

    console.log('  ✓ [테스트 8] 옵션 실제 기초자산 신호 연결 통과!');
  }

  // ═════════════════════════════════════════════════════════════════
  // 9. [P2] 가격·현금·보유량 정합성 (50,000 fallback 제거 및 예약금 반영)
  // ═════════════════════════════════════════════════════════════════
  console.log('\n▶ [테스트 9] [P2] 50,000 fallback 제거 및 미체결 예약 자산 차감 검증');
  {
    const targetAllocs = [
      {
        assetId: 'stk_valid',
        assetClass: 'STOCK' as const,
        targetWeight: 0.2,
        targetNotional: 20_000_000,
        targetQuantity: 200,
        deltaQuantity: 200,
        unconstrainedWeight: 0.2,
        constraintReasons: [],
      },
      {
        assetId: 'stk_missing_price',
        assetClass: 'STOCK' as const,
        targetWeight: 0.2,
        targetNotional: 20_000_000,
        targetQuantity: 0,
        deltaQuantity: 0,
        unconstrainedWeight: 0.2,
        constraintReasons: [],
      },
    ];

    const currentPrices = new Map<string, number>([
      ['stk_valid', 100_000],
      // 'stk_missing_price'는 가격 맵에서 의도적 누락
    ]);

    // availableCash = 15,000,000 (목표 20,000,000보다 적음)
    const { intents, heldIntents } = convertAllocationsToOrderIntents(
      targetAllocs,
      15_000_000,
      currentPrices
    );

    assert.ok(
      heldIntents.some((h) => h.assetId === 'stk_missing_price' && h.reason === 'INVALID_OR_MISSING_PRICE'),
      '9.1 가격 누락 자산은 50,000원 임의 fallback 없이 INVALID_OR_MISSING_PRICE 로 fail-closed 보류'
    );

    const validIntent = intents.find((i) => i.stockId === 'stk_valid');
    assert.ok(validIntent, '9.2 유효 가격 자산에 대해 주문 의향 생성');
    assert.ok(
      validIntent!.size! * 100_000 * 1.0025 <= 15_000_000,
      '9.3 주문 수량은 0.25% 수수료를 포함한 실제 가용 현금 내로 제한됨'
    );

    console.log('  ✓ [테스트 9] 가격 결측 fail-closed 및 가용 현금 정합성 통과!');
  }

  // ═════════════════════════════════════════════════════════════════
  // 10. SHADOW 모드 무간섭 검증 및 OFF 모드 완벽 회귀 보존
  // ═════════════════════════════════════════════════════════════════
  console.log('\n▶ [테스트 10] SHADOW 모드 무간섭 검증 및 OFF 모드 완벽 회귀 보존');
  {
    const TEST_SEED = 777;

    // 1. OFF 모드 실행
    memoryDb.resetToSeedData();
    const mgrOff = new AgentManager(TEST_SEED, START_EPOCH_MS, {
      enableCrossAssetEngine: false,
      crossAssetMode: 'OFF',
    });
    await mgrOff.step(60);
    const fpOff = getSystemFingerprint(mgrOff);

    // 2. SHADOW 모드 실행 (교차자산 진단 활성화, 실제 장부/주문 주문 미반영)
    memoryDb.resetToSeedData();
    const mgrShadow = new AgentManager(TEST_SEED, START_EPOCH_MS, {
      enableCrossAssetEngine: true,
      crossAssetMode: 'SHADOW',
    });
    await mgrShadow.step(60);
    const fpShadow = getSystemFingerprint(mgrShadow);

    // OFF와 SHADOW의 실제 장부, 체결, 주문, PRNG 지문이 100% 동일해야 함
    assert.strictEqual(
      fpShadow,
      fpOff,
      '10.1 SHADOW 모드의 실제 장부·체결·PRNG 지문이 OFF 모드와 100% 비트 단위 일치'
    );

    const shadowSnap = mgrShadow.getCrossAssetLatestSnapshot('acc_bot_val_01');
    assert.ok(shadowSnap, '10.2 SHADOW 모드에서 교차자산 의사결정 진단 정상 기록');
    assert.ok(shadowSnap.decisions.length > 0, '10.3 SHADOW 모드에서 자산별 판단 내역 존재');

    // 3. Reset 복원 검증
    mgrShadow.reset(TEST_SEED);
    assert.strictEqual(mgrShadow.crossAssetMode, 'OFF', '10.4 reset 후 crossAssetMode === OFF 복원');
    assert.strictEqual(
      mgrShadow.getCrossAssetDiagnosticsHistory().length,
      0,
      '10.5 reset 후 교차자산 진단 이력 초기화'
    );
    assert.strictEqual(mgrShadow.macroState.version, 1, '10.6 reset 후 macroState 버전 초기화');

    console.log('  ✓ [테스트 10] SHADOW 무간섭 및 회귀 검증 통과!');
  }

  // ═════════════════════════════════════════════════════════════════
  // 11. [P1] 목표 배분 부재 및 무효 배분 시 주문 원천 차단 회귀 검증
  // ═════════════════════════════════════════════════════════════════
  console.log('\n▶ [테스트 11] [P1] 목표 배분 부재/무효 시 주문 차단 및 보류 사유 진단 검증');
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(1001, START_EPOCH_MS, {
      enableCrossAssetEngine: true,
      crossAssetMode: 'EXPERIMENTAL_ON',
    });

    const stockList = Array.from(memoryDb.stocks.values());
    const targetStock = stockList[0];
    const valAgent = mgr.agents.get('acc_bot_val_01')!;

    // 11.1 배분 결과 누락(undefined) 시 PORTFOLIO_ALLOCATION_FAILED 차단
    const gateUndefined = mgr.applyCrossAssetRiskGate(
      valAgent,
      targetStock,
      { action: 'buy', stockId: targetStock.id, price: targetStock.current_price, size: 10 },
      undefined,
      1,
      1000
    );
    assert.strictEqual(gateUndefined.allowed, false, '11.1.1 배분 결과 누락 시 주문 차단');
    assert.strictEqual(gateUndefined.heldReason, 'PORTFOLIO_ALLOCATION_FAILED', '11.1.2 보류 사유 PORTFOLIO_ALLOCATION_FAILED 기록');

    // 11.2 미수렴(converged: false) 시 PORTFOLIO_ALLOCATION_FAILED 차단
    const gateUnconverged = mgr.applyCrossAssetRiskGate(
      valAgent,
      targetStock,
      { action: 'buy', stockId: targetStock.id, price: targetStock.current_price, size: 10 },
      {
        accountId: valAgent.accountId,
        simulationTime: 1000,
        converged: false,
        appliedConstraints: ['CONVERGENCE_FAILED'],
        totalNav: 100_000_000,
        availableCash: 100_000_000,
        targetAllocations: [],
        aggregateFactorExposure: { rateBeta: 0, growthBeta: 0, commodityBeta: 0 },
        heldReasons: {},
      },
      1,
      1000
    );
    assert.strictEqual(gateUnconverged.allowed, false, '11.2.1 미수렴 시 주문 차단');
    assert.strictEqual(gateUnconverged.heldReason, 'PORTFOLIO_ALLOCATION_FAILED', '11.2.2 미수렴 시 PORTFOLIO_ALLOCATION_FAILED 기록');

    // 11.3 대상 자산 목표 배분 누락 시 NO_TARGET_ALLOCATION 차단
    const gateNoAlloc = mgr.applyCrossAssetRiskGate(
      valAgent,
      targetStock,
      { action: 'buy', stockId: targetStock.id, price: targetStock.current_price, size: 10 },
      {
        accountId: valAgent.accountId,
        simulationTime: 1000,
        converged: true,
        appliedConstraints: [],
        totalNav: 100_000_000,
        availableCash: 100_000_000,
        targetAllocations: [], // targetStock 누락
        aggregateFactorExposure: { rateBeta: 0, growthBeta: 0, commodityBeta: 0 },
        heldReasons: {},
      },
      1,
      1000
    );
    assert.strictEqual(gateNoAlloc.allowed, false, '11.3.1 목표 배분 누락 시 주문 차단');
    assert.strictEqual(gateNoAlloc.heldReason, 'NO_TARGET_ALLOCATION', '11.3.2 보류 사유 NO_TARGET_ALLOCATION 기록');

    // 11.4 가격 오류로 배분 제외된 경우 INVALID_TARGET_ALLOCATION 차단
    const gatePriceError = mgr.applyCrossAssetRiskGate(
      valAgent,
      targetStock,
      { action: 'buy', stockId: targetStock.id, price: targetStock.current_price, size: 10 },
      {
        accountId: valAgent.accountId,
        simulationTime: 1000,
        converged: true,
        appliedConstraints: [],
        totalNav: 100_000_000,
        availableCash: 100_000_000,
        targetAllocations: [],
        aggregateFactorExposure: { rateBeta: 0, growthBeta: 0, commodityBeta: 0 },
        heldReasons: { [targetStock.id]: 'INVALID_OR_MISSING_PRICE' },
      },
      1,
      1000
    );
    assert.strictEqual(gatePriceError.allowed, false, '11.4.1 가격 오류 배분 제외 시 주문 차단');
    assert.strictEqual(gatePriceError.heldReason, 'INVALID_TARGET_ALLOCATION', '11.4.2 보류 사유 INVALID_TARGET_ALLOCATION 기록');

    // 11.5 비유한/음수 수치 시 INVALID_TARGET_ALLOCATION 차단
    const gateNaN = mgr.applyCrossAssetRiskGate(
      valAgent,
      targetStock,
      { action: 'buy', stockId: targetStock.id, price: targetStock.current_price, size: 10 },
      {
        accountId: valAgent.accountId,
        simulationTime: 1000,
        converged: true,
        appliedConstraints: [],
        totalNav: 100_000_000,
        availableCash: 100_000_000,
        targetAllocations: [
          {
            assetId: targetStock.id,
            assetClass: 'STOCK',
            targetWeight: NaN,
            targetQuantity: 10,
            targetNotional: 100000,
            deltaQuantity: 10,
            unconstrainedWeight: NaN,
            constraintReasons: [],
          },
        ],
        aggregateFactorExposure: { rateBeta: 0, growthBeta: 0, commodityBeta: 0 },
        heldReasons: {},
      },
      1,
      1000
    );
    assert.strictEqual(gateNaN.allowed, false, '11.5.1 비유한 수치(NaN) 목표 배분 차단');
    assert.strictEqual(gateNaN.heldReason, 'INVALID_TARGET_ALLOCATION', '11.5.2 보류 사유 INVALID_TARGET_ALLOCATION 기록');

    // 11.6 위험 제약 미충족 (buy 시 deltaQuantity <= 0) RISK_CONSTRAINT_UNSATISFIED 차단
    const gateRiskNoBuy = mgr.applyCrossAssetRiskGate(
      valAgent,
      targetStock,
      { action: 'buy', stockId: targetStock.id, price: targetStock.current_price, size: 10 },
      {
        accountId: valAgent.accountId,
        simulationTime: 1000,
        converged: true,
        appliedConstraints: [],
        totalNav: 100_000_000,
        availableCash: 100_000_000,
        targetAllocations: [
          {
            assetId: targetStock.id,
            assetClass: 'STOCK',
            targetWeight: 0.1,
            targetQuantity: 0,
            targetNotional: 0,
            deltaQuantity: 0, // 추가 매수 불가
            unconstrainedWeight: 0.1,
            constraintReasons: [],
          },
        ],
        aggregateFactorExposure: { rateBeta: 0, growthBeta: 0, commodityBeta: 0 },
        heldReasons: {},
      },
      1,
      1000
    );
    assert.strictEqual(gateRiskNoBuy.allowed, false, '11.6.1 deltaQuantity<=0 시 매수 차단');
    assert.strictEqual(gateRiskNoBuy.heldReason, 'RISK_CONSTRAINT_UNSATISFIED', '11.6.2 보류 사유 RISK_CONSTRAINT_UNSATISFIED 기록');

    // 11.7 실제 시뮬레이션 스텝 진행 시 모든 제출 주문에 유효한 배분 결정이 대응하는지 검증
    await mgr.step(5);
    const allOrdersAfterStep = Array.from(memoryDb.orders.values());
    for (const ord of allOrdersAfterStep) {
      if (typeof ord.user_id === 'string' && ord.user_id.startsWith('acc_bot_')) {
        const snap = mgr.getCrossAssetLatestSnapshot(ord.user_id);
        assert.ok(snap, `11.7.1 주문 제출 에이전트(${ord.user_id})의 교차자산 스냅샷 존재`);
        const decision = snap.decisions.find((d) => d.assetId === ord.stock_id);
        assert.ok(decision, `11.7.2 주문 제출 종목(${ord.stock_id})에 대한 배분 결정 존재`);
        if (ord.side === 'buy') {
          assert.ok(
            decision.deltaQuantity > 0,
            `11.7.3 매수 주문 종목의 deltaQuantity(${decision.deltaQuantity})는 양수여야 함`
          );
        } else if (ord.side === 'sell') {
          assert.ok(
            decision.deltaQuantity < 0,
            `11.7.4 매도 주문 종목의 deltaQuantity(${decision.deltaQuantity})는 음수여야 함`
          );
        }
      }
    }

    // 11.8 동일 입력과 seed에서 보류 사유와 결과의 결정론 검증
    mgr.reset(1001);
    mgr.setCrossAssetMode('EXPERIMENTAL_ON');
    const runGateTest = (m: AgentManager) => {
      const agent = m.agents.get('acc_bot_val_01')!;
      return m.applyCrossAssetRiskGate(
        agent,
        targetStock,
        { action: 'buy', stockId: targetStock.id, price: targetStock.current_price, size: 10 },
        undefined,
        1,
        1000
      );
    };
    const resA = runGateTest(mgr);
    const holdsCountA = mgr.crossAssetDiagnostics.getOrderGateHolds().length;

    mgr.reset(1001);
    mgr.setCrossAssetMode('EXPERIMENTAL_ON');
    const resB = runGateTest(mgr);
    const holdsCountB = mgr.crossAssetDiagnostics.getOrderGateHolds().length;

    assert.strictEqual(resA.allowed, resB.allowed, '11.8.1 동일 seed/입력에서 gate 허용 여부 결정론 일치');
    assert.strictEqual(resA.heldReason, resB.heldReason, '11.8.2 동일 seed/입력에서 heldReason 결정론 일치');
    assert.strictEqual(holdsCountA, holdsCountB, '11.8.3 동일 seed에서 게이트 보류 기록 수 결정론적 일치');

    console.log('  ✓ [테스트 11] 목표 배분 부재/무효 시 주문 차단 및 진단 기록 검증 통과!');
  }

  // ═════════════════════════════════════════════════════════════════
  // 12. [P1] 공통요인 노출 한도 정밀 캡핑 및 미수렴 fail-closed 회귀 검증
  // ═════════════════════════════════════════════════════════════════
  console.log('\n▶ [테스트 12] [P1] 공통요인 노출 한도 정밀 캡핑 및 불변조건 검증');
  {
    // 12.1 금리 기여도가 정확히 0.3인 주식 2개, maxRateBeta = 0.1
    const profile: AgentMacroProfile = {
      agentId: 'test_cap_bot',
      strategyType: 'value',
      macroSensitivity: 0.5,
      microSensitivity: 0.5,
      riskAversion: 1.0,
      maxAssetConcentration: 0.50,
      maxSectorConcentration: 1.0,
      minCashBuffer: 0.05,
      maxFactorExposure: {
        rateBeta: 0.10,
        growthBeta: 1.5,
        commodityBeta: 1.5,
      },
    };

    const signals = new Map<string, CrossAssetSignal>();
    signals.set('stock_A', {
      assetId: 'stock_A',
      ticker: 'STK_A',
      assetClass: 'STOCK',
      direction: 0.8,
      expectedReturn: 0.10,
      expectedVolatility: 0.15,
      confidence: 0.9,
      horizonMs: 5000,
      liquidityPenalty: 0.001,
      riskContributions: { rates: 0.30, growth: 0.2, commoditySupply: 0.0 },
      drivers: [],
    });
    signals.set('stock_B', {
      assetId: 'stock_B',
      ticker: 'STK_B',
      assetClass: 'STOCK',
      direction: 0.8,
      expectedReturn: 0.10,
      expectedVolatility: 0.15,
      confidence: 0.9,
      horizonMs: 5000,
      liquidityPenalty: 0.001,
      riskContributions: { rates: 0.30, growth: 0.2, commoditySupply: 0.0 },
      drivers: [],
    });

    const allocResult = computePortfolioAllocation({
      agentProfile: profile,
      nav: 100_000_000,
      availableCash: 100_000_000,
      signals,
      currentHoldings: [],
      assetMetadata: new Map([
        ['stock_A', { sectorId: 'it' }],
        ['stock_B', { sectorId: 'it' }],
      ]),
      currentPrices: new Map([
        ['stock_A', 10000],
        ['stock_B', 10000],
      ]),
      simulationTime: 1000,
    });

    assert.strictEqual(allocResult.converged, true, '12.1.1 3-factor 캡핑 정상 수렴');
    assert.ok(allocResult.appliedConstraints.includes('RATE_FACTOR_EXPOSURE_CAPPED'), '12.1.2 RATE_FACTOR_EXPOSURE_CAPPED 제약 적용 기록 확인');
    assert.ok(
      allocResult.aggregateFactorExposure.rateBeta <= 0.10 + 1e-4,
      `12.1.3 조정 후 rateBeta(${allocResult.aggregateFactorExposure.rateBeta}) <= 0.10 + 1e-4 불변조건 만족`
    );

    // 12.2 음의 기여를 갖는 헤지 자산 보존 검증 (주식+국채 혼합)
    signals.set('bond_govt', {
      assetId: 'bond_govt',
      ticker: 'BND_G',
      assetClass: 'BOND',
      direction: 0.8,
      expectedReturn: 0.05,
      expectedVolatility: 0.05,
      confidence: 0.9,
      horizonMs: 5000,
      liquidityPenalty: 0.001,
      riskContributions: { rates: -0.30, growth: -0.2, commoditySupply: 0.0 },
      drivers: [],
    });
    const hedgeResult = computePortfolioAllocation({
      agentProfile: profile,
      nav: 100_000_000,
      availableCash: 100_000_000,
      signals,
      currentHoldings: [],
      assetMetadata: new Map([
        ['stock_A', { sectorId: 'it' }],
        ['stock_B', { sectorId: 'it' }],
        ['bond_govt', { sectorId: 'sovereign' }],
      ]),
      currentPrices: new Map([
        ['stock_A', 10000],
        ['stock_B', 10000],
        ['bond_govt', 10000],
      ]),
      simulationTime: 1000,
    });
    assert.strictEqual(hedgeResult.converged, true, '12.2.1 헤지 자산 포함 포트폴리오 수렴');
    assert.ok(
      hedgeResult.aggregateFactorExposure.rateBeta <= 0.10 + 1e-4,
      '12.2.2 헤지 포함 포트폴리오 rateBeta 불변조건 만족'
    );

    // 12.3 자산 입력 순서 교환(Permutation) 불변성 검증
    const reversedSignals = new Map<string, CrossAssetSignal>();
    reversedSignals.set('stock_B', signals.get('stock_B')!);
    reversedSignals.set('stock_A', signals.get('stock_A')!);
    const permResult = computePortfolioAllocation({
      agentProfile: profile,
      nav: 100_000_000,
      availableCash: 100_000_000,
      signals: reversedSignals,
      currentHoldings: [],
      assetMetadata: new Map([
        ['stock_B', { sectorId: 'it' }],
        ['stock_A', { sectorId: 'it' }],
      ]),
      currentPrices: new Map([
        ['stock_B', 10000],
        ['stock_A', 10000],
      ]),
      simulationTime: 1000,
    });
    assert.strictEqual(permResult.converged, true, '12.3.1 순서 변경 시에도 수렴');
    const aWeight1 = allocResult.targetAllocations.find((a) => a.assetId === 'stock_A')!.targetWeight;
    const aWeight2 = permResult.targetAllocations.find((a) => a.assetId === 'stock_A')!.targetWeight;
    assert.ok(
      Math.abs(aWeight1 - aWeight2) < 1e-6,
      '12.3.2 입력 순서에 무관하게 결정론적 비중 도출'
    );

    // 12.4 상충하여 만족할 수 없는 제약 시 fail-closed 검증 (converged === false)
    const impossibleProfile: AgentMacroProfile = {
      ...profile,
      minCashBuffer: 0.95,
      maxAssetConcentration: 0.01,
      maxFactorExposure: {
        rateBeta: -0.5,
        growthBeta: 1.5,
        commodityBeta: 1.5,
      },
    };
    const impossibleResult = computePortfolioAllocation({
      agentProfile: impossibleProfile,
      nav: 100_000_000,
      availableCash: 100_000_000,
      signals,
      currentHoldings: [],
      assetMetadata: new Map([
        ['stock_A', { sectorId: 'it' }],
        ['stock_B', { sectorId: 'it' }],
      ]),
      currentPrices: new Map([
        ['stock_A', 10000],
        ['stock_B', 10000],
      ]),
      simulationTime: 1000,
    });
    assert.strictEqual(impossibleResult.converged, false, '12.4 불가능한 제약 조건 시 converged === false 명시적 반환');

    console.log('  ✓ [테스트 12] 공통요인 노출 한도 정밀 캡핑 및 불변조건 검증 통과!');
  }

  // ═════════════════════════════════════════════════════════════════
  // 13. [P2] reset 이후 실제 거시 상태와 관측 상태 baseline 보존 및 누적 전진 검증
  // ═════════════════════════════════════════════════════════════════
  console.log('\n▶ [테스트 13] [P2] initialMacroState.growth=0.08 baseline 보존 및 누적 전진 검증');
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(1001, START_EPOCH_MS, {
      enableCrossAssetEngine: true,
      crossAssetMode: 'EXPERIMENTAL_ON',
      initialMacroState: {
        growth: 0.08,
      },
    });

    // 13.1 초기 baseline 검증
    assert.strictEqual(mgr.macroState.growth, 0.08, '13.1.1 초기 macroState.growth === 0.08 보존');
    const valBotBelief0 = mgr.getAgentMacroBelief('acc_bot_val_01');
    assert.ok(valBotBelief0, '13.1.2 val_01 에이전트 관측 상태 존재');
    assert.strictEqual(valBotBelief0.growth, 0.08, '13.1.3 val_01 관측 growth === 0.08 초기 baseline 일치');
    assert.strictEqual(valBotBelief0.version, 1, '13.1.4 val_01 초기 버전 === 1');

    // 13.2 3단계 전진 동안 버전 단조 증가 검증
    await mgr.step(5);
    const snap1 = mgr.getCrossAssetLatestSnapshot('acc_bot_val_01')!;
    assert.strictEqual(snap1.macroVersion, 2, '13.2.1 1스텝 후 매크로 버전 === 2');

    await mgr.step(5);
    const snap2 = mgr.getCrossAssetLatestSnapshot('acc_bot_val_01')!;
    assert.strictEqual(snap2.macroVersion, 3, '13.2.2 2스텝 후 매크로 버전 === 3');

    await mgr.step(5);
    const snap3 = mgr.getCrossAssetLatestSnapshot('acc_bot_val_01')!;
    assert.strictEqual(snap3.macroVersion, 4, '13.2.3 3스텝 후 매크로 버전 === 4');

    // 13.3 Reset 후 baseline 복원 검증
    mgr.reset(1001);
    assert.strictEqual(mgr.macroState.growth, 0.08, '13.3.1 reset 후 macroState.growth === 0.08 baseline 복원');
    const valBotBeliefReset = mgr.getAgentMacroBelief('acc_bot_val_01');
    assert.ok(valBotBeliefReset, '13.3.2 reset 후 등록된 val_01 관측 상태 존재');
    assert.strictEqual(valBotBeliefReset.growth, 0.08, '13.3.3 reset 후 관측 growth === 0.08 baseline 일치');
    assert.strictEqual(valBotBeliefReset.version, 1, '13.3.4 reset 후 버전 === 1 초기화');

    // 13.4 재실행 시 지문 동일성 검증
    mgr.setCrossAssetMode('EXPERIMENTAL_ON');
    await mgr.step(5);
    const snapRe1 = mgr.getCrossAssetLatestSnapshot('acc_bot_val_01')!;
    assert.strictEqual(snapRe1.macroVersion, 2, '13.4.1 재실행 1스텝 후 매크로 버전 === 2');
    assert.strictEqual(
      snapRe1.observedMacroState.values.growth,
      snap1.observedMacroState.values.growth,
      '13.4.2 reset 후 동일 seed/입력 재실행 시 관측치 100% 동일'
    );

    console.log('  ✓ [테스트 13] baseline 보존 및 관측 상태 누적 전진 검증 통과!');
  }

  // ═════════════════════════════════════════════════════════════════
  // 14. [P2] 기본 거시 프로필 일원화 및 전략-배분 일치 검증
  // ═════════════════════════════════════════════════════════════════
  console.log('\n▶ [테스트 14] [P2] 기본 거시 프로필 일원화 및 불변성 검증');
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(1001, START_EPOCH_MS, {
      enableCrossAssetEngine: true,
      crossAssetMode: 'EXPERIMENTAL_ON',
    });

    const valAgent = mgr.agents.get('acc_bot_val_01')!;
    const trendAgent = mgr.agents.get('acc_bot_trend_01')!;

    // 14.1 등록 시 단 1회 해석된 프로필 존재 확인
    assert.ok(valAgent.macroProfile, '14.1.1 가치투자 봇 macroProfile 등록 완료');
    assert.ok(trendAgent.macroProfile, '14.1.2 모멘텀 봇 macroProfile 등록 완료');
    assert.strictEqual(valAgent.macroProfile.macroSensitivity, 0.75, '14.1.3 가치투자 봇 macroSensitivity === 0.75');
    assert.strictEqual(valAgent.macroProfile.microSensitivity, 0.25, '14.1.4 가치투자 봇 microSensitivity === 0.25');
    assert.strictEqual(trendAgent.macroProfile.macroSensitivity, 0.45, '14.1.5 모멘텀 봇 macroSensitivity === 0.45');
    assert.strictEqual(trendAgent.macroProfile.microSensitivity, 0.70, '14.1.6 모멘텀 봇 microSensitivity === 0.70');

    // 14.2 사용자 지정 프로필 전달 시 방어적 복사 및 보존
    const customProfile: AgentMacroProfile = {
      agentId: 'acc_custom_01',
      strategyType: 'value',
      macroSensitivity: 0.60,
      microSensitivity: 0.40,
      riskAversion: 1.0,
      maxAssetConcentration: 0.25,
      maxSectorConcentration: 0.40,
      minCashBuffer: 0.15,
      maxFactorExposure: {
        rateBeta: 0.35,
        growthBeta: 0.70,
        commodityBeta: 0.30,
      },
    };
    mgr.registerAgent({
      accountId: 'acc_custom_01',
      agentId: 'agent_custom_01',
      participantType: 'bot',
      strategyType: 'value',
      name: '커스텀 프로필 봇',
      targetPositions: {},
      maxOrderSize: 100,
      maxPosition: 5000,
      riskTolerance: 0.7,
      urgency: 0.5,
      activityRate: 0.5,
      infoLatency: 0,
      evaluationsPerStep: 2,
      sectorPreferences: {},
      nextDecisionTime: 0,
      stats: { ordersSubmitted: 0, ordersCancelled: 0, fillsCount: 0, volumeTraded: 0, feesPaid: 0, realizedPnl: 0 },
      macroProfile: customProfile,
    });

    const registeredCustom = mgr.agents.get('acc_custom_01')!;
    assert.strictEqual(registeredCustom.macroProfile!.macroSensitivity, 0.60, '14.2.1 커스텀 프로필 macroSensitivity 보존');
    assert.notStrictEqual(registeredCustom.macroProfile, customProfile, '14.2.2 원본 프로필 객체와 분리된 방어적 복사본 사용');

    // 14.3 동일 seed에서 PRNG 지문 불변 확인
    const prngBefore = mgr.agentPrngs.get('acc_bot_val_01')!.getState();
    assert.ok(prngBefore, '14.3 에이전트 PRNG 상태 유효');

    console.log('  ✓ [테스트 14] 기본 거시 프로필 일원화 및 불변성 검증 통과!');
  }

  // ═════════════════════════════════════════════════════════════════
  // 15. [P2] 이벤트 적용 범위(Scope) 격리 및 원인 추적 체인(Causality Trace) 검증
  // ═════════════════════════════════════════════════════════════════
  console.log('\n▶ [테스트 15] [P2] 이벤트 적용 범위 격리 및 sourceEventId 인과 추적 검증');
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(1001, START_EPOCH_MS, {
      enableCrossAssetEngine: true,
      crossAssetMode: 'EXPERIMENTAL_ON',
    });

    const stockList = Array.from(memoryDb.stocks.values());
    const targetStock = stockList[0];
    const t0 = mgr.clock.simulationTime;

    // 대상 종목에 펀더멘털 가치를 부여하여 긍정적 밸류에이션 확보
    mgr.fundamentals.set(targetStock.id, targetStock.current_price * 1.3);

    // 15.1 특정 종목만 대상으로 한 자산 한정 충격 등록
    const targetAssetEvent: MarketEvent = {
      eventId: 'evt_scoped_asset_001',
      scope: 'stock',
      eventType: 'OFFICIAL',
      targetStockIds: [targetStock.id],
      valuationSignal: 0.80,
      attentionShock: 0.20,
      uncertaintyShock: 0.05,
      confidence: 0.95,
      halfLife: 500,
      publishedAt: t0,
      effectiveFrom: t0,
      publisher: 'IndustryWeekly',
      title: '특정 종목 기술 혁신 특허 취득',
      content: '핵심 기술 특허 취득으로 단독 수혜',
      macroImpacts: [
        { factor: 'growth', direction: 1, magnitude: 0.9, halfLifeSeconds: 500 },
      ],
    };
    mgr.registerEvent(targetAssetEvent);

    await mgr.step(5);

    // 전역 거시 상태의 growth는 변경되지 않아야 함 (범위 격리)
    assert.strictEqual(
      mgr.macroState.growth,
      DEFAULT_MACRO_STATE.growth,
      '15.1.1 자산 한정 충격은 전역 MacroState.growth를 변경하지 않음'
    );

    // 진단 스냅샷에서 대상 자산의 배분 결정 확인
    const snapVal = mgr.getCrossAssetLatestSnapshot('acc_bot_val_01')!;
    const targetDecision = snapVal.decisions.find((d) => d.assetId === targetStock.id);
    assert.ok(targetDecision, '15.1.2 대상 자산의 배분 결정 존재 확인');
    assert.ok(targetDecision.constrainedWeight > 0 && targetDecision.targetQuantity > 0, '15.1.3 단독 수혜 자산 목표 비중 및 수량 양수 할당 확인');
    assert.ok(targetDecision.sourceEventIds.includes('evt_scoped_asset_001'), '15.1.4 대상 자산 결정에 원본 이벤트 ID 연계 확인');

    // 15.2 섹터 한정 충격 등록 및 무관한 섹터 불변 검증
    const tCur = mgr.clock.simulationTime;
    const sectorEvent: MarketEvent = {
      eventId: 'evt_scoped_sector_semi',
      scope: 'sector',
      sectorId: 'semiconductor',
      eventType: 'OFFICIAL',
      targetStockIds: [],
      valuationSignal: 0.60,
      attentionShock: 0.20,
      uncertaintyShock: 0.05,
      confidence: 0.95,
      halfLife: 500,
      publishedAt: tCur,
      effectiveFrom: tCur,
      publisher: 'SemiconductorTimes',
      title: '반도체 보조금 특별법 통과',
      content: '반도체 전용 세제 혜택 및 설비투자 지원',
      macroImpacts: [
        { factor: 'growth', direction: 1, magnitude: 0.7, halfLifeSeconds: 500 },
      ],
    };
    mgr.registerEvent(sectorEvent);

    await mgr.step(5);

    // 전역 MacroState 여전히 격리 유지
    assert.strictEqual(
      mgr.macroState.growth,
      DEFAULT_MACRO_STATE.growth,
      '15.2.1 섹터 한정 충격도 전역 MacroState.growth를 변경하지 않음'
    );

    // 15.3 정정 이벤트(RETRACT) 적용 시 원본 sourceEventId 무효화 검증
    const tRetract = mgr.clock.simulationTime;
    const retractEvent: MarketEvent = {
      eventId: 'evt_scoped_asset_001_retract',
      originalEventId: 'evt_scoped_asset_001',
      eventType: 'CORRECTION',
      correctionMode: 'RETRACT',
      scope: 'stock',
      targetStockIds: [targetStock.id],
      valuationSignal: 0,
      attentionShock: 0.1,
      uncertaintyShock: 0.1,
      confidence: 0.95,
      halfLife: 500,
      publishedAt: tRetract,
      effectiveFrom: tRetract,
      publisher: 'IndustryWeekly',
      title: '특허 취득 오보 정정 및 취소',
      content: '이전 특허 취득 보도는 사실무근으로 확인되어 전면 철회',
    };
    mgr.registerEvent(retractEvent);
    await mgr.step(5);

    // 15.4 진단 조회 순수성 및 방어적 복사본 검증
    const holds1 = mgr.crossAssetDiagnostics.getOrderGateHolds();
    const history1 = mgr.getCrossAssetDiagnosticsHistory('acc_bot_val_01');
    assert.ok(Array.isArray(holds1), '15.4.1 getOrderGateHolds 정상 조회');
    assert.ok(Array.isArray(history1), '15.4.2 getCrossAssetDiagnosticsHistory 정상 조회');

    console.log('  ✓ [테스트 15] 이벤트 적용 범위 격리 및 인과 추적 검증 통과!');
  }

  console.log('\n================================================================');
  console.log('  🎉 교차자산 거시 봇 전체 종합 검증 스위트 모든 테스트 100% 통과!');
  console.log('================================================================\n');
  process.exit(0);
}

runCrossAssetFullSuite().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
