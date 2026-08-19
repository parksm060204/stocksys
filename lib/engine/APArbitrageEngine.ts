import { iNAVData, APArbitrageDecision, LPQuote, ArbitrageSignal } from './etfTypes';
import { roundToETFTick } from './etfDefinitions';

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

  public evaluateArbitrageOpportunity(navData: iNAVData, _apBotBalance?: any): APArbitrageDecision {
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
   * LP (Liquidity Provider) 대량 호가 유동성 공급 (iNAV 부근 0.05% 스프레드 밀착 유지)
   */
  public generateLPQuote(iNAV: number, isUsOrGlobal = false): LPQuote {
    const spreadHalf = iNAV * 0.0005; // 0.05% 대폭 좁혀진 촘촘한 LP 스프레드
    const rawBid = iNAV - spreadHalf;
    const rawAsk = iNAV + spreadHalf;

    const bid = roundToETFTick(rawBid, isUsOrGlobal);
    const ask = roundToETFTick(rawAsk, isUsOrGlobal);

    const seed = Math.abs(Math.floor(iNAV));
    // 5,000주 ~ 10,000주의 강력한 LP 방어 유동성 쿠션 주입
    const bidQty = 5000 + ((seed * 17) % 5000);
    const askQty = 5000 + ((seed * 31) % 5000);

    return { bid, ask, bidQty, askQty };
  }

  /**
   * LP 앵커링 평균 회귀(Mean-Reversion) 시세 안정화 수식
   * P_{t+1} = P_t + 0.80 * (iNAV - P_t) + LP_Noise
   */
  public calculateLPAntichamberPrice(currentPrice: number, iNAV: number, isUsOrGlobal = false): number {
    const deviation = iNAV - currentPrice;
    // 80% 의 강력한 평균 회귀 속도 적용
    const reversion = deviation * 0.80;
    const noise = (Math.random() - 0.49) * (iNAV * 0.0006); // 극소한 LP 변동 노이즈
    const rawNext = currentPrice + reversion + noise;

    return roundToETFTick(rawNext, isUsOrGlobal);
  }
}
