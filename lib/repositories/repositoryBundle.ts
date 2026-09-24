/**
 * RepositoryBundle Interface for STOCKSYS
 */

import type { MarketRepository } from './marketRepository';
import type { ParticipantRepository } from './participantRepository';
import type { SettlementRepository } from './settlementRepository';
import type { EventRepository } from './eventRepository';

export interface RepositoryBundle {
  readonly market: MarketRepository;
  readonly participant: ParticipantRepository;
  readonly settlement: SettlementRepository;
  readonly event: EventRepository;
  readonly markets: MarketRepository;
  readonly participants: ParticipantRepository;
  readonly events: EventRepository;
}
