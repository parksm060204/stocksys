# Codex 코드 리뷰 16건 수정 결과 보고서 (AGY Hydrogen high)

- 작업 대상: `C:/Users/abcde/Desktop/웹소설/stock-sys`
- 기준 보고서: `docs/code-review-2026-11-17-codex.md` (P1 7건 + P2 9건, 총 16건)
- 작성 일시: 2026-11-17

---

## 종합 검증 결과 요약 (최종 코드 수정 이후 재실행 기준)

| 검증 항목 | 명령 / 방식 | 결과 |
| --- | --- | --- |
| 루트 TypeScript 검사 | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | 통과 (exit 0) |
| 엔진 서버 TypeScript 검사 | `node node_modules/typescript/bin/tsc -p engine-server/tsconfig.json --noEmit --incremental false` | 통과 (exit 0) |
| Next.js 프로덕션 빌드 | `npx next build` (Next.js 16.3.5 Turbopack, TS + 28 정적/동적 라우트 생성) | 통과 (exit 0) |
| 기존 검증 스크립트 | `node --import tsx scripts/test-review-fixes-verification.ts` | 전수 통과 (exit 0) |
| Follow-up A~F 검증 | `node --import tsx scripts/test-followup-a-to-f.ts` | 전수 통과 (exit 0) |
| Phase 1 스위트 | `node --import tsx scripts/test-phase1-suite.ts` | 전수 통과 (exit 0) |
| 16건 통합 회귀 스위트 | `node --import tsx scripts/test-codex-review-16-fixes.ts` (격리 임시 `STOCKSYS_DATA_DIR`) | 16/16 전수 통과 (exit 0) |
| 프로덕션 HTTP E2E | `npx next start -p 3109` (격리 임시 `STOCKSYS_DATA_DIR`, NextAuth JWT 쿠키) | `HTTP_E2E_OK` (exit 0) |

---

## P1 수정 내역 (1 ~ 7번)

### 1. 일반 주식 주문 경로의 옵션/비주식/미등록 자산 차단
- **변경 파일**: `lib/engine/dbMatching.ts`, `app/api/orders/route.ts`, `app/api/local-db/route.ts`
- **구현 내용**:
  - `dbMatching.ts`의 `submitAndMatchOrder()` 초입에 `db.optionsContracts.has(stockId)`, `db.commodities.has(stockId)`, `db.bonds.has(stockId)` 및 `!db.stocks.has(stockId)` 검사를 추가해 옵션·원자재·채권·미등록 식별자가 주식 매칭/정산 경로로 진입하지 못하도록 차단했습니다.
  - `app/api/orders/route.ts`와 `app/api/local-db/route.ts`(`rpc.submit_and_match_order`) HTTP 경계에서도 동일한 주식 전용 자산 검증을 선행해 잘못된 경로 우회를 400 응답으로 거절합니다.
- **검증 근거**: `scripts/test-codex-review-16-fixes.ts` `[1]`번 테스트에서 `opt_c_720` 및 미등록 UUID가 `submitAndMatchOrder`와 `POST /api/orders` 모두에서 HTTP 400으로 거절됨을 검증했고, 격리 `next start` HTTP E2E에서도 `POST /api/orders` + `opt_c_720` → `400`을 확인했습니다.
- **남은 제약**: 없음.

### 2. 전역 저장 스냅샷의 미확정 트랜잭션 격리 (Commit Gate)
- **변경 파일**: `lib/memoryDb/PersistenceManager.ts`, `lib/engine/dbMatching.ts`, `lib/engine/marketService.ts`, `lib/exchange/exchangeService.ts`, `app/api/shop/purchase/route.ts`, `app/api/local-db/route.ts`, `lib/commodities/commodityLedger.ts`, `lib/options/optionOrderService.ts`, `lib/events/playerEventService.ts`
- **구현 내용**:
  - `PersistenceManager`에 `AsyncLocalStorage` 기반 재진입 가능 직렬 커밋 게이트(`withCommitGate`, `runWithCommitGate`, `createPersistHandler`)를 도입해 `saveSnapshot()`의 `exportSnapshot -> JSON.stringify -> enqueueSerializedSave` 구간과 동일한 직렬 커밋 경계 안에서만 상태 변경 + 영속 저장 + 실패 시 롤백이 실행되도록 통일했습니다.
  - 자동/백그라운드 `saveSnapshot` 역시 `withCommitGate`를 경유하므로 저장 대기 중 실패 예정 트랜잭션의 미확정 상태가 다른 계좌 스냅샷이나 자동 저장 스냅샷에 섞이지 않습니다.
