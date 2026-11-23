export type DbClient = any;
import { validateOrderCapacity, getEffectiveStockTakerFeeRate, OpenOrderForRisk } from '@/lib/engine/orderRisk';
import { hasActiveFeeBooster } from '@/lib/shop/catalog';
import { SettlementTrade, calculateTradeFees, executeSettlement } from '@/lib/engine/settlement';
import { memoryDb, OrderRecord } from '@/lib/memoryDb/memoryStore';
import { snapshotTradingState, rollbackTradingState, TradingSnapshot } from '@/lib/memoryDb/memoryTransaction';
import { withAccountLocks } from '@/lib/memoryDb/accountLocks';
import { runWithCommitGate, persistenceManager } from '@/lib/memoryDb/PersistenceManager';

export interface OrderInput {
  stock_id: string;
  user_id: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  is_lp?: boolean;
  order_type?: 'limit' | 'ioc';
  created_at?: string;
  simulation_time?: number;
  sequence?: number;
  participant_type?: 'human' | 'bot' | 'lp';
  account_id?: string;
  agent_id?: string;
  onPersist?: () => Promise<boolean>;
  persistOnlyOnFill?: boolean;
}

export interface MatchOrderResult {
  success: boolean;
  filledQty: number;
  message: string;
  orderId?: string;
  execPrice?: number;
  lastExecPrice?: number;
  avgPrice?: number;
  status?: string;
  fills?: ExecutionFill[];
}

export interface ExecutionFill {
  tradeId: string;
  price: number;
  size: number;
  makerOrderId: string;
  takerOrderId: string;
}

// ── Test-only failure hook ──
// Set to a non-null function to force a failure at a specific internal step.
// MUST NOT be set in production code paths. Tests reset it after use.
type FailureHook = (context: { stockId: string }) => void | boolean | Promise<void | boolean>;
let _testFailureHook: FailureHook | null = null;

/** @internal Test-only: inject a failure that fires after settlement, before final order insert. */
export function __setTestFailureHook(hook: FailureHook | null): void {
  _testFailureHook = hook;
}

/**
 * 연속 쌍방 경매(Continuous Double Auction) 주문 검증, 즉시 대조 매칭 및 정산
 *
 * Architecture:
 *   1. Order capacity pre-validation (reserves cash/holdings)
 *   2. Price-Time Priority matching (finds counterparty resting orders)
 *   3. Settlement via bulk_settle_trades (cumulative validation + asset mutation)
 *   4. Maker order status updates (direct memoryDb write)
 *   5. Stock OHLC / volume update (direct memoryDb write)
 *   6. Incoming order insert (direct memoryDb write — orderId captured here)
 *
 * ALL writes in steps 3–6 are covered by a snapshot/rollback transaction.
 * If any write throws, the snapshot is restored atomically.
 *
 * [Self-Trade Prevention]
 * Opposite-order query excludes .neq('user_id', user_id) at DB layer
 * + defensive loop guard inside the fill loop.
 *
 * [Mutex]
 * This function is called exclusively through LocalMarketService.submitOrder()
 * which holds the per-stock lock for the entire duration.
 * Direct calls from outside the serialized path are intentionally unsupported.
 */
