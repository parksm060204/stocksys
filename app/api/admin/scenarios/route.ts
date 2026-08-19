import { NextResponse } from 'next/server';
import { scenarioManager } from '@/lib/scenario/ScenarioManager';
import { commodityEngineInstance } from '@/app/api/commodities/route';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const activeScenarios = scenarioManager.getActiveScenarios();
  const activeMacroShocks = scenarioManager.getActiveMacroShocks();
  const logs = scenarioManager.getActionLogs();

  return NextResponse.json({
    success: true,
    tick: scenarioManager.currentTick,
    activeScenarios,
    activeMacroShocks,
    logs,
  });
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // 관리자 권한 확인 (개발 환경 또는 profiles.is_admin 체크)
    let isAdmin = false;
    let adminUser = 'admin';

    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin, email')
        .eq('id', user.id)
        .single();
      if (profile?.is_admin) {
        isAdmin = true;
        adminUser = profile.email || user.id;
      }
    }

    // 로컬 개발 편의상 미인증 시에도 admin_key 헤더 또는 기본 허용
    const adminKey = req.headers.get('x-admin-key');
    if (adminKey === 'myung_admin_secret' || process.env.NODE_ENV !== 'production') {
      isAdmin = true;
    }

    if (!isAdmin) {
      return NextResponse.json({ success: false, message: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const body = await req.json();
    const { action } = body;

    // 1. 작전 세력 주입
    if (action === 'inject_scenario') {
      const { assetType, assetId, ticker, name, mode, durationTicks, targetChangePct, volumeMultiplier, initialPrice } = body;

      const scenario = scenarioManager.injectScenario({
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
      });

      // DB stocks / commodities 목표가 일시 반영 (옵션)
      if (assetType === 'stock') {
        const targetMultiplier = 1 + (Number(targetChangePct) || 50) / 100;
        await supabase
          .from('stocks')
          .update({ target_price: Math.round(initialPrice * targetMultiplier) })
          .eq('id', assetId);
      }

      return NextResponse.json({ success: true, scenario });
    }

    // 2. 거시경제 충격 발동
    if (action === 'trigger_macro_shock') {
      const { shockType } = body;
      const shock = scenarioManager.triggerMacroShock({
        type: shockType,
        adminUser,
      });

      // admin_settings 테이블 매크로 심리 레짐 갱신
      await supabase
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
      const success = scenarioManager.rollbackScenario(scenarioId, adminUser);
      return NextResponse.json({ success });
    }

    // 4. 전체 긴급 정지 (EMERGENCY HALT ALL)
    if (action === 'emergency_halt') {
      const result = scenarioManager.emergencyHaltAll(adminUser);
      return NextResponse.json({ success: true, result });
    }

    return NextResponse.json({ success: false, message: '유효하지 않은 액션입니다.' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || '서버 오류' }, { status: 500 });
  }
}
