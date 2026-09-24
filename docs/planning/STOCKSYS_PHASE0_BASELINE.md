# STOCKSYS Phase 0 Baseline & Safety Specification

본 문서는 STOCKSYS 시뮬레이션 엔진의 체질 개선을 위한 Phase 0 기준선 및 안전 제약 조건을 정의한다.

---

## 1. 개요 및 현재 상태

| 항목 | Phase 0 기준선 상태 | 비고 |
| :--- | :--- | :--- |
| **런타임 TypeScript 파일 수** | 59개 | `lib/` 및 `engine-server/src` |
| **`engine-server` `Math.random()` 호출** | 36회 (초기 기준선) | Phase 1에서 Seeded PRNG로 전면 전환 대상 |
| **`lib/engine/simulation` `Math.random()`** | 0회 | 완벽한 결정론 코어 보존 |
| **레거시 Child Order 안전 제한** | 중앙화 완료 (`legacyOrderSafety.ts`) | 5,000,000 KRW / 5,000주 / Depth 10% |
| **시장조작(Spoofing/Layering)** | 기본 차단 (Fail-Closed) | `ENABLE_MARKET_ABUSE_SCENARIOS=true` 시에만 허용 |
| **루트 TypeScript / Next.js 빌드** | 통과 (`npm run build`) | Next.js 16.3.5 Turbopack |
| **독립 `engine-server` 빌드** | 타입 및 설정 경계 불일치 | Phase 1-E 해결 과제 |
| **운영 스키마 상태** | `archive/legacy-postgres` 부채 존재 | `institutional_portfolios` 등 VM DB 체크리스트 준수 |
| **의사결정 계층 구조** | 이원화 상태 | `lib/engine/simulation` (Canonical) vs `engine-server/src` |

---

## 2. 안전장치 및 주문 제한 (Order Safety)

### 2.1 레거시 Child Order 제한 (`legacyOrderSafety.ts`)
- **최대 주문 금액**: 5,000,000 KRW
- **최대 주문 수량**: 5,000 주
- **호가창 깊이 비율 상한**: 호가창 잔량의 최대 10% (`DEPTH_RATIO_CAP = 0.10`)
- **KRX 틱 사다리 정렬**:
  - 2,000원 미만: 1원
  - 2,000원 ~ 5,000원 미만: 5원
  - 5,000원 ~ 20,000원 미만: 10원
  - 20,000원 ~ 50,000원 미만: 50원
  - 50,000원 ~ 200,000원 미만: 100원
  - 200,000원 ~ 500,000원 미만: 500원
  - 500,000원 이상: 1,000원
- **원칙**: 전략 목표 수량(Portfolio Allocation Target)과 Child Order 제한을 동일시하지 않는다. 본 제한은 향후 Parent/Child 주문 엔진 분할 전까지 시스템 폭주를 방지하는 임시 안전장치이다.

### 2.2 시장조작(Market Abuse) 기능 격리 (`featureFlags.ts`)
- 일반적인 정상 기관 봇 및 프랍데스크에서 허수 주문(Spoofing), 호가 깔아두기 취소(Layering) 등 시장교란 행위는 원천 차단된다.
- 격리된 테스트 시나리오에서 오직 환경변수 `ENABLE_MARKET_ABUSE_SCENARIOS`가 정확히 `'true'`인 경우에만 활성화된다 (`"1"`, `"True"`, `"TRUE"` 등은 fail-closed 차단).

---

## 3. 데이터 보존 및 롤링 규칙

- **`trades` 테이블**: 최신 5,000건 유지 (Ring Buffer 롤링 슬라이딩 캡, 매 20틱 트리밍).
- **`stock_price_history` 테이블**: 최신 3,000건 유지.
- **`institutional_portfolios`**: 기관 봇의 영구 자산 장부로서 In-Place UPDATE 유지.
- **`SHADOW` 모드**: 실제 주문·체결·잔고·PRNG 지문에 일체 간섭하지 않는 무간섭성 보존.

---

## 4. 아키텍처 체질 개선 방향 (Phase 1)

1. **Simulation Context 도입**: 결정론적 Seed 기반 PRNG 스트림 분기(`fork(namespace)`), 가상 시뮬레이션 클록 분리.
2. **라이브 엔진 비결정성 제거**: `engine-server/src`의 36개 `Math.random()` 전면 교체.
3. **공통 참여자 도메인 경계 구축**: `ParticipantAccount`, `ParticipantIdentity`, 순수 변환 어댑터 제공.
4. **독립 `engine-server` 컴파일 경계 복구**: TypeScript strict 컴파일 통과.
