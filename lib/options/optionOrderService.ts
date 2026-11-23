import type {
  MemoryDatabase,
  OptionContractRecord,
  OrderRecord,
  TradeRecord,
} from '@/lib/memoryDb/memoryStore';
import { withStockLock, withAllStockLocks } from '@/lib/engine/marketService';
import { withAccountLocks } from '@/lib/memoryDb/accountLocks';
import { runWithCommitGate, persistenceManager } from '@/lib/memoryDb/PersistenceManager';
import { calculateSingleBuyOrderReservedCash, getAvailableCashKrw, applyCashCreditWithMarginDebt, sweepUnencumberedCashToMarginDebt } from '@/lib/engine/orderRisk';
import { pruneExpiredProfileEntitlements } from '@/lib/shop/catalog';
import { hasAmbiguousK200Units } from './contractUnits';

export const OPTIONS_LP_ID = 'bot_options_mm_001';
const SUPPORTED_OPTION_ORDER_TYPES = new Set(['LIMIT', 'MARKET']);
const OPTION_FEE_RATE = 0.001; // 0.1%

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function safeMulInt(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const prod = Math.round(a * b);
  if (!Number.isSafeInteger(prod) || prod < 0) return null;
  return prod;
}

export function getOptionLpQuotes(contract: OptionContractRecord): {
  lpBidPrice: number;
  lpAskPrice: number;
} {
  const ref = Number(contract.current_price);
  const lpAskPrice = round2(Math.max(0.01, ref));
  const lpBidPrice = round2(Math.max(0.01, Math.min(lpAskPrice, ref * 0.98)));
  return { lpBidPrice, lpAskPrice };
}

export interface OptionOrderSubmitInput {
  db: MemoryDatabase;
  userId: string;
  contractId?: string;
  ticker?: string;
  side: 'BUY' | 'SELL';
  orderType: string;
  price?: number;
  qty: number;
  nowMs?: number;
  now?: () => number;
  onPersist?: () => Promise<boolean>;
}

export interface OptionOrderSubmitResult {
  success: boolean;
  statusCode: number;
  message: string;
  order?: {
    orderId: string;
    contractId: string;
    ticker: string;
    side: 'BUY' | 'SELL';
    orderType: string;
    status: 'open' | 'partial' | 'filled';
    requestedQty: number;
    filledQty: number;
    remainingQty: number;
    avgExecPrice: number;
    multiplier: number;
    totalNotionalKrw: number;
    feeKrw: number;
    remainingCash: number;
  };
}

export function findOptionContract(
  db: MemoryDatabase,
  contractId?: string,
  ticker?: string
): OptionContractRecord | null {
  if (contractId && db.optionsContracts.has(contractId)) {
    return db.optionsContracts.get(contractId) || null;
  }
  if (ticker) {
    for (const contract of db.optionsContracts.values()) {
      if (contract.ticker === ticker) return contract;
    }
  }
  return null;
}

