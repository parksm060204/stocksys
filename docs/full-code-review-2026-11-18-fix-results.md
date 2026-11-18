# 전체 코드 리뷰 발견 사항(F1~F25) 수정 결과 보고서 (2026-11-18)

## 1. 요약 및 검증 게이트

`docs/full-code-review-2026-11-18-findings.md`의 원본 번호·심각도(`F1`~`F25`)에 맞춰 수정 내역, 정책 변경, 검증 결과, 미완료·잔여 한계를 기록합니다.

| 검증 항목 | 명령 / 대상 | 최신 결과 | 비고 |
| --- | --- | --- | --- |
| Root TypeScript | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | `EXIT=0` | 0 errors |
| Engine-Server TypeScript | `node node_modules/typescript/bin/tsc -p engine-server/tsconfig.json --noEmit --incremental false` | `EXIT=0` | 0 errors |
| ESLint | `npm run lint` | `EXIT=0` | 0 errors, 147 warnings |
| Next.js Production Build | `npm run build` (임시 `STOCKSYS_DATA_DIR`) | `EXIT=0` | Next.js 16.3.5 Turbopack, 28 routes |
| F1~F25 신규 회귀 테스트 | `npx tsx scripts/test-full-review-2026-11-18-fixes.ts` | `EXIT=0` | `[1]`~`[8]`(부채 계좌 주식/옵션/환전/이벤트 차단 및 상환·NAV, `acquired_passives` 포함) 통과 |
| Codex 16 리뷰 회귀 테스트 | `npx tsx scripts/test-codex-review-16-fixes.ts` | `EXIT=0` | 16/16 통과 (`evictedCustomTradeIds` 미증가 확인 포함) |
| 기존 실패 3건 복구 | `test-phase2-bot-portfolio-authority.ts`, `test-order-security-and-atomic.ts`, `test-phase3-atomic-lp-quote-refresh.ts` | 모두 `EXIT=0` | 3건 전부 통과 |
| Follow-up A~F 검증 | `npx tsx scripts/test-followup-a-to-f.ts` | `EXIT=0` | F4 마진 부채 정책 반영 후 통과 |
| 격리 HTTP 스모크 테스트 | `next start -p 3199` (임시 `STOCKSYS_DATA_DIR`, 종료 후 삭제) | 통과 | `/v2/stocks`, `/etf`, `/shop`, `/admin`, `/api/commodities` 200; `/api/market-flow` `marketState` 미노출; `/api/options/order` 401; `/api/admin/scenarios` 403; `/api/shop/purchase` 401 |

### 기존 75개 테스트 스위트 조사 및 분류 결과

초기 45~60초 일괄 실행에서 나타난 7 FAIL / 3 TIMEOUT을 개별 원인(50MB `maxBuffer`, 180초 타임아웃, 코드 대조)으로 재검증해 다음과 같이 구분했습니다.

