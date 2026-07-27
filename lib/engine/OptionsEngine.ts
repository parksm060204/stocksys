import { OrderBook } from './OrderBook';
import { Order, RolloverOrder, Trade } from './types';

export class OptionsEngine {
  private orderBooks: Map<string, OrderBook> = new Map();

  public getOrCreateBook(ticker: string): OrderBook {
    if (!this.orderBooks.has(ticker)) {
      this.orderBooks.set(ticker, new OrderBook(ticker));
    }
    return this.orderBooks.get(ticker)!;
  }

  /**
   * [롤오버 원자적 콤보 처리]
   * 근월물 청산과 원월물 진입이 스프레드 조건에 맞을 때만 동시 집행 (Atomic Leg-Execution)
   */
  public processRolloverCombo(rollover: RolloverOrder): { success: boolean; trades: Trade[] } {
    const closeBook = this.getOrCreateBook(rollover.closeContractTicker);
    const openBook = this.getOrCreateBook(rollover.openContractTicker);

    const bestClosePrice = rollover.side === 'SELL' ? closeBook.getBestBid() : closeBook.getBestAsk();
    const bestOpenPrice = rollover.side === 'SELL' ? openBook.getBestAsk() : openBook.getBestBid();

    if (bestClosePrice === null || bestOpenPrice === null) {
      return { success: false, trades: [] }; // 유동성 부족으로 실패
    }

    const currentSpread = bestOpenPrice - bestClosePrice;

    // 허용 슬리피지/스프레드 범위를 벗어나면 거부
    if (currentSpread > rollover.targetSpreadPrice) {
      return { success: false, trades: [] };
    }

    // 원자적 체결 실행 (두 Leg 동시 주문 발주)
    const closeLegOrder: Order = {
      id: `ROLL-LEG1-${rollover.comboId}`,
      botId: rollover.botId,
      contractTicker: rollover.closeContractTicker,
      side: rollover.side === 'SELL' ? 'SELL' : 'BUY',
      type: 'MARKET',
      price: 0,
      quantity: rollover.quantity,
      filledQuantity: 0,
      timestamp: Date.now()
    };

    const openLegOrder: Order = {
      id: `ROLL-LEG2-${rollover.comboId}`,
      botId: rollover.botId,
      contractTicker: rollover.openContractTicker,
      side: rollover.side === 'SELL' ? 'BUY' : 'SELL',
      type: 'MARKET',
      price: 0,
      quantity: rollover.quantity,
      filledQuantity: 0,
      timestamp: Date.now()
    };

    const tradesLeg1 = closeBook.processOrder(closeLegOrder);
    const tradesLeg2 = openBook.processOrder(openLegOrder);

    return {
      success: true,
      trades: [...tradesLeg1, ...tradesLeg2]
    };
  }

  /**
   * [D-Day 만기 정산 엔진]
   * $T = 0$ 시점에 기초자산 가격 기준 내가격(ITM) 현금 정산 및 외가격(OTM) 소멸
   */
  public settleExpiration(
    contractTicker: string,
    strikePrice: number,
    optionType: 'CALL' | 'PUT',
    finalUnderlyingPrice: number,
    positions: Array<{ botId: string; quantity: number; side: 'LONG' | 'SHORT' }>
  ) {
    let payoffPerContract = 0;

    if (optionType === 'CALL') {
      payoffPerContract = Math.max(0, finalUnderlyingPrice - strikePrice);
    } else {
      payoffPerContract = Math.max(0, strikePrice - finalUnderlyingPrice);
    }

    const settlementResults = positions.map(pos => {
      const isITM = payoffPerContract > 0;
      const multiplier = pos.side === 'LONG' ? 1 : -1;
      const settlementAmount = isITM ? payoffPerContract * pos.quantity * multiplier : 0;

      return {
        botId: pos.botId,
        contractTicker,
        status: isITM ? 'EXERCISED_ITM' : 'EXPIRED_OTM',
        payoffPerContract,
        netPnl: settlementAmount
      };
    });

    // 해당 종목의 호가창 폐기
    this.orderBooks.delete(contractTicker);

    return settlementResults;
  }
}
