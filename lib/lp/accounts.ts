import { LP_CONFIG, TRILLION } from "./config";
import type { LPAccount, InvestorCategory, BotStyle, MarketFocus, AlgoPattern, PortfolioAllocation, BondGrade, DerivativePurpose } from "./types";

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface AccountDef {
  name: string;
  investorCategory: InvestorCategory;
  botStyle: BotStyle;
  marketFocus: MarketFocus;
  algoPattern: AlgoPattern;
  capital: number;
  sectorBias: string | null;
  description: string;
}

// =====================================================
// 국내중심 LP (5계좌) — 100조~1000조, 언밸런스
// =====================================================
const DOMESTIC_DEFS: AccountDef[] = [
  {
    name: "국민연금공단",
    investorCategory: "INST_PENSION",
    botStyle: "PASSIVE",
    marketFocus: "DOMESTIC",
    algoPattern: "DEFENDER",
    capital: 1000 * TRILLION,
    sectorBias: null,
    description: "가장 막강한 자금력. 장기 가치 투자. 하락장에서 저가 매수로 증시 방어. 묵직하게 우량주 바닥 지지.",
  },
  {
    name: "한국투자증권 프랍",
    investorCategory: "INST_FINANCE",
    botStyle: "ACTIVE",
    marketFocus: "DOMESTIC",
    algoPattern: "SCALPER",
    capital: 150 * TRILLION,
    sectorBias: null,
    description: "증권사 자기자금 직접 매매. 단기 차익·알고리즘 매매. 호가창 빈 공간을 초단타로 채우고 빠짐.",
  },
  {
    name: "미래에셋자산운용",
    investorCategory: "INST_TRUST",
    botStyle: "ACTIVE",
    marketFocus: "DOMESTIC",
    algoPattern: "TREND_CHASER",
    capital: 300 * TRILLION,
    sectorBias: "반도체",
    description: "펀드 수익률 벤치마크 초과 달성 목표. 주도주 트렌드 적극 추종. 호재 시 가장 공격적으로 매수 호가 올림.",
  },
  {
    name: "삼성생명 보험운용",
    investorCategory: "INST_BANK_INS",
    botStyle: "PASSIVE",
    marketFocus: "DOMESTIC",
    algoPattern: "VALUE_HOLDER",
    capital: 200 * TRILLION,
    sectorBias: "금융",
    description: "보험료 운용. 가장 보수적. 시세 차익보다 배당금·우량주 중심. 거래 빈도 매우 낮음.",
  },
  {
    name: "신한 사모펀드",
    investorCategory: "INST_PEF",
    botStyle: "ACTIVE",
    marketFocus: "DOMESTIC",
    algoPattern: "MOMENTUM",
    capital: 100 * TRILLION,
    sectorBias: null,
    description: "절대 수익 추구. 롱숏 전략·공매도·모멘텀 투자. 가장 공격적이고 변동성 큰 매매.",
  },
];

