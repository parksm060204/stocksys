import { BaseAgent } from "./BaseAgent";
export declare class AdversarialAgent extends BaseAgent {
    private activePhase;
    private targetStockId;
    private inventory;
    private targetInventory;
    private phaseTicks;
    constructor();
    triggerManipulation(stockId: string, marketCap: number, currentPrice: number): void;
    executeManipulation(currentMarket: any): any[];
}
//# sourceMappingURL=AdversarialAgent.d.ts.map