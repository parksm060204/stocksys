/**
 * STOCKSYS Agent Manager & Causal Market Simulation Orchestrator
 *
 * Coordinates:
 * - Deterministic simulation clock & decoupled PRNG streams
 * - Single source of truth structured market events & idempotency tracking
 * - Bounded attention & uncertainty dynamics with half-life decay
 * - Weighted stock candidate selection with exploration (eliminates fixed-order full evaluation)
 * - Information latency buffer per agent
 * - Two-phase LP quoting with strict non-duplicative budget management
 * - Continuous window statistics, leader ranking, and causal trace logs
 * - Unified execution via LocalMarketService.submitOrder & cancelOrder
 */

import { memoryDb, StockRecord, MarketNewsRecord, OrderRecord } from '../../memoryDb/memoryStore';
import { LocalMarketService } from '../marketService';
import { calculateReservedCash, calculateReservedQty, OpenOrderForRisk } from '../orderRisk';
import { SimulationClock, SimPrng } from './simClock';
import {
  AgentAccount,
  ValueStrategyConfig,
  TrendStrategyConfig,
  LpStrategyConfig,
  AgentOrderIntent,
} from './agentTypes';
import { buildMarketObservation } from './marketObservation';
import { evaluateValueStrategy } from './strategies/valueStrategy';
import { evaluateTrendStrategy } from './strategies/trendStrategy';
import { evaluateLpStrategy } from './strategies/lpStrategy';
import { MarketDiagnostics, WindowStatistics } from './marketDiagnostics';
import {
  MarketEvent,
  EventIdempotencyTracker,
  SEED_EVENT_TEMPLATES,
  resolveTargetStockIds,
  getVisibleMarketEvents,
  validateMarketEvent,
  calculateEffectiveMacroSignal,
} from './marketEventTypes';
import {
  MarketStateEngine,
  MarketStateSnapshot,
  RegimeObservation,
  MarketStateEngineConfig,
  deriveDeterministicSeed,
  calculateAuthoritativeMarketCap,
  calculateCrossSectionalDispersion,
  resolveBotEffectParams,
  resolveLpEffectParams,
  computeDirectionalArrivalProbabilities,
  RegimeEffectsMode,
  DEFAULT_REGIME_EFFECTS_MODE,
  isValidRegimeEffectsMode,
  RegimeModeChangeRecord,
  RegimeModeDiagnostics,
  ShadowDiagnosticsStepRecord,
  InvariantViolationRecord,
  InvariantViolationDTO,
  RegimeExperimentCapability,
  isValidRegimeExperimentCapability,
  sanitizeReason,
} from './regime';

import type {
  AppliedRegimeContext,
  RegimeEffectsContext,
  BotEffectParams,
  LpEffectParams,
} from './regime';

export class AgentManager {
  public clock: SimulationClock;
  public prng: SimPrng;
  public fundamentalPrng: SimPrng;
  public agentPrngs: Map<string, SimPrng> = new Map();

  public agents: Map<string, AgentAccount> = new Map();
  public fundamentals: Map<string, number> = new Map();
  public diagnostics: MarketDiagnostics = new MarketDiagnostics();
  public marketStateEngine: MarketStateEngine;

  // ── Single-Source Event & Attention State (3-Stage Lifecycle: registered -> published -> effective) ──
  public pendingEvents: MarketEvent[] = [];       // Registered events awaiting publishedAt
  public publishedEvents: MarketEvent[] = [];     // Officially published events (publishedAt <= simTime)
  public events: MarketEvent[] = [];              // Alias to publishedEvents for compatibility
  public publishedEventIds: Set<string> = new Set();
  public effectiveEventIds: Set<string> = new Set();
  public idempotencyTracker: EventIdempotencyTracker = new EventIdempotencyTracker();
  public attentionMap: Map<string, number> = new Map();     // stockId -> attentionScore [0, 1]
  public uncertaintyMap: Map<string, number> = new Map();   // stockId -> uncertaintyScore [0, 1]
  // LP 취소 실패/지연으로 인한 종목별 신규 호가 제출 보류 진단 기록
  public lpDeferrals: Map<string, { stockId: string; reason: string; unresolvedOrderIds: string[]; simTime: number }> = new Map();

  // MJD SDE parameters (per-second units)
  public readonly mjd_mu: number = 0.00005;     // Drift per second
  public readonly mjd_sigma: number = 0.0025;   // Volatility per sqrt(second)
  public readonly mjd_lambda: number = 0.005;   // Jump rate per second

  // Strategy Configurations
  public valueConfig: ValueStrategyConfig = {
    valueWeight: 1.0,
    exposureWeight: 0.4,
    noiseStdDev: 0.015,
    delaySteps: 2,
    deadbandPct: 0.01,
    minProfitMarginPct: 0.003,
    participationRate: 0.20,
    buyThreshold: 0.2,
    sellThreshold: -0.2,
  };

  public trendConfig: TrendStrategyConfig = {
    trendWeight: 1.0,
    exposureWeight: 0.3,
    lookbackSteps: 10,
    minWarmupSteps: 5,
    trendScale: 0.02,
    participationRate: 0.25,
    buyThreshold: 0.25,
    sellThreshold: -0.25,
  };

  public lpConfig: LpStrategyConfig = {
    targetInventory: 5000,
    inventoryLimit: 15000,
    numLevels: 5,
    baseSpreadBps: 20,
    volatilityAlpha: 1.5,
    inventoryRiskBeta: 0.8,
    inventorySkewKappa: 1.5,
    quoteLifetimeSteps: 5,
    baseLevelSize: 50,
  };

  public readonly enableRegimeEngine: boolean;
  private _regimeEffectsMode: RegimeEffectsMode = DEFAULT_REGIME_EFFECTS_MODE;
  private pendingEffectsMode: RegimeEffectsMode | null = null;
  private pendingReason: string | null = null;
  private modeChangeHistory: RegimeModeChangeRecord[] = [];
  public recentDeferralCount: number = 0;
  public invariantViolationCount: number = 0;
  private shadowDiagnosticsHistory: ShadowDiagnosticsStepRecord[] = [];
  private invariantViolations: InvariantViolationRecord[] = [];
  private reportedInvariantFingerprints: Map<string, number> = new Map();

  /** 현재 활성 중인 국면 효과 모드 ('OFF' | 'SHADOW' | 'EXPERIMENTAL_ON') */
  public get regimeEffectsMode(): RegimeEffectsMode {
    return this._regimeEffectsMode;
  }

  /**
   * 하위 호환성 getter: 실제 봇·LP에 효과 배수가 적용되는지 여부.
   * EXPERIMENTAL_ON일 때만 true이며, OFF 및 SHADOW 모드에서는 항상 false.
   */
  public get enableRegimeEffects(): boolean {
    return this._regimeEffectsMode === 'EXPERIMENTAL_ON';
  }

  // ── 실제 국면 관측 통계 추적 상태 ──
  private previousTotalTurnover: number | null = null;
  private previousTotalDepth: number | null = null;
  private emptyBookAccumulatedSeconds: number = 0;
  private emptyBookStockRatio: number = 0;
  private marketIndexReturns: number[] = [];
  public lastObservation: RegimeObservation | null = null;

  constructor(
    seed: number = 42,
    startEpochMs: number = 1773500000000,
    options?: {
      enableRegimeEngine?: boolean;
      /** 국면 효과 모드 ('OFF' | 'SHADOW' 허용. 'EXPERIMENTAL_ON'은 생성자 직접 활성화 금지). 기본값 'OFF'. */
      regimeEffectsMode?: RegimeEffectsMode;
      /** @deprecated 생성자 직접 활성화는 금지되며 무시됩니다. 기본값 'OFF'. */
      enableRegimeEffects?: boolean;
      regimeEngineConfig?: Partial<MarketStateEngineConfig>;
    }
  ) {
    this.enableRegimeEngine = options?.enableRegimeEngine ?? true;

    // 생성자 보안 정책: 'EXPERIMENTAL_ON' 직접 활성화는 엄격히 거절하고 기본값 'OFF' 강제
    if (options?.regimeEffectsMode === 'EXPERIMENTAL_ON') {
      console.warn(
        '[AgentManager] 보안 정책 적용: 생성자에서 EXPERIMENTAL_ON 직접 활성화는 금지됩니다. OFF 모드로 초기화됩니다. 승인된 Capability를 통해 setRegimeEffectsMode()를 사용하십시오.'
      );
      this._regimeEffectsMode = 'OFF';
    } else if (options?.regimeEffectsMode === 'SHADOW') {
      this._regimeEffectsMode = 'SHADOW';
    } else {
      this._regimeEffectsMode = DEFAULT_REGIME_EFFECTS_MODE;
    }

    if (
      options?.enableRegimeEffects === true ||
      options?.regimeEngineConfig?.regimeEffectsEnabled === true
    ) {
      console.warn(
        '[AgentManager] 하위호환 경고: enableRegimeEffects 직접 설정은 더 이상 지원되지 않습니다. OFF 모드로 안전하게 초기화됩니다.'
      );
    }

    this.clock = new SimulationClock(startEpochMs, 1.0);
    this.prng = new SimPrng(seed);
    this.fundamentalPrng = this.prng.split(100);
    // MarketStateEngine 내부에서 seed로부터 고유 namespace 파생을 1회 수행하도록 원본 seed 전달
    this.marketStateEngine = new MarketStateEngine(
      { ...(options?.regimeEngineConfig ?? {}), regimeEffectsEnabled: this.enableRegimeEffects },
      seed,
      startEpochMs
    );

    this.registerDefaultAgents();
    this.initFundamentals();
    this.initAttentionAndUncertainty();
  }

