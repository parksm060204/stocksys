import type {
  MemoryDatabase,
  CommodityMarginReservation,
  CommodityPositionRecord,
  ProfileRecord,
  PersistedCommodityOrder,
} from '@/lib/memoryDb/memoryStore';
import { withAccountLocks } from '@/lib/memoryDb/accountLocks';
import { runWithCommitGate, persistenceManager } from '@/lib/memoryDb/PersistenceManager';
import { getAvailableCashKrw, calculateUserReservedCashKrw, sweepUnencumberedCashToMarginDebt } from '@/lib/engine/orderRisk';
import { getCurrencyRateToKrw } from '@/lib/exchange/exchangeService';
import type { CommodityDefinition, CommodityOrder, CommodityTrade } from './types';

function roundMoney(v: number): number {
  return Math.round(v * 100) / 100;
}

export function getUsdToKrwRate(db: MemoryDatabase): number {
  return getCurrencyRateToKrw(db, 'USD') ?? 1350;
}

export function calculateCommodityMarginPerContractKrw(
  commodity: CommodityDefinition,
  db: MemoryDatabase
): number {
  const usdToKrw = getUsdToKrwRate(db);
  const marginUsd = Number(commodity.marginRequirement || 3000);
  return Math.max(1, Math.round(marginUsd * usdToKrw));
}

export function getCommodityContractMultiplier(commodity: CommodityDefinition): number {
  if (!Number.isFinite(commodity.tickSize) || commodity.tickSize <= 0) return 1;
  if (!Number.isFinite(commodity.tickValue) || commodity.tickValue <= 0) return 1;
  return Math.max(1, Math.round(commodity.tickValue / commodity.tickSize));
}

export interface CommodityOrderReserveInput {
  db: MemoryDatabase;
  commodity: CommodityDefinition;
  userId: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price: number;
  size: number;
  submitToEngine: () => CommodityOrder;
  rollbackFromEngine: (orderId: string) => void;
  onPersist?: () => Promise<boolean>;
  runWithEngineLock?: <T>(fn: () => Promise<T>) => Promise<T>;
}

export interface CommodityOrderReserveResult {
  success: boolean;
  message: string;
  statusCode: number;
  order?: CommodityOrder;
  reservation?: CommodityMarginReservation;
  remainingCash?: number;
}

/**
 * 계좌 잠금(withAccountLocks) 하에서 증거금을 원자적으로 예약하고 오더북·미체결장부에 등록하며,
 * 영속 저장까지 성공한 경우에만 커밋한다.
 */
