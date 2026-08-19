import { SectorType, SECTOR_REGISTRY } from './institutionalSectorEngine';

export type MacroRegimeType = 
  | 'NORMAL'                      // 평상시 국면 (±0.5% 이내 미세 조율)
  | 'HIGH_RATE_INFLATION'         // 고금리 / 인플레이션 국면
  | 'RATE_CUT_EASING'             // 금리 인하 / 유동성 확장 국면
  | 'AI_BOOM_TECH_RALLY'          // AI 슈퍼사이클 / 기술혁신 국면
  | 'RECESSION_STAGFLATION'       // 경기 후퇴 / 스태그플레이션 국면
  | 'GEOPOLITICAL_DEFENSE_RISK'   // 지정학적 리스크 / 공급망 재편 국면
  // 4대 대형 패러다임 시프트 AI 뉴스 연동 국면 (S_news >= 0.70 특수 N% 리밸런싱)
  | 'BIO_REVOLUTION'              // 🧬 바이오/신약 퀀텀점프 혁명
  | 'CLIMATE_CLEAN_ENERGY'        // 🌱 친환경 에너지 대전환 (글로벌 2위 산업 등극)
  | 'QUANTUM_AI_SINGULARITY'      // ⚛️ 양자 AI 초지능 싱귤래리티
  | 'DEFENSE_SPACE_COLONIZATION'; // 🚀 우주 상업화 & 지정학 퀀텀점프

export interface AINewsAnalysisResult {
  newsId: string;
  title: string;
  targetSector: SectorType;
  aiWeightScore: number;          // AI 뉴스 가중치 점수 (0.00 ~ 1.00)
  isThresholdExceeded: boolean;   // S_news >= 0.70 여부
  specialRebalanceNPercent: number; // N% 특수 리밸런싱 비율 (%) = Math.round(S_news * 40)
  impactSummary: string;
}

export interface MacroRegimeProfile {
  id: MacroRegimeType;
  title: string;
  icon: string;
  description: string;
  isSpecialParadigm: boolean;     // AI 뉴스 특수 패러다임 시프트 여부
  aiWeightScore: number;          // AI 가중치 점수 (S_news)
  targetSector: SectorType;
  sectorDeltaPercent: number;     // 주력 타겟 섹터의 N% 변동 수치
  recommendedAction: string;
}

