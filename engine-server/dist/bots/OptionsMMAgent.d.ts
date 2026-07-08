import type { OptionsMMBot } from "../types";
import { BaseAgent } from "./BaseAgent";
export declare class OptionsMMAgent extends BaseAgent {
    private bot;
    private gammaGrid;
    private lastPriceState;
    constructor(bot: OptionsMMBot);
    /**
     * 사전 계산된 정규분포(Bell Curve) 근사값을 통해 O(1)로 감마를 참조합니다.
     * 실제 블랙-숄즈 대신, ATM(행사가)에서 가장 높고 OTM/ITM에서 0으로 수렴하는 가우시안 커널을 사용합니다.
     */
    private getGamma;
    executeDeltaHedging(currentMarket: any, orderBook: any): any[];
}
//# sourceMappingURL=OptionsMMAgent.d.ts.map