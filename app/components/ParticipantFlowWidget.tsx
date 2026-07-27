"use client";

import { useEffect, useState } from "react";
import StrictWidget from "./StrictWidget";
import { createClient } from "@/lib/supabase/client";

interface FlowData {
  type: string;
  netAmount: number; // in 억 원
  trend: string; // "매수" | "매도"
}

export default function ParticipantFlowWidget({ stockId }: { stockId: string }) {
  const [flows, setFlows] = useState<FlowData[]>([
    { type: "외국계", netAmount: 0, trend: "-" },
    { type: "기관", netAmount: 0, trend: "-" },
    { type: "개인", netAmount: 0, trend: "-" },
  ]);

  useEffect(() => {
    const supabase = createClient();
    let isMounted = true;

    const loadInitialData = async () => {
      // 오늘 생성된 체결만 가져오는 로직 (데모를 위해 전체 체결을 가져오되 최적화 필요)
      const { data } = await supabase.from('trades').select('price, size, buyer_is_bot, seller_is_bot').eq('stock_id', stockId);
      if (data && isMounted) {
        let instNet = 0;
        let retailNet = 0;
        let foreignNet = 0; // 외국계는 데모용으로 0으로 두거나 랜덤 변동

        for (const t of data) {
          const volInEok = (t.price * t.size) / 100000000;
          if (t.buyer_is_bot) instNet += volInEok;
          else retailNet += volInEok;

          if (t.seller_is_bot) instNet -= volInEok;
          else retailNet -= volInEok;
        }

        setFlows([
          { type: "외국계", netAmount: foreignNet, trend: "-" },
          { type: "기관", netAmount: instNet, trend: instNet > 0 ? "순매수" : instNet < 0 ? "순매도" : "-" },
          { type: "개인", netAmount: retailNet, trend: retailNet > 0 ? "순매수" : retailNet < 0 ? "순매도" : "-" },
        ]);
      }
    };

    loadInitialData();

    const channel = supabase
      .channel(`flow-${stockId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trades', filter: `stock_id=eq.${stockId}` }, (payload: { new: { price: number; size: number; buyer_is_bot: boolean; seller_is_bot: boolean } }) => {
        const t = payload.new;
        const volInEok = (t.price * t.size) / 100000000;
        
        setFlows(prev => {
          const next = [...prev];
          
          if (t.buyer_is_bot) next[1].netAmount += volInEok;
          else next[2].netAmount += volInEok;

          if (t.seller_is_bot) next[1].netAmount -= volInEok;
          else next[2].netAmount -= volInEok;

          next[1].trend = next[1].netAmount > 0 ? "순매수" : next[1].netAmount < 0 ? "순매도" : "-";
          next[2].trend = next[2].netAmount > 0 ? "순매수" : next[2].netAmount < 0 ? "순매도" : "-";
          return next;
        });
      })
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [stockId]);

  return (
    <StrictWidget title="투자자별 매매동향" className="h-[140px]">
      <div className="flex flex-col h-full bg-[#000]">
        {/* 헤더 */}
        <div className="grid grid-cols-[1fr_1fr_1fr] border-b border-[#333] px-3 py-1.5 bg-[#111]">
          <span className="text-[11px] text-gray-500 font-medium">투자자구분</span>
          <span className="text-[11px] text-gray-500 font-medium text-right">순매수(억)</span>
          <span className="text-[11px] text-gray-500 font-medium text-right">증감방향</span>
        </div>

        {/* 바디 */}
        <div className="flex-1 overflow-hidden px-3 py-1">
          {flows.map((flow) => {
            const isBuy = flow.netAmount > 0;
            const isSell = flow.netAmount < 0;
            const colorClass = isBuy ? "text-red-400" : isSell ? "text-blue-400" : "text-gray-400";
            const sign = isBuy ? "+" : ""; // minus sign is included in number naturally if negative

            return (
              <div
                key={flow.type}
                className="grid grid-cols-[1fr_1fr_1fr] border-b border-[#222] last:border-0 py-1.5 items-center hover:bg-[#111] transition-none"
              >
                <span className="text-[12px] text-gray-300 font-bold">[{flow.type}]</span>
                <span className={`text-[12px] font-mono tabular-nums text-right font-semibold ${colorClass}`}>
                  {sign}{flow.netAmount.toLocaleString()}
                </span>
                <span className={`text-[11px] text-right font-bold tracking-widest ${colorClass}`}>
                  {isBuy ? "▲" : isSell ? "▼" : "-"} {flow.trend}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </StrictWidget>
  );
}
