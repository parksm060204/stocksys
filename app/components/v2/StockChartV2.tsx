"use client";

/**
 * StockChartV2.tsx
 *
 * lightweight-charts v5 기반 듀얼 모드 차트 컴포넌트.
 *
 * Default 모드 (isProMode=false):
 *   - 깔끔한 선 차트(LineSeries)
 *   - 그리드·축 완전 숨김 → 시각적 노이즈 0
 *
 * Pro 모드 (isProMode=true):
 *   - 봉 차트(CandlestickSeries) + 거래량 히스토그램(pane 1)
 *   - 볼린저 밴드 상·중·하선(LineSeries, 3개)
 *   - RSI 보조 패널(pane 2, HistogramSeries + 30/70 경계선)
 *   - 그리드·축 완전 표시
 *
 * isProMode 변경 시 → 차트 인스턴스 파괴 후 재생성 (useEffect key 패턴)
 */

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  LineSeries,
  CandlestickSeries,
  HistogramSeries,
} from "lightweight-charts";
import { createClient } from "@/lib/supabase/client";

/* ─────────────────────────────────────────────────────────
   Constants & Helpers
───────────────────────────────────────────────────────── */
const INTERVAL_MS = 10 * 60 * 1000; // 10분봉

function floorToInterval(ts: number) {
  return Math.floor(ts / INTERVAL_MS) * INTERVAL_MS;
}

function seededRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

function hashStr(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ── 캔들 타입 ── */
type Candle = {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/* ── trades 테이블 → 10분봉 집계 ── */
function groupToCandles(
  trades: { price: number; volume?: number; quantity?: number; created_at: string }[]
): Candle[] {
  const map = new Map<
    number,
    { open: number; high: number; low: number; close: number; volume: number }
  >();
  for (const t of trades) {
    const ts = floorToInterval(new Date(t.created_at).getTime()) / 1000;
    const vol = Number(t.volume ?? t.quantity ?? 1);
    const c = map.get(ts);
    if (!c) {
      map.set(ts, {
        open: t.price,
        high: t.price,
        low: t.price,
        close: t.price,
        volume: vol,
      });
    } else {
      c.close = t.price;
      c.volume += vol;
      if (t.price > c.high) c.high = t.price;
      if (t.price < c.low) c.low = t.price;
    }
  }
  return Array.from(map.entries())
    .map(([time, v]) => ({ time, ...v }))
    .sort((a, b) => a.time - b.time);
}

/* ── 시드 기반 Fallback 캔들 (역순 매칭으로 수직 낙하 착시 완벽 방지) ── */
function makeFallbackCandles(stockId: string, currentPrice: number): Candle[] {
  const rng = seededRng(hashStr(stockId));
  const now = Date.now();
  const count = 60;
  const history: Candle[] = [];
  let price = currentPrice;

  for (let i = 0; i <= count; i++) {
    const ts = Math.floor(floorToInterval(now - i * INTERVAL_MS) / 1000);
    const chg = (rng() - 0.492) * 0.018;
    const close = price;
    const open = close / (1 + chg);
    const wk = rng() * 0.006;
    const high = Math.max(open, close) * (1 + wk);
    const low = Math.min(open, close) * (1 - wk);
    const volume = Math.floor(rng() * 80000 + 5000);

    history.push({
      time: ts,
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume,
    });

    price = open;
  }

  return history.reverse();
}

/* ── Bollinger Bands ── */
function calcBollingerBands(
  data: Candle[],
  period = 20,
  multiplier = 2
): {
  upper: { time: number; value: number }[];
  mid: { time: number; value: number }[];
  lower: { time: number; value: number }[];
} {
  const upper: { time: number; value: number }[] = [];
  const mid: { time: number; value: number }[] = [];
  const lower: { time: number; value: number }[] = [];

  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, c) => a + c.close, 0) / period;
    const variance =
      slice.reduce((a, c) => a + Math.pow(c.close - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    upper.push({ time: data[i].time, value: +(mean + multiplier * std).toFixed(2) });
    mid.push({ time: data[i].time, value: +mean.toFixed(2) });
    lower.push({ time: data[i].time, value: +(mean - multiplier * std).toFixed(2) });
  }
  return { upper, mid, lower };
}

/* ── RSI 계산 ── */
function calcRSI(
  data: Candle[],
  period = 14
): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  if (data.length < period + 1) return result;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < data.length; i++) {
    if (i > period) {
      const diff = data[i].close - data[i - 1].close;
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);
    result.push({ time: data[i].time, value: +rsi.toFixed(2) });
  }
  return result;
}

/* ─────────────────────────────────────────────────────────
   Props
───────────────────────────────────────────────────────── */
interface Props {
  ticker: string;
  currentPrice: number;
  isProMode: boolean;
}

