import type { AgentConfig, AgentPortfolio, AgentWeights, MarketSentiment, MarketEvent } from '../types';
import { EventBus } from '../EventBus';

export class BaseAgent {
  public botId: string;
  public capital: number;
  public agentConfig: AgentConfig;
  public currentPortfolio: AgentPortfolio;
  public pendingNewsOrders: any[] = [];

  constructor(configOrId: any, initialCapital?: number) {
    if (typeof configOrId === 'string') {
      this.botId = configOrId;
      this.agentConfig = {} as AgentConfig;
    } else {
      this.botId = configOrId?.id || 'unknown_bot';
      this.agentConfig = configOrId || {};
    }
    
    const cap = (typeof initialCapital === 'number' && !isNaN(initialCapital))
      ? initialCapital
      : (typeof configOrId === 'object' && typeof configOrId?.capital === 'number' ? configOrId.capital : 10000000000);
      
    this.capital = cap;
    
    const weights = { ...((this.agentConfig as any).targetAllocation || this.agentConfig.baseWeights || { stock: 0, bond: 0, commodity: 0, cash: 1, kr_equity: 0, us_equity: 0, eu_equity: 0, derivatives: 0 }) };
    
    const totalEquities = (weights.stock || 0) + (weights.kr_equity || 0) + (weights.us_equity || 0) + (weights.eu_equity || 0);

    // 포트폴리오 초기화 (초기 자본금은 전부 현금, 또는 기본 비중대로 배분)
    this.currentPortfolio = {
      cash: cap * (weights.cash !== undefined ? weights.cash : Math.max(0, 1.0 - totalEquities - (weights.bond || 0) - (weights.commodity || 0) - (weights.derivatives || 0))),
      stock: cap * totalEquities,
      kr_equity: cap * (weights.kr_equity || 0.0),
      us_equity: cap * (weights.us_equity || 0.0),
      eu_equity: cap * (weights.eu_equity || 0.0),
      bond: cap * (weights.bond || 0.0),
      commodity: cap * (weights.commodity || 0.0),
      derivatives: cap * (weights.derivatives || 0.0)
    };

    // EventBus 구독: endogenous AI 뉴스 수신 시 즉각 반응
    EventBus.subscribe('news_published', (news: any) => this.handleNewsPublished(news));
  }

  /**
   * Gemini AI 뉴스 발령 시 기관 봇 즉각 리액션 주문 매칭
   */
  protected handleNewsPublished(news: any) {
    if (!news || !news.impact_score) return;

    const riskTol = this.agentConfig.riskTolerance || 1.0;
    const impact = Number(news.impact_score);
    const effectiveImpact = impact * riskTol;

    // 미세 반응 기준값 (|effectiveImpact| >= 2.0)
    if (Math.abs(effectiveImpact) < 2.0) return;

    const side = effectiveImpact > 0 ? 'buy' : 'sell';

    this.pendingNewsOrders.push({
      newsId: news.id,
      targetTicker: news.target_ticker,
      targetSector: news.target_sector,
      side,
      impact: effectiveImpact,
      timestamp: Date.now()
    });
  }