export async function reserveMarginAndSubmitCommodityOrder(
  input: CommodityOrderReserveInput
): Promise<CommodityOrderReserveResult> {
  const { db, commodity, userId, side, size, submitToEngine, rollbackFromEngine, onPersist, runWithEngineLock } = input;

  if (db.isTradingHalted()) {
    return {
      success: false,
      message: '현재 관리자 긴급 서킷브레이커(거래 동결)가 발동되어 원자재 주문을 접수할 수 없습니다.',
      statusCode: 403,
    };
  }

  const execute = async (): Promise<CommodityOrderReserveResult> => withAccountLocks([db.resolveAccountLockKey(userId)], async () => {
    return runWithCommitGate(onPersist, async () => {
      if (db.isTradingHalted()) {
        return {
          success: false,
          message: '현재 관리자 긴급 서킷브레이커(거래 동결)가 발동되어 원자재 주문을 접수할 수 없습니다.',
          statusCode: 403,
        };
      }
      const profile = db.resolveProfileByUserId(userId);
      if (!profile) {
        return {
          success: false,
          message: '사용자 계좌 프로필을 찾을 수 없습니다.',
          statusCode: 404,
        };
      }

      const marginPerContractKrw = calculateCommodityMarginPerContractKrw(commodity, db);

      // 기존 포지션 및 동일 방향 미체결 청산 주문을 반영하여,
      // 순수 포지션 축소분(closingQty)에는 신규 진입 증거금을 요구하지 않는다.
      const pos = db.commodityPositions.get(`${userId}_${commodity.id}`);
      const netPos = pos?.side === 'long' ? pos.quantity : pos?.side === 'short' ? -pos.quantity : 0;
      let sameSideOpenQty = 0;
      for (const res of db.commodityMarginReservations.values()) {
        if (
          res.user_id === userId &&
          res.commodity_id === commodity.id &&
          res.side === side &&
          (res.status === 'open' || res.status === 'partial')
        ) {
          sameSideOpenQty += Math.max(0, res.remaining_size);
        }
      }

      let closingCapacity = 0;
      if (side === 'sell' && netPos > 0) {
        closingCapacity = Math.max(0, netPos - sameSideOpenQty);
      } else if (side === 'buy' && netPos < 0) {
        closingCapacity = Math.max(0, Math.abs(netPos) - sameSideOpenQty);
      }
      const closingQty = Math.min(size, closingCapacity);
      const openingQty = size - closingQty;
      const totalRequiredMarginKrw = roundMoney(marginPerContractKrw * openingQty);

      if (totalRequiredMarginKrw > 0) {
        const { availableCash, reservedCash } = getAvailableCashKrw(db, userId);
        if (!Number.isFinite(availableCash) || availableCash < totalRequiredMarginKrw) {
          return {
            success: false,
            message: `가용 증거금이 부족합니다. 필요 증거금: ₩${totalRequiredMarginKrw.toLocaleString()}, 가용 예수금: ₩${Math.floor(availableCash).toLocaleString()} (주식/옵션 예약금: ₩${reservedCash.toLocaleString()})`,
            statusCode: 400,
          };
        }
      }

      const prevCash = profile.cash;
      const prevTick = db.commodityCurrentTick;
      const prevOrderSeq = db.commodityUserOrderSeq;
      let placedOrder: CommodityOrder | null = null;
      try {
        profile.cash = roundMoney(prevCash - totalRequiredMarginKrw);
        placedOrder = submitToEngine();

        const reservation: CommodityMarginReservation = {
          order_id: placedOrder.id,
          user_id: userId,
          commodity_id: commodity.id,
          side,
          total_size: size,
          remaining_size: size,
          margin_per_contract_krw: marginPerContractKrw,
          reserved_krw: totalRequiredMarginKrw,
          status: 'open',
          created_at: db.getIsoTimestamp(),
        };
        db.commodityMarginReservations.set(placedOrder.id, reservation);
        db.commodityOpenOrders.set(placedOrder.id, { ...placedOrder });

        if (onPersist) {
          const saved = await onPersist();
          if (!saved) {
            profile.cash = prevCash;
            db.commodityCurrentTick = prevTick;
            db.commodityUserOrderSeq = prevOrderSeq;
            rollbackFromEngine(placedOrder.id);
            db.commodityMarginReservations.delete(placedOrder.id);
            db.commodityOpenOrders.delete(placedOrder.id);
            return {
              success: false,
              message: '원자재 주문 장부 영속 저장에 실패하여 주문을 롤백했습니다.',
              statusCode: 500,
            };
          }
        }

        return {
          success: true,
          message: '원자재 주문 및 증거금 예약이 완료되었습니다.',
          statusCode: 200,
          order: placedOrder,
          reservation,
          remainingCash: profile.cash,
        };
      } catch (err: any) {
        profile.cash = prevCash;
        db.commodityCurrentTick = prevTick;
        db.commodityUserOrderSeq = prevOrderSeq;
        if (placedOrder) {
          rollbackFromEngine(placedOrder.id);
          db.commodityMarginReservations.delete(placedOrder.id);
          db.commodityOpenOrders.delete(placedOrder.id);
        }
        return {
          success: false,
          message: err?.message || '원자재 주문 등록 중 오류가 발생했습니다.',
          statusCode: 400,
        };
      }
    }, onPersist ? undefined : persistenceManager);
  });

  return runWithEngineLock ? runWithEngineLock(execute) : execute();
}

