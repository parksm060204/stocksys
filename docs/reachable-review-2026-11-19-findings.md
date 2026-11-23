# 실행 경로·재현 근거 중심 코드/보안 리뷰 보고서 (2026-11-19)

## 1. 리뷰 기준 및 요약

- **리뷰 대상**: `HEAD 7008f55` 및 현재 워크트리의 모든 미커밋 수정·신규 파일(`app/`, `lib/`, `engine-server/src/`, `proxy.ts`, `instrumentation.ts`).
- **작업 원칙**: 읽기 전용 리뷰(애플리케이션·테스트·설정·기존 문서·`.data` 및 `.next` 빌드 미수정). 모든 확정 결함은 **실행 재현**과 **정적 경로 연결**을 명확히 구분하고, 기본 상태에서 재현되지 않거나 private 메서드·임의 상태 주입에 의존한 항목은 `의심·미검증`으로 분류했다.
- **활성 모드 경계**: 현재 저장소의 활성 저장 경로는 `lib/memoryDb/`(`MemoryDatabase` + `PersistenceManager`)이며, `vm-db/`는 `archive/legacy-postgres/`로 아카이브되어 있다. 실행 모드는 ① Next.js 로컬 스탠드얼론(`NEXT_PUBLIC_USE_IN_MEMORY=true`, `LocalMarketEngineInstance` + `AgentManager` + `CommodityMarketEngine`)과 ② 별도 프로세스 `engine-server`(`MarketEngine` + `SettlementBatchService`, `.data/engine-server`)로 구분된다.

### 영역별 확정 / 의심·미검증 집계

| 영역 | 확정 건수 (심각도) | 의심·미검증 건수 |
| --- | --- | --- |
| 1. 인증·인가·공개 데이터/API | 2건 (`P1` 2) | 1건 |
| 2. 주문·금전·부채·정산 | 2건 (`P1` 1, `P2` 1) | 1건 |
| 3. 동시성·영속성·실패 복구 | 1건 (`P2` 1) | 2건 |
| 4. 시드·마이그레이션·파생 | 0건 | 0건 |
| 5. 봇·시장·프론트엔드 | 4건 (`P1` 2, `P2` 2) | 1건 |
| 6. 운영·설정·검증 | 0건 | 1건 |
| **합계** | **9건 (`P0` 0 / `P1` 5 / `P2` 4)** | **6건** |

---

## 2. 확정 결함 상세

### [RR-01] `/api/local-db` 뉴스 테이블(`NEWS_TABLES`) 필터·정렬 오라클로 미구독/비인증 사용자에게 `is_fake` 및 유료 찌라시 본문 추론 허용
- **ID / 심각도**: `RR-01` / **P1**
- **영역**: 1. 인증·인가·공개 데이터/API
- **영향**: 비인증 사용자 또는 유료 언론사 미구독 일반 사용자가 유료 `RUMOR` 기사의 숨겨진 참/거짓 진실 플래그(`is_fake`)와 마스킹된 본문(`content`, `summary`, `body`) 문자열을 필터/정렬 응답 포함 여부로 추출(오라클 공격)할 수 있다.
- **발생 조건 / 권한 / 실행 모드**:
  - 로컬 스탠드얼론 모드(`POST /api/local-db`), `market_news`/`news`/`news_v2`에 `RUMOR` 또는 `is_fake` 필드를 가진 뉴스가 존재할 때.
  - 비인증 사용자(`NEXT_PUBLIC_DISABLE_GUEST_AUTH=true` 또는 `NODE_ENV=production`) 또는 관리자·뉴스 구독권이 없는 일반 로그인 사용자(`hasRumorAccess === false`).
- **실제 진입점과 호출 경로**:
  `POST /api/local-db` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts:90`) → `PUBLIC_READ_TABLES.has(tableName)` 분기 (`/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts:271`) → `applyQueryOptions(qb, query)` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts:295`, `/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts:654`) → `MemoryQueryBuilder.applyFilters()` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryDbClient.ts:410`) → 이후 `authorizeNewsRecord(r, hasRumorAccess)` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts:62`, `/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts:315`).
- **좁은 위치**:
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts:294` (`294~317행`: `trades`와 달리 `NEWS_TABLES`에는 허용 필터/정렬 컬럼 화이트리스트가 없고, `qb.execute()`로 필터·정렬·`limit`를 먼저 적용한 뒤 `authorizeNewsRecord`로 마스킹·필드 제거를 수행함)
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts:62` (`62~81행`: `RUMOR` 본문 마스킹 및 `sanitizePublicNewsRecord` 호출)
- **기대 vs 관측**:
  - 기대: `hasRumorAccess === false`인 요청에서는 `is_fake`/`isRumorFake`/`correctedAt` 및 마스킹 대상 `content`/`summary`/`body` 컬럼에 대한 필터·정렬을 차단하거나 마스킹 이후에만 적용해야 한다.
  - 관측: `is_fake = true` 동등 필터와 `content` `gt`/`lt` 범위 필터 모두 `HTTP 200`으로 대상 뉴스 레코드를 반환(응답은 `locked: true`, `is_fake` 키 부재, `content` 마스킹 상태이지만 필터 적중 여부로 원문과 `is_fake` 진위 판별 가능).
- **최소 재현 코드 / 실행법 / 결과**:
  - 스크립트: `/C:/Users/abcde/.gemini/antigravity-cli/brain/3caaf7fe-b740-4042-9d3d-03a869892383/scratch/verify_defects.ts:44` (`44~106행`, `NEXT_PUBLIC_DISABLE_GUEST_AUTH=true` 및 임시 `STOCKSYS_DATA_DIR` 생성 후 `finally`에서 삭제)
  - 최소 요청 페이로드:
    ```json
    {
      "action": "execute",
      "tableName": "market_news",
      "query": {
        "action": "select",
        "filters": [
          { "col": "is_fake", "op": "eq", "val": true },
          { "col": "content", "op": "gt", "val": "SECRET_ALPHA_" },
          { "col": "content", "op": "lt", "val": "SECRET_ALPHA_Z" }
        ]
      }
    }
    ```
  - 실행 명령: `node --import tsx "C:\Users\abcde\.gemini\antigravity-cli\brain\3caaf7fe-b740-4042-9d3d-03a869892383\scratch\verify_defects.ts"`
  - 결과:
    `V1 is_fake=true filter status: 200 matched: [ 'news_oracle_probe_1' ] locked: true is_fake_field_present: false`
    `V1 content range oracle count: 1 returned content: [프리미엄 구독 필요] 언론사 구독 후 전체 찌라시 본문을 열람할 수 있습니다.`