  public getPendingNewsOrders(marketState: any): any[] {
    if (this.pendingNewsOrders.length === 0) return [];
    
    const queued = [...this.pendingNewsOrders];
    this.pendingNewsOrders = [];
    const orders: any[] = [];

    for (const q of queued) {
      const allInstruments = [
        ...(marketState.stocks || []),
        ...(marketState.bonds || []),
        ...(marketState.commodities || [])
      ];

      const targets = allInstruments.filter(inst => {
        if (q.targetTicker && (inst.ticker === q.targetTicker || inst.id === q.targetTicker)) return true;
        if (q.targetSector && (inst.sector === q.targetSector || q.targetSector === 'ALL')) return true;
        return false;
      });

      for (const inst of targets.slice(0, 3)) {
        const price = inst.current_price || inst.currentPrice || 10000;
        const qty = Math.min(2000, Math.max(10, Math.floor((this.capital * 0.001 * Math.abs(q.impact)) / price)));

        if (qty > 0) {
          orders.push({
            stock_id: inst.id,
            user_id: null,
            side: q.side,
            price: q.side === 'buy' ? price * 1.01 : price * 0.99,
            size: qty,
            status: 'open',
            is_lp: true,
            _botId: this.botId
          });
        }
      }
    }

    return orders;
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
    
    // ⚠️ 마진콜 / 파산(Bankrupt) 보호: 총 자산 가치가 NaN 또는 0 이하이면 매매 중단
    if (isNaN(currentTotalValue) || currentTotalValue <= 0) {
      return orders;
    }

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

  public alignToTickSize(price: number): number {
    if (price <= 0) return 1;
    const tick = this.getTickSize(price);
    return Math.round(price / tick) * tick;
  }

  /**
   * 기관급 트레이딩 안전장치 (Institutional Risk Controls)
   * 1. Hard Limit: 1회 주문 최대 금액 5,000,000 KRW, 수량 5,000주 제한
   * 2. 호가창 깊이(LOB Depth) 대비 최대 10% 비율 제한
   * 3. 틱 단위 가격 정렬 (KRX Tick Alignment)
   */
  public applyInstitutionalRiskControls(order: any, currentPrice: number, lobDepth: number = 50000): any {
    const MAX_NOTIONAL_PER_ORDER = 5000000; // 1회 최대 500만 원
    const MAX_QTY_PER_ORDER = 5000;         // 1회 최대 5,000주
    const DEPTH_RATIO_CAP = 0.10;           // 호가창 깊이의 최대 10%

    let safeQty = Math.abs(order.size || 1);

    if (currentPrice > 0) {
      const notionalCapQty = Math.floor(MAX_NOTIONAL_PER_ORDER / currentPrice);
      safeQty = Math.min(safeQty, Math.max(1, notionalCapQty));
    }

    safeQty = Math.min(safeQty, MAX_QTY_PER_ORDER);

    if (lobDepth > 0) {
      const depthCapQty = Math.floor(lobDepth * DEPTH_RATIO_CAP);
      safeQty = Math.min(safeQty, Math.max(1, depthCapQty));
    }

    const rawPrice = order.price || currentPrice;
    const alignedPrice = this.alignToTickSize(rawPrice);

    return {
      ...order,
      price: alignedPrice,
      size: Math.max(1, Math.floor(safeQty))
    };
  }

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

    // 뉴스 이벤트 반영
    for (const event of activeEvents) {
      if (event.targetSector === 'ALL' || event.targetSector === stock.sector) {
        if ((event.impact === 'POSITIVE' || event.impact === 'STRONG_POSITIVE') && side === 'buy') {
          urgency = Math.min(1.0, urgency * event.urgencyMultiplier);
          finalTargetQty = Math.floor(finalTargetQty * event.urgencyMultiplier);
        } else if ((event.impact === 'NEGATIVE' || event.impact === 'STRONG_NEGATIVE') && side === 'sell') {
          urgency = Math.min(1.0, urgency * event.urgencyMultiplier);
          finalTargetQty = Math.floor(finalTargetQty * event.urgencyMultiplier);
        } else {
          urgency = urgency / event.urgencyMultiplier;
        }
      }
    }

    const orders: any[] = [];
    const tickSize = this.getTickSize(stock.current_price);
    const priceDiffRatio = Math.abs(stock.current_price - targetPrice) / stock.current_price;

    // 1. 긴급성 최우선 판단 -> Sweep-to-fill
    if (urgency > 0.7) {
      const sweepTicks = urgency > 0.9 ? 4 : 2; 
      for (let i = 0; i < sweepTicks; i++) {
        const sweepPrice = side === 'buy' 
          ? stock.current_price + (tickSize * i)
          : stock.current_price - (tickSize * i);
        
        const rawOrder = {
          stock_id: stock.id,
          user_id: null,
          side: side,
          price: sweepPrice,
          size: Math.floor(finalTargetQty / sweepTicks) || 1,
          status: 'open',
          is_lp: true,
          _botId: this.botId
        };
        orders.push(this.applyInstitutionalRiskControls(rawOrder, stock.current_price));
      }
      return orders;
    }

    // 2. 가격 차이 판단 -> Spoofing (허수 주문)
    if (urgency < 0.3 && priceDiffRatio > 0.01 && finalTargetQty > 1000) {
      const spoofSide = side === 'buy' ? 'sell' : 'buy';
      const tickOffset = 3 + (Math.abs(Math.floor(finalTargetQty)) % 3);
      const spoofPrice = side === 'buy'
        ? stock.current_price + (tickSize * tickOffset)
        : stock.current_price - (tickSize * tickOffset);
      
      const spoofQty = Math.min(5000, finalTargetQty * 2);

      orders.push(this.applyInstitutionalRiskControls({
        stock_id: stock.id,
        user_id: null,
        side: spoofSide,
        price: spoofPrice,
        size: spoofQty,
        status: 'open',
        is_lp: true,
        _botId: this.botId
      }, stock.current_price));

      orders.push(this.applyInstitutionalRiskControls({
        stock_id: stock.id,
        user_id: null,
        side: side,
        price: targetPrice,
        size: Math.floor(finalTargetQty * 0.05) || 1,
        status: 'open',
        is_lp: true,
        _botId: this.botId
      }, stock.current_price));
      return orders;
    }

    // 3. 수량 부담 판단 -> Iceberg (빙산 주문)
    if (finalTargetQty > 500) {
      const icebergDisplayQty = Math.max(10, Math.floor(finalTargetQty * 0.02));
      orders.push(this.applyInstitutionalRiskControls({
        stock_id: stock.id,
        user_id: null,
        side: side,
        price: targetPrice,
        size: icebergDisplayQty,
        status: 'open',
        is_lp: true,
        _botId: this.botId
      }, stock.current_price));
      return orders;
    }

    // 4. 일반적인 시장가/지정가 주문
    orders.push(this.applyInstitutionalRiskControls({
      stock_id: stock.id,
      user_id: null,
      side: side,
      price: targetPrice,
      size: finalTargetQty,
      status: 'open',
      is_lp: true,
      _botId: this.botId
    }, stock.current_price));
    
    return orders;
  }
}
