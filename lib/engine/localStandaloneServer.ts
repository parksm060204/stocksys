import { memoryDb, StockRecord, TradeRecord, OrderRecord } from '../memoryDb/memoryStore';
import { createMockSupabaseClient } from '../memoryDb/mockSupabaseClient';
import { printLocalBannerOnce } from './localDevMode';

interface GlobalWithEngine {
  __STOCKSYS_ENGINE__?: LocalMarketEngineInstance;
  __STOCKSYS_ENGINE_INITIALIZING__?: boolean;
}

const globalObj = globalThis as unknown as GlobalWithEngine;

class LocalMarketEngineInstance {
  private isRunning: boolean = false;
  private tickIntervalMs: number = 1000;
  private timer: NodeJS.Timeout | null = null;
  private tickCount: number = 0;
  private client = createMockSupabaseClient();
  private readonly LP_REFRESH_TICKS: number = 5;

  // SDE: Merton Jump-Diffusion 가치 변동
  private fundamentals: Record<string, number> = {};
  private readonly mjd_mu: number = 0.0001;
  private readonly mjd_sigma: number = 0.004;
  private readonly mjd_lambda: number = 0.01;

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    printLocalBannerOnce();
    console.log('🚀 [LocalMarketEngine] Dev Engine started inside Next.js Node process.');

