import type { AgentConfig, AgentPortfolio, AgentWeights, MarketSentiment, MarketEvent } from '../types';

export class BaseAgent {
  public botId: string;
  public capital: number;
  public agentConfig: AgentConfig;
  public currentPortfolio: AgentPortfolio;

  constructor(configOrId: any, initialCapital: number) {
    if (typeof configOrId === 'string') {
      this.botId = configOrId;
      this.agentConfig = {} as AgentConfig;
    } else {
      this.botId = configOrId.id;
      this.agentConfig = configOrId;
    }
    this.capital = initialCapital;
    
    const weights = { ...((this.agentConfig as any).targetAllocation || this.agentConfig.baseWeights || { stock: 0, bond: 0, commodity: 0, cash: 1, kr_equity: 0, us_equity: 0, eu_equity: 0, derivatives: 0 }) };
    
    const totalEquities = (weights.stock || 0) + (weights.kr_equity || 0) + (weights.us_equity || 0) + (weights.eu_equity || 0);

    // 포트폴리오 초기화 (초기 자본금은 전부 현금, 또는 기본 비중대로 배분)
    this.currentPortfolio = {
      cash: initialCapital * (weights.cash !== undefined ? weights.cash : 1.0 - totalEquities - (weights.bond || 0) - (weights.commodity || 0) - (weights.derivatives || 0)),
      stock: initialCapital * totalEquities,
      kr_equity: initialCapital * (weights.kr_equity || 0.0),
      us_equity: initialCapital * (weights.us_equity || 0.0),
      eu_equity: initialCapital * (weights.eu_equity || 0.0),
      bond: initialCapital * (weights.bond || 0.0),
      commodity: initialCapital * (weights.commodity || 0.0),
      derivatives: initialCapital * (weights.derivatives || 0.0)
    };
  }

  /**
   * 2. 최상위 가중치 결정 로직 (CIO Logic)
   * 현재 매크로 상태와 봇 성향을 기반으로 최적의 포트폴리오 비중 산출
   */
  public calculateTargetWeights(sentiment: MarketSentiment, activeEvents: MarketEvent[]): AgentWeights {
    let target = { ...((this.agentConfig as any).targetAllocation || this.agentConfig.baseWeights || { stock: 0, bond: 0, commodity: 0, cash: 1 }) };

    // 활성 이벤트(인플레이션 등)에 따른 레짐 쉬프트
    if (this.agentConfig.regimeShifts) {
      for (const event of activeEvents) {
        if (event.id === 'INFLATION_SHOCK' && this.agentConfig.regimeShifts['INFLATION']) {
          target = { ...this.agentConfig.regimeShifts['INFLATION'] };
        } else if (event.id === 'DEFLATION_SHOCK' && this.agentConfig.regimeShifts['DEFLATION']) {
          target = { ...this.agentConfig.regimeShifts['DEFLATION'] };
        } else if (event.id === 'MARKET_CRASH' && this.agentConfig.regimeShifts['CRASH']) {
          target = { ...this.agentConfig.regimeShifts['CRASH'] };
        }
      }

      // VIX 기반 Sentiment 연동 (패닉 상태)
      if (sentiment === 'RISK_OFF' && this.agentConfig.regimeShifts['PANIC']) {
        target = { ...this.agentConfig.regimeShifts['PANIC'] };
      }
    }

    // 리스크 선호도에 따른 미세 조정
    if (this.agentConfig.riskTolerance > 1.0) {
      // 위험 자산 비중 확대
      const boost = (this.agentConfig.riskTolerance - 1.0) * 0.1;
      const totalEquities = (target.stock || 0) + (target.kr_equity || 0) + (target.us_equity || 0) + (target.eu_equity || 0);
      if (totalEquities > 0) {
        if (target.stock > 0) target.stock += boost;
        if (target.kr_equity > 0) target.kr_equity += boost * (target.kr_equity / totalEquities);
        if (target.us_equity > 0) target.us_equity += boost * (target.us_equity / totalEquities);
        if (target.eu_equity > 0) target.eu_equity += boost * (target.eu_equity / totalEquities);
      }
      if (target.commodity > 0) target.commodity += boost;
      target.bond -= boost;
      target.cash -= boost;
    } else if (this.agentConfig.riskTolerance < 1.0 && this.agentConfig.riskTolerance !== undefined) {
      // 안전 자산 비중 확대
      const boost = (1.0 - this.agentConfig.riskTolerance) * 0.1;
      target.bond += boost;
      target.cash += boost;
      const totalEquities = (target.stock || 0) + (target.kr_equity || 0) + (target.us_equity || 0) + (target.eu_equity || 0);
      if (totalEquities > 0) {
        if (target.stock > 0) target.stock -= boost;
        if (target.kr_equity > 0) target.kr_equity -= boost * (target.kr_equity / totalEquities);
        if (target.us_equity > 0) target.us_equity -= boost * (target.us_equity / totalEquities);
        if (target.eu_equity > 0) target.eu_equity -= boost * (target.eu_equity / totalEquities);
      }
      if (target.commodity > 0) target.commodity -= boost;
    }

    // Normalize
    const totalEquities = (target.stock || 0) + (target.kr_equity || 0) + (target.us_equity || 0) + (target.eu_equity || 0);
    const total = totalEquities + target.bond + target.commodity + target.cash;
    if (total > 0) {
      target.stock = totalEquities / total;
      target.bond /= total;
      target.commodity /= total;
      target.cash /= total;
      if (target.kr_equity) target.kr_equity /= total;
      if (target.us_equity) target.us_equity /= total;
      if (target.eu_equity) target.eu_equity /= total;
    }

    return target;
  }