- **상위 보호 확인**: `trades`와 `bots_config`에는 `PUBLIC_TRADE_COLUMNS` / `ALLOWED_BOT_DIR_COLS` 사전 필터 차단이 구현되어 있으나(`279~292행`, `338~350행`), `NEWS_TABLES`에는 동일 차단이 없어 상위 보호가 부재하다.
- **검증 수준과 한계**: **실행 재현** (격리된 임시 `STOCKSYS_DATA_DIR`에서 `POST /api/local-db` 핸들러 직접 호출).

---

### [RR-02] `GET /api/market-flow`의 `recentNews`가 인증·구독 마스킹 없이 `RUMOR` 본문(`content`)을 그대로 노출
- **ID / 심각도**: `RR-02` / **P1**
- **영역**: 1. 인증·인가·공개 데이터/API
- **영향**: `RUMOR` 유료 구독 페이월(`/api/local-db`의 `authorizeNewsRecord`)이 비인증 공개 엔드포인트 `GET /api/market-flow`의 `recentNews`를 통해 완전히 우회되어 최근 10건의 찌라시 본문 원문이 그대로 노출된다.
- **발생 조건 / 권한 / 실행 모드**:
  - 로컬 스탠드얼론 모드(`GET /api/market-flow`).
  - 비인증·미구독 포함 모든 사용자.
  - `AgentManager`가 `eventType: 'RUMOR'` 이벤트를 발행해 `memoryDb.marketNews`에 동기화된 상태.
- **실제 진입점과 호출 경로**:
  `GET /api/market-flow` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/market-flow/route.ts:45`) → `engine.getMarketFlowData(pointsLimit)` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/market-flow/route.ts:64`) → `MarketDiagnostics.getMarketFlowData()` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/marketDiagnostics.ts:831`) → `memoryDb.marketNews` 매핑 (`838~848행`에서 `n.content` 원문 직접 반환).
- **좁은 위치**:
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/market-flow/route.ts:64` (`62~75행`: `verifyAdminSession`은 `marketState` 추가 노출 여부만 제어하고 `flowData.recentNews`는 필터링/마스킹 없이 응답)
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/marketDiagnostics.ts:831` (`831~848행`: `content: n.content`를 `category === 'RUMOR'` 검사나 `authorizeNewsRecord` 없이 그대로 직렬화)
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/agentManager.ts:810` (`810~832행`: `RUMOR` 이벤트 발행 시 원문 `event.content`를 `memoryDb.marketNews`에 저장)
- **기대 vs 관측**:
  - 기대: `RUMOR` 카테고리 뉴스는 구독 권한이 없는 공개 API 응답에서 본문을 마스킹해야 한다.
  - 관측: 비인증 `GET /api/market-flow`가 `HTTP 200`과 함께 `recentNews` 항목의 `content`에 `'UNMASKED_PAID_RUMOR_SECRET'` 원문을 그대로 반환했다.
- **최소 재현 코드 / 실행법 / 결과**:
  - 스크립트: `/C:/Users/abcde/.gemini/antigravity-cli/brain/3caaf7fe-b740-4042-9d3d-03a869892383/scratch/verify_defects.ts:108` (`108~138행`)
  - 최소 재현 요지: `engine.publishEvent({ eventId: 'evt_rumor_leak_probe', eventType: 'RUMOR', scope: 'stock', content: 'UNMASKED_PAID_RUMOR_SECRET', ... })` 호출 후 비인증 상태에서 `GET /api/market-flow?points=10` 호출.
  - 결과: `V2 publish ok: true GET /api/market-flow status: 200 leaked content: UNMASKED_PAID_RUMOR_SECRET`
- **상위 보호 확인**: `app/api/market-flow/route.ts:73`은 `marketState`만 관리자 권한으로 가드할 뿐, `flowData.recentNews`에 대한 세션/구독/마스킹 가드가 없다.
- **검증 수준과 한계**: **실행 재현** (격리된 임시 `STOCKSYS_DATA_DIR`에서 `AgentManager.publishEvent` 후 `GET /api/market-flow` 핸들러 직접 호출).

---

### [RR-03] (구성 환경 조건부) `SettlementBatchService` 월간 키(`period_YYYY-MM`)와 `BondCouponEngine` 분기 지급액 불일치로 3배 과다 쿠폰 지급 및 만기 원금 상환 차단
- **ID / 심각도**: `RR-03` / **P2** (기본 `MemoryDatabase` 초기 상태 미도달, 채권 보유가 구성된 `engine-server` 환경 한정)
- **영역**: 2. 주문·금전·부채·정산
- **영향**: 채권 보유 포지션이 있는 `engine-server` 구성 환경에서:
  1. `SettlementBatchService.runDailySettlementBatch()`가 매 달력 월마다 분기 이자(`coupon_rate / 100 / 4`)를 지급해 분기당 3배, 연간 12회(연 쿠폰의 300%)를 과지급한다.
  2. 직전 달 월간 쿠폰이 만기일 전 91.25일(`(365d) / 4`) 이내에 지급된 경우, 만기 달 배치에서 `BondCouponEngine`이 새 월간 키(`period_YYYY-MM`)가 미지급 상태라고 판단해 `couponAmount > 0`을 전달하지만 `InMemorySettlementRepository.settleBondMaturityAtomically`는 91.25일 내 기지급 이력(`finalCouponAlreadyPaidByHistory`)을 감지해 `INVALID_COUPON_AMOUNT`로 거부한다. `BondCouponEngine`이 이를 `if (!settlementRes.success) continue;`로 건너뛰어 **만기 원금 상환 자체가 최대 91.25일간 중단**된다.
- **발생 조건 / 권한 / 실행 모드 (기본 상태 vs 구성 환경 구분)**:
  - **기본 상태 미도달 확인**: 초기 `MemoryDatabase`의 `botsConfig`는 빈 배열(`[]`)이고, `MarketEngine.initializeBots()`가 등록하는 `BUILT_IN_PARTICIPANTS` 15개 봇(`ADVERSARIAL`, `WALL_BREAKER`, `AS_MARKET_MAKER`, `STAT_ARB`, `RETAIL_SWARM`, `HEDGE_FUND`, `PROP_DESK`, `QUANT_FUND`, `OPTIONS_MM`, `CTA`, `COMMERCIAL_HEDGER`) 및 사용자 `POST /api/orders`(`memoryDb.bonds.has(stock_id) -> 400`)는 채권 주문/보유량을 생성하지 않는다. (기본 상태 `MarketEngine` 3틱 실행 실측: `botCount: 15, bondOrders: 0, bondHoldings: 0`.)
  - **도달 가능한 구성 환경**: `bots_config`에 `PENSION_FUND`, `COMMERCIAL_BANK`, 또는 `ExecutionTrader` 유형이 구성되어 있거나, 복원된 스냅샷에 채권 보유(`holdings`)가 존재하는 `engine-server` 환경에서 `MarketEngine.tick()`(50틱 주기)이 달력 월 경계 및 만기일을 지날 때 발생한다.
