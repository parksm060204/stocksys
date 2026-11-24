import { memoryDb, StockRecord, TradeRecord, OrderRecord, ProfileRecord, HoldingRecord } from '../memoryDb/memoryStore';
import { createMemoryDbClient } from '../memoryDb/memoryDbClient';
import { persistenceManager, runWithCommitGate } from '../memoryDb/PersistenceManager';
import { printLocalBannerOnce } from './localDevMode';
import { withStockLock, withAllStockLocks } from './marketService';
import { withAccountLocks } from '../memoryDb/accountLocks';
import { snapshotTradingState, rollbackTradingState, TradingSnapshot } from '../memoryDb/memoryTransaction';
import { calculateTradeFees, executeSettlement, SettlementTrade } from './settlement';
import { getEffectiveStockTakerFeeRate } from './orderRisk';
import { AgentManager, AgentManagerOptions } from './simulation/agentManager';
import { validateMarketEvent } from './simulation/marketEventTypes';
import { SerialExecutionQueue } from './simulation/executionQueue';
import { createInMemoryRepositoryBundle } from '../repositories/inMemory';
import { SettlementBatchService } from '../../engine-server/src/settlement/SettlementBatchService';
import { ScenarioManager } from '../scenario/ScenarioManager';
import { CommodityMarketEngine, getAttachedCommodityEngines } from '../commodities/CommodityMarketEngine';

async function runWithCommodityEngineTickLocks<T>(
  engines: CommodityMarketEngine[],
  fn: () => Promise<T>,
  idx: number = 0
): Promise<T> {
  if (idx >= engines.length) {
    return await fn();
  }
  return await engines[idx].runWithTickLock(() => runWithCommodityEngineTickLocks(engines, fn, idx + 1));
}

export async function resetStandaloneMarketAtomically(
  persistFn?: () => Promise<boolean>
): Promise<boolean> {
  const commodityEngines = getAttachedCommodityEngines(memoryDb);
  return await runWithCommodityEngineTickLocks(commodityEngines, async () => {
    const allAssetIds = Array.from(
      new Set([
        ...memoryDb.stocks.keys(),
        ...memoryDb.optionsContracts.keys(),
        ...memoryDb.bonds.keys(),
      ])
    );
    return await withAllStockLocks(allAssetIds, async () => {
      return await runWithCommitGate(
        persistFn,
        async () => {
          const dbRollbackSnap = memoryDb.exportRollbackSnapshot();
          const prevCommodityResetVersion = memoryDb.commodityResetVersion;
          const prevCommoditySnapshotVersion = memoryDb.commoditySnapshotVersion;
          const prevScenarioResetVersion = memoryDb.scenarioResetVersion;
          const commSnapshots = commodityEngines.map((eng) => ({
            eng,
            runtimeSnap: eng.snapshotRuntime(),
            recMeta: eng.getReconcileMetadata(),
          }));
          const rollbackResetState = () => {
            memoryDb.restoreRollbackSnapshot(dbRollbackSnap);
            memoryDb.commodityResetVersion = prevCommodityResetVersion;
            memoryDb.commoditySnapshotVersion = prevCommoditySnapshotVersion;
            memoryDb.scenarioResetVersion = prevScenarioResetVersion;
            for (const { eng, runtimeSnap, recMeta } of commSnapshots) {
              eng.restoreRuntime(runtimeSnap);
              eng.restoreReconcileMetadata(recMeta);
            }
          };

          try {
            memoryDb.resetToSeedData({ suppressPublish: true });
            for (const eng of commodityEngines) {
              await eng.reconcileWithDatabase(memoryDb);
            }
            if (persistFn) {
              const saved = await persistFn();
              if (!saved) {
                rollbackResetState();
                return false;
              }
            }
            memoryDb.publish('market_reset', { timestamp: memoryDb.getNowMs() });
            return true;
          } catch (err) {
            rollbackResetState();
            throw err;
          }
        },
        persistFn ? undefined : persistenceManager
      );
    });
  });
}

interface GlobalWithEngine {
  __STOCKSYS_ENGINE__?: LocalMarketEngineInstance;
  __STOCKSYS_ENGINE_INITIALIZING__?: boolean;
  __STOCKSYS_DB_READY_PROMISE__?: Promise<void>;
  __STOCKSYS_READY_PROMISE__?: Promise<void>;
  __STOCKSYS_SHUTDOWN_REGISTERED__?: boolean;
}

type StandaloneFailureHook = (context: { stockId: string }) => void | boolean | Promise<void | boolean>;
let _standaloneTestFailureHook: StandaloneFailureHook | null = null;

/** @internal Test-only: inject a failure in processMatching after settlement, before state updates. */
export function __setStandaloneFailureHook(hook: StandaloneFailureHook | null): void {
  _standaloneTestFailureHook = hook;
}

const globalObj = globalThis as unknown as GlobalWithEngine;

export class LocalMarketEngineInstance {
  private isRunning: boolean = false;
  private tickIntervalMs: number = 1000;
  private timer: NodeJS.Timeout | null = null;
  private tickCount: number = 0;
  private simulationQueue = new SerialExecutionQueue();
  private client = createMemoryDbClient();
  private readonly LP_REFRESH_TICKS: number = 5;
  private readonly MAX_RETAINED_LP_ORDERS_PER_STOCK: number = 30;
  private isTicking: boolean = false;
  private onPersist?: () => Promise<boolean>;
  public lastPersistOk: boolean = true;
  public lastPersistError: string | null = null;
  private readonly SETTLEMENT_INTERVAL_TICKS: number = 50;
  private readonly MAX_RETAINED_TERMINATED_LP_ORDERS: number = 200;
  private settlementService: SettlementBatchService = new SettlementBatchService(
    createInMemoryRepositoryBundle(memoryDb),
    { now: () => memoryDb.getNowMs() }
  );

  // 국면 효과(Stage 2) 운용 모드는 안전 기본값 'OFF'로 시작.
  private agentManager: AgentManager;

  constructor() {
    const checkpoint = memoryDb.localSimulationClock;
    this.agentManager = new AgentManager(42, checkpoint?.simulationTime ?? 1773500000000);
    if (checkpoint) this.agentManager.clock.restoreState(checkpoint);
  }

  private checkpointSimulationClock(): void {
    memoryDb.localSimulationClock = this.agentManager.clock.getState();
  }

  public hasOnPersist(): boolean {
    return typeof this.onPersist === 'function';
  }

  public setOnPersist(fn?: () => Promise<boolean>): void {
    this.onPersist = fn;
    if (!fn) {
      this.agentManager.setOnPersist(undefined);
      return;
    }
    this.agentManager.setOnPersist(async () => {
      // Sync simulation clock inside the active commit gate before any in-step fill persists!
      this.checkpointSimulationClock();
      return await fn();
    });
  }


  // SDE: Merton Jump-Diffusion 가치 변동
  private fundamentals: Record<string, number> = {};
  private readonly mjd_mu: number = 0.0001;
  private readonly mjd_sigma: number = 0.004;
  private readonly mjd_lambda: number = 0.01;

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    printLocalBannerOnce();
    console.log('🚀 [LocalMarketEngine] Dev Engine started inside Next.js Node process.');

