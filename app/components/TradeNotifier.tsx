'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/useAuth';
import { useToast } from './ToastProvider';

export default function TradeNotifier() {
  const { userId, isLoggedIn } = useAuth();
  const { showToast } = useToast();
  const processedTradesRef = useRef<Set<string>>(new Set());
  const lastCheckTimeRef = useRef<string>('');
  const isInitialMountRef = useRef<boolean>(true);

  useEffect(() => {
    if (!isLoggedIn || !userId) return;

    if (!lastCheckTimeRef.current) {
      lastCheckTimeRef.current = new Date(Date.now() - 5000).toISOString();
    }

    const supabase = createClient();
    let isSubscribed = true;

    // 종목 캐시 맵
    const stockCache = new Map<string, { name: string; ticker: string; market: string }>();

    const getStockInfo = async (stockId: string) => {
      if (stockCache.has(stockId)) return stockCache.get(stockId)!;
      const { data } = await supabase.from('stocks').select('name, ticker, market').eq('id', stockId).single();
      const info = data || { name: '주식', ticker: 'STK', market: 'domestic' };
      stockCache.set(stockId, info);
      return info;
    };

    const pollNewTrades = async () => {
      if (!isSubscribed) return;

      try {
        // 내가 매수자이거나 매도자인 최근 체결건 조회
        const { data: myTrades, error } = await supabase
          .from('trades')
          .select('id, stock_id, buyer_id, seller_id, price, size, created_at')
          .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
          .gt('created_at', lastCheckTimeRef.current)
          .order('created_at', { ascending: true })
          .limit(20);

        if (error) throw error;

        if (myTrades && myTrades.length > 0) {
          for (const t of myTrades) {
            if (processedTradesRef.current.has(t.id)) continue;
            processedTradesRef.current.add(t.id);

            // 초기 마운트 시의 과거 데이터는 알림을 띄우지 않고 ID만 등록
            if (!isInitialMountRef.current) {
              const isBuyer = t.buyer_id === userId;
              const stock = await getStockInfo(t.stock_id);
              const p = Number(t.price);
              const s = Number(t.size);
              const totalVal = p * s;

              const isOverseas = stock.market === 'overseas' || stock.market === 'us';
              const priceFmt = isOverseas ? `$${p.toLocaleString()}` : `₩${p.toLocaleString()}`;
              const totalFmt = isOverseas ? `$${totalVal.toLocaleString()}` : `₩${totalVal.toLocaleString()}`;

              if (isBuyer) {
                showToast({
                  type: 'buy',
                  title: `${stock.name} ${s.toLocaleString()}주 매수 체결`,
                  description: `체결가: ${priceFmt} · 총 ${totalFmt}`,
                  duration: 5000,
                });
              } else {
                showToast({
                  type: 'sell',
                  title: `${stock.name} ${s.toLocaleString()}주 매도 체결`,
                  description: `체결가: ${priceFmt} · 총 ${totalFmt}`,
                  duration: 5000,
                });
              }
            }
          }

          // 최신 시각 갱신
          const latest = myTrades[myTrades.length - 1];
          if (latest && latest.created_at) {
            lastCheckTimeRef.current = latest.created_at;
          }
        }

        isInitialMountRef.current = false;
      } catch {
        // 백그라운드 폴링 에러 무시
      }
    };

    // 최초 1회 즉시 실행
    pollNewTrades();

    // 2.5초 간격 체결 폴링
    const intervalId = setInterval(pollNewTrades, 2500);

    return () => {
      isSubscribed = false;
      clearInterval(intervalId);
    };
  }, [isLoggedIn, userId, showToast]);

  return null;
}
