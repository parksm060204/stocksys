import type { AgentConfig, AgentPortfolio, AgentWeights, MarketSentiment, MarketEvent } from '../types';
export declare class BaseAgent {
    botId: string;
    capital: number;
    agentConfig: AgentConfig;
    currentPortfolio: AgentPortfolio;
    constructor(configOrId: any, initialCapital: number);
    /**
     * 2. 최상위 가중치 결정 로직 (CIO Logic)
     * 현재 매크로 상태와 봇 성향을 기반으로 최적의 포트폴리오 비중 산출
     */
    calculateTargetWeights(sentiment: MarketSentiment, activeEvents: MarketEvent[]): AgentWeights;
    /**
     * 3. 포트폴리오 평가 및 분할 집행 (Execution Logic: TWAP)
     * 목표 비중과 현재 포트폴리오를 비교하여 델타 산출 후 분할 매매 주문 반환
     * ⚠️ 중요: 이 함수는 주문 객체만 반환하며, 포트폴리오 상태를 절대 직접 수정하지 않습니다.
     *          실제 체결 후 MarketEngine에서 confirmExecution()을 호출해야 합니다.
     */
    executePortfolioRebalancing(marketState: any): any[];
    /**
     * 실제 체결(Matching) 완료 후 MarketEngine에서 호출하는 포트폴리오 업데이트 함수
     * Optimistic Update(선반영)를 완전히 대체합니다.
     *
     * @param assetClass 체결된 자산 유형 ('stock' | 'bond' | 'commodity')
     * @param side 체결 방향 ('buy' | 'sell')
     * @param filledQty 실제 체결된 수량
     * @param filledPrice 실제 체결 단가
     */
    confirmExecution(assetClass: 'stock' | 'bond' | 'commodity', side: 'buy' | 'sell', filledQty: number, filledPrice: number, stockId?: string): void;
    protected getTickSize(price: number): number;
    /**
     * 상황(맥락)에 기반하여 자연스럽게 가장 합리적인 매매 기법을 선택하여 주문 배열을 반환합니다.
     *
     * @param stock 대상 주식 객체
     * @param side 'buy' or 'sell'
     * @param targetPrice 내가 원하는 체결 목표가 (스푸핑의 기준이 됨)
     * @param targetQty 내가 사고/팔고자 하는 총 목표 수량 (빙산 주문의 기준이 됨)
     * @param urgency 긴급성 (0~1). 1에 가까울수록 손해를 보더라도 즉시 체결(스윕)을 원함
     * @param activeEvents 현재 발동 중인 뉴스 이벤트 배열
     */
    protected executeSmartOrder(stock: any, side: 'buy' | 'sell', targetPrice: number, targetQty: number, baseUrgency: number, activeEvents?: any[]): any[];
}
//# sourceMappingURL=BaseAgent.d.ts.map