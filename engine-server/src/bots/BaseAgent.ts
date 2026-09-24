import type { AgentConfig, AgentPortfolio, AgentWeights, MarketSentiment, MarketEvent } from '../types';
import { EventBus } from '../EventBus';
import { applyLegacyChildOrderSafetyLimits, getLegacyTickSize, alignToLegacyTickSize } from '../risk/legacyOrderSafety';
import { isMarketAbuseScenarioEnabled } from '../simulation/featureFlags';
import {
  SimulationContext,
  SimulationRandomSource,
  SimulationTimeSource,
  createSimulationContext
} from '../../../lib/engine/simulation/runtime';

export class BaseAgent {
  public botId: string;
  public capital: number;
  public agentConfig: AgentConfig;
  public currentPortfolio: AgentPortfolio;
  public pendingNewsOrders: any[] = [];

  // ── Simulation Context (Deterministic PRNG & Virtual Clock) ──
  public readonly context: SimulationContext;
  public readonly random: SimulationRandomSource;
  public readonly clock: SimulationTimeSource;

  // ── HFT Microstructure 상태 추적 ──
  public icebergReserves: Map<string, { side: 'buy' | 'sell'; price: number; remainingQty: number; sliceQty: number }> = new Map();
  public activeSpoofOrders: Array<{ orderId: string; stockId: string; side: 'buy' | 'sell'; price: number; tickCreated: number }> = [];
  public ordersToCancel: string[] = [];

