/**
 * STOCKSYS Deterministic Market State Transition Engine
 *
 * 1단계: 시장 국면(MarketRegime) 및 거래 세션(TradingSession) 결정론적 엔진
 *
 * 주요 원칙:
 * 1. 경제 상태 결정에 Date.now(), Math.random() 사용 완전 금지 (독립 deriveDeterministicSeed & SimPrng 전용)
 * 2. 원자적 스냅샷 게시: 비동기 스텝 실행 중 torn read 방지를 위한 불변 스냅샷 단일 참조 교체
 * 3. 거래일 기준점 명시: tradingDayAnchorMs 기반 시간 경과 및 [start, end) 반열린 구간 규칙
 * 4. 다음 스텝 적용 원칙: 스텝 N 종료 시 pendingTransition 등록 -> 스텝 N+1 시작 시 활성화 (No Circular Causality)
 * 5. 우선순위: 유동성위기 -> 고변동성 -> 상승/하락 -> 횡보
 * 6. 과도한 전환 방지: 최소 유지 시간, 쿨다운, 진입/이탈 분리 히스테리시스, 스텝당 최대 1회 전환, 동일 국면 전환 금지
 * 7. 읽기 전용 불변 스냅샷 반환: deepFreeze 및 deepClone 격리로 부작용 0, 외부 변조 완벽 차단
 */

import { SimPrng } from '../simClock';
import {
  MarketRegime,
  TradingSession,
  RegimeTransitionReason,
  MarketStateSnapshot,
  RegimeObservation,
  RegimeTransitionRecord,
  SessionTransitionRecord,
  MarketStateEngineConfig,
  MarketRegimeParameters,
  SessionScheduleConfig,
  PendingRegimeTransition,
  RegimeTransitionMetrics,
  RegimeThresholdConfig,
} from './regimeTypes';
import {
  DEFAULT_REGIME_PARAMETERS,
  DEFAULT_REGIME_THRESHOLDS,
  DEFAULT_SESSION_SCHEDULE,
  STANDARD_SESSIONS,
  validateRegimeParameters,
  validateSessionSchedule,
  validateRegimeThresholds,
  deepFreeze,
  deepClone,
  deriveDeterministicSeed,
} from './regimeConfig';

export class MarketStateEngine {
  private readonly config: MarketStateEngineConfig;
  private prng: SimPrng;
  private readonly initialSeed: number;

  // ── 거래일 시간 기준점 ──
  private readonly tradingDayAnchorMs: number;
  private readonly tradingDayDurationMs: number;

  // ── 국면 상태 (내부 가변 계산 상태) ──
  private currentRegime: MarketRegime;
  private previousRegime: MarketRegime | null = null;
  private regimeStartedAt: number; // epoch ms
  private transitionId: number = 0;
  private lastTransitionReason: RegimeTransitionReason | null = null;
  private lastTransitionEvaluatedAt: number = 0;

  // ── 다음 스텝 지연 적용 대기 (Pending) ──
  private pendingTransition: PendingRegimeTransition | null = null;

  // ── 거래 세션 상태 ──
  private currentSession: TradingSession;
  private sessionStartedAt: number; // epoch ms
  private nextSession: TradingSession;
  private nextTransitionAt: number; // epoch ms
  private sessionTransitionId: number = 0;
  private lastProcessedBoundaryMs: number = -1;

  // ── 이력 링 버퍼 ──
  private readonly maxHistoryLimit: number;
  private regimeHistory: RegimeTransitionRecord[] = [];
  private sessionHistory: SessionTransitionRecord[] = [];

  // ── 원자적 상태 스냅샷 (단일 참조 교체) ──
  private stateVersion: number = 0;
  private publishedSnapshot!: Readonly<MarketStateSnapshot>;

