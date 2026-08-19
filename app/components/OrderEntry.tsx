"use client";

import { useEffect, useState, useCallback } from "react";
import type { Stock } from "@/lib/types";
import { fmtPrice } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { submitAndMatchOrder } from "@/lib/engine/dbMatching";
import { useToast } from "@/app/components/ToastProvider";

export default function OrderEntry({ stock }: { stock: Stock }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState(String(stock.currentPrice));
  const [qty, setQty] = useState("10");
  const [stockId, setStockId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [userCash, setUserCash] = useState<number | null>(null);
  const [userHoldingQty, setUserHoldingQty] = useState<number | null>(null);

  const supabase = createClient();
  const { userId, isLoggedIn } = useAuth();
  const { showToast } = useToast();

  const refreshUserBalances = useCallback(async (sId: string) => {
    if (!isLoggedIn || !userId) return;
    const { data: profile } = await supabase.from('profiles').select('cash').eq('id', userId).single();
    if (profile) setUserCash(Number(profile.cash || 0));

    const { data: holding } = await supabase.from('holdings').select('quantity').eq('user_id', userId).eq('stock_id', sId).single();
    setUserHoldingQty(holding ? Number(holding.quantity || 0) : 0);
  }, [isLoggedIn, userId, supabase]);

  useEffect(() => {
    const initData = async () => {
      const { data: stockData } = await supabase.from('stocks').select('id').eq('ticker', stock.ticker).single();
      if (stockData) {
        setStockId(stockData.id);
        if (isLoggedIn && userId) {
          refreshUserBalances(stockData.id);
        }
      }
    };
    initData();
  }, [stock.ticker, supabase, isLoggedIn, userId, refreshUserBalances]);

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
      if (!isLoggedIn || !userId) {
        showToast({
          type: 'warn',
          title: '로그인 필요',
          description: '가상 주식 거래는 로그인 후 이용 가능합니다.',
        });
        return;
      }

      if (side === 'buy') {
        const { data: profile } = await supabase.from('profiles').select('cash').eq('id', userId).single();
        if (!profile || Number(profile.cash || 0) < total) {
          showToast({
            type: 'error',
            title: '예수금 부족',
            description: `주문 금액(₩${total.toLocaleString()})이 현재 예수금보다 큽니다.`,
          });
          return;
        }
      } else {
        const { data: holding } = await supabase.from('holdings').select('quantity').eq('user_id', userId).eq('stock_id', stockId).single();
        if (!holding || Number(holding.quantity || 0) < Number(qty)) {
          showToast({
            type: 'error',
            title: '보유 수량 부족',
            description: `매도 주문 수량(${Number(qty).toLocaleString()}주)이 보유 주식보다 많습니다.`,
          });
          return;
        }
      }

      const res = await submitAndMatchOrder(supabase, {
        stock_id: stockId,
        user_id: userId,
        side,
        price: Number(price),
        size: Number(qty)
      });

      if (res.success) {
        showToast({
          type: res.filledQty > 0 ? (side === 'buy' ? 'buy' : 'sell') : 'info',
          title: res.filledQty > 0 ? `${stock.name} 주문 체결 완료` : `${stock.name} 주문 접수 완료`,
          description: res.message,
        });
        refreshUserBalances(stockId);
      } else {
        showToast({
          type: 'error',
          title: '주문 실패',
          description: res.message,
        });
      }
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="w-full flex flex-col h-full bg-[#0E1117] border border-[#212631] rounded-2xl overflow-hidden shadow-2xl">
      {/* Tab Switcher */}
      <div className="grid grid-cols-2 border-b border-[#212631] bg-[#090B0F]">
        <button
          onClick={() => setSide("buy")}
          className={`py-3 text-[13.5px] font-black transition-all cursor-pointer ${
            side === "buy" 
              ? "bg-[#F04452]/15 text-[#F04452] border-b-2 border-[#F04452]" 
              : "text-[#8E939D] hover:text-white"
          }`}
        >
          매수 (BUY)
        </button>
        <button
          onClick={() => setSide("sell")}
          className={`py-3 text-[13.5px] font-black transition-all border-l border-[#212631] cursor-pointer ${
            side === "sell" 
              ? "bg-[#3182F6]/15 text-[#3182F6] border-b-2 border-[#3182F6]" 
              : "text-[#8E939D] hover:text-white"
          }`}
        >
          매도 (SELL)
        </button>
      </div>

      <div className="space-y-4 p-4 flex-1 flex flex-col justify-between">
        <div className="space-y-3.5">
          <Field label="주문 가격">
            <div className="relative">
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={`w-full rounded-xl border border-[#212631] bg-[#05070A] px-3.5 py-2.5 text-right font-mono text-[13.5px] text-white font-black outline-none ${
                  side === "buy" ? "focus:border-[#F04452]" : "focus:border-[#3182F6]"
                }`}
              />
              <button 
                onClick={() => setPrice(String(stock.currentPrice))}
                className="absolute left-2.5 top-2 text-[10.5px] text-[#8E939D] hover:text-white bg-[#161B22] border border-[#212631] px-2 py-0.5 rounded-md font-bold"
              >
                현재가
              </button>
            </div>
          </Field>

          <Field label="주문 수량 (주)">
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={`w-full rounded-xl border border-[#212631] bg-[#05070A] px-3.5 py-2.5 text-right font-mono text-[13.5px] text-white font-black outline-none ${
                side === "buy" ? "focus:border-[#F04452]" : "focus:border-[#3182F6]"
              }`}
            />
          </Field>

          {/* 수량 프리셋 버튼 */}
          <div className="flex gap-1.5">
            {["10", "50", "100", "500"].map((q) => (
              <button
                key={q}
                onClick={() => setQty(q)}
                className="flex-1 rounded-lg border border-[#212631] bg-[#161B22] py-1 text-[11px] font-mono font-bold text-[#8E939D] hover:bg-white/10 hover:text-white transition-all cursor-pointer"
              >
                {q}주
              </button>
            ))}
          </div>

          {/* 초고속 매매 패널 */}
          <div className="pt-3 border-t border-[#212631]">
            <span className="text-[10px] uppercase font-bold tracking-wider text-[#8E939D] block mb-2 font-mono">
              QUICK ORDER SCALPING
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleQuickBuy(10)}
                className="border border-[#F04452]/40 bg-[#F04452]/10 text-[#F04452] hover:bg-[#F04452]/20 py-2 text-[11px] font-extrabold rounded-xl transition-all cursor-pointer"
              >
                10% 시장가 매수
              </button>
              <button
                onClick={() => handleQuickBuy(50)}
                className="border border-[#F04452]/40 bg-[#F04452]/10 text-[#F04452] hover:bg-[#F04452]/20 py-2 text-[11px] font-extrabold rounded-xl transition-all cursor-pointer"
              >
                50% 시장가 매수
              </button>
              <button
                onClick={() => handleQuickSell(10)}
                className="border border-[#3182F6]/40 bg-[#3182F6]/10 text-[#3182F6] hover:bg-[#3182F6]/20 py-2 text-[11px] font-extrabold rounded-xl transition-all cursor-pointer"
              >
                10% 시장가 매도
              </button>
              <button
                onClick={() => handleQuickSell(100)}
                className="border border-[#3182F6]/40 bg-[#3182F6]/10 text-[#3182F6] hover:bg-[#3182F6]/20 py-2 text-[11px] font-extrabold rounded-xl transition-all cursor-pointer"
              >
                전량(100%) 매도
              </button>
            </div>
          </div>
        </div>

        <div>
          {/* 예상 금액 요약 */}
          <div className="flex items-center justify-between bg-[#161B22] px-3.5 py-2.5 mb-3 border border-[#212631] rounded-xl">
            <span className="text-[11.5px] text-[#8E939D] font-medium">총 주문 예상금액</span>
            <span className="font-mono text-[14.5px] font-black tabular-nums text-white">
              {fmtPrice(total, stock.market)}
            </span>
          </div>

          <button
            onClick={handleOrder}
            disabled={loading}
            className={`w-full py-3.5 text-[14px] font-black transition-all rounded-full cursor-pointer shadow-lg active:scale-[0.98] ${
              side === "buy" 
                ? "bg-[#F04452] text-white hover:bg-[#ff5252] shadow-[0_0_20px_rgba(240,68,82,0.35)]" 
                : "bg-[#3182F6] text-white hover:bg-[#4092ff] shadow-[0_0_20px_rgba(49,130,246,0.35)]"
            }`}
          >
            {loading ? "주문 처리 중..." : side === "buy" ? "매수 주문 제출 (BUY)" : "매도 주문 제출 (SELL)"}
          </button>
        </div>
      </div>
    </div>
  );
}


function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-[#8E939D] font-bold">{label}</span>
      {children}
    </label>
  );
}

