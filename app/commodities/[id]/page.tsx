import Link from "next/link";
import { notFound } from "next/navigation";
import { change, fmtSigned, fmtPrice } from "@/lib/format";
import RealtimePriceHeader from "@/app/components/RealtimePriceHeader";
import Orderbook from "@/app/components/Orderbook";
import TradeFeed from "@/app/components/TradeFeed";
import OrderEntry from "@/app/components/OrderEntry";
import TickChart from "@/app/components/TickChart";
import StrictWidget from "@/app/components/StrictWidget";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 0;

export default async function CommodityDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: row } = await supabase.from('commodities').select('*').eq('commodity_id', id).single();
  if (!row) notFound();

  const commodity = {
    id: row.id,
    name: row.name,
    ticker: row.ticker,
    market: "commodities",
    sector: "원자재",
    currentPrice: row.current_price,
    previousClose: row.previous_price,
    description: row.description || "",
    unit: row.unit,
    tickSize: row.tick_size,
    tickValue: row.tick_value,
    marginRequirement: row.margin_requirement,
  };

  const { percent, amount, dir } = change(commodity.currentPrice, commodity.previousClose);
  const color = dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-muted";

  return (
    <div className="flex h-[calc(100vh-48px)] flex-col bg-bg text-tx font-mono overflow-hidden selection:bg-hl selection:text-bg">
      {/* Top Header */}
      <div className="flex-none border-b border-bd bg-bg px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/commodities" className="text-muted hover:text-tx text-sm flex items-center gap-1 transition-colors">
            ← <span className="underline decoration-bd underline-offset-4">목록</span>
          </Link>
          <div className="h-4 w-px bg-bd"></div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight">{commodity.name}</h1>
            <span className="text-xs text-muted border border-bd px-1 py-0.5">{commodity.ticker}</span>
          </div>
          <RealtimePriceHeader stock={commodity as any} />
        </div>
        <div className="flex items-center gap-4 text-sm tabular-nums">
          <div className="flex items-center gap-2">
            <span className="text-dim">전일대비</span>
            <span className={color}>{fmtSigned(amount)} ({fmtSigned(percent)}%)</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="h-full grid grid-cols-12 gap-0">
          
          {/* L: Chart + Info */}
          <div className="col-span-12 lg:col-span-8 flex flex-col border-r border-bd">
            <div className="flex-1 min-h-[400px]">
              <StrictWidget title="TICK CHART">
                <TickChart ticker={commodity.ticker} currentPrice={commodity.currentPrice} />
              </StrictWidget>
            </div>
            
            <div className="h-48 border-t border-bd bg-bg-alt flex flex-col">
              <div className="border-b border-bd px-3 py-1.5 text-[11px] font-bold text-dim flex items-center gap-2">
                <span>[INFO]</span>
                <span className="text-tx">COMMODITY SPECIFICATION</span>
              </div>
              <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-[10px] text-dim mb-1">계약 단위</div>
                  <div className="font-semibold">{commodity.unit}</div>
                </div>
                <div>
                  <div className="text-[10px] text-dim mb-1">틱 사이즈</div>
                  <div className="font-semibold">{commodity.tickSize}</div>
                </div>
                <div>
                  <div className="text-[10px] text-dim mb-1">틱 가치</div>
                  <div className="font-semibold">{fmtPrice(commodity.tickValue, 'overseas')}</div>
                </div>
                <div>
                  <div className="text-[10px] text-dim mb-1">증거금</div>
                  <div className="font-semibold">{fmtPrice(commodity.marginRequirement, 'overseas')}</div>
                </div>
              </div>
              <div className="px-3 pb-3 text-[12px] text-muted flex-1 overflow-y-auto">
                {commodity.description}
              </div>
            </div>
          </div>

          {/* R: Orderbook + Order Entry */}
          <div className="col-span-12 lg:col-span-4 flex flex-col bg-bg">
            <div className="flex-1 flex flex-col sm:flex-row lg:flex-col overflow-hidden">
              <div className="flex-1 sm:w-1/2 lg:w-full border-b sm:border-b-0 sm:border-r lg:border-r-0 lg:border-b border-bd min-h-[300px]">
                <StrictWidget title="ORDERBOOK">
                  <Orderbook ticker={commodity.ticker} currentPrice={commodity.currentPrice} />
                </StrictWidget>
              </div>
              
              <div className="h-[250px] sm:h-auto sm:w-1/2 lg:w-full lg:h-[250px] border-b sm:border-b-0 lg:border-b border-bd">
                <StrictWidget title="TIME & SALES">
                  <TradeFeed stock={commodity as any} />
                </StrictWidget>
              </div>
            </div>
            
            <div className="flex-none p-3 bg-bg-alt">
              <div className="mb-2 text-[11px] font-bold text-dim flex items-center gap-2">
                <span>[TERMINAL]</span>
                <span className="text-tx">ORDER ENTRY</span>
              </div>
              {/* OrderEntry 컴포넌트는 stock 객체를 받습니다 */}
              <OrderEntry stock={commodity as any} />
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
