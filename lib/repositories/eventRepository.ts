/**
 * EventRepository Interface for STOCKSYS
 */

import type {
  ActiveManipulationRecord,
  MarketNewsRecord,
  PlayerEventRecord
} from './types';

export interface EventRepository {
  getPendingManipulations(): Promise<ActiveManipulationRecord[]>;
  updateManipulationStatus(id: string, status: string): Promise<void>;
  saveMarketNews(news: MarketNewsRecord): Promise<void>;
  getRecentMarketNews(limit?: number): Promise<MarketNewsRecord[]>;
  getPlayerEvents(): Promise<PlayerEventRecord[]>;
  saveActivePlayerEvent(event: any): Promise<void>;
}