// =====================================================
// 해외중심 LP (40계좌) — 100조~1경, 현실적 언밸런스
// =====================================================
const OVERSEAS_DEFS: AccountDef[] = [
  // --- 초대형 패시브 (Vanguard/BlackRock급) — 보수적, 자금 압도적 ---
  {
    name: "Vanguard Index Funds",
    investorCategory: "INST_PENSION",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "INDEX_TRACKER",
    capital: 10000 * TRILLION, // 1경
    sectorBias: null,
    description: "세계 최대 인덱스 펀드. 시장 지수를 기계적으로 추종. 개별 종목 호/악재보다 전체 자금 흐름에 따라 비중 조정.",
  },
  {
    name: "BlackRock iShares",
    investorCategory: "INST_PENSION",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "INDEX_TRACKER",
    capital: 9000 * TRILLION,
    sectorBias: null,
    description: "세계 2대 자산운용사. ETF 중심. 보수적 인덱스 추종. 자금이 막대하지만 매매 빈도 낮음.",
  },
  {
    name: "State Street Global Advisors",
    investorCategory: "INST_PENSION",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "INDEX_TRACKER",
    capital: 7000 * TRILLION,
    sectorBias: null,
    description: "세계 3대 자산운용사. SPDR ETF 운용. 기계적 인덱스 추종.",
  },
  {
    name: "Fidelity Investments",
    investorCategory: "INST_TRUST",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "INDEX_TRACKER",
    capital: 5000 * TRILLION,
    sectorBias: null,
    description: "대형 운용사. 인덱스 펀드 + 일부 액티브 운용. 보수적 성향.",
  },
  // --- 대형 연기금 ---
  {
    name: "CalPERS (캘리포니아 공무원연금)",
    investorCategory: "INST_PENSION",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "DEFENDER",
    capital: 3000 * TRILLION,
    sectorBias: null,
    description: "미국 최대 공무원 연기금. 장기 가치 투자. 하락장 방어.",
  },
  {
    name: "GPIF (일본 정부연금)",
    investorCategory: "INST_PENSION",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "DEFENDER",
    capital: 2500 * TRILLION,
    sectorBias: null,
    description: "세계 최대 연기금. 장기 보수적 운용. 하락장 바닥 지지.",
  },
  {
    name: "Norges Bank (노르웨이 국부펀드)",
    investorCategory: "INST_PENSION",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "VALUE_HOLDER",
    capital: 2000 * TRILLION,
    sectorBias: null,
    description: "세계 최대 국부펀드. 가치 투자 장기 보유. 거래 빈도 매우 낮음.",
  },
  {
    name: "ADIA (아부다비 투자청)",
    investorCategory: "INST_PENSION",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "VALUE_HOLDER",
    capital: 2000 * TRILLION,
    sectorBias: "에너지",
    description: "중東 최대 국부펀드. 에너지 섹터 편향. 장기 보수적 운용.",
  },
  // --- 대형 투신 (트렌드 추종) ---
  {
    name: "T. Rowe Price",
    investorCategory: "INST_TRUST",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "TREND_CHASER",
    capital: 1500 * TRILLION,
    sectorBias: "Technology",
    description: "대형 액티브 운용사. 주도주 추종. 호재 시 추격 매수.",
  },
  {
    name: "Capital Group (American Funds)",
    investorCategory: "INST_TRUST",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "TREND_CHASER",
    capital: 1200 * TRILLION,
    sectorBias: null,
    description: "장기 액티브 운용. 트렌드 추종하되 보유 기간 긴 편.",
  },
  {
    name: "Invesco Ltd.",
    investorCategory: "INST_TRUST",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "TREND_CHASER",
    capital: 1000 * TRILLION,
    sectorBias: null,
    description: "글로벌 운용사. 트렌드 추종 + 일부 인덱스.",
  },
  {
    name: "Franklin Templeton",
    investorCategory: "INST_TRUST",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "TREND_CHASER",
    capital: 800 * TRILLION,
    sectorBias: "Energy",
    description: "신흥시장+에너지 편향. 트렌드 추종.",
  },
  // --- 중형 사모펀드/헤지펀드 (공격적) ---
  {
    name: "Bridgewater Associates",
    investorCategory: "INST_PEF",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "MOMENTUM",
    capital: 1500 * TRILLION,
    sectorBias: null,
    description: "세계 최대 헤지펀드. 매크로 전략. 모멘텀 가속화.",
  },
  {
    name: "Renaissance Technologies",
    investorCategory: "INST_PEF",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "SCALPER",
    capital: 1000 * TRILLION,
    sectorBias: null,
    description: "수학적 알고리즘 매매. 초고빈도 스캘핑. 호가 빈 공간 초단타.",
  },
  {
    name: "Citadel LLC",
    investorCategory: "INST_PEF",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "ARBITRAGER",
    capital: 800 * TRILLION,
    sectorBias: null,
    description: "차익거래+통계적 차익. 가격 차이 이용. 방향성보다 변동성 먹음.",
  },
  {
    name: "Millennium Management",
    investorCategory: "INST_PEF",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "ARBITRAGER",
    capital: 700 * TRILLION,
    sectorBias: null,
    description: "멀티 전략 헤지펀드. 차익+모멘텀 병행.",
  },
  {
    name: "Point72 Asset Management",
    investorCategory: "INST_PEF",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "MOMENTUM",
    capital: 500 * TRILLION,
    sectorBias: "Biotech",
    description: "바이오 섹터 편향. 모멘텀 투자. 공격적 매매.",
  },
  {
    name: "Two Sigma Investments",
    investorCategory: "INST_PEF",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "SCALPER",
    capital: 600 * TRILLION,
    sectorBias: null,
    description: "데이터 기반 알고리즘 매매. 고빈도 스캘핑.",
  },
  {
    name: "D. E. Shaw & Co.",
    investorCategory: "INST_PEF",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "ARBITRAGER",
    capital: 500 * TRILLION,
    sectorBias: null,
    description: "차익거래+통계적 모델. 방향성 중립.",
  },
  {
    name: "Man Group (AHL)",
    investorCategory: "INST_PEF",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "MOMENTUM",
    capital: 400 * TRILLION,
    sectorBias: null,
    description: "트렌드 추종 CTA. 모멘텀 가속화.",
  },
  // --- 보험/은행 (보수적) ---
  {
    name: "Allianz Global Investors",
    investorCategory: "INST_BANK_INS",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "VALUE_HOLDER",
    capital: 700 * TRILLION,
    sectorBias: null,
    description: "독일 보험사 운용. 보수적 가치 투자. 배당주 중심.",
  },
  {
    name: "AXA Investment Managers",
    investorCategory: "INST_BANK_INS",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "VALUE_HOLDER",
    capital: 500 * TRILLION,
    sectorBias: null,
    description: "프랑스 보험사 운용. 보수적 장기 보유.",
  },
  {
    name: "JPMorgan Asset Management",
    investorCategory: "INST_BANK_INS",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "INDEX_TRACKER",
    capital: 800 * TRILLION,
    sectorBias: null,
    description: "은행 계열 운용. 인덱스+일부 액티브. 보수적.",
  },
  {
    name: "BNY Mellon Investment Mgmt",
    investorCategory: "INST_BANK_INS",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "INDEX_TRACKER",
    capital: 400 * TRILLION,
    sectorBias: null,
    description: "은행 계열. 인덱스 추종 중심.",
  },
  // --- 중소형 운용사 (다양한 성향) ---
  {
    name: "Wellington Management",
    investorCategory: "INST_TRUST",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "TREND_CHASER",
    capital: 1200 * TRILLION,
    sectorBias: null,
    description: "대형 액티브 운용사. 주도주 추종.",
  },
  {
    name: "Baillie Gifford",
    investorCategory: "INST_TRUST",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "TREND_CHASER",
    capital: 400 * TRILLION,
    sectorBias: "Technology",
    description: "성장주 편향. 기술 섹터 추종.",
  },
  {
    name: "Aberdeen Standard Investments",
    investorCategory: "INST_TRUST",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "VALUE_HOLDER",
    capital: 500 * TRILLION,
    sectorBias: null,
    description: "신흥시장 가치 투자. 보수적 장기 보유.",
  },
  {
    name: "Legal & General Investment Mgmt",
    investorCategory: "INST_PENSION",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "INDEX_TRACKER",
    capital: 600 * TRILLION,
    sectorBias: null,
    description: "영국 연기금 운용. 인덱스 추종.",
  },
  {
    name: "Northern Trust Asset Mgmt",
    investorCategory: "INST_PENSION",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "INDEX_TRACKER",
    capital: 400 * TRILLION,
    sectorBias: null,
    description: "인덱스+멀티팩터. 기계적 비중 조정.",
  },
  {
    name: "Geode Capital Management",
    investorCategory: "INST_PENSION",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "INDEX_TRACKER",
    capital: 800 * TRILLION,
    sectorBias: null,
    description: "Fidelity 계열 인덱스 운용. 기계적 추종.",
  },
  {
    name: "PIMCO",
    investorCategory: "INST_BANK_INS",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "VALUE_HOLDER",
    capital: 300 * TRILLION,
    sectorBias: "채권",
    description: "채권 중심 운용. 보수적.",
  },
  {
    name: "Schroders",
    investorCategory: "INST_TRUST",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "TREND_CHASER",
    capital: 300 * TRILLION,
    sectorBias: null,
    description: "영국 운용사. 액티브 트렌드 추종.",
  },
  {
    name: "Amundi Asset Management",
    investorCategory: "INST_TRUST",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "INDEX_TRACKER",
    capital: 400 * TRILLION,
    sectorBias: null,
    description: "유럽 최대 운용사. 인덱스 중심.",
  },
  {
    name: "Pictet Asset Management",
    investorCategory: "INST_TRUST",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "VALUE_HOLDER",
    capital: 200 * TRILLION,
    sectorBias: null,
    description: "스위스 프라이빗 뱅크. 보수적 가치 투자.",
  },
  {
    name: "Elliott Management",
    investorCategory: "INST_PEF",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "MOMENTUM",
    capital: 200 * TRILLION,
    sectorBias: null,
    description: "공격적 행동주의 펀드. 모멘텀+변동성 먹음.",
  },
  {
    name: "Caxton Associates",
    investorCategory: "INST_PEF",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "MOMENTUM",
    capital: 150 * TRILLION,
    sectorBias: null,
    description: "매크로 헤지펀드. 모멘텀 가속화.",
  },
  {
    name: "Winton Group",
    investorCategory: "INST_PEF",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "MOMENTUM",
    capital: 100 * TRILLION,
    sectorBias: null,
    description: "CTA 트렌드 추종. 모멘텀.",
  },
  {
    name: "AQR Capital Management",
    investorCategory: "INST_PEF",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "ARBITRAGER",
    capital: 300 * TRILLION,
    sectorBias: null,
    description: "멀티팩터+차익. 방향성 중립.",
  },
  {
    name: "Jupiter Asset Management",
    investorCategory: "INST_TRUST",
    botStyle: "ACTIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "TREND_CHASER",
    capital: 100 * TRILLION,
    sectorBias: null,
    description: "영국 중소형 운용사. 액티브 트렌드 추종.",
  },
  {
    name: "M&G Investments",
    investorCategory: "INST_BANK_INS",
    botStyle: "PASSIVE",
    marketFocus: "OVERSEAS",
    algoPattern: "VALUE_HOLDER",
    capital: 150 * TRILLION,
    sectorBias: null,
    description: "영국 보험사 운용. 보수적 가치 투자.",
  },
];

