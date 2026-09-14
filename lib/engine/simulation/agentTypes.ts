/**
 * STOCKSYS Agent-Based Market (ABM) Type Definitions
 */

import { OrderRecord } from '../../memoryDb/memoryStore';

export type ParticipantType = 'human' | 'bot' | 'lp';
export type StrategyType = 'value' | 'trend' | 'market_maker';

export interface AgentStats {
  ordersSubmitted: number;
  ordersCancelled: number;
  fillsCount: number;
  volumeTraded: number;
  feesPaid: number;
  realizedPnl: number;
}

export interface AgentAccount {
  accountId: string;          // Maps to user_id in DB (e.g. 'acc_bot_val_01')
  agentId: string;            // Strategy identity
  participantType: ParticipantType;
  strategyType: StrategyType;
  name: string;
  targetPositions: Record<string, number>; // stockId -> target shares
  maxOrderSize: number;       // Maximum single order size in shares
  maxPosition: number;        // Maximum absolute position in shares
  riskTolerance: number;      // 0.0 ~ 1.0 (higher = more willing to absorb risk)
  urgency: number;            // 0.0 ~ 1.0 (higher = more likely to take liquidity / IOC)
  activityRate: number;       // Poisson arrival parameter lambda (actions per second)
  infoLatency?: number;       // Information observation latency in simulation seconds (e.g. 2.0s)
  evaluationsPerStep?: number; // Max number of candidate stocks to evaluate when activated (e.g. 2~3)
  sectorPreferences?: Record<string, number>; // Sector preference weight multipliers (e.g. { semiconductor: 1.2 })
  nextDecisionTime: number;   // Simulation time for next action check
  stats: AgentStats;
}

export interface AgentOrderIntent {
  action: 'buy' | 'sell' | 'hold' | 'cancel' | 'replace';
  stockId: string;
  price?: number;
  size?: number;
  orderType?: 'limit' | 'ioc';
  cancelOrderId?: string;
  reason?: string;
}

export interface ValueStrategyConfig {
  valueWeight: number;        // Weight for valuation signal (e.g. 1.0)
  exposureWeight: number;     // Weight for exposure gap damping (e.g. 0.5)
  noiseStdDev: number;        // Estimation error standard deviation (e.g. 0.015 = 1.5%)
  delaySteps: number;         // Information latency in steps (e.g. 1~3 steps)
  deadbandPct: number;        // Minimum valuation gap to trigger action (e.g. 0.01 = 1%)
  minProfitMarginPct: number; // Required expected profit over costs (e.g. 0.003 = 0.3%)
  participationRate: number;  // Max % of rolling volume per order (e.g. 0.20 = 20%)
  buyThreshold: number;       // Signal threshold to buy (e.g. 0.2)
  sellThreshold: number;      // Signal threshold to sell (e.g. -0.2)
}

export interface TrendStrategyConfig {
  trendWeight: number;        // Weight for trend signal (e.g. 1.0)
  exposureWeight: number;     // Weight for exposure gap damping (e.g. 0.5)
  lookbackSteps: number;      // Rolling window for returns/moving averages (e.g. 10)
  minWarmupSteps: number;     // Minimum data points before acting (e.g. 5)
  trendScale: number;         // Return scale for tanh normalization (e.g. 0.02 = 2%)
  participationRate: number;  // Max % of rolling volume (e.g. 0.25 = 25%)
  buyThreshold: number;       // Signal threshold to buy (e.g. 0.25)
  sellThreshold: number;      // Signal threshold to sell (e.g. -0.25)
}

export interface LpStrategyConfig {
  targetInventory: number;    // Target inventory Q* (e.g. 2000 shares)
  inventoryLimit: number;     // Maximum inventory capacity Q_max (e.g. 10000 shares)
  numLevels: number;          // Number of quote depth levels (e.g. 3~5)
  baseSpreadBps: number;      // Base spread in basis points (e.g. 30 bps = 0.003)
  volatilityAlpha: number;    // Spread scaling parameter for volatility
  inventoryRiskBeta: number;  // Spread widening parameter for inventory risk
  inventorySkewKappa: number; // Reservation price skew parameter in tick units
  quoteLifetimeSteps: number; // Max steps before refreshing resting quotes
  baseLevelSize: number;      // Base size per level (e.g. 50 shares)
}
