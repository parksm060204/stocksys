import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtCap } from "@/lib/format";
import RealtimePriceHeader from "@/app/components/RealtimePriceHeader";
import { createClient } from "@/lib/supabase/server";
import type { Stock } from "@/lib/types";
import StockDetailClient from "./StockDetailClient";

export const revalidate = 0;

// 티커 기준 현실 상장일 (KRX + NYSE/NASDAQ 구분 없이 주요 종목)
const REAL_IPO_DATES: Record<string, string> = {
  // 한국
  "005930": "1975-06-11", // 삼성전자
  "000660": "1996-12-26", // SK하이닙스
  "035420": "2008-11-28", // NAVER
  "005380": "1994-11-16", // 현대자
  "000270": "2000-12-29", // 기아자
  "035720": "2010-11-11", // 카카오
  "051910": "2003-02-03", // LG화학
  "006400": "1994-08-08", // 삼성SDI
  "068270": "2015-12-15", // 셀트리온
  "207940": "2021-01-22", // 삼성바이오로직
  // 미국
  AAPL: "1980-12-12",
  MSFT: "1986-03-13",
  AMZN: "1997-05-15",
  GOOGL: "2004-08-19",
  META: "2012-05-18",
  TSLA: "2010-06-29",
  NVDA: "1999-01-22",
  NFLX: "2002-05-23",
  AMD: "1972-09-27",
  INTC: "1971-10-13",
  JPM: "1969-01-01",
  BAC: "1969-01-01",
  GS: "1999-05-04",
  BRK: "1980-01-01",
  // 유럽
  ASML: "1995-03-30",
  SAP: "1998-08-03",
  LVMH: "1989-01-01",
  NESN: "1994-01-01",
  NOVO: "2023-09-01",
};

function formatListedAt(ticker: string, dbDate: string | null): string {
  const real = REAL_IPO_DATES[ticker.toUpperCase()];
  if (real) return real;
  if (dbDate) return dbDate.slice(0, 10);
  return "-";
}

export default async function StockDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: row } = await supabase.from('stocks').select('*').eq('id', id).single();
  if (!row) notFound();

  const stock: Stock = {
    id: row.id,
    name: row.name,
    ticker: row.ticker,
    market: row.market,
    sector: row.sector,
    currentPrice: row.current_price,
    previousClose: row.previous_close,
    description: row.description || "",
    marketCap: row.market_cap ? Number(row.market_cap) : row.current_price * 1000000,
    openPrice: row.open_price ? Number(row.open_price) : row.previous_close,
    high: row.high ? Number(row.high) : row.current_price,
    low: row.low ? Number(row.low) : row.current_price,
    volume: row.volume ? Number(row.volume) : 0,
    relevanceWeight: row.relevance_weight ? Number(row.relevance_weight) : 1,
    targetPrice: row.target_price ? Number(row.target_price) : row.current_price,
    isCore: row.is_core || false,
    listedAt: formatListedAt(row.ticker, row.listed_at),
    financials: row.financials || null,
  };

  const isUSD = stock.market === "overseas" || stock.market === "europe" || stock.market === "commodities";
  const tradingValueStr = isUSD ? `$${fmtCap(stock.currentPrice * stock.volume)}` : `₩${fmtCap(stock.currentPrice * stock.volume)}`;


  
  // Fetch news related to this stock or its sector
  const { data: newsData } = await supabase
    .from('market_news')
    .select('*')
    .or(`target_sector.eq.${stock.sector},headline.ilike.%${stock.name}%,summary.ilike.%${stock.name}%`)
    .order('created_at', { ascending: false })
    .limit(5);
  const relatedNews = newsData || [];

  // Fetch price history records
  const { data: priceHistoryData } = await supabase
    .from('stock_price_history')
    .select('*')
    .eq('stock_id', id)
    .order('created_at', { ascending: false })
    .limit(50);
  const priceHistory = priceHistoryData || [];


  // For now, chat messages are empty or we can fetch them if there's a chat table
  const messages: any[] = [];

  const marketMap: Record<string, { href: string; label: string }> = {
    domestic: { href: "/stocks?tab=kospi", label: "국내주식" },
    overseas: { href: "/stocks?tab=sp50", label: "미국주식" },
    europe: { href: "/stocks?tab=eurostoxx50", label: "유럽주식" },
  };
  const marketLink = marketMap[stock.market] || { href: `/markets/${stock.market}`, label: stock.market };

  return (
    <div className="h-screen w-full bg-black text-[#e6edf6] flex flex-col p-2 overflow-hidden font-sans">
      <nav className="mb-2 flex items-center gap-2 text-[12px] text-gray-500 shrink-0 px-2">
        <Link href="/" className="hover:text-white">메인홈</Link>
        <span>/</span>
        <Link href={marketLink.href} className="hover:text-white">{marketLink.label}</Link>
        <span>/</span>
        <span className="text-gray-400">{stock.name}</span>
      </nav>

      <div className="mb-3 flex flex-wrap items-end justify-between gap-4 border-b border-[#222] pb-2 px-2 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-white">{stock.name}</h1>
            <span className="rounded bg-[#111] px-2 py-0.5 font-mono text-[12px] text-gray-400">
              {stock.ticker}
            </span>
            {stock.isCore && (
              <span className="rounded bg-yellow-500/15 px-2 py-0.5 text-[11px] font-semibold text-yellow-500">
                CORE 종목
              </span>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-[13px] text-gray-500">{stock.description}</p>
        </div>
        <RealtimePriceHeader stock={stock} />
      </div>

      <StockDetailClient
        stock={stock}
        relatedNews={relatedNews}
        messages={messages}
        tradingValueStr={tradingValueStr}
        priceHistory={priceHistory}
      />
    </div>
  );
}
