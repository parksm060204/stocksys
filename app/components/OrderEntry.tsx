"use client";

import { useEffect, useState } from "react";
import type { Stock } from "@/lib/types";
import { fmtPrice } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

export default function OrderEntry({ stock }: { stock: Stock }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState(String(stock.currentPrice));
  const [qty, setQty] = useState("10");
  const [stockId, setStockId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [userCash, setUserCash] = useState<number | null>(null);
  const [userHoldingQty, setUserHoldingQty] = useState<number | null>(null);

  const supabase = createClient();

  useEffect(() => {
    const initData = async () => {
      const { data: stockData } = await supabase.from('stocks').select('id').eq('ticker', stock.ticker).single();
      if (stockData) setStockId(stockData.id);

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: profile } = await supabase.from('profiles').select('cash').eq('id', session.user.id).single();
        if (profile) setUserCash(profile.cash);

        if (stockData) {
          const { data: holding } = await supabase.from('holdings').select('quantity').eq('user_id', session.user.id).eq('stock_id', stockData.id).single();
          if (holding) setUserHoldingQty(holding.quantity);
        }
      }
    };
    initData();
  }, [stock.ticker, supabase]);

  const total = (Number(price) || 0) * (Number(qty) || 0);

  const handleQuickBuy = (pct: number) => {
    setSide("buy");
    const targetPrice = Number(price) || stock.currentPrice;
    if (userCash && targetPrice > 0) {
      const maxAffordableQty = Math.floor((userCash * (pct / 100)) / targetPrice);
      setQty(String(Math.max(1, maxAffordableQty)));
    } else {
      setQty("10");
    }
  };

  const handleQuickSell = (pct: number) => {
    setSide("sell");
    if (userHoldingQty && userHoldingQty > 0) {
      const calculatedQty = Math.floor(userHoldingQty * (pct / 100));
      setQty(String(Math.max(1, calculatedQty)));
    } else {
      setQty("10");
    }
  };

  const handleOrder = async () => {
    if (!stockId || loading) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        alert("로그인 후 이용 가능합니다.");
        return;
      }

      if (side === 'buy') {
        const { data: profile } = await supabase.from('profiles').select('cash').eq('id', session.user.id).single();
        if (!profile || profile.cash < total) {
          alert("예수금이 부족합니다.");
          return;
        }
      } else {
        const { data: holding } = await supabase.from('holdings').select('quantity').eq('user_id', session.user.id).eq('stock_id', stockId).single();
        if (!holding || holding.quantity < Number(qty)) {
          alert("보유 수량이 부족합니다.");
          return;
        }
      }

      const { error } = await supabase.from('orders').insert({
        stock_id: stockId,
        user_id: session.user.id,
        side,
        price: Number(price),
        size: Number(qty),
        is_lp: false,
        status: 'open'
      });

      if (error) {
        console.error(error);
        alert("주문 접수 실패");
      } else {
        alert("주문이 성공적으로 접수되었습니다!");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full flex flex-col h-full bg-[#090a0f] border border-[#222736] rounded-md overflow-hidden">
      {/* Tab Switcher */}
      <div className="grid grid-cols-2 border-b border-[#222736]">
        <button
          onClick={() => setSide("buy")}
          className={`py-2.5 text-[13px] font-bold transition-all cursor-pointer ${
            side === "buy" 
              ? "bg-[#FF453A]/15 text-[#FF453A] border-b-2 border-[#FF453A]" 
              : "bg-[#141721] text-gray-400 hover:text-white"
          }`}
        >
          🔴 매수
        </button>
        <button
          onClick={() => setSide("sell")}
          className={`py-2.5 text-[13px] font-bold transition-all border-l border-[#222736] cursor-pointer ${
            side === "sell" 
              ? "bg-[#0A84FF]/15 text-[#0A84FF] border-b-2 border-[#0A84FF]" 
              : "bg-[#141721] text-gray-400 hover:text-white"
          }`}
        >
          🔵 매도
        </button>
      </div>

      <div className="space-y-4 p-3.5 flex-1 flex flex-col justify-between">
        <div className="space-y-3">
          <Field label="주문 가격 (원)">
            <div className="relative">
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full border border-[#222736] bg-[#090a0f] px-3 py-2 text-right font-mono text-[13px] text-[#f3f4f6] font-bold outline-none focus:border-[#FF453A]"
              />
              <button 
                onClick={() => setPrice(String(stock.currentPrice))}
                className="absolute left-2 top-2 text-[10px] text-gray-500 hover:text-white bg-[#1c202c] px-1.5 py-0.5 rounded"
              >
                현재가
              </button>
            </div>
          </Field>

          <Field label="주문 수량 (주)">
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-full border border-[#222736] bg-[#090a0f] px-3 py-2 text-right font-mono text-[13px] text-[#f3f4f6] font-bold outline-none focus:border-[#0A84FF]"
            />
          </Field>

          {/* 수량 프리셋 버튼 */}
          <div className="flex gap-1.5">
            {["10", "50", "100", "500"].map((q) => (
              <button
                key={q}
                onClick={() => setQty(q)}
                className="flex-1 border border-[#222736] bg-[#141721] py-1 text-[11px] font-mono text-gray-300 hover:bg-[#1c202c] hover:text-white transition-all cursor-pointer"
              >
                {q}주
              </button>
            ))}
          </div>

          {/* ⚡ 초고속 매매 패널 (Quick Scalping Panel) */}
          <div className="pt-2 border-t border-[#222736]/60">
            <span className="text-[10px] uppercase font-bold tracking-wider text-gray-400 block mb-2">
              ⚡ 초고속 시장가 스캘핑
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => handleQuickBuy(10)}
                className="btn-glow-red border border-[#FF453A]/40 bg-[#FF453A]/10 text-[#FF453A] py-1.5 text-[11px] font-bold rounded cursor-pointer"
              >
                🔴 10% 시장가 매수
              </button>
              <button
                onClick={() => handleQuickBuy(50)}
                className="btn-glow-red border border-[#FF453A]/40 bg-[#FF453A]/10 text-[#FF453A] py-1.5 text-[11px] font-bold rounded cursor-pointer"
              >
                🔴 50% 시장가 매수
              </button>
              <button
                onClick={() => handleQuickSell(10)}
                className="btn-glow-blue border border-[#0A84FF]/40 bg-[#0A84FF]/10 text-[#0A84FF] py-1.5 text-[11px] font-bold rounded cursor-pointer"
              >
                🔵 10% 시장가 매도
              </button>
              <button
                onClick={() => handleQuickSell(100)}
                className="btn-glow-blue border border-[#0A84FF]/40 bg-[#0A84FF]/10 text-[#0A84FF] py-1.5 text-[11px] font-bold rounded cursor-pointer"
              >
                🔵 전량(100%) 매도
              </button>
            </div>
          </div>
        </div>

        <div>
          {/* 예상 금액 요약 */}
          <div className="flex items-center justify-between bg-[#141721] px-3 py-2.5 mb-3 border border-[#222736] rounded">
            <span className="text-[11px] text-gray-400 font-medium">총 주문 예상금액</span>
            <span className="font-mono text-[14px] font-extrabold tabular-nums text-[#f3f4f6]">
              {fmtPrice(total, stock.market)}
            </span>
          </div>

          <button
            onClick={handleOrder}
            disabled={loading}
            className={`w-full py-3 text-[14px] font-black transition-all rounded cursor-pointer ${
              side === "buy" 
                ? "bg-[#FF453A] text-white hover:bg-[#e0382e] shadow-[0_0_15px_rgba(255,69,58,0.35)]" 
                : "bg-[#0A84FF] text-white hover:bg-[#0071e3] shadow-[0_0_15px_rgba(10,132,255,0.35)]"
            }`}
          >
            {loading ? "주문 처리 중..." : side === "buy" ? "🔴 매수 주문 실행" : "🔵 매도 주문 실행"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-[#9ca3af] font-medium">{label}</span>
      {children}
    </label>
  );
}
