import { NextResponse } from 'next/server';
import { scenarioManager, syncScenarioManagerFromDatabase } from '@/lib/scenario/ScenarioManager';
import { commodityEngineInstance } from '@/lib/commodities/commodityEngineInstance';
import { MACRO_COMMODITY_EVENTS } from '@/lib/commodities/eventSystem';
import { COMMODITY_DEFINITIONS } from '@/lib/commodities/definitions';
import { verifyAdminSession } from '@/lib/auth/adminAuth';
import { ensureLocalStandaloneReady, getLocalStandaloneEngine, persistConfirmedState } from '@/lib/engine/localStandaloneServer';
import { withAllStockLocks } from '@/lib/engine/marketService';
import { runWithCommitGate, persistenceManager } from '@/lib/memoryDb/PersistenceManager';
import { memoryDb } from '@/lib/memoryDb/memoryStore';

const SUPPORTED_STOCK_MARKETS = new Set(['domestic', 'overseas', 'europe', 'etf']);

function getAuthoritativeScenarioManager() {
  return commodityEngineInstance?.scenarioManager ?? scenarioManager;
}

function withScenarioLocks<T>(stockIds: string[], task: () => Promise<T>): Promise<T> {
  const run = () => commodityEngineInstance.runWithTickLock(() => withAllStockLocks(stockIds, task));
  return getLocalStandaloneEngine()?.runWithSimulationLock(run) ?? run();
}

