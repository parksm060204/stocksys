import { memoryDb, StockRecord, TradeRecord, OrderRecord } from '../memoryDb/memoryStore';
import { createMemoryDbClient } from '../memoryDb/memoryDbClient';
import { printLocalBannerOnce } from './localDevMode';
import { withStockLock, withAllStockLocks } from './marketService';
import { withAccountLocks } from '../memoryDb/accountLocks';
import { snapshotTradingState, rollbackTradingState, TradingSnapshot } from '../memoryDb/memoryTransaction';
import { calculateTradeFees, executeSettlement, SettlementTrade } from './settlement';
import { randomUUID } from 'crypto';
import { AgentManager } from './simulation/agentManager';
import { SerialExecutionQueue } from './simulation/executionQueue';

interface GlobalWithEngine {
  __STOCKSYS_ENGINE__?: LocalMarketEngineInstance;
  __STOCKSYS_ENGINE_INITIALIZING__?: boolean;
}

type StandaloneFailureHook = (context: { stockId: string }) => void | boolean | Promise<void | boolean>;
let _standaloneTestFailureHook: StandaloneFailureHook | null = null;

/** @internal Test-only: inject a failure in processMatching after settlement, before state updates. */
export function __setStandaloneFailureHook(hook: StandaloneFailureHook | null): void {
  _standaloneTestFailureHook = hook;
}

const globalObj = globalThis as unknown as GlobalWithEngine;

export class LocalMarketEngineInstance {
  private isRunning: boolean = false;
  private tickIntervalMs: number = 1000;
  private timer: NodeJS.Timeout | null = null;
  private tickCount: number = 0;
  private simulationQueue = new SerialExecutionQueue();
  private client = createMemoryDbClient();
  private readonly LP_REFRESH_TICKS: number = 5;
  private readonly MAX_RETAINED_LP_ORDERS_PER_STOCK: number = 30;

  public agentManager: AgentManager = new AgentManager();

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

  /**
   * 시뮬레이션을 수동으로 dt초만큼 전진 (타이머 없이 동기적/결정론적 테스트 지원)
   */
  public async stepSimulation(dt: number = 1.0): Promise<void> {
    await this.enqueueSimulation(() => this.agentManager.step(dt));
  }

  public async tick(): Promise<void> {
    await this.enqueueSimulation(() => this.runTick());
  }

  public async publishEvent(event: Parameters<AgentManager['publishEvent']>[0]): Promise<boolean> {
    return this.enqueueSimulation(() => Promise.resolve(this.agentManager.publishEvent(event)));
  }

  public async resetSimulation(): Promise<void> {
    await this.enqueueSimulation(async () => {
      const stockIds = Array.from(memoryDb.stocks.keys());
      await withAllStockLocks(stockIds, async () => {
        memoryDb.resetToSeedData();
        this.agentManager.reset();
        this.tickCount = 0;
      });
    });
  }

  private enqueueSimulation<T>(task: () => Promise<T>): Promise<T> {
    return this.simulationQueue.run(task);
  }

  private async runTick(): Promise<void> {
    this.tickCount++;

    // ── 1. 에이전트 기반 시장(ABM) 1스텝 실행 ──
    // MJD SDE, 재고 기반 LP 호가 갱신, 가치 투자자 및 추세 추종자 의사결정 및 즉시 매칭
    await this.agentManager.step(1.0);

    // ── 2. 오래된 봇 주문 및 종료된 LP 주문 메모리 정리 (Memory Leak 방지) ──
    if (this.tickCount % 20 === 0) {
      const nowMs = Date.now();
      for (const [id, order] of Array.from(memoryDb.orders.entries())) {
        // 사용자 미체결/보유 주문은 보존
        if (order.user_id) continue;

        // 일반 봇 주문 정리: 60초 초과 또는 체결/취소 완료
        if (!order.is_lp) {
          if (
            order.status === 'filled' ||
            order.status === 'cancelled' ||
            nowMs - new Date(order.created_at).getTime() > 60_000
          ) {
            memoryDb.orders.delete(id);
            memoryDb.removeOrderFromIndex(order);
          }
        } else {
          // 종료된 LP 주문(filled / cancelled) 30초 초과 시 정리
          if (
            (order.status === 'filled' || order.status === 'cancelled') &&
            nowMs - new Date(order.created_at).getTime() > 30_000
          ) {
            memoryDb.orders.delete(id);
            memoryDb.removeOrderFromIndex(order);
          }
        }
      }

      await this.client.rpc('trim_old_market_data', { p_max_trades: 5000, p_max_history: 3000 });
    }
  }

