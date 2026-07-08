import type { PropDeskBot } from "../types";
import { BaseAgent } from "./BaseAgent";
export declare class PropDeskAgent extends BaseAgent {
    private bot;
    private regressionState;
    private ofiState;
    private prevOrderBookState;
    private prevPriceState;
    constructor(bot: PropDeskBot);
    executeMarketMaking(currentMarket: any, orderBook: any, myHoldings: any): any[];
}
//# sourceMappingURL=PropDeskAgent.d.ts.map