import type { PropDeskBot } from "../types";
import { BaseAgent } from "./BaseAgent";
export declare class PropDeskAgent extends BaseAgent {
    private bot;
    private regressionState;
    private ofiState;
    private prevOrderBookState;
    private prevPriceState;
    private holdings;
    constructor(bot: PropDeskBot);
    executeMarketMaking(currentMarket: any, orderBook: any, myHoldings: any): any[];
    confirmExecution(assetClass: 'stock' | 'bond' | 'commodity', side: 'buy' | 'sell', filledQty: number, filledPrice: number, stockId?: string): void;
}
//# sourceMappingURL=PropDeskAgent.d.ts.map