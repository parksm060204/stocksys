import type { StatArbBot } from "../types";
import { BaseAgent } from "./BaseAgent";
export declare class StatArbAgent extends BaseAgent {
    private bot;
    private basketWeights;
    private lastKnownPrices;
    private currentNAV;
    private isInitialized;
    private virtualEtfPrice;
    private inventoryRisk;
    private readonly MAX_INVENTORY;
    constructor(bot: StatArbBot);
    /**
     * O(1) ETF NAV 업데이트 및 차익거래 실행
     */
    executeArbitrage(currentMarket: any, myHoldings: any): any[];
}
//# sourceMappingURL=StatArbAgent.d.ts.map