"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import StrictWidget from "@/app/components/StrictWidget";

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
  const [userId, setUserId] = useState<string | null>(null);

  // Exchange Form State
  const [fromCur, setFromCur] = useState<string>("KRW");
  const [toCur, setToCur] = useState<string>("USD");
  const [fromAmount, setFromAmount] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const supabase = createClient();

  const fetchRatesAndBalances = useCallback(async (uid: string) => {
    // 1. Fetch rates
    const { data: ratesData } = await supabase.from("exchange_rates").select("*").order("currency_code");
    if (ratesData) {
      setRates((prev) => {
        // Save previous rates to show up/down indicators
        const mapping: Record<string, number> = {};
        prev.forEach((r) => {
          mapping[r.currency_code] = r.rate_to_krw;
        });
        setPrevRates(mapping);
        return ratesData;
      });
    }

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
    let uid: string | null = null;
    supabase.auth.getSession().then(({ data }: { data: { session: { user: { id: string } } | null } }) => {
      if (data.session?.user) {
        uid = data.session.user.id;
        setUserId(uid);
        fetchRatesAndBalances(uid);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event: unknown, session: { user: { id: string } } | null) => {
      if (session?.user) {
        uid = session.user.id;
        setUserId(uid);
        fetchRatesAndBalances(uid);
      } else {
        setUserId(null);
      }
    });

    // 실시간 환율 및 잔고 업데이트 폴링 (3초 간격)
    const t = setInterval(() => {
      if (uid) fetchRatesAndBalances(uid);
    }, 3000);

    return () => {
      clearInterval(t);
      listener?.subscription.unsubscribe();
    };
  }, [fetchRatesAndBalances, supabase]);

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

  // 계산된 구매 가능 수량
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
          text: `환전 성공! ${amt.toLocaleString()} ${fromCur} ➔ ${toAmountVal.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${toCur}`,
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
    <div className="mx-auto max-w-7xl px-6 py-6 font-sans">
      {/* Navigation */}
      <nav className="mb-4 flex items-center gap-2 text-[12px] text-gray-500">
        <Link href="/" className="hover:text-white">메인홈</Link>
        <span>/</span>
        <span className="text-gray-400">환전소</span>
      </nav>

      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-black text-white">
            <span className="text-3xl">💱</span>
            다국어 환전거래소
          </h1>
          <p className="mt-1 text-[13px] text-gray-500">
            DXY 주요 외화 및 중국 위안화, 대한민국 원화 간 실시간 환전 서비스를 제공합니다.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Left Column (8): Exchange Rate Board & Wallet Balances */}
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-4">
          
          {/* Real-time Exchange Rates Board */}
          <StrictWidget title="📊 실시간 환율 정보 (원화 대비)">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[#222] text-gray-500 text-[11px] uppercase tracking-wider">
                    <th className="px-4 py-3 font-semibold">통화</th>
                    <th className="px-4 py-3 font-semibold">통화명</th>
                    <th className="px-4 py-3 text-right font-semibold">환율 (KRW)</th>
                    <th className="px-4 py-3 text-right font-semibold">변동</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222]">
                  {rates.map((rate) => {
                    if (rate.currency_code === "KRW") return null;

                    const curVal = Number(rate.rate_to_krw);
                    const prevVal = prevRates[rate.currency_code] || curVal;
                    const diff = curVal - prevVal;
                    const isUp = diff > 0;
                    const isDown = diff < 0;

                    return (
                      <tr key={rate.currency_code} className="hover:bg-[#111]/40 transition-colors">
                        <td className="px-4 py-4.5 font-bold text-white flex items-center gap-2">
                          <span className="grid h-6 w-6 place-items-center rounded bg-[#222] text-yellow-500 font-mono text-[11px]">
                            {CURRENCY_ICONS[rate.currency_code]}
                          </span>
                          {rate.currency_code}
                        </td>
                        <td className="px-4 py-4.5 text-gray-400">{rate.currency_name}</td>
                        <td className="px-4 py-4.5 text-right font-mono font-semibold tabular-nums text-white">
                          {curVal.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} 원
                        </td>
                        <td className={`px-4 py-4.5 text-right font-mono text-[12px] tabular-nums ${isUp ? "text-red-400" : isDown ? "text-blue-400" : "text-gray-500"}`}>
                          {isUp ? `▲ +${diff.toFixed(4)}` : isDown ? `▼ ${diff.toFixed(4)}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </StrictWidget>

          {/* User Multi-Currency Wallet Balances */}
          <StrictWidget title="👛 보유 통화 지갑">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 bg-[#0a0a0a]/50">
              {Object.keys(CURRENCY_NAMES).map((cur) => {
                const bal = getBalance(cur);
                return (
                  <div key={cur} className="rounded-lg border border-[#222] bg-[#111]/30 p-4 transition-all hover:border-[#333]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{CURRENCY_NAMES[cur]}</span>
                      <span className="rounded bg-[#222] px-1.5 py-0.5 font-mono text-[10px] text-gray-400 font-bold">{cur}</span>
                    </div>
                    <div className="font-mono text-lg font-black text-white tabular-nums">
                      {CURRENCY_ICONS[cur]} {bal.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </div>
                  </div>
                );
              })}
            </div>
          </StrictWidget>
        </div>

        {/* Right Column (4): Exchange Actions Form */}
        <div className="col-span-12 lg:col-span-4 flex flex-col">
          <StrictWidget title="💱 통화 간 빠른 환전">
            <form onSubmit={handleExchange} className="p-4 flex flex-col gap-4">
              
              {/* Message Banner */}
              {message && (
                <div className={`rounded-lg p-3 text-[12px] ${message.type === "success" ? "bg-red-500/10 border border-red-500/30 text-red-400" : "bg-blue-500/10 border border-blue-500/30 text-blue-400"}`}>
                  {message.text}
                </div>
              )}

              {/* Sell Currency */}
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">판매 통화 (From)</label>
                <div className="flex gap-2">
                  <select
                    value={fromCur}
                    onChange={(e) => setFromCur(e.target.value)}
                    className="flex-1 rounded-lg border border-[#222] bg-black px-3 py-2 text-[13px] text-white focus:border-yellow-500 focus:outline-none"
                  >
                    {Object.keys(CURRENCY_NAMES).map((cur) => (
                      <option key={cur} value={cur}>{cur} - {CURRENCY_NAMES[cur]}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Amount Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">환전 금액</label>
                  <button
                    type="button"
                    onClick={handleMax}
                    className="text-[10px] text-yellow-500 font-bold hover:underline"
                  >
                    최대 환전 (보유: {getBalance(fromCur).toLocaleString()} {fromCur})
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={fromAmount}
                    onChange={(e) => setFromAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-[#222] bg-black px-3 py-2.5 font-mono text-[15px] font-bold text-white placeholder:text-gray-700 focus:border-yellow-500 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 font-mono text-[13px] font-bold text-gray-500">{fromCur}</span>
                </div>
              </div>

              {/* Icon divider */}
              <div className="flex justify-center -my-2">
                <button
                  type="button"
                  onClick={() => {
                    const temp = fromCur;
                    setFromCur(toCur);
                    setToCur(temp);
                  }}
                  className="rounded-full border border-[#222] bg-[#111] p-1.5 hover:bg-[#222] transition-colors"
                >
                  ↕️
                </button>
              </div>

              {/* Buy Currency */}
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">구매 통화 (To)</label>
                <select
                  value={toCur}
                  onChange={(e) => setToCur(e.target.value)}
                  className="w-full rounded-lg border border-[#222] bg-black px-3 py-2 text-[13px] text-white focus:border-yellow-500 focus:outline-none"
                >
                  {Object.keys(CURRENCY_NAMES).map((cur) => (
                    <option key={cur} value={cur}>{cur} - {CURRENCY_NAMES[cur]}</option>
                  ))}
                </select>
              </div>

              {/* Conversion Preview */}
              <div className="rounded-lg border border-[#222] bg-[#111]/30 p-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-gray-500">환산 비율</span>
                  <span className="font-mono text-white">
                    1 {fromCur} = {conversionRate.toFixed(4)} {toCur}
                  </span>
                </div>
                <div className="h-px bg-[#222]" />
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-gray-500">예상 수령 금액</span>
                  <span className="font-mono text-[16px] font-black text-yellow-500 tabular-nums">
                    {CURRENCY_ICONS[toCur]} {toAmountVal.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </span>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-yellow-500 py-3 text-[14px] font-bold text-black hover:bg-yellow-400 transition-colors disabled:opacity-50"
              >
                {submitting ? "환전 진행 중..." : "환전 신청"}
              </button>
            </form>
          </StrictWidget>
        </div>
      </div>
    </div>
  );
}