- **실제 진입점과 호출 경로**:
  `MarketEngine.tick()` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:2314`) → `SettlementBatchService.runDailySettlementBatch()` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/SettlementBatchService.ts:56`, `118~123행`) → `currentPeriodKey(now)` (`47~50행`: `` `period_${iso.slice(0, 7)}` ``) → `BondCouponEngine.executeCouponBatch()` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/BondCouponEngine.ts:98`, `130~171행`) → `InMemorySettlementRepository.settleBondMaturityAtomically()` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts:1654`, `1740~1778행`).
- **좁은 위치**:
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/SettlementBatchService.ts:47` (`47~50행`, `118~123행`: 월간 `period_YYYY-MM` 키 생성 후 `executeCouponBatch` 호출)
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/BondCouponEngine.ts:24` (`24행`, `46~53행`: `defaultPaymentsPerYear = 4`; `130~152행`: `cKey` 미결제 시 `finalCoupon > 0` 전달 후 실패 시 `continue`)
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts:1740` (`1740~1776행`: 91.25일 창 내 지급 이력이 있으면 `maxAllowedFinalCoupon = 0`, `couponAmount > 0` 시 `INVALID_COUPON_AMOUNT` 반환)
- **기대 vs 관측**:
  - 기대: `payments_per_year = 4` 채권은 분기당 1회(연 4회)만 쿠폰을 지급해야 하며, 만기 시 최종 쿠폰이 이미 최근 분기 내에 지급됐다면 원금만 상환(`couponAmount = 0`)해야 한다.
  - 관측: `SettlementBatchService`에 채권 100단위(`coupon_rate: 4.0`, `payments_per_year: 4`) 보유 상태에서 2027-01/02/03월 실행 시 한 분기에 `10,000원 × 3 = 30,000원` 지급. 전월 쿠폰 지급 20일 후 만기 도래 시 `bondPrincipalRedeemed: 0`, `holdingStillOpen: true`로 원금 상환이 실패했다.
- **최소 재현 코드 / 실행법 / 결과**:
  - 스크립트: `/C:/Users/abcde/.gemini/antigravity-cli/brain/3caaf7fe-b740-4042-9d3d-03a869892383/scratch/verify_defects.ts:140` (`140~208행`)
  - 기본 봇 채권 미생성 확인 명령:
    `node --import tsx -e "import { MemoryDatabase } from './lib/memoryDb/memoryStore.ts'; import { createInMemoryRepositoryBundle } from './lib/repositories/inMemory/index.ts'; import { createSimulationContext } from './lib/engine/simulation/runtime/simulationContext.ts'; import { MarketEngine } from './engine-server/src/MarketEngine.ts'; (async () => { const db = new MemoryDatabase(); const eng = new MarketEngine({ simulationContext: createSimulationContext({ seed: 42 }), repositories: createInMemoryRepositoryBundle(db) }); await eng.initializeBots(); for (let i=0;i<3;i++) await eng.tick(); const bondIds = new Set(Array.from(db.bonds.keys())); console.log({ botCount: db.botsConfig.length, bondOrders: Array.from(db.orders.values()).filter(o => bondIds.has(o.stock_id)).length, bondHoldings: Array.from(db.holdings.values()).filter(h => bondIds.has(h.stock_id)).length }); })()"`
  - 결과:
    - 기본 상태 확인: `{ botCount: 15, bondOrders: 0, bondHoldings: 0 }`
    - 구성 환경 정산 배치(`V3`): `Q1 monthly coupons paid: { jan: 10000, feb: 10000, mar: 10000, totalCashAfterQ1: 30000 }`, `Part B: { prevMonthCoupon: 10000, maturedResult: { optionSettled: 0, optionPayout: 0, bondCouponsPaid: 0, bondPrincipalRedeemed: 0 }, holdingStillOpen: true }`
- **상위 보호 확인**: `InMemorySettlementRepository.settleBondMaturityAtomically`가 중복 최종 쿠폰 지급은 차단하지만, `SettlementBatchService`/`BondCouponEngine`이 이를 `0`으로 재시도하지 않아 만기 원금 상환까지 차단된다.
- **검증 수준과 한계**: **실행 재현** (`SettlementBatchService` + `StaticTimeSource` 정산 배치 검증; 단, 기본 `MemoryDatabase` 상태에서는 채권 보유량 자체가 생성되지 않으므로 구성 환경 조건부 결함임).

---

### [RR-04] 로컬 스탠드얼론 모드에서 옵션 만기 정산·채권 이자/만기 상환 배치 미연결로 만기 파생 포지션 무기한 미정산
- **ID / 심각도**: `RR-04` / **P1**
- **영역**: 2. 주문·금전·부채·정산 (실행 모드 경계 포함)
- **영향**: Next.js 단독 실행(로컬 스탠드얼론 모드, `NEXT_PUBLIC_USE_IN_MEMORY=true`)에서 사용자가 `/api/options/order`로 옵션 계약을 매수한 뒤 만기가 도래해도, 만기 정산 엔진이 전혀 호출되지 않아 ITM 옵션 정산금이 지급되지 않고 만기 보유 포지션도 청산되지 않는다.
- **발생 조건 / 권한 / 실행 모드**:
  - 로컬 스탠드얼론 실행 모드(Next.js 단일 프로세스; `engine-server`는 `.data/engine-server`로 저장소를 분리해 Next.js `.data`와 상태를 공유하지 않음).
  - 일반 사용자가 `/api/options/order`로 유효 옵션을 매수한 뒤 `expiry_date <= now` 시점이 경과한 상태.
- **실제 진입점과 호출 경로**:
  `POST /api/options/order` → `submitAuthoritativeOptionOrder()` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/options/optionOrderService.ts:1`)로 옵션 보유 생성 → `LocalMarketEngineInstance.runTick()` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts:165`)가 `agentManager.step(1.0)` 및 정리 작업만 수행하고 `SettlementBatchService` / `OptionSettlementEngine` / `settleOptionExpiryAtomically`를 호출하지 않음.
- **좁은 위치**:
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts:165` (`165~227행`: `runTick()`에 옵션 만기/채권 상환 호출 누락)
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/index.ts:17` (`17~18행`: `ENGINE_SERVER_DATA_DIR` 기본값이 `.data/engine-server`로 Next.js 스탠드얼론 `.data`와 분리됨)
- **기대 vs 관측**:
  - 기대: 활성 스탠드얼론 실행에서도 만기 도래 옵션이 주기적으로 정산·청산되어야 한다.
  - 관측: K200 콜옵션(행사가 260, 기초지수 > 260) 1계약 보유 후 만기(`expiry_date < now`)가 지나고 `runTick()`을 5회 실행해도 `holdingQty: 1`, `cashBefore === cashAfter (9461962)`, `settlementsCount: 0`으로 변동이 없었다.
- **최소 재현 코드 / 실행법 / 결과**:
  - 스크립트: `/C:/Users/abcde/.gemini/antigravity-cli/brain/3caaf7fe-b740-4042-9d3d-03a869892383/scratch/verify_defects.ts:380` (`380~407행`)
  - 결과: `V8 expired option after standalone ticks: { holdingQty: 1, cashBefore: 9461962, cashAfter: 9461962, settlementsCount: 0 }`
- **상위 보호 확인**: `lib/engine/optionBotEngine.ts`의 클라이언트 fallback `processOptionExpiration()`도 의도적으로 DB 쓰기를 하지 않으므로(`0` 반환), 스탠드얼론 Next.js 서버 내 어디에도 만기 정산 호출자가 없다.
- **검증 수준과 한계**: **실행 재현** (격리된 임시 `STOCKSYS_DATA_DIR`에서 `submitAuthoritativeOptionOrder` 후 `LocalMarketEngineInstance.runTick()` 실행).

---

### [RR-05] 로컬 스탠드얼론 `runTick()`의 주문 정리가 `user_id` 존재 시 무조건 건너뛰어 종료된 ABM 봇/LP 주문이 무한 누적됨
- **ID / 심각도**: `RR-05` / **P2**
- **영역**: 3. 동시성·영속성·실패 복구 (운영 장기 상한 포함)
- **영향**: 로컬 스탠드얼론 모드에서 `AgentManager`가 매 스텝 LP 호가 취소·재제출 및 봇 주문을 생성할 때마다 `filled`/`cancelled` 주문이 `memoryDb.orders` 및 `.data/snapshot.json`에 영구 누적되어 장시간 가동 시 메모리·스냅샷 파일 크기 및 직렬화 시간이 선형으로 증가한다.
- **발생 조건 / 권한 / 실행 모드**:
  - 로컬 스탠드얼론 실행 모드(`LocalMarketEngineInstance.runTick()` 가동).
  - 별도 권한 불필요(정상 봇 시뮬레이션 가동 중 자동 누적).
- **실제 진입점과 호출 경로**:
  `AgentManager.submitLpOrders()` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/agentManager.ts:2070`) 및 `submitBotOrder()` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/agentManager.ts:2117`)가 `userId: 'acc_lp_main'`, `'acc_bot_val_01'` 등을 주문 `user_id`에 기록 → `LocalMarketEngineInstance.runTick()` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts:173`)가 매 20틱마다 `if (order.user_id) continue;` (`180행`)로 모든 ABM 봇/LP 주문을 정리 대상에서 제외.
