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
  public start() {
    console.log("📰 News Fetcher is disabled.");
  }

  public stop() {
    console.log("🛑 News Fetcher Stopped.");
  }
}
