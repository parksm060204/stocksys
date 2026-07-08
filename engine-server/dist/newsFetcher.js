"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NewsFetcher = void 0;
const rss_parser_1 = __importDefault(require("rss-parser"));
const supabase_js_1 = require("@supabase/supabase-js");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const supabase = (0, supabase_js_1.createClient)(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const parser = new rss_parser_1.default();
const RSS_FEEDS = [
    { source: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex' },
    // 필요 시 CNBC, WSJ 등의 무료 RSS 추가 가능
];
class NewsFetcher {
    isRunning = false;
    fetchIntervalMs = 10 * 60 * 1000; // 10분마다 실행
    timer = null;
    constructor() { }
    start() {
        if (this.isRunning)
            return;
        this.isRunning = true;
        console.log("📰 News Fetcher Started (10-min interval)...");
        // 시작 즉시 1회 실행
        this.fetchNews();
        this.timer = setInterval(() => this.fetchNews(), this.fetchIntervalMs);
    }
    stop() {
        this.isRunning = false;
        if (this.timer)
            clearInterval(this.timer);
        console.log("🛑 News Fetcher Stopped.");
    }
    async fetchNews() {
        console.log(`[NewsFetcher] Fetching real-world news from ${RSS_FEEDS.length} sources...`);
        for (const feed of RSS_FEEDS) {
            try {
                const parsedFeed = await parser.parseURL(feed.url);
                // 의미 없는 기사를 거르기 위한 금융/경제 키워드 필터
                const KEYWORDS = ['stock', 'market', 'economy', 'earnings', 'rate', 'fed', 'inflation', 'tech', 'finance', 'shares', 'dividend', 'ceo', 'revenue', 'wall street'];
                const filteredItems = parsedFeed.items.filter((item) => {
                    const content = ((item.title || '') + ' ' + (item.contentSnippet || '')).toLowerCase();
                    return KEYWORDS.some(keyword => content.includes(keyword));
                });
                const newsItems = filteredItems.map((item) => ({
                    source: feed.source,
                    title: item.title || 'No Title',
                    link: item.link || '',
                    pub_date: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString()
                }));
                if (newsItems.length === 0)
                    continue;
                // DB에 적재 (title이 UNIQUE이므로 이미 있는 뉴스는 무시됨. Supabase의 upsert 사용)
                const { error } = await supabase
                    .from('real_news')
                    .upsert(newsItems, { onConflict: 'title', ignoreDuplicates: true });
                if (error) {
                    console.error(`[NewsFetcher] DB Insert Error for ${feed.source}:`, error.message);
                }
                else {
                    console.log(`[NewsFetcher] Successfully parsed ${newsItems.length} items from ${feed.source}`);
                }
            }
            catch (error) {
                console.error(`[NewsFetcher] Error fetching feed from ${feed.source}:`, error.message);
            }
        }
    }
}
exports.NewsFetcher = NewsFetcher;
//# sourceMappingURL=newsFetcher.js.map