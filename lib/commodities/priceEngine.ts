import { CommodityDefinition, ActiveCommodityEvent } from './types';

/**
 * Box-Muller 변환을 이용한 표준정규분포 N(0, 1) 난수 생성기
 */
export function generateStandardGaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random(); // (0, 1] 범위
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * 평균 mean, 표준편차 stdDev의 정규분포 난수 N(mean, stdDev^2) 생성기
 */
export function generateGaussianNoise(mean: number, stdDev: number): number {
  return mean + stdDev * generateStandardGaussian();
}

/**
 * 계절성 사인함수 값 산출: S(t) = amplitude * sin((2*PI*t / period) + phase)
 */
export function calculateSeasonalityLevel(tick: number, seasonality?: { period: number; amplitude: number; phase: number }): number {
  if (!seasonality || seasonality.period <= 0) return 0;
  const { period, amplitude, phase } = seasonality;
  return amplitude * Math.sin(((2 * Math.PI * (tick % period)) / period) + phase);
}

/**
 * 계절성 증분(미분/델타) 산출: Delta_S(t) = S(t+1) - S(t)
 */
export function calculateSeasonalityDelta(tick: number, seasonality?: { period: number; amplitude: number; phase: number }): number {
  if (!seasonality || seasonality.period <= 0) return 0;
  const currentLevel = calculateSeasonalityLevel(tick, seasonality);
  const nextLevel = calculateSeasonalityLevel(tick + 1, seasonality);
  return nextLevel - currentLevel;
}

/**
 * 수급 압력(Supply-Demand Pressure) 산출
 * Formula: ((체결 매수량 - 체결 매도량) / 평균거래량) * impact_coefficient
 */
export function calculateSupplyDemandPressure(
  netBuyVolume: number,
  averageVolume: number,
  impactCoefficient: number = 0.005
): number {
  const normVol = averageVolume > 0 ? averageVolume : 1000;
  const rawPressure = (netBuyVolume / normVol) * impactCoefficient;
  // 단일 틱 최대 수급 충격 캡 (-10% ~ +10%)
  return Math.max(-0.10, Math.min(0.10, rawPressure));
}

/**
 * 활성 이벤트에 의한 가격 충격(Event Shock) 산출
 * Formula: sum( magnitude * decay(남은틱/전체틱) * event_sensitivity )
 */
export function calculateEventShock(
  commodity: CommodityDefinition,
  activeEvents: ActiveCommodityEvent[]
): number {
  if (!activeEvents || activeEvents.length === 0) return 0;

  let totalShock = 0;

  for (const ev of activeEvents) {
    const isTargetCategory = ev.targetCategories.includes(commodity.category);
    const isTargetCommodity = ev.targetCommodityIds ? ev.targetCommodityIds.includes(commodity.id) : false;

    if (isTargetCategory || isTargetCommodity) {
      const decayRatio = ev.totalTicks > 0 ? Math.max(0, ev.remainingTicks / ev.totalTicks) : 0;
      // 틱당 분할 충격량: (전체 크기 / 전체 틱) * 감쇄비율 * 민감도
      const perTickMagnitude = ev.totalTicks > 0 ? ev.magnitude / (ev.totalTicks * 0.5) : ev.magnitude;
      const shock = perTickMagnitude * decayRatio * commodity.eventSensitivity;
      totalShock += shock;
    }
  }

  // 단일 틱 최대 이벤트 충격 캡 (-5% ~ +5%)
  return Math.max(-0.05, Math.min(0.05, totalShock));
}

/**
 * 틱 단위(tickSize) 정렬 헬퍼
 */
export function alignToTick(price: number, tickSize: number): number {
  if (tickSize <= 0) return price;
  const factor = 1 / tickSize;
  return Math.round(price * factor) / factor;
}

/**
 * [핵심 가격 결정 공식]
 * Price(t+1) = Price(t) * (1 + drift + supply_demand_pressure + event_shock + noise)
 */
export function computeNextPrice(params: {
  currentPrice: number;
  commodity: CommodityDefinition;
  tick: number;
  netBuyVolume: number;
  activeEvents: ActiveCommodityEvent[];
  impactCoefficient?: number;
}): {
  nextPrice: number;
  drift: number;
  supplyDemandPressure: number;
  eventShock: number;
  noise: number;
  returnPct: number;
} {
  const {
    currentPrice,
    commodity,
    tick,
    netBuyVolume,
    activeEvents,
    impactCoefficient = 0.004,
  } = params;

  // 1. drift: 기본 카테고리 drift + 계절성 증분 Delta_S(t) + 실물 균형가 복원력(Mean Reversion Pull)
  const baseDrift = commodity.drift;
  const seasonalityDelta = calculateSeasonalityDelta(tick, commodity.seasonality);

  // 실물 원자재 특성상 기본 생산 단가(basePrice)로부터 과도하게 괴리 시 회귀 압력 (-0.15% ~ +0.15%)
  const priceRatio = currentPrice / (commodity.basePrice > 0 ? commodity.basePrice : currentPrice);
  const fundamentalPull = -0.0015 * Math.log(Math.max(0.01, priceRatio));

  const totalDrift = baseDrift + seasonalityDelta + fundamentalPull;

  // 2. supply_demand_pressure
  const supplyDemandPressure = calculateSupplyDemandPressure(
    netBuyVolume,
    commodity.averageVolume,
    impactCoefficient
  );

  // 3. event_shock
  const eventShock = calculateEventShock(commodity, activeEvents);

  // 4. noise: N(0, base_volatility^2)
  const noise = generateGaussianNoise(0, commodity.baseVolatility);

  // 5. 총 틱 수익률 (합산)
  const returnPct = totalDrift + supplyDemandPressure + eventShock + noise;

  // 6. 차기 가격 계산 (하한선은 최소 1 tickSize 보장)
  let rawNextPrice = currentPrice * (1 + returnPct);
  rawNextPrice = Math.max(commodity.tickSize, rawNextPrice);

  const nextPrice = alignToTick(rawNextPrice, commodity.tickSize);

  return {
    nextPrice,
    drift: totalDrift,
    supplyDemandPressure,
    eventShock,
    noise,
    returnPct,
  };
}
