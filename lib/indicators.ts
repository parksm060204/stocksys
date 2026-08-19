export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface LinePoint {
  time: number;
  value: number;
}

export interface BollingerBandsResult {
  upper: LinePoint[];
  middle: LinePoint[];
  lower: LinePoint[];
}

export interface RSIResult {
  rsi: LinePoint[];
}

/**
 * 단순 이동평균선 (SMA) 계산 - O(N) 슬라이딩 윈도우
 */
export function calculateSMA(candles: CandleData[], period: number): LinePoint[] {
  if (candles.length < period || period <= 0) return [];

  const points: LinePoint[] = [];
  let sum = 0;

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i]?.close ?? 0;
    sum += close;

    if (i >= period) {
      const oldClose = candles[i - period]?.close ?? 0;
      sum -= oldClose;
    }

    if (i >= period - 1) {
      const currentCandle = candles[i];
      if (currentCandle) {
        points.push({
          time: currentCandle.time,
          value: parseFloat((sum / period).toFixed(4)),
        });
      }
    }
  }

  return points;
}

/**
 * 지수 이동평균선 (EMA) 계산
 */
export function calculateEMA(candles: CandleData[], period: number): LinePoint[] {
  if (candles.length < period || period <= 0) return [];

  const points: LinePoint[] = [];
  const k = 2 / (period + 1);

  // 초기 SMA 계산
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i]?.close ?? 0;
  }
  let prevEma = sum / period;

  const startCandle = candles[period - 1];
  if (startCandle) {
    points.push({
      time: startCandle.time,
      value: parseFloat(prevEma.toFixed(4)),
    });
  }

  for (let i = period; i < candles.length; i++) {
    const candle = candles[i];
    if (candle) {
      const close = candle.close;
      const currentEma = close * k + prevEma * (1 - k);
      points.push({
        time: candle.time,
        value: parseFloat(currentEma.toFixed(4)),
      });
      prevEma = currentEma;
    }
  }

  return points;
}

/**
 * 볼린저 밴드 (Bollinger Bands) 계산
 */
export function calculateBollingerBands(
  candles: CandleData[],
  period: number = 20,
  stdDevMultiplier: number = 2
): BollingerBandsResult {
  if (candles.length < period || period <= 0) {
    return { upper: [], middle: [], lower: [] };
  }

  const upper: LinePoint[] = [];
  const middle: LinePoint[] = [];
  const lower: LinePoint[] = [];

  let sum = 0;
  let sumSq = 0;

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i]?.close ?? 0;
    sum += close;
    sumSq += close * close;

    if (i >= period) {
      const oldClose = candles[i - period]?.close ?? 0;
      sum -= oldClose;
      sumSq -= oldClose * oldClose;
    }

    if (i >= period - 1) {
      const candle = candles[i];
      if (candle) {
        const ma = sum / period;
        const variance = Math.max(0, sumSq / period - ma * ma);
        const stdDev = Math.sqrt(variance);

        const upVal = ma + stdDevMultiplier * stdDev;
        const lowVal = ma - stdDevMultiplier * stdDev;

        upper.push({ time: candle.time, value: parseFloat(upVal.toFixed(4)) });
        middle.push({ time: candle.time, value: parseFloat(ma.toFixed(4)) });
        lower.push({ time: candle.time, value: parseFloat(lowVal.toFixed(4)) });
      }
    }
  }

  return { upper, middle, lower };
}

/**
 * 상대강도지수 (RSI) 계산 (Wilder's Smoothing)
 */
export function calculateRSI(candles: CandleData[], period: number = 14): LinePoint[] {
  if (candles.length <= period || period <= 0) return [];

  const points: LinePoint[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  // 1. 첫 번째 period 동안의 평균 상승분/하락분
  for (let i = 1; i <= period; i++) {
    const prev = candles[i - 1]?.close ?? 0;
    const curr = candles[i]?.close ?? 0;
    const change = curr - prev;

    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }

  avgGain /= period;
  avgLoss /= period;

  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  let rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);

  const firstCandle = candles[period];
  if (firstCandle) {
    points.push({
      time: firstCandle.time,
      value: parseFloat(rsi.toFixed(2)),
    });
  }

  // 2. 이후 Wilder's Smoothing 적용
  for (let i = period + 1; i < candles.length; i++) {
    const candle = candles[i];
    const prevCandle = candles[i - 1];

    if (candle && prevCandle) {
      const change = candle.close - prevCandle.close;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);

      points.push({
        time: candle.time,
        value: parseFloat(rsi.toFixed(2)),
      });
    }
  }

  return points;
}
