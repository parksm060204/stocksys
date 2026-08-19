export type ScenarioPhase = 'accumulation' | 'pump' | 'dump' | 'full_cycle';
export type ScenarioStep = 'accumulation' | 'pump' | 'dump' | 'completed';
export type AssetType = 'stock' | 'commodity';

export interface ManipulationScenario {
  id: string;
  assetType: AssetType;
  assetId: string;
  ticker: string;
  name: string;
  mode: ScenarioPhase;
  currentStep: ScenarioStep;
  durationTicks: number;       // 각 단계별 틱 수
  totalTicks: number;          // 전체 틱 수
  remainingTicks: number;      // 현재 단계 남은 틱 수
  targetChangePct: number;     // 목표 변동률 (예: +50%, -30%)
  volumeMultiplier: number;    // 거래량 배수 (예: 2x ~ 10x)
  initialPrice: number;
  currentPrice: number;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  createdAt: number;
  createdBy: string;
}

export type MacroShockType =
  | 'RATE_HIKE_SHOCK'       // 기준금리 급등 충격 (성장주/부채기업 급락, 채권 YTM 급등)
  | 'RATE_CUT_SURPRISE'     // 깜짝 금리 인하 (주식 유동성 랠리, 채권 가격 상승)
  | 'GEOPOLITICAL_CRISIS'   // 지정학적 전쟁 위기 (원유/금/천연가스 폭등, 글로벌 주식 급락)
  | 'LIQUIDITY_BOOM'        // 글로벌 양적완화/유동성 랠리 (전방위 자산 폭등)
  | 'STAGFLATION_CRACK';    // 스태그플레이션 (원자재 급등 + 실물 경기 침체)

export interface MacroShockEvent {
  id: string;
  type: MacroShockType;
  title: string;
  headline: string;
  description: string;
  regime: 'Crisis' | 'Recession' | 'Boom' | 'Normal';
  interestRateDelta: number; // 금리 변동 (예: +1.0% = +0.01)
  magnitude: number;
  durationTicks: number;
  remainingTicks: number;
  affectedAssets: {
    stocks?: number;       // 주식 영향률
    oil?: number;          // 유가 영향률
    gold?: number;         // 금 영향률
    bonds?: number;        // 채권 영향률
  };
  createdAt: number;
}

export interface ScenarioBias {
  buyBias: number;          // 1.0 기준 (>1 매수 집중, <1 매도 집중)
  sellBias: number;
  eventShock: number;       // 추가 강제 이벤트 충격 (-0.05 ~ +0.05)
  volumeMultiplier: number;
  suppressVolatility: boolean; // 매집 단계 시 급등락 억제 여부
}

export interface AdminActionLog {
  id: string;
  actionType: 'INJECT_SCENARIO' | 'TRIGGER_MACRO_SHOCK' | 'ROLLBACK_SCENARIO' | 'EMERGENCY_HALT_ALL';
  targetId?: string;
  targetName?: string;
  details: Record<string, any>;
  adminUser: string;
  timestamp: number;
}
