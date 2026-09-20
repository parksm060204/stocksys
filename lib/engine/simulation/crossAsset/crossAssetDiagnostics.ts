/**
 * STOCKSYS Cross-Asset Decision Diagnostics System
 *
 * - 거시 상태 버전, 시각, 시장 국면 추적
 * - 자산별 교차자산 신호 (기대수익, 변동성, 확신도, 주도 요인)
 * - 포트폴리오 목표 배분, 공통 요인 노출, 제약 적용 전후 내역
 * - 미지원 자산군 또는 데이터 부족으로 인한 보류 사유(Fail-closed trace)
 * - 순수 읽기 조회, 불변 방어적 복사본 반환, PRNG 부수 효과 없음
 */

import { MarketRegime } from '../regime/regimeTypes';
import { ObservableMacroState } from '../macro/macroTypes';
import { AssetClass, SignalDriver } from './crossAssetTypes';

export interface AssetDecisionTrace {
  readonly assetId: string;
  readonly assetClass: AssetClass;
  readonly direction: number;
  readonly expectedReturn: number;
  readonly expectedVolatility: number;
  readonly confidence: number;
  readonly horizonMs: number;
  readonly unconstrainedWeight: number;
  readonly constrainedWeight: number;
  readonly currentQuantity: number;
  readonly targetQuantity: number;
  readonly deltaQuantity: number;
  readonly orderAction?: 'buy' | 'sell' | 'hold';
  readonly orderSize?: number;
  readonly primaryDriver?: SignalDriver;
  readonly drivers: readonly SignalDriver[];
  readonly riskContributions: Readonly<Record<string, number>>;
  readonly constraintsApplied: readonly string[];
  readonly heldReason?: string;
  readonly sourceEventIds: readonly string[];
}

export interface CrossAssetStepSnapshot {
  readonly agentId: string;
  readonly simulationTime: number;
  readonly macroVersion: number;
  readonly marketRegime: MarketRegime;
  readonly observedMacroState: ObservableMacroState;
  readonly totalNav: number;
  readonly availableCash: number;
  readonly aggregateFactorExposure: Readonly<Record<string, number>>;
  readonly decisions: readonly AssetDecisionTrace[];
  readonly generalHeldReasons: Readonly<Record<string, string>>;
}

export class CrossAssetDiagnosticsManager {
  private history: CrossAssetStepSnapshot[] = [];
  private readonly maxHistoryLimit: number;

  constructor(maxHistoryLimit: number = 100) {
    this.maxHistoryLimit = Math.max(10, maxHistoryLimit);
  }

  /**
   * 의사결정 스냅샷 기록 (방어적 복사)
   */
  public recordStep(snapshot: CrossAssetStepSnapshot): void {
    const defensiveCopy: CrossAssetStepSnapshot = {
      agentId: snapshot.agentId,
      simulationTime: snapshot.simulationTime,
      macroVersion: snapshot.macroVersion,
      marketRegime: snapshot.marketRegime,
      observedMacroState: {
        ...snapshot.observedMacroState,
        values: { ...snapshot.observedMacroState.values },
        confidences: { ...snapshot.observedMacroState.confidences },
        effectiveRegime: snapshot.observedMacroState.effectiveRegime,
      },
      totalNav: snapshot.totalNav,
      availableCash: snapshot.availableCash,
      aggregateFactorExposure: { ...snapshot.aggregateFactorExposure },
      generalHeldReasons: { ...snapshot.generalHeldReasons },
      decisions: snapshot.decisions.map((d) => ({
        ...d,
        drivers: d.drivers.map((drv) => ({ ...drv })),
        riskContributions: { ...d.riskContributions },
        constraintsApplied: [...d.constraintsApplied],
        sourceEventIds: [...d.sourceEventIds],
        primaryDriver: d.primaryDriver ? { ...d.primaryDriver } : undefined,
      })),
    };

    this.history.push(defensiveCopy);
    if (this.history.length > this.maxHistoryLimit) {
      this.history = this.history.slice(-this.maxHistoryLimit);
    }
  }

  /**
   * 최신 스냅샷 조회 (순수 읽기)
   */
  public getLatestSnapshot(agentId?: string): CrossAssetStepSnapshot | undefined {
    if (!agentId) {
      return this.history.length > 0 ? this.cloneSnapshot(this.history[this.history.length - 1]) : undefined;
    }
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].agentId === agentId) {
        return this.cloneSnapshot(this.history[i]);
      }
    }
    return undefined;
  }

  /**
   * 과거 진단 이력 조회 (순수 읽기)
   */
  public getHistory(agentId?: string, limit: number = 50): readonly CrossAssetStepSnapshot[] {
    const clampedLimit = Math.min(this.maxHistoryLimit, Math.max(1, limit));
    const filtered = agentId ? this.history.filter((h) => h.agentId === agentId) : this.history;
    return filtered.slice(-clampedLimit).map((h) => this.cloneSnapshot(h));
  }

  /**
   * 진단 이력 초기화
   */
  public reset(): void {
    this.history = [];
  }

  private cloneSnapshot(s: CrossAssetStepSnapshot): CrossAssetStepSnapshot {
    return {
      agentId: s.agentId,
      simulationTime: s.simulationTime,
      macroVersion: s.macroVersion,
      marketRegime: s.marketRegime,
      observedMacroState: {
        ...s.observedMacroState,
        values: { ...s.observedMacroState.values },
        confidences: { ...s.observedMacroState.confidences },
      },
      totalNav: s.totalNav,
      availableCash: s.availableCash,
      aggregateFactorExposure: { ...s.aggregateFactorExposure },
      generalHeldReasons: { ...s.generalHeldReasons },
      decisions: s.decisions.map((d) => ({
        ...d,
        drivers: [...d.drivers],
        riskContributions: { ...d.riskContributions },
        constraintsApplied: [...d.constraintsApplied],
        sourceEventIds: [...d.sourceEventIds],
      })),
    };
  }
}
