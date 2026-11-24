"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/db/client";
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

const EMPTY_BALANCES: UserBalances = {
  cash: 0,
  usd_balance: 0,
  eur_balance: 0,
  jpy_balance: 0,
  cny_balance: 0,
  gbp_balance: 0,
};

function parseFiniteNonNeg(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Object.is(value, -0) ? 0 : value;
}

function parseOptionalFiniteNonNeg(value: unknown): number | null {
  if (value === undefined || value === null) return 0;
  return parseFiniteNonNeg(value);
}

function parseProfileBalances(profile: unknown): UserBalances | null {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return null;
  }
  const p = profile as Record<string, unknown>;
  const cash = parseFiniteNonNeg(p.cash);
  const usd_balance = parseOptionalFiniteNonNeg(p.usd_balance);
  const eur_balance = parseOptionalFiniteNonNeg(p.eur_balance);
  const jpy_balance = parseOptionalFiniteNonNeg(p.jpy_balance);
  const cny_balance = parseOptionalFiniteNonNeg(p.cny_balance);
  const gbp_balance = parseOptionalFiniteNonNeg(p.gbp_balance);

  if (
    cash === null ||
    usd_balance === null ||
    eur_balance === null ||
    jpy_balance === null ||
    cny_balance === null ||
    gbp_balance === null
  ) {
    return null;
  }
  return { cash, usd_balance, eur_balance, jpy_balance, cny_balance, gbp_balance };
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
  const [balanceState, setBalanceState] = useState<{ userId: string; balances: UserBalances } | null>(null);
  const [balanceError, setBalanceError] = useState<boolean>(false);
  const { userId, isLoggedIn } = useAuth();
  const currentUid = isLoggedIn && userId ? userId : null;

  const balanceRequestSeqRef = useRef<number>(0);
  const activeAuthUserIdRef = useRef<string | null>(currentUid);

  // Exchange Form State
  const [fromCur, setFromCur] = useState<string>("KRW");
  const [toCur, setToCur] = useState<string>("USD");
  const [fromAmount, setFromAmount] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const db = createClient();

  const fetchRatesAndBalances = useCallback(async (uid: string | null, seq?: number) => {
    const requestSeq = seq ?? ++balanceRequestSeqRef.current;

    // 1. Fetch rates (공개 환율 정보)
    try {
      const { data: ratesData } = await db.from("exchange_rates").select("*").order("currency_code");
      if (Array.isArray(ratesData)) {
        setRates((prev) => {
          const mapping: Record<string, number> = {};
          prev.forEach((r) => {
            mapping[r.currency_code] = r.rate_to_krw;
          });
          setPrevRates(mapping);
          return ratesData;
        });
      }
    } catch {
      // ignore public rates transient error
    }

    if (!uid) {
      if (requestSeq === balanceRequestSeqRef.current && activeAuthUserIdRef.current === null) {
        setBalanceState(null);
        setBalanceError(false);
      }
      return;
    }

    // 2. Fetch user balances
    try {
      const { data: profile, error } = await db
        .from("profiles")
        .select("cash, usd_balance, eur_balance, jpy_balance, cny_balance, gbp_balance")
        .eq("user_id", uid)
        .maybeSingle();

      if (requestSeq !== balanceRequestSeqRef.current || activeAuthUserIdRef.current !== uid) {
        return;
      }

      if (error) {
        setBalanceState(null);
        setBalanceError(true);
        return;
      }

      const parsed = parseProfileBalances(profile);
      if (parsed) {
        setBalanceState({ userId: uid, balances: parsed });
        setBalanceError(false);
      } else {
        setBalanceState(null);
        setBalanceError(profile !== null && profile !== undefined);
      }
    } catch {
      if (requestSeq === balanceRequestSeqRef.current && activeAuthUserIdRef.current === uid) {
        setBalanceState(null);
        setBalanceError(true);
      }
    }
  }, [db]);

  useEffect(() => {
    let cancelled = false;
    activeAuthUserIdRef.current = currentUid;
    const seq = ++balanceRequestSeqRef.current;

    if (!currentUid) {
      setBalanceState(null);
      setBalanceError(false);
      setFromAmount("");
      setMessage(null);
      void fetchRatesAndBalances(null, seq);
      return () => {
        cancelled = true;
        balanceRequestSeqRef.current += 1;
      };
    }

    setBalanceState((prev) => (prev && prev.userId === currentUid ? prev : null));
    setBalanceError(false);
    void fetchRatesAndBalances(currentUid, seq);

    const t = setInterval(() => {
      if (!cancelled && activeAuthUserIdRef.current === currentUid) {
        void fetchRatesAndBalances(currentUid, balanceRequestSeqRef.current);
      }
    }, 3000);

    return () => {
      cancelled = true;
      balanceRequestSeqRef.current += 1;
      clearInterval(t);
    };
  }, [fetchRatesAndBalances, currentUid]);

  const hasValidUserBalances = Boolean(
    currentUid && balanceState && balanceState.userId === currentUid
  );
  const activeBalances = hasValidUserBalances && balanceState ? balanceState.balances : EMPTY_BALANCES;

  const getBalance = (currency: string) => {
    switch (currency) {
      case "KRW": return activeBalances.cash;
      case "USD": return activeBalances.usd_balance;
      case "EUR": return activeBalances.eur_balance;
      case "JPY": return activeBalances.jpy_balance;
      case "CNY": return activeBalances.cny_balance;
      case "GBP": return activeBalances.gbp_balance;
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
    if (!hasValidUserBalances) return;
    const bal = getBalance(fromCur);
    setFromAmount(bal.toString());
  };

  const handleExchange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUid) {
      setMessage({ text: "로그인이 필요합니다.", type: "error" });
      return;
    }
    const amt = parseFloat(fromAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setMessage({ text: "올바른 금액을 입력해 주세요.", type: "error" });
      return;
    }
    if (!hasValidUserBalances) {
      setMessage({ text: "보유 잔액을 확인 중입니다. 잠시 후 다시 시도해 주세요.", type: "error" });
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
      const { data, error } = await db.rpc("exchange_currency", {
        p_user_id: currentUid,
        p_from_cur: fromCur,
        p_to_cur: toCur,
        p_amount: amt,
      });

      if (activeAuthUserIdRef.current !== currentUid) {
        return;
      }

      if (error || !data) {
        setMessage({ text: `환전 실패: ${error?.message || "알 수 없는 오류"}`, type: "error" });
      } else {
        const credited = Number(data.to_amount ?? toAmountVal);
        setMessage({
          text: `환전 완료: ${Number(data.from_amount ?? amt).toLocaleString()} ${fromCur} ➔ ${credited.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${toCur}`,
          type: "success",
        });
        setFromAmount("");
        void fetchRatesAndBalances(currentUid, balanceRequestSeqRef.current);
      }
    } catch (err: any) {
      if (activeAuthUserIdRef.current === currentUid) {
        setMessage({ text: `오류가 발생했습니다: ${err.message}`, type: "error" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-6 font-sans bg-[#05070A] min-h-screen text-[#F4F5F6] space-y-6">
      {/* Header Banner */}
      <div className="bg-[#0E1117] border border-border p-6 rounded-3xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-2xl">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#F04452]/40 bg-up/10 px-3.5 py-1 text-xs font-mono font-bold text-up mb-2">
            <span className="inline-block h-2 w-2 rounded-full bg-up animate-pulse" />
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
          <div className="bg-[#0E1117] border border-border rounded-3xl overflow-hidden shadow-2xl">
            <div className="border-b border-border px-6 py-4 bg-[#090B0F]">
              <h2 className="text-[14px] font-black text-white font-mono">실시간 환율 정보 (원화 대비)</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px] border-collapse font-mono">
                <thead>
                  <tr className="border-b border-border text-[#8E939D] text-xs uppercase tracking-wider bg-[#090B0F]">
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
                      <tr key={rate.currency_code} className="hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors border-b border-border last:border-none">
                        <td className="px-6 py-4 border-none font-extrabold text-white flex items-center gap-3">
                          <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#161B22] text-up font-mono text-[13px] border border-border font-black">
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
                            isUp ? "bg-up/10 border-[#F04452]/30 text-up" : isDown ? "bg-down/10 border-[#3182F6]/30 text-down" : "bg-[#161B22] border-border text-[#8E939D]"
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
          <div className="bg-[#0E1117] border border-border p-6 rounded-3xl shadow-2xl space-y-4 font-mono" data-testid="exchange-wallet-card">
            <h2 className="text-[14px] font-black text-white border-b border-border pb-3">보유 통화 지갑</h2>
            {!currentUid ? (
              <div className="rounded-2xl border border-border bg-[#05070A] p-6 text-center text-[13px] text-[#8E939D] font-sans">
                로그인 후 보유 통화 지갑 잔액을 확인할 수 있습니다.
              </div>
            ) : !hasValidUserBalances ? (
              <div className="rounded-2xl border border-border bg-[#05070A] p-6 text-center text-[13px] text-[#8E939D] font-sans">
                {balanceError ? "보유 잔액 정보를 불러오지 못했습니다." : "보유 잔액을 불러오는 중입니다..."}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Object.keys(CURRENCY_NAMES).map((cur) => {
                  const bal = getBalance(cur);
                  return (
                    <div key={cur} className="rounded-2xl border border-border bg-[#05070A] p-4 transition-all hover:border-[#F04452]/40">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10.5px] font-bold text-[#8E939D] uppercase tracking-wider">{CURRENCY_NAMES[cur]}</span>
                        <span className="rounded-full bg-[#161B22] px-2.5 py-0.5 font-mono text-[10px] text-up font-black border border-border">{cur}</span>
                      </div>
                      <div className="font-mono text-lg font-black text-white tabular-nums">
                        {CURRENCY_ICONS[cur]} {bal.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (4): Exchange Actions Form */}
        <div className="col-span-12 lg:col-span-4 flex flex-col font-mono">
          <div className="bg-[#0E1117] border border-border rounded-3xl p-6 shadow-2xl space-y-4">
            <h2 className="text-[14px] font-black text-white border-b border-border pb-3">통화 간 빠른 환전</h2>
            <form onSubmit={handleExchange} className="flex flex-col gap-4">
              
              {/* Message Banner */}
              {message && (
                <div className={`rounded-2xl p-4 text-[12px] font-bold ${
                  message.type === "success" 
                    ? "bg-up/10 border border-[#F04452]/30 text-up" 
                    : "bg-down/10 border border-[#3182F6]/30 text-down"
                }`}>
                  {message.text}
                </div>
              )}

              {/* Sell Currency */}
              <div>
                <label className="block text-xs font-bold text-[#8E939D] uppercase tracking-wider mb-1.5">
                  판매 통화 (From)
                </label>
                <select
                  value={fromCur}
                  onChange={(e) => setFromCur(e.target.value)}
                  className="w-full rounded-2xl bg-[#05070A] border border-border px-4 py-3 text-[13.5px] font-bold text-white focus:ring-1 focus:ring-[#F04452] focus:outline-none transition-all"
                >
                  {Object.keys(CURRENCY_NAMES).map((cur) => (
                    <option key={cur} value={cur}>{cur} - {CURRENCY_NAMES[cur]}</option>
                  ))}
                </select>
              </div>

              {/* Amount Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-[#8E939D] uppercase tracking-wider">
                    환전 금액
                  </label>
                  <button
                    type="button"
                    disabled={!hasValidUserBalances}
                    onClick={handleMax}
                    className="text-xs text-up font-black hover:underline cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {hasValidUserBalances ? `최대 (보유: ${getBalance(fromCur).toLocaleString()})` : "최대"}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={fromAmount}
                    onChange={(e) => setFromAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-2xl bg-[#05070A] border border-border px-4 py-3 font-mono text-[16px] font-black text-white placeholder:text-[#565A63] focus:ring-1 focus:ring-[#F04452] focus:outline-none tabular-nums"
                  />
                  <span className="absolute right-4 top-3.5 font-mono text-[12px] font-black text-up">
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
                  className="rounded-full bg-[#161B22] p-2.5 hover:bg-[#212631] transition-colors border border-border cursor-pointer text-up font-bold"
                >
                  ↕️
                </button>
              </div>

              {/* Buy Currency */}
              <div>
                <label className="block text-xs font-bold text-[#8E939D] uppercase tracking-wider mb-1.5">
                  구매 통화 (To)
                </label>
                <select
                  value={toCur}
                  onChange={(e) => setToCur(e.target.value)}
                  className="w-full rounded-2xl bg-[#05070A] border border-border px-4 py-3 text-[13.5px] font-bold text-white focus:ring-1 focus:ring-[#F04452] focus:outline-none transition-all"
                >
                  {Object.keys(CURRENCY_NAMES).map((cur) => (
                    <option key={cur} value={cur}>{cur} - {CURRENCY_NAMES[cur]}</option>
                  ))}
                </select>
              </div>

              {/* Conversion Preview */}
              <div className="rounded-2xl bg-[#05070A] p-4 flex flex-col gap-2 border border-border">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[#8E939D] font-bold">적용 환율</span>
                  <span className="font-mono text-white font-black">
                    1 {fromCur} = {conversionRate.toFixed(4)} {toCur}
                  </span>
                </div>
                <div className="h-px bg-[#212631]" />
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-[#8E939D] font-bold">예상 수령 금액</span>
                  <span className="font-mono text-[17px] font-black text-up tabular-nums">
                    {CURRENCY_ICONS[toCur]} {toAmountVal.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </span>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-full bg-up py-3.5 text-[14px] font-black text-white hover:bg-[#ff5252] transition-all disabled:opacity-50 cursor-pointer shadow-lg active:scale-[0.98]"
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

