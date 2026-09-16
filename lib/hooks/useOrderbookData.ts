'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  getTickSize,
  alignToTickSize,
  type SimOrderbookLevel,
  type SimTrade,
} from './useStockBotSimulation';

import { createClient } from '@/lib/db/client';
import { filterValidOrderbookLevels } from '@/lib/utils/orderbookSelector';

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
  isSynthetic?: boolean;
  actualDbSize?: number;
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
  source: 'db' | 'hybrid' | 'simulation';
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
  intervalMs = 1000,
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

  // ─── DB 폴링 및 실시간 동적 호가 매칭 ────────────────────────────────────
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

      // ── 3. 실제 유효 주문이 존재하는 가격 행만 추출 (0 수량 및 인위적 빈 간격 생성 금지) ──
      const newAsks: OrderbookLevel[] = [];
      for (const [p, dbVol] of askMap.entries()) {
        if (Number.isFinite(p) && p > 0 && Number.isFinite(dbVol) && dbVol > 0) {
          newAsks.push({
            price: p,
            totalSize: Math.round(dbVol),
            isSynthetic: false,
            actualDbSize: dbVol,
          });
        }
      }
      // 매도 호가: 가격 오름차순 (최우선 매도호가가 앞쪽)
      newAsks.sort((a, b) => a.price - b.price);

      const newBids: OrderbookLevel[] = [];
      for (const [p, dbVol] of bidMap.entries()) {
        if (Number.isFinite(p) && p > 0 && Number.isFinite(dbVol) && dbVol > 0) {
          newBids.push({
            price: p,
            totalSize: Math.round(dbVol),
            isSynthetic: false,
            actualDbSize: dbVol,
          });
        }
      }
      // 매수 호가: 가격 내림차순 (최우선 매수호가가 앞쪽)
      newBids.sort((a, b) => b.price - a.price);

      // ── 체결 피드 구성 (100% DB trades 테이블 데이터) ──
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

      if (mountedRef.current) {
        setBids(newBids);
        setAsks(newAsks);
        setPrice(latestPrice > 0 ? latestPrice : currentPriceRef.current);
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

  // 실제 DB 호가와 합성(Synthetic) 호가 비중에 따른 투명한 source 산출
  const totalLevels = bids.length + asks.length;
  const syntheticCount = [...bids, ...asks].filter((l) => l.isSynthetic).length;
  const source: 'db' | 'hybrid' | 'simulation' =
    totalLevels === 0
      ? 'db'
      : syntheticCount === 0
      ? 'db'
      : syntheticCount === totalLevels
      ? 'simulation'
      : 'hybrid';

  return { bids, asks, trades, price, source };
}

// ─── 시뮬레이션 시뮬레이션 결과를 SimOrderbookLevel 호환성 유지 ──────────────────
export type { SimOrderbookLevel, SimTrade };