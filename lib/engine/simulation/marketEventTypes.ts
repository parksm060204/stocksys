/**
 * STOCKSYS Single Source of Truth Market Event System
 *
 * Defines:
 * - Structured economic market events decoupled from UI strings but bound by eventId
 * - Valuation signals, non-directional attention shocks, uncertainty shocks, and half-life decay
 * - Canonical sector & stock ID mappings (strictly isolating non-equity tickers like US10Y)
 * - Idempotency tracking to prevent double-processing across polling or replay
 * - Deterministic template event generators operable without external API keys
 */

import { memoryDb, StockRecord } from '../../memoryDb/memoryStore';

export type EventScope = 'market' | 'sector' | 'stock';
export type EventCategory = 'OFFICIAL' | 'RUMOR' | 'CORRECTION';

export interface MarketEvent {
  eventId: string;
  sourceEventId?: string;
  publishedAt: number;        // simulationTime (seconds)
  effectiveFrom: number;      // simulationTime (seconds)
  scope: EventScope;
  targetStockIds: string[];   // Canonical stock IDs
  sectorId?: string;          // Canonical sector ID ('semiconductor', 'auto', 'energy', etc.)
  themeIds?: string[];
  eventType: EventCategory;
  valuationSignal: number;    // Directional signal: -1.0 (strong bear) to +1.0 (strong bull)
  attentionShock: number;     // Non-directional attention shock: 0.0 to 1.0 (bad news also shocks attention)
  uncertaintyShock: number;   // Uncertainty shock: 0.0 to 1.0 (widens LP spread, reduces depth)
  confidence: number;         // 0.0 to 1.0
  halfLife: number;           // Decay half-life in simulation seconds (e.g. 30s)
  originalEventId?: string;   // Pointer to original rumor event for CORRECTION
  isRumorFake?: boolean;      // Internal simulation truth (bots cannot peek before correction)
  // Display metadata for UI & terminal
  publisher: string;
  title: string;
  content: string;
}

/**
 * Normalizes user/template sector strings to canonical sector IDs
 */
export function normalizeSectorId(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase().trim();
  if (s.includes('반도체') || s.includes('semi') || s.includes('chip')) return 'semiconductor';
  if (s.includes('자동차') || s.includes('auto') || s.includes('mobility') || s.includes('ev')) return 'auto';
  if (s.includes('에너지') || s.includes('energy') || s.includes('oil')) return 'energy';
  if (s.includes('it') || s.includes('소프트') || s.includes('플랫폼') || s.includes('tech') || s.includes('테크')) return 'it';
  if (s.includes('금융') || s.includes('finance') || s.includes('bank')) return 'finance';
  if (s.includes('바이오') || s.includes('bio') || s.includes('health')) return 'bio';
  if (s.includes('통신') || s.includes('telecom')) return 'telecom';
  if (s.includes('지수') || s.includes('index') || s.includes('etf')) return 'index';
  return undefined;
}

/**
 * Resolves canonical stock IDs for an event scope.
 * Explicitly rejects or isolates non-equity tickers (e.g. 'US10Y', 'GC00', 'WTI').
 */
export function resolveTargetStockIds(
  scope: EventScope,
  targetTickers?: (string | null | undefined)[],
  sectorId?: string
): string[] {
  const stockIds: string[] = [];

  if (scope === 'market') {
    // Market-wide event applies to all active stocks
    for (const stock of memoryDb.stocks.values()) {
      stockIds.push(stock.id);
    }
    return stockIds;
  }

  if (scope === 'sector' && sectorId) {
    const canonicalSector = normalizeSectorId(sectorId);
    for (const stock of memoryDb.stocks.values()) {
      if (stock.sector_id === canonicalSector) {
        stockIds.push(stock.id);
      }
    }
    return stockIds;
  }

  // Stock-specific scope: resolve tickers, ignoring non-equity tickers
  if (targetTickers) {
    const NON_EQUITY_TICKERS = new Set(['US10Y', 'KR10Y', 'KRW', 'USD', 'GC00', 'CL00', 'WTI', 'BRENT', 'GOLD']);
    for (const rawTicker of targetTickers) {
      if (!rawTicker) continue;
      const cleanTicker = rawTicker.trim().toUpperCase().replace('$', '');
      if (NON_EQUITY_TICKERS.has(cleanTicker)) {
        // Explicitly isolated from equity engine
        continue;
      }
      const stockId = memoryDb.tickerIndex.get(cleanTicker);
      if (stockId && !stockIds.includes(stockId)) {
        stockIds.push(stockId);
      }
    }
  }

  return stockIds;
}

/**
 * Tracks processed event IDs to guarantee idempotency across multiple receivers/polls
 */
export class EventIdempotencyTracker {
  private processedIds: Set<string> = new Set();
  private maxHistory: number = 2000;

  public has(eventId: string): boolean {
    return this.processedIds.has(eventId);
  }