  /**
   * 안정적 ID 및 차분 갱신을 사용한 LP 호가 관리.
   * 종료된 LP 주문 누적을 방지하고, 호가 점멸을 최소화하며, 사용자 주문은 완전 보존.
   */
  public async refreshLpOrders(): Promise<void> {
    const now = Date.now();
    const stockIds = Array.from(memoryDb.stocks.keys());

    for (const stockId of stockIds) {
      await withStockLock(stockId, async () => {
        // 락 내부에서 현재 DB에 존재하는 최신 종목 객체 조회 (대기 중 교체/삭제 방어)
        const stk = memoryDb.stocks.get(stockId);
        if (!stk) return;

        const cp = stk.current_price;
        const tick = this.getTickSize(cp);
        const baseVol = cp >= 50000 ? 2500 : cp >= 10000 ? 800 : 200;

        // 종목별 종료된 LP 주문 보존 한도(cap) 적용
        const existingStockOrderIds = memoryDb.orderStockIndex.get(stockId);
        if (existingStockOrderIds) {
          const finishedLpOrders: OrderRecord[] = [];
          for (const oId of existingStockOrderIds) {
            const ord = memoryDb.orders.get(oId);
            if (ord && ord.is_lp && (ord.status === 'filled' || ord.status === 'cancelled')) {
              finishedLpOrders.push(ord);
            }
          }

          if (finishedLpOrders.length > this.MAX_RETAINED_LP_ORDERS_PER_STOCK) {
            finishedLpOrders.sort((a, b) => a.created_at.localeCompare(b.created_at));
            const removeCount = finishedLpOrders.length - this.MAX_RETAINED_LP_ORDERS_PER_STOCK;
            for (let i = 0; i < removeCount; i++) {
              const toRemove = finishedLpOrders[i];
              memoryDb.orders.delete(toRemove.id);
              memoryDb.removeOrderFromIndex(toRemove);
            }
          }
        }

        // 안정적인 ID를 사용한 10단 호가 차분 갱신 (점멸 방지)
        for (let level = 1; level <= 10; level++) {
          // BUY LP 호가
          const bidPrice = cp - level * tick;
          if (bidPrice > 0) {
            const bidId = `lp_${stk.id}_bid_${level}`;
            const bidSize = Math.round(baseVol * (1 + (10 - level) * 0.15));
            const existingBid = memoryDb.orders.get(bidId);

            if (existingBid && (existingBid.status === 'open' || existingBid.status === 'partial') && existingBid.price === bidPrice) {
              // 가격이 동일하면 수량만 조정하거나 기존 호가 유지 (점멸 방지)
              existingBid.size = bidSize;
            } else {
              // 신규 등록 또는 가격 변동 시 업데이트
              const ord: OrderRecord = {
                id: bidId,
                stock_id: stk.id,
                user_id: null,
                side: 'buy',
                price: bidPrice,
                size: bidSize,
                filled: 0,
                status: 'open',
                is_lp: true,
                created_at: new Date(now).toISOString(),
              };
              memoryDb.orders.set(bidId, ord);
              memoryDb.addOrderToIndex(ord);
            }
          }

          // SELL LP 호가
          const askPrice = cp + level * tick;
          const askId = `lp_${stk.id}_ask_${level}`;
          const askSize = Math.round(baseVol * (1 + (10 - level) * 0.15));
          const existingAsk = memoryDb.orders.get(askId);

          if (existingAsk && (existingAsk.status === 'open' || existingAsk.status === 'partial') && existingAsk.price === askPrice) {
            existingAsk.size = askSize;
          } else {
            const aOrd: OrderRecord = {
              id: askId,
              stock_id: stk.id,
              user_id: null,
              side: 'sell',
              price: askPrice,
              size: askSize,
              filled: 0,
              status: 'open',
              is_lp: true,
              created_at: new Date(now).toISOString(),
            };
            memoryDb.orders.set(askId, aOrd);
            memoryDb.addOrderToIndex(aOrd);
          }
        }
      });
    }
  }

