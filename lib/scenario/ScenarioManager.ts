import {
  ManipulationScenario,
  MacroShockEvent,
  MacroShockType,
  ScenarioBias,
  AdminActionLog,
  ScenarioPhase,
  AssetType,
} from './types';

export class ScenarioManager {
  private activeScenarios: Map<string, ManipulationScenario> = new Map();
  private activeMacroShocks: Map<string, MacroShockEvent> = new Map();
  private actionLogs: AdminActionLog[] = [];
  public currentTick: number = 0;

  /**
   * 작전 세력 시나리오 주입
   */
  public injectScenario(params: {
    assetType: AssetType;
    assetId: string;
    ticker: string;
    name: string;
    mode: ScenarioPhase;
    durationTicks?: number;
    targetChangePct?: number;
    volumeMultiplier?: number;
    initialPrice: number;
    adminUser?: string;
  }): ManipulationScenario {
    const duration = Math.max(10, params.durationTicks ?? 60);
    const targetChange = params.targetChangePct ?? (params.mode === 'pump' ? 50 : params.mode === 'dump' ? -35 : 0);
    const totalTicks = params.mode === 'full_cycle' ? duration * 3 : duration;

    const scenario: ManipulationScenario = {
      id: `scen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      assetType: params.assetType,
      assetId: params.assetId,
      ticker: params.ticker,
      name: params.name,
      mode: params.mode,
      currentStep: params.mode === 'full_cycle' ? 'accumulation' : params.mode,
      durationTicks: duration,
      totalTicks,
      remainingTicks: duration,
      targetChangePct: targetChange,
      volumeMultiplier: Math.max(1, params.volumeMultiplier ?? 3),
      initialPrice: params.initialPrice,
      currentPrice: params.initialPrice,
      status: 'active',
      createdAt: Date.now(),
      createdBy: params.adminUser || 'admin',
    };

    this.activeScenarios.set(scenario.id, scenario);

    this.logAction({
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      actionType: 'INJECT_SCENARIO',
      targetId: params.assetId,
      targetName: `[${params.ticker}] ${params.name}`,
      details: {
        mode: params.mode,
        durationTicks: duration,
        targetChangePct: targetChange,
        volumeMultiplier: scenario.volumeMultiplier,
        initialPrice: params.initialPrice,
      },
      adminUser: scenario.createdBy,
      timestamp: Date.now(),
    });

    return scenario;
  }

  /**
   * 거시경제 충격 원클릭 발동
   */
  public triggerMacroShock(params: {
    type: MacroShockType;
    adminUser?: string;
  }): MacroShockEvent {
    let title = '';
    let headline = '';
    let description = '';
    let regime: 'Crisis' | 'Recession' | 'Boom' | 'Normal' = 'Crisis';
    let interestRateDelta = 0;
    let magnitude = 0;
    let durationTicks = 60;
    let affectedAssets = {};

    switch (params.type) {
      case 'RATE_HIKE_SHOCK':
        title = '⚡ 중앙은행 긴급 기준금리 +100bp 인상';
        headline = '금리 폭탄 투하! 고부채 기업 및 성장주 폭락, 채권 금리 폭등';
        description = '인플레이션 억제를 위한 기습적인 빅스텝 금리 인상으로 주식 시장 전반에 하방 충격이 발생합니다.';
        regime = 'Recession';
        interestRateDelta = 0.01;
        magnitude = -0.06;
        durationTicks = 80;
        affectedAssets = { stocks: -0.05, bonds: -0.08, oil: -0.03, gold: 0.02 };
        break;

      case 'RATE_CUT_SURPRISE':
        title = '💧 중앙은행 전격 금리 인하 및 양적완화 재개';
        headline = '유동성 파티 개막! 기준금리 전격 인하로 위험자산 폭등세';
        description = '경기 부양을 위한 금리 인하로 증시와 원자재 시장에 강력한 유동성 랠리가 유입됩니다.';
        regime = 'Boom';
        interestRateDelta = -0.0075;
        magnitude = 0.07;
        durationTicks = 80;
        affectedAssets = { stocks: 0.06, bonds: 0.05, oil: 0.04, gold: 0.05 };
        break;

      case 'GEOPOLITICAL_CRISIS':
        title = '💥 중동 주요 원유 수송로 봉쇄 및 전면전 위기';
        headline = '지정학적 위기 고조! WTI 원유·금·천연가스 가격 수직 폭등';
        description = '전쟁 공포로 인해 안전자산(금)과 에너지 가격이 폭등하고 글로벌 증시가 급락합니다.';
        regime = 'Crisis';
        magnitude = 0.09;
        durationTicks = 100;
        affectedAssets = { stocks: -0.06, oil: 0.12, gold: 0.08, bonds: 0.02 };
        break;

      case 'LIQUIDITY_BOOM':
        title = '🚀 글로벌 초대형 경기부양책 및 유동성 대방출';
        headline = '글로벌 유동성 랠리! 전 자산군 동반 신고가 랠리 진행';
        description = '천문학적인 유동성 공급으로 위험자산 전반에 강력한 매수세가 집중됩니다.';
        regime = 'Boom';
        magnitude = 0.08;
        durationTicks = 90;
        affectedAssets = { stocks: 0.08, oil: 0.06, gold: 0.04, bonds: -0.02 };
        break;

      case 'STAGFLATION_CRACK':
        title = '❄️ 스태그플레이션 충격! 원자재 급등 속 실물 경기 급랭';
        headline = '최악의 스태그플레이션 도래: 원자재는 폭등하고 주식은 급락';
        description = '원자재 공급난과 수요 위축이 동시에 발생하는 복합 위기 국면입니다.';
        regime = 'Crisis';
        magnitude = -0.05;
        durationTicks = 80;
        affectedAssets = { stocks: -0.07, oil: 0.08, gold: 0.06, bonds: -0.04 };
        break;
    }

    const shockEvent: MacroShockEvent = {
      id: `shock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: params.type,
      title,
      headline,
      description,
      regime,
      interestRateDelta,
      magnitude,
      durationTicks,
      remainingTicks: durationTicks,
      affectedAssets,
      createdAt: Date.now(),
    };

    this.activeMacroShocks.set(shockEvent.id, shockEvent);

    this.logAction({
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      actionType: 'TRIGGER_MACRO_SHOCK',
      targetName: title,
      details: {
        type: params.type,
        regime,
        magnitude,
        durationTicks,
      },
      adminUser: params.adminUser || 'admin',
      timestamp: Date.now(),
    });

    return shockEvent;
  }

