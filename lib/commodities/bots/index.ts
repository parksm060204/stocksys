import { CommodityBot } from './CommodityBot';
import { TrendFollowingBot } from './TrendFollowingBot';
import { MeanReversionBot } from './MeanReversionBot';
import { HedgerBot } from './HedgerBot';
import { MarketMakerBot } from './MarketMakerBot';
import { NewsTraderBot } from './NewsTraderBot';
import { BotType } from '../types';

export {
  CommodityBot,
  TrendFollowingBot,
  MeanReversionBot,
  HedgerBot,
  MarketMakerBot,
  NewsTraderBot,
};

export interface BotRatios {
  trendFollowing?: number; // 트렌드추종형 비중
  meanReversion?: number;  // 평균회귀형 비중
  hedger?: number;         // 헤저/실수요 비중
  marketMaker?: number;    // 마켓메이커 비중
  newsTrader?: number;     // 뉴스트레이더 비중
}

/**
 * 봇 군단(Bot Swarm) 생성 팩토리 함수
 */
export function createBotSwarm(options?: {
  totalBots?: number;
  ratios?: BotRatios;
  baseCapital?: number;
}): CommodityBot[] {
  const totalBots = options?.totalBots ?? 50;
  const baseCapital = options?.baseCapital ?? 1000000; // $1,000,000 기본 자본
  const ratios = {
    trendFollowing: options?.ratios?.trendFollowing ?? 0.25,
    meanReversion: options?.ratios?.meanReversion ?? 0.25,
    hedger: options?.ratios?.hedger ?? 0.15,
    marketMaker: options?.ratios?.marketMaker ?? 0.20,
    newsTrader: options?.ratios?.newsTrader ?? 0.15,
  };

  const sum =
    ratios.trendFollowing +
    ratios.meanReversion +
    ratios.hedger +
    ratios.marketMaker +
    ratios.newsTrader;

  const norm = {
    trendFollowing: ratios.trendFollowing / sum,
    meanReversion: ratios.meanReversion / sum,
    hedger: ratios.hedger / sum,
    marketMaker: ratios.marketMaker / sum,
    newsTrader: ratios.newsTrader / sum,
  };

  const countTrend = Math.round(totalBots * norm.trendFollowing);
  const countMR = Math.round(totalBots * norm.meanReversion);
  const countHedge = Math.round(totalBots * norm.hedger);
  const countMM = Math.round(totalBots * norm.marketMaker);
  const countNews = Math.max(0, totalBots - (countTrend + countMR + countHedge + countMM));

  const bots: CommodityBot[] = [];
  let botIndex = 1;

  // 1. 트렌드추종 봇
  for (let i = 0; i < countTrend; i++) {
    bots.push(
      new TrendFollowingBot({
        id: `bot_trend_${botIndex++}`,
        name: `CTA-Trend-${i + 1}`,
        type: 'trend_following' as BotType,
        capital: baseCapital * (0.8 + Math.random() * 0.4),
        riskTolerance: 0.5 + Math.random() * 0.4,
        positionLimit: 50,
        reactionDelay: Math.floor(Math.random() * 3), // 0~2틱 지연
        stopLossPct: -0.04 - Math.random() * 0.03,
        takeProfitPct: 0.08 + Math.random() * 0.06,
      })
    );
  }

  // 2. 평균회귀 봇
  for (let i = 0; i < countMR; i++) {
    bots.push(
      new MeanReversionBot({
        id: `bot_mr_${botIndex++}`,
        name: `Quant-MR-${i + 1}`,
        type: 'mean_reversion' as BotType,
        capital: baseCapital * (0.8 + Math.random() * 0.4),
        riskTolerance: 0.4 + Math.random() * 0.3,
        positionLimit: 40,
        reactionDelay: Math.floor(Math.random() * 2),
        stopLossPct: -0.05,
        takeProfitPct: 0.05,
      })
    );
  }

  // 3. 헤저(실수요) 봇
  for (let i = 0; i < countHedge; i++) {
    bots.push(
      new HedgerBot({
        id: `bot_hedger_${botIndex++}`,
        name: `Agri-Hedger-${i + 1}`,
        type: 'hedger' as BotType,
        capital: baseCapital * 1.5,
        riskTolerance: 0.3 + Math.random() * 0.2,
        positionLimit: 80,
        reactionDelay: 1 + Math.floor(Math.random() * 3), // 1~3틱 지연
        stopLossPct: -0.08,
        takeProfitPct: 0.12,
      })
    );
  }

  // 4. 마켓메이커 봇
  for (let i = 0; i < countMM; i++) {
    bots.push(
      new MarketMakerBot({
        id: `bot_mm_${botIndex++}`,
        name: `LP-MM-${i + 1}`,
        type: 'market_maker' as BotType,
        capital: baseCapital * 2.0,
        riskTolerance: 0.7 + Math.random() * 0.2,
        positionLimit: 100,
        reactionDelay: 0, // 초저지연
        stopLossPct: -0.03,
        takeProfitPct: 0.03,
      })
    );
  }

  // 5. 뉴스트레이더 봇
  for (let i = 0; i < countNews; i++) {
    bots.push(
      new NewsTraderBot({
        id: `bot_news_${botIndex++}`,
        name: `Event-News-${i + 1}`,
        type: 'news_trader' as BotType,
        capital: baseCapital * (0.7 + Math.random() * 0.5),
        riskTolerance: 0.6 + Math.random() * 0.4,
        positionLimit: 60,
        reactionDelay: Math.floor(Math.random() * 4), // 0~3틱 지연
        stopLossPct: -0.05,
        takeProfitPct: 0.10,
      })
    );
  }

  return bots;
}
