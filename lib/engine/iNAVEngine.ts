import { ETFDefinition, iNAVData } from './etfTypes';

export class iNAVEngine {
  private etf: ETFDefinition;

  constructor(etf: ETFDefinition) {
    this.etf = etf;
  }

  /**
   * 기초 자산 실시간 가격 데이터를 받아 iNAV 및 괴리율 계산
   */
  public calculateiNAV(
    underlyingPrices: Map<string, number>,
    currentMarketPrice: number
  ): iNAVData {
    let totalBasketValue = 0;

    // 1. PDF 구성 종목들의 가치합 산출
    for (const item of this.etf.pdf) {
      const price = underlyingPrices.get(item.ticker) ?? 0;
      totalBasketValue += price * item.sharesPerCU;
    }

    // 2. 레버리지/인버스 배율 적용
    totalBasketValue += this.etf.cashComponent;
    
    // 1주당 iNAV
    const rawNAV = totalBasketValue / this.etf.cuSize;
    
    // 3. 괴리율(Discrepancy Rate) 계산
    const discrepancyRate = rawNAV > 0 
      ? ((currentMarketPrice - rawNAV) / rawNAV) * 100 
      : 0;

    return {
      etfTicker: this.etf.etfTicker,
      iNAV: Number(rawNAV.toFixed(2)),
      marketPrice: currentMarketPrice,
      discrepancyRate: Number(discrepancyRate.toFixed(3)),
      timestamp: Date.now()
    };
  }
}
