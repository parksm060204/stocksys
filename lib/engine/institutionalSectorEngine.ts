import { INDIVIDUAL_INSTITUTION_REGISTRY, InstitutionProfile } from './crossAssetLinkageEngine';
import { MacroRegimeEngine, MacroRegimeType } from './macroRegimeEngine';

export type SectorType = 
  | 'TECH_SEMI'       // 반도체 & 빅테크
  | 'BATTERY_ENERGY'  // 2차전지 & 친환경 에너지
  | 'AUTO_HEAVY'      // 자동차 & 중공업
  | 'FINANCE'         // 금융 & 투자은행
  | 'BIO_HEALTH'      // 바이오 & 헬스케어
  | 'DEFENSE_AERO'    // 방산 & 우주항공
  | 'CONSUMER_MEDIA'; // 소비재 & 엔터미디어

export interface SectorDefinition {
  id: SectorType;
  name: string;
  nameEn: string;
  icon: string;
  color: string;
  keyStocks: { ticker: string; name: string; weightInSector: number }[];
}

export const SECTOR_REGISTRY: Record<SectorType, SectorDefinition> = {
  TECH_SEMI: {
    id: 'TECH_SEMI',
    name: '반도체 & 빅테크',
    nameEn: 'Tech & Semiconductors',
    icon: '💻',
    color: '#00C805',
    keyStocks: [
      { ticker: 'SAMSUNG_ELEC', name: '삼성전자', weightInSector: 40 },
      { ticker: 'SK_HYNIX', name: 'SK하이닉스', weightInSector: 25 },
      { ticker: 'NVDA', name: 'NVIDIA', weightInSector: 15 },
      { ticker: 'AAPL', name: 'Apple', weightInSector: 10 },
      { ticker: 'MSFT', name: 'Microsoft', weightInSector: 10 },
    ]
  },
  BATTERY_ENERGY: {
    id: 'BATTERY_ENERGY',
    name: '2차전지 & 친환경 에너지',
    nameEn: 'Battery & Energy',
    icon: '🔋',
    color: '#F04452',
    keyStocks: [
      { ticker: 'LG_ENERGY', name: 'LG에너지솔루션', weightInSector: 45 },
      { ticker: 'POSCO_HOLDINGS', name: 'POSCO홀딩스', weightInSector: 35 },
      { ticker: 'TSLA', name: 'Tesla Energy', weightInSector: 20 },
    ]
  },
  AUTO_HEAVY: {
    id: 'AUTO_HEAVY',
    name: '자동차 & 모빌리티/중공업',
    nameEn: 'Automotive & Heavy Industry',
    icon: '🚗',
    color: '#FFB800',
    keyStocks: [
      { ticker: 'HYUNDAI_MOTOR', name: '현대자동차', weightInSector: 50 },
      { ticker: 'KIA', name: '기아', weightInSector: 30 },
      { ticker: 'TOYOTA', name: 'Toyota', weightInSector: 20 },
    ]
  },
  FINANCE: {
    id: 'FINANCE',
    name: '금융 & 투자은행(IB)',
    nameEn: 'Financials & Banking',
    icon: '🏛️',
    color: '#3182F6',
    keyStocks: [
      { ticker: 'KB_FINANCE', name: 'KB금융', weightInSector: 35 },
      { ticker: 'SHINHAN', name: '신한지주', weightInSector: 30 },
      { ticker: 'JPMORGAN', name: 'JPMorgan Chase', weightInSector: 20 },
      { ticker: 'GOLDMAN', name: 'Goldman Sachs', weightInSector: 15 },
    ]
  },
  BIO_HEALTH: {
    id: 'BIO_HEALTH',
    name: '바이오 & 헬스케어',
    nameEn: 'Bio & Healthcare',
    icon: '🧬',
    color: '#A855F7',
    keyStocks: [
      { ticker: 'SAMSUNG_BIOLOGICS', name: '삼성바이오로직스', weightInSector: 50 },
      { ticker: 'CELLTRION', name: '셀트리온', weightInSector: 35 },
      { ticker: 'LILLY', name: 'Eli Lilly', weightInSector: 15 },
    ]
  },
  DEFENSE_AERO: {
    id: 'DEFENSE_AERO',
    name: '방산 & 우주항공',
    nameEn: 'Defense & Aerospace',
    icon: '🚀',
    color: '#EC4899',
    keyStocks: [
      { ticker: 'HANWHA_AERO', name: '한화에어로스페이스', weightInSector: 50 },
      { ticker: 'LIG_NEX1', name: 'LIG넥스원', weightInSector: 30 },
      { ticker: 'LOCKHEED', name: 'Lockheed Martin', weightInSector: 20 },
    ]
  },
  CONSUMER_MEDIA: {
    id: 'CONSUMER_MEDIA',
    name: '소비재 & K-컬처/엔터',
    nameEn: 'Consumer & Media',
    icon: '🎬',
    color: '#06B6D4',
    keyStocks: [
      { ticker: 'SONY', name: 'Sony Group', weightInSector: 35 },
      { ticker: 'TENCENT', name: 'Tencent', weightInSector: 35 },
      { ticker: 'ALIBABA', name: 'Alibaba', weightInSector: 30 },
    ]
  }
};