  /**
   * 자동 시장 엔진의 연속 매칭 및 원자적 정산.
   * - 종목별 lock (withStockLock) 적용으로 사용자 주문과 상호 배제
   * - 봇/LP user_id=null 명시적 지원 (정상 봇 거래 허용)
   * - 동일 실제 사용자의 자기 매매 방지
   * - 정산 실패 또는 에러 발생 시 모든 상태(현금, 보유량, 주문, 거래, 종목 통계, 가격 기록, 인덱스) 완전 롤백
   * - 확정된 상태만 외부에 발행
   */
  public async processMatching(botOrders: any[]): Promise<void> {
    // 1. 봇 주문을 stock_id별로 분류
    const botOrdersByStock = new Map<string, any[]>();
    for (const b of botOrders) {
      if (!botOrdersByStock.has(b.stock_id)) {
        botOrdersByStock.set(b.stock_id, []);
      }
      botOrdersByStock.get(b.stock_id)!.push(b);
    }

    // 활성화된 주문이 있는 모든 종목 수집
    const targetStockIds = new Set<string>(botOrdersByStock.keys());
    for (const ord of memoryDb.orders.values()) {
      if (ord.status === 'open' || ord.status === 'partial') {
        targetStockIds.add(ord.stock_id);
      }
    }

    for (const stockId of targetStockIds) {
      // 종목 락으로 사용자 주문과의 동시성 완전 직렬화
      await withStockLock(stockId, async () => {
        // 락 획득 후 현재 DB에 존재하는 최신 종목 객체 조회 (대기 중 교체/삭제 방어)
        const stock = memoryDb.stocks.get(stockId);
        if (!stock) return;

        // 2. 해당 종목의 봇 주문 등록
        const pendingBots = botOrdersByStock.get(stockId) || [];
        for (const b of pendingBots) {
          const id = `bot_ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const oRec: OrderRecord = { ...b, id };
          memoryDb.orders.set(id, oRec);
          memoryDb.addOrderToIndex(oRec);
        }

        // 3. 해당 종목의 미체결 주문 집계
        const bids: OrderRecord[] = [];
        const asks: OrderRecord[] = [];

        const stockOrderIds = memoryDb.orderStockIndex.get(stockId);
        if (stockOrderIds) {
          for (const oId of stockOrderIds) {
            const ord = memoryDb.orders.get(oId);
            if (!ord || (ord.status !== 'open' && ord.status !== 'partial')) continue;
            if (ord.side === 'buy') bids.push(ord);
            else asks.push(ord);
          }
        }

        if (bids.length === 0 || asks.length === 0) return;

        // 가격 우선, 시간 우선 정렬
        // 매수: 가격 내림차순, 시간 오름차순
        bids.sort((a, b) => b.price !== a.price ? b.price - a.price : a.created_at.localeCompare(b.created_at));
        // 매도: 가격 오름차순, 시간 오름차순
        asks.sort((a, b) => a.price !== b.price ? a.price - b.price : a.created_at.localeCompare(b.created_at));

        const tradesToSettle: SettlementTrade[] = [];
        const orderUpdates: { orderId: string; newFilled: number; newStatus: OrderRecord['status'] }[] = [];
        const involvedUserIds = new Set<string>();
        const localFilledMap = new Map<string, number>();

        let executionHigh = -Infinity;
        let executionLow = Infinity;
        let lastExecPrice: number | null = null;
        let matchedVol = 0;
        const now = new Date().toISOString();

        let bidIdx = 0;
        let askIdx = 0;

        while (bidIdx < bids.length && askIdx < asks.length) {
          const topBid = bids[bidIdx]!;
          const topAsk = asks[askIdx]!;

          if (topBid.price < topAsk.price) break; // Cross 미발생

          // [Self-Trade Prevention] 동일한 실제 사용자끼리의 체결 방지
          // 봇/LP(user_id === null)는 자기 매매 차단 대상이 아니며, 정상 거래 가능
          if (topBid.user_id && topAsk.user_id && topBid.user_id === topAsk.user_id) {
            // 나중에 들어온 쪽(taker)을 건너뜀
            if (topBid.created_at > topAsk.created_at) {
              bidIdx++;
            } else {
              askIdx++;
            }
            continue;
          }

          const curBidFilled = localFilledMap.get(topBid.id) ?? (topBid.filled || 0);
          const curAskFilled = localFilledMap.get(topAsk.id) ?? (topAsk.filled || 0);
          const bidRemain = topBid.size - curBidFilled;
          const askRemain = topAsk.size - curAskFilled;
          const matchQty = Math.min(bidRemain, askRemain);

          if (matchQty <= 0) {
            if (bidRemain <= 0) bidIdx++;
            if (askRemain <= 0) askIdx++;
            continue;
          }

          // Maker-Taker 판별 (더 일찍 생성된 주문이 Maker)
          const isBidMaker = topBid.created_at <= topAsk.created_at;
          const execPrice = isBidMaker ? topBid.price : topAsk.price;

          lastExecPrice = execPrice;
          executionHigh = Math.max(executionHigh, execPrice);
          executionLow = Math.min(executionLow, execPrice);
          matchedVol += matchQty;

          const newBidFilled = curBidFilled + matchQty;
          const newAskFilled = curAskFilled + matchQty;
          const newBidStatus: OrderRecord['status'] = newBidFilled >= topBid.size ? 'filled' : 'partial';
          const newAskStatus: OrderRecord['status'] = newAskFilled >= topAsk.size ? 'filled' : 'partial';

          localFilledMap.set(topBid.id, newBidFilled);
          localFilledMap.set(topAsk.id, newAskFilled);

          orderUpdates.push({ orderId: topBid.id, newFilled: newBidFilled, newStatus: newBidStatus });
          orderUpdates.push({ orderId: topAsk.id, newFilled: newAskFilled, newStatus: newAskStatus });

          // 수수료 계산
          const { buyer_fee, seller_fee } = calculateTradeFees(isBidMaker, !isBidMaker);
          const tradeId = `trade_${randomUUID()}`;

          tradesToSettle.push({
            id: tradeId,
            stock_id: stockId,
            buyer_id: topBid.user_id || null,
            seller_id: topAsk.user_id || null,
            buyer_is_bot: !topBid.user_id,
            seller_is_bot: !topAsk.user_id,
            price: execPrice,
            size: matchQty,
            buyer_fee,
            seller_fee,
            created_at: now,
          });

          if (topBid.user_id) involvedUserIds.add(topBid.user_id);
          if (topAsk.user_id) involvedUserIds.add(topAsk.user_id);

          if (newBidStatus === 'filled') bidIdx++;
          if (newAskStatus === 'filled') askIdx++;
        }

        if (tradesToSettle.length === 0) return;

        // 실제 사용자 계정 락 획득 후 원자적 정산 실행
        const userIdsArray = Array.from(involvedUserIds);
        await withAccountLocks(userIdsArray, async () => {
          const snap: TradingSnapshot = snapshotTradingState(stockId, userIdsArray);
          for (const t of tradesToSettle) {
            if (t.id) snap.createdTradeIds.add(t.id);
          }

          try {
            // 정산 실행 및 검증
            const settleResult = await executeSettlement(this.client, tradesToSettle);
            if (!settleResult.success) {
              throw new Error(settleResult.error?.message || '자동 매칭 정산 실패');
            }

            for (const tradeId of settleResult.trade_ids) {
              snap.createdTradeIds.add(tradeId);
            }

            // ── Test-only failure hook after settlement ──
            if (_standaloneTestFailureHook) {
              const hookResult = await _standaloneTestFailureHook({ stockId });
              if (hookResult !== false) {
                throw new Error('[TEST] Injected standalone post-settlement failure');
              }
            }

            // 정산 성공 확정 후 주문 상태 실제 갱신
            for (const update of orderUpdates) {
              const liveOrder = memoryDb.orders.get(update.orderId);
              if (liveOrder) {
                liveOrder.filled = update.newFilled;
                liveOrder.status = update.newStatus;
              }
            }

            // 종목 현재가, 최고가, 최저가, 거래량 확정 반영
            if (lastExecPrice !== null && lastExecPrice > 0) {
              const liveStock = memoryDb.stocks.get(stockId);
              if (!liveStock) return;

              const curHigh = Number(liveStock.high || 0);
              const curLow = Number(liveStock.low || 0);
              const newHigh = Math.max(curHigh, executionHigh);
              const newLow = curLow === 0 ? executionLow : Math.min(curLow, executionLow);

              liveStock.current_price = lastExecPrice;
              liveStock.high = newHigh;
              liveStock.low = newLow;
              liveStock.high_price = newHigh;
              liveStock.low_price = newLow;
              liveStock.volume = Number(liveStock.volume || 0) + matchedVol;
              liveStock.change_rate = parseFloat((((lastExecPrice - liveStock.previous_close) / liveStock.previous_close) * 100).toFixed(2));

              // 주가 히스토리 추가
              const histId = `hist_${stockId}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
              snap.createdHistoryIds.add(histId);
              memoryDb.stockPriceHistory.push({
                id: histId,
                stock_id: stockId,
                price: lastExecPrice,
                recorded_at: now,
              });

              // 외부에 확정된 시세 발행
              memoryDb.publish('stocks_changes', { eventType: 'UPDATE', new: liveStock });
            }
          } catch (err) {
            console.error(`[LocalMarketEngine] Matching settlement failed for stock ${stockId}, rolling back:`, err);
            rollbackTradingState(snap);
            // 에러를 상위로 전파하지 않고 해당 틱 롤백 완료
          }
        });
      });
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

export function stopLocalStandaloneEngine(): void {
  if (globalObj.__STOCKSYS_ENGINE__) {
    globalObj.__STOCKSYS_ENGINE__.stop();
    globalObj.__STOCKSYS_ENGINE__ = undefined;
  }
}

export function getLocalStandaloneEngine(): LocalMarketEngineInstance | undefined {
  return globalObj.__STOCKSYS_ENGINE__;
}

export function getLocalStandaloneClient(): any {
  return createMemoryDbClient();
}