    this.scheduleTick(1000);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('🛑 [LocalMarketEngine] Dev Engine stopped.');
  }

  private scheduleTick(delayMs: number): void {
    if (!this.isRunning) return;
    this.timer = setTimeout(async () => {
      const startTime = Date.now();
      try {
        await this.tick();
      } catch (err) {
        console.error('❌ [LocalMarketEngine] Tick Error:', err);
      }
      const elapsed = Date.now() - startTime;
      const nextDelay = Math.max(300, Math.min(2500, this.tickIntervalMs - elapsed));
      this.scheduleTick(nextDelay);
    }, delayMs);
  }

  private async tick(): Promise<void> {
    this.tickCount++;

    // ── 1. 5틱마다 LP 호가 갱신 ──
    const shouldRefreshLp = this.tickCount % this.LP_REFRESH_TICKS === 0;
    if (shouldRefreshLp) {
      await this.refreshLpOrders();
    }

    // ── 2. MJD 주가 펀더멘털 및 시장 변동 시뮬레이션 ──
    for (const stock of memoryDb.stocks.values()) {
      if (!this.fundamentals[stock.id]) {
        this.fundamentals[stock.id] = stock.current_price;
      }
      const f = this.fundamentals[stock.id]!;
      const dW = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.732;
      let jump = 0;
      if (Math.random() < this.mjd_lambda) {
        jump = (Math.random() - 0.5) * 0.05;
      }
      const dF = f * (this.mjd_mu + this.mjd_sigma * dW + jump);
      this.fundamentals[stock.id] = Math.max(100, f + dF);
    }

    // ── 3. 봇 주문 생성 (Retail & Institutional Bot Flow) ──
    const botOrders: any[] = [];
    const stockList = Array.from(memoryDb.stocks.values());

    for (const stock of stockList) {
      const cp = stock.current_price;
      const tick = this.getTickSize(cp);
      const f = this.fundamentals[stock.id] || cp;

      // 봇 매수/매도 성향 (펀더멘털 대비 고평가/저평가 판단)
      const diffPct = (f - cp) / cp;
      const isBuyHeavy = diffPct > 0.005 || Math.random() < 0.48;

      // 매 틱 40% 확률로 봇 시장가/지정가 주문 발생
      if (Math.random() < 0.4) {
        const side = isBuyHeavy ? 'buy' : 'sell';
        const price = side === 'buy' ? cp + (Math.random() > 0.5 ? 0 : -tick) : cp - (Math.random() > 0.5 ? 0 : -tick);
        const alignedPrice = Math.max(tick, Math.round(price / tick) * tick);
        const size = Math.max(1, Math.min(500, Math.floor(20 + Math.random() * 80)));

        botOrders.push({
          stock_id: stock.id,
          user_id: null,
          side,
          price: alignedPrice,
          size,
          filled: 0,
          status: 'open',
          is_lp: false,
          created_at: new Date().toISOString(),
        });
      }
    }

    // ── 4. 통합 매칭 엔진 실행 (LP + User Orders + Bot Orders) ──
    await this.processMatching(botOrders);

    // ── 5. 오래된 봇 주문 및 체결/취소 완료 주문 메모리 정리 (Memory Leak 방지) ──
    if (this.tickCount % 20 === 0) {
      const nowMs = Date.now();
      for (const [id, order] of Array.from(memoryDb.orders.entries())) {
        // 유저 주문(user_id 존재)은 유지, LP 주문은 refreshLpOrders에서 별도 관리
        // 봇 주문(!order.user_id && !order.is_lp) 중 체결 완료, 취소, 또는 60초 초과 미체결 주문 삭제
        if (
          !order.user_id &&
          !order.is_lp &&
          (order.status === 'filled' ||
           order.status === 'cancelled' ||
           nowMs - new Date(order.created_at).getTime() > 60_000)
        ) {
          memoryDb.orders.delete(id);
          memoryDb.removeOrderFromIndex(order);
        }
      }

      await this.client.rpc('trim_old_market_data', { p_max_trades: 5000, p_max_history: 3000 });
    }
  }

  private async refreshLpOrders(): Promise<void> {
    const now = Date.now();
    // 기존 LP 주문 정리
    for (const [id, ord] of Array.from(memoryDb.orders.entries())) {
      if (ord.is_lp && (ord.status === 'open' || ord.status === 'partial')) {
        memoryDb.orders.delete(id);
        memoryDb.removeOrderFromIndex(ord);
      }
    }

    // 종목별 신규 LP 호가 생성 (매수 10단, 매도 10단)
    for (const stk of memoryDb.stocks.values()) {
      const cp = stk.current_price;
      const tick = this.getTickSize(cp);
      const baseVol = cp >= 50000 ? 2500 : cp >= 10000 ? 800 : 200;

      for (let level = 1; level <= 10; level++) {
        const bidPrice = cp - level * tick;
        if (bidPrice > 0) {
          const oId = `lp_bid_${stk.id}_${level}_${now}`;
          const ord: OrderRecord = {
            id: oId,
            stock_id: stk.id,
            user_id: null,
            side: 'buy',
            price: bidPrice,
            size: Math.round(baseVol * (1 + (10 - level) * 0.15)),
            filled: 0,
            status: 'open',
            is_lp: true,
            created_at: new Date(now - (11 - level) * 1000).toISOString(),
          };
          memoryDb.orders.set(oId, ord);
          memoryDb.addOrderToIndex(ord);
        }

        const askPrice = cp + level * tick;
        const aId = `lp_ask_${stk.id}_${level}_${now}`;
        const aOrd: OrderRecord = {
          id: aId,
          stock_id: stk.id,
          user_id: null,
          side: 'sell',
          price: askPrice,
          size: Math.round(baseVol * (1 + (10 - level) * 0.15)),
          filled: 0,
          status: 'open',
          is_lp: true,
          created_at: new Date(now - (11 - level) * 1000).toISOString(),
        };
        memoryDb.orders.set(aId, aOrd);
        memoryDb.addOrderToIndex(aOrd);
      }
    }
  }

  private async processMatching(botOrders: any[]): Promise<void> {
    // 1. 봇 주문을 orders에 임시 등록
    for (const b of botOrders) {
      const id = `bot_ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const oRec: OrderRecord = { ...b, id };
      memoryDb.orders.set(id, oRec);
      memoryDb.addOrderToIndex(oRec);
    }

    // 2. 종목별 미체결 주문 집계
    const openOrdersByStock: Record<string, { bids: OrderRecord[]; asks: OrderRecord[] }> = {};

    for (const ord of memoryDb.orders.values()) {
      if (ord.status !== 'open' && ord.status !== 'partial') continue;
      if (!openOrdersByStock[ord.stock_id]) {
        openOrdersByStock[ord.stock_id] = { bids: [], asks: [] };
      }
      if (ord.side === 'buy') {
        openOrdersByStock[ord.stock_id]!.bids.push(ord);
      } else {
        openOrdersByStock[ord.stock_id]!.asks.push(ord);
      }
    }

    const settledTrades: any[] = [];
    const now = new Date().toISOString();

    for (const stockId of Object.keys(openOrdersByStock)) {
      const book = openOrdersByStock[stockId]!;
      const stock = memoryDb.stocks.get(stockId);
      if (!stock) continue;

      // 매수: 가격 내림차순, 시간 오름차순
      book.bids.sort((a, b) => b.price !== a.price ? b.price - a.price : a.created_at.localeCompare(b.created_at));
      // 매도: 가격 오름차순, 시간 오름차순
      book.asks.sort((a, b) => a.price !== b.price ? a.price - b.price : a.created_at.localeCompare(b.created_at));

      let lastExecPrice: number | null = null;
      let matchedVol = 0;

      while (book.bids.length > 0 && book.asks.length > 0) {
        const topBid = book.bids[0]!;
        const topAsk = book.asks[0]!;

        if (topBid.price < topAsk.price) break; // Cross 미발생

        const bidRemain = topBid.size - topBid.filled;
        const askRemain = topAsk.size - topAsk.filled;
        const matchQty = Math.min(bidRemain, askRemain);

        if (matchQty <= 0) break;

        // Maker-Taker 판별 (더 일찍 생성되어 호가창에 resting 중이던 주문이 Maker)
        const isBidMaker = topBid.created_at <= topAsk.created_at;
        // 체결가는 Price-Time Priority에 따라 먼저 대기 중이던 Maker의 호가로 체결
        const execPrice = isBidMaker ? topBid.price : topAsk.price;
        lastExecPrice = execPrice;
        matchedVol += matchQty;

        topBid.filled += matchQty;
        topAsk.filled += matchQty;

        if (topBid.filled >= topBid.size) {
          topBid.status = 'filled';
          book.bids.shift();
        } else {
          topBid.status = 'partial';
        }

        if (topAsk.filled >= topAsk.size) {
          topAsk.status = 'filled';
          book.asks.shift();
        } else {
          topAsk.status = 'partial';
        }

        const bidFee = isBidMaker ? -0.001 : 0.0025;
        const askFee = isBidMaker ? 0.0025 : -0.001;

        settledTrades.push({
          stock_id: stockId,
          buyer_id: topBid.user_id,
          seller_id: topAsk.user_id,
          buyer_is_bot: !topBid.user_id,
          seller_is_bot: !topAsk.user_id,
          price: execPrice,
          size: matchQty,
          buyer_fee: bidFee,
          seller_fee: askFee,
          created_at: now,
        });
      }

      // 종목 현재가 및 통계 업데이트
      if (lastExecPrice !== null && lastExecPrice > 0) {
        stock.current_price = lastExecPrice;
        stock.high_price = Math.max(stock.high_price, lastExecPrice);
        stock.low_price = Math.min(stock.low_price, lastExecPrice);
        stock.volume += matchedVol;
        stock.change_rate = parseFloat((((lastExecPrice - stock.previous_close) / stock.previous_close) * 100).toFixed(2));
        memoryDb.publish('stocks_changes', { eventType: 'UPDATE', new: stock });

        // 주가 히스토리 추가
        memoryDb.stockPriceHistory.push({
          id: `hist_${stockId}_${Date.now()}`,
          stock_id: stockId,
          price: lastExecPrice,
          recorded_at: now,
        });
      }
    }

    // 체결 정산 RPC 실행
    if (settledTrades.length > 0) {
      await this.client.rpc('bulk_settle_trades', { p_trades: settledTrades });
    }
  }

  private getTickSize(price: number): number {
    if (price < 2000) return 1;
    if (price < 5000) return 5;
    if (price < 20000) return 10;
    if (price < 50000) return 50;
    if (price < 200000) return 100;
    if (price < 500000) return 500;
    return 1000;
  }
}

export function ensureLocalStandaloneEngine(): void {
  if (globalObj.__STOCKSYS_ENGINE__) return;
  if (globalObj.__STOCKSYS_ENGINE_INITIALIZING__) return;

  globalObj.__STOCKSYS_ENGINE_INITIALIZING__ = true;
  try {
    const engine = new LocalMarketEngineInstance();
    engine.start().catch((err) => {
      console.error('[LocalMarketEngine] Failed to start:', err);
    });
    globalObj.__STOCKSYS_ENGINE__ = engine;
  } finally {
    globalObj.__STOCKSYS_ENGINE_INITIALIZING__ = false;
  }
}