export interface InstitutionSectorAllocation {
  sectorId: SectorType;
  sectorName: string;
  icon: string;
  color: string;
  weightPercent: number;          // 기관 주식 포트폴리오 내 해당 섹터 비중 (%)
  allocatedAmountBillion: number; // 섹터 할당 금액 (Billion USD)
  topConstituentStocks: { name: string; estimatedAmountBillion: number }[];
}

export interface InstitutionalSectorProfile {
  institution: InstitutionProfile;
  totalStockAumBillion: number;   // 전체 AUM 중 현물(주식) 할당 총액
  sectorAllocations: InstitutionSectorAllocation[];
  primarySector: SectorDefinition;
  rebalanceSignal: string;
}

/**
 * 50개 기관별 독자적 7대 섹터 가중치 매트릭스 계산기
 */
export class InstitutionalSectorEngine {
  public static getProfile(instId: string, regimeKey: MacroRegimeType = 'NORMAL'): InstitutionalSectorProfile {
    const inst = INDIVIDUAL_INSTITUTION_REGISTRY[instId] || INDIVIDUAL_INSTITUTION_REGISTRY["NPS_KOREA"];
    const totalStockAumBillion = inst.aumBillionUsd * inst.weights.wSpot;

    // 1. 기본 자산배분 섹터 가중치
    const baseSectorWeights = this.calculateSectorWeights(inst);

    // 2. 거시경제 체제(MacroRegime) & AI 뉴스 특수 가중치(S_news >= 0.70) 연동 동적 리밸런싱 적용
    const sectorWeights = MacroRegimeEngine.calculateDynamicSectorWeights(instId, regimeKey, baseSectorWeights);

    const sectorAllocations: InstitutionSectorAllocation[] = Object.keys(SECTOR_REGISTRY).map((key) => {
      const sectorKey = key as SectorType;
      const sectorDef = SECTOR_REGISTRY[sectorKey];
      const weightPercent = sectorWeights[sectorKey] || 5;
      const allocatedAmountBillion = Number(((totalStockAumBillion * weightPercent) / 100).toFixed(1));

      const topConstituentStocks = sectorDef.keyStocks.map((stk) => ({
        name: stk.name,
        estimatedAmountBillion: Number(((allocatedAmountBillion * stk.weightInSector) / 100).toFixed(2))
      }));

      return {
        sectorId: sectorKey,
        sectorName: sectorDef.name,
        icon: sectorDef.icon,
        color: sectorDef.color,
        weightPercent,
        allocatedAmountBillion,
        topConstituentStocks
      };
    }).sort((a, b) => b.weightPercent - a.weightPercent);

    const primarySector = SECTOR_REGISTRY[sectorAllocations[0].sectorId];
    const topSectorName = primarySector.name;

    const rebalanceSignal = `[${inst.name}] 주식 자산($${totalStockAumBillion.toFixed(0)}B) 중 주력 ${topSectorName}(${sectorAllocations[0].weightPercent}%) 중심 비중 확대 유지 중`;

    return {
      institution: inst,
      totalStockAumBillion: Number(totalStockAumBillion.toFixed(1)),
      sectorAllocations,
      primarySector,
      rebalanceSignal
    };
  }

