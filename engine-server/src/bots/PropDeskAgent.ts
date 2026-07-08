import type { PropDeskBot } from "../types";
import { BaseAgent } from "./BaseAgent";
import { WelfordRegression, OFISlidingWindow } from "./utils/math";

export class PropDeskAgent extends BaseAgent {
  private bot: PropDeskBot;
  
  // 상태 추적 맵 (Stock ID 기준)
  private regressionState: Record<string, WelfordRegression> = {};
  private ofiState: Record<string, OFISlidingWindow> = {};
  private prevOrderBookState: Record<string, { bidPrice: number, bidSize: number, askPrice: number, askSize: number }> = {};
  private prevPriceState: Record<string, number> = {};

  constructor(bot: PropDeskBot) {
    super(bot.id, bot.capital);
    this.bot = bot;
  }

  public executeMarketMaking(currentMarket: any, orderBook: any, myHoldings: any) {
    const orders: any[] = [];
    const availableStocks = currentMarket.stocks || [];
    const currentTime = Date.now();

    for (const stock of availableStocks) {
      const stockId = stock.id;
      const tickSize = this.getTickSize(stock.current_price);
      
      // 상태 초기화
      if (!this.regressionState[stockId]) this.regressionState[stockId] = new WelfordRegression(0.99); // 0.99 decay factor
      if (!this.ofiState[stockId]) this.ofiState[stockId] = new OFISlidingWindow(10000); // 10초 윈도우
      
      // OFI 계산을 위한 호가창 파싱
      const stockBook = orderBook[stockId] || { bids: [], asks: [] };
      const bestBid = stockBook.bids[0] || { price: 0, total_volume: 0 };
      const bestAsk = stockBook.asks[0] || { price: 0, total_volume: 0 };
      
      const pB_n = bestBid.price;
      const qB_n = bestBid.total_volume;
      const pA_n = bestAsk.price;
      const qA_n = bestAsk.total_volume;

      const prev = this.prevOrderBookState[stockId];
      let e_n = 0;

      if (prev) {
        const term1 = pB_n >= prev.bidPrice ? qB_n : 0;
        const term2 = pB_n <= prev.bidPrice ? prev.bidSize : 0;
        const term3 = pA_n <= prev.askPrice ? prev.askSize : 0;
        const term4 = pA_n >= prev.askPrice ? qA_n : 0;
        e_n = term1 - term2 - term3 + term4;
      }

      // 상태 업데이트
      this.prevOrderBookState[stockId] = { bidPrice: pB_n, bidSize: qB_n, askPrice: pA_n, askSize: qA_n };
      this.ofiState[stockId]!.add(currentTime, e_n);

      // Welford Regression 업데이트 (Kyle's Lambda)
      const prevPrice = this.prevPriceState[stockId] || stock.current_price;
      const dS = stock.current_price - prevPrice;
      const vT = stock.volume || 0; // 누적 거래량
      
      this.regressionState[stockId]!.update(vT, dS);
      this.prevPriceState[stockId] = stock.current_price;

      // ==========================================
      // 공격 모드 1: OFI Scalping
      // ==========================================
      const ofiSum = this.ofiState[stockId]!.getSum();
      const ofiThreshold = 50000; // 스캘핑 발동 임계값 (잔량 5만 주 이상 불균형)
      const scalpingQty = Math.floor((this.bot.capital * 0.1) / stock.current_price); // 자본금의 10%

      if (scalpingQty > 0) {
        if (ofiSum > ofiThreshold) {
          // 매수 압력 폭발 -> 프론트 러닝 (추격 매수 스캘핑)
          orders.push(...this.executeSmartOrder(stock, 'buy', pA_n + tickSize, scalpingQty, 0.9, currentMarket.activeEvents));
          console.log(`[PropDesk] OFI Scalping BUY on ${stock.name} (OFI: ${ofiSum})`);
          continue; // 스캘핑 발동 시 일반 마켓메이킹 생략
        } else if (ofiSum < -ofiThreshold) {
          // 매도 압력 폭발 -> 프론트 러닝 (패닉 셀 스캘핑)
          orders.push(...this.executeSmartOrder(stock, 'sell', pB_n - tickSize, scalpingQty, 0.9, currentMarket.activeEvents));
          console.log(`[PropDesk] OFI Scalping SELL on ${stock.name} (OFI: ${ofiSum})`);
          continue; 
        }
      }

      // ==========================================
      // 공격 모드 2: Predatory Trading (연기금 사냥)
      // ==========================================
      const kyleLambda = this.regressionState[stockId]!.getSlope();
      const lambdaThreshold = 0.005; // 유의미한 가격 상승 압력 임계값

      if (kyleLambda > lambdaThreshold && scalpingQty > 0) {
        // 거대 자본(연기금 등)의 지속적인 매수세 감지 -> 먼저 사서 나중에 비싸게 던짐 (Front-running)
        console.log(`[PropDesk] Predatory Trading Triggered! Kyle's Lambda: ${kyleLambda.toFixed(4)} on ${stock.name}`);
        orders.push(...this.executeSmartOrder(stock, 'buy', stock.current_price + tickSize * 2, scalpingQty, 0.8, currentMarket.activeEvents));
        continue;
      } else if (kyleLambda < -lambdaThreshold && scalpingQty > 0) {
        // 지속적인 매도세 감지 -> 먼저 공매도 치기
        orders.push(...this.executeSmartOrder(stock, 'sell', stock.current_price - tickSize * 2, scalpingQty, 0.8, currentMarket.activeEvents));
        continue;
      }

      // ==========================================
      // 기본 모드: Avellaneda-Stoikov Market Making
      // ==========================================
      const holdingQty = myHoldings[stock.id] || 0;
      const targetQty = Math.floor((this.bot.capital * 0.05) / stock.current_price); // 5% 비중
      if (targetQty <= 0) continue;

      const s = stock.current_price;
      const q = (holdingQty - targetQty) / targetQty; 
      const gamma = 0.1; 
      
      const dayReturn = (stock.current_price - stock.previous_close) / stock.previous_close;
      const sigma2 = Math.max(Math.pow(Math.abs(dayReturn) * 100, 2), 0.5); 
      const T_minus_t = 1; 

      const r = s - (q * gamma * sigma2 * T_minus_t);

      const k = 1.5; 
      const optimalSpread = (gamma * sigma2 * T_minus_t) + ((2 / gamma) * Math.log(1 + (gamma / k)));
      const halfSpread = (optimalSpread / 2) * tickSize; 

      const targetBuyPrice = Math.floor((r - halfSpread) / tickSize) * tickSize;
      const targetSellPrice = Math.ceil((r + halfSpread) / tickSize) * tickSize;
      
      const orderQty = Math.floor(targetQty * 0.1); 
      if (orderQty <= 0) continue;

      orders.push(...this.executeSmartOrder(stock, 'buy', targetBuyPrice, orderQty, 0.1, currentMarket.activeEvents));
      orders.push(...this.executeSmartOrder(stock, 'sell', targetSellPrice, orderQty, 0.1, currentMarket.activeEvents));
    }

    return orders;
  }
}
