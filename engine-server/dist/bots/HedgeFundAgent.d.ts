import type { HedgeFundBot, MarketSentiment } from "../types";
import { BaseAgent } from "./BaseAgent";
export declare class HedgeFundAgent extends BaseAgent {
    private bot;
    private balanceSheet;
    constructor(bot: HedgeFundBot);
    updateSentiment(newSentiment: MarketSentiment): void;
    private rebalancePortfolio;
    private priceHistory;
    executeAggressiveSweep(currentMarket: any): any[];
}
//# sourceMappingURL=HedgeFundAgent.d.ts.map