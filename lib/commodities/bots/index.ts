import { CommodityBot } from './CommodityBot';
import { TrendFollowingBot } from './TrendFollowingBot';
import { MeanReversionBot } from './MeanReversionBot';
import { HedgerBot } from './HedgerBot';
import { MarketMakerBot } from './MarketMakerBot';
import { NewsTraderBot } from './NewsTraderBot';
import { BotType } from '../types';
import type { SimulationTimeSource } from '../../engine/simulation/runtime/simulationTimeSource';
import type { SimulationRandomSource } from '../../engine/simulation/runtime/simulationRandom';
import type { SimulationContext } from '../../engine/simulation/runtime/simulationContext';
import { SIMULATION_NAMESPACES } from '../../engine/simulation/runtime/simulationNamespaces';

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

export interface CreateBotSwarmOptions {
  totalBots?: number;
  ratios?: BotRatios;
  baseCapital?: number;
  random?: SimulationRandomSource;
  clock?: SimulationTimeSource;
  context?: SimulationContext;
}

/**
 * 봇 군단(Bot Swarm) 생성 팩토리 함수
 */
export function createBotSwarm(options?: CreateBotSwarmOptions): CommodityBot[] {
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

  const clock = options?.clock || options?.context?.clock;
  const swarmRng = options?.random || (options?.context ? options.context.fork(SIMULATION_NAMESPACES.COMMODITIES.BOT_SWARM) : undefined);
  const rand = () => (swarmRng ? swarmRng.next() : 0.5);

  const getBotRandom = (botId: string): SimulationRandomSource | undefined => {
    if (options?.context) {
      return options.context.fork(SIMULATION_NAMESPACES.COMMODITIES.BOT(botId));
    }
    return swarmRng;
  };

  // 1. 트렌드추종 봇
  for (let i = 0; i < countTrend; i++) {
    const id = `bot_trend_${botIndex++}`;
    bots.push(
      new TrendFollowingBot({
        id,
        name: `CTA-Trend-${i + 1}`,
        type: 'trend_following' as BotType,
        capital: baseCapital * (0.8 + rand() * 0.4),
        riskTolerance: 0.5 + rand() * 0.4,
        positionLimit: 50,
        reactionDelay: Math.floor(rand() * 3), // 0~2틱 지연
        stopLossPct: -0.04 - rand() * 0.03,
        takeProfitPct: 0.08 + rand() * 0.06,
        clock,
        random: getBotRandom(id),
      })
    );
  }

  // 2. 평균회귀 봇
  for (let i = 0; i < countMR; i++) {
    const id = `bot_mr_${botIndex++}`;
    bots.push(
      new MeanReversionBot({
        id,
        name: `Quant-MR-${i + 1}`,
        type: 'mean_reversion' as BotType,
        capital: baseCapital * (0.8 + rand() * 0.4),
        riskTolerance: 0.4 + rand() * 0.3,
        positionLimit: 40,
        reactionDelay: Math.floor(rand() * 2),
        stopLossPct: -0.05,
        takeProfitPct: 0.05,
        clock,
        random: getBotRandom(id),
      })
    );
  }

  // 3. 헤저(실수요) 봇
  for (let i = 0; i < countHedge; i++) {
    const id = `bot_hedger_${botIndex++}`;
    bots.push(
      new HedgerBot({
        id,
        name: `Agri-Hedger-${i + 1}`,
        type: 'hedger' as BotType,
        capital: baseCapital * 1.5,
        riskTolerance: 0.3 + rand() * 0.2,
        positionLimit: 80,
        reactionDelay: 1 + Math.floor(rand() * 3), // 1~3틱 지연
        stopLossPct: -0.08,
        takeProfitPct: 0.12,
        clock,
        random: getBotRandom(id),
      })
    );
  }

  // 4. 마켓메이커 봇
  for (let i = 0; i < countMM; i++) {
    const id = `bot_mm_${botIndex++}`;
    bots.push(
      new MarketMakerBot({
        id,
        name: `LP-MM-${i + 1}`,
        type: 'market_maker' as BotType,
        capital: baseCapital * 2.0,
        riskTolerance: 0.7 + rand() * 0.2,
        positionLimit: 100,
        reactionDelay: 0, // 초저지연
        stopLossPct: -0.03,
        takeProfitPct: 0.03,
        clock,
        random: getBotRandom(id),
      })
    );
  }

  // 5. 뉴스트레이더 봇
  for (let i = 0; i < countNews; i++) {
    const id = `bot_news_${botIndex++}`;
    bots.push(
      new NewsTraderBot({
        id,
        name: `Event-News-${i + 1}`,
        type: 'news_trader' as BotType,
        capital: baseCapital * (0.7 + rand() * 0.5),
        riskTolerance: 0.6 + rand() * 0.4,
        positionLimit: 60,
        reactionDelay: Math.floor(rand() * 4), // 0~3틱 지연
        stopLossPct: -0.05,
        takeProfitPct: 0.10,
        clock,
        random: getBotRandom(id),
      })
    );
  }

  return bots;
}