  constructor(
    config?: Partial<MarketStateEngineConfig>,
    seed: number = 42,
    initialEpochMs: number = 1773500000000
  ) {
    this.initialSeed = seed;
    // 시장 국면 전용 독립 PRNG 스트림 (기존 봇/주문 PRNG와 완전 격리)
    const regimeSeed = deriveDeterministicSeed(seed, 'market-regime-v1');
    this.prng = new SimPrng(regimeSeed);

    const sessionSchedule = deepFreeze(
      deepClone(config?.sessionSchedule ?? DEFAULT_SESSION_SCHEDULE)
    );
    validateSessionSchedule(sessionSchedule);

    const thresholds = deepFreeze(
      deepClone(config?.thresholds ?? DEFAULT_REGIME_THRESHOLDS)
    );
    validateRegimeThresholds(thresholds);

    this.tradingDayAnchorMs = sessionSchedule.tradingDayAnchorMs ?? sessionSchedule.dayStartEpochMs ?? initialEpochMs;
    const dayDurationSec = sessionSchedule.tradingDayDurationSeconds ?? sessionSchedule.totalDayDurationSeconds ?? 86400;
    this.tradingDayDurationMs = dayDurationSec * 1000;

    const sessionCalc = this.calculateSessionAtTime(initialEpochMs, sessionSchedule);

    const VALID_REGIMES = new Set(['BULL', 'BEAR', 'SIDEWAYS', 'HIGH_VOLATILITY', 'LIQUIDITY_CRISIS']);
    if (config?.initialRegime && !VALID_REGIMES.has(config.initialRegime)) {
      throw new Error(`[MarketStateEngine] Invalid initialRegime: ${config.initialRegime}`);
    }

    const VALID_SESSIONS = new Set(STANDARD_SESSIONS);
    if (config?.initialSession !== undefined) {
      if (!VALID_SESSIONS.has(config.initialSession)) {
        throw new Error(`[MarketStateEngine] Invalid initialSession: ${config.initialSession}`);
      }
      if (config.initialSession !== sessionCalc.session) {
        throw new Error(
          `[MarketStateEngine] initialSession mismatch: provided '${config.initialSession}', but calculated session at ${initialEpochMs} is '${sessionCalc.session}'`
        );
      }
    }

    if (config?.maxHistoryLimit !== undefined) {
      if (
        typeof config.maxHistoryLimit !== 'number' ||
        !Number.isInteger(config.maxHistoryLimit) ||
        config.maxHistoryLimit <= 0
      ) {
        throw new RangeError(
          `[MarketStateEngine] maxHistoryLimit must be a positive integer: ${config.maxHistoryLimit}`
        );
      }
    }

    const initialRegime = config?.initialRegime ?? 'SIDEWAYS';
    const initialSession = config?.initialSession ?? sessionCalc.session;
    const maxHistoryLimit = config?.maxHistoryLimit ?? 200;

    this.config = deepFreeze({
      initialRegime,
      initialSession,
      sessionSchedule,
      thresholds,
      maxHistoryLimit,
    });
    this.maxHistoryLimit = maxHistoryLimit;

    this.currentRegime = this.config.initialRegime;
    this.regimeStartedAt = initialEpochMs;

    this.currentSession = this.config.initialSession ?? sessionCalc.session;
    this.sessionStartedAt = sessionCalc.sessionStartedAt;
    this.nextSession = sessionCalc.nextSession;
    this.nextTransitionAt = sessionCalc.nextTransitionAt;

    // 초기 완성 스냅샷 원자적 게시
    this.publishSnapshot(initialEpochMs);
  }

  // ─────────────────────────────────────────────────────────────────
  // 1. 거래 세션 스케줄링 [start, end) 및 다중 경계 순차 전진
  // ─────────────────────────────────────────────────────────────────

  /**
   * 주어진 시뮬레이션 시각에 맞춰 거래 세션을 전진시킵니다.
   * [start, end) 반열린 구간 규칙: 정확히 경계 시각에 도달하면 다음 세션으로 즉시 전환됩니다.
   * 큰 dt가 입력되어 여러 경계나 여러 거래일을 통과할 경우 모든 경계를 순서대로 transition 이력에 기록합니다.
   */
  public advanceSession(targetEpochMs: number): void {
    if (!Number.isFinite(targetEpochMs) || targetEpochMs < 0) {
      throw new RangeError(`[MarketStateEngine] targetEpochMs must be non-negative finite: ${targetEpochMs}`);
    }
    if (targetEpochMs < this.sessionStartedAt) {
      throw new RangeError(`[MarketStateEngine] Time cannot flow backwards: ${targetEpochMs} < ${this.sessionStartedAt}`);
    }

    // 경계를 통과할 때마다 루프로 다음 세션으로 순차 전진
    while (targetEpochMs >= this.nextTransitionAt) {
      const boundaryTime = this.nextTransitionAt;
      if (boundaryTime === this.lastProcessedBoundaryMs) {
        break; // 동일 경계 중복 기록 방지
      }
      this.lastProcessedBoundaryMs = boundaryTime;

      const prevSession = this.currentSession;
      const targetSession = this.nextSession;

      this.sessionTransitionId++;
      const elapsedMs = boundaryTime - this.tradingDayAnchorMs;
      const tradingDay = Math.floor(elapsedMs / this.tradingDayDurationMs);

      const record: SessionTransitionRecord = deepFreeze({
        transitionId: this.sessionTransitionId,
        timestamp: boundaryTime,
        fromSession: prevSession,
        toSession: targetSession,
        tradingDay: Math.max(0, tradingDay),
      });

      this.sessionHistory.push(record);
      if (this.sessionHistory.length > this.maxHistoryLimit) {
        this.sessionHistory.shift();
      }

      this.currentSession = targetSession;
      this.sessionStartedAt = boundaryTime;

      // 다음 경계 갱신
      const nextBound = this.calculateNextSessionFrom(boundaryTime);
      this.nextSession = nextBound.nextSession;
      this.nextTransitionAt = nextBound.nextTransitionAt;
    }
  }

