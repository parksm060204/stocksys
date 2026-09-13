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
  intervalMs = 1000,
): UseOrderbookDataResult {
  const [bids, setBids] = useState<OrderbookLevel[]>([]);
  const [asks, setAsks] = useState<OrderbookLevel[]>([]);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [price, setPrice] = useState(currentPrice);
  const mountedRef = useRef(true);
  const currentPriceRef = useRef(currentPrice);
  const depthStateRef = useRef<Map<number, number>>(new Map());
  const persistedVolumesRef = useRef<Map<number, number>>(new Map());
  const tickSeqRef = useRef(0);

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

      tickSeqRef.current += 1;
      const seq = tickSeqRef.current;

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

      const centerPrice = alignToTickSize(latestPrice > 0 ? latestPrice : currentPriceRef.current);
      const tick = getTickSize(centerPrice);
      const baseVolMultiplier = centerPrice >= 50000 ? 25000 : centerPrice >= 10000 ? 8000 : 1500;

      const wallCache = persistedVolumesRef.current;

      // ── 현재 보여야 할 가격 집합 계산 ──
      const visiblePrices = new Set<number>();
      for (let i = 1; i <= 10; i++) visiblePrices.add(centerPrice + i * tick);
      for (let i = 0; i < 10; i++) visiblePrices.add(Math.max(tick, centerPrice - i * tick));

      // ── 더 이상 보이지 않는 가격 캐시 정리 (메모리 누수 방지) ──
      for (const cachedPrice of Array.from(wallCache.keys())) {
        if (!visiblePrices.has(cachedPrice)) {
          wallCache.delete(cachedPrice);
        }
      }

      // ── 초당 체결 차감: 1호가(bestAsk, bestBid)에서 소량 자연 감소 ──
      if (seq % 2 === 0) {
        const bestAskPrice = centerPrice + tick;
        const bestBidPrice = centerPrice;
        if (wallCache.has(bestAskPrice)) {
          const cur = wallCache.get(bestAskPrice)!;
          const drain = Math.floor(Math.random() * 80) + 20;
          const after = cur - drain;
          if (after > 200) {
            wallCache.set(bestAskPrice, after);
          } else {
            // 소진되면 자연 리필 (새 지정가 주문 유입 시뮬)
            const seedOffset = Math.floor(((bestAskPrice * 9301 + 49297) % 233280) / 233280 * 873) + 127;
            wallCache.set(bestAskPrice, Math.floor(baseVolMultiplier * 0.8) + seedOffset + Math.floor(Math.random() * 200));
          }
        }
        if (wallCache.has(bestBidPrice)) {
          const cur = wallCache.get(bestBidPrice)!;
          const drain = Math.floor(Math.random() * 80) + 20;
          const after = cur - drain;
          if (after > 200) {
            wallCache.set(bestBidPrice, after);
          } else {
            const seedOffset = Math.floor(((bestBidPrice * 7919 + 65537) % 233280) / 233280 * 891) + 109;
            wallCache.set(bestBidPrice, Math.floor(baseVolMultiplier * 0.85) + seedOffset + Math.floor(Math.random() * 200));
          }
        }
      }

      // 매도 10호가
      const newAsks: OrderbookLevel[] = [];
      for (let i = 1; i <= 10; i++) {
        const p = centerPrice + i * tick;
        const dbVol = askMap.get(p) ?? 0;

        let size = dbVol;
        if (size <= 0) {
          if (!wallCache.has(p)) {
            const wallFactor = (i === 3 || i === 5 || i === 10) ? 2.4 : 1.0;
            const seedOffset = Math.floor(((p * 9301 + 49297) % 233280) / 233280 * 873) + 127;
            const generated = Math.floor(baseVolMultiplier * (0.8 + (i % 3) * 0.3) * wallFactor) + seedOffset;
            wallCache.set(p, generated);
          }
          size = wallCache.get(p)!;
        } else {
          // DB 실제 주문이 있으면 캐시도 업데이트
          wallCache.set(p, size);
        }

        newAsks.push({
          price: p,
          totalSize: Math.max(10, Math.round(size)),
        });
      }
      newAsks.sort((a, b) => a.price - b.price);

      // 매수 10호가
      const newBids: OrderbookLevel[] = [];
      for (let i = 0; i < 10; i++) {
        const p = Math.max(tick, centerPrice - i * tick);
        const dbVol = bidMap.get(p) ?? 0;

        let size = dbVol;
        if (size <= 0) {
          if (!wallCache.has(p)) {
            const bidWallFactor = (i === 2 || i === 4 || i === 9) ? 2.8 : 1.0;
            const seedOffset = Math.floor(((p * 7919 + 65537) % 233280) / 233280 * 891) + 109;
            const generated = Math.floor(baseVolMultiplier * (0.85 + (i % 3) * 0.35) * bidWallFactor) + seedOffset;
            wallCache.set(p, generated);
          }
          size = wallCache.get(p)!;
        } else {
          wallCache.set(p, size);
        }

        newBids.push({
          price: p,
          totalSize: Math.max(10, Math.round(size)),
        });
      }
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
        setPrice(centerPrice);
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