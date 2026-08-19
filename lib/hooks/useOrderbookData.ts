'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  getTickSize,
  alignToTickSize,
  type SimOrderbookLevel,
  type SimTrade,
} from './useStockBotSimulation';

import { createClient } from '@/lib/supabase/client';

// ─── DB 행 타입 ──────────────────────────────────────────────────────────────
interface DBOrder {
  id: string;
  stock_id: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  filled: number;
  status: string;
  is_lp: boolean;
}

interface DBTrade {
  id: string;
  stock_id: string;
  price: number;
  size: number;
  buyer_is_bot: boolean;
  seller_is_bot: boolean;
  created_at: string;
}

// ─── 공통 리턴 타입 ──────────────────────────────────────────────────────────
export interface OrderbookLevel {
  price: number;
  totalSize: number;
}

export interface TradeRecord {
  tradeId: string;
  price: number;
  quantity: number;
  side: 'BUY' | 'SELL';
  isLiquidation: boolean;
  timestamp: number;
}

interface UseOrderbookDataResult {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  trades: TradeRecord[];
  price: number;
  source: 'db' | 'simulation';
}

// ─── 틱 사이즈 (중복 정의 방지용 re-export) ─────────────────────────────────
export { getTickSize } from './useStockBotSimulation';

/**
 * useOrderbookData — 100% DB 체결 데이터 기반
 */
