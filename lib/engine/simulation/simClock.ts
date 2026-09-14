/**
 * STOCKSYS Simulation Clock & Deterministic Pseudo-Random Number Generator (PRNG)
 *
 * - Mulberry32 32-bit PRNG with Box-Muller Gaussian transform
 * - Stream splitting for independent agent/market streams
 * - Monotonic simulation time, step counter, and arrival sequence generator
 */

export class SimPrng {
  private state: number;

  constructor(seed: number = 42) {
    // 32-bit positive integer seed initialization
    this.state = (Math.abs(Math.floor(seed)) || 1) >>> 0;
  }

  /**
   * Generates a pseudo-random float in [0, 1).
   * Mulberry32 algorithm.
   */
  public next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Generates an integer in [min, max] inclusive.
   */
  public nextInt(min: number, max: number): number {
    const l = Math.ceil(min);
    const u = Math.floor(max);
    return Math.floor(this.next() * (u - l + 1)) + l;
  }

  /**
   * Standard normal distribution N(0, 1) using Box-Muller transform.
   */
  public nextGaussian(): number {
    let u1 = this.next();
    let u2 = this.next();
    // Guard against u1 === 0 which produces -Infinity with Math.log
    while (u1 <= 1e-12) {
      u1 = this.next();
    }
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }

  /**
   * Normal distribution with specified mean and standard deviation: N(mean, stdDev^2)
   */
  public nextNormal(mean: number, stdDev: number): number {
    return mean + stdDev * this.nextGaussian();
  }

  /**
   * Splits off an independent PRNG stream deterministically derived from current state.
   */
  public split(offset: number = 0): SimPrng {
    const nextSeed = ((this.state ^ 0x5a5a5a5a) + Math.imul(offset + 1, 0x9e3779b9)) >>> 0;
    return new SimPrng(nextSeed);
  }

  public getState(): number {
    return this.state;
  }

  public setState(s: number): void {
    this.state = s >>> 0;
  }
}

export interface ClockState {
  simulationTime: number; // ms timestamp
  simulationStep: number;
  dt: number;             // seconds per step
  sequence: number;
}

export class SimulationClock {
  private _simulationTime: number;
  private _simulationStep: number;
  private _dt: number;
  private _sequence: number;

  constructor(
    startEpochMs: number = 1773500000000,
    dtSeconds: number = 1.0,
    initialStep: number = 0
  ) {
    this._simulationTime = startEpochMs;
    this._dt = dtSeconds;
    this._simulationStep = initialStep;
    this._sequence = 1;
  }

  public get simulationTime(): number {
    return this._simulationTime;
  }

  public get simulationStep(): number {
    return this._simulationStep;
  }

  public get dt(): number {
    return this._dt;
  }

  public get sequence(): number {
    return this._sequence;
  }

  /**
   * Issues the next strictly monotonic sequence counter for an event/order.
   */
  public nextSequence(): number {
    return this._sequence++;
  }

  /**
   * Advances simulation time by specified seconds (defaults to this.dt).
   */
  public advance(dtSeconds?: number): { step: number; time: number; dt: number } {
    const stepDt = dtSeconds !== undefined ? dtSeconds : this._dt;
    this._simulationStep++;
    this._simulationTime += Math.round(stepDt * 1000);
    return {
      step: this._simulationStep,
      time: this._simulationTime,
      dt: stepDt,
    };
  }

  public getState(): ClockState {
    return {
      simulationTime: this._simulationTime,
      simulationStep: this._simulationStep,
      dt: this._dt,
      sequence: this._sequence,
    };
  }

  public reset(startEpochMs?: number): void {
    if (startEpochMs !== undefined) {
      this._simulationTime = startEpochMs;
    }
    this._simulationStep = 0;
    this._sequence = 1;
  }
}