// =====================================================
// 세계적 IB (10계좌) — 각 3000조원
// =====================================================
const IB_DEFS: AccountDef[] = [
  {
    name: "Goldman Sachs",
    investorCategory: "FOREIGNER",
    botStyle: "ACTIVE",
    marketFocus: "GLOBAL",
    algoPattern: "ARBITRAGER",
    capital: 3000 * TRILLION,
    sectorBias: null,
    description: "세계 최대 투자은행. 프랍 트레이딩+시장 메이킹. 호가창 촘촘히 유지+차익거래.",
  },
  {
    name: "Morgan Stanley",
    investorCategory: "FOREIGNER",
    botStyle: "ACTIVE",
    marketFocus: "GLOBAL",
    algoPattern: "ARBITRAGER",
    capital: 3000 * TRILLION,
    sectorBias: null,
    description: "투자은행. 시장 메이킹+기관 주문 실행. 호가 유동성 공급.",
  },
  {
    name: "JPMorgan Chase (IB)",
    investorCategory: "FOREIGNER",
    botStyle: "ACTIVE",
    marketFocus: "GLOBAL",
    algoPattern: "ARBITRAGER",
    capital: 3000 * TRILLION,
    sectorBias: null,
    description: "대형 투자은행. 프랍+마켓 메이킹. 글로벌 유동성 공급.",
  },
  {
    name: "Deutsche Bank",
    investorCategory: "FOREIGNER",
    botStyle: "ACTIVE",
    marketFocus: "GLOBAL",
    algoPattern: "ARBITRAGER",
    capital: 3000 * TRILLION,
    sectorBias: null,
    description: "유럽 최대 IB. 차익거래+알고리즘 매매. 가격 차이 이용.",
  },
  {
    name: "UBS Group",
    investorCategory: "FOREIGNER",
    botStyle: "ACTIVE",
    marketFocus: "GLOBAL",
    algoPattern: "ARBITRAGER",
    capital: 3000 * TRILLION,
    sectorBias: null,
    description: "스위스 대형 IB. 프라이빗 뱅킹+마켓 메이킹.",
  },
  {
    name: "Credit Suisse",
    investorCategory: "FOREIGNER",
    botStyle: "ACTIVE",
    marketFocus: "GLOBAL",
    algoPattern: "ARBITRAGER",
    capital: 3000 * TRILLION,
    sectorBias: null,
    description: "스위스 IB. 차익거래+위험 중립 전략.",
  },
  {
    name: "Barclays (IB)",
    investorCategory: "FOREIGNER",
    botStyle: "ACTIVE",
    marketFocus: "GLOBAL",
    algoPattern: "ARBITRAGER",
    capital: 3000 * TRILLION,
    sectorBias: null,
    description: "영국 IB. 마켓 메이킹+유동성 공급.",
  },
  {
    name: "Citi (Institutional)",
    investorCategory: "FOREIGNER",
    botStyle: "ACTIVE",
    marketFocus: "GLOBAL",
    algoPattern: "ARBITRAGER",
    capital: 3000 * TRILLION,
    sectorBias: null,
    description: "시티그룹 기관 부문. 글로벌 마켓 메이킹.",
  },
  {
    name: "HSBC Global Banking",
    investorCategory: "FOREIGNER",
    botStyle: "ACTIVE",
    marketFocus: "GLOBAL",
    algoPattern: "ARBITRAGER",
    capital: 3000 * TRILLION,
    sectorBias: null,
    description: "아시아-유럽 축차 IB. 차익거래+유동성 공급.",
  },
  {
    name: "BNP Paribas (IB)",
    investorCategory: "FOREIGNER",
    botStyle: "ACTIVE",
    marketFocus: "GLOBAL",
    algoPattern: "ARBITRAGER",
    capital: 3000 * TRILLION,
    sectorBias: null,
    description: "유럽 대형 IB. 마켓 메이킹+기관 주문.",
  },
];

