# 전체 코드 재리뷰 보고서 (독립 읽기 전용 리뷰 1회)

작성일: 2026-11-17
지시서: `docs/full-code-rereview-worker-plan.md`
상태: **애플리케이션 코드·테스트·설정 무수정 (읽기 전용 리뷰 + 격리 동적 재현)**

---

## 1. 요약

이전 리뷰 11건(`docs/code-review-2026-11-16.md`) 및 코디네이터 후속 수정 A–F(`docs/review-fixes-coordinator-followup.md`)가 반영된 현재 체크아웃을 대상으로 전체 실행 경로를 다시 점검했다.
기존 11건과 A–F의 핵심 수정(원자재 입력 검증/NaN 루프 방어, 프로필 허용 목록, 주문/정산 테이블 격리, 프로덕션 게스트 차단, 옵션 LP 지정가 매칭, 원자재 주문별 예약·비동기 정산·미체결 복원, 파일 `.lock` 및 락 내부 커밋 경계)은 코드 및 회귀 테스트에서 동작함을 확인했으나, **교차 자산 예약 중복 소비(P1)**, **주식 정산 원장 `evictedCustomTradeIds` 무한 누적(P1)**, **OAuth 로그인 시 스냅샷 복원 선행 누락(P1)**, **`engine-server` 재시작 시 고정 `run_seed_42` ID 충돌 및 틱 커밋 부재(P1)** 등 추가 결함이 확인되었다.

---

## 2. 검토 범위표

| 영역 | 주요 파일·진입점 | 검토 내용 |
|---|---|---|
| API 라우트 (`app/api/*`) | `orders`, `local-db`, `commodities`, `options/order`, `shop/purchase`, `auth/[...nextauth]`, `analyze`, `market-flow`, `admin/scenarios` | 인증/인가, RPC 화이트리스트, 입력 검증, 락/영속 경계, 복원 순서 |
| DB·영속성 (`lib/memoryDb/*`) | `memoryStore.ts`, `PersistenceManager.ts`, `StorageAdapter.ts`, `memoryTransaction.ts`, `memoryDbClient.ts`, `accountLocks.ts` | 스냅샷 v2 완전성, `.lock` 소유권, 커밋 게이트, 원장 트리밍·아카이브 |
| 거래·정산·리스크 (`lib/engine/*`, `lib/repositories/*`) | `dbMatching.ts`, `marketService.ts`, `orderRisk.ts`, `localStandaloneServer.ts`, `InMemorySettlementRepository.ts` | 락 순서, 롤백 범위, 교차 자산 예약, 봇 틱 내구성 |
| 파생·원자재·상점·환전 (`lib/options/*`, `lib/commodities/*`, `lib/shop/*`, `lib/exchange/*`) | `optionOrderService.ts`, `CommodityOrderBook.ts`, `CommodityMarketEngine.ts`, `commodityLedger.ts`, `catalog.ts`, `exchangeService.ts` | 지정가 매칭, 주문별 예약 귀속, 손실 보존, 30일 만료, 반올림·안전정수 |
| 별도 엔진 (`engine-server/src/*`) | `index.ts`, `MarketEngine.ts`, `simulationContext.ts` | 재시작 ID 충돌, 커밋 영속성, 봇 자산 권위 |
| UI·클라이언트 (`app/*`) | `OptionHTSDashboard`, `OptionOrderEntry`, `OptionAccountPanel`, `shop`, `exchange`, `v2/*`, `etf`, `RandomEventModal`, `useAuth` | 가짜 잔액/성공 표시, v2 연결, 403 차단 잔존 호출 |
| legacy / archive | `archive/legacy-postgres/*` | 현재 런타임 미사용(참고 범위 제외) |

---

## 3. 발견 사항 (심각도 순)

### [P1-1] 옵션·주식·환전·상점·원자재 간 교차 자산 예약 불일치 및 이중 소비
- **위치:**
  - `lib/engine/orderRisk.ts:22-35` (`calculateReservedCash`)
  - `lib/options/optionOrderService.ts:199-215`
  - `lib/exchange/exchangeService.ts:107-130`
  - `app/api/shop/purchase/route.ts:62-68,142-148`
  - `lib/commodities/commodityLedger.ts:66-79`
