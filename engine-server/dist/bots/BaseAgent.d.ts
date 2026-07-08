export declare class BaseAgent {
    protected botId: string;
    protected capital: number;
    constructor(botId: string, capital: number);
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