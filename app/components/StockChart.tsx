"use client";

import { useState, useEffect, useMemo } from "react";
import type { Stock } from "@/lib/types";
import { fmtPrice } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type TimeUnit = "1m" | "5m" | "10m" | "1h" | "1d";

const INTERVAL_MINUTES: Record<TimeUnit, number> = {
  "1m": 1,
  "5m": 5,
  "10m": 10,
  "1h": 60,
  "1d": 1440,
};

function formatCandleTime(date: Date, unit: TimeUnit): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  if (unit === "1d") {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  if (unit === "1h") {
    return `${h}:00`;
  }
  return `${h}:${m}`;
}

export default function StockChart({ stock }: { stock: Stock }) {
  const [unit, setUnit] = useState<TimeUnit>("10m");
  const [realTrades, setRealTrades] = useState<Array<{ price: number; volume: number; created_at: string }>>([]);

  const supabase = createClient();

  // 거래소 DB trades 실시간 조회 및 구독 (가상 시뮬레이션 완전 배제)
  useEffect(() => {
    if (!stock?.id) return;

    // 1. 실제 체결 데이터 조회
    supabase
      .from("trades")
      .select("price, size, created_at")
      .eq("stock_id", stock.id)
      .order("created_at", { ascending: true })
      .then(({ data }: { data: Array<{ price: number; size?: number; created_at: string }> | null }) => {
        if (data && data.length > 0) {
          setRealTrades(
            data.map((t) => ({
              price: Number(t.price),
              volume: Number(t.size || 1),
              created_at: t.created_at,
            }))
          );
        } else {
          setRealTrades([]);
        }
      });

    // 2. 봇 및 실투자자 체결 실시간 릴레이션 구독
    const channel = supabase
      .channel(`stock_trades_real_${stock.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "trades", filter: `stock_id=eq.${stock.id}` },
        (payload: { new: Record<string, unknown> }) => {
          const newTrade = payload.new as any;
          setRealTrades((prev) => [
            ...prev,
            {
              price: Number(newTrade.price),
              volume: Number(newTrade.size || 1),
              created_at: newTrade.created_at,
            },
          ]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stock.id, supabase]);

  // 실제 체결(trades) 데이터만을 기반으로 시간 단위(1m/5m/10m/1h/1d) 캔들 집계
  const candles: Candle[] = useMemo(() => {
    if (realTrades.length === 0) {
      // 체결 내역이 아직 없는 경우 현재가 기반 단일 캔들 표시
      const nowStr = formatCandleTime(new Date(), unit);
      return [
        {
          time: nowStr,
          open: stock.currentPrice,
          high: stock.currentPrice,
          low: stock.currentPrice,
          close: stock.currentPrice,
          volume: stock.volume || 0,
        },
      ];
    }

    const intervalMs = INTERVAL_MINUTES[unit] * 60 * 1000;
    const map = new Map<number, Candle>();

    realTrades.forEach((t) => {
      const d = new Date(t.created_at);
      const tsKey = Math.floor(d.getTime() / intervalMs) * intervalMs;
      const existing = map.get(tsKey);

      if (!existing) {
        map.set(tsKey, {
          time: formatCandleTime(new Date(tsKey), unit),
          open: t.price,
          high: t.price,
          low: t.price,
          close: t.price,
          volume: t.volume,
        });
      } else {
        existing.close = t.price;
        if (t.price > existing.high) existing.high = t.price;
        if (t.price < existing.low) existing.low = t.price;
        existing.volume += t.volume;
      }
    });

    return Array.from(map.values());
  }, [realTrades, unit, stock.currentPrice, stock.volume]);

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

  // Y축 틱 계산
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
    const tickCount = Math.min(5, candles.length);
    const step = Math.max(1, Math.floor((candles.length - 1) / tickCount));
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
    if (candles.length <= 1) return w / 2;
    return (index / (candles.length - 1)) * (w - 60) + 10;
  };

  const getY = (priceVal: number) => {
    if (maxPrice === minPrice) return chartHeight / 2;
    return chartHeight - ((priceVal - minPrice) / (maxPrice - minPrice)) * (chartHeight - 20) - 10;
  };

  const getVolY = (vol: number) => {
    return h - (vol / maxVolume) * volHeight;
  };

  // 기준선 (전일 종가)
  const prevCloseY = getY(stock.previousClose);

  return (
    <div className="flex flex-col h-full w-full">
      {/* 1. 상단 정보창 및 툴바 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#212631] pb-3 px-1">
        {/* OHLCV 인포 */}
        <div className="flex flex-wrap items-center gap-3 font-mono text-[11.5px] text-[#8E939D] font-medium">
          <span className="text-[#565A63]">시간: <span className="text-white font-bold">{activeCandle.time}</span></span>
          <span>시: <span className={`font-bold ${activeCandle.open >= stock.previousClose ? "text-[#F04452]" : "text-[#3182F6]"}`}>{fmtPrice(activeCandle.open, stock.market)}</span></span>
          <span>고: <span className="text-[#F04452] font-bold">{fmtPrice(activeCandle.high, stock.market)}</span></span>
          <span>저: <span className="text-[#3182F6] font-bold">{fmtPrice(activeCandle.low, stock.market)}</span></span>
          <span>종: <span className={`font-bold ${activeCandle.close >= stock.previousClose ? "text-[#F04452]" : "text-[#3182F6]"}`}>{fmtPrice(activeCandle.close, stock.market)}</span></span>
          <span className="text-[10px] text-emerald-400 font-bold bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20 ml-1">
            LIVE DB ({realTrades.length}건 체결)
          </span>
        </div>

        {/* 봉 주기 버튼 */}
        <div className="flex items-center gap-1 rounded-full bg-[#161B22] p-1 border border-[#212631]">
          {(["1m", "5m", "10m", "1h", "1d"] as TimeUnit[]).map((u) => (
            <button
              key={u}
              onClick={() => {
                setUnit(u);
              }}
              className={`rounded-full px-3 py-1 font-mono text-[11px] font-bold transition-all cursor-pointer ${
                unit === u
                  ? "bg-[#F04452] text-white shadow-[0_0_10px_rgba(240,68,82,0.4)]"
                  : "text-[#8E939D] hover:text-white hover:bg-white/5"
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
          {yTicks.map((t) => {
            const y = getY(t);
            return (
              <g key={`y-${t}`}>
                <line x1="0" y1={y} x2={w - 50} y2={y} stroke="#212631" strokeOpacity="0.6" strokeDasharray="2 4" strokeWidth="1" />
                <text x={w} y={y + 3} textAnchor="end" className="fill-[#8E939D] font-mono text-[9px] font-medium">{t.toLocaleString()}</text>
              </g>
            );
          })}

          {/* X축 그리드 및 시간 텍스트 */}
          {xTicks.map((t) => {
            const cx = getX(t.index);
            return (
              <g key={`x-${t.index}`}>
                <line x1={cx} y1="0" x2={cx} y2={chartHeight} stroke="#212631" strokeOpacity="0.4" strokeDasharray="2 4" strokeWidth="1" />
                <text x={cx} y={chartHeight + 14} textAnchor="middle" className="fill-[#8E939D] font-mono text-[9px] font-medium">{t.time}</text>
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
                stroke="#565A63"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              <text
                x={w - 5}
                y={prevCloseY - 4}
                textAnchor="end"
                className="fill-[#8E939D] font-mono text-[9px] font-bold"
              >
                전일대비 기준선
              </text>
            </g>
          )}

          {/* 캔들 및 거래량 차트 그리기 */}
          {candles.map((c, i) => {
            const cx = getX(i);
            const isUp = c.close >= c.open;
            const strokeColor = isUp ? "#F04452" : "#3182F6";
            const fillColor = isUp ? "#F04452" : "#3182F6";

            // 캔들 OHLC 좌표
            const oY = getY(c.open);
            const cY = getY(c.close);
            const hY = getY(c.high);
            const lY = getY(c.low);

            const candleWidth = Math.max(Math.floor(w / Math.max(candles.length, 1)) - 5, 4);
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

                {/* 3. 하단 거래량 바 */}
                <rect
                  x={cx - candleWidth / 2}
                  y={volY}
                  width={candleWidth}
                  height={volH}
                  fill={fillColor}
                  opacity="0.2"
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
