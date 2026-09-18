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

import { memoryDb, StockRecord, MarketNewsRecord } from '../../memoryDb/memoryStore';
import { LocalMarketService } from '../marketService';
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
} from './marketEventTypes';
import {
  MarketStateEngine,
  MarketStateSnapshot,
  RegimeObservation,
  deriveDeterministicSeed,
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

  constructor(seed: number = 42, startEpochMs: number = 1773500000000) {
    this.clock = new SimulationClock(startEpochMs, 1.0);
    this.prng = new SimPrng(seed);
    this.fundamentalPrng = this.prng.split(100);
    const regimeSeed = deriveDeterministicSeed(seed, 'market-regime-v1');
    this.marketStateEngine = new MarketStateEngine({}, regimeSeed, startEpochMs);

    this.registerDefaultAgents();
    this.initFundamentals();
    this.initAttentionAndUncertainty();
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

    const storedEvent: MarketEvent = {
      ...event,
      targetStockIds: [...event.targetStockIds],
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

    // 1. t0 시점에 적용 예정인 pending 국면 활성화
    this.marketStateEngine.activatePendingRegime(t0, currentStepId);

    // 2. 시계를 t1 = t0 + dt로 전진
    const { time: simTime, step: nextStepId } = this.clock.advance(dt);

    this.processDuePublications(simTime);
    this.processDueEffects(simTime);

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

        const plan = evaluateLpStrategy(obs, lpAgent, this.lpConfig);

        // Phase 1: Execute cancellations first to safely release reserved cash & shares
        for (const toCancel of plan.cancels) {
          const cancelRes = await LocalMarketService.cancelOrder({
            orderId: toCancel.id,
            userId: lpAgent.accountId,
          });
          if (cancelRes.success) {
            this.diagnostics.recordOrderCancel('market_maker');
            lpAgent.stats.ordersCancelled++;
          }
        }

        // Phase 2: Submit new quote levels within strictly re-verified available budget
        for (const nOrd of plan.newOrders) {
          const seq = this.clock.nextSequence();
          const matchRes = await LocalMarketService.submitOrder({
            userId: lpAgent.accountId,
            stockId: stock.id,
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
    }

    // ── 5. Bot Trading Strategy Lifecycle (Weighted Selection & Latency) ──
    const stockList = Array.from(memoryDb.stocks.values());

    for (const [accountId, agent] of this.agents.entries()) {
      if (agent.participantType === 'lp') continue;

      const agentPrng = this.agentPrngs.get(accountId) || this.prng;
      const arrivalProb = 1 - Math.exp(-agent.activityRate * dt);

      // Poisson arrival check
      if (agentPrng.next() >= arrivalProb) {
        continue;
      }

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
          intent = evaluateValueStrategy(obs, agent, this.valueConfig, trueF, agentPrng);
        } else if (agent.strategyType === 'trend') {
          intent = evaluateTrendStrategy(obs, agent, this.trendConfig);
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

    // ── 6. Record Time-Series Flow Snapshot for Dashboard (Single End-of-Step Execution) ──
    const finalWindowStats = this.diagnostics.computeWindowStatistics(simTime, 10, 50);
    this.diagnostics.updateLeaderBoard(simTime, this.attentionMap, finalWindowStats, dt);
    this.diagnostics.recordSnapshot(simTime, this.attentionMap, this.publishedEvents, finalWindowStats);

    // ── 7. Deterministic Market Regime Evaluation (Scheduled for next step, No circular causality) ──
    const statsList = Array.from(finalWindowStats.values());
    let aggReturn = 0;
    let avgSpreadBps = 0;
    let validSpreadCount = 0;

    for (const st of statsList) {
      aggReturn += st.returnRate;
      if (st.spread !== null && st.spread > 0) {
        const stk = memoryDb.stocks.get(st.stockId);
        const price = stk?.current_price ?? 50000;
        const bps = (st.spread / price) * 10000;
        avgSpreadBps += bps;
        validSpreadCount++;
      }
    }

    const stockCount = Math.max(1, statsList.length);
    const meanReturn = aggReturn / stockCount;
    const meanSpreadBps = validSpreadCount > 0 ? avgSpreadBps / validSpreadCount : 20.0;

    let varSum = 0;
    for (const st of statsList) {
      const diff = st.returnRate - meanReturn;
      varSum += diff * diff;
    }
    const realizedVol = Math.sqrt(varSum / stockCount);

    let avgUncertainty = 0.05;
    if (this.uncertaintyMap.size > 0) {
      let sumUnc = 0;
      for (const u of this.uncertaintyMap.values()) sumUnc += u;
      avgUncertainty = sumUnc / this.uncertaintyMap.size;
    }

    // Effective Macro News Signal (Strict barrier: publishedAt <= simTime && effectiveFrom <= simTime only)
    let macroSignal = 0;
    const effectiveMacroEvents = this.publishedEvents.filter(
      (e) => e.scope === 'market' && e.effectiveFrom <= simTime && this.effectiveEventIds.has(e.eventId)
    );
    for (const ev of effectiveMacroEvents) {
      macroSignal += ev.valuationSignal;
    }
    macroSignal = Math.max(-1.0, Math.min(1.0, macroSignal));

    const observation: RegimeObservation = {
      simulationTime: simTime,
      aggregateReturn: meanReturn,
      realizedVolatility: realizedVol,
      turnoverChange: 0,
      averageSpreadBps: meanSpreadBps,
      depthChange: 0,
      uncertainty: avgUncertainty,
      emptyBookDurationSeconds: 0,
      effectiveMacroNewsSignal: macroSignal,
    };

    // 7. (t0, t1]에서 통과한 세션 경계 전부 처리
    this.marketStateEngine.advanceSession(simTime);

    const nextStepTime = simTime + Math.round(dt * 1000);
    this.marketStateEngine.evaluateNextRegime(observation, simTime, nextStepTime, nextStepId);

    // 8. 완성된 t1 스냅샷 원자적 게시
    this.marketStateEngine.publishSnapshot(simTime);
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

  public reset(seed: number = 42): void {
    this.clock.reset();
    this.prng = new SimPrng(seed);
    this.fundamentalPrng = this.prng.split(100);
    const regimeSeed = deriveDeterministicSeed(seed, 'market-regime-v1');
    this.marketStateEngine.reset(this.clock.simulationTime, regimeSeed);
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

    this.registerDefaultAgents();
    this.initFundamentals();
    this.initAttentionAndUncertainty();
  }

  public getMarketStateSnapshot(): MarketStateSnapshot {
    return this.marketStateEngine.getSnapshot();
  }

  public applyDueEventEffects(simTime: number): void {
    this.processDueEffects(simTime);
  }
}
