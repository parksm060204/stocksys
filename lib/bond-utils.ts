/**
 * bond-utils.ts — 채권 전용 계산 유틸리티
 *
 * 핵심 원칙: 가격과 YTM은 역상관관계
 *   - 채권 가격 ↓  =>  YTM ↑  (더 싸게 사서 같은 이자 받으니 수익률 올라감)
 *   - 채권 가격 ↑  =>  YTM ↓
 *
 * 가격 단위: 액면가 100 기준 (예: 98.5 = 액면가의 98.5%)
 */

export interface BondMeta {
  couponRate: number;    // 표면금리 (%) e.g. 3.5
  faceValue: number;     // 액면가 (100 기준)
  maturityYears: number; // 잔존만기 (년)
  currentYtm: number;    // 현재 YTM (%)
  riskCategory: "sovereign" | "corporate_ig" | "high_yield";
  countryCode: string;   // "US" | "KR" | "DE" | etc.
  issuerName?: string;   // 발행기관/기업명
}

/**
 * 근사 YTM 계산 (Approximate YTM formula)
 * YTM ≈ (C + (F - P) / N) / ((F + P) / 2)
 * C = 연간 이자 (couponRate * faceValue / 100)
 * F = 액면가 (face value)
 * P = 현재 가격 (current price)
 * N = 잔존 만기 (years)
 */
export function calcYTM(
  price: number,
  faceValue: number,
  couponRate: number,
  maturityYears: number,
): number {
  if (price <= 0 || maturityYears <= 0) return 0;
  const C = (couponRate / 100) * faceValue;
  const ytm = (C + (faceValue - price) / maturityYears) / ((faceValue + price) / 2);
  return Math.max(0, +(ytm * 100).toFixed(4)); // %로 반환
}

/**
 * YTM → 가격 역산 (근사)
 * P ≈ (C + F/N + F * ytm/2) / (1/N + ytm/2)  — 근사식
 *
 * 더 직관적 재정리:
 * ytm = (C + (F - P)/N) / ((F + P)/2)
 * 풀면: P = (C * 2 + F * (2/N - ytm)) / (ytm + 2/N)
 */
export function calcPriceFromYTM(
  ytm: number,       // YTM (%)
  faceValue: number,
  couponRate: number,
  maturityYears: number,
): number {
  if (ytm <= 0 || maturityYears <= 0) return faceValue;
  const y = ytm / 100;
  const C = (couponRate / 100) * faceValue;
  const N = maturityYears;
  const price = (2 * C + faceValue * (2 / N - y)) / (y + 2 / N);
  return Math.max(0, +price.toFixed(4));
}

/** YTM 포맷 (예: 4.25%) */
export function fmtYTM(ytm: number): string {
  return `${ytm.toFixed(2)}%`;
}

/**
 * 만기 보유 시 확정 수익 계산 (세전)
 * = (액면가 - 현재가격) + 표면이자 * 잔존만기
 *   단, 가격은 "주"당 실제 원화 가격으로 환산 필요
 */
export function calcMaturityProfit(params: {
  purchasePrice: number;   // 매수한 실제 가격 (원화)
  faceValue: number;       // 액면 실제 원화 (보통 10,000원)
  couponRatePct: number;   // 표면금리 (%)
  maturityYears: number;   // 잔존만기
  quantity: number;        // 매수 수량
}): {
  couponTotal: number;   // 총 이자 수입
  capitalGain: number;   // 자본손익 (만기 상환 - 매수가)
  total: number;         // 총 확정 수익
} {
  const { purchasePrice, faceValue, couponRatePct, maturityYears, quantity } = params;
  const annualCoupon = (couponRatePct / 100) * faceValue;
  const couponTotal = annualCoupon * maturityYears * quantity;
  const capitalGain = (faceValue - purchasePrice) * quantity;
  return {
    couponTotal,
    capitalGain,
    total: couponTotal + capitalGain,
  };
}

/**
 * 채권 위험 등급별 스프레드 기준금리 (%)
 * 기준금리에 이 값을 더하면 해당 등급 채권의 YTM 기준값
 */
export const CREDIT_SPREAD: Record<BondMeta["riskCategory"], number> = {
  sovereign: 0,       // 국채는 스프레드 없음
  corporate_ig: 0.8,  // 우량 회사채 +80bp
  high_yield: 8.0,    // 하이일드 +800bp (=8%)
};

/** 채권 카테고리 한글명 */
export const RISK_CATEGORY_KO: Record<BondMeta["riskCategory"], string> = {
  sovereign: "국채",
  corporate_ig: "우량 회사채",
  high_yield: "하이일드(정크)",
};