export async function submitAuthoritativeOptionOrder(
  input: OptionOrderSubmitInput
): Promise<OptionOrderSubmitResult> {
  const { db, userId, contractId, ticker, side, orderType, price, qty } = input;
  const getCurrentNowMs = (): number => {
    if (typeof input.now === 'function') return input.now();
    if (input.nowMs !== undefined) return input.nowMs;
    return db.executionContext ? db.getNowMs() : Date.now();
  };
  const entryNowMs = getCurrentNowMs();

  if (db.isTradingHalted()) {
    return {
      success: false,
      statusCode: 403,
      message: '현재 관리자 긴급 서킷브레이커(거래 동결)가 발동되어 옵션 주문을 접수할 수 없습니다.',
    };
  }

  if (!contractId && !ticker) {
    return { success: false, statusCode: 400, message: '옵션 계약 식별자(contractId 또는 ticker)가 필요합니다.' };
  }

  const prelimContract = findOptionContract(db, contractId, ticker);
  if (!prelimContract) {
    return { success: false, statusCode: 404, message: '존재하지 않는 옵션 계약입니다.' };
  }
  if (hasAmbiguousK200Units(prelimContract)) {
    return { success: false, statusCode: 409, message: '기존 옵션 계약의 지수·주식 단위가 일치하지 않아 계약 확인이 필요합니다.' };
  }

  if (side !== 'BUY' && side !== 'SELL') {
    return { success: false, statusCode: 400, message: '주문 방향(side)은 BUY 또는 SELL이어야 합니다.' };
  }

  if (typeof orderType !== 'string' || !SUPPORTED_OPTION_ORDER_TYPES.has(orderType)) {
    return {
      success: false,
      statusCode: 400,
      message: `지원하지 않는 주문 방식입니다: ${String(orderType)}. 지정가(LIMIT) 또는 시장가(MARKET)만 지원됩니다.`,
    };
  }

  if (typeof qty !== 'number' || !Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
    return { success: false, statusCode: 400, message: '주문 수량(qty)은 1계약 이상의 정수여야 합니다.' };
  }

  const prelimExpiryMs = Date.parse(prelimContract.expiry_date);
  if (!Number.isFinite(prelimExpiryMs) || prelimExpiryMs <= entryNowMs) {
    return { success: false, statusCode: 400, message: '만기된 옵션 계약은 주문할 수 없습니다.' };
  }

  const prelimMultiplier = prelimContract.multiplier ?? 250000;
  if (!Number.isFinite(prelimMultiplier) || prelimMultiplier <= 0) {
    return { success: false, statusCode: 400, message: '옵션 계약 승수가 유효하지 않습니다.' };
  }

  if (orderType === 'LIMIT') {
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      return { success: false, statusCode: 400, message: '지정가 주문 가격은 0보다 큰 유한한 숫자여야 합니다.' };
    }
  }

  const prelimQuotes = getOptionLpQuotes(prelimContract);
  const limitPrice = orderType === 'LIMIT' ? round2(price!) : side === 'BUY' ? Infinity : 0;

  // 입력값 곱셈 안전 정수 범위 사전 검증
  const prelimWorstCaseUnit =
    orderType === 'LIMIT' ? limitPrice : side === 'BUY' ? prelimQuotes.lpAskPrice : prelimQuotes.lpBidPrice;
  const prelimWorstCaseNotional = safeMulInt(prelimWorstCaseUnit * prelimMultiplier, qty);
  if (prelimWorstCaseNotional === null || prelimWorstCaseNotional <= 0) {
    return { success: false, statusCode: 400, message: '주문 금액이 안전한 정수 범위를 초과했습니다.' };
  }

  return withStockLock(prelimContract.id, async () => {
    const lockNowMs = getCurrentNowMs();
    if (db.isTradingHalted()) {
      return {
        success: false,
        statusCode: 403,
        message: '현재 관리자 긴급 서킷브레이커(거래 동결)가 발동되어 옵션 주문을 접수할 수 없습니다.',
      };
    }

    const contract = findOptionContract(db, prelimContract.id, ticker);
    if (!contract) {
      return { success: false, statusCode: 404, message: '존재하지 않는 옵션 계약입니다.' };
    }
    if (hasAmbiguousK200Units(contract)) {
      return { success: false, statusCode: 409, message: '기존 옵션 계약의 지수·주식 단위가 일치하지 않아 계약 확인이 필요합니다.' };
    }

    const expiryMs = Date.parse(contract.expiry_date);
    if (!Number.isFinite(expiryMs) || expiryMs <= lockNowMs) {
      return { success: false, statusCode: 400, message: '만기된 옵션 계약은 주문할 수 없습니다.' };
    }

    const multiplier = contract.multiplier ?? 250000;
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      return { success: false, statusCode: 400, message: '옵션 계약 승수가 유효하지 않습니다.' };
    }

    const { lpBidPrice, lpAskPrice } = getOptionLpQuotes(contract);
    const worstCaseUnit = orderType === 'LIMIT' ? limitPrice : side === 'BUY' ? lpAskPrice : lpBidPrice;
    const worstCaseNotional = safeMulInt(worstCaseUnit * multiplier, qty);
    if (worstCaseNotional === null || worstCaseNotional <= 0) {
      return { success: false, statusCode: 400, message: '주문 금액이 안전한 정수 범위를 초과했습니다.' };
    }
    // 1. 매칭 후보 조회 (상대 휴면 지정가 주문 + LP 호가)
    const oppSide = side === 'BUY' ? 'sell' : 'buy';
    const orderIds = db.orderStockIndex.get(contract.id);
    const restingOpposites: OrderRecord[] = [];
    if (orderIds) {
      for (const oid of orderIds) {
        const ord = db.orders.get(oid);
        if (!ord || ord.side !== oppSide) continue;
        if (ord.status !== 'open' && ord.status !== 'partial') continue;
        if (ord.user_id === userId) continue; // 자기 매매 방지
        const rem = ord.size - ord.filled;
        if (rem <= 0) continue;
        if (side === 'BUY' && ord.price <= limitPrice) restingOpposites.push(ord);
        if (side === 'SELL' && ord.price >= limitPrice) restingOpposites.push(ord);
      }
    }

    restingOpposites.sort((a, b) => {
      if (a.price !== b.price) {
        return side === 'BUY' ? a.price - b.price : b.price - a.price;
      }
      return a.created_at.localeCompare(b.created_at);
    });

    const lpCanFill =
      (side === 'BUY' && lpAskPrice <= limitPrice) ||
      (side === 'SELL' && lpBidPrice >= limitPrice);

    const fills: Array<{ counterpartyId: string; price: number; qty: number; restingOrder?: OrderRecord }> = [];
    let remaining = qty;

    for (const opp of restingOpposites) {
      if (remaining <= 0) break;
      // LP 호가와 사용자 대기 주문을 가격 우선으로 통합 비교:
      // 매수 시 LP 매도호가(lpAskPrice)보다 비싼 사용자 매도는 건너뛰고 LP와 체결하며,
      // 매도 시 LP 매수호가(lpBidPrice)보다 싼 사용자 매수는 건너뛰고 LP와 체결한다.
      if (lpCanFill) {
        if (side === 'BUY' && opp.price > lpAskPrice) break;
        if (side === 'SELL' && opp.price < lpBidPrice) break;
      }
      const oppRem = opp.size - opp.filled;
      const fillQty = Math.min(remaining, oppRem);
      if (fillQty > 0 && opp.user_id) {
        if (side === 'SELL') {
          const oppBuyerDebt = Math.max(0, Number(db.resolveProfileByUserId(opp.user_id)?.margin_debt_krw ?? 0));
          if (oppBuyerDebt > 0) continue;
        }
        fills.push({ counterpartyId: opp.user_id, price: opp.price, qty: fillQty, restingOrder: opp });
        remaining -= fillQty;
      }
    }

    // LP 호가 체결 가능 여부 (지정가 의미 엄격 준수: BUY는 lpAskPrice <= limitPrice, SELL은 lpBidPrice >= limitPrice)
    if (remaining > 0 && lpCanFill) {
      if (side === 'BUY') {
        fills.push({ counterpartyId: OPTIONS_LP_ID, price: lpAskPrice, qty: remaining });
        remaining = 0;
      } else {
        fills.push({ counterpartyId: OPTIONS_LP_ID, price: lpBidPrice, qty: remaining });
        remaining = 0;
      }
    }

    const lockAccounts = Array.from(new Set([userId, ...fills.map((f) => f.counterpartyId)]));
    const lockKeys = lockAccounts.map((id) => db.resolveAccountLockKey(id));

    return withAccountLocks(lockKeys, async () => {
      if (db.isTradingHalted()) {
        return {
          success: false,
          statusCode: 403,
          message: '현재 관리자 긴급 서킷브레이커(거래 동결)가 발동되어 옵션 주문을 접수할 수 없습니다.',
        };
      }
      const profile = db.resolveProfileByUserId(userId);
      if (!profile) {
        return { success: false, statusCode: 404, message: '사용자 계좌를 찾을 수 없습니다.' };
      }

      // 서버 측 옵션 거래 자격증 검증 (만료 정리는 커밋 게이트/스냅샷 내부에서 수행)
      const accountNowMs = getCurrentNowMs();
      const tempEntitlementProfile = { ...profile };
      pruneExpiredProfileEntitlements(tempEntitlementProfile, accountNowMs);
      if (!tempEntitlementProfile.is_admin && !tempEntitlementProfile.has_options_license) {
        return {
          success: false,
          statusCode: 403,
          message: '파생상품 옵션 거래 자격증이 필요합니다. 상점에서 자격증을 취득해 주세요.',
        };
      }

      // 공용 가용 예수금 계산기(주식 및 모든 옵션 계약의 승수·수수료 반영) + 매도 보유 수량 예약 검증
      const { availableCash, reservedCash: reservedBuyCash } = getAvailableCashKrw(db, userId);
      let reservedSellQty = 0;
      const userOrderIds = db.orderUserIndex.get(userId);
      if (userOrderIds) {
        for (const oid of userOrderIds) {
          const ord = db.orders.get(oid);
          if (!ord || (ord.status !== 'open' && ord.status !== 'partial')) continue;
          const rem = ord.size - ord.filled;
          if (rem <= 0) continue;
          if (ord.stock_id === contract.id && ord.side === 'sell') {
            reservedSellQty += rem;
          }
        }
      }

      const filledQty = qty - remaining;
      let totalFillNotional = 0;
      let totalFillBuyerFeeKrw = 0;
      let totalFillUserFeeKrw = 0;
      const cpCumulativeBuyCash = new Map<string, number>();
      const cpCumulativeSellQty = new Map<string, number>();
      const cpMatchedOrderIds = new Map<string, Set<string>>();

      for (const f of fills) {
        const n = safeMulInt(f.price * multiplier, f.qty);
        if (n === null) {
          return { success: false, statusCode: 400, message: '체결 금액이 안전한 정수 범위를 초과했습니다.' };
        }
        const fillNotional = Math.round(n);
        totalFillNotional += fillNotional;
        if (!Number.isSafeInteger(totalFillNotional)) {
          return { success: false, statusCode: 400, message: '총 체결 금액이 안전한 정수 범위를 초과했습니다.' };
        }

        const buyerId = side === 'BUY' ? userId : f.counterpartyId;
        const fillBuyerFee = buyerId === OPTIONS_LP_ID ? 0 : Math.round(fillNotional * OPTION_FEE_RATE);
        const userFillFee = userId === OPTIONS_LP_ID ? 0 : Math.round(fillNotional * OPTION_FEE_RATE);
        totalFillUserFeeKrw += userFillFee;
        if (side === 'BUY') {
          totalFillBuyerFeeKrw += fillBuyerFee;
        } else {
          cpCumulativeBuyCash.set(
            f.counterpartyId,
            (cpCumulativeBuyCash.get(f.counterpartyId) ?? 0) + fillNotional + fillBuyerFee
          );
        }
        if (side === 'BUY') {
          cpCumulativeSellQty.set(
            f.counterpartyId,
            (cpCumulativeSellQty.get(f.counterpartyId) ?? 0) + f.qty
          );
        }
        if (f.restingOrder?.id) {
          let ids = cpMatchedOrderIds.get(f.counterpartyId);
          if (!ids) {
            ids = new Set<string>();
            cpMatchedOrderIds.set(f.counterpartyId, ids);
          }
          ids.add(f.restingOrder.id);
        }
      }

      const restingNotional =
        remaining > 0 && orderType === 'LIMIT'
          ? safeMulInt(limitPrice * multiplier, remaining)
          : 0;
      if (restingNotional === null) {
        return { success: false, statusCode: 400, message: '미체결 주문 금액이 안전한 정수 범위를 초과했습니다.' };
      }

      const restingFeeKrw = Math.round(restingNotional * OPTION_FEE_RATE);

      const userHoldingKey = `${userId}_${contract.id}`;
      const userHolding = db.holdings.get(userHoldingKey);

      if (side === 'BUY') {
        const requiredCash = totalFillNotional + totalFillBuyerFeeKrw + restingNotional + restingFeeKrw;
        if (!Number.isSafeInteger(requiredCash)) {
          return { success: false, statusCode: 400, message: '필요 예수금 계산이 안전 범위를 초과했습니다.' };
        }
        if (!Number.isFinite(availableCash) || availableCash < requiredCash) {
          return {
            success: false,
            statusCode: 400,
            message: `가용 예수금이 부족합니다. 필요 금액: ₩${requiredCash.toLocaleString()}, 가용 예수금: ₩${Math.floor(availableCash).toLocaleString()} (예약금: ₩${reservedBuyCash.toLocaleString()})`,
          };
        }
      } else {
        const ownedQty = userHolding?.quantity ?? 0;
        const availableSellQty = ownedQty - reservedSellQty;
        if (availableSellQty < qty) {
          return {
            success: false,
            statusCode: 400,
            message: `매도 가능한 보유 옵션 수량이 부족합니다. (가용: ${Math.max(0, availableSellQty)}계약, 요청: ${qty}계약)`,
          };
        }
      }

      // 상대방(휴면/LP) 계좌 존재·누적 예수금(수수료 포함)·누적 보유수량 사전 검증
      for (const f of fills) {
        const cp = db.resolveProfileByUserId(f.counterpartyId);
        if (!cp) {
          return { success: false, statusCode: 500, message: `상대방 계좌(${f.counterpartyId})를 찾을 수 없습니다.` };
        }
      }
      if (side === 'SELL') {
        for (const [cpId, requiredTotalCash] of cpCumulativeBuyCash.entries()) {
          const cp = db.resolveProfileByUserId(cpId)!;
          if (Math.max(0, Number(cp.margin_debt_krw ?? 0)) > 0) {
            return { success: false, statusCode: 400, message: '상대방 매수자에 미수 부채가 있어 체결할 수 없습니다.' };
          }
          if (!Number.isFinite(cp.cash) || cp.cash < requiredTotalCash) {
            return { success: false, statusCode: 400, message: '상대방 매수자의 예수금(수수료 포함)이 부족하여 체결할 수 없습니다.' };
          }
          if (cpId !== OPTIONS_LP_ID) {
            const matchedIds = cpMatchedOrderIds.get(cpId);
            let otherReservedCash = 0;
            const cpOrderIds = db.orderUserIndex.get(cpId);
            if (cpOrderIds) {
              for (const oid of cpOrderIds) {
                if (matchedIds?.has(oid)) continue;
                const ord = db.orders.get(oid);
                if (!ord || ord.side !== 'buy' || (ord.status !== 'open' && ord.status !== 'partial')) continue;
                otherReservedCash += calculateSingleBuyOrderReservedCash(ord, db.optionsContracts, {
                  stocks: db.stocks,
                  exchangeRates: db.exchangeRates,
                });
              }
            }
            if (cp.cash - otherReservedCash < requiredTotalCash) {
              return { success: false, statusCode: 400, message: '상대방 매수자의 타 미체결 예약금을 제외한 가용 예수금이 부족하여 체결할 수 없습니다.' };
            }
          }
        }
      } else {
        for (const [cpId, requiredSellQty] of cpCumulativeSellQty.entries()) {
          if (cpId === OPTIONS_LP_ID) continue;
          const cpHoldingQty = db.holdings.get(`${cpId}_${contract.id}`)?.quantity ?? 0;
          const matchedIds = cpMatchedOrderIds.get(cpId);
          let otherReservedSell = 0;
          const cpOrderIds = db.orderUserIndex.get(cpId);
          if (cpOrderIds) {
            for (const oid of cpOrderIds) {
              if (matchedIds?.has(oid)) continue;
              const ord = db.orders.get(oid);
              if (!ord || ord.stock_id !== contract.id || ord.side !== 'sell' || (ord.status !== 'open' && ord.status !== 'partial')) continue;
              otherReservedSell += Math.max(0, ord.size - (ord.filled || 0));
            }
          }
          if (cpHoldingQty - otherReservedSell < requiredSellQty) {
            return { success: false, statusCode: 400, message: '상대방 매도자의 보유 옵션 수량이 부족하여 체결할 수 없습니다.' };
          }
        }
      }

      return runWithCommitGate(input.onPersist, async () => {
      const commitNowMs = getCurrentNowMs();
      if (db.isTradingHalted()) {
        return {
          success: false,
          statusCode: 403,
          message: '현재 관리자 긴급 서킷브레이커(거래 동결)가 발동되어 옵션 주문을 접수할 수 없습니다.',
        };
      }
      const latestContract = findOptionContract(db, contract.id);
      if (!latestContract) {
        return { success: false, statusCode: 404, message: '존재하지 않는 옵션 계약입니다.' };
      }
      if (hasAmbiguousK200Units(latestContract)) {
        return { success: false, statusCode: 409, message: '기존 옵션 계약의 지수·주식 단위가 일치하지 않아 계약 확인이 필요합니다.' };
      }
      const latestExpiryMs = Date.parse(latestContract.expiry_date);
      if (!Number.isFinite(latestExpiryMs) || latestExpiryMs <= commitNowMs) {
        return { success: false, statusCode: 400, message: '만기된 옵션 계약은 주문할 수 없습니다.' };
      }
      const latestMultiplier = latestContract.multiplier ?? 250000;
      const latestQuotes = getOptionLpQuotes(latestContract);
      const usesLpFill = fills.some((f) => f.counterpartyId === OPTIONS_LP_ID);
      if (
        latestMultiplier !== multiplier ||
        (usesLpFill &&
          ((side === 'BUY' && latestQuotes.lpAskPrice !== lpAskPrice) ||
            (side === 'SELL' && latestQuotes.lpBidPrice !== lpBidPrice)))
      ) {
        return {
          success: false,
          statusCode: 409,
          message: '주문 처리 중 옵션 계약 조건 또는 호가가 변경되어 다시 시도해 주세요.',
        };
      }
      const latestProfile = db.resolveProfileByUserId(userId);
      if (!latestProfile) {
        return { success: false, statusCode: 404, message: '사용자 계좌를 찾을 수 없습니다.' };
      }
      const commitEntitlementProfile = { ...latestProfile };
      pruneExpiredProfileEntitlements(commitEntitlementProfile, commitNowMs);
      if (!commitEntitlementProfile.is_admin && !commitEntitlementProfile.has_options_license) {
        return {
          success: false,
          statusCode: 403,
          message: '파생상품 옵션 거래 자격증이 필요합니다. 상점에서 자격증을 취득해 주세요.',
        };
      }
      // 스냅샷(관련 계좌·종목만) 확보
      const snapProfiles = new Map<string, any>();
      const snapHoldings = new Map<string, any>();
      const snapOrders = new Map<string, OrderRecord>();
      const snapLpLiabilities = new Map(db.lpLiabilities);
      const prevVolume = contract.volume ?? 0;
      const createdTradeIds: string[] = [];

      for (const accId of lockAccounts) {
        const p = db.resolveProfileByUserId(accId);
        if (p) snapProfiles.set(p.id, structuredClone(p));
        const hk = `${accId}_${contract.id}`;
        const h = db.holdings.get(hk);
        if (h) snapHoldings.set(hk, { ...h });
      }
      pruneExpiredProfileEntitlements(latestProfile, commitNowMs);
      for (const f of fills) {
        if (f.restingOrder) snapOrders.set(f.restingOrder.id, { ...f.restingOrder });
      }

      const incomingOrderId = db.generateId('opt_ord');

      const rollbackLocal = () => {
        contract.volume = prevVolume;
        for (const [profileId, prevP] of snapProfiles.entries()) {
          const curP = db.profiles.get(profileId);
          if (curP) {
            for (const key of Object.keys(curP)) {
              if (!(key in prevP)) {
                delete (curP as any)[key];
              }
            }
            Object.assign(curP, prevP);
          } else {
            db.profiles.set(profileId, prevP);
          }
        }
        for (const accId of lockAccounts) {
          const hk = `${accId}_${contract.id}`;
          const prevH = snapHoldings.get(hk);
          if (prevH) {
            db.holdings.set(hk, prevH);
            db.addHoldingToIndex(prevH);
          } else {
            const curH = db.holdings.get(hk);
            if (curH) db.removeHoldingFromIndex(curH);
            db.holdings.delete(hk);
          }
        }
        for (const [oid, prevOrd] of snapOrders.entries()) {
          db.orders.set(oid, prevOrd);
        }
        const incOrd = db.orders.get(incomingOrderId);
        if (incOrd) {
          db.removeOrderFromIndex(incOrd);
          db.orders.delete(incomingOrderId);
        }
        db.lpLiabilities = new Map(snapLpLiabilities);
        for (const tid of createdTradeIds) {
          db.settlementLedger.delete(tid);
          const idx = db.trades.findIndex((t) => t.id === tid);
          if (idx !== -1) db.trades.splice(idx, 1);
          const stTrades = db.tradeStockIndex.get(contract.id);
          if (stTrades) {
            const sIdx = stTrades.findIndex((t) => t.id === tid);
            if (sIdx !== -1) stTrades.splice(sIdx, 1);
          }
        }
      };

      try {
        // 체결 정산 실행 (양측 계좌 자산 보존)
        for (const f of fills) {
          const fillNotional = Math.round(f.price * f.qty * multiplier);
          const buyerId = side === 'BUY' ? userId : f.counterpartyId;
          const sellerId = side === 'SELL' ? userId : f.counterpartyId;
          const buyerFee = buyerId === OPTIONS_LP_ID ? 0 : Math.round(fillNotional * OPTION_FEE_RATE);
          const sellerFee = sellerId === OPTIONS_LP_ID ? 0 : Math.round(fillNotional * OPTION_FEE_RATE);

          const buyerProfile = db.resolveProfileByUserId(buyerId)!;
          const sellerProfile = db.resolveProfileByUserId(sellerId)!;

          buyerProfile.cash = round2(buyerProfile.cash - (fillNotional + buyerFee));
          const sellerNet = fillNotional - sellerFee;
          if (sellerNet >= 0) {
            applyCashCreditWithMarginDebt(sellerProfile, sellerNet);
          } else {
            sellerProfile.cash = round2(sellerProfile.cash + sellerNet);
          }

          // 매수자 보유량 증가 (LP 재매수 시 기존 lpLiabilities 부채를 먼저 상계한 뒤 초과분만 보유량 적립)
          let remainingToHold = f.qty;
          if (buyerId === OPTIONS_LP_ID) {
            const liabKey = `${OPTIONS_LP_ID}:${contract.id}`;
            const curLiab = db.lpLiabilities.get(liabKey) ?? 0;
            if (curLiab > 0) {
              const netted = Math.min(curLiab, f.qty);
              const nextLiab = curLiab - netted;
              if (nextLiab > 0) {
                db.lpLiabilities.set(liabKey, nextLiab);
              } else {
                db.lpLiabilities.delete(liabKey);
              }
              remainingToHold = f.qty - netted;
            }
          }

          if (remainingToHold > 0) {
            const buyerHKey = `${buyerId}_${contract.id}`;
            const buyerHolding = db.holdings.get(buyerHKey);
            if (buyerHolding) {
              const nextQ = buyerHolding.quantity + remainingToHold;
              buyerHolding.avg_price = (buyerHolding.avg_price * buyerHolding.quantity + f.price * remainingToHold) / nextQ;
              buyerHolding.quantity = nextQ;
            } else {
              const newH = {
                id: buyerHKey,
                user_id: buyerId,
                stock_id: contract.id,
                quantity: remainingToHold,
                avg_price: f.price,
                created_at: db.getIsoTimestamp(),
              };
              db.holdings.set(buyerHKey, newH);
              db.addHoldingToIndex(newH);
            }
          }

          // 매도자 보유량 차감 (LP 매도 시 재고 부족분은 lpLiabilities에 부채 기록)
          const sellerHKey = `${sellerId}_${contract.id}`;
          const sellerHolding = db.holdings.get(sellerHKey);
          if (sellerHolding && sellerHolding.quantity >= f.qty) {
            sellerHolding.quantity -= f.qty;
            if (sellerHolding.quantity <= 0) {
              db.removeHoldingFromIndex(sellerHolding);
              db.holdings.delete(sellerHKey);
            }
          } else if (sellerId === OPTIONS_LP_ID) {
            const existingQty = sellerHolding?.quantity ?? 0;
            if (sellerHolding && existingQty > 0) {
              db.removeHoldingFromIndex(sellerHolding);
              db.holdings.delete(sellerHKey);
            }
            const shortDelta = f.qty - existingQty;
            const liabKey = `${OPTIONS_LP_ID}:${contract.id}`;
            db.lpLiabilities.set(liabKey, (db.lpLiabilities.get(liabKey) ?? 0) + shortDelta);
          } else {
            throw new Error('상대방 매도 보유 수량이 부족합니다.');
          }

          if (f.restingOrder) {
            f.restingOrder.filled += f.qty;
            f.restingOrder.status = f.restingOrder.filled >= f.restingOrder.size ? 'filled' : 'partial';
          }

          const tradeId = db.nextMonotonicTradeId('opt_tr');
          createdTradeIds.push(tradeId);
          const tr: TradeRecord = {
            id: tradeId,
            stock_id: contract.id,
            buyer_id: buyerId,
            seller_id: sellerId,
            buy_order_id: side === 'BUY' ? incomingOrderId : f.restingOrder?.id,
            sell_order_id: side === 'SELL' ? incomingOrderId : f.restingOrder?.id,
            buyer_is_bot: buyerId === OPTIONS_LP_ID,
            seller_is_bot: sellerId === OPTIONS_LP_ID,
            price: f.price,
            size: f.qty,
            buyer_fee: buyerFee,
            seller_fee: sellerFee,
            created_at: db.getIsoTimestamp(),
          };
          db.trades.push(tr);
          db.addTradeToIndex(tr);
          db.settlementLedger.set(tradeId, {
            trade_id: tradeId,
            stock_id: contract.id,
            price: f.price,
            size: f.qty,
            total_amount: fillNotional,
            buyer_fee_rate: buyerId === OPTIONS_LP_ID ? 0 : OPTION_FEE_RATE,
            seller_fee_rate: sellerId === OPTIONS_LP_ID ? 0 : OPTION_FEE_RATE,
            buyer_fee_amount: buyerFee,
            seller_fee_amount: sellerFee,
            settled_at: db.getIsoTimestamp(),
          });
        }

        contract.volume = prevVolume + filledQty;

        const orderStatus: 'open' | 'partial' | 'filled' =
          filledQty === 0 ? 'open' : remaining === 0 ? 'filled' : 'partial';

        const orderRecord: OrderRecord = {
          id: incomingOrderId,
          stock_id: contract.id,
          user_id: userId,
          side: side === 'BUY' ? 'buy' : 'sell',
          price: orderType === 'LIMIT' ? limitPrice : side === 'BUY' ? lpAskPrice : lpBidPrice,
          size: qty,
          filled: filledQty,
          status: orderStatus,
          is_lp: false,
          created_at: db.getIsoTimestamp(),
          order_type: 'limit',
        };
        db.orders.set(incomingOrderId, orderRecord);
        db.addOrderToIndex(orderRecord);

        if (input.onPersist) {
          const saved = await input.onPersist();
          if (!saved) {
            rollbackLocal();
            return {
              success: false,
              statusCode: 500,
              message: '옵션 주문 장부 영속 저장에 실패하여 주문을 롤백했습니다.',
            };
          }
        }
        db.trimSettlementLedger(10000);

        const avgExecPrice = filledQty > 0 ? totalFillNotional / (filledQty * multiplier) : 0;
        const msg =
          orderStatus === 'open'
            ? `${contract.ticker} 비시장성 지정가 주문이 미체결 상태로 접수되었습니다 (체결 대기: ${remaining}계약).`
            : orderStatus === 'partial'
              ? `${contract.ticker} ${filledQty}계약 체결 완료, 잔여 ${remaining}계약 미체결 대기 중`
              : `${contract.ticker} ${side === 'BUY' ? '매수' : '매도'} ${filledQty}계약 체결 완료`;

        return {
          success: true,
          statusCode: 200,
          message: msg,
          order: {
            orderId: incomingOrderId,
            contractId: contract.id,
            ticker: contract.ticker,
            side,
            orderType,
            status: orderStatus,
            requestedQty: qty,
            filledQty,
            remainingQty: remaining,
            avgExecPrice,
            multiplier,
            totalNotionalKrw: totalFillNotional,
            feeKrw: totalFillUserFeeKrw,
            remainingCash: profile.cash,
          },
        };
      } catch (err: any) {
        rollbackLocal();
        return {
          success: false,
          statusCode: 500,
          message: err?.message || '옵션 주문 정산 중 오류가 발생하여 롤백했습니다.',
        };
      }
      }, input.onPersist ? undefined : persistenceManager);
    });
  });
}