// =====================================================
// 매크로 5계좌 (기존 유지, 뉴스 즉시 반응)
// =====================================================
const MACRO_DEFS: AccountDef[] = [
  {
    name: "BlackRock Strategic",
    investorCategory: "INST_PEF",
    botStyle: "ACTIVE",
    marketFocus: "GLOBAL",
    algoPattern: "MOMENTUM",
    capital: LP_CONFIG.macroCapitalPerAccount,
    sectorBias: null,
    description: "매크로 전략. 뉴스 즉시 반응. 모멘텀 가속화.",
  },
  {
    name: "Bridgewater Alpha",
    investorCategory: "INST_PEF",
    botStyle: "ACTIVE",
    marketFocus: "GLOBAL",
    algoPattern: "MOMENTUM",
    capital: LP_CONFIG.macroCapitalPerAccount,
    sectorBias: null,
    description: "매크로 헤지. 뉴스 즉시 반응. 위기 시 공격적 매매.",
  },
  {
    name: "Soros Fund Management",
    investorCategory: "INST_PEF",
    botStyle: "ACTIVE",
    marketFocus: "GLOBAL",
    algoPattern: "MOMENTUM",
    capital: LP_CONFIG.macroCapitalPerAccount,
    sectorBias: null,
    description: "전설적 매크로 펀드. 뉴스 즉시 반응. 모멘텀 가속화.",
  },
  {
    name: "Tudor Investment Corp",
    investorCategory: "INST_PEF",
    botStyle: "ACTIVE",
    marketFocus: "GLOBAL",
    algoPattern: "MOMENTUM",
    capital: LP_CONFIG.macroCapitalPerAccount,
    sectorBias: null,
    description: "매크로 펀드. 뉴스 즉시 반응. 단기 모멘텀.",
  },
  {
    name: "Brevan Howard",
    investorCategory: "INST_PEF",
    botStyle: "ACTIVE",
    marketFocus: "GLOBAL",
    algoPattern: "MOMENTUM",
    capital: LP_CONFIG.macroCapitalPerAccount,
    sectorBias: null,
    description: "매크로 채권 편향. 뉴스 즉시 반응. 금리/채권 민감.",
  },
];

