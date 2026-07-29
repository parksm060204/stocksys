import { notFound } from "next/navigation";
import { fmtCap } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Stock } from "@/lib/types";
import StockDetailV2Client from "./StockDetailV2Client";

export const revalidate = 0;

// 티커 기준 현실 상장일
const REAL_IPO_DATES: Record<string, string> = {
  "005930": "1975-06-11",
  "000660": "1996-12-26",
  "035420": "2008-11-28",
  "005380": "1994-11-16",
  "000270": "2000-12-29",
  "035720": "2010-11-11",
  "051910": "2003-02-03",
  "006400": "1994-08-08",
  "068270": "2015-12-15",
  "207940": "2021-01-22",
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

export default async function StockDetailV2Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("stocks")
    .select("*")
    .eq("id", id)
    .single();
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
    marketCap: row.market_cap
      ? Number(row.market_cap)
      : row.current_price * 1_000_000,
    openPrice: row.open_price ? Number(row.open_price) : row.previous_close,
    high: row.high ? Number(row.high) : row.current_price,
    low: row.low ? Number(row.low) : row.current_price,
    volume: row.volume ? Number(row.volume) : 0,
    relevanceWeight: row.relevance_weight ? Number(row.relevance_weight) : 1,
    targetPrice: row.target_price
      ? Number(row.target_price)
      : row.current_price,
    isCore: row.is_core || false,
    listedAt: formatListedAt(row.ticker, row.listed_at),
    financials: row.financials || null,
  };

  const isUSD =
    stock.market === "overseas" ||
    stock.market === "europe" ||
    stock.market === "commodities";
  const tradingValueStr = isUSD
    ? `$${fmtCap(stock.currentPrice * stock.volume)}`
    : `₩${fmtCap(stock.currentPrice * stock.volume)}`;

  // 관련 뉴스
  const { data: newsData } = await supabase
    .from("news_v2")
    .select("*")
    .or(
      `sector.eq.${stock.sector},headline.ilike.%${stock.name}%,content.ilike.%${stock.name}%`
    )
    .order("created_at", { ascending: false })
    .limit(8);
  const relatedNews = newsData || [];

  const messages: never[] = [];

  return (
    <StockDetailV2Client
      stock={stock}
      relatedNews={relatedNews}
      messages={messages}
      tradingValueStr={tradingValueStr}
    />
  );
}