| 스크립트 | 재검증 결과 | 구분 및 구체적 원인 |
| --- | --- | --- |
| `test-regime-effects-stage2.ts` | **PASS (`EXIT=0`, 4.4s)** | 초기 `EXIT=null`은 Node `spawnSync` 기본 1MB stdout 버퍼 초과(`ENOBUFS`)였음. 50MB 버퍼로 통과 확인. |
| `test-market-regime-long-run.ts` | **PASS (`EXIT=0`, 90.1s)** | 장기 시뮬레이션으로 60s 타임아웃을 초과했으나 180s 실행 시 정상 통과. |
| `test-causal-market-flow.ts` | **시나리오 A~H 전부 PASS** (종료 대기 타임아웃) | `🎉 ALL CAUSAL MARKET FLOW SCENARIOS (A ~ H) PASSED PERFECTLY!` 출력 후 `LocalMarketEngine`의 백그라운드 `setInterval`이 이벤트 루프를 유지해 프로세스 미종료. |
| `test-market-flow-verification.ts` | **시나리오 전부 PASS** (종료 대기 타임아웃) | `🎉 ALL MARKET FLOW VERIFICATION SCENARIOS PASSED!` 출력 후 동일하게 `LocalMarketEngine` `setInterval`로 이벤트 루프 미종료. |
| `test-market-regime-foundation.ts` | **기존 오류 (`EXIT=1`, 2.8s)** | 초기 `ENOBUFS` 해소 후 재실행 시 2305행 `B: 양측 호가 복구 후 공백 비율 0 (실제: 0.0909...)`에서 실패. 본 수정(F1~F25)과 무관한 기존 LP 복구/스텝 간 호가 공백 이슈. |
| `test-comprehensive-audit-fixes.ts` | **기존 노후 테스트 (`EXIT=1`)** | 137행 `TypeError: Cannot read properties of undefined (reading 'processMatching')` — 제거된 내부 메서드 호출. |
| `test-concurrency-and-stale-ref.ts` | **기존 노후 테스트 (`EXIT=1`)** | 157행 `TypeError: Cannot read properties of undefined (reading 'refreshLpOrders')` — 제거된 내부 메서드 호출. |
| `test-stage1-verification.ts` | **기존 실패 (`EXIT=1`)** | 368행 `높은 불확실성에서는 요구 마진 확대로 신중하게 보류(hold) 전환` — 국내 종목(`fxRateToKrw=1`) 불확실성 마진 캘리브레이션 불일치. |
| `test-stage2-review-fixes.ts` | **기존 fixture 불일치 (`EXIT=1`)** | 752행 `obsAfterOrderA?.account.reservedCash === 40000 * 50` (실제 `2005000`) — 테이커 수수료 0.25%가 예약금에 포함된 현행 사양과 구기대값(`2000000`) 불일치. |
| `test-transaction-isolation.ts` | **기존 아키텍처 불일치 (`EXIT=1`)** | 103행 `Stock B transaction succeeds` — `LocalMarketService.submitOrder`가 `PersistenceManager.withCommitGate` 전역 직렬화 락을 사용하므로 Stock A의 `_testFailureHook` 내부에서 Stock B가 동시 완료될 수 없음. |

---

## 2. F1 ~ F25 개별 수정 내역 (원본 번호·심각도 기준)

