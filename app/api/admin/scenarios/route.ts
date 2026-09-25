import { NextResponse } from 'next/server';
import { scenarioManager } from '@/lib/scenario/ScenarioManager';
import { commodityEngineInstance } from '@/app/api/commodities/route';
import { createMemoryDbClient } from '@/lib/memoryDb/memoryDbClient';
import { verifyAdminSession } from '@/lib/auth/adminAuth';
import { getLocalStandaloneEngine } from '@/lib/engine/localStandaloneServer';

function getAuthoritativeScenarioManager() {
  return commodityEngineInstance?.scenarioManager ?? scenarioManager;
}

export async function GET(req: Request) {
  const auth = await verifyAdminSession(req);
  if (!auth.isAdmin) {
    return NextResponse.json({ success: false, message: '관리자 권한이 필요합니다.' }, { status: 403 });
  }

  const activeManager = getAuthoritativeScenarioManager();
  const activeScenarios = activeManager.getActiveScenarios();
  const activeMacroShocks = activeManager.getActiveMacroShocks();
  const logs = activeManager.getActionLogs();
  const engine = getLocalStandaloneEngine();
  const diagnostics = engine ? engine.getDiagnosticsSummaryReport() : null;

  return NextResponse.json({
    success: true,
    tick: activeManager.currentTick,
    activeScenarios,
    activeMacroShocks,
    logs,
    diagnostics,
  });
}

export async function POST(req: Request) {
  try {
    const auth = await verifyAdminSession(req);
    if (!auth.isAdmin) {
      return NextResponse.json({ success: false, message: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const adminUser = auth.adminUser || 'admin';
    const db = createMemoryDbClient();
    const body = await req.json();
    const { action } = body;
    const activeManager = getAuthoritativeScenarioManager();

    // 1. 작전 세력 주입
    if (action === 'inject_scenario') {
      const { assetType, assetId, ticker, name, mode, durationTicks, targetChangePct, volumeMultiplier, initialPrice } = body;

      const scenarioParams = {
        assetType,
        assetId,
        ticker,
        name,
        mode,
        durationTicks: Number(durationTicks) || 60,
        targetChangePct: Number(targetChangePct) || 50,
        volumeMultiplier: Number(volumeMultiplier) || 3,
        initialPrice: Number(initialPrice) || 10000,
        adminUser,
      };

      const scenario = activeManager.injectScenario(scenarioParams);
      if (activeManager !== scenarioManager) {
        try { scenarioManager.injectScenario(scenarioParams); } catch { /* ignore */ }
      }

      // DB stocks / commodities 목표가 일시 반영 (옵션)
      if (assetType === 'stock') {
        const targetMultiplier = 1 + (Number(targetChangePct) || 50) / 100;
        await db
          .from('stocks')
          .update({ target_price: Math.round(initialPrice * targetMultiplier) })
          .eq('id', assetId);
      }

      return NextResponse.json({ success: true, scenario });
    }

    // 2. 거시경제 충격 발동
    if (action === 'trigger_macro_shock') {
      const { shockType } = body;
      const shock = activeManager.triggerMacroShock({
        type: shockType,
        adminUser,
      });
      if (activeManager !== scenarioManager) {
        try { scenarioManager.triggerMacroShock({ type: shockType, adminUser }); } catch { /* ignore */ }
      }

      // admin_settings 테이블 매크로 심리 레짐 갱신
      await db
        .from('admin_settings')
        .update({ market_sentiment: shock.regime })
        .eq('id', 1);

      // 원자재 시장에도 관련 이벤트 전파
      if (shockType === 'GEOPOLITICAL_CRISIS') {
        commodityEngineInstance.eventSystem.triggerEventById('ev_tmpl_hormuz_blockade', commodityEngineInstance.currentTick);
      } else if (shockType === 'RATE_HIKE_SHOCK') {
        commodityEngineInstance.eventSystem.triggerEventById('ev_tmpl_recession_pmi_crash', commodityEngineInstance.currentTick);
      } else if (shockType === 'LIQUIDITY_BOOM') {
        commodityEngineInstance.eventSystem.triggerEventById('ev_tmpl_green_subsidy_surge', commodityEngineInstance.currentTick);
      }

      return NextResponse.json({ success: true, shock });
    }

    // 3. 단일 시나리오 롤백
    if (action === 'rollback_scenario') {
      const { scenarioId } = body;
      const success = activeManager.rollbackScenario(scenarioId, adminUser);
      if (activeManager !== scenarioManager) {
        try { scenarioManager.rollbackScenario(scenarioId, adminUser); } catch { /* ignore */ }
      }
      return NextResponse.json({ success });
    }

    // 4. 전체 긴급 정지 (EMERGENCY HALT ALL)
    if (action === 'emergency_halt') {
      const result = activeManager.emergencyHaltAll(adminUser);
      if (activeManager !== scenarioManager) {
        try { scenarioManager.emergencyHaltAll(adminUser); } catch { /* ignore */ }
      }
      return NextResponse.json({ success: true, result });
    }

    // 5. 구조화된 시장 뉴스 이벤트 주입
    if (action === 'inject_news_event') {
      const { event } = body;
      const engine = getLocalStandaloneEngine();
      if (!engine) {
        return NextResponse.json({ success: false, message: '엔진이 기동되지 않았습니다.' }, { status: 503 });
      }
      const accepted = await engine.publishEvent(event);
      return NextResponse.json({ success: accepted, eventId: event?.eventId });
    }

    return NextResponse.json({ success: false, message: '유효하지 않은 액션입니다.' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || '서버 오류' }, { status: 500 });
  }
}
