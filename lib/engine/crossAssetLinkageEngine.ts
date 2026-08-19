export interface CrossAssetWeights {
  wSpot: number;   // 현물 (주식/원자재) 가중치 (0.0 ~ 1.0)
  wDeriv: number;  // 파생상품 (선물/옵션) 가중치 (0.0 ~ 1.0)
  wBond: number;   // 채권 (국채/금리) 가중치 (0.0 ~ 1.0)
  mandateName: string;
  strategyDescription: string;
  realWorldMotif: string;
}

export interface InstitutionProfile {
  id: string;
  name: string;
  nameEn: string;
  category: 'PENSION' | 'HEDGE_FUND' | 'PROP_DESK' | 'BANK' | 'ASSET_MGMT' | 'SOVEREIGN' | 'CENTRAL_BANK' | 'COMMERCIAL';
  weights: CrossAssetWeights;
  aumBillionUsd: number;
}

/**
 * 현실의 월스트리트 및 여의도 금융기관 50개의 실물 운용 정관(Mandate) 모티브 세부 가중치 레지스트리
 */
export const INDIVIDUAL_INSTITUTION_REGISTRY: Record<string, InstitutionProfile> = {
  // 1~10: 연기금 & 국부펀드 (Pension & Sovereign Wealth Funds)
  "NPS_KOREA": {
    id: "NPS_KOREA",
    name: "국민연금 (NPS)",
    nameEn: "National Pension Service of Korea",
    category: "PENSION",
    aumBillionUsd: 800,
    weights: {
      wSpot: 0.45,
      wDeriv: 0.15,
      wBond: 0.40,
      mandateName: "자산배분 듀레이션 매칭",
      strategyDescription: "주식/국채 목표 비중유지, 10년물 금리 급등 시 주식 매도 채권 매수 리밸런싱",
      realWorldMotif: "대한민국 국민연금 기금운용본부"
    }
  },
  "GIC_SINGAPORE": {
    id: "GIC_SINGAPORE",
    name: "싱가포르 국부펀드 (GIC)",
    nameEn: "GIC Private Limited",
    category: "SOVEREIGN",
    aumBillionUsd: 770,
    weights: {
      wSpot: 0.50,
      wDeriv: 0.20,
      wBond: 0.30,
      mandateName: "글로벌 다각화 포트폴리오",
      strategyDescription: "글로벌 대형주 및 미국 국채 배분, 환헤지 선물 연계",
      realWorldMotif: "Singapore Government Investment Corporation"
    }
  },
  "SAUDI_PIF": {
    id: "SAUDI_PIF",
    name: "사우디 국부펀드 (PIF / Aramco)",
    nameEn: "Public Investment Fund of Saudi Arabia",
    category: "SOVEREIGN",
    aumBillionUsd: 930,
    weights: {
      wSpot: 0.65,
      wDeriv: 0.25,
      wBond: 0.10,
      mandateName: "원자재 헤징 & 빅테크 지분 투자",
      strategyDescription: "원유 선물 숏 헤징 및 테크 현물 주식 매수",
      realWorldMotif: "Saudi Arabia Public Investment Fund"
    }
  },
  "NORWAY_NBIM": {
    id: "NORWAY_NBIM",
    name: "노르웨이 국부펀드 (NBIM)",
    nameEn: "Norges Bank Investment Management",
    category: "SOVEREIGN",
    aumBillionUsd: 1600,
    weights: {
      wSpot: 0.70,
      wDeriv: 0.10,
      wBond: 0.20,
      mandateName: "글로벌 주식 패시브 초과수익",
      strategyDescription: "전세계 9,000개 기업 주식 보유 및 환경 ESG 스크리닝",
      realWorldMotif: "Government Pension Fund Global of Norway"
    }
  },
  "CALPERS_US": {
    id: "CALPERS_US",
    name: "캘리포니아 공무원 연금 (CalPERS)",
    nameEn: "California Public Employees' Retirement System",
    category: "PENSION",
    aumBillionUsd: 490,
    weights: {
      wSpot: 0.40,
      wDeriv: 0.25,
      wBond: 0.35,
      mandateName: "리스크 파리티 & 레버리지 헤징",
      strategyDescription: "채권 레버리지 및 파생상품 옵션 풋보호 전략",
      realWorldMotif: "US CalPERS Retirement System"
    }
  },

  // 11~20: 글로벌 퀀트 & 헤지펀드 (Quant & Hedge Funds)
  "CITADEL_SEC": {
    id: "CITADEL_SEC",
    name: "시타델 (Citadel Securities)",
    nameEn: "Citadel Securities LLC",
    category: "HEDGE_FUND",
    aumBillionUsd: 65,
    weights: {
      wSpot: 0.15,
      wDeriv: 0.75,
      wBond: 0.10,
      mandateName: "옵션 MM & 감마 스퀴즈 헌팅",
      strategyDescription: "고빈도 파생 마켓메이킹, 델타 뉴트럴 헤징, 감마 싹쓸이",
      realWorldMotif: "Ken Griffin's Citadel Market Maker"
    }
  },
  "RENAISSANCE_MED": {
    id: "RENAISSANCE_MED",
    name: "르네상스 (Renaissance Medallion)",
    nameEn: "Renaissance Technologies LLC",
    category: "HEDGE_FUND",
    aumBillionUsd: 130,
    weights: {
      wSpot: 0.35,
      wDeriv: 0.55,
      wBond: 0.10,
      mandateName: "계량 통계적 차익거래 (StatArb)",
      strategyDescription: "주식-선물 미세 괴리 탐지, 풋-콜 파리티 차익거래",
      realWorldMotif: "Jim Simons' Medallion Quant Fund"
    }
  },
  "BRIDGEWATER_AW": {
    id: "BRIDGEWATER_AW",
    name: "브릿지워터 (Bridgewater All Weather)",
    nameEn: "Bridgewater Associates",
    category: "HEDGE_FUND",
    aumBillionUsd: 124,
    weights: {
      wSpot: 0.25,
      wDeriv: 0.35,
      wBond: 0.40,
      mandateName: "올웨더 리스크 패리티 (Risk Parity)",
      strategyDescription: "ERP 신호 기반 국채 10년물과 주식/원자재 동시 매매",
      realWorldMotif: "Ray Dalio's Bridgewater Associates"
    }
  },
  "TWO_SIGMA": {
    id: "TWO_SIGMA",
    name: "투포인트에이트 (Two Sigma Quant)",
    nameEn: "Two Sigma Investments",
    category: "HEDGE_FUND",
    aumBillionUsd: 60,
    weights: {
      wSpot: 0.35,
      wDeriv: 0.45,
      wBond: 0.20,
      mandateName: "머신러닝 다변량 신호 매매",
      strategyDescription: "금리-파생-현물 실시간 상관계수 시그널 포지션 집행",
      realWorldMotif: "Two Sigma Systematic Quant"
    }
  },
  "MILLENNIUM_MGMT": {
    id: "MILLENNIUM_MGMT",
    name: "밀레니엄 (Millennium Management)",
    nameEn: "Millennium Management LLC",
    category: "HEDGE_FUND",
    aumBillionUsd: 68,
    weights: {
      wSpot: 0.30,
      wDeriv: 0.50,
      wBond: 0.20,
      mandateName: "멀티매니저 파생 스프레드",
      strategyDescription: "개별 Pod별 파생 옵션 롱숏 및 현물 스프레드 차익",
      realWorldMotif: "Israel Englander's Millennium Pod Platform"
    }
  },

  // 21~30: 글로벌 자산운용사 (Global Asset Management)
  "BLACKROCK_GLB": {
    id: "BLACKROCK_GLB",
    name: "블랙록 (BlackRock Global)",
    nameEn: "BlackRock Inc.",
    category: "ASSET_MGMT",
    aumBillionUsd: 10500,
    weights: {
      wSpot: 0.50,
      wDeriv: 0.25,
      wBond: 0.25,
      mandateName: "iShares ETF 유동성 및 패시브",
      strategyDescription: "지수 추종 ETF 창설/청산(AP) 및 선물 바스켓 매매",
      realWorldMotif: "Larry Fink's BlackRock iShares"
    }
  },
  "VANGUARD_GRP": {
    id: "VANGUARD_GRP",
    name: "뱅가드 (Vanguard Group)",
    nameEn: "The Vanguard Group",
    category: "ASSET_MGMT",
    aumBillionUsd: 8600,
    weights: {
      wSpot: 0.55,
      wDeriv: 0.15,
      wBond: 0.30,
      mandateName: "초저비용 패시브 자산운용",
      strategyDescription: "현물 대형주 인덱싱 및 국채 포트폴리오 홀딩",
      realWorldMotif: "Jack Bogle's Vanguard Index Group"
    }
  },
  "SAMSUNG_AM": {
    id: "SAMSUNG_AM",
    name: "삼성자산운용 (Samsung KODEX)",
    nameEn: "Samsung Asset Management",
    category: "ASSET_MGMT",
    aumBillionUsd: 230,
    weights: {
      wSpot: 0.50,
      wDeriv: 0.35,
      wBond: 0.15,
      mandateName: "KODEX 레버리지/인버스 PDF 차익",
      strategyDescription: "KOSPI 200 선물 차익거래 및 레버리지 일단위 리밸런싱",
      realWorldMotif: "Samsung KODEX ETF Management"
    }
  },
  "MIRAE_ASSET": {
    id: "MIRAE_ASSET",
    name: "미래에셋자산운용 (Mirae TIGER)",
    nameEn: "Mirae Asset Global Investments",
    category: "ASSET_MGMT",
    aumBillionUsd: 210,
    weights: {
      wSpot: 0.55,
      wDeriv: 0.30,
      wBond: 0.15,
      mandateName: "TIGER 글로벌 테마 & 파생 ETF",
      strategyDescription: "글로벌 혁신 테마 현물 매수 및 옵션 커버드콜 구축",
      realWorldMotif: "Mirae Asset TIGER ETF Desk"
    }
  },
  "KIM_KOREA": {
    id: "KIM_KOREA",
    name: "한국투자신탁운용 (KIM ACE)",
    nameEn: "Korea Investment Management",
    category: "ASSET_MGMT",
    aumBillionUsd: 65,
    weights: {
      wSpot: 0.60,
      wDeriv: 0.25,
      wBond: 0.15,
      mandateName: "국내 공모펀드 & 차익거래",
      strategyDescription: "국내 가치주 현물 매수 및 프로그램 차익 매매",
      realWorldMotif: "Korea Investment Management ACE"
    }
  },

  // 31~40: 투자은행 & 상업은행 (Investment Banks & Commercial Banks)
  "JPMORGAN_CHASE": {
    id: "JPMORGAN_CHASE",
    name: "JP모건 (JPMorgan Fixed Income)",
    nameEn: "JPMorgan Chase & Co.",
    category: "BANK",
    aumBillionUsd: 3900,
    weights: {
      wSpot: 0.10,
      wDeriv: 0.30,
      wBond: 0.60,
      mandateName: "국채 프라이머리 딜러 & 금리스왑",
      strategyDescription: "10년물 국채 유동성 공급, 이자율 스왑(IRS) 파생 헤징",
      realWorldMotif: "JPMorgan Rates & Treasury Trading Desk"
    }
  },
  "GOLDMAN_SACHS": {
    id: "GOLDMAN_SACHS",
    name: "골드만삭스 (Goldman Sachs Vol Desk)",
    nameEn: "Goldman Sachs Group Inc.",
    category: "PROP_DESK",
    aumBillionUsd: 2800,
    weights: {
      wSpot: 0.20,
      wDeriv: 0.60,
      wBond: 0.20,
      mandateName: "구조화 파생 & 변동성 차익",
      strategyDescription: "장외 파생 스왑션 공급 및 현물 주식 델타 헤징",
      realWorldMotif: "Goldman Sachs Equity Derivatives Trading"
    }
  },
  "MORGAN_STANLEY": {
    id: "MORGAN_STANLEY",
    name: "모건스탠리 (Morgan Stanley Prime)",
    nameEn: "Morgan Stanley",
    category: "BANK",
    aumBillionUsd: 1500,
    weights: {
      wSpot: 0.35,
      wDeriv: 0.45,
      wBond: 0.20,
      mandateName: "프라임 브로커리지 & 롱숏",
      strategyDescription: "기관 대주 거래, 선물 롱숏 및 현물 바스켓 매매",
      realWorldMotif: "Morgan Stanley Institutional Equity Division"
    }
  },
  "SHINHAN_BANK": {
    id: "SHINHAN_BANK",
    name: "신한은행 자금부 (Shinhan Treasury)",
    nameEn: "Shinhan Bank Treasury Division",
    category: "BANK",
    aumBillionUsd: 450,
    weights: {
      wSpot: 0.05,
      wDeriv: 0.25,
      wBond: 0.70,
      mandateName: "원화 국고채 ALM 듀레이션 관리",
      strategyDescription: "3Y/10Y 국채 매수, 통화스왑(CRS) 파생 헤징",
      realWorldMotif: "Shinhan Bank ALM Treasury Division"
    }
  },
  "KB_BANK": {
    id: "KB_BANK",
    name: "KB국민은행 (KB Treasury)",
    nameEn: "KB Kookmin Bank Treasury",
    category: "BANK",
    aumBillionUsd: 480,
    weights: {
      wSpot: 0.05,
      wDeriv: 0.25,
      wBond: 0.70,
      mandateName: "원화 수신 채권 매칭 운용",
      strategyDescription: "은행채 발행 및 국고채 수익률 곡선 듀레이션 조절",
      realWorldMotif: "KB Kookmin Bank Treasury & FX Division"
    }
  },

  // 41~50: 중앙은행 & 기업 헤저 (Central Banks & Corporate Hedgers)
  "BOK_KOREA": {
    id: "BOK_KOREA",
    name: "한국은행 (Bank of Korea)",
    nameEn: "Bank of Korea",
    category: "CENTRAL_BANK",
    aumBillionUsd: 420,
    weights: {
      wSpot: 0.05,
      wDeriv: 0.15,
      wBond: 0.80,
      mandateName: "기준금리 조절 & 국고채 RP 수술",
      strategyDescription: "통화안정증권 발행, 10년물 국채 시장 안정화 조치",
      realWorldMotif: "Bank of Korea Open Market Operations Desk"
    }
  },
  "US_FED": {
    id: "US_FED",
    name: "미 연방준비제도 (US Federal Reserve)",
    nameEn: "Federal Reserve Open Market Desk",
    category: "CENTRAL_BANK",
    aumBillionUsd: 7200,
    weights: {
      wSpot: 0.00,
      wDeriv: 0.10,
      wBond: 0.90,
      mandateName: "Fed Funds 금리 조절 & QT 국채 매각",
      strategyDescription: "미 국채 10년물 유동성 공개시장운영 및 양적완화/긴축",
      realWorldMotif: "Federal Reserve Bank of New York Trading Desk"
    }
  },
  "COMMERCIAL_HEDGE_OIL": {
    id: "COMMERCIAL_HEDGE_OIL",
    name: "SK이노베이션 원유 트레이딩팀",
    nameEn: "SK Innovation Crude Trading",
    category: "COMMERCIAL",
    aumBillionUsd: 35,
    weights: {
      wSpot: 0.55,
      wDeriv: 0.35,
      wBond: 0.10,
      mandateName: "원유 실물 현물 & WTI 선물 헤징",
      strategyDescription: "원유 현물 매수 및 WTI 선물 매도 크랙 스프레드 고정",
      realWorldMotif: "Energy Commercial Hedging Trading Desk"
    }
  },
  "COMMERCIAL_HEDGE_SEMI": {
    id: "COMMERCIAL_HEDGE_SEMI",
    name: "삼성전자 자금기획팀",
    nameEn: "Samsung Electronics Corporate Treasury",
    category: "COMMERCIAL",
    aumBillionUsd: 120,
    weights: {
      wSpot: 0.60,
      wDeriv: 0.30,
      wBond: 0.10,
      mandateName: "기업 유동성 & 외환/금리 헤지",
      strategyDescription: "달러 선물 헤징 및 자사주 현물 매수 지원",
      realWorldMotif: "Samsung Electronics Treasury & Financial Strategy"
    }
  }
};

