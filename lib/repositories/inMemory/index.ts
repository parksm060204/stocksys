/**
 * In-Memory Repositories Export and Bundle Factory
 */

import { MemoryDatabase } from '../../memoryDb/memoryStore';
import { InMemoryMarketRepository } from './InMemoryMarketRepository';
import { InMemoryParticipantRepository } from './InMemoryParticipantRepository';
import { InMemorySettlementRepository } from './InMemorySettlementRepository';
import { InMemoryEventRepository } from './InMemoryEventRepository';
import type { RepositoryBundle } from '../repositoryBundle';

export * from './InMemoryMarketRepository';
export * from './InMemoryParticipantRepository';
export * from './InMemorySettlementRepository';
export * from './InMemoryEventRepository';

export function createInMemoryRepositoryBundle(db: MemoryDatabase = new MemoryDatabase()): RepositoryBundle {
  const market = new InMemoryMarketRepository(db);
  const participant = new InMemoryParticipantRepository(db);
  const settlement = new InMemorySettlementRepository(db);
  const event = new InMemoryEventRepository(db);

  return {
    market,
    participant,
    settlement,
    event,
    markets: market,
    participants: participant,
    events: event,
  };
}