// =====================================================
// 알고리즘 성격 매핑
// =====================================================
function algoToParams(algo: AlgoPattern, rng: () => number): {
  aggressiveness: number;
  patience: number;
  defenseThreshold: number;
  newsSensitivity: number;
  tradeFrequency: number;
} {
  switch (algo) {
    case "DEFENDER": // 하락장 방어
      return {
        aggressiveness: 0.2 + rng() * 0.15,
        patience: 0.85 + rng() * 0.1,
        defenseThreshold: 2 + rng() * 2,
        newsSensitivity: 0.2 + rng() * 0.15,
        tradeFrequency: 0.2,
      };
    case "TREND_CHASER": // 트렌드 추종
      return {
        aggressiveness: 0.7 + rng() * 0.2,
        patience: 0.3 + rng() * 0.2,
        defenseThreshold: 99,
        newsSensitivity: 0.85 + rng() * 0.1,
        tradeFrequency: 0.8,
      };
    case "SCALPER": // 스캘핑
      return {
        aggressiveness: 0.6 + rng() * 0.2,
        patience: 0.05 + rng() * 0.1,
        defenseThreshold: 99,
        newsSensitivity: 0.5 + rng() * 0.2,
        tradeFrequency: 0.95,
      };
    case "VALUE_HOLDER": // 가치 보유
      return {
        aggressiveness: 0.1 + rng() * 0.1,
        patience: 0.9 + rng() * 0.05,
        defenseThreshold: 5 + rng() * 3,
        newsSensitivity: 0.1 + rng() * 0.1,
        tradeFrequency: 0.1,
      };
    case "MOMENTUM": // 모멘텀
      return {
        aggressiveness: 0.85 + rng() * 0.1,
        patience: 0.1 + rng() * 0.15,
        defenseThreshold: 99,
        newsSensitivity: 0.9 + rng() * 0.05,
        tradeFrequency: 0.85,
      };
    case "INDEX_TRACKER": // 인덱스 추종
      return {
        aggressiveness: 0.3 + rng() * 0.15,
        patience: 0.7 + rng() * 0.15,
        defenseThreshold: 99,
        newsSensitivity: 0.15 + rng() * 0.1,
        tradeFrequency: 0.3,
      };
    case "MARKET_MAKER": // 마켓 메이킹
      return {
        aggressiveness: 0.4 + rng() * 0.15,
        patience: 0.5 + rng() * 0.15,
        defenseThreshold: 99,
        newsSensitivity: 0.4 + rng() * 0.15,
        tradeFrequency: 0.9,
      };
    case "ARBITRAGER": // 차익거래
      return {
        aggressiveness: 0.5 + rng() * 0.2,
        patience: 0.1 + rng() * 0.1,
        defenseThreshold: 99,
        newsSensitivity: 0.3 + rng() * 0.15,
        tradeFrequency: 0.9,
      };
  }
}