- **검증 근거**: `scripts/test-codex-review-16-fixes.ts` `[2]`번 테스트에서 저장 실패가 예정된 거래 A가 게이트에서 대기하는 동안 동시 거래 B(`executeCurrencyExchange`)와 자동 `pm.saveSnapshot(db)`를 경합 실행해 A의 미확정 차감이 B 또는 자동 저장 스냅샷 어디에도 포함되지 않고 A는 원복, B는 커밋됨을 확인했습니다.
- **남은 제약**: 모든 신규 서버 쓰기 경로는 `runWithCommitGate` 및 `persistConfirmedState` 패턴을 계속 따라야 합니다.

### 3. 원자재 틱 실패 롤백 범위와 동시 주문/환전 잠금 순서 일치
- **변경 파일**: `lib/memoryDb/accountLocks.ts`, `lib/commodities/CommodityMarketEngine.ts`, `lib/commodities/commodityLedger.ts`, `lib/commodities/bots/CommodityBot.ts`, `lib/commodities/eventSystem.ts`, `lib/scenario/ScenarioManager.ts`, `app/api/commodities/route.ts`
- **구현 내용**:
  - `accountLocks.ts`에 `AsyncLocalStorage` 기반 재진입 허용(이미 보유한 계좌 락의 부분집합 재진입 허용, 락 확장 역순 시 예외 발생)을 적용해 교착을 차단했습니다.
  - `CommodityMarketEngine.stepTickAsync()` 및 `app/api/commodities/route.ts`, `reserveMarginAndSubmitCommodityOrder`의 락 순서를 `tickLock -> withAccountLocks -> commitGate`로 단일화했습니다.
  - 실패 틱 롤백 시 `Map` 전체 교체를 제거하고, 스냅샷으로 확보한 관련 계좌/포지션/예약/미체결 주문(`per-key`), `currentTick`, `tradeSeq`, `userOrderSeq`, `orderBooks`, `commodities`(제자리 `Object.assign` 복원 및 `priceHistory`), `tradesHistory`, 모든 `bots` 런타임 상태, `eventSystem`, `scenarioManager`, PRNG(`priceRandom`, `eventRandom`, `engineRandom`)를 정확히 복원합니다.
- **검증 근거**: `scripts/test-codex-review-16-fixes.ts` `[3]`번 테스트에서 실패한 원자재 틱 중 동시 실행된 환전(`executeCurrencyExchange`)과 신규 원자재 지정가 주문이 교착이나 덮어쓰기 없이 모두 성공하고, 실패한 틱의 `currentTick`, `currentPrice`, `priceHistory`, `tradesHistory`, 전 봇 자본은 정확히 직전 틱 상태로 롤백됨을 확인했습니다.
- **남은 제약**: `CommodityMarketEngine`은 `clock.now()`를 읽기 전용으로 참조하며 별도 가상 시계 오프셋을 전진시키지 않습니다.

### 4. 소액 환전 왕복 반올림 차익 차단
- **변경 파일**: `lib/exchange/exchangeService.ts`
- **구현 내용**:
  - `CURRENCY_SCALE_MAP`(`KRW: 0`, `JPY: 0`, `USD/EUR/CNY/GBP: 2`)과 내림(floor) 양자화 헬퍼 `floorCurrency()`를 도입했습니다.
  - 환전 시 출금 금액(`fromAmount`)과 수취 금액(`toAmount`) 모두 대상 통화의 최소 단위로 `floor` 처리하며, `fromAmount <= 0` 또는 `toAmount <= 0`이면 거래를 거절합니다.
- **검증 근거**: `scripts/test-codex-review-16-fixes.ts` `[4]`번 테스트에서 기본 USD 환율 1380 기준 `7 KRW -> 0 USD` 거절(또는 최소 14 KRW -> `0.01 USD -> 13 KRW` 이하로 가치 증식 불가) 및 `5 KRW -> JPY` 1엔 미만 거절을 확인했습니다.
- **남은 제약**: 없음.