function applyUserFillToPosition(
  db: MemoryDatabase,
  userId: string,
  commodity: CommodityDefinition,
  side: 'buy' | 'sell',
  fillPrice: number,
  fillSize: number,
  releasedOrderMarginKrw: number,
  marginPerContractKrw: number
): number {
  const posKey = `${userId}_${commodity.id}`;
  const existing: CommodityPositionRecord = db.commodityPositions.get(posKey) ?? {
    id: posKey,
    user_id: userId,
    commodity_id: commodity.id,
    side: 'flat',
    quantity: 0,
    avg_entry_price: 0,
    reserved_margin_krw: 0,
    realized_pnl_krw: 0,
    updated_at: db.getIsoTimestamp(),
  };

  const tradeSide: 'long' | 'short' = side === 'buy' ? 'long' : 'short';
  const usdToKrw = getUsdToKrwRate(db);
  const multiplier = getCommodityContractMultiplier(commodity);
  let cashCreditKrw = 0;

  if (existing.side === 'flat' || existing.quantity === 0 || existing.side === tradeSide) {
    // 신규 진입 또는 동일 방향 추가 매수/매도: 예약 증거금을 포지션 증거금으로 이관
    const totalQty = existing.quantity + fillSize;
    const weightedAvg =
      totalQty > 0
        ? (existing.avg_entry_price * existing.quantity + fillPrice * fillSize) / totalQty
        : fillPrice;
    existing.side = tradeSide;
    existing.quantity = totalQty;
    existing.avg_entry_price = weightedAvg;
    existing.reserved_margin_krw = roundMoney(existing.reserved_margin_krw + releasedOrderMarginKrw);
  } else {
    // 반대 방향 청산 (부분 또는 전량 청산 후 반대 포지션 전환)
    const closedQty = Math.min(existing.quantity, fillSize);
    const openRemainder = fillSize - closedQty;

    const priceDiff =
      existing.side === 'long'
        ? fillPrice - existing.avg_entry_price
        : existing.avg_entry_price - fillPrice;
    const realizedPnlKrw = roundMoney(priceDiff * closedQty * multiplier * usdToKrw);
    existing.realized_pnl_krw = roundMoney(existing.realized_pnl_krw + realizedPnlKrw);

    const closedPosMargin =
      existing.quantity > 0
        ? roundMoney(existing.reserved_margin_krw * (closedQty / existing.quantity))
        : 0;
    existing.reserved_margin_krw = Math.max(
      0,
      roundMoney(existing.reserved_margin_krw - closedPosMargin)
    );
    existing.quantity -= closedQty;

    // 반대 전환분(openRemainder)이 우선 order margin을 충당하고, 나머지 closedOrderMargin과 기존 포지션 증거금을 환급
    const openOrderMargin =
      openRemainder > 0
        ? Math.min(releasedOrderMarginKrw, roundMoney(marginPerContractKrw * openRemainder))
        : 0;
    const closedOrderMargin = Math.max(0, roundMoney(releasedOrderMarginKrw - openOrderMargin));
    let availableReturn = roundMoney(closedPosMargin + closedOrderMargin);

    if (openRemainder > 0) {
      existing.side = tradeSide;
      existing.quantity = openRemainder;
      existing.avg_entry_price = fillPrice;
      existing.reserved_margin_krw = roundMoney(existing.reserved_margin_krw + openOrderMargin);
    } else if (existing.quantity === 0) {
      existing.side = 'flat';
      existing.avg_entry_price = 0;
    }

    // 기존 포지션 축소 후 동일 방향 미체결 주문 중 청산 면제로 무증거금 등록되었던 주문이
    // 이제 신규 진입분이 되는 경우, 반환 예정이던 포지션 증거금을 해당 주문으로 자동 이관한다.
    const remainingOpenSameSide: CommodityMarginReservation[] = [];
    let totalOpenSameSideQty = 0;
    let totalOpenSameSideReserve = 0;
    for (const res of db.commodityMarginReservations.values()) {
      if (
        res.user_id === userId &&
        res.commodity_id === commodity.id &&
        res.side === side &&
        (res.status === 'open' || res.status === 'partial') &&
        res.remaining_size > 0
      ) {
        remainingOpenSameSide.push(res);
        totalOpenSameSideQty += res.remaining_size;
        totalOpenSameSideReserve = roundMoney(totalOpenSameSideReserve + res.reserved_krw);
      }
    }

    if (remainingOpenSameSide.length > 0 && availableReturn > 0) {
      const remainingClosable =
        existing.side !== 'flat' && existing.side !== tradeSide ? existing.quantity : 0;
      const uncoveredQty = Math.max(0, totalOpenSameSideQty - remainingClosable);
      const neededTotalReserve = roundMoney(uncoveredQty * marginPerContractKrw);
      let deficit = Math.max(0, roundMoney(neededTotalReserve - totalOpenSameSideReserve));
      if (deficit > 0) {
        for (const res of remainingOpenSameSide) {
          if (deficit <= 0 || availableReturn <= 0) break;
          const resCap = roundMoney(res.margin_per_contract_krw * res.remaining_size);
          const room = Math.max(0, roundMoney(resCap - res.reserved_krw));
          const transfer = Math.min(room, deficit, availableReturn);
          if (transfer > 0) {
            res.reserved_krw = roundMoney(res.reserved_krw + transfer);
            availableReturn = roundMoney(availableReturn - transfer);
            deficit = roundMoney(deficit - transfer);
          }
        }
      }
    }

    cashCreditKrw = roundMoney(availableReturn + realizedPnlKrw);
  }

  existing.updated_at = db.getIsoTimestamp();
  db.commodityPositions.set(posKey, existing);
  return cashCreditKrw;
}

