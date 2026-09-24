/**
 * Simulation Time Source Interfaces and Implementations
 *
 * Separates virtual simulation time from real wall-clock time:
 * - Simulation time is used for market dynamics, bot decisions, cooldowns, and order timing.
 * - Wall-clock time is used strictly for diagnostic logging, OS resource metrics, and external I/O.
 */

import type { SimulationClock } from '../simClock';

export interface SimulationTimeSource {
  now(): number;
}

/**
 * Time source bound to an authoritative SimulationClock instance.
 */
export class ClockTimeSource implements SimulationTimeSource {
  constructor(private readonly clock: SimulationClock) {}

  public now(): number {
    return this.clock.simulationTime;
  }
}

/**
 * Fixed / mock time source for tests.
 */
export class StaticTimeSource implements SimulationTimeSource {
  constructor(private timeMs: number) {}

  public now(): number {
    return this.timeMs;
  }

  public setTime(timeMs: number): void {
    this.timeMs = timeMs;
  }

  public advance(deltaMs: number): number {
    this.timeMs += deltaMs;
    return this.timeMs;
  }
}

/**
 * System wall-clock time source (Date.now()).
 * Only to be used for non-deterministic diagnostic, logging, or fallback paths.
 */
export class WallClockTimeSource implements SimulationTimeSource {
  public now(): number {
    return Date.now();
  }
}
