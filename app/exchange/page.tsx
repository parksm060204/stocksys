"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";

interface ExchangeRate {
  currency_code: string;
  currency_name: string;
  rate_to_krw: number;
  updated_at: string;
}

interface UserBalances {
  cash: number;
  usd_balance: number;
  eur_balance: number;
  jpy_balance: number;
  cny_balance: number;
  gbp_balance: number;
}

const CURRENCY_ICONS: Record<string, string> = {
  KRW: "₩",
  USD: "$",
  EUR: "€",
  JPY: "¥",
  CNY: "元",
  GBP: "£",
};

const CURRENCY_NAMES: Record<string, string> = {
  KRW: "원화",
  USD: "달러",
  EUR: "유로",
  JPY: "엔화",
  CNY: "위안화",
  GBP: "파운드",
};

export default function CurrencyExchangePage() {
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [prevRates, setPrevRates] = useState<Record<string, number>>({});
  const [balances, setBalances] = useState<UserBalances>({
    cash: 0,
    usd_balance: 0,
    eur_balance: 0,
    jpy_balance: 0,
    cny_balance: 0,
    gbp_balance: 0,
  });
  const { userId, isLoggedIn } = useAuth();

  // Exchange Form State
  const [fromCur, setFromCur] = useState<string>("KRW");
  const [toCur, setToCur] = useState<string>("USD");
  const [fromAmount, setFromAmount] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const supabase = createClient();

  const fetchRatesAndBalances = useCallback(async (uid: string | null) => {
    // 1. Fetch rates
    const { data: ratesData } = await supabase.from("exchange_rates").select("*").order("currency_code");
    if (ratesData) {
      setRates((prev) => {
        const mapping: Record<string, number> = {};
        prev.forEach((r) => {
          mapping[r.currency_code] = r.rate_to_krw;
        });
        setPrevRates(mapping);
        return ratesData;
      });
    }

    if (!uid) return;

    // 2. Fetch user balances
    const { data: profile } = await supabase
      .from("profiles")
      .select("cash, usd_balance, eur_balance, jpy_balance, cny_balance, gbp_balance")
      .eq("id", uid)
      .single();
    if (profile) {
      setBalances({
        cash: Number(profile.cash),
        usd_balance: Number(profile.usd_balance),
        eur_balance: Number(profile.eur_balance),
        jpy_balance: Number(profile.jpy_balance),
        cny_balance: Number(profile.cny_balance),
        gbp_balance: Number(profile.gbp_balance),
      });
    }
  }, [supabase]);

  useEffect(() => {
    if (isLoggedIn && userId) {
      fetchRatesAndBalances(userId);
    } else {
      fetchRatesAndBalances(null);
    }

    const t = setInterval(() => {
      if (isLoggedIn && userId) fetchRatesAndBalances(userId);
    }, 3000);

    return () => {
      clearInterval(t);
    };
  }, [fetchRatesAndBalances, isLoggedIn, userId]);

  const getBalance = (currency: string) => {
    switch (currency) {
      case "KRW": return balances.cash;
      case "USD": return balances.usd_balance;
      case "EUR": return balances.eur_balance;
      case "JPY": return balances.jpy_balance;
      case "CNY": return balances.cny_balance;
      case "GBP": return balances.gbp_balance;
      default: return 0;
    }
  };

  const getRate = (code: string) => {
    const rateObj = rates.find((r) => r.currency_code === code);
    return rateObj ? Number(rateObj.rate_to_krw) : 1;
  };

  const sellRate = getRate(fromCur);
  const buyRate = getRate(toCur);
  const conversionRate = sellRate / buyRate;
  const toAmountVal = fromAmount ? parseFloat(fromAmount) * conversionRate : 0;

  const handleMax = () => {
    const bal = getBalance(fromCur);
    setFromAmount(bal.toString());
  };

  const handleExchange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) {
      setMessage({ text: "로그인이 필요합니다.", type: "error" });
      return;
    }
    const amt = parseFloat(fromAmount);
    if (isNaN(amt) || amt <= 0) {
      setMessage({ text: "올바른 금액을 입력해 주세요.", type: "error" });
      return;
    }
    if (getBalance(fromCur) < amt) {
      setMessage({ text: "보유 잔액이 부족합니다.", type: "error" });
      return;
    }
    if (fromCur === toCur) {
      setMessage({ text: "동일한 통화 간의 환전은 불가능합니다.", type: "error" });
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const { data, error } = await supabase.rpc("exchange_currency", {
        p_user_id: userId,
        p_from_cur: fromCur,
        p_to_cur: toCur,
        p_amount: amt,
      });

      if (error || !data) {
        setMessage({ text: `환전 실패: ${error?.message || "알 수 없는 오류"}`, type: "error" });
      } else {
        setMessage({
          text: `환전 완료: ${amt.toLocaleString()} ${fromCur} ➔ ${toAmountVal.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${toCur}`,
          type: "success",
        });
        setFromAmount("");
        fetchRatesAndBalances(userId);
      }
    } catch (err: any) {
      setMessage({ text: `오류가 발생했습니다: ${err.message}`, type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-6 font-sans bg-[#05070A] min-h-screen text-[#F4F5F6] space-y-6">
      {/* Header Banner */}
      <div className="bg-[#0E1117] border border-[#212631] p-6 rounded-3xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-2xl">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#F04452]/40 bg-[#F04452]/10 px-3.5 py-1 text-[11px] font-mono font-bold text-[#F04452] mb-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[#F04452] animate-pulse" />
            CURRENCY EXCHANGE · 실시간 환전소
          </div>
          <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
            실시간 다국어 환전 시스템
          </h1>
          <p className="text-[12.5px] text-[#8E939D] mt-1 font-medium leading-relaxed">
            주요 외화 (USD, EUR, JPY, CNY, GBP) 및 원화 (KRW) 간 실시간 환전 서비스를 제공합니다.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Left Column (8): Exchange Rate Board & Wallet Balances */}
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-6">
          
          {/* Real-time Exchange Rates Board */}
          <div className="bg-[#0E1117] border border-[#212631] rounded-3xl overflow-hidden shadow-2xl">
            <div className="border-b border-[#212631] px-6 py-4 bg-[#090B0F]">
              <h2 className="text-[14px] font-black text-white font-mono">실시간 환율 정보 (원화 대비)</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px] border-collapse font-mono">
                <thead>
                  <tr className="border-b border-[#212631] text-[#8E939D] text-[11px] uppercase tracking-wider bg-[#090B0F]">
                    <th className="px-6 py-3.5 border-none font-bold">통화</th>
                    <th className="px-6 py-3.5 border-none font-bold">통화명</th>
                    <th className="px-6 py-3.5 border-none text-right font-bold">환율 (KRW)</th>
                    <th className="px-6 py-3.5 border-none text-right font-bold">변동</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#212631]">
                  {rates.map((rate) => {
                    if (rate.currency_code === "KRW") return null;

                    const curVal = Number(rate.rate_to_krw);
                    const prevVal = prevRates[rate.currency_code] || curVal;
                    const diff = curVal - prevVal;
                    const isUp = diff > 0;
                    const isDown = diff < 0;

                    return (
                      <tr key={rate.currency_code} className="hover:bg-[#161B22] transition-colors border-b border-[#212631] last:border-none">
                        <td className="px-6 py-4 border-none font-extrabold text-white flex items-center gap-3">
                          <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#161B22] text-[#F04452] font-mono text-[13px] border border-[#212631] font-black">
                            {CURRENCY_ICONS[rate.currency_code]}
                          </span>
                          <span className="text-[14px]">{rate.currency_code}</span>
                        </td>
                        <td className="px-6 py-4 border-none text-[#8E939D] text-[13px] font-sans font-medium">{rate.currency_name}</td>
                        <td className="px-6 py-4 border-none text-right font-mono font-black text-[14.5px] tabular-nums text-white">
                          {curVal.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} 원
                        </td>
                        <td className="px-6 py-4 border-none text-right font-mono text-[12px] font-black tabular-nums">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full border ${
                            isUp ? "bg-[#F04452]/10 border-[#F04452]/30 text-[#F04452]" : isDown ? "bg-[#3182F6]/10 border-[#3182F6]/30 text-[#3182F6]" : "bg-[#161B22] border-[#212631] text-[#8E939D]"
                          }`}>
                            {isUp ? `▲ +${diff.toFixed(4)}` : isDown ? `▼ ${diff.toFixed(4)}` : "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* User Multi-Currency Wallet Balances */}
          <div className="bg-[#0E1117] border border-[#212631] p-6 rounded-3xl shadow-2xl space-y-4 font-mono">
            <h2 className="text-[14px] font-black text-white border-b border-[#212631] pb-3">보유 통화 지갑</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Object.keys(CURRENCY_NAMES).map((cur) => {
                const bal = getBalance(cur);
                return (
                  <div key={cur} className="rounded-2xl border border-[#212631] bg-[#05070A] p-4 transition-all hover:border-[#F04452]/40">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10.5px] font-bold text-[#8E939D] uppercase tracking-wider">{CURRENCY_NAMES[cur]}</span>
                      <span className="rounded-full bg-[#161B22] px-2.5 py-0.5 font-mono text-[10px] text-[#F04452] font-black border border-[#212631]">{cur}</span>
                    </div>
                    <div className="font-mono text-lg font-black text-white tabular-nums">
                      {CURRENCY_ICONS[cur]} {bal.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column (4): Exchange Actions Form */}
        <div className="col-span-12 lg:col-span-4 flex flex-col font-mono">
          <div className="bg-[#0E1117] border border-[#212631] rounded-3xl p-6 shadow-2xl space-y-4">
            <h2 className="text-[14px] font-black text-white border-b border-[#212631] pb-3">통화 간 빠른 환전</h2>
            <form onSubmit={handleExchange} className="flex flex-col gap-4">
              
              {/* Message Banner */}
              {message && (
                <div className={`rounded-2xl p-4 text-[12px] font-bold ${
                  message.type === "success" 
                    ? "bg-[#F04452]/10 border border-[#F04452]/30 text-[#F04452]" 
                    : "bg-[#3182F6]/10 border border-[#3182F6]/30 text-[#3182F6]"
                }`}>
                  {message.text}
                </div>
              )}

              {/* Sell Currency */}
              <div>
                <label className="block text-[11px] font-bold text-[#8E939D] uppercase tracking-wider mb-1.5">
                  판매 통화 (From)
                </label>
                <select
                  value={fromCur}
                  onChange={(e) => setFromCur(e.target.value)}
                  className="w-full rounded-2xl bg-[#05070A] border border-[#212631] px-4 py-3 text-[13.5px] font-bold text-white focus:ring-1 focus:ring-[#F04452] focus:outline-none transition-all"
                >
                  {Object.keys(CURRENCY_NAMES).map((cur) => (
                    <option key={cur} value={cur}>{cur} - {CURRENCY_NAMES[cur]}</option>
                  ))}
                </select>
              </div>

              {/* Amount Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[11px] font-bold text-[#8E939D] uppercase tracking-wider">
                    환전 금액
                  </label>
                  <button
                    type="button"
                    onClick={handleMax}
                    className="text-[11px] text-[#F04452] font-black hover:underline cursor-pointer"
                  >
                    최대 (보유: {getBalance(fromCur).toLocaleString()})
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={fromAmount}
                    onChange={(e) => setFromAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-2xl bg-[#05070A] border border-[#212631] px-4 py-3 font-mono text-[16px] font-black text-white placeholder:text-[#565A63] focus:ring-1 focus:ring-[#F04452] focus:outline-none tabular-nums"
                  />
                  <span className="absolute right-4 top-3.5 font-mono text-[12px] font-black text-[#F04452]">
                    {fromCur}
                  </span>
                </div>
              </div>

              {/* Icon divider */}
              <div className="flex justify-center -my-1">
                <button
                  type="button"
                  onClick={() => {
                    const temp = fromCur;
                    setFromCur(toCur);
                    setToCur(temp);
                  }}
                  className="rounded-full bg-[#161B22] p-2.5 hover:bg-[#212631] transition-colors border border-[#212631] cursor-pointer text-[#F04452] font-bold"
                >
                  ↕️
                </button>
              </div>

              {/* Buy Currency */}
              <div>
                <label className="block text-[11px] font-bold text-[#8E939D] uppercase tracking-wider mb-1.5">
                  구매 통화 (To)
                </label>
                <select
                  value={toCur}
                  onChange={(e) => setToCur(e.target.value)}
                  className="w-full rounded-2xl bg-[#05070A] border border-[#212631] px-4 py-3 text-[13.5px] font-bold text-white focus:ring-1 focus:ring-[#F04452] focus:outline-none transition-all"
                >
                  {Object.keys(CURRENCY_NAMES).map((cur) => (
                    <option key={cur} value={cur}>{cur} - {CURRENCY_NAMES[cur]}</option>
                  ))}
                </select>
              </div>

              {/* Conversion Preview */}
              <div className="rounded-2xl bg-[#05070A] p-4 flex flex-col gap-2 border border-[#212631]">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[#8E939D] font-bold">적용 환율</span>
                  <span className="font-mono text-white font-black">
                    1 {fromCur} = {conversionRate.toFixed(4)} {toCur}
                  </span>
                </div>
                <div className="h-px bg-[#212631]" />
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-[#8E939D] font-bold">예상 수령 금액</span>
                  <span className="font-mono text-[17px] font-black text-[#F04452] tabular-nums">
                    {CURRENCY_ICONS[toCur]} {toAmountVal.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </span>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-full bg-[#F04452] py-3.5 text-[14px] font-black text-white hover:bg-[#ff5252] transition-all disabled:opacity-50 cursor-pointer shadow-lg active:scale-[0.98]"
              >
                {submitting ? "환전 진행 중..." : "환전 신청하기"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