/**
 * 계좌 현금 증감을 회계적으로 일관되게 반영한다.
 * - 손실(cashDelta < 0) 시 타 자산(주식/옵션) 예약금과 0원 하한을 침범하지 않고,
 *   부족분은 profile.margin_debt_krw(미수금/부채)로 정확히 기록하여 손실을 삭제하지 않는다.
 * - 입금/수익(cashDelta > 0) 시 기존 margin_debt_krw를 우선 상환한 뒤 잔여분만 profile.cash에 가산한다.
 */
export function applyCashDeltaWithMarginDebt(
  db: MemoryDatabase,
  profile: ProfileRecord,
  cashDelta: number
): void {
  if (!Number.isFinite(cashDelta) || cashDelta === 0) return;

  const currentDebt = Math.max(0, roundMoney(Number(profile.margin_debt_krw ?? 0)));
  if (cashDelta > 0) {
    if (currentDebt > 0) {
      const repay = Math.min(cashDelta, currentDebt);
      const nextDebt = roundMoney(currentDebt - repay);
      if (nextDebt > 0) profile.margin_debt_krw = nextDebt;
      else delete profile.margin_debt_krw;
      const remainder = roundMoney(cashDelta - repay);
      if (remainder > 0) {
        profile.cash = roundMoney(profile.cash + remainder);
      }
    } else {
      profile.cash = roundMoney(profile.cash + cashDelta);
    }
    return;
  }

  const loss = Math.abs(cashDelta);
  const reservedCash = calculateUserReservedCashKrw(db, profile.id);
  const unencumberedCash = Math.max(0, roundMoney(profile.cash - reservedCash));
  const cashDeduct = Math.min(loss, unencumberedCash);
  const shortfall = roundMoney(loss - cashDeduct);
  profile.cash = roundMoney(profile.cash - cashDeduct);
  if (shortfall > 0) {
    profile.margin_debt_krw = roundMoney(currentDebt + shortfall);
  }
}

export interface CommoditySettlementOptions {
  faultInjection?: 'FAIL_AFTER_BUYER_SETTLED';
}

/**
 * 원자재 체결을 양측 주문 ID(buyOrderId, sellOrderId)의 정확한 예약에 귀속하여
 * 원자적·멱등 정산한다. 실패 시 양쪽 계좌·포지션·예약·미체결장부를 완전히 롤백한다.
 */
