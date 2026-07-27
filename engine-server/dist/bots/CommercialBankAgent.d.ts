import type { CommercialBankBot } from "../types";
import { BaseAgent } from "./BaseAgent";
export declare class CommercialBankAgent extends BaseAgent {
    private bot;
    constructor(bot: CommercialBankBot);
    private calculatePriceFromYTM;
    executeArbitrage(currentMarket: any, adminBaseRate: number): any[];
}
//# sourceMappingURL=CommercialBankAgent.d.ts.map