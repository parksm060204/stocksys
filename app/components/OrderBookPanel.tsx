"use client";

import { useEffect, useRef, useState, memo } from "react";
import type { Stock } from "@/lib/types";
import { getMarketData } from "@/lib/mock-data";
import { getTickSize, snapToTick } from "@/lib/lp/engine";
import { fmtPrice } from "@/lib/format";
import { calcYTM } from "@/lib/bond-utils";

// ─────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────
interface BookLevel {
  price: number;
  size: number;
  isWall: boolean; // 기관 매물대 여부
  delta?: number;  // 증감분 표시용
}

interface BookState {
  asks: BookLevel[]; // index 0 = 최우선 매도호가 (현재가에 가장 가까운)
  bids: BookLevel[]; // index 0 = 최우선 매수호가
  basePrice: number; // 이 배열이 기준으로 삼는 현재가
}

type Flash = { size: number; side: "buy" | "sell"; ts: number; price: number };

const LEVELS = 10;
const UPDATE_INTERVAL = 300; // ms — 300ms마다 잔량만 증감

// ─────────────────────────────────────────────
// 초기 호가창 배열 생성 (서버 엔진 데이터 기반)
// ─────────────────────────────────────────────
function buildBookFromEngine(basePrice: number, stock: Stock, engineOb: { asks: any[], bids: any[] }): BookState {
  const market = stock.market;
  const tick = getTickSize(basePrice, market);
  const snapped = snapToTick(basePrice, tick);

  let upperLimit = Infinity;
  let lowerLimit = 0;
  if (market === "domestic") {
    upperLimit = snapToTick(stock.previousClose * 1.30, tick);
    lowerLimit = snapToTick(stock.previousClose * 0.70, tick);
  }

  const asks: BookLevel[] = [];
  for (let i = 0; i < LEVELS; i++) {
    const p = +(snapped + tick * (i + 1)).toFixed(2);
    if (p > upperLimit) break;
    const engineLevel = engineOb.asks.find((l: any) => l.price === p);
    asks.push({ price: p, size: engineLevel ? engineLevel.size : 0, isWall: false });
  }

  const bids: BookLevel[] = [];
  for (let i = 0; i < LEVELS; i++) {
    const p = +(snapped - tick * (i + 1)).toFixed(2);
    if (p < lowerLimit) break;
    const engineLevel = engineOb.bids.find((l: any) => l.price === p);
    bids.push({ price: p, size: engineLevel ? engineLevel.size : 0, isWall: false });
  }

  return { asks, bids, basePrice: snapped };
}

// ─────────────────────────────────────────────
// 엔진 실제 잔량을 기반으로 UI 갱신 (스프레드는 민감하게, 외곽은 둔감하게)
// ─────────────────────────────────────────────
function applyDelta(prev: BookState, engineSizes: { askSizes: number[]; bidSizes: number[] }): BookState {
  const updatedAsks = prev.asks.map((level, i) => {
    const targetSize = engineSizes.askSizes[i] ?? level.size;
    let delta = targetSize - level.size;
    return { ...level, size: level.size + delta, delta };
  });

  const updatedBids = prev.bids.map((level, i) => {
    const targetSize = engineSizes.bidSizes[i] ?? level.size;
    let delta = targetSize - level.size;
    return { ...level, size: level.size + delta, delta };
  });

  return { ...prev, asks: updatedAsks, bids: updatedBids };
}