export async function settleCommodityTradeForUsers(
  db: MemoryDatabase,
  trade: CommodityTrade,
  commodity: CommodityDefinition,
  options?: CommoditySettlementOptions
): Promise<void> {
  if (db.isCommodityTradeSettled(trade.id)) return;

  const buyerUser = trade.buyerId && db.profiles.has(trade.buyerId) ? trade.buyerId : null;
  const sellerUser = trade.sellerId && db.profiles.has(trade.sellerId) ? trade.sellerId : null;

  if (!buyerUser && !sellerUser) {
    return;
  }

  if (buyerUser && sellerUser && buyerUser === sellerUser) {
    throw new Error(`자기 매매 체결은 허용되지 않습니다 (userId=${buyerUser}, tradeId=${trade.id})`);
  }

  const lockIds = Array.from(new Set([buyerUser, sellerUser].filter(Boolean) as string[]));
  const lockKeys = lockIds.map((uid) => db.resolveAccountLockKey(uid));

  await withAccountLocks(lockKeys, async () => {
    if (db.isCommodityTradeSettled(trade.id)) return;

    // 스냅샷 확보 (실패 시 해당 계좌·포지션·예약만 롤백)
    const profileSnapshots = new Map<string, ProfileRecord>();
    const positionSnapshots = new Map<string, CommodityPositionRecord | null>();
    const reservationSnapshots = new Map<string, CommodityMarginReservation>();
    const openOrderSnapshots = new Map<string, PersistedCommodityOrder | null>();

    for (const uid of lockIds) {
      const p = db.resolveProfileByUserId(uid);
      if (p) profileSnapshots.set(p.id, { ...p });
      const posKey = `${uid}_${commodity.id}`;
      const pos = db.commodityPositions.get(posKey);
      positionSnapshots.set(posKey, pos ? { ...pos } : null);
    }
    for (const oid of [trade.buyOrderId, trade.sellOrderId]) {
      if (!oid) continue;
      const res = db.commodityMarginReservations.get(oid);
      if (res) reservationSnapshots.set(oid, { ...res });
      const ord = db.commodityOpenOrders.get(oid);
      openOrderSnapshots.set(oid, ord ? { ...ord } : null);
    }
    for (const [oid, res] of db.commodityMarginReservations.entries()) {
      if (
        (res.status === 'open' || res.status === 'partial') &&
        res.commodity_id === commodity.id &&
        lockIds.includes(res.user_id) &&
        !reservationSnapshots.has(oid)
      ) {
        reservationSnapshots.set(oid, { ...res });
      }
    }

    const rollbackSettlement = () => {
      for (const [pid, prevP] of profileSnapshots.entries()) {
        db.profiles.set(pid, prevP);
      }
      for (const [posKey, prevPos] of positionSnapshots.entries()) {
        if (prevPos) db.commodityPositions.set(posKey, prevPos);
        else db.commodityPositions.delete(posKey);
      }
      for (const [oid, prevRes] of reservationSnapshots.entries()) {
        db.commodityMarginReservations.set(oid, prevRes);
      }
      for (const [oid, prevOrd] of openOrderSnapshots.entries()) {
        if (prevOrd) db.commodityOpenOrders.set(oid, prevOrd);
        else db.commodityOpenOrders.delete(oid);
      }
      db.commoditySettlementLedger.delete(trade.id);
    };

    try {
      const settleParty = (userId: string, side: 'buy' | 'sell', orderId: string) => {
        const profile = db.resolveProfileByUserId(userId);
        if (!profile) {
          throw new Error(`계좌 프로필을 찾을 수 없습니다: ${userId}`);
        }
        if (!orderId) {
          throw new Error(`체결에 주문 ID가 누락되었습니다 (tradeId=${trade.id}, side=${side})`);
        }

        const reservation = db.commodityMarginReservations.get(orderId);
        if (!reservation) {
          throw new Error(`주문 예약 증거금을 찾을 수 없습니다: orderId=${orderId}`);
        }
        if (reservation.user_id !== userId || reservation.commodity_id !== commodity.id || reservation.side !== side) {
          throw new Error(`주문 예약 소유자/종목/방향 불일치: orderId=${orderId}`);
        }
        if (reservation.status !== 'open' && reservation.status !== 'partial') {
          throw new Error(`유효하지 않은 예약 상태(${reservation.status}): orderId=${orderId}`);
        }
        if (reservation.remaining_size < trade.size) {
          throw new Error(
            `예약 잔량 부족: orderId=${orderId}, remaining=${reservation.remaining_size}, tradeSize=${trade.size}`
          );
        }

        const newRemainingSize = reservation.remaining_size - trade.size;
        const targetRemainingReserve = roundMoney(reservation.margin_per_contract_krw * newRemainingSize);
        const releasedMargin = Math.max(0, roundMoney(reservation.reserved_krw - targetRemainingReserve));
        reservation.remaining_size = newRemainingSize;
        reservation.reserved_krw = Math.max(0, roundMoney(reservation.reserved_krw - releasedMargin));
        reservation.status = reservation.remaining_size <= 0 ? 'filled' : 'partial';

        const openOrd = db.commodityOpenOrders.get(orderId);
        if (openOrd) {
          openOrd.filled += trade.size;
          if (openOrd.filled >= openOrd.size) {
            db.commodityOpenOrders.delete(orderId);
          }
        }

        const cashDelta = applyUserFillToPosition(
          db,
          userId,
          commodity,
          side,
          trade.price,
          trade.size,
          releasedMargin,
          reservation.margin_per_contract_krw
        );

        // 손실 보존 + 타 자산 예약금 보호 + 부채(margin_debt_krw) 회계 반영
        if (cashDelta !== 0) {
          applyCashDeltaWithMarginDebt(db, profile, cashDelta);
        }
      };

      if (buyerUser) {
        settleParty(buyerUser, 'buy', trade.buyOrderId);
      }

      if (options?.faultInjection === 'FAIL_AFTER_BUYER_SETTLED') {
        throw new Error('FAULT_INJECTION_FAIL_AFTER_BUYER_SETTLED');
      }

      if (sellerUser) {
        settleParty(sellerUser, 'sell', trade.sellOrderId);
      }

      db.commoditySettlementLedger.set(trade.id, {
        id: trade.id,
        commodity_id: commodity.id,
        tick: trade.tick,
        settled_at: db.getIsoTimestamp(),
      });
      db.trimCommoditySettlementLedger(5000);
    } catch (err) {
      rollbackSettlement();
      throw err;
    }
  });
}

