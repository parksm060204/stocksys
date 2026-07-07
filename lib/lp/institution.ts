import { TRILLION } from "./config";
import type { StockMeta } from "./types";

export type InstitutionState =
  | "IDLE"
  | "ACCUMULATING"
  | "MARKUP"
  | "DISTRIBUTING"
  | "COMPLETE";

export interface InstitutionOrder {
  side: "buy" | "sell";
  price: number;
  size: number;
  isWall: boolean;
}

export interface InstitutionTrade {
  side: "buy" | "sell";
  price: number;
  size: number;
}

export interface InstitutionTickResult {
  orders: InstitutionOrder[];
  trades: InstitutionTrade[];
  priceModifier: number;
}

export interface InstitutionHistoryEntry {
  time: string;
  phase: string;
  detail: string;
}

export interface InstitutionStatus {
  state: InstitutionState;
  phaseLabel: string;
  message: string;
  targetStockId: string | null;
  targetStockName: string | null;
  targetTicker: string | null;
  startPrice: number;
  currentPrice: number;
  priceChangePct: number;
  accumulatedShares: number;
  accumulatedPct: number;
  avgBuyPrice: number;
  distributedShares: number;
  distributedPct: number;
  realizedPnl: number;
  realizedPnlPct: number;
  totalInvested: number;
  totalRecovered: number;
  availableCash: number;
  tickCount: number;
  history: InstitutionHistoryEntry[];
}

const ACCUMULATION_TARGET_PCT = 0.03;
const MARKUP_TARGET_PCT = 0.25;
const ACCUMULATION_TICKS_MAX = 40;
const MARKUP_TICKS_MAX = 12;
const DISTRIBUTION_TICKS_TARGET = 25;

export class Institution {
  id = "INSTITUTION-01";
  name = "그림자 세력";

  state: InstitutionState = "IDLE";
  targetStockId: string | null = null;
  targetStockMeta: StockMeta | null = null;

  capital: number = 50 * TRILLION;
  availableCash: number = 50 * TRILLION;

  accumulatedShares = 0;
  accumulatedCost = 0;
  avgBuyPrice = 0;

  distributedShares = 0;
  realizedRevenue = 0;

  startPrice = 0;
  markupTarget = 0;

  tickCount = 0;
  phaseTicks = 0;

  history: InstitutionHistoryEntry[] = [];
  currentPrice = 0;

  setTarget(meta: StockMeta, currentPrice: number) {
    this.targetStockId = meta.id;
    this.targetStockMeta = meta;
    this.state = "ACCUMULATING";
    this.accumulatedShares = 0;
    this.accumulatedCost = 0;
    this.avgBuyPrice = 0;
    this.distributedShares = 0;
    this.realizedRevenue = 0;
    this.startPrice = currentPrice;
    this.markupTarget = currentPrice * (1 + MARKUP_TARGET_PCT);
    this.tickCount = 0;
    this.phaseTicks = 0;
    this.availableCash = this.capital;
    this.currentPrice = currentPrice;
    this.history = [];
    this.log("ACCUMULATE_START", `${meta.name}(${meta.ticker}) 세력 작업 개시 — 매집 phase 진입`);
  }

  stop() {
    this.log("STOP", "세력 작업 강제 중단");
    this.state = "IDLE";
    this.targetStockId = null;
    this.targetStockMeta = null;
  }

  reset() {
    this.state = "IDLE";
    this.targetStockId = null;
    this.targetStockMeta = null;
    this.accumulatedShares = 0;
    this.accumulatedCost = 0;
    this.avgBuyPrice = 0;
    this.distributedShares = 0;
    this.realizedRevenue = 0;
    this.availableCash = this.capital;
    this.history = [];
    this.tickCount = 0;
    this.phaseTicks = 0;
  }

  tick(currentPrice: number): InstitutionTickResult {
    this.currentPrice = currentPrice;
    if (this.state === "IDLE" || this.state === "COMPLETE" || !this.targetStockMeta) {
      return { orders: [], trades: [], priceModifier: 0 };
    }

    this.tickCount++;
    this.phaseTicks++;

    switch (this.state) {
      case "ACCUMULATING":
        return this.tickAccumulate(currentPrice);
      case "MARKUP":
        return this.tickMarkup(currentPrice);
      case "DISTRIBUTING":
        return this.tickDistribute(currentPrice);
      default:
        return { orders: [], trades: [], priceModifier: 0 };
    }
  }

