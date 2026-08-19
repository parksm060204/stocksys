import Link from "next/link";
import { fmtPrice } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export const revalidate = 0; // Disable static caching to fetch live user data

export default async function MyPage() {
  const session = await getServerSession(authOptions);

  // 1. 비로그인 상태일 경우: 마이페이지 데이터 렌더링을 완전 차단하고 로그인 안내 표시
  if (!session?.user) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center font-sans">
        <div className="rounded-2xl border border-[#222736] bg-[#141721] p-10 space-y-4 shadow-xl">
          <div className="text-4xl mb-2">🔒</div>
          <h1 className="text-2xl font-bold text-white">로그인이 필요한 서비스입니다</h1>
          <p className="text-[13px] text-gray-400 max-w-md mx-auto leading-relaxed">
            마이페이지는 가상 주식 거래소 계정의 포트폴리오, 손익 현황 및 외화 지갑을 확인하는 공간입니다. 상단 우측의 Google 로그인 버튼을 눌러 접속해 주세요.
          </p>
          <div className="pt-4">
            <Link
              href="/"
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-[#3182F6] hover:bg-[#2b72d6] text-white font-bold text-[13px] transition-all"
            >
              메인홈으로 돌아가기
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 2. 로그인된 상태: 해당 사용자의 실제 DB 프로필 및 보유 자산 조회
  const userId = session.user.id;
  const supabase = await createClient();

  const [{ data: profile }, { data: holdingsData }, { data: ratesData }] = await Promise.all([
    supabase
      .from("profiles")
      .select("cash, usd_balance, eur_balance, jpy_balance, cny_balance, gbp_balance")
      .eq("id", userId)
      .single(),
    supabase
      .from("holdings")
      .select("stock_id, quantity, avg_price, stocks(id, ticker, name, market, current_price)")
      .eq("user_id", userId),
    supabase.from("exchange_rates").select("*"),
  ]);

  const cash = Number(profile?.cash || 0);
  const usd = Number(profile?.usd_balance || 0);
  const eur = Number(profile?.eur_balance || 0);
  const jpy = Number(profile?.jpy_balance || 0);
  const cny = Number(profile?.cny_balance || 0);
  const gbp = Number(profile?.gbp_balance || 0);

  // 보유 주식 실시간 손익 계산
  const rows = (holdingsData || []).map((h: any) => {
    const stock = h.stocks;
    const currentPrice = Number(stock?.current_price || h.avg_price);
    const quantity = Number(h.quantity || 0);
    const avgPrice = Number(h.avg_price || 0);
    const market = stock?.market || "domestic";

    const value = currentPrice * quantity;
    const cost = avgPrice * quantity;
    const pnl = value - cost;
    const pnlPct = cost !== 0 ? (pnl / cost) * 100 : 0;

    return {
      stockId: h.stock_id,
      name: stock?.name || "알 수 없는 종목",
      ticker: stock?.ticker || "UNKN",
      market,
      quantity,
      avgPrice,
      currentPrice,
      value,
      cost,
      pnl,
      pnlPct,
    };
  });

  const totalValue = rows.reduce((a: number, r: any) => a + Number(r.value || 0), 0);
  const totalCost = rows.reduce((a: number, r: any) => a + Number(r.cost || 0), 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost !== 0 ? (totalPnl / totalCost) * 100 : 0;

  // 환율 적용 총 자산 계산
  const ratesMap = new Map((ratesData || []).map((r: any) => [r.currency_code, Number(r.rate_to_krw || 1)]));
  const getRate = (code: string): number => Number(ratesMap.get(code) || 1);

  const usdInKrw = Number(usd || 0) * getRate("USD");
  const eurInKrw = Number(eur || 0) * getRate("EUR");
  const jpyInKrw = Number(jpy || 0) * getRate("JPY");
  const cnyInKrw = Number(cny || 0) * getRate("CNY");
  const gbpInKrw = Number(gbp || 0) * getRate("GBP");
  const totalCurrenciesInKrw = Number(cash || 0) + usdInKrw + eurInKrw + jpyInKrw + cnyInKrw + gbpInKrw;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6 font-sans space-y-6">
      {/* Header Banner */}
      <div className="bg-[#0E1117] border border-[#212631] p-6 rounded-3xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-2xl">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#F04452]/40 bg-[#F04452]/10 px-3.5 py-1 text-[11px] font-mono font-bold text-[#F04452] mb-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[#F04452] animate-pulse" />
            MY PORTFOLIO · 가상 계좌 마이페이지
          </div>
          <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
            마이페이지 & 포트폴리오
          </h1>
          <p className="text-[12.5px] text-[#8E939D] mt-1 font-medium">
            {session.user.name || session.user.email} 님의 실시간 자산 및 보유 외화 지갑 현황입니다.
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 font-mono">
        <Summary label="총 자산 (원화 환산)" value={fmtPrice(totalValue + totalCurrenciesInKrw, "domestic")} />
        <Summary label="주식 평가금액" value={fmtPrice(totalValue, "domestic")} />
        <Summary label="원화 예수금" value={fmtPrice(cash, "domestic")} />
        <Summary
          label="평가 손익"
          value={`${fmtPrice(totalPnl, "domestic")} (${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%)`}
          tone={totalPnl >= 0 ? "up" : "down"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 보유 종목 테이블 */}
        <div className="lg:col-span-2 rounded-3xl border border-[#212631] bg-[#0E1117] overflow-hidden shadow-2xl">
          <div className="border-b border-[#212631] px-5 py-4 flex items-center justify-between bg-[#090B0F]">
            <h2 className="text-[14px] font-black text-white">보유 종목 리스트</h2>
            <span className="text-[11px] text-[#8E939D] font-mono font-bold">{rows.length}개 종목</span>
          </div>
          <div className="overflow-x-auto">
            {rows.length === 0 ? (
              <div className="p-12 text-center text-[13px] text-[#8E939D] font-mono">현재 보유 중인 종목이 없습니다.</div>
            ) : (
              <table className="w-full text-left text-[13px] border-collapse font-mono">
                <thead className="border-b border-[#212631] text-[11px] font-extrabold uppercase tracking-wider text-[#8E939D] bg-[#090B0F]">
                  <tr>
                    <th className="px-5 py-3 font-bold border-none">종목</th>
                    <th className="px-5 py-3 text-right font-bold border-none">보유 수량</th>
                    <th className="px-5 py-3 text-right font-bold border-none">평단가</th>
                    <th className="px-5 py-3 text-right font-bold border-none">현재가</th>
                    <th className="px-5 py-3 text-right font-bold border-none">평가금액</th>
                    <th className="px-5 py-3 text-right font-bold border-none">손익</th>
                    <th className="px-5 py-3 text-right font-bold border-none">수익률</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#212631]">
                  {rows.map((r: any) => (
                    <tr key={r.stockId} className="transition-colors hover:bg-[#161B22] border-b border-[#212631] last:border-none">
                      <td className="px-5 py-4 border-none">
                        <Link href={`/stocks/${r.stockId}`} className="font-extrabold text-white hover:text-[#F04452] transition-colors">
                          {r.name}
                        </Link>
                        <div className="font-mono text-[11px] text-[#565A63] font-bold">{r.ticker}</div>
                      </td>
                      <td className="px-5 py-4 text-right font-mono tabular-nums text-[#8E939D] font-medium">{r.quantity.toLocaleString()}</td>
                      <td className="px-5 py-4 text-right font-mono tabular-nums text-[#8E939D] font-medium">{fmtPrice(r.avgPrice, r.market as any)}</td>
                      <td className="px-5 py-4 text-right font-mono tabular-nums text-white font-bold">{fmtPrice(r.currentPrice, r.market as any)}</td>
                      <td className="px-5 py-4 text-right font-mono tabular-nums text-white font-black">{fmtPrice(r.value, r.market as any)}</td>
                      <td className={`px-5 py-4 text-right font-mono tabular-nums font-black ${r.pnl >= 0 ? "text-[#F04452]" : "text-[#3182F6]"}`}>
                        {r.pnl >= 0 ? "+" : ""}{fmtPrice(r.pnl, r.market as any)}
                      </td>
                      <td className={`px-5 py-4 text-right font-mono font-black tabular-nums ${r.pnlPct >= 0 ? "text-[#F04452]" : "text-[#3182F6]"}`}>
                        <span className={`inline-block px-2 py-0.5 rounded-full border text-[11.5px] ${
                          r.pnlPct >= 0 ? "bg-[#F04452]/10 border-[#F04452]/30 text-[#F04452]" : "bg-[#3182F6]/10 border-[#3182F6]/30 text-[#3182F6]"
                        }`}>
                          {r.pnlPct >= 0 ? "+" : ""}{r.pnlPct.toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 보유 외화 지갑 카드 */}
        <div className="rounded-3xl border border-[#212631] bg-[#0E1117] p-5 flex flex-col shadow-2xl space-y-4">
          <div className="border-b border-[#212631] pb-3">
            <h2 className="text-[14px] font-black text-white">보유 외화 지갑</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 flex-1">
            <CurrencyItem code="KRW" name="원화" amount={cash} icon="₩" />
            <CurrencyItem code="USD" name="달러" amount={usd} icon="$" />
            <CurrencyItem code="EUR" name="유로" amount={eur} icon="€" />
            <CurrencyItem code="JPY" name="엔화" amount={jpy} icon="¥" />
            <CurrencyItem code="CNY" name="위안화" amount={cny} icon="元" />
            <CurrencyItem code="GBP" name="파운드" amount={gbp} icon="£" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-[#F04452]" : tone === "down" ? "text-[#3182F6]" : "text-white";
  return (
    <div className="rounded-2xl border border-[#212631] bg-[#0E1117] p-4 shadow-xl">
      <div className="text-[10.5px] uppercase tracking-wider text-[#8E939D] font-bold">{label}</div>
      <div className={`mt-1 font-mono text-[16px] font-black tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function CurrencyItem({ code, name, amount, icon }: { code: string; name: string; amount: number; icon: string }) {
  return (
    <div className="rounded-2xl border border-[#212631] bg-[#05070A] p-3.5 hover:border-[#F04452]/40 transition-all font-mono">
      <div className="text-[10.5px] text-[#8E939D] uppercase font-bold">{name} ({code})</div>
      <div className="mt-1 font-mono text-[14px] font-black text-white tabular-nums">
        {icon} {amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}
      </div>
    </div>
  );
}