    this.scheduleTick(1000);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('🛑 [LocalMarketEngine] Dev Engine stopped.');
  }

  private scheduleTick(delayMs: number): void {
    if (!this.isRunning) return;
    this.timer = setTimeout(async () => {
      if (this.isTicking) return; // Prevent overlapping timer ticks
      const startTime = Date.now();
      try {
        this.isTicking = true;
        await this.tick();
      } catch (err) {
        console.error('❌ [LocalMarketEngine] Tick Error:', err);
      } finally {
        this.isTicking = false;
      }
      const elapsed = Date.now() - startTime;
      const nextDelay = Math.max(300, Math.min(2500, this.tickIntervalMs - elapsed));
      this.scheduleTick(nextDelay);
    }, delayMs);
  }

  private rollbackUnpersistedStep(
    agentSnap: ReturnType<AgentManager['captureStepSnapshot']>,
    prevDbClock: typeof memoryDb.localSimulationClock,
    prevMarketNews: typeof memoryDb.marketNews,
    prevPendingAdminEvents: typeof memoryDb.pendingAdminMarketEvents,
    prevBotOrders: Map<string, OrderRecord>
  ): void {
    this.agentManager.restoreStepSnapshot(agentSnap);
    memoryDb.localSimulationClock = prevDbClock ? { ...prevDbClock } : null;
    memoryDb.marketNews = structuredClone(prevMarketNews);
    memoryDb.pendingAdminMarketEvents = structuredClone(prevPendingAdminEvents);

    // Revert only bot/LP orders that were NOT matched by any concurrent external order
    for (const [id, ord] of Array.from(memoryDb.orders.entries())) {
      if (!this.isBotOrLpOrder(ord)) continue;
      const prevOrd = prevBotOrders.get(id);
      if (!prevOrd) {
        if ((ord.filled || 0) === 0) {
          memoryDb.orders.delete(id);
          memoryDb.removeOrderFromIndex(ord);
        }
      } else if ((ord.filled || 0) === (prevOrd.filled || 0) && ord.status !== prevOrd.status) {
        const restored = structuredClone(prevOrd);
        memoryDb.orders.set(id, restored);
        memoryDb.addOrderToIndex(restored);
      }
    }
    for (const [id, prevOrd] of prevBotOrders.entries()) {
      if (!memoryDb.orders.has(id)) {
        const restored = structuredClone(prevOrd);
        memoryDb.orders.set(id, restored);
        memoryDb.addOrderToIndex(restored);
      }
    }
  }

  private async runAgentStepWithCommitBoundary(
    dt: number,
    activePersist: (() => Promise<boolean>) | undefined,
    options: { alwaysPersist: boolean; throwOnPersistFailure: boolean }
  ): Promise<boolean> {
    // Drain any in-flight T0 snapshot commit before capturing rollback baseline & preStepCommitSeq
    // so an earlier save finishing mid-step is never mistaken for a T1 commit.
    const preStepCommitSeq = await runWithCommitGate(
      activePersist,
      async () => persistenceManager.getCommittedSnapshotSeq(),
      activePersist ? undefined : persistenceManager
    );
    const captureRollbackState = Boolean(activePersist);
    const agentSnap = captureRollbackState ? this.agentManager.captureStepSnapshot() : null;
    const prevDbClock = memoryDb.localSimulationClock ? { ...memoryDb.localSimulationClock } : null;
    const prevMarketNews = captureRollbackState ? structuredClone(memoryDb.marketNews) : null;
    const prevPendingAdminEvents = captureRollbackState ? structuredClone(memoryDb.pendingAdminMarketEvents) : null;
    const prevBotOrders = captureRollbackState
      ? new Map(
          Array.from(memoryDb.orders.entries())
            .filter(([, ord]) => this.isBotOrLpOrder(ord))
            .map(([id, ord]) => [id, structuredClone(ord)])
        )
      : null;

    let committedFillInStep = false;
    const previousAgentPersist = this.agentManager.getOnPersist();
    const previousClockSync = this.agentManager.getOnStepClockAdvance();
    const previousEventsEffective = this.agentManager.getOnEventsEffective();

    this.agentManager.setOnStepClockAdvance((clockState) => {
      memoryDb.localSimulationClock = clockState;
    });
    this.agentManager.setOnEventsEffective((effectiveIds) => {
      // Remove effective scheduled events synchronously before any mid-step fill or concurrent order persists.
      memoryDb.pendingAdminMarketEvents = memoryDb.pendingAdminMarketEvents.filter(
        (event) => !effectiveIds.has(event.eventId)
      );
    });
    if (activePersist) {
      this.agentManager.setOnPersist(async () => {
        this.checkpointSimulationClock();
        const saved = await activePersist();
        if (saved) {
          committedFillInStep = true;
        }
        return saved;
      });
    }

    const hasPersistedInStep = () =>
      committedFillInStep || persistenceManager.getCommittedSnapshotSeq() > preStepCommitSeq;

    try {
      await this.agentManager.step(dt);
    } catch (err) {
      if (captureRollbackState && !hasPersistedInStep() && agentSnap) {
        this.rollbackUnpersistedStep(
          agentSnap,
          prevDbClock,
          prevMarketNews!,
          prevPendingAdminEvents!,
          prevBotOrders!
        );
      } else {
        this.checkpointSimulationClock();
      }
      throw err;
    } finally {
      this.agentManager.setOnPersist(previousAgentPersist);
      this.agentManager.setOnStepClockAdvance(previousClockSync);
      this.agentManager.setOnEventsEffective(previousEventsEffective);
    }

    const commitOutcome = await runWithCommitGate(
      activePersist,
      async () => {
        const preCommitPending = structuredClone(memoryDb.pendingAdminMarketEvents);
        for (const event of preCommitPending) {
          if (
            !this.agentManager.publishedEventIds.has(event.eventId) &&
            !this.agentManager.pendingEvents.some((item) => item.eventId === event.eventId)
          ) {
            this.agentManager.registerEvent(event);
          }
        }
        const nextPending = preCommitPending.filter(
          (event) => !this.agentManager.effectiveEventIds.has(event.eventId)
        );
        memoryDb.pendingAdminMarketEvents = nextPending;
        this.checkpointSimulationClock();

        const prevPublishedSet = new Set(agentSnap?.publishedEventIds ?? []);
        const prevEffectiveSet = new Set(agentSnap?.effectiveEventIds ?? []);
        const hadAdminEventProgression =
          prevMarketNews !== null &&
          prevPendingAdminEvents !== null &&
          (
            memoryDb.marketNews.length !== prevMarketNews.length ||
            nextPending.length !== prevPendingAdminEvents.length ||
            Array.from(this.agentManager.publishedEventIds).some((id) => !prevPublishedSet.has(id)) ||
            Array.from(this.agentManager.effectiveEventIds).some((id) => !prevEffectiveSet.has(id))
          );

        const shouldPersist = options.alwaysPersist || hadAdminEventProgression;
        if (!activePersist || !shouldPersist) {
          return { ok: true as const };
        }

        let saved = false;
        let errorMsg = '';
        try {
          saved = await activePersist();
          if (!saved) {
            errorMsg = 'Simulation step snapshot save failed';
          }
        } catch (err: any) {
          saved = false;
          errorMsg = err?.message || String(err);
        }

        if (!saved) {
          this.lastPersistOk = false;
          this.lastPersistError = errorMsg || 'Simulation step snapshot save failed';

          if (!hasPersistedInStep() && agentSnap) {
            this.rollbackUnpersistedStep(
              agentSnap,
              prevDbClock,
              prevMarketNews!,
              prevPendingAdminEvents!,
              prevBotOrders!
            );
          } else {
            // An in-step fill or concurrent order already persisted the step's state/news/clock to disk.
            // Keep memory aligned with the persisted disk snapshot instead of rolling back to T0.
            memoryDb.pendingAdminMarketEvents = nextPending;
            this.checkpointSimulationClock();
          }
          return { ok: false as const, errorMsg: this.lastPersistError };
        }

        this.lastPersistOk = true;
        this.lastPersistError = null;
        return { ok: true as const };
      },
      activePersist ? undefined : persistenceManager
    );

    if (!commitOutcome.ok) {
      if (options.throwOnPersistFailure) {
        throw new Error(commitOutcome.errorMsg || 'Simulation step snapshot save failed');
      }
      return false;
    }
    return true;
  }

  /**
   * Advances the simulation deterministically through the serialized execution queue
   * and persists the advanced simulation clock before resolving when persistence is configured.
   */
  public async stepSimulation(dt: number = 1.0, persistFn?: () => Promise<boolean>): Promise<void> {
    const activePersist = persistFn ?? this.onPersist;
    await this.enqueueSimulation(async () => {
      await this.publishQueuedAdminEvents(activePersist, true);
      await this.runAgentStepWithCommitBoundary(dt, activePersist, {
        alwaysPersist: Boolean(activePersist),
        throwOnPersistFailure: true,
      });
    });
  }

  public async tick(): Promise<void> {
    await this.enqueueSimulation(() => this.runTick());
  }

  public async scheduleEvent(event: Parameters<AgentManager['registerEvent']>[0]): Promise<boolean> {
    return this.enqueueSimulation(() => Promise.resolve(this.agentManager.registerEvent(event)));
  }

  public async runWithSimulationLock<T>(task: () => Promise<T>): Promise<T> {
    return this.enqueueSimulation(task);
  }

  public async publishEvent(event: Parameters<AgentManager['publishEvent']>[0]): Promise<boolean> {
    return this.enqueueSimulation(async () => {
      const queued = await runWithCommitGate(persistConfirmedState, async () => {
        if (!event || validateMarketEvent(event) ||
            !Number.isFinite(new Date(event.publishedAt).getTime()) ||
            !Number.isFinite(new Date(event.effectiveFrom).getTime())) return false;
        const previous = memoryDb.pendingAdminMarketEvents;
        if (
          previous.some((item) => item.eventId === event.eventId) ||
          memoryDb.marketNews.some((item) => item.id === event.eventId) ||
          this.agentManager.publishedEventIds.has(event.eventId) ||
          this.agentManager.pendingEvents.some((item) => item.eventId === event.eventId)
        ) return false;

        const previousClock = memoryDb.localSimulationClock;
        memoryDb.pendingAdminMarketEvents = [...previous, structuredClone(event)];
        this.checkpointSimulationClock();
        try {
          if (!await persistConfirmedState()) throw new Error('Market event snapshot save failed');
        } catch (error) {
          memoryDb.pendingAdminMarketEvents = previous;
          memoryDb.localSimulationClock = previousClock;
          throw error;
        }
        return true;
      });
      if (queued) await this.publishQueuedAdminEvents();
      return queued;
    });
  }

  private async publishQueuedAdminEvents(
    persistFn?: () => Promise<boolean>,
    throwOnPersistFailure: boolean = false
  ): Promise<boolean> {
    if (memoryDb.pendingAdminMarketEvents.length === 0) return true;
    const effectivePersist = persistFn ?? this.onPersist ?? persistConfirmedState;
    let persistError: Error | null = null;
    let persistedOk = true;
    await runWithCommitGate(effectivePersist, async () => {
      const previous = structuredClone(memoryDb.pendingAdminMarketEvents);
      const previousClock = memoryDb.localSimulationClock ? { ...memoryDb.localSimulationClock } : null;
      const previousMarketNews = structuredClone(memoryDb.marketNews);
      const agentSnap = this.agentManager.captureStepSnapshot();
      const prevPublishedSet = new Set(agentSnap.publishedEventIds);

      for (const event of previous) {
        if (!this.agentManager.publishedEventIds.has(event.eventId) &&
            !this.agentManager.pendingEvents.some((item) => item.eventId === event.eventId)) {
          this.agentManager.registerEvent(event);
        }
      }

      this.checkpointSimulationClock();
      const pending = previous.filter((event) => !this.agentManager.effectiveEventIds.has(event.eventId));
      const hasNewPublications =
        memoryDb.marketNews.length !== previousMarketNews.length ||
        previous.some(
          (event) =>
            this.agentManager.publishedEventIds.has(event.eventId) && !prevPublishedSet.has(event.eventId)
        );
      if (pending.length === previous.length && !hasNewPublications) {
        return;
      }

      memoryDb.pendingAdminMarketEvents = pending;
      try {
        if (await effectivePersist()) {
          this.lastPersistOk = true;
          this.lastPersistError = null;
          return;
        }
        persistError = new Error('Market event snapshot save failed');
      } catch (error: any) {
        console.error('[LocalMarketEngine] Market event snapshot save failed:', error);
        persistError = error instanceof Error ? error : new Error(String(error));
      }
      // Roll back queue, clock, public news, and agentManager event state together within the same commit gate.
      this.agentManager.restoreStepSnapshot(agentSnap);
      memoryDb.localSimulationClock = previousClock;
      memoryDb.marketNews = previousMarketNews;
      memoryDb.pendingAdminMarketEvents = previous;
      this.lastPersistOk = false;
      this.lastPersistError = persistError.message;
      persistedOk = false;
    });
    if (throwOnPersistFailure && persistError) {
      throw persistError;
    }
    return persistedOk;
  }

  public async resetSimulation(persistFn?: () => Promise<boolean>): Promise<boolean> {
    return await this.enqueueSimulation(async () => {
      const effectivePersist = persistFn ?? this.onPersist;
      const ok = await resetStandaloneMarketAtomically(effectivePersist);
      if (!ok) {
        this.lastPersistOk = false;
        this.lastPersistError = 'Market reset snapshot save failed';
        return false;
      }
      this.agentManager.reset();
      this.checkpointSimulationClock();
      this.settlementService = new SettlementBatchService(
        createInMemoryRepositoryBundle(memoryDb),
        { now: () => memoryDb.getNowMs() }
      );
      this.tickCount = 0;
      this.lastPersistOk = true;
      this.lastPersistError = null;
      return true;
    });
  }

  // ── Read-Only Diagnostic Accessors (No State Mutations) ──

  public getSimulationTime(): number {
    return this.agentManager.clock.simulationTime;
  }

  public getActiveAgentsCount(): number {
    return this.agentManager.agents.size;
  }

  public getMarketFlowData(pointsLimit: number = 60) {
    return this.agentManager.diagnostics.getMarketFlowData(
      this.agentManager.clock.simulationTime,
      pointsLimit
    );
  }

  public getDiagnosticsSummaryReport(stockId?: string) {
    return this.agentManager.diagnostics.generateSummaryReport(stockId);
  }

  public getMarketStateSnapshot() {
    return this.agentManager.getMarketStateSnapshot();
  }

  public isEngineRunning(): boolean {
    return this.isRunning;
  }

  /** @internal Test-only access to underlying AgentManager for explicit headless unit assertions */
  public __getAgentManagerForTesting(): AgentManager {
    return this.agentManager;
  }

  private enqueueSimulation<T>(task: () => Promise<T>): Promise<T> {
    return this.simulationQueue.run(task);
  }

  private isBotOrLpOrder(order: OrderRecord): boolean {
    if (!order.user_id) return true;
    if (order.is_lp === true) return true;
    if (order.participant_type === 'bot' || order.participant_type === 'lp') return true;
    if (typeof order.agent_id === 'string' && order.agent_id.length > 0) return true;
    if (this.agentManager.agents.has(order.user_id)) return true;
    return false;
  }

  private prepareActiveStockScenarios(): boolean {
    const snap = memoryDb.scenarioRuntimeState;
    if (!snap || !Array.isArray(snap.activeScenarios) || snap.activeScenarios.length === 0) {
      this.agentManager.scenarioBiases.clear();
      return false;
    }
    const stockScenarios = snap.activeScenarios.filter(([, s]: [string, any]) => s?.assetType === 'stock' && s?.status === 'active');
    if (stockScenarios.length === 0) {
      this.agentManager.scenarioBiases.clear();
      return false;
    }
    const mgr = new ScenarioManager();
    mgr.restoreState(snap);
    this.agentManager.scenarioBiases.clear();
    for (const [, s] of stockScenarios) {
      if (s?.assetId) {
        this.agentManager.scenarioBiases.set(s.assetId, mgr.getAssetBias(s.assetId));
      }
    }
    return true;
  }

  private async commitStockScenarioStep(): Promise<void> {
    const activePersist = this.onPersist;
    await runWithCommitGate(
      activePersist,
      async () => {
        if (memoryDb.isTradingHalted()) return;
        const prevDbSnap = memoryDb.scenarioRuntimeState
          ? structuredClone(memoryDb.scenarioRuntimeState)
          : null;
        if (!prevDbSnap || !Array.isArray(prevDbSnap.activeScenarios)) return;
        const hasActiveStock = prevDbSnap.activeScenarios.some(
          ([, s]: [string, any]) => s?.assetType === 'stock' && s?.status === 'active'
        );
        if (!hasActiveStock) return;

        const mgr = new ScenarioManager();
        mgr.restoreState(prevDbSnap);
        mgr.stepTick('stock');
        memoryDb.scenarioRuntimeState = mgr.snapshotState();

        if (activePersist) {
          let saved = false;
          try {
            saved = await activePersist();
          } catch (err: any) {
            saved = false;
            this.lastPersistOk = false;
            this.lastPersistError = `Scenario step snapshot save threw at tick ${this.tickCount}: ${err?.message || String(err)}`;
          }
          if (!saved) {
            memoryDb.scenarioRuntimeState = prevDbSnap;
            this.lastPersistOk = false;
            if (!this.lastPersistError) {
              this.lastPersistError = `Scenario step snapshot save failed at tick ${this.tickCount}`;
            }
            return;
          }
          this.lastPersistOk = true;
          this.lastPersistError = null;
        }
      },
      activePersist ? undefined : persistenceManager
    );
  }

  private async runPeriodicSettlementBatch(persistFn: () => Promise<boolean>): Promise<void> {
    const batchNow = memoryDb.getNowMs();
    const repo = this.settlementService.getRepositories();

    const collectAllAssetIds = (): string[] =>
      Array.from(
        new Set([
          ...memoryDb.stocks.keys(),
          ...memoryDb.optionsContracts.keys(),
          ...memoryDb.bonds.keys(),
        ])
      ).sort();

    const collectPlan = () => {
      const expiredOptions = repo.settlement.getExpiredOptionContracts(batchNow);
      const bonds = repo.settlement.getBonds(batchNow);
      const expiredOptionIds = Array.from(new Set(expiredOptions.map((o) => o.id))).sort();
      const bondIds = Array.from(new Set(bonds.map((b) => b.id))).sort();
      const targetAssetIds = Array.from(new Set([...expiredOptionIds, ...bondIds])).sort();
      const targetHoldings = repo.settlement.getPositionsForAssetIds(targetAssetIds);
      const openOrderAccountIds =
        repo.settlement.getOpenOptionOrderAccountIds?.(expiredOptionIds) ?? [];
      const accountUserIds = Array.from(
        new Set([
          ...targetHoldings.map((h) => h.user_id),
          ...openOrderAccountIds,
        ])
      ).sort();
      const lockKeys = Array.from(
        new Set(accountUserIds.map((uid) => memoryDb.resolveAccountLockKey(uid)))
      ).sort();
      const targetHoldingKeys = Array.from(
        new Set(targetHoldings.map((h) => `${h.user_id}_${h.stock_id}`))
      ).sort();

      return {
        expiredOptions,
        expiredOptionIds,
        bonds,
        targetAssetIds,
        targetHoldings,
        targetHoldingKeys,
        openOrderAccountIds,
        accountUserIds,
        lockKeys,
      };
    };

    const sameStringArray = (a: readonly string[], b: readonly string[]): boolean =>
      a.length === b.length && a.every((v, i) => v === b[i]);

    const MAX_LOCK_RETRIES = 5;
    for (let assetAttempt = 0; assetAttempt <= MAX_LOCK_RETRIES; assetAttempt++) {
      const allAssetIds = collectAllAssetIds();
      const lockedAssetSet = new Set(allAssetIds);

      const assetOutcome = await withAllStockLocks(allAssetIds, async () => {
        for (let accountAttempt = 0; accountAttempt <= MAX_LOCK_RETRIES; accountAttempt++) {
          const planBefore = collectPlan();
          if (planBefore.targetAssetIds.some((id) => !lockedAssetSet.has(id))) {
            return 'retry_assets' as const;
          }

          const lockedAccountSet = new Set(planBefore.lockKeys);

          const accountOutcome = await withAccountLocks(planBefore.lockKeys, async () => {
            return await runWithCommitGate(persistFn, async () => {
              const planAfter = collectPlan();

              if (planAfter.targetAssetIds.some((id) => !lockedAssetSet.has(id))) {
                return 'retry_assets' as const;
              }

              const lockKeysMatch =
                sameStringArray(planAfter.lockKeys, planBefore.lockKeys) &&
                planAfter.lockKeys.every((k) => lockedAccountSet.has(k));
              const targetsMatch =
                sameStringArray(planAfter.targetAssetIds, planBefore.targetAssetIds) &&
                sameStringArray(planAfter.accountUserIds, planBefore.accountUserIds) &&
                sameStringArray(planAfter.targetHoldingKeys, planBefore.targetHoldingKeys);

              if (!lockKeysMatch || !targetsMatch) {
                return 'retry_accounts' as const;
              }

              const profileSnaps = new Map<string, ProfileRecord>();
              for (const pid of planAfter.lockKeys) {
                const p = memoryDb.profiles.get(pid);
                if (p) profileSnaps.set(pid, structuredClone(p));
              }
              for (const uid of planAfter.accountUserIds) {
                const p = memoryDb.resolveProfileByUserId(uid);
                if (p && !profileSnaps.has(p.id)) {
                  profileSnaps.set(p.id, structuredClone(p));
                }
              }

              const holdingSnaps = new Map<string, HoldingRecord>();
              const targetAssetSet = new Set(planAfter.targetAssetIds);
              for (const [hid, h] of memoryDb.holdings.entries()) {
                if (targetAssetSet.has(h.stock_id) && Number.isFinite(h.quantity) && h.quantity > 0) {
                  holdingSnaps.set(hid, structuredClone(h));
                }
              }

              const orderSnaps = new Map<string, OrderRecord>();
              for (const opt of planAfter.expiredOptions) {
                const orderIds = memoryDb.orderStockIndex.get(opt.id);
                if (orderIds) {
                  for (const oid of orderIds) {
                    const ord = memoryDb.orders.get(oid);
                    if (ord) orderSnaps.set(oid, structuredClone(ord));
                  }
                }
              }

              const optCountBefore = memoryDb.optionSettlements.length;
              const bondCountBefore = memoryDb.bondCouponPayments.length;
              const ledgerKeysBefore = new Set(memoryDb.settlementLedger.keys());
              const lpLiabilitiesSnap = new Map(memoryDb.lpLiabilities);
              const lastPeriodKeyBefore = this.settlementService.getLastRunPeriodKey();

              const rollbackSettlement = () => {
                for (const [pid, pSnap] of profileSnaps.entries()) {
                  const live = memoryDb.profiles.get(pid);
                  if (live) {
                    for (const k of Object.keys(live)) {
                      if (!(k in pSnap)) delete (live as any)[k];
                    }
                    Object.assign(live, structuredClone(pSnap));
                  } else {
                    memoryDb.profiles.set(pid, structuredClone(pSnap));
                  }
                  memoryDb.addProfileToIndex(memoryDb.profiles.get(pid)!);
                }
                for (const [hid, hSnap] of holdingSnaps.entries()) {
                  const restored = structuredClone(hSnap);
                  memoryDb.holdings.set(hid, restored);
                  memoryDb.addHoldingToIndex(restored);
                }
                for (const [oid, oSnap] of orderSnaps.entries()) {
                  const restored = structuredClone(oSnap);
                  memoryDb.orders.set(oid, restored);
                  memoryDb.addOrderToIndex(restored);
                }
                memoryDb.optionSettlements = memoryDb.optionSettlements.slice(0, optCountBefore);
                memoryDb.bondCouponPayments = memoryDb.bondCouponPayments.slice(0, bondCountBefore);
                for (const k of Array.from(memoryDb.settlementLedger.keys())) {
                  if (!ledgerKeysBefore.has(k)) {
                    memoryDb.settlementLedger.delete(k);
                  }
                }
                memoryDb.lpLiabilities = new Map(lpLiabilitiesSnap);
                this.settlementService.restoreLastRunPeriodKey(lastPeriodKeyBefore);
              };

              try {
                const summary = await this.settlementService.runDailySettlementBatch(batchNow);
                const hasChanges =
                  summary.optionSettled > 0 ||
                  summary.optionOrdersExpired > 0 ||
                  (summary.optionLpLiabilitiesCleared ?? 0) > 0 ||
                  summary.bondCouponsPaid > 0 ||
                  summary.bondPrincipalRedeemed > 0;
                if (!hasChanges) return 'done' as const;

                const saved = await persistFn();
                if (!saved) {
                  rollbackSettlement();
                  this.lastPersistOk = false;
                  this.lastPersistError = `Settlement batch snapshot save failed at tick ${this.tickCount}`;
                  console.error(`❌ [LocalMarketEngine] ${this.lastPersistError}`);
                } else {
                  this.lastPersistOk = true;
                  this.lastPersistError = null;
                }
              } catch (err: any) {
                rollbackSettlement();
                this.lastPersistOk = false;
                this.lastPersistError = `Settlement batch failed at tick ${this.tickCount}: ${err?.message || String(err)}`;
                console.error(`❌ [LocalMarketEngine] ${this.lastPersistError}`);
              }
              return 'done' as const;
            });
          });

          if (accountOutcome === 'done') {
            return 'done' as const;
          }
          if (accountOutcome === 'retry_assets') {
            return 'retry_assets' as const;
          }
        }
        return 'deferred' as const;
      });

      if (assetOutcome === 'done') {
        return;
      }
      if (assetOutcome === 'deferred') {
        console.warn(
          `⚠️ [LocalMarketEngine] Deferred settlement batch at tick ${this.tickCount}: target/account lock set changed continuously`
        );
        return;
      }
    }

    console.warn(
      `⚠️ [LocalMarketEngine] Deferred settlement batch at tick ${this.tickCount}: asset set changed continuously`
    );
  }

  private async runTick(): Promise<void> {
    this.tickCount++;
    const persistFn = this.onPersist || (() => persistenceManager.saveSnapshot(memoryDb));
    const prePublishOk = await this.publishQueuedAdminEvents(persistFn, false);

    // ── 1. 에이전트 기반 시장(ABM) 1스텝 실행 (긴급 거래 동결 시 거래 중지) ──
    if (prePublishOk && !memoryDb.isTradingHalted()) {
      const hadActiveStockScenarios = this.prepareActiveStockScenarios();
      let stepOk = false;
      try {
        stepOk = await this.runAgentStepWithCommitBoundary(1.0, persistFn, {
          alwaysPersist: false,
          throwOnPersistFailure: false,
        });
      } finally {
        this.agentManager.scenarioBiases.clear();
      }
      if (stepOk && hadActiveStockScenarios) {
        await this.commitStockScenarioStep();
      }
    }

    // ── 2. 오래된 봇 주문 및 종료된 LP 주문 메모리 정리 (Memory Leak 방지) ──
    if (this.tickCount % 20 === 0) {
      await withAllStockLocks(Array.from(memoryDb.stocks.keys()), async () => {
        await runWithCommitGate(persistFn, async () => {
          const nowMs = memoryDb.getNowMs();
          const simTime = this.agentManager.clock.simulationTime;
          const terminatedLpOrders: OrderRecord[] = [];

          for (const [id, order] of Array.from(memoryDb.orders.entries())) {
            // 실제 사용자 주문은 절대 삭제하지 않음
            if (!this.isBotOrLpOrder(order)) continue;

            const ageMs =
              typeof order.simulation_time === 'number' && Number.isFinite(order.simulation_time)
                ? Math.max(0, simTime - order.simulation_time)
                : Math.max(0, nowMs - new Date(order.created_at).getTime());

            const isTerminated =
              order.status === 'filled' ||
              order.status === 'cancelled' ||
              order.status === 'expired';

            if (!order.is_lp) {
              // 일반 봇 주문 정리: 체결/취소/만료 완료 또는 60초 초과
              if (isTerminated || ageMs > 60_000) {
                memoryDb.orders.delete(id);
                memoryDb.removeOrderFromIndex(order);
              }
            } else {
              // 종료된 LP 주문(filled / cancelled / expired) 30초 초과 시 정리
              if (isTerminated && ageMs > 30_000) {
                memoryDb.orders.delete(id);
                memoryDb.removeOrderFromIndex(order);
              } else if (isTerminated) {
                terminatedLpOrders.push(order);
              }
            }
          }

          if (terminatedLpOrders.length > this.MAX_RETAINED_TERMINATED_LP_ORDERS) {
            terminatedLpOrders.sort((a, b) => a.created_at.localeCompare(b.created_at));
            const excess = terminatedLpOrders.length - this.MAX_RETAINED_TERMINATED_LP_ORDERS;
            for (let i = 0; i < excess; i++) {
              const ord = terminatedLpOrders[i];
              memoryDb.orders.delete(ord.id);
              memoryDb.removeOrderFromIndex(ord);
            }
          }

          await this.client.rpc('trim_old_market_data', { p_max_trades: 5000, p_max_history: 3000 });
          memoryDb.trimSettlementLedger(10000);
          let saved = false;
          try {
            saved = await persistFn();
          } catch (err: any) {
            saved = false;
            this.lastPersistOk = false;
            this.lastPersistError = `Periodic snapshot save threw at tick ${this.tickCount}: ${err?.message || String(err)}`;
            console.error(`❌ [LocalMarketEngine] ${this.lastPersistError}`);
            return;
          }
          if (!saved) {
            this.lastPersistOk = false;
            this.lastPersistError = `Periodic snapshot save failed at tick ${this.tickCount}`;
            console.error(`❌ [LocalMarketEngine] ${this.lastPersistError}`);
          } else {
            this.lastPersistOk = true;
            this.lastPersistError = null;
          }
        });
      });
    }

    // ── 3. 만기 옵션/채권 정기 정산 (50틱 주기, 락·커밋게이트·영속 경계 내 원자적 실행) ──
    if (this.tickCount % this.SETTLEMENT_INTERVAL_TICKS === 0) {
      await this.runPeriodicSettlementBatch(persistFn);
    }
  }

  /**
   * 안정적 ID 및 차분 갱신을 사용한 LP 호가 관리.
   * 종료된 LP 주문 누적을 방지하고, 호가 점멸을 최소화하며, 사용자 주문은 완전 보존.
   */
  public async refreshLpOrders(): Promise<void> {
    const now = memoryDb.getNowMs();
    const stockIds = Array.from(memoryDb.stocks.keys());

    for (const stockId of stockIds) {
      await withStockLock(stockId, async () => {
        // 락 내부에서 현재 DB에 존재하는 최신 종목 객체 조회 (대기 중 교체/삭제 방어)
        const stk = memoryDb.stocks.get(stockId);
        if (!stk || stk.is_listed === false) return;

        const cp = stk.current_price;
        const tick = this.getTickSize(cp);
        const baseVol = cp >= 50000 ? 2500 : cp >= 10000 ? 800 : 200;

        // 종목별 종료된 LP 주문 보존 한도(cap) 적용
        const existingStockOrderIds = memoryDb.orderStockIndex.get(stockId);
        if (existingStockOrderIds) {
          const finishedLpOrders: OrderRecord[] = [];
          for (const oId of existingStockOrderIds) {
            const ord = memoryDb.orders.get(oId);
            if (ord && ord.is_lp && (ord.status === 'filled' || ord.status === 'cancelled')) {
              finishedLpOrders.push(ord);
            }
          }

          if (finishedLpOrders.length > this.MAX_RETAINED_LP_ORDERS_PER_STOCK) {
            finishedLpOrders.sort((a, b) => a.created_at.localeCompare(b.created_at));
            const removeCount = finishedLpOrders.length - this.MAX_RETAINED_LP_ORDERS_PER_STOCK;
            for (let i = 0; i < removeCount; i++) {
              const toRemove = finishedLpOrders[i];
              memoryDb.orders.delete(toRemove.id);
              memoryDb.removeOrderFromIndex(toRemove);
            }
          }
        }

        // 안정적인 ID를 사용한 10단 호가 차분 갱신 (점멸 방지)
        for (let level = 1; level <= 10; level++) {
          // BUY LP 호가
          const bidPrice = cp - level * tick;
          if (bidPrice > 0) {
            const bidId = `lp_${stk.id}_bid_${level}`;
            const bidSize = Math.round(baseVol * (1 + (10 - level) * 0.15));
            const existingBid = memoryDb.orders.get(bidId);

            if (existingBid && (existingBid.status === 'open' || existingBid.status === 'partial') && existingBid.price === bidPrice) {
              // 가격이 동일하면 수량만 조정하거나 기존 호가 유지 (점멸 방지)
              existingBid.size = bidSize;
            } else {
              // 신규 등록 또는 가격 변동 시 업데이트
              const ord: OrderRecord = {
                id: bidId,
                stock_id: stk.id,
                user_id: null,
                side: 'buy',
                price: bidPrice,
                size: bidSize,
                filled: 0,
                status: 'open',
                is_lp: true,
                created_at: new Date(now).toISOString(),
              };
              memoryDb.orders.set(bidId, ord);
              memoryDb.addOrderToIndex(ord);
            }
          }

          // SELL LP 호가
          const askPrice = cp + level * tick;
          const askId = `lp_${stk.id}_ask_${level}`;
          const askSize = Math.round(baseVol * (1 + (10 - level) * 0.15));
          const existingAsk = memoryDb.orders.get(askId);

          if (existingAsk && (existingAsk.status === 'open' || existingAsk.status === 'partial') && existingAsk.price === askPrice) {
            existingAsk.size = askSize;
          } else {
            const aOrd: OrderRecord = {
              id: askId,
              stock_id: stk.id,
              user_id: null,
              side: 'sell',
              price: askPrice,
              size: askSize,
              filled: 0,
              status: 'open',
              is_lp: true,
              created_at: new Date(now).toISOString(),
            };
            memoryDb.orders.set(askId, aOrd);
            memoryDb.addOrderToIndex(aOrd);
          }
        }
      });
    }
  }

  /**
   * 자동 시장 엔진의 연속 매칭 및 원자적 정산.
   * - 종목별 lock (withStockLock) 적용으로 사용자 주문과 상호 배제
   * - 봇/LP user_id=null 명시적 지원 (정상 봇 거래 허용)
   * - 동일 실제 사용자의 자기 매매 방지
   * - 정산 실패 또는 에러 발생 시 모든 상태(현금, 보유량, 주문, 거래, 종목 통계, 가격 기록, 인덱스) 완전 롤백
   * - 확정된 상태만 외부에 발행
   */
  public async processMatching(botOrders: any[]): Promise<void> {
    // 1. 봇 주문을 stock_id별로 분류 (상장 폐지 종목 제외)
    const botOrdersByStock = new Map<string, any[]>();
    for (const b of botOrders) {
      if (memoryDb.stocks.get(b.stock_id)?.is_listed === false) continue;
      if (!botOrdersByStock.has(b.stock_id)) {
        botOrdersByStock.set(b.stock_id, []);
      }
      botOrdersByStock.get(b.stock_id)!.push(b);
    }

    // 활성화된 주문이 있는 모든 종목 수집 (상장 폐지 종목 신규 매칭 제외, 기존 주문 취소는 별도 경로로 보존)
    const targetStockIds = new Set<string>(botOrdersByStock.keys());
    for (const ord of memoryDb.orders.values()) {
      if (ord.status === 'open' || ord.status === 'partial') {
        if (memoryDb.stocks.get(ord.stock_id)?.is_listed === false) continue;
        targetStockIds.add(ord.stock_id);
      }
    }

    for (const stockId of targetStockIds) {
      // 종목 락으로 사용자 주문과의 동시성 완전 직렬화
      await withStockLock(stockId, async () => {
        // 락 획득 후 현재 DB에 존재하는 최신 종목 객체 조회 (대기 중 교체/삭제/상장폐지 방어)
        const stock = memoryDb.stocks.get(stockId);
        if (!stock || stock.is_listed === false) return;

        // 2. 해당 종목의 봇 주문 등록
        const pendingBots = botOrdersByStock.get(stockId) || [];
        for (const b of pendingBots) {
          const id = memoryDb.generateId('bot_ord');
          const oRec: OrderRecord = { ...b, id };
          memoryDb.orders.set(id, oRec);
          memoryDb.addOrderToIndex(oRec);
        }

        // 3. 해당 종목의 미체결 주문 집계
        const bids: OrderRecord[] = [];
        const asks: OrderRecord[] = [];

        const stockOrderIds = memoryDb.orderStockIndex.get(stockId);
        if (stockOrderIds) {
          for (const oId of stockOrderIds) {
            const ord = memoryDb.orders.get(oId);
            if (!ord || (ord.status !== 'open' && ord.status !== 'partial')) continue;
            if (ord.side === 'buy') bids.push(ord);
            else asks.push(ord);
          }
        }

        if (bids.length === 0 || asks.length === 0) return;

        // 가격 우선, 시간 우선 정렬
        // 매수: 가격 내림차순, 시간 오름차순
        bids.sort((a, b) => b.price !== a.price ? b.price - a.price : a.created_at.localeCompare(b.created_at));
        // 매도: 가격 오름차순, 시간 오름차순
        asks.sort((a, b) => a.price !== b.price ? a.price - b.price : a.created_at.localeCompare(b.created_at));

        const tradesToSettle: SettlementTrade[] = [];
        const orderUpdates: { orderId: string; newFilled: number; newStatus: OrderRecord['status'] }[] = [];
        const involvedUserIds = new Set<string>();
        const localFilledMap = new Map<string, number>();

        let executionHigh = -Infinity;
        let executionLow = Infinity;
        let lastExecPrice: number | null = null;
        let matchedVol = 0;
        const nowMs = memoryDb.getNowMs();
        const now = new Date(nowMs).toISOString();

        let bidIdx = 0;
        let askIdx = 0;

        while (bidIdx < bids.length && askIdx < asks.length) {
          const topBid = bids[bidIdx]!;
          const topAsk = asks[askIdx]!;

          if (topBid.price < topAsk.price) break; // Cross 미발생

          // [Self-Trade Prevention] 동일한 실제 사용자끼리의 체결 방지
          // 봇/LP(user_id === null)는 자기 매매 차단 대상이 아니며, 정상 거래 가능
          if (topBid.user_id && topAsk.user_id && topBid.user_id === topAsk.user_id) {
            // 나중에 들어온 쪽(taker)을 건너뜀
            if (topBid.created_at > topAsk.created_at) {
              bidIdx++;
            } else {
              askIdx++;
            }
            continue;
          }

          // 미수 부채가 있는 매수 계좌의 대기 매수 주문은 체결 차단
          if (topBid.user_id) {
            const bidBuyerDebt = Math.max(0, Number(memoryDb.resolveProfileByUserId(topBid.user_id)?.margin_debt_krw ?? 0));
            if (bidBuyerDebt > 0) {
              bidIdx++;
              continue;
            }
          }

          const curBidFilled = localFilledMap.get(topBid.id) ?? (topBid.filled || 0);
          const curAskFilled = localFilledMap.get(topAsk.id) ?? (topAsk.filled || 0);
          const bidRemain = topBid.size - curBidFilled;
          const askRemain = topAsk.size - curAskFilled;
          const matchQty = Math.min(bidRemain, askRemain);

          if (matchQty <= 0) {
            if (bidRemain <= 0) bidIdx++;
            if (askRemain <= 0) askIdx++;
            continue;
          }

          // Maker-Taker 판별 (더 일찍 생성된 주문이 Maker)
          const isBidMaker = topBid.created_at <= topAsk.created_at;
          const execPrice = isBidMaker ? topBid.price : topAsk.price;

          lastExecPrice = execPrice;
          executionHigh = Math.max(executionHigh, execPrice);
          executionLow = Math.min(executionLow, execPrice);
          matchedVol += matchQty;

          const newBidFilled = curBidFilled + matchQty;
          const newAskFilled = curAskFilled + matchQty;
          const newBidStatus: OrderRecord['status'] = newBidFilled >= topBid.size ? 'filled' : 'partial';
          const newAskStatus: OrderRecord['status'] = newAskFilled >= topAsk.size ? 'filled' : 'partial';

          localFilledMap.set(topBid.id, newBidFilled);
          localFilledMap.set(topAsk.id, newAskFilled);

          orderUpdates.push({ orderId: topBid.id, newFilled: newBidFilled, newStatus: newBidStatus });
          orderUpdates.push({ orderId: topAsk.id, newFilled: newAskFilled, newStatus: newAskStatus });

          // 수수료 계산 (테이커 측 fee_booster 50% 할인 반영)
          const baseFees = calculateTradeFees(isBidMaker, !isBidMaker);
          const buyerProfile = topBid.user_id ? memoryDb.resolveProfileByUserId(topBid.user_id) : undefined;
          const sellerProfile = topAsk.user_id ? memoryDb.resolveProfileByUserId(topAsk.user_id) : undefined;
          const buyer_fee = isBidMaker ? baseFees.buyer_fee : getEffectiveStockTakerFeeRate(buyerProfile, nowMs);
          const seller_fee = !isBidMaker ? baseFees.seller_fee : getEffectiveStockTakerFeeRate(sellerProfile, nowMs);
          const tradeId = memoryDb.nextMonotonicTradeId('tr');

          tradesToSettle.push({
            id: tradeId,
            stock_id: stockId,
            buyer_id: topBid.user_id || null,
            seller_id: topAsk.user_id || null,
            buyer_is_bot: !topBid.user_id,
            seller_is_bot: !topAsk.user_id,
            price: execPrice,
            size: matchQty,
            buyer_fee,
            seller_fee,
            created_at: now,
          });

          if (topBid.user_id) involvedUserIds.add(topBid.user_id);
          if (topAsk.user_id) involvedUserIds.add(topAsk.user_id);

          if (newBidStatus === 'filled') bidIdx++;
          if (newAskStatus === 'filled') askIdx++;
        }

        if (tradesToSettle.length === 0) return;

        // 실제 사용자 계정 락 획득 후 원자적 정산 및 영속 저장 실행
        const userIdsArray = Array.from(involvedUserIds);
        const lockKeys = userIdsArray.map((id) => memoryDb.resolveAccountLockKey(id));
        await withAccountLocks(lockKeys, async () => {
          await runWithCommitGate(this.onPersist, async () => {
            const snap: TradingSnapshot = snapshotTradingState(stockId, userIdsArray);
            for (const t of tradesToSettle) {
              if (t.id) snap.createdTradeIds.add(t.id);
            }

            try {
              // 정산 실행 및 검증
              const settleResult = await executeSettlement(this.client, tradesToSettle);
              if (!settleResult.success) {
                throw new Error(settleResult.error?.message || '자동 매칭 정산 실패');
              }

              for (const tradeId of settleResult.trade_ids) {
                snap.createdTradeIds.add(tradeId);
              }

              // ── Test-only failure hook after settlement ──
              if (_standaloneTestFailureHook) {
                const hookResult = await _standaloneTestFailureHook({ stockId });
                if (hookResult !== false) {
                  throw new Error('[TEST] Injected standalone post-settlement failure');
                }
              }

              // 정산 성공 확정 후 주문 상태 실제 갱신
              for (const update of orderUpdates) {
                const liveOrder = memoryDb.orders.get(update.orderId);
                if (liveOrder) {
                  liveOrder.filled = update.newFilled;
                  liveOrder.status = update.newStatus;
                }
              }

              // 종목 현재가, 최고가, 최저가, 거래량 확정 반영
              if (lastExecPrice !== null && lastExecPrice > 0) {
                const liveStock = memoryDb.stocks.get(stockId);
                if (!liveStock) return;

                const curHigh = Number(liveStock.high || 0);
                const curLow = Number(liveStock.low || 0);
                const newHigh = Math.max(curHigh, executionHigh);
                const newLow = curLow === 0 ? executionLow : Math.min(curLow, executionLow);

                liveStock.current_price = lastExecPrice;
                liveStock.high = newHigh;
                liveStock.low = newLow;
                liveStock.high_price = newHigh;
                liveStock.low_price = newLow;
                liveStock.volume = Number(liveStock.volume || 0) + matchedVol;
                liveStock.change_rate = parseFloat((((lastExecPrice - liveStock.previous_close) / liveStock.previous_close) * 100).toFixed(2));

                // 주가 히스토리 추가
                const histId = memoryDb.generateId(`hist_${stockId}`);
                snap.createdHistoryIds.add(histId);
                memoryDb.stockPriceHistory.push({
                  id: histId,
                  stock_id: stockId,
                  price: lastExecPrice,
                  recorded_at: now,
                });

                if (this.onPersist) {
                  const saved = await this.onPersist();
                  if (!saved) {
                    this.lastPersistOk = false;
                    this.lastPersistError = `Auto-matching persist failed for stock ${stockId}`;
                    throw new Error(this.lastPersistError);
                  }
                  this.lastPersistOk = true;
                  this.lastPersistError = null;
                }

                // 외부에 확정된 시세 발행
                memoryDb.publish('stocks_changes', { eventType: 'UPDATE', new: liveStock });
              } else if (this.onPersist) {
                const saved = await this.onPersist();
                if (!saved) {
                  this.lastPersistOk = false;
                  this.lastPersistError = `Auto-matching persist failed for stock ${stockId}`;
                  throw new Error(this.lastPersistError);
                }
                this.lastPersistOk = true;
                this.lastPersistError = null;
              }
            } catch (err) {
              console.error(`[LocalMarketEngine] Matching settlement failed for stock ${stockId}, rolling back:`, err);
              rollbackTradingState(snap);
              // 에러를 상위로 전파하지 않고 해당 틱 롤백 완료
            }
          });
        });
      });
    }
  }

  private getTickSize(price: number): number {
    if (price < 2000) return 1;
    if (price < 5000) return 5;
    if (price < 20000) return 10;
    if (price < 50000) return 50;
    if (price < 200000) return 100;
    if (price < 500000) return 500;
    return 1000;
  }
}

