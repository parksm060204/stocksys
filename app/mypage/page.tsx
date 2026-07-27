import Link from "next/link";
import { fmtPrice } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 0; // Disable static caching to fetch live user data

export default async function MyPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

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

  const totalValue = rows.reduce((a, r) => a + r.value, 0);
  const totalCost = rows.reduce((a, r) => a + r.cost, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost !== 0 ? (totalPnl / totalCost) * 100 : 0;

  // 환율 적용 총 자산 계산
  const ratesMap = new Map((ratesData || []).map((r) => [r.currency_code, Number(r.rate_to_krw)]));
  const getRate = (code: string) => ratesMap.get(code) || 1;

  const usdInKrw = usd * getRate("USD");
  const eurInKrw = eur * getRate("EUR");
  const jpyInKrw = jpy * getRate("JPY");
  const cnyInKrw = cny * getRate("CNY");
  const gbpInKrw = gbp * getRate("GBP");
  const totalCurrenciesInKrw = cash + usdInKrw + eurInKrw + jpyInKrw + cnyInKrw + gbpInKrw;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6 font-sans">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">마이페이지</h1>
          <p className="text-[13px] text-gray-400">
            {session.user.user_metadata?.full_name || session.user.email} 님의 가상 자산 포트폴리오
          </p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Summary label="총 자산 (원화 환산)" value={fmtPrice(totalValue + totalCurrenciesInKrw, "domestic")} />
        <Summary label="주식 평가금액" value={fmtPrice(totalValue, "domestic")} />
        <Summary label="원화 예수금" value={fmtPrice(cash, "domestic")} />
        <Summary
          label="평가 손익"
          value={`${fmtPrice(totalPnl, "domestic")} (${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%)`}
          tone={totalPnl >= 0 ? "up" : "down"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* 보유 종목 테이블 */}
        <div className="lg:col-span-2 rounded-xl border border-[#222736] bg-[#141721]">
          <div className="border-b border-[#222736] px-4 py-3 flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-white">보유 종목</h2>
            <span className="text-[11px] text-gray-500 font-mono">{rows.length}개 종목</span>
          </div>
          <div className="overflow-x-auto">
            {rows.length === 0 ? (
              <div className="p-8 text-center text-[13px] text-gray-500">현재 보유 중인 종목이 없습니다.</div>
            ) : (
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-[#222736] text-[11px] uppercase tracking-wider text-gray-500 bg-[#090a0f]">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">종목</th>
                    <th className="px-4 py-2.5 text-right font-semibold">보유 수량</th>
                    <th className="px-4 py-2.5 text-right font-semibold">평단가</th>
                    <th className="px-4 py-2.5 text-right font-semibold">현재가</th>
                    <th className="px-4 py-2.5 text-right font-semibold">평가금액</th>
                    <th className="px-4 py-2.5 text-right font-semibold">손익</th>
                    <th className="px-4 py-2.5 text-right font-semibold">수익률</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.stockId} className="border-b border-[#222736]/60 last:border-0 hover:bg-[#1c202c]">
                      <td className="px-4 py-3">
                        <Link href={`/stocks/${r.stockId}`} className="font-medium text-white hover:text-[#0A84FF]">
                          {r.name}
                        </Link>
                        <div className="font-mono text-[11px] text-gray-500">{r.ticker}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-gray-300">{r.quantity.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-gray-400">{fmtPrice(r.avgPrice, r.market as any)}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-white">{fmtPrice(r.currentPrice, r.market as any)}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-white">{fmtPrice(r.value, r.market as any)}</td>
                      <td className={`px-4 py-3 text-right font-mono tabular-nums ${r.pnl >= 0 ? "text-[#FF453A]" : "text-[#0A84FF]"}`}>
                        {r.pnl >= 0 ? "+" : ""}{fmtPrice(r.pnl, r.market as any)}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold tabular-nums ${r.pnlPct >= 0 ? "text-[#FF453A]" : "text-[#0A84FF]"}`}>
                        {r.pnlPct >= 0 ? "+" : ""}{r.pnlPct.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 보유 외화 지갑 카드 */}
        <div className="rounded-xl border border-[#222736] bg-[#141721] p-4 flex flex-col">
          <div className="border-b border-[#222736] pb-3 mb-3">
            <h2 className="text-[14px] font-semibold text-white">보유 외화 지갑</h2>
          </div>
          <div className="grid grid-cols-2 gap-2 flex-1">
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
  const color = tone === "up" ? "text-[#FF453A]" : tone === "down" ? "text-[#0A84FF]" : "text-white";
  return (
    <div className="rounded-xl border border-[#222736] bg-[#141721] p-4">
      <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</div>
      <div className={`mt-1 font-mono text-[16px] font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function CurrencyItem({ code, name, amount, icon }: { code: string; name: string; amount: number; icon: string }) {
  return (
    <div className="rounded-lg border border-[#222736]/80 bg-[#090a0f] p-3 hover:border-gray-600 transition-all">
      <div className="text-[10px] text-gray-500 uppercase font-semibold">{name} ({code})</div>
      <div className="mt-1 font-mono text-[14px] font-bold text-white tabular-nums">
        {icon} {amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}
      </div>
    </div>
  );
}