- **좁은 위치**:
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts:178` (`178~202행`: `if (order.user_id) continue;` 때문에 `acc_*` 계좌 주문이 비-LP/LP 정리 분기에 전혀 도달하지 못함)
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts:258` (`233~265행`: `refreshLpOrders()`의 `MAX_RETAINED_LP_ORDERS_PER_STOCK = 30` 정리는 `runTick()`에서 호출되지 않으며, 호출되더라도 `is_lp` 주문만 대상으로 해 `acc_bot_*` 비-LP 주문을 정리하지 않음)
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/agentManager.ts:2070` (`2070~2076행`, `2117~2124행`: ABM LP·봇 주문에 `userId: agent.accountId` 설정)
- **기대 vs 관측**:
  - 기대: 시스템 봇/LP 계좌(`acc_lp_main`, `acc_bot_*`)의 종료된(`filled`/`cancelled`) 주문은 주기적으로 정리되거나 상한이 적용되어야 한다.
  - 관측:
    - **실행 측정(20틱)**: 20틱 실행(20틱째 정리 루프 포함) 후 `memoryDb.orders.size`가 `659 → 923`으로 증가했고, 종료 상태(`filled`/`cancelled`)의 `acc_*` 주문이 정리 직후에도 `56건` 그대로 잔존했다.
    - **정적 상한 부재 확인**: 저장소 전체에서 `orders.delete` / `orders.clear` / `MAX_RETAINED` 검색 결과(`rg -n "\.orders\.delete|\.orders\.clear|MAX_RETAINED" lib app engine-server`), 스탠드얼론 `runTick()`에는 `trim_old_market_data`(trades 5,000 / history 3,000)와 달리 `acc_*` 종료 주문을 제거하거나 개수를 제한하는 다른 trim 경로가 존재하지 않는다.
- **최소 재현 코드 / 실행법 / 결과**:
  - 스크립트: `/C:/Users/abcde/.gemini/antigravity-cli/brain/3caaf7fe-b740-4042-9d3d-03a869892383/scratch/verify_defects.ts:266` (`266~281행`)
  - 결과: `V5 memoryDb.orders size before 20 ticks: 659 after 20 ticks (incl cleanup): 923 dead acc_* orders: 56`
- **상위 보호 확인**: `trades`·`stockPriceHistory`·`settlementLedger`에는 상한 트림이 적용되나(`204~205행`), `orders`에는 봇 계좌 트림·상한이 없다.
- **검증 수준과 한계**: **실행 재현**(20틱 실행 후 정리 미작동 및 잔존 건수 실측) + **정적 경로 확인**(전체 저장소에 대체 trim 경로 부재 확인; 수시간 이상 장기 실행 OOM 자체는 미실행).

---

### [RR-06] `/v2/stocks/[id]` 서버 컴포넌트가 `MemoryQueryBuilder`에 없는 `.or()` 메서드를 예외 처리 없이 호출해 HTTP 200 스트리밍 SSR 오류로 페이지 렌더링 실패
- **ID / 심각도**: `RR-06` / **P1**
- **영역**: 5. 봇·시장·프론트엔드
- **영향**: V2 종목 상세 경로(`/v2/stocks/AAPL`, `/v2/stocks/bond_kr_2y` 등 모든 유효 id/ticker)에서 Next.js App Router 스트리밍 SSR이 HTTP `200` 헤더를 먼저 전송한 뒤 Server Component 내부에서 `TypeError: ...or is not a function`으로 실패해 스트리밍 오류 digest(`1057335340`)를 반환하며, `StockDetailV2Client` UI가 정상 렌더링되지 않는다.
- **발생 조건 / 권한 / 실행 모드**:
  - 로컬 스탠드얼론 모드(`lib/db/server.ts`가 `MemoryDbClient` 반환)에서 모든 사용자(비인증/인증 공통).
  - `/v2/stocks/<유효한 stock/bond id 또는 ticker>` 진입 시(`notFound()`가 아닌 실제 `row` 조회 성공 후 `145~152행` 실행).
- **실제 진입점과 호출 경로**:
  `GET /v2/stocks/AAPL` 또는 `/v2/stocks/bond_kr_2y` → `StockDetailPage` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/app/v2/stocks/[id]/page.tsx:145`) → `createClient()` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/db/server.ts:4` → `createMemoryDbClient()`) → `MemoryQueryBuilder` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryDbClient.ts:25`: `.or()` 메서드 미구현).
