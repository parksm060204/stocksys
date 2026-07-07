import type { HedgeFundBot, MarketSentiment } from "./types";

export class HedgeFundAgent {
  private bot: HedgeFundBot;

  constructor(bot: HedgeFundBot) {
    this.bot = bot;
  }

  // AI 뉴스 이벤트나 매크로 지표 변동 시 호출되는 함수
  public updateSentiment(newSentiment: MarketSentiment) {
    this.bot.currentSentiment = newSentiment;
    this.rebalancePortfolio();
  }

  private rebalancePortfolio() {
    if (this.bot.currentSentiment === 'RISK_OFF') {
      // [공포 장세] 주식과 하이일드 채권을 투매하고, 안전한 단기 국채로 대피 (Flight to Quality)
      this.bot.portfolioTarget = { equity: 0.1, safeBonds: 0.9, highYield: 0.0 };
    } else if (this.bot.currentSentiment === 'RISK_ON') {
      // [환희 장세] 안전 자산을 버리고 주식과 하이일드 채권을 쓸어 담음
      this.bot.portfolioTarget = { equity: 0.7, safeBonds: 0.0, highYield: 0.3 };
    } else {
      // [평시]
      this.bot.portfolioTarget = { equity: 0.5, safeBonds: 0.3, highYield: 0.2 };
    }
  }

  // 매 틱(Tick)마다 타겟 비중과 현재 비중을 맞추기 위해 맹렬하게 시장가로 매매
  public executeAggressiveSweep(currentMarket: any, myHoldings: any) {
    // 1. KST 정규장 확인 
    const currentKSTHour = (new Date().getUTCHours() + 9) % 24;
    if (currentKSTHour < 18 || currentKSTHour >= 22.5) return;

    const orders = [];

    // [Risk-Off 시나리오 예시] 안전 자산(단기 국채) 비중이 목표(90%)보다 부족할 때
    const currentSafeBondsRatio = myHoldings.safeBonds / this.bot.capital;
    
    if (this.bot.currentSentiment === 'RISK_OFF' && currentSafeBondsRatio < this.bot.portfolioTarget.safeBonds) {
      // 1. 주식 시장(KR/US 50종목)에 무차별 시장가 매도 폭탄 (주가 급락 유발)
      orders.push(this.createMarketSweepOrder('EQUITY', 'SELL', myHoldings.equity * 0.8));
      
      // 2. 동시에 하이일드 회사채도 시장가로 투매 (하이일드 YTM 급등 유발)
      orders.push(this.createMarketSweepOrder('HIGH_YIELD_BOND', 'SELL', myHoldings.highYield));
      
      // 3. 그 돈으로 1년/3년물 단기 국채를 시장가로 쓸어 담음 (안전 국채 YTM 급락 유발)
      const buyPower = this.bot.capital * 0.5; // 엄청난 액수의 자금
      orders.push(this.createMarketSweepOrder('SAFE_BOND', 'BUY', buyPower));
    } else if (this.bot.currentSentiment === 'RISK_ON') {
      // [Risk-On 시나리오 예시] 주식 비중이 목표치보다 낮을 때
      const currentEquityRatio = myHoldings.equity / this.bot.capital;
      if (currentEquityRatio < this.bot.portfolioTarget.equity) {
        // 안전 자산 투매
        orders.push(this.createMarketSweepOrder('SAFE_BOND', 'SELL', myHoldings.safeBonds));
        // 주식, 하이일드 매수 스윕
        orders.push(this.createMarketSweepOrder('EQUITY', 'BUY', this.bot.capital * 0.4));
        orders.push(this.createMarketSweepOrder('HIGH_YIELD_BOND', 'BUY', this.bot.capital * 0.2));
      }
    }
    
    // 2. 엔진에 주문 전송
    if (orders.length > 0) {
      this.submitCrossMarketOrders(orders);
    }
  }

  private createMarketSweepOrder(assetType: string, side: 'BUY' | 'SELL', amount: number) {
    // 시장가를 긁어버리는 극단적 주문 생성 로직
    return {
      botId: this.bot.id,
      assetType: assetType, // 주식과 채권 시장 모두 접근 가능
      orderType: 'MARKET',
      side: side,
      volume: amount,
      timestamp: Date.now()
    };
  }

  private submitCrossMarketOrders(orders: any[]) {
    // 주식 DB와 채권 DB로 각각 주문을 분배하여 라우팅
    console.log(`[HedgeFund ${this.bot.name}] Submitting ${orders.length} cross-market orders for sentiment ${this.bot.currentSentiment}`);
  }
}
