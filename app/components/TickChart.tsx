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

const INTERVAL_MS = 10 * 60 * 1000; // 10분

function floorToInterval(ts: number) {
  return Math.floor(ts / INTERVAL_MS) * INTERVAL_MS;
}

/** trades 테이블에서 가져온 데이터로 10분봉 집계 */
function groupToCandles(
  trades: { price: number; created_at: string }[]
): CandleData[] {
  const map = new Map<number, CandleData>();
  for (const t of trades) {
    const ts = floorToInterval(new Date(t.created_at).getTime()) / 1000;
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
      .single()
      .then(({ data }: { data: { id: string } | null }) => {
        if (data && !isDisposedRef.current) setStockId(data.id);
      });
  }, [ticker]);

  // 4. 메인 차트 및 보조지표 라인 시리즈 초기화
  useEffect(() => {
    if (!mainChartContainerRef.current) return;
    isDisposedRef.current = false;

    const el = mainChartContainerRef.current;
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#090B0F' },
        textColor: '#9CA3AF',
      },
      grid: {
        vertLines: { color: '#161B22' },
        horzLines: { color: '#161B22' },
      },
      width: el.clientWidth || 600,
      height: el.clientHeight || 340,
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#212631' },
      rightPriceScale: { borderColor: '#212631' },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#F04452',
      downColor: '#3182F6',
      borderVisible: false,
      wickUpColor: '#F04452',
      wickDownColor: '#3182F6',
    });

    // MA 라인 시리즈 생성 (노랑, 주황, 보라, 청록)
    const ma5Series = chart.addSeries(LineSeries, { color: '#F59E0B', lineWidth: 2, priceLineVisible: false });
    const ma20Series = chart.addSeries(LineSeries, { color: '#F97316', lineWidth: 2, priceLineVisible: false });
    const ma60Series = chart.addSeries(LineSeries, { color: '#A855F7', lineWidth: 2, priceLineVisible: false });
    const ma120Series = chart.addSeries(LineSeries, { color: '#06B6D4', lineWidth: 2, priceLineVisible: false });

    // 볼린저밴드 시리즈 생성 (상단: 청색, 중간선: 점선, 하단: 청색)
    const bbUpper = chart.addSeries(LineSeries, { color: '#3B82F6', lineWidth: 1, lineStyle: LineStyle.Solid, priceLineVisible: false });
    const bbMiddle = chart.addSeries(LineSeries, { color: '#60A5FA', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false });
    const bbLower = chart.addSeries(LineSeries, { color: '#3B82F6', lineWidth: 1, lineStyle: LineStyle.Solid, priceLineVisible: false });

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
            height: el.clientHeight || 340,
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
        textColor: '#9CA3AF',
      },
      grid: {
        vertLines: { color: '#161B22' },
        horzLines: { color: '#161B22' },
      },
      width: rsiEl.clientWidth || 600,
      height: 100,
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#212631' },
      rightPriceScale: { borderColor: '#212631', scaleMargins: { top: 0.1, bottom: 0.1 } },
    });

    const rsiSeries = rsiChart.addSeries(LineSeries, {
      color: '#EC4899',
      lineWidth: 2,
      priceLineVisible: false,
    });

    // 70(과매수), 30(과매도) 가이드 기준선 추가
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

    // 캔들 데이터 기반 RSI 즉각 반영
    const candles = Array.from(candleMapRef.current.values()).sort((a, b) => a.time - b.time);
    if (candles.length > 0) {
      const rsiPoints = calculateRSI(candles, settings.rsiPeriod);
      rsiSeries.setData(rsiPoints as any);
    }

    const roRsi = new ResizeObserver(() => {
      if (rsiEl && rsiChartRef.current) {
        try {
          rsiChart.applyOptions({ width: rsiEl.clientWidth, height: 100 });
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

      // MA 지표 업데이트
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

      // 볼린저밴드 업데이트
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

      // RSI 서브 차트 업데이트
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
    const since = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();

    supabase
      .from('trades')
      .select('price, created_at')
      .eq('stock_id', stockId)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .then(({ data }: { data: Array<{ price: number; created_at: string }> | null }) => {
        if (isDisposedRef.current || !candleSeriesRef.current) return;
        try {
          if (data && data.length > 0) {
            const candles = groupToCandles(data);
            map.clear();
            candles.forEach((c) => map.set(c.time, c));
            series.setData(candles as any);
            updateAllIndicators(candles);
            mainChartRef.current?.timeScale().scrollToRealTime();
          } else {
            // DB 체결 데이터가 아직 없는 경우 현재가 기반 실시간 베이스 캔들
            const nowTs = Math.floor(floorToInterval(Date.now()) / 1000);
            const baseCandle = {
              time: nowTs,
              open: currentPrice,
              high: currentPrice,
              low: currentPrice,
              close: currentPrice,
            };
            map.clear();
            map.set(nowTs, baseCandle);
            series.setData([baseCandle] as any);
            updateAllIndicators([baseCandle]);
          }
        } catch {}
      });

    // 실시간 체결 구독
    const channel = supabase
      .channel(`10m_${stockId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trades', filter: `stock_id=eq.${stockId}` },
        (payload: { new: Record<string, unknown> }) => {
          if (isDisposedRef.current || !candleSeriesRef.current) return;
          try {
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

            // 실시간 캔들 변경에 따른 지표 재계산
            const allCandles = Array.from(map.values()).sort((a, b) => a.time - b.time);
            updateAllIndicators(allCandles);
          } catch {}
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stockId, currentPrice, supabase, updateAllIndicators]);

  return (
    <StrictWidget className="h-full flex flex-col" overflowClass="overflow-hidden">
      {/* ── 1. 차트 상단 툴바: 지표 토글 및 범례 ── */}
      <div className="bg-[#0E1117] py-2 px-3.5 border-b border-[#212631] text-xs font-mono flex items-center justify-between flex-wrap gap-2 select-none">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
          <span className="font-extrabold text-white text-[12px] flex items-center gap-1.5 shrink-0">
            <span>📈</span>
            <span>10분봉</span>
          </span>

          <div className="h-3 w-px bg-[#212631]" />

          {/* 이동평균선(MA) 토글 버튼군 */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => updateSettings({ showMA5: !settings.showMA5 })}
              className={`px-2 py-0.5 rounded text-[10.5px] font-bold border transition-colors cursor-pointer ${
                settings.showMA5
                  ? 'bg-[#F59E0B]/20 text-[#F59E0B] border-[#F59E0B]/50'
                  : 'bg-[#161B22] text-[#565A63] border-[#212631] hover:text-white'
              }`}
            >
              MA5
            </button>
            <button
              onClick={() => updateSettings({ showMA20: !settings.showMA20 })}
              className={`px-2 py-0.5 rounded text-[10.5px] font-bold border transition-colors cursor-pointer ${
                settings.showMA20
                  ? 'bg-[#F97316]/20 text-[#F97316] border-[#F97316]/50'
                  : 'bg-[#161B22] text-[#565A63] border-[#212631] hover:text-white'
              }`}
            >
              MA20
            </button>
            <button
              onClick={() => updateSettings({ showMA60: !settings.showMA60 })}
              className={`px-2 py-0.5 rounded text-[10.5px] font-bold border transition-colors cursor-pointer ${
                settings.showMA60
                  ? 'bg-[#A855F7]/20 text-[#A855F7] border-[#A855F7]/50'
                  : 'bg-[#161B22] text-[#565A63] border-[#212631] hover:text-white'
              }`}
            >
              MA60
            </button>
            <button
              onClick={() => updateSettings({ showMA120: !settings.showMA120 })}
              className={`px-2 py-0.5 rounded text-[10.5px] font-bold border transition-colors cursor-pointer ${
                settings.showMA120
                  ? 'bg-[#06B6D4]/20 text-[#06B6D4] border-[#06B6D4]/50'
                  : 'bg-[#161B22] text-[#565A63] border-[#212631] hover:text-white'
              }`}
            >
              MA120
            </button>
          </div>

          <div className="h-3 w-px bg-[#212631]" />

          {/* 볼린저밴드 & RSI 토글 버튼 */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => updateSettings({ showBB: !settings.showBB })}
              className={`px-2 py-0.5 rounded text-[10.5px] font-bold border transition-colors cursor-pointer ${
                settings.showBB
                  ? 'bg-[#3B82F6]/20 text-[#3B82F6] border-[#3B82F6]/50'
                  : 'bg-[#161B22] text-[#565A63] border-[#212631] hover:text-white'
              }`}
            >
              볼린저밴드 (BB)
            </button>
            <button
              onClick={() => updateSettings({ showRSI: !settings.showRSI })}
              className={`px-2 py-0.5 rounded text-[10.5px] font-bold border transition-colors cursor-pointer ${
                settings.showRSI
                  ? 'bg-[#EC4899]/20 text-[#EC4899] border-[#EC4899]/50'
                  : 'bg-[#161B22] text-[#565A63] border-[#212631] hover:text-white'
              }`}
            >
              RSI (14)
            </button>
          </div>
        </div>

        {/* 우측 설정 톱니바퀴 버튼 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettingsModal(!showSettingsModal)}
            className="p-1 rounded-lg hover:bg-[#161B22] text-[#8E939D] hover:text-white transition-colors text-[11px] font-bold border border-[#212631] px-2 flex items-center gap-1 cursor-pointer"
          >
            <span>⚙️</span>
            <span>지표 설정</span>
          </button>
          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20 hidden sm:inline-block">
            LIVE DB
          </span>
        </div>
      </div>

      {/* ── 지표 커스텀 파라미터 모달 ── */}
      {showSettingsModal && (
        <div className="bg-[#141721] p-3.5 border-b border-[#212631] text-xs font-mono flex items-center justify-between gap-4 flex-wrap z-10">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[#8E939D]">RSI 기간:</span>
              <input
                type="number"
                min="5"
                max="50"
                value={settings.rsiPeriod}
                onChange={(e) => updateSettings({ rsiPeriod: Number(e.target.value) || 14 })}
                className="w-14 bg-[#05070A] border border-[#212631] rounded px-2 py-0.5 text-white text-center"
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
                className="w-14 bg-[#05070A] border border-[#212631] rounded px-2 py-0.5 text-white text-center"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[#8E939D]">BB 표준편차(k):</span>
              <input
                type="number"
                min="1"
                max="4"
                step="0.5"
                value={settings.bbStdDev}
                onChange={(e) => updateSettings({ bbStdDev: Number(e.target.value) || 2 })}
                className="w-14 bg-[#05070A] border border-[#212631] rounded px-2 py-0.5 text-white text-center"
              />
            </div>
          </div>
          <button
            onClick={() => setShowSettingsModal(false)}
            className="px-3 py-1 rounded bg-[#212631] hover:bg-[#3182F6] text-white font-bold text-[11px] transition-colors cursor-pointer"
          >
            닫기
          </button>
        </div>
      )}

      {/* ── 2. 메인 차트 컨테이너 ── */}
      <div ref={mainChartContainerRef} className="w-full flex-1 min-h-[260px]" />

      {/* ── 3. RSI 서브 패널 (토글 활성화 시) ── */}
      {settings.showRSI && (
        <div className="border-t border-[#212631] bg-[#05070A] p-1 flex flex-col">
          <div className="px-2 py-0.5 text-[10px] font-bold text-[#EC4899] flex items-center justify-between">
            <span>RSI ({settings.rsiPeriod})</span>
            <span className="text-[#565A63]">과매수(70) / 과매도(30)</span>
          </div>
          <div ref={rsiChartContainerRef} className="w-full h-24" />
        </div>
      )}
    </StrictWidget>
  );
}
