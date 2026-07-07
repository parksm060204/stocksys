export type MarketSentiment = 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';

export interface PensionFundBot {
  id: string;
  name: string;
  type: 'PENSION_FUND';
  capital: number;
  riskTolerance: number;
  tradingStyle: 'LIMIT_HEAVY';
  targetYTM: Record<string, number>;
  rebalanceIntervalMs: number;
}

export interface CommercialBankBot {
  id: string;
  name: string;
  type: 'COMMERCIAL_BANK';
  capital: number;
  reactionSpeed: number;
  tradingStyle: 'SWEEP_AGGRESSIVE';
  targetSpread: Record<string, number>;
  cooldownMs?: number;
  lastSweepTime?: number;
}

export interface HedgeFundBot {
  id: string;
  name: string;
  type: 'HEDGE_FUND';
  capital: number;
  reactionSpeed: number;
  tradingStyle: 'SWEEP_AGGRESSIVE';
  portfolioTarget: {
    equity: number;
    safeBonds: number;
    highYield: number;
  };
  currentSentiment: MarketSentiment;
}

export interface PropDeskBot {
  id: string;
  name: string;
  type: 'PROP_DESK';
  capital: number;
  reactionSpeed: number;
  tradingStyle: 'MARKET_MAKER';
  mmConfig: {
    maxInventory: number;
    targetSpreadHoga: number;
    tickProfitTarget: number;
  };
}
