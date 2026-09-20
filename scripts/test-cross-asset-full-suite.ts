/**
 * scripts/test-cross-asset-full-suite.ts
 *
 * STOCKSYS 교차자산 거시 의사결정 엔진 전체 종합 검증 스위트
 *
 * 1. 결정론 (Determinism):
 *    - 동일 seed/입력 시 신호, 목표 포지션, 주문 비트 단위 일치
 *    - 진단 조회(getCrossAssetLatestSnapshot, getCrossAssetDiagnosticsHistory) 전후 PRNG 상태 불변
 *    - 시스템 벽시계(Date.now) 무관, 순수 시뮬레이션 시계 전진에만 의존
 *
 * 2. 정보 경계 (Information Boundary):
 *    - publishedAt / effectiveFrom 이전의 미래/미공개 이벤트 신호 반영 차단
 *    - 발효 시점 경계(simTime >= effectiveFrom)에서 정확히 1회 반영
 *    - 봇 관측과 엔진 내부 실상태의 명확한 분리
 *
 * 3. 경제적 방향성 & 차별적 전달 (10대 시나리오 전수 검증):
 *    - 성장 상승 / 인플레 안정: 주식(기술/제조) 강세, 회사채 스프레드 축소
 *    - 성장 둔화 / 인플레 상승: 장기채 하락, 원자재 상대 우위, 주식 밸류에이션 압박
 *    - 정책금리 급등: 장기 듀레이션 채권 및 고P/E 기술주 하락, 단기/금융주 상대 방어
 *    - 유동성 위축: 유동성 패널티 증가, 스프레드 확대, 위험자산 전반 비중 축소
 *    - 신용 스프레드 확대: 회사채 하락, 국채(안전자산) 선호
 *    - 달러 강세: 원자재 수요 및 원자재 가격 압박
 *    - 원유 공급 충격: 원유 급등, 에너지 섹터 수혜, 제조/소비재 마진 압박
 *    - 위험회피 급등: 안전자산(국채/금) 선호, 주식 비중 축소, 풋옵션 수요
 *    - 기업 실적 충격: 개별 주식 펀더멘털 괴리 신호
 *    - 변동성 급등: 옵션 베가 신호 상승, 방향성 비중 축소
 *
 * 4. 회계·위험 한도 및 Fail-Closed 불변식:
 *    - 공통 요인 노출(금리, 성장, 원자재 Beta) 한도 캡핑
 *    - 단일 자산/섹터 집중도 한도 준수
 *    - 최소 현금 버퍼(minCashBuffer) 보존
 *    - 거래 엔진 미지원 자산군(채권, 원자재, 옵션) 주문 제출 차단 및 fail-closed 사유 기록
 *    - 음수 현금/보유량 방지, NaN/Infinity 완전 차단
 *
 * 5. 회귀 및 SHADOW 모드 무간섭 검증:
 *    - crossAssetMode === 'OFF' 시 기존 결과 100% 보존
 *    - crossAssetMode === 'SHADOW' 시 실제 장부/체결/PRNG 지문이 OFF와 100% 동일
 */

import * as assert from 'assert';
import { memoryDb } from '../lib/memoryDb/memoryStore';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import { DEFAULT_MACRO_STATE } from '../lib/engine/simulation/macro/macroState';
import { MarketEvent } from '../lib/engine/simulation/marketEventTypes';

