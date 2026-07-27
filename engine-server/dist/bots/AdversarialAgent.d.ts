import { BaseAgent } from "./BaseAgent";
export declare class AdversarialAgent extends BaseAgent {
    id: string;
    private lobHistory;
    constructor();
    protected getTickSize(price: number): number;
    triggerManipulation(stockId: string, marketCap: number, currentPrice: number): void;
    executeManipulation(marketState: any): any[];
    executeFrontRunning(stockId: string, currentLOB: {
        bestBidPrice: number;
        bestBidVol: number;
        bestAskPrice: number;
        bestAskVol: number;
    }): any[];
}
//# sourceMappingURL=AdversarialAgent.d.ts.map