/**
 * 스냅샷 DB 복원만 독립적으로 대기한다. (인증 콜백에서 엔진 기동/세션 순환 호출 없이 안전하게 사용 가능)
 */
export async function ensureMemoryDbReady(): Promise<void> {
  if (!globalObj.__STOCKSYS_DB_READY_PROMISE__) {
    globalObj.__STOCKSYS_DB_READY_PROMISE__ = (async () => {
      await persistenceManager.loadSnapshot(memoryDb);
    })().catch((err) => {
      globalObj.__STOCKSYS_DB_READY_PROMISE__ = undefined;
      throw err;
    });
  }
  return globalObj.__STOCKSYS_DB_READY_PROMISE__;
}

export async function ensureLocalStandaloneReady(): Promise<void> {
  if (!globalObj.__STOCKSYS_READY_PROMISE__) {
    globalObj.__STOCKSYS_READY_PROMISE__ = (async () => {
      // 1. 스냅샷 복원 완료 전에는 엔진/주문을 시작하지 않는다.
      await ensureMemoryDbReady();

      // Next.js 프로덕션 빌드 단계에서는 백그라운드 타이머/엔진 루프를 기동하지 않는다.
      if (process.env.NEXT_PHASE === 'phase-production-build') {
        return;
      }

      // 2. 엔진 기동 및 주기적 스냅샷 자동 저장 연결
      if (!globalObj.__STOCKSYS_ENGINE__) {
        const engine = new LocalMarketEngineInstance();
        engine.setOnPersist(persistConfirmedState);
        globalObj.__STOCKSYS_ENGINE__ = engine;
        await engine.start();
      }
      persistenceManager.startAutoSave(memoryDb, 30000);

      // 3. 종료 시 최종 스냅샷 플러시 등록
      if (!globalObj.__STOCKSYS_SHUTDOWN_REGISTERED__ && typeof process !== 'undefined' && typeof process.on === 'function') {
        globalObj.__STOCKSYS_SHUTDOWN_REGISTERED__ = true;
        const flushAndStop = async () => {
          persistenceManager.stopAutoSave();
          if (globalObj.__STOCKSYS_ENGINE__) {
            globalObj.__STOCKSYS_ENGINE__.stop();
          }
          await persistenceManager.saveSnapshot(memoryDb).catch(() => false);
          persistenceManager.releaseWriterLock();
        };
        process.once('SIGINT', () => {
          flushAndStop().finally(() => process.exit(0));
        });
        process.once('SIGTERM', () => {
          flushAndStop().finally(() => process.exit(0));
        });
      }
    })().catch((err) => {
      globalObj.__STOCKSYS_READY_PROMISE__ = undefined;
      throw err;
    });
  }
  return globalObj.__STOCKSYS_READY_PROMISE__;
}

