import type { PensionFundBot } from "../types";
import { BaseAgent } from "./BaseAgent";
export declare class PensionFundAgent extends BaseAgent {
    readonly config: PensionFundBot;
    private executionState;
    constructor(bot: PensionFundBot);
    private calculatePriceFromYTM;
    evaluateMarketAndPlaceOrders(currentMarket: any, isCreditCrunch?: boolean): any[];
}
//# sourceMappingURL=PensionFundAgent.d.ts.map