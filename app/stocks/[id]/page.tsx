import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtCap } from "@/lib/format";
import RealtimePriceHeader from "@/app/components/RealtimePriceHeader";
import { createClient } from "@/lib/db/server";
import { sanitizePublicNewsRecord } from "@/lib/engine/simulation/marketEventTypes";
import type { Stock } from "@/lib/types";
import StockDetailClient from "./StockDetailClient";

export const revalidate = 0;

// 티커 기준 현실 상장일 (KRX + NYSE/NASDAQ 구분 없이 주요 종목)
const REAL_IPO_DATES: Record<string, string> = {
  // 한국
  "005930": "1975-06-11", // 삼성전자
  "000660": "1996-12-26", // SK하이닉스
  "035420": "2008-11-28", // NAVER
  "005380": "1994-11-16", // 현대차
  "000270": "2000-12-29", // 기아
  "035720": "2010-11-11", // 카카오
  "051910": "2003-02-03", // LG화학
  "006400": "1994-08-08", // 삼성SDI
  "068270": "2015-12-15", // 셀트리온
  "207940": "2021-01-22", // 삼성바이오로직스
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

  let { data: row } = await supabase.from('stocks').select('*').eq('id', id).maybeSingle();
  if (!row) {
    const { data: rowByTicker } = await supabase.from('stocks').select('*').eq('ticker', id).maybeSingle();
    row = rowByTicker;
  }

  let bondMeta: any = undefined;

  // stocks 테이블에 없는 경우 채권(bonds) 테이블에서 조회
  if (!row) {
    let { data: bondRow } = await supabase.from('bonds').select('*').eq('id', id).maybeSingle();
    if (!bondRow) {
      const { data: bondByTicker } = await supabase.from('bonds').select('*').eq('ticker', id).maybeSingle();
      bondRow = bondByTicker;
    }
    if (bondRow) {
      const curPrice = Number(bondRow.current_price) || 100;
      const prevClose = Number(bondRow.previous_close) || curPrice;
      row = {
        id: bondRow.id || bondRow.ticker,
        name: bondRow.name,
        ticker: bondRow.ticker,
        market: 'bonds',
        sector: bondRow.bond_type === 'govt' ? '국채' : bondRow.bond_type === 'corp_ig' ? '우량회사채' : '투기회사채',
        current_price: curPrice,
        previous_close: prevClose,
        description: `${bondRow.name} (${bondRow.ticker}) - 잔존만기 ${bondRow.maturity || '2Y'}, 표면금리 ${bondRow.coupon_rate || 3.25}%, 액면가 ${bondRow.face_value || 10000}원, 듀레이션 ${bondRow.duration || 1.9}년 채권 자산입니다.`,
        market_cap: (bondRow.face_value || 10000) * (bondRow.volume || 10000),
        open_price: prevClose,
        high: Math.max(curPrice, prevClose),
        low: Math.min(curPrice, prevClose),
        volume: Number(bondRow.volume) || 15000,
        relevance_weight: 1,
        target_price: curPrice,
        is_core: true,
        listed_at: '2020-01-01',
      };
      bondMeta = {
        faceValue: 100, // 100원 기준 계산
        couponRate: bondRow.coupon_rate || 3.25,
        maturityYears: bondRow.maturity ? parseInt(bondRow.maturity) || 2 : 2,
        currentYtm: bondRow.ytm || 3.35,
        riskCategory: bondRow.bond_type === 'govt' ? 'sovereign' : bondRow.bond_type === 'corp_ig' ? 'corporate_ig' : 'high_yield',
        countryCode: bondRow.ticker?.startsWith('US') ? 'US' : 'KR',
        issuerName: bondRow.name,
      };
    }
  }

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
    bondMeta: bondMeta || (row as any).bondMeta,
  };

  const isUSD = stock.market === "overseas" || stock.market === "europe" || stock.market === "commodities";
  const tradingValueStr = isUSD ? `$${fmtCap(stock.currentPrice * stock.volume)}` : `₩${fmtCap(stock.currentPrice * stock.volume)}`;

  // Fetch news related to this stock or its sector
  let relatedNews: any[] = [];
  try {
    const { data: newsData } = await supabase
      .from('market_news')
      .select('*')
      .or(`target_sector.eq.${stock.sector},headline.ilike.%${stock.name}%,summary.ilike.%${stock.name}%`)
      .order('created_at', { ascending: false })
      .limit(5);
    relatedNews = (newsData || []).map(sanitizePublicNewsRecord);
  } catch (e) {
    console.warn("Failed to fetch market news:", e);
  }

  // Fetch price history records (정규 stock.id 우선 조회 및 티커 fallback 지원)
  let priceHistory: any[] = [];
  try {
    let { data: priceHistoryData } = await supabase
      .from('stock_price_history')
      .select('*')
      .eq('stock_id', stock.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if ((!priceHistoryData || priceHistoryData.length === 0) && stock.ticker && stock.ticker !== stock.id) {
      const { data: fallbackData } = await supabase
        .from('stock_price_history')
        .select('*')
        .eq('stock_id', stock.ticker)
        .order('created_at', { ascending: false })
        .limit(50);
      if (fallbackData && fallbackData.length > 0) {
        priceHistoryData = fallbackData;
      }
    }
    priceHistory = priceHistoryData || [];
  } catch (e) {
    console.warn("Failed to fetch price history:", e);
  }


  // 채권 자산의 경우 priceHistory가 비어있으면 초기 포인트 제공
  if (stock.market === 'bonds' && priceHistory.length === 0) {
    priceHistory = [
      { id: 'bh_1', stock_id: stock.id, price: stock.currentPrice, volume: stock.volume, created_at: new Date().toISOString() },
      { id: 'bh_2', stock_id: stock.id, price: stock.previousClose, volume: Math.floor(stock.volume * 0.9), created_at: new Date(Date.now() - 60000).toISOString() },
    ];
  }

  const messages: any[] = [];

  const marketMap: Record<string, { href: string; label: string }> = {
    domestic: { href: "/stocks?tab=kospi", label: "국내주식" },
    overseas: { href: "/stocks?tab=sp50", label: "미국주식" },
    europe: { href: "/stocks?tab=eurostoxx50", label: "유럽주식" },
    bonds: { href: "/markets/bonds", label: "채권" },
  };
  const marketLink = marketMap[stock.market] || { href: `/markets/${stock.market}`, label: stock.market };

  return (
    <div className="min-h-screen w-full bg-bg text-tx flex flex-col p-2 md:p-3 overflow-y-auto font-sans">
      <nav className="mb-2 flex items-center gap-2 text-[12px] text-muted shrink-0 px-2">
        <Link href="/" className="hover:text-tx">메인홈</Link>
        <span>/</span>
        <Link href={marketLink.href} className="hover:text-tx">{marketLink.label}</Link>
        <span>/</span>
        <span className="text-tx font-medium">{stock.name}</span>
      </nav>

      <div className="mb-3 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-2 px-2 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-tx">{stock.name}</h1>
            <span className="rounded bg-panel2 border border-border px-2 py-0.5 font-mono text-[12px] text-muted">
              {stock.ticker}
            </span>
            {stock.isCore && (
              <span className="rounded bg-yellow-500/15 px-2 py-0.5 text-xs font-semibold text-yellow-500">
                CORE 종목
              </span>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">{stock.description}</p>
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