- **원인 및 발생 조건:**
  1. `orderRisk.ts:31`의 `calculateReservedCash()`는 `remainingQty * Number(o.price)`만 합산하며 옵션 계약 승수(`multiplier = 250000`)를 곱하지 않는다.
  2. `optionOrderService.ts:206`은 `ord.stock_id === contract.id`인 동일 계약의 휴면 주문에만 `multiplier`를 곱하고, **타 옵션 계약**의 휴면 매수 주문에는 `* 1`만 적용한다.
  3. `executeCurrencyExchange`, `/api/shop/purchase`, `reserveMarginAndSubmitCommodityOrder`는 `profile.cash`만 검사하고 `memoryDb.orders`에 대기 중인 주식/옵션 미체결 매수 주문의 예약금을 전혀 차감하지 않는다.
- **영향:** 사용자가 예수금 `600,000원` 상태에서 비시장성 옵션 지정가 매수(예약금 `500,000원`)를 걸어둔 채, 동일 자금으로 주식 주문·환전(`552,000원`)·상점 구매·원자재 주문을 동시에 실행할 수 있다. 이후 휴면 주문 체결 시 계좌 현금이 음수로 빠지거나 정산 실패가 발생한다.
- **최소 재현 (동적 재현 성공):**
  - `u.cash = 600_000`에서 `submitAuthoritativeOptionOrder`로 `price: 2.00, qty: 1` 비시장성 옵션 매수(`status: 'open'`, 실질 예약 `500,000원`) 접수 후:
  - `validateOrderCapacity` 결과: `REPRO1_STOCK_CAP_VALID: true RESERVED_SEEN: 2` (`500,000`원 대신 `2`원만 인식).
  - `executeCurrencyExchange(..., amount: 552000)` 결과: `REPRO1_EXCHANGE_SUCCEEDED_DESPITE_OPTION_RESERVE: true`.
- **수정 방향:** `memoryDb.orders`의 옵션 주문은 계약 승수를 반영한 단일 공용 예약 계산기(`calculateTotalReservedCash(db, userId)`)를 구현하고, 주식·옵션·원자재·환전·상점 모두 `profile.cash - reservedCash`를 가용 현금으로 사용해야 한다.

### [P1-2] 주식 정산 원장 `evictedCustomTradeIds` 무한 RAM/스냅샷 누적
- **위치:**
  - `lib/memoryDb/memoryStore.ts:346,986-1020` (`evictedCustomTradeIds`, `trimSettlementLedger`)
  - `lib/engine/localStandaloneServer.ts:428` (`trade_${randomUUID()}`)
  - `lib/engine/dbMatching.ts:238` (`randomUUID()`)
  - `engine-server/src/MarketEngine.ts:1319` (`buildDeterministicTradeId`)
- **원인 및 발생 조건:** `trimSettlementLedger()`는 `/^tr_e(\d+)_(\d+)$/` 패턴에 매칭되는 ID만 `settledEpochWatermarks`로 압축하고 나머지는 모두 `evictedCustomTradeIds` (`Set<string>`)에 추가한다. 그러나 코드베이스 전체에서 `tr_e<epoch>_<seq>` 형식의 ID를 생성하는 경로가 단 하나도 없다.
- **영향:** 장기 실행 시 트리밍된 **모든** 주식·옵션 체결 ID(100%)가 `evictedCustomTradeIds`에 무한 누적되며 `snapshot.json` 크기와 메모리 사용량이 계속 증가한다.
- **최소 재현 (동적 재현 성공):**
  - `trade_0_uuid` ~ `trade_14_uuid` 15건을 `settlementLedger`에 넣고 `db2.trimSettlementLedger(10)` 실행:
  - 관측 결과: `REPRO2_EVICTED_CUSTOM_IDS_SIZE: 5 WATERMARKS: 0`.
