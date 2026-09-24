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
export type OrderbookConnectionState = 'loading' | 'live' | 'stale' | 'error';
export type OrderbookDataQuality = 'authoritative' | 'legacy-fallback';

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

export interface UseOrderbookDataResult {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  trades: TradeRecord[];
  price: number;
  source: 'db' | 'hybrid' | 'simulation';
  connectionState: OrderbookConnectionState;
  dataQuality: OrderbookDataQuality;
}

// ─── 틱 사이즈 (중복 정의 방지용 re-export) ─────────────────────────────────
export { getTickSize } from './useStockBotSimulation';

// 교차 호가 진단 추적 (단발성 시점 차이 경고 방지 및 연속 관측 횟수 추적)
interface CrossedDiagnostics {
  count: number;
  lastWarnedAt: number;
}
const crossedDiagnosticsMap = new Map<string, CrossedDiagnostics>();

function recordAndDiagnoseCrossedBook(
  stockId: string,
  bestBid: number,
  bestAsk: number,
  snapshotTime: number,
  durationMs?: number
) {
  const diag = crossedDiagnosticsMap.get(stockId) ?? { count: 0, lastWarnedAt: 0 };
  diag.count += 1;
  crossedDiagnosticsMap.set(stockId, diag);

  const now = Date.now();
  // 단발성 비동기 시점 차이(T와 T+Δ)로 인한 오판을 방지하고,
  // 3회 이상 연속으로 교차 상태가 지속 관측될 때만 실제 엔진 매칭 지연 상태로 진단하여 경고
  if (diag.count >= 3 && now - diag.lastWarnedAt > 10_000) {
    diag.lastWarnedAt = now;
    console.warn(
      `[OrderbookIntegrity] Sustained crossed book detected\n` +
      `stockId=${stockId}\nbestBid=${bestBid}\nbestAsk=${bestAsk}\n` +
      `consecutiveCount=${diag.count}\nsnapshotTime=${snapshotTime}\nfetchDurationMs=${durationMs ?? 0}`
    );
  }
}

function resetCrossedBookDiagnostics(stockId: string) {
  const diag = crossedDiagnosticsMap.get(stockId);
  if (diag && diag.count > 0) {
    diag.count = 0;
  }
}

/**
 * useOrderbookData — 100% DB 권위 있는 주문 장부 및 체결 데이터 기반 훅
 */