/**
 * 만료되거나 취소된 원자재 미체결 주문의 잔여 예약 증거금을 사용자 계좌로 환불한다.
 */
export async function releaseCommodityOrderMargin(
  db: MemoryDatabase,
  orderId: string,
  status: 'expired' | 'cancelled'
): Promise<boolean> {
  const reservation = db.commodityMarginReservations.get(orderId);
  if (!reservation) return false;
  if (reservation.status !== 'open' && reservation.status !== 'partial') return false;

  return withAccountLocks([db.resolveAccountLockKey(reservation.user_id)], async () => {
    const current = db.commodityMarginReservations.get(orderId);
    if (!current || (current.status !== 'open' && current.status !== 'partial')) {
      return false;
    }

    const profile = db.resolveProfileByUserId(current.user_id);
    if (profile && current.reserved_krw > 0) {
      applyCashDeltaWithMarginDebt(db, profile, current.reserved_krw);
    }

    current.reserved_krw = 0;
    current.remaining_size = 0;
    current.status = status;
    db.commodityOpenOrders.delete(orderId);
    return true;
  });
}

/**
 * 유지증거금(초기 증거금의 50%) 미달 원자재 포지션을 강제 청산한다.
 * - 해당 종목의 미체결 주문 예약을 먼저 취소·환불한 뒤 현재가로 포지션을 청산 정산한다.
 * - 갭 손실로 예치 증거금 및 가용 현금을 초과하는 손실이 발생하면 profile.margin_debt_krw에 부채로 기록한다.
 */