  // === Phase 1: 매집 — 주가를 누르면서 저가에 소량씩 매수 ===
  private tickAccumulate(currentPrice: number): InstitutionTickResult {
    const meta = this.targetStockMeta!;
    const targetShares = Math.floor(meta.sharesOutstanding * ACCUMULATION_TARGET_PCT);
    const remaining = targetShares - this.accumulatedShares;
    const ticksLeft = Math.max(ACCUMULATION_TICKS_MAX - this.phaseTicks, 1);
    const sharesThisTick = Math.max(Math.floor(remaining / ticksLeft), 1);
    const affordable = Math.floor(this.availableCash / currentPrice);
    const actualBuy = Math.min(sharesThisTick, affordable);

    if (actualBuy > 0) {
      this.accumulatedShares += actualBuy;
      this.accumulatedCost += actualBuy * currentPrice;
      this.avgBuyPrice = this.accumulatedCost / this.accumulatedShares;
      this.availableCash -= actualBuy * currentPrice;
    }

    // --- 매도벽 (주가 억제 / capping) ---
    const orders: InstitutionOrder[] = [];
    const tick = Math.max(currentPrice * 0.004, 1);
    const wallBase = Math.max(meta.marketCap / currentPrice * 0.0012, 5000);
    for (let i = 1; i <= 5; i++) {
      orders.push({
        side: "sell",
        price: +(currentPrice + tick * i).toFixed(2),
        size: Math.floor(wallBase * (1.2 - i * 0.1)),
        isWall: true,
      });
    }

    // --- 소량 매수 (iceberg) ---
    if (actualBuy > 0) {
      orders.push({
        side: "buy",
        price: +(currentPrice * 0.998).toFixed(2),
        size: actualBuy,
        isWall: false,
      });
    }

    const trades: InstitutionTrade[] = actualBuy > 0
      ? [{ side: "buy", price: currentPrice, size: actualBuy }]
      : [];

    // 약한 하방 압력
    const priceModifier = -0.0006;

    // 전환 조건: 3% 매집 완료
    const accumulatedPct = this.accumulatedShares / meta.sharesOutstanding;
    if (accumulatedPct >= ACCUMULATION_TARGET_PCT || this.phaseTicks >= ACCUMULATION_TICKS_MAX) {
      this.state = "MARKUP";
      this.phaseTicks = 0;
      this.log(
        "PHASE_CHANGE",
        `매집 완료 → 시세 조종 phase | ${this.accumulatedShares.toLocaleString()}주 (${(accumulatedPct * 100).toFixed(2)}%) @ ${Math.round(this.avgBuyPrice).toLocaleString()}`,
      );
    }

    return { orders, trades, priceModifier };
  }

  // === Phase 2: 시세 조종 — 급상승 연출로 개미 유인 ===
  private tickMarkup(currentPrice: number): InstitutionTickResult {
    const meta = this.targetStockMeta!;

    // 공격적 시장가 매수 (ramping)
    const rampSize = Math.floor(meta.marketCap / currentPrice * 0.0025);
    const rampPrice = +(currentPrice * 1.008).toFixed(2);

    const orders: InstitutionOrder[] = [
      { side: "buy", price: rampPrice, size: rampSize, isWall: false },
    ];

    // 연속 상승봉 패턴 (self-crossing wash trades로 거래량 부풀리기)
    const trades: InstitutionTrade[] = [
      { side: "buy", price: rampPrice, size: rampSize },
      { side: "buy", price: +(currentPrice * 1.004).toFixed(2), size: Math.floor(rampSize * 0.6) },
    ];

    // 강한 상방 압력
    const priceModifier = 0.004;

    // 전환 조건: 목표가 도달 또는 최대 틱 수
    if (currentPrice >= this.markupTarget || this.phaseTicks >= MARKUP_TICKS_MAX) {
      this.state = "DISTRIBUTING";
      this.phaseTicks = 0;
      const changePct = ((currentPrice / this.startPrice - 1) * 100).toFixed(1);
      this.log(
        "PHASE_CHANGE",
        `시세 조종 완료 → 분배 phase | 현재가 ${Math.round(currentPrice).toLocaleString()} (시작가 대비 +${changePct}%)`,
      );
    }

    return { orders, trades, priceModifier };
  }

