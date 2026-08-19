"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { fmtVolume } from "@/lib/format";
import StrictWidget from './StrictWidget';
import { runOptionBotTradingEngine, LiquidationEvent, RolloverTrackerState } from "@/lib/engine/optionBotEngine";
import RolloverTracker from "./RolloverTracker";

import { useAuth } from "@/lib/auth/useAuth";

interface OptionsPanelProps {
  stockId: string;
  ticker?: string;
}

export default function OptionsPanel({ stockId, ticker = "STOCK" }: OptionsPanelProps) {
  const [hasLicense, setHasLicense] = useState(false);
  const [options, setOptions] = useState<any[]>([]);
  const [spotPrice, setSpotPrice] = useState<number>(50000);
  const [filterClass, setFilterClass] = useState<"ALL" | "IDX" | "STK" | "FUT">("ALL");
  const [loading, setLoading] = useState(true);
  const [gammaSqueezeNotice, setGammaSqueezeNotice] = useState(false);
  const [liquidations, setLiquidations] = useState<LiquidationEvent[]>([]);
  const [rolloverState, setRolloverState] = useState<RolloverTrackerState | null>(null);

  // D-Day Expiry Countdown Timer
  const [countdownStr, setCountdownStr] = useState("01:24:05");

  const supabase = createClient();
  const { userId, isLoggedIn } = useAuth();

  useEffect(() => {
    async function fetchData() {
      if (isLoggedIn && userId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_admin, has_options_license')
          .eq('id', userId)
          .single();
        if (profile) {
          setHasLicense(profile.is_admin || profile.has_options_license || false);
        }
      }

      // Fetch stock spot price
      const { data: stockData } = await supabase
        .from('stocks')
        .select('current_price, ticker, name')
        .eq('id', stockId)
        .single();

      const currentSpot = Number(stockData?.current_price || 50000);
      setSpotPrice(currentSpot);
      const symbol = stockData?.ticker || ticker;

      // Run 50 Institution Bots Options Trading Simulation
      const result = await runOptionBotTradingEngine(stockId, symbol, currentSpot);
      if (result.gammaSqueezeTriggered) {
        setGammaSqueezeNotice(true);
      }
      if (result.liquidationEvents && result.liquidationEvents.length > 0) {
        setLiquidations(result.liquidationEvents);
      }
      if (result.rolloverTrackerState) {
        setRolloverState(result.rolloverTrackerState);
      }

      // Fetch options contracts
      const { data: optionsData } = await supabase
        .from('options_contracts')
        .select('*')
        .eq('underlying_stock_id', stockId)
        .order('strike_price', { ascending: true });

      setOptions(optionsData || []);
      setLoading(false);
    }

    fetchData();

    // Timer Interval for Expiration Countdown
    const timer = setInterval(() => {
      const now = new Date();
      const h = String(15 - now.getHours()).padStart(2, '0');
      const m = String(59 - now.getMinutes()).padStart(2, '0');
      const s = String(59 - now.getSeconds()).padStart(2, '0');
      setCountdownStr(`${Math.max(0, parseInt(h))}:${m}:${s}`);
    }, 1000);

    return () => clearInterval(timer);
  }, [stockId, ticker, supabase, isLoggedIn, userId]);

  const handleTradeOption = async (option: any) => {
    if (!userId || !hasLicense) {
      alert("파생상품 옵션 거래 자격증이 필요합니다. 상점에서 해금해 주세요.");
      return;
    }

    const qtyStr = prompt(`[${option.ticker}] 옵션 주문 수량을 입력해 주세요:`, "10");
    if (!qtyStr) return;
    const qty = parseInt(qtyStr, 10);
    if (isNaN(qty) || qty <= 0) return;

    const totalPrice = option.current_price * qty;
    if (!confirm(`[${option.ticker}] ${option.option_type} 옵션 ${qty}계약 매수\n총 결제금액: ₩${totalPrice.toLocaleString()}`)) return;

    try {
      const { error } = await supabase.rpc('execute_option_order', {
        p_user_id: userId,
        p_option_id: option.id,
        p_side: 'BUY',
        p_quantity: qty,
        p_price: option.current_price
      });

      if (error) throw error;
      alert(`🎉 [${option.ticker}] ${qty}계약 매수 주문 체결 완료!`);
      
      const { data: refreshed } = await supabase
        .from('options_contracts')
        .select('*')
        .eq('underlying_stock_id', stockId)
        .order('strike_price', { ascending: true });
      setOptions(refreshed || []);
    } catch (e: any) {
      console.error(e);
      alert("옵션 주문 체결 실패: " + (e.message || e));
    }
  };

  const handleExecuteUserRollover = async () => {
    if (!userId || !hasLicense || options.length < 2) return;
    const currOpt = options[0];
    const nextOpt = options[1];
    const qty = 5;

    if (!confirm(`[롤오버 결합 주문 실행]\n근월물 [${currOpt.ticker}] ${qty}계약 청산 🔄 차월물 [${nextOpt.ticker}] ${qty}계약 원자적 이월 진입`)) return;

    try {
      const { data, error } = await supabase.rpc('execute_rollover_combo', {
        p_user_id: userId,
        p_curr_option_id: currOpt.id,
        p_next_option_id: nextOpt.id,
        p_quantity: qty,
        p_curr_price: currOpt.current_price,
        p_next_price: nextOpt.current_price
      });

      if (error) throw error;
      alert(`🎉 롤오버 결합 주문 체결 완료! 스프레드 차액: ₩${Number(data).toLocaleString()}`);
    } catch (e: any) {
      console.error(e);
      alert("롤오버 결합 주문 실패: " + (e.message || e));
    }
  };

  const filteredOptions = options.filter(opt => {
    if (filterClass === "ALL") return true;
    return opt.asset_class === filterClass;
  });

  if (loading) {
    return <div className="text-center p-4 text-[12px] text-gray-500 font-mono">⚡ 파생상품 옵션 & 감마 월 로딩 중...</div>;
  }

  return (
    <StrictWidget title="OPTIONS MARKET & GAMMA WALLS (파생상품 시장)">

      <div className="p-4 bg-transparent space-y-4 font-sans">
        {!hasLicense ? (
          <div className="text-center py-8">
            <div className="text-3xl mb-3">🔒</div>
            <h4 className="text-[15px] font-black text-white mb-2">파생상품 시장 접근 권한 없음</h4>
            <p className="text-[12.5px] text-[#8E939D] mb-4 max-w-sm mx-auto leading-relaxed">
              기관들의 옵션 헷징 수급, Gamma Wall 및 감마 스퀴즈에 접근하려면 파생상품 옵션 거래 자격증이 필요합니다.
            </p>
            <Link 
              href="/shop" 
              className="inline-flex items-center justify-center rounded-full bg-[#F04452] px-6 py-2.5 text-[13px] font-black text-white hover:bg-[#ff5252] transition-colors shadow-lg cursor-pointer"
            >
              상점에서 자격증 해금하기
            </Link>
          </div>
        ) : (
          <div>
            {/* 1. HTS D-DAY EXPIRATION COUNTDOWN BANNER */}
            <div className="mb-4 p-4 rounded-2xl border border-[#F04452]/50 bg-[#F04452]/10 text-white flex flex-col sm:flex-row items-center justify-between gap-3 shadow-[0_0_20px_rgba(240,68,82,0.25)] animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-[#F04452] animate-ping shrink-0" />
                <div>
                  <div className="text-[13px] font-black text-[#F04452] uppercase tracking-wider font-mono">
                    D-DAY 옵션 만기일 비상 결제령
                  </div>
                  <div className="text-[11.5px] text-[#8E939D] font-medium">
                    만기 잔여 시간에 따라 Greeks 감마 폭발 및 강제 반대매매(Liquidation)가 일어납니다.
                  </div>
                </div>
              </div>

              <div className="shrink-0 flex items-center gap-2 bg-[#05070A] px-4 py-2 rounded-xl border border-[#F04452]/40 font-mono">
                <span className="text-[11px] text-[#F04452] font-extrabold">만기 마감 남은 시간:</span>
                <span className="text-base font-black text-white tracking-wider tabular-nums">
                  {countdownStr}
                </span>
              </div>
            </div>

            {/* 2. ROLLOVER TRACKER HTS WIDGET */}
            <div className="mb-4">
              <RolloverTracker 
                data={rolloverState} 
                onExecuteUserRollover={handleExecuteUserRollover} 
              />
            </div>

            {/* 3. GAMMA SQUEEZE ALERT BANNER */}
            {gammaSqueezeNotice && (
              <div className="mb-4 p-3.5 rounded-xl border border-[#F04452]/50 bg-[#F04452]/15 text-[#F04452] font-black text-[12px] flex items-center justify-between font-mono">
                <div className="flex items-center gap-2">
                  <span>🔥 GAMMA SQUEEZE ALERT:</span>
                  <span>기관 딜러 델타 매수로 인해 현물 주가 폭등 유발 중!</span>
                </div>
                <span className="text-[10px] bg-[#F04452]/30 px-2.5 py-0.5 rounded-full border border-[#F04452]/50">WAG THE DOG</span>
              </div>
            )}

            {/* 4. LIQUIDATION TRADE FEED NOTIFICATION */}
            {liquidations.length > 0 && (
              <div className="mb-4 p-3.5 rounded-xl border border-[#3182F6]/40 bg-[#3182F6]/10 space-y-2 font-mono">
                <div className="text-[11px] font-black text-[#3182F6] flex items-center gap-2 uppercase tracking-wide">
                  <span className="w-2 h-2 rounded-full bg-[#3182F6] animate-pulse" />
                  <span>기관 포지션 반대매매 / 마진콜 체결 리포트</span>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  {liquidations.slice(0, 3).map((liq) => (
                    <div key={liq.id} className="bg-[#0E1117] border border-[#3182F6]/40 px-3 py-1 rounded-xl text-white flex items-center gap-2">
                      <span className="font-extrabold text-[#F04452]">[{liq.type}]</span>
                      <span>{liq.ticker}</span>
                      <span className="font-black text-white">{liq.quantity}계약</span>
                      <span className="text-[#8E939D]">@ ₩{liq.price.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 5. CATEGORY FILTER BAR (Robinhood Segmented Pills) */}
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#212631] text-[12px] font-black font-mono">
              <button
                onClick={() => setFilterClass("ALL")}
                className={`px-3.5 py-1.5 rounded-xl transition-all cursor-pointer ${
                  filterClass === "ALL" ? "bg-[#F04452] text-white shadow-[0_0_10px_rgba(240,68,82,0.3)]" : "bg-[#161B22] text-[#8E939D] hover:text-white"
                }`}
              >
                전체 (ALL)
              </button>

              <button
                onClick={() => setFilterClass("IDX")}
                className={`px-3.5 py-1.5 rounded-xl transition-all cursor-pointer ${
                  filterClass === "IDX" ? "bg-[#F04452] text-white shadow-[0_0_10px_rgba(240,68,82,0.3)]" : "bg-[#161B22] text-[#8E939D] hover:text-white"
                }`}
              >
                지수 (IDX)
              </button>

              <button
                onClick={() => setFilterClass("STK")}
                className={`px-3.5 py-1.5 rounded-xl transition-all cursor-pointer ${
                  filterClass === "STK" ? "bg-[#F04452] text-white shadow-[0_0_10px_rgba(240,68,82,0.3)]" : "bg-[#161B22] text-[#8E939D] hover:text-white"
                }`}
              >
                개별주 (STK)
              </button>

              <button
                onClick={() => setFilterClass("FUT")}
                className={`px-3.5 py-1.5 rounded-xl transition-all cursor-pointer ${
                  filterClass === "FUT" ? "bg-[#F04452] text-white shadow-[0_0_10px_rgba(240,68,82,0.3)]" : "bg-[#161B22] text-[#8E939D] hover:text-white"
                }`}
              >
                선물 (FUT)
              </button>
            </div>
            
            {/* 6. OPTIONS CONTRACTS TABLE WITH ITM / OTM VISUAL SHIFT */}
            <div className="overflow-x-auto rounded-2xl border border-[#212631] bg-[#0E1117]">
              <table className="w-full text-left text-[12.5px] font-mono border-collapse">
                <thead>
                  <tr className="border-b border-[#212631] text-[#8E939D] text-[11px] font-extrabold uppercase bg-[#090B0F]">
                    <th className="py-3 px-4 border-none">표준 티커 (Ticker)</th>
                    <th className="py-3 px-4 border-none">구분</th>
                    <th className="py-3 px-4 border-none text-right">행사가 (Strike)</th>
                    <th className="py-3 px-4 border-none text-right">프리미엄</th>
                    <th className="py-3 px-4 border-none text-right">미결제약정 (OI)</th>
                    <th className="py-3 px-4 border-none text-center">행사 상태</th>
                    <th className="py-3 px-4 border-none text-center">주문</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#212631]">
                  {filteredOptions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-[#8E939D] text-[12px]">
                        해당 카테고리의 옵션 계약이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredOptions.map((opt: any) => {
                      const isCall = opt.option_type === 'CALL';
                      const strike = Number(opt.strike_price);

                      const isITM = isCall ? spotPrice > strike : spotPrice < strike;
                      const isATM = Math.abs(spotPrice - strike) / strike < 0.02;
                      const isOTM = !isITM && !isATM;

                      const isGammaWall = opt.open_interest >= 8000;

                      return (
                        <tr 
                          key={opt.id} 
                          className={`transition-colors hover:bg-[#161B22] border-b border-[#212631] last:border-none ${
                            isITM 
                              ? "bg-[#F04452]/5 border-l-4 border-l-[#F04452]" 
                              : isOTM 
                              ? "opacity-70 hover:opacity-100" 
                              : "bg-[#3182F6]/5 border-l-4 border-l-[#3182F6]"
                          }`}
                        >
                          <td className="py-3 px-4 border-none text-[11.5px] font-extrabold text-white">
                            {opt.ticker || `STK-${ticker}-${opt.option_type[0]}${opt.strike_price}`}
                          </td>

                          <td className="py-3 px-4 border-none">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border ${
                              isCall ? 'bg-[#F04452]/15 text-[#F04452] border-[#F04452]/30' : 'bg-[#3182F6]/15 text-[#3182F6] border-[#3182F6]/30'
                            }`}>
                              {opt.option_type}
                            </span>
                          </td>

                          <td className="py-3 px-4 border-none text-right font-black text-white tabular-nums">
                            ₩{strike.toLocaleString()}
                          </td>

                          <td className="py-3 px-4 border-none text-right font-black text-[#F04452] tabular-nums">
                            ₩{Number(opt.current_price || 1000).toLocaleString()}
                          </td>

                          <td className="py-3 px-4 border-none text-right text-white tabular-nums font-bold">
                            {fmtVolume(opt.open_interest)}
                            {isGammaWall && (
                              <span className="ml-1.5 px-2 py-0.5 text-[9px] bg-[#F04452]/15 text-[#F04452] font-black rounded-full border border-[#F04452]/40">
                                WALL
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 border-none text-center font-bold text-[11px]">
                            {isITM && (
                              <span className="px-2.5 py-0.5 rounded-full bg-[#F04452]/15 text-[#F04452] border border-[#F04452]/30 font-black">
                                ITM (내가격)
                              </span>
                            )}
                            {isATM && (
                              <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-white border border-white/30 animate-pulse font-black">
                                ATM (핀 위치)
                              </span>
                            )}
                            {isOTM && (
                              <span className="px-2.5 py-0.5 rounded-full bg-[#161B22] text-[#8E939D] border border-[#212631]">
                                OTM (외가격)
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 border-none text-center">
                            <button
                              onClick={() => handleTradeOption(opt)}
                              className="px-3 py-1 text-[11px] font-black bg-[#F04452] hover:bg-[#ff5252] text-white rounded-full transition-all cursor-pointer shadow-md"
                            >
                              매수
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </StrictWidget>
  );
}

