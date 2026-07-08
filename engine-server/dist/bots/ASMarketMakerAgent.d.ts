import { BaseAgent } from "./BaseAgent";
export declare class ASMarketMakerAgent extends BaseAgent {
    private inventory;
    private readonly gamma;
    private readonly k;
    private readonly sigma2;
    constructor();
    executeMarketMaking(currentMarket: any): any[];
    updateInventory(stockId: string, deltaQty: number): void;
}
//# sourceMappingURL=ASMarketMakerAgent.d.ts.map