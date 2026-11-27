/**
 * STOCKSYS Adaptive Risk, Drawdown & Inventory Skew Control Layer
 *
 * Pure deterministic risk scaling based on per-bot NAV watermark drawdown,
 * realized PnL deterioration, and positional inventory skew.
 * Shared across stock/ETF and commodity trading bots.
 * Zero Math.random(), zero Date.now(), zero external IO.
 */

import type { AgentAccount } from '../agentTypes';
import type { MarketObservation } from '../marketObservation';

export interface DrawdownRiskOutput {
  drawdownPct: number;           // [0, 1] current drawdown from peak equity
  positionLimitMultiplier: number; // [0.25, 1.0] dynamic cap multiplier on maxPosition
  orderSizeMultiplier: number;   // [0.20, 1.0] dynamic cap multiplier on order size
  buySizeMultiplier: number;     // [0.20, 1.0] directional buy scaling after inventory skew
  sellSizeMultiplier: number;    // [0.20, 1.0] directional sell scaling after inventory skew
  inventorySkewRatio: number;    // [-1, 1] normalized inventory concentration
}

export interface AdaptiveBotRiskRecord {
  accountId: string;
  peakEquity: number;
  lastEquity: number;
  maxDrawdownPct: number;
  consecutiveLossSteps: number;
  lastRealizedPnl: number;
  lastUpdatedSimTime: number;
}

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

/**
 * Pure drawdown + inventory skew risk multiplier calculator.
 * - Drawdown beyond 2% progressively scales down position limit and order sizing.
 * - High positive inventory concentration dampens additional buying while allowing de-risking sells.
 * - High negative inventory concentration (commodities short) dampens additional selling while allowing covering buys.
 */
export function computeAdaptiveRiskMultipliers(input: {
  currentEquity: number;
  peakEquity: number;
  currentPosition: number;
  maxPosition: number;
  realizedPnl?: number;
  consecutiveLossSteps?: number;
  baseRiskTolerance?: number;
}): DrawdownRiskOutput {
  const safePeak = Number.isFinite(input.peakEquity) && input.peakEquity > 0 ? input.peakEquity : 0;
  const safeEquity = Number.isFinite(input.currentEquity) ? input.currentEquity : safePeak;

  const drawdownPct =
    safePeak > 0 && safeEquity < safePeak
      ? clamp((safePeak - safeEquity) / safePeak, 0, 1)
      : 0;

  // Risk tolerance lightly widens acceptable drawdown cushion before cuts bite hardest
  const riskTol = clamp(input.baseRiskTolerance ?? 0.5, 0.1, 1.0);
  const graceBand = 0.015 + riskTol * 0.015; // 1.65% ~ 3.0% grace band
  const excessDd = Math.max(0, drawdownPct - graceBand);

  const lossStreakPenalty = clamp((input.consecutiveLossSteps ?? 0) * 0.04, 0, 0.25);
  const pnlPenalty =
    safePeak > 0 && typeof input.realizedPnl === 'number' && input.realizedPnl < 0
      ? clamp(Math.abs(input.realizedPnl) / safePeak, 0, 0.25) * 0.5
      : 0;

  const positionLimitMultiplier = clamp(
    1.0 - Math.min(0.75, excessDd * 3.5 + lossStreakPenalty * 0.6 + pnlPenalty),
    0.25,
    1.0
  );

  const ddSizeScale = clamp(1.0 / (1.0 + excessDd * 10.0) - lossStreakPenalty * 0.5, 0.2, 1.0);

  const safeMaxPos = Math.max(1, Math.abs(input.maxPosition || 1));
  const inventorySkewRatio = clamp(input.currentPosition / safeMaxPos, -1, 1);

  // Concentration above 35% of maxPosition progressively throttles same-direction accumulation
  let buySizeMultiplier = ddSizeScale;
  let sellSizeMultiplier = ddSizeScale;
  if (inventorySkewRatio > 0.35) {
    const excessSkew = (inventorySkewRatio - 0.35) / 0.65; // [0, 1]
    buySizeMultiplier = clamp(ddSizeScale * (1.0 - excessSkew * 0.65), 0.2, 1.0);
    // De-risking sell preserves at least 0.5x even under drawdown
    sellSizeMultiplier = clamp(Math.max(ddSizeScale, 0.5), 0.5, 1.0);
  } else if (inventorySkewRatio < -0.35) {
    const excessSkew = (Math.abs(inventorySkewRatio) - 0.35) / 0.65;
    sellSizeMultiplier = clamp(ddSizeScale * (1.0 - excessSkew * 0.65), 0.2, 1.0);
    buySizeMultiplier = clamp(Math.max(ddSizeScale, 0.5), 0.5, 1.0);
  }

  return {
    drawdownPct,
    positionLimitMultiplier,
    orderSizeMultiplier: ddSizeScale,
    buySizeMultiplier,
    sellSizeMultiplier,
    inventorySkewRatio,
  };
}

