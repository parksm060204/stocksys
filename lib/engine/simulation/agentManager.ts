/**
 * STOCKSYS Agent Manager & Market Simulation Orchestrator
 *
 * Coordinates:
 * - Deterministic simulation clock & decoupled PRNG streams
 * - Merton Jump-Diffusion (MJD) latent fundamental value generation scaled by dt
 * - Independent bot & LP accounts with strictly enforced balance constraints
 * - Unified execution via LocalMarketService.submitOrder and cancelOrder
 * - Detailed diagnostic metrics collection
 */

import { memoryDb, StockRecord } from '../../memoryDb/memoryStore';
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
import { MarketDiagnostics } from './marketDiagnostics';

export class AgentManager {
  public clock: SimulationClock;
  public prng: SimPrng;
  public fundamentalPrng: SimPrng;
  public agentPrngs: Map<string, SimPrng> = new Map();

  public agents: Map<string, AgentAccount> = new Map();
  public fundamentals: Map<string, number> = new Map();
  public diagnostics: MarketDiagnostics = new MarketDiagnostics();

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
      activityRate: 1.0, // Every step evaluates quotes
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
      activityRate: 0.5, // ~50% Poisson arrival per sec
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

  /**
   * Advances the simulation by dt seconds and executes the full agent lifecycle:
   * 1. Advance simulation clock
   * 2. Merton Jump-Diffusion SDE update with dt scaling
   * 3. LP quote differential update (skewed, multi-level, budget constrained)
   * 4. Bot Poisson arrivals & strategy evaluations (Value & Trend)
   * 5. Monotonic sequence tagging and immediate unified matching
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

    // ── 2. Market Maker (LP) Quote Lifecycle ──
    const lpAgent = this.agents.get('acc_lp_main');
    if (lpAgent) {
      for (const stock of memoryDb.stocks.values()) {
        const obs = buildMarketObservation(stock.id, lpAgent.accountId, simTime);
        if (!obs) continue;

        this.diagnostics.recordMarketQuality(stock.id, obs.spread, obs.hasTwoSidedBook);

        const plan = evaluateLpStrategy(obs, lpAgent, this.lpConfig);

        // Cancel out-of-band quotes
        for (const toCancel of plan.cancels) {
          await LocalMarketService.cancelOrder({
            orderId: toCancel.id,
            userId: lpAgent.accountId,
          });
          this.diagnostics.recordOrderCancel('market_maker');
          lpAgent.stats.ordersCancelled++;
        }

        // Submit new quote levels with strict sequence & arrival timestamp
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

    // ── 3. Bot Trading Strategy Lifecycle (Value & Trend) ──
    const stockList = Array.from(memoryDb.stocks.values());

    for (const [accountId, agent] of this.agents.entries()) {
      if (agent.participantType === 'lp') continue;

      const agentPrng = this.agentPrngs.get(accountId) || this.prng;
      const arrivalProb = 1 - Math.exp(-agent.activityRate * dt);

      // Check Poisson arrival
      if (agentPrng.next() >= arrivalProb) {
        continue;
      }

      // Pick target stock (can evaluate all or sample)
      for (const stock of stockList) {
        const obs = buildMarketObservation(stock.id, accountId, simTime);
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

          if (matchRes.success) {
            if (matchRes.filledQty > 0) {
              const isTaker = intent.orderType === 'ioc';
              this.diagnostics.recordOrderFill(agent.strategyType, matchRes.filledQty, !isTaker);
              agent.stats.fillsCount++;
              agent.stats.volumeTraded += matchRes.filledQty;
            }
          } else {
            this.diagnostics.recordRejection(accountId, stock.id, matchRes.message || 'order_rejected', simTime);
          }
        }
      }
    }
  }

  public reset(seed: number = 42): void {
    this.clock.reset();
    this.prng = new SimPrng(seed);
    this.fundamentalPrng = this.prng.split(100);
    this.diagnostics.reset();
    this.agents.clear();
    this.agentPrngs.clear();
    this.fundamentals.clear();
    this.registerDefaultAgents();
    this.initFundamentals();
  }
}
