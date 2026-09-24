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
import type { EventRepository } from '../../lib/repositories/eventRepository';

/** simulation clock 기준 due-time 작업을 보관하는 큐 항목 */
interface ScheduledCorrection {
  readonly dueSimulationTime: number;
  readonly rumor: NewsItem;
}

export class EventDirector {
  private engine: MarketEngine;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private newsGenerator: NewsGenerator;
  private readonly random: SimulationRandomSource;
  private readonly context: SimulationContext;
  private readonly eventRepository: EventRepository;
  /**
   * 정정 뉴스 due-time 큐.
   * 실제 setTimeout을 사용하지 않고 simulation clock 도달 여부로 처리한다.
   */
  private pendingCorrections: ScheduledCorrection[] = [];
  /** 결정론적 ID 카운터 (namespace별) */
  private newsIdCounter = 0;
  private marketEventIdCounter = 0;

  constructor(
    engine: MarketEngine,
    context?: SimulationContext,
    eventRepository?: EventRepository,
    newsGenerator?: NewsGenerator
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

    this.engine = engine;
    // tracker가 적용되는 API(context.fork)를 사용해 namespace 충돌을 감지한다.
    this.random = this.context.fork(SIMULATION_NAMESPACES.EVENT_DIRECTOR.NEWS_SCHEDULE);
    this.newsGenerator = newsGenerator || new NewsGenerator(this.context);
  }

  /** 결정론적 뉴스 ID (seed + sequence 기반, UUID/timestamp 금지) */
  private nextNewsId(kind: string): string {
    this.newsIdCounter += 1;
    return `news_${this.context.runId}_${kind}_${this.newsIdCounter}`;
  }

  /** 결정론적 시장 이벤트 ID */
  private nextMarketEventId(kind: string): string {
    this.marketEventIdCounter += 1;
    return `mevt_${this.context.runId}_${kind}_${this.marketEventIdCounter}`;
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
    this.minuteCounter++;

    // 0. simulation clock이 도달한 정정 뉴스를 먼저 처리한다 (벽시계 timer 대기 없음)
    await this.processDueCorrections();

    // 1. 매 5분마다 Gemini AI 뉴스 생성 (또는 5% 무작위 확률)
    if (this.minuteCounter % 5 === 0 || this.random.nextBoolean(0.05)) {
      await this.triggerEndogenousNews();
    }
  }

  public async triggerEndogenousNews(): Promise<NewsItem | null> {
    try {
      console.log("📰 [EventDirector] Generating endogenous AI news via Gemini...");
      
      const marketState = this.engine ? this.engine.getMarketState() : {};
      const newsItem = await this.newsGenerator.generateNews(marketState);

      // 1. EventRepository에 저장 (결정론적 ID)
      await this.eventRepository.saveMarketNews({
        id: newsItem.id || this.nextNewsId('gen'),
        type: newsItem.type,
        category: (newsItem.category as any) || 'OFFICIAL',
        publisher: newsItem.publisher,
        title: newsItem.title,
        content: newsItem.content,
        target_sector: newsItem.target_sector || null,
        target_ticker: newsItem.target_ticker || null,
        impact_score: newsItem.impact_score || 0,
        is_fake: newsItem.is_fake || false,
        simulation_time: this.context.clock.now(),
        created_at: new Date(this.context.clock.now()).toISOString(),
      });

      console.log(`📡 [NewsPublished] [${newsItem.category}] (${newsItem.publisher}) ${newsItem.title} (Impact: ${newsItem.impact_score})`);

      // 2. EventBus로 news_published 이벤트 브로드캐스팅 (봇들이 즉각 리스닝)
      EventBus.publish('news_published', newsItem);

      // 3. 엔진 호가창에 MarketEvent 주입 (기존 호가 임팩트 연동)
      const marketEvent: MarketEvent = {
        id: this.nextMarketEventId('news'),
        targetSector: newsItem.target_sector || 'ALL',
        impact: newsItem.impact_score > 4 ? 'STRONG_POSITIVE' : (newsItem.impact_score > 0 ? 'POSITIVE' : (newsItem.impact_score < -4 ? 'STRONG_NEGATIVE' : 'NEGATIVE')),
        urgencyMultiplier: Math.min(3.0, 1.0 + Math.abs(newsItem.impact_score) / 5.0),
        durationTicks: 120
      };
      this.engine.injectEvent(marketEvent);

      // 4. 찌라시(RUMOR)이면서 가짜 뉴스(is_fake)일 경우 정정 보도 스케줄링 (4분 뒤)
      if (newsItem.category === 'RUMOR' && newsItem.is_fake) {
        this.scheduleCorrection(newsItem);
      }

      return newsItem;
    } catch (e: any) {
      console.error("❌ [EventDirector] Endogenous news trigger failed:", e.message);
      return null;
    }
  }

  /**
   * 정정 뉴스 예약: 실제 setTimeout 대신 simulation clock due-time 큐에 넣는다.
   * dueSimulationTime = 현재 simulation 시각 + 4분
   */
  private scheduleCorrection(rumor: NewsItem): void {
    const delayMs = 4 * 60 * 1000;
    const dueSimulationTime = this.context.clock.now() + delayMs;
    console.log(
      `🕒 [EventDirector] Scheduled correction for fake rumor [${rumor.title}] at simulation time ${dueSimulationTime}.`
    );
    this.pendingCorrections.push({ dueSimulationTime, rumor });
  }

  /**
   * simulation clock이 도달한 정정 뉴스를 실행한다.
   * tick()/tickMinute()에서 호출되며, 테스트는 clock만 전진시키면 된다.
   */
  public async processDueCorrections(): Promise<number> {
    const now = this.context.clock.now();
    const due = this.pendingCorrections.filter((c) => c.dueSimulationTime <= now);
    if (due.length === 0) return 0;

    this.pendingCorrections = this.pendingCorrections.filter((c) => c.dueSimulationTime > now);

    for (const item of due) {
      try {
        console.log(`🚨 [EventDirector] Executing Scheduled Correction News for [${item.rumor.title}]!`);
        const correctionNews = this.newsGenerator.generateCorrection(item.rumor);

        await this.eventRepository.saveMarketNews({
          id: correctionNews.id || this.nextNewsId('corr'),
          type: correctionNews.type,
          category: (correctionNews.category as any) || 'CORRECTION',
          publisher: correctionNews.publisher,
          title: correctionNews.title,
          content: correctionNews.content,
          target_sector: correctionNews.target_sector || null,
          target_ticker: correctionNews.target_ticker || null,
          impact_score: correctionNews.impact_score || 0,
          is_fake: false,
          simulation_time: this.context.clock.now(),
          created_at: new Date(this.context.clock.now()).toISOString(),
        });

        EventBus.publish('news_published', correctionNews);

        const reverseMarketEvent: MarketEvent = {
          id: this.nextMarketEventId('corr'),
          targetSector: correctionNews.target_sector || 'ALL',
          impact: correctionNews.impact_score > 0 ? 'STRONG_POSITIVE' : 'STRONG_NEGATIVE',
          urgencyMultiplier: 3.0,
          durationTicks: 180
        };
        this.engine.injectEvent(reverseMarketEvent);
      } catch (err: any) {
        console.error("❌ Correction news execution failed:", err.message);
      }
    }
    return due.length;
  }

  /** 현재 예약된 정정_news 수 (테스트/진단용) */
  public getPendingCorrectionCount(): number {
    return this.pendingCorrections.length;
  }
}
