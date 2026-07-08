export type MarketSentiment = 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
export interface MarketEvent {
    id: string;
    targetSector: string | 'ALL';
    impact: 'STRONG_POSITIVE' | 'POSITIVE' | 'NEGATIVE' | 'STRONG_NEGATIVE';
    urgencyMultiplier: number;
    durationTicks: number;
    reliability?: number;
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
    basketTarget: string;
    transCostThreshold: number;
}
export interface OptionsMMBot {
    id: string;
    name: string;
    type: 'OPTIONS_MM';
    capital: number;
    reactionSpeed: number;
    tradingStyle: 'DELTA_NEUTRAL';
    initialGammaNet: number;
}
export interface QuantBot {
    id: string;
    name: string;
    type: 'QUANT_FUND';
    capital: number;
    reactionSpeed: number;
    tradingStyle: 'INFORMED_TRADER';
}
//# sourceMappingURL=types.d.ts.map