'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { useToast } from '@/app/components/ToastProvider';

export interface CommodityOpenOrderItem {
  id: string;
  commodityId: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price: number;
  size: number;
  filled: number;
  status: string;
  reserved_krw?: number;
  timestamp?: number;
}

export interface CommodityPositionSummary {
  quantity: number;
  avg_entry_price: number;
}

interface CommodityActiveOrdersPanelProps {
  commodityId: string;
  commodityName: string;
  refreshSignal?: number;
  onOrdersChanged?: () => void;
}

export default function CommodityActiveOrdersPanel({
  commodityId,
  commodityName,
  refreshSignal = 0,
  onOrdersChanged,
}: CommodityActiveOrdersPanelProps) {
  const [orders, setOrders] = useState<CommodityOpenOrderItem[]>([]);
  const [position, setPosition] = useState<CommodityPositionSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const { isLoggedIn } = useAuth();
  const { showToast } = useToast();

  const fetchOrders = useCallback(async () => {
    if (!isLoggedIn) {
      setOrders([]);
      setPosition(null);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/commodities?id=${encodeURIComponent(commodityId)}`);
      const data = await res.json();
      if (data.success) {
        setOrders(Array.isArray(data.myOrders) ? data.myOrders : []);
        setPosition(data.myPosition || null);
      }
    } catch {
      // 백그라운드 조회 오류 무시
    } finally {
      setLoading(false);
    }
  }, [commodityId, isLoggedIn]);

  useEffect(() => {
    void fetchOrders();
    const interval = setInterval(() => {
      void fetchOrders();
    }, 2000);
    return () => clearInterval(interval);
  }, [fetchOrders, refreshSignal]);

  const handleCancelOrder = async (order: CommodityOpenOrderItem) => {
    if (cancellingId) return;
    setCancellingId(order.id);
    try {
      const res = await fetch('/api/commodities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel_order', orderId: order.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || '원자재 주문 취소에 실패했습니다.');
      }

      showToast({
        type: 'info',
        title: `${commodityName} 주문 취소 완료`,
        description: `증거금 ₩${Number(data.refundedKrw || 0).toLocaleString()} 환불 완료`,
      });
      await fetchOrders();
      onOrdersChanged?.();
    } catch (e: any) {
      showToast({
        type: 'error',
        title: '원자재 주문 취소 실패',
        description: e?.message || '취소 요청 중 오류가 발생했습니다.',
      });
    } finally {
      setCancellingId(null);
    }
  };

  const handleCancelAll = async () => {
    if (orders.length === 0 || cancellingId) return;
    setCancellingId('ALL');
    try {
      const res = await fetch('/api/commodities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel_all_orders', commodityId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || '원자재 전체 취소에 실패했습니다.');
      }

      showToast({
        type: 'info',
        title: `${commodityName} 전체 미체결 취소 완료`,
        description: `${data.cancelledOrderIds?.length ?? 0}건 취소 · 증거금 ₩${Number(data.refundedKrw || 0).toLocaleString()} 환불`,
      });
      await fetchOrders();
      onOrdersChanged?.();
    } catch (e: any) {
      showToast({
        type: 'error',
        title: '일괄 취소 실패',
        description: e?.message || '일괄 취소 중 오류가 발생했습니다.',
      });
    } finally {
      setCancellingId(null);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="p-8 text-center text-[12px] font-mono text-[#8E939D] space-y-2">
        <div>🔒 로그인이 필요한 메뉴입니다.</div>
        <p className="text-xs text-[#565A63]">로그인 후 원자재 선물 미체결 주문과 보유 포지션을 관리할 수 있습니다.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full font-mono text-xs select-none">
      {/* 상단 요약 & 일괄 취소 */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-b border-border bg-[#090B0F]">
        <div className="flex items-center gap-3">
          <span className="text-[11.5px] text-[#8E939D] font-bold">
            {commodityName} 미체결 <strong className="text-white">{orders.length}</strong>건
          </span>
          {position && position.quantity !== 0 && (
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${
              position.quantity > 0
                ? 'bg-up/10 text-up border-[#F04452]/30'
                : 'bg-down/10 text-down border-[#3182F6]/30'
            }`}>
              보유 포지션: {position.quantity > 0 ? `롱 +${position.quantity}` : `숏 ${position.quantity}`}계약 (평균 ${Number(position.avg_entry_price || 0).toFixed(2)})
            </span>
          )}
        </div>

        {orders.length > 0 && (
          <button
            onClick={handleCancelAll}
            disabled={cancellingId !== null}
            className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
          >
            전량 일괄 취소
          </button>
        )}
      </div>

      {/* 주문 목록 */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {loading && orders.length === 0 ? (
          <div className="p-8 text-center text-[#8E939D] text-[11.5px]">원자재 미체결 내역 불러오는 중...</div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-[#565A63] text-[11.5px]">
            {commodityName}에 접수된 미체결 선물 주문이 없습니다.
          </div>
        ) : (
          <div className="divide-y divide-[#212631]/60">
            {orders.map((o) => {
              const remQty = Math.max(0, Number(o.size) - Number(o.filled || 0));
              const isBuy = o.side === 'buy';
              return (
                <div key={o.id} className="p-3 hover:bg-[#161B22]/60 transition-colors flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`px-2 py-1 rounded-lg text-[10px] font-black border shrink-0 ${
                      isBuy ? 'bg-up/15 text-up border-[#F04452]/30' : 'bg-down/15 text-down border-[#3182F6]/30'
                    }`}>
                      {isBuy ? '롱 매수' : '숏 매도'}
                    </span>
                    <div className="min-w-0">
                      <div className="text-white font-bold text-xs flex items-center gap-2">
                        <span>{commodityName}</span>
                        <span className="text-[#8E939D] uppercase">{o.type}</span>
                      </div>
                      <div className="text-[11px] text-[#8E939D] tabular-nums mt-0.5">
                        ${Number(o.price).toLocaleString()} · 잔여 {remQty.toLocaleString()} / {Number(o.size).toLocaleString()}계약 · 예약증거금 ₩{Number(o.reserved_krw || 0).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleCancelOrder(o)}
                    disabled={cancellingId !== null}
                    className="px-2.5 py-1.5 rounded-lg bg-[#161B22] hover:bg-rose-500/20 text-[#8E939D] hover:text-rose-400 border border-border hover:border-rose-500/40 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    {cancellingId === o.id ? '취소 중...' : '주문 취소'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