// =====================================================
// InvestorCategory별 포트폴리오 알로케이션 (현실 기반)
// =====================================================
function getAllocation(investorCategory: InvestorCategory, rng: () => number): PortfolioAllocation {
  const jitter = (base: number, range: number) =>
    +(base + (rng() - 0.5) * range).toFixed(1);

  switch (investorCategory) {
    case "INST_PENSION":
      return {
        stockMax: jitter(65, 8),
        bondMax: jitter(28, 6),
        derivativeMax: jitter(3, 2),
        cashMin: jitter(5, 2),
        bondGrade: "INVESTMENT_GRADE",
        derivativePurpose: "HEDGING",
        stockStyle: "대형 우량주·블루칩 중심. 장기 보유. 시장 하락 시 저가 매수로 비중 확대.",
        bondStyle: "정부채·AAA급 우량 회사채만 매입. 신용등급 투자급 이하 불매.",
        derivativeStyle: "헷징 목적만. 주식 포지션 보호용 풋옵션·선물 매도. 투기적 포지션 금지.",
        rationale: "국민/공무원 연금 자금은 원본 손실이 곧 사회적 문제. 원본 보전이 최우선이므로 가장 보수적으로 운용. 파생상품은 순수 헷징 용도로만 제한.",
      };

    case "INST_FINANCE":
      return {
        stockMax: jitter(40, 10),
        bondMax: jitter(15, 8),
        derivativeMax: jitter(35, 10),
        cashMin: jitter(10, 5),
        bondGrade: "MIXED",
        derivativePurpose: "ARBITRAGE",
        stockStyle: "단기 스윙·알고리즘 매매. 포지션 보유 시간 짧음. 차익·통계적 차익 기회 포착.",
        bondStyle: "단기 채권·CD·RP 활용. 유동성 확보 목적. 등급은 혼합 (차익 기회가 있으면 투자급 이하도 일부).",
        derivativeStyle: "차익거래·통계적 차익 주력. 선물-현물 베이시스, 옵션 변동성 차익. 방향성 베팅보다 가격 왜곡 이용.",
        rationale: "증권사 자기자금(프랍)은 분기 수익이 평가되므로 단기 성과 압박. 방향성 베팅보다 차익/알고리즘으로 안정적 수익 추구. 파생상품 비율이 높지만 투기가 아닌 차익 목적.",
      };

    case "INST_TRUST":
      return {
        stockMax: jitter(78, 7),
        bondMax: jitter(15, 5),
        derivativeMax: jitter(7, 4),
        cashMin: jitter(5, 3),
        bondGrade: "INVESTMENT_GRADE",
        derivativePurpose: "HEDGING",
        stockStyle: "주도주·성장주 적극 추종. 펀드 벤치마크 초과 수익(Alpha) 추구. 섹터 로테이션 적극 활용.",
        bondStyle: "투자등급(A- 이상) 회사채·국채. 펀드 안전자산 비중용. 정크본드 불매.",
        derivativeStyle: "주로 헷징. 일부 ETF 선물로 섹터 비중 조정. 투기적 숏 포지션은 제한적.",
        rationale: "펀드 수익률이 벤치마크(코스피/S&P500)를 이겨야 고객 자금이 유입됨. 따라서 주도주 추종이 핵심. 하지만 원본 손실 시 환매 급증 위험으로 파생상품은 헷징 위주로 제한.",
      };

    case "INST_PEF":
      return {
        stockMax: jitter(50, 12),
        bondMax: jitter(12, 8),
        derivativeMax: jitter(38, 12),
        cashMin: jitter(8, 5),
        bondGrade: "HIGH_YIELD",
        derivativePurpose: "SPECULATION",
        stockStyle: "롱숏 전략. 강세주 매수·약세주 공매도. 모멘텀 타기. 레버리지 활용. 변동성이 수익의 원천.",
        bondStyle: "고수익채(정크본드·딜런스드 디스트레스드 채권) 매입. 부도 위험이 높지만 수익률도 높은 채권 선호. 일부 헷징용 CDS 보유.",
        derivativeStyle: "공격적 투기. 레버리지 옵션·크레딧 디폴트 스왑(CDS). 방향성 베팅 적극. 숏 선물로 하락 베팅. 변동성 매매(VIX)도 활용.",
        rationale: "헤지펀드는 절대 수익(Absolute Return)이 유일한 목표. 벤치마크 없음. 고객이 위험을 감수할 각오가 되어 있으므로 파생상품·정크본드 비율이 가장 높음. 단, 리스크 관리를 위해 일부 헷징은 병행.",
      };

    case "INST_BANK_INS":
      return {
        stockMax: jitter(20, 6),
        bondMax: jitter(68, 8),
        derivativeMax: jitter(5, 3),
        cashMin: jitter(12, 4),
        bondGrade: "INVESTMENT_GRADE",
        derivativePurpose: "HEDGING",
        stockStyle: "배당주·대형 우량주만. 시세 차익 추구 불가. 규제상 주식 비중 제한. K-ICS·솔벤시 규제 준수.",
        bondStyle: "가장 보수적. 국채·AAA급 우량 회사채만. 만기 매칭(ALM) 원칙. 정크본드 절대 불매.",
        derivativeStyle: "순수 헷징. 이자율 변동 헷징(IR 스왑), 주식 하락 헷징(풋옵션). 투기적 포지션 규제상 금지.",
        rationale: "보험료·예금은 고객에게 반드시 돌려주어야 할 돈. 규제(K-ICS, 솔벤시, 바젤)가 주식/파생상품 비중을 엄격히 제한. 원본 보전 + 규제 준수가 최우선이므로 채권 비중이 압도적으로 높음.",
      };

    case "FOREIGNER":
      return {
        stockMax: jitter(40, 8),
        bondMax: jitter(25, 6),
        derivativeMax: jitter(25, 8),
        cashMin: jitter(10, 4),
        bondGrade: "MIXED",
        derivativePurpose: "MARKET_MAKING",
        stockStyle: "프랍 트레이딩 + 마켓 메이킹 인벤토리. 기관 고객 주문 실행. 자기 자본으로 방향성 베팅도 일부 수행.",
        bondStyle: "마켓 메이킹 인벤토리. 국채·회사채 모두 취급. 유통시장 유동성 공급 역할. 등급은 혼합 (고객 수요에 맞춤).",
        derivativeStyle: "마켓 메이킹 + 차익거래. 고객 주문 헤징 + 자체 차익. 옵션 마켓 메이킹으로 바이델타 헤징. 변동성 매매도 일부.",
        rationale: "투자은행은 자기 자본으로 시장 유동성을 공급하는 역할. 프랍 트레이딩으로 수익 추구 + 마켓 메이킹으로 수수료 수익. 파생상품은 고객 헤징 주문 처리 + 자체 차익용이므로 비율이 높지만 투기 목적은 아님.",
      };
  }
}

