/**
 * Simulation Context for STOCKSYS
 *
 * Provides a unified execution context for simulation:
 * - Deterministic PRNG seed and namespaced stream splitting
 * - Controlled virtual clock
 * - Isolated run identification
 */

import { SimulationClock } from '../simClock';
import {
  SimulationRandomSource,
  DefaultSimulationRandomSource
} from './simulationRandom';
import {
  SimulationTimeSource,
  ClockTimeSource,
  WallClockTimeSource
} from './simulationTimeSource';

export interface SimulationContext {
  readonly seed: number;
  readonly clock: SimulationTimeSource;
  readonly random: SimulationRandomSource;
  readonly runId: string;
  readonly operationalTraceId?: string;
}

export interface CreateSimulationContextOptions {
  seed?: number;
  clock?: SimulationTimeSource | SimulationClock;
  random?: SimulationRandomSource;
  runId?: string;
  operationalTraceId?: string;
}

let traceCounter = 0;

export function createSimulationContext(
  options: CreateSimulationContextOptions = {}
): SimulationContext {
  const envSeed = process.env.ENGINE_SIMULATION_SEED
    ? parseInt(process.env.ENGINE_SIMULATION_SEED, 10)
    : undefined;

  const resolvedSeed =
    options.seed !== undefined
      ? options.seed
      : !isNaN(envSeed as number)
      ? (envSeed as number)
      : 42;

  let resolvedClock: SimulationTimeSource;
  if (options.clock) {
    if ('now' in options.clock && typeof options.clock.now === 'function') {
      resolvedClock = options.clock as SimulationTimeSource;
    } else {
      resolvedClock = new ClockTimeSource(options.clock as SimulationClock);
    }
  } else {
    // Default clock is WallClockTimeSource for backwards compatibility if not provided
    resolvedClock = new WallClockTimeSource();
  }

  const resolvedRandom =
    options.random || new DefaultSimulationRandomSource(resolvedSeed, 'root');

  // Deterministic runId: depends purely on seed and options
  const resolvedRunId =
    options.runId || `run_seed_${resolvedSeed}`;

  // Operational trace id: separated for logging/diagnostics without polluting determinism
  const resolvedOperationalTraceId =
    options.operationalTraceId || `trace_${resolvedSeed}_${Date.now()}_${++traceCounter}`;

  return {
    seed: resolvedSeed,
    clock: resolvedClock,
    random: resolvedRandom,
    runId: resolvedRunId,
    operationalTraceId: resolvedOperationalTraceId,
  };
}

/**
 * Creates a sub-context with a namespaced forked random stream.
 */
export function forkSimulationContext(
  parent: SimulationContext,
  namespace: string
): SimulationContext {
  return {
    seed: parent.seed,
    clock: parent.clock,
    random: parent.random.fork(namespace),
    runId: parent.runId,
  };
}