### [F1] `P0` — `engine-server` IDX K200 옵션 기초자산·행사가 단위 불일치(`72,000` vs `260`)로 만기 정산 시 1계약당 `179.35억` 원 과다 지급 — **해결**
- `K200_INDEX_UNDERLYING_ID = 'idx_k200'`, `K200_INDEX_BASE_VALUE = 260.0`, `computeK200IndexPrice(stocks)`를 도입해 K200 지수 옵션의 기초자산을 시가총액 가중 지수(~260pt)로 분리했습니다.
- `applySnapshotData(..., { migrateCatalog: true })`의 `migrateLegacyIdxOptionUnderlyings()`가 기존 `opt_k200_*`/`IDX-K200` 계약의 행사가·만기일을 유지한 채 `underlying_stock_id`를 `idx_k200`으로 자동 이관합니다.
- `InMemorySettlementRepository`, `OptionSettlementEngine`, `SettlementBatchService`에 `asset_class` 및 `HELD_UNDERLYING_UNIT_MISMATCH` fail-closed 가드를 추가했습니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts:30](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts#L30), [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemoryMarketRepository.ts:62](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemoryMarketRepository.ts#L62), [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts:1510](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts#L1510)

### [F2] `P0` — `InMemorySettlementRepository.settleBondMaturityAtomically`의 `coupon_rate` 단위 불일치(% vs 소수)로 시드 채권 전체 거부 및 소수 쿠폰 100배 과다지급 — **해결**
- `BondCouponEngine`과 동일하게 `coupon_rate`를 연 퍼센트 단위(`3.25` = 3.25%)로 통일해 상한 검증을 `couponRate > 100`으로 고치고 `face_value * (couponRate / 100) * holding.quantity`로 정산합니다.
- 기존 테스트 픽스처([/C:/Users/abcde/Desktop/웹소설/stock-sys/scripts/test-phase1-settlement-integrity.ts:603](/C:/Users/abcde/Desktop/웹소설/stock-sys/scripts/test-phase1-settlement-integrity.ts#L603))도 `coupon_rate: 5.0`으로 정합화했습니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts:1681](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts#L1681)

### [F3] `P0` — `InMemorySettlementRepository.executeCommitMatchedBatchAtomically` Phase 5 롤백 시 체결된 신규 주문(`newOrders`) 재삽입 — **해결**
- `newlyInsertedOrderIds`를 `ordersSnapshot`에서 제외해 롤백 시 `db.orders`와 `orderStockIndex`에서 신규 주문이 완전히 삭제되도록 수정했습니다(`replaceLpQuotesAtomically`에도 동일 패턴 유지).
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts:1008](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts#L1008), [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts:1291](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts#L1291)

### [F4] `P1` — 원자재 선물 정산 시 강제청산·손실 하한 부재로 `profile.cash` 음수 추락 및 부채 계좌 전 경로 보호 — **해결**
- `ProfileRecord.margin_debt_krw` 및 `applyCashDeltaWithMarginDebt`를 도입해 타 자산 예약금(`reservedCash`)과 `cash >= 0` 하한을 보호하고, 미지급 손실은 `margin_debt_krw`로 기록합니다.
- `evaluateAndLiquidateCommodityMaintenanceMargin`으로 초기 증거금의 50% 미만 시 강제 청산을 수행합니다.
- **전 경로 공통 정책 적용**:
  - `getAvailableCashKrw` (`margin_debt_krw > 0`이면 `availableCash = 0`): 옵션, 원자재, 상점, 랜덤 이벤트, `KRW -> 외화` 환전 차단.
  - `validateOrderCapacity` + `dbMatching.ts`: `marginDebtKrw > 0`이면 raw `currentCash`와 무관하게 주식/ETF 매수 주문 차단.
  - `executeCurrencyExchange`: 부채 상태에서 외화 간 환전(`USD -> EUR`) 차단, `외화 -> KRW` 환전 시 `applyCashCreditWithMarginDebt`로 부채 우선 상환.
  - `applyCashCreditWithMarginDebt`: 주식/ETF 매도(`memoryDbClient.ts`), 옵션 매도(`optionOrderService.ts`), 채권·옵션 만기 지급(`InMemorySettlementRepository.ts`) 수익금으로 부채 우선 상환.
  - `calculateAuthoritativePortfolioValuation` (`marketObservation.ts:138`) 및 `app/mypage/page.tsx:187`: 총자산/NAV에서 `margin_debt_krw` 차감.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/orderRisk.ts:173](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/orderRisk.ts#L173), [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/dbMatching.ts:154](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/dbMatching.ts#L154), [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/exchange/exchangeService.ts:155](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/exchange/exchangeService.ts#L155), [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/commodityLedger.ts:321](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/commodityLedger.ts#L321), [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/marketObservation.ts:137](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/marketObservation.ts#L137)

### [F5] `P1` — `AgentManager.applyCrossAssetRiskGate`의 보유량 조회 키 구분자 불일치(`:` vs `_`)로 매도 게이트 항상 차단 — **해결**
- `memoryDb.holdings.get` 키를 `${agent.accountId}_${stock.id}`로 통일하고 `getStockFxRateToKrw(memoryDb, hStock)` 인자 순서를 교정했습니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/agentManager.ts:682](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/agentManager.ts#L682), [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/agentManager.ts:1141](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/agentManager.ts#L1141)

### [F6] `P1` — `AgentManager` · `marketObservation` · `valueStrategy` · `trendStrategy`의 USD 종목 환율(`fxRateToKrw`) 및 틱 단위 미반영 — **해결**
- `calculateAuthoritativePortfolioValuation`에서 종목별 `getStockFxRateToKrw`를 곱해 KRW NAV를 산출하고, 전략 레이어에 USD `$0.01` 틱 크기 및 `alignedPrice * fxRate * 1.0025` 매수 비용 계산을 적용했습니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/marketObservation.ts:125](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/marketObservation.ts#L125), [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/strategies/valueStrategy.ts:1](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/strategies/valueStrategy.ts#L1), [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/strategies/trendStrategy.ts:1](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/strategies/trendStrategy.ts#L1)

### [F7] `P1` — `engine-server` 비-LP 전략 봇들의 `is_lp: true` 표기로 `MarketEngine.validateSingleOrder`에서 `REJECTED_UNAUTHORIZED_LP` 거부 — **해결**
- 9개 비-LP 봇(`WallBreakerAgent`, `HedgeFundAgent`, `CommercialBankAgent`, `CommodityBots`, `StatArbAgent`, `RetailSwarmAgent`, `AdversarialAgent`, `PensionFundAgent`, `BaseAgent`)의 주문 생성을 `is_lp: false`로 교정하고, `ASMarketMakerAgent`만 `shouldRefreshLp` 게이트로 LP 호가를 제출하도록 수정했습니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:850](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts#L850), [/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/BaseAgent.ts:1](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/BaseAgent.ts#L1)

### [F8] `P1` — `/v2/stocks` 페이지의 `snake_case` DB 행 무매핑 전달로 전 종목 `₩0` / `0.00%` 표시 — **해결**
- `app/v2/stocks/page.tsx`에서 `snake_case` DB 행을 `Stock`(`camelCase`) 모델로 정규화 매핑했습니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/app/v2/stocks/page.tsx:1](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/v2/stocks/page.tsx#L1)

### [F9] `P1` — `/v2/stocks/[id]` `PriceHeroV2`가 no-op `db.channel()`만 사용해 실시간 시세 미갱신 — **해결**
- `db.channel()`을 1500ms `stocks` 폴링(언마운트 cleanup 포함)으로 대체하고 `fmtPrice(price, stock.market, stock.ticker)`를 적용했습니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/v2/PriceHeroV2.tsx:1](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/v2/PriceHeroV2.tsx#L1)

### [F10] `P1` — `OptionsPanel`의 `/api/options/order` 필드 불일치(`quantity` vs `qty`, `res.filledQty` vs `res.order?.filledQty`) — **해결**
- 요청 페이로드를 `qty`로 교정하고 `res.order?.filledQty ?? res.filledQty ?? 0`으로 체결 수량을 판독하며, 롤오버 시 동일 타입·동일 행사가 매칭 및 1차 레그 체결 수량 클램핑을 적용했습니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionsPanel.tsx:1](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionsPanel.tsx#L1)

### [F11] `P2` — `MarketEngine.fetchMarketState`의 빈 `orderBook: {}` 고정 반환 및 `ASMarketMakerAgent.ordersToCancel` 미소비 — **해결**
- `buildOrderBookSnapshot()`으로 활성 호가 스냅샷을 생성해 `marketState.orderBook`을 채우고, `ASMarketMakerAgent.ordersToCancel`을 실제로 취소 큐에 연결했습니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:1620](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts#L1620)

### [F12] `P2` — `ActiveOrdersPanel`이 `memoryDbClient` 미지원 조인(`stocks(...)`)에 의존해 로컬 모드 종목명·통화 오표시 — **해결**
- `memoryDbClient.ts`의 `orders` 조회 시 `stocks` 관계 조인 데이터를 주입하도록 구현했습니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryDbClient.ts:381](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryDbClient.ts#L381)

### [F13] `P2` — 채권 상세 페이지(`/stocks/[bondId]`) 주문 패널이 항상 `400` 거부되는 주식 API(`/api/orders`) 호출 — **해결**
- `OrderEntry.tsx`에서 `stock.market === 'bonds'`인 경우 주문 제출을 비활성화하고 채권 거래 불가 안내 문구를 표시하도록 수정했습니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OrderEntry.tsx:1](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OrderEntry.tsx#L1)

### [F14] `P2` — `POST /api/admin/scenarios`에서 `initialPrice` 누락 시 `stocks.target_price` `NaN` 기록 및 영속 저장·락 누락 — **해결**
- `initialPrice` 미전달 시 현재가 폴백 및 `Number.isFinite` 검증을 추가했고, `list_stock` 및 `trigger_ai_event` 액션을 `runWithCommitGate(persistConfirmedState, ...)` 및 실패 롤백과 함께 구현했습니다(`adminSettings.get('1')` 문자열 키 조회 포함).
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/admin/scenarios/route.ts:1](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/admin/scenarios/route.ts#L1)

### [F15] `P2` — `app/admin/page.tsx` 비로그인 시 UI 관리자 권한 우회 및 로컬 DB에서 무조건 `403` 실패하는 쓰기 호출 — **해결**
- `!isLoggedIn => setIsAdmin(true)` 우회를 제거하고, 신규 상장·AI 이벤트 실행 호출을 `/api/admin/scenarios`로 일원화했습니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/app/admin/page.tsx:1](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/admin/page.tsx#L1)

### [F16] `P2` — `GET /api/market-flow`의 비인증 내부 시뮬레이션 상태(`marketState`) 전체 노출 — **해결**
- `verifyAdminSession`을 통과한 관리자 요청에만 `marketState`를 포함하고 일반/비로그인 요청에서는 제외합니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/market-flow/route.ts:1](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/market-flow/route.ts#L1)

### [F17] `P2` — 상점 유료 부스터(`fee_booster`, `scanner_item`, `ai_predictor`) 및 이벤트 `acquired_passives` 효과 미연동 — **해결**
- **`fee_booster`**: `hasActiveFeeBooster`가 `unlocked_features`의 `fee_booster`(만료일 내)뿐 아니라 `acquired_passives`의 `'fee_booster'` 보유자도 인식하도록 연결해 `orderRisk.ts` 예약금과 `dbMatching.ts` 테이커 수수료 모두 50% 감면(0.25% → 0.125%)을 적용합니다.
- **`scanner_item` / `ai_predictor`**: `lib/shop/catalog.ts`에서 신규 판매를 중단(`availableForPurchase: false`)하고 `POST /api/shop/purchase`는 `410 Gone`을 반환하며, 기존 보유자의 `unlocked_features` 권리는 유지합니다.
- **`acquired_passives` 정책 및 기존 보유자 처리**: `'fee_booster'` 외의 일반 이벤트 패시브 문자열(예: `PASSIVE_INSIGHT`)은 프로필/아카이브 배지 전용으로 유지하되, `RandomEventModal.tsx` UI 문구를 `프로필 배지(수치 효과 없음)`으로 명확히 수정해 미구현 유료 버프 오인을 방지했습니다(기존 보유자의 `acquired_passives` 배열은 삭제 없이 보존).
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/shop/catalog.ts:91](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/shop/catalog.ts#L91), [/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/shop/purchase/route.ts:1](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/shop/purchase/route.ts#L1), [/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/RandomEventModal.tsx:147](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/RandomEventModal.tsx#L147)

### [F18] `P2` — `OptionMonthChainGrid`의 고정 하드코딩 선물 지수(`260.45`, `126,293`)로 인한 ATM 오표시 — **해결**
- `OptionHTSDashboard`와 `OptionMonthChainGrid`가 실시간 계산된 K200 지수 props를 사용하도록 수정했습니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionHTSDashboard.tsx:1](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionHTSDashboard.tsx#L1), [/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionMonthChainGrid.tsx:1](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionMonthChainGrid.tsx#L1)

### [F19] `P2` — `MemoryDatabase.restoreRollbackSnapshot`의 `Object.assign` 병합으로 틱 중 추가된 프로필 키 잔존 — **해결**
- `restoreRollbackSnapshot`에서 `Object.assign` 전 스냅샷에 없던 프로필 키(`has_options_license` 등)를 `delete`하도록 수정했습니다(`CommodityMarketEngine` 롤백 포함).
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts:1460](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts#L1460)

### [F20] `P2` — `MemoryDatabase.trimSettlementLedger`의 `settledBondRedemptions` 및 `evictedCustomTradeIds` 상한 부재 — **부분해결 (상한 적용 + 유한성 반증 제시)**
- **`settledBondRedemptions`**: `settledBondRedemptionWatermarkYm`과 `compactSettledBondRedemptionKeys()`를 도입해 만기 상환 키를 연월 워터마크로 압축(`<= 2000` 상한 유지)했습니다.
- **`evictedCustomTradeIds` 도달성 조사 및 유한성 반증**:
  - **활성 생성자 도달성 조사**: 프로덕션 활성 경로의 6개 ID 생성기(`dbMatching.ts`/`localStandaloneServer.ts`의 `tr_e{epoch}_{seq}`, `optionOrderService.ts`의 `opt_tr_e{epoch}_{seq}`, `MarketEngine.ts`의 `det_fill_{runId}_{seq}`, `BondCouponEngine.ts`의 `bond_coupon_*_period_{YYYY-MM}`, `BondCouponEngine.ts`/`InMemorySettlementRepository.ts`의 `bond_maturity_redemption_*_period_{YYYY-MM}`, `OptionSettlementEngine.ts`의 `opt_settle_*_{YYYY-MM-DD}`)는 모두 워터마크·구간·날짜 워터마크로 압축되므로 **프로덕션 정상 동작에서는 `evictedCustomTradeIds`에 단 한 건도 유입되지 않습니다** (`test-codex-review-16-fixes.ts` `[7]` 검증 통과).
  - **유한성 반증 (비둘기집 원리)**: 반면 테스트/직접 호출자가 임의의 비구조화 문자열(`custom_adhoc_id` 등)을 무한 개수로 주입할 경우, 임의의 집합 $S$를 상한 $K < |S|$의 유한 메모리에 손실 없이 저장하면서 동시에 (1) 중복지급 완전 차단(false negative=0)과 (2) 미체결 ID 오차단 방지(false positive=0)를 함께 달성하는 것은 비둘기집 원리상 수학적으로 불가능합니다. 따라서 단순 FIFO로 기체결 키를 망각하는 대신 `evictedCustomTradeIds`를 무손실 보존하고(활성 생성자 미도달), 프로덕션 호출부는 반드시 구조화된 단조/기간 키만 사용하도록 분리했습니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts:393](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts#L393), [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts:1407](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts#L1407)

### [F21] `P2` — `CommodityMarketEngine.stepTickAsync`에서 자전거래 취소 주문을 `'expired'` 상태로 환불 처리 — **해결**
- `TickSummary.selfTradeCancelledOrders`를 추가해 자전거래(STP) 취소 주문을 `'cancelled'`로, 만료 주문을 `'expired'`로 구분 환불합니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/CommodityMarketEngine.ts:32](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/CommodityMarketEngine.ts#L32), [/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/CommodityMarketEngine.ts:710](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/CommodityMarketEngine.ts#L710)

### [F22] `P3` — 마이페이지 채권(`/bonds`) 및 사이드바 경제지표(`/eco`) 링크의 404 라우트 — **해결**
- `app/mypage/page.tsx` 보유 종목 링크를 `/stocks/${h.stock_id}`로 수정하고 `Sidebar.tsx`의 미구현 `/eco` 메뉴를 제거했습니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/app/mypage/page.tsx:127](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/mypage/page.tsx#L127), [/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/Sidebar.tsx:1](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/Sidebar.tsx#L1)

### [F23] `P3` — `TopBar` 상단 종목 검색 입력창의 핸들러 미연결 — **해결**
- `TopBar.tsx`에 실시간 종목명/티커 검색 드롭다운 및 Enter 이동(`/stocks/${id}`)을 구현했습니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/TopBar.tsx:1](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/TopBar.tsx#L1)

### [F24] `P3` — `MarketEngine.ts`의 WTI 매크로 충격 ID 불일치(`WTI_CRUDE` vs `CRUDE_OIL`) 및 `AGENTS.md`·워크스페이스 불일치 — **해결**
- `MarketEngine.ts`에서 `'CRUDE_OIL'`과 `'WTI_CRUDE'`를 모두 조회하도록 수정했고, `AGENTS.md`에 `vm-db/`가 `archive/legacy-postgres/`로 아카이브된 비활성 경로임을 명시했습니다.
- 파일: [/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:1710](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts#L1710), [/C:/Users/abcde/Desktop/웹소설/stock-sys/AGENTS.md:168](/C:/Users/abcde/Desktop/웹소설/stock-sys/AGENTS.md#L168)

### [F25] `P3` — `npm run lint` 실패(`eslint` 오류 5건) 및 기존 회귀 스크립트 3건 실패 — **해결**
- `npm run lint`가 `EXIT=0` (0 errors, 147 warnings)으로 통과하며, 기존 실패 3건(`test-phase2-bot-portfolio-authority.ts`, `test-order-security-and-atomic.ts`, `test-phase3-atomic-lp-quote-refresh.ts`)도 모두 `EXIT=0`으로 복구했습니다.

---

## 3. 미검증 영역

- **실제 브라우저(Playwright) 상호작용 E2E**: `next start -p 3199` SSR/API HTTP 스모크 테스트는 통과했으나 헤드리스 브라우저 DOM 클릭·차트 상호작용은 미실행입니다.
- **외부 연동(OAuth / Yahoo Finance / 원격 PostgreSQL)**: 운영 `.data` 및 외부 DB 보호 원칙에 따라 비활성 상태에서 검증했습니다.