### 5. 공용 가용 현금 계산(승수·수수료 포함, 원자재 증거금 이중 차감 방지)
- **변경 파일**: `lib/engine/orderRisk.ts`, `lib/engine/dbMatching.ts`, `lib/options/optionOrderService.ts`, `lib/exchange/exchangeService.ts`, `app/api/shop/purchase/route.ts`, `lib/commodities/commodityLedger.ts`
- **구현 내용**:
  - `lib/engine/orderRisk.ts`에 `OPTION_RESERVATION_FEE_RATE = 0.001`, `calculateSingleBuyOrderReservedCash()`, `calculateUserReservedCashKrw()`, `getAvailableCashKrw(db, userId)`를 신설하고 기존 `calculateReservedCash`/`validateOrderCapacity`도 선택적 `optionsContracts` 인자를 받아 옵션 미체결 매수 주문의 `multiplier`와 0.1% 수수료를 포함해 계산하도록 통합했습니다.
  - 이미 `profile.cash`에서 즉시 차감되는 `commodityMarginReservations`는 `reservedCash`에 중복 합산하지 않습니다.
  - 주식, 옵션, 환전(KRW 출금), 상점 구매/구독, 원자재 신규 증거금 검증이 모두 `getAvailableCashKrw()`를 사용하도록 교체했습니다.
- **검증 근거**: `scripts/test-codex-review-16-fixes.ts` `[5]`번 테스트에서 옵션 미체결 매수 주문(승수 250,000 + 0.1% 수수료 = 500,500원 예약) 후 주식·환전 가용 현금이 동일하게 제한됨과, 원자재 증거금 차감 후 추가 원자재 주문 시 이중 차감이 발생하지 않음을 검증했습니다.
- **남은 제약**: 없음.

### 6. `engine-server` 재시작 후 `runId` / 주문 ID / 체결 ID 충돌 방지
- **변경 파일**: `lib/memoryDb/memoryStore.ts`, `engine-server/src/restartRuntime.ts`(신규), `engine-server/src/MarketEngine.ts`, `engine-server/src/index.ts`
- **구현 내용**:
  - `MemoryDatabase` 스냅샷에 `engineNextEpoch`, `engineTickCount`, `enginePartialFillSequence`를 추가하고, `restartRuntime.ts`의 `prepareEngineRestartRuntime()`가 스냅샷 복원 후 즉시 epoch를 증가·저장한 뒤 `run_seed_<seed>_e<epoch>`를 할당하고 `tickCount`/`partialFillSequence`를 연속 복원하도록 구성했습니다.
  - 동일 시드 재실행 결정론 테스트 요구(`run_seed_...` 초기 실행 동작)와 운영 재시작 ID 비충돌 요구를 모두 유지합니다.
- **검증 근거**: `test-phase1-suite.ts`의 결정론 테스트(`test-phase1-live-engine-determinism.ts`) 통과 및 `scripts/test-codex-review-16-fixes.ts` `[6]`번 테스트에서 스냅샷 저장 후 재시작 시 `epoch 1 -> 2`, `run_seed_42_e1 -> run_seed_42_e2`, 생성 주문 ID·체결 ID 비중복을 확인했습니다.
- **남은 제약**: 없음.

### 7. 정산 원장 멱등성 유지와 메모리/스냅샷 크기 상한 보장
- **변경 파일**: `lib/memoryDb/memoryStore.ts`, `lib/engine/dbMatching.ts`, `lib/options/optionOrderService.ts`, `lib/engine/localStandaloneServer.ts`, `lib/repositories/inMemory/InMemoryMarketRepository.ts`
- **구현 내용**:
  - `MemoryDatabase`에 monotonic 체결 ID 생성기 `nextMonotonicTradeId('tr' | 'opt_tr')`를 도입하고(`stock`, `option`, `localStandaloneServer` 모두 적용), `trimSettlementLedger()`가 에포크+시퀀스 기반 ID를 O(1) 워터마크(`settledTradeWatermark` / `settledOptionEpochWatermarks` / `settledDeterministicWatermarks`)로 압축하도록 개선했습니다.
  - 실제 생성되는 모든 체결 ID가 에포크 워터마크로 압축 가능하므로 `evictedCustomTradeIds`가 무한 누적되지 않으면서도 압축된 과거 ID의 재정산(replay) 시 `isTradeAlreadySettled()`가 확실히 차단합니다.
- **검증 근거**: `scripts/test-followup-a-to-f.ts` `[B, C]` 및 `scripts/test-codex-review-16-fixes.ts` `[7]`번 테스트에서 10,000건 초과 실제 생성 `tr`/`opt_tr`/`cm_trade`/`eng_tr` ID 트리밍 후 `evictedCustomTradeIds.size === 0`과 재정산 차단(replay 방지)을 검증했습니다.
- **남은 제약**: 임의의 비표준 수동 문자열 ID(테스트용 특수 포맷)만 예외 집합으로 남으며 정규 엔진/거래 생성 ID는 모두 워터마크 압축 대상입니다.