  /**
   * 안전한 국면 효과 모드 전환 메서드 (3단계).
   * - 인가 검증: EXPERIMENTAL_ON 전환 시 불투명 Capability 객체 검증 필수
   * - 무중단 안전 전환: 즉시 이전 상태의 주문·체결을 롤백하거나 취소하지 않고, 다음 스텝 경계에서 적용
   * - OFF, SHADOW 전환은 안전한 축소 전환이므로 사유 정규화 후 허용
   * - 유효하지 않은 모드 전달 시 명시적 거절
   */
  public setRegimeEffectsMode(
    mode: RegimeEffectsMode,
    options?: { capability?: RegimeExperimentCapability; reason?: string }
  ): { success: boolean; message: string } {
    if (!isValidRegimeEffectsMode(mode)) {
      return { success: false, message: `유효하지 않은 국면 효과 모드입니다: ${mode}` };
    }

    const sanitizedReason = sanitizeReason(options?.reason) || `Mode transition to ${mode}`;

    // 비인가 전환 차단: EXPERIMENTAL_ON 활성화 시 Capability 인가 검증
    if (mode === 'EXPERIMENTAL_ON') {
      if (!isValidRegimeExperimentCapability(options?.capability)) {
        return {
          success: false,
          message: '비인가 요청: EXPERIMENTAL_ON 모드 전환을 위한 유효한 승인 capability가 필요합니다.',
        };
      }
    }

    if (mode === this._regimeEffectsMode && this.pendingEffectsMode === null) {
      return { success: true, message: `이미 ${mode} 모드입니다.` };
    }

    // 즉시 주문/체결을 롤백하거나 강제 취소하지 않고, 다음 스텝 경계에서 안전하게 적용되도록 예약
    this.pendingEffectsMode = mode;
    this.pendingReason = sanitizedReason;
    return {
      success: true,
      message: `모드 전환 예약 완료: 다음 스텝 경계에서 ${this._regimeEffectsMode} -> ${mode} 적용 예정`,
    };
  }

  /**
   * 국면 모드 확인 및 진단 정보 DTO 반환
   * - 현재 모드 (OFF / SHADOW / EXPERIMENTAL_ON)
   * - 탐지된 국면 vs 실제 적용된 국면 (SHADOW 모드에서는 탐지된 국면과 실제 적용된 국면이 분리됨)
   * - 최근 적용된 배수 목록
   * - 최근 호가 보류(deferral) 횟수
   * - 불변식 위반 횟수 (정상 상태: 0)
   * - 섀도우 진단 최신 레코드
   * - 불변식 위반 최근 DTO (민감정보 마스킹)
   */
  public getRegimeModeDiagnostics(): RegimeModeDiagnostics {
    const activeRegimeState = this.enableRegimeEngine ? this.marketStateEngine.getAppliedContext() : null;
    const isApplied = this._regimeEffectsMode === 'EXPERIMENTAL_ON' && activeRegimeState !== null;
    return {
      currentMode: this._regimeEffectsMode,
      pendingMode: this.pendingEffectsMode,
      detectedRegime: activeRegimeState?.regime ?? 'SIDEWAYS',
      appliedRegime: isApplied ? (activeRegimeState?.regime ?? null) : null,
      appliedMultipliers: isApplied ? (this.diagnostics.getLastRegimeApplication()?.multipliers ?? {}) : {},
      recentDeferrals: this.recentDeferralCount,
      invariantViolationCount: this.invariantViolationCount,
      modeChangeHistory: [...this.modeChangeHistory],
      shadowDiagnostics:
        this.shadowDiagnosticsHistory.length > 0
          ? this.shadowDiagnosticsHistory[this.shadowDiagnosticsHistory.length - 1]
          : null,
      violations: this.invariantViolations.slice(-20).map((v) => ({
        code: v.code,
        simulationTime: v.simulationTime,
        entityType: v.entityType,
        redactedEntityId:
          v.entityId.length > 8 ? `${v.entityId.slice(0, 4)}...${v.entityId.slice(-4)}` : v.entityId,
      })),
    };
  }

  public getShadowDiagnosticsHistory(limit: number = 50): readonly ShadowDiagnosticsStepRecord[] {
    return this.shadowDiagnosticsHistory.slice(-limit);
  }


  public registerDefaultAgents(): void {
    // 1. LP Agent
    this.registerAgent({
      accountId: 'acc_lp_main',
      agentId: 'agent_lp_01',
      participantType: 'lp',
      strategyType: 'market_maker',
      name: '유동성공급자(LP)',
      targetPositions: {},
      maxOrderSize: 500,
      maxPosition: 30000,
      riskTolerance: 0.5,
      urgency: 0.1,
      activityRate: 1.0, // Quotes checked every step
      infoLatency: 0,    // LP observes order book directly in real time
      evaluationsPerStep: 20,
      sectorPreferences: {},
      nextDecisionTime: 0,
      stats: { ordersSubmitted: 0, ordersCancelled: 0, fillsCount: 0, volumeTraded: 0, feesPaid: 0, realizedPnl: 0 },
    });

    // 2. Value Investors
    this.registerAgent({
      accountId: 'acc_bot_val_01',
      agentId: 'agent_val_01',
      participantType: 'bot',
      strategyType: 'value',
      name: '가치투자 봇 1호',
      targetPositions: {},
      maxOrderSize: 200,
      maxPosition: 10000,
      riskTolerance: 0.6,
      urgency: 0.4,
      activityRate: 0.8,
      infoLatency: 2.0,  // 2.0 seconds information latency
      evaluationsPerStep: 4,
      sectorPreferences: { semiconductor: 1.4, it: 1.1 },
      nextDecisionTime: 0,
      stats: { ordersSubmitted: 0, ordersCancelled: 0, fillsCount: 0, volumeTraded: 0, feesPaid: 0, realizedPnl: 0 },
    });

    this.registerAgent({
      accountId: 'acc_bot_val_02',
      agentId: 'agent_val_02',
      participantType: 'bot',
      strategyType: 'value',
      name: '가치투자 봇 2호',
      targetPositions: {},
      maxOrderSize: 150,
      maxPosition: 8000,
      riskTolerance: 0.4,
      urgency: 0.35,
      activityRate: 0.7,
      infoLatency: 4.0,  // 4.0 seconds latency (slower observer)
      evaluationsPerStep: 4,
      sectorPreferences: { finance: 1.4, auto: 1.2 },
      nextDecisionTime: 0,
      stats: { ordersSubmitted: 0, ordersCancelled: 0, fillsCount: 0, volumeTraded: 0, feesPaid: 0, realizedPnl: 0 },
    });

    // 3. Trend Followers
    this.registerAgent({
      accountId: 'acc_bot_trend_01',
      agentId: 'agent_trend_01',
      participantType: 'bot',
      strategyType: 'trend',
      name: '모멘텀 봇 1호',
      targetPositions: {},
      maxOrderSize: 250,
      maxPosition: 10000,
      riskTolerance: 0.7,
      urgency: 0.7, // High urgency -> IOC orders
      activityRate: 0.8,
      infoLatency: 1.0,
      evaluationsPerStep: 4,
      sectorPreferences: { semiconductor: 1.2, it: 1.2, auto: 1.0 },
      nextDecisionTime: 0,
      stats: { ordersSubmitted: 0, ordersCancelled: 0, fillsCount: 0, volumeTraded: 0, feesPaid: 0, realizedPnl: 0 },
    });

    this.registerAgent({
      accountId: 'acc_bot_trend_02',
      agentId: 'agent_trend_02',
      participantType: 'bot',
      strategyType: 'trend',
      name: '모멘텀 봇 2호',
      targetPositions: {},
      maxOrderSize: 150,
      maxPosition: 6000,
      riskTolerance: 0.5,
      urgency: 0.5,
      activityRate: 0.7,
      infoLatency: 2.0,
      evaluationsPerStep: 4,
      sectorPreferences: { energy: 1.3, bio: 1.2, finance: 1.2 },
      nextDecisionTime: 0,
      stats: { ordersSubmitted: 0, ordersCancelled: 0, fillsCount: 0, volumeTraded: 0, feesPaid: 0, realizedPnl: 0 },
    });
  }

  public registerAgent(account: AgentAccount): void {
    this.agents.set(account.accountId, account);
    const subPrng = this.prng.split(this.agents.size * 50);
    this.agentPrngs.set(account.accountId, subPrng);
  }

  public initFundamentals(): void {
    for (const stock of memoryDb.stocks.values()) {
      if (!this.fundamentals.has(stock.id)) {
        this.fundamentals.set(stock.id, stock.current_price);
      }
    }
  }

  public initAttentionAndUncertainty(): void {
    for (const stock of memoryDb.stocks.values()) {
      const baseLiq = stock.base_liquidity ?? 0.5;
      this.attentionMap.set(stock.id, baseLiq);
      this.uncertaintyMap.set(stock.id, 0.05);
    }
  }

