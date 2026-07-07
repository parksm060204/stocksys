import { change, fmtPrice, fmtSigned } from "@/lib/format";
import type { MarketId } from "@/lib/types";

export function ChangeBadge({
  current,
  prev,
  market,
}: {
  current: number;
  prev: number;
  market: MarketId;
}) {
  const { amount, percent, dir } = change(current, prev);
  const color =
    dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-muted";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "–";
  return (
    <span className={`font-mono text-[12px] tabular-nums ${color}`}>
      {arrow} {fmtSigned(percent)}% · {fmtPrice(Math.abs(amount), market)}
    </span>
  );
}

export function PriceTag({
  current,
  prev,
  market,
  size = "md",
}: {
  current: number;
  prev: number;
  market: MarketId;
  size?: "sm" | "md" | "lg";
}) {
  const { dir } = change(current, prev);
  const color = dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-tx";
  const cls = size === "lg" ? "text-2xl" : size === "sm" ? "text-[13px]" : "text-base";
  return <span className={`font-mono font-semibold tabular-nums ${color} ${cls}`}>{fmtPrice(current, market)}</span>;
}
