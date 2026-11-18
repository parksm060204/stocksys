import { NextResponse } from 'next/server';
import { scenarioManager } from '@/lib/scenario/ScenarioManager';
import { commodityEngineInstance } from '@/app/api/commodities/route';
import { verifyAdminSession } from '@/lib/auth/adminAuth';
import { ensureLocalStandaloneReady, getLocalStandaloneEngine, persistConfirmedState } from '@/lib/engine/localStandaloneServer';
import { withAllStockLocks } from '@/lib/engine/marketService';
import { runWithCommitGate } from '@/lib/memoryDb/PersistenceManager';
import { memoryDb } from '@/lib/memoryDb/memoryStore';

function getAuthoritativeScenarioManager() {
  return commodityEngineInstance?.scenarioManager ?? scenarioManager;
}

export async function GET(req: Request) {
  await ensureLocalStandaloneReady();
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
    await ensureLocalStandaloneReady();
    const auth = await verifyAdminSession(req);
    if (!auth.isAdmin) {
      return NextResponse.json({ success: false, message: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const adminUser = auth.adminUser || 'admin';
    const body = await req.json();
    const { action } = body;
    const activeManager = getAuthoritativeScenarioManager();

    // 1. 작전 세력 주입
    if (action === 'inject_scenario') {
      const { assetType, assetId, ticker, name, mode, durationTicks, targetChangePct, volumeMultiplier, initialPrice } = body;

      const stockRecord = typeof assetId === 'string' ? memoryDb.stocks.get(assetId) : undefined;
      const numericInitPrice = Number(initialPrice);
      const safeInitialPrice =
        Number.isFinite(numericInitPrice) && numericInitPrice > 0
          ? numericInitPrice
          : (stockRecord && Number.isFinite(stockRecord.current_price) && stockRecord.current_price > 0
              ? stockRecord.current_price
              : 10000);
      const numericTargetPct = Number(targetChangePct);
      const safeTargetPct = Number.isFinite(numericTargetPct) ? numericTargetPct : 50;
      const numericDuration = Number(durationTicks);
      const safeDuration = Number.isFinite(numericDuration) && numericDuration > 0 ? Math.round(numericDuration) : 60;
      const numericVolMult = Number(volumeMultiplier);
      const safeVolMult = Number.isFinite(numericVolMult) && numericVolMult > 0 ? numericVolMult : 3;

      const scenarioParams = {
        assetType,
        assetId,
        ticker,
        name,
        mode,
        durationTicks: safeDuration,
        targetChangePct: safeTargetPct,
        volumeMultiplier: safeVolMult,
        initialPrice: safeInitialPrice,
        adminUser,
      };

      const scenario = activeManager.injectScenario(scenarioParams);
      if (activeManager !== scenarioManager) {
        try { scenarioManager.injectScenario(scenarioParams); } catch { /* ignore */ }
      }

      // DB stocks 목표가 원자적·영속 반영
      if (assetType === 'stock' && typeof assetId === 'string' && memoryDb.stocks.has(assetId)) {
        const targetMultiplier = 1 + safeTargetPct / 100;
        const nextTargetPrice = Math.max(1, Math.round(safeInitialPrice * targetMultiplier));
        const persistOk = await withAllStockLocks([assetId], async () => {
          return await runWithCommitGate(persistConfirmedState, async () => {
            const stk = memoryDb.stocks.get(assetId);
            if (!stk) return true;
            const prevTarget = (stk as any).target_price;
            (stk as any).target_price = nextTargetPrice;
            const saved = await persistConfirmedState();
            if (!saved) {
              (stk as any).target_price = prevTarget;
              return false;
            }
            return true;
          });
        });
        if (!persistOk) {
          return NextResponse.json(
            { success: false, message: '시나리오 목표가 영속 저장에 실패하여 롤백되었습니다.' },
            { status: 500 }
          );
        }
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

      // admin_settings 테이블 매크로 심리 레짐 영속 갱신
      const persisted = await runWithCommitGate(persistConfirmedState, async () => {
        const setting = memoryDb.adminSettings.get('1') ?? Array.from(memoryDb.adminSettings.values())[0];
        const prevSentiment = setting?.market_sentiment;
        if (setting) {
          setting.market_sentiment = shock.regime;
        }
        const saved = await persistConfirmedState();
        if (!saved && setting) {
          setting.market_sentiment = prevSentiment;
          return false;
        }
        return saved;
      });
      if (!persisted) {
        return NextResponse.json(
          { success: false, message: '거시경제 충격 상태 영속 저장에 실패했습니다.' },
          { status: 500 }
        );
      }

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

    // 5. 신규 종목 상장 (관리자 전용)
    if (action === 'list_stock') {
      const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const market = typeof body.market === 'string' ? body.market.trim() : 'domestic';
      const sector = typeof body.sector === 'string' ? body.sector.trim() : '반도체';
      const initPrice = Number(body.initialPrice);

      if (!ticker || !name || !Number.isFinite(initPrice) || initPrice <= 0) {
        return NextResponse.json(
          { success: false, message: '유효한 티커, 종목명, 초기 가격(>0)이 필요합니다.' },
          { status: 400 }
        );
      }
      if (memoryDb.tickerIndex.has(ticker)) {
        return NextResponse.json(
          { success: false, message: `이미 상장된 티커입니다: ${ticker}` },
          { status: 409 }
        );
      }

      const newId = crypto.randomUUID();
      const created = await withAllStockLocks([newId], async () => {
        return await runWithCommitGate(persistConfirmedState, async () => {
          const rec: any = {
            id: newId,
            ticker,
            name,
            market,
            sector,
            current_price: initPrice,
            open_price: initPrice,
            previous_close: initPrice,
            high: initPrice,
            low: initPrice,
            volume: 10000,
            change_rate: 0,
            market_cap: Math.round(initPrice * 1_000_000),
            target_price: Math.round(initPrice * 1.2),
            is_listed: true,
            is_core: false,
            shares_outstanding: 1_000_000,
            floating_shares: 500_000,
          };
          memoryDb.stocks.set(newId, rec);
          memoryDb.addStockToIndex(rec);
          const saved = await persistConfirmedState();
          if (!saved) {
            memoryDb.stocks.delete(newId);
            memoryDb.tickerIndex.delete(ticker);
            return null;
          }
          return rec;
        });
      });

      if (!created) {
        return NextResponse.json({ success: false, message: '신규 종목 영속 저장에 실패했습니다.' }, { status: 500 });
      }
      return NextResponse.json({ success: true, stock: created });
    }

    // 6. AI 시황/웹소설 이벤트 등록 (관리자 전용)
    if (action === 'trigger_ai_event') {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : '';
      if (!title || !rawText) {
        return NextResponse.json(
          { success: false, message: '이벤트 제목과 본문이 필요합니다.' },
          { status: 400 }
        );
      }

      const newsId = memoryDb.generateId('news');
      const createdAt = memoryDb.getIsoTimestamp();
      const savedOk = await runWithCommitGate(persistConfirmedState, async () => {
        const entry: any = {
          id: newsId,
          headline: title,
          title,
          content: rawText,
          summary: rawText.slice(0, 120),
          publisher: 'ADMIN_EVENT',
          category: 'OFFICIAL',
          sentiment: 'positive',
          target_sector: '반도체',
          impact_score: 0.8,
          created_at: createdAt,
        };
        memoryDb.marketNews.unshift(entry);
        const saved = await persistConfirmedState();
        if (!saved) {
          memoryDb.marketNews.shift();
          return false;
        }
        return true;
      });

      if (!savedOk) {
        return NextResponse.json({ success: false, message: '이벤트 저장에 실패했습니다.' }, { status: 500 });
      }
      return NextResponse.json({ success: true, newsId });
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
