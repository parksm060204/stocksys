import Link from "next/link";
import { notFound } from "next/navigation";
import { STOCKS, getStock, getChatMessages, NEWS } from "@/lib/mock-data";
import { change, fmtPrice, fmtSigned, fmtVolume, fmtCap } from "@/lib/format";
import { ChangeBadge } from "@/app/components/PriceTag";
import RealtimePriceHeader from "@/app/components/RealtimePriceHeader";
import OrderBookPanel from "@/app/components/OrderBookPanel";
import TradeFeed from "@/app/components/TradeFeed";
import ChatPanel from "@/app/components/ChatPanel";
import OrderEntry from "@/app/components/OrderEntry";
import StockChart from "@/app/components/StockChart";
import FinancialPanel from "@/app/components/FinancialPanel";
import BondDetailPanel from "@/app/components/BondDetailPanel";

export function generateStaticParams() {
  return STOCKS.map((s) => ({ id: s.id }));
}

export default async function StockDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const stock = getStock(id);
  if (!stock) notFound();

  const { percent, amount, dir } = change(stock.currentPrice, stock.previousClose);
  const color = dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-muted";
  const relatedNews = NEWS.filter(
    (n) => n.sector === stock.sector || (n.sector && stock.sector.includes(n.sector)),
  );
  const messages = getChatMessages(stock.id);

  const marketMap: Record<string, { href: string; label: string }> = {
    domestic: { href: "/stocks?tab=kospi", label: "국내주식" },
    overseas: { href: "/stocks?tab=sp50", label: "미국주식" },
    europe: { href: "/stocks?tab=eurostoxx50", label: "유럽주식" },
  };
  const marketLink = marketMap[stock.market] || { href: `/markets/${stock.market}`, label: stock.market };

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <nav className="mb-4 flex items-center gap-2 text-[12px] text-dim">
        <Link href="/" className="hover:text-tx">
          메인홈
        </Link>
        <span>/</span>
        <Link href={marketLink.href} className="hover:text-tx">
          {marketLink.label}
        </Link>
        <span>/</span>
        <span className="text-muted">{stock.name}</span>
      </nav>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-tx">{stock.name}</h1>
            <span className="rounded bg-panel2 px-2 py-0.5 font-mono text-[12px] text-muted">
              {stock.ticker}
            </span>
            {stock.isCore && (
              <span className="rounded bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn">
                CORE 종목
              </span>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">{stock.description}</p>
        </div>
        <RealtimePriceHeader stock={stock} />
      </div>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 lg:col-span-3 space-y-5">
          <OrderBookPanel stock={stock} />
          <OrderEntry stock={stock} />
        </div>

        <div className="col-span-12 lg:col-span-5 space-y-5">
          <div className="rounded-xl border border-border bg-panel">
            <div className="border-b border-border px-4 py-2.5">
              <h3 className="text-[13px] font-semibold text-tx">가격 차트</h3>
            </div>
            <div className="relative p-4">
              <StockChart stock={stock} />
            </div>
            <div className="grid grid-cols-4 border-t border-border text-center text-[11px]">
              <Cell label="시가" value={fmtPrice(stock.openPrice, stock.market)} />
              <Cell label="고가" value={fmtPrice(stock.high, stock.market)} tone="up" />
              <Cell label="저가" value={fmtPrice(stock.low, stock.market)} tone="down" />
              <Cell label="거래량" value={fmtVolume(stock.volume)} />
            </div>
          </div>
          <TradeFeed stock={stock} />
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-5">
          <div className="rounded-xl border border-border bg-panel">
            <div className="border-b border-border px-4 py-2.5">
              <h3 className="text-[13px] font-semibold text-tx">기업 정보</h3>
            </div>
            <div className="grid grid-cols-2 gap-px bg-border/60">
              <Info label="섹터" value={stock.sector} />
              <Info label="시가총액" value={fmtCap(stock.marketCap)} />
              <Info label="목표가(LP)" value="🔒 비공개 (기관 전용)" />
              <Info label="섹터 민감도" value={`${stock.relevanceWeight}x`} />
              <Info label="상장일" value={stock.listedAt} />
              <Info label="전일 종가" value={fmtPrice(stock.previousClose, stock.market)} />
            </div>
          </div>
          
          {stock.market === "bonds" ? (
            <BondDetailPanel stock={stock} />
          ) : (
            <FinancialPanel stock={stock} />
          )}

          <div className="rounded-xl border border-border bg-panel">
            <div className="border-b border-border px-4 py-2.5">
              <h3 className="text-[13px] font-semibold text-tx">관련 뉴스 · 공시</h3>
            </div>
            {relatedNews.length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-dim">관련 뉴스가 없습니다</p>
            ) : (
              <div className="divide-y divide-border/60">
                {relatedNews.map((n) => (
                  <div key={n.id} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-px text-[9px] font-semibold ${
                          n.source === "AI" ? "bg-accent/15 text-accent" : n.source === "DISCLOSURE" ? "bg-warn/15 text-warn" : "bg-up/15 text-up"
                        }`}
                      >
                        {n.source}
                      </span>
                      <span className={`text-[10px] ${n.sentiment === "positive" ? "text-up" : n.sentiment === "negative" ? "text-down" : "text-dim"}`}>
                        {n.sentiment === "positive" ? "호재" : n.sentiment === "negative" ? "악재" : "중립"}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] text-tx">{n.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{n.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <ChatPanel stockId={stock.id} initial={messages} />
        </div>
      </div>

      <div className="mt-6">
        <ChangeBadge current={stock.currentPrice} prev={stock.previousClose} market={stock.market} />
      </div>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-tx";
  return (
    <div className="bg-panel px-2 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-dim">{label}</div>
      <div className={`mt-0.5 font-mono text-[12px] tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-dim">{label}</div>
      <div className="mt-0.5 font-mono text-[13px] tabular-nums text-tx">{value}</div>
    </div>
  );
}
