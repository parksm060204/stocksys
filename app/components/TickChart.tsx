'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickSeries } from 'lightweight-charts';

const INTERVAL_MS = 10 * 60 * 1000; // 10분

function floorToInterval(ts: number) {
  return Math.floor(ts / INTERVAL_MS) * INTERVAL_MS;
}

// 난수 생성기 (시드 기반 — 동일 종목은 동일 차트)
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

/** trades 테이블에서 가져온 데이터로 10분봉 집계 */
function groupToCandles(
  trades: { price: number; created_at: string }[]
): { time: number; open: number; high: number; low: number; close: number }[] {
  const map = new Map<number, { open: number; high: number; low: number; close: number }>();
  for (const t of trades) {
    const ts = floorToInterval(new Date(t.created_at).getTime()) / 1000;
    const c = map.get(ts);
    if (!c) {
      map.set(ts, { open: t.price, high: t.price, low: t.price, close: t.price });
    } else {
      c.close = t.price;
      if (t.price > c.high) c.high = t.price;
      if (t.price < c.low) c.low = t.price;
    }
  }
  return Array.from(map.entries())
    .map(([time, v]) => ({ time, ...v }))
    .sort((a, b) => a.time - b.time);
}

/** 실 데이터 없을 때 시드 기반 가상 캔들 생성 */
function makeFallbackCandles(
  stockId: string,
  currentPrice: number
): { time: number; open: number; high: number; low: number; close: number }[] {
  const rng = seededRng(hashStr(stockId));
  const now = Date.now();
  const count = 48; // 48 * 10분 = 8시간
  const candles = [];
  let price = currentPrice * (0.94 + rng() * 0.12);

  for (let i = count; i >= 1; i--) {
    const ts = Math.floor(floorToInterval(now - i * INTERVAL_MS) / 1000);
    const chg = (rng() - 0.495) * 0.018;
    const open = price;
    const close = open * (1 + chg);
    const wk = rng() * 0.006;
    const high = Math.max(open, close) * (1 + wk);
    const low = Math.min(open, close) * (1 - wk);
    candles.push({ time: ts, open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2) });
    price = close;
  }
  // 마지막 봉을 현재가로 연결
  const lastTs = Math.floor(floorToInterval(now) / 1000);
  const lastOpen = price;
  candles.push({
    time: lastTs,
    open: +lastOpen.toFixed(2),
    high: +Math.max(lastOpen, currentPrice).toFixed(2),
    low: +Math.min(lastOpen, currentPrice).toFixed(2),
    close: +currentPrice.toFixed(2),
  });
  return candles;
}

export default function TenMinChart({ ticker, currentPrice }: { ticker: string; currentPrice: number }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const candleMapRef = useRef<Map<number, { time: number; open: number; high: number; low: number; close: number }>>(new Map());
  const [stockId, setStockId] = useState<string | null>(null);
  const [useFallback, setUseFallback] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    supabase.from('stocks').select('id').eq('ticker', ticker).single().then(({ data }) => {
      if (data) setStockId(data.id);
    });
  }, [ticker]);

  // 차트 초기화
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const el = chartContainerRef.current;
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#111215' },
        textColor: '#9ca3af',
      },
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      width: el.clientWidth || 600,
      height: 340,
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#1f2937' },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#F23645',
      downColor: '#089981',
      borderVisible: false,
      wickUpColor: '#F23645',
      wickDownColor: '#089981',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (el) chart.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, []);

  // 데이터 로드 & 실시간 구독
  useEffect(() => {
    if (!stockId || !seriesRef.current) return;

    const series = seriesRef.current;
    const map = candleMapRef.current;

    const since = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();

    supabase
      .from('trades')
      .select('price, created_at')
      .eq('stock_id', stockId)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (data && data.length >= 2) {
          const candles = groupToCandles(data);
          map.clear();
          candles.forEach((c) => map.set(c.time, c));
          series.setData(candles as any);
          chartRef.current?.timeScale().scrollToRealTime();
          setUseFallback(false);
        } else {
          // 데이터 없음 → 시뮬레이션 폴백
          const fallback = makeFallbackCandles(stockId, currentPrice);
          map.clear();
          fallback.forEach((c) => map.set(c.time, c));
          series.setData(fallback as any);
          chartRef.current?.timeScale().scrollToRealTime();
          setUseFallback(true);
        }
      });

    // 실시간 구독 (실 데이터 있을 때만 의미 있음)
    const channel = supabase
      .channel(`10m_${stockId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trades', filter: `stock_id=eq.${stockId}` }, (payload) => {
        const t = payload.new as { price: number; created_at: string };
        const ts = Math.floor(floorToInterval(new Date(t.created_at).getTime()) / 1000);
        const c = map.get(ts);
        if (!c) {
          const nc = { time: ts, open: t.price, high: t.price, low: t.price, close: t.price };
          map.set(ts, nc);
          series.update(nc as any);
        } else {
          c.close = t.price;
          if (t.price > c.high) c.high = t.price;
          if (t.price < c.low) c.low = t.price;
          series.update(c as any);
        }
        setUseFallback(false);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [stockId]);

  return (
    <div className="w-full bg-panel border border-border rounded-xl overflow-hidden">
      <div className="bg-panel2 py-2 px-4 border-b border-border font-bold text-tx text-[13px] flex items-center gap-2">
        <span>10분봉 차트</span>
        {useFallback ? (
          <span className="text-[10px] font-normal text-warn/80 bg-warn/10 px-1.5 py-px rounded">시뮬레이션</span>
        ) : (
          <span className="text-[10px] font-normal text-dim">실시간 체결 기반</span>
        )}
      </div>
      <div ref={chartContainerRef} className="w-full" />
    </div>
  );
}