  /**
   * 특정 시각 기준 현재 세션 및 경계 계산 ([start, end) 규칙)
   */
  private calculateSessionAtTime(
    epochMs: number,
    schedule?: SessionScheduleConfig
  ): {
    session: TradingSession;
    sessionStartedAt: number;
    nextSession: TradingSession;
    nextTransitionAt: number;
  } {
    const sched = schedule ?? this.config.sessionSchedule;
    const anchorMs = sched.tradingDayAnchorMs ?? sched.dayStartEpochMs ?? epochMs;
    const dayDurationSec = sched.tradingDayDurationSeconds ?? sched.totalDayDurationSeconds ?? 86400;
    const dayDurationMs = dayDurationSec * 1000;

    const elapsedSinceAnchor = epochMs - anchorMs;
    const normalizedElapsedMs = ((elapsedSinceAnchor % dayDurationMs) + dayDurationMs) % dayDurationMs;
    const currentDayStartMs = epochMs - normalizedElapsedMs;

    let accumulatedMs = 0;
    for (let i = 0; i < sched.sessions.length; i++) {
      const def = sched.sessions[i];
      const sessionDurationMs = def.durationSeconds * 1000;
      const sessionEndOffsetMs = accumulatedMs + sessionDurationMs;

      // [start, end)
      if (normalizedElapsedMs >= accumulatedMs && normalizedElapsedMs < sessionEndOffsetMs) {
        const nextIndex = (i + 1) % sched.sessions.length;
        const nextDef = sched.sessions[nextIndex];
        return {
          session: def.session,
          sessionStartedAt: currentDayStartMs + accumulatedMs,
          nextSession: nextDef.session,
          nextTransitionAt: currentDayStartMs + sessionEndOffsetMs,
        };
      }
      accumulatedMs = sessionEndOffsetMs;
    }

    // fallback: 마지막 세션
    const lastDef = sched.sessions[sched.sessions.length - 1];
    return {
      session: lastDef.session,
      sessionStartedAt: currentDayStartMs + accumulatedMs - lastDef.durationSeconds * 1000,
      nextSession: sched.sessions[0].session,
      nextTransitionAt: currentDayStartMs + dayDurationMs,
    };
  }

