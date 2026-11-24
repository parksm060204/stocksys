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
  removeMarketNews?(id: string): Promise<void>;
  getRecentMarketNews(limit?: number): Promise<MarketNewsRecord[]>;
  getMarketNewsSync?(): MarketNewsRecord[];
  getPlayerEvents(): Promise<PlayerEventRecord[]>;
  saveActivePlayerEvent(event: any): Promise<void>;
}