---

## P2 수정 내역 (8 ~ 16번)

### 8. 자동 체결 내구성 경계 및 저장 실패 전파
- **변경 파일**: `lib/engine/simulation/agentManager.ts`, `lib/engine/marketService.ts`, `lib/engine/dbMatching.ts`, `lib/engine/localStandaloneServer.ts`, `engine-server/src/MarketEngine.ts`
- **구현 내용**:
  - `localStandaloneServer`의 봇/LP 매칭 체결(`processMatching`)에 `withStockLock -> withAccountLocks -> runWithCommitGate` 및 저장 실패 시 완전 롤백을 적용하고, 봇/LP 자동 주문(`AgentManager`)에도 `setOnPersist(persistConfirmedState)` + `persistOnlyOnFill: true`를 연결해 체결 발생 시 즉시 영속화하며 실패 시 예외를 기록·롤백합니다.
  - 20틱 주기 `saveSnapshot()`도 `false` 반환 또는 예외 발생을 무시하지 않고 실패 상태(`lastPersistError`)를 기록하며, `engine-server` `MarketEngine.tick()`은 `onTickCommitPersist` 실패 시 `COMMITTED` + `PERSISTENCE_FAILED` 오류를 반환하고 종료 시 런타임 카운터를 동기 저장합니다.
- **검증 근거**: `scripts/test-codex-review-16-fixes.ts` `[8]`번 테스트에서 Next.js 내부 엔진(`processMatching`) 저장 실패 시 보유량/현금/체결 원복과 `engine-server` `MarketEngine.tick()`의 `PERSISTENCE_FAILED` 반환을 모두 검증했습니다.
- **남은 제약**: `AgentManager` 호가 등록(미체결) 자체는 기존 설계대로 메모리 매 틱 갱신되며 체결 발생 시점에만 `persistOnlyOnFill`로 즉시 스냅샷을 저장합니다.

### 9. 옵션 매칭의 LP 호가 vs 사용자 대기 주문 가격 우선 통합 비교
- **변경 파일**: `lib/options/optionOrderService.ts`
- **구현 내용**:
  - `submitAuthoritativeOptionOrder()`에서 매수 시 오름차순 사용자 매도 호가 가격(`opp.price`)이 `lpAskPrice`보다 높으면 즉시 LP 호가 체결로 전환(`if (side === 'BUY' && opp.price > lpAskPrice) break`)하고, 매도 시에도 `lpBidPrice`보다 불리한 사용자 매수 호가보다 LP 호가를 우선 체결합니다.
- **검증 근거**: `scripts/test-codex-review-16-fixes.ts` `[9]`번 테스트에서 LP ask `10`, 사용자 resting ask `20` 상태에서 시장가 매수 시 LP와 가격 `10`으로 체결되고 사용자 ask `20`은 `open` 상태로 유지됨을 검증했습니다.
- **남은 제약**: 없음.

### 10. 원자재 증거금/실현손익의 `rate_to_krw` 권위 스키마 일관화
- **변경 파일**: `lib/exchange/exchangeService.ts`, `lib/commodities/commodityLedger.ts`, `lib/memoryDb/memoryStore.ts`, `lib/repositories/inMemory/InMemoryMarketRepository.ts`
- **구현 내용**:
  - `ExchangeRateRecord` 타입과 `getCurrencyRateToKrw()`를 중심으로 통화 코드별 환율 조회(`rate_to_krw` 우선)를 단일화해 기본 USD 환율 `1380`이 `1350` 폴백으로 잘못 읽히던 문제를 수정했습니다.
  - `InMemoryMarketRepository.upsertExchangeRates()`의 키 조회 역시 `currency_code` 기준으로 정정했습니다.
- **검증 근거**: `scripts/test-codex-review-16-fixes.ts` `[10]`번 테스트에서 `getUsdToKrwRate(db) === 1380` 및 `CRUDE_OIL` 1계약 증거금이 `5000 * 1380 = 6,900,000원`으로 계산됨을 검증했습니다.
- **남은 제약**: DB에 `USD` 레코드가 전혀 없는 극단적 테스트 환경에서만 `1350` 방어 폴백을 사용합니다.

