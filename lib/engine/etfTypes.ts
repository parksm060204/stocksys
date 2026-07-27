export interface PDFConstituent {
  ticker: string;         // 구성 종목 코드 (예: 'AAPL', 'NVDA', 'KOSPI200_FUTURES')
  sharesPerCU: number;    // 1 CU(Creation Unit) 당 필요한 주식 수
  weight: number;         // 포트폴리오 내 비중 (%)
}

export interface ETFDefinition {
  etfTicker: string;      // ETF 종목 코드 (예: 'ETF-K200-BULL2X')
  name: string;
  underlyingType: 'EQUITY' | 'BOND' | 'COMMODITY' | 'DERIVATIVE';
  leverageFactor: number; // 1 (일반), 2 (2배 레버리지), -1 (인버스), -2 (인버스 2X)
  cuSize: number;         // 1 CU 당 ETF 주식 수 (예: 50,000주)
  cashComponent: number;  // CU 당 소액 현금 조정분 (Cash Component)
  pdf: PDFConstituent[];  // 구성 종목 바스켓
  totalOutstandingUnits: number; // 발행 총 주식 수
}

export interface iNAVData {
  etfTicker: string;
  iNAV: number;           // 실시간 순자산가치
  marketPrice: number;    // 현재 ETF 시장가
  discrepancyRate: number;// 괴리율 (%) = ((시장가 - iNAV) / iNAV) * 100
  timestamp: number;
}

export interface APArbitrageDecision {
  action: 'CREATE_AND_SELL_ETF' | 'BUY_AND_REDEEM_ETF' | 'HOLD';
  etfTicker?: string;
  expectedProfitPerUnit?: number;
  reason?: string;
}

export interface ArbitrageSignal {
  type: 'PREMIUM_ARBITRAGE' | 'DISCOUNT_ARBITRAGE' | 'NONE';
  etfTicker: string;
  underlyingTicker: string;
  spread: number;
  quantity: number;
}

export interface LPQuote {
  bid: number;
  ask: number;
  bidQty: number;
  askQty: number;
}

export interface ETFPortfolio {
  etfTicker: string;
  leverageFactor: number; // +2, +3, -1, -2, -3 등
  nav: number;            // 현재 총 순자산가치 (Cash + Assets)
  currentExposure: number;// 현재 보유 중인 선물/주식 포지션 평가액
  totalUnits: number;     // 발행된 ETF 총 주식 수
}

export interface RebalanceOrder {
  side: 'BUY' | 'SELL';
  orderQuantity: number;
  requiredExposureDelta: number;
}
