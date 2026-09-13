'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  LineSeries,
  LineStyle,
} from 'lightweight-charts';
import StrictWidget from './StrictWidget';
import {
  CandleData,
  calculateSMA,
  calculateBollingerBands,
  calculateRSI,
} from '@/lib/indicators';

type TimeUnit = '10m' | '1h' | '1d' | '1M';

const INTERVAL_MS: Record<TimeUnit, number> = {
  '10m': 10 * 60 * 1000,
  '1h':  60 * 60 * 1000,
  '1d':  24 * 60 * 60 * 1000,
  '1M':  30 * 24 * 60 * 60 * 1000,
};

const TIME_UNIT_LABEL: Record<TimeUnit, string> = {
  '10m': '10분',
  '1h':  '1시간',
  '1d':  '1일',
  '1M':  '1개월',
};

function floorToInterval(ts: number, intervalMs: number) {
  return Math.floor(ts / intervalMs) * intervalMs;
}

/** trades 테이블에서 가져온 데이터로 주어진 interval 단위 캔들 집계 */
function groupToCandles(
  trades: { price: number; created_at: string }[],
  intervalMs: number
): CandleData[] {
  const map = new Map<number, CandleData>();
  for (const t of trades) {
    const ts = floorToInterval(new Date(t.created_at).getTime(), intervalMs) / 1000;
    const c = map.get(ts);
    if (!c) {
      map.set(ts, { time: ts, open: t.price, high: t.price, low: t.price, close: t.price });
    } else {
      c.close = t.price;
      if (t.price > c.high) c.high = t.price;
      if (t.price < c.low) c.low = t.price;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

interface IndicatorSettings {
  showMA5: boolean;
  showMA20: boolean;
  showMA60: boolean;
  showMA120: boolean;
  showBB: boolean;
  showRSI: boolean;
  rsiPeriod: number;
  bbPeriod: number;
  bbStdDev: number;
}

const DEFAULT_SETTINGS: IndicatorSettings = {
  showMA5: true,
  showMA20: true,
  showMA60: false,
  showMA120: false,
  showBB: false,
  showRSI: false,
  rsiPeriod: 14,
  bbPeriod: 20,
  bbStdDev: 2,
};

function getStockTickSize(price: number, ticker: string): number {
  if (price <= 0) return 1;
  const isUS = price < 1000 && !ticker.match(/^\d{6}$/);
  if (isUS) return 0.01;
  if (price < 2000) return 1;
  if (price < 5000) return 5;
  if (price < 20000) return 10;
  if (price < 50000) return 50;
  if (price < 200000) return 100;
  if (price < 500000) return 500;
  return 1000;
}

const STORAGE_KEY = 'stock_sys_indicator_settings';

export default function TickChart({
  ticker,
  currentPrice,
}: {
  ticker: string;
  currentPrice: number;
}) {
  const mainChartContainerRef = useRef<HTMLDivElement>(null);
  const rsiChartContainerRef = useRef<HTMLDivElement>(null);

  // 차트 인스턴스 참조
  const mainChartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);

  // 메인 시리즈 참조
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ma5SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma60SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma120SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // 볼린저밴드 시리즈 참조
  const bbUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbMiddleSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // RSI 시리즈 참조
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const candleMapRef = useRef<Map<number, CandleData>>(new Map());
  const isDisposedRef = useRef(false);
  const [stockId, setStockId] = useState<string | null>(null);

  // 타임프레임 상태
  const [timeUnit, setTimeUnit] = useState<TimeUnit>('10m');

  // 크로스헤어 OHLC 상태
  const [ohlcInfo, setOhlcInfo] = useState<{ time: string; open: number; high: number; low: number; close: number } | null>(null);

  // 지표 설정 상태
  const [settings, setSettings] = useState<IndicatorSettings>(DEFAULT_SETTINGS);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);

  const supabase = createClient();

  // 1. 로컬스토리지에서 지표 설정 로드
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setSettings(JSON.parse(saved));
      }
    } catch {
      // 로컬스토리지 오류 무시
    }
  }, []);

  // 2. 지표 설정 변경 시 로컬스토리지 저장
  const updateSettings = useCallback((newSettings: Partial<IndicatorSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // 로컬스토리지 오류 무시
      }
      return updated;
    });
  }, []);

  // 3. 종목 ID 조회
  useEffect(() => {
    const client = createClient();
    client
      .from('stocks')
      .select('id')
      .eq('ticker', ticker)
      .maybeSingle()
      .then(({ data }: { data: { id: string } | null }) => {
        if (data?.id && !isDisposedRef.current) setStockId(data.id);
      });
  }, [ticker]);

  // 4. 메인 차트 및 보조지표 라인 시리즈 초기화
  useEffect(() => {
    const el = mainChartContainerRef.current;
    if (!el) return;

    isDisposedRef.current = false;

    const tickSize = getStockTickSize(currentPrice, ticker);
    const isUS = tickSize === 0.01;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#090B0F' },
        textColor: '#8E939D',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      width: el.clientWidth || 600,
      height: el.clientHeight || 320,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#1e2230',
        barSpacing: 12,
        minBarSpacing: 4,
        rightOffset: 6,
      },
      rightPriceScale: {
        borderColor: '#1e2230',
        scaleMargins: { top: 0.1, bottom: 0.08 },
        autoScale: true,
      },
    });

    // 가격축 minMove 강제 정렬 (100원 단위 등 거래소 틱 기준)
    chart.priceScale('right').applyOptions({ autoScale: true });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#F04452',
      downColor: '#3182F6',
      borderVisible: false,
      wickUpColor: '#F04452',
      wickDownColor: '#3182F6',
      priceFormat: {
        type: 'price',
        precision: isUS ? 2 : 0,
        minMove: tickSize,
      },
    });

    // MA 라인 시리즈 생성 (노랑, 주황, 보라, 청록)
    const ma5Series = chart.addSeries(LineSeries, {
      color: '#F59E0B',
      lineWidth: 2,
      priceLineVisible: false,
      priceFormat: { type: 'price', precision: isUS ? 2 : 0, minMove: tickSize },
    });
    const ma20Series = chart.addSeries(LineSeries, {
      color: '#F97316',
      lineWidth: 2,
      priceLineVisible: false,
      priceFormat: { type: 'price', precision: isUS ? 2 : 0, minMove: tickSize },
    });
    const ma60Series = chart.addSeries(LineSeries, {
      color: '#A855F7',
      lineWidth: 2,
      priceLineVisible: false,
      priceFormat: { type: 'price', precision: isUS ? 2 : 0, minMove: tickSize },
    });
    const ma120Series = chart.addSeries(LineSeries, {
      color: '#06B6D4',
      lineWidth: 2,
      priceLineVisible: false,
      priceFormat: { type: 'price', precision: isUS ? 2 : 0, minMove: tickSize },
    });

    // 볼린저밴드 시리즈 생성 (상단: 청색, 중간선: 점선, 하단: 청색)
    const bbUpper = chart.addSeries(LineSeries, {
      color: '#3B82F6',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      priceFormat: { type: 'price', precision: isUS ? 2 : 0, minMove: tickSize },
    });
    const bbMiddle = chart.addSeries(LineSeries, {
      color: '#60A5FA',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      priceFormat: { type: 'price', precision: isUS ? 2 : 0, minMove: tickSize },
    });
    const bbLower = chart.addSeries(LineSeries, {
      color: '#3B82F6',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      priceFormat: { type: 'price', precision: isUS ? 2 : 0, minMove: tickSize },
    });

    mainChartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    ma5SeriesRef.current = ma5Series;
    ma20SeriesRef.current = ma20Series;
    ma60SeriesRef.current = ma60Series;
    ma120SeriesRef.current = ma120Series;
    bbUpperSeriesRef.current = bbUpper;
    bbMiddleSeriesRef.current = bbMiddle;
    bbLowerSeriesRef.current = bbLower;

    const ro = new ResizeObserver(() => {
      if (el && !isDisposedRef.current && mainChartRef.current) {
        try {
          chart.applyOptions({
            width: el.clientWidth,
            height: el.clientHeight || 320,
          });
        } catch {
          // ignore
        }
      }
    });
    ro.observe(el);

    return () => {
      isDisposedRef.current = true;
      ro.disconnect();
      mainChartRef.current = null;
      candleSeriesRef.current = null;
      ma5SeriesRef.current = null;
      ma20SeriesRef.current = null;
      ma60SeriesRef.current = null;
      ma120SeriesRef.current = null;
      bbUpperSeriesRef.current = null;
      bbMiddleSeriesRef.current = null;
      bbLowerSeriesRef.current = null;
      try {
        chart.remove();
      } catch {
        // ignore
      }
    };
  }, []);

  // 5. RSI 서브 차트 패널 초기화 (settings.showRSI 활성화 시)
  useEffect(() => {
    if (!settings.showRSI || !rsiChartContainerRef.current) {
      if (rsiChartRef.current) {
        try {
          rsiChartRef.current.remove();
        } catch {}
        rsiChartRef.current = null;
        rsiSeriesRef.current = null;
      }
      return;
    }

    const rsiEl = rsiChartContainerRef.current;
    const rsiChart = createChart(rsiEl, {
      layout: {
        background: { type: ColorType.Solid, color: '#05070A' },
        textColor: '#8E939D',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      width: rsiEl.clientWidth || 600,
      height: 90,
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#1e2230' },
      rightPriceScale: { borderColor: '#1e2230', scaleMargins: { top: 0.1, bottom: 0.1 } },
    });

    const rsiSeries = rsiChart.addSeries(LineSeries, {
      color: '#EC4899',
      lineWidth: 2,
      priceLineVisible: false,
    });

    rsiSeries.createPriceLine({ price: 70, color: '#F04452', lineWidth: 1, lineStyle: LineStyle.Dashed, title: '과매수 70' });
    rsiSeries.createPriceLine({ price: 30, color: '#3182F6', lineWidth: 1, lineStyle: LineStyle.Dashed, title: '과매도 30' });

    rsiChartRef.current = rsiChart;
    rsiSeriesRef.current = rsiSeries;

    // 메인 차트와 타임스케일 동기화
    const mainChart = mainChartRef.current;
    if (mainChart) {
      mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range && rsiChartRef.current) {
          rsiChartRef.current.timeScale().setVisibleLogicalRange(range);
        }
      });
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range && mainChartRef.current) {
          mainChartRef.current.timeScale().setVisibleLogicalRange(range);
        }
      });
    }

    const candles = Array.from(candleMapRef.current.values()).sort((a, b) => a.time - b.time);
    if (candles.length > 0) {
      const rsiPoints = calculateRSI(candles, settings.rsiPeriod);
      rsiSeries.setData(rsiPoints as any);
    }

    const roRsi = new ResizeObserver(() => {
      if (rsiEl && rsiChartRef.current) {
        try {
          rsiChart.applyOptions({ width: rsiEl.clientWidth, height: 90 });
        } catch {}
      }
    });
    roRsi.observe(rsiEl);

    return () => {
      roRsi.disconnect();
      rsiChartRef.current = null;
      rsiSeriesRef.current = null;
      try {
        rsiChart.remove();
      } catch {}
    };
  }, [settings.showRSI, settings.rsiPeriod]);

  // 6. 모든 지표 시리즈 데이터 재계산 및 렌더링
  const updateAllIndicators = useCallback(
    (candles: CandleData[]) => {
      if (candles.length === 0) return;

      if (ma5SeriesRef.current) {
        const ma5Data = settings.showMA5 ? calculateSMA(candles, 5) : [];
        ma5SeriesRef.current.setData(ma5Data as any);
      }
      if (ma20SeriesRef.current) {
        const ma20Data = settings.showMA20 ? calculateSMA(candles, 20) : [];
        ma20SeriesRef.current.setData(ma20Data as any);
      }
      if (ma60SeriesRef.current) {
        const ma60Data = settings.showMA60 ? calculateSMA(candles, 60) : [];
        ma60SeriesRef.current.setData(ma60Data as any);
      }
      if (ma120SeriesRef.current) {
        const ma120Data = settings.showMA120 ? calculateSMA(candles, 120) : [];
        ma120SeriesRef.current.setData(ma120Data as any);
      }

      if (bbUpperSeriesRef.current && bbMiddleSeriesRef.current && bbLowerSeriesRef.current) {
        if (settings.showBB) {
          const bb = calculateBollingerBands(candles, settings.bbPeriod, settings.bbStdDev);
          bbUpperSeriesRef.current.setData(bb.upper as any);
          bbMiddleSeriesRef.current.setData(bb.middle as any);
          bbLowerSeriesRef.current.setData(bb.lower as any);
        } else {
          bbUpperSeriesRef.current.setData([]);
          bbMiddleSeriesRef.current.setData([]);
          bbLowerSeriesRef.current.setData([]);
        }
      }

      if (rsiSeriesRef.current && settings.showRSI) {
        const rsiData = calculateRSI(candles, settings.rsiPeriod);
        rsiSeriesRef.current.setData(rsiData as any);
      }
    },
    [settings]
  );

  // 7. DB 체결 데이터 로드 & 실시간 구독
  useEffect(() => {
    if (!stockId || !candleSeriesRef.current || isDisposedRef.current) return;

    const series = candleSeriesRef.current;
    const map = candleMapRef.current;
    const currentIntervalMs = INTERVAL_MS[timeUnit];

    const lookbackMs: Record<TimeUnit, number> = {
      '10m': 12 * 60 * 60 * 1000,
      '1h':  7 * 24 * 60 * 60 * 1000,
      '1d':  365 * 24 * 60 * 60 * 1000,
      '1M':  3 * 365 * 24 * 60 * 60 * 1000,
    };
    const since = new Date(Date.now() - lookbackMs[timeUnit]).toISOString();

    supabase
      .from('trades')
      .select('price, created_at')
      .eq('stock_id', stockId)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .then(({ data }: { data: Array<{ price: number; created_at: string }> | null }) => {
        if (isDisposedRef.current || !candleSeriesRef.current) return;
        try {
          map.clear();
          if (data && data.length > 5) {
            const candles = groupToCandles(data, currentIntervalMs);
            candles.forEach((c) => map.set(c.time, c));
            series.setData(candles as any);
            updateAllIndicators(candles);
            mainChartRef.current?.timeScale().scrollToRealTime();
            const last = candles[candles.length - 1];
            if (last) {
              setOhlcInfo({
                time: `${TIME_UNIT_LABEL[timeUnit]}봉`,
                open: last.open,
                high: last.high,
                low: last.low,
                close: last.close,
              });
            }
          } else {
            // 합성 캔들: 랜덤 워크 누적 방식, 최소 ±1.5% 진폭 보장
            const tick = getStockTickSize(currentPrice, ticker);
            const alignP = (v: number) => (tick < 1 ? Number(v.toFixed(2)) : Math.round(v / tick) * tick);

            const candles: CandleData[] = [];
            const nowTs = Math.floor(floorToInterval(Date.now(), currentIntervalMs) / 1000);

            // 시작점을 현재가 -1.5% 에서 시작하는 랜덤 워크
            const startPrice = alignP(currentPrice * 0.985);
            let prevClose = startPrice;

            for (let i = 29; i >= 0; i--) {
              const candleTime = nowTs - i * Math.floor(currentIntervalMs / 1000);
              const openP = prevClose;

              let closeP: number;
              if (i === 0) {
                closeP = alignP(currentPrice); // 마지막 봉은 현재가 정확히
              } else {
                // 캔들당 ±0.3~0.7% 랜덤 워크
                const stepPct = (Math.random() - 0.46) * 0.008;
                closeP = alignP(prevClose * (1 + stepPct));
              }

              // 고가/저가: 캔들 범위의 30~80% 추가 돌출
              const bodyHigh = Math.max(openP, closeP);
              const bodyLow = Math.min(openP, closeP);
              const bodySize = Math.max(tick * 2, bodyHigh - bodyLow);
              const highP = alignP(bodyHigh + bodySize * (0.3 + Math.random() * 0.5));
              const lowP = alignP(bodyLow - bodySize * (0.3 + Math.random() * 0.5));

              const cData: CandleData = {
                time: candleTime,
                open: openP,
                high: Math.max(highP, openP, closeP),
                low: Math.min(lowP, openP, closeP),
                close: closeP,
              };
              candles.push(cData);
              map.set(candleTime, cData);
              prevClose = closeP;
            }

            series.setData(candles as any);

            // autoScale을 강제 재적용하여 전체 범위가 Y축에 반영되도록
            mainChartRef.current?.priceScale('right').applyOptions({
              autoScale: true,
              scaleMargins: { top: 0.12, bottom: 0.12 },
            });

            updateAllIndicators(candles);
            mainChartRef.current?.timeScale().fitContent();
            const lastCandle = candles[candles.length - 1];
            if (lastCandle) {
              setOhlcInfo({
                time: `${TIME_UNIT_LABEL[timeUnit]}봉`,
                open: lastCandle.open,
                high: lastCandle.high,
                low: lastCandle.low,
                close: currentPrice,
              });
            }
          }
        } catch {}
      });

    // 실시간 체결 구독
    const channel = supabase
      .channel(`candle_${timeUnit}_${stockId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trades', filter: `stock_id=eq.${stockId}` },
        (payload: { new: Record<string, unknown> }) => {
          if (isDisposedRef.current || !candleSeriesRef.current) return;
          try {
            const t = payload.new as { price: number; created_at: string };
            const tick = getStockTickSize(t.price, ticker);
            const rawP = Number(t.price);
            const alignedPrice = tick < 1 ? Number(rawP.toFixed(2)) : Math.round(rawP / tick) * tick;

            const ts = Math.floor(floorToInterval(new Date(t.created_at).getTime(), currentIntervalMs) / 1000);
            const c = map.get(ts);
            if (!c) {
              const nc = { time: ts, open: alignedPrice, high: alignedPrice, low: alignedPrice, close: alignedPrice };
              map.set(ts, nc);
              series.update(nc as any);
              setOhlcInfo({ time: `${TIME_UNIT_LABEL[timeUnit]}봉`, open: nc.open, high: nc.high, low: nc.low, close: nc.close });
            } else {
              c.close = alignedPrice;
              if (alignedPrice > c.high) c.high = alignedPrice;
              if (alignedPrice < c.low) c.low = alignedPrice;
              series.update(c as any);
              setOhlcInfo({ time: `${TIME_UNIT_LABEL[timeUnit]}봉`, open: c.open, high: c.high, low: c.low, close: c.close });
            }
            const allCandles = Array.from(map.values()).sort((a, b) => a.time - b.time);
            updateAllIndicators(allCandles);
          } catch {}
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stockId, timeUnit, supabase, updateAllIndicators]);

  // ── 5. 호가/체결 주가 변화 0ms 실시간 차트 캔들 즉각 동기화 ──
  useEffect(() => {
    if (isDisposedRef.current || !candleSeriesRef.current || !currentPrice || currentPrice <= 0) return;

    try {
      const currentIntervalMs = INTERVAL_MS[timeUnit];
      const nowTs = Math.floor(floorToInterval(Date.now(), currentIntervalMs) / 1000);
      const tick = getStockTickSize(currentPrice, ticker);
      const alignedPrice = tick < 1 ? Number(currentPrice.toFixed(2)) : Math.round(currentPrice / tick) * tick;
      const map = candleMapRef.current;

      const existing = map.get(nowTs);
      if (existing) {
        existing.close = alignedPrice;
        if (alignedPrice > existing.high) existing.high = alignedPrice;
        if (alignedPrice < existing.low) existing.low = alignedPrice;
        candleSeriesRef.current.update(existing as any);
        setOhlcInfo({
          time: `${TIME_UNIT_LABEL[timeUnit]}봉`,
          open: existing.open,
          high: existing.high,
          low: existing.low,
          close: existing.close,
        });
      } else {
        // 새 인터벌 봉 생성
        const lastCandle = Array.from(map.values()).sort((a, b) => a.time - b.time).pop();
        const openP = lastCandle ? lastCandle.close : alignedPrice;
        const newCandle: CandleData = {
          time: nowTs,
          open: openP,
          high: Math.max(openP, alignedPrice),
          low: Math.min(openP, alignedPrice),
          close: alignedPrice,
        };
        map.set(nowTs, newCandle);
        candleSeriesRef.current.update(newCandle as any);
        setOhlcInfo({
          time: `${TIME_UNIT_LABEL[timeUnit]}봉`,
          open: newCandle.open,
          high: newCandle.high,
          low: newCandle.low,
          close: newCandle.close,
        });
      }

      // 보조지표 실시간 갱신
      const allCandles = Array.from(map.values()).sort((a, b) => a.time - b.time);
      updateAllIndicators(allCandles);
    } catch {}
  }, [currentPrice, ticker, timeUnit, updateAllIndicators]);

  // 플로팅 트레이딩뷰 도구 바 상태
  const [showToolsDrawer, setShowToolsDrawer] = useState(false);

  return (
    <StrictWidget className="h-full flex flex-col relative" overflowClass="overflow-hidden">
      {/* ── 1. 차트 상단 헤더 (토스 스타일 깔끔한 단일 행) ── */}
      <div className="bg-[#090B0F] py-2.5 px-4 border-b border-[#1e2230] flex items-center justify-between gap-3 select-none shrink-0 font-sans">
        <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-black text-white font-mono tracking-tight">{ticker}</span>
            <span className="text-xs font-bold text-[#8E939D] bg-white/[0.06] px-2 py-0.5 rounded-full font-mono">
              {TIME_UNIT_LABEL[timeUnit]}
            </span>
          </div>

          {/* OHLC 실시간 칩 */}
          {ohlcInfo && (
            <div className="flex items-center gap-2 text-xs font-mono text-[#8E939D] pl-2 border-l border-[#1e2230]">
              <span>시 <span className="text-white font-bold tabular-nums">{ohlcInfo.open.toLocaleString()}</span></span>
              <span>고 <span className="text-up font-bold tabular-nums">{ohlcInfo.high.toLocaleString()}</span></span>
              <span>저 <span className="text-down font-bold tabular-nums">{ohlcInfo.low.toLocaleString()}</span></span>
              <span>종 <span className={`font-bold tabular-nums ${ohlcInfo.close >= ohlcInfo.open ? 'text-up' : 'text-down'}`}>{ohlcInfo.close.toLocaleString()}</span></span>
            </div>
          )}
        </div>

        {/* 우측 상태 뱃지 */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-up/10 border border-[#F04452]/30 text-[10.5px] font-bold text-up">
            <span className="w-1.5 h-1.5 rounded-full bg-up animate-pulse" />
            LIVE
          </span>
        </div>
      </div>

      {/* ── 2. 메인 차트 캔버스 영역 ── */}
      <div className="relative flex-1 w-full overflow-hidden bg-[#090B0F]">
        <div ref={mainChartContainerRef} className="w-full h-full" />
      </div>

      {/* ── 3. RSI 서브 패널 (토글 활성화 시) ── */}
      {settings.showRSI && (
        <div className="border-t border-[#1e2230] bg-[#05070A] p-1 flex flex-col shrink-0">
          <div className="px-3 py-1 text-[10.5px] font-bold text-[#EC4899] flex items-center justify-between font-mono">
            <span>RSI ({settings.rsiPeriod})</span>
            <span className="text-[#565A63]">과매수(70) / 과매도(30)</span>
          </div>
          <div ref={rsiChartContainerRef} className="w-full h-20" />
        </div>
      )}

      {/* ── 4. 차트 하단 바 (좌: 타임프레임 | 우: 지표 & 도구 슬라이드바) ── */}
      <div className="bg-[#090B0F] py-2 px-3 sm:px-4 border-t border-[#1e2230] flex items-center justify-between gap-2 shrink-0 font-sans select-none">
        {/* 좌측: 타임프레임 선택 탭 */}
        <div className="flex items-center gap-1 bg-[#141721] p-1 rounded-xl border border-border">
          {(['10m', '1h', '1d', '1M'] as TimeUnit[]).map((u) => (
            <button
              key={u}
              onClick={() => setTimeUnit(u)}
              className={`rounded-lg px-3 py-1 text-[11.5px] font-bold transition-all cursor-pointer font-sans ${
                timeUnit === u
                  ? 'bg-up text-white shadow-[0_0_10px_rgba(240,68,82,0.4)]'
                  : 'text-[#8E939D] hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              {TIME_UNIT_LABEL[u]}
            </button>
          ))}
        </div>

        {/* 우측: 지표 & 도구 슬라이드바 (문구 삭제 및 도구 배치) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {showToolsDrawer && (
            <div className="flex items-center gap-1 bg-[#141721] p-1 rounded-xl border border-border animate-fade-in-up font-mono">
              <button
                onClick={() => updateSettings({ showMA5: !settings.showMA5 })}
                className={`px-2 py-0.5 rounded-lg text-[10.5px] font-bold transition-all cursor-pointer ${
                  settings.showMA5 ? 'bg-[#F59E0B] text-black font-black shadow-[0_0_6px_#F59E0B]' : 'text-[#8E939D] hover:text-white'
                }`}
              >
                MA5
              </button>
              <button
                onClick={() => updateSettings({ showMA20: !settings.showMA20 })}
                className={`px-2 py-0.5 rounded-lg text-[10.5px] font-bold transition-all cursor-pointer ${
                  settings.showMA20 ? 'bg-[#F97316] text-black font-black shadow-[0_0_6px_#F97316]' : 'text-[#8E939D] hover:text-white'
                }`}
              >
                MA20
              </button>
              <button
                onClick={() => updateSettings({ showMA60: !settings.showMA60 })}
                className={`px-2 py-0.5 rounded-lg text-[10.5px] font-bold transition-all cursor-pointer ${
                  settings.showMA60 ? 'bg-[#A855F7] text-white font-black shadow-[0_0_6px_#A855F7]' : 'text-[#8E939D] hover:text-white'
                }`}
              >
                MA60
              </button>
              <button
                onClick={() => updateSettings({ showMA120: !settings.showMA120 })}
                className={`px-2 py-0.5 rounded-lg text-[10.5px] font-bold transition-all cursor-pointer ${
                  settings.showMA120 ? 'bg-[#06B6D4] text-black font-black shadow-[0_0_6px_#06B6D4]' : 'text-[#8E939D] hover:text-white'
                }`}
              >
                MA120
              </button>
              <div className="h-3 w-px bg-[#212631] mx-0.5" />
              <button
                onClick={() => updateSettings({ showBB: !settings.showBB })}
                className={`px-2 py-0.5 rounded-lg text-[10.5px] font-bold transition-all cursor-pointer ${
                  settings.showBB ? 'bg-[#3B82F6] text-white font-black shadow-[0_0_6px_#3B82F6]' : 'text-[#8E939D] hover:text-white'
                }`}
              >
                BB
              </button>
              <button
                onClick={() => updateSettings({ showRSI: !settings.showRSI })}
                className={`px-2 py-0.5 rounded-lg text-[10.5px] font-bold transition-all cursor-pointer ${
                  settings.showRSI ? 'bg-[#EC4899] text-white font-black shadow-[0_0_6px_#EC4899]' : 'text-[#8E939D] hover:text-white'
                }`}
              >
                RSI
              </button>
              <button
                onClick={() => setShowSettingsModal(!showSettingsModal)}
                className="px-1.5 py-0.5 rounded-lg text-[10.5px] text-[#8E939D] hover:text-white transition-colors cursor-pointer"
                title="지표 설정"
              >
                ⚙️
              </button>
            </div>
          )}

          {/* 메인 토글 버튼 */}
          <button
            onClick={() => setShowToolsDrawer(!showToolsDrawer)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-xl border transition-all text-[11.5px] font-bold cursor-pointer font-sans shrink-0 ${
              showToolsDrawer
                ? 'bg-down border-[#3182F6] text-white shadow-[0_0_10px_rgba(49,130,246,0.4)]'
                : 'bg-[#141721] border-border text-[#8E939D] hover:text-white hover:border-white/20'
            }`}
          >
            <span>🛠️</span>
            <span>지표 & 도구</span>
          </button>
        </div>
      </div>

      {/* ── 5. 지표 상세 설정 모달 (필요 시) ── */}
      {showSettingsModal && (
        <div className="absolute inset-x-4 top-14 z-30 bg-[#141721]/95 backdrop-blur-xl p-4 rounded-2xl border border-border shadow-2xl text-xs font-mono flex items-center justify-between gap-4 flex-wrap animate-fade-in-up">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[#8E939D]">RSI 기간:</span>
              <input
                type="number"
                min="5"
                max="50"
                value={settings.rsiPeriod}
                onChange={(e) => updateSettings({ rsiPeriod: Number(e.target.value) || 14 })}
                className="w-14 bg-[#05070A] border border-border rounded-lg px-2 py-1 text-white text-center font-bold"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[#8E939D]">BB 기간:</span>
              <input
                type="number"
                min="5"
                max="50"
                value={settings.bbPeriod}
                onChange={(e) => updateSettings({ bbPeriod: Number(e.target.value) || 20 })}
                className="w-14 bg-[#05070A] border border-border rounded-lg px-2 py-1 text-white text-center font-bold"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[#8E939D]">BB 승수(k):</span>
              <input
                type="number"
                min="1"
                max="4"
                step="0.5"
                value={settings.bbStdDev}
                onChange={(e) => updateSettings({ bbStdDev: Number(e.target.value) || 2 })}
                className="w-14 bg-[#05070A] border border-border rounded-lg px-2 py-1 text-white text-center font-bold"
              />
            </div>
          </div>
          <button
            onClick={() => setShowSettingsModal(false)}
            className="px-3.5 py-1.5 rounded-xl bg-down hover:bg-[#2b72d6] text-white font-bold text-[11.5px] transition-colors cursor-pointer"
          >
            확인
          </button>
        </div>
      )}
    </StrictWidget>
  );
}