  /**
   * 단일 시나리오 롤백 (긴급 중단 및 정상화)
   */
  public rollbackScenario(scenarioId: string, adminUser: string = 'admin'): boolean {
    const scenario = this.activeScenarios.get(scenarioId);
    if (!scenario) return false;

    scenario.status = 'cancelled';
    this.activeScenarios.delete(scenarioId);

    this.logAction({
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      actionType: 'ROLLBACK_SCENARIO',
      targetId: scenario.assetId,
      targetName: `[${scenario.ticker}] ${scenario.name}`,
      details: {
        scenarioId,
        cancelledAtStep: scenario.currentStep,
        remainingTicks: scenario.remainingTicks,
      },
      adminUser,
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * 전체 시나리오 & 거시경제 쇼크 긴급 전체 정지 (EMERGENCY HALT ALL)
   */
  public emergencyHaltAll(adminUser: string = 'admin'): { cancelledScenarios: number; cancelledShocks: number } {
    const cancelledScenarios = this.activeScenarios.size;
    const cancelledShocks = this.activeMacroShocks.size;

    this.activeScenarios.clear();
    this.activeMacroShocks.clear();

    this.logAction({
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      actionType: 'EMERGENCY_HALT_ALL',
      details: {
        cancelledScenariosCount: cancelledScenarios,
        cancelledShocksCount: cancelledShocks,
      },
      adminUser,
      timestamp: Date.now(),
    });

    return { cancelledScenarios, cancelledShocks };
  }

  /**
   * 매 틱 시나리오 수명주기 및 단계 전이 실행
   */
  public stepTick(): void {
    this.currentTick += 1;

    // 1. 작전 시나리오 상태 갱신
    this.activeScenarios.forEach((scenario, id) => {
      scenario.remainingTicks -= 1;

      if (scenario.remainingTicks <= 0) {
        if (scenario.mode === 'full_cycle') {
          // 풀사이클 단계 전이: accumulation ➔ pump ➔ dump ➔ completed
          if (scenario.currentStep === 'accumulation') {
            scenario.currentStep = 'pump';
            scenario.remainingTicks = scenario.durationTicks;
          } else if (scenario.currentStep === 'pump') {
            scenario.currentStep = 'dump';
            scenario.remainingTicks = scenario.durationTicks;
          } else {
            scenario.currentStep = 'completed';
            scenario.status = 'completed';
            this.activeScenarios.delete(id);
          }
        } else {
          scenario.currentStep = 'completed';
          scenario.status = 'completed';
          this.activeScenarios.delete(id);
        }
      }
    });

    // 2. 거시경제 쇼크 틱 감쇄
    this.activeMacroShocks.forEach((shock, id) => {
      shock.remainingTicks -= 1;
      if (shock.remainingTicks <= 0) {
        this.activeMacroShocks.delete(id);
      }
    });
  }

  /**
   * 특정 종목에 적용할 실시간 바이어스 계산
   */
  public getAssetBias(assetId: string): ScenarioBias {
    let buyBias = 1.0;
    let sellBias = 1.0;
    let eventShock = 0;
    let volumeMultiplier = 1.0;
    let suppressVolatility = false;

    // 1. 활성 작전 세력 시나리오 검색
    for (const scenario of this.activeScenarios.values()) {
      if (scenario.assetId === assetId || scenario.ticker.toLowerCase() === assetId.toLowerCase()) {
        volumeMultiplier = Math.max(volumeMultiplier, scenario.volumeMultiplier);

        const decayRatio = scenario.remainingTicks / scenario.durationTicks;

        if (scenario.currentStep === 'accumulation') {
          // 매집: 기관 매수 비중 상향, 호가 하단 지정가 집중, 급등락 억제
          buyBias *= 2.8;
          sellBias *= 0.6;
          suppressVolatility = true;
          eventShock += 0.001;
        } else if (scenario.currentStep === 'pump') {
          // 펌핑: 시장가 연속 매수 폭주 + 강제 상승 충격
          buyBias *= 4.5;
          sellBias *= 0.2;
          eventShock += 0.035 * Math.max(0.3, decayRatio);
        } else if (scenario.currentStep === 'dump') {
          // 덤핑: 시장가 매도 폭주 + 강제 하락 충격
          buyBias *= 0.2;
          sellBias *= 5.0;
          eventShock -= 0.045 * Math.max(0.3, decayRatio);
        }
      }
    }

    // 2. 거시경제 쇼크 반영
    for (const shock of this.activeMacroShocks.values()) {
      const shockDecay = shock.remainingTicks / shock.durationTicks;
      eventShock += (shock.magnitude / shock.durationTicks) * shockDecay * 1.5;
    }

    return {
      buyBias,
      sellBias,
      eventShock,
      volumeMultiplier,
      suppressVolatility,
    };
  }

  /**
   * 상태 조회 헬퍼
   */
  public getActiveScenarios(): ManipulationScenario[] {
    return Array.from(this.activeScenarios.values());
  }

  public getActiveMacroShocks(): MacroShockEvent[] {
    return Array.from(this.activeMacroShocks.values());
  }

  public getActionLogs(): AdminActionLog[] {
    return this.actionLogs.slice(-50).reverse();
  }

  private logAction(log: AdminActionLog): void {
    this.actionLogs.push(log);
    if (this.actionLogs.length > 200) {
      this.actionLogs = this.actionLogs.slice(-100);
    }
  }
}

// 글로벌 싱글톤 인스턴스 (Next.js HMR 안전)
const globalForScenario = globalThis as unknown as {
  scenarioManagerInstance?: ScenarioManager;
};

export const scenarioManager: ScenarioManager =
  globalForScenario.scenarioManagerInstance || new ScenarioManager();

if (!globalForScenario.scenarioManagerInstance) {
  globalForScenario.scenarioManagerInstance = scenarioManager;
}
