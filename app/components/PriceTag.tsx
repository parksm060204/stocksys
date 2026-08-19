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
  const badgeBg =
    dir === "up" ? "bg-[#F04452]/10 border-[#F04452]/30 text-[#F04452]" : dir === "down" ? "bg-[#3182F6]/10 border-[#3182F6]/30 text-[#3182F6]" : "bg-[#161B22] border-[#212631] text-[#8E939D]";
  return (
    <span className={`inline-block font-mono text-[12px] font-bold tabular-nums px-2.5 py-0.5 rounded-full border ${badgeBg}`}>
      {fmtSigned(percent)}% ({fmtPrice(Math.abs(amount), market)})

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
  const color = dir === "up" ? "text-[#F04452]" : dir === "down" ? "text-[#3182F6]" : "text-white";
  const cls = size === "lg" ? "text-3xl font-black" : size === "sm" ? "text-[13px] font-bold" : "text-base font-extrabold";
  return <span className={`font-mono tabular-nums ${color} ${cls}`}>{fmtPrice(current, market)}</span>;
}