  public record(eventId: string): boolean {
    if (this.processedIds.has(eventId)) {
      return false; // Already processed
    }
    this.processedIds.add(eventId);
    if (this.processedIds.size > this.maxHistory) {
      // Trim oldest items
      const arr = Array.from(this.processedIds);
      this.processedIds = new Set(arr.slice(arr.length - 1000));
    }
    return true;
  }

  public reset(): void {
    this.processedIds.clear();
  }
}

/**
 * Deterministic template definitions for generating seed/runtime news events
 */
export interface EventTemplate {
  scope: EventScope;
  sectorId?: string;
  targetTickers?: string[];
  eventType: EventCategory;
  valuationSignal: number;
  attentionShock: number;
  uncertaintyShock: number;
  confidence: number;
  halfLife: number;
  publisher: string;
  title: string;
  content: string;
  isRumorFake?: boolean;
}

export const SEED_EVENT_TEMPLATES: EventTemplate[] = [
  // 1. Sector Bull: Semiconductor Breakthrough
  {
    scope: 'sector',
    sectorId: 'semiconductor',
    eventType: 'OFFICIAL',
    valuationSignal: 0.25,
    attentionShock: 0.60,
    uncertaintyShock: 0.10,
    confidence: 0.90,
    halfLife: 45,
    publisher: '스트리트 리포트',
    title: '차세대 3D 패키징 수율 90% 돌파… 반도체 업계 슈퍼 사이클 진입',
    content: '1. AI 가속기용 초고대역폭 메모리 공급 쇼티지 심화\n2. 주요 파운드리 및 메모리 수주 물량 2027년까지 완판\n3. 하반기 영업이익률 대폭 개선 전망',
  },
  // 2. Stock Bull: 0010 오성전자 대규모 수주
  {
    scope: 'stock',
    targetTickers: ['0010'],
    eventType: 'OFFICIAL',
    valuationSignal: 0.35,
    attentionShock: 0.75,
    uncertaintyShock: 0.15,
    confidence: 0.95,
    halfLife: 50,
    publisher: '월스트리트저널',
    title: '오성전자, 글로벌 빅테크와 12조원 규모 맞춤형 AI 칩 턴키 계약 체결',
    content: '1. 차세대 데이터센터 핵심 칩 독점 공급사 확정\n2. 단일 계약 기준 창사 이래 최대 규모\n3. 3분기부터 실적 반영 시작',
  },
  // 3. Stock Bear: 0020 에코에너지 유상증자 및 설비 지연 (악재지만 관심 폭증)
  {
    scope: 'stock',
    targetTickers: ['0020'],
    eventType: 'OFFICIAL',
    valuationSignal: -0.30,
    attentionShock: 0.80, // 악재여도 관심 폭증!
    uncertaintyShock: 0.60, // 높은 불확실성
    confidence: 0.90,
    halfLife: 40,
    publisher: '캐피탈 옵저버',
    title: '에코에너지, 500억 규모 시설자금 유상증자 결정… 주주가치 희석 우려',
    content: '1. 신규 2차전지 소재 라인 증설 비용 급증\n2. 신주발행가 기준 기존 주가 대비 25% 할인율 적용\n3. 유동성 리스크 및 투자 심리 급랭',
  },
  // 4. Sector Bear: Auto 원자재 급등 및 마진 압박
  {
    scope: 'sector',
    sectorId: 'auto',
    eventType: 'OFFICIAL',
    valuationSignal: -0.20,
    attentionShock: 0.50,
    uncertaintyShock: 0.35,
    confidence: 0.85,
    halfLife: 35,
    publisher: '블룸버그 터미널',
    title: '글로벌 관세 인상 및 핵심 전장 부품 공급 차질로 완성차 수익성 악화',
    content: '1. 주요 수출국 보호무역 조치 발표로 추가 관세 부과\n2. 물류비용 및 희토류 가격 급등으로 대당 마진 3%p 하락\n3. 주요 완성차 업체 연간 가이던스 하향 조정',
  },
  // 5. Stock Rumor: 0025 NVC 비공식 피인수 소문 (미확인 찌라시)
  {
    scope: 'stock',
    targetTickers: ['0025'],
    eventType: 'RUMOR',
    valuationSignal: 0.40,
    attentionShock: 0.85,
    uncertaintyShock: 0.70, // 극도의 불확실성
    confidence: 0.50,
    halfLife: 25,
    publisher: '가십 썬',
    title: '[찌라시] IT 강소기업 NVC, 글로벌 빅테크 비밀 경영권 인수 타진설',
    content: '1. 해외 사모펀드 컨소시엄과 프리미엄 40% 경영권 양수도 협상 소문\n2. 이사회 측 극비 실사 진행 정황 포착\n3. 확인되지 않은 시장 루머로 급등락 주의 요망',
    isRumorFake: true, // 시뮬레이션 내부 진실 (거짓 루머)
  },
];
