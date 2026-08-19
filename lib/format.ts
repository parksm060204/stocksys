import type { MarketId } from "./types";

export function change(current?: number | null, prev?: number | null) {
  if (current === undefined || current === null || prev === undefined || prev === null || prev <= 0 || isNaN(prev) || isNaN(current)) {
    return { amount: 0, percent: 0, dir: "flat" as const };
  }
  const amount = current - prev;
  const rawPercent = (amount / prev) * 100;
  const percent = Math.max(-99.99, Math.min(999.99, rawPercent));
  const dir = amount > 0 ? ("up" as const) : amount < 0 ? ("down" as const) : ("flat" as const);
  return { amount, percent, dir };
}

export function fmtPrice(price?: number | null, market?: MarketId): string {
  if (price === undefined || price === null || isNaN(price)) {
    return market === "overseas" || market === "europe" || market === "commodities" ? "$0.00" : market === "options" ? "0.00P" : market === "bonds" ? "0.00" : "₩0";
  }
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

export function fmtVolume(v?: number | null): string {
  if (v === undefined || v === null || isNaN(v)) return "0";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

export function fmtCap(v?: number | null): string {
  if (v === undefined || v === null || isNaN(v)) return "0";
  if (v >= 1_000_000_000_000) return `${(v / 1_000_000_000_000).toFixed(1)}조`;
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}억`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  return v.toLocaleString();
}

export function fmtSigned(v?: number | null, digits = 2): string {
  if (v === undefined || v === null || isNaN(v)) return (0).toFixed(digits);
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s;
}

/**
 * DB에 저장된 UTC 일시/타임스탬프를 한국 표준시 KST(Asia/Seoul / 서버시간) 기준 시각으로 변환
 */
export function fmtKSTTime(input?: string | number | Date | null): string {
  if (!input) return "--:--:--";
  let date: Date;
  if (typeof input === "string") {
    const isoStr = input.includes("Z") || input.includes("+") ? input : input.replace(" ", "T") + "Z";
    date = new Date(isoStr);
  } else {
    date = new Date(input);
  }

  if (isNaN(date.getTime())) return "--:--:--";

  return date.toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