  /**
   * Registers a structured market event into the internal pending queue (Status: 'registered').
   * Guarantees idempotency and strictly prevents lookahead leaks:
   * Future events are kept in the pending queue and are NOT visible in public news DB,
   * dashboard feeds, or agent observations until their publishedAt simulation timestamp is reached.
   */
  public registerEvent(event: MarketEvent): boolean {
    if (validateMarketEvent(event)) return false;
    if (!this.idempotencyTracker.record(event.eventId)) {
      return false; // Duplicate event rejected
    }

    const resolvedTargetStockIds =
      event.targetStockIds && event.targetStockIds.length > 0
        ? [...event.targetStockIds]
        : resolveTargetStockIds(event.scope, undefined, event.sectorId);

    const storedEvent: MarketEvent = {
      ...event,
      targetStockIds: resolvedTargetStockIds,
      themeIds: event.themeIds ? [...event.themeIds] : undefined,
      sequence: event.sequence ?? this.clock.nextSequence(),
    };

    // Future corrections are strictly kept in pendingEvents without mutating the original rumor.
    // The original event's correctedAt is ONLY recorded when publishedAt is reached in processDuePublications.
    this.pendingEvents.push(storedEvent);
    this.pendingEvents.sort((a, b) =>
      a.publishedAt - b.publishedAt || a.effectiveFrom - b.effectiveFrom || (a.sequence ?? 0) - (b.sequence ?? 0)
    );

    // If publishedAt <= current simulation time, transition to published immediately
    if (storedEvent.publishedAt <= this.clock.simulationTime) {
      this.processDuePublications(this.clock.simulationTime);
    }

    // If effectiveFrom <= current simulation time, apply due effects immediately
    // For future events (effectiveFrom > simTime), effects are strictly deferred to serialized simulation steps
    if (storedEvent.effectiveFrom <= this.clock.simulationTime) {
      this.processDueEffects(this.clock.simulationTime);
    }

    return true;
  }

  /**
   * Backward-compatible alias for registerEvent.
   */
  public publishEvent(event: MarketEvent): boolean {
    return this.registerEvent(event);
  }

  /**
   * Processes due publications (Status: 'registered' -> 'published'):
   * Moves events where publishedAt <= simTime into publishedEvents,
   * adds them to memoryDb.marketNews exactly once, and records NEWS_PUBLISHED.
   */
  public processDuePublications(simTime: number): void {
    const dueEvents: MarketEvent[] = [];
    const remainingPending: MarketEvent[] = [];

    for (const event of this.pendingEvents) {
      if (event.publishedAt <= simTime) {
        dueEvents.push(event);
      } else {
        remainingPending.push(event);
      }
    }
    this.pendingEvents = remainingPending;

    dueEvents.sort((a, b) =>
      a.publishedAt - b.publishedAt || a.effectiveFrom - b.effectiveFrom || (a.sequence ?? 0) - (b.sequence ?? 0)
    );

    for (const event of dueEvents) {
      if (this.publishedEventIds.has(event.eventId)) continue;
      this.publishedEventIds.add(event.eventId);
      this.publishedEvents.push(event);

      // If this is a CORRECTION, tag the published original rumor with correctedAt time
      // strictly now that this correction has reached publishedAt.
      if (event.eventType === 'CORRECTION' && event.originalEventId) {
        const orig = this.publishedEvents.find((e) => e.eventId === event.originalEventId);
        if (orig) {
          orig.correctedAt = event.publishedAt;
        }
      }

      // Synchronize to memoryDb.marketNews for UI display (created_at and simulation_time use publishedAt)
      const newsRecord: MarketNewsRecord = {
        id: event.eventId,
        type: event.scope.toUpperCase(),
        category: event.eventType,
        publisher: event.publisher,
        title: event.title,
        content: event.content,
        target_sector: event.sectorId || null,
        target_ticker:
          event.targetStockIds.length === 1
            ? memoryDb.stocks.get(event.targetStockIds[0])?.ticker || null
            : null,
        impact_score: parseFloat((event.valuationSignal * 10).toFixed(1)),
        created_at: new Date(event.publishedAt).toISOString(),
        simulation_time: event.publishedAt,
        sequence: event.sequence,
      };
      const existingNewsIndex = memoryDb.marketNews.findIndex((news) => news.id === newsRecord.id);
      if (existingNewsIndex >= 0) memoryDb.marketNews.splice(existingNewsIndex, 1);
      memoryDb.marketNews.unshift(newsRecord);
      if (memoryDb.marketNews.length > 200) {
        memoryDb.marketNews.pop();
      }

      // Record causal trace for official publication
      this.diagnostics.recordCausalTrace({
        timestamp: event.publishedAt,
        eventId: event.eventId,
        eventType: event.eventType,
        stage: 'NEWS_PUBLISHED',
        details: `[${event.eventType}] ${event.title} published (ValSignal: ${event.valuationSignal}, AttShock: ${event.attentionShock})`,
        isCausalConnected: true,
      });
    }

    this.publishedEvents.sort((a, b) =>
      a.publishedAt - b.publishedAt || a.effectiveFrom - b.effectiveFrom || (a.sequence ?? 0) - (b.sequence ?? 0)
    );
    this.events = this.publishedEvents;
  }

  /**
   * Processes due economic effects (Status: 'published' -> 'effective'):
   * Applies attention & uncertainty shocks exactly once when effectiveFrom <= simTime.
   */
  public processDueEffects(simTime: number): void {
    const dueEffects = this.publishedEvents.filter(
      (e) => !this.effectiveEventIds.has(e.eventId) && e.effectiveFrom <= simTime
    );
    dueEffects.sort((a, b) =>
      a.effectiveFrom - b.effectiveFrom || (a.sequence ?? 0) - (b.sequence ?? 0)
    );

    for (const event of dueEffects) {
      if (this.effectiveEventIds.has(event.eventId)) continue;
      this.effectiveEventIds.add(event.eventId);

      for (const stockId of event.targetStockIds) {
        const currentAttention = this.attentionMap.get(stockId) ?? 0.5;
        const currentUncertainty = this.uncertaintyMap.get(stockId) ?? 0.05;
        this.attentionMap.set(stockId, Math.min(1, currentAttention + event.attentionShock));
        this.uncertaintyMap.set(stockId, Math.min(1, currentUncertainty + event.uncertaintyShock));
      }
    }
  }

  /**
   * Advances the simulation by dt seconds and executes the full agent lifecycle:
   * 1. Advance simulation clock
   * 2. Process due publications (registered -> published)
   * 3. Process due economic effects (published -> effective)
   * 4. Merton Jump-Diffusion SDE update with dt scaling
   * 5. Decay attention & uncertainty over simulation time
   * 6. Rolling window statistics
   * 7. Two-phase LP quoting (Cancels first, then budget-safe new orders)
   * 8. Bot decision making via weighted candidate sampling & latency buffer
   * 9. Post-execution single leaderboard update and dashboard snapshot
   */
  public async step(dt: number = 1.0): Promise<void> {
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new RangeError(`[AgentManager] dt must be positive finite: ${dt}`);
    }
    const t0 = this.clock.simulationTime;
    const currentStepId = this.clock.simulationStep;

    // 0. 스텝 경계: 대기 중인 국면 효과 모드 전환이 있으면 원자적으로 적용
    // 0. 스텝 경계: 대기 중인 국면 효과 모드 전환이 있으면 원자적으로 적용
    if (this.pendingEffectsMode !== null) {
      const fromMode = this._regimeEffectsMode;
      const toMode = this.pendingEffectsMode;
      const reason = this.pendingReason || `Mode transition applied at step boundary ${currentStepId}`;
      this._regimeEffectsMode = toMode;
      this.pendingEffectsMode = null;
      this.pendingReason = null;
      this.modeChangeHistory.push({
        timestamp: t0,
        fromMode,
        toMode,
        appliedAtStepId: currentStepId,
        reason,
      });
      if (this.modeChangeHistory.length > 100) {
        this.modeChangeHistory = this.modeChangeHistory.slice(-100);
      }
    }

    // 1. t0 시점에 적용 예정인 pending 국면 활성화
    if (this.enableRegimeEngine) {
      this.marketStateEngine.activatePendingRegime(t0, currentStepId);
    }

    // 1-b. 이번 스텝에 적용할 국면·전환 ID·파라미터를 불변 컨텍스트로 1회 고정한다.
    //      같은 스텝의 모든 봇과 LP가 동일 컨텍스트를 사용하며, 스텝 종료 시 예약된 새 국면은 다음 스텝부터 적용된다.
    //      getAppliedContext()는 아직 게시 전이라도 방금 활성화된 국면을 반영하므로 적용이 한 스텝 늦어지지 않는다.
    const activeRegimeState = this.enableRegimeEngine ? this.marketStateEngine.getAppliedContext() : null;
    const effectsActive = this._regimeEffectsMode === 'EXPERIMENTAL_ON' && activeRegimeState !== null;
    const regimeContext: RegimeEffectsContext =
      effectsActive && activeRegimeState
        ? Object.freeze({
            enabled: true as const,
            regime: activeRegimeState.regime,
            transitionId: activeRegimeState.transitionId,
            parameters: activeRegimeState.parameters,
          })
        : null;
    // 순수 변환: 매 스텝 원본 설정과 활성 국면으로부터 유효 파라미터를 새로 계산 (누적 곱셈 없음, 원본 불변)
    const botEffectParams: BotEffectParams = resolveBotEffectParams(regimeContext);
    const lpEffectParams: LpEffectParams = resolveLpEffectParams(regimeContext);
    const appliedMultipliers: Record<string, number> = regimeContext
      ? {
          bot_buyArrival: botEffectParams.buyArrivalMultiplier,
          bot_sellArrival: botEffectParams.sellArrivalMultiplier,
          bot_orderSize: botEffectParams.orderSizeMultiplier,
          bot_riskTolerance: botEffectParams.riskToleranceMultiplier,
          bot_trendSensitivity: botEffectParams.trendSensitivity,
          bot_valueSensitivity: botEffectParams.valueSensitivity,
          bot_uncertainty: botEffectParams.uncertaintyMultiplier,
          bot_newsHalfLife: botEffectParams.newsHalfLifeMultiplier,
          bot_cashPreference: botEffectParams.cashPreference,
          lp_spread: lpEffectParams.lpSpreadMultiplier,
          lp_depth: lpEffectParams.lpDepthMultiplier,
          lp_uncertainty: lpEffectParams.uncertaintyMultiplier,
        }
      : {};