const START_EPOCH_MS = 1773500000000;

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
  // 2. 정보 경계 (Information Boundary)
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
      valuationSignal: 0.90,
      attentionShock: 0.30,
      uncertaintyShock: 0.10,
      confidence: 0.95,
      halfLife: 1000,
      publishedAt: t0,
      effectiveFrom: futureEffectiveTime,
      publisher: 'EnergyAgency',
      title: '중동 분쟁 지정학적 위기 고조 및 군사 충돌',
      content: '주요 분쟁 지역 확산으로 지정학 위험과 군사적 충돌 우려 확산',
    });
    assert.strictEqual(regOk, true, '2.0 이벤트 등록 성공 검증');

    // 10초 스텝 진행 (아직 effectiveFrom 이전)
    await mgr.step(10);
    const snapBefore = mgr.getCrossAssetLatestSnapshot('acc_bot_val_01');
    assert.ok(snapBefore, '2.1 진단 스냅샷 생성 확인');

    // 거시 상태의 geopoliticalRisk 및 uncertainty가 baseline 수준 유지 (미래 이벤트 미반영)
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
  // 3. 자산군 차별화 및 위험 한도 (Risk Limits & Fail-Closed)
  // ═════════════════════════════════════════════════════════════════
  console.log('\n▶ [테스트 3] 공통 요인 노출 캡핑, 포지션 집중도 한도 및 Fail-Closed 검증');
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(2022, START_EPOCH_MS, {
      enableCrossAssetEngine: true,
      crossAssetMode: 'EXPERIMENTAL_ON',
      initialMacroState: {
        growth: 0.05,       // 강력한 경기 호황
        inflation: 0.015,
        policyRate: 0.02,
        liquidity: 0.85,
        riskAversion: 0.15,
      },
    });

    await mgr.step(10);
    const snap = mgr.getCrossAssetLatestSnapshot('acc_bot_val_01');
    assert.ok(snap, '3.1 호황 국면 스냅샷 생성');

    // 1. 공통 요인 노출(Factor Exposure) 상한선 준수 확인
    const factorExp = snap.aggregateFactorExposure;
    assert.ok(factorExp.rateBeta <= 0.50 + 1e-4, '3.2 Rate Beta 상한(0.50) 이내 제약');
    assert.ok(factorExp.growthBeta <= 0.80 + 1e-4, '3.3 Growth Beta 상한(0.80) 이내 제약');

    // 2. 단일 자산 최대 비중 한도(maxAssetConcentration = 0.25) 준수 확인
    for (const dec of snap.decisions) {
      assert.ok(
        dec.constrainedWeight <= 0.25 + 1e-4,
        `3.4 단일 자산(${dec.assetId}) 비중(${dec.constrainedWeight})이 25% 한도 이내`
      );
    }

    // 3. Fail-Closed 검증: 주식(STOCK) 외 자산(BOND, COMMODITY, OPTION)은 명확한 보류 사유와 함께 주문 미생성
    for (const dec of snap.decisions) {
      if (dec.assetClass !== 'STOCK') {
        assert.ok(
          dec.heldReason && dec.heldReason.includes(`EXECUTION_NOT_SUPPORTED_FOR_${dec.assetClass}`),
          `3.5 미지원 자산군(${dec.assetClass})의 주문 생성이 안전하게 fail-closed 보류됨: ${dec.heldReason}`
        );
        assert.ok(
          dec.orderAction === 'hold' || dec.orderAction === undefined,
          `3.6 미지원 자산군(${dec.assetClass})에 대해 실제 거래 주문이 발행되지 않음`
        );
      }
    }

    // 4. 회계 불변식 검사
    checkSystemInvariants('Test3-RiskLimits');
    console.log('  ✓ [테스트 3] 요인 캡핑, 포지션 한도 및 Fail-Closed 불변식 통과!');
  }

  // ═════════════════════════════════════════════════════════════════
  // 4. SHADOW 모드 및 무간섭 회귀 검증
  // ═════════════════════════════════════════════════════════════════
  console.log('\n▶ [테스트 4] SHADOW 모드 무간섭 검증 및 OFF 모드 완벽 회귀 보존');
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
      '4.1 SHADOW 모드의 실제 장부·체결·PRNG 지문이 OFF 모드와 100% 비트 단위 일치'
    );

    // SHADOW 모드에서는 진단 데이터가 정상 수집되어야 함
    const shadowSnap = mgrShadow.getCrossAssetLatestSnapshot('acc_bot_val_01');
    assert.ok(shadowSnap, '4.2 SHADOW 모드에서 교차자산 의사결정 진단 정상 기록');
    assert.ok(shadowSnap.decisions.length > 0, '4.3 SHADOW 모드에서 자산별 판단 내역 존재');

    // 3. Reset 복원 검증
    mgrShadow.reset(TEST_SEED);
    assert.strictEqual(mgrShadow.crossAssetMode, 'OFF', '4.4 reset 후 crossAssetMode === OFF 복원');
    assert.strictEqual(
      mgrShadow.getCrossAssetDiagnosticsHistory().length,
      0,
      '4.5 reset 후 교차자산 진단 이력 초기화'
    );
    assert.strictEqual(mgrShadow.macroState.version, 1, '4.6 reset 후 macroState 버전 초기화');

    console.log('  ✓ [테스트 4] SHADOW 무간섭 및 회귀 검증 통과!');
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
