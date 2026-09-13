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

  public executeMarketMaking(currentMarket: any, orderBook?: any) {
    const orders: any[] = [];
    const availableStocks = currentMarket.stocks || [];

    for (const stock of availableStocks) {
      if (!this.inventory[stock.id]) this.inventory[stock.id] = 0;
      
      const s = stock.current_price;
      const baseQty = Math.floor(1000000 / s) || 1; // 100만 원 규모를 1단위로 정규화
      const q = (this.inventory[stock.id] || 0) / baseQty;
      
      // 변동성 동적 추정 (최근 수익률 절대값 기반)
      const dayReturn = Math.abs((stock.current_price - stock.previous_close) / stock.previous_close);
      const dynamicSigma2 = Math.min(5000, Math.max(10, dayReturn * 100000));

      let currentGamma = this.gamma;
      if (dynamicSigma2 > 500) {
        currentGamma = 0.9; // Extreme Risk Aversion
      }

      // 1. Avellaneda-Stoikov Reservation Price (r) & Spread (s)
      const rawR = s - (q * currentGamma * dynamicSigma2);
      const r = Math.max(s * 0.9, Math.min(s * 1.1, rawR)); // 주가의 ±10% 이내로 Reservation Price 안전 유도

      // AS 모델 최적 스프레드
      const rawSpread = (currentGamma * dynamicSigma2) + (2 / currentGamma) * Math.log(1 + currentGamma / this.k);
      const maxSpread = s * 0.02; // 최대 2%
      const spread = Math.min(rawSpread, maxSpread);
      
      const delta = spread / 2;
      const tickSize = this.getTickSize(s);

      // 2. Orderbook Imbalance (OFI / Fade Filter)
      // 매도 잔량이 매수 잔량보다 월등히 많아 폭락 위험(Imbalance < -0.5) 시 매수 호가를 뒤로 뺌 (Fade)
      const stockBook = orderBook?.[stock.id] || stock.orderBook || { bids: [], asks: [] };
      const totalBids = (stockBook.bids || []).reduce((acc: number, b: any) => acc + (b.size || 0), 0);
      const totalAsks = (stockBook.asks || []).reduce((acc: number, a: any) => acc + (a.size || 0), 0);
      const totalVol = totalBids + totalAsks;
      const imbalance = totalVol > 0 ? (totalBids - totalAsks) / totalVol : 0;

      let fadeOffset = 0;
      let bidSizeMultiplier = 1.0;
      let askFadeOffset = 0;

      // 🧠 HFT Strategy 3: 돌파(Breakout) 임박 감지 시 매도 호가 후퇴 (Liquidity Vacuum 형성)
      const bestAsk = stockBook.asks?.[0] || { price: s + tickSize, size: 5000 };
      if (imbalance > 0.6 || (bestAsk.size > 0 && bestAsk.size < 800)) {
        // 상방 돌파 임박 -> Adverse Selection 방어: 매도 호가 4틱 위로 급후퇴하여 호가 공백(진공) 연출
        askFadeOffset = tickSize * 4;
      }

      if (imbalance < -0.5) {
        // 매도 압력 극심 -> 칼날 잡기 방지: 매수 호가 2틱 아래로 후퇴 (Fade)
        fadeOffset = tickSize * 2;
        bidSizeMultiplier = 0.5; // 매수 수량 50% 축소
      }

      // 매수/매도 기준 가격 산출
      const bidPrice = Math.floor((r - delta - fadeOffset) / tickSize) * tickSize;
      const askPrice = Math.ceil((r + delta + askFadeOffset) / tickSize) * tickSize;

      const baseBid = Math.min(bidPrice, s - tickSize);
      const baseAsk = Math.max(askPrice, s + tickSize + askFadeOffset);
      const maxQty = Math.floor(1000000 / s) || 10;

      // 3. Multi-Band Exponential Quote Layering (5단계 기하급수적 호가 배치)
      // Delta Update 방식: 기존 LP 주문을 확인하고 필요한 호가만 보충(INSERT), 벗어난 호가는 취소(CANCEL)
      const idealBids = new Map<number, number>();
      const idealAsks = new Map<number, number>();

      for (let level = 0; level < 5; level++) {
        const pBid = Math.max(tickSize, baseBid - level * tickSize);
        const pAsk = baseAsk + level * tickSize;
        
        // 지수적 물량 배치
        const expMultiplier = Math.exp(0.25 * level);
        const buyQty = Math.max(1, Math.floor(maxQty * expMultiplier * bidSizeMultiplier));
        const sellQty = Math.max(1, Math.floor(maxQty * expMultiplier));

        idealBids.set(pBid, buyQty);
        idealAsks.set(pAsk, sellQty);
      }

      // 기존 나의 LP 주문 (또는 이 봇이 관리하는 LP 주문) 식별
      const existingLpBids = (stockBook.bids || []).filter((b: any) => b.is_lp && (b._botId === this.botId || !b.user_id));
      const existingLpAsks = (stockBook.asks || []).filter((a: any) => a.is_lp && (a._botId === this.botId || !a.user_id));

      // 취소 대상 판별 및 기존 주문 유지 처리
      const fulfilledBids = new Set<number>();
      for (const b of existingLpBids) {
        if (!idealBids.has(b.price) && b.id) {
          // 이상적인 호가 범위를 벗어난 과거 주문 취소
          this.ordersToCancel.push(b.id);
        } else {
          // 이미 제자리에 있는 호가면 유지 (보충 불필요)
          fulfilledBids.add(b.price);
        }
      }

      const fulfilledAsks = new Set<number>();
      for (const a of existingLpAsks) {
        if (!idealAsks.has(a.price) && a.id) {
          this.ordersToCancel.push(a.id);
        } else {
          fulfilledAsks.add(a.price);
        }
      }

      // 4. 구멍난 호가(빈 호가)만 신규 생성 (Delta INSERT)
      for (const [pBid, buyQty] of Array.from(idealBids.entries())) {
        if (!fulfilledBids.has(pBid)) {
          orders.push(this.applyInstitutionalRiskControls({
            stock_id: stock.id,
            user_id: null,
            side: 'buy',
            price: pBid,
            size: buyQty,
            status: 'open',
            is_lp: true,
            _botId: this.botId
          }, stock.current_price));
        }
      }

      for (const [pAsk, sellQty] of Array.from(idealAsks.entries())) {
        if (!fulfilledAsks.has(pAsk)) {
          orders.push(this.applyInstitutionalRiskControls({
            stock_id: stock.id,
            user_id: null,
            side: 'sell',
            price: pAsk,
            size: sellQty,
            status: 'open',
            is_lp: true,
            _botId: this.botId
          }, stock.current_price));
        }
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