  /**
   * boundaryTime 정확한 시점에서의 다음 세션 경계 계산
   */
  private calculateNextSessionFrom(boundaryEpochMs: number): {
    nextSession: TradingSession;
    nextTransitionAt: number;
  } {
    const schedule = this.config.sessionSchedule;
    const anchorMs = schedule.tradingDayAnchorMs ?? schedule.dayStartEpochMs ?? boundaryEpochMs;
    const dayDurationSec = schedule.tradingDayDurationSeconds ?? schedule.totalDayDurationSeconds ?? 86400;
    const dayDurationMs = dayDurationSec * 1000;

    const elapsedSinceAnchor = boundaryEpochMs - anchorMs;
    const normalizedElapsedMs = ((elapsedSinceAnchor % dayDurationMs) + dayDurationMs) % dayDurationMs;
    const currentDayStartMs = boundaryEpochMs - normalizedElapsedMs;

    let accumulatedMs = 0;
    for (let i = 0; i < schedule.sessions.length; i++) {
      const def = schedule.sessions[i];
      const sessionDurationMs = def.durationSeconds * 1000;
      const sessionEndOffsetMs = accumulatedMs + sessionDurationMs;

      if (normalizedElapsedMs >= accumulatedMs && normalizedElapsedMs < sessionEndOffsetMs) {
        const nextIndex = (i + 1) % schedule.sessions.length;
        return {
          nextSession: schedule.sessions[nextIndex].session,
          nextTransitionAt: currentDayStartMs + sessionEndOffsetMs,
        };
      }
      accumulatedMs = sessionEndOffsetMs;
    }

    return {
      nextSession: schedule.sessions[1 % schedule.sessions.length].session,
      nextTransitionAt: boundaryEpochMs + schedule.sessions[0].durationSeconds * 1000,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 2. 다음 스텝 적용 원칙: 스텝 시작 시 Pending 활성화
  // ─────────────────────────────────────────────────────────────────

  /**
   * 스텝 시작 시 호출되어 이전 스텝 종료 시점에 결정된 pendingTransition을 현재 국면으로 승격합니다.
   *
   * 엄격한 활성화 조건:
   * 1. pending.effectiveAt <= currentStepStartTime
   * 2. pending.decisionStepId < currentStepId (원래 평가가 수행된 스텝 이후의 스텝이어야 함)
   * 3. pending.regime !== currentRegime
   */
  public activatePendingRegime(currentStepStartTime: number, currentStepId: number = 1): boolean {
    if (!this.pendingTransition) {
      return false;
    }

    if (this.pendingTransition.regime === this.currentRegime) {
      this.pendingTransition = null;
      return false;
    }

    // 조건 1: 적용 유효 시각 이전에는 활성화 금지
    if (this.pendingTransition.effectiveAt > currentStepStartTime) {
      return false;
    }

    // 조건 2: 평가가 수행된 동일 스텝 내에서는 활성화 금지 (스텝 N -> N+1 지연)
    if (this.pendingTransition.decisionStepId >= currentStepId) {
      return false;
    }

    this.transitionId++;
    const fromRegime = this.currentRegime;
    const toRegime = this.pendingTransition.regime;
    const reason = this.pendingTransition.reason;
    const effectiveAt = currentStepStartTime;
    const evaluatedAt = this.pendingTransition.decidedAt;
    const decisionStepId = this.pendingTransition.decisionStepId;
    const metrics = this.pendingTransition.metrics;

    const record: RegimeTransitionRecord = deepFreeze({
      transitionId: this.transitionId,
      evaluatedAt,
      effectiveAt,
      decisionStepId,
      fromRegime,
      toRegime,
      reason,
      metrics,
      details: `Regime shifted from ${fromRegime} to ${toRegime} via ${reason} (evaluatedAt: ${evaluatedAt}, effectiveAt: ${effectiveAt}, stepId: ${decisionStepId})`,
    });

    this.regimeHistory.push(record);
    if (this.regimeHistory.length > this.maxHistoryLimit) {
      this.regimeHistory.shift();
    }

    this.previousRegime = fromRegime;
    this.currentRegime = toRegime;
    this.regimeStartedAt = currentStepStartTime;
    this.lastTransitionReason = reason;
    this.lastTransitionEvaluatedAt = evaluatedAt;

    // pending 클리어
    this.pendingTransition = null;

    return true;
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. 결정론적 국면 평가: 스텝 종료 시 다음 국면 후보 평가 (Pending 등록)
  // ─────────────────────────────────────────────────────────────────

  /**
   * 확정된 이전 스텝의 통계 DTO(RegimeObservation)를 기반으로 다음 국면을 평가합니다.
   * 평가 결과는 즉시 활성화되지 않고 pendingTransition으로 등록되어 다음 스텝 시작 시 적용됩니다.
   *
   * @param obs 확정된 이전 스텝의 관측 지표 (읽기 전용)
   * @param simTime 현재 스텝 시뮬레이션 시각 (epoch ms)
   * @param nextStepEffectiveAt 다음 스텝 시작 예정 시각 (epoch ms)
   * @param decisionStepId 평가가 발생한 스텝 ID
   */
  public evaluateNextRegime(
    obs: Readonly<RegimeObservation>,
    simTime: number,
    nextStepEffectiveAt: number,
    decisionStepId: number = 0
  ): MarketRegime | null {
    if (!obs || typeof obs !== 'object') {
      throw new Error('[MarketStateEngine] RegimeObservation must be a valid object');
    }

    if (typeof simTime !== 'number' || !Number.isFinite(simTime) || simTime < 0) {
      throw new RangeError(`[MarketStateEngine] simTime must be a non-negative finite number: got ${simTime}`);
    }

    if (
      typeof nextStepEffectiveAt !== 'number' ||
      !Number.isFinite(nextStepEffectiveAt) ||
      nextStepEffectiveAt < simTime
    ) {
      throw new RangeError(
        `[MarketStateEngine] nextStepEffectiveAt (${nextStepEffectiveAt}) cannot precede simTime (${simTime})`
      );
    }

    if (typeof decisionStepId !== 'number' || !Number.isInteger(decisionStepId) || decisionStepId < 0) {
      throw new RangeError(
        `[MarketStateEngine] decisionStepId must be a non-negative integer: got ${decisionStepId}`
      );
    }

    if (obs.simulationTime !== simTime) {
      throw new Error(
        `[MarketStateEngine] obs.simulationTime (${obs.simulationTime}) does not match simTime (${simTime})`
      );
    }

    // 관측값 유한수 엄격 검증
    const observationFields: Array<keyof RegimeObservation> = [
      'simulationTime',
      'aggregateReturn',
      'realizedVolatility',
      'turnoverChange',
      'averageSpreadBps',
      'depthChange',
      'uncertainty',
      'emptyBookDurationSeconds',
      'effectiveMacroNewsSignal',
    ];
    for (const field of observationFields) {
      const val = obs[field];
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        throw new RangeError(`[MarketStateEngine] RegimeObservation.${field} must be a finite number: got ${val}`);
      }
    }

    if (obs.realizedVolatility < 0) {
      throw new RangeError(
        `[MarketStateEngine] realizedVolatility must be non-negative: got ${obs.realizedVolatility}`
      );
    }
    if (obs.averageSpreadBps < 0) {
      throw new RangeError(`[MarketStateEngine] averageSpreadBps must be non-negative: got ${obs.averageSpreadBps}`);
    }
    if (obs.emptyBookDurationSeconds < 0) {
      throw new RangeError(
        `[MarketStateEngine] emptyBookDurationSeconds must be non-negative: got ${obs.emptyBookDurationSeconds}`
      );
    }

    if (obs.uncertainty < 0 || obs.uncertainty > 1.0) {
      throw new RangeError(`[MarketStateEngine] uncertainty must be in [0.0, 1.0]: got ${obs.uncertainty}`);
    }

    if (obs.effectiveMacroNewsSignal < -1.0 || obs.effectiveMacroNewsSignal > 1.0) {
      throw new RangeError(
        `[MarketStateEngine] effectiveMacroNewsSignal must be in [-1.0, 1.0]: got ${obs.effectiveMacroNewsSignal}`
      );
    }

    if (obs.crossSectionalDispersion !== undefined) {
      if (
        typeof obs.crossSectionalDispersion !== 'number' ||
        !Number.isFinite(obs.crossSectionalDispersion) ||
        obs.crossSectionalDispersion < 0
      ) {
        throw new RangeError(
          `[MarketStateEngine] crossSectionalDispersion must be a non-negative finite number: got ${obs.crossSectionalDispersion}`
        );
      }
    }

    if (obs.emptyBookStockRatio !== undefined) {
      if (
        typeof obs.emptyBookStockRatio !== 'number' ||
        !Number.isFinite(obs.emptyBookStockRatio) ||
        obs.emptyBookStockRatio < 0 ||
        obs.emptyBookStockRatio > 1.0
      ) {
        throw new RangeError(
          `[MarketStateEngine] emptyBookStockRatio must be a finite number in [0.0, 1.0]: got ${obs.emptyBookStockRatio}`
        );
      }
    }

    // ── 방어 로직 1: 이미 대기 중인 pending 전환이 있으면 다음 스텝 활성화 전까지 새 평가 예약 차단 (덮어쓰기 방지) ──
    if (this.pendingTransition !== null) {
      return null;
    }

    // ── 방어 로직 2: 최소 국면 유지 시간 검사 ──
    const regimeDurationSeconds = Math.max(0, (simTime - this.regimeStartedAt) / 1000);
    if (regimeDurationSeconds < this.config.thresholds.minRegimeDurationSeconds) {
      return null;
    }

    // ── 방어 로직 3: 국면 전환 쿨다운 검사 ──
    const timeSinceLastEvalSeconds = Math.max(0, (simTime - this.lastTransitionEvaluatedAt) / 1000);
    if (this.lastTransitionEvaluatedAt > 0 && timeSinceLastEvalSeconds < this.config.thresholds.regimeCooldownSeconds) {
      return null;
    }

    const th = this.config.thresholds;
    let candidateRegime: MarketRegime | null = null;
    let reason: RegimeTransitionReason | null = null;

    // 진입 및 이탈 임계치 분리값 조회
    const crisisEnterSpread = th.liquidityCrisisEnterSpreadBps ?? th.liquidityCrisisSpreadBpsThreshold ?? 120.0;
    const crisisExitSpread = th.liquidityCrisisExitSpreadBps ?? th.liquidityCrisisRecoverySpreadBps ?? 65.0;
    const crisisEnterDepth = th.liquidityCrisisEnterDepthDrop ?? th.liquidityCrisisDepthDropThreshold ?? -0.45;
    const crisisExitDepth = th.liquidityCrisisExitDepthDrop ?? -0.20;

    const highVolEnter = th.highVolatilityEnterThreshold ?? th.highVolatilityThreshold ?? 0.035;
    const highVolExit = th.highVolatilityExitThreshold ?? th.highVolatilityRecoveryVolatility ?? 0.022;

    // ─────────────────────────────────────────────────────────────────
    // 우선순위 1: 유동성 위기 (LIQUIDITY_CRISIS)
    // ─────────────────────────────────────────────────────────────────
    const isCrisisSpread = obs.averageSpreadBps >= crisisEnterSpread;
    const isCrisisDepthDrop = obs.depthChange <= crisisEnterDepth;
    const isCrisisEmptyBook = obs.emptyBookDurationSeconds >= th.liquidityCrisisEmptyBookDurationSeconds;
    const ratioThreshold = th.emptyBookStockRatioThreshold ?? 0.3;

    if (this.currentRegime === 'LIQUIDITY_CRISIS') {
      // 위기 탈출 히스테리시스: 스프레드가 회복 기준 이하로 안정되고 깊이도 회복되어야 이탈
      const hasRecoveredSpread = obs.averageSpreadBps <= crisisExitSpread;
      const hasRecoveredDepth = obs.depthChange >= crisisExitDepth;
      const minCrisisDuration = th.liquidityCrisisRecoveryMinDurationSeconds ?? 10.0;
      const hasMetMinCrisisDuration = regimeDurationSeconds >= minCrisisDuration;

      // 위기 이탈 조건: 스프레드·깊이 회복과 함께 장부 공백(양측 호가 부재) 종목 비율이 임계값 아래로 확실히 복구되고 누적 지속시간이 0초로 리셋됨.
      // 값이 누락된 경우(undefined/null) 정상 회복으로 오인하지 않고 회복 차단.
      const hasRecoveredEmptyBook =
        typeof obs.emptyBookStockRatio === 'number' &&
        obs.emptyBookStockRatio < ratioThreshold &&
        obs.emptyBookDurationSeconds === 0;

      if (!hasRecoveredSpread || !hasRecoveredDepth || !hasMetMinCrisisDuration || !hasRecoveredEmptyBook) {
        return null; // 위기 유지
      }

      // 위기 탈출 시 변동성 여부에 따라 이동
      if (obs.realizedVolatility >= highVolEnter) {
        candidateRegime = 'HIGH_VOLATILITY';
        reason = 'CRISIS_RECOVERY';
      } else {
        candidateRegime = 'SIDEWAYS';
        reason = 'CRISIS_RECOVERY';
      }
    } else {
      // 위기 진입 경로:
      // 경로 A: 기존 스프레드 확대 + 호가 깊이 급감
      const isSpreadDepthCrisis = isCrisisSpread && isCrisisDepthDrop;
      // 경로 B: 설정된 종목 비율 이상에서 양측 호가가 없고 emptyBookDurationSeconds가 기준 이상 지속
      //        (스프레드 이력이 없거나 평균 스프레드가 대체값(20bps) 등 낮은 경우에도 위기 진입 가능)
      const isBookDroughtCrisis =
        isCrisisEmptyBook &&
        (obs.emptyBookStockRatio === undefined || obs.emptyBookStockRatio >= ratioThreshold);

      if (isSpreadDepthCrisis || isBookDroughtCrisis) {
        candidateRegime = 'LIQUIDITY_CRISIS';
        reason = 'LIQUIDITY_DROUGHT';
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // 우선순위 2: 고변동성 (HIGH_VOLATILITY)
    // ─────────────────────────────────────────────────────────────────
    if (!candidateRegime) {
      const isHighVol = obs.realizedVolatility >= highVolEnter;
      const isHighUncertainty = obs.uncertainty >= th.highVolatilityUncertaintyThreshold;

      if (this.currentRegime === 'HIGH_VOLATILITY') {
        // 고변동성 이탈 히스테리시스: 회복 임계치(highVolExit) 이하로 확실히 안정화되어야 이탈
        const hasRecoveredVol = obs.realizedVolatility <= highVolExit;
        if (!hasRecoveredVol) {
          return null; // 고변동성 유지
        }
      } else if (isHighVol || isHighUncertainty) {
        candidateRegime = 'HIGH_VOLATILITY';
        reason = 'VOLATILITY_SURGE';
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // 우선순위 3: 상승장 (BULL) 또는 하락장 (BEAR)
    // ─────────────────────────────────────────────────────────────────
    if (!candidateRegime) {
      const isBullReturn = obs.aggregateReturn >= th.bullReturnThreshold;
      const isBullTurnover = obs.turnoverChange >= th.bullTurnoverChangeThreshold;
      const isBullMacro = obs.effectiveMacroNewsSignal >= th.bullMacroSignalThreshold;

      const isBearReturn = obs.aggregateReturn <= th.bearReturnThreshold;
      const isBearTurnover = obs.turnoverChange >= th.bearTurnoverChangeThreshold;
      const isBearMacro = obs.effectiveMacroNewsSignal <= th.bearMacroSignalThreshold;

      const isBullQualified = isBullReturn && (isBullTurnover || isBullMacro);
      const isBearQualified = isBearReturn && (isBearTurnover || isBearMacro);

      if (isBullQualified && !isBearQualified) {
        candidateRegime = 'BULL';
        reason = 'BULLISH_FLOW';
      } else if (isBearQualified && !isBullQualified) {
        candidateRegime = 'BEAR';
        reason = 'BEARISH_FLOW';
      } else if (isBullQualified && isBearQualified) {
        // 모순/경합 신호 시 결정론적 PRNG로 tie-breaking
        const tieBreaker = this.prng.next();
        if (tieBreaker >= 0.5) {
          candidateRegime = 'BULL';
          reason = 'BULLISH_FLOW';
        } else {
          candidateRegime = 'BEAR';
          reason = 'BEARISH_FLOW';
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // 우선순위 4: 횡보장 (SIDEWAYS)
    // ─────────────────────────────────────────────────────────────────
    if (!candidateRegime) {
      const isSidewaysReturn = Math.abs(obs.aggregateReturn) <= th.sidewaysReturnAbsBound;
      const isSidewaysVol = obs.realizedVolatility <= th.sidewaysVolatilityBound;

      if (isSidewaysReturn && isSidewaysVol) {
        candidateRegime = 'SIDEWAYS';
        reason = 'RANGE_STABILIZATION';
      }
    }

    // ── 방어 로직 4: 동일 국면으로의 무의미한 전환 차단 ──
    if (!candidateRegime || candidateRegime === this.currentRegime) {
      return null;
    }

    const metrics: RegimeTransitionMetrics = deepFreeze({
      aggregateReturn: obs.aggregateReturn,
      realizedVolatility: obs.realizedVolatility,
      crossSectionalDispersion: obs.crossSectionalDispersion,
      turnoverChange: obs.turnoverChange,
      averageSpreadBps: obs.averageSpreadBps,
      depthChange: obs.depthChange,
      uncertainty: obs.uncertainty,
      emptyBookDurationSeconds: obs.emptyBookDurationSeconds,
      emptyBookStockRatio: obs.emptyBookStockRatio,
      effectiveMacroNewsSignal: obs.effectiveMacroNewsSignal,
    });

    const finalReason: RegimeTransitionReason = reason ?? 'RANGE_STABILIZATION';

    // 다음 스텝 적용을 위해 pendingTransition으로 등록
    this.pendingTransition = deepFreeze({
      regime: candidateRegime,
      decidedAt: simTime,
      effectiveAt: nextStepEffectiveAt,
      decisionStepId,
      reason: finalReason,
      metrics,
    });

    return candidateRegime;
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. 원자적 상태 스냅샷 게시 및 순수 읽기 전용 조회
  // ─────────────────────────────────────────────────────────────────

  /**
   * 스텝의 모든 상태 변경(pending 활성화, 세션 전진, 국면 평가)이 완료된 후
   * 완성된 불변 스냅샷을 생성하여 단일 참조 교체(atomic reference swap)로 게시합니다.
   * 비동기 await 도중 불완전한 중간 상태가 노출되지 않도록 보장합니다.
   */
  public publishSnapshot(simTime: number): Readonly<MarketStateSnapshot> {
    this.stateVersion++;

    const durationSec = Math.max(0, (simTime - this.regimeStartedAt) / 1000);
    const params = DEFAULT_REGIME_PARAMETERS[this.currentRegime];

    const elapsedMs = simTime - this.tradingDayAnchorMs;
    const timeWithinDayMs = ((elapsedMs % this.tradingDayDurationMs) + this.tradingDayDurationMs) % this.tradingDayDurationMs;
    const tradingDayIndex = Math.max(0, Math.floor(elapsedMs / this.tradingDayDurationMs));
    const tradingDayStartedAt = simTime - timeWithinDayMs;

    const snapshot: MarketStateSnapshot = deepFreeze({
      stateVersion: this.stateVersion,
      simulationTime: simTime,

      regime: this.currentRegime,
      previousRegime: this.previousRegime,
      regimeStartedAt: this.regimeStartedAt,
      regimeDurationSeconds: durationSec,

      session: this.currentSession,
      sessionStartedAt: this.sessionStartedAt,
      nextSession: this.nextSession,
      nextTransitionAt: this.nextTransitionAt,

      tradingDayIndex,
      tradingDayStartedAt,

      pendingRegime: this.pendingTransition?.regime ?? null,
      pendingRegimeEffectiveAt: this.pendingTransition?.effectiveAt ?? null,

      transitionId: this.transitionId,
      transitionReason: this.lastTransitionReason,
      parameters: params,

      implementationStage: 1,
      marketMechanicsApplied: false,
      capabilities: {
        regimeDetection: true,
        sessionTracking: true,
        botBehaviorAdjustment: false,
        lpAdjustment: false,
        auctionMatching: false,
        sessionOrderRestriction: false,
      },
    });

    // 단일 참조 교체: 읽기 스레드는 항상 완전히 완성된 최신 스냅샷만 관측함
    this.publishedSnapshot = snapshot;
    return this.publishedSnapshot;
  }

  /**
   * 순수 읽기 전용 상태 스냅샷 조회
   * - 시계, PRNG, 상태, 이력에 일절 부작용 없음
   * - deepClone 및 deepFreeze를 통해 호출자가 반환 객체를 변조해도 내부 상태 완벽 보존
   * - 완성되지 않은 중간 상태를 반환하지 않고 마지막으로 원자적으로 게시된 스냅샷 반환
   */
  public getSnapshot(_currentSimTime?: number): Readonly<MarketStateSnapshot> {
    return deepFreeze(deepClone(this.publishedSnapshot));
  }

  public getRegimeParameters(): Readonly<MarketRegimeParameters> {
    return DEFAULT_REGIME_PARAMETERS[this.currentRegime];
  }

  public getRegimeHistory(): readonly RegimeTransitionRecord[] {
    return deepFreeze(deepClone(this.regimeHistory));
  }

  public getSessionHistory(): readonly SessionTransitionRecord[] {
    return deepFreeze(deepClone(this.sessionHistory));
  }

  public getPendingTransition(): Readonly<PendingRegimeTransition> | null {
    return this.pendingTransition ? deepFreeze(deepClone(this.pendingTransition)) : null;
  }

  public getThresholds(): Readonly<RegimeThresholdConfig> {
    return deepFreeze(deepClone(this.config.thresholds));
  }

  // ─────────────────────────────────────────────────────────────────
  // 5. 시뮬레이션 리셋 복원
  // ─────────────────────────────────────────────────────────────────

  public reset(initialEpochMs: number = 1773500000000, seed?: number): void {
    const effectiveSeed = seed ?? this.initialSeed;
    const regimeSeed = deriveDeterministicSeed(effectiveSeed, 'market-regime-v1');
    this.prng = new SimPrng(regimeSeed);

    this.currentRegime = this.config.initialRegime;
    this.previousRegime = null;
    this.regimeStartedAt = initialEpochMs;
    this.transitionId = 0;
    this.lastTransitionReason = null;
    this.lastTransitionEvaluatedAt = 0;

    this.pendingTransition = null;

    const sessionCalc = this.calculateSessionAtTime(initialEpochMs);
    this.currentSession = sessionCalc.session;
    this.sessionStartedAt = sessionCalc.sessionStartedAt;
    this.nextSession = sessionCalc.nextSession;
    this.nextTransitionAt = sessionCalc.nextTransitionAt;
    this.sessionTransitionId = 0;
    this.lastProcessedBoundaryMs = -1;

    this.regimeHistory = [];
    this.sessionHistory = [];

    // 리셋 후 초기 완성 스냅샷 원자적 재게시
    this.publishSnapshot(initialEpochMs);
  }
}