export function useOrderbookData(
  stockId: string,
  _ticker: string,
  currentPrice: number,
  intervalMs = 1000,
  clientOverride?: any,
): UseOrderbookDataResult {
  const [bids, setBids] = useState<OrderbookLevel[]>([]);
  const [asks, setAsks] = useState<OrderbookLevel[]>([]);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [price, setPrice] = useState(currentPrice);
  const [connectionState, setConnectionState] = useState<OrderbookConnectionState>('loading');
  const [dataQuality, setDataQuality] = useState<OrderbookDataQuality>('authoritative');

  const mountedRef = useRef(true);
  const currentPriceRef = useRef(currentPrice);
  const activeStockIdRef = useRef(stockId);
  const prevStockIdRef = useRef(stockId);
  const requestGenerationRef = useRef(0);
  const hasBookDataRef = useRef(false);
  const clientRef = useRef(clientOverride);

  useEffect(() => {
    clientRef.current = clientOverride;
  }, [clientOverride]);

  useEffect(() => {
    currentPriceRef.current = currentPrice;
  }, [currentPrice]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── 종목 변경 시 즉각적인 이전 호가 초기화 ──
  useEffect(() => {
    if (prevStockIdRef.current !== stockId) {
      prevStockIdRef.current = stockId;
      activeStockIdRef.current = stockId;
      requestGenerationRef.current++;
      hasBookDataRef.current = false;

      // 이전 종목 상태를 즉시 클리어하여 화면 잔류 방지
      setBids([]);
      setAsks([]);
      setTrades([]);
      setPrice(currentPrice);
      setConnectionState('loading');
      setDataQuality('authoritative');
    }
  }, [stockId, currentPrice]);

  // ─── DB 폴링 및 권위 있는 호가 집계 ────────────────────────────────────
  const fetchFromDB = useCallback(async (targetStockId: string, generation: number) => {
    if (!targetStockId || targetStockId === '__none__') return;
    const db = clientRef.current || createClient();

    try {
      // 1. 단일 스냅샷 기반의 서버 권위 호가 집계 RPC 호출 (100% 완전 잔량 합산 및 매수/매도 시점 일치 보장)
      const rpcRes = await db.rpc('get_authoritative_orderbook', {
        p_stock_id: targetStockId,
        p_depth: 10,
      });

      if (
        !mountedRef.current ||
        generation !== requestGenerationRef.current ||
        activeStockIdRef.current !== targetStockId
      ) {
        return;
      }

      if (!rpcRes.error && rpcRes.data && Array.isArray(rpcRes.data.bids) && Array.isArray(rpcRes.data.asks)) {
        const data = rpcRes.data;
        const newBids: OrderbookLevel[] = data.bids;
        const newAsks: OrderbookLevel[] = data.asks;
        const dbTrades: DBTrade[] = data.trades || [];

        // 최신 체결가
        let latestPrice = currentPriceRef.current;
        if (dbTrades.length > 0 && dbTrades[0]) {
          latestPrice = Number(dbTrades[0].price);
        }

        // 교차 호가 진단 (단일 스냅샷 기반: Local Standalone에서는 동기식 집계 스냅샷, 외부 DB에서는 단일 SQL 스냅샷)
        const bestAsk = newAsks[0]?.price;
        const bestBid = newBids[0]?.price;
        if (bestBid !== undefined && bestAsk !== undefined && bestBid >= bestAsk) {
          recordAndDiagnoseCrossedBook(targetStockId, bestBid, bestAsk, data.timestamp, data.fetchDurationMs);
        } else {
          resetCrossedBookDiagnostics(targetStockId);
        }

        // 체결 피드 생성
        let lastPrice = currentPriceRef.current;
        const newTrades: TradeRecord[] = dbTrades.map((t, index) => {
          const tPrice = Number(t.price);
          let side: 'BUY' | 'SELL';
          if (t.seller_is_bot && !t.buyer_is_bot) side = 'SELL';
          else if (t.buyer_is_bot && !t.seller_is_bot) side = 'BUY';
          else {
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

        setBids(newBids);
        setAsks(newAsks);
        setTrades(newTrades);
        setPrice(latestPrice > 0 ? latestPrice : currentPriceRef.current);
        setConnectionState('live');
        setDataQuality('authoritative');
        hasBookDataRef.current = newBids.length > 0 || newAsks.length > 0;
        return;
      }

      // RPC 에러가 치명적인 DB 오류/네트워크 단절인 경우 빈 호가창으로 오인하지 않고 에러 상태로 처리
      // 문자열 검색 대신 PostgREST 구조화된 에러 코드(PGRST202, 42883) 우선 사용
      if (rpcRes.error) {
        const code = (rpcRes.error as any).code;
        const errMsg = String(rpcRes.error.message || rpcRes.error);
        const isRpcNotFound = code === 'PGRST202' || code === '42883' || errMsg.includes('PGRST202');
        if (!isRpcNotFound) {
          throw rpcRes.error;
        }
        console.warn(`[useOrderbookData] Authoritative RPC not installed (${code}). Falling back to legacy 200-limit queries.`);
        setDataQuality('legacy-fallback');
      }

      // ── Fallback: RPC를 지원하지 않는 레거시 환경 전용 분리 쿼리 수행 ──
      // 주의: Local Standalone 단일 프로세스에서는 동기식 집계를 통해 동일 읽기 구간의 스냅샷을 보장합니다.
      // 외부 DB 모드에서는 docs/sql/02_get_authoritative_orderbook.sql 단일 SQL statement 또는 읽기 트랜잭션이 필수입니다.
      const fetchAsks = () =>
        db
          .from('orders')
          .select('id,stock_id,side,price,size,filled,status,is_lp')
          .eq('stock_id', targetStockId)
          .eq('side', 'sell')
          .in('status', ['open', 'partial'])
          .order('price', { ascending: true })
          .limit(200);

      const fetchBids = () =>
        db
          .from('orders')
          .select('id,stock_id,side,price,size,filled,status,is_lp')
          .eq('stock_id', targetStockId)
          .eq('side', 'buy')
          .in('status', ['open', 'partial'])
          .order('price', { ascending: false })
          .limit(200);

      const fetchTrades = () =>
        db
          .from('trades')
          .select('id,stock_id,price,size,buyer_is_bot,seller_is_bot,created_at')
          .eq('stock_id', targetStockId)
          .order('created_at', { ascending: false })
          .limit(50);

      const [asksResult, bidsResult, tradesResult] = await Promise.all([
        fetchAsks(),
        fetchBids(),
        fetchTrades(),
      ]);

      if (asksResult.error) throw asksResult.error;
      if (bidsResult.error) throw bidsResult.error;
      if (tradesResult.error) throw tradesResult.error;

      // 비동기 응답 역전 및 언마운트/종목 변경 방어 검증
      if (
        !mountedRef.current ||
        generation !== requestGenerationRef.current ||
        activeStockIdRef.current !== targetStockId
      ) {
        return;
      }

      const rawAsks = (asksResult.data as DBOrder[]) || [];
      const rawBids = (bidsResult.data as DBOrder[]) || [];
      const dbTrades = (tradesResult.data as DBTrade[]) || [];

      // 최신 체결가
      let latestPrice = currentPriceRef.current;
      if (dbTrades.length > 0 && dbTrades[0]) {
        latestPrice = Number(dbTrades[0].price);
      }

      // ── 호가 집계: 동일 가격·동일 방향 주문 잔량 합산 (반대 방향 임의 상쇄 완전 금지) ──
      const askMap = new Map<number, number>();
      for (const o of rawAsks) {
        const remaining = Math.max(0, Number(o.size) - Number(o.filled));
        const price = Number(o.price);
        if (
          (o.status === 'open' || o.status === 'partial') &&
          Number.isFinite(price) &&
          price > 0 &&
          Number.isFinite(remaining) &&
          remaining > 0
        ) {
          const alignedP = alignToTickSize(price);
          askMap.set(alignedP, (askMap.get(alignedP) ?? 0) + remaining);
        }
      }

      const bidMap = new Map<number, number>();
      for (const o of rawBids) {
        const remaining = Math.max(0, Number(o.size) - Number(o.filled));
        const price = Number(o.price);
        if (
          (o.status === 'open' || o.status === 'partial') &&
          Number.isFinite(price) &&
          price > 0 &&
          Number.isFinite(remaining) &&
          remaining > 0
        ) {
          const alignedP = alignToTickSize(price);
          bidMap.set(alignedP, (bidMap.get(alignedP) ?? 0) + remaining);
        }
      }

      // ── 반올림 후 0수량 재검증 및 유효 호가 생성 ──
      const newAsks: OrderbookLevel[] = [];
      for (const [p, dbVol] of askMap.entries()) {
        const roundedSize = Math.round(dbVol);
        if (Number.isFinite(p) && p > 0 && Number.isFinite(roundedSize) && roundedSize > 0) {
          newAsks.push({
            price: p,
            totalSize: roundedSize,
            isSynthetic: false,
            actualDbSize: dbVol,
          });
        }
      }
      newAsks.sort((a, b) => a.price - b.price); // 매도 오름차순 (최우선 매도호가가 앞쪽)

      const newBids: OrderbookLevel[] = [];
      for (const [p, dbVol] of bidMap.entries()) {
        const roundedSize = Math.round(dbVol);
        if (Number.isFinite(p) && p > 0 && Number.isFinite(roundedSize) && roundedSize > 0) {
          newBids.push({
            price: p,
            totalSize: roundedSize,
            isSynthetic: false,
            actualDbSize: dbVol,
          });
        }
      }
      newBids.sort((a, b) => b.price - a.price); // 매수 내림차순 (최우선 매수호가가 앞쪽)

      // ── 교차 호가 감지 (진단 경고 및 연속 횟수 추적) ──
      const bestAsk = newAsks[0]?.price;
      const bestBid = newBids[0]?.price;
      if (bestBid !== undefined && bestAsk !== undefined && bestBid >= bestAsk) {
        recordAndDiagnoseCrossedBook(targetStockId, bestBid, bestAsk, Date.now());
      } else {
        resetCrossedBookDiagnostics(targetStockId);
      }

      // ── 체결 피드 구성 (100% DB trades 테이블 데이터) ──
      let lastPrice = currentPriceRef.current;
      const newTrades: TradeRecord[] = dbTrades.map((t, index) => {
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

      if (
        mountedRef.current &&
        generation === requestGenerationRef.current &&
        activeStockIdRef.current === targetStockId
      ) {
        setBids(newBids);
        setAsks(newAsks);
        setTrades(newTrades);
        setPrice(latestPrice > 0 ? latestPrice : currentPriceRef.current);
        setConnectionState('live');
        setDataQuality('legacy-fallback');
        hasBookDataRef.current = newBids.length > 0 || newAsks.length > 0;
      }
    } catch (err) {
      if (
        !mountedRef.current ||
        generation !== requestGenerationRef.current ||
        activeStockIdRef.current !== targetStockId
      ) {
        return;
      }
      console.warn(`[useOrderbookData] DB fetch error for stock ${targetStockId}:`, (err as any)?.message || err);
      setConnectionState(hasBookDataRef.current ? 'stale' : 'error');
    }
  }, []);

  // ─── 완료 기반 재귀 폴링 루프 (요청 중첩 및 경합 방지) ──────────────────
  useEffect(() => {
    if (!stockId || stockId === '__none__') return;
    activeStockIdRef.current = stockId;

    let timeoutId: NodeJS.Timeout | null = null;
    let isCancelled = false;

    const poll = async () => {
      const generation = ++requestGenerationRef.current;
      try {
        await fetchFromDB(stockId, generation);
      } finally {
        if (!isCancelled && mountedRef.current && activeStockIdRef.current === stockId) {
          timeoutId = setTimeout(poll, intervalMs);
        }
      }
    };

    poll();

    return () => {
      isCancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
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

  return { bids, asks, trades, price, source, connectionState, dataQuality };
}

// ─── 시뮬레이션 결과를 SimOrderbookLevel 호환성 유지 ──────────────────
export type { SimOrderbookLevel, SimTrade };