import { BaseAgent } from './BaseAgent';
import { CommercialHedgerBot, CTABot } from '../types';
/**
 * 1. Commercial Hedger Bot (보수적 헤지 목적)
 * 실제 생산자/수요자 입장에서 가격이 임계치에 도달하면 대규모 지정가 호가벽을 세웁니다.
 */
export declare class CommercialHedgerAgent extends BaseAgent {
    readonly config: CommercialHedgerBot;
    constructor(config: CommercialHedgerBot);
    executeHedging(commodityPrice: number, commodityId: string, tickSize: number): any[];
}
/**
 * 2. CTA Bot (Commodity Trading Advisor, 돌파형 추세추종)
 * 가격 모멘텀이 터질 때 시장가로 밀어붙여 추세를 가속화합니다.
 */
export declare class CTAAgent extends BaseAgent {
    readonly config: CTABot;
    private priceHistory;
    constructor(config: CTABot);
    executeMomentum(commodityPrice: number, commodityId: string, tickSize: number, activeEvents?: any[]): any[];
    protected getTickSize(price: number): number;
}
//# sourceMappingURL=CommodityBots.d.ts.map