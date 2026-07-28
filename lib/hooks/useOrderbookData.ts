'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import {
  useStockBotSimulation,
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
 * useOrderbookData — DB 우선, 시뮬레이션 fallback
 */
export function useOrderbookData(
  stockId: string,
  ticker: string,
  currentPrice: number,
  intervalMs = 800,
): UseOrderbookDataResult {
  // 시뮬레이션 fallback 훅 (항상 호출 — Hooks 규칙)
  const sim = useStockBotSimulation(ticker, currentPrice, intervalMs);

  const [bids, setBids] = useState<OrderbookLevel[]>([]);
  const [asks, setAsks] = useState<OrderbookLevel[]>([]);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [price, setPrice] = useState(currentPrice);
  const [dbHasData, setDbHasData] = useState(false);
  const mountedRef = useRef(true);

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
        setDbHasData(false);
        return;
      }

      // DB에 orders 혹은 trades가 1건이라도 존재하면 100% DB 모드로 작동
      setDbHasData(true);

      // 최신 체결가 추정
      let latestPrice = currentPrice;
      if (hasTrades && dbTrades && dbTrades[0]) {
        latestPrice = Number(dbTrades[0].price);
      }

      // ── 호가창 구성 ──
      const bidMap = new Map<number, number>();
      const askMap = new Map<number, number>();

      if (hasOrders) {
        for (const o of orders as DBOrder[]) {
          const remaining = Math.max(0, o.size - o.filled);
          if (remaining <= 0) continue;

          if (o.side === 'buy') {
            bidMap.set(o.price, (bidMap.get(o.price) ?? 0) + remaining);
          } else {
            askMap.set(o.price, (askMap.get(o.price) ?? 0) + remaining);
          }
        }
      }

      let newBids: OrderbookLevel[] = Array.from(bidMap.entries())
        .map(([price, totalSize]) => ({ price, totalSize: Math.round(totalSize) }))
        .sort((a, b) => b.price - a.price)
        .slice(0, 10);

      let newAsks: OrderbookLevel[] = Array.from(askMap.entries())
        .map(([price, totalSize]) => ({ price, totalSize: Math.round(totalSize) }))
        .sort((a, b) => a.price - b.price)
        .slice(0, 10);

      // 만약 DB orders가 순간적으로 부족할 경우 최신 체결가 기반 결정론적 지수 감쇄 모델로 10호가 구성
      const tick = getTickSize(latestPrice);
      if (newBids.length < 5 || newAsks.length < 5) {
        const basePrice = alignToTickSize(newBids[0]?.price || newAsks[0]?.price || latestPrice);
        if (newAsks.length < 5) {
          for (let i = 1; i <= 10; i++) {
            const p = basePrice + i * tick;
            if (!askMap.has(p)) {
              // 결정론적 수학 호가 수량 (Exponential Depth Decay: BaseVolume * e^(-0.35 * i))
              const baseVol = 800 + (Math.abs(Math.sin(p)) * 600);
              const size = Math.max(10, Math.floor(baseVol * Math.exp(-0.3 * i)));
              newAsks.push({ price: p, totalSize: size });
            }
          }
          newAsks = newAsks.sort((a, b) => a.price - b.price).slice(0, 10);
        }
        if (newBids.length < 5) {
          for (let i = 1; i <= 10; i++) {
            const p = Math.max(tick, basePrice - i * tick);
            if (!bidMap.has(p)) {
              const baseVol = 800 + (Math.abs(Math.cos(p)) * 600);
              const size = Math.max(10, Math.floor(baseVol * Math.exp(-0.3 * i)));
              newBids.push({ price: p, totalSize: size });
            }
          }
          newBids = newBids.sort((a, b) => b.price - a.price).slice(0, 10);
        }
      }

      if (mountedRef.current) {
        setBids(newBids);
        setAsks(newAsks);
        setPrice(latestPrice);
      }

      // ── 체결 피드 구성 ──
      if (hasTrades && mountedRef.current) {
        let lastPrice = currentPrice;
        const newTrades: TradeRecord[] = (dbTrades as DBTrade[]).map((t, index) => {
          const tPrice = Number(t.price);
          let side: 'BUY' | 'SELL';

          if (t.seller_is_bot && !t.buyer_is_bot) {
            side = 'SELL';
          } else if (t.buyer_is_bot && !t.seller_is_bot) {
            side = 'BUY';
          } else {
            // 봇 간 거래 시: 가격 변동 방향 및 인덱스로 매수/매도 구분
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
      // DB 조회 실패 → 시뮬레이션 fallback 유지
      setDbHasData(false);
    }
  }, [stockId]);

  // ─── DB 폴링 루프 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!stockId || stockId === '__none__') return;
    const id = setInterval(fetchFromDB, intervalMs);
    return () => clearInterval(id);
  }, [fetchFromDB, intervalMs, stockId]);

  // ─── DB 데이터가 있으면 DB 데이터 반환, 없으면 시뮬레이션 ──────────────────
  if (dbHasData) {
    return { bids, asks, trades, price, source: 'db' };
  }

  // 시뮬레이션 fallback
  return {
    bids: sim.bids,
    asks: sim.asks,
    trades: sim.trades.map((t: SimTrade) => ({
      tradeId: t.tradeId,
      price: t.price,
      quantity: t.quantity,
      side: t.side,
      isLiquidation: t.isLiquidation,
      timestamp: t.timestamp,
    })),
    price: sim.price,
    source: 'simulation',
  };
}

// ─── 시뮬레이션 시뮬레이션 결과를 SimOrderbookLevel 호환성 유지 ──────────────────
export type { SimOrderbookLevel, SimTrade };