function makeAccount(id: string, def: AccountDef, type: "LP" | "MACRO", rng: () => number): LPAccount {
  const params = algoToParams(def.algoPattern, rng);
  const allocation = getAllocation(def.investorCategory, rng);

  // 기관 성향별 순환매 리밸런싱 스타일 분배
  let rebalanceStyle: "gradual" | "aggressive" = "gradual";
  if (type === "MACRO") {
    rebalanceStyle = "aggressive";
  } else {
    switch (def.investorCategory) {
      case "INST_PEF":
      case "INST_FINANCE":
      case "INST_TRUST":
        rebalanceStyle = "aggressive";
        break;
      case "INST_PENSION":
      case "INST_BANK_INS":
        rebalanceStyle = "gradual";
        break;
      case "FOREIGNER":
        // IB 중 차익거래/스캘핑 등 단기 성향은 aggressive, 마켓메이커 등은 gradual
        rebalanceStyle = (def.algoPattern === "ARBITRAGER" || def.algoPattern === "SCALPER")
          ? "aggressive"
          : "gradual";
        break;
    }
  }

  return {
    id,
    type,
    name: def.name,
    investorCategory: def.investorCategory,
    botStyle: def.botStyle,
    marketFocus: def.marketFocus,
    algoPattern: def.algoPattern,
    capital: def.capital,
    cash: def.capital,
    lockedCash: 0,
    holdings: {},
    availableCash: def.capital,
    aggressiveness: +params.aggressiveness.toFixed(2),
    patience: +params.patience.toFixed(2),
    sectorBias: def.sectorBias,
    defenseThreshold: +params.defenseThreshold.toFixed(1),
    newsSensitivity: +params.newsSensitivity.toFixed(2),
    tradeFrequency: +params.tradeFrequency.toFixed(2),
    description: def.description,
    allocation,
    rebalanceStyle,
  };
}

export function generateAccounts(): LPAccount[] {
  const rng = mulberry32(20260629);
  const accounts: LPAccount[] = [];

  // 국내중심 LP 5계좌
  DOMESTIC_DEFS.forEach((def, i) => {
    accounts.push(makeAccount(`LP-KR-${String(i + 1).padStart(2, "0")}`, def, "LP", rng));
  });

  // 해외중심 LP 40계좌
  OVERSEAS_DEFS.forEach((def, i) => {
    accounts.push(makeAccount(`LP-OS-${String(i + 1).padStart(2, "0")}`, def, "LP", rng));
  });

  // 세계적 IB 10계좌
  IB_DEFS.forEach((def, i) => {
    accounts.push(makeAccount(`IB-${String(i + 1).padStart(2, "0")}`, def, "LP", rng));
  });

  // 매크로 5계좌
  MACRO_DEFS.forEach((def, i) => {
    accounts.push(makeAccount(`MACRO-${String(i + 1).padStart(2, "0")}`, def, "MACRO", rng));
  });

  // 개미(RETAIL) 100계좌 생성 (초기자본 1000만 현금 + 특정 대형주 물린 상태)
  // 편의상 첫 번째 시총 1위 대형주 ID를 "STK-001"로 가정하고 세팅 (엔진에서 사용될 때 매핑 필요)
  for (let i = 1; i <= 100; i++) {
    const cash = 10_000_000;
    // 물린 주식 가치: 500만 ~ 3000만
    const stockValue = 5_000_000 + rng() * 25_000_000;
    
    // 현재가가 80,000원이라고 가정할 때 평단가는 +25% 비싼 100,000원 (-20% 손실 상태)
    const avgPrice = 100_000;
    const quantity = Math.floor((stockValue * 1.25) / avgPrice);
    
    const def: AccountDef = {
      name: `개미투자자-${i}`,
      investorCategory: "RETAIL",
      botStyle: "ACTIVE",
      marketFocus: "DOMESTIC",
      algoPattern: "SCALPER", // 기본 단타 베이스지만 로직에서 덮어쓸 예정
      capital: cash + stockValue,
      sectorBias: null,
      description: "손실 중에는 무조건 존버, 수익 나면 칼같이 익절하는 개미.",
    };
    
    const account = makeAccount(`RETAIL-${String(i).padStart(3, "0")}`, def, "LP", rng);
    account.cash = cash; // 현금 1000만원
    account.availableCash = cash;
    account.holdings = {
      "STK-001": { // 임시 종목 ID (후술할 engine.ts 등에서 매칭)
        quantity: quantity,
        lockedQuantity: 0,
        avgPrice: avgPrice
      }
    };
    accounts.push(account);
  }

  // 실제 로그인해서 즐길 사람(User) 계정 1개 생성 (추가 확장 가능)
  const userDef: AccountDef = {
    name: "주린이(Me)",
    investorCategory: "RETAIL",
    botStyle: "PASSIVE",
    marketFocus: "DOMESTIC",
    algoPattern: "TREND_CHASER",
    capital: 50_000_000,
    sectorBias: null,
    description: "실제 로그인해서 활동하는 유저 계정입니다.",
  };
  // =====================================================
  // Market Makers (5 계좌)
  // =====================================================
  const mmDefs: AccountDef[] = [
    { name: "KRX 마켓메이커", investorCategory: "INST_FINANCE", botStyle: "LIQUIDITY_PROVIDER", marketFocus: "DOMESTIC", algoPattern: "MARKET_MAKER", capital: 1000 * TRILLION, sectorBias: null, description: "한국 시장 전담 마켓 메이커." },
    { name: "Virtu Financial", investorCategory: "FOREIGNER", botStyle: "LIQUIDITY_PROVIDER", marketFocus: "OVERSEAS", algoPattern: "MARKET_MAKER", capital: 5000 * TRILLION, sectorBias: null, description: "미국 주식 유동성 공급 1." },
    { name: "Citadel Securities", investorCategory: "FOREIGNER", botStyle: "LIQUIDITY_PROVIDER", marketFocus: "OVERSEAS", algoPattern: "MARKET_MAKER", capital: 6000 * TRILLION, sectorBias: null, description: "미국 주식 유동성 공급 2." },
    { name: "Jane Street", investorCategory: "FOREIGNER", botStyle: "LIQUIDITY_PROVIDER", marketFocus: "OVERSEAS", algoPattern: "MARKET_MAKER", capital: 4000 * TRILLION, sectorBias: null, description: "미국 주식 유동성 공급 3." },
    { name: "Optiver", investorCategory: "FOREIGNER", botStyle: "LIQUIDITY_PROVIDER", marketFocus: "EUROPE", algoPattern: "MARKET_MAKER", capital: 3000 * TRILLION, sectorBias: null, description: "유럽 주식 유동성 공급." }
  ];
  for (let i = 0; i < mmDefs.length; i++) {
    const acc = makeAccount(`MM-00${i+1}`, mmDefs[i], "LP", rng);
    // MM은 유동성 공급 전용이므로 아주 공격적이고 넓은 밴드 운영 (아래 엔진에서 재정의됨)
    accounts.push(acc);
  }

  const userAccount = makeAccount("USER-001", userDef, "LP", rng);
  userAccount.isRealUser = true;
  userAccount.cash = 50_000_000;
  userAccount.availableCash = 50_000_000;
  userAccount.holdings = {};
  accounts.push(userAccount);

  return accounts;
}