export interface OptionAccountSummary {
  cash: number;
  reservedCash: number;
  availableCash: number;
  positions: Array<{
    contractId: string;
    ticker: string;
    type: 'CALL' | 'PUT';
    strikePrice: number;
    expiryDate: string;
    qty: number;
    avgPrice: number;
    currentPrice: number;
    multiplier: number;
    pnl: number;
    pnlPct: number;
  }>;
  unfilled: Array<{
    id: string;
    contractId: string;
    ticker: string;
    side: 'BUY' | 'SELL';
    price: number;
    qty: number;
    filled: number;
    remaining: number;
    status: string;
    createdAt: string;
  }>;
  trades: Array<{
    id: string;
    contractId: string;
    ticker: string;
    side: 'BUY' | 'SELL';
    price: number;
    qty: number;
    feeKrw: number;
    createdAt: string;
  }>;
}

export function getOptionAccountSummary(
  db: MemoryDatabase,
  userId: string
): OptionAccountSummary {
  const { cash, reservedCash, availableCash } = getAvailableCashKrw(db, userId);

  const positions: OptionAccountSummary['positions'] = [];
  const holdingIds = db.holdingUserIndex.get(userId);
  if (holdingIds) {
    for (const hid of holdingIds) {
      const h = db.holdings.get(hid);
      if (!h || h.quantity <= 0) continue;
      const contract = db.optionsContracts.get(h.stock_id);
      if (!contract) continue;
      const multiplier = Number(contract.multiplier ?? 250000);
      const currentPrice = Number(contract.current_price ?? 0);
      const avgPrice = Number(h.avg_price ?? 0);
      const pnl = Math.round((currentPrice - avgPrice) * h.quantity * multiplier);
      const costBasis = avgPrice * h.quantity * multiplier;
      const pnlPct = costBasis > 0 ? Math.round((pnl / costBasis) * 1000) / 10 : 0;
      positions.push({
        contractId: contract.id,
        ticker: contract.ticker,
        type: contract.type,
        strikePrice: contract.strike_price,
        expiryDate: contract.expiry_date,
        qty: h.quantity,
        avgPrice,
        currentPrice,
        multiplier,
        pnl,
        pnlPct,
      });
    }
  }

  const unfilled: OptionAccountSummary['unfilled'] = [];
  const orderIds = db.orderUserIndex.get(userId);
  if (orderIds) {
    for (const oid of orderIds) {
      const ord = db.orders.get(oid);
      if (!ord || (ord.status !== 'open' && ord.status !== 'partial')) continue;
      const contract = db.optionsContracts.get(ord.stock_id);
      if (!contract) continue;
      const remaining = Math.max(0, ord.size - (ord.filled || 0));
      if (remaining <= 0) continue;
      unfilled.push({
        id: ord.id,
        contractId: contract.id,
        ticker: contract.ticker,
        side: ord.side === 'buy' ? 'BUY' : 'SELL',
        price: ord.price,
        qty: ord.size,
        filled: ord.filled || 0,
        remaining,
        status: ord.status,
        createdAt: ord.created_at,
      });
    }
  }
  unfilled.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const trades: OptionAccountSummary['trades'] = [];
  for (let i = db.trades.length - 1; i >= 0 && trades.length < 50; i -= 1) {
    const t = db.trades[i];
    if (t.buyer_id !== userId && t.seller_id !== userId) continue;
    const contract = db.optionsContracts.get(t.stock_id);
    if (!contract) continue;
    const isBuyer = t.buyer_id === userId;
    trades.push({
      id: t.id,
      contractId: contract.id,
      ticker: contract.ticker,
      side: isBuyer ? 'BUY' : 'SELL',
      price: t.price,
      qty: t.size,
      feeKrw: Number(isBuyer ? t.buyer_fee ?? 0 : t.seller_fee ?? 0),
      createdAt: t.created_at,
    });
  }

  return { cash, reservedCash, availableCash, positions, unfilled, trades };
}

