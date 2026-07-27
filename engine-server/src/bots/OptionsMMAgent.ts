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
    
    // 이 시뮬레이션에서는 감마 스퀴즈를 적절히 제어하기 위해 감마 스케일을 조정합니다.
    return gammaRaw * 100; 
  }

  public executeDeltaHedging(currentMarket: any, orderBook: any) {
    const orders: any[] = [];
    const availableStocks = currentMarket.stocks || [];
    const optionsContracts = currentMarket.options_contracts || [];

    for (const stock of availableStocks) {
      const stockId = stock.id;
      const stockOptions = optionsContracts.filter((o: any) => o.underlying_stock_id === stockId);
      
      // 관련 옵션이 없으면 패스
      if (stockOptions.length === 0) continue;

      const prevPrice = this.lastPriceState[stockId];
      if (prevPrice === undefined || prevPrice === stock.current_price) {
        this.lastPriceState[stockId] = stock.current_price;
        continue;
      }

      const dS = stock.current_price - prevPrice;
      
      let netGammaExposure = 0;
      
      for (const opt of stockOptions) {
        const stdDev = stock.current_price * opt.implied_volatility * 0.1; // 간이 표준편차
        const gamma = this.getGamma(stock.current_price, opt.strike_price, stdDev);
        
        // MM은 유동성 공급자이므로, 콜옵션 미결제약정이 클수록 콜옵션 매도 포지션을 쥐고 있다고 가정 (Short Gamma)
        // 풋옵션 미결제약정이 클수록 풋옵션 매도 포지션을 쥐고 있다고 가정 (Short Gamma)
        // 둘 다 Short Gamma 방향으로 작용 (Gamma Squeeze를 유발하는 극단적 상황 시뮬레이션)
        netGammaExposure += (-opt.open_interest * gamma); 
      }
      
      // dV (Hedging Volume) = -NetGamma * dS. (Net Gamma가 음수이므로, dS가 양수면 양수 물량 매수)
      // Net Gamma의 절댓값 크기를 곱해 매수해야 할 수량을 구합니다.
      const dV = Math.floor(Math.abs(netGammaExposure) * Math.sign(dS));

      if (dV !== 0) {
        const action = dV > 0 ? 'buy' : 'sell';
        const qty = Math.abs(dV);
        
        // 자본금 한도 체크 및 급격한 가격 변동 방지를 위한 최대 주문량 제한 (최대 2000주)
        const requiredCapital = qty * stock.current_price;
        let actualQty = requiredCapital > this.bot.capital ? Math.floor(this.bot.capital / stock.current_price) : qty;
        actualQty = Math.min(2000, actualQty);

        if (actualQty > 0) {
          // 감마 스퀴즈 발동 여부 검사 (호가창 유동성 대비 헤징 물량이 너무 클 경우)
          const stockBook = orderBook[stockId] || { asks: [], bids: [] };
          let liquidityDepth = 0;
          
          if (action === 'buy') {
            for (let i = 0; i < 3; i++) { // 상위 3호가
              if (stockBook.asks[i]) liquidityDepth += stockBook.asks[i].size;
            }
          } else {
            for (let i = 0; i < 3; i++) { // 하위 3호가
              if (stockBook.bids[i]) liquidityDepth += stockBook.bids[i].size;
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
