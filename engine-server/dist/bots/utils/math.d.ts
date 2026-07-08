/**
 * O(1) Online Linear Regression using Welford's Algorithm
 * Used for estimating Kyle's Lambda (price impact coefficient).
 */
export declare class WelfordRegression {
    private n;
    private meanX;
    private meanY;
    private M2X;
    private covariance;
    private decayFactor;
    /**
     * @param decayFactor 0 ~ 1 (1 means no decay, 0.99 means older data exponentially loses weight)
     */
    constructor(decayFactor?: number);
    /**
     * Update the regression state with a new data point (x, y).
     * @param x Cumulative Volume (V_t)
     * @param y Mid Price Change (dS_t)
     */
    update(x: number, y: number): void;
    /**
     * Get the current slope (Kyle's Lambda)
     * lambda = Cov(X, Y) / Var(X)
     */
    getSlope(): number;
    reset(): void;
}
/**
 * O(1) Sliding Window Queue for Order Flow Imbalance (OFI)
 */
export declare class OFISlidingWindow {
    private windowSizeMs;
    private queue;
    private currentSum;
    /**
     * @param windowSizeMs Time window in milliseconds to track OFI
     */
    constructor(windowSizeMs?: number);
    /**
     * Add a new OFI value e_n at the given time, and slide the window.
     */
    add(time: number, e: number): void;
    /**
     * Get the sum of e_n within the current window
     */
    getSum(): number;
}
//# sourceMappingURL=math.d.ts.map