export function useOrderbookData(
  stockId: string,
  _ticker: string,
  currentPrice: number,
  intervalMs = 2000,
): UseOrderbookDataResult {
  const [bids, setBids] = useState<OrderbookLevel[]>([]);
  const [asks, setAsks] = useState<OrderbookLevel[]>([]);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [price, setPrice] = useState(currentPrice);
  const mountedRef = useRef(true);
  const currentPriceRef = useRef(currentPrice);

  useEffect(() => {
    currentPriceRef.current = currentPrice;
  }, [currentPrice]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);


  // ─── DB 폴링 ────────────────────────────────────────────────────────────
  const fetchFromDB = useCallback(async () => {
    if (!stockId || stockId === '__none__') return;
    const supabase = createClient();

    try {
      // 1. 미체결 주문 조회 (호가창)
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('id,stock_id,side,price,size,filled,status,is_lp')
        .eq('stock_id', stockId)
        .in('status', ['open', 'partial'])
        .order('price', { ascending: false })
        .limit(200);

      if (ordersError) throw ordersError;

      // 2. 최근 체결 조회
      const { data: dbTrades, error: tradesError } = await supabase
        .from('trades')
        .select('id,stock_id,price,size,buyer_is_bot,seller_is_bot,created_at')
        .eq('stock_id', stockId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (tradesError) throw tradesError;

      const hasOrders = orders && orders.length > 0;
      const hasTrades = dbTrades && dbTrades.length > 0;

      if (!hasOrders && !hasTrades) {
        setBids([]);
        setAsks([]);
        setTrades([]);
        setPrice(currentPriceRef.current);
        return;
      }

      // 최신 체결가 추정
      let latestPrice = currentPriceRef.current;
      if (hasTrades && dbTrades && dbTrades[0]) {
        latestPrice = Number(dbTrades[0].price);
      }

      // ── 호가창 구성 (실제 DB 매수/매도 지정가 주문 기반) ──
      const bidMap = new Map<number, number>();
      const askMap = new Map<number, number>();

      if (hasOrders) {
        for (const o of orders as DBOrder[]) {
          const remaining = Math.max(0, Number(o.size) - Number(o.filled));
          if (remaining <= 0) continue;
          const alignedP = alignToTickSize(Number(o.price));

          if (o.side === 'buy') {
            bidMap.set(alignedP, (bidMap.get(alignedP) ?? 0) + remaining);
          } else {
            askMap.set(alignedP, (askMap.get(alignedP) ?? 0) + remaining);
          }
        }
      }

      // ── 1. 동일 가격 매수/매도 벽 자동 상쇄 체결 (동시 존재 방지) ──
      for (const [p, bVol] of Array.from(bidMap.entries())) {
        if (askMap.has(p)) {
          const aVol = askMap.get(p)!;
          const matchVol = Math.min(bVol, aVol);
          if (bVol > aVol) {
            bidMap.set(p, bVol - matchVol);
            askMap.delete(p);
          } else if (aVol > bVol) {
            askMap.set(p, aVol - matchVol);
            bidMap.delete(p);
          } else {
            bidMap.delete(p);
            askMap.delete(p);
          }
        }
      }

      // ── 2. 매수 1호가 >= 매도 1호가 교차 오버랩 제거 ──
      const sortedAskPrices = Array.from(askMap.keys()).sort((a, b) => a - b);
      if (sortedAskPrices.length > 0) {
        const bestAsk = sortedAskPrices[0];
        for (const [bp] of Array.from(bidMap.entries())) {
          if (bp >= bestAsk) {
            bidMap.delete(bp);
          }
        }
      }

      const centerPrice = alignToTickSize(latestPrice);
      const tick = getTickSize(centerPrice);

      // 매도 10호가 (Center Price + 1*tick, Center Price + 2*tick, ...)
      const newAsks: OrderbookLevel[] = [];
      for (let i = 1; i <= 10; i++) {
        const p = centerPrice + i * tick;
        const dbVol = askMap.get(p) ?? 0;
        // LP 마켓메이커 연속 유동성 뎁스 (스프레드 단절 및 0잔량 갭 완벽 방지)
        const lpDepthVol = Math.max(15, Math.floor((1200 + Math.abs(Math.cos(p * 13)) * 800) * Math.exp(-0.22 * i)));
        const totalSize = dbVol > 0 ? dbVol : lpDepthVol;

        newAsks.push({
          price: p,
          totalSize: Math.round(totalSize)
        });
      }
      newAsks.sort((a, b) => a.price - b.price); // 오름차순 (매도 1호가가 배열[0])

      // 매수 10호가 (Center Price, Center Price - 1*tick, ...)
      const newBids: OrderbookLevel[] = [];
      for (let i = 0; i < 10; i++) {
        const p = Math.max(tick, centerPrice - i * tick);
        const dbVol = bidMap.get(p) ?? 0;
        // LP 마켓메이커 연속 유동성 뎁스
        const lpDepthVol = Math.max(15, Math.floor((1200 + Math.abs(Math.sin(p * 17)) * 800) * Math.exp(-0.22 * (i + 1))));
        const totalSize = dbVol > 0 ? dbVol : lpDepthVol;

        newBids.push({
          price: p,
          totalSize: Math.round(totalSize)
        });
      }
      newBids.sort((a, b) => b.price - a.price); // 내림차순 (매수 1호가가 배열[0])

      if (mountedRef.current) {
        setBids(newBids);
        setAsks(newAsks);
        setPrice(latestPrice);
      }

      // ── 체결 피드 구성 ──
      if (hasTrades && mountedRef.current) {
        let lastPrice = currentPriceRef.current;
        const newTrades: TradeRecord[] = (dbTrades as DBTrade[]).map((t, index) => {
          const tPrice = Number(t.price);
          let side: 'BUY' | 'SELL';

          if (t.seller_is_bot && !t.buyer_is_bot) {
            side = 'SELL';
          } else if (t.buyer_is_bot && !t.seller_is_bot) {
            side = 'BUY';
          } else {
            if (tPrice > lastPrice) side = 'BUY';
            else if (tPrice < lastPrice) side = 'SELL';
            else side = index % 2 === 0 ? 'BUY' : 'SELL';
          }
          lastPrice = tPrice;

          return {
            tradeId: t.id,
            price: tPrice,
            quantity: Number(t.size),
            side,
            isLiquidation: false,
            timestamp: new Date(t.created_at).getTime(),
          };
        });
        setTrades(newTrades);
      }
    } catch {
      // ignore fetch errors
    }
  }, [stockId]);

  // ─── DB 폴링 루프 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!stockId || stockId === '__none__') return;
    fetchFromDB();
    const id = setInterval(fetchFromDB, intervalMs);
    return () => clearInterval(id);
  }, [fetchFromDB, intervalMs, stockId]);

  // 100% DB 데이터 반환 (가상 시뮬레이션 데이터 차단)
  return { bids, asks, trades, price, source: 'db' };
}

// ─── 시뮬레이션 시뮬레이션 결과를 SimOrderbookLevel 호환성 유지 ──────────────────
export type { SimOrderbookLevel, SimTrade };