  /**
   * 3. 포트폴리오 평가 및 분할 집행 (Execution Logic: TWAP)
   * 목표 비중과 현재 포트폴리오를 비교하여 델타 산출 후 분할 매매 주문 반환
   * ⚠️ 중요: 이 함수는 주문 객체만 반환하며, 포트폴리오 상태를 절대 직접 수정하지 않습니다.
   *          실제 체결 후 MarketEngine에서 confirmExecution()을 호출해야 합니다.
   */
  public executePortfolioRebalancing(marketState: any): any[] {
    const orders: any[] = [];
    
    // 1. 현재 자산 가치 평가 (Mark-to-Market)
    const currentTotalValue = this.currentPortfolio.cash + this.currentPortfolio.stock + this.currentPortfolio.bond + this.currentPortfolio.commodity;
    
    // 2. 목표 비중 산출
    const targetWeights = this.calculateTargetWeights(marketState.sentiment, marketState.activeEvents);
    
    // 3. 자산군별 델타(매수/매도 필요 금액) 계산
    const deltaStock = (currentTotalValue * (targetWeights.stock || 0)) - this.currentPortfolio.stock;
    const deltaBond = (currentTotalValue * targetWeights.bond) - this.currentPortfolio.bond;
    const deltaCommodity = (currentTotalValue * targetWeights.commodity) - this.currentPortfolio.commodity;

    // 4. TWAP 분할 비율 산정 (executionStyle에 따라 이번 틱에 던질 물량 비율 결정)
    let twapRatio = 0.05; // 기본 5%
    if (this.agentConfig.executionStyle === 'AGGRESSIVE_MARKET') twapRatio = 0.20; // 20%씩 공격적
    if (this.agentConfig.executionStyle === 'HFT_LIMIT') twapRatio = 0.10; // 10%
    if (this.agentConfig.executionStyle === 'PASSIVE_TWAP') twapRatio = 0.02; // 2%씩 천천히

    // 5. 종목 선정 및 주문 생성
    // 주식 거래
    if (Math.abs(deltaStock) > 10000 && marketState.stocks?.length > 0) {
      const stockDelta = deltaStock / marketState.stocks.length;
      for (const stock of marketState.stocks) {
        const targetQty = Math.floor(Math.abs(stockDelta) * twapRatio / stock.current_price);
        if (targetQty > 0) {
          const side = stockDelta > 0 ? 'buy' : 'sell';
          orders.push(...this.executeSmartOrder(stock, side, stock.current_price, targetQty, twapRatio * 5, marketState.activeEvents));
          // ✅ 포트폴리오 선반영 제거: 실제 체결 후 confirmExecution()에서만 업데이트
        }
      }
    }

    // 채권 거래
    if (Math.abs(deltaBond) > 10000 && marketState.bonds?.length > 0) {
      const bondDelta = deltaBond / marketState.bonds.length;
      for (const bond of marketState.bonds) {
        const targetQty = Math.floor(Math.abs(bondDelta) * twapRatio / bond.current_price);
        if (targetQty > 0) {
          const side = bondDelta > 0 ? 'buy' : 'sell';
          orders.push(...this.executeSmartOrder(bond, side, bond.current_price, targetQty, twapRatio * 5, marketState.activeEvents));
          // ✅ 포트폴리오 선반영 제거
        }
      }
    }

    // 원자재 거래
    if (Math.abs(deltaCommodity) > 10000 && marketState.commodities?.length > 0) {
      const commodityDelta = deltaCommodity / marketState.commodities.length;
      for (const commodity of marketState.commodities) {
        const targetQty = Math.floor(Math.abs(commodityDelta) * twapRatio / commodity.current_price);
        if (targetQty > 0) {
          const side = commodityDelta > 0 ? 'buy' : 'sell';
          orders.push(...this.executeSmartOrder(commodity, side, commodity.current_price, targetQty, twapRatio * 5, marketState.activeEvents));
          // ✅ 포트폴리오 선반영 제거
        }
      }
    }

    return orders;
  }

  /**
   * 실제 체결(Matching) 완료 후 MarketEngine에서 호출하는 포트폴리오 업데이트 함수
   * Optimistic Update(선반영)를 완전히 대체합니다.
   * 
   * @param assetClass 체결된 자산 유형 ('stock' | 'bond' | 'commodity')
   * @param side 체결 방향 ('buy' | 'sell')
   * @param filledQty 실제 체결된 수량
   * @param filledPrice 실제 체결 단가
   */
  public confirmExecution(assetClass: 'stock' | 'bond' | 'commodity', side: 'buy' | 'sell', filledQty: number, filledPrice: number, stockId?: string) {
    const notional = filledQty * filledPrice;
    if (side === 'buy') {
      this.currentPortfolio.cash = Math.max(0, this.currentPortfolio.cash - notional);
      this.currentPortfolio[assetClass] += notional;
    } else {
      this.currentPortfolio[assetClass] = Math.max(0, this.currentPortfolio[assetClass] - notional);
      this.currentPortfolio.cash += notional;
    }
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
          is_lp: true,
          _botId: this.botId
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

      orders.push({
        stock_id: stock.id,
        user_id: null,
        side: spoofSide,
        price: spoofPrice,
        size: spoofQty,
        status: 'open',
        is_lp: true,
        _botId: this.botId
      });

      // 허수 주문을 깔아두고, 진짜 내 목표가에는 빙산주문처럼 작게 리필 대기
      orders.push({
        stock_id: stock.id,
        user_id: null,
        side: side,
        price: targetPrice,
        size: Math.floor(finalTargetQty * 0.05) || 1,
        status: 'open',
        is_lp: true,
        _botId: this.botId
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
        is_lp: true,
        _botId: this.botId
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
      is_lp: true,
      _botId: this.botId
    });
    
    return orders;
  }
}