- **수정 방향:** 엔진/매칭 경로의 거래 ID를 에포크+단조 시퀀스(`tr_e<epoch>_<seq>`)로 통일하거나, 오래된 거래 ID 아카이브를 디스크 append-only 인덱스/블룸+디스크 조회로 분리하여 RAM 상한을 강제해야 한다.

### [P1-3] NextAuth OAuth 콜백이 스냅샷 복원 전에 `memoryDb.profiles`를 변경함
- **위치:** `app/api/auth/[...nextauth]/route.ts:24,55` (`signIn`, `session` 콜백)
- **원인 및 발생 조건:** `signIn` 및 `session` 콜백이 `await ensureLocalStandaloneReady()` 호출 없이 직접 `memoryDb.ensureUserProfile(userId, ...)`를 호출한다.
- **영향:**
  1. 콜드 스타트 직후 첫 요청이 NextAuth 세션/로그인일 경우, `loadSnapshot()` 이전에 `memoryDb.profiles`에 신규 프로필이 생성되고 직후 `importSnapshot()`이 `this.profiles = new Map(data.profiles)`로 이를 덮어쓸 수 있다.
  2. 이미 복원된 후 신규 OAuth 사용자가 가입해도 `persistConfirmedState()`를 호출하지 않아 재시작 시 프로필이 유실될 수 있다.
- **검증 상태:** 코드 경로 확인 (외부 OAuth 자격 증명 부재로 실제 Google OAuth 로그인은 미실행).
- **수정 방향:** NextAuth 콜백에서 `await ensureLocalStandaloneReady()` 후 `ensureUserProfile()`을 호출하고, 신규 생성 시 `persistConfirmedState()`를 호출한다.

### [P1-4] `engine-server` 재시작 시 고정 `run_seed_42` ID 충돌 및 틱 커밋 영속성 부재
- **위치:**
  - `engine-server/src/index.ts:20-31`
  - `lib/engine/simulation/runtime/simulationContext.ts:75-76` (`run_seed_${resolvedSeed}`)
  - `engine-server/src/MarketEngine.ts:254,1319`
- **원인 및 발생 조건:** `engine-server/src/index.ts`는 스냅샷 복원 후 `createSimulationContext()`를 기본값으로 생성하므로 `runId`가 항상 `'run_seed_42'`이고 `tickCount = 0`, `partialFillSequence = 0`에서 재시작한다. 또한 `engine-server`는 30초 `startAutoSave`만 연결되어 있고 `MarketEngine` 틱 커밋 시점의 즉시 저장 훅이 없다.
- **영향:** `engine-server`가 스냅샷을 복원한 뒤 재기동하면 직전 실행과 동일한 `deterministicTradeId` / `deterministicOrderId`를 생성해 `ORDER_ALREADY_EXISTS` 또는 기정산 중복 건너뜀(`isTradeSettled`) 충돌이 발생하며, 최대 30초 이내의 확정 봇 체결이 크래시 시 유실될 수 있다.
- **최소 재현 (동적 재현 성공):**
  - `createSimulationContext()`를 두 번 호출해 `runId` 비교:
  - 관측 결과: `REPRO3_RUN_IDS: run_seed_42 run_seed_42 SAME: true`.
- **수정 방향:** `engine-server` 스냅샷에 `engineRunEpoch` / `tickCount` / `simClock`을 저장·복원하여 재시작마다 고유 `simulationRunId`를 부여하고, `MarketEngine` 틱 커밋 후 `enginePersistence.saveSnapshot(memoryDb)`를 호출한다.

### [P2-1] `LocalMarketEngineInstance.runTick()`의 20틱 주기 저장 및 저장 실패 무시
- **위치:** `lib/engine/localStandaloneServer.ts:156-195`
- **원인 및 발생 조건:** `runTick()`은 `this.tickCount % 20 === 0`일 때만 `persistenceManager.saveSnapshot(memoryDb)`를 호출하고 반환값(`boolean`)을 검사하지 않는다. `AgentManager` 자체 상태(`agents`, `clock`, `diagnostics`)도 스냅샷에 저장되지 않아 재시작 시 봇 시뮬레이션 상태가 초기 시드(`seed 42`)로 돌아간다.
- **영향:** 1~19틱 사이의 확정된 자동 체결이 비정상 종료 시 유실될 수 있으며, 저장 실패 시에도 경고/오류 처리가 없다.
- **검증 상태:** 코드 경로 확인.

