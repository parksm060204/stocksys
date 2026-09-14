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
} from './marketEventTypes';

export class AgentManager {
  public clock: SimulationClock;
  public prng: SimPrng;
  public fundamentalPrng: SimPrng;
  public agentPrngs: Map<string, SimPrng> = new Map();

  public agents: Map<string, AgentAccount> = new Map();
  public fundamentals: Map<string, number> = new Map();
  public diagnostics: MarketDiagnostics = new MarketDiagnostics();

  // ── Single-Source Event & Attention State ──
  public events: MarketEvent[] = [];
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
      urgency: 0.2,
      activityRate: 0.5,
      infoLatency: 2.0,  // 2.0 seconds information latency
      evaluationsPerStep: 3,
      sectorPreferences: { semiconductor: 1.3, it: 1.1 },
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
      urgency: 0.1,
      activityRate: 0.35,
      infoLatency: 4.0,  // 4.0 seconds latency (slower observer)
      evaluationsPerStep: 2,
      sectorPreferences: { auto: 1.2, energy: 1.1 },
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
      activityRate: 0.6,
      infoLatency: 1.0,
      evaluationsPerStep: 3,
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
      urgency: 0.4,
      activityRate: 0.4,
      infoLatency: 2.0,
      evaluationsPerStep: 2,
      sectorPreferences: { energy: 1.3, bio: 1.2 },
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
   * Publishes a structured market event into the simulation engine.
   * Guarantees idempotency and syncs directly to memoryDb.marketNews for terminal UI rendering.
   */
  public publishEvent(event: MarketEvent): boolean {
    if (!this.idempotencyTracker.record(event.eventId)) {
      return false; // Duplicate event rejected
    }

    this.events.push(event);

    // If this is a CORRECTION, stamp the original rumor with correctedAt time.
    // Do NOT globally zero the confidence — bots who haven't received the CORRECTION
    // yet (due to infoLatency) should still see the original confidence intact.
    // The value strategy discounts corrected events by checking visibleEvents for
    // a matching CORRECTION event and zeroing confidence only in that agent's view.
    if (event.eventType === 'CORRECTION' && event.originalEventId) {
      const orig = this.events.find((e) => e.eventId === event.originalEventId);
      if (orig) {
        // Only tag with correctedAt — do not mutate global confidence
        (orig as any).correctedAt = event.publishedAt;
      }
    }

    // Apply immediate attention & uncertainty shocks to target stocks
    for (const sId of event.targetStockIds) {
      const curAtt = this.attentionMap.get(sId) || 0.5;
      const curUnc = this.uncertaintyMap.get(sId) || 0.05;

      // Attention increases non-directionally (bad news also increases attention)
      const newAtt = Math.min(1.0, curAtt + event.attentionShock);
      const newUnc = Math.min(1.0, curUnc + event.uncertaintyShock);

      this.attentionMap.set(sId, newAtt);
      this.uncertaintyMap.set(sId, newUnc);
    }

    // Synchronize to memoryDb.marketNews for UI display (without triggering artificial price changes)
    const newsRecord: MarketNewsRecord = {
      id: event.eventId,
      type: event.scope.toUpperCase(),
      category: event.eventType,
      publisher: event.publisher,
      title: event.title,
      content: event.content,
      target_sector: event.sectorId || null,
      target_ticker: event.targetStockIds.length === 1 ? memoryDb.stocks.get(event.targetStockIds[0])?.ticker || null : null,
      impact_score: parseFloat((event.valuationSignal * 10).toFixed(1)),
      is_fake: Boolean(event.isRumorFake),
      created_at: new Date(this.clock.simulationTime).toISOString(),
    };
    memoryDb.marketNews.unshift(newsRecord);
    if (memoryDb.marketNews.length > 200) {
      memoryDb.marketNews.pop();
    }

    // Record causal trace
    this.diagnostics.recordCausalTrace({
      timestamp: event.publishedAt,
      eventId: event.eventId,
      eventType: event.eventType,
      stage: 'NEWS_RECEIVED',
      details: `[${event.eventType}] ${event.title} (ValSignal: ${event.valuationSignal}, AttShock: ${event.attentionShock})`,
    });

    return true;
  }