// ─────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────
export default function OrderBookPanel({ stock }: { stock: Stock }) {
  const [book, setBook] = useState<BookState | null>(null);
  
  // 체결 플래시(리스트) 및 체결 강도 상태
  const [recentTrades, setRecentTrades] = useState<Flash[]>([]);
  const [tradeStats, setTradeStats] = useState({ buyVol: 0, sellVol: 0, strength: 100.0 });
  const [session, setSession] = useState<string>("CLOSED");
  
  // 최신 엔진 데이터는 ref에 캐시 — 렌더 루프와 분리
  const engineCacheRef = useRef<{ askSizes: number[]; bidSizes: number[] }>({
    askSizes: [],
    bidSizes: [],
  });

  // ── 엔진 폴링: 100ms마다 조용히 캐시 업데이트 + 체결 강도 누적 ──
  useEffect(() => {
    const poll = () => {
      const data = getMarketData(stock);
      if (!data) return;

      const ob = data.orderBook;
      // 서버 호가가 비어있으면 렌더링(초기화)을 보류하고 로딩 상태 유지
      const totalSize = ob.asks.reduce((sum: any, l: any) => sum + l.size, 0) + ob.bids.reduce((sum: any, l: any) => sum + l.size, 0);
      if (totalSize === 0) return;

      engineCacheRef.current = {
        askSizes: ob.asks.map((l) => l.size),
        bidSizes: ob.bids.map((l) => l.size),
      };

      // 호가창 초기화 또는 현재가 변동 시 리셋
      setBook((prev) => {
        const newBase = snapToTick(data.price, getTickSize(data.price, stock.market));
        if (!prev || Math.abs(prev.basePrice - newBase) >= getTickSize(data.price, stock.market)) {
          return buildBookFromEngine(data.price, stock, ob);
        }
        return prev;
      });

      if (data.session) setSession(data.session);

      // 체결 내역 업데이트 및 강도 계산
      if (data.trades.length > 0) {
        const now = Date.now();
        setTradeStats((prev) => {
          let b = prev.buyVol;
          let s = prev.sellVol;
          for (const t of data.trades) {
            if (t.side === "buy") b += t.size;
            else s += t.size;
          }
          const strength = s === 0 ? 100 : (b / s) * 100;
          return { buyVol: b, sellVol: s, strength };
        });

        setRecentTrades((prev) => {
          const newTrades = data.trades.map(t => ({ size: t.size, side: t.side, ts: now, price: t.price }));
          const combined = [...newTrades, ...prev];
          return combined.slice(0, 5); // 최근 5개만 유지
        });
      }
    };

    poll();
    const pollId = setInterval(poll, 100);
    return () => clearInterval(pollId);
  }, [stock]);

  // ── 화면 업데이트: 300ms마다 delta 적용 후 렌더 ──
  useEffect(() => {
    const render = () => {
      setBook((prev) => {
        if (!prev) return prev;
        return applyDelta(prev, engineCacheRef.current);
      });
    };

    const renderId = setInterval(render, UPDATE_INTERVAL);
    return () => clearInterval(renderId);
  }, []);

  if (!book) return <div className="p-4 text-sm text-dim">호가 불러오는 중…</div>;

  const maxSize = Math.max(
    ...book.asks.map((l) => l.size),
    ...book.bids.map((l) => l.size),
    1,
  );

  // 매도호가: 높은 가격이 위로 (index 9 → 0 순서로 화면 위쪽)
  const asksDisplay = [...book.asks].reverse();

  return (
    <div className="rounded-xl border border-border bg-panel flex flex-col font-sans overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-tx">호가창</h3>
          {session === "REGULAR" ? (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-up/20 text-up border border-up/30">
              {stock.market === "domestic" ? "본장 (KRX)" : "본장 (정규장)"}
            </span>
          ) : session === "PRE" ? (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-warn/20 text-warn border border-warn/30">
              {stock.market === "domestic" ? "넥장 (NXT)" : "프리마켓"}
            </span>
          ) : session === "AFTER" ? (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-warn/20 text-warn border border-warn/30">
              {stock.market === "domestic" ? "넥장 (NXT)" : "애프터마켓"}
            </span>
          ) : (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-panel2 text-dim border border-border">장 마감</span>
          )}
        </div>
        <span className="text-[11px] text-dim">10호가 MTS</span>
      </div>

      <div className="grid grid-cols-3 border-b border-border text-[11px] font-medium text-dim bg-panel2">
        <div className="py-2 text-center border-r border-border">매도잔량</div>
        <div className="py-2 text-center border-r border-border">호가</div>
        <div className="py-2 text-center">매수잔량</div>
      </div>

      <div className="flex flex-col text-[12px]">
        {/* 매도호가 (위: 가장 높은 가격) */}
        {asksDisplay.map((l, i) => (
          <BookRow
            key={`a-${l.price}`}
            price={l.price}
            size={l.size}
            delta={l.delta}
            maxSize={maxSize}
            side="ask"
            market={stock.market}
            isWall={l.isWall}
            isCurrentPrice={l.price === stock.currentPrice}
            bondMeta={stock.bondMeta}
          />
        ))}

        {/* 매수호가 (위: 가장 높은 가격) */}
        {book.bids.map((l, i) => (
          <BookRow
            key={`b-${l.price}`}
            price={l.price}
            size={l.size}
            delta={l.delta}
            maxSize={maxSize}
            side="bid"
            market={stock.market}
            isWall={l.isWall}
            isCurrentPrice={l.price === stock.currentPrice}
            bondMeta={stock.bondMeta}
          />
        ))}
      </div>
      
      {/* ── 체결 강도 및 실시간 체결 미니 패널 ── */}
      <div className="border-t border-border bg-panel2 p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-dim">체결강도</span>
          <span className={`text-[13px] font-bold font-mono ${tradeStats.strength >= 100 ? "text-up" : "text-down"}`}>
            {tradeStats.strength.toFixed(2)}%
          </span>
        </div>
        <div className="flex gap-2 h-1 w-full bg-panel rounded-full overflow-hidden">
          <div className="bg-up" style={{ flex: tradeStats.strength >= 100 ? 1 : tradeStats.buyVol / (tradeStats.sellVol || 1) }} />
          <div className="bg-down" style={{ flex: tradeStats.strength < 100 ? 1 : tradeStats.sellVol / (tradeStats.buyVol || 1) }} />
        </div>
        <div className="mt-2 flex flex-col gap-0.5 border-t border-border/30 pt-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-dim">체결내역</span>
          </div>
          {recentTrades.map((t, i) => (
            <div key={`${t.ts}-${i}`} className="flex justify-between items-center text-[10px] font-mono">
              <span className="text-dim">{fmtPrice(t.price, stock.market)}</span>
              <span className={t.side === "buy" ? "text-up" : "text-down"}>
                {t.size.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 개별 호가 행 — memo로 불필요한 리렌더 방지
// ─────────────────────────────────────────────
const BookRow = memo(function BookRow({
  price,
  size,
  delta,
  maxSize,
  side,
  market,
  isWall,
  isCurrentPrice,
  bondMeta,
}: {
  price: number;
  size: number;
  delta?: number;
  maxSize: number;
  side: "ask" | "bid";
  market: Stock["market"];
  isWall: boolean;
  isCurrentPrice?: boolean;
  bondMeta?: Stock["bondMeta"];
}) {
  const isAsk = side === "ask";
  const pct = Math.min((size / maxSize) * 100, 100);

  const [showDelta, setShowDelta] = useState(false);
  const prevDelta = useRef(delta);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (delta && delta !== 0 && delta !== prevDelta.current) {
      setShowDelta(true);
      prevDelta.current = delta;
      const t = setTimeout(() => setShowDelta(false), 200);
      return () => clearTimeout(t);
    }
  }, [delta]);

  // 체결(현재가가 이 호가로 옴) 시 0.5초 반짝이는 효과
  useEffect(() => {
    if (isCurrentPrice) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 500);
      return () => clearTimeout(t);
    }
  }, [isCurrentPrice]);

  return (
    <div
      className={`grid grid-cols-3 items-center border-b border-border/30 transition-colors duration-300
        ${flash ? (isAsk ? "bg-down/20" : "bg-up/20") : isCurrentPrice ? (isAsk ? "bg-down/5" : "bg-up/5") : ""}`}
    >
      {/* 왼쪽: 매도 잔량 */}
      <div className="relative h-8 flex items-center justify-end px-2 border-r border-border/30">
        {isAsk && (
          <>
            <div
              className={`absolute right-0 inset-y-0 transition-all duration-300 ${isCurrentPrice ? "bg-down/30" : "bg-down/12"}`}
              style={{ width: `${pct}%` }}
            />
            <span className={`relative font-mono tabular-nums flex items-center gap-1 ${isCurrentPrice ? "text-down font-bold" : "text-tx"}`}>
              {showDelta && delta && delta !== 0 ? (
                <span className={`text-[9px] font-bold ${delta > 0 ? "text-up" : "text-down"}`}>
                  {delta > 0 ? "+" : ""}{Math.floor(delta)}
                </span>
              ) : null}
              {Math.floor(size) === 0 ? "" : Math.floor(size).toLocaleString()}
            </span>
          </>
        )}
      </div>

      {/* 중앙: 가격 */}
      <div
        className={`flex flex-col items-center justify-center font-mono font-bold border-r border-border/30 h-full relative transition-colors cursor-pointer
          ${isAsk ? "bg-down/10 text-down hover:bg-down/20" : "bg-up/10 text-up hover:bg-up/20"}`}
      >
        {isCurrentPrice && (
          <div className="absolute inset-0 border-2 border-tx pointer-events-none z-10" />
        )}
        <span className="text-[11px]">{fmtPrice(price, market)}</span>
        {bondMeta && (
          <span className="text-[9px] font-normal opacity-75">
            {calcYTM(price, bondMeta.faceValue, bondMeta.couponRate, bondMeta.maturityYears).toFixed(2)}%
          </span>
        )}
      </div>

      {/* 오른쪽: 매수 잔량 */}
      <div className="relative h-8 flex items-center justify-start px-2">
        {!isAsk && (
          <>
            <div
              className={`absolute left-0 inset-y-0 transition-all duration-300 ${isCurrentPrice ? "bg-up/30" : "bg-up/12"}`}
              style={{ width: `${pct}%` }}
            />
            <span className={`relative font-mono tabular-nums flex items-center gap-1 ${isCurrentPrice ? "text-up font-bold" : "text-tx"}`}>
              {Math.floor(size) === 0 ? "" : Math.floor(size).toLocaleString()}
              {showDelta && delta && delta !== 0 ? (
                <span className={`text-[9px] font-bold ${delta > 0 ? "text-up" : "text-down"}`}>
                  {delta > 0 ? "+" : ""}{Math.floor(delta)}
                </span>
              ) : null}
            </span>
          </>
        )}
      </div>
    </div>
  );
});
