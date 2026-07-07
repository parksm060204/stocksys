export const TRILLION = 1_000_000_000_000; // 1조
export const QUADRILLION = 10_000 * TRILLION; // 1경

export const LP_CONFIG = {
  lpAccountCount: 55,
  lpCapitalPerAccount: 1000 * TRILLION, // 1000조
  macroCount: 5,
  macroCapitalPerAccount: 100 * TRILLION, // 100조

  domesticTotalCap: 4000 * TRILLION, // 4000조
  overseasTotalCap: 5 * QUADRILLION, // 5경 = 50,000조

  tickInterval: 100, // 0.1초
  orderBookLevels: 10,
  maxUserImpactPct: 0.5, // 유저 주문이 가격에 미치는 최대 영향 0.5%
} as const;

export type CapClass = "mega" | "large" | "mid" | "small" | "micro";

export const CAP_THRESHOLDS: Record<CapClass, { min: number; label: string }> = {
  mega: { min: 500 * TRILLION, label: "초대형주" },
  large: { min: 100 * TRILLION, label: "대형주" },
  mid: { min: 10 * TRILLION, label: "중형주" },
  small: { min: 1 * TRILLION, label: "소형주" },
  micro: { min: 0, label: "마이크로주" },
};

export function classifyCap(marketCap: number): CapClass {
  if (marketCap >= CAP_THRESHOLDS.mega.min) return "mega";
  if (marketCap >= CAP_THRESHOLDS.large.min) return "large";
  if (marketCap >= CAP_THRESHOLDS.mid.min) return "mid";
  if (marketCap >= CAP_THRESHOLDS.small.min) return "small";
  return "micro";
}

export function capLabel(marketCap: number): string {
  return CAP_THRESHOLDS[classifyCap(marketCap)].label;
}