export async function evaluateAndLiquidateCommodityMaintenanceMargin(
  db: MemoryDatabase,
  commoditiesMap: ReadonlyMap<string, CommodityDefinition & { currentPrice: number }>,
  removeFromBook?: (commodityId: string, orderId: string) => unknown
): Promise<number> {
  const MAINTENANCE_RATIO = 0.5;
  const usdToKrw = getUsdToKrwRate(db);
  let liquidatedCount = 0;

  for (const [posKey, pos] of Array.from(db.commodityPositions.entries())) {
    if (!pos || pos.side === 'flat' || pos.quantity <= 0) continue;
    const commodity = commoditiesMap.get(pos.commodity_id);
    if (!commodity || !Number.isFinite(commodity.currentPrice) || commodity.currentPrice <= 0) continue;

    const multiplier = getCommodityContractMultiplier(commodity);
    const priceDiff =
      pos.side === 'long'
        ? commodity.currentPrice - pos.avg_entry_price
        : pos.avg_entry_price - commodity.currentPrice;
    const unrealizedPnlKrw = roundMoney(priceDiff * pos.quantity * multiplier * usdToKrw);
    const equityKrw = roundMoney(pos.reserved_margin_krw + unrealizedPnlKrw);
    const maintenanceMarginKrw = roundMoney(pos.reserved_margin_krw * MAINTENANCE_RATIO);

    if (equityKrw >= maintenanceMarginKrw) continue;

    // 1. 동일 종목 미체결 예약 취소 및 환불
    for (const [oid, res] of Array.from(db.commodityMarginReservations.entries())) {
      if (
        res.user_id === pos.user_id &&
        res.commodity_id === pos.commodity_id &&
        (res.status === 'open' || res.status === 'partial')
      ) {
        removeFromBook?.(pos.commodity_id, oid);
        await releaseCommodityOrderMargin(db, oid, 'cancelled');
      }
    }

    // 2. 강제 청산 정산
    const profile = db.resolveProfileByUserId(pos.user_id);
    if (profile) {
      const cashDelta = roundMoney(pos.reserved_margin_krw + unrealizedPnlKrw);
      applyCashDeltaWithMarginDebt(db, profile, cashDelta);
    }

    db.commodityPositions.delete(posKey);
    liquidatedCount++;
  }

  return liquidatedCount;
}

export interface CancelCommodityOrdersParams {
  db: MemoryDatabase;
  userId: string;
  orderIds?: string[];
  commodityId?: string;
  removeFromBook: (commodityId: string, orderId: string) => CommodityOrder | null;
  restoreToBook: (commodityId: string, order: CommodityOrder) => void;
  onPersist?: () => Promise<boolean>;
  runWithEngineLock?: <T>(fn: () => Promise<T>) => Promise<T>;
}

export interface CancelCommodityOrdersResult {
  success: boolean;
  statusCode: number;
  message?: string;
  cancelledOrderIds: string[];
  refundedKrw: number;
  remainingCash?: number;
}

/**
 * 원자재 미체결 주문 단건/일괄 취소 (락 순서: engineTickLock -> accountLock -> commitGate).
 * 소유권 검증 + 오더북 제거 + 증거금 환불 + 영속 저장 실패 시 원자적 롤백을 보장한다.
 */