    // SHADOW 모드 가상 효과 컨텍스트 준비 (실제 장부/PRNG에는 1비트도 적용하지 않음)
    const isShadow = this._regimeEffectsMode === 'SHADOW';
    const virtualRegimeContext: RegimeEffectsContext =
      isShadow && activeRegimeState
        ? Object.freeze({
            enabled: true as const,
            regime: activeRegimeState.regime,
            transitionId: activeRegimeState.transitionId,
            parameters: activeRegimeState.parameters,
          })
        : null;
    const virtualBotEffectParams: BotEffectParams = resolveBotEffectParams(virtualRegimeContext);
    const virtualLpEffectParams: LpEffectParams = resolveLpEffectParams(virtualRegimeContext);
    const virtualMultipliers: Record<string, number> = virtualRegimeContext
      ? {
          bot_buyArrival: virtualBotEffectParams.buyArrivalMultiplier,
          bot_sellArrival: virtualBotEffectParams.sellArrivalMultiplier,
          bot_orderSize: virtualBotEffectParams.orderSizeMultiplier,
          bot_riskTolerance: virtualBotEffectParams.riskToleranceMultiplier,
          bot_trendSensitivity: virtualBotEffectParams.trendSensitivity,
          bot_valueSensitivity: virtualBotEffectParams.valueSensitivity,
          bot_uncertainty: virtualBotEffectParams.uncertaintyMultiplier,
          bot_newsHalfLife: virtualBotEffectParams.newsHalfLifeMultiplier,
          bot_cashPreference: virtualBotEffectParams.cashPreference,
          lp_spread: virtualLpEffectParams.lpSpreadMultiplier,
          lp_depth: virtualLpEffectParams.lpDepthMultiplier,
          lp_uncertainty: virtualLpEffectParams.uncertaintyMultiplier,
        }
      : {};

    // 섀도우 진단 통계 수집 변수
    let actualIntentsCount = 0;
    let virtualIntentsCount = 0;
    let actualBuyCount = 0;
    let actualSellCount = 0;
    let actualHoldCount = 0;
    let virtualBuyCount = 0;
    let virtualSellCount = 0;
    let virtualHoldCount = 0;
    let actualOrderVolumeSum = 0;
    let virtualOrderVolumeSum = 0;
    let actualLpSpreadSum = 0;
    let actualLpDepthSum = 0;
    let virtualLpSpreadSum = 0;
    let virtualLpDepthSum = 0;
    let lpEvaluatedStockCount = 0;
    let directionChangedCount = 0;
    let sizeChangedCount = 0;
    let expectedDeferrals = 0;


    // 2. 시계를 t1 = t0 + dt로 전진
    const { time: simTime, step: nextStepId } = this.clock.advance(dt);

    this.processDuePublications(simTime);
    this.processDueEffects(simTime);

    // 관측/추적: 이번 스텝에 적용된 국면 컨텍스트 진단 기록 (효과 ON/OFF 및 주요 배수 포함)
    if (this.enableRegimeEngine && activeRegimeState) {
      this.diagnostics.recordRegimeApplication({
        simulationTime: simTime,
        stepId: currentStepId,
        regime: activeRegimeState.regime,
        transitionId: activeRegimeState.transitionId,
        effectsEnabled: effectsActive,
        multipliers: appliedMultipliers,
      });
    }

    // ── 1. MJD Latent Fundamental SDE Update ──
    for (const stock of memoryDb.stocks.values()) {
      const f = this.fundamentals.get(stock.id) || stock.current_price;
      const dW = Math.sqrt(dt) * this.fundamentalPrng.nextGaussian();

      let jump = 0;
      const jumpProb = 1 - Math.exp(-this.mjd_lambda * dt);
      if (this.fundamentalPrng.next() < jumpProb) {
        jump = this.fundamentalPrng.nextNormal(0, 0.03); // ~3% standard jump
      }

      const dF = f * (this.mjd_mu * dt + this.mjd_sigma * dW + jump);
      const newF = Math.max(10, f + dF);
      this.fundamentals.set(stock.id, newF);
    }

    // ── 2. Attention & Uncertainty Exponential Decay ──
    for (const stock of memoryDb.stocks.values()) {
      const curAtt = this.attentionMap.get(stock.id) ?? 0.5;
      const baseLiq = stock.base_liquidity ?? 0.5;
      // Decay towards baseline liquidity (half-life ~20s)
      const decayedAtt = baseLiq + (curAtt - baseLiq) * Math.exp(-0.035 * dt);
      this.attentionMap.set(stock.id, Math.max(0.1, Math.min(1.0, decayedAtt)));

      const curUnc = this.uncertaintyMap.get(stock.id) ?? 0.05;
      // Uncertainty decays towards minimal 0.05 (half-life ~15s)
      const decayedUnc = 0.05 + (curUnc - 0.05) * Math.exp(-0.05 * dt);
      this.uncertaintyMap.set(stock.id, Math.max(0.01, Math.min(1.0, decayedUnc)));
    }

    // ── 3. Rolling Window Statistics (Read-Only during decision phase) ──
    const windowStatsMap = this.diagnostics.computeWindowStatistics(simTime, 10, 50);

    // ── 4. Two-Phase LP (Market Maker) Quoting Lifecycle ──
    const lpAgent = this.agents.get('acc_lp_main');
    if (lpAgent) {
      for (const stock of memoryDb.stocks.values()) {
        const obs = buildMarketObservation(
          stock.id,
          lpAgent.accountId,
          simTime,
          20,
          this.attentionMap,
          this.uncertaintyMap,
          this.events,
          windowStatsMap.get(stock.id)
        );
        if (!obs) continue;

        this.diagnostics.recordMarketQuality(stock.id, obs.spread, obs.hasTwoSidedBook);

        if (effectsActive) {
          const failedCancelOrderIds = new Set<string>();

          // 1. 취소 대상 계산 (Phase 1)
          const initialPlan = evaluateLpStrategy(obs, lpAgent, this.lpConfig, lpEffectParams);
          if (initialPlan.cancels.length > 0) {
            // 2. 실제 취소 결과 확인: cancelLpOrders 내부에서 성공 건만 반영하며, 취소 실패 주문의 예약 자산은 유지된다.
            const cancelRes1 = await this.cancelLpOrders(lpAgent, initialPlan.cancels);
            for (const fid of cancelRes1.failedOrderIds) {
              failedCancelOrderIds.add(fid);
            }
          }

          // 3. 최신 계좌·주문 관측 재조회 (Phase 2):
          //    취소 성공분만 가용 자산으로 회복되고, 실패분은 여전히 예약 자산으로 차감되어 안전하게 보존됨
          const freshObs = buildMarketObservation(
            stock.id,
            lpAgent.accountId,
            simTime,
            20,
            this.attentionMap,
            this.uncertaintyMap,
            this.events,
            windowStatsMap.get(stock.id)
          );
          if (!freshObs) {
            this.lpDeferrals.set(stock.id, {
              stockId: stock.id,
              reason: 'fresh_observation_failed',
              unresolvedOrderIds: Array.from(failedCancelOrderIds),
              simTime,
            });
            console.warn(`[LP Deferral] Stock ${stock.id}: Failed to refetch fresh market observation in Phase 2. Deferring new LP quotes.`);
            continue;
          }

          // 4. 최종 신규 주문 수량 계산
          let currentPlan = evaluateLpStrategy(freshObs, lpAgent, this.lpConfig, lpEffectParams);

          // 재계산 후 추가 취소가 남아있거나 이전 실패 건 중 여전히 활성인 주문이 있으면 1회 한정 재시도 (무한 루프 방지)
          const retryCancelsMap = new Map<string, OrderRecord>();
          for (const c of currentPlan.cancels) {
            retryCancelsMap.set(c.id, c);
          }
          for (const fid of failedCancelOrderIds) {
            const ord = memoryDb.orders.get(fid);
            if (ord && (ord.status === 'open' || ord.status === 'partial') && (ord.size - (ord.filled || 0)) > 0) {
              retryCancelsMap.set(fid, ord);
            }
          }

          if (retryCancelsMap.size > 0) {
            const cancelRes2 = await this.cancelLpOrders(lpAgent, Array.from(retryCancelsMap.values()));
            for (const cid of cancelRes2.cancelledOrderIds) {
              failedCancelOrderIds.delete(cid);
            }
            for (const fid of cancelRes2.failedOrderIds) {
              failedCancelOrderIds.add(fid);
            }

            const finalObs = buildMarketObservation(
              stock.id,
              lpAgent.accountId,
              simTime,
              20,
              this.attentionMap,
              this.uncertaintyMap,
              this.events,
              windowStatsMap.get(stock.id)
            );
            if (!finalObs) {
              this.lpDeferrals.set(stock.id, {
                stockId: stock.id,
                reason: 'final_observation_failed',
                unresolvedOrderIds: Array.from(failedCancelOrderIds),
                simTime,
              });
              console.warn(`[LP Deferral] Stock ${stock.id}: Failed to refetch final market observation. Deferring new LP quotes.`);
              continue;
            }
            currentPlan = evaluateLpStrategy(finalObs, lpAgent, this.lpConfig, lpEffectParams);
          }

          // 미해결 취소 대상 주문 ID 전체 집합 수집
          const allTargetCancelIds = new Set<string>(failedCancelOrderIds);
          for (const c of currentPlan.cancels) {
            allTargetCancelIds.add(c.id);
          }

          // 최신 실제 메모리 DB 장부에서 해당 미해결 주문의 실제 상태 및 잔여 수량 재확인
          const activeUnresolvedCancels: OrderRecord[] = [];
          for (const cancelId of allTargetCancelIds) {
            const actualOrder = memoryDb.orders.get(cancelId);
            if (
              actualOrder &&
              actualOrder.user_id === lpAgent.accountId &&
              actualOrder.stock_id === stock.id &&
              (actualOrder.status === 'open' || actualOrder.status === 'partial')
            ) {
              const rem = actualOrder.size - (actualOrder.filled || 0);
              if (rem > 0) {
                activeUnresolvedCancels.push(actualOrder);
              }
            }
          }

          // 보수적 안전 정책: 취소 대상 주문 중 단 하나라도 미해결 활성 상태로 남아있으면,
          // 동일 가격/다른 가격 불문하고 해당 종목의 신규 호가 제출을 이번 스텝에서 전면 보류하고 다음 스텝으로 이월!
          if (activeUnresolvedCancels.length > 0) {
            this.recentDeferralCount++;
            this.lpDeferrals.set(stock.id, {
              stockId: stock.id,
              reason: 'unresolved_active_cancel_orders',
              unresolvedOrderIds: activeUnresolvedCancels.map((o) => o.id),
              simTime,
            });
            console.warn(
              `[LP Deferral] Stock ${stock.id} (${stock.ticker}): ${activeUnresolvedCancels.length} unresolved cancel order(s) remain active ([${activeUnresolvedCancels.map((o) => `${o.id}:${o.side}@${o.price}`).join(', ')}]). Deferring all new LP quote submissions for this stock until next step.`
            );
            continue;
          }

          // 모든 취소 대상이 정상 해소되었으므로 이전 보류 기록 해제
          this.lpDeferrals.delete(stock.id);

          // 5. 기존 주문 서비스로 제출
          await this.submitLpOrders(lpAgent, stock.id, currentPlan.newOrders, simTime);
        } else {
          // 기존 실행 경로 (효과 OFF): 단일 장부 기준 계획으로 취소 후 제출 (동작 보존)
          const plan = evaluateLpStrategy(obs, lpAgent, this.lpConfig);
          if (isShadow) {
            lpEvaluatedStockCount++;
            actualLpDepthSum += plan.newOrders.reduce((sum, o) => sum + o.size, 0);
            const buys = plan.newOrders.filter((o) => o.side === 'buy');
            const sells = plan.newOrders.filter((o) => o.side === 'sell');
            if (buys.length > 0 && sells.length > 0) {
              actualLpSpreadSum += Math.max(0, sells[0].price - buys[0].price);
            }

            // 가상 LP 주문 산출 (PRNG 소비 없음, 장부 미반영)
            const virtualPlan = evaluateLpStrategy(obs, lpAgent, this.lpConfig, virtualLpEffectParams);
            virtualLpDepthSum += virtualPlan.newOrders.reduce((sum, o) => sum + o.size, 0);
            const vBuys = virtualPlan.newOrders.filter((o) => o.side === 'buy');
            const vSells = virtualPlan.newOrders.filter((o) => o.side === 'sell');
            if (vBuys.length > 0 && vSells.length > 0) {
              virtualLpSpreadSum += Math.max(0, vSells[0].price - vBuys[0].price);
            }
          }
          await this.cancelLpOrders(lpAgent, plan.cancels);
          await this.submitLpOrders(lpAgent, stock.id, plan.newOrders, simTime);
        }

      }
    }