export async function GET(req: Request) {
  await ensureLocalStandaloneReady();
  const auth = await verifyAdminSession(req);
  if (!auth.isAdmin) {
    return NextResponse.json({ success: false, message: '관리자 권한이 필요합니다.' }, { status: 403 });
  }

  const activeManager = getAuthoritativeScenarioManager();
  const snapshot = await withScenarioLocks([], () => runWithCommitGate(
    undefined,
    async () => {
      try {
        syncScenarioManagerFromDatabase(memoryDb, activeManager, { clearOnDbNull: true });
        if (activeManager !== scenarioManager) {
          syncScenarioManagerFromDatabase(memoryDb, scenarioManager, { clearOnDbNull: true });
        }
      } catch { /* ignore invalid persisted snapshot */ }
      return {
        tick: activeManager.currentTick,
        activeScenarios: activeManager.getActiveScenarios(),
        activeMacroShocks: activeManager.getActiveMacroShocks(),
        logs: activeManager.getActionLogs(),
        tradingHalt: memoryDb.isTradingHalted(),
      };
    },
    persistenceManager
  ));
  const engine = getLocalStandaloneEngine();
  const diagnostics = engine ? engine.getDiagnosticsSummaryReport() : null;

  return NextResponse.json({
    success: true,
    tick: snapshot.tick,
    activeScenarios: snapshot.activeScenarios,
    activeMacroShocks: snapshot.activeMacroShocks,
    logs: snapshot.logs,
    diagnostics,
    emergencyControl: {
      tradingHalt: snapshot.tradingHalt,
      lpInfiniteLiquiditySupported: false,
    },
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

      if (assetType !== 'stock' && assetType !== 'commodity') {
        return NextResponse.json(
          { success: false, message: `지원하지 않는 시나리오 자산 유형입니다: ${String(assetType)} (stock 또는 commodity만 지원)` },
          { status: 400 }
        );
      }

      if (assetType === 'stock') {
        const targetStock = typeof assetId === 'string' ? memoryDb.stocks.get(assetId) : undefined;
        if (!targetStock || targetStock.market === 'bonds' || targetStock.is_listed === false) {
          return NextResponse.json(
            { success: false, message: '유효한 상장 주식/ETF 종목만 작전 시나리오 대상으로 지정할 수 있습니다. (채권·상장폐지 종목 미지원)' },
            { status: 400 }
          );
        }
      } else {
        const validCommodity = COMMODITY_DEFINITIONS.some((c) => c.id === assetId);
        if (!validCommodity) {
          return NextResponse.json(
            { success: false, message: `유효하지 않은 원자재 식별자입니다: ${String(assetId)}` },
            { status: 400 }
          );
        }
      }

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

      // DB stocks 목표가 및 시나리오 상태 원자적·영속 반영 (단일 커밋 게이트 내부에서 동기화/변이/롤백)
      const stockIdForLock = assetType === 'stock' && typeof assetId === 'string' && memoryDb.stocks.has(assetId)
        ? [assetId]
        : [];
      const injectedResult = await withScenarioLocks(stockIdForLock, async () => {
        return await runWithCommitGate(persistConfirmedState, async () => {
          syncScenarioManagerFromDatabase(memoryDb, activeManager, { clearOnDbNull: true });
          const prevSnap = activeManager.snapshotState();
          const prevDbSnap = memoryDb.scenarioRuntimeState ? structuredClone(memoryDb.scenarioRuntimeState) : null;
          const stk = stockIdForLock.length > 0 ? memoryDb.stocks.get(stockIdForLock[0]!) : undefined;
          const prevTarget = stk?.target_price;
          try {
            const scenario = activeManager.injectScenario(scenarioParams);
            if (activeManager !== scenarioManager) scenarioManager.restoreState(activeManager.snapshotState());
            if (stk) stk.target_price = Math.max(1, Math.round(safeInitialPrice * (1 + safeTargetPct / 100)));
            memoryDb.scenarioRuntimeState = activeManager.snapshotState();
            if (await persistConfirmedState()) return scenario;
          } catch (error) {
            console.error('[Admin scenarios] Scenario injection failed:', error);
          }
          if (stk) stk.target_price = prevTarget;
          memoryDb.scenarioRuntimeState = prevDbSnap;
          activeManager.restoreState(prevSnap);
          if (activeManager !== scenarioManager) scenarioManager.restoreState(prevSnap);
          return null;
        });
      });
      if (!injectedResult) {
        return NextResponse.json(
          { success: false, message: '시나리오 영속 저장에 실패하여 롤백되었습니다.' },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, scenario: injectedResult });
    }

    // 2. 거시경제 충격 발동
    if (action === 'trigger_macro_shock') {
      const { shockType } = body;
      if (typeof shockType !== 'string' || !Object.hasOwn(MACRO_COMMODITY_EVENTS, shockType)) {
        return NextResponse.json({ success: false, message: '지원하지 않는 거시경제 충격입니다.' }, { status: 400 });
      }
      const type = shockType as keyof typeof MACRO_COMMODITY_EVENTS;

      const shockResult = await withScenarioLocks([], async () => {
        await commodityEngineInstance.reconcileWithDatabase(memoryDb);
        return await runWithCommitGate(persistConfirmedState, async () => {
          syncScenarioManagerFromDatabase(memoryDb, activeManager, { clearOnDbNull: true });
          const prevSnap = activeManager.snapshotState();
          const prevDbSnap = memoryDb.scenarioRuntimeState ? structuredClone(memoryDb.scenarioRuntimeState) : null;
          const prevEventSnap = commodityEngineInstance.eventSystem.snapshotState();
          const prevDbEventSnap = memoryDb.commodityEventRuntimeState
            ? structuredClone(memoryDb.commodityEventRuntimeState)
            : null;
          const setting = memoryDb.adminSettings.get('1') ?? Array.from(memoryDb.adminSettings.values())[0];
          const prevSentiment = setting?.market_sentiment;

          try {
            const shock = activeManager.triggerMacroShock({ type, adminUser });
            const event = commodityEngineInstance.eventSystem.triggerEventById(
              MACRO_COMMODITY_EVENTS[type], commodityEngineInstance.currentTick
            );
            if (!event) throw new Error('Macro shock commodity template is missing');
            if (activeManager !== scenarioManager) scenarioManager.restoreState(activeManager.snapshotState());
            if (setting) setting.market_sentiment = shock.regime;
            memoryDb.scenarioRuntimeState = activeManager.snapshotState();
            memoryDb.commodityEventRuntimeState = commodityEngineInstance.eventSystem.snapshotState();
            if (await persistConfirmedState()) return shock;
          } catch (error) {
            console.error('[Admin scenarios] Macro shock failed:', error);
          }

          if (setting) setting.market_sentiment = prevSentiment;
          memoryDb.scenarioRuntimeState = prevDbSnap;
          memoryDb.commodityEventRuntimeState = prevDbEventSnap;
          activeManager.restoreState(prevSnap);
          if (activeManager !== scenarioManager) scenarioManager.restoreState(prevSnap);
          commodityEngineInstance.eventSystem.restoreState(prevEventSnap);
          return null;
        });
      });
      if (!shockResult) {
        return NextResponse.json(
          { success: false, message: '거시경제 충격 상태 영속 저장에 실패하여 롤백되었습니다.' },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, shock: shockResult });
    }

    // 5. 신규 종목 상장 (관리자 전용)
    if (action === 'list_stock') {
      const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const market =
        body.market === undefined
          ? 'domestic'
          : typeof body.market === 'string'
            ? body.market.trim()
            : '';
      const sector = typeof body.sector === 'string' ? body.sector.trim() : '반도체';
      const initPrice = Number(body.initialPrice);

      if (!SUPPORTED_STOCK_MARKETS.has(market)) {
        return NextResponse.json(
          {
            success: false,
            message: `지원하지 않는 시장 구분입니다: ${String(body.market)} (domestic, overseas, europe, etf 중 하나여야 합니다)`,
          },
          { status: 400 }
        );
      }

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
            memoryDb.removeStockFromIndex(rec);
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
      const savedOk = await withScenarioLocks([], () => runWithCommitGate(persistConfirmedState, async () => {
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
        const previousNews = [...memoryDb.marketNews];
        memoryDb.saveMarketNews(entry);
        try {
          if (await persistConfirmedState()) return true;
        } catch (error) {
          console.error('[Admin scenarios] News snapshot save failed:', error);
        }
        memoryDb.marketNews = previousNews;
        return false;
      }));

      if (!savedOk) {
        return NextResponse.json({ success: false, message: '이벤트 저장에 실패했습니다.' }, { status: 500 });
      }
      return NextResponse.json({ success: true, newsId });
    }

    // 3. 단일 시나리오 롤백
    if (action === 'rollback_scenario') {
      const { scenarioId } = body;
      const rollbackOutcome = await withScenarioLocks([], () => runWithCommitGate(persistConfirmedState, async () => {
        syncScenarioManagerFromDatabase(memoryDb, activeManager, { clearOnDbNull: true });
        const prevSnap = activeManager.snapshotState();
        const prevDbSnap = memoryDb.scenarioRuntimeState ? structuredClone(memoryDb.scenarioRuntimeState) : null;
        const success = activeManager.rollbackScenario(scenarioId, adminUser);
        if (activeManager !== scenarioManager) {
          try { scenarioManager.restoreState(activeManager.snapshotState()); } catch { /* ignore */ }
        }
        if (!success) {
          return { persisted: true, success: false };
        }
        memoryDb.scenarioRuntimeState = activeManager.snapshotState();
        const saved = await persistConfirmedState();
        if (!saved) {
          memoryDb.scenarioRuntimeState = prevDbSnap;
          activeManager.restoreState(prevSnap);
          if (activeManager !== scenarioManager) {
            try { scenarioManager.restoreState(prevSnap); } catch { /* ignore */ }
          }
          return { persisted: false, success: false };
        }
        return { persisted: true, success: true };
      }));
      if (!rollbackOutcome.persisted) {
        return NextResponse.json({ success: false, message: '시나리오 롤백 영속 저장에 실패했습니다.' }, { status: 500 });
      }
      return NextResponse.json({ success: rollbackOutcome.success });
    }

    // 4. 전체 긴급 정지 (EMERGENCY HALT ALL)
    if (action === 'emergency_halt') {
      const haltResult = await withScenarioLocks([], () => runWithCommitGate(persistConfirmedState, async () => {
        syncScenarioManagerFromDatabase(memoryDb, activeManager, { clearOnDbNull: true });
        const prevSnap = activeManager.snapshotState();
        const prevDbSnap = memoryDb.scenarioRuntimeState ? structuredClone(memoryDb.scenarioRuntimeState) : null;
        const result = activeManager.emergencyHaltAll(adminUser);
        if (activeManager !== scenarioManager) {
          try { scenarioManager.restoreState(activeManager.snapshotState()); } catch { /* ignore */ }
        }
        memoryDb.scenarioRuntimeState = activeManager.snapshotState();
        const saved = await persistConfirmedState();
        if (!saved) {
          memoryDb.scenarioRuntimeState = prevDbSnap;
          activeManager.restoreState(prevSnap);
          if (activeManager !== scenarioManager) {
            try { scenarioManager.restoreState(prevSnap); } catch { /* ignore */ }
          }
          return null;
        }
        return result;
      }));
      if (!haltResult) {
        return NextResponse.json({ success: false, message: '긴급 정지 영속 저장에 실패했습니다.' }, { status: 500 });
      }
      return NextResponse.json({ success: true, result: haltResult });
    }

    // 5. 긴급 서킷브레이커 (거래 동결 토글)
    if (action === 'set_trading_halt') {
      if (typeof body.tradingHalt !== 'boolean') {
        return NextResponse.json(
          { success: false, message: 'tradingHalt(boolean) 값이 필요합니다.' },
          { status: 400 }
        );
      }
      const nextHalt = body.tradingHalt;
      const persisted = await runWithCommitGate(persistConfirmedState, async () => {
        let setting = memoryDb.adminSettings.get('1') ?? Array.from(memoryDb.adminSettings.values())[0];
        const prevHalt = Boolean(setting?.trading_halt);
        if (!setting) {
          setting = { id: 1, base_rate: 0.025, market_sentiment: 'NEUTRAL', trading_halt: nextHalt };
          memoryDb.adminSettings.set('1', setting);
        } else {
          setting.trading_halt = nextHalt;
        }
        const saved = await persistConfirmedState();
        if (!saved) {
          setting.trading_halt = prevHalt;
          return false;
        }
        return true;
      });
      if (!persisted) {
        return NextResponse.json(
          { success: false, message: '거래 동결 상태 영속 저장에 실패하여 롤백되었습니다.' },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, tradingHalt: nextHalt });
    }

    // 6. 구조화된 시장 뉴스 이벤트 주입
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
