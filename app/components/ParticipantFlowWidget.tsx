"use client";

import { useEffect, useState } from "react";
import StrictWidget from "./StrictWidget";
import { createClient, getTradeDedupKey, subscribeStockTradesWithInitialLoad } from "@/lib/db/client";

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
    if (!stockId) return;
    const db = createClient();
    let isMounted = true;
    const seenKeys = new Set<string>();

    setFlows([
      { type: "외국계", netAmount: 0, trend: "-" },
      { type: "기관", netAmount: 0, trend: "-" },
      { type: "개인", netAmount: 0, trend: "-" },
    ]);

    const cleanupStream = subscribeStockTradesWithInitialLoad(db, {
      stockId,
      selectColumns: "id, price, size, buyer_is_bot, seller_is_bot, created_at, sequence, cursor",
      initialLimit: 5000,
      channelName: `flow-${stockId}`,
      onInitial: (rows, error) => {
        if (!isMounted || error) return;
        seenKeys.clear();
        let instNet = 0;
        let retailNet = 0;
        const foreignNet = 0;

        for (const row of rows) {
          seenKeys.add(getTradeDedupKey(row));
          const price = Number(row.price);
          const size = Number(row.size);
          if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0) continue;
          const volInEok = (price * size) / 100000000;
          if (row.buyer_is_bot) instNet += volInEok;
          else retailNet += volInEok;

          if (row.seller_is_bot) instNet -= volInEok;
          else retailNet -= volInEok;
        }

        setFlows([
          { type: "외국계", netAmount: foreignNet, trend: "-" },
          { type: "기관", netAmount: instNet, trend: instNet > 0 ? "순매수" : instNet < 0 ? "순매도" : "-" },
          { type: "개인", netAmount: retailNet, trend: retailNet > 0 ? "순매수" : retailNet < 0 ? "순매도" : "-" },
        ]);
      },
      onInsert: (row) => {
        if (!isMounted) return;
        const key = getTradeDedupKey(row);
        if (seenKeys.has(key)) return;
        seenKeys.add(key);

        const price = Number(row.price);
        const size = Number(row.size);
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0) return;
        const volInEok = (price * size) / 100000000;

        setFlows((prev) => {
          const nextInst = prev[1].netAmount + (row.buyer_is_bot ? volInEok : 0) - (row.seller_is_bot ? volInEok : 0);
          const nextRetail = prev[2].netAmount + (!row.buyer_is_bot ? volInEok : 0) - (!row.seller_is_bot ? volInEok : 0);
          return [
            { ...prev[0] },
            {
              ...prev[1],
              netAmount: nextInst,
              trend: nextInst > 0 ? "순매수" : nextInst < 0 ? "순매도" : "-",
            },
            {
              ...prev[2],
              netAmount: nextRetail,
              trend: nextRetail > 0 ? "순매수" : nextRetail < 0 ? "순매도" : "-",
            },
          ];
        });
      },
    });

    return () => {
      isMounted = false;
      cleanupStream();
    };
  }, [stockId]);

  return (
    <StrictWidget title="투자자별 매매동향" className="h-[140px]">
      <div className="flex flex-col h-full bg-[#000]">
        {/* 헤더 */}
        <div className="grid grid-cols-[1fr_1fr_1fr] border-b border-[#333] px-3 py-1.5 bg-[#111]">
          <span className="text-xs text-gray-500 font-medium">투자자구분</span>
          <span className="text-xs text-gray-500 font-medium text-right">순매수(억)</span>
          <span className="text-xs text-gray-500 font-medium text-right">증감방향</span>
        </div>

        {/* 바디 */}
        <div className="flex-1 overflow-hidden px-3 py-1">
          {flows.map((flow) => {
            const isBuy = flow.netAmount > 0;
            const isSell = flow.netAmount < 0;
            const colorClass = isBuy ? "text-up" : isSell ? "text-down" : "text-gray-400";
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
                <span className={`text-xs text-right font-bold tracking-widest ${colorClass}`}>
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