export interface MarketStateSnapshot {
  equitySpotPrices: Record<string, number>; // ticker -> price
  bondYield10Y: number; // 10년물 국채 금리 (%) e.g. 3.50
  bondYield3Y: number; // 3년물 국채 금리 (%) e.g. 3.20
  futuresPrice: number; // KOSPI200 선물 가격 e.g. 350.50
  spotIndexPrice: number; // KOSPI200 현물 지수 e.g. 350.20
  callOptionPrice: number;
  putOptionPrice: number;
  strikePrice: number;
}

export interface CrossAssetSignalResult {
  institutionId: string;
  institutionName: string;
  wSpot: number;
  wDeriv: number;
  wBond: number;
  equityRiskPremium: number; // ERP (%)
  basis: number; // Futures - Spot
  parityDiscrepancy: number; // C - P - (S - K)
  unifiedSignalScore: number; // -1.0 (Strong Sell/Risk-Off) ~ +1.0 (Strong Buy/Risk-On)
  recommendedLegOrders: {
    spotAction: 'BUY' | 'SELL' | 'HOLD';
    derivAction: 'BUY_CALL' | 'BUY_PUT' | 'SELL_FUTURES' | 'BUY_FUTURES' | 'NONE';
    bondAction: 'BUY_BOND' | 'SELL_BOND' | 'NONE';
    tradeReason: string;
  };
}

