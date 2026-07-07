import { TRILLION } from "./config";
import type { LPAccount, StockMeta } from "./types";

export type GammaState = "FLAT" | "LONG_GAMMA" | "SHORT_GAMMA" | "SQUEEZE_ACTIVE";

export interface GammaSqueezeStatus {
  state: GammaState;
  dealerNetGamma: number;    // 딜러 순 감마 포지션 (양수=롱감마, 음수=숏감마)
  callOpenInterest: number;  // 콜 옵션 미결제 약정
  putOpenInterest: number;   // 풋 옵션 미결제 약정
  triggerPrice: number;      // 스퀴즈 발동 가격 (콜 매콜레벨)
  gammaExposure: number;     // 가격 1% 상승 시 딜러가 매수해야 하는 물량
  squeezePressure: number;   // 0~1, 스퀴즈 압력 강도
  activeTicks: number;       // 스퀴즈 진행 틱 수
  history: { time: string; event: string }[];
}

export interface GammaSqueezeResult {
  priceModifier: number;    // 가격에 가하는 영향
  forcedBuyVolume: number;  // 딜러 강제 매수 물량
  state: GammaState;
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

export class GammaSqueezeEngine {
  statuses: Map<string, GammaSqueezeStatus> = new Map();

  // 종목별 감마 환경 초기화
  // — IB 계좌(MARKET_MAKER)가 많이 참여할수록 옵션 미결제 약정↑
  initStock(meta: StockMeta, currentPrice: number, accounts: LPAccount[]) {
    const rng = mulberry32(hashStr(meta.id + "gamma"));

    // IB + 사모펀드가 옵션을 많이 발행/매수
    const ibCount = accounts.filter((a) => a.playerType === "IB").length;
    const hedgeCount = accounts.filter((a) => a.playerType === "PE_HEDGE").length;
    const totalOptionPlayers = ibCount + hedgeCount;

    // 시총 대비 옵션 미결제 약정 (시총이 클수록 옵션도 많음)
    const capRatio = meta.marketCap / TRILLION;
    const baseOI = Math.max(capRatio * 100_000, 50_000);

    const callOI = Math.floor(baseOI * (0.5 + rng() * 0.3) * (1 + totalOptionPlayers * 0.05));
    const putOI = Math.floor(baseOI * (0.3 + rng() * 0.2) * (1 + totalOptionPlayers * 0.03));

    // 딜러(마켓메이커)는 콜을 매도(숏)하므로 풋을 매도하면 롱감마
    // 콜 매도가 많으면 숏감마 → 스퀴즈 위험
    const netGamma = (putOI - callOI) * 0.001; // 음수면 숏감마

    // 스퀴즈 발동 가격 (현재가 + 5~15%)
    const triggerPrice = currentPrice * (1.05 + rng() * 0.10);

    const dealerGammaPer1Pct = Math.floor(callOI * 0.05 * (1 + ibCount * 0.1));

    this.statuses.set(meta.id, {
      state: netGamma < 0 ? "SHORT_GAMMA" : "LONG_GAMMA",
      dealerNetGamma: netGamma,
      callOpenInterest: callOI,
      putOpenInterest: putOI,
      triggerPrice,
      gammaExposure: dealerGammaPer1Pct,
      squeezePressure: 0,
      activeTicks: 0,
      history: [],
    });
  }

  tick(meta: StockMeta, currentPrice: number): GammaSqueezeResult {
    const status = this.statuses.get(meta.id);
    if (!status) return { priceModifier: 0, forcedBuyVolume: 0, state: "FLAT" };

    const rng = mulberry32(hashStr(meta.id) + Math.floor(Date.now() / 2000));

    // 1. 숏감마 상태에서 가격이 상승하면 딜러가 매수해야 함
    if (status.state === "SHORT_GAMMA") {
      const pricePctAbove = (currentPrice / status.triggerPrice - 1) * 100;

      // 트리거 가격 근처 → 스퀴즈 압력 증가
      if (currentPrice >= status.triggerPrice * 0.97) {
        const pressure = Math.min((pricePctAbove + 3) / 10, 1);
        status.squeezePressure = Math.max(status.squeezePressure, pressure);

        // 압력이 0.7 이상이면 스퀴즈 발동
        if (status.squeezePressure >= 0.7) {
          status.state = "SQUEEZE_ACTIVE";
          status.activeTicks = 0;
          this.log(meta.id, `감마스퀴즈 발동! 트리거가 ${Math.round(status.triggerPrice).toLocaleString()} 돌파 — 딜러 강제 매수 시작`);
        }
      }
    }

    // 2. 스퀴즈 활성화 → 딜러가 매수하며 가격 밀어올림
    if (status.state === "SQUEEZE_ACTIVE") {
      status.activeTicks++;

      // 강제 매수 물량 = 감마 노출 × 현재 가격 상승률
      const priceRisePct = Math.abs(currentPrice / status.triggerPrice - 1) * 100;
      const forcedBuy = Math.floor(status.gammaExposure * (priceRisePct / 100) * (1 + status.activeTicks * 0.1));
      const priceModifier = 0.003 + status.squeezePressure * 0.007; // 0.3~1%/tick

      // 스퀴즈는 5~10 tick 후 자연 소멸 (딜러가 헤징 완료)
      if (status.activeTicks >= 8 || rng() > 0.8) {
        status.state = "LONG_GAMMA"; // 딜러가 롱감마로 전환 (매수 헤징 완료)
        status.squeezePressure *= 0.5;
        this.log(meta.id, `감마스퀴즈 종료 — 딜러 헤징 완료, 롱감마 전환 (강제 매수 ${forcedBuy.toLocaleString()}주)`);
      }

      return { priceModifier, forcedBuyVolume: forcedBuy, state: status.state };
    }

    // 3. 일반 숏감마 — 약한 매수 압력
    if (status.state === "SHORT_GAMMA" && currentPrice > status.triggerPrice * 0.95) {
      const weakPressure = status.squeezePressure * 0.002;
      return { priceModifier: weakPressure, forcedBuyVolume: 0, state: status.state };
    }

    // 4. 롱감마 — 가격 하락 시 딜러 매수, 상승 시 매도 (안정화)
    if (status.state === "LONG_GAMMA") {
      const stabilizer = -0.0005; // 약한 평균회귀
      return { priceModifier: stabilizer, forcedBuyVolume: 0, state: status.state };
    }

    return { priceModifier: 0, forcedBuyVolume: 0, state: status.state };
  }

  private log(stockId: string, event: string) {
    const status = this.statuses.get(stockId);
    if (!status) return;
    status.history.unshift({
      time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      event,
    });
    if (status.history.length > 10) status.history.pop();
  }

  getStatus(stockId: string): GammaSqueezeStatus | null {
    return this.statuses.get(stockId) ?? null;
  }
}

let _gammaEngine: GammaSqueezeEngine | null = null;

export function getGammaEngine(): GammaSqueezeEngine {
  if (!_gammaEngine) _gammaEngine = new GammaSqueezeEngine();
  return _gammaEngine;
}
