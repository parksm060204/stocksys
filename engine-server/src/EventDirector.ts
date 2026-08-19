import { createClient } from '@supabase/supabase-js';
import type { MarketEngine } from './MarketEngine';
import type { MarketEvent } from './types';
import { EventBus } from './EventBus';
import { NewsGenerator, NewsItem } from './services/NewsGenerator';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ [EventDirector] Critical Error: Missing Supabase credentials in environment variables.");
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}


const supabase = createClient(supabaseUrl, supabaseKey);


export class EventDirector {
  private engine: MarketEngine;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private newsGenerator: NewsGenerator;

  constructor(engine: MarketEngine) {
    this.engine = engine;
    this.newsGenerator = new NewsGenerator();
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

    // 1. 매 5분마다 Gemini AI 뉴스 생성 (또는 5% 무작위 확률)
    if (this.minuteCounter % 5 === 0 || Math.random() < 0.05) {
      await this.triggerEndogenousNews();
    }
  }

  public async triggerEndogenousNews(): Promise<NewsItem | null> {
    try {
      console.log("📰 [EventDirector] Generating endogenous AI news via Gemini...");
      
      const marketState = this.engine ? this.engine.getMarketState() : {};
      const newsItem = await this.newsGenerator.generateNews(marketState);

      // 1. Supabase market_news 테이블에 저장
      const { data: inserted, error: insertError } = await supabase
        .from('market_news')
        .insert({
          type: newsItem.type,
          category: newsItem.category,
          publisher: newsItem.publisher,
          title: newsItem.title,
          content: newsItem.content,
          target_sector: newsItem.target_sector,
          target_ticker: newsItem.target_ticker,
          impact_score: newsItem.impact_score,
          is_fake: newsItem.is_fake
        })
        .select()
        .single();

      if (insertError) {
        console.warn("⚠️ market_news insert failed (fallback to premium_news):", insertError.message);
        // Fallback write to premium_news for UI backwards compatibility
        await supabase.from('premium_news').insert({
          headline: newsItem.title,
          content_summary: newsItem.content,
          is_quoted: newsItem.category === 'RUMOR',
          is_true: !newsItem.is_fake
        });
      } else if (inserted) {
        newsItem.id = inserted.id;
      }

      console.log(`📡 [NewsPublished] [${newsItem.category}] (${newsItem.publisher}) ${newsItem.title} (Impact: ${newsItem.impact_score})`);

      // 2. EventBus로 news_published 이벤트 브로드캐스팅 (봇들이 즉각 리스닝)
      EventBus.publish('news_published', newsItem);

      // 3. 엔진 호가창에 MarketEvent 주입 (기존 호가 임팩트 연동)
      const marketEvent: MarketEvent = {
        id: uuidv4(),
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

  private scheduleCorrection(rumor: NewsItem) {
    // 시뮬레이션 환경용 4분(240,000ms) 뒤 정정 공시 발령
    const delayMs = 4 * 60 * 1000;
    console.log(`🕒 [EventDirector] Scheduled correction for fake rumor [${rumor.title}] in 4 minutes.`);

    setTimeout(async () => {
      try {
        console.log(`🚨 [EventDirector] Executing Scheduled Correction News for [${rumor.title}]!`);
        const correctionNews = this.newsGenerator.generateCorrection(rumor);

        // Supabase INSERT
        const { data: inserted } = await supabase
          .from('market_news')
          .insert({
            type: correctionNews.type,
            category: correctionNews.category,
            publisher: correctionNews.publisher,
            title: correctionNews.title,
            content: correctionNews.content,
            target_sector: correctionNews.target_sector,
            target_ticker: correctionNews.target_ticker,
            impact_score: correctionNews.impact_score,
            is_fake: false,
            original_rumor_id: rumor.id || null
          })
          .select()
          .single();

        if (inserted) correctionNews.id = inserted.id;

        // Broadcast Correction Event
        EventBus.publish('news_published', correctionNews);

        // Inject Reversal Market Event
        const reverseMarketEvent: MarketEvent = {
          id: uuidv4(),
          targetSector: correctionNews.target_sector || 'ALL',
          impact: correctionNews.impact_score > 0 ? 'STRONG_POSITIVE' : 'STRONG_NEGATIVE',
          urgencyMultiplier: 3.0,
          durationTicks: 180
        };
        this.engine.injectEvent(reverseMarketEvent);
      } catch (err: any) {
        console.error("❌ Correction news execution failed:", err.message);
      }
    }, delayMs);
  }
}
