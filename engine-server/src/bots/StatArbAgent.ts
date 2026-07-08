import type { StatArbBot } from "../types";
import { BaseAgent } from "./BaseAgent";

export class StatArbAgent extends BaseAgent {
  private bot: StatArbBot;
  
  // ETF 바스켓 설정 (종목 ID -> 가중치 w_i)
  private basketWeights: Record<string, number> = {};
  
  // 이벤트 주도형 캐싱 변수
  private lastKnownPrices: Record<string, number> = {};
  private currentNAV: number = 0;
  private isInitialized: boolean = false;
  
  // 가상의 ETF 시장 가격 (초기엔 NAV와 동일하게 시작하며, 자체적으로 랜덤 워크를 타거나 시장 노이즈를 반영)
  // 실제 거래소에 상장된 ETF가 없으므로 봇 내부에서 가상으로 관리.
  private virtualEtfPrice: number = 0;
  
  // AP 에이전트 (Authorized Participant) 특화 상태 변수
  private inventoryRisk: number = 0; // 현재 재고량 (Risk)
  private readonly MAX_INVENTORY = 1000000000; // 최대 수용 한도 (10억)

  constructor(bot: StatArbBot) {
    super(bot.id, bot.capital);
    this.bot = bot;
  }

  /**
   * O(1) ETF NAV 업데이트 및 차익거래 실행
   */
  public executeArbitrage(currentMarket: any, myHoldings: any) {
    const orders: any[] = [];
    const availableStocks = currentMarket.stocks || [];

    // 1. 초기 바스켓 구성 (최초 1회)
    if (!this.isInitialized && availableStocks.length >= 3) {
      // 임의로 시총 상위 혹은 첫 3개 종목을 편입 (TECH 섹터가 있다면 우선)
      const basketStocks = availableStocks.slice(0, 3);
      
      // 등가중치(Equal-weight) 방식 적용 (예: 각각 0.33)
      const weight = 1.0 / basketStocks.length;
      
      let initialNAV = 0;
      for (const stock of basketStocks) {
        this.basketWeights[stock.id] = weight;
        this.lastKnownPrices[stock.id] = stock.current_price;
        initialNAV += stock.current_price * weight;
      }
      
      this.currentNAV = initialNAV;
      this.virtualEtfPrice = initialNAV; // 초기 가상 가격 일치
      this.isInitialized = true;
      console.log(`[StatArb] ETF Basket Initialized. NAV: ${initialNAV.toFixed(2)}`);
    }

    if (!this.isInitialized) return orders;

    // 2. 가상 ETF 가격 시뮬레이션 (약간의 랜덤 노이즈 추가하여 괴리율 발생 유도)
    const noise = 1 + (Math.random() * 0.002 - 0.001); // -0.1% ~ +0.1% 노이즈
    this.virtualEtfPrice *= noise;

    // 3. O(1) 이벤트 주도형 NAV 업데이트
    for (const stock of availableStocks) {
      const weight = this.basketWeights[stock.id];
      if (weight !== undefined) {
        const lastPrice = this.lastKnownPrices[stock.id];
        if (lastPrice !== undefined && lastPrice !== stock.current_price) {
          // 가격이 변동된 종목만 가중치를 곱해 NAV에 가감 (O(1))
          const deltaP = stock.current_price - lastPrice;
          this.currentNAV += deltaP * weight;
          this.lastKnownPrices[stock.id] = stock.current_price;
        }
      }
    }

    // 4. 차익거래 (Arbitrage) 조건 검사
    // 괴리율 = |ETF 시장가 - NAV|
    const diff = this.virtualEtfPrice - this.currentNAV;
    const deviationPct = Math.abs(diff) / this.currentNAV;

    // C_trans (거래 비용) 임계값을 넘어가면 차익거래 발동
    if (deviationPct > this.bot.transCostThreshold) {
      const tradeAmount = this.bot.capital * 0.05; // 5% 투입
      
      if (diff > 0) {
        // ETF 고평가, 기초자산(NAV) 저평가 상태
        // 행동: ETF 공매도 (가상이므로 생략), 기초자산 바스켓 매수 (Creation)
        // 위기 시 기초 자산을 흡수(매수)하여 시장 충격을 완충합니다.
        
        let discountMultiplier = 1.0;
        
        // AP의 재고 한도(Inventory Limit) 도달 시 할인율(Discount) 전가
        if (this.inventoryRisk > this.MAX_INVENTORY * 0.8) {
          // 재고 한도의 80%를 넘어가면 유동성 제공을 꺼리며 스프레드를 엄청나게 벌림
          discountMultiplier = 0.8; // 20% 더 싼 가격에만 매수해주겠다 (Discount)
          console.log(`[AP Agent] ⚠️ INVENTORY LIMIT REACHED! Demanding ${((1 - discountMultiplier) * 100).toFixed(0)}% discount to provide liquidity.`);
        }

        console.log(`[AP Agent] Premium Detected! ETF: ${this.virtualEtfPrice.toFixed(2)}, NAV: ${this.currentNAV.toFixed(2)}. Buying Basket (Creation).`);
        
        for (const stockId of Object.keys(this.basketWeights)) {
          const stock = availableStocks.find((s: any) => s.id === stockId);
          if (stock && this.basketWeights[stockId] !== undefined) {
            const allocateMoney = tradeAmount * this.basketWeights[stockId]!;
            const qty = Math.floor(allocateMoney / stock.current_price);
            if (qty > 0) {
              const tickSize = this.getTickSize(stock.current_price);
              
              // discountMultiplier 가 1 미만이면 현재가보다 훨씬 아래(할인된 가격)에 호가를 깔아버림
              const targetBuyPrice = stock.current_price * discountMultiplier;
              
              orders.push(...this.executeSmartOrder(stock, 'buy', targetBuyPrice, qty, 0.9, currentMarket.activeEvents));
              
              // 재고 증가
              this.inventoryRisk += (qty * stock.current_price);
            }
          }
        }
        
        // 차익거래로 인해 괴리율 축소 (가상 ETF 가격을 NAV 쪽으로 강제 조정)
        this.virtualEtfPrice -= diff * 0.5;

      } else {
        // ETF 저평가, 기초자산(NAV) 고평가 상태
        // 행동: ETF 매수 (생략), 기초자산 바스켓 매도 (Redemption)
        console.log(`[AP Agent] Discount Detected! ETF: ${this.virtualEtfPrice.toFixed(2)}, NAV: ${this.currentNAV.toFixed(2)}. Selling Basket (Redemption).`);
        
        for (const stockId of Object.keys(this.basketWeights)) {
          const stock = availableStocks.find((s: any) => s.id === stockId);
          if (stock && this.basketWeights[stockId] !== undefined) {
            const allocateMoney = tradeAmount * this.basketWeights[stockId]!;
            let qty = Math.floor(allocateMoney / stock.current_price);
            
            // 공매도를 허용하거나(가정) 보유량 한도 내에서 매도
            if (qty > 0) {
              const tickSize = this.getTickSize(stock.current_price);
              // 시장가에 가깝게 공격적 매도
              orders.push(...this.executeSmartOrder(stock, 'sell', stock.current_price - tickSize * 3, qty, 0.9, currentMarket.activeEvents));
              
              // 매도 시 재고 리스크 감소
              this.inventoryRisk = Math.max(0, this.inventoryRisk - (qty * stock.current_price));
            }
          }
        }

        // 차익거래로 인해 괴리율 축소
        this.virtualEtfPrice -= diff * 0.5;
      }
    } else {
      // 평시에는 재고 리스크를 서서히 줄임 (Inventory Decay)
      this.inventoryRisk *= 0.95;
    }

    return orders;
  }
}
