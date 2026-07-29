import type { MarketId } from "./types";

export function change(current: number, prev: number) {
  if (!prev || prev <= 0 || isNaN(prev) || isNaN(current)) {
    return { amount: 0, percent: 0, dir: "flat" as const };
  }
  const amount = current - prev;
  const rawPercent = (amount / prev) * 100;
  const percent = Math.max(-99.99, Math.min(999.99, rawPercent));
  const dir = amount > 0 ? ("up" as const) : amount < 0 ? ("down" as const) : ("flat" as const);
  return { amount, percent, dir };
}

export function fmtPrice(price: number, market: MarketId): string {
  if (market === "overseas" || market === "europe" || market === "commodities") {
    return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (market === "options") {
    return `${price.toFixed(2)}P`;
  }
  if (market === "bonds") {
    return price.toFixed(2);
  }
  return `₩${Math.round(price).toLocaleString("ko-KR")}`;
}

export function fmtVolume(v?: number): string {
  if (v === undefined || v === null || isNaN(v)) return "0";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

export function fmtCap(v: number): string {
  if (v >= 1_000_000_000_000) return `${(v / 1_000_000_000_000).toFixed(1)}조`;
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}억`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  return v.toLocaleString();
}

export function fmtSigned(v: number, digits = 2): string {
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s;
}