### 11. 원자재 포지션 축소 주문 증거금 면제 및 중복 청산/반전 증거금 검증
- **변경 파일**: `lib/commodities/commodityLedger.ts`
- **구현 내용**:
  - 기존 순포지션을 축소하는 반대 방향 주문은 보유 순포지션에서 동일 방향 기존 미체결 청산 주문 수량을 차감한 순 청산 여력(`closingCapacity`) 범위 내에서 신규 진입 증거금(`0원`)을 면제합니다.
  - `closingCapacity`를 초과하는 중복 청산 주문이나 반대 방향 포지션 전환(flip) 구간 수량에 대해서는 초과 계약분만큼 신규 증거금을 징수·검증하고, 체결 시 보유 증거금을 비례 해제 및 잔여 반대 미체결 주문으로 이관(`transferableReleasedMargin`)합니다.
- **검증 근거**: `scripts/test-codex-review-16-fixes.ts` `[11]`번 테스트에서 잔고 0원 상태의 1계약 롱 보유자가 1계약 매도 청산 주문(`reserved_krw === 0`)은 접수 가능하나, 두 번째 중복 매도 청산 주문은 거부됨을 확인했습니다.
- **남은 제약**: 없음.

### 12. 옵션 계좌 패널 실데이터 연동 및 전체 취소·전량 청산 구현
- **변경 파일**: `lib/options/optionOrderService.ts`, `app/api/options/account/route.ts`(신규), `app/components/OptionAccountPanel.tsx`, `app/components/OptionHTSDashboard.tsx`
- **구현 내용**:
  - 서버에 `getOptionAccountSummary()`, `cancelOptionOrder()`, `cancelAllOptionOrders()`, `liquidateAllOptionPositions()`를 구현하고 `GET/POST /api/options/account` API를 신설했습니다.
  - `OptionAccountPanel.tsx`와 `OptionHTSDashboard.tsx`에서 샘플 계좌/가짜 `alert`를 제거하고, 실제 본인 잔고·예약금·보유 포지션·미체결 주문·체결 내역 및 단건 취소/일괄 취소/일괄 시장가 청산·결과 갱신을 서버 API에 연동했습니다.
- **검증 근거**: `scripts/test-codex-review-16-fixes.ts` `[12,13]` 테스트 및 격리 `next start` `GET /api/options/account` -> `200`, `GET /options` -> `200` 확인.
- **남은 제약**: 브라우저 UI 클릭 인터랙션(Playwright) 대신 API·서비스 단위 통합 테스트와 프로덕션 SSR 렌더 검증을 수행했습니다.

### 13. 옵션 체인 월물/행사가/시세의 실제 DB 계약 데이터 연동 (만기된 `202608` 제거)
- **변경 파일**: `lib/memoryDb/memoryStore.ts`, `app/components/OptionMonthChainGrid.tsx`, `app/components/OptionHTSDashboard.tsx`
- **구현 내용**:
  - `MemoryDatabase.seedDefaultData()`가 현재 기준 향후 3개월 월물(`IDX-K200-YYMM-C/P{strike}`)의 콜/풋 옵션 체인을 동적 미래 만기일로 생성하도록 변경했습니다(하위 호환용 `opt_c_720`/`opt_p_720` 역시 미래 만기일 부여).
  - `OptionMonthChainGrid.tsx`와 `OptionHTSDashboard.tsx`에서 고정 `202608` 더미 배열을 제거하고 DB `options_contracts`(`asset_class === 'IDX'`)를 만기 월물·행사가별로 그룹핑해 선택한 계약의 실제 ID/티커를 일치시켰습니다.
- **검증 근거**: `scripts/test-codex-review-16-fixes.ts` `[12,13]` 및 격리 `next start` `POST /api/local-db` (`options_contracts`, `IDX`)에서 40건 이상의 미래 만기 IDX 계약 반환(ticker에 `2608` 미포함)을 확인했습니다.
- **남은 제약**: 동일.

### 14. ETF 거래의 서버 권위 `/api/orders` 연동 및 12종 ETF 서버 시드
- **변경 파일**: `lib/engine/etfDefinitions.ts`, `lib/memoryDb/memoryStore.ts`, `app/etf/page.tsx`
- **구현 내용**:
  - `MemoryDatabase.seedDefaultData()` 및 `STOCK_UUID_MAP`에 `ETF_CATALOG` 12개 ETF 종목 전체를 서버 초기 데이터로 시드했습니다.
  - `app/etf/page.tsx`에서 403 오류를 유발하던 클라이언트 `stocks.upsert`와 가짜 낙관적 `profiles`/`holdings` 갱신을 제거하고, 호가창 조회 후 `/api/orders`를 호출해 응답 성공 여부에 따라 실제 에러를 표시하고 성공 시 서버 잔고/보유량 재조회로 동기화합니다.