export async function cancelOptionOrder(params: {
  db: MemoryDatabase;
  userId: string;
  orderId: string;
  onPersist?: () => Promise<boolean>;
}): Promise<{ success: boolean; statusCode: number; message: string }> {
  const { db, userId, orderId, onPersist } = params;
  const prelim = db.orders.get(orderId);
  if (!prelim || !db.optionsContracts.has(prelim.stock_id)) {
    return { success: false, statusCode: 404, message: '옵션 주문을 찾을 수 없습니다.' };
  }

  return withStockLock(prelim.stock_id, async () => {
    return withAccountLocks([db.resolveAccountLockKey(userId)], async () => {
      return runWithCommitGate(onPersist, async () => {
        const current = db.orders.get(orderId);
        if (!current || !db.optionsContracts.has(current.stock_id)) {
          return { success: false, statusCode: 404, message: '옵션 주문을 찾을 수 없습니다.' };
        }
        if (current.user_id !== userId) {
          return { success: false, statusCode: 403, message: '본인의 옵션 주문만 취소할 수 있습니다.' };
        }
        if (current.status !== 'open' && current.status !== 'partial') {
          return { success: false, statusCode: 400, message: `이미 ${current.status} 상태인 주문입니다.` };
        }
        const prevStatus = current.status;
        current.status = 'cancelled';
        const userProfile = db.resolveProfileByUserId(userId);
        const prevCash = userProfile?.cash;
        const prevDebt = userProfile?.margin_debt_krw;
        if (userProfile) {
          sweepUnencumberedCashToMarginDebt(db, userProfile);
        }
        if (onPersist) {
          const saved = await onPersist();
          if (!saved) {
            current.status = prevStatus;
            if (userProfile) {
              if (prevCash !== undefined) userProfile.cash = prevCash;
              if (prevDebt !== undefined) userProfile.margin_debt_krw = prevDebt;
              else delete userProfile.margin_debt_krw;
            }
            return { success: false, statusCode: 500, message: '옵션 주문 취소 저장에 실패해 롤백했습니다.' };
          }
        }
        return { success: true, statusCode: 200, message: '옵션 주문이 취소되었습니다.' };
      });
    });
  });
}

