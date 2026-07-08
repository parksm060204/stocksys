'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickSeries } from 'lightweight-charts';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export default function TickChart({ ticker }: { ticker: string }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [stockId, setStockId] = useState<string | null>(null);

  useEffect(() => {
    const initStock = async () => {
      const { data } = await supabase.from('stocks').select('id').eq('ticker', ticker).single();
      if (data) setStockId(data.id);
    };
    initStock();
  }, [ticker]);

  useEffect(() => {
    if (!chartContainerRef.current || !stockId) return;

    // 차트 초기화
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#1a1a1a' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#333' },
        horzLines: { color: '#333' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#F23645', // 한국식: 빨강이 상승
      downColor: '#089981', // 파랑/초록이 하락
      borderVisible: false,
      wickUpColor: '#F23645',
      wickDownColor: '#089981',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Resize handler
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    let currentCandle: any = null;
    
    const fetchTrades = async () => {
      // 초기 렌더링 시 최근 100건 정도만 가져와서 표시
      const { data } = await supabase
        .from('trades')
        .select('*')
        .eq('stock_id', stockId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (data && data.length > 0) {
        const reversed = [...data].reverse();
        const ohlcData = reversed.map((t, idx) => {
          const time = new Date(t.created_at).getTime() / 1000;
          return {
            time: time as any, // lightweight-charts 타임스탬프 형식
            open: t.price,
            high: t.price,
            low: t.price,
            close: t.price,
          };
        });
        
        // 중복 시간 제거를 위해 단순 매핑
        const uniqueData = ohlcData.reduce((acc: any[], curr) => {
          if (acc.length === 0 || acc[acc.length-1].time !== curr.time) {
            acc.push(curr);
          } else {
            acc[acc.length-1].close = curr.close;
            acc[acc.length-1].high = Math.max(acc[acc.length-1].high, curr.high);
            acc[acc.length-1].low = Math.min(acc[acc.length-1].low, curr.low);
          }
          return acc;
        }, []);

        series.setData(uniqueData);
        if (uniqueData.length > 0) {
          currentCandle = uniqueData[uniqueData.length - 1];
        }
      }
    };

    fetchTrades();

    // 실시간 구독
    const channel = supabase.channel(`trades_changes_${stockId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trades', filter: `stock_id=eq.${stockId}` }, (payload) => {
        const trade = payload.new;
        const tradeTime = Math.floor(new Date(trade.created_at).getTime() / 1000) as any;

        if (!currentCandle || currentCandle.time !== tradeTime) {
          // 새 캔들
          currentCandle = {
            time: tradeTime,
            open: trade.price,
            high: trade.price,
            low: trade.price,
            close: trade.price,
          };
        } else {
          // 캔들 업데이트
          currentCandle.close = trade.price;
          currentCandle.high = Math.max(currentCandle.high, trade.price);
          currentCandle.low = Math.min(currentCandle.low, trade.price);
        }

        series.update(currentCandle);
      })
      .subscribe();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      supabase.removeChannel(channel);
    };
  }, [stockId]);

  return (
    <div className="w-full bg-panel border border-border rounded-xl overflow-hidden">
      <div className="bg-panel2 py-2 px-4 border-b border-border font-bold text-tx">
        실시간 체결 틱 차트 (Tick Chart)
      </div>
      <div ref={chartContainerRef} className="w-full" />
    </div>
  );
}
