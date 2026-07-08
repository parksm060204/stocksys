export type MarketSentiment = 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';

export interface MarketEvent {
  id: string;
  targetSector: string | 'ALL'; // 특정 섹터(예: TECH, BIO) 혹은 시장 전체
  impact: 'STRONG_POSITIVE' | 'POSITIVE' | 'NEGATIVE' | 'STRONG_NEGATIVE'; // 호재/악재 강도
  urgencyMultiplier: number; // 봇들의 긴급성(Urgency)을 얼마나 폭증시킬 것인가 (1.0 ~ 5.0)
  durationTicks: number; // 이 뉴스의 약발이 호가창에 유지되는 틱 수 (예: 60초)
}

export interface PensionFundBot {
  id: string;
  name: string;
  type: 'PENSION_FUND';
  capital: number;
  riskTolerance: number;
  tradingStyle: 'LIMIT_HEAVY';
  targetYTM: Record<string, number>;
  rebalanceIntervalMs: number;
  sectorTargets?: Record<string, number>;
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
  sectorTargets?: Record<string, number>;
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

export interface RetailSwarmBot {
  id: string;
  name: string;
  type: 'RETAIL_SWARM';
  capital: number;
  fomoThreshold: number; 
  panicThreshold: number;
  tradingStyle: 'MOMENTUM_CHASER' | 'VALUE_DIP_BUYER';
}