export function ensureLocalStandaloneEngine(): void {
  if (globalObj.__STOCKSYS_ENGINE__) return;
  void ensureLocalStandaloneReady().catch((err) => {
    console.error('[LocalMarketEngine] Failed to initialize standalone runtime:', err);
  });
}

export async function persistConfirmedState(): Promise<boolean> {
  return persistenceManager.saveSnapshot(memoryDb);
}

export function stopLocalStandaloneEngine(): void {
  persistenceManager.stopAutoSave();
  if (globalObj.__STOCKSYS_ENGINE__) {
    globalObj.__STOCKSYS_ENGINE__.stop();
    globalObj.__STOCKSYS_ENGINE__ = undefined;
  }
  persistenceManager.releaseWriterLock();
  globalObj.__STOCKSYS_READY_PROMISE__ = undefined;
  globalObj.__STOCKSYS_DB_READY_PROMISE__ = undefined;
}

export function getLocalStandaloneEngine(): LocalMarketEngineInstance | undefined {
  return globalObj.__STOCKSYS_ENGINE__;
}

export function getLocalStandaloneClient(): any {
  return createMemoryDbClient();
}

/**
 * Headless 시뮬레이션 러너 전용 안전 옵션 타입.
 * verifier 또는 인증 구현체를 주입할 수 있는 필드는 엄격히 배제됨.
 */
