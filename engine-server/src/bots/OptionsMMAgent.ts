import type { OptionsMMBot } from "../types";
import { BaseAgent } from "./BaseAgent";

export class OptionsMMAgent extends BaseAgent {
  private bot: OptionsMMBot;
  
  // O(1) 옵션 그릭스 캐싱 (Stock ID -> Interpolation Grid)
  private gammaGrid: Record<string, { strike: number, stdDev: number }> = {};
  private lastPriceState: Record<string, number> = {};

  constructor(bot: OptionsMMBot) {
    super(bot.id, bot.capital);
    this.bot = bot;
  }

  /**
   * 사전 계산된 정규분포(Bell Curve) 근사값을 통해 O(1)로 감마를 참조합니다.
   * 실제 블랙-숄즈 대신, ATM(행사가)에서 가장 높고 OTM/ITM에서 0으로 수렴하는 가우시안 커널을 사용합니다.
   */
  private getGamma(currentPrice: number, strike: number, stdDev: number): number {
    // 가우시안 기반 감마 근사
    const z = (currentPrice - strike) / stdDev;
    // 1 / (stdDev * sqrt(2*PI)) * exp(-0.5 * z^2)
    const gammaRaw = (1.0 / (stdDev * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * Math.pow(z, 2));
    
    // 이 시뮬레이션에서는 감마 스퀴즈를 발생시키기 위해 감마 값을 폭발적으로 스케일링합니다.
    return gammaRaw * 5000; 
  }

  public executeDeltaHedging(currentMarket: any, orderBook: any) {
    const orders: any[] = [];
    const availableStocks = currentMarket.stocks || [];

    for (const stock of availableStocks) {
      const stockId = stock.id;
      
      // 초기 행사가(Strike) 셋팅 (서버 켜질 때 1회)
      if (!this.gammaGrid[stockId]) {
        this.gammaGrid[stockId] = {
          // ATM 근처에 대규모 옵션 미결제약정(Open Interest)이 몰려있다고 가정
          strike: stock.current_price * 1.05, // 5% 위에 거대한 콜옵션 벽 존재
          stdDev: stock.current_price * 0.02 // 2% 표준편차
        };
        this.lastPriceState[stockId] = stock.current_price;
      }

      const prevPrice = this.lastPriceState[stockId];
      if (prevPrice === undefined || prevPrice === stock.current_price) {
        this.lastPriceState[stockId] = stock.current_price;
        continue;
      }

      const dS = stock.current_price - prevPrice;
      const grid = this.gammaGrid[stockId]!;
      
      // O(1) 감마 룩업
      const gamma = this.getGamma(stock.current_price, grid.strike, grid.stdDev);
      
      // 옵션 마켓 메이커는 콜옵션을 대량으로 '매도(Short)'한 상태이므로, Net Gamma는 음수입니다.
      // 델타 중립을 유지하려면, 주가 상승 시(dS > 0) 델타가 급등하므로 기초자산을 '매수'해서 헤징해야 합니다.
      // 주가 하락 시(dS < 0) 델타가 감소하므로 기초자산을 '매도'합니다.
      
      // dV (Hedging Volume) = NetGamma * dS.
      // Net Gamma의 절댓값 크기를 곱해 매수해야 할 수량을 구합니다.
      const netGammaExposure = this.bot.initialGammaNet * gamma; 
      // initialGammaNet이 양수 (예: 1.0)라고 가정하면, Short Gamma 상태를 방어하기 위해 dS와 같은 방향으로 매매.
      const dV = Math.floor(netGammaExposure * dS);

      if (dV !== 0) {
        const action = dV > 0 ? 'buy' : 'sell';
        const qty = Math.abs(dV);
        
        // 자본금 한도 체크
        const requiredCapital = qty * stock.current_price;
        const actualQty = requiredCapital > this.bot.capital ? Math.floor(this.bot.capital / stock.current_price) : qty;

        if (actualQty > 0) {
          // 감마 스퀴즈 발동 여부 검사 (호가창 유동성 대비 헤징 물량이 너무 클 경우)
          const stockBook = orderBook[stockId] || { asks: [], bids: [] };
          let liquidityDepth = 0;
          
          if (action === 'buy') {
            for (let i = 0; i < 3; i++) { // 상위 3호가
              if (stockBook.asks[i]) liquidityDepth += stockBook.asks[i].total_volume;
            }
          } else {
            for (let i = 0; i < 3; i++) { // 하위 3호가
              if (stockBook.bids[i]) liquidityDepth += stockBook.bids[i].total_volume;
            }
          }

          if (actualQty > liquidityDepth && liquidityDepth > 0) {
            console.log(`[Gamma Squeeze!!] ${stock.name} - MM needs ${actualQty} but LOB depth is ${liquidityDepth}. Sweeping!`);
          }

          // 무조건 델타를 맞추기 위해 시장가(매우 공격적 지정가)로 쓸어담습니다.
          const tickSize = this.getTickSize(stock.current_price);
          const targetPrice = action === 'buy' ? stock.current_price + tickSize * 10 : stock.current_price - tickSize * 10;
          
          orders.push(...this.executeSmartOrder(stock, action, targetPrice, actualQty, 1.0, currentMarket.activeEvents));
        }
      }

      this.lastPriceState[stockId] = stock.current_price;
    }

    return orders;
  }
}
