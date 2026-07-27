import { BaseAgent } from "./BaseAgent";
export declare class WallBreakerAgent extends BaseAgent {
    private huntCooldowns;
    constructor();
    executeGammaSqueezeHunt(tickInfo: {
        hour: number;
    }, currentPrices: Record<string, number>, optionsData: any[]): any[];
}
//# sourceMappingURL=WallBreakerAgent.d.ts.map