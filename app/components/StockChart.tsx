"use client";

import { useEffect, useState, useMemo } from "react";
import type { Stock } from "@/lib/types";
import { fmtPrice } from "@/lib/format";

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type TimeUnit = "1m" | "5m" | "10m" | "1h" | "1d";

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export default function StockChart({ stock }: { stock: Stock }) {
  const [unit, setUnit] = useState<TimeUnit>("10m");

  // 난수 기반 과거 캔들 데이터 생성
  const candles = useMemo(() => {
    const seed = hashStr(stock.id + unit);
    const rng = mulberry32(seed);

    const data: Candle[] = [];
    const count = 32; // 표시할 캔들 수
    let price = stock.previousClose * (0.95 + rng() * 0.08); // 약간의 시초 오프셋

    // 시간 계산 헬퍼
    const now = new Date();
    const getCandleTime = (index: number) => {
      const d = new Date(now.getTime());
      const offset = (count - 1 - index);
      switch (unit) {
        case "1m":
          d.setMinutes(d.getMinutes() - offset);
          return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        case "5m":
          d.setMinutes(d.getMinutes() - offset * 5);
          return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        case "10m":
          d.setMinutes(d.getMinutes() - offset * 10);
          return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        case "1h":
          d.setHours(d.getHours() - offset);
          return `${String(d.getHours()).padStart(2, "0")}:00`;
        case "1d":
          d.setDate(d.getDate() - offset);
          return `${d.getMonth() + 1}/${d.getDate()}`;
      }
    };

    // 0 ~ count-2 까지 과거 데이터 생성
    for (let i = 0; i < count - 1; i++) {
      const change = (rng() - 0.495) * 0.02; // 변동률
      const open = price;
      const close = price * (1 + change);
      const high = Math.max(open, close) * (1 + rng() * 0.008);
      const low = Math.min(open, close) * (1 - rng() * 0.008);
      const volume = Math.floor(rng() * 50000) + 2000;

      data.push({
        time: getCandleTime(i),
        open: +open.toFixed(2),
        high: +high.toFixed(2),
        low: +low.toFixed(2),
        close: +close.toFixed(2),
        volume,
      });

      price = close; // 다음 봉 시가는 이전 봉 종가
    }

    // 마지막 캔들 (현재 실시간 가격과 동기화)
    const lastOpen = price;
    const lastClose = stock.currentPrice;
    // 고가/저가는 현재 수집된 고가/저가와 동적으로 계산
    const lastHigh = Math.max(lastOpen, lastClose, stock.high);
    const lastLow = Math.min(lastOpen, lastClose, stock.low);

    data.push({
      time: getCandleTime(count - 1),
      open: +lastOpen.toFixed(2),
      high: +lastHigh.toFixed(2),
      low: +lastLow.toFixed(2),
      close: +lastClose.toFixed(2),
      volume: Math.floor(stock.volume / 10), // 현재 거래량의 일부 매칭
    });

    return data;
  }, [stock.id, stock.currentPrice, stock.high, stock.low, stock.previousClose, stock.volume, unit]);

  const activeCandle = candles[candles.length - 1];

  // SVG 좌표 변환용 계산
  const { minPrice, maxPrice, maxVolume } = useMemo(() => {
    let minP = Infinity;
    let maxP = -Infinity;
    let maxV = 0;

    candles.forEach((c) => {
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
      if (c.volume > maxV) maxV = c.volume;
    });

    // 상하 여백 5% 확보
    const padding = (maxP - minP) * 0.05 || minP * 0.05;
    return {
      minPrice: minP - padding,
      maxPrice: maxP + padding,
      maxVolume: maxV || 1,
    };
  }, [candles]);

  // Y축 틱 계산 (100, 500, 1000 단위 등 예쁜 숫자)
  const yTicks = useMemo(() => {
    const range = maxPrice - minPrice;
    if (range <= 0) return [minPrice];
    
    const targetTickCount = 4;
    const roughStep = range / targetTickCount;
    
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const normalizedStep = roughStep / magnitude;
    let niceStep = 1;
    if (normalizedStep > 5) niceStep = 10;
    else if (normalizedStep > 2) niceStep = 5;
    else if (normalizedStep > 1) niceStep = 2;
    
    const tickStep = niceStep * magnitude;
    const startTick = Math.ceil(minPrice / tickStep) * tickStep;
    const endTick = Math.floor(maxPrice / tickStep) * tickStep;
    
    const ticks = [];
    for (let t = startTick; t <= endTick; t += tickStep) {
      ticks.push(t);
    }
    return ticks;
  }, [minPrice, maxPrice]);

  // X축 시간 틱 (5~6개 등분)
  const xTicks = useMemo(() => {
    const tickCount = 5;
    const step = Math.floor((candles.length - 1) / tickCount);
    const ticks = [];
    for (let i = 0; i < candles.length; i += step) {
      ticks.push({ index: i, time: candles[i].time });
    }
    return ticks;
  }, [candles]);

  const w = 600;
  const h = 200;
  const chartHeight = h * 0.75; // 차트 높이 75%
  const volHeight = h * 0.2;    // 거래량 높이 20%

  const getX = (index: number) => {
    return (index / (candles.length - 1)) * (w - 60) + 10;
  };

  const getY = (price: number) => {
    return chartHeight - ((price - minPrice) / (maxPrice - minPrice)) * (chartHeight - 20) - 10;
  };

  const getVolY = (vol: number) => {
    return h - (vol / maxVolume) * volHeight;
  };

  // 기준선 (전일 종가)
  const prevCloseY = getY(stock.previousClose);

  return (
    <div className="flex flex-col h-full w-full">
      {/* 1. 상단 정보창 및 툴바 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2 px-1">
        {/* OHLCV 인포 */}
        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted">
          <span className="text-dim">시간: <span className="text-tx">{activeCandle.time}</span></span>
          <span>시: <span className={activeCandle.open >= stock.previousClose ? "text-up" : "text-down"}>{fmtPrice(activeCandle.open, stock.market)}</span></span>
          <span>고: <span className="text-up">{fmtPrice(activeCandle.high, stock.market)}</span></span>
          <span>저: <span className="text-down">{fmtPrice(activeCandle.low, stock.market)}</span></span>
          <span>종: <span className={activeCandle.close >= stock.previousClose ? "text-up" : "text-down"}>{fmtPrice(activeCandle.close, stock.market)}</span></span>
        </div>

        {/* 봉 주기 버튼 */}
        <div className="flex items-center gap-1 rounded-lg bg-panel2 p-0.5 border border-border/30">
          {(["1m", "5m", "10m", "1h", "1d"] as TimeUnit[]).map((u) => (
            <button
              key={u}
              onClick={() => {
                setUnit(u);
              }}
              className={`rounded px-2.5 py-0.5 font-mono text-[11px] font-semibold transition-all ${
                unit === u
                  ? "bg-border text-tx shadow-sm"
                  : "text-dim hover:text-tx"
              }`}
            >
              {u === "1m" ? "1분" : u === "5m" ? "5분" : u === "10m" ? "10분" : u === "1h" ? "1시간" : "1일"}
            </button>
          ))}
        </div>
      </div>

      {/* 2. 메인 차트 영역 */}
      <div className="relative flex-1 mt-2 min-h-0 select-none">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="h-full w-full"
          preserveAspectRatio="none"
        >
          {/* Y축 그리드 및 가격 텍스트 */}
          {yTicks.map(t => {
             const y = getY(t);
             return (
               <g key={`y-${t}`}>
                 <line x1="0" y1={y} x2={w - 50} y2={y} stroke="var(--border)" strokeOpacity="0.4" strokeDasharray="2 4" strokeWidth="1" />
                 <text x={w} y={y + 3} textAnchor="end" className="fill-dim font-mono text-[9px]">{t.toLocaleString()}</text>
               </g>
             );
          })}
          
          {/* X축 그리드 및 시간 텍스트 */}
          {xTicks.map(t => {
             const cx = getX(t.index);
             return (
               <g key={`x-${t.index}`}>
                 <line x1={cx} y1="0" x2={cx} y2={chartHeight} stroke="var(--border)" strokeOpacity="0.2" strokeDasharray="2 4" strokeWidth="1" />
                 <text x={cx} y={chartHeight + 14} textAnchor="middle" className="fill-dim font-mono text-[9px]">{t.time}</text>
               </g>
             );
          })}

          {/* 전일 종가 기준선 */}
          {prevCloseY >= 0 && prevCloseY <= chartHeight && (
            <g>
              <line
                x1="0"
                y1={prevCloseY}
                x2={w}
                y2={prevCloseY}
                stroke="var(--border)"
                strokeDasharray="2 3"
                strokeWidth="1"
              />
              <text
                x={w - 5}
                y={prevCloseY - 4}
                textAnchor="end"
                className="fill-dim font-mono text-[9px]"
              >
                전일대비 기준선
              </text>
            </g>
          )}

          {/* 캔들 및 거래량 차트 그리기 */}
          {candles.map((c, i) => {
            const cx = getX(i);
            const isUp = c.close >= c.open;
            const strokeColor = isUp ? "var(--up)" : "var(--down)";
            const fillColor = isUp ? "var(--up)" : "var(--down)";

            // 캔들 OHLC 좌표
            const oY = getY(c.open);
            const cY = getY(c.close);
            const hY = getY(c.high);
            const lY = getY(c.low);

            const candleWidth = Math.max(Math.floor(w / candles.length) - 5, 3);
            const rectHeight = Math.max(Math.abs(oY - cY), 1.5);
            const rectY = Math.min(oY, cY);

            // 거래량 바 좌표
            const volY = getVolY(c.volume);
            const volH = h - volY;

            return (
              <g key={i}>
                {/* 1. 캔들 꼬리 (High-Low) */}
                <line
                  x1={cx}
                  y1={hY}
                  x2={cx}
                  y2={lY}
                  stroke={strokeColor}
                  strokeWidth="1.2"
                />

                {/* 2. 캔들 몸통 */}
                <rect
                  x={cx - candleWidth / 2}
                  y={rectY}
                  width={candleWidth}
                  height={rectHeight}
                  fill={fillColor}
                  stroke={strokeColor}
                  strokeWidth="0.5"
                  rx="1"
                />

                {/* 3. 하단 거래량 바 (반투명 겹침) */}
                <rect
                  x={cx - candleWidth / 2}
                  y={volY}
                  width={candleWidth}
                  height={volH}
                  fill={fillColor}
                  opacity="0.16"
                  rx="0.5"
                />

              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
