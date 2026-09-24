/**
 * InMemoryEventRepository
 * Concrete in-memory implementation of EventRepository backed by MemoryDatabase.
 */

import { MemoryDatabase } from '../../memoryDb/memoryStore';
import type { EventRepository } from '../eventRepository';
import type {
  ActiveManipulationRecord,
  MarketNewsRecord,
  PlayerEventRecord
} from '../types';

export class InMemoryEventRepository implements EventRepository {
  constructor(private readonly db: MemoryDatabase) {}

  public async getPendingManipulations(): Promise<ActiveManipulationRecord[]> {
    return this.db.activeManipulations
      .filter((m) => m.status === 'pending' || m.status === 'active')
      .map((m) => ({ ...m }));
  }

  public async updateManipulationStatus(id: string, status: string): Promise<void> {
    const item = this.db.activeManipulations.find((m) => m.id === id);
    if (item) {
      item.status = status;
    }
  }

  public async resolveManipulation(id: string): Promise<void> {
    return this.updateManipulationStatus(id, 'resolved');
  }

  public async saveMarketNews(news: MarketNewsRecord): Promise<void> {
    const id = news.id || this.db.generateId('news');
    this.db.marketNews.push({
      ...news,
      id,
      created_at: news.created_at || this.db.getIsoTimestamp(),
    });
  }

  public async getRecentMarketNews(limit: number = 20): Promise<MarketNewsRecord[]> {
    return this.db.marketNews.slice(-limit).map((n) => ({ ...n }));
  }

  public async getPlayerEvents(): Promise<PlayerEventRecord[]> {
    return this.db.playerEvents.map((e) => ({ ...e }));
  }

  public async saveActivePlayerEvent(event: any): Promise<void> {
    this.db.activePlayerEvents.push({ ...event });
  }
}