    // ── 5. Bot Trading Strategy Lifecycle (Weighted Selection & Latency) ──
    const stockList = Array.from(memoryDb.stocks.values());

    for (const [accountId, agent] of this.agents.entries()) {
      if (agent.participantType === 'lp') continue;

      const agentPrng = this.agentPrngs.get(accountId) || this.prng;

      // SHADOW 모드: 실제 실행 전 PRNG 상태를 스냅샷하여 격리된 가상 시뮬레이션에 제공
      const preAgentPrngState = isShadow ? agentPrng.getState() : 0;
      const actualDecisionsByStock = new Map<string, { action: 'buy' | 'sell' | 'hold'; size: number }>();

      // 활동 게이트 (스텝당 정확히 1회 난수 소비 — 효과 OFF와 PRNG 소비 순서 동일)
      let activityRoll = 0;
      let pBuy = 1;
      let pSell = 1;
      let actualArrived = false;
      if (effectsActive) {
        // 국면 방향별 발생 확률: pCandidate = max(pBuy, pSell)로 활동을 판단하고,
        // 전략이 선택한 방향에 따라 pBuy/pSell로 제출을 필터링한다 (기존 확률로 먼저 탈락시키지 않음).
        const probs = computeDirectionalArrivalProbabilities(
          agent.activityRate,
          botEffectParams.buyArrivalMultiplier,
          botEffectParams.sellArrivalMultiplier,
          dt
        );
        pBuy = probs.pBuy;
        pSell = probs.pSell;
        activityRoll = agentPrng.next();
        if (activityRoll >= probs.pCandidate) {
          continue;
        }
        actualArrived = true;
      } else {
        // 기존 실행 경로 (효과 OFF 및 SHADOW): 단일 Poisson 도착 확률
        const arrivalProb = 1 - Math.exp(-agent.activityRate * dt);
        if (agentPrng.next() >= arrivalProb) {
          if (isShadow) {
            actualHoldCount++;
          }
          if (!isShadow) {
            continue;
          }
        } else {
          actualArrived = true;
        }
      }

      if (actualArrived) {
        // Filter events visible to this agent based on information latency
        // Internal truth (isRumorFake) is strictly redacted from bot observations
        const visibleEvents = getVisibleMarketEvents(this.events, simTime, agent.infoLatency ?? 0);

        // Select candidate stocks to evaluate (eliminates fixed-order full evaluation)
        const candidateStocks = this.selectCandidateStocks(agent, stockList, agentPrng);

        for (const stock of candidateStocks) {
          const obs = buildMarketObservation(
            stock.id,
            accountId,
            simTime,
            20,
            this.attentionMap,
            this.uncertaintyMap,
            visibleEvents,
            windowStatsMap.get(stock.id)
          );
          if (!obs) continue;

          let intent: AgentOrderIntent = { action: 'hold', stockId: stock.id };

          if (agent.strategyType === 'value') {
            const trueF = this.fundamentals.get(stock.id) || stock.current_price;
            intent = evaluateValueStrategy(
              obs,
              agent,
              this.valueConfig,
              trueF,
              agentPrng,
              effectsActive ? botEffectParams : undefined
            );
          } else if (agent.strategyType === 'trend') {
            intent = evaluateTrendStrategy(obs, agent, this.trendConfig, effectsActive ? botEffectParams : undefined);
          }

          if (isShadow) {
            const actAction = intent.action === 'buy' || intent.action === 'sell' ? intent.action : 'hold';
            actualDecisionsByStock.set(stock.id, { action: actAction, size: intent.size || 0 });
            if (actAction === 'buy') {
              actualBuyCount++;
              actualIntentsCount++;
              actualOrderVolumeSum += intent.size || 0;
            } else if (actAction === 'sell') {
              actualSellCount++;
              actualIntentsCount++;
              actualOrderVolumeSum += intent.size || 0;
            } else {
              actualHoldCount++;
            }
          }

          if (intent.action === 'hold') {
            continue;
          }

          if (intent.action === 'cancel' && intent.cancelOrderId) {
            await LocalMarketService.cancelOrder({
              orderId: intent.cancelOrderId,
              userId: accountId,
            });
            this.diagnostics.recordOrderCancel(agent.strategyType);
            agent.stats.ordersCancelled++;
            continue;
          }

          if (intent.action === 'buy' || intent.action === 'sell') {
            if (!intent.price || !intent.size || intent.size <= 0) continue;

            // 방향별 발생 확률 필터: 전략 방향을 강제로 뒤집지 않고 제출 여부만 제한한다.
            // 취소·필수 위험 관리 처리는 위에서 이미 처리되어 이 필터의 영향을 받지 않는다.
            if (effectsActive) {
              const directionalGate = intent.action === 'buy' ? pBuy : pSell;
              if (activityRoll >= directionalGate) {
                continue;
              }
            }

            const seq = this.clock.nextSequence();
            const decisionId = `decision_${agent.agentId}_${simTime}_${seq}`;
            const matchRes = await LocalMarketService.submitOrder({
              userId: accountId,
              stockId: stock.id,
              side: intent.action,
              price: intent.price,
              size: intent.size,
              isLp: false,
              orderType: intent.orderType || 'limit',
              simulationTime: simTime,
              createdAt: new Date(simTime).toISOString(),
              sequence: seq,
              participantType: 'bot',
              accountId: accountId,
              agentId: agent.agentId,
            });

            this.diagnostics.recordOrderSubmit(agent.strategyType);
            agent.stats.ordersSubmitted++;

            const causalEventIds = visibleEvents
              .filter((event) => event.targetStockIds.includes(stock.id) && event.effectiveFrom <= simTime)
              .map((event) => event.eventId);

            this.diagnostics.recordCausalTrace({
              timestamp: simTime,
              stockId: stock.id,
              agentId: agent.agentId,
              decisionId,
              orderId: matchRes.orderId,
              eventIds: causalEventIds,
              stage: 'ORDER_SUBMIT',
              details: `[${agent.strategyType}] ${intent.action.toUpperCase()} ${intent.size}sh @ ${intent.price} (reason: ${intent.reason})`,
              isCausalConnected: true,
              regime: activeRegimeState?.regime,
              regimeTransitionId: activeRegimeState?.transitionId,
              regimeEffectsEnabled: effectsActive,
              appliedMultipliers: regimeContext ? appliedMultipliers : undefined,
            });

            if (matchRes.success) {
              if (matchRes.filledQty > 0) {
                const fills = matchRes.fills || [{
                  tradeId: '',
                  price: matchRes.avgPrice ?? matchRes.execPrice ?? intent.price,
                  size: matchRes.filledQty,
                  makerOrderId: '',
                  takerOrderId: matchRes.orderId || '',
                }];
                const allTradeIds = fills.map((f) => f.tradeId).filter(Boolean);

                for (const fill of fills) {
                  // The incoming order is the taker for every actual match;
                  // IOC is not a reliable proxy for maker/taker role.
                  this.diagnostics.recordOrderFill(agent.strategyType, fill.size, false);
                  agent.stats.fillsCount++;
                  agent.stats.volumeTraded += fill.size;

                  const makerOrder = fill.makerOrderId ? memoryDb.orders.get(fill.makerOrderId) : undefined;
                  const makerAgent = makerOrder?.account_id ? this.agents.get(makerOrder.account_id) : undefined;
                  if (makerAgent) {
                    const makerStrategy = makerAgent.strategyType;
                    this.diagnostics.recordOrderFill(makerStrategy, fill.size, true);
                    makerAgent.stats.fillsCount++;
                    makerAgent.stats.volumeTraded += fill.size;
                  }
                }

                for (const fill of fills) {
                  this.diagnostics.recordCausalTrace({
                    timestamp: simTime,
                    stockId: stock.id,
                    agentId: agent.agentId,
                    decisionId,
                    orderId: matchRes.orderId,
                    tradeId: fill.tradeId,
                    tradeIds: allTradeIds,
                    stage: 'ORDER_FILL',
                    details: `Filled ${fill.size}sh @ ${fill.price} (weighted order avg ${matchRes.avgPrice ?? matchRes.execPrice ?? intent.price}; makerOrder=${fill.makerOrderId || 'unknown'})`,
                    isCausalConnected: true,
                  });
                }
              }
            } else {
              this.diagnostics.recordRejection(accountId, stock.id, matchRes.message || 'order_rejected', simTime);
              this.diagnostics.recordCausalTrace({
                timestamp: simTime,
                stockId: stock.id,
                agentId: agent.agentId,
                decisionId,
                orderId: matchRes.orderId,
                stage: 'ORDER_REJECTED',
                details: `Order rejected: ${matchRes.message || 'order_rejected'}`,
                isCausalConnected: true,
              });
            }
          }
        }
      }

      // SHADOW 모드: 가상 의사결정 집계 (실제 PRNG에 영향 없는 격리된 fork SimPrng 사용)
      if (isShadow) {
        try {
          const shadowPrng = new SimPrng();
          shadowPrng.setState(preAgentPrngState);

          const vProbs = computeDirectionalArrivalProbabilities(
            agent.activityRate,
            virtualBotEffectParams.buyArrivalMultiplier,
            virtualBotEffectParams.sellArrivalMultiplier,
            dt
          );
          const vActivityRoll = shadowPrng.next();
          const vArrived = vActivityRoll < vProbs.pCandidate;

          const virtualDecisionsByStock = new Map<string, { action: 'buy' | 'sell' | 'hold'; size: number }>();

          if (!vArrived) {
            virtualHoldCount++;
          } else {
            const vVisibleEvents = getVisibleMarketEvents(this.events, simTime, agent.infoLatency ?? 0);
            const vCandidateStocks = this.selectCandidateStocks(agent, stockList, shadowPrng);
            for (const vStock of vCandidateStocks) {
              const vObs = buildMarketObservation(
                vStock.id,
                accountId,
                simTime,
                20,
                this.attentionMap,
                this.uncertaintyMap,
                vVisibleEvents,
                windowStatsMap.get(vStock.id)
              );
              if (!vObs) continue;

              let vIntent: AgentOrderIntent = { action: 'hold', stockId: vStock.id };
              if (agent.strategyType === 'value') {
                const trueF = this.fundamentals.get(vStock.id) || vStock.current_price;
                vIntent = evaluateValueStrategy(
                  vObs,
                  agent,
                  this.valueConfig,
                  trueF,
                  shadowPrng,
                  virtualBotEffectParams
                );
              } else if (agent.strategyType === 'trend') {
                vIntent = evaluateTrendStrategy(vObs, agent, this.trendConfig, virtualBotEffectParams);
              }

              let vAction: 'buy' | 'sell' | 'hold' = 'hold';
              let vSize = 0;

              if (vIntent.action === 'buy' || vIntent.action === 'sell') {
                const vGate = vIntent.action === 'buy' ? vProbs.pBuy : vProbs.pSell;
                if (vActivityRoll < vGate && vIntent.price && vIntent.size && vIntent.size > 0) {
                  vAction = vIntent.action;
                  vSize = vIntent.size;
                }
              }

              if (vAction === 'buy') {
                virtualBuyCount++;
                virtualIntentsCount++;
                virtualOrderVolumeSum += vSize;
              } else if (vAction === 'sell') {
                virtualSellCount++;
                virtualIntentsCount++;
                virtualOrderVolumeSum += vSize;
              } else {
                virtualHoldCount++;
              }

              virtualDecisionsByStock.set(vStock.id, { action: vAction, size: vSize });
            }
          }

          // 의사결정 차이 집계 (actual vs virtual)
          const allEvaluatedStockIds = new Set([
            ...actualDecisionsByStock.keys(),
            ...virtualDecisionsByStock.keys(),
          ]);

          for (const sId of allEvaluatedStockIds) {
            const act = actualDecisionsByStock.get(sId) || { action: 'hold' as const, size: 0 };
            const virt = virtualDecisionsByStock.get(sId) || { action: 'hold' as const, size: 0 };

            if (act.action !== virt.action) {
              directionChangedCount++;
            } else if (act.action !== 'hold' && act.size !== virt.size) {
              sizeChangedCount++;
            }
          }
        } catch (shadowErr) {
          console.warn(`[SHADOW] Error evaluating virtual agent ${agent.agentId}:`, shadowErr);
        }
      }
    }

