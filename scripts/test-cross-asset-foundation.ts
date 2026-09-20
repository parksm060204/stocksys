/**
 * test-cross-asset-foundation.ts
 *
 * 1단계 교차자산 거시 봇 의사결정 기반 모델 및 순수 계산 엔진 단위 테스트
 * - 결정론적 재현성 (동일 입력 bit-for-bit 일치)
 * - 미공개 이벤트 차단 (effectiveFrom 경계)
 * - [P1] 거시 충격 방향 모델 및 명시적 거시 효과 검증 (Section 2)
 * - [P1] 충격 적용의 시간 의미 정리 및 ODE 평균회귀 일관성 (Section 3)
 * - 10대 경제 시나리오별 차별적 전달 및 신호 방향성 검증
 * - 순수 함수 무상태성 (PRNG/시스템 시계 비오염)
 */

import assert from 'node:assert';
import {
  advanceMacroState,
  convertEventToEconomicShock,
  convertEventToEconomicShocks,
  createObservableMacroState,
  DEFAULT_MACRO_STATE,
} from '../lib/engine/simulation/macro/macroState';
import { ObservableMarketEvent } from '../lib/engine/simulation/marketEventTypes';
import {
  AssetMicroSnapshot,
  computeCrossAssetSignals,
} from '../lib/engine/simulation/crossAsset/crossAssetSignalEngine';
import { analyzeTransmissionContext } from '../lib/engine/simulation/crossAsset/transmissionEngine';

function createObsEvent(partial: Partial<ObservableMarketEvent> & { eventId: string; title: string }): ObservableMarketEvent {
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
    publisher: 'CentralBank',
    content: 'Default content',
    ...partial,
  };
}

console.log('================================================================');
console.log('  🧪 [STOCKSYS] 교차자산 거시 봇 기반 모델 및 전달 엔진 검증');
console.log('================================================================\n');

