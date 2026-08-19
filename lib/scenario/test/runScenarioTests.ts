import { ScenarioManager } from '../ScenarioManager';

async function runScenarioTestSuite() {
  console.log('================================================================');
  console.log('🎛️ [SCENARIO CONTROLLER] 시나리오 제어기 및 롤백 검증 테스트 시작');
  console.log('================================================================\n');

  const scenarioMgr = new ScenarioManager();
  let passedTests = 0;
  const totalTests = 4;

  // ── [TEST 1] 작전 세력 주입 (매집 -> 펌핑 -> 덤핑) 단계별 Bias 검증 ──
  console.log('▶ [TEST 1] 작전 세력 주입 (Full Cycle) 단계별 봇 Bias 전이 검증');
  const scen = scenarioMgr.injectScenario({
    assetType: 'commodity',
    assetId: 'CRUDE_OIL',
    ticker: 'CL',
    name: 'WTI 원유',
    mode: 'full_cycle',
    durationTicks: 20,
    targetChangePct: 60,
    volumeMultiplier: 4,
    initialPrice: 78.5,
    adminUser: 'test_admin',
  });

  // 1-1. 매집 단계 (Accumulation)
  const biasAcc = scenarioMgr.getAssetBias('CRUDE_OIL');
  console.log(`  [매집 단계 (Tick 0)] BuyBias: ${biasAcc.buyBias.toFixed(1)}x, SellBias: ${biasAcc.sellBias.toFixed(1)}x, Volatility Suppressed: ${biasAcc.suppressVolatility}`);
  if (biasAcc.buyBias > 2.0 && biasAcc.suppressVolatility === true) {
    console.log('  - 매집 단계 판정: ✅ 정상 (스텔스 매수 집중 & 변동성 억제)');
  } else {
    console.error('  - 매집 단계 판정: ❌ 실패');
  }

  // 20틱 경과 ➔ 펌핑 단계 (Pump)로 자동 전이
  for (let i = 0; i < 20; i++) scenarioMgr.stepTick();
  const biasPump = scenarioMgr.getAssetBias('CRUDE_OIL');
  console.log(`  [펌핑 단계 (Tick 20)] BuyBias: ${biasPump.buyBias.toFixed(1)}x, EventShock: +${(biasPump.eventShock * 100).toFixed(1)}%`);
  if (biasPump.buyBias > 4.0 && biasPump.eventShock > 0.01) {
    console.log('  - 펌핑 단계 판정: ✅ 정상 (공격적 매수 폭주 & 상승 쇼크 주입)');
  } else {
    console.error('  - 펌핑 단계 판정: ❌ 실패');
  }

  // 20틱 경과 ➔ 덤핑 단계 (Dump)로 자동 전이
  for (let i = 0; i < 20; i++) scenarioMgr.stepTick();
  const biasDump = scenarioMgr.getAssetBias('CRUDE_OIL');
  console.log(`  [덤핑 단계 (Tick 40)] SellBias: ${biasDump.sellBias.toFixed(1)}x, EventShock: ${(biasDump.eventShock * 100).toFixed(1)}%`);
  if (biasDump.sellBias > 4.0 && biasDump.eventShock < -0.01) {
    console.log('  - 덤핑 단계 판정: ✅ 정상 (매도 폭주 & 하락 쇼크 주입)');
    passedTests++;
  } else {
    console.error('  - 덤핑 단계 판정: ❌ 실패');
  }

  // ── [TEST 2] 거시경제 충격 발동 & 파급효과 검증 ──
  console.log('\n▶ [TEST 2] 거시경제 충격 (지정학 위기 & 금리 쇼크) 발동 검증');
  const warShock = scenarioMgr.triggerMacroShock({
    type: 'GEOPOLITICAL_CRISIS',
    adminUser: 'test_admin',
  });
  console.log(`  - 발동된 쇼크: ${warShock.title} (레짐: ${warShock.regime}, 충격량: +${(warShock.magnitude * 100).toFixed(1)}%)`);

  const activeShocks = scenarioMgr.getActiveMacroShocks();
  if (activeShocks.length === 1 && activeShocks[0]?.regime === 'Crisis') {
    console.log('  결과: ✅ PASS (거시경제 충격 이벤트 정상 등록 및 레짐 전환)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 3] 단일 시나리오 롤백 (긴급 중단 및 시장 정상 복구) ──
  console.log('\n▶ [TEST 3] 단일 시나리오 긴급 롤백(Rollback) 및 정상화 검증');
  const rollbackSuccess = scenarioMgr.rollbackScenario(scen.id, 'test_admin');
  const biasAfterRollback = scenarioMgr.getAssetBias('CRUDE_OIL');
  console.log(`  - 롤백 성공 여부: ${rollbackSuccess}`);
  console.log(`  - 롤백 후 BuyBias: ${biasAfterRollback.buyBias.toFixed(1)}x, SellBias: ${biasAfterRollback.sellBias.toFixed(1)}x`);

  if (rollbackSuccess && biasAfterRollback.buyBias === 1.0 && biasAfterRollback.sellBias === 1.0) {
    console.log('  결과: ✅ PASS (작전 바이어스 완전 제거 및 정상 시장 복구 확인)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 4] 전체 긴급 정지 (EMERGENCY HALT ALL) 검증 ──
  console.log('\n▶ [TEST 4] 전체 긴급 정지 (Emergency Halt All) 검증');
  // 추가 시나리오 등록
  scenarioMgr.injectScenario({
    assetType: 'stock',
    assetId: 'stock_005930',
    ticker: '005930',
    name: '삼성전자',
    mode: 'pump',
    initialPrice: 70000,
  });

  const haltResult = scenarioMgr.emergencyHaltAll('test_admin');
  console.log(`  - 긴급 정지 결과: 취소된 작전 ${haltResult.cancelledScenarios}건, 취소된 거시충격 ${haltResult.cancelledShocks}건`);
  console.log(`  - 잔여 활성 작전 수: ${scenarioMgr.getActiveScenarios().length}건, 거시충격 수: ${scenarioMgr.getActiveMacroShocks().length}건`);

  if (
    scenarioMgr.getActiveScenarios().length === 0 &&
    scenarioMgr.getActiveMacroShocks().length === 0
  ) {
    console.log('  결과: ✅ PASS (전체 시장 100% 긴급 정지 및 클린 복귀 완료)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // 감사 로그 검증
  const logs = scenarioMgr.getActionLogs();
  console.log(`\n📜 관리자 감사 로그 기록: 총 ${logs.length}건 저장됨`);

  console.log('\n================================================================');
  if (passedTests === totalTests) {
    console.log(`🏁 [최종 결과] 시나리오 제어기 검증: 모든 테스트 통과 (${passedTests}/${totalTests}) 100% ✅`);
  } else {
    console.log(`🏁 [최종 결과] 시나리오 제어기 검증: 일부 실패 (${passedTests}/${totalTests}) ❌`);
  }
  console.log('================================================================\n');
}

runScenarioTestSuite().catch(console.error);