- **좁은 위치**:
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/app/v2/stocks/[id]/page.tsx:145` (`145~153행`: `.or(...)` 호출 및 `try/catch` 부재; `sanitizePublicNewsRecord`만 호출해 `RUMOR` 마스킹도 빠져 있음)
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/db/server.ts:9` (`createMemoryDbClient()` 반환)
- **기대 vs 관측**:
  - 기대: `MemoryQueryBuilder`가 지원하는 필터로 관련 뉴스를 조회하고 `StockDetailV2Client`를 오류 없이 SSR 렌더링해야 한다.
  - 관측: 기존 `.next` 빌드(`ZPbJhT3GqVusCk1Ty3LG8`)를 임시 `next start -p 13199`로 기동해 실제 HTTP 요청을 보낸 결과, `/v2/stocks/AAPL`과 `/v2/stocks/bond_kr_2y` 모두 **HTTP `200` 응답 본문에 Next 스트리밍 오류 마커(`HAS_ERR_MARKER=True`)** 가 포함되었고 서버 `STDERR`에 `TypeError: o.from(...).select(...).or is not a function { digest: '1057335340' }`가 기록되었다.
- **최소 재현 코드 / 실행법 / 결과**:
  - 실제 HTTP 서버 재현 명령(빌드 재실행 없이 기존 `.next` 사용, 임시 `STOCKSYS_DATA_DIR` 및 임시 포트 `13199`, 완료 후 자체 프로세스만 종료):
    ```powershell
    $tmp = Join-Path $env:TEMP ("stocksys_next_" + [guid]::NewGuid().ToString("N")); New-Item -ItemType Directory -Path $tmp | Out-Null
    $env:STOCKSYS_DATA_DIR = $tmp; $env:NEXT_PUBLIC_USE_IN_MEMORY = "true"
    $proc = Start-Process -FilePath "npx.cmd" -ArgumentList "next","start","-p","13199" -RedirectStandardError (Join-Path $tmp "err.log") -PassThru -NoNewWindow
    # 준비 후 Invoke-WebRequest http://127.0.0.1:13199/v2/stocks/AAPL 및 /v2/stocks/bond_kr_2y 확인, finally에서 Stop-Process 및 $tmp 삭제
    ```
  - 결과:
    - `PATH=/v2/stocks/AAPL STATUS=200 LEN=29479 HAS_ERR_MARKER=True`
    - `PATH=/v2/stocks/bond_kr_2y STATUS=200 LEN=29491 HAS_ERR_MARKER=True`
    - `STDERR`: `TypeError: o.from(...).select(...).or is not a function ... { digest: '1057335340' }` (2건)
- **상위 보호 확인**: `/stocks/[id]/page.tsx:142`와 달리 `/v2/stocks/[id]/page.tsx:145`에는 `try/catch`가 없어 스트리밍 오류로 직행한다. (단, HTTP 상태 코드가 `500`이 아니라 `200` 스트리밍 오류이므로 단순 상태 코드 `200`만 보는 smoke 테스트에서는 정상으로 오인될 수 있다.)
- **검증 수준과 한계**: **실행 재현** (실제 `next start` HTTP 요청의 응답 본문 오류 마커 및 서버 `STDERR` digest `1057335340` 확인).

---

### [RR-07] 원자재 호가창(`CommodityOrderbookPanel` + `CommodityDetailClient`)이 API 필드명·타입 불일치로 스프레드 `$NaN` 및 모든 호가 잔량 `NaN` 렌더링
- **ID / 심각도**: `RR-07` / **P1**
- **영역**: 5. 봇·시장·프론트엔드
- **영향**: 원자재 상세 페이지(`/commodities/[id]`)의 `호가 / 실시간 체결` 탭에서 스프레드가 항상 `$NaN`으로 표시되고, 호가창의 모든 매수·매도 잔량이 `NaN`으로 표시되며 막대 깊이 비율(`maxSize = 1`, `pct = 0%`)이 깨져 사용자가 호가 잔량을 식별할 수 없다.
- **발생 조건 / 권한 / 실행 모드**:
  - `/commodities/[id]` 접근 시(로그인 무관, `GET /api/commodities?id=...` 응답 수신 후 `호가 / 실시간 체결` 탭 진입).
- **실제 진입점과 호출 경로**:
  `GET /api/commodities?id=CRUDE_OIL` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/commodities/route.ts:72`, `72~73행`: `depth = { bids: [{ price, totalSize, orderCount }], asks: [...] }`, `spread = { bestBid, bestAsk, spread, spreadPct }`) → `CommodityDetailClient` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/app/commodities/[id]/CommodityDetailClient.tsx:59`, `43~44행`, `59~60행`, `208~214행`: `depth`와 `spread` 객체를 변환 없이 전달) → `CommodityOrderbookPanel` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityOrderbookPanel.tsx:27`, `39행`, `56~78행`).
- **좁은 위치**:
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityOrderbookPanel.tsx:27` (`27~28행`, `56행`, `61행`, `72행`, `77행`: API의 `totalSize` 대신 `b.size`/`ask.size` 참조)
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityOrderbookPanel.tsx:39` (`39행`: 객체 `{ bestBid, bestAsk, spread, spreadPct }`에 `Number(spread).toFixed(2)` 수행 → `$NaN`)
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/app/commodities/[id]/CommodityDetailClient.tsx:208` (`208~214행`: `orderbookDepth.bids`/`asks` 및 `orderbookSpread` 그대로 전달)
- **기대 vs 관측**:
  - 기대: `totalSize`를 계약 수량으로, `spread.spread`를 달러 스프레드 숫자로 표시해야 한다.
  - 관측: `GET /api/commodities?id=CRUDE_OIL` 실제 응답으로 `CommodityOrderbookPanel`을 SSR 렌더링한 HTML에 `스프레드: $NaN` 및 호가 잔량 셀 `>NaN<`이 포함됨을 확인했다.