export async function cancelAllOptionOrders(params: {
  db: MemoryDatabase;
  userId: string;
  onPersist?: () => Promise<boolean>;
}): Promise<{ success: boolean; statusCode: number; cancelledCount: number; message: string }> {
  const { db, userId, onPersist } = params;
  const prelimIds: string[] = [];
  const prelimOrderIds = db.orderUserIndex.get(userId);
  if (prelimOrderIds) {
    for (const oid of prelimOrderIds) {
      const ord = db.orders.get(oid);
      if (ord && db.optionsContracts.has(ord.stock_id) && (ord.status === 'open' || ord.status === 'partial')) {
        prelimIds.push(ord.stock_id);
      }
    }
  }
  if (prelimIds.length === 0) {
    return { success: true, statusCode: 200, cancelledCount: 0, message: '취소할 미체결 옵션 주문이 없습니다.' };
  }

  return withAllStockLocks(prelimIds, async () => {
    return withAccountLocks([db.resolveAccountLockKey(userId)], async () => {
      return runWithCommitGate(onPersist, async () => {
        const prevStatuses = new Map<string, OrderRecord['status']>();
        const userOrders = db.orderUserIndex.get(userId);
        if (userOrders) {
          for (const oid of userOrders) {
            const ord = db.orders.get(oid);
            if (!ord || !db.optionsContracts.has(ord.stock_id)) continue;
            if (ord.status === 'open' || ord.status === 'partial') {
              prevStatuses.set(oid, ord.status);
              ord.status = 'cancelled';
            }
          }
        }
        if (prevStatuses.size === 0) {
          return { success: true, statusCode: 200, cancelledCount: 0, message: '취소할 미체결 옵션 주문이 없습니다.' };
        }
        const userProfile = db.resolveProfileByUserId(userId);
        const prevCash = userProfile?.cash;
        const prevDebt = userProfile?.margin_debt_krw;
        if (userProfile) {
          sweepUnencumberedCashToMarginDebt(db, userProfile);
        }
        if (onPersist) {
          const saved = await onPersist();
          if (!saved) {
            for (const [oid, prevStatus] of prevStatuses.entries()) {
              const ord = db.orders.get(oid);
              if (ord) ord.status = prevStatus;
            }
            if (userProfile) {
              if (prevCash !== undefined) userProfile.cash = prevCash;
              if (prevDebt !== undefined) userProfile.margin_debt_krw = prevDebt;
              else delete userProfile.margin_debt_krw;
            }
            return {
              success: false,
              statusCode: 500,
              cancelledCount: 0,
              message: '옵션 일괄 취소 저장에 실패하여 전체 롤백했습니다.',
            };
          }
        }
        return {
          success: true,
          statusCode: 200,
          cancelledCount: prevStatuses.size,
          message: `미체결 옵션 주문 ${prevStatuses.size}건을 일괄 취소했습니다.`,
        };
      });
    });
  });
}