    // ── 6. Record Time-Series Flow Snapshot for Dashboard (Single End-of-Step Execution) ──
    const finalWindowStats = this.diagnostics.computeWindowStatistics(simTime, 10, 50);
    this.diagnostics.updateLeaderBoard(simTime, this.attentionMap, finalWindowStats, dt);
    this.diagnostics.recordSnapshot(simTime, this.attentionMap, this.publishedEvents, finalWindowStats);

    // ── 7. Deterministic Market Regime Evaluation (Scheduled for next step, No circular causality) ──
    if (this.enableRegimeEngine) {
      const statsList = Array.from(finalWindowStats.values());
      let totalMarketCap = 0;
      let weightedReturnSum = 0;
      let aggReturn = 0;
      let avgSpreadBps = 0;
      let validSpreadCount = 0;
      // 현재 장부(해당 스텝 최종 최우선 양측 호가) 기준 스프레드 집계
      let currentSpreadBpsSum = 0;
      let validCurrentSpreadCount = 0;

      for (const st of statsList) {
        aggReturn += st.returnRate;
        const stk = memoryDb.stocks.get(st.stockId);
        const price = stk?.current_price ?? 50000;
        const mcap = calculateAuthoritativeMarketCap(stk);
        totalMarketCap += mcap;
        weightedReturnSum += st.returnRate * mcap;

        if (st.spread !== null && st.spread > 0) {
          const bps = (st.spread / price) * 10000;
          avgSpreadBps += bps;
          validSpreadCount++;
        }

        if (
          st.currentSpreadBps !== null &&
          st.currentSpreadBps !== undefined &&
          Number.isFinite(st.currentSpreadBps)
        ) {
          currentSpreadBpsSum += st.currentSpreadBps;
          validCurrentSpreadCount++;
        }
      }

      const stockCount = Math.max(1, statsList.length);
      const marketCapWeightedReturn = totalMarketCap > 0 ? weightedReturnSum / totalMarketCap : aggReturn / stockCount;
      const meanReturn = marketCapWeightedReturn;
      const meanSpreadBps = validSpreadCount > 0 ? avgSpreadBps / validSpreadCount : 20.0;
      // 현재 장부에서 유효 스프레드를 하나도 관측하지 못하면 대체값을 쓰지 않고 null(관측 불가)로 둔다.
      const meanCurrentSpreadBps = validCurrentSpreadCount > 0 ? currentSpreadBpsSum / validCurrentSpreadCount : null;

      // 횡단면 수익률 분산 (종목 간 동일 가중 편차: 산술 평균 기준 순수 함수 적용)
      const crossSectionalDispersion = calculateCrossSectionalDispersion(statsList.map((st) => st.returnRate));

      // 시장 지수 시계열 실현 변동성 (Time-series realized volatility)
      this.marketIndexReturns.push(meanReturn);
      if (this.marketIndexReturns.length > 20) {
        this.marketIndexReturns.shift();
      }
      let realizedVol: number;
      if (this.marketIndexReturns.length >= 2) {
        const n = this.marketIndexReturns.length;
        const avgR = this.marketIndexReturns.reduce((acc, r) => acc + r, 0) / n;
        const sumSq = this.marketIndexReturns.reduce((acc, r) => acc + (r - avgR) * (r - avgR), 0);
        realizedVol = Math.sqrt(sumSq / (n - 1));
      } else {
        realizedVol = Math.max(0.005, Math.abs(meanReturn));
      }

      // 실제 거래대금 변화율 (전기 윈도우 대비)
      const currentTotalTurnover = statsList.reduce((acc, st) => acc + (st.turnover || 0), 0);
      let turnoverChange = 0;
      if (this.previousTotalTurnover !== null && this.previousTotalTurnover > 0) {
        turnoverChange = (currentTotalTurnover - this.previousTotalTurnover) / this.previousTotalTurnover;
      }
      this.previousTotalTurnover = currentTotalTurnover;

      // 실제 호가 깊이 변화율 (전기 윈도우 대비)
      const currentTotalDepth = statsList.reduce((acc, st) => acc + (st.depthShares || 0), 0);
      let depthChange = 0;
      if (this.previousTotalDepth !== null && this.previousTotalDepth > 0) {
        depthChange = (currentTotalDepth - this.previousTotalDepth) / this.previousTotalDepth;
      }
      this.previousTotalDepth = currentTotalDepth;

      // 실제 호가 공백(빈 장부) 종목 비율 판정: 현재 장부의 "유효한" 양측 최우선 호가 존재 여부로 판정
      // 매수 또는 매도 한쪽만 남아있는 단측 호가(One-Sided Book), 교차 호가, 잔량 0/비정상 가격은 모두 공백으로 집계.
      // 교차 호가를 정상 양측 장부로 세면 복구 비율이 과대평가되므로 hasValidTwoSidedQuote만 신뢰한다.
      // 중앙 설정의 emptyBookStockRatioThreshold 이상일 때만 지속시간 누적
      const totalStockCount = statsList.length;
      let emptyBookStockCount = 0;
      for (const st of statsList) {
        const isValidTwoSidedQuote =
          typeof st.hasValidTwoSidedQuote === 'boolean'
            ? st.hasValidTwoSidedQuote
            : st.hasTwoSidedBook === true &&
              (st.bidDepthShares ?? 0) > 0 &&
              (st.askDepthShares ?? 0) > 0 &&
              st.currentSpreadBps !== null;
        if (!isValidTwoSidedQuote) {
          emptyBookStockCount++;
        }
      }
      const emptyBookRatio = totalStockCount > 0 ? emptyBookStockCount / totalStockCount : 0;
      this.emptyBookStockRatio = emptyBookRatio;
      const ratioThreshold = this.marketStateEngine.getThresholds().emptyBookStockRatioThreshold ?? 0.3;

      if (emptyBookRatio >= ratioThreshold) {
        this.emptyBookAccumulatedSeconds += dt;
      } else {
        this.emptyBookAccumulatedSeconds = 0;
      }
      const emptyBookDurationSeconds = this.emptyBookAccumulatedSeconds;

      let avgUncertainty = 0.05;
      if (this.uncertaintyMap.size > 0) {
        let sumUnc = 0;
        for (const u of this.uncertaintyMap.values()) sumUnc += u;
        avgUncertainty = sumUnc / this.uncertaintyMap.size;
      }

      // Effective Macro News Signal (Pure function: confidence, half-life decay, RETRACT/REPLACE/ADDITIVE)
      const macroSignal = calculateEffectiveMacroSignal(this.publishedEvents, simTime);

      const observation: RegimeObservation = {
        simulationTime: simTime,
        aggregateReturn: meanReturn,
        realizedVolatility: realizedVol,
        crossSectionalDispersion,
        turnoverChange,
        averageSpreadBps: meanSpreadBps,
        currentSpreadBps: meanCurrentSpreadBps,
        depthChange,
        uncertainty: avgUncertainty,
        emptyBookDurationSeconds,
        emptyBookStockRatio: emptyBookRatio,
        effectiveMacroNewsSignal: macroSignal,
      };
      this.lastObservation = observation;

      // 세션 경계 처리
      this.marketStateEngine.advanceSession(simTime);

      // evaluateNextRegime:
      // 평가 결정 시각: simTime (스텝 종료 시각)
      // 발효 예정 시각: simTime (다음 스텝의 시작 시각 t0와 동일)
      // 평가 결정 스텝 ID: currentStepId (시뮬레이션 스텝 전진 이전의 step ID)
      // -> 다음 스텝에서: decisionStepId (= currentStepId) < nextStepId (새 currentStepId) AND
      //    effectiveAt (= simTime) <= newStepStartTime (= simTime) 가 정확히 만족되어 1회 활성화됨.
      this.marketStateEngine.evaluateNextRegime(observation, simTime, simTime, currentStepId);

      // 완성된 t1 스냅샷 원자적 게시
      this.marketStateEngine.publishSnapshot(simTime);
    }

