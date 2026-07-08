export class BaseAgent {
  protected botId: string;
  protected capital: number;

  constructor(botId: string, capital: number) {
    this.botId = botId;
    this.capital = capital;
  }

  protected getTickSize(price: number): number {
    if (price < 2000) return 1;
    if (price < 5000) return 5;
    if (price < 20000) return 10;
    if (price < 50000) return 50;
    if (price < 200000) return 100;
    if (price < 500000) return 500;
    return 1000;
  }

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
  protected executeSmartOrder(
    stock: any, 
    side: 'buy' | 'sell', 
    targetPrice: number, 
    targetQty: number, 
    baseUrgency: number,
    activeEvents: any[] = []
  ) {
    let urgency = baseUrgency;
    let finalTargetQty = targetQty;

    // 뉴스 이벤트(Gemini 발작 로직) 반영
    for (const event of activeEvents) {
      if (event.targetSector === 'ALL' || event.targetSector === stock.sector) {
        // 호재인데 매수하려거나 악재인데 매도하려는 경우 긴급성 대폭 증폭
        if ((event.impact === 'POSITIVE' || event.impact === 'STRONG_POSITIVE') && side === 'buy') {
          urgency = Math.min(1.0, urgency * event.urgencyMultiplier);
          finalTargetQty = Math.floor(finalTargetQty * event.urgencyMultiplier); // 물량도 증폭
        } else if ((event.impact === 'NEGATIVE' || event.impact === 'STRONG_NEGATIVE') && side === 'sell') {
          urgency = Math.min(1.0, urgency * event.urgencyMultiplier);
          finalTargetQty = Math.floor(finalTargetQty * event.urgencyMultiplier);
        } else {
          // 뉴스 방향과 반대 행동 중일 때는 긴급성을 대폭 낮춤 (예: 호재인데 팔려던 물량은 천천히 팜)
          urgency = urgency / event.urgencyMultiplier;
        }
      }
    }

    const orders: any[] = [];
    const tickSize = this.getTickSize(stock.current_price);
    const priceDiffRatio = Math.abs(stock.current_price - targetPrice) / stock.current_price;

    // 1. 긴급성(Urgency) 최우선 판단 -> Sweep-to-fill
    if (urgency > 0.7) {
      const sweepTicks = urgency > 0.9 ? 4 : 2; 
      for (let i = 0; i < sweepTicks; i++) {
        const sweepPrice = side === 'buy' 
          ? stock.current_price + (tickSize * i)
          : stock.current_price - (tickSize * i);
        
        orders.push({
          stock_id: stock.id,
          user_id: null,
          side: side,
          price: sweepPrice,
          size: Math.floor(finalTargetQty / sweepTicks) || 1,
          status: 'open',
          is_lp: true
        });
      }
      return orders;
    }

    // 2. 가격 차이 판단 -> Spoofing (허수 주문)
    // 당장 급하지 않은데(urgency 낮음), 현재가와 내 목표가가 차이가 좀 난다(예: 더 싸게 사고 싶음)
    // 그리고 내 목표 물량이 크다면, 허수 벽을 세워서 개미를 위협하는 것이 합리적임
    if (urgency < 0.3 && priceDiffRatio > 0.01 && finalTargetQty > 1000) {
      // 내가 싸게 사고 싶다(Buy) -> 개미들이 팔게 만들어야 함 -> 위에다 가짜 거대 매도벽을 세움
      const spoofSide = side === 'buy' ? 'sell' : 'buy';
      const spoofPrice = side === 'buy'
        ? stock.current_price + (tickSize * (Math.floor(Math.random() * 3) + 3)) // 3~5틱 위 가짜 매도벽
        : stock.current_price - (tickSize * (Math.floor(Math.random() * 3) + 3)); // 3~5틱 아래 가짜 매수벽
      
      const spoofQty = finalTargetQty * 5; // 내 진짜 목표 물량보다 훨씬 거대하게 위협용으로 설정

      // 스푸핑 허수 주문 (엔진 틱마다 지워지므로 안전)
      orders.push({
        stock_id: stock.id,
        user_id: null,
        side: spoofSide,
        price: spoofPrice,
        size: spoofQty,
        status: 'open',
        is_lp: true
      });

      // 허수 주문을 깔아두고, 진짜 내 목표가에는 빙산주문처럼 작게 리필 대기
      orders.push({
        stock_id: stock.id,
        user_id: null,
        side: side,
        price: targetPrice,
        size: Math.floor(finalTargetQty * 0.05) || 1,
        status: 'open',
        is_lp: true
      });
      return orders;
    }

    // 3. 수량 부담 판단 -> Iceberg (빙산 주문)
    // 급하진 않고 현재가 근처에서 사고 싶은데 수량이 너무 많다 -> 빙산 주문
    if (finalTargetQty > 500) {
      const icebergDisplayQty = Math.max(10, Math.floor(finalTargetQty * 0.02)); // 전체 물량의 2%만 노출
      orders.push({
        stock_id: stock.id,
        user_id: null,
        side: side,
        price: targetPrice,
        size: icebergDisplayQty,
        status: 'open',
        is_lp: true
      });
      return orders;
    }

    // 4. 일반적인 시장가/지정가 주문
    // 특이 사항 없는 작은 주문은 그냥 현재가에 던짐
    orders.push({
      stock_id: stock.id,
      user_id: null,
      side: side,
      price: targetPrice,
      size: finalTargetQty,
      status: 'open',
      is_lp: true
    });
    
    return orders;
  }
}
