import { iNAVData, APArbitrageDecision, LPQuote, ArbitrageSignal } from './etfTypes';

export class APArbitrageEngine {
  private thresholdRate: number = 0.0015; // 0.15% 이상 괴리 시 차익거래 발동

  /**
   * 실시간 iNAV와 호가창을 감시하여 차익거래 주문 체인 생성
   */
  public detectOpportunity(
    etfTicker: string,
    underlyingTicker: string,
    etfBestBid: number,
    etfBestAsk: number,
    iNAV: number,
    maxExecutionQty: number
  ): ArbitrageSignal {
    const premiumRate = (etfBestBid - iNAV) / iNAV;
    const discountRate = (iNAV - etfBestAsk) / iNAV;

    // 1. 프리미엄 차익: ETF 매도 + 기초자산/선물 매수
    if (premiumRate > this.thresholdRate) {
      return {
        type: 'PREMIUM_ARBITRAGE',
        etfTicker,
        underlyingTicker,
        spread: Number((etfBestBid - iNAV).toFixed(2)),
        quantity: maxExecutionQty
      };
    }

    // 2. 할인 차익: ETF 매수 + 기초자산/선물 매도
    if (discountRate > this.thresholdRate) {
      return {
        type: 'DISCOUNT_ARBITRAGE',
        etfTicker,
        underlyingTicker,
        spread: Number((iNAV - etfBestAsk).toFixed(2)),
        quantity: maxExecutionQty
      };
    }

    return { type: 'NONE', etfTicker, underlyingTicker, spread: 0, quantity: 0 };
  }

  public evaluateArbitrageOpportunity(navData: iNAVData, apBotBalance?: any): APArbitrageDecision {
    const { discrepancyRate, etfTicker, marketPrice, iNAV } = navData;

    if (discrepancyRate > 0.15) {
      return {
        action: 'CREATE_AND_SELL_ETF',
        etfTicker,
        expectedProfitPerUnit: Number((marketPrice - iNAV).toFixed(2)),
        reason: `프리미엄 발생 (+${discrepancyRate.toFixed(2)}%): 기초자산 매수 후 ETF 설정/매도`
      };
    }

    if (discrepancyRate < -0.15) {
      return {
        action: 'BUY_AND_REDEEM_ETF',
        etfTicker,
        expectedProfitPerUnit: Number((iNAV - marketPrice).toFixed(2)),
        reason: `할인 발생 (${discrepancyRate.toFixed(2)}%): ETF 시장 매수 후 해지 및 기초자산 매도`
      };
    }

    return { action: 'HOLD' };
  }

  /**
   * LP (Liquidity Provider) 호가 조성 함수 (iNAV 부근 스프레드 유지)
   */
  public generateLPQuote(iNAV: number): LPQuote {
    const spreadHalf = iNAV * 0.001; // 0.1% 스프레드
    const bid = Math.floor(iNAV - spreadHalf);
    const ask = Math.ceil(iNAV + spreadHalf);
    const bidQty = Math.floor(Math.random() * 5000) + 2000;
    const askQty = Math.floor(Math.random() * 5000) + 2000;

    return { bid, ask, bidQty, askQty };
  }
}