export async function liquidateAllOptionPositions(params: {
  db: MemoryDatabase;
  userId: string;
  nowMs?: number;
  onPersist?: () => Promise<boolean>;
}): Promise<{
  success: boolean;
  statusCode: number;
  liquidatedCount: number;
  message: string;
  failures: string[];
}> {
  const { db, userId, nowMs, onPersist } = params;
  const holdingsSnapshot: Array<{ contractId: string; ticker: string; qty: number }> = [];
  const holdingIds = db.holdingUserIndex.get(userId);
  if (holdingIds) {
    for (const hid of holdingIds) {
      const h = db.holdings.get(hid);
      if (!h || h.quantity <= 0) continue;
      const contract = db.optionsContracts.get(h.stock_id);
      if (!contract) continue;
      holdingsSnapshot.push({ contractId: contract.id, ticker: contract.ticker, qty: h.quantity });
    }
  }

  if (holdingsSnapshot.length === 0) {
    return {
      success: true,
      statusCode: 200,
      liquidatedCount: 0,
      message: '청산할 보유 옵션 포지션이 없습니다.',
      failures: [],
    };
  }

  let liquidatedCount = 0;
  const failures: string[] = [];

  for (const pos of holdingsSnapshot) {
    // 동일 종목에 예약된 기존 매도 미체결 수량을 제외한 가용 수량 계산
    let reservedSellQty = 0;
    const orderIds = db.orderUserIndex.get(userId);
    if (orderIds) {
      for (const oid of orderIds) {
        const ord = db.orders.get(oid);
        if (ord && ord.stock_id === pos.contractId && ord.side === 'sell' && (ord.status === 'open' || ord.status === 'partial')) {
          reservedSellQty += Math.max(0, ord.size - (ord.filled || 0));
        }
      }
    }
    const sellQty = Math.max(0, pos.qty - reservedSellQty);
    if (sellQty <= 0) {
      failures.push(`${pos.ticker}: 미체결 매도 주문에 묶인 수량을 제외하면 청산 가능 수량이 없습니다.`);
      continue;
    }

    const res = await submitAuthoritativeOptionOrder({
      db,
      userId,
      contractId: pos.contractId,
      side: 'SELL',
      orderType: 'MARKET',
      qty: sellQty,
      nowMs,
      onPersist,
    });
    if (res.success && (res.order?.filledQty ?? 0) > 0) {
      liquidatedCount += 1;
    } else {
      failures.push(`${pos.ticker}: ${res.message}`);
    }
  }

  if (liquidatedCount === 0 && failures.length > 0) {
    return {
      success: false,
      statusCode: 400,
      liquidatedCount: 0,
      message: `옵션 포지션 청산 실패: ${failures[0]}`,
      failures,
    };
  }

  return {
    success: true,
    statusCode: 200,
    liquidatedCount,
    message:
      failures.length > 0
        ? `${liquidatedCount}개 포지션 청산 완료 (${failures.length}건 실패: ${failures[0]})`
        : `${liquidatedCount}개 옵션 포지션을 시장가로 일괄 청산했습니다.`,
    failures,
  };
}