export const MACRO_REGIME_REGISTRY: Record<MacroRegimeType, MacroRegimeProfile> = {
  NORMAL: {
    id: 'NORMAL',
    title: '평상시 모드 (Normal Regime)',
    icon: '🟢',
    description: '거시 지표 안정 유지. 일일 iNAV 변동폭 ±0.5% 이내 미세 조율 수렴',
    isSpecialParadigm: false,
    aiWeightScore: 0.25,
    targetSector: 'TECH_SEMI',
    sectorDeltaPercent: 0,
    recommendedAction: '기준 포트폴리오 유지'
  },
  HIGH_RATE_INFLATION: {
    id: 'HIGH_RATE_INFLATION',
    title: '고금리 / 인플레이션 국면',
    icon: '📈',
    description: '10년물 국채 금리 급등. 고P/E 축소, 금융(+10%) & 에너지(+10%) 우위 배치',
    isSpecialParadigm: false,
    aiWeightScore: 0.62,
    targetSector: 'FINANCE',
    sectorDeltaPercent: 10,
    recommendedAction: '금융 & 원자재 비중 확대'
  },
  RATE_CUT_EASING: {
    id: 'RATE_CUT_EASING',
    title: '금리 인하 / 유동성 확장 국면',
    icon: '🏦',
    description: '중앙은행 금리 인하. Risk-On 확충, 반도체/빅테크(+15%) & 바이오(+10%) 확대',
    isSpecialParadigm: false,
    aiWeightScore: 0.68,
    targetSector: 'TECH_SEMI',
    sectorDeltaPercent: 15,
    recommendedAction: '성장주 & 바이오 비중 확대'
  },
  AI_BOOM_TECH_RALLY: {
    id: 'AI_BOOM_TECH_RALLY',
    title: 'AI 슈퍼사이클 / 기술혁신',
    icon: '💻',
    description: 'AI 반도체 수요 폭발. 반도체/빅테크(+20%) 메가 오버웨이트',
    isSpecialParadigm: false,
    aiWeightScore: 0.69,
    targetSector: 'TECH_SEMI',
    sectorDeltaPercent: 20,
    recommendedAction: '반도체/빅테크 압도적 우위'
  },
  RECESSION_STAGFLATION: {
    id: 'RECESSION_STAGFLATION',
    title: '경기 후퇴 / 스태그플레이션',
    icon: '🛡️',
    description: '경기 침체 방어. 채권(+20%) 및 방산/바이오 방어주 중심 자금 이동',
    isSpecialParadigm: false,
    aiWeightScore: 0.65,
    targetSector: 'BIO_HEALTH',
    sectorDeltaPercent: 12,
    recommendedAction: '안고자산 & 방어주 수성'
  },
  GEOPOLITICAL_DEFENSE_RISK: {
    id: 'GEOPOLITICAL_DEFENSE_RISK',
    title: '지정학적 리스크 / 공급망 재편',
    icon: '⚔️',
    description: '국제 정세 불안. 방산/우주항공(+20%) & 에너지(+15%) 우위 배치',
    isSpecialParadigm: false,
    aiWeightScore: 0.67,
    targetSector: 'DEFENSE_AERO',
    sectorDeltaPercent: 20,
    recommendedAction: '방산 & 에너지 리밸런싱'
  },

  // 4대 대형 패러다임 시프트 AI 뉴스 연동 국면 (S_news >= 0.70 특수 N% 리밸런싱)
  BIO_REVOLUTION: {
    id: 'BIO_REVOLUTION',
    title: '🧬 바이오/신약 퀀텀점프 혁명 (AI 가중치 0.88)',
    icon: '🧬',
    description: 'FDA 세계 최초 암 완치제 가속 승인! AI 가중치 0.88 (>=0.70) → 바이오 섹터 +35% 특수 자금 주입 (글로벌 2위 산업 등극)',
    isSpecialParadigm: true,
    aiWeightScore: 0.88,
    targetSector: 'BIO_HEALTH',
    sectorDeltaPercent: 35,
    recommendedAction: '전 기관 바이오 섹터 +35% N% 특수 리밸런싱 구동'
  },
  CLIMATE_CLEAN_ENERGY: {
    id: 'CLIMATE_CLEAN_ENERGY',
    title: '🌱 친환경 에너지 대전환 (AI 가중치 0.85)',
    icon: '🌱',
    description: '글로벌 탄소 국경세 300% 기습 적용 확정! AI 가중치 0.85 (>=0.70) → 2차전지/친환경 에너지 +34% 특수 자금 주입',
    isSpecialParadigm: true,
    aiWeightScore: 0.85,
    targetSector: 'BATTERY_ENERGY',
    sectorDeltaPercent: 34,
    recommendedAction: '전 기관 친환경/2차전지 +34% N% 특수 리밸런싱 구동'
  },
  QUANTUM_AI_SINGULARITY: {
    id: 'QUANTUM_AI_SINGULARITY',
    title: '⚛️ 양자 AI 초지능 싱귤래리티 (AI 가중치 0.92)',
    icon: '⚛️',
    description: '초거대 양자 컴퓨터 상용화 성공! AI 가중치 0.92 (>=0.70) → 반도체/빅테크 +37% 특수 자금 주입',
    isSpecialParadigm: true,
    aiWeightScore: 0.92,
    targetSector: 'TECH_SEMI',
    sectorDeltaPercent: 37,
    recommendedAction: '전 기관 빅테크/반도체 +37% N% 특수 리밸런싱 구동'
  },
  DEFENSE_SPACE_COLONIZATION: {
    id: 'DEFENSE_SPACE_COLONIZATION',
    title: '🚀 우주 상업화 & 지정학 퀀텀점프 (AI 가중치 0.82)',
    icon: '🚀',
    description: '우주 자원 채굴 및 방산 국방예산 500조 원 증액! AI 가중치 0.82 (>=0.70) → 방산/우주항공 +33% 특수 자금 주입',
    isSpecialParadigm: true,
    aiWeightScore: 0.82,
    targetSector: 'DEFENSE_AERO',
    sectorDeltaPercent: 33,
    recommendedAction: '전 기관 방산/우주항공 +33% N% 특수 리밸런싱 구동'
  }
};

