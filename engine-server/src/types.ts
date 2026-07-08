export type MarketSentiment = 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';

export interface MarketEvent {
  id: string;
  targetSector: string | 'ALL'; // 특정 섹터(예: TECH, BIO) 혹은 시장 전체
  impact: 'STRONG_POSITIVE' | 'POSITIVE' | 'NEGATIVE' | 'STRONG_NEGATIVE'; // 호재/악재 강도
  urgencyMultiplier: number; // 봇들의 긴급성(Urgency)을 얼마나 폭증시킬 것인가 (1.0 ~ 5.0)
  durationTicks: number; // 이 뉴스의 약발이 호가창에 유지되는 틱 수 (예: 60초)
  reliability?: number; // 신뢰도 0.0 ~ 1.0 (찌라시 여부)
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

export interface StatArbBot {
  id: string;
  name: string;
  type: 'STAT_ARB';
  capital: number;
  reactionSpeed: number;
  tradingStyle: 'ARBITRAGE';
  basketTarget: string; // e.g. "TECH_TOP3"
  transCostThreshold: number; // C_trans
}

export interface OptionsMMBot {
  id: string;
  name: string;
  type: 'OPTIONS_MM';
  capital: number;
  reactionSpeed: number;
  tradingStyle: 'DELTA_NEUTRAL';
  initialGammaNet: number; // 초기 숏 감마/롱 감마 노출도
}

export interface QuantBot {
  id: string;
  name: string;
  type: 'QUANT_FUND';
  capital: number;
  reactionSpeed: number;
  tradingStyle: 'INFORMED_TRADER';
}
