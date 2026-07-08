import type { HedgeFundBot, MarketSentiment } from "../types";
import { BaseAgent } from "./BaseAgent";

export class HedgeFundAgent extends BaseAgent {
  private bot: HedgeFundBot;

  // Balance Sheet (대차대조표) 상태 변수
  private balanceSheet: {
    cash: number;
    debt: number;
    targetLeverage: number;
    holdings: Record<string, number>; // stock_id -> quantity
  } = {
    cash: 0,
    debt: 0,
    targetLeverage: 3.0, // 3배 레버리지 타겟
    holdings: {}
  };

  constructor(bot: HedgeFundBot) {
    super(bot.id, bot.capital);
    this.bot = bot;
    
    // 초기 자본금 세팅: Capital = Equity. 
    // Target Leverage 3.0 이면, Assets = 3 * Equity, Debt = 2 * Equity.
    this.balanceSheet.cash = bot.capital * 3.0; 
    this.balanceSheet.debt = bot.capital * 2.0; 
  }

  public updateSentiment(newSentiment: MarketSentiment) {
    this.bot.currentSentiment = newSentiment;
    this.rebalancePortfolio();
    
    // VIX 폭등(공포) 시 목표 레버리지를 축소 (디레버리징)
    if (newSentiment === 'RISK_OFF') {
      this.balanceSheet.targetLeverage = 1.5; // 강제 디레버리징
    } else if (newSentiment === 'RISK_ON') {
      this.balanceSheet.targetLeverage = 4.0;
    } else {
      this.balanceSheet.targetLeverage = 3.0;
    }
  }

  private rebalancePortfolio() {
    if (this.bot.currentSentiment === 'RISK_OFF') {
      this.bot.portfolioTarget = { equity: 0.1, safeBonds: 0.9, highYield: 0.0 };
    } else if (this.bot.currentSentiment === 'RISK_ON') {
      this.bot.portfolioTarget = { equity: 0.7, safeBonds: 0.0, highYield: 0.3 };
    } else {
      this.bot.portfolioTarget = { equity: 0.5, safeBonds: 0.3, highYield: 0.2 };
    }
  }

  private priceHistory: Record<string, number[]> = {};