- **최소 재현 코드 / 실행법 / 결과**:
  - 스크립트: `/C:/Users/abcde/.gemini/antigravity-cli/brain/3caaf7fe-b740-4042-9d3d-03a869892383/scratch/verify_defects.ts:302` (`302~378행`)
  - 결과:
    `V7 API depth[0] keys: [ 'price', 'totalSize', 'orderCount' ] spread type/value: object { bestBid: 70, bestAsk: 79.285, spread: 9.284999999999997, spreadPct: 12.439293967913716 }`
    `V7 rendered CommodityOrderbookPanel contains $NaN: true contains >NaN<: true`
- **상위 보호 확인**: 별도 어댑터/정규화 레이어 없음.
- **검증 수준과 한계**: **실행 재현** (실제 `GET /api/commodities` 응답으로 `CommodityOrderbookPanel` `renderToStaticMarkup` 수행).

---

### [RR-08] `CommodityOrderEntry`·`CommodityActiveOrdersPanel`이 `myPosition.side`를 무시해 숏 포지션을 `롱 +N`으로 오표시하고 Reduce-Only 계산을 무력화함
- **ID / 심각도**: `RR-08` / **P2**
- **영역**: 5. 봇·시장·프론트엔드
- **영향**: 사용자가 원자재 선물 매도(숏) 포지션을 보유한 상태에서 UI(`CommodityOrderEntry`, `CommodityActiveOrdersPanel`)가 이를 `롱 +N계약`으로 잘못 표시하며, 숏 청산용 매수(`buy`) 주문을 입력할 때도 `Reduce-Only` 증거금 면제(`₩0`)로 인식하지 않고 신규 필요 증거금을 과다 표시하고 `maxContracts`를 축소한다. (서버 `commodityLedger.ts` 정산 자체는 `myPosition.side`를 올바르게 사용하므로 금전 오정산으로 이어지지는 않는다.)
- **발생 조건 / 권한 / 실행 모드**:
  - 로그인 사용자가 원자재 선물에서 매도 체결로 `short` 포지션(`side: 'short'`, `quantity > 0`)을 보유한 상태에서 `/commodities/[id]` 화면을 이용할 때.
