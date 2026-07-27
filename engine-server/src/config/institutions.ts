import { AgentConfig } from '../types';

export const REAL_WORLD_INSTITUTIONS: Record<string, AgentConfig> = {
  BRIDGEWATER_MACRO: {
    id: 'BRIDGEWATER_MACRO',
    name: '폰툰 캐피탈 (Pontoon Capital)',
    type: 'GLOBAL_MACRO',
    riskTolerance: 1.2,
    baseWeights: { stock: 0.30, bond: 0.55, commodity: 0.15, cash: 0.0 },
    executionStyle: 'AGGRESSIVE_MARKET',
    regimeShifts: {
      INFLATION: { stock: 0.10, bond: 0.30, commodity: 0.60, cash: 0.0 },
      DEFLATION: { stock: 0.20, bond: 0.80, commodity: 0.0, cash: 0.0 },
      PANIC: { stock: 0.0, bond: 0.60, commodity: 0.40, cash: 0.0 },
    }
  },

  RENAISSANCE_QUANT: {
    id: 'RENAISSANCE_QUANT',
    name: '리버티 테크놀로지 (Liberty Tech)',
    type: 'STATISTICAL_ARBITRAGE',
    riskTolerance: 2.5,
    baseWeights: { stock: 0.90, bond: 0.0, commodity: 0.0, cash: 0.10 },
    executionStyle: 'HFT_LIMIT',
    regimeShifts: {} // 매크로 무시, 차익거래만 수행
  },

  CITADEL_MM: {
    id: 'CITADEL_MM',
    name: '포트리스 증권 (Fortress Securities)',
    type: 'MARKET_MAKER',
    riskTolerance: 0.8,
    baseWeights: { stock: 0.15, bond: 0.0, commodity: 0.0, cash: 0.85 }, // 옵션은 별도 계산
    executionStyle: 'HFT_LIMIT',
    regimeShifts: {
      PANIC: { stock: 0.05, bond: 0.0, commodity: 0.0, cash: 0.95 } // 유동성 축소
    }
  },

  BLACKROCK_PASSIVE: {
    id: 'BLACKROCK_PASSIVE',
    name: '흑요석 자산운용 (Obsidian AM)',
    type: 'PASSIVE_INDEX',
    riskTolerance: 1.0,
    baseWeights: { stock: 0.60, bond: 0.40, commodity: 0.0, cash: 0.0 },
    executionStyle: 'PASSIVE_TWAP',
    regimeShifts: {} // 시장 비중 유지
  },

  NPS_PENSION: {
    id: 'NPS_PENSION',
    name: '국가연금공단 (NPS)',
    type: 'PENSION_FUND',
    riskTolerance: 0.5,
    baseWeights: { stock: 0.50, bond: 0.50, commodity: 0.0, cash: 0.0 },
    executionStyle: 'PASSIVE_TWAP',
    regimeShifts: {
      CRASH: { stock: 0.60, bond: 0.40, commodity: 0.0, cash: 0.0 } // 폭락장 주식 비중 확대 (물타기)
    }
  }
};
