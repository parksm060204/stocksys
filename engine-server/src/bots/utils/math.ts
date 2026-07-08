/**
 * O(1) Online Linear Regression using Welford's Algorithm
 * Used for estimating Kyle's Lambda (price impact coefficient).
 */
export class WelfordRegression {
  private n: number = 0;
  private meanX: number = 0;
  private meanY: number = 0;
  private M2X: number = 0; // Sum of squared differences from the mean (for variance of X)
  private covariance: number = 0; // Covariance between X and Y
  private decayFactor: number;

  /**
   * @param decayFactor 0 ~ 1 (1 means no decay, 0.99 means older data exponentially loses weight)
   */
  constructor(decayFactor: number = 1.0) {
    this.decayFactor = decayFactor;
  }

  /**
   * Update the regression state with a new data point (x, y).
   * @param x Cumulative Volume (V_t)
   * @param y Mid Price Change (dS_t)
   */
  public update(x: number, y: number) {
    this.n = this.n * this.decayFactor + 1;
    
    const dx = x - this.meanX;
    const dy = y - this.meanY;
    
    this.meanX += dx / this.n;
    this.meanY += dy / this.n;
    
    // Welford's algorithm for variance and covariance
    this.M2X = this.M2X * this.decayFactor + dx * (x - this.meanX);
    this.covariance = this.covariance * this.decayFactor + dx * (y - this.meanY);
  }

  /**
   * Get the current slope (Kyle's Lambda)
   * lambda = Cov(X, Y) / Var(X)
   */
  public getSlope(): number {
    if (this.n < 2 || this.M2X === 0) return 0;
    return this.covariance / this.M2X;
  }

  public reset() {
    this.n = 0;
    this.meanX = 0;
    this.meanY = 0;
    this.M2X = 0;
    this.covariance = 0;
  }
}

/**
 * O(1) Sliding Window Queue for Order Flow Imbalance (OFI)
 */
export class OFISlidingWindow {
  private windowSizeMs: number;
  private queue: { time: number, e: number }[] = [];
  private currentSum: number = 0;

  /**
   * @param windowSizeMs Time window in milliseconds to track OFI
   */
  constructor(windowSizeMs: number = 5000) {
    this.windowSizeMs = windowSizeMs;
  }

  /**
   * Add a new OFI value e_n at the given time, and slide the window.
   */
  public add(time: number, e: number) {
    this.queue.push({ time, e });
    this.currentSum += e;

    // Remove old entries outside the window
    while (this.queue.length > 0 && time - this.queue[0]!.time > this.windowSizeMs) {
      const old = this.queue.shift();
      if (old) {
        this.currentSum -= old.e;
      }
    }
  }

  /**
   * Get the sum of e_n within the current window
   */
  public getSum(): number {
    return this.currentSum;
  }
}
