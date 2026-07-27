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

// ─── 로그정규분포 체결 수량 (대부분 소량, 가끔 대량) ─────────────────────────
function randomQty(): number {
  // 로그정규분포 근사: 대부분 5~60주, 가끔 수백~수천주
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const lognormal = Math.exp(1.6 + z * 0.85);
  return Math.max(1, Math.round(lognormal));
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
 * 초기 호가창 생성 — 스프레드 근처에 잔량 집중, 외곽은 얇게
 */
function buildLevels(mid: number): { bids: SimOrderbookLevel[]; asks: SimOrderbookLevel[] } {
  const tick = getTickSize(mid);
  const bids: SimOrderbookLevel[] = [];
  const asks: SimOrderbookLevel[] = [];

  for (let i = 0; i < 10; i++) {
    // 지수 감쇄: 1호가에 최대, 10호가로 갈수록 감소 (실제 HTS와 동일)
    const depthFactor = Math.exp(-i * 0.42);
    bids.push({
      price: mid - (i + 1) * tick,
      totalSize: Math.round((700 + Math.random() * 1600) * depthFactor) + 80,
    });
    asks.push({
      price: mid + (i + 1) * tick,
      totalSize: Math.round((700 + Math.random() * 1600) * depthFactor) + 80,
    });
  }
  return { bids, asks };
}

/**
 * 클라이언트 봇 시뮬레이션 훅 — 실제 매칭 엔진처럼 동작하는 호가창
 *
 * 핵심 원칙:
 * 1. 체결은 최우선 호가(스프레드 경계)에서만 발생
 * 2. 호가가 소진되면 가격이 한 틱 이동하고 호가창이 시프트
 * 3. 잔량은 체결 차감 + 스프레드 근처 소량 리필로만 변동 (외곽 고정)
 * 4. 주문 흐름에 모멘텀(추세)을 부여하여 가격이 연속적으로 움직임
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

  // ─── 매 틱 실행 ──────────────────────────────────────────────────────────
  const runTick = useCallback(() => {
    const eng = engineRef.current;
    if (!eng || ticker === '__none__') return;

    const tick = getTickSize(eng.midPrice);
    const newTrades: SimTrade[] = [];
    eng.tickCount++;

    // ── 1. 모멘텀 업데이트 (EWMA + 노이즈 + 가끔 강한 추세) ──
    const noise = (Math.random() - 0.5) * 0.22;
    eng.momentum = eng.momentum * 0.93 + noise;
    // 2% 확률로 강한 추세 임펄스 (뉴스 없이도 움직이는 시장)
    if (Math.random() < 0.02) {
      eng.momentum += (Math.random() > 0.5 ? 1 : -1) * (0.25 + Math.random() * 0.35);
      eng.momentum = Math.max(-1, Math.min(1, eng.momentum));
    }

    // ── 2. 이번 틱 체결 건수 결정 (활동성 = 1~4건, 모멘텀 강할수록 많음) ──
    const activity = 1 + Math.abs(eng.momentum) * 2.5 + Math.random() * 1.2;
    const numTrades = Math.min(5, Math.floor(activity));

    // ── 3. 체결 엔진 ──────────────────────────────────────────
    for (let i = 0; i < numTrades; i++) {
      // 체결 방향: 모멘텀 기반 확률 (모멘텀 > 0이면 매수 우세)
      const buyProb = 0.5 + eng.momentum * 0.38;
      const isBuy = Math.random() < buyProb;

      if (isBuy) {
        // ─── 매수 체결: 최우선 매도호가 소진 ───
        const bestAsk = eng.asks[0];
        if (!bestAsk || bestAsk.totalSize <= 0) break;

        const qty = Math.min(randomQty(), bestAsk.totalSize);
        bestAsk.totalSize -= qty;

        newTrades.push({
          tradeId: `SIM-${eng.tickCount}-${i}-${Date.now() % 10000}`,
          price: bestAsk.price,
          quantity: qty,
          side: 'BUY',
          isLiquidation: Math.random() < 0.02,
          timestamp: Date.now(),
        });

        // 최우선 매도호가 완전 소진 → 가격 상승, 호가창 위로 시프트
        if (bestAsk.totalSize <= 0) {
          eng.asks.shift();
          // 새 매도 외곽 추가 (상단)
          const topAsk = eng.asks[eng.asks.length - 1];
          eng.asks.push({
            price: topAsk.price + tick,
            totalSize: Math.round(80 + Math.random() * 250),
          });
          // 매수 쪽은 그대로 유지 (가격이 올라간 만큼 아래 매수는 상대적으로 더 아래가 됨)
          // midPrice를 새 최우선 매도호가 기준으로 재설정
          if (eng.asks.length > 0) {
            eng.midPrice = eng.asks[0].price - tick * 0.5;
          }
        }
      } else {
        // ─── 매도 체결: 최우선 매수호가 소진 ───
        const bestBid = eng.bids[0];
        if (!bestBid || bestBid.totalSize <= 0) break;

        const qty = Math.min(randomQty(), bestBid.totalSize);
        bestBid.totalSize -= qty;

        newTrades.push({
          tradeId: `SIM-${eng.tickCount}-${i}-${Date.now() % 10000}`,
          price: bestBid.price,
          quantity: qty,
          side: 'SELL',
          isLiquidation: Math.random() < 0.02,
          timestamp: Date.now(),
        });

        // 최우선 매수호가 완전 소진 → 가격 하락, 호가창 아래로 시프트
        if (bestBid.totalSize <= 0) {
          eng.bids.shift();
          // 새 매수 외곽 추가 (하단)
          const bottomBid = eng.bids[eng.bids.length - 1];
          eng.bids.push({
            price: bottomBid.price - tick,
            totalSize: Math.round(80 + Math.random() * 250),
          });
          if (eng.bids.length > 0) {
            eng.midPrice = eng.bids[0].price + tick * 0.5;
          }
        }
      }
    }

    // ── 4. 신규 지정가 주문 유입 (최우선 3호가까지만, 소량 리필) ──
    // 외곽 호가는 거의 고정 → 호가창이 안정적으로 보임
    for (let i = 0; i < 3; i++) {
      const maxBidRefill = Math.round((700 + 1600) * Math.exp(-i * 0.42)) + 120;
      const maxAskRefill = maxBidRefill;
      if (eng.bids[i] && Math.random() < 0.45) {
        eng.bids[i].totalSize = Math.min(
          eng.bids[i].totalSize + Math.round(Math.random() * 40),
          maxBidRefill
        );
      }
      if (eng.asks[i] && Math.random() < 0.45) {
        eng.asks[i].totalSize = Math.min(
          eng.asks[i].totalSize + Math.round(Math.random() * 40),
          maxAskRefill
        );
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