  public executeAggressiveSweep(currentMarket: any) {
    const orders: any[] = [];
    const availableStocks = currentMarket.stocks || [];
    
    // 1. 대차대조표 MTM (Mark-to-Market) 및 레버리지 산출
    let totalAssets = this.balanceSheet.cash;
    for (const stock of availableStocks) {
      if (this.balanceSheet.holdings[stock.id]) {
        totalAssets += (this.balanceSheet.holdings[stock.id] || 0) * stock.current_price;
      }
    }
    
    const equity = totalAssets - this.balanceSheet.debt;
    if (equity <= 0) {
      console.log(`[Margin Call] ☠️ ${this.bot.name} is BANKRUPT!`);
      // 마진콜 청산 완료 상태 처리 (시뮬레이션 단순화)
      return orders;
    }
    
    const currentLeverage = totalAssets / equity;
    
    // 2. Margin Spiral (Fire Sale) 논리
    // 현재 레버리지가 타겟 레버리지보다 매우 크면 강제 청산(Fire Sale) 수행
    if (currentLeverage > this.balanceSheet.targetLeverage * 1.1) {
      console.log(`🔥 [Margin Spiral] ${this.bot.name} Deleveraging! L=${currentLeverage.toFixed(2)} > Target=${this.balanceSheet.targetLeverage.toFixed(2)}`);
      
      // 줄여야 할 자산 규모 (Deleveraging Amount)
      const targetAssets = equity * this.balanceSheet.targetLeverage;
      let assetsToSell = totalAssets - targetAssets;
      
      for (const stock of availableStocks) {
        if (assetsToSell <= 0) break;
        if ((this.balanceSheet.holdings[stock.id] || 0) > 0) {
          const qtyOwned = this.balanceSheet.holdings[stock.id] || 0;
          const stockValue = qtyOwned * stock.current_price;
          
          const qtyToSell = Math.min(qtyOwned, Math.ceil((assetsToSell) / stock.current_price));
          
          if (qtyToSell > 0) {
            const tickSize = this.getTickSize(stock.current_price);
            // Fire Sale: 호가창 하단으로 무자비하게 던짐 (시장 충격 극대화, 비선형 Psi 효과)
            orders.push({
              stock_id: stock.id,
              user_id: this.botId,
              side: 'sell',
              price: stock.current_price - (tickSize * 10), // 매우 공격적 시장가 던지기
              size: qtyToSell,
              status: 'open',
              is_lp: true
            });
            
            assetsToSell -= qtyToSell * stock.current_price;
            // 시뮬레이션: 일단 팔았다고 가정 (실제로는 Engine이 inventory를 깎아야 함)
            this.balanceSheet.holdings[stock.id] = (this.balanceSheet.holdings[stock.id] || 0) - qtyToSell;
            this.balanceSheet.cash += qtyToSell * stock.current_price; 
            this.balanceSheet.debt = Math.max(0, this.balanceSheet.debt - (qtyToSell * stock.current_price)); // 빚 갚음
          }
        }
      }
    }
    
    // 3. 기존 Merton Jump-Diffusion 모델 적용
    for (const stock of availableStocks) {
      if (!this.priceHistory[stock.id]) {
        this.priceHistory[stock.id] = [];
      }
      
      const history = this.priceHistory[stock.id]!;
      history.push(stock.current_price);
      if (history.length > 20) history.shift(); // 최근 20틱 유지

      if (history.length < 20) continue;

      // 과거 20틱 평균 및 변동성 계산
      const avgPrice = history.reduce((a, b) => a + b, 0) / history.length;
      const variance = history.reduce((a, b) => a + Math.pow(b - avgPrice, 2), 0) / history.length;
      const stdDev = Math.sqrt(variance);

      // 점프 감지: 현재가가 평균 대비 3표준편차 이상 벗어났는가?
      const zScore = stdDev === 0 ? 0 : (stock.current_price - avgPrice) / stdDev;
      const jumpThreshold = 3.0; // 3 sigma
      let dN_t = 0; // Poisson jump indicator

      if (Math.abs(zScore) > jumpThreshold) {
        dN_t = zScore > 0 ? 1 : -1; // 1: 급등 점프, -1: 급락 점프
      }

      if (dN_t !== 0) {
        console.log(`[Jump-Diffusion] ${this.bot.name} detected dN_t = ${dN_t} for ${stock.name} (Z: ${zScore.toFixed(2)}). Sweeping!`);
        const tickSize = this.getTickSize(stock.current_price);
        const sweepPowerMoney = this.bot.capital * 0.1; // 점프 발생 시 자본의 10%를 한방에 쏟아부음
        const baseQty = Math.floor(sweepPowerMoney / stock.current_price);
        
        if (baseQty > 0) {
          if (dN_t === 1) {
            // 위로 점프 -> 추격 매수 스윕 (Sweep Up)
            const targetBuyPrice = stock.current_price + (tickSize * 5); // 5틱 위까지 싹쓸이
            orders.push(...this.executeSmartOrder(
              stock,
              'buy',
              targetBuyPrice,
              baseQty,
              0.95, // 극도의 긴급성
              currentMarket.activeEvents
            ));
          } else {
            // 아래로 점프 -> 패닉 공매도 스윕 (Sweep Down)
            const targetSellPrice = stock.current_price - (tickSize * 5); // 5틱 아래까지 싹쓸이
            orders.push(...this.executeSmartOrder(
              stock,
              'sell',
              targetSellPrice,
              baseQty,
              0.95, // 극도의 긴급성
              currentMarket.activeEvents
            ));
          }
        }
      }
    }
    
    // 4. 일반적인 포트폴리오 편입 (가짜 매수)
    // 시뮬레이션을 위해 초기에 주식을 매수해서 홀딩스에 넣는 로직이 필요함
    if (this.balanceSheet.cash > this.balanceSheet.debt * 0.5) {
      const moneyToInvest = this.balanceSheet.cash * 0.1;
      const stock = availableStocks[Math.floor(Math.random() * availableStocks.length)];
      if (stock) {
        const qty = Math.floor(moneyToInvest / stock.current_price);
        if (qty > 0) {
          orders.push({
            stock_id: stock.id,
            user_id: this.botId,
            side: 'buy',
            price: stock.current_price,
            size: qty,
            status: 'open',
            is_lp: true
          });
          // 임시로 구매 처리
          this.balanceSheet.cash -= qty * stock.current_price;
          if (!this.balanceSheet.holdings[stock.id]) this.balanceSheet.holdings[stock.id] = 0;
          this.balanceSheet.holdings[stock.id] = (this.balanceSheet.holdings[stock.id] || 0) + qty;
        }
      }
    }

    return orders;
  }
}
