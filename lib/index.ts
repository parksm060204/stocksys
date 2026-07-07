import type { Stock, MarketId } from "./types";
import { STOCKS, LP_ENGINE } from "./mock-data";
import { fmtSigned } from "./format";

export interface MarketIndex {
  id: string;
  name: string;
  nameKo: string;
  market: MarketId;
  baseValue: number;       // 기준 시점 지수
  currentValue: number;    // 현재 지수
  previousClose: number;   // 전일 지수
  changePct: number;       // 등락률
  changeAmount: number;    // 등락 폭
  totalMarketCap: number;  // 구성 종목 총시총
  constituentCount: number;
  topGainers: { name: string; ticker: string; changePct: number }[];
  topLosers: { name: string; ticker: string; changePct: number }[];
}

function calcIndex(stocks: Stock[], baseValue: number): {
  indexValue: number;
  totalCap: number;
} {
  // 시가총액 가중 지수
  // 기준 시점의 총시총 대비 현재 총시총의 비율 × 기준 지수
  const totalCap = stocks.reduce((sum, s) => sum + s.marketCap, 0);

  // 각 종목의 시총 변화율을 가중 평균
  // previousClose 기준으로 현재 가격의 가중 변화율 계산
  let weightedChange = 0;
  let totalPrevCap = 0;
  for (const s of stocks) {
    const livePrice = LP_ENGINE?.states.get(s.id)?.currentPrice ?? s.currentPrice;
    const prevCap = s.previousClose * (s.marketCap / s.currentPrice);
    totalPrevCap += prevCap;
    weightedChange += (livePrice - s.previousClose) / s.previousClose * prevCap;
  }
  let indexChange = totalPrevCap > 0 ? weightedChange / totalPrevCap : 0;
  
  // Enforce index movement boundaries: Novel events [-30%, +20%], Basic news [-10%, +10%]
  const isNovel = LP_ENGINE?.activeEventIsNovel;
  const maxLimit = isNovel ? 0.20 : 0.10;
  const minLimit = isNovel ? -0.30 : -0.10;
  indexChange = Math.max(minLimit, Math.min(maxLimit, indexChange));

  const indexValue = baseValue * (1 + indexChange);

  return { indexValue: +indexValue.toFixed(2), totalCap };
}

function getConstituents(market: MarketId): Stock[] {
  return STOCKS.filter((s) => s.market === market);
}

function getMovers(stocks: Stock[], count: number, direction: "up" | "down") {
  const movers = stocks
    .map((s) => {
      const livePrice = LP_ENGINE?.states.get(s.id)?.currentPrice ?? s.currentPrice;
      return {
        name: s.name,
        ticker: s.ticker,
        changePct: ((livePrice - s.previousClose) / s.previousClose) * 100,
      };
    })
    .sort((a, b) => (direction === "up" ? b.changePct - a.changePct : a.changePct - b.changePct));

  return movers.slice(0, count);
}

export function getKOSPIIndex(): MarketIndex {
  const stocks = getConstituents("domestic");
  const baseValue = 2500; // 가상 KOSPI 기준 지수
  const { indexValue, totalCap } = calcIndex(stocks, baseValue);

  const previousClose = baseValue;
  const changeAmount = indexValue - previousClose;
  const changePct = previousClose > 0 ? (changeAmount / previousClose) * 100 : 0;

  return {
    id: "kospi",
    name: "KOSPI",
    nameKo: "KOSPI 지수",
    market: "domestic",
    baseValue,
    currentValue: indexValue,
    previousClose,
    changePct,
    changeAmount,
    totalMarketCap: totalCap,
    constituentCount: stocks.length,
    topGainers: getMovers(stocks, 5, "up"),
    topLosers: getMovers(stocks, 5, "down"),
  };
}

export function getSP50Index(): MarketIndex {
  const stocks = getConstituents("overseas");
  const baseValue = 5000; // 가상 S&P 50 기준 지수
  const { indexValue, totalCap } = calcIndex(stocks, baseValue);

  const previousClose = baseValue;
  const changeAmount = indexValue - previousClose;
  const changePct = previousClose > 0 ? (changeAmount / previousClose) * 100 : 0;

  return {
    id: "sp50",
    name: "S&P 50",
    nameKo: "S&P 50 지수",
    market: "overseas",
    baseValue,
    currentValue: indexValue,
    previousClose,
    changePct,
    changeAmount,
    totalMarketCap: totalCap,
    constituentCount: stocks.length,
    topGainers: getMovers(stocks, 5, "up"),
    topLosers: getMovers(stocks, 5, "down"),
  };
}

export function getEuroStoxx50Index(): MarketIndex {
  const stocks = getConstituents("europe");
  const baseValue = 4000; // 가상 Euro Stoxx 50 기준 지수
  const { indexValue, totalCap } = calcIndex(stocks, baseValue);

  const previousClose = baseValue;
  const changeAmount = indexValue - previousClose;
  const changePct = previousClose > 0 ? (changeAmount / previousClose) * 100 : 0;

  return {
    id: "eurostoxx50",
    name: "Euro Stoxx 50",
    nameKo: "유로스톡스 50 지수",
    market: "europe",
    baseValue,
    currentValue: indexValue,
    previousClose,
    changePct,
    changeAmount,
    totalMarketCap: totalCap,
    constituentCount: stocks.length,
    topGainers: getMovers(stocks, 5, "up"),
    topLosers: getMovers(stocks, 5, "down"),
  };
}

export function getAllIndices(): MarketIndex[] {
  return [getKOSPIIndex(), getSP50Index(), getEuroStoxx50Index()];
}

export function formatIndex(index: MarketIndex): string {
  const dir = index.changeAmount > 0 ? "▲" : index.changeAmount < 0 ? "▼" : "–";
  return `${index.nameKo}: ${index.currentValue.toLocaleString()} ${dir} ${fmtSigned(index.changePct)}%`;
}

export { calcIndex, getConstituents, getMovers };
