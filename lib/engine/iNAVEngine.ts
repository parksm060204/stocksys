import { ETFDefinition, iNAVData } from './etfTypes';
import { roundToETFTick } from './etfDefinitions';

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

    totalBasketValue += this.etf.cashComponent;
    
    // 1주당 iNAV
    let rawNAV = totalBasketValue / this.etf.cuSize;

    // 스케일 정규화 (PDF 샘플 단주 규격과 ETF 시장가 비율 맞춤)
    if (rawNAV > 0 && currentMarketPrice > 0) {
      const ratio = currentMarketPrice / rawNAV;
      if (ratio > 5 || ratio < 0.2) {
        const scaleFactor = Math.pow(10, Math.round(Math.log10(ratio)));
        rawNAV = rawNAV * scaleFactor;
      }
    }

    // 2. KRX ETF 호가단위(Tick Size 5원/10원) 반올림 적용
    const isUsOrGlobal = (this.etf as any).category === 'US' || (this.etf as any).category === 'GLOBAL';
    const finalNAV = roundToETFTick(rawNAV, isUsOrGlobal);
    
    // 3. 괴리율(Discrepancy Rate) 계산
    const discrepancyRate = finalNAV > 0 
      ? ((currentMarketPrice - finalNAV) / finalNAV) * 100 
      : 0;

    return {
      etfTicker: this.etf.etfTicker,
      iNAV: finalNAV,
      marketPrice: currentMarketPrice,
      discrepancyRate: Number(discrepancyRate.toFixed(2)),
      timestamp: Date.now()
    };
  }
}