/**
 * Deterministic stateful per-bot drawdown & performance tracker for AgentManager.
 * All state is JSON-serializable and captured/restored in AgentManager.captureStepSnapshot().
 */
export class AdaptiveRiskManager {
  private records = new Map<string, AdaptiveBotRiskRecord>();

  public updateAgentEquity(
    accountId: string,
    nav: number,
    realizedPnl: number,
    simTime: number
  ): AdaptiveBotRiskRecord {
    const safeNav = Number.isFinite(nav) && nav > 0 ? nav : 0;
    const prev = this.records.get(accountId);

    if (!prev) {
      const initial: AdaptiveBotRiskRecord = {
        accountId,
        peakEquity: safeNav,
        lastEquity: safeNav,
        maxDrawdownPct: 0,
        consecutiveLossSteps: 0,
        lastRealizedPnl: realizedPnl,
        lastUpdatedSimTime: simTime,
      };
      this.records.set(accountId, initial);
      return { ...initial };
    }

    const peakEquity = Math.max(prev.peakEquity, safeNav);
    const curDrawdown =
      peakEquity > 0 && safeNav < peakEquity
        ? clamp((peakEquity - safeNav) / peakEquity, 0, 1)
        : 0;
    const equityDelta = safeNav - prev.lastEquity;
    const pnlDelta = realizedPnl - prev.lastRealizedPnl;

    let consecutiveLossSteps = prev.consecutiveLossSteps;
    if (equityDelta < -1e-6 || pnlDelta < -1e-6) {
      consecutiveLossSteps = Math.min(20, consecutiveLossSteps + 1);
    } else if (equityDelta > 1e-6 || pnlDelta > 1e-6) {
      consecutiveLossSteps = 0;
    }

    const next: AdaptiveBotRiskRecord = {
      accountId,
      peakEquity,
      lastEquity: safeNav,
      maxDrawdownPct: Math.max(prev.maxDrawdownPct, curDrawdown),
      consecutiveLossSteps,
      lastRealizedPnl: realizedPnl,
      lastUpdatedSimTime: simTime,
    };
    this.records.set(accountId, next);
    return { ...next };
  }

  public evaluateAgentRisk(
    accountId: string,
    obs: MarketObservation,
    agent: AgentAccount
  ): DrawdownRiskOutput {
    const nav =
      obs.account.nav ??
      (obs.account.cash + (obs.account.totalHoldingsValue ?? obs.account.holdingQty * obs.midPrice));
    const rec = this.records.get(accountId);
    const peakEquity = rec ? Math.max(rec.peakEquity, nav) : Math.max(1, nav);

    return computeAdaptiveRiskMultipliers({
      currentEquity: nav,
      peakEquity,
      currentPosition: obs.account.holdingQty,
      maxPosition: agent.maxPosition,
      realizedPnl: agent.stats.realizedPnl,
      consecutiveLossSteps: rec?.consecutiveLossSteps ?? 0,
      baseRiskTolerance: agent.riskTolerance,
    });
  }

  public getRecord(accountId: string): AdaptiveBotRiskRecord | undefined {
    const rec = this.records.get(accountId);
    return rec ? { ...rec } : undefined;
  }

  public snapshotState(): Array<[string, AdaptiveBotRiskRecord]> {
    return Array.from(this.records.entries()).map(([k, v]) => [k, { ...v }]);
  }

  public restoreState(snap?: ReadonlyArray<readonly [string, AdaptiveBotRiskRecord]>): void {
    this.records.clear();
    if (!Array.isArray(snap)) return;
    for (const [k, v] of snap) {
      if (k && v) {
        this.records.set(k, { ...v });
      }
    }
  }
}
