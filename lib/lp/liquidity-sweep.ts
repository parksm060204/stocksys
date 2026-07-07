import { TRILLION } from "./config";
import type { LPAccount, AlgoPattern } from "./types";
import type { StockMeta } from "./types";
import type { Stock } from "@/lib/types";

export type SweepDirection = "UP_SWEEP" | "DOWN_SWEEP" | "NONE";
export type SweepPhase = "ACCUMULATION" | "SWEEP_UP" | "SWEEP_DOWN" | "STOP_HUNT" | "RESTING";

export interface LiquidityZone {
  price: number;
  type: "support" | "resistance" | "stop_cluster";
  strength: number; // 0~1, 호가 얇은 구간 정도
}

export interface SweepStatus {
  phase: SweepPhase;
  direction: SweepDirection;
  active: boolean;
  sweepPrice: number;        // 스윕 목표 가격
  sweepSize: number;         // 스윕 주문 물량
  triggerAccount: string | null; // 스윕 주도 계좌
  ticksRemaining: number;    // 남은 스윕 틱 수
  cooldownTicks: number;     // 다음 스윕까지 대기 틱 수
  recentSweeps: { time: string; direction: SweepDirection; price: number; volume: number }[];
  zones: LiquidityZone[];
}

export interface SweepResult {
  priceModifier: number;
  forcedVolume: number;   // 강제 주문 물량
  direction: SweepDirection;
  trades: { side: "buy" | "sell"; price: number; size: number }[];
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 스윕을 주도할 가능성이 높은 알고리즘 패턴
const SWEEP_CAPABLE: AlgoPattern[] = ["MOMENTUM", "TREND_CHASER", "MARKET_MAKER", "ARBITRAGER"];

export class LiquiditySweepEngine {
  statuses: Map<string, SweepStatus> = new Map();

  initStock(meta: StockMeta, currentPrice: number) {
    const rng = mulberry32(hashStr(meta.id + "sweep"));

    // 유동성 존(지지/저항/스탑 클러스터) 생성
    const tick = Math.max(currentPrice * 0.01, 1);
    const zones: LiquidityZone[] = [];

    // 저항선 (위쪽)
    for (let i = 1; i <= 3; i++) {
      zones.push({
        price: +(currentPrice * (1 + 0.02 * i + rng() * 0.01)).toFixed(2),
        type: "resistance",
        strength: 0.3 + rng() * 0.4,
      });
    }
    // 지지선 (아래쪽)
    for (let i = 1; i <= 3; i++) {
      zones.push({
        price: +(currentPrice * (1 - 0.02 * i - rng() * 0.01)).toFixed(2),
        type: "support",
        strength: 0.3 + rng() * 0.4,
      });
    }
    // 스탑 클러스터 (가장 얇은 구간)
    zones.push({
      price: +(currentPrice * (1 + 0.05 + rng() * 0.03)).toFixed(2),
      type: "stop_cluster",
      strength: 0.7 + rng() * 0.3,
    });
    zones.push({
      price: +(currentPrice * (1 - 0.05 - rng() * 0.03)).toFixed(2),
      type: "stop_cluster",
      strength: 0.7 + rng() * 0.3,
    });

    void tick;

    this.statuses.set(meta.id, {
      phase: "RESTING",
      direction: "NONE",
      active: false,
      sweepPrice: 0,
      sweepSize: 0,
      triggerAccount: null,
      ticksRemaining: 0,
      cooldownTicks: Math.floor(rng() * 15) + 10,
      recentSweeps: [],
      zones,
    });
  }

  tick(
    stock: Stock,
    meta: StockMeta,
    currentPrice: number,
    accounts: LPAccount[],
  ): SweepResult {
    const status = this.statuses.get(meta.id);
    if (!status) return { priceModifier: 0, forcedVolume: 0, direction: "NONE", trades: [] };

    const rng = mulberry32(hashStr(meta.id) + Math.floor(Date.now() / 3000));

    // 1. 활성 스윕 진행
    if (status.active && status.ticksRemaining > 0) {
      return this.executeSweep(stock, meta, currentPrice, status, rng);
    }

    // 2. 스윕 종료 → 쿨다운
    if (status.active && status.ticksRemaining <= 0) {
      status.active = false;
      status.phase = "RESTING";
      status.cooldownTicks = Math.floor(rng() * 20) + 15;
      this.logSweep(meta.id, status);
    }

    // 3. 쿨다운 감소
    if (status.cooldownTicks > 0) {
      status.cooldownTicks--;
      return { priceModifier: 0, forcedVolume: 0, direction: "NONE", trades: [] };
    }

    // 4. 스윕 발동 조건 체크
    return this.checkSweepTrigger(stock, meta, currentPrice, accounts, status, rng);
  }

