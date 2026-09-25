/**
 * Simulation Random Source Interface and Implementation
 *
 * Wraps canonical SimPrng (Mulberry32 + Box-Muller) to provide:
 * - Deterministic random streams.
 * - Namespaced stream splitting (fork) where consumption in one stream does not pollute others.
 * - Safe snapshotting without consuming PRNG state.
 */

import { SimPrng } from '../simClock';

export interface SimulationRandomSnapshot {
  readonly seed: number;
  readonly state: number;
  readonly namespace?: string;
}

export interface SimulationRandomSource {
  next(): number;
  nextInt(minInclusive: number, maxExclusive: number): number;
  nextBoolean(probability: number): boolean;
  normal(mean?: number, standardDeviation?: number): number;
  fork(namespace: string): SimulationRandomSource;
  snapshot(): SimulationRandomSnapshot;
  restore?(snapshot: SimulationRandomSnapshot): void;
}

/**
 * 32-bit FNV-1a hash algorithm for deterministic seed derivation.
 */
function hashNamespace(baseSeed: number, namespace: string): number {
  let h = (baseSeed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < namespace.length; i++) {
    h ^= namespace.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export class DefaultSimulationRandomSource implements SimulationRandomSource {
  private readonly prng: SimPrng;
  private readonly rootSeed: number;
  private readonly namespace: string;

  constructor(seed: number = 42, namespace: string = 'root') {
    this.rootSeed = (Math.abs(Math.floor(seed)) || 1) >>> 0;
    this.namespace = namespace;
    this.prng = new SimPrng(this.rootSeed);
  }

  public next(): number {
    return this.prng.next();
  }

  public nextInt(minInclusive: number, maxExclusive: number): number {
    const min = Math.ceil(minInclusive);
    const max = Math.floor(maxExclusive);
    if (max <= min) return min;
    const range = max - min;
    return Math.floor(this.prng.next() * range) + min;
  }

  public nextBoolean(probability: number): boolean {
    if (probability <= 0) return false;
    if (probability >= 1) return true;
    return this.prng.next() < probability;
  }

  public normal(mean: number = 0, standardDeviation: number = 1): number {
    return this.prng.nextNormal(mean, standardDeviation);
  }

  /**
   * Forks an independent child random stream deterministically derived from
   * this stream's base seed and the target namespace.
   *
   * Crucial guarantee:
   * Consumption in this instance does NOT alter the seed or sequence of the forked stream,
   * guaranteeing bit-for-bit isolation across agents/strategies.
   */
  public fork(namespace: string): SimulationRandomSource {
    const childNamespace = this.namespace ? `${this.namespace}:${namespace}` : namespace;
    const derivedSeed = hashNamespace(this.rootSeed, childNamespace);
    return new DefaultSimulationRandomSource(derivedSeed, childNamespace);
  }

  /**
   * Non-destructive state snapshot.
   */
  public snapshot(): SimulationRandomSnapshot {
    return {
      seed: this.rootSeed,
      state: this.prng.getState(),
      namespace: this.namespace,
    };
  }

  public restore(snapshot: SimulationRandomSnapshot): void {
    if (snapshot && typeof snapshot.state === 'number') {
      this.prng.setState(snapshot.state);
    }
  }
}