/* ─────────────────────────────────────────────────────────
   Main Component
───────────────────────────────────────────────────────── */
export default function StockChartV2({ ticker, currentPrice, isProMode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const isDisposedRef = useRef(false);

  // Series refs (필요한 것만 저장)
  const mainSeriesRef = useRef<ISeriesApi<"Line"> | ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const [stockId, setStockId] = useState<string | null>(null);
  const [isFallback, setIsFallback] = useState(false);
  const [, setActiveMode] = useState<"default" | "pro">(
    isProMode ? "pro" : "default"
  );

  const supabase = createClient();

  /* ── 1. ticker → stockId 변환 ── */
  useEffect(() => {
    const client = createClient();
    client
      .from("stocks")
      .select("id")
      .eq("ticker", ticker)
      .single()
      .then(({ data }: { data: { id: string } | null }) => {
        if (data && !isDisposedRef.current) setStockId(data.id);
      });
  }, [ticker]);

  /* ── 2. isProMode 변경 → 차트 인스턴스 파괴 & 재생성 ── */
  useEffect(() => {
    if (!containerRef.current) return;

    // 기존 차트 완전 파괴
    isDisposedRef.current = true;
    if (chartRef.current) {
      try {
        chartRef.current.remove();
      } catch {
        // already disposed
      }
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
    }
    isDisposedRef.current = false;

    const el = containerRef.current;

    /* ── 공통 레이아웃 옵션 ── */
    const COMMON_LAYOUT = {
      background: { type: ColorType.Solid, color: "#0D0F14" },
      textColor: isProMode ? "#9CA3AF" : "transparent",
      fontSize: 11,
    };

    const HIDDEN_SCALE = {
      visible: false,
      borderVisible: false,
    };

    const VISIBLE_SCALE = {
      visible: true,
      borderColor: "#1F2937",
    };

    /* ══════════════════════════════════════════
       DEFAULT 모드 — 선 차트, 노이즈 0
    ══════════════════════════════════════════ */
    if (!isProMode) {
      const chart = createChart(el, {
        layout: COMMON_LAYOUT,
        grid: {
          vertLines: { visible: false },
          horzLines: { visible: false },
        },
        leftPriceScale: HIDDEN_SCALE,
        rightPriceScale: HIDDEN_SCALE,
        timeScale: {
          visible: false,
          borderVisible: false,
        },
        crosshair: {
          horzLine: { visible: false, labelVisible: false },
          vertLine: { visible: true, labelVisible: false, color: "#374151", width: 1 },
        },
        handleScroll: true,
        handleScale: true,
        width: el.clientWidth || 600,
        height: el.clientHeight || 340,
      });

      const lineSer = chart.addSeries(LineSeries, {
        color: "#3182F6",
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: "#3182F6",
        crosshairMarkerBackgroundColor: "#0D0F14",
        lastValueVisible: false,
        priceLineVisible: false,
      });

      chartRef.current = chart;
      mainSeriesRef.current = lineSer as unknown as ISeriesApi<"Line">;
      setActiveMode("default");

      // ResizeObserver
      const ro = new ResizeObserver(() => {
        if (!isDisposedRef.current && chartRef.current) {
          try {
            chart.applyOptions({
              width: el.clientWidth,
              height: el.clientHeight || 340,
            });
          } catch { /* disposed */ }
        }
      });
      ro.observe(el);

      return () => {
        isDisposedRef.current = true;
        ro.disconnect();
        chartRef.current = null;
        mainSeriesRef.current = null;
        volumeSeriesRef.current = null;
        try { chart.remove(); } catch { /* disposed */ }
      };
    }

    /* ══════════════════════════════════════════
       PRO 모드 — 캔들 + 볼밴 + 거래량 + RSI
    ══════════════════════════════════════════ */
    const chart = createChart(el, {
      layout: COMMON_LAYOUT,
      grid: {
        vertLines: { color: "#1A1D24", visible: true },
        horzLines: { color: "#1A1D24", visible: true },
      },
      leftPriceScale: HIDDEN_SCALE,
      rightPriceScale: VISIBLE_SCALE,
      timeScale: {
        visible: true,
        borderColor: "#1F2937",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        horzLine: { visible: true, labelVisible: true, color: "#374151", width: 1, labelBackgroundColor: "#1F2937" },
        vertLine: { visible: true, labelVisible: true, color: "#374151", width: 1, labelBackgroundColor: "#1F2937" },
      },
      handleScroll: true,
      handleScale: true,
      width: el.clientWidth || 600,
      height: el.clientHeight || 500,
    });

    // ① 봉 차트 (메인 pane 0)
    const candleSer = chart.addSeries(CandlestickSeries, {
      upColor: "#F04452",
      downColor: "#3182F6",
      borderVisible: false,
      wickUpColor: "#F04452",
      wickDownColor: "#3182F6",
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineColor: "#F04452",
    });

    // ② 볼린저 밴드 — 상단 (pane 0)
    const bbUpperSer = chart.addSeries(LineSeries, {
      color: "rgba(245,158,11,0.6)",
      lineWidth: 1,
      lineStyle: 2, // Dashed
      lastValueVisible: false,
      priceLineVisible: false,
    });

    // ③ 볼린저 밴드 — 중간(SMA)
    const bbMidSer = chart.addSeries(LineSeries, {
      color: "rgba(245,158,11,0.35)",
      lineWidth: 1,
      lineStyle: 0,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    // ④ 볼린저 밴드 — 하단
    const bbLowerSer = chart.addSeries(LineSeries, {
      color: "rgba(245,158,11,0.6)",
      lineWidth: 1,
      lineStyle: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    // ⑤ 거래량 히스토그램 (pane 1)
    const volumeSer = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
        lastValueVisible: false,
        priceLineVisible: false,
      },
      1 // pane index
    );
    chart.panes()[1]?.setHeight(80);

    // ⑥ RSI 히스토그램 (pane 2)
    const rsiSer = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "price", precision: 1 },
        priceScaleId: "rsi",
        lastValueVisible: true,
        priceLineVisible: false,
        base: 50,
        color: "#3182F6",
      },
      2 // pane index
    );
    chart.panes()[2]?.setHeight(70);

    chartRef.current = chart;
    mainSeriesRef.current = candleSer as unknown as ISeriesApi<"Candlestick">;
    volumeSeriesRef.current = volumeSer as unknown as ISeriesApi<"Histogram">;
    setActiveMode("pro");

    // ResizeObserver
    const ro = new ResizeObserver(() => {
      if (!isDisposedRef.current && chartRef.current) {
        try {
          chart.applyOptions({
            width: el.clientWidth,
            height: el.clientHeight || 500,
          });
        } catch { /* disposed */ }
      }
    });
    ro.observe(el);

    // 데이터 주입 함수 — stockId 로드 전에도 Fallback으로 즉시 렌더
    const injectData = (candles: Candle[]) => {
      if (isDisposedRef.current) return;
      try {
        // 봉 차트
        candleSer.setData(
          candles.map((c) => ({
            time: c.time as unknown as import("lightweight-charts").Time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }))
        );

        // 볼린저 밴드
        const { upper, mid, lower } = calcBollingerBands(candles, 20, 2);
        bbUpperSer.setData(upper as any);
        bbMidSer.setData(mid as any);
        bbLowerSer.setData(lower as any);

        // 거래량
        volumeSer.setData(
          candles.map((c) => ({
            time: c.time as unknown as import("lightweight-charts").Time,
            value: c.volume,
            color: c.close >= c.open ? "rgba(240,68,82,0.5)" : "rgba(49,130,246,0.5)",
          }))
        );

        // RSI
        const rsiData = calcRSI(candles, 14);
        rsiSer.setData(
          rsiData.map((d) => ({
            time: d.time as unknown as import("lightweight-charts").Time,
            value: d.value,
            color:
              d.value >= 70
                ? "rgba(240,68,82,0.8)"
                : d.value <= 30
                ? "rgba(49,130,246,0.8)"
                : "rgba(107,114,128,0.6)",
          }))
        );

        chart.timeScale().scrollToRealTime();
      } catch { /* disposed during async */ }
    };

    // 즉시 Fallback 렌더 (stockId 없어도)
    const tempId = hashStr(ticker).toString();
    injectData(makeFallbackCandles(tempId, currentPrice));
    setIsFallback(true);

    return () => {
      isDisposedRef.current = true;
      ro.disconnect();
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
      try { chart.remove(); } catch { /* disposed */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProMode]); // ← isProMode 변경 시 전체 재생성

  /* ── 3. stockId 확보 후 실 데이터 로드 (Default 선 차트 + Pro 봉 차트 공용) ── */
  useEffect(() => {
    if (!stockId || isDisposedRef.current || !chartRef.current) return;

    const since = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();

    supabase
      .from("trades")
      .select("price, volume, quantity, created_at")
      .eq("stock_id", stockId)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .then(
        ({
          data,
        }: {
          data: Array<{
            price: number;
            volume?: number;
            quantity?: number;
            created_at: string;
          }> | null;
        }) => {
          if (isDisposedRef.current || !chartRef.current) return;
          try {
            if (data && data.length >= 2) {
              const candles = groupToCandles(data);
              setIsFallback(false);

              if (!isProMode) {
                /* Default 모드: 선 차트에 close 가격만 */
                const lineSer = mainSeriesRef.current as ISeriesApi<"Line">;
                lineSer?.setData(
                  candles.map((c) => ({
                    time: c.time as unknown as import("lightweight-charts").Time,
                    value: c.close,
                  }))
                );
              } else {
                /* Pro 모드: 봉 + 볼밴 + 거래량 + RSI 재주입 */
                const candleSer = mainSeriesRef.current as ISeriesApi<"Candlestick">;
                candleSer?.setData(
                  candles.map((c) => ({
                    time: c.time as unknown as import("lightweight-charts").Time,
                    open: c.open,
                    high: c.high,
                    low: c.low,
                    close: c.close,
                  }))
                );
                const volSer = volumeSeriesRef.current;
                volSer?.setData(
                  candles.map((c) => ({
                    time: c.time as unknown as import("lightweight-charts").Time,
                    value: c.volume,
                    color:
                      c.close >= c.open
                        ? "rgba(240,68,82,0.5)"
                        : "rgba(49,130,246,0.5)",
                  }))
                );
              }
              chartRef.current?.timeScale().scrollToRealTime();
            } else {
              /* DB 체결 데이터가 아직 없는 경우 현재가 기준 실시간 베이스 캔들 설정 */
              const nowTs = Math.floor(floorToInterval(Date.now()) / 1000);
              const baseCandle = {
                time: nowTs as unknown as import("lightweight-charts").Time,
                open: currentPrice,
                high: currentPrice,
                low: currentPrice,
                close: currentPrice,
              };
              if (!isProMode && mainSeriesRef.current) {
                const lineSer = mainSeriesRef.current as ISeriesApi<"Line">;
                lineSer.setData([{ time: baseCandle.time, value: currentPrice }]);
              } else if (isProMode && mainSeriesRef.current) {
                const candleSer = mainSeriesRef.current as ISeriesApi<"Candlestick">;
                candleSer.setData([baseCandle]);
              }
              chartRef.current?.timeScale().scrollToRealTime();
              setIsFallback(false);
            }
          } catch { /* disposed */ }
        }
      );

    // 실시간 구독
    const channel = supabase
      .channel(`chart_v2_${stockId}_${isProMode}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "trades",
          filter: `stock_id=eq.${stockId}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          if (isDisposedRef.current || !mainSeriesRef.current) return;
          try {
            const t = payload.new as {
              price: number;
              created_at: string;
              quantity?: number;
            };
            const ts = Math.floor(
              floorToInterval(new Date(t.created_at).getTime()) / 1000
            ) as unknown as import("lightweight-charts").Time;

            if (!isProMode) {
              (mainSeriesRef.current as ISeriesApi<"Line">).update({
                time: ts,
                value: t.price,
              });
            } else {
              (mainSeriesRef.current as ISeriesApi<"Candlestick">).update({
                time: ts,
                open: t.price,
                high: t.price,
                low: t.price,
                close: t.price,
              });
            }
            setIsFallback(false);
          } catch { /* disposed */ }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stockId, isProMode, currentPrice, supabase]);

  /* ─────────────────────────────────────────────────────────
     Render
  ───────────────────────────────────────────────────────── */
  return (
    <div className="relative w-full h-full flex flex-col bg-[#0D0F14]">
      {/* 상단 레이블 바 */}
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-widest">
            {isProMode ? "봉 차트 (10분)" : "실시간 선 차트"}
          </span>
          {isProMode && (
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-[#F59E0B]/80 bg-[#F59E0B]/10 px-1.5 py-px rounded tracking-widest">
                BB(20,2)
              </span>
              <span className="text-[9px] text-[#6B7280] bg-[#1C1C1E] px-1.5 py-px rounded tracking-widest">
                RSI(14)
              </span>
              <span className="text-[9px] text-[#6B7280] bg-[#1C1C1E] px-1.5 py-px rounded tracking-widest">
                VOL
              </span>
            </div>
          )}
        </div>

        {isFallback && (
          <span className="text-[9px] text-yellow-500/70 bg-yellow-500/10 px-2 py-px rounded tracking-widest">
            시뮬레이션
          </span>
        )}
      </div>

      {/* 차트 컨테이너 */}
      <div ref={containerRef} className="flex-1 w-full min-h-0" />

      {/* Pro 모드 범례 */}
      {isProMode && (
        <div className="flex items-center gap-3 px-3 py-1.5 shrink-0 border-t border-[#1C1C1E]">
          <LegendItem color="#F04452" label="상승봉" />
          <LegendItem color="#3182F6" label="하락봉" />
          <LegendItem color="rgba(245,158,11,0.7)" label="볼린저밴드" dashed />
          <LegendItem color="rgba(107,114,128,0.6)" label="RSI" />
        </div>
      )}
    </div>
  );
}

/* ── 범례 소형 컴포넌트 ── */
function LegendItem({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <span
        className="inline-block w-5 h-px"
        style={{
          background: color,
          borderTop: dashed ? `1px dashed ${color}` : undefined,
        }}
      />
      <span className="text-[9px] text-[#6B7280]">{label}</span>
    </div>
  );
}