### [P2-2] `OptionAccountPanel` 하드코딩 더미 데이터 및 미연결 일괄 취소/청산
- **위치:** `app/components/OptionAccountPanel.tsx:10-33`
- **원인 및 발생 조건:** `OptionAccountPanel`이 실제 DB `orders`/`holdings`/`profiles`를 조회하지 않고 하드코딩된 샘플(`ORD-101`, `ORD-102`, `positions`)을 표시하며 `handleCancelAll`·`handleLiquidateAll`이 로컬 상태와 `alert`만 실행한다.
- **영향:** `/options`에서 실제 주문 제출 후에도 계좌 패널에 반영되지 않아 사용자 혼란을 유발한다.
- **검증 상태:** 코드 경로 확인.

### [P2-3] `app/etf/page.tsx`, `RandomEventModal.tsx`의 잔존 클라이언트 `cash` 직접 수정 및 `market-flow`/`admin/scenarios`의 복원 대기 누락
- **위치:**
  - `app/etf/page.tsx:175,218`, `app/components/RandomEventModal.tsx:101`
  - `app/api/market-flow/route.ts:47,120`, `app/api/admin/scenarios/route.ts:35-80`
- **원인 및 발생 조건:**
  - `etf/page.tsx`와 `RandomEventModal.tsx`가 여전히 `db.from('profiles').update({ cash: ... })`를 호출해 `/api/local-db`에서 `403`으로 거절된다(미구현 서버 API).
  - `/api/market-flow`는 비동기 `ensureLocalStandaloneReady()` 대신 동기 `ensureLocalStandaloneEngine()`을 호출해 콜드 스타트 시 `503`을 반환할 수 있고, `/api/admin/scenarios`는 `ensureLocalStandaloneReady()`와 `persistConfirmedState()` 호출이 없다.
- **검증 상태:** 코드 경로 확인.

### [P3-1] `OptionOrderEntry`의 `handlePctQty`가 수수료(0.1%)를 고려하지 않아 100% 버튼 시 잔액 부족 가능
- **위치:** `app/components/OptionOrderEntry.tsx:53-59`
- **원인:** `maxPossible = Math.floor((userBalance * (pct / 100)) / unitCost)` 계산 시 서버 수수료(`0.1%`)를 빼지 않아 `100%` 선택 후 매수 제출 시 서버에서 잔액 부족(400)으로 거절될 수 있다.

---

## 4. 기존 11건 및 후속 A–F 대응 상태 재확인

