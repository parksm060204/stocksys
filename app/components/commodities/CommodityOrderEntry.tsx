'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CommodityDefinition } from '@/lib/commodities/types';
import { fmtPrice } from '@/lib/format';
import { useAuth } from '@/lib/auth/useAuth';
import { useToast } from '@/app/components/ToastProvider';
import { DEFAULT_USD_TO_KRW_RATE } from '@/lib/engine/currency';

interface CommodityOrderEntryProps {
  commodity: CommodityDefinition & { currentPrice: number };
  onOrderPlaced?: () => void;
}

export default function CommodityOrderEntry({
  commodity,
  onOrderPlaced,
}: CommodityOrderEntryProps) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit');
  const [price, setPrice] = useState<string>(String(commodity.currentPrice));
  const [contracts, setContracts] = useState<string>('1');
  const [userCash, setUserCash] = useState<number | null>(null);
  const [usdToKrwRate, setUsdToKrwRate] = useState<number>(DEFAULT_USD_TO_KRW_RATE);
  const [positionQty, setPositionQty] = useState<number>(0);
  const [pendingOrders, setPendingOrders] = useState<Array<{ side: 'buy' | 'sell'; size: number; filled: number }>>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const { userId, isLoggedIn } = useAuth();
  const { showToast } = useToast();
  const accountKey = isLoggedIn && userId ? userId : null;

  const mountedRef = useRef<boolean>(true);
  const fetchSeqRef = useRef<number>(0);
  const submitSeqRef = useRef<number>(0);
  const activeContextRef = useRef<{ accountKey: string | null; commodityId: string }>({
    accountKey,
    commodityId: commodity.id,
  });
  const onOrderPlacedRef = useRef(onOrderPlaced);

  useEffect(() => {
    onOrderPlacedRef.current = onOrderPlaced;
  }, [onOrderPlaced]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      fetchSeqRef.current += 1;
      submitSeqRef.current += 1;
    };
  }, []);

  const fetchAccountState = useCallback(async () => {
    const reqAccountKey = accountKey;
    const reqCommodityId = commodity.id;
    const reqSeq = ++fetchSeqRef.current;

    try {
      const res = await fetch(`/api/commodities?id=${encodeURIComponent(reqCommodityId)}`);
      const data = await res.json();
      if (
        !mountedRef.current ||
        reqSeq !== fetchSeqRef.current ||
        activeContextRef.current.accountKey !== reqAccountKey ||
        activeContextRef.current.commodityId !== reqCommodityId
      ) {
        return;
      }
      if (!data?.success) return;
      if (Number(data.usdToKrwRate) > 0) {
        setUsdToKrwRate(Number(data.usdToKrwRate));
      }
      if (reqAccountKey) {
        setUserCash(data.availableCashKrw !== null && data.availableCashKrw !== undefined ? Number(data.availableCashKrw) : null);
        const rawPosQty = Math.abs(Number(data.myPosition?.quantity ?? 0));
        const posSide = data.myPosition?.side;
        const signedPosQty = posSide === 'short' ? -rawPosQty : posSide === 'flat' ? 0 : rawPosQty;
        setPositionQty(Number.isFinite(signedPosQty) ? signedPosQty : 0);
        setPendingOrders(Array.isArray(data.myOrders) ? data.myOrders : []);
      } else {
        setUserCash(null);
        setPositionQty(0);
        setPendingOrders([]);
      }
    } catch {
      // 조회 실패 시 기존 상태 유지
    }
  }, [commodity.id, accountKey]);

  useEffect(() => {
    activeContextRef.current = { accountKey, commodityId: commodity.id };
    fetchSeqRef.current += 1;
    submitSeqRef.current += 1;

    setUserCash(null);
    setPositionQty(0);
    setPendingOrders([]);
    setLoading(false);

    void fetchAccountState();
    return () => {
      fetchSeqRef.current += 1;
      submitSeqRef.current += 1;
    };
  }, [fetchAccountState, accountKey, commodity.id]);

  const numContracts = Math.max(1, parseInt(contracts, 10) || 1);
  const numPrice = orderType === 'market' ? commodity.currentPrice : parseFloat(price) || commodity.currentPrice;

  // 서버 권위 환율 기반 계약당 필요 위탁증거금 & reduce-only 청산 면제 수량 계산
  const marginPerContractUsd = commodity.marginRequirement || 3000;
  const marginPerContractKrw = Math.max(1, Math.round(marginPerContractUsd * usdToKrwRate));
  const pendingSameSideQty = pendingOrders
    .filter((o) => o.side === side)
    .reduce((acc, o) => acc + Math.max(0, Number(o.size) - Number(o.filled || 0)), 0);
  const reduceOnlyCapacity =
    side === 'sell' && positionQty > 0
      ? Math.max(0, positionQty - pendingSameSideQty)
      : side === 'buy' && positionQty < 0
        ? Math.max(0, Math.abs(positionQty) - pendingSameSideQty)
        : 0;
  const additionalExposureContracts = Math.max(0, numContracts - reduceOnlyCapacity);
  const totalRequiredMarginKrw = marginPerContractKrw * additionalExposureContracts;

  // 최대 주문 가능 계약수 (청산 가능 수량 + 신규 증거금 여력)
  const maxContracts =
    reduceOnlyCapacity +
    (userCash !== null && userCash > 0 && marginPerContractKrw > 0
      ? Math.max(0, Math.floor(userCash / marginPerContractKrw))
      : 0);

  const handleSetMax = () => {
    setContracts(String(Math.max(1, maxContracts)));
  };

  const handleSubmitOrder = async () => {
    if (loading) return;
    if (!isLoggedIn || !userId) {
      showToast({
        type: 'warn',
        title: '로그인 필요',
        description: '원자재 선물 거래는 로그인 후 이용 가능합니다.',
      });
      return;
    }

    if (totalRequiredMarginKrw > 0 && userCash !== null && userCash < totalRequiredMarginKrw) {
      showToast({
        type: 'error',
        title: '증거금 부족',
        description: `필요 추가 위탁증거금(₩${totalRequiredMarginKrw.toLocaleString()})이 가용 예수금(₩${userCash.toLocaleString()})을 초과합니다.`,
      });
      return;
    }

    const reqAccountKey = accountKey;
    const reqCommodityId = commodity.id;
    if (!reqAccountKey) return;
    const reqSubmitSeq = submitSeqRef.current;

    setLoading(true);
    try {
      // 1. 서버 권위 API 주문 제출 (서버에서 계좌 잠금, 증거금 예약 및 정산 처리)
      const res = await fetch('/api/commodities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_order',
          order: {
            commodityId: reqCommodityId,
            side,
            type: orderType,
            price: numPrice,
            size: numContracts,
          },
        }),
      });

      const data = await res.json();
      if (
        !mountedRef.current ||
        reqSubmitSeq !== submitSeqRef.current ||
        activeContextRef.current.accountKey !== reqAccountKey ||
        activeContextRef.current.commodityId !== reqCommodityId
      ) {
        return;
      }
      if (!res.ok || !data.success) throw new Error(data.message || '주문 제출 실패');

      await fetchAccountState();
      if (
        !mountedRef.current ||
        reqSubmitSeq !== submitSeqRef.current ||
        activeContextRef.current.accountKey !== reqAccountKey ||
        activeContextRef.current.commodityId !== reqCommodityId
      ) {
        return;
      }

      const confirmedMargin = Number(data.reservedMarginKrw ?? totalRequiredMarginKrw);
      showToast({
        type: side === 'buy' ? 'buy' : 'sell',
        title: `${commodity.nameKo} ${side === 'buy' ? '매수' : '매도'} 주문 접수`,
        description: `${numContracts}계약 @ $${numPrice.toLocaleString()} (위탁증거금 ₩${confirmedMargin.toLocaleString()} 예약 완료)`,
      });

      onOrderPlacedRef.current?.();
    } catch (e: any) {
      if (
        !mountedRef.current ||
        reqSubmitSeq !== submitSeqRef.current ||
        activeContextRef.current.accountKey !== reqAccountKey ||
        activeContextRef.current.commodityId !== reqCommodityId
      ) {
        return;
      }
      showToast({
        type: 'error',
        title: '주문 오류',
        description: e.message || '주문 처리 중 문제가 발생했습니다.',
      });
    } finally {
      if (
        mountedRef.current &&
        reqSubmitSeq === submitSeqRef.current &&
        activeContextRef.current.accountKey === reqAccountKey &&
        activeContextRef.current.commodityId === reqCommodityId
      ) {
        setLoading(false);
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0E1117] border border-border rounded-2xl overflow-hidden shadow-2xl font-mono text-xs select-none">
      {/* ── 1. 매수 / 매도 탭 ── */}
      <div className="grid grid-cols-2 border-b border-border bg-[#090B0F]">
        <button
          onClick={() => setSide('buy')}
          className={`py-3 text-[13.5px] font-black transition-all cursor-pointer ${
            side === 'buy'
              ? 'bg-up/15 text-up border-b-2 border-[#F04452]'
              : 'text-[#8E939D] hover:text-white'
          }`}
        >
          선물 롱 매수 (BUY)
        </button>
        <button
          onClick={() => setSide('sell')}
          className={`py-3 text-[13.5px] font-black transition-all border-l border-border cursor-pointer ${
            side === 'sell'
              ? 'bg-down/15 text-down border-b-2 border-[#3182F6]'
              : 'text-[#8E939D] hover:text-white'
          }`}
        >
          선물 숏 매도 (SELL)
        </button>
      </div>

      <div className="p-4 space-y-4 flex-1 flex flex-col justify-between">
        <div className="space-y-3.5">
          {/* 주문 유형 선택 (지정가 / 시장가) */}
          <div className="flex items-center gap-1.5 bg-[#161B22] p-1 rounded-xl border border-border">
            <button
              onClick={() => setOrderType('limit')}
              className={`flex-1 py-1.5 rounded-lg font-bold text-xs transition-colors cursor-pointer ${
                orderType === 'limit' ? 'bg-[#212631] text-white shadow' : 'text-[#8E939D] hover:text-white'
              }`}
            >
              지정가 (Limit)
            </button>
            <button
              onClick={() => setOrderType('market')}
              className={`flex-1 py-1.5 rounded-lg font-bold text-xs transition-colors cursor-pointer ${
                orderType === 'market' ? 'bg-[#212631] text-white shadow' : 'text-[#8E939D] hover:text-white'
              }`}
            >
              시장가 (Market)
            </button>
          </div>

          {/* 가격 입력 (지정가 시) */}
          {orderType === 'limit' && (
            <div>
              <div className="flex justify-between text-xs text-[#8E939D] font-bold mb-1">
                <span>주문 가격 (USD)</span>
                <span className="text-[#565A63]">틱 단위: {commodity.tickSize}</span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  step={commodity.tickSize}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full bg-[#05070A] border border-border rounded-xl px-3.5 py-2.5 text-white font-mono font-black text-sm outline-none focus:border-[#3182F6] transition-colors"
                />
                <span className="absolute right-3.5 top-3 text-xs text-[#565A63] font-bold">USD</span>
              </div>
            </div>
          )}

          {/* 계약 수량 입력 */}
          <div>
            <div className="flex justify-between text-xs text-[#8E939D] font-bold mb-1">
              <span>주문 수량 (계약)</span>
              <span className="text-down cursor-pointer hover:underline" onClick={handleSetMax}>
                최대 가능: {maxContracts.toLocaleString()}계약
              </span>
            </div>
            <div className="relative">
              <input
                type="number"
                min="1"
                max={Math.max(100, maxContracts)}
                value={contracts}
                onChange={(e) => setContracts(e.target.value)}
                className="w-full bg-[#05070A] border border-border rounded-xl px-3.5 py-2.5 text-white font-mono font-black text-sm outline-none focus:border-[#3182F6] transition-colors"
              />
              <span className="absolute right-3.5 top-3 text-xs text-[#565A63] font-bold">Contracts</span>
            </div>

            {/* 퀵 계약 수량 버튼 */}
            <div className="grid grid-cols-4 gap-1.5 mt-2">
              {['1', '5', '10', '25'].map((val) => (
                <button
                  key={val}
                  onClick={() => setContracts(val)}
                  className="py-1 rounded-lg bg-[#161B22] hover:bg-[#212631] text-[#8E939D] hover:text-white font-bold text-[10.5px] transition-colors border border-border/60"
                >
                  +{val}계약
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── 증거금 및 정산 내역 요약 ── */}
        <div className="space-y-3 pt-2">
          <div className="p-3 bg-[#05070A] rounded-xl border border-border space-y-1.5 font-mono">
            <div className="flex justify-between text-xs text-[#8E939D]">
              <span>계약당 위탁증거금 (₩{usdToKrwRate.toLocaleString()}/USD)</span>
              <span className="text-white font-bold">{fmtPrice(marginPerContractUsd, 'overseas')}</span>
            </div>
            <div className="flex justify-between text-[11.5px]">
              <span className="text-[#8E939D] font-bold">
                {additionalExposureContracts === 0 ? '청산(Reduce-Only) 주문' : '총 필요 추가 위탁증거금'}
              </span>
              <span className="text-up font-black tabular-nums text-[13px]">
                {additionalExposureContracts === 0 ? '₩0 (증거금 면제)' : `₩${totalRequiredMarginKrw.toLocaleString()}`}
              </span>
            </div>
            {positionQty !== 0 && (
              <div className="flex justify-between text-[10.5px] text-amber-400">
                <span>현재 보유 포지션</span>
                <span>{positionQty > 0 ? `롱 +${positionQty}` : `숏 ${positionQty}`}계약</span>
              </div>
            )}
            <div className="flex justify-between text-[10.5px] text-[#565A63] pt-1 border-t border-border/50">
              <span>내 가용 예수금</span>
              <span className="text-[#8E939D]">
                {userCash !== null ? `₩${userCash.toLocaleString()}` : '로그인 필요'}
              </span>
            </div>
          </div>

          <button
            onClick={handleSubmitOrder}
            disabled={loading}
            className={`w-full py-3.5 rounded-full font-black text-[13.5px] transition-all cursor-pointer shadow-lg active:scale-[0.98] ${
              side === 'buy'
                ? 'bg-up text-white hover:bg-[#ff5252] shadow-[0_0_16px_rgba(240,68,82,0.35)]'
                : 'bg-down text-white hover:bg-[#4092ff] shadow-[0_0_16px_rgba(49,130,246,0.35)]'
            }`}
          >
            {loading
              ? '주문 처리 중...'
              : side === 'buy'
              ? `${numContracts}계약 롱 매수 주문 (BUY)`
              : `${numContracts}계약 숏 매도 주문 (SELL)`}
          </button>
        </div>
      </div>
    </div>
  );
}