export class CrossAssetLinkageEngine {
  /**
   * 개별 기관의 3원(파생-채권-현물) 연계 트레이딩 신호 산출
   */
  public static calculateSignal(
    institutionId: string,
    market: MarketStateSnapshot
  ): CrossAssetSignalResult {
    const profile = INDIVIDUAL_INSTITUTION_REGISTRY[institutionId] || INDIVIDUAL_INSTITUTION_REGISTRY["NPS_KOREA"];
    const { wSpot, wDeriv, wBond } = profile.weights;

    // 1. 채권 시장 신호: Equity Risk Premium (ERP = 주식 이익수익률 6.5% - 10년물 국채금리)
    const averageEarningsYield = 6.5; // 평균 주식 이익수익률 6.5%
    const equityRiskPremium = averageEarningsYield - market.bondYield10Y;
    
    // ERP가 높으면(금리 낮음) Risk-On (+), ERP가 낮거나 음수면(금리 높음) Risk-Off (-)
    const bondSignal = Math.max(-1.0, Math.min(1.0, (equityRiskPremium - 2.5) / 2.0));

    // 2. 파생상품 시장 신호: Basis (선물 - 현물) & Put-Call Parity 괴리
    const basis = market.futuresPrice - market.spotIndexPrice;
    const parityDiscrepancy = (market.callOptionPrice - market.putOptionPrice) - (market.spotIndexPrice - market.strikePrice);
    
    // 베이시스 컨탱고(Basis > 0)면 차익매수 시그널 (+), 백워데이션(Basis < 0)이면 매도 시그널 (-)
    const derivSignal = Math.max(-1.0, Math.min(1.0, (basis * 0.5) + (parityDiscrepancy * 0.1)));

    // 3. 현물 시장 모멘텀 신호
    const spotSignal = bondSignal * 0.5 + derivSignal * 0.5;

    // 4. 통합 3원 연계 스코어 ($S_{unified} = w_{Spot} S_{Spot} + w_{Deriv} S_{Deriv} + w_{Bond} S_{Bond}$)
    const unifiedSignalScore = Number(
      (wSpot * spotSignal + wDeriv * derivSignal + wBond * bondSignal).toFixed(3)
    );

    // 5. 3-Leg 동시 연계 매매 추천 액션 산출
    let spotAction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let derivAction: 'BUY_CALL' | 'BUY_PUT' | 'SELL_FUTURES' | 'BUY_FUTURES' | 'NONE' = 'NONE';
    let bondAction: 'BUY_BOND' | 'SELL_BOND' | 'NONE' = 'NONE';
    let tradeReason = "";

    if (unifiedSignalScore > 0.25) {
      spotAction = 'BUY';
      derivAction = basis < 0 ? 'BUY_FUTURES' : 'BUY_CALL';
      bondAction = market.bondYield10Y > 3.8 ? 'BUY_BOND' : 'NONE';
      tradeReason = `[Risk-On 연계] ERP(${equityRiskPremium.toFixed(2)}%) 우수 및 베이시스(${basis.toFixed(2)}) 상승으로 현물+파생 동시 매수 집행`;
    } else if (unifiedSignalScore < -0.25) {
      spotAction = 'SELL';
      derivAction = basis > 0 ? 'SELL_FUTURES' : 'BUY_PUT';
      bondAction = 'BUY_BOND'; // 국채로 자금 이탈
      tradeReason = `[Risk-Off 헤징] 10년물 국채금리(${market.bondYield10Y}%) 상승 및 파생 백워데이션으로 현물 매도 후 채권/풋옵션 전환`;
    } else {
      // 무위험 차익거래 (Cash-and-Carry) 탐지
      if (basis > 0.8) {
        spotAction = 'BUY';
        derivAction = 'SELL_FUTURES';
        tradeReason = `[Contango 차익거래] 선물 매도 + 현물 매수 Cash-and-Carry 연계 매매`;
      } else if (basis < -0.8) {
        spotAction = 'SELL';
        derivAction = 'BUY_FUTURES';
        tradeReason = `[Backwardation 차익거래] 현물 매도 + 선물 매수 Reverse Arbitrage 연계 매매`;
      } else {
        tradeReason = `[중립 중첩 상태] 3원 시장 균형 상태 유지`;
      }
    }

    return {
      institutionId: profile.id,
      institutionName: profile.name,
      wSpot,
      wDeriv,
      wBond,
      equityRiskPremium: Number(equityRiskPremium.toFixed(2)),
      basis: Number(basis.toFixed(2)),
      parityDiscrepancy: Number(parityDiscrepancy.toFixed(2)),
      unifiedSignalScore,
      recommendedLegOrders: {
        spotAction,
        derivAction,
        bondAction,
        tradeReason
      }
    };
  }
}