| 구분 | 항목 | 현 상태 | 비고 |
|---|---|---|---|
| 기존 #1 | 원자재 입력 검증·NaN 무한루프 | **해결 확인** | 400 거절 + `matchOrders` 비정상 잔량 제거 |
| 기존 #2 | 프로필 UPDATE 허용 목록 | **해결 확인** | `username`, `nickname`만 허용 (403 차단) |
| 기존 #3 | 원자재 이벤트 관리자·세션 인증 | **해결 확인** | `verifyAdminSession` + `resolveAuthenticatedUserId` |
| 기존 #4 | 런타임 영속 저장·복원 | **부분 보완 필요** | API/원자재/스냅샷 v2는 동작하나 OAuth 콜백(`P1-3`), `runTick` 20틱 주기(`P2-1`), `engine-server` 틱 커밋(`P1-4`) 미비 |
| 기존 #5 | 원자재 증거금 예약·정산 | **부분 보완 필요** | 원자재 내부 예약·정산은 동작하나 주식/옵션 휴면 예약과의 교차 검증(`P1-1`) 누락 |
| 기존 #6 | 옵션 HTS 서버 주문 연결 | **부분 보완 필요** | `OptionOrderEntry` → `/api/options/order`는 연결되었으나 `OptionAccountPanel`(`P2-2`)은 더미 유지 |
| 기존 #7 | 상점 서버 구매·카탈로그·만료 | **해결 확인** | 단, `profile.cash` 검사 시 주식/옵션 휴면 예약 미차감(`P1-1`) |
| 기존 #8 | 환전 RPC 구현·미존재 RPC 오류 | **해결 확인** | 단, `profile.cash` 검사 시 주식/옵션 휴면 예약 미차감(`P1-1`) |
| 기존 #9 | 원자재 `tradeHistory`·원장 상한 | **부분 보완 필요** | 원자재 `commoditySettlementLedger`는 에포크 압축 완료, 주식 `evictedCustomTradeIds`는 무한 누적(`P1-2`) |
| 기존 #10 | 주문·정산 테이블 개인정보 격리 | **해결 확인** | `orders`/`option_settlements`/`bond_coupon_payments` 세션 강제, `trades` 식별자 제거 |
| 기존 #11 | 프로덕션 게스트 자동 로그인 차단 | **해결 확인** | `isDevGuestAuthEnabled()` 서버/클라이언트 일치 |
| 후속 A | 옵션 지정가 매칭·LP 자산 보존 | **해결 확인** | 단, `P1-1` 교차 자산 예약 누락 |
| 후속 B | 주식 원장 트리밍 후 멱등성 | **부분 보완 필요** | 재실행 차단은 동작하나 `evictedCustomTradeIds` 무한 누적(`P1-2`) |
| 후속 C | 원자재 원장 cap 및 재시작 ID 분리 | **해결 확인** | `cm_trade_e<epoch>_t<tick>_s<seq>` 에포크 압축 동작 |
| 후속 D | 원자재 주문별 예약·비동기 정산·손실 | **해결 확인** | `buyOrderId`/`sellOrderId` 귀속, `stepTickAsync` 롤백, 손실 보존 확인 |
| 후속 E | 원자재 미체결 복원·지연 시작 | **해결 확인** | `ensureCommodityEngineReady()` + `reconcileWithDatabase` 확인 |
| 후속 F | 락 내부 커밋 경계·`.lock` 소유권 | **부분 보완 필요** | API 경로·`.lock`은 동작하나 `runTick` 20틱 주기(`P2-1`) 및 `engine-server`(`P1-4`) 보완 필요 |

---

## 5. 실행한 검증 명령과 결과 (본 리뷰 세션)

- 격리 동적 재현 스크립트(`node --import tsx -e ...`):
  - `REPRO1_STOCK_CAP_VALID: true RESERVED_SEEN: 2` / `REPRO1_EXCHANGE_SUCCEEDED_DESPITE_OPTION_RESERVE: true` (P1-1 재현 확인)
  - `REPRO2_EVICTED_CUSTOM_IDS_SIZE: 5 WATERMARKS: 0` (P1-2 재현 확인)
  - `REPRO3_RUN_IDS: run_seed_42 run_seed_42 SAME: true` (P1-4 재현 확인)
- 기존 검증 스위트 재실행:
  - `node node_modules/typescript/bin/tsc --noEmit --incremental false` (아래 최종 확인 실행)
  - `node node_modules/typescript/bin/tsc -p engine-server/tsconfig.json --noEmit --incremental false`
  - `node --import tsx scripts/test-followup-a-to-f.ts`
  - `node --import tsx scripts/test-review-fixes-verification.ts`
  - `node --import tsx scripts/test-phase1-suite.ts`

---

## 6. 미검증 범위 및 제약
- 실제 Google OAuth 자격 증명 및 외부 브라우저 OAuth 콜백 흐름은 외부 자격 증명이 없어 실행하지 못했다.
- 다중 호스트(NFS 등 네트워크 공유 파일시스템) 환경에서의 `.lock` 동작은 단일 로컬 Windows 호스트에서만 검증했다.
- `app/etf/page.tsx` 및 `app/components/RandomEventModal.tsx`는 코드 경로로 `403` 실패를 확인했으며 브라우저 클릭 E2E는 생략했다.
