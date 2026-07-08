import type { Stock, MarketId } from "./types";
import { fmtSigned } from "./format";

export interface MarketIndex {
  id: string;
  name: string;
  nameKo: string;
  market: MarketId;
  baseValue: number;
  currentValue: number;
  previousClose: number;
  changePct: number;
  changeAmount: number;
  totalMarketCap: number;
  constituentCount: number;
  topGainers: { name: string; ticker: string; changePct: number }[];
  topLosers: { name: string; ticker: string; changePct: number }[];
}

function calcIndex(stocks: Stock[], baseValue: number): {
  indexValue: number;
  totalCap: number;
} {
  const totalCap = stocks.reduce((sum, s) => sum + (s.marketCap || 0), 0);

  let weightedChange = 0;
  let totalPrevCap = 0;
  for (const s of stocks) {
    // We assume currentPrice is already updated from DB
    const prevCap = s.previousClose * ((s.marketCap || 0) / (s.currentPrice || 1));
    totalPrevCap += prevCap;
    weightedChange += (s.currentPrice - s.previousClose) / s.previousClose * prevCap;
  }
  let indexChange = totalPrevCap > 0 ? weightedChange / totalPrevCap : 0;
  
  // Hard limits
  const maxLimit = 0.20;
  const minLimit = -0.30;
  indexChange = Math.max(minLimit, Math.min(maxLimit, indexChange));

  const indexValue = baseValue * (1 + indexChange);

  return { indexValue: +indexValue.toFixed(2), totalCap };
}

function getMovers(stocks: Stock[], count: number, direction: "up" | "down") {
  const movers = stocks
    .map((s) => {
      return {
        name: s.name,
        ticker: s.ticker,
        changePct: ((s.currentPrice - s.previousClose) / s.previousClose) * 100,
      };
    })
    .sort((a, b) => (direction === "up" ? b.changePct - a.changePct : a.changePct - b.changePct));

  return movers.slice(0, count);
}

export function getKOSPIIndex(stocks: Stock[]): MarketIndex {
  const domesticStocks = stocks.filter((s) => s.market === "domestic");
  const baseValue = 2500;
  const { indexValue, totalCap } = calcIndex(domesticStocks, baseValue);

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
    constituentCount: domesticStocks.length,
    topGainers: getMovers(domesticStocks, 5, "up"),
    topLosers: getMovers(domesticStocks, 5, "down"),
  };
}

export function getSP50Index(stocks: Stock[]): MarketIndex {
  const overseasStocks = stocks.filter((s) => s.market === "overseas");
  const baseValue = 5000;
  const { indexValue, totalCap } = calcIndex(overseasStocks, baseValue);

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
    constituentCount: overseasStocks.length,
    topGainers: getMovers(overseasStocks, 5, "up"),
    topLosers: getMovers(overseasStocks, 5, "down"),
  };
}

export function getEuroStoxx50Index(stocks: Stock[]): MarketIndex {
  const europeStocks = stocks.filter((s) => s.market === "europe");
  const baseValue = 4000;
  const { indexValue, totalCap } = calcIndex(europeStocks, baseValue);

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
    constituentCount: europeStocks.length,
    topGainers: getMovers(europeStocks, 5, "up"),
    topLosers: getMovers(europeStocks, 5, "down"),
  };
}

export function getAllIndices(stocks: Stock[]): MarketIndex[] {
  return [getKOSPIIndex(stocks), getSP50Index(stocks), getEuroStoxx50Index(stocks)];
}

export function formatIndex(index: MarketIndex): string {
  const dir = index.changeAmount > 0 ? "▲" : index.changeAmount < 0 ? "▼" : "–";
  return `${index.nameKo}: ${index.currentValue.toLocaleString()} ${dir} ${fmtSigned(index.changePct)}%`;
}

export { calcIndex, getMovers };