export function totalLPCapital(): number {
  const accounts = generateAccounts();
  return accounts
    .filter((a) => a.type === "LP")
    .reduce((sum, a) => sum + a.capital, 0);
}

export function totalMacroCapital(): number {
  const accounts = generateAccounts();
  return accounts
    .filter((a) => a.type === "MACRO")
    .reduce((sum, a) => sum + a.capital, 0);
}

export function formatCapital(v: number): string {
  if (v >= 10_000 * TRILLION) return `${(v / (10_000 * TRILLION)).toFixed(1)}경`;
  if (v >= TRILLION) return `${(v / TRILLION).toFixed(0)}조`;
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(0)}억`;
  return v.toLocaleString();
}

export function getAccountGroups(accounts: LPAccount[]) {
  return {
    domestic: accounts.filter((a) => a.marketFocus === "DOMESTIC" && a.type === "LP"),
    overseas: accounts.filter((a) => a.marketFocus === "OVERSEAS" && a.type === "LP"),
    ib: accounts.filter((a) => a.investorCategory === "FOREIGNER" && a.type === "LP"),
    macro: accounts.filter((a) => a.type === "MACRO"),
  };
}

export function getInvestorCategoryLabel(type: InvestorCategory): string {
  const labels: Record<InvestorCategory, string> = {
    PENSION: "연기금",
    SECURITIES: "금융투자",
    INVESTMENT_TRUST: "투신",
    PE_HEDGE: "사모펀드",
    INSURANCE_BANK: "보험/은행",
    IB: "세계적 IB",
  };
  return labels[type];
}

export function getBotStyleLabel(style: BotStyle): string {
  const labels: Record<BotStyle, string> = {
    PASSIVE: "패시브",
    ACTIVE: "액티브",
    LIQUIDITY_PROVIDER: "유동성 공급자",
  };
  return labels[style];
}

export function getAlgoLabel(algo: AlgoPattern): string {
  const labels: Record<AlgoPattern, string> = {
    DEFENDER: "하락장 방어형",
    TREND_CHASER: "트렌드 추종형",
    SCALPER: "스캘핑형",
    VALUE_HOLDER: "가치 보유형",
    MOMENTUM: "모멘텀 가속형",
    INDEX_TRACKER: "인덱스 추종형",
    MARKET_MAKER: "마켓 메이킹형",
    ARBITRAGER: "차익거래형",
  };
  return labels[algo];
}

export function getBondGradeLabel(grade: BondGrade): string {
  const labels: Record<BondGrade, string> = {
    INVESTMENT_GRADE: "우량채권 (투자등급)",
    HIGH_YIELD: "고수익채 (정크본드)",
    MIXED: "혼합 (우량+일부 고수익)",
  };
  return labels[grade];
}

export function getDerivativePurposeLabel(purpose: DerivativePurpose): string {
  const labels: Record<DerivativePurpose, string> = {
    HEDGING: "헷징 (위험 회피)",
    SPECULATION: "투기 (방향성 베팅)",
    ARBITRAGE: "차익거래 (가격 왜곡 이용)",
    MARKET_MAKING: "마켓 메이킹 (유동성 공급)",
  };
  return labels[purpose];
}