  /**
   * Advances the simulation by dt seconds and executes the full agent lifecycle:
   * 1. Advance simulation clock
   * 2. Merton Jump-Diffusion SDE update with dt scaling
   * 3. Decay attention & uncertainty over simulation time
   * 4. Update rolling window statistics and leader stock rankings
   * 5. Two-phase LP quoting (Cancels first, then budget-safe new orders)
   * 6. Bot decision making via weighted candidate sampling & latency buffer
   */
  public async step(dt: number = 1.0): Promise<void> {
    const { time: simTime } = this.clock.advance(dt);

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

    // ── 3. Rolling Window Statistics & Leader Ranking ──
    const windowStatsMap = this.diagnostics.computeWindowStatistics(simTime, 10, 50);
    this.diagnostics.updateLeaderBoard(simTime, this.attentionMap);

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
            sequence: seq,
            participantType: 'lp',
            accountId: lpAgent.accountId,
            agentId: lpAgent.agentId,
          });

          this.diagnostics.recordOrderSubmit('market_maker');
          lpAgent.stats.ordersSubmitted++;

          if (matchRes.success && matchRes.filledQty > 0) {
            this.diagnostics.recordOrderFill('market_maker', matchRes.filledQty, true);
            lpAgent.stats.fillsCount++;
            lpAgent.stats.volumeTraded += matchRes.filledQty;
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
      const visibleEvents = this.events
        .filter((e) => e.publishedAt <= simTime - (agent.infoLatency ?? 0))
        .map((e) => {
          const { isRumorFake, ...sanitized } = e;
          return sanitized as MarketEvent;
        });

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
          const matchRes = await LocalMarketService.submitOrder({
            userId: accountId,
            stockId: stock.id,
            side: intent.action,
            price: intent.price,
            size: intent.size,
            isLp: false,
            orderType: intent.orderType || 'limit',
            simulationTime: simTime,
            sequence: seq,
            participantType: 'bot',
            accountId: accountId,
            agentId: agent.agentId,
          });

          this.diagnostics.recordOrderSubmit(agent.strategyType);
          agent.stats.ordersSubmitted++;

          this.diagnostics.recordCausalTrace({
            timestamp: simTime,
            stockId: stock.id,
            agentId: agent.agentId,
            stage: 'ORDER_SUBMIT',
            details: `[${agent.strategyType}] ${intent.action.toUpperCase()} ${intent.size}sh @ ${intent.price} (reason: ${intent.reason})`,
          });

          if (matchRes.success) {
            if (matchRes.filledQty > 0) {
              const isTaker = intent.orderType === 'ioc';
              this.diagnostics.recordOrderFill(agent.strategyType, matchRes.filledQty, !isTaker);
              agent.stats.fillsCount++;
              agent.stats.volumeTraded += matchRes.filledQty;

              this.diagnostics.recordCausalTrace({
                timestamp: simTime,
                stockId: stock.id,
                agentId: agent.agentId,
                stage: 'ORDER_FILL',
                details: `Filled ${matchRes.filledQty}sh @ avg ${intent.price}`,
              });
            }
          } else {
            this.diagnostics.recordRejection(accountId, stock.id, matchRes.message || 'order_rejected', simTime);
          }
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

  public reset(seed: number = 42): void {
    this.clock.reset();
    this.prng = new SimPrng(seed);
    this.fundamentalPrng = this.prng.split(100);
    this.diagnostics.reset();
    this.agents.clear();
    this.agentPrngs.clear();
    this.fundamentals.clear();
    this.events = [];
    this.idempotencyTracker.reset();
    this.attentionMap.clear();
    this.uncertaintyMap.clear();

    this.registerDefaultAgents();
    this.initFundamentals();
    this.initAttentionAndUncertainty();
  }
}