  private static calculateSectorWeights(inst: InstitutionProfile): Record<SectorType, number> {
    const id = inst.id;
    const category = inst.category;

    // 1. 특정 테마/섹터 운용사 예외 맞춤 설정
    if (id.includes("SAMSUNG") || id.includes("KODEXSEMI")) {
      return { TECH_SEMI: 55, BATTERY_ENERGY: 15, FINANCE: 10, BIO_HEALTH: 10, AUTO_HEAVY: 5, DEFENSE_AERO: 3, CONSUMER_MEDIA: 2 };
    }
    if (id.includes("SAUDI") || id.includes("ARAMCO") || id.includes("PIF")) {
      return { TECH_SEMI: 35, BATTERY_ENERGY: 30, DEFENSE_AERO: 15, AUTO_HEAVY: 10, FINANCE: 5, BIO_HEALTH: 3, CONSUMER_MEDIA: 2 };
    }
    if (id.includes("CITADEL") || id.includes("RENAISSANCE")) {
      return { TECH_SEMI: 50, FINANCE: 25, AUTO_HEAVY: 10, BIO_HEALTH: 8, BATTERY_ENERGY: 4, DEFENSE_AERO: 2, CONSUMER_MEDIA: 1 };
    }

    // 2. 카테고리별 표준 섹터 가중치
    switch (category) {
      case 'PENSION': // 연기금 (국민연금 등): 다각화 밸런스
        return { TECH_SEMI: 35, FINANCE: 20, BIO_HEALTH: 15, AUTO_HEAVY: 12, BATTERY_ENERGY: 8, DEFENSE_AERO: 5, CONSUMER_MEDIA: 5 };
      case 'HEDGE_FUND': // 헤지펀드: 반도체/테크 고비중
        return { TECH_SEMI: 48, FINANCE: 22, BATTERY_ENERGY: 10, AUTO_HEAVY: 8, BIO_HEALTH: 6, DEFENSE_AERO: 4, CONSUMER_MEDIA: 2 };
      case 'ASSET_MGMT': // 자산운용사 (블랙록, 뱅가드): 지수형 분포
        return { TECH_SEMI: 40, FINANCE: 18, BATTERY_ENERGY: 12, AUTO_HEAVY: 10, BIO_HEALTH: 10, CONSUMER_MEDIA: 6, DEFENSE_AERO: 4 };
      case 'SOVEREIGN': // 국부펀드: 메가 캡 & 에너지/방산
        return { TECH_SEMI: 38, BATTERY_ENERGY: 20, FINANCE: 15, DEFENSE_AERO: 12, AUTO_HEAVY: 8, BIO_HEALTH: 4, CONSUMER_MEDIA: 3 };
      case 'BANK':
      case 'CENTRAL_BANK': // 중앙은행 / 은행: 금융 고비중
        return { FINANCE: 65, TECH_SEMI: 15, BATTERY_ENERGY: 8, AUTO_HEAVY: 5, BIO_HEALTH: 4, DEFENSE_AERO: 2, CONSUMER_MEDIA: 1 };
      default:
        return { TECH_SEMI: 35, FINANCE: 20, AUTO_HEAVY: 15, BATTERY_ENERGY: 10, BIO_HEALTH: 10, DEFENSE_AERO: 5, CONSUMER_MEDIA: 5 };
    }
  }
}
