import { BaseAgent } from "./BaseAgent";

export class ASMarketMakerAgent extends BaseAgent {
  private inventory: Record<string, number> = {};
  
  // Avellaneda-Stoikov 파라미터 (DRL 연동 전 휴리스틱 상수)
  private readonly gamma: number = 0.1; // Risk aversion (재고 기피 성향)
  private readonly k: number = 1.5; // 호가창 유동성 파라미터 (Order book liquidity)
  private readonly sigma2: number = 100; // 분산 (추정치)

  constructor() {
    super('bot_as_mm_001', 100000000000); // 1000억
  }

  public executeMarketMaking(currentMarket: any) {
    const orders: any[] = [];
    const availableStocks = currentMarket.stocks || [];

    for (const stock of availableStocks) {
      if (!this.inventory[stock.id]) this.inventory[stock.id] = 0;
      
      const s = stock.current_price;
      const baseQty = Math.floor(1000000 / s) || 1; // 100만 원 규모를 1단위로 정규화
      const q = (this.inventory[stock.id] || 0) / baseQty;
      
      // 변동성 동적 추정 (최근 수익률 절대값 기반) 및 상한 5000 클램프
      const dayReturn = Math.abs((stock.current_price - stock.previous_close) / stock.previous_close);
      const dynamicSigma2 = Math.min(5000, Math.max(10, dayReturn * 100000)); // 변동성이 커지면 스프레드 폭증

      // 위기 시 감마(위험 회피) 폭증 트리거
      let currentGamma = this.gamma;
      if (dynamicSigma2 > 500) {
        currentGamma = 0.9; // DRL 정책망이 '위험'을 감지했다고 가정 (Extreme Risk Aversion)
      }

      // AS 모델: 유보 가격 (Reservation Price)
      // r = s - q * gamma * sigma^2
      // 재고(q)가 많으면 r이 낮아져 매도(asks)를 시장가에 가깝게 붙이고 매수(bids)를 멀리 뺌
      const r = s - (q * currentGamma * dynamicSigma2);

      // AS 모델: 최적 스프레드
      // spread = gamma * sigma^2 + (2/gamma) * ln(1 + gamma/k)
      const rawSpread = (currentGamma * dynamicSigma2) + (2 / currentGamma) * Math.log(1 + currentGamma / this.k);
      // 스프레드 상한: 현재가의 2% (HTS 시장 통상 수준)
      const maxSpread = s * 0.02;
      const spread = Math.min(rawSpread, maxSpread);
      
      const delta = spread / 2;
      const tickSize = this.getTickSize(s);

      // 매수/매도 호가 결정
      const bidPrice = Math.floor((r - delta) / tickSize) * tickSize;
      const askPrice = Math.ceil((r + delta) / tickSize) * tickSize;

      // 틱 사이즈 보정
      const baseBid = Math.min(bidPrice, s - tickSize);
      const baseAsk = Math.max(askPrice, s + tickSize);
      const maxQty = Math.floor(1000000 / s) || 10;

      // 5~10호가 촘촘한 LP 레이어 생성
      for (let level = 0; level < 5; level++) {
        const pBid = Math.max(tickSize, baseBid - level * tickSize);
        const pAsk = baseAsk + level * tickSize;
        const qty = Math.max(1, Math.floor(maxQty * (1 + level * 0.5)));

        orders.push({
          stock_id: stock.id,
          user_id: null,
          side: 'buy',
          price: pBid,
          size: qty,
          status: 'open',
          is_lp: true,
          _botId: this.botId
        });

        orders.push({
          stock_id: stock.id,
          user_id: null,
          side: 'sell',
          price: pAsk,
          size: qty,
          status: 'open',
          is_lp: true,
          _botId: this.botId
        });
      }
    }

    return orders;
  }

  // 체결 시 재고 업데이트용 (Engine에서 호출해야 함)
  public updateInventory(stockId: string, deltaQty: number) {
    if (!this.inventory[stockId]) this.inventory[stockId] = 0;
    this.inventory[stockId] += deltaQty;
  }

  public confirmExecution(assetClass: 'stock' | 'bond' | 'commodity', side: 'buy' | 'sell', filledQty: number, filledPrice: number, stockId?: string) {
    super.confirmExecution(assetClass, side, filledQty, filledPrice, stockId);
    if (assetClass === 'stock' && stockId) {
      const delta = side === 'buy' ? filledQty : -filledQty;
      this.updateInventory(stockId, delta);
    }
  }
}
