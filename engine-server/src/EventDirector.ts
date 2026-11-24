import './loadEnv';
import type { MarketEngine } from './MarketEngine';
import type { MarketEvent } from './types';
import { EventBus } from './EventBus';
import { NewsGenerator, NewsItem } from './services/NewsGenerator';
import {
  SimulationContext,
  SimulationRandomSource,
  SIMULATION_NAMESPACES
} from '../../lib/engine/simulation/runtime';
import { SerialExecutionQueue } from '../../lib/engine/simulation/executionQueue';
import {
  persistenceManager,
  PersistenceManager,
  runWithCommitGate
} from '../../lib/memoryDb/PersistenceManager';
import type { EventRepository } from '../../lib/repositories/eventRepository';
import type { MarketNewsRecord } from '../../lib/repositories/types';

/** simulation clock 기준 due-time 작업을 보관하는 큐 항목 */
interface ScheduledCorrection {
  readonly dueSimulationTime: number;
  readonly rumor: NewsItem;
  correctionId?: string;
}

export interface EventDirectorOptions {
  onPersist?: () => Promise<boolean>;
  persistence?: PersistenceManager;
  epoch?: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class EventDirector {
  public static readonly CORRECTION_DELAY_MS = 4 * 60 * 1000;
  private engine: MarketEngine;
  private isRunning: boolean = false;
  private isTicking: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private newsGenerator: NewsGenerator;
  private readonly random: SimulationRandomSource;
  private readonly context: SimulationContext;
  private readonly eventRepository: EventRepository;
  private readonly onPersist?: () => Promise<boolean>;
  private readonly persistence?: PersistenceManager;
  private readonly epoch: number;
  private readonly executionQueue = new SerialExecutionQueue();
  private hasRestoredPendingCorrections = false;
  private restorePendingPromise: Promise<number> | null = null;
  /**
   * 정정 뉴스 due-time 큐.
   * 실제 setTimeout을 사용하지 않고 simulation clock 도달 여부로 처리한다.
   */
  private pendingCorrections: ScheduledCorrection[] = [];
  /** 결정론적 ID 카운터 (namespace별) */
  private newsIdCounter = 0;
  private marketEventIdCounter = 0;
  private readonly knownNewsIds = new Set<string>();

  constructor(
    engine: MarketEngine,
    context?: SimulationContext,
    eventRepository?: EventRepository,
    newsGenerator?: NewsGenerator,
    options?: EventDirectorOptions
  ) {
    const resolvedContext = context || engine?.simulationContext;
    if (!resolvedContext) {
      throw new Error("[EventDirector] Explicit SimulationContext is required. Pass context or ensure engine.simulationContext is defined.");
    }
    this.context = resolvedContext;

    const resolvedRepo = eventRepository || (engine as any)?.repositories?.event;
    if (!resolvedRepo) {
      throw new Error("[EventDirector] Explicit EventRepository is required. Pass eventRepository or ensure engine has repositories configured.");
    }
    this.eventRepository = resolvedRepo;
    this.onPersist = options?.onPersist;
    this.persistence =
      options?.persistence ||
      ((this.onPersist as any)?.__persistenceManager as PersistenceManager | undefined) ||
      ((engine as any)?.customPersistence &&
      typeof (engine as any).customPersistence.withCommitGate === 'function'
        ? ((engine as any).customPersistence as PersistenceManager)
        : undefined) ||
      (((engine as any)?.onTickCommitPersist as any)?.__persistenceManager as PersistenceManager | undefined);

    const repoDb = (engine as any)?.repositories?.markets?.getDatabase?.();
    const dbEpoch =
      typeof repoDb?.engineNextEpoch === 'number' &&
      Number.isFinite(repoDb.engineNextEpoch) &&
      repoDb.engineNextEpoch >= 1
        ? repoDb.engineNextEpoch
        : 1;
    this.epoch =
      typeof options?.epoch === 'number' && Number.isFinite(options.epoch) && options.epoch >= 1
        ? options.epoch
        : dbEpoch;

    this.engine = engine;
    // tracker가 적용되는 API(context.fork)를 사용해 namespace 충돌을 감지한다.
    this.random = this.context.fork(SIMULATION_NAMESPACES.EVENT_DIRECTOR.NEWS_SCHEDULE);
    this.newsGenerator = newsGenerator || new NewsGenerator(this.context);

    if (typeof this.eventRepository.getMarketNewsSync === 'function') {
      const records = this.eventRepository.getMarketNewsSync();
      this.syncKnownNewsFromRecords(records);
      this.applyRestoredCorrections(records);
      this.hasRestoredPendingCorrections = true;
    }
  }

  private getCommitGatePersistence(): PersistenceManager | undefined {
    if (this.persistence) return this.persistence;
    if (this.onPersist) {
      return ((this.onPersist as any).__persistenceManager as PersistenceManager | undefined) || persistenceManager;
    }
    return persistenceManager;
  }

  private syncKnownNewsFromRecords(records: readonly MarketNewsRecord[]): void {
    if (!Array.isArray(records)) return;
    const escapedRunId = escapeRegExp(this.context.runId);
    const idPattern = new RegExp(`^news_${escapedRunId}_(?:e\\d+_)?[a-zA-Z0-9]+_(\\d+)$`);
    for (const record of records) {
      if (!record || typeof record.id !== 'string' || !record.id) continue;
      this.knownNewsIds.add(record.id);
      const match = idPattern.exec(record.id);
      if (match) {
        const seq = Number(match[1]);
        if (Number.isFinite(seq) && seq > this.newsIdCounter) {
          this.newsIdCounter = seq;
        }
      }
    }
  }

  /** 결정론적 뉴스 ID (seed + epoch + sequence 기반, UUID/timestamp 금지) */
  private nextNewsId(kind: string): string {
    if (typeof this.eventRepository.getMarketNewsSync === 'function') {
      this.syncKnownNewsFromRecords(this.eventRepository.getMarketNewsSync());
    }
    const epochSegment = this.epoch > 1 ? `e${this.epoch}_` : '';
    let candidate = '';
    do {
      this.newsIdCounter += 1;
      candidate = `news_${this.context.runId}_${epochSegment}${kind}_${this.newsIdCounter}`;
    } while (this.knownNewsIds.has(candidate));
    return candidate;
  }

  /** 결정론적 시장 이벤트 ID */
  private nextMarketEventId(kind: string): string {
    const epochSegment = this.epoch > 1 ? `e${this.epoch}_` : '';
    this.marketEventIdCounter += 1;
    return `mevt_${this.context.runId}_${epochSegment}${kind}_${this.marketEventIdCounter}`;
  }

  public getEventRepository(): EventRepository {
    return this.eventRepository;
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("🎬 Event Director Started (Monitoring AI News & Macro Calendar...)");
    
    // 5분(300000ms) 주기 뉴스트리거 및 매 1분 스케줄링 체크
    this.timer = setInterval(() => this.tickMinute(), 60 * 1000);
  }

  public stop() {
    this.isRunning = false;
    if (this.timer) clearInterval(this.timer);
    console.log("🛑 Event Director Stopped.");
  }

  private minuteCounter: number = 0;

  private async tickMinute() {
    if (this.isTicking) return;
    this.isTicking = true;
    try {
      this.minuteCounter++;

      // 0. simulation clock이 도달한 정정 뉴스를 먼저 처리한다 (벽시계 timer 대기 없음)
      await this.processDueCorrections();

      // 1. 매 5분마다 Gemini AI 뉴스 생성 (또는 5% 무작위 확률)
      if (this.minuteCounter % 5 === 0 || this.random.nextBoolean(0.05)) {
        await this.triggerEndogenousNews();
      }
    } finally {
      this.isTicking = false;
    }
  }

  public async triggerEndogenousNews(): Promise<NewsItem | null> {
    return this.executionQueue.run(() => this.triggerEndogenousNewsInternal());
  }

  private async triggerEndogenousNewsInternal(): Promise<NewsItem | null> {
    try {
      console.log("📰 [EventDirector] Generating endogenous AI news via Gemini...");
      await this.restorePendingCorrectionsInternal();

      const marketState = this.engine ? this.engine.getMarketState() : {};
      const newsItem = await this.newsGenerator.generateNews(marketState);
      const publishedAtMs = this.context.clock.now();
      const requestedId = newsItem.id;
      const newsId =
        requestedId && !this.knownNewsIds.has(requestedId)
          ? requestedId
          : this.nextNewsId('gen');
      const persistedNewsItem: NewsItem = { ...newsItem, id: newsId };
      const isFakeRumor = persistedNewsItem.category === 'RUMOR' && Boolean(persistedNewsItem.is_fake);
      const correctionDueSimulationTime = isFakeRumor
        ? publishedAtMs + EventDirector.CORRECTION_DELAY_MS
        : undefined;

      // 1. 공유 커밋 게이트 내에서 EventRepository 저장 + 스냅샷 영속화 (실패 시 임시 뉴스 즉시 제거)
      await runWithCommitGate(
        this.onPersist,
        async () => {
          await this.eventRepository.saveMarketNews({
            id: newsId,
            type: persistedNewsItem.type,
            category: (persistedNewsItem.category as any) || 'OFFICIAL',
            publisher: persistedNewsItem.publisher,
            title: persistedNewsItem.title,
            content: persistedNewsItem.content,
            target_sector: persistedNewsItem.target_sector || null,
            target_ticker: persistedNewsItem.target_ticker || null,
            impact_score: persistedNewsItem.impact_score || 0,
            is_fake: persistedNewsItem.is_fake || false,
            simulation_time: publishedAtMs,
            created_at: new Date(publishedAtMs).toISOString(),
            ...(correctionDueSimulationTime !== undefined
              ? { correction_due_simulation_time: correctionDueSimulationTime }
              : {}),
          });

          if (this.onPersist) {
            let saved = false;
            try {
              saved = await this.onPersist();
            } catch (persistErr) {
              if (typeof this.eventRepository.removeMarketNews === 'function') {
                await this.eventRepository.removeMarketNews(newsId).catch(() => {});
              }
              throw persistErr;
            }
            if (!saved) {
              if (typeof this.eventRepository.removeMarketNews === 'function') {
                await this.eventRepository.removeMarketNews(newsId).catch(() => {});
              }
              throw new Error('Failed to persist market news snapshot');
            }
          }
        },
        this.getCommitGatePersistence()
      );

      this.knownNewsIds.add(newsId);

      console.log(`📡 [NewsPublished] [${persistedNewsItem.category}] (${persistedNewsItem.publisher}) ${persistedNewsItem.title} (Impact: ${persistedNewsItem.impact_score})`);

      // 2. EventBus로 news_published 이벤트 브로드캐스팅 (봇들이 즉각 리스닝)
      EventBus.publish('news_published', persistedNewsItem);

      // 3. 엔진 호가창에 MarketEvent 주입 (기존 호가 임팩트 연동)
      const marketEvent: MarketEvent = {
        id: this.nextMarketEventId('news'),
        targetSector: persistedNewsItem.target_sector || 'ALL',
        impact: persistedNewsItem.impact_score > 4 ? 'STRONG_POSITIVE' : (persistedNewsItem.impact_score > 0 ? 'POSITIVE' : (persistedNewsItem.impact_score < -4 ? 'STRONG_NEGATIVE' : 'NEGATIVE')),
        urgencyMultiplier: Math.min(3.0, 1.0 + Math.abs(persistedNewsItem.impact_score) / 5.0),
        durationTicks: 120
      };
      this.engine.injectEvent(marketEvent);

      // 4. 찌라시(RUMOR)이면서 가짜 뉴스(is_fake)일 경우 정정 보도 스케줄링 (4분 뒤)
      if (isFakeRumor && correctionDueSimulationTime !== undefined) {
        this.scheduleCorrection(persistedNewsItem, correctionDueSimulationTime);
      }

      return persistedNewsItem;
    } catch (e: any) {
      console.error("❌ [EventDirector] Endogenous news trigger failed:", e.message);
      return null;
    }
  }

  private static getNewsTimestampMs(record: MarketNewsRecord): number {
    if (typeof record.simulation_time === 'number' && Number.isFinite(record.simulation_time)) {
      return record.simulation_time;
    }
    const parsed = Date.parse(record.created_at ?? '');
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  private static findUncorrectedFakeRumors(records: readonly MarketNewsRecord[]): MarketNewsRecord[] {
    const fakeRumors: MarketNewsRecord[] = [];
    const corrections: MarketNewsRecord[] = [];

    for (const r of records) {
      if (!r) continue;
      if (r.category === 'RUMOR' && r.is_fake === true) {
        fakeRumors.push(r);
      } else if (r.category === 'CORRECTION') {
        corrections.push(r);
      }
    }

    const matchedRumorIndices = new Set<number>();
    const consumedCorrectionIndices = new Set<number>();

    // Pass 1: Explicit original_rumor_id matching
    corrections.forEach((corr, corrIdx) => {
      if (!corr.original_rumor_id) return;
      let matchedAny = false;
      fakeRumors.forEach((rumor, rumorIdx) => {
        if (rumor.id && rumor.id === corr.original_rumor_id) {
          matchedRumorIndices.add(rumorIdx);
          matchedAny = true;
        }
      });
      if (matchedAny) {
        consumedCorrectionIndices.add(corrIdx);
      }
    });

    // Pass 2: Legacy corrections without original_rumor_id -> strict 1:1 matching
    const legacyCorrectionIndices = corrections
      .map((_, idx) => idx)
      .filter((idx) => !consumedCorrectionIndices.has(idx) && !corrections[idx].original_rumor_id)
      .sort((a, b) => {
        const ta = EventDirector.getNewsTimestampMs(corrections[a]);
        const tb = EventDirector.getNewsTimestampMs(corrections[b]);
        if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
        return a - b;
      });

    for (const corrIdx of legacyCorrectionIndices) {
      const corr = corrections[corrIdx];
      if (!corr.title || typeof corr.title !== 'string') continue;
      const corrTime = EventDirector.getNewsTimestampMs(corr);

      let bestRumorIdx = -1;
      let bestDelta = Infinity;
      let bestRumorTime = Infinity;

      for (let rIdx = 0; rIdx < fakeRumors.length; rIdx++) {
        if (matchedRumorIndices.has(rIdx)) continue;
        const rumor = fakeRumors[rIdx];
        if (!rumor.title || !corr.title.includes(rumor.title)) continue;

        const rumorTime = EventDirector.getNewsTimestampMs(rumor);
        if (Number.isFinite(rumorTime) && Number.isFinite(corrTime) && corrTime < rumorTime) {
          continue;
        }

        const delta =
          Number.isFinite(rumorTime) && Number.isFinite(corrTime)
            ? Math.abs(rumorTime + EventDirector.CORRECTION_DELAY_MS - corrTime)
            : 0;
        const normalizedTime = Number.isFinite(rumorTime) ? rumorTime : Infinity;

        if (
          bestRumorIdx === -1 ||
          delta < bestDelta ||
          (delta === bestDelta && normalizedTime < bestRumorTime)
        ) {
          bestRumorIdx = rIdx;
          bestDelta = delta;
          bestRumorTime = normalizedTime;
        }
      }

      if (bestRumorIdx >= 0) {
        matchedRumorIndices.add(bestRumorIdx);
        consumedCorrectionIndices.add(corrIdx);
      }
    }

    return fakeRumors.filter((_, idx) => !matchedRumorIndices.has(idx));
  }

  private applyRestoredCorrections(records: readonly MarketNewsRecord[]): number {
    if (!Array.isArray(records) || records.length === 0) return 0;

    this.syncKnownNewsFromRecords(records);
    const uncorrectedRumors = EventDirector.findUncorrectedFakeRumors(records);
    let restoredCount = 0;

    for (const record of uncorrectedRumors) {
      const alreadyScheduled = this.pendingCorrections.some(
        (c) => (record.id && c.rumor.id === record.id) ||
               (!record.id && c.rumor.title === record.title && c.dueSimulationTime === record.correction_due_simulation_time)
      );
      if (alreadyScheduled) continue;

      let dueSimulationTime: number | null = null;
      if (
        typeof record.correction_due_simulation_time === 'number' &&
        Number.isFinite(record.correction_due_simulation_time)
      ) {
        dueSimulationTime = record.correction_due_simulation_time;
      } else {
        const baseTime = EventDirector.getNewsTimestampMs(record);
        if (Number.isFinite(baseTime)) {
          dueSimulationTime = baseTime + EventDirector.CORRECTION_DELAY_MS;
        }
      }

      if (dueSimulationTime === null) continue;

      this.pendingCorrections.push({
        dueSimulationTime,
        rumor: {
          id: record.id,
          created_at: record.created_at,
          type: (record.type === 'MACRO' || record.type === 'MICRO' ? record.type : 'MICRO'),
          category: 'RUMOR',
          publisher: record.publisher,
          title: record.title,
          content: record.content,
          target_sector: record.target_sector ?? null,
          target_ticker: record.target_ticker ?? null,
          impact_score: typeof record.impact_score === 'number' ? record.impact_score : 0,
          is_fake: true,
        },
      });
      restoredCount++;
    }

    return restoredCount;
  }

  /**
   * 저장된 가짜 뉴스 원문과 예정 시각으로부터 미발행 정정 예약을 복원한다.
   */
  public async restorePendingCorrections(): Promise<number> {
    if (this.hasRestoredPendingCorrections) {
      return this.pendingCorrections.length;
    }
    return this.executionQueue.run(() => this.restorePendingCorrectionsInternal());
  }

  private async restorePendingCorrectionsInternal(): Promise<number> {
    if (this.hasRestoredPendingCorrections) {
      return this.pendingCorrections.length;
    }
    if (this.restorePendingPromise) {
      return this.restorePendingPromise;
    }

    this.restorePendingPromise = (async () => {
      try {
        const records = await this.eventRepository.getRecentMarketNews(200);
        this.applyRestoredCorrections(records);
        this.hasRestoredPendingCorrections = true;
        return this.pendingCorrections.length;
      } finally {
        this.restorePendingPromise = null;
      }
    })();

    return this.restorePendingPromise;
  }

  /**
   * 정정 뉴스 예약: 실제 setTimeout 대신 simulation clock due-time 큐에 넣는다.
   * dueSimulationTime = 현재 simulation 시각 + 4분 (또는 전달된 예정 시각)
   */
  private scheduleCorrection(rumor: NewsItem, dueSimulationTime?: number): void {
    const resolvedDueTime = dueSimulationTime ?? (this.context.clock.now() + EventDirector.CORRECTION_DELAY_MS);
    console.log(
      `🕒 [EventDirector] Scheduled correction for fake rumor [${rumor.title}] at simulation time ${resolvedDueTime}.`
    );
    this.pendingCorrections.push({ dueSimulationTime: resolvedDueTime, rumor });
  }

  /**
   * simulation clock이 도달한 정정 뉴스를 실행한다.
   * tick()/tickMinute()에서 호출되며, 테스트는 clock만 전진시키면 된다.
   * 동시 호출은 직렬화 큐로 보호하며, 저장 실패 시 큐에서 제거하지 않아 다음 호출에서 안전하게 재시도한다.
   */
  public async processDueCorrections(): Promise<number> {
    return this.executionQueue.run(() => this.processDueCorrectionsInternal());
  }

  private async processDueCorrectionsInternal(): Promise<number> {
    await this.restorePendingCorrectionsInternal();

    const now = this.context.clock.now();
    const due = this.pendingCorrections.filter((c) => c.dueSimulationTime <= now);
    if (due.length === 0) return 0;

    let publishedCount = 0;

    for (const item of due) {
      const correctionId =
        item.correctionId && !this.knownNewsIds.has(item.correctionId)
          ? item.correctionId
          : this.nextNewsId('corr');
      item.correctionId = correctionId;

      try {
        console.log(`🚨 [EventDirector] Executing Scheduled Correction News for [${item.rumor.title}]!`);
        const correctionNews: NewsItem = {
          ...this.newsGenerator.generateCorrection(item.rumor),
          id: correctionId,
          original_rumor_id: item.rumor.id || null,
        };

        await runWithCommitGate(
          this.onPersist,
          async () => {
            await this.eventRepository.saveMarketNews({
              id: correctionId,
              type: correctionNews.type,
              category: (correctionNews.category as any) || 'CORRECTION',
              publisher: correctionNews.publisher,
              title: correctionNews.title,
              content: correctionNews.content,
              target_sector: correctionNews.target_sector || null,
              target_ticker: correctionNews.target_ticker || null,
              impact_score: correctionNews.impact_score || 0,
              is_fake: false,
              original_rumor_id: item.rumor.id || null,
              simulation_time: now,
              created_at: new Date(now).toISOString(),
            });

            if (this.onPersist) {
              let saved = false;
              try {
                saved = await this.onPersist();
              } catch (persistErr) {
                if (typeof this.eventRepository.removeMarketNews === 'function') {
                  await this.eventRepository.removeMarketNews(correctionId).catch(() => {});
                }
                throw persistErr;
              }
              if (!saved) {
                if (typeof this.eventRepository.removeMarketNews === 'function') {
                  await this.eventRepository.removeMarketNews(correctionId).catch(() => {});
                }
                throw new Error('Correction news snapshot save failed');
              }
            }
          },
          this.getCommitGatePersistence()
        );

        // 영속 저장 성공 확정 후에만 큐에서 제거하고 외부에 브로드캐스트한다.
        this.knownNewsIds.add(correctionId);
        this.pendingCorrections = this.pendingCorrections.filter((c) => c !== item);

        EventBus.publish('news_published', correctionNews);

        const reverseMarketEvent: MarketEvent = {
          id: this.nextMarketEventId('corr'),
          targetSector: correctionNews.target_sector || 'ALL',
          impact: correctionNews.impact_score > 0 ? 'STRONG_POSITIVE' : 'STRONG_NEGATIVE',
          urgencyMultiplier: 3.0,
          durationTicks: 180
        };
        this.engine.injectEvent(reverseMarketEvent);
        publishedCount++;
      } catch (err: any) {
        console.error("❌ Correction news execution failed (will retry):", err.message);
      }
    }
    return publishedCount;
  }

  /** 현재 예약된 정정_news 수 (테스트/진단용) */
  public getPendingCorrectionCount(): number {
    return this.pendingCorrections.length;
  }
}