  // === Phase 3: 분배 — 상승세 유지하며 보유 주식 매도 ===
  private tickDistribute(currentPrice: number): InstitutionTickResult {
    const meta = this.targetStockMeta!;
    const remaining = this.accumulatedShares - this.distributedShares;
    const ticksLeft = Math.max(DISTRIBUTION_TICKS_TARGET - this.phaseTicks, 1);
    const sellThisTick = Math.max(Math.floor(remaining / ticksLeft), 1);
    const actualSell = Math.min(sellThisTick, remaining);

    if (actualSell > 0) {
      this.distributedShares += actualSell;
      const sellPrice = +(currentPrice * 1.002).toFixed(2);
      this.realizedRevenue += actualSell * sellPrice;
      this.availableCash += actualSell * sellPrice;
    }

    // --- 매수 지지벽 (개미에게 강세로 보이게 / support) ---
    const orders: InstitutionOrder[] = [];
    const tick = Math.max(currentPrice * 0.004, 1);
    const wallBase = Math.max(meta.marketCap / currentPrice * 0.0015, 8000);
    for (let i = 1; i <= 5; i++) {
      orders.push({
        side: "buy",
        price: +(currentPrice - tick * i).toFixed(2),
        size: Math.floor(wallBase * (1.3 - i * 0.1)),
        isWall: true,
      });
    }

    // --- 매도 (분배) ---
    if (actualSell > 0) {
      orders.push({
        side: "sell",
        price: +(currentPrice * 1.002).toFixed(2),
        size: actualSell,
        isWall: false,
      });
    }

    const trades: InstitutionTrade[] = actualSell > 0
      ? [{ side: "sell", price: +(currentPrice * 1.002).toFixed(2), size: actualSell }]
      : [];

    // 미약한 상방 압력 (주가 유지하면서 매도)
    const priceModifier = 0.0008;

    // 완료 조건: 전량 매도
    if (this.distributedShares >= this.accumulatedShares) {
      const totalCost = this.accumulatedCost;
      const totalRevenue = this.realizedRevenue;
      const pnl = totalRevenue - totalCost;
      const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
      this.state = "COMPLETE";
      this.log(
        "COMPLETE",
        `세력 작업 종료 | 매수 ${this.accumulatedShares.toLocaleString()}주 @ ${Math.round(this.avgBuyPrice).toLocaleString()} → 매도 ${this.distributedShares.toLocaleString()}주 | 실현 수익 ${pnl >= 0 ? "+" : ""}${Math.round(pnl).toLocaleString()} (${pnlPct.toFixed(1)}%)`,
      );
    }

    return { orders, trades, priceModifier };
  }

  private log(phase: string, detail: string) {
    this.history.unshift({
      time: new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      phase,
      detail,
    });
    if (this.history.length > 30) this.history.pop();
  }

  getStatus(): InstitutionStatus {
    const meta = this.targetStockMeta;
    const accumulatedPct =
      meta && this.accumulatedShares > 0
        ? (this.accumulatedShares / meta.sharesOutstanding) * 100
        : 0;
    const distributedPct =
      this.accumulatedShares > 0
        ? (this.distributedShares / this.accumulatedShares) * 100
        : 0;
    const realizedPnl =
      this.realizedRevenue -
      this.accumulatedCost * (this.distributedShares / Math.max(this.accumulatedShares, 1));
    const realizedPnlPct =
      this.accumulatedCost > 0 && this.distributedShares > 0
        ? (realizedPnl / (this.accumulatedCost * (this.distributedShares / this.accumulatedShares))) * 100
        : 0;
    const priceChangePct =
      this.startPrice > 0
        ? ((this.currentPrice / this.startPrice - 1) * 100)
        : 0;

    return {
      state: this.state,
      phaseLabel: this.stateLabel(),
      message: this.stateMessage(),
      targetStockId: this.targetStockId,
      targetStockName: meta?.name ?? null,
      targetTicker: meta?.ticker ?? null,
      startPrice: this.startPrice,
      currentPrice: this.currentPrice,
      priceChangePct,
      accumulatedShares: this.accumulatedShares,
      accumulatedPct,
      avgBuyPrice: this.avgBuyPrice,
      distributedShares: this.distributedShares,
      distributedPct,
      realizedPnl,
      realizedPnlPct,
      totalInvested: this.accumulatedCost,
      totalRecovered: this.realizedRevenue,
      availableCash: this.availableCash,
      tickCount: this.tickCount,
      history: this.history,
    };
  }

  private stateLabel(): string {
    switch (this.state) {
      case "IDLE": return "대기";
      case "ACCUMULATING": return "매집 중 (주가 억제)";
      case "MARKUP": return "시세 조종 중 (급상승 연출)";
      case "DISTRIBUTING": return "분배 중 (개미 유인 매도)";
      case "COMPLETE": return "작업 완료";
    }
  }

  private stateMessage(): string {
    switch (this.state) {
      case "IDLE": return "관리자에서 종목을 지정하면 작업을 시작합니다";
      case "ACCUMULATING": return "주가를 누르면서 저가에 매집하는 중…";
      case "MARKUP": return "급상승을 연출하여 개미 투자자를 유인하는 중…";
      case "DISTRIBUTING": return "상승세를 유지하며 보유 주식을 매도하는 중…";
      case "COMPLETE": return "전량 매도 완료. 새 종목을 지정할 수 있습니다.";
    }
  }
}

let _institution: Institution | null = null;

export function getInstitution(): Institution {
  if (!_institution) _institution = new Institution();
  return _institution;
}