  // 스윕 발동 조건: 대형 기관 + 유동성 얇은 구간 근처
  private checkSweepTrigger(
    stock: Stock,
    meta: StockMeta,
    currentPrice: number,
    accounts: LPAccount[],
    status: SweepStatus,
    rng: () => number,
  ): SweepResult {
    // 스윕 주도 가능한 계좌 필터 (대형 + 공격적)
    const sweepCapable = accounts.filter(
      (a) =>
        SWEEP_CAPABLE.includes(a.algoPattern) &&
        a.aggressiveness > 0.6 &&
        a.capital > 100 * TRILLION,
    );

    if (sweepCapable.length === 0) {
      return { priceModifier: 0, forcedVolume: 0, direction: "NONE", trades: [] };
    }

    // 가장 가까운 유동성 존 찾기
    const nearestZone = status.zones
      .map((z) => ({ ...z, distance: Math.abs(z.price - currentPrice) / currentPrice }))
      .sort((a, b) => a.distance - b.distance)[0];

    // 유동성 존이 2% 이내이고 강도가 0.5 이상 → 스윕 발동 확률
    if (nearestZone.distance < 0.02 && nearestZone.strength > 0.5) {
      // 발동 확률 = 존 강도 × 평균 공격성 × 랜덤
      const triggerProb = nearestZone.strength * (sweepCapable.length / 10) * rng();
      if (triggerProb > 0.15) {
        // 스윕 방향 결정
        const isUpSweep = nearestZone.price > currentPrice;
        const direction: SweepDirection = isUpSweep ? "UP_SWEEP" : "DOWN_SWEEP";
        const triggerAccount = sweepCapable[Math.floor(rng() * sweepCapable.length)];

        // 스윕 주문 물량 (시총 대비)
        const capRatio = meta.marketCap / TRILLION;
        const sweepSize = Math.floor(capRatio * 1000 * nearestZone.strength * triggerAccount.aggressiveness);

        status.active = true;
        status.direction = direction;
        status.phase = isUpSweep ? "SWEEP_UP" : "SWEEP_DOWN";
        status.sweepPrice = nearestZone.price;
        status.sweepSize = sweepSize;
        status.triggerAccount = triggerAccount.name;
        status.ticksRemaining = Math.floor(rng() * 3) + 2; // 2~4 tick 지속

        return this.executeSweep(stock, meta, currentPrice, status, rng);
      }
    }

    // 스탑 헌트 (하락 후 반등) — 낮은 확률로 발생
    if (rng() > 0.97) {
      const stopZone = status.zones.find((z) => z.type === "stop_cluster" && z.price < currentPrice);
      if (stopZone && Math.abs(stopZone.price - currentPrice) / currentPrice < 0.05) {
        const triggerAccount = sweepCapable[Math.floor(rng() * sweepCapable.length)];
        const capRatio = meta.marketCap / TRILLION;
        const sweepSize = Math.floor(capRatio * 800 * stopZone.strength * triggerAccount.aggressiveness);

        status.active = true;
        status.direction = "DOWN_SWEEP";
        status.phase = "STOP_HUNT";
        status.sweepPrice = stopZone.price;
        status.sweepSize = sweepSize;
        status.triggerAccount = triggerAccount.name;
        status.ticksRemaining = Math.floor(rng() * 2) + 2;

        return this.executeSweep(stock, meta, currentPrice, status, rng);
      }
    }

    return { priceModifier: 0, forcedVolume: 0, direction: "NONE", trades: [] };
  }

  private executeSweep(
    stock: Stock,
    meta: StockMeta,
    currentPrice: number,
    status: SweepStatus,
    rng: () => number,
  ): SweepResult {
    status.ticksRemaining--;

    const isUp = status.direction === "UP_SWEEP";
    const side: "buy" | "sell" = isUp ? "buy" : "sell";

    // 강한 가격 영향 — 얇은 구간을 급격히 뚫음
    const baseModifier = isUp ? 0.008 : -0.008;
    const intensityBonus = (1 - status.ticksRemaining / 4) * 0.005;
    const priceModifier = baseModifier + (isUp ? intensityBonus : -intensityBonus);

    // 강제 주문 물량 (틱마다 감소)
    const tickVolume = Math.floor(status.sweepSize * (0.4 + status.ticksRemaining * 0.15) * (0.8 + rng() * 0.4));

    // 체결 내역
    const trades: { side: "buy" | "sell"; price: number; size: number }[] = [];
    const tradeCount = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < tradeCount; i++) {
      const priceDrift = (rng() - 0.5) * currentPrice * 0.002;
      trades.push({
        side,
        price: +(currentPrice + (isUp ? Math.abs(priceDrift) : -Math.abs(priceDrift))).toFixed(2),
        size: Math.floor(tickVolume / tradeCount * (0.5 + rng())),
      });
    }

    void stock;
    void meta;

    return {
      priceModifier,
      forcedVolume: tickVolume,
      direction: status.direction,
      trades,
    };
  }

  private logSweep(stockId: string, status: SweepStatus) {
    status.recentSweeps.unshift({
      time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      direction: status.direction,
      price: status.sweepPrice,
      volume: status.sweepSize,
    });
    if (status.recentSweeps.length > 5) status.recentSweeps.pop();
  }

  getStatus(stockId: string): SweepStatus | null {
    return this.statuses.get(stockId) ?? null;
  }
}

let _sweepEngine: LiquiditySweepEngine | null = null;

export function getLiquiditySweepEngine(): LiquiditySweepEngine {
  if (!_sweepEngine) _sweepEngine = new LiquiditySweepEngine();
  return _sweepEngine;
}
