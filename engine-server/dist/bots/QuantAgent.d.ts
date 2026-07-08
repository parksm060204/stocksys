import type { QuantBot } from "../types";
import { BaseAgent } from "./BaseAgent";
export declare class QuantAgent extends BaseAgent {
    private bot;
    private pendingNews;
    constructor(bot: QuantBot);
    executeQuantStrategy(currentMarket: any, orderBook: any): any[];
}
//# sourceMappingURL=QuantAgent.d.ts.map