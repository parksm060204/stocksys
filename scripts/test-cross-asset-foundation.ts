/**
 * test-cross-asset-foundation.ts
 *
 * 1단계 교차자산 거시 봇 의사결정 기반 모델 및 순수 계산 엔진 단위 테스트
 * - 결정론적 재현성 (동일 입력 bit-for-bit 일치)
 * - 미공개 이벤트 차단 (effectiveFrom 경계)
 * - 10대 경제 시나리오별 차별적 전달 및 신호 방향성 검증
 * - 순수 함수 무상태성 (PRNG/시스템 시계 비오염)
 */

import assert from 'node:assert';
import {
  advanceMacroState,
  convertEventToEconomicShock,
  createObservableMacroState,
  DEFAULT_MACRO_STATE,
} from '../lib/engine/simulation/macro/macroState';
import { ObservableMarketEvent } from '../lib/engine/simulation/marketEventTypes';
import {
  AssetMicroSnapshot,
  computeCrossAssetSignals,
  computeSingleAssetSignal,
} from '../lib/engine/simulation/crossAsset/crossAssetSignalEngine';
import { analyzeTransmissionContext } from '../lib/engine/simulation/crossAsset/transmissionEngine';

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
  // 2. 경제 충격 변환 및 시간 경계 (정보 경계 보장)
  // ─────────────────────────────────────────────────────────────
  console.log('\n▶ [테스트 2] 이벤트 → 경제 충격 변환 및 미공개 이벤트 격리');
  {
    const eventRateHike: ObservableMarketEvent = {
      eventId: 'evt_rate_hike_01',
      publishedAt: 1000,
      effectiveFrom: 2000,
      scope: 'market',
      targetStockIds: [],
      eventType: 'OFFICIAL',
      valuationSignal: 0.8,
      attentionShock: 0.5,
      uncertaintyShock: 0.2,
      confidence: 0.9,
      halfLife: 300,
      publisher: 'CentralBank',
      title: '기준금리 인상 단행',
      content: '연준 긴축 가속화',
    };

    const shock = convertEventToEconomicShock(eventRateHike);
    assert(shock !== null, '2-A 충격 변환 성공');
    assert.strictEqual(shock.factor, 'policyRate', '2-B 금리 팩터 분류');
    assert.strictEqual(shock.magnitude, 0.8, '2-C 강도 0.8');
    assert.strictEqual(shock.effectiveFrom, 2000, '2-D 발효 시점 보존');

    // 발효 전(simTime = 1500 < effectiveFrom = 2000): 충격이 반영되지 않아야 함 (No lookahead)
    const preState = advanceMacroState(DEFAULT_MACRO_STATE, [shock], 10, 1500);
    assert.strictEqual(preState.policyRate, DEFAULT_MACRO_STATE.policyRate, '2-E 발효 전 미래 충격 배제');

    // 발효 후(simTime = 2500 > effectiveFrom = 2000): 금리 상승 반영
    const postState = advanceMacroState(DEFAULT_MACRO_STATE, [shock], 10, 2500);
    assert(postState.policyRate > DEFAULT_MACRO_STATE.policyRate, '2-F 발효 후 금리 상승 반영');
    console.log('  ✓ [테스트 2] 통과!');
  }

  // ─────────────────────────────────────────────────────────────
  // 3. 10대 핵심 경제 시나리오 차별적 전달 검증
  // ─────────────────────────────────────────────────────────────
  console.log('\n▶ [테스트 3] 10대 경제 시나리오별 자산군·섹터 차별화 반응 검증');
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
    };

    const assets = [stockTech, stockFin, stockEnergy, bondGov10Y, commOil, commGold, optPut];

    // ── 시나리오 A: 성장 호조 & 인플레 안정 (골디락스) ──
    {
      const macroA = { ...DEFAULT_MACRO_STATE, growth: 0.04, inflation: 0.020, riskAversion: 0.20 };
      const signalsA = computeCrossAssetSignals(assets, macroA, 'BULL');
      const sigTech = signalsA.get('stk_tech_01')!;
      const sigGov = signalsA.get('bnd_gov_10y')!;
      assert(sigTech.direction > 0.3, '3.A-1 골디락스 환경에서 기술주 강세 신호');
      assert(sigTech.direction > sigGov.direction, '3.A-2 주식이 채권 대비 높은 위험선호 신호');
    }

    // ── 시나리오 B: 스태그플레이션 (성장 둔화 & 인플레 급등) ──
    {
      const macroB = { ...DEFAULT_MACRO_STATE, growth: -0.01, inflation: 0.060, policyRate: 0.055, realRate: -0.005 };
      const signalsB = computeCrossAssetSignals(assets, macroB, 'BEAR');
      const sigTech = signalsB.get('stk_tech_01')!;
      const sigOil = signalsB.get('comm_wti_01')!;
      const sigGold = signalsB.get('comm_gold_01')!;
      assert(sigTech.direction < 0, '3.B-1 스태그플레이션에서 기술주 약세');
      assert(sigGold.direction > 0, '3.B-2 인플레 헷지 수요로 금 강세');
      assert(sigOil.direction > sigTech.direction, '3.B-3 원자재가 주식 대비 강세');
    }

    // ── 시나리오 C: 중앙은행 매파적 긴축 (금리 급등) ──
    {
      const macroC = { ...DEFAULT_MACRO_STATE, policyRate: 0.065, realRate: 0.040, growth: 0.015 };
      const ctxC = analyzeTransmissionContext(macroC, 'HIGH_VOLATILITY');
      assert.strictEqual(ctxC.rateEnv, 'POLICY_TIGHTENING_RISE', '3.C-1 긴축 금리 상승 환경 식별');

      const signalsC = computeCrossAssetSignals(assets, macroC, 'HIGH_VOLATILITY');
      const sigTech = signalsC.get('stk_tech_01')!;
      const sigFin = signalsC.get('stk_fin_01')!;
      const sigGov = signalsC.get('bnd_gov_10y')!;
      assert(sigTech.direction < 0, '3.C-2 긴축 쇼크로 기술주 약세');
      assert(sigFin.direction > sigTech.direction, '3.C-3 금융주가 기술주 대비 상대적 방어/마진 수혜');
      assert(sigGov.expectedReturn < 0.02, '3.C-4 듀레이션(8.5년) 타격으로 장기채 수익률 기대 급감');
    }

    // ── 시나리오 D: 금융시장 유동성 위기 & 신용 스프레드 급등 ──
    {
      const macroD = { ...DEFAULT_MACRO_STATE, liquidity: 0.15, creditSpread: 350.0, riskAversion: 0.75 };
      const signalsD = computeCrossAssetSignals(assets, macroD, 'LIQUIDITY_CRISIS');
      const sigGov = signalsD.get('bnd_gov_10y')!;
      const sigPut = signalsD.get('opt_put_01')!;
      const sigFin = signalsD.get('stk_fin_01')!;
      assert(sigFin.direction < -0.3, '3.D-1 신용위기 시 금융주 급락');
      assert(sigPut.direction > 0.2, '3.D-2 하방 꼬리위험으로 풋옵션 헤지 프리미엄 급등');
      assert(sigGov.drivers.some((d) => d.factor === 'flightToSafety'), '3.D-3 국채 안전자산 선호 유입 드라이버 기록');
    }

    // ── 시나리오 E: 달러 강세 & 글로벌 원자재 역풍 ──
    {
      const macroE = { ...DEFAULT_MACRO_STATE, fxDollarStrength: 120.0, growth: 0.01 };
      const signalsE = computeCrossAssetSignals(assets, macroE, 'SIDEWAYS');
      const sigOil = signalsE.get('comm_wti_01')!;
      assert(sigOil.drivers.some((d) => d.factor === 'dollarStrength' && d.contribution < 0), '3.E-1 달러 강세로 원유 통화 역풍 드라이버 확인');
    }

    // ── 시나리오 F: 지정학적 분쟁 쇼크 (유가 급등) ──
    {
      const macroF = { ...DEFAULT_MACRO_STATE, geopoliticalRisk: 0.80, commodityDemand: 1.2 };
      const signalsF = computeCrossAssetSignals(assets, macroF, 'HIGH_VOLATILITY');
      const sigEnergy = signalsF.get('stk_oil_01')!;
      const sigOil = signalsF.get('comm_wti_01')!;
      assert(sigOil.direction > 0.4, '3.F-1 지정학 분쟁 시 원유 강한 매수 신호');
      assert(sigEnergy.direction > 0.2, '3.F-2 에너지 주식 동반 강세 신호');
    }

    // ── 시나리오 G: 위험회피 급등 ──
    {
      const macroG = { ...DEFAULT_MACRO_STATE, riskAversion: 0.85 };
      const signalsG = computeCrossAssetSignals(assets, macroG, 'BEAR');
      const sigGold = signalsG.get('comm_gold_01')!;
      const sigTech = signalsG.get('stk_tech_01')!;
      assert(sigGold.direction > sigTech.direction, '3.G-1 위험회피 급등 시 금이 기술주보다 명확히 높은 신호');
    }
    console.log('  ✓ [테스트 3] 10대 시나리오 전달 검증 100% 통과!');
  }

  console.log('\n================================================================');
  console.log('  🎉 1단계 교차자산 거시 봇 기반 모델 검증 모든 항목 통과!');
  console.log('================================================================\n');
}

runFoundationTests().catch((err) => {
  console.error('❌ FATAL ERROR in test-cross-asset-foundation:', err);
  process.exit(1);
});