    // SHADOW 모드 스텝 레코드 기록 (bounded buffer 100)
    if (isShadow) {
      const shadowRecord: ShadowDiagnosticsStepRecord = {
        simulationTime: simTime,
        stepId: currentStepId,
        detectedRegime: activeRegimeState?.regime ?? null,
        transitionId: activeRegimeState?.transitionId ?? null,
        virtualMultipliers,
        actualIntentsCount,
        virtualIntentsCount,
        actualBuyCount,
        actualSellCount,
        actualHoldCount,
        virtualBuyCount,
        virtualSellCount,
        virtualHoldCount,
        actualOrderVolumeSum,
        virtualOrderVolumeSum,
        actualLpSpread: lpEvaluatedStockCount > 0 ? actualLpSpreadSum / lpEvaluatedStockCount : 0,
        virtualLpSpread: lpEvaluatedStockCount > 0 ? virtualLpSpreadSum / lpEvaluatedStockCount : 0,
        actualLpDepth: lpEvaluatedStockCount > 0 ? actualLpDepthSum / lpEvaluatedStockCount : 0,
        virtualLpDepth: lpEvaluatedStockCount > 0 ? virtualLpDepthSum / lpEvaluatedStockCount : 0,
        directionChangedCount,
        sizeChangedCount,
        expectedDeferrals,
        shadowCalculationStatus: 'COMPLETED',
      };
      this.shadowDiagnosticsHistory.push(shadowRecord);
      if (this.shadowDiagnosticsHistory.length > 100) {
        this.shadowDiagnosticsHistory = this.shadowDiagnosticsHistory.slice(-100);
      }
    }