/**
 * AI 뉴스 가중치 평가 및 거시경제 동적 자산배분 엔진
 */
export class MacroRegimeEngine {
  /**
   * 임의의 뉴스 텍스트가 들어왔을 때 AI 가중치(S_news) 및 N% 특수 리밸런싱 스코어 산출
   */
  public static analyzeAINewsText(title: string, content: string): AINewsAnalysisResult {
    let targetSector: SectorType = 'TECH_SEMI';
    let baseScore = 0.50;

    const text = `${title} ${content}`.toLowerCase();

    if (text.includes('암') || text.includes('바이오') || text.includes('fda') || text.includes('신약')) {
      targetSector = 'BIO_HEALTH';
      baseScore = 0.88;
    } else if (text.includes('탄소') || text.includes('친환경') || text.includes('2차전지') || text.includes('배터리')) {
      targetSector = 'BATTERY_ENERGY';
      baseScore = 0.85;
    } else if (text.includes('양자') || text.includes('컴퓨터') || text.includes('ai') || text.includes('반도체')) {
      targetSector = 'TECH_SEMI';
      baseScore = 0.92;
    } else if (text.includes('방산') || text.includes('우주') || text.includes('국방') || text.includes('전쟁')) {
      targetSector = 'DEFENSE_AERO';
      baseScore = 0.82;
    }

    const isThresholdExceeded = baseScore >= 0.70;
    const specialRebalanceNPercent = isThresholdExceeded ? Math.round(baseScore * 40) : 5;

    const sectorName = SECTOR_REGISTRY[targetSector].name;
    const impactSummary = isThresholdExceeded
      ? `[AI 가중치 ${baseScore.toFixed(2)} >= 0.70] 특수 패러다임 시프트 발동! ${sectorName} 섹터 +${specialRebalanceNPercent}% N% 대폭 리밸런싱`
      : `[AI 가중치 ${baseScore.toFixed(2)} < 0.70] 미세 거시 조율 (+${specialRebalanceNPercent}% 변동)`;

    return {
      newsId: `NEWS_${Date.now()}`,
      title,
      targetSector,
      aiWeightScore: baseScore,
      isThresholdExceeded,
      specialRebalanceNPercent,
      impactSummary
    };
  }

  /**
   * 특정 거시 국면/AI 뉴스 패러다임에 따른 50개 기관의 동적 7대 섹터 가중치 계산
   */
  public static calculateDynamicSectorWeights(
    instId: string,
    regimeKey: MacroRegimeType,
    baseWeights: Record<SectorType, number>
  ): Record<SectorType, number> {
    const regime = MACRO_REGIME_REGISTRY[regimeKey] || MACRO_REGIME_REGISTRY.NORMAL;
    if (regimeKey === 'NORMAL') return { ...baseWeights };

    const targetSec = regime.targetSector;
    const delta = regime.sectorDeltaPercent; // N% 변동 수치

    const result: Record<SectorType, number> = { ...baseWeights };

    // 타겟 섹터에 N% 추가 주입
    result[targetSec] = (result[targetSec] || 10) + delta;

    // 타 섹터에서 비율대로 차감하여 총합 100% 유지
    const otherKeys = (Object.keys(baseWeights) as SectorType[]).filter(k => k !== targetSec);
    const sumOthers = otherKeys.reduce((sum, k) => sum + result[k], 0);

    if (sumOthers > 0) {
      otherKeys.forEach(k => {
        const reduction = (result[k] / sumOthers) * delta;
        result[k] = Math.max(1, Number((result[k] - reduction).toFixed(1)));
      });
    }

    // 최종 합계 100% 정규화
    const totalSum = (Object.keys(result) as SectorType[]).reduce((sum, k) => sum + result[k], 0);
    (Object.keys(result) as SectorType[]).forEach(k => {
      result[k] = Number(((result[k] / totalSum) * 100).toFixed(1));
    });

    return result;
  }
}