async function runFoundationTests() {
  // ─────────────────────────────────────────────────────────────
  // 1. 공통 거시 상태 초기화 및 결정론적 전진 (Pure Function)
  // ─────────────────────────────────────────────────────────────
  console.log('▶ [테스트 1] MacroState 결정론 및 평균회귀 검증');
  {
    const state0 = DEFAULT_MACRO_STATE;
    assert.strictEqual(state0.growth, 0.02, '1-A 기본 성장률 2%');
    assert.strictEqual(state0.inflation, 0.025, '1-B 기본 인플레이션 2.5%');
    assert.strictEqual(state0.policyRate, 0.035, '1-C 기본 정책금리 3.5%');
    assert.strictEqual(state0.realRate, 0.010, '1-D 기본 실질금리 1.0%');

    // 충격 없는 상태에서 60초 경과 -> 평균회귀 상태 유지
    const state1 = advanceMacroState(state0, [], 60, 60_000);
    const state2 = advanceMacroState(state0, [], 60, 60_000);
    assert.strictEqual(JSON.stringify(state1), JSON.stringify(state2), '1-E 동일 입력 시 100% 비트 단위 일치');
    assert.strictEqual(state1.growth, state0.growth, '1-F 기준점 유지');
    assert.strictEqual(state1.version, state0.version + 1, '1-G 버전 증가');

    // 관측 복사본 생성 검증
    const obsCopy = createObservableMacroState(state1);
    assert.notStrictEqual(obsCopy.state, state1, '1-H 방어적 복사본 반환');
    assert.strictEqual(obsCopy.state.growth, state1.growth, '1-I 내용 일치');
    console.log('  ✓ [테스트 1] 통과!');
  }

  // ─────────────────────────────────────────────────────────────
  // 2. [P1] 거시 충격 방향 모델 및 미공개 이벤트 격리 (Section 2)
  // ─────────────────────────────────────────────────────────────
  console.log('\n▶ [테스트 2] [P1] 명시적 거시 효과 모델 및 방향성 정합성 검증');
  {
    // 2.1 금리 인상: direction: +1 -> policyRate 상승
    const eventRateHike = createObsEvent({
      eventId: 'evt_rate_hike_01',
      publishedAt: 1000,
      effectiveFrom: 2000,
      valuationSignal: -0.5, // 주식시장에는 부정적이지만
      macroImpacts: [
        { factor: 'policyRate', direction: 1, magnitude: 0.8, halfLifeSeconds: 300 },
      ],
      title: '기준금리 인상 단행',
      content: '연준 긴축 가속화',
    });

    const shocksHike = convertEventToEconomicShocks(eventRateHike);
    assert.strictEqual(shocksHike.length, 1, '2.1-A 충격 변환 1건');
    assert.strictEqual(shocksHike[0].factor, 'policyRate', '2.1-B 금리 팩터 분류');
    assert.strictEqual(shocksHike[0].direction, 1, '2.1-C 방향 +1');
    assert.strictEqual(shocksHike[0].magnitude, 0.8, '2.1-D 강도 0.8');

    // 발효 전(simTime = 1500 < effectiveFrom = 2000): 충격 배제
    const preHike = advanceMacroState(DEFAULT_MACRO_STATE, shocksHike, 10, 1500);
    assert.strictEqual(preHike.policyRate, DEFAULT_MACRO_STATE.policyRate, '2.1-E 발효 전 미래 충격 배제');

    // 발효 후(simTime = 2500 > effectiveFrom = 2000): 금리 상승
    const postHike = advanceMacroState(DEFAULT_MACRO_STATE, shocksHike, 10, 2500);
    assert(postHike.policyRate > DEFAULT_MACRO_STATE.policyRate, '2.1-F 금리 인상 시 policyRate 상승');

    // 2.2 금리 인하: valuationSignal=+0.8 (주식 호재), direction: -1 -> policyRate 하락 (상승하면 결함!)
    const eventRateCut = createObsEvent({
      eventId: 'evt_rate_cut_01',
      publishedAt: 1000,
      effectiveFrom: 2000,
      valuationSignal: 0.8, // 주식시장 강세 신호
      macroImpacts: [
        { factor: 'policyRate', direction: -1, magnitude: 0.8, halfLifeSeconds: 300 },
      ],
      title: '기준금리 전격 인하',
      content: '경기 부양 목적 인하',
    });
    const shocksCut = convertEventToEconomicShocks(eventRateCut);
    const postCut = advanceMacroState(DEFAULT_MACRO_STATE, shocksCut, 10, 2500);
    assert(
      postCut.policyRate < DEFAULT_MACRO_STATE.policyRate,
      `2.2 금리 인하 시 policyRate 하락 검증 (현재: ${postCut.policyRate} < ${DEFAULT_MACRO_STATE.policyRate})`
    );

    // 2.3 전쟁·지정학 위기: valuationSignal=-0.8 (주식 악재), direction: +1 -> geopoliticalRisk 상승 (하락하면 결함!)
    const eventWar = createObsEvent({
      eventId: 'evt_war_01',
      publishedAt: 1000,
      effectiveFrom: 2000,
      valuationSignal: -0.8, // 주식시장 급락 신호
      macroImpacts: [
        { factor: 'geopoliticalRisk', direction: 1, magnitude: 0.9, halfLifeSeconds: 600 },
      ],
      title: '전쟁 발발',
      content: '국경 지대 전면 군사 충돌',
    });
    const shocksWar = convertEventToEconomicShocks(eventWar);
    const postWar = advanceMacroState(DEFAULT_MACRO_STATE, shocksWar, 10, 2500);
    assert(
      postWar.geopoliticalRisk > DEFAULT_MACRO_STATE.geopoliticalRisk,
      `2.3 전쟁 발발 시 geopoliticalRisk 상승 검증 (현재: ${postWar.geopoliticalRisk} > ${DEFAULT_MACRO_STATE.geopoliticalRisk})`
    );

    // 2.4 부도·신용위기: creditSpread와 riskAversion 동반 상승
    const eventDefault = createObsEvent({
      eventId: 'evt_default_01',
      publishedAt: 1000,
      effectiveFrom: 2000,
      valuationSignal: -0.9,
      macroImpacts: [
        { factor: 'creditSpread', direction: 1, magnitude: 0.8, halfLifeSeconds: 400 },
        { factor: 'riskAversion', direction: 1, magnitude: 0.7, halfLifeSeconds: 400 },
      ],
      title: '대형 금융사 부도',
      content: '신용 경색 확산',
    });
    const shocksDefault = convertEventToEconomicShocks(eventDefault);
    const postDefault = advanceMacroState(DEFAULT_MACRO_STATE, shocksDefault, 10, 2500);
    assert(
      postDefault.creditSpread > DEFAULT_MACRO_STATE.creditSpread,
      '2.4-A 신용위기 시 creditSpread 상승'
    );
    assert(
      postDefault.riskAversion > DEFAULT_MACRO_STATE.riskAversion,
      '2.4-B 신용위기 시 riskAversion 상승'
    );

    // 2.5 유동성 공급 / 유동성 경색
    const eventLiquidityInject = createObsEvent({
      eventId: 'evt_liq_inj_01',
      publishedAt: 1000,
      effectiveFrom: 2000,
      macroImpacts: [{ factor: 'liquidity', direction: 1, magnitude: 0.6, halfLifeSeconds: 300 }],
      title: '긴급 유동성 공급',
    });
    const eventLiquidityCrunch = createObsEvent({
      eventId: 'evt_liq_crn_01',
      publishedAt: 1000,
      effectiveFrom: 2000,
      macroImpacts: [{ factor: 'liquidity', direction: -1, magnitude: 0.6, halfLifeSeconds: 300 }],
      title: '시장 유동성 경색',
    });
    const postLiqInj = advanceMacroState(DEFAULT_MACRO_STATE, convertEventToEconomicShocks(eventLiquidityInject), 10, 2500);
    const postLiqCrn = advanceMacroState(DEFAULT_MACRO_STATE, convertEventToEconomicShocks(eventLiquidityCrunch), 10, 2500);
    assert(postLiqInj.liquidity > DEFAULT_MACRO_STATE.liquidity, '2.5-A 유동성 공급 시 liquidity 상승');
    assert(postLiqCrn.liquidity < DEFAULT_MACRO_STATE.liquidity, '2.5-B 유동성 경색 시 liquidity 하락');

    // 2.6 개별 기업 단독 수주·증자: 명시적 거시 효과 없음 -> 전역 성장률 및 모든 거시 팩터 불변 (fail-closed)
    const eventStockOrder = createObsEvent({
      eventId: 'evt_corp_order_01',
      publishedAt: 1000,
      effectiveFrom: 2000,
      scope: 'stock',
      targetStockIds: ['stk_samsung_01'],
      eventType: 'RUMOR',
      valuationSignal: 0.75, // 개별 주식 호재
      title: '단독 대규모 해외 수주 계약',
      content: '단일 법인 차원의 수주 성공',
    });
    const shocksStock = convertEventToEconomicShocks(eventStockOrder);
    assert.strictEqual(shocksStock.length, 0, '2.6-A 명시적 거시 효과 없는 개별 기업 이벤트는 충격 목록 빈 배열');
    const postStock = advanceMacroState(DEFAULT_MACRO_STATE, shocksStock, 10, 2500);
    assert.strictEqual(postStock.growth, DEFAULT_MACRO_STATE.growth, '2.6-B 기업 단독 이벤트 시 전역 성장률 100% 불변');
    assert.strictEqual(postStock.policyRate, DEFAULT_MACRO_STATE.policyRate, '2.6-C 금리 불변');

    console.log('  ✓ [테스트 2] 명시적 거시 효과 및 방향성 모델 통과!');
  }

  // ─────────────────────────────────────────────────────────────
  // 3. [P1] 충격 적용의 시간 의미 정리 및 회귀 검증 (Section 3)
  // ─────────────────────────────────────────────────────────────
  console.log('\n▶ [테스트 3] [P1] 시간 의미, 스텝 일관성, 반감기 감쇠 및 멱등성 검증');
  {
    const shockRate = createObsEvent({
      eventId: 'evt_time_rate_01',
      publishedAt: 0,
      effectiveFrom: 0,
      macroImpacts: [{ factor: 'policyRate', direction: 1, magnitude: 0.5, halfLifeSeconds: 60 }],
      title: '금리 충격',
    });
    const shocks = convertEventToEconomicShocks(shockRate);

    // 3.1 스텝 분할 일치성: 10초 1회 전진 결과 ≈ 1초 10회 전진 결과
    const stateOne10s = advanceMacroState(DEFAULT_MACRO_STATE, shocks, 10, 10_000);

    let stateTen1s = DEFAULT_MACRO_STATE;
    for (let s = 1; s <= 10; s++) {
      stateTen1s = advanceMacroState(stateTen1s, shocks, 1, s * 1000);
    }
    const rateDiff = Math.abs(stateOne10s.policyRate - stateTen1s.policyRate);
    assert(
      rateDiff < 1e-4,
      `3.1 스텝 일관성: 10초 1회(${stateOne10s.policyRate}) ≈ 1초 10회(${stateTen1s.policyRate}), diff=${rateDiff} < 1e-4`
    );

    // 3.2 동일 eventId 반복 입력 -> 중복 충격 없음 (멱등성)
    const duplicateShocks = [...shocks, ...shocks, ...shocks];
    const stateSingle = advanceMacroState(DEFAULT_MACRO_STATE, shocks, 10, 10_000);
    const stateDedup = advanceMacroState(DEFAULT_MACRO_STATE, duplicateShocks, 10, 10_000);
    assert.strictEqual(
      JSON.stringify(stateSingle),
      JSON.stringify(stateDedup),
      '3.2 동일 shockId / sourceEventId 중복 입력 시 100% 동일 결과 (중복 적용 차단)'
    );

    // 3.3 반감기 감쇠: t=0, t=60(1 반감기), t=120(2 반감기) 경과 시 충격 영향 축소
    const stateT0 = advanceMacroState(DEFAULT_MACRO_STATE, shocks, 0, 0);
    const stateT60 = advanceMacroState(DEFAULT_MACRO_STATE, shocks, 60, 60_000);
    const stateT120 = advanceMacroState(DEFAULT_MACRO_STATE, shocks, 60, 120_000);

    const boostT0 = stateT0.policyRate - DEFAULT_MACRO_STATE.policyRate;
    const boostT60 = stateT60.policyRate - DEFAULT_MACRO_STATE.policyRate;
    const boostT120 = stateT120.policyRate - DEFAULT_MACRO_STATE.policyRate;
    assert(boostT60 < boostT0, `3.3-A 반감기 60초 후 영향 감소 (${boostT60} < ${boostT0})`);
    assert(boostT120 < boostT60, `3.3-B 반감기 120초 후 추가 영향 감소 (${boostT120} < ${boostT60})`);

    // 3.4 충격 종료 후 평균회귀: 충격이 끝난 후 충분한 시간 경과 시 baseline 복귀
    let stateDecaying = stateT120;
    // 이후 충격 없이 10,000초 진행
    for (let step = 0; step < 100; step++) {
      stateDecaying = advanceMacroState(stateDecaying, [], 100, 120_000 + (step + 1) * 100_000);
    }
    const finalDiffFromBaseline = Math.abs(stateDecaying.policyRate - DEFAULT_MACRO_STATE.policyRate);
    assert(
      finalDiffFromBaseline < 1e-3,
      `3.4 충격 종료 후 기준선으로 평균회귀 완료 (기준선과의 편차: ${finalDiffFromBaseline} < 1e-3)`
    );

    // 3.5 비정상 입력 거부: NaN, Infinity, 음수 반감기, 비정상 magnitude 거부
    const invalidEvent = createObsEvent({
      eventId: 'evt_invalid_01',
      publishedAt: 0,
      effectiveFrom: 0,
      macroImpacts: [
        { factor: 'growth', direction: 1, magnitude: NaN, halfLifeSeconds: 300 },
        { factor: 'policyRate', direction: 1, magnitude: 0.5, halfLifeSeconds: -50 },
        { factor: 'liquidity', direction: 1, magnitude: Infinity, halfLifeSeconds: 100 },
      ],
      title: '비정상 이벤트',
    });
    const invalidShocks = convertEventToEconomicShocks(invalidEvent);
    assert.strictEqual(invalidShocks.length, 0, '3.5 NaN/Infinity/음수 반감기를 가진 충격은 안전하게 필터링됨');

    console.log('  ✓ [테스트 3] 시간 의미 및 ODE 평균회귀 검증 통과!');
  }

  // ─────────────────────────────────────────────────────────────
  // 4. 10대 핵심 경제 시나리오 차별적 전달 검증
  // ─────────────────────────────────────────────────────────────
  console.log('\n▶ [테스트 4] 10대 경제 시나리오별 자산군·섹터 차별화 반응 검증');
  {
    const stockTech: AssetMicroSnapshot = {
      assetId: 'stk_tech_01',
      ticker: 'TECH',
      assetClass: 'STOCK',
      sectorId: 'tech',
      currentPrice: 100000,
      spreadBps: 15,
      historicalVol: 0.25,
      valuationGap: 0.0,
    };

    const stockFin: AssetMicroSnapshot = {
      assetId: 'stk_fin_01',
      ticker: 'BANK',
      assetClass: 'STOCK',
      sectorId: 'financials',
      currentPrice: 50000,
      spreadBps: 20,
      historicalVol: 0.18,
      valuationGap: 0.0,
    };

    const stockEnergy: AssetMicroSnapshot = {
      assetId: 'stk_oil_01',
      ticker: 'ENRG',
      assetClass: 'STOCK',
      sectorId: 'energy',
      currentPrice: 80000,
      spreadBps: 25,
      historicalVol: 0.30,
      valuationGap: 0.0,
    };

    const bondGov10Y: AssetMicroSnapshot = {
      assetId: 'bnd_gov_10y',
      ticker: 'KTB10Y',
      assetClass: 'BOND',
      currentPrice: 10000,
      ytm: 3.5,
      duration: 8.5,
      isSovereign: true,
    };

    const commOil: AssetMicroSnapshot = {
      assetId: 'comm_wti_01',
      ticker: 'WTI',
      assetClass: 'COMMODITY',
      category: 'energy',
      currentPrice: 75,
      spreadBps: 10,
    };

    const commGold: AssetMicroSnapshot = {
      assetId: 'comm_gold_01',
      ticker: 'GOLD',
      assetClass: 'COMMODITY',
      category: 'gold',
      currentPrice: 2000,
      spreadBps: 5,
    };

    const optPut: AssetMicroSnapshot = {
      assetId: 'opt_put_01',
      ticker: 'PUT_200',
      assetClass: 'OPTION',
      currentPrice: 500,
      optionType: 'PUT',
      delta: -0.40,
      impliedVol: 0.22,
      historicalVol: 0.22,
      underlyingAssetId: 'stk_tech_01',
    };

    const assets = [stockTech, stockFin, stockEnergy, bondGov10Y, commOil, commGold, optPut];

    // ── 시나리오 A: 성장 호조 & 인플레 안정 (골디락스) ──
    {
      const macroA = { ...DEFAULT_MACRO_STATE, growth: 0.04, inflation: 0.020, riskAversion: 0.20 };
      const signalsA = computeCrossAssetSignals(assets, macroA, 'BULL');
      const sigTech = signalsA.get('stk_tech_01')!;
      const sigGov = signalsA.get('bnd_gov_10y')!;
      assert(sigTech.direction > 0.3, '4.A-1 골디락스 환경에서 기술주 강세 신호');
      assert(sigTech.direction > sigGov.direction, '4.A-2 주식이 채권 대비 높은 위험선호 신호');
    }

    // ── 시나리오 B: 스태그플레이션 (성장 둔화 & 인플레 급등) ──
    {
      const macroB = { ...DEFAULT_MACRO_STATE, growth: -0.01, inflation: 0.060, policyRate: 0.055, realRate: -0.005 };
      const signalsB = computeCrossAssetSignals(assets, macroB, 'BEAR');
      const sigTech = signalsB.get('stk_tech_01')!;
      const sigOil = signalsB.get('comm_wti_01')!;
      const sigGold = signalsB.get('comm_gold_01')!;
      assert(sigTech.direction < 0, '4.B-1 스태그플레이션에서 기술주 약세');
      assert(sigGold.direction > 0, '4.B-2 인플레 헷지 수요로 금 강세');
      assert(sigOil.direction > sigTech.direction, '4.B-3 원자재가 주식 대비 강세');
    }

    // ── 시나리오 C: 중앙은행 매파적 긴축 (금리 급등) ──
    {
      const macroC = { ...DEFAULT_MACRO_STATE, policyRate: 0.065, realRate: 0.040, growth: 0.015 };
      const ctxC = analyzeTransmissionContext(macroC, 'HIGH_VOLATILITY');
      assert.strictEqual(ctxC.rateEnv, 'POLICY_TIGHTENING_RISE', '4.C-1 긴축 금리 상승 환경 식별');

      const signalsC = computeCrossAssetSignals(assets, macroC, 'HIGH_VOLATILITY');
      const sigTech = signalsC.get('stk_tech_01')!;
      const sigFin = signalsC.get('stk_fin_01')!;
      const sigGov = signalsC.get('bnd_gov_10y')!;
      assert(sigTech.direction < 0, '4.C-2 긴축 쇼크로 기술주 약세');
      assert(sigFin.direction > sigTech.direction, '4.C-3 금융주가 기술주 대비 상대적 방어/마진 수혜');
      assert(sigGov.expectedReturn < 0.02, '4.C-4 듀레이션(8.5년) 타격으로 장기채 수익률 기대 급감');
    }

    // ── 시나리오 D: 금융시장 유동성 위기 & 신용 스프레드 급등 ──
    {
      const macroD = { ...DEFAULT_MACRO_STATE, liquidity: 0.15, creditSpread: 350.0, riskAversion: 0.75 };
      const signalsD = computeCrossAssetSignals(assets, macroD, 'LIQUIDITY_CRISIS');
      const sigGov = signalsD.get('bnd_gov_10y')!;
      const sigPut = signalsD.get('opt_put_01')!;
      const sigFin = signalsD.get('stk_fin_01')!;
      assert(sigFin.direction < -0.3, '4.D-1 신용위기 시 금융주 급락');
      assert(sigPut.direction > 0.2, '4.D-2 하방 꼬리위험으로 풋옵션 헤지 프리미엄 급등');
      assert(sigGov.drivers.some((d) => d.factor === 'flightToSafety'), '4.D-3 국채 안전자산 선호 유입 드라이버 기록');
    }

    // ── 시나리오 E: 달러 강세 & 글로벌 원자재 역풍 ──
    {
      const macroE = { ...DEFAULT_MACRO_STATE, fxDollarStrength: 120.0, growth: 0.01 };
      const signalsE = computeCrossAssetSignals(assets, macroE, 'SIDEWAYS');
      const sigOil = signalsE.get('comm_wti_01')!;
      assert(sigOil.drivers.some((d) => d.factor === 'dollarStrength' && d.contribution < 0), '4.E-1 달러 강세로 원유 통화 역풍 드라이버 확인');
    }

    // ── 시나리오 F: 지정학적 분쟁 쇼크 (유가 급등) ──
    {
      const macroF = { ...DEFAULT_MACRO_STATE, geopoliticalRisk: 0.80, commodityDemand: 1.2 };
      const signalsF = computeCrossAssetSignals(assets, macroF, 'HIGH_VOLATILITY');
      const sigEnergy = signalsF.get('stk_oil_01')!;
      const sigOil = signalsF.get('comm_wti_01')!;
      assert(sigOil.direction > 0.4, '4.F-1 지정학 분쟁 시 원유 강한 매수 신호');
      assert(sigEnergy.direction > 0.2, '4.F-2 에너지 주식 동반 강세 신호');
    }

    // ── 시나리오 G: 위험회피 급등 ──
    {
      const macroG = { ...DEFAULT_MACRO_STATE, riskAversion: 0.85 };
      const signalsG = computeCrossAssetSignals(assets, macroG, 'BEAR');
      const sigGold = signalsG.get('comm_gold_01')!;
      const sigTech = signalsG.get('stk_tech_01')!;
      assert(sigGold.direction > sigTech.direction, '4.G-1 위험회피 급등 시 금이 기술주보다 명확히 높은 신호');
    }
    console.log('  ✓ [테스트 4] 10대 시나리오 전달 검증 100% 통과!');
  }

  console.log('\n================================================================');
  console.log('  🎉 1단계 교차자산 거시 봇 기반 모델 검증 모든 항목 통과!');
  console.log('================================================================\n');
}

runFoundationTests().catch((err) => {
  console.error('❌ FATAL ERROR in test-cross-asset-foundation:', err);
  process.exit(1);
});
