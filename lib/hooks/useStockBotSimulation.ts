'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

// ─── 타입 정의 ────────────────────────────────────────────────────────────────
export interface SimOrderbookLevel {
  price: number;
  totalSize: number;
}

export interface SimTrade {
  tradeId: string;
  price: number;
  quantity: number;
  side: 'BUY' | 'SELL';
  isLiquidation: boolean;
  timestamp: number;
}

// ─── 틱 사이즈 ───────────────────────────────────────────────────────────────
export function getTickSize(price: number): number {
  if (price < 2000) return 1;
  if (price < 5000) return 5;
  if (price < 20000) return 10;
  if (price < 50000) return 50;
  if (price < 200000) return 100;
  if (price < 500000) return 500;
  return 1000;
}

export function alignToTickSize(price: number): number {
  if (price <= 0) return 1;
  const tick = getTickSize(price);
  return Math.round(price / tick) * tick;
}

// ─── 결정론적 의사 난수 생성기 (Deterministic Seeded PRNG) ──────────────────
function deterministicPRNG(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// ─── 정규분포 수량 계산 (결정론적 산출) ─────────────────────────────────
function deterministicQty(seed: number): number {
  const r = deterministicPRNG(seed);
  return Math.max(5, Math.floor(20 + r * 150));
}

// ─── 난수 기반 시뮬레이션 상태 ────────────────────────────────────────────────
interface EngineState {
  midPrice: number;           // 현재 스프레드 중간가
  bids: SimOrderbookLevel[];  // 매수 호가 (가격 내림차순)
  asks: SimOrderbookLevel[];  // 매도 호가 (가격 오름차순)
  momentum: number;           // -1 ~ +1 주문 흐름 모멘텀 (연속적 추세)
  tickCount: number;
}

/**
 * 초기 호가창 생성 — 스프레드 근처에 잔량 집중, 외곽은 결정론적 지수 감쇄
 */
function buildLevels(mid: number): { bids: SimOrderbookLevel[]; asks: SimOrderbookLevel[] } {
  const tick = getTickSize(mid);
  const bids: SimOrderbookLevel[] = [];
  const asks: SimOrderbookLevel[] = [];

  for (let i = 0; i < 10; i++) {
    const depthFactor = Math.exp(-i * 0.35);
    const bidBase = 1200 + (Math.abs(Math.sin(mid - (i + 1) * tick)) * 500);
    const askBase = 1200 + (Math.abs(Math.cos(mid + (i + 1) * tick)) * 500);
    
    bids.push({
      price: mid - (i + 1) * tick,
      totalSize: Math.max(20, Math.round(bidBase * depthFactor)),
    });
    asks.push({
      price: mid + (i + 1) * tick,
      totalSize: Math.max(20, Math.round(askBase * depthFactor)),
    });
  }
  return { bids, asks };
}

/**
 * 클라이언트 봇 시뮬레이션 훅 — 결정론적 매칭 엔진
 */
export function useStockBotSimulation(
  ticker: string,
  currentPrice: number,
  intervalMs = 600
) {
  const engineRef = useRef<EngineState | null>(null);
  const prevTickerRef = useRef('');

  const [bids, setBids] = useState<SimOrderbookLevel[]>([]);
  const [asks, setAsks] = useState<SimOrderbookLevel[]>([]);
  const [trades, setTrades] = useState<SimTrade[]>([]);
  const [price, setPrice] = useState(currentPrice);

  // ─── 종목 변경 / 최초 초기화 ─────────────────────────────────────────────
  useEffect(() => {
    if (ticker !== prevTickerRef.current || !engineRef.current) {
      const { bids: b, asks: a } = buildLevels(currentPrice);
      engineRef.current = {
        midPrice: currentPrice,
        bids: b,
        asks: a,
        momentum: 0,
        tickCount: 0,
      };
      const tickerChanged = ticker !== prevTickerRef.current;
      prevTickerRef.current = ticker;
      setBids(b);
      setAsks(a);
      setPrice(currentPrice);
      if (tickerChanged) setTrades([]);
    }
  }, [ticker, currentPrice]);

  // ─── 매 틱 실행 (결정론적 삼각함수 파동 모델) ──────────────────────────────────
  const runTick = useCallback(() => {
    const eng = engineRef.current;
    if (!eng || ticker === '__none__') return;

    const tick = getTickSize(eng.midPrice);
    const newTrades: SimTrade[] = [];
    eng.tickCount++;

    // ── 1. 삼각함도 파동 결정론적 모멘텀 ──
    void deterministicPRNG;  // PRNG helpers (side-effect-free deterministic shift if needed externally)
    const wave = Math.sin(eng.tickCount * 0.1) * 0.5 + Math.cos(eng.tickCount * 0.05) * 0.3;
    eng.momentum = eng.momentum * 0.85 + wave * 0.15;

    // ── 2. 체결 건수 산정 ──
    const activity = 1 + Math.abs(eng.momentum) * 2;
    const numTrades = Math.min(3, Math.floor(activity));

    // ── 3. 결정론적 체결 ──
    for (let i = 0; i < numTrades; i++) {
      const subPrng = deterministicPRNG(eng.tickCount * 10 + i);
      const isBuy = subPrng < (0.5 + eng.momentum * 0.3);

      if (isBuy) {
        const bestAsk = eng.asks[0];
        if (!bestAsk || bestAsk.totalSize <= 0) break;

        const qty = Math.min(deterministicQty(eng.tickCount + i), bestAsk.totalSize);
        bestAsk.totalSize -= qty;

        newTrades.push({
          tradeId: `SIM-${eng.tickCount}-${i}`,
          price: bestAsk.price,
          quantity: qty,
          side: 'BUY',
          isLiquidation: false,
          timestamp: Date.now(),
        });

        if (bestAsk.totalSize <= 0) {
          eng.asks.shift();
          const topAsk = eng.asks[eng.asks.length - 1];
          const newSize = Math.max(30, Math.round(200 + Math.abs(Math.sin(topAsk.price + tick)) * 400));
          eng.asks.push({
            price: topAsk.price + tick,
            totalSize: newSize,
          });
          if (eng.asks.length > 0) {
            eng.midPrice = eng.asks[0].price - tick * 0.5;
          }
        }
      } else {
        const bestBid = eng.bids[0];
        if (!bestBid || bestBid.totalSize <= 0) break;

        const qty = Math.min(deterministicQty(eng.tickCount + i + 50), bestBid.totalSize);
        bestBid.totalSize -= qty;

        newTrades.push({
          tradeId: `SIM-${eng.tickCount}-${i}`,
          price: bestBid.price,
          quantity: qty,
          side: 'SELL',
          isLiquidation: false,
          timestamp: Date.now(),
        });

        if (bestBid.totalSize <= 0) {
          eng.bids.shift();
          const bottomBid = eng.bids[eng.bids.length - 1];
          const newSize = Math.max(30, Math.round(200 + Math.abs(Math.cos(bottomBid.price - tick)) * 400));
          eng.bids.push({
            price: bottomBid.price - tick,
            totalSize: newSize,
          });
          if (eng.bids.length > 0) {
            eng.midPrice = eng.bids[0].price + tick * 0.5;
          }
        }
      }
    }

    // ── 4. 신규 지정가 주문 유입 (결정론적 소량 리필) ──
    for (let i = 0; i < 3; i++) {
      const maxBidRefill = Math.round(1500 * Math.exp(-i * 0.35)) + 120;
      if (eng.bids[i]) {
        const addSize = Math.floor(10 * Math.abs(Math.sin(eng.tickCount + i)));
        eng.bids[i].totalSize = Math.min(eng.bids[i].totalSize + addSize, maxBidRefill);
      }
      if (eng.asks[i]) {
        const addSize = Math.floor(10 * Math.abs(Math.cos(eng.tickCount + i)));
        eng.asks[i].totalSize = Math.min(eng.asks[i].totalSize + addSize, maxBidRefill);
      }
    }

    // ── 5. 가격 갱신 (체결 결과로만 변동) ──
    // 현재가 = 최우선 매수/매도호가의 중간값
    if (eng.bids.length > 0 && eng.asks.length > 0) {
      const spreadMid = (eng.bids[0].price + eng.asks[0].price) / 2;
      // 한 틱 단위로 반올림
      const tickSize = getTickSize(spreadMid);
      eng.midPrice = Math.round(spreadMid / tickSize) * tickSize;
    }

    // ── 6. React state 반영 ──
    setBids([...eng.bids]);
    setAsks([...eng.asks]);
    setPrice(eng.midPrice);
    if (newTrades.length > 0) {
      setTrades(prev => [...newTrades, ...prev].slice(0, 50));
    }
  }, [ticker]);

  // ─── 봇 루프 ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (ticker === '__none__') return;
    const id = setInterval(runTick, intervalMs);
    return () => clearInterval(id);
  }, [runTick, intervalMs, ticker]);

  return { bids, asks, trades, price };
}
