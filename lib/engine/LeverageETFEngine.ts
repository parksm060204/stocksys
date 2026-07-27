import { ETFPortfolio, RebalanceOrder } from './etfTypes';

export class LeverageETFEngine {
  /**
   * 기초 지수 가격 변동에 따른 iNAV 업데이트
   */
  public updateNAV(
    portfolio: ETFPortfolio,
    indexReturn: number
  ): number {
    const etfReturn = portfolio.leverageFactor * indexReturn;
    portfolio.nav = portfolio.nav * (1 + etfReturn);
    
    // 지수 변동으로 인한 현재 포지션 가치 평가
    portfolio.currentExposure = portfolio.currentExposure * (1 + indexReturn);
    return portfolio.nav;
  }

  /**
   * 장 마감 또는 장중 리밸런싱 필요 주문 수량 산출
   * @param currentFuturesPrice 선물/기초자산의 현재가 (계약당 단가)
   */
  public calculateRebalanceOrders(
    portfolio: ETFPortfolio,
    currentFuturesPrice: number
  ): RebalanceOrder {
    // 1. 목표 노출액 산출 (Target Exposure = NAV * Leverage)
    const targetExposure = portfolio.nav * portfolio.leverageFactor;

    // 2. 필요한 포지션 조정액 (Exposure Delta)
    const requiredExposureDelta = targetExposure - portfolio.currentExposure;

    // 3. 체결 필요한 선물/기초자산 계약(주) 수 계산
    const unitPrice = Math.max(1, currentFuturesPrice);
    const orderQuantity = Math.abs(Math.round(requiredExposureDelta / unitPrice));
    
    // 조정액이 양수이면 매수(Long 확대/Short 축소), 음수이면 매도
    const side: 'BUY' | 'SELL' = requiredExposureDelta > 0 ? 'BUY' : 'SELL';

    return {
      side,
      orderQuantity,
      requiredExposureDelta
    };
  }

  /**
   * 리밸런싱 체결 후 포지션 갱신
   */
  public applyRebalance(portfolio: ETFPortfolio, executedExposure: number) {
    portfolio.currentExposure += executedExposure;
  }
}