- **실제 진입점과 호출 경로**:
  `GET /api/commodities?id=...` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/commodities/route.ts:91`: `memoryDb.commodityPositions`의 `{ side: 'short', quantity: 3 }` 반환) → `CommodityOrderEntry` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityOrderEntry.tsx:42`: `setPositionQty(Number(data.myPosition?.quantity ?? 0))`로 `side` 폐기) 및 `CommodityActiveOrdersPanel` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityActiveOrdersPanel.tsx:59`, `157~164행`: `position.quantity > 0`으로만 롱/숏 분기).
- **좁은 위치**:
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityOrderEntry.tsx:42` (`42행`, `67~73행`: `side === 'buy' && positionQty < 0` 분기 도달 불가; `268행`: `positionQty > 0 ? '롱 +...' : '숏 ...'`)
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityActiveOrdersPanel.tsx:20` (`20~23행`, `157~164행`: `side` 필드 누락 및 `position.quantity > 0` 분기)
- **기대 vs 관측**:
  - 기대: `myPosition.side === 'short'`이면 UI에서 `숏 -N계약`으로 표시하고, `buy` 방향 주문 시 `Reduce-Only` 가능 수량을 `myPosition.quantity` 기준으로 산정해야 한다.
  - 관측: `reserveMarginAndSubmitCommodityOrder` + `settleCommodityTradeForUsers`로 3계약 매도 체결 시 `memoryDb.commodityPositions`에 `{ side: 'short', quantity: 3 }`이 저장되며, UI 계산식은 `Number(pos.quantity ?? 0) === 3 > 0`을 받아 롱 포지션으로 분기한다.
- **최소 재현 코드 / 실행법 / 결과**:
  - 스크립트: `/C:/Users/abcde/.gemini/antigravity-cli/brain/3caaf7fe-b740-4042-9d3d-03a869892383/scratch/verify_defects.ts:302` (`302~378행`)
  - 결과: `V7 stored short position: { side: 'short', quantity: 3 }`, UI `Number(pos.quantity ?? 0) > 0 === true`.
- **상위 보호 확인**: 서버 측 `commodityLedger.ts`는 `existing.side`를 정확히 판별하므로 실제 금전 정산 및 주문 수락은 정상 동작한다.
- **검증 수준과 한계**: **실행 재현**(백엔드 `myPosition` 실측 구조) + **정적 경로 확인**(프론트엔드 UI 상태 계산 및 JSX 분기).

---

### [RR-09] V1 종목 상세(`/stocks/[id]`) 관련 뉴스 조회가 `.or()` 예외를 삼켜 로컬 메모리 모드에서 관련 뉴스가 항상 비어 있음
- **ID / 심각도**: `RR-09` / **P2**
- **영역**: 5. 봇·시장·프론트엔드
- **영향**: V1 종목 상세 페이지(`/stocks/[id]`)의 `뉴스 / 주주톡` 탭에서 해당 종목·섹터 뉴스가 존재해도 항상 `관련 뉴스가 없습니다`로 표시된다.
- **발생 조건 / 권한 / 실행 모드**:
  - 로컬 스탠드얼론 모드(`lib/db/server.ts`가 `MemoryQueryBuilder` 반환)에서 `/stocks/[id]` 조회 시(모든 사용자).
- **실제 진입점과 호출 경로**:
  `GET /stocks/AAPL` → `StockDetail` (`/C:/Users/abcde/Desktop/웹소설/stock-sys/app/stocks/[id]/page.tsx:141`) → `db.from('market_news').select('*').or(...)` (`143~148행`) → `TypeError` 발생 → `catch (e)` (`150~152행`)로 `relatedNews = []` 유지.
- **좁은 위치**:
  - `/C:/Users/abcde/Desktop/웹소설/stock-sys/app/stocks/[id]/page.tsx:142` (`142~152행`: `MemoryQueryBuilder` 미지원 `.or()` 호출 및 `try/catch` 묵살)
- **기대 vs 관측**:
  - 기대: `MemoryQueryBuilder` 호환 필터로 해당 종목·섹터 뉴스를 조회하고 `RUMOR` 마스킹을 적용해 전달해야 한다.
  - 관측: `next start -p 13199`로 `GET /stocks/AAPL` 요청 시 HTTP `200`(`LEN=48394`, 페이지 정상 렌더링)과 함께 서버 `STDERR`에 `Failed to fetch market news: TypeError: r.from(...).select(...).or is not a function`이 기록되며 관련 뉴스가 빈 배열로 처리된다.
- **최소 재현 코드 / 실행법 / 결과**:
  - `RR-06`과 동일한 임시 `next start -p 13199` 서버에서 `GET /stocks/AAPL` 호출 + `verify_defects.ts:283` (`283~300행`)
  - 결과: `PATH=/stocks/AAPL STATUS=200 LEN=48394 HAS_ERR_MARKER=False`, `STDERR: Failed to fetch market news: TypeError: r.from(...).select(...).or is not a function`
- **상위 보호 확인**: `try/catch`가 스트리밍 오류는 막아주지만 관련 뉴스 조회 기능 자체를 항상 무력화한다.
- **검증 수준과 한계**: **실행 재현** (실제 `next start` HTTP `GET /stocks/AAPL` 서버 로그 및 `createClient()` `.or()` `TypeError` 실측).

---

## 3. 의심·미검증 항목

| ID | 영역 | 확인된 사실 | 아직 필요한 조건 / 검증 | 확정하지 못한 이유 |
| --- | --- | --- | --- | --- |
| `SU-01` | 3. 동시성·영속성 | `localStandaloneServer.ts:170` 및 `101`이 `agentManager.step(1.0)` 전체를 `withCommitGate`로 감싸지 않으며, `agentManager.ts:829`가 `memoryDb.marketNews`에 뉴스를 먼저 적재한 뒤 개별 봇 주문 `submitBotOrder`가 `onPersist`를 호출하고 `localStandaloneServer.ts:641`이 30초 `startAutoSave`를 별도 실행함 | `agentManager.step()` 실행 중 봇 주문 체결 실패·예외 또는 30초 `autoSave` 타이머가 스텝 중간에 개입해 불완전 스텝 스냅샷이 디스크에 남는지 경쟁 실행 테스트 필요 | 코드 구조상 경합 가능성은 보이나 `step()` 중간 실패·저장 타이밍을 맞춘 경쟁 재현을 실행하지 못함 |
| `SU-02` | 5. 봇·시장·프론트엔드 | `app/api/admin/scenarios/route.ts:61-132`가 주식(`assetType === 'stock'`) 시나리오 주입 시 `stk.target_price`와 `commodityEngineInstance.scenarioManager`를 갱신하지만, `rg -n "target_price"` 및 `rg -n "scenarioManager"` 결과 `AgentManager`와 `MarketEngine`은 두 값을 참조하지 않음 | 관리자 UI에서 주식 작전 시나리오 주입 후 `LocalMarketEngineInstance` / `MarketEngine` 다수 틱 실행 시 주가·거래량 변화 유무 대조 실험 | 원자재 시나리오는 `CommodityMarketEngine.nextTick()`에서 참조됨을 확인했으나, 주식 시나리오 미작동에 대한 다중 틱 실행 비교는 미수행 |
| `SU-03` | 3. 동시성·영속성 | `MarketEngine.ts:736-789`의 `runtimeSnapshot` / `rollbackAll`은 `tickCount`, `commodityRuntime`, 난수, `BaseAgent.snapshotRuntimeState()`를 복구하지만 `this.simClock` 자체는 스냅샷하지 않음 | `StaticTimeSource`를 `tick()` 내부에서 전진시키는 커스텀 구성에서의 롤백 후 시각 드리프트 여부 검증 | 기본 `WallClockTimeSource` / `ClockTimeSource` 환경에서 `MarketEngine.tick()`이 `simClock`을 직접 전진시키지 않아 실제 장애 조건 미확인 |
| `SU-04` | 1. 인증·인가 | `app/api/auth/[...nextauth]/route.ts`, `lib/auth/sessionAuth.ts`, `lib/auth/adminAuth.ts` 정적 점검 완료 | 실제 브라우저에서 NextAuth Google/Kakao OAuth 콜백 및 세션 쿠키 발급 E2E 검증 | 읽기 전용 정책상 실 OAuth 공급자 및 브라우저 E2E 미실행 |
| `SU-05` | 6. 운영·설정·검증 | `archive/legacy-postgres/` 및 `vm-db/`는 아카이브 비활성 경로임 (`AGENTS.md` 및 활성 `lib/memoryDb/` 확인) | 레거시 Postgres 모드 재활성화 시 별도 점검 필요 | 활성 실행 모드가 아니므로 이번 운영 범위에서 제외 |
| `SU-06` | 2. 주문·금전·부채·정산 | `MarketEngine.ts:1436-1440`, `1594-1597`은 채권 주문 현금 사전 검증 시 `face_value / quote_base` (`100x`) 승수를 누락해 1x로 계산하며, `InMemorySettlementRepository.ts:908`은 `100x`로 정산함. private `processBatchOrders` 직접 주입 및 `bot_pension_001.cash = 150000` 강제 설정에서는 `PRE_VALIDATION_FAILED`로 배치 롤백이 관측됨 (`verify_defects.ts:210-264`) | 기본 `BUILT_IN_PARTICIPANTS` 15개 봇에는 `PENSION_FUND`·`COMMERCIAL_BANK`·`ExecutionTrader`가 없어 기본 상태(`bondOrders: 0`)에서 미도달. `bots_config`를 정상 구성한 환경에서 손실 누적으로 봇 현금이 100x 주문대금 미만으로 떨어지는 정상 `tick()` 경로 재현 필요 | 정상 진입점(`initializeBots()` + `tick()`)으로 채권 매수 봇 현금이 1x 이상 100x 미만 구간에 진입해 `PRE_VALIDATION_FAILED`가 발생하는지 입증하지 못해 `의심·미검증`으로 이동함 |

---

## 4. 리뷰 범위, 실행 검증 기록 및 워크트리 무결성

### 4.1 읽은 파일 범위 및 미열람·미실행 범위
- **직접 열람·점검 영역**:
  - 인증·API·프록시: `AGENTS.md`, `package.json`, `next.config.ts`, `proxy.ts`, `instrumentation.ts`, `app/api/local-db/route.ts`, `app/api/auth/[...nextauth]/route.ts`, `app/auth/callback/route.ts`, `lib/auth/sessionAuth.ts`, `lib/auth/adminAuth.ts`, `lib/auth/useAuth.ts`, `lib/engine/localDevMode.ts`, `app/api/admin/scenarios/route.ts`, `app/api/analyze/route.ts`, `app/api/commodities/route.ts`, `app/api/events/resolve/route.ts`, `app/api/market-flow/route.ts`, `app/api/options/account/route.ts`, `app/api/options/order/route.ts`, `app/api/orders/route.ts`, `app/api/shop/purchase/route.ts`, `lib/rateLimit/sharedRateLimiter.ts`, `lib/shop/catalog.ts`, `lib/db/client.ts`, `lib/db/server.ts`.
  - 인메모리 DB·정산·엔진·봇: `lib/memoryDb/memoryStore.ts`, `memoryDbClient.ts`, `PersistenceManager.ts`, `StorageAdapter.ts`, `accountLocks.ts`, `memoryTransaction.ts`, `lib/engine/marketService.ts`, `dbMatching.ts`, `orderRisk.ts`, `currency.ts`, `settlement.ts`, `localStandaloneServer.ts`, `simulation/agentManager.ts`, `simulation/marketDiagnostics.ts`, `simulation/marketEventTypes.ts`, `simulation/runtime/simulationTimeSource.ts`, `simulation/runtime/simulationContext.ts`, `lib/options/optionOrderService.ts`, `lib/options/contractUnits.ts`, `lib/engine/OptionsEngine.ts`, `lib/engine/optionBotEngine.ts`, `lib/commodities/commodityLedger.ts`, `CommodityMarketEngine.ts`, `CommodityOrderBook.ts`, `eventSystem.ts`, `lib/exchange/exchangeService.ts`, `lib/events/playerEventService.ts`, `lib/scenario/ScenarioManager.ts`, `lib/services/priceHistoryService.ts`, `lib/repositories/settlementPolicy.ts`, `InMemorySettlementRepository.ts`, `InMemoryMarketRepository.ts`, `InMemoryParticipantRepository.ts`, `lib/engine/APArbitrageEngine.ts`, `iNAVEngine.ts`, `LeverageETFEngine.ts`, `etfDefinitions.ts`, `RealtimeGateway.ts`, `engine-server/src/index.ts`, `restartRuntime.ts`, `MarketEngine.ts`, `EventDirector.ts`, `services/NewsGenerator.ts`, `risk/legacyOrderSafety.ts`, `risk/orderSourceMetadata.ts`, `settlement/BondCouponEngine.ts`, `OptionSettlementEngine.ts`, `SettlementBatchService.ts`, `bots/*` (Base, ASMM, Adversarial, WallBreaker, PensionFund, HedgeFund, Quant, StatArb, CommercialBank, PropDesk, RetailSwarm, CommodityBots, OptionsMM, ExecutionTrader).
  - 프론트엔드·검증: `app/commodities/[id]/CommodityDetailClient.tsx`, `app/components/commodities/CommodityOrderEntry.tsx`, `CommodityActiveOrdersPanel.tsx`, `CommodityOrderbookPanel.tsx`, `app/components/OrderEntry.tsx`, `OptionOrderEntry.tsx`, `OptionHTSDashboard.tsx`, `OptionsPanel.tsx`, `OptionAccountPanel.tsx`, `ActiveOrdersPanel.tsx`, `RandomEventModal.tsx`, `TradeFeed.tsx`, `v2/TradeFeedV2.tsx`, `TopBar.tsx`, `DashboardGate.tsx`, `lib/hooks/useOptionMarketData.ts`, `useOrderbookData.ts`, `app/markets/[market]/page.tsx`, `app/stocks/page.tsx`, `app/stocks/[id]/page.tsx`, `StockDetailClient.tsx`, `app/v2/page.tsx`, `app/v2/stocks/page.tsx`, `app/v2/stocks/[id]/page.tsx`, `StockDetailV2Client.tsx`, `app/etf/page.tsx`, `app/options/page.tsx`, `app/shop/page.tsx`, `app/admin/page.tsx`, `app/admin/ScenarioController.tsx`, `app/news/page.tsx`, `app/exchange/page.tsx`, `app/mypage/page.tsx`, `app/institutions/page.tsx`, `app/market-flow/page.tsx`, `scripts/test-full-review-2026-11-19-fixes.ts`, `scripts/test-orderbook-react-render.tsx`, `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`, `02-guides/data-security.md`.
- **미열람·미실행 범위**: 실제 브라우저(Playwright/DOM 상호작용) 클릭·폴링, 실 OAuth 공급자 로그인, `next build` / `tsc` / `lint` 일괄 실행, 레거시 Postgres 원격 DB 연결, `lib/commodities/bots/*` 개별 세부 파일 전수 열람.

### 4.2 실행한 검증 명령 및 결과
1. **격리 결함 재현 스크립트 (`verify_defects.ts`)**
   - 파일 링크: `/C:/Users/abcde/.gemini/antigravity-cli/brain/3caaf7fe-b740-4042-9d3d-03a869892383/scratch/verify_defects.ts:1`
   - 명령: `node --import tsx "C:\Users\abcde\.gemini\antigravity-cli\brain\3caaf7fe-b740-4042-9d3d-03a869892383\scratch\verify_defects.ts"` (임시 `STOCKSYS_DATA_DIR` 생성 후 `finally`에서 삭제, `WaitMsBeforeAsync: 10000`)
   - 종료 코드: **`0`**
2. **기존 `.next` 빌드(`ZPbJhT3GqVusCk1Ty3LG8`) 기반 임시 `next start` HTTP 스트리밍 검증**
   - 명령: 격리 `$env:STOCKSYS_DATA_DIR` + `$env:NEXT_PUBLIC_USE_IN_MEMORY="true"`로 `npx.cmd next start -p 13199` 기동 후 `/v2/stocks/AAPL`, `/v2/stocks/bond_kr_2y`, `/stocks/AAPL` 요청, 종료 시 자체 `13199` 프로세스 및 임시 디렉터리 삭제 (`task-441`, 종료 코드 **`0`**)
   - 관측: `/v2/stocks/AAPL` 및 `/v2/stocks/bond_kr_2y`는 HTTP `200` + 스트리밍 오류 마커 + 서버 `STDERR` `digest: '1057335340'`; `/stocks/AAPL`은 HTTP `200` + 정상 렌더링 + `STDERR` `Failed to fetch market news: TypeError`.
3. **기본 `MarketEngine` 채권 주문·보유량 생성 여부 확인**
   - 명령: `MarketEngine.initializeBots()` + `tick()` 3회 실행 후 `db.botsConfig`, `db.orders`, `db.holdings` 점검 (종료 코드 **`0`**)
   - 관측: `{ botCount: 15, bondOrders: 0, bondHoldings: 0 }` (기본 상태 `PENSION_FUND`/`COMMERCIAL_BANK`/`ExecutionTrader` 부재).
4. **기존 최근 회귀 스크립트 (`scripts/test-full-review-2026-11-19-fixes.ts`)**
   - 명령: 임시 `$env:STOCKSYS_DATA_DIR` 설정 후 `node --import tsx scripts\test-full-review-2026-11-19-fixes.ts` (종료 코드 **`0`**).

### 4.3 코드 무변경 확인
- 본 작업에서 허용된 `docs/reachable-review-2026-11-19-findings.md` 신규 작성/갱신 및 `HISTORY.md` 하단 요약 추가 외에는 애플리케이션·테스트·설정·`.data`·`.next`·기존 문서를 일절 수정하지 않았으며, 기존 미커밋 변경과 `debug.log`/로컬 훅을 그대로 보존했다.