- **검증 근거**: `scripts/test-codex-review-16-fixes.ts` `[14]`번 테스트(12종 ETF 전수 시드 + `/api/orders` 체결 검증) 및 격리 `next start` `POST /api/orders` (`00000000-0000-4000-8000-000000000201`) -> `200`, `GET /etf` -> `200` 확인.
- **남은 제약**: ETF UI 페이지 브라우저 클릭 인터랙션은 수동/Playwright 미실행 상태입니다.

### 15. 랜덤 이벤트 선택의 서버 권위 검증·비용 차감·패시브 반영
- **변경 파일**: `lib/memoryDb/memoryStore.ts`, `lib/events/playerEventService.ts`(신규), `app/api/events/resolve/route.ts`(신규), `app/api/local-db/route.ts`, `app/components/RandomEventModal.tsx`
- **구현 내용**:
  - `ProfileRecord`에 `acquired_passives?: string[]` 필드를 추가하고 `active_player_events`를 `USER_SCOPED_READ_TABLES`로 이동해 타인의 이벤트 조회·임의 수정을 차단했습니다.
  - `playerEventService.ts` + `POST /api/events/resolve`가 세션 소유자, 이벤트 `pending` 상태, 선택지(`A`/`B`), 서버 기준 비용(`cost`), 예수금 충분 여부 검증 후 `withAccountLocks -> runWithCommitGate` 안에서 비용 차감, 패시브 부여, 상태 `resolved` 갱신 및 저장 실패 시 롤백을 수행합니다.
  - `RandomEventModal.tsx`는 서버 응답 `200` 성공 시에만 모달을 닫고, 오류 응답 시 인라인 오류를 표시합니다.
- **검증 근거**: `scripts/test-codex-review-16-fixes.ts` `[15]`번 테스트(비소유자 403, 저장 실패 시 cash/status/passive 롤백, 성공 시 차감·패시브·resolved, 중복 요청 409) 및 `next start` `POST /api/events/resolve` -> `404` 확인.
- **남은 제약**: 없음.

### 16. DB 준비 상태와 엔진 기동 분리 및 콜드 스타트 복원 대기 통일
- **변경 파일**: `lib/engine/localStandaloneServer.ts`, `app/api/auth/[...nextauth]/route.ts`, `lib/auth/adminAuth.ts`, `lib/auth/useAuth.ts`, `lib/db/server.ts`, `app/api/market-flow/route.ts`, `app/api/admin/scenarios/route.ts`
- **구현 내용**:
  - `ensureMemoryDbReady()`(스냅샷 로드·DB 복원 전용)와 `ensureLocalStandaloneReady()`(DB 복원 + 엔진 기동)를 분리하고, `next build` 빌드 단계(`NEXT_PHASE === 'phase-production-build'`)에서는 백그라운드 타이머 기동을 방지했습니다.
  - NextAuth `signIn`/`session` 콜백은 `ensureMemoryDbReady()`만 대기한 뒤 `try-catch`와 `withAccountLocks + runWithCommitGate`로 신규 프로필을 생성·저장해 OAuth 세션 콜백과 엔진 초기화 간 순환 대기를 끊었습니다.
  - `lib/auth/useAuth.ts`(`'use client'`)에서 서버 전용 `authOptions`/`getServerSession` 재내보내기를 제거해 클라이언트 번들이 `StorageAdapter`/`fs`를 끌어오던 빌드 오류를 해결했습니다.
  - `verifyAdminSession`, `lib/db/server.ts`, `/api/market-flow`, `/api/admin/scenarios`가 콜드 스타트 시 준비 완료를 안정적으로 대기하도록 통일했습니다.
- **검증 근거**: `scripts/test-codex-review-16-fixes.ts` `[16]`번 테스트(스냅샷 사전 저장 후 콜드 스타트 복원 대기 검증), `npx next build` 성공, 격리 `next start` `/api/auth/providers` 200 JSON, `/api/market-flow` 200, `/api/admin/scenarios` 403 확인.
- **남은 제약**: 없음.
