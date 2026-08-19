'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/useAuth';
import { useToast } from './ToastProvider';
import { fmtKSTTime } from '@/lib/format';
import Link from 'next/link';

export interface OpenOrder {
  id: string;
  stock_id: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  filled: number;
  status: string;
  created_at: string;
  stocks?: {
    id: string;
    ticker: string;
    name: string;
    market: string;
    current_price: number;
  };
}

interface ActiveOrdersPanelProps {
  currentStockId?: string;
  compact?: boolean;
  onOrderCountChange?: (count: number) => void;
}

export default function ActiveOrdersPanel({
  currentStockId,
  compact: _compact = false,
  onOrderCountChange,
}: ActiveOrdersPanelProps) {
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [filterMode, setFilterMode] = useState<'CURRENT' | 'ALL'>(currentStockId ? 'CURRENT' : 'ALL');
  const [loading, setLoading] = useState<boolean>(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const { userId, isLoggedIn } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const fetchOrders = useCallback(async () => {
    if (!isLoggedIn || !userId) {
      setOrders([]);
      setLoading(false);
      onOrderCountChange?.(0);
      return;
    }

    try {
      let query = supabase
        .from('orders')
        .select('id, stock_id, side, price, size, filled, status, created_at, stocks(id, ticker, name, market, current_price)')
        .eq('user_id', userId)
        .in('status', ['open', 'partial'])
        .order('created_at', { ascending: false });

      if (filterMode === 'CURRENT' && currentStockId) {
        query = query.eq('stock_id', currentStockId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const list = (data || []) as unknown as OpenOrder[];
      setOrders(list);
      onOrderCountChange?.(list.length);
    } catch (e) {
      console.error('[ActiveOrdersPanel] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn, userId, filterMode, currentStockId, supabase, onOrderCountChange]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 3000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  // 개별 주문 취소
  const handleCancelOrder = async (order: OpenOrder) => {
    if (cancellingId) return;
    setCancellingId(order.id);

    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('id', order.id)
        .eq('user_id', userId);

      if (error) throw error;

      showToast({
        type: 'info',
        title: `${order.stocks?.name || '종목'} 주문 취소 완료`,
        description: `${order.side === 'buy' ? '매수' : '매도'} ${(Number(order.size) - Number(order.filled)).toLocaleString()}주 취소 접수`,
      });

      // 낙관적 UI 갱신
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
      onOrderCountChange?.(Math.max(0, orders.length - 1));
    } catch (e: any) {
      showToast({
        type: 'error',
        title: '주문 취소 실패',
        description: e.message || '취소 중 오류가 발생했습니다.',
      });
    } finally {
      setCancellingId(null);
    }
  };

  // 전체 미체결 일괄 취소
  const handleCancelAll = async () => {
    if (orders.length === 0 || cancellingId) return;
    if (!confirm(`현재 표시된 ${orders.length}건의 미체결 주문을 모두 취소하시겠습니까?`)) return;

    setCancellingId('ALL');
    try {
      const targetIds = orders.map((o) => o.id);
      const { error } = await supabase
        .from('orders')
        .update({ status: 'cancelled' })
        .in('id', targetIds)
        .eq('user_id', userId);

      if (error) throw error;

      showToast({
        type: 'info',
        title: '전체 주문 일괄 취소 완료',
        description: `${targetIds.length}건의 미체결 주문이 취소되었습니다.`,
      });

      setOrders([]);
      onOrderCountChange?.(0);
    } catch (e: any) {
      showToast({
        type: 'error',
        title: '일괄 취소 실패',
        description: e.message || '오류가 발생했습니다.',
      });
    } finally {
      setCancellingId(null);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="p-8 text-center text-[12px] font-mono text-[#8E939D] space-y-2">
        <div>🔒 로그인이 필요한 메뉴입니다.</div>
        <p className="text-[11px] text-[#565A63]">로그인 후 미체결 주문을 조회하고 관리할 수 있습니다.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full font-mono text-xs select-none">
      {/* 서브 헤더 (필터 & 일괄 취소 버튼) */}
      <div className="flex items-center justify-between p-3 border-b border-[#212631] bg-[#090B0F]">
        <div className="flex items-center gap-1.5">
          {currentStockId && (
            <div className="flex bg-[#161B22] p-0.5 rounded-lg border border-[#212631]">
              <button
                onClick={() => setFilterMode('CURRENT')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                  filterMode === 'CURRENT' ? 'bg-[#212631] text-white' : 'text-[#8E939D] hover:text-white'
                }`}
              >
                현재 종목
              </button>
              <button
                onClick={() => setFilterMode('ALL')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                  filterMode === 'ALL' ? 'bg-[#212631] text-white' : 'text-[#8E939D] hover:text-white'
                }`}
              >
                전체 종목
              </button>
            </div>
          )}
          <span className="text-[11.5px] text-[#8E939D] font-bold">
            미체결 <strong className="text-white">{orders.length}</strong>건
          </span>
        </div>

        {orders.length > 0 && (
          <button
            onClick={handleCancelAll}
            disabled={cancellingId !== null}
            className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50"
          >
            전량 일괄 취소
          </button>
        )}
      </div>

      {/* 미체결 주문 테이블 / 리스트 */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {loading && orders.length === 0 ? (
          <div className="p-8 text-center text-[#8E939D] text-[11.5px]">미체결 내역 불러오는 중...</div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-[#565A63] text-[11.5px]">
            접수된 미체결 지정가 주문이 없습니다.
          </div>
        ) : (
          <div className="divide-y divide-[#212631]/60">
            {orders.map((o) => {
              const remQty = Math.max(0, Number(o.size) - Number(o.filled));
              const fillPct = Number(o.size) > 0 ? (Number(o.filled) / Number(o.size)) * 100 : 0;
              const isBuy = o.side === 'buy';
              const stockName = o.stocks?.name || '종목';
              const ticker = o.stocks?.ticker || '';
              const isOverseas = o.stocks?.market === 'overseas' || o.stocks?.market === 'us';
              const priceFmt = isOverseas ? `$${Number(o.price).toLocaleString()}` : `₩${Number(o.price).toLocaleString()}`;

              return (
                <div
                  key={o.id}
                  className="p-3 hover:bg-[#161B22]/60 transition-colors flex items-center justify-between gap-3 group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`px-2 py-0.5 rounded text-[10.5px] font-black shrink-0 border ${
                        isBuy
                          ? 'bg-[#F04452]/10 text-[#F04452] border-[#F04452]/30'
                          : 'bg-[#3182F6]/10 text-[#3182F6] border-[#3182F6]/30'
                      }`}
                    >
                      {isBuy ? '매수' : '매도'}
                    </span>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 truncate">
                        <Link
                          href={`/stocks/${o.stock_id}`}
                          className="font-bold text-white hover:text-[#F04452] transition-colors truncate"
                        >
                          {stockName}
                        </Link>
                        {ticker && <span className="text-[10px] text-[#565A63] font-bold shrink-0">{ticker}</span>}
                      </div>
                      <div className="text-[10.5px] text-[#8E939D] flex items-center gap-2 mt-0.5">
                        <span>{fmtKSTTime(o.created_at)}</span>
                        <span>·</span>
                        <span className="text-white font-bold">{priceFmt}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <div className="text-[12px] font-black text-white tabular-nums">
                        잔여 {remQty.toLocaleString()}주
                        <span className="text-[10.5px] text-[#8E939D] font-normal ml-1">
                          / {Number(o.size).toLocaleString()}주
                        </span>
                      </div>
                      {fillPct > 0 && (
                        <div className="flex items-center justify-end gap-1.5 mt-0.5">
                          <div className="w-12 bg-[#212631] h-1 rounded-full overflow-hidden">
                            <div
                              className="bg-[#00C853] h-full rounded-full"
                              style={{ width: `${Math.min(100, fillPct)}%` }}
                            />
                          </div>
                          <span className="text-[9.5px] text-[#00C853] font-bold tabular-nums">
                            {fillPct.toFixed(0)}% 체결
                          </span>
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => handleCancelOrder(o)}
                      disabled={cancellingId === o.id || cancellingId === 'ALL'}
                      className="px-2.5 py-1 rounded bg-[#212631] hover:bg-rose-500 hover:text-white text-[#8E939D] text-[11px] font-bold transition-all cursor-pointer disabled:opacity-40"
                    >
                      {cancellingId === o.id ? '취소중..' : '취소'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
