import Parser from 'rss-parser';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const parser = new Parser();

const RSS_FEEDS = [
  { source: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex' },
  // 필요 시 CNBC, WSJ 등의 무료 RSS 추가 가능
];

export class NewsFetcher {
  private isRunning: boolean = false;
  private fetchIntervalMs: number = 10 * 60 * 1000; // 10분마다 실행
  private timer: NodeJS.Timeout | null = null;

  constructor() {}

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("📰 News Fetcher Started (10-min interval)...");
    
    // 시작 즉시 1회 실행
    this.fetchNews();
    this.timer = setInterval(() => this.fetchNews(), this.fetchIntervalMs);
  }

  public stop() {
    this.isRunning = false;
    if (this.timer) clearInterval(this.timer);
    console.log("🛑 News Fetcher Stopped.");
  }

  private async fetchNews() {
    console.log(`[NewsFetcher] Fetching real-world news from ${RSS_FEEDS.length} sources...`);
    
    for (const feed of RSS_FEEDS) {
      try {
        const parsedFeed = await parser.parseURL(feed.url);
        
        // 의미 없는 기사를 거르기 위한 금융/경제 키워드 필터
        const KEYWORDS = ['stock', 'market', 'economy', 'earnings', 'rate', 'fed', 'inflation', 'tech', 'finance', 'shares', 'dividend', 'ceo', 'revenue', 'wall street'];
        
        const filteredItems = parsedFeed.items.filter(item => {
          const content = ((item.title || '') + ' ' + (item.contentSnippet || '')).toLowerCase();
          return KEYWORDS.some(keyword => content.includes(keyword));
        });

        const newsItems = filteredItems.map(item => ({
          source: feed.source,
          title: item.title || 'No Title',
          link: item.link || '',
          pub_date: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString()
        }));

        if (newsItems.length === 0) continue;

        // DB에 적재 (title이 UNIQUE이므로 이미 있는 뉴스는 무시됨. Supabase의 upsert 사용)
        const { error } = await supabase
          .from('real_news')
          .upsert(newsItems, { onConflict: 'title', ignoreDuplicates: true });

        if (error) {
          console.error(`[NewsFetcher] DB Insert Error for ${feed.source}:`, error.message);
        } else {
          console.log(`[NewsFetcher] Successfully parsed ${newsItems.length} items from ${feed.source}`);
        }

      } catch (error: any) {
        console.error(`[NewsFetcher] Error fetching feed from ${feed.source}:`, error.message);
      }
    }
  }
}