  constructor(configOrId: any, initialCapital?: number, context?: SimulationContext) {
    if (typeof configOrId === 'string') {
      this.botId = configOrId;
      this.agentConfig = {} as AgentConfig;
    } else {
      this.botId = configOrId?.id || 'unknown_bot';
      this.agentConfig = configOrId || {};
    }

    // Context & Seeded Stream Initializer
    this.context = context || createSimulationContext();
    this.random = this.context.random.fork(this.botId);
    this.clock = this.context.clock;
    
    const cap = (typeof initialCapital === 'number' && !isNaN(initialCapital))
      ? initialCapital
      : (typeof configOrId === 'object' && typeof configOrId?.capital === 'number' ? configOrId.capital : 10000000000);
      
    this.capital = cap;
    
    const rawWeights = { ...((this.agentConfig as any).targetAllocation || (this.agentConfig as any).baseWeights || {}) };
    const krW = Number(rawWeights.kr_equity || 0);
    const usW = Number(rawWeights.us_equity || 0);
    const euW = Number(rawWeights.eu_equity || 0);
    const stockW = Number(rawWeights.stock || (krW + usW + euW));
    const bondW = Number(rawWeights.bond || 0);
    const commW = Number(rawWeights.commodity || 0);
    const derivW = Number(rawWeights.derivatives || 0);
    const cashW = rawWeights.cash !== undefined ? Number(rawWeights.cash) : Math.max(0.05, 1.0 - stockW - bondW - commW - derivW);

    const totalW = stockW + bondW + commW + derivW + cashW || 1.0;

    // 포트폴리오 초기화 (초기 자본금은 타겟 비중대로 적절히 배분)
    this.currentPortfolio = {
      cash: cap * (cashW / totalW),
      stock: cap * (stockW / totalW),
      kr_equity: cap * (krW > 0 ? krW / totalW : (stockW * 0.5) / totalW),
      us_equity: cap * (usW > 0 ? usW / totalW : (stockW * 0.5) / totalW),
      eu_equity: cap * (euW > 0 ? euW / totalW : 0),
      bond: cap * (bondW / totalW),
      commodity: cap * (commW / totalW),
      derivatives: cap * (derivW / totalW)
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
      timestamp: this.clock.now()
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

    // 주식 비중 일원화: 지역별 비중(kr+us+eu)이 존재하면 우선 합산하고, stock과의 이중 계산을 차단
    const regionalEquities = (target.kr_equity || 0) + (target.us_equity || 0) + (target.eu_equity || 0);
    if (regionalEquities > 0) {
      target.stock = regionalEquities;
    } else if ((target.stock || 0) > 0) {
      // 레거시 stock 단일 비중만 존재할 경우 5:3:2 비율로 기본 분배
      target.kr_equity = (target.stock || 0) * 0.5;
      target.us_equity = (target.stock || 0) * 0.3;
      target.eu_equity = (target.stock || 0) * 0.2;
    }

    // 리스크 선호도에 따른 미세 조정
    if (this.agentConfig.riskTolerance > 1.0) {
      // 위험 자산 비중 확대
      const boost = (this.agentConfig.riskTolerance - 1.0) * 0.1;
      const totalEquities = (target.kr_equity || 0) + (target.us_equity || 0) + (target.eu_equity || 0);
      if (totalEquities > 0) {
        if (target.kr_equity) target.kr_equity += boost * (target.kr_equity / totalEquities);
        if (target.us_equity) target.us_equity += boost * (target.us_equity / totalEquities);
        if (target.eu_equity) target.eu_equity += boost * (target.eu_equity / totalEquities);
        target.stock = (target.kr_equity || 0) + (target.us_equity || 0) + (target.eu_equity || 0);
      }
      if (target.commodity > 0) target.commodity += boost;
      target.bond -= boost;
      target.cash -= boost;
    } else if (this.agentConfig.riskTolerance < 1.0 && this.agentConfig.riskTolerance !== undefined) {
      // 안전 자산 비중 확대
      const boost = (1.0 - this.agentConfig.riskTolerance) * 0.1;
      target.bond += boost;
      target.cash += boost;
      const totalEquities = (target.kr_equity || 0) + (target.us_equity || 0) + (target.eu_equity || 0);
      if (totalEquities > 0) {
        if (target.kr_equity) target.kr_equity = Math.max(0, target.kr_equity - boost * (target.kr_equity / totalEquities));
        if (target.us_equity) target.us_equity = Math.max(0, target.us_equity - boost * (target.us_equity / totalEquities));
        if (target.eu_equity) target.eu_equity = Math.max(0, target.eu_equity - boost * (target.eu_equity / totalEquities));
        target.stock = (target.kr_equity || 0) + (target.us_equity || 0) + (target.eu_equity || 0);
      }
      if (target.commodity > 0) target.commodity = Math.max(0, target.commodity - boost);
    }

    // Normalize (전체 합계 = 1.0 보장, 주식 이중합산 방지)
    const totalEquities = (target.kr_equity || 0) + (target.us_equity || 0) + (target.eu_equity || 0);
    const total = totalEquities + target.bond + target.commodity + target.cash;
    if (total > 0) {
      target.bond /= total;
      target.commodity /= total;
      target.cash /= total;
      if (target.kr_equity) target.kr_equity /= total;
      if (target.us_equity) target.us_equity /= total;
      if (target.eu_equity) target.eu_equity /= total;
      target.stock = (target.kr_equity || 0) + (target.us_equity || 0) + (target.eu_equity || 0);
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
  public confirmExecution(assetClass: 'stock' | 'bond' | 'commodity', side: 'buy' | 'sell', filledQty: number, filledPrice: number, _stockId?: string) {
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
    return getLegacyTickSize(price);
  }

  public alignToTickSize(price: number): number {
    return alignToLegacyTickSize(price);
  }

  /**
   * 기관급 트레이딩 안전장치 (Institutional Risk Controls)
   * 1. Hard Limit: 1회 주문 최대 금액 5,000,000 KRW, 수량 5,000주 제한
   * 2. 호가창 깊이(LOB Depth) 대비 최대 10% 비율 제한
   * 3. 틱 단위 가격 정렬 (KRX Tick Alignment)
   * -> Canonical module `legacyOrderSafety.ts`로 중앙화됨
   */
  public applyInstitutionalRiskControls(order: any, currentPrice: number, lobDepth: number = 50000): any {
    return applyLegacyChildOrderSafetyLimits(order, currentPrice, lobDepth);
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

    // 2. 가격 차이 판단 -> Spoofing (허수 주문) - 시장조작 격리 플래그 검사 (정상 상태에서는 비활성화)
    if (isMarketAbuseScenarioEnabled() && urgency < 0.3 && priceDiffRatio > 0.01 && finalTargetQty > 1000) {
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

  // =========================================================================
  // 🧠 HFT Strategy 1: 빙산 주문(Iceberg Order) 및 무한 리필 교착 상태 구축
  // =========================================================================
  public placeIcebergOrder(
    stock: any,
    side: 'buy' | 'sell',
    price: number,
    totalTargetQty: number,
    displaySliceQty: number = 2000
  ): any {
    const alignedPrice = this.alignToTickSize(price);
    const key = `${stock.id}_${side}_${alignedPrice}`;
    let reserve = this.icebergReserves.get(key);

    if (!reserve || reserve.remainingQty <= 0) {
      reserve = {
        side,
        price: alignedPrice,
        remainingQty: totalTargetQty,
        sliceQty: displaySliceQty
      };
      this.icebergReserves.set(key, reserve);
    }

    const currentDisplay = Math.min(reserve.remainingQty, reserve.sliceQty);
    reserve.remainingQty -= currentDisplay;

    return this.applyInstitutionalRiskControls({
      stock_id: stock.id,
      user_id: null,
      side,
      price: alignedPrice,
      size: currentDisplay,
      status: 'open',
      is_lp: true,
      is_iceberg: true,
      _botId: this.botId
    }, stock.current_price);
  }

  // =========================================================================
  // 🧠 HFT Strategy 2: 스푸핑 & 레이어링 (가짜 대형벽 깔고 취소하기)
  // =========================================================================
  public executeSpoofLayering(
    stock: any,
    side: 'buy' | 'sell',
    offsetTicks: number = 2,
    multiplier: number = 8.0,
    currentTick: number = 0
  ): any | null {
    if (!isMarketAbuseScenarioEnabled()) {
      return null;
    }
    const tickSize = this.getTickSize(stock.current_price);
    const spoofPrice = side === 'buy'
      ? this.alignToTickSize(stock.current_price - offsetTicks * tickSize)
      : this.alignToTickSize(stock.current_price + offsetTicks * tickSize);

    const baseQty = Math.max(500, Math.floor((this.capital * 0.03) / stock.current_price));
    const spoofQty = Math.floor(baseQty * multiplier);
    const orderId = `spoof_${this.botId}_${stock.id}_${this.clock.now()}`;

    const spoofOrder = this.applyInstitutionalRiskControls({
      id: orderId,
      stock_id: stock.id,
      user_id: null,
      side,
      price: spoofPrice,
      size: spoofQty,
      status: 'open',
      is_lp: true,
      is_spoof: true,
      _botId: this.botId
    }, stock.current_price);

    this.activeSpoofOrders.push({
      orderId,
      stockId: stock.id,
      side,
      price: spoofPrice,
      tickCreated: currentTick
    });

    return spoofOrder;
  }

  public cancelExpiredSpoofs(currentTick: number, maxAgeTicks: number = 1): string[] {
    const toCancel: string[] = [];
    this.activeSpoofOrders = this.activeSpoofOrders.filter((s) => {
      if (currentTick - s.tickCreated >= maxAgeTicks) {
        toCancel.push(s.orderId);
        return false;
      }
      return true;
    });
    this.ordersToCancel.push(...toCancel);
    return toCancel;
  }

  // =========================================================================
  // 🧠 HFT Strategy 3: 돌파 감지 시 유동성 진공 스윕 (Market Sweep)
  // =========================================================================
  public checkVacuumAndSweep(stock: any, bestAskSize: number, askPrice: number): any | null {
    // 최우선 매도호가 잔량이 10% 이하로 급감하여 돌파 임박 감지 시 시장가 스윕 발사
    if (bestAskSize > 0 && bestAskSize < 1000) {
      const sweepQty = Math.max(500, Math.floor((this.capital * 0.05) / stock.current_price));
      return {
        stock_id: stock.id,
        user_id: null,
        side: 'buy',
        type: 'market',
        price: askPrice,
        size: sweepQty,
        status: 'open',
        is_sweep: true,
        _botId: this.botId
      };
    }
    return null;
  }
}