export interface HeadlessSimulationRunnerOptions {
  enableRegimeEngine?: boolean;
  /** 국면 효과 모드 ('OFF' | 'SHADOW' 허용. 'EXPERIMENTAL_ON'은 생성자 직접 활성화 금지). 기본값 'OFF'. */
  regimeEffectsMode?: 'OFF' | 'SHADOW' | 'EXPERIMENTAL_ON';
  /** @deprecated 생성자 직접 활성화는 금지되며 무시됩니다. 기본값 'OFF'. */
  enableRegimeEffects?: boolean;
  regimeEngineConfig?: AgentManagerOptions['regimeEngineConfig'];
}

/**
 * Creates a standalone, queue-aware headless simulation runner for isolated deterministic tests.
 */
export function createHeadlessSimulationRunner(
  seed: number = 42,
  startEpochMs: number = 1773500000000,
  options?: HeadlessSimulationRunnerOptions
) {
  const queue = new SerialExecutionQueue();
  const agentManager = new AgentManager(seed, startEpochMs, options);
  return {
    agentManager,
    queue,
    step: (dt: number = 1.0) => queue.run(() => agentManager.step(dt)),
    registerEvent: (ev: Parameters<AgentManager['registerEvent']>[0]) =>
      queue.run(() => Promise.resolve(agentManager.registerEvent(ev))),
    publishEvent: (ev: Parameters<AgentManager['publishEvent']>[0]) =>
      queue.run(() => Promise.resolve(agentManager.publishEvent(ev))),
    reset: (s?: number) => queue.run(() => Promise.resolve(agentManager.reset(s))),
    getFlowData: (points: number = 60) =>
      agentManager.diagnostics.getMarketFlowData(agentManager.clock.simulationTime, points),
    getSimulationTime: () => agentManager.clock.simulationTime,
  };
}