export async function cancelCommodityOrders(
  params: CancelCommodityOrdersParams
): Promise<CancelCommodityOrdersResult> {
  const { db, userId, orderIds, commodityId } = params;
  if (!userId) {
    return { success: false, statusCode: 401, message: '인증된 사용자가 필요합니다.', cancelledOrderIds: [], refundedKrw: 0 };
  }

  const executeLocked = async (): Promise<CancelCommodityOrdersResult> => {
    return withAccountLocks([db.resolveAccountLockKey(userId)], async () => {
      const targetIds: string[] = [];

      if (Array.isArray(orderIds) && orderIds.length > 0) {
        const uniqueIds = Array.from(new Set(orderIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '')));
        if (uniqueIds.length === 0) {
          return { success: false, statusCode: 400, message: '유효한 주문 ID가 필요합니다.', cancelledOrderIds: [], refundedKrw: 0 };
        }
        for (const oid of uniqueIds) {
          const openOrd = db.commodityOpenOrders.get(oid);
          const res = db.commodityMarginReservations.get(oid);
          if (!openOrd && !res) {
            return { success: false, statusCode: 404, message: `원자재 주문을 찾을 수 없습니다: ${oid}`, cancelledOrderIds: [], refundedKrw: 0 };
          }
          const ownerId = openOrd?.userId || res?.user_id;
          if (ownerId !== userId) {
            return { success: false, statusCode: 403, message: '본인의 원자재 주문만 취소할 수 있습니다.', cancelledOrderIds: [], refundedKrw: 0 };
          }
          const status = res?.status ?? 'open';
          if (status === 'open' || status === 'partial') {
            targetIds.push(oid);
          }
        }
      } else {
        for (const [oid, res] of db.commodityMarginReservations.entries()) {
          if (res.user_id !== userId) continue;
          if (res.status !== 'open' && res.status !== 'partial') continue;
          if (commodityId && res.commodity_id !== commodityId) continue;
          targetIds.push(oid);
        }
      }

      if (targetIds.length === 0) {
        return { success: false, statusCode: 400, message: '취소할 미체결 원자재 주문이 없습니다.', cancelledOrderIds: [], refundedKrw: 0 };
      }

      return runWithCommitGate(params.onPersist, async () => {
        const profile = db.resolveProfileByUserId(userId);
        const prevCash = profile ? profile.cash : undefined;
        const prevMarginDebt = profile ? profile.margin_debt_krw : undefined;
        const resSnapshots = new Map<string, CommodityMarginReservation>();
        const openOrdSnapshots = new Map<string, PersistedCommodityOrder>();
        const removedBookOrders: Array<{ commodityId: string; order: CommodityOrder }> = [];

        for (const oid of targetIds) {
          const res = db.commodityMarginReservations.get(oid);
          if (res) resSnapshots.set(oid, { ...res });
          const openOrd = db.commodityOpenOrders.get(oid);
          if (openOrd) openOrdSnapshots.set(oid, { ...openOrd });
        }

        const rollbackCancel = () => {
          if (profile && prevCash !== undefined) {
            profile.cash = prevCash;
            if (prevMarginDebt !== undefined) profile.margin_debt_krw = prevMarginDebt;
            else delete profile.margin_debt_krw;
          }
          for (const [oid, prevRes] of resSnapshots.entries()) {
            db.commodityMarginReservations.set(oid, prevRes);
          }
          for (const [oid, prevOrd] of openOrdSnapshots.entries()) {
            db.commodityOpenOrders.set(oid, prevOrd);
          }
          for (const { commodityId: cid, order } of removedBookOrders) {
            params.restoreToBook(cid, order);
          }
        };

        try {
          let totalRefunded = 0;
          const cancelledOrderIds: string[] = [];

          for (const oid of targetIds) {
            const res = db.commodityMarginReservations.get(oid);
            const openOrd = db.commodityOpenOrders.get(oid);
            const cid = res?.commodity_id || openOrd?.commodityId;
            const prevReserved = res?.reserved_krw ?? 0;

            if (cid) {
              const removed = params.removeFromBook(cid, oid);
              if (removed) {
                removedBookOrders.push({ commodityId: cid, order: removed });
              }
            }

            const released = await releaseCommodityOrderMargin(db, oid, 'cancelled');
            if (released) {
              totalRefunded = roundMoney(totalRefunded + prevReserved);
              cancelledOrderIds.push(oid);
            }
          }

          if (profile) {
            sweepUnencumberedCashToMarginDebt(db, profile);
          }

          if (params.onPersist) {
            const saved = await params.onPersist();
            if (!saved) {
              rollbackCancel();
              return {
                success: false,
                statusCode: 500,
                message: '원자재 주문 취소 영속 저장 실패로 취소를 롤백했습니다.',
                cancelledOrderIds: [],
                refundedKrw: 0,
              };
            }
          }

          return {
            success: true,
            statusCode: 200,
            message: `${cancelledOrderIds.length}건의 원자재 주문이 취소되었습니다.`,
            cancelledOrderIds,
            refundedKrw: totalRefunded,
            remainingCash: profile?.cash,
          };
        } catch (err: any) {
          rollbackCancel();
          return {
            success: false,
            statusCode: 500,
            message: err?.message || '원자재 주문 취소 처리 중 오류가 발생했습니다.',
            cancelledOrderIds: [],
            refundedKrw: 0,
          };
        }
      });
    });
  };

  if (params.runWithEngineLock) {
    return params.runWithEngineLock(executeLocked);
  }
  return executeLocked();
}