export async function submitAndMatchOrder(
  db: DbClient,
  input: OrderInput
): Promise<MatchOrderResult> {
  const { stock_id, user_id, side, price: incomingPrice, size: incomingSize } = input || {};

  if (!user_id || typeof user_id !== 'string' || user_id.trim() === '') {
    return { success: false, filledQty: 0, message: '인증된 사용자 정보가 필요합니다.' };
  }

  if (!stock_id || typeof stock_id !== 'string' || stock_id.trim() === '') {
    return { success: false, filledQty: 0, message: '올바른 종목 식별자(stock_id)가 필요합니다.' };
  }

  if (memoryDb.optionsContracts.has(stock_id)) {
    return {
      success: false,
      filledQty: 0,
      message: '옵션 계약은 일반 주식 주문 경로로 거래할 수 없습니다. 옵션 전용 주문 API(/api/options/order)를 이용해 주세요.',
    };
  }

  if (memoryDb.commodities.has(stock_id) || memoryDb.bonds.has(stock_id)) {
    return {
      success: false,
      filledQty: 0,
      message: '해당 자산군은 일반 주식 주문 경로로 거래할 수 없습니다.',
    };
  }

  if (!memoryDb.stocks.has(stock_id)) {
    return {
      success: false,
      filledQty: 0,
      message: '등록되지 않은 주식/ETF 종목입니다.',
    };
  }

  if (memoryDb.isTradingHalted()) {
    return {
      success: false,
      filledQty: 0,
      message: '현재 관리자 긴급 서킷브레이커(거래 동결)가 발동되어 신규 주문을 접수할 수 없습니다.',
    };
  }

  if (incomingSize <= 0 || incomingPrice <= 0) {
    return { success: false, filledQty: 0, message: '올바르지 않은 주문 가격 또는 수량입니다.' };
  }

  try {
    let lockAccountKeys = [memoryDb.resolveAccountLockKey(user_id)];
    for (;;) {
      const outcome = await withAccountLocks(lockAccountKeys, async () => {
    if (memoryDb.isTradingHalted()) {
      return {
        success: false,
        filledQty: 0,
        message: '현재 관리자 긴급 서킷브레이커(거래 동결)가 발동되어 신규 주문을 접수할 수 없습니다.',
      };
    }
    // ── 0. Order Capacity Pre-Validation ──
    // Reads open/partial orders, current cash, current holding — pure reads, no mutation.
    {
      const { data: userOpenOrders, error: ordersErr } = await db
        .from('orders')
        .select('id, user_id, stock_id, side, price, size, filled, status')
        .eq('user_id', user_id)
        .in('status', ['open', 'partial']);

      if (ordersErr) throw ordersErr;

      const { data: profile } = await db
        .from('profiles')
        .select('cash')
        .eq('user_id', user_id)
        .maybeSingle();
      const currentCash = Number(profile?.cash || 0);

      const { data: holding } = await db
        .from('holdings')
        .select('quantity')
        .eq('user_id', user_id)
        .eq('stock_id', stock_id)
        .maybeSingle();
      const currentHoldingQty = Number(holding?.quantity || 0);

      const userProfile = memoryDb.resolveProfileByUserId(user_id);
      const stockTakerFeeRate = getEffectiveStockTakerFeeRate(userProfile, memoryDb.getNowMs());
      const capacityCheck = validateOrderCapacity({
        userId: user_id,
        stockId: stock_id,
        side,
        incomingPrice,
        incomingSize,
        currentCash,
        currentHoldingQty,
        openOrders: (userOpenOrders as OpenOrderForRisk[]) || [],
        optionsContracts: memoryDb.optionsContracts,
        currencyContext: {
          stocks: memoryDb.stocks,
          exchangeRates: memoryDb.exchangeRates,
        },
        stockTakerFeeRate,
        marginDebtKrw: Number(userProfile?.margin_debt_krw ?? 0),
      });

      if (!capacityCheck.valid) {
        return {
          success: false,
          filledQty: 0,
          message: capacityCheck.message || '가용 자산이 부족하여 주문을 접수할 수 없습니다.',
        };
      }
    }

    // ── 1. Price-Time Priority Matching ──
    // Reads opposite resting orders. Pure reads, no mutation yet.
    let remainingQty = incomingSize;
    let totalFilledQty = 0;
    let lastExecPrice = incomingPrice;
    const executionFills: Array<Omit<ExecutionFill, 'tradeId' | 'takerOrderId'> & { tradeIndex: number }> = [];

    // [Multi-Fill OHLC] track high/low across all fills in this order
    let executionHigh = -Infinity;
    let executionLow = Infinity;

    // [Self-Trade Prevention] .neq('user_id', user_id) at DB query level
    const oppSide = side === 'buy' ? 'sell' : 'buy';
    let query = db
      .from('orders')
      .select('*')
      .eq('stock_id', stock_id)
      .eq('side', oppSide)
      .in('status', ['open', 'partial'])
      .neq('user_id', user_id);

    if (side === 'buy') {
      query = query
        .lte('price', incomingPrice)
        .order('price', { ascending: true })
        .order('created_at', { ascending: true })
        .order('sequence', { ascending: true });
    } else {
      query = query
        .gte('price', incomingPrice)
        .order('price', { ascending: false })
        .order('created_at', { ascending: true })
        .order('sequence', { ascending: true });
    }

    const { data: oppOrders, error: fetchErr } = await query;
    if (fetchErr) throw fetchErr;

    const tradesToSettle: SettlementTrade[] = [];
    const oppOrdersToUpdate: { id: string; filled: number; status: string }[] = [];
    const involvedUserIds = new Set<string>([user_id]);

    if (oppOrders && oppOrders.length > 0) {
      for (const opp of oppOrders) {
        if (remainingQty <= 0) break;

        // [Self-Trade Prevention] defensive loop guard
        if (opp.user_id === user_id) continue;

        // 미수 부채(margin_debt_krw > 0) 계좌의 기존 대기 매수 주문은 추가 위험 방지를 위해 체결하지 않음
        if (side === 'sell' && opp.user_id) {
          const oppBuyerDebt = Math.max(0, Number(memoryDb.resolveProfileByUserId(opp.user_id)?.margin_debt_krw ?? 0));
          if (oppBuyerDebt > 0) continue;
        }

        const oppRemaining = Math.max(0, Number(opp.size) - Number(opp.filled || 0));
        if (oppRemaining <= 0) continue;

        const execPrice = Number(opp.price);
        const matchQty = Math.min(remainingQty, oppRemaining);
        if (matchQty <= 0) continue;

        lastExecPrice = execPrice;
        executionHigh = Math.max(executionHigh, execPrice);
        executionLow = Math.min(executionLow, execPrice);

        const buyerId = side === 'buy' ? user_id : opp.user_id;
        const sellerId = side === 'sell' ? user_id : opp.user_id;
        const buyerIsBot = side === 'buy' ? false : !opp.user_id;
        const sellerIsBot = side === 'sell' ? false : !opp.user_id;

        // Maker-Taker: opp is the resting maker, incoming is taker
        const buyerIsMaker = side === 'sell';
        const sellerIsMaker = side === 'buy';
        let { buyer_fee, seller_fee } = calculateTradeFees(buyerIsMaker, sellerIsMaker);
        const nowMs = memoryDb.getNowMs();
        if (!buyerIsMaker && buyer_fee > 0 && buyerId && hasActiveFeeBooster(memoryDb.resolveProfileByUserId(buyerId), nowMs)) {
          buyer_fee *= 0.5;
        }
        if (!sellerIsMaker && seller_fee > 0 && sellerId && hasActiveFeeBooster(memoryDb.resolveProfileByUserId(sellerId), nowMs)) {
          seller_fee *= 0.5;
        }

        tradesToSettle.push({
          stock_id,
          buyer_id: buyerId || null,
          seller_id: sellerId || null,
          buyer_is_bot: buyerIsBot,
          seller_is_bot: sellerIsBot,
          price: execPrice,
          size: matchQty,
          buyer_fee,
          seller_fee,
          created_at: input.created_at || memoryDb.getIsoTimestamp(),
          simulation_time: input.simulation_time,
        });
        executionFills.push({
          price: execPrice,
          size: matchQty,
          makerOrderId: String(opp.id),
          tradeIndex: tradesToSettle.length - 1,
        });

        const newOppFilled = Number(opp.filled || 0) + matchQty;
        const newOppStatus = newOppFilled >= Number(opp.size) ? 'filled' : 'partial';
        oppOrdersToUpdate.push({ id: opp.id, filled: newOppFilled, status: newOppStatus });

        // Track all users involved for snapshot coverage
        if (buyerId) involvedUserIds.add(buyerId);
        if (sellerId) involvedUserIds.add(sellerId);

        remainingQty -= matchQty;
        totalFilledQty += matchQty;
      }
    }

    // ── 2. Generate orderId & check lock completeness before any mutation ──
    const orderId = memoryDb.generateId(`ord_${user_id.slice(0, 8)}`);
    const involvedAccountIds = Array.from(involvedUserIds);
    const neededLockKeys = Array.from(
      new Set(involvedAccountIds.map((id) => memoryDb.resolveAccountLockKey(id)))
    );
    if (neededLockKeys.some((lk) => !lockAccountKeys.includes(lk))) {
      // The first read only needs the incoming user's lock. If matching found
      // other accounts, reacquire every account in sorted order so capacity
      // validation is protected by the complete lock set.
      return { retryAccountIds: neededLockKeys };
    }

    const effectivePersist =
      input.onPersist && (!input.persistOnlyOnFill || tradesToSettle.length > 0)
        ? input.onPersist
        : undefined;
    const gatePm = effectivePersist
      ? undefined
      : ((input.onPersist as any)?.__persistenceManager ?? persistenceManager);

    return await runWithCommitGate(effectivePersist, async () => {
      if (memoryDb.isTradingHalted()) {
        return {
          success: false,
          filledQty: 0,
          message: '현재 관리자 긴급 서킷브레이커(거래 동결)가 발동되어 신규 주문을 접수할 수 없습니다.',
        };
      }
      const tradeIds = tradesToSettle.map(() => memoryDb.nextMonotonicTradeId('tr'));
      tradesToSettle.forEach((trade, index) => {
        trade.id = tradeIds[index];
      });

      const snap: TradingSnapshot = snapshotTradingState(stock_id, involvedAccountIds);
      snap.insertedOrderId = orderId;
      for (const tradeId of tradeIds) snap.createdTradeIds.add(tradeId);

      try {
      // ── 4. Settlement (cumulative validation + asset mutation) ──
      if (tradesToSettle.length > 0) {
        const settleResult = await executeSettlement(db, tradesToSettle);
        for (const tradeId of settleResult.trade_ids) snap.createdTradeIds.add(tradeId);
        if (!settleResult.success) {
          throw new Error(settleResult.error?.message || '체결 정산 트랜잭션 실패');
        }
      }

      // ── Test-only failure hook ──
      // Fires AFTER settlement assets are mutated, BEFORE subsequent writes.
      // Allows tests to verify full rollback of settlement mutations.
      if (_testFailureHook) {
        const hookResult = await _testFailureHook({ stockId: stock_id });
        if (hookResult === false) {
          // A test may use a single hook while allowing other concurrent
          // transactions to proceed normally.
        } else {
        // If hook doesn't throw, throw ourselves so rollback is triggered
        throw new Error('[TEST] Injected failure after settlement');
        }
      }

      // ── 5. Maker order status updates (direct memoryDb write) ──
      for (const o of oppOrdersToUpdate) {
        const order = memoryDb.orders.get(o.id);
        if (order) {
          order.filled = o.filled;
          order.status = o.status as OrderRecord['status'];
        }
      }

      // ── 6. Stock OHLC / volume update (direct memoryDb write) ──
      if (totalFilledQty > 0) {
        const stock = memoryDb.stocks.get(stock_id);
        if (stock) {
          const curHigh = Number(stock.high || 0);
          const curLow = Number(stock.low || 0);
          const newHigh = Math.max(curHigh, executionHigh);
          const newLow = curLow === 0 ? executionLow : Math.min(curLow, executionLow);
          const newVol = Number(stock.volume || 0) + totalFilledQty;
          stock.current_price = lastExecPrice;
          stock.high = newHigh;
          stock.low = newLow;
          stock.volume = newVol;
        }
      }

      // ── 7. Incoming order insert (direct memoryDb write — orderId captured above) ──
      const isIoc = input.order_type === 'ioc';
      let initialStatus: OrderRecord['status'];

      if (isIoc) {
        // IOC: immediate-or-cancel. Any unfilled portion is immediately cancelled, never rests in the book.
        if (remainingQty === 0 && totalFilledQty > 0) {
          initialStatus = 'filled';
        } else {
          initialStatus = 'cancelled';
        }
      } else {
        initialStatus = totalFilledQty === 0 ? 'open' : remainingQty === 0 ? 'filled' : 'partial';
      }

      const newOrder: OrderRecord = {
        id: orderId,
        stock_id,
        user_id,
        side,
        price: incomingPrice,
        size: incomingSize,
        filled: totalFilledQty,
        status: initialStatus,
        is_lp: input.is_lp ?? false,
        created_at: input.created_at || memoryDb.getIsoTimestamp(),
        participant_type: input.participant_type,
        account_id: input.account_id || user_id,
        agent_id: input.agent_id,
        order_type: input.order_type || 'limit',
        sequence: input.sequence,
        simulation_time: input.simulation_time,
      };
      memoryDb.orders.set(orderId, newOrder);
      memoryDb.addOrderToIndex(newOrder);

      // ── 7.5. Durable commit boundary inside lock + commitGate (rollback this tx on save failure) ──
      if (effectivePersist) {
        const saved = await effectivePersist();
        if (!saved) {
          throw new Error('주문 장부 영속 저장에 실패하여 주문을 롤백했습니다.');
        }
      }

      // ── 8. Return result ──
      if (totalFilledQty > 0) {
        const iocNote = isIoc && remainingQty > 0 ? ` (미체결 ${remainingQty}주는 IOC 조건에 따라 취소되었습니다)` : '';
        const weightedAvgPrice = executionFills.reduce((sum, fill) => sum + fill.price * fill.size, 0) / totalFilledQty;
        return {
          success: true,
          filledQty: totalFilledQty,
          execPrice: lastExecPrice,
          lastExecPrice,
          avgPrice: weightedAvgPrice,
          fills: executionFills.map((fill) => ({
            tradeId: tradeIds[fill.tradeIndex],
            price: fill.price,
            size: fill.size,
            makerOrderId: fill.makerOrderId,
            takerOrderId: orderId,
          })),
          status: initialStatus,
          orderId,
          message: `🎉 ${totalFilledQty.toLocaleString()}주가 체결되었습니다! (가중평균 체결가: ₩${weightedAvgPrice.toLocaleString()})${iocNote}`,
        };
      } else {
        const iocMsg = isIoc
          ? `IOC 주문 체결 가능 수량이 없어 전량 취소되었습니다. (${incomingPrice.toLocaleString()}원 ${incomingSize}주)`
          : `주문이 호가창에 정상 접수되었습니다! (${incomingPrice.toLocaleString()}원 ${incomingSize}주)`;
        return {
          success: true,
          filledQty: 0,
          status: initialStatus,
          orderId,
          message: iocMsg,
        };
      }
    } catch (txErr: any) {
      // ── Full rollback — restore all state to pre-tx snapshot ──
      rollbackTradingState(snap);
      throw txErr; // re-throw so outer catch returns failure
    }
    }, gatePm);
      });
      if ('retryAccountIds' in outcome && outcome.retryAccountIds) {
        lockAccountKeys = outcome.retryAccountIds;
        continue;
      }
      return outcome;
    }
    } catch (err: any) {
    console.error('[dbMatching Error]', err);
    return { success: false, filledQty: 0, message: err.message || '주문 처리 중 오류 발생' };
  }
}