    // 8. 런타임 불변식 검증 (PRNG 미소비, 쿨다운 중복 억제, bounded buffer)
    this.checkRuntimeInvariants(simTime, currentStepId, effectsActive, regimeContext ? appliedMultipliers : undefined);
  }

  /**
   * LP 취소 대상 주문을 실제 취소하고, 성공한 경우에만 진단·통계를 기록한다.
   * 취소 실패 주문은 예약 자산이 유지되므로 신규 호가 예산에서 사용되지 않는다.
   */
  private async cancelLpOrders(
    lpAgent: AgentAccount,
    orders: OrderRecord[]
  ): Promise<{ failedOrderIds: Set<string>; cancelledOrderIds: Set<string> }> {
    const failedOrderIds = new Set<string>();
    const cancelledOrderIds = new Set<string>();

    for (const toCancel of orders) {
      try {
        const cancelRes = await LocalMarketService.cancelOrder({
          orderId: toCancel.id,
          userId: lpAgent.accountId,
        });
        if (cancelRes.success) {
          this.diagnostics.recordOrderCancel('market_maker');
          lpAgent.stats.ordersCancelled++;
          cancelledOrderIds.add(toCancel.id);
        } else {
          failedOrderIds.add(toCancel.id);
        }
      } catch (e) {
        failedOrderIds.add(toCancel.id);
      }
    }
    return { failedOrderIds, cancelledOrderIds };
  }

  /**
   * LP 신규 호가를 기존 LocalMarketService 검증·예약·매칭 경로로 제출한다.
   */
  private async submitLpOrders(
    lpAgent: AgentAccount,
    stockId: string,
    newOrders: { side: 'buy' | 'sell'; price: number; size: number; replacesOrderId?: string }[],
    simTime: number
  ): Promise<void> {
    for (const nOrd of newOrders) {
      const seq = this.clock.nextSequence();
      const matchRes = await LocalMarketService.submitOrder({
        userId: lpAgent.accountId,
        stockId,
        side: nOrd.side,
        price: nOrd.price,
        size: nOrd.size,
        isLp: true,
        orderType: 'limit',
        simulationTime: simTime,
        createdAt: new Date(simTime).toISOString(),
        sequence: seq,
        participantType: 'lp',
        accountId: lpAgent.accountId,
        agentId: lpAgent.agentId,
      });

      this.diagnostics.recordOrderSubmit('market_maker');
      lpAgent.stats.ordersSubmitted++;

      if (matchRes.success && matchRes.filledQty > 0) {
        for (const fill of matchRes.fills || [{ size: matchRes.filledQty }]) {
          this.diagnostics.recordOrderFill('market_maker', fill.size, false);
          lpAgent.stats.fillsCount++;
          lpAgent.stats.volumeTraded += fill.size;
        }
      }
    }
  }

  /**
   * Selects candidate stocks for an agent to evaluate using weighted sampling & exploration.
   * Prevents first-index starvation and ensures capital rotates dynamically.
   */
  private selectCandidateStocks(agent: AgentAccount, stocks: StockRecord[], prng: SimPrng): StockRecord[] {
    const numToPick = Math.min(stocks.length, agent.evaluationsPerStep || 2);
    if (stocks.length <= numToPick) return [...stocks];

    const selected: StockRecord[] = [];
    const pool = [...stocks];

    // 15% exploration probability to pick a completely random stock
    const EXPLORATION_RATE = 0.15;

    while (selected.length < numToPick && pool.length > 0) {
      if (prng.next() < EXPLORATION_RATE) {
        // Random exploration
        const randIdx = Math.floor(prng.next() * pool.length);
        selected.push(pool.splice(randIdx, 1)[0]);
        continue;
      }

      // Weighted roulette selection based on attention and sector preferences
      let totalWeight = 0;
      const weights: number[] = [];

      for (const s of pool) {
        const att = this.attentionMap.get(s.id) || s.base_liquidity || 0.5;
        const secPref = (s.sector_id && agent.sectorPreferences?.[s.sector_id]) || 1.0;
        // Weight combines base liquidity, dynamic attention, and agent sector affinity
        const baseLiq = s.base_liquidity ?? 0.5;
        const w = (baseLiq * 0.3 + att * 0.7) * secPref;
        weights.push(w);
        totalWeight += w;
      }

      let r = prng.next() * totalWeight;
      let pickedIdx = 0;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          pickedIdx = i;
          break;
        }
      }

      selected.push(pool.splice(pickedIdx, 1)[0]);
    }

    return selected;
  }

  /**
   * 런타임 불변식 검증 (PRNG 미소비, 핑거프린트 쿨다운 기반 중복 억제, bounded buffer)
   */
  public checkRuntimeInvariants(
    simTime: number,
    stepId: number,
    effectsActive: boolean,
    appliedMultipliers?: Record<string, number>
  ): void {
    const reportViolation = (
      code: string,
      entityType: 'profile' | 'holding' | 'order' | 'trade' | 'regime' | 'system',
      entityId: string,
      details: string
    ) => {
      const fingerprint = `${code}:${entityType}:${entityId}`;
      const lastReported = this.reportedInvariantFingerprints.get(fingerprint);
      if (lastReported !== undefined && stepId - lastReported < 10) {
        // 동일 위반 10스텝 쿨다운 중복 억제
        return;
      }
      this.reportedInvariantFingerprints.set(fingerprint, stepId);
      this.invariantViolationCount++;
      this.invariantViolations.push({
        code,
        simulationTime: simTime,
        entityType,
        entityId,
        message: details,
        stepId,
      });
      if (this.invariantViolations.length > 100) {
        this.invariantViolations = this.invariantViolations.slice(-100);
      }
      if (this.reportedInvariantFingerprints.size > 500) {
        // 오래된 핑거프린트 정리
        for (const [fp, reportedStep] of this.reportedInvariantFingerprints.entries()) {
          if (stepId - reportedStep >= 20) {
            this.reportedInvariantFingerprints.delete(fp);
          }
        }
      }
    };

    // 1. 프로필/계좌 잔고 검사: 현금 음수 또는 비유한수
    for (const [accId, profile] of memoryDb.profiles.entries()) {
      if (!Number.isFinite(profile.cash) || profile.cash < 0) {
        reportViolation(
          'INVALID_CASH_BALANCE',
          'profile',
          accId,
          `Invalid cash balance: ${profile.cash}`
        );
      }
    }

    // 2. 보유량 검사: 수량 음수 또는 비유한수
    for (const [holdingId, holding] of memoryDb.holdings.entries()) {
      if (!Number.isFinite(holding.quantity) || holding.quantity < 0) {
        reportViolation(
          'INVALID_HOLDING_QUANTITY',
          'holding',
          holdingId,
          `Invalid holding quantity: ${holding.quantity}`
        );
      }
    }

    // 3. 미체결 주문 기반 예약 자산 검사: reserved cash/holding 음수
    if (memoryDb.orderUserIndex) {
      for (const [userId, orderIds] of memoryDb.orderUserIndex.entries()) {
        const userOrders: OpenOrderForRisk[] = [];
        for (const oId of orderIds) {
          const ord = memoryDb.orders.get(oId);
          if (ord && (ord.status === 'open' || ord.status === 'partial')) {
            userOrders.push(ord as OpenOrderForRisk);
          }
        }
        const resCash = calculateReservedCash(userOrders);
        if (!Number.isFinite(resCash) || resCash < 0) {
          reportViolation(
            'INVALID_RESERVED_CASH',
            'profile',
            userId,
            `Negative or non-finite reserved cash: ${resCash}`
          );
        }

        // 보유 종목별 reserved holding 검사
        const userHoldingIds = memoryDb.holdingUserIndex.get(userId);
        if (userHoldingIds) {
          for (const hId of userHoldingIds) {
            const h = memoryDb.holdings.get(hId);
            if (h) {
              const resHold = calculateReservedQty(userOrders, h.stock_id);
              if (!Number.isFinite(resHold) || resHold < 0) {
                reportViolation(
                  'INVALID_RESERVED_HOLDING',
                  'holding',
                  hId,
                  `Negative or non-finite reserved holding: ${resHold}`
                );
              }
            }
          }
        }
      }
    }

    // 4. 주문 상태 검사: filled < 0 또는 > size, 잔량 <= 0 (open/partial), 비양수/비유한수 size
    for (const [orderId, order] of memoryDb.orders.entries()) {
      if (!Number.isFinite(order.size) || order.size <= 0) {
        reportViolation(
          'INVALID_ORDER_SIZE',
          'order',
          orderId,
          `Invalid order size: ${order.size}`
        );
      }
      const filled = order.filled || 0;
      if (!Number.isFinite(filled) || filled < 0 || filled > order.size) {
        reportViolation(
          'INVALID_ORDER_FILLED',
          'order',
          orderId,
          `Invalid filled qty: ${filled} / ${order.size}`
        );
      }
      if (order.status === 'open' || order.status === 'partial') {
        const remaining = order.size - filled;
        if (remaining <= 0) {
          reportViolation(
            'INVALID_OPEN_ORDER_REMAINING',
            'order',
            orderId,
            `Open/partial order has zero or negative remaining qty: ${remaining}`
          );
        }
      }
    }

    // 5. 최근 체결 검사: 체결 가격·수량이 비양수 또는 비유한수
    const tradesToCheck = memoryDb.trades.slice(-50);
    for (const trade of tradesToCheck) {
      if (!Number.isFinite(trade.price) || trade.price <= 0) {
        reportViolation(
          'INVALID_TRADE_PRICE',
          'trade',
          trade.id,
          `Invalid trade price: ${trade.price}`
        );
      }
      if (!Number.isFinite(trade.size) || trade.size <= 0) {
        reportViolation(
          'INVALID_TRADE_SIZE',
          'trade',
          trade.id,
          `Invalid trade size: ${trade.size}`
        );
      }
    }

    // 6. 보조 인덱스 정합성 검사
    if (memoryDb.orderStockIndex) {
      for (const [stockId, oIds] of memoryDb.orderStockIndex.entries()) {
        for (const oId of oIds) {
          const ord = memoryDb.orders.get(oId);
          if (!ord || ord.stock_id !== stockId) {
            reportViolation(
              'INDEX_MISMATCH_STOCK',
              'system',
              `${stockId}:${oId}`,
              `Stock order index mismatch for order ${oId}`
            );
          }
        }
      }
    }

    // 7. 국면 효과 정책 검사: OFF/SHADOW인데 실제 applied multiplier가 활성화된 경우
    if (!effectsActive && appliedMultipliers && Object.keys(appliedMultipliers).length > 0) {
      reportViolation(
        'ILLEGAL_MULTIPLIER_USAGE',
        'regime',
        this._regimeEffectsMode,
        `Multipliers applied while mode is ${this._regimeEffectsMode}`
      );
    }

    // 8. 동일 스텝에서 허용되지 않은 복수 모드 활성화 검사
    if (
      this._regimeEffectsMode !== 'OFF' &&
      this._regimeEffectsMode !== 'SHADOW' &&
      this._regimeEffectsMode !== 'EXPERIMENTAL_ON'
    ) {
      reportViolation(
        'INVALID_REGIME_MODE',
        'regime',
        String(this._regimeEffectsMode),
        `Unrecognized regime mode: ${this._regimeEffectsMode}`
      );
    }
  }

  public reset(seed: number = 42): void {
    const prevMode = this._regimeEffectsMode;
    this.clock.reset();
    this.prng = new SimPrng(seed);
    this.fundamentalPrng = this.prng.split(100);
    if (this.enableRegimeEngine) {
      this.marketStateEngine.reset(this.clock.simulationTime, seed);
    }
    this.previousTotalTurnover = null;
    this.previousTotalDepth = null;
    this.emptyBookAccumulatedSeconds = 0;
    this.marketIndexReturns = [];
    this.diagnostics.reset();
    this.agents.clear();
    this.agentPrngs.clear();
    this.fundamentals.clear();
    this.pendingEvents = [];
    this.publishedEvents = [];
    this.events = [];
    this.publishedEventIds.clear();
    this.effectiveEventIds.clear();
    this.idempotencyTracker.reset();
    this.attentionMap.clear();
    this.uncertaintyMap.clear();
    this.lastObservation = null;
    this.emptyBookStockRatio = 0;
    this.lpDeferrals.clear();

    // Reset 운용 모드 및 진단 상태 원자적 초기화 (안전 정책)
    this._regimeEffectsMode = 'OFF';
    this.pendingEffectsMode = null;
    this.pendingReason = null;
    this.recentDeferralCount = 0;
    this.invariantViolationCount = 0;
    this.shadowDiagnosticsHistory = [];
    this.invariantViolations = [];
    this.reportedInvariantFingerprints.clear();

    // 감사 이력 정합성: simulation_reset_fail_safe 기록
    this.modeChangeHistory = [
      {
        timestamp: this.clock.simulationTime,
        fromMode: prevMode,
        toMode: 'OFF',
        appliedAtStepId: this.clock.simulationStep,
        reason: 'simulation_reset_fail_safe',
      },
    ];

    this.registerDefaultAgents();
    this.initFundamentals();
    this.initAttentionAndUncertainty();
  }

  public getMarketStateSnapshot(): MarketStateSnapshot {
    return this.marketStateEngine.getSnapshot();
  }

  public getLastObservation(): RegimeObservation | null {
    return this.lastObservation;
  }

  public getEmptyBookAccumulatedSeconds(): number {
    return this.emptyBookAccumulatedSeconds;
  }

  public getEmptyBookStockRatio(): number {
    return this.emptyBookStockRatio;
  }

  public applyDueEventEffects(simTime: number): void {
    this.processDueEffects(simTime);
  }
}
