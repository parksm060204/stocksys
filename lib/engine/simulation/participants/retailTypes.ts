/**
 * Retail Participant Types for STOCKSYS
 *
 * Defines swarm profiles, noise traders, and sentiment behavioral parameters.
 */

import { ParticipantAccount } from './participantTypes';

export interface RetailSwarmProfile {
  swarmClusterId: string;
  populationSize: number;
  fomoSensitivity: number;
  panicSensitivity: number;
  memeStockAffinity: number;
  defaultNoiseRatio: number;
  defaultChartistRatio: number;
  defaultFundamentalistRatio: number;
}

export interface RetailSwarmAccount extends ParticipantAccount {
  swarmProfile: RetailSwarmProfile;
}
