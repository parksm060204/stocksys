# 전체 코드 독립 리뷰 보고서 (2026-11-18)

- **검토 대상**: `HEAD` 및 미커밋 수정·신규 파일 전체 (`C:\Users\abcde\Desktop\웹소설\stock-sys`)
- **검토 원칙**:
  - 애플리케이션·테스트·설정 파일은 일절 수정하지 않음(읽기 전용 감사).
  - 운영 `.data` 및 원격 PostgreSQL/Redis에 접근·변이하지 않고, 격리된 임시 `STOCKSYS_DATA_DIR` 및 메모리 인스턴스에서만 검증·반례 재현을 수행함.
  - 이전 수정 워커의 보고서([post-fix-review-remediation-results.md](/C:/Users/abcde/Desktop/웹소설/stock-sys/docs/post-fix-review-remediation-results.md:1-223))는 맥락 및 재검증 대상으로만 취급하며, 본 보고서의 모든 결함과 수치는 직접 읽은 코드 및 직접 실행한 명령 출력만을 근거로 기술함.

---

## 1. 요약 (심각도별 건수)

| 심각도 | 건수 | 비고 |
| :---: | :---: | :--- |
| **P0** | 3 | 파생/채권 정산 단위 불일치(179억 과지급·시드 채권 정산 불가), 배치 롤백 시 신규 주문 재삽입 |
| **P1** | 7 | 원자재 음수 현금 추락, ABM cross-asset 키 불일치/USD FX 미환산, 비-LP 봇 `is_lp` 거부, V2 시세 0원/미갱신, `OptionsPanel` `quantity`/`qty` 불일치(이전 `P2-5.4` 잔존 1건 포함) |
| **P2** | 11 | `MarketEngine` 빈 `orderBook: {}` 및 `ordersToCancel` 미소비, `ActiveOrdersPanel` 조인 누락, 채권 주문 400 실패, 관리자 시나리오 `NaN`/`persist` 누락, `AdminPage` 비로그인 우회 및 403 쓰기, 비인증 `GET /api/market-flow`, 상점 부스터/패시브 미연동, 옵션 그리드 하드코딩 지수, `restoreRollbackSnapshot` 잔존 키, 정산 Set 상한 부재, 자전거래 `'expired'` 표기 |
| **P3** | 4 | `/bonds`·`/eco` 404 링크, `TopBar` 검색 미구현, `WTI_CRUDE`/`CRUDE_OIL` 및 `vm-db` 경로 불일치, `npm run lint` 및 기존 테스트 3건 실패 |
| **합계** | **25** | Section 5의 `P2-5.4` 잔존 판정은 `F10`과 동일 건으로 중복 합산하지 않음 |

---

## 2. 검토 범위표 및 미검토·미실행 영역

### 2.1 직접 읽고 점검한 영역

| 영역 | 점검 파일 및 범위 |
| :--- | :--- |
| 규칙·설정·문서 | [AGENTS.md](/C:/Users/abcde/Desktop/웹소설/stock-sys/AGENTS.md:1-176), [package.json](/C:/Users/abcde/Desktop/웹소설/stock-sys/package.json:1-39), [next.config.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/next.config.ts:1-7), [proxy.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/proxy.ts:1-11), [instrumentation.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/instrumentation.ts:1-9), [tsconfig.json](/C:/Users/abcde/Desktop/웹소설/stock-sys/tsconfig.json:1-34), [eslint.config.mjs](/C:/Users/abcde/Desktop/웹소설/stock-sys/eslint.config.mjs:1-50), [engine-server/tsconfig.json](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/tsconfig.json:1-45), [02_get_authoritative_orderbook.sql](/C:/Users/abcde/Desktop/웹소설/stock-sys/docs/sql/02_get_authoritative_orderbook.sql:1-100), [post-fix-review-remediation-results.md](/C:/Users/abcde/Desktop/웹소설/stock-sys/docs/post-fix-review-remediation-results.md:1-223) |
| 인증·API·DB 어댑터 | `lib/auth/*`, `app/api/auth/[...nextauth]/route.ts`, `lib/db/client.ts`([175-244](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/db/client.ts:175-244)), [local-db/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts:1-589), [orders/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/orders/route.ts:1-181), [options/order/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/options/order/route.ts:1-60), `app/api/options/account/route.ts`, `app/api/commodities/route.ts`, `app/api/events/resolve/route.ts`, `app/api/shop/purchase/route.ts`, [admin/scenarios/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/admin/scenarios/route.ts:1-147), [market-flow/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/market-flow/route.ts:1-154), [analyze/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/analyze/route.ts:1-272), [adminAuth.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/auth/adminAuth.ts:1-66) |
| 인메모리 DB·저장소 | [memoryStore.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts:1-1768), [memoryDbClient.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryDbClient.ts:1-977), `accountLocks.ts`, `PersistenceManager.ts`, `StorageAdapter.ts`, `memoryTransaction.ts`, [InMemorySettlementRepository.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts:1-1756), `InMemoryMarketRepository.ts`, `InMemoryParticipantRepository.ts`, `InMemoryEventRepository.ts`, [inMemory/index.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/index.ts:1-32) |
| 엔진·정산·상품군 | `lib/engine/{currency,etfDefinitions,dbMatching,marketService,settlement}.ts`, [orderRisk.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/orderRisk.ts:1-265), [localStandaloneServer.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts:1-720), [agentManager.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/agentManager.ts:1-2706), [marketObservation.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/marketObservation.ts:1-332), `strategies/{lpStrategy,valueStrategy,trendStrategy}.ts`, [optionOrderService.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/options/optionOrderService.ts:1-936), [definitions.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/definitions.ts:1-250), [commodityLedger.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/commodityLedger.ts:1-673), [CommodityMarketEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/CommodityMarketEngine.ts:1-836), `lib/{exchange/exchangeService,events/playerEventService,shop/catalog,scenario/ScenarioManager,format,bond-utils}.ts`, [priceHistoryService.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/services/priceHistoryService.ts:1-258), [optionBotEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/optionBotEngine.ts:1-100) |
| `engine-server` | `engine-server/src/{index,restartRuntime}.ts`, [MarketEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:1-2200), [orderSourceMetadata.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/risk/orderSourceMetadata.ts:1-252), [SettlementBatchService.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/SettlementBatchService.ts:1-151), [OptionSettlementEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/OptionSettlementEngine.ts:1-193), [BondCouponEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/BondCouponEngine.ts:1-170), `engine-server/src/bots/*` 전체 12개 파일 (`BaseAgent`, `ASMarketMakerAgent`, `HedgeFundAgent`, `WallBreakerAgent`, `CommercialBankAgent`, `CommodityBots`, `PensionFundAgent`, `PropDeskAgent`, `QuantAgent`, `RetailSwarmAgent`, `StatArbAgent`, `AdversarialAgent`, `OptionsMMAgent`, `ExecutionTrader`) |
| 프론트엔드·훅 | `app/{page,etf/page,news/page,mypage/page,exchange/page,shop/page,options/page,institutions/page,market-flow/page,admin/page}.tsx`, `app/markets/[market]/page.tsx`, `app/stocks/{page,[id]/page,[id]/StockDetailClient}.tsx`, `app/commodities/[id]/CommodityDetailClient.tsx`, `app/v2/{layout,page,stocks/page,exchange/page,shop/page,news/page,institutions/page,stocks/[id]/StockDetailV2Client}.tsx`, `app/components/{AppShell,Sidebar,TopBar,DashboardGate,StockTable,Orderbook,OrderEntry,ActiveOrdersPanel,OptionsPanel,OptionAccountPanel,OptionHTSDashboard,OptionOrderEntry,OptionMonthChainGrid,BondDetailPanel,RandomEventModal,TradeFeed,TradeNotifier,TickChart,RealtimePriceHeader,ETFMonitorWidget,ETFItemCard,ETFStructureCard,ETFUserUnderlyingHoldings}.tsx`, `app/components/commodities/{CommodityOrderEntry,CommodityActiveOrdersPanel}.tsx`, `app/components/v2/{PriceHeroV2,TradeFeedV2,StockChartV2,OrderbookV2,V2Navbar,V2VersionToggle}.tsx`, `lib/hooks/{useOrderbookData,useOptionMarketData,useStockBotSimulation}.ts` |

### 2.2 미검토 및 미실행 영역

- **정적 UI 위젯 일부 세부 행 미검토**: `app/components/{ChatPanel,FinancialPanel,GlassCard,LocalDevBanner,MacroRegimeRebalanceWidget,LeverageRebalanceWidget,InstitutionalSectorPortfolioWidget,CrossAssetLinkageWidget,ParticipantFlowWidget,RolloverTracker,ExpirationHeader,OptionChainMatrix,OptionConfigModal,OptionOrderBook,EcoTerminal,MoverCard,PriceTag,ThemeToggle,ThemeProvider,AuthProvider,ToastProvider,StrictWidget}.tsx`, `app/components/market-flow/*`, `app/components/commodities/{CommodityEventPanel,CommoditySeasonalityPanel}.tsx`, `app/components/v2/V2Card.tsx`, `lib/indicators.ts`, `lib/engine/macroRegimeEngine.ts`, `lib/engine/optionBotEngine.ts`(101~446행), `archive/legacy-postgres/*`.
- **미실행 검증**: `npm run build` / `next start` 프로덕션 서버 기동, Playwright 등 실브라우저 DOM/클릭 E2E, 실제 Google OAuth 왕복, 원격 PostgreSQL/Redis 연결(`NEXT_PUBLIC_USE_IN_MEMORY=false`), OS 프로세스 `SIGKILL`·디스크 `ENOSPC` 주입 실험.
- **미실행 테스트 스크립트**: `scripts/` 내 `test-market-regime-*`, `test-regime-*`, `test-news-*`, `test-followup-a-to-f.ts`, `test-comprehensive-audit-fixes.ts`, `test-review-fixes-verification.ts`, `test-regression-settlement-auth-ai.ts`, `test-nextauth-safe-handler.ts`, `test-orderbook-zero-suppression.ts`, `test-orderbook-and-news-integrity.ts`, `test-concurrency-and-stale-ref.ts`, `test-transaction-isolation.ts`, `test-time-concurrency-news.ts`, `test-causal-market-flow.ts`, `test-market-flow-*`, `test-stage1-verification.ts`, `test-stage2-review-fixes.ts`, `test-comparison-827dd60.ts`.

---

## 3. 확정 발견 사항 (Findings)

### F1 [P0] `engine-server` IDX K200 옵션 기초자산·행사가 단위 불일치(`72,000` vs `260`)로 만기 정산 시 1계약당 `179.35억` 원 과다 지급

- **위치**: [memoryStore.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts:745-763), [InMemorySettlementRepository.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts:1541-1552), [OptionSettlementEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/OptionSettlementEngine.ts:69-80), [SettlementBatchService.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/SettlementBatchService.ts:80-100)
- **발생 조건 및 호출 경로**:
  - `buildFutureOptionContractsForMonth`가 생성하는 모든 월물 옵션(`opt_k200_${yymm}_c_${sLabel}` / `_p_${sLabel}`)은 `asset_class: 'IDX'`, `strike_price: 240.0..290.0` (KOSPI200 지수 포인트 스케일, `current_price: 2.15`, `multiplier: 250000`)인데 `underlying_stock_id`가 `osId`(`0010` 오성전자, `current_price: 72000` KRW)를 가리킴.
  - 반대로 구형 시드 `opt_c_720`은 `ticker: "IDX-K200-2608-C260.0"`이면서 `strike_price: 72000`, `current_price: 2.15`로 혼재되어 있음.
  - `engine-server`의 `SettlementBatchService.runDailySettlementBatch()` -> `OptionSettlementEngine.executeSettlementBatch()` -> `InMemorySettlementRepository.settleOptionExpiryAtomically()`가 만기 시 `closePrice(72000) - strike_price(260)`을 그대로 계산함.
- **관측 / 기대 결과**:
  - **관측 (CE-1 재현)**: `opt_k200_2612_c_260.0`(프리미엄 `2.15`, 1계약 매수원가 ₩537,500) 1계약 만기 정산 시 `payout_delta_krw = 17935000000` (`(72000 - 260) * 1 * 250000` = 약 179.35억 원) 지급됨.
  - **기대**: `IDX` 지수 옵션은 KOSPI200 지수(`~260`pt 스케일)를 기초자산으로 정산하고, `STK` 개별주식 옵션(`0010`)과 명확히 분리된 행사가·프리미엄 단위를 사용해야 함.
- **도달성 및 사용자 영향**: `POST /api/options/order`로 사용자도 해당 `opt_k200_*` 계약을 매수 가능하나, 만기 배치(`SettlementBatchService`)는 현재 `engine-server` 프로세스에만 연결되어 있고 `localStandaloneServer`에서는 호출되지 않음. `engine-server` 가동 환경에서 만기 도래 시 사실상 무제한 KRW가 지급됨.
- **최소 수정 방향**: `IDX` 계약 정산 시 `underlying_stock_id` 주가가 아닌 K200 지수(예: `market_indices` 또는 주식 바스켓 스케일링)를 기초가격으로 사용하도록 `SettlementBatchService.runDailySettlementBatch`와 `InMemorySettlementRepository`를 분리하고, `opt_c_720`의 티커/행사가 불일치를 정리함.
- **검증**: 격리 `MemoryDatabase` + `InMemorySettlementRepository` 반례 스크립트 CE-1로 `payout_delta_krw: 17935000000` 직접 재현 완료.

---

### F2 [P0] `InMemorySettlementRepository.settleBondMaturityAtomically`의 `coupon_rate` 단위 불일치(% vs 소수)로 시드 채권 전체 거부 및 소수 쿠폰 100배 지급

- **위치**: [InMemorySettlementRepository.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts:1662-1675), [memoryStore.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts:870-876), [BondCouponEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/BondCouponEngine.ts:48)
- **발생 조건 및 호출 경로**:
  - `MemoryDatabase` 시드 채권 7종은 모두 `coupon_rate`를 퍼센트 포인트(`3.25` ~ `7.25`)로 저장하며 `BondCouponEngine.calculateCouponPayment`는 이를 `/ 100`으로 나눠 계산함(`bond.coupon_rate / 100`).
  - 반면 `InMemorySettlementRepository.settleBondMaturityAtomically`는 `couponRate > 1.0`이면 `INVALID_COUPON_RATE`로 거부하고(`1663-1665`), `couponRate <= 1.0`일 때는 `/ 100` 없이 `bond.face_value * couponRate * holding.quantity`를 곱함(`1674`).
- **관측 / 기대 결과**:
  - **관측 (CE-2 재현)**: 시드 채권(`coupon_rate: 3.25`, `face_value: 10000`) 만기 상환 호출 시 `{ success: false, errorCode: "INVALID_COUPON_RATE", error: "Invalid bond coupon rate: 3.25" }` 반환. `coupon_rate: 0.5`(0.5% 의도) 설정 시 쿠폰이 기대값 `50`원이 아닌 `5,000`원(총 `15,000`원, 100배 과지급) 지급됨.
  - **기대**: `BondCouponEngine`과 동일하게 `%` 단위(`0 ~ 100`)를 허용하고 `/ 100` 환산을 일관 적용해야 함.
- **도달성 및 사용자 영향**: 현재 `/api/orders`에서 채권 사용자 매수는 차단되어(`400`) 일반 유저 API로 즉시 도달하지 않으나, 채권 보유 레코드 또는 `engine-server` 만기 상환 호출 시 전 시드 채권이 만기 상환 불가 상태가 됨.
- **최소 수정 방향**: `settleBondMaturityAtomically`의 상한 검증과 계산식을 `couponRate > 100` 검사 및 `bond.face_value * (couponRate / 100) * holding.quantity`로 `BondCouponEngine`과 통일함.
- **검증**: 격리 반례 CE-2로 `INVALID_COUPON_RATE` 거부 및 `0.5` 입력 시 `totalPaid: 15000`(100배 쿠폰) 직접 재현 완료.

---

### F3 [P0] `InMemorySettlementRepository.executeCommitMatchedBatchAtomically` Phase 5 롤백 시 체결된 신규 주문(`newOrders`) 재삽입

- **위치**: [InMemorySettlementRepository.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts:611-627), [InMemorySettlementRepository.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts:1008-1011), [InMemorySettlementRepository.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts:1283-1298)
- **발생 조건 및 호출 경로**:
  - `executeCommitMatchedBatchAtomically`에서 `batch.newOrders`에 담긴 신규 주문 `ord`를 Phase 1.5(`611-627`)에서 `newlyInsertedOrderIds`와 `this.db.orders`에 삽입함.
  - 이어 `batch.trades`가 해당 신규 주문을 체결하면 `allocatedPerOrder`에 `ord.id`가 포함되고, Phase 4 스냅샷 루프(`1008-1011`)가 `this.db.orders.get(orderId)`를 읽어 `ordersSnapshot`에 `ord` 복사본을 저장함.
  - 이후 Phase 4 후반부(`batch.orderUpdates`의 `ORDER_CAS_MISMATCH` 등 `1190`행 예외)에서 실패하여 `catch` 블록이 실행되면, `1283-1287`행에서 `newlyInsertedOrderIds`를 삭제한 뒤 **직후 `1291-1293`행에서 `ordersSnapshot`을 다시 `this.db.orders.set(id, snap)`으로 복원**하고 `rebuildIndexes()`(`1298`)를 호출함.
- **관측 / 기대 결과**:
  - **관측 (CE-3 재현)**: `{ success: false, rollbackOccurred: true, errorCode: "EXECUTION_FAILED", error: "EXECUTION_FAILED: ORDER_CAS_MISMATCH: ..." }` 반환 후에도 `db.orders.has('ord_new_ghost') === true`, `status === 'open'`, `openOrders` 인덱스에도 잔존함.
  - **기대**: 롤백 시 해당 배치에서 신규 생성된 주문(`newlyInsertedOrderIds`)은 `ordersSnapshot` 복원 대상에서 제외되어 완전히 제거되어야 함.
- **도달성 및 사용자 영향**: 저수준 배치 저장소 재현(직접 호출 또는 `MarketEngine`의 `batch.newOrders` + `batch.orderUpdates` 조합에서 Phase 4 실패 발생 시 도달 가능). 실패한 트랜잭션의 유령 매수/매도 주문이 오더북에 남아 이후 틱에서 체결될 수 있음.
- **최소 수정 방향**: `1008-1011`행 또는 `1291-1293`행에서 `newlyInsertedOrderIds.has(id)`인 주문은 `ordersSnapshot`에 기록·복원하지 않도록 제외함.
- **검증**: 격리 반례 CE-3 실행으로 `rollbackOccurred: true` 이후 `ghostOrderStillInOrdersMap: true`, `ghostInOpenIndex: true` 직접 재현 완료.

---

### F4 [P1] 원자재 선물 정산 시 강제청산·손실 하한 부재로 `profile.cash` 음수 추락

- **위치**: [commodityLedger.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/commodityLedger.ts:437-452)
- **발생 조건 및 호출 경로**:
  - `POST /api/commodities`로 증거금을 예치해 포지션을 진입한 뒤 가격이 크게 역행하여 청산 체결되면 `CommodityMarketEngine.stepTickAsync()` -> `settleCommodityTradeForUsers()` -> `applyUserFillToPosition()`이 `realizedPnlKrw`를 계산하고 `450`행이 `profile.cash = roundMoney(profile.cash + cashDelta)`를 수행함.
  - 유지증거금 강제청산(margin call/liquidation) 엔진이 없고, 손실이 `reserved_margin_krw + availableCash`를 초과해도 `profile.cash` 하한 및 타 자산(주식/옵션) 예약금 침범 보호가 없음.
- **관측 / 기대 결과**:
  - **관측 (CE-6 재현)**: 초기 현금 `7,500,000` KRW 계좌가 `CRUDE_OIL` 1계약(`78.5`, 위탁증거금 `6,750,000` KRW) 매수 후 `50.0`에 청산 시 `userCashAfterLargeLoss: -31830000` KRW로 하락함.
  - **기대**: 유지증거금 이하 하락 시 사전 강제청산되거나, 최소한 원화 현금 잔고가 음수로 내려가 타 자산 예약 현금을 훼손하지 않아야 함.
- **도달성 및 사용자 영향**: 실제 `/api/commodities` 주문 및 틱 루프에서 변동성/시나리오 이벤트로 도달 가능. 계좌 파산 이후에도 음수 현금 상태가 발생하며 타 주문의 예수금 불변식이 깨질 수 있음.
- **최소 수정 방향**: 틱 루프에 평가손실 기반 유지증거금 강제청산 또는 손실 한도(담보 범위 내 정산 및 거래소 손실 계상) 정책을 명시적으로 도입함.
- **검증**: 격리 반례 CE-6에서 `userCashBefore: 7500000` -> `userCashAfterLargeLoss: -31830000` 직접 재현 완료.

---

### F5 [P1] `AgentManager.applyCrossAssetRiskGate`의 보유량 조회 키 구분자 불일치(`:` vs `_`)로 매도 게이트 항상 차단

- **위치**: [agentManager.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/agentManager.ts:682)
- **발생 조건 및 호출 경로**:
  - `memoryDb.holdings`의 모든 키는 `${userId}_${stockId}` 형식이나, `AgentManager.applyCrossAssetRiskGate`는 `crossAssetMode === 'EXPERIMENTAL_ON'` 상태에서 매도 가능 수량을 조회할 때 `memoryDb.holdings.get(`${agent.accountId}:${stock.id}`)`(콜론 `:`)를 호출함.
- **관측 / 기대 결과**:
  - **관측 (CE-4 재현)**: `${agent.accountId}_${usdStock.id}`에 500주가 있어도 콜론 조회는 항상 `undefined`(`holdingQty = 0`)를 반환해 cross-asset 매도 주문이 전량 차단됨.
  - **기대**: `${agent.accountId}_${stock.id}` 키(또는 `holdingUserIndex`)로 보유 수량을 조회해야 함.
- **도달성 및 사용자 영향**: 기본 모드(`'OFF'`)에서는 비활성이며, `crossAssetMode === 'EXPERIMENTAL_ON'` 전환 시 모든 ABM 에이전트가 cross-asset 리밸런싱 매도를 수행할 수 없음.
- **최소 수정 방향**: `682`행의 키 구분자를 `:`에서 `_`로 수정함.
- **검증**: 격리 반례 CE-4에서 `colonLookupIsUndefined: true`, `canonicalLookupQty: 500` 직접 재현 완료.

---

### F6 [P1] `AgentManager` · `marketObservation` · `valueStrategy` · `trendStrategy`의 USD 종목 환율(`fxRateToKrw`) 및 틱 단위 미반영

- **위치**: [agentManager.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/agentManager.ts:1138-1154), [marketObservation.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/marketObservation.ts:123-125), [valueStrategy.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/strategies/valueStrategy.ts:219-236), [trendStrategy.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/strategies/trendStrategy.ts:166-179)
- **발생 조건 및 호출 경로**:
  - `lpStrategy`와 `orderRisk`에는 `CurrencyReservationContext`가 추가되었으나, `calculateAuthoritativePortfolioValuation`(`124`행), `agentManager`의 cross-asset NAV 집계(`1141`행)는 USD 종목(`AAPL`, `TSLA`, USD ETF 등)의 가격에 환율(`~1380`)을 곱하지 않고 원화 `rawCash`에 직접 합산함.
  - `valueStrategy.ts:219`와 `trendStrategy.ts:166`은 `costPerShare = alignedPrice * 1.0025`로 달러 단가를 원화 `availableCash`와 직접 비교하며, KRX 틱 함수(`price < 2000 ? 1`)를 그대로 써서 `$10`~`$200`대 USD 종목에 `$1.00` 호가 단위를 강제함.
- **관측 / 기대 결과**:
  - **관측 (CE-4 재현)**: 계좌 현금이 단 `1,000` KRW($0.74 상당)인 상태에서 `AAPL`($185.5)에 대해 `evaluateValueStrategy`를 호출하면 `costPerShare = 187.47 <= 1000`으로 판정해 `{ action: "buy", price: 187, size: 5 }` 매수 주문을 생성함(실제 체결 필요 원화는 ~₩1,262,250으로 1,350배 이상 과소평가). 또한 500주 보유 평가액도 원화가 아닌 미환산 USD 단위로 NAV에 합산됨.
  - **기대**: `MarketObservation`에 `fxRateToKrw` 및 `isUsdAsset`을 포함하여 NAV 평가·`costPerShare`·틱 단위(`$0.01`)가 모두 환율 및 통화에 맞게 일관 계산되어야 함.
- **도달성 및 사용자 영향**: `localStandaloneServer`의 매 틱 ABM 시뮬레이션에서 해외주식/유럽주식/USD ETF 전 종목에 상시 발생하여, 가용 현금이 부족한 가치·추세 봇의 무효 주문과 비정상 NAV·`$1` 호가 스프레드를 유발함.
- **최소 수정 방향**: `getStockFxRateToKrw`를 `marketObservation`·`agentManager`·`valueStrategy`·`trendStrategy`에 통합 적용하고 USD 종목 틱 단위를 `0.01`로 분기함.
- **검증**: 격리 반례 CE-4로 `agentCashKrw: 1000` 계좌의 `AAPL` 5주 매수 주문 생성 직접 재현 완료.

---

### F7 [P1] `engine-server` 비-LP 전략 봇들의 `is_lp: true` 표기로 `MarketEngine.validateSingleOrder`에서 `REJECTED_UNAUTHORIZED_LP` 거부

- **위치**: [MarketEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:1142-1153), [WallBreakerAgent.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/WallBreakerAgent.ts:79), [HedgeFundAgent.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/HedgeFundAgent.ts:241), [CommercialBankAgent.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/CommercialBankAgent.ts:58), [CommodityBots.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/CommodityBots.ts:33,46), [StatArbAgent.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/StatArbAgent.ts:72,82,101,111), [RetailSwarmAgent.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/RetailSwarmAgent.ts:183), [AdversarialAgent.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/AdversarialAgent.ts:83), [PensionFundAgent.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/PensionFundAgent.ts:53), [BaseAgent.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/BaseAgent.ts:135,620)
- **발생 조건 및 호출 경로**:
  - `MarketEngine.validateSingleOrder`는 `order.is_lp && verified.participantKind !== 'LIQUIDITY_PROVIDER'`이면 `REJECTED_UNAUTHORIZED_LP`로 주문을 즉시 폐기함(`1142-1153`).
  - 그러나 `WallBreakerAgent`, `HedgeFundAgent`, `CommercialBankAgent`, `CommercialHedgerAgent`, `StatArbAgent`, `RetailSwarmAgent`, `AdversarialAgent`, `PensionFundAgent` 및 `BaseAgent.getPendingNewsOrders` 등이 모두 `is_lp: true`를 넣어 주문을 생성함.
- **관측 / 기대 결과**:
  - **관측 (CE-5 재현)**: `WallBreakerAgent.executeGammaSqueezeHunt`가 생성한 주문을 `MarketEngine.validateSingleOrder`에 전달 시 `{ participantId: "WALL_BREAKER", reasonCodes: ["REJECTED_UNAUTHORIZED_LP"] }`로 거부됨.
  - **기대**: 유동성 공급자(`LIQUIDITY_PROVIDER`)가 아닌 전략 봇은 `is_lp: false` 및 `orderType: 'CHILD_ORDER'` / `'STRATEGIC_ORDER'`로 제출해야 함.
- **도달성 및 사용자 영향**: `engine-server` 가동 시 감마 스퀴즈, 페어 트레이딩, 개미 떼, 채권 차익, 헤지펀드 공매도, 뉴스 반응 등 핵심 전략 봇 주문이 엔진 진입 단계에서 차단됨.
- **최소 수정 방향**: 각 비-LP 전략 봇의 주문 생성 객체에서 `is_lp: true`를 `is_lp: false`로 수정하고, 봇별 `bots_config` 등록 및 `participantId` 일치를 검증함.
- **검증**: 격리 반례 CE-5에서 `WALL_BREAKER` 주문의 `REJECTED_UNAUTHORIZED_LP` 거부 직접 확인 완료.

---

### F8 [P1] `/v2/stocks` 페이지의 `snake_case` DB 행 무매핑 전달로 전 종목 `₩0` / `0.00%` 표시

- **위치**: [app/v2/stocks/page.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/v2/stocks/page.tsx:15-46), [StockTable.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/StockTable.tsx:24-85)
- **발생 조건 및 호출 경로**:
  - `V2StocksPage`가 `db.from("stocks").select("*")` 결과를 변환 없이 `<StockTable stocks={stocks} />`에 그대로 전달함.
  - `StockTable`은 `s.currentPrice`, `s.previousClose`, `s.marketCap`, `s.isCore`(`camelCase`)를 읽으나, `memoryDbClient`/Postgres 응답은 `current_price`, `previous_close`, `market_cap`, `is_core`(`snake_case`)임.
- **관측 / 기대 결과**:
  - **관측 (코드 확인)**: `currentPrice`, `previousClose`, `marketCap`이 모두 `undefined`가 되어 현재가 `₩0`/`$0.00`, 등락률 `0.00%`, 시가총액 `0`으로 렌더링됨.
  - **기대**: `app/stocks/page.tsx`처럼 `Stock` 인터페이스(`camelCase`)로 매핑한 뒤 `StockTable`에 전달해야 함.
- **도달성 및 사용자 영향**: `/v2/stocks` 라우트에 접속하는 모든 사용자가 전 종목 시세·등락률·시가총액을 전혀 볼 수 없음.
- **최소 수정 방향**: `app/v2/stocks/page.tsx`의 `.then(({ data }) => ...)`에서 `Stock` 모델로 정규화 매핑함.
- **검증**: 소스 대조 확인 완료(브라우저 DOM 렌더링은 미실행).

---

### F9 [P1] `/v2/stocks/[id]` `PriceHeroV2`가 no-op `db.channel()`만 사용해 실시간 시세 미갱신

- **위치**: [PriceHeroV2.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/v2/PriceHeroV2.tsx:14-32), [lib/db/client.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/db/client.ts:226-233)
- **발생 조건 및 호출 경로**:
  - `PriceHeroV2`는 `db.channel(...).on("postgres_changes", ...).subscribe()`만으로 `price` 상태를 갱신하려 함.
  - 그러나 현재 활성 HTTP 클라이언트 `HttpMemoryClient.channel()`([client.ts:226-233](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/db/client.ts:226-233))은 콜백을 전혀 호출하지 않는 no-op 스텁임.
- **관측 / 기대 결과**:
  - **관측 (코드 확인)**: `OrderbookV2`와 `TradeFeedV2`는 `useOrderbookData` 폴링으로 실시간 갱신되지만, 상단 메인 가격 히어로(`PriceHeroV2`)는 최초 SSR 시점 가격에서 영구 고정됨.
  - **기대**: `useOrderbookData`의 실시간 가격을 전달받거나 주기적 `stocks` 폴링을 함께 수행해야 함.
- **도달성 및 사용자 영향**: `/v2/stocks/[id]` 화면에서 주문창·체결창과 상단 대표 현재가가 어긋나 사용자 판단 혼선 발생.
- **최소 수정 방향**: `StockDetailV2Client`가 `PriceHeroV2`에 실시간 폴링 또는 `useOrderbookData` 기반 최신 가격을 연동함.
- **검증**: `PriceHeroV2.tsx`와 `lib/db/client.ts` 정적 대조 확인 완료(브라우저 UI 실행은 미실행).

---

### F10 [P1] `OptionsPanel`의 `/api/options/order` 필드 불일치(`quantity` vs `qty`, `res.filledQty` vs `res.order?.filledQty`) — *[이전 `P2-5.4` 잔존]*

- **위치**: [OptionsPanel.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionsPanel.tsx:113-135), [OptionsPanel.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionsPanel.tsx:157-197), [options/order/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/options/order/route.ts:27-52)
- **발생 조건 및 호출 경로**:
  - 주식 상세 -> 기업 분석 탭 -> `OptionsPanel`에서 매수(`handleTradeOption`) 또는 롤오버(`handleExecuteUserRollover`) 클릭 시 `POST /api/options/order`에 `{ ..., quantity: qty }`를 전송하고, 성공 응답에서 `res.filledQty`를 읽음.
  - 그러나 `app/api/options/order/route.ts:27, 37`은 `body`에서 `qty`만 추출하며(`quantity` 무시 -> `qty: undefined`), 응답은 `{ success: true, message, order: result.order }` 형태로 `filledQty`가 `res.order.filledQty` 하위에 있음.
- **관측 / 기대 결과**:
  - **관측 (코드 대조)**: `submitAuthoritativeOptionOrder`가 `qty === undefined`로 인해 모든 주문을 `400`으로 거부함. 설령 통과하더라도 `res.filledQty`가 항상 `undefined -> 0`으로 해석되어 체결 완료를 미체결 대기로 오표시함.
  - **기대**: `OptionsPanel`이 `qty` 필드로 요청하고 `res.order?.filledQty`를 참조하거나, `/api/options/order`가 `qty ?? quantity`를 수용해야 함.
- **도달성 및 사용자 영향**: `/stocks/[id]` 내 옵션 패널을 통한 옵션 매수 및 롤오버 기능이 100% 작동 불능.
- **최소 수정 방향**: `OptionsPanel.tsx`의 요청 본문 키를 `qty`로 변경하고 응답 파싱을 `res.order?.filledQty ?? res.filledQty ?? 0`으로 수정함.
- **검증**: 두 파일 계약 대조로 확인 완료(브라우저 클릭 E2E는 미실행). *(이전 `P2-5.4` 수정은 미존재 RPC만 교체하고 본문 필드명은 누락해 해결되지 않음 — Section 5에서 중복 합산 제외)*

---

### F11 [P2] `MarketEngine.fetchMarketState`의 빈 `orderBook: {}` 고정 반환 및 `ASMarketMakerAgent.ordersToCancel` 미소비

- **위치**: [MarketEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:854), [MarketEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:1096), [ASMarketMakerAgent.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/ASMarketMakerAgent.ts:100-122)
- **발생 조건 및 호출 경로**:
  - `fetchMarketState`가 항상 `orderBook: {}`를 반환하고, `ASMarketMakerAgent.executeMarketMaking`은 `marketState.orderBook[stock.id]`에서 기존 LP 호가(`existingLpBids`, `existingLpAsks`)를 찾지 못해 매 틱 전체 10레벨 호가를 새로 생성하며(`ordersToCancel`에 아무것도 쌓이지 않음), 설령 다른 봇(`BaseAgent.ordersToCancel`)이나 `ASMarketMakerAgent`가 `ordersToCancel`에 ID를 넣어도 `MarketEngine` 코드 전체에서 `ordersToCancel`을 읽는 경로가 없음.
- **관측 / 기대 결과**:
  - **관측 (CE-5 및 grep 확인)**: `rg -n "ordersToCancel" engine-server/src/` 결과 `BaseAgent.ts`와 `ASMarketMakerAgent.ts`에서만 `push`될 뿐 `MarketEngine.ts`에 소비 코드가 전혀 없음. CE-5에서 주가 급변 후에도 `asMarketMakerOrdersToCancelLenAfterPriceJump === 0`.
  - **기대**: `marketState.orderBook`에 종목별 현재 미체결 호가를 반영하거나, LP 갱신을 5틱 일괄 `lpQuoteUpserts`에 맞게 정리하고 불필요한 죽은 `ordersToCancel` 상태를 제거해야 함.
- **도달성 및 사용자 영향**: `engine-server` 실행 중 AS 마켓메이커의 델타 유지/취소 의도가 무력화되고 `shouldRefreshLp` 주기가 아닌 틱마다 불필요한 330건의 버려지는 원시 주문이 생성되어 `hawkesIntensity`가 매 틱 +16.5씩 폭증(매 틱 `[Hawkes] Flash Crash Detected!` 출력).
- **최소 수정 방향**: `ASMarketMakerAgent`를 `shouldRefreshLp` 틱에만 실행하거나 `marketState.orderBook`에 실제 `openOrders`를 매핑하고 `ordersToCancel` 큐를 처리/제거함.
- **검증**: CE-5 로그(`[Hawkes] Flash Crash Detected! Orders: 330`) 및 `rg` 검색으로 확인 완료.

---

### F12 [P2] `ActiveOrdersPanel`이 `memoryDbClient` 미지원 조인(`stocks(...)`)에 의존해 로컬 모드 종목명·통화 오표시

- **위치**: [ActiveOrdersPanel.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/ActiveOrdersPanel.tsx:59,221-223), [memoryDbClient.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryDbClient.ts:380-389)
- **발생 조건 및 호출 경로**:
  - `ActiveOrdersPanel`은 `db.from('orders').select('..., stocks(id, ticker, name, market, current_price)')`로 관계 조인을 요청함.
  - 그러나 `memoryDbClient.execute()`는 `this.tableName === 'holdings'`일 때만 `stocks` 객체를 주입하며(`381-389`), `'orders'` 조회에서는 `stocks` 조인을 수행하지 않음.
- **관측 / 기대 결과**:
  - **관측 (코드 대조)**: 로컬 모드에서 `o.stocks`가 항상 `undefined`이므로 종목명이 일괄 `'종목'`으로, 티커는 빈 문자열로 표시되며, `fmtPrice(Number(o.price), undefined, '')`가 호출되어 `AAPL`·`SPY` 같은 USD 주문 가격도 `₩185`처럼 원화로 잘못 표기됨.
  - **기대**: `memoryDbClient`가 `orders` 조회 시에도 `stocks` 조인을 주입하거나 `ActiveOrdersPanel`이 `stocks` 메타를 별도 조회해 매핑해야 함.
- **도달성 및 사용자 영향**: 로컬 스탠드얼론 모드에서 미체결 주문 목록을 보는 모든 사용자에게 즉시 발생.
- **최소 수정 방향**: `memoryDbClient.ts:381` 조건을 `this.tableName === 'holdings' || this.tableName === 'orders'`로 확장해 `stocks` 메타를 주입함.
- **검증**: `memoryDbClient.ts` 및 `ActiveOrdersPanel.tsx` 코드 대조로 확인 완료.

---

### F13 [P2] 채권 상세 페이지(`/stocks/[bondId]`) 주문 패널이 항상 `400` 거부되는 주식 API(`/api/orders`) 호출

- **위치**: [StockDetailClient.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/stocks/[id]/StockDetailClient.tsx:244,267), [OrderEntry.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OrderEntry.tsx:132-142), [orders/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/orders/route.ts:66-71)
- **발생 조건 및 호출 경로**:
  - `/markets/bonds`에서 채권 상세(`/stocks/[id]`)로 진입 시 `OrderEntry`가 렌더링되어 `POST /api/orders`를 호출함.
  - `/api/orders`는 `memoryDb.bonds.has(stock_id)`인 경우 `400 ('해당 자산군은 일반 주식 주문 경로로 거래할 수 없습니다.')`로 차단하며, 별도 채권 주문 API 라우트가 없음.
- **관측 / 기대 결과**:
  - **관측 (코드 확인)**: 채권 상세 화면에 매수/매도 주문 UI가 노출되지만 주문 제출 시 항상 실패함.
  - **기대**: 채권 거래 전용 API를 제공하거나 거래 미지원 안내 상태로 비활성화해야 함.
- **도달성 및 사용자 영향**: 채권 매매를 시도하는 모든 사용자에게 직접 도달.
- **최소 수정 방향**: 전용 채권 주문 엔드포인트를 구현하거나 `stock.market === 'bonds'`일 때 `OrderEntry`에 안내 배너 및 제출 비활성화를 적용함.
- **검증**: `StockDetailClient.tsx`, `OrderEntry.tsx`, `app/api/orders/route.ts` 대조로 확인 완료.

---

### F14 [P2] `POST /api/admin/scenarios`에서 `initialPrice` 누락 시 `stocks.target_price` `NaN` 기록 및 영속 저장·락 누락

- **위치**: [admin/scenarios/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/admin/scenarios/route.ts:63,73-99)
- **발생 조건 및 호출 경로**:
  - 관리자 `inject_scenario` 요청에서 `initialPrice`가 누락되면 `63`행은 `Number(initialPrice) || 10000`으로 fallback하지만 `77`행은 raw `initialPrice`를 그대로 사용해 `Math.round(undefined * targetMultiplier)` = `NaN`을 `stocks.target_price`에 기록함.
  - 또한 `75-78`행의 `stocks` 업데이트와 `96-99`행의 `admin_settings` 업데이트가 `withStockLock`, `runWithCommitGate`, `persistConfirmedState()` 없이 메모리만 수정함.
- **관측 / 기대 결과**:
  - **관측 (코드 확인)**: `initialPrice` 미전달 시 `target_price`가 `NaN`으로 오염되고, 서버 재시작 시 시나리오로 변경된 `target_price`/`market_sentiment`가 스냅샷에 보존되지 않거나 다른 틱 저장과 경합할 수 있음.
  - **기대**: 유효한 수치 검증 후 `stocks` 기존 가격 기반 계산, 락·`persistConfirmedState()` 적용 필요.
- **도달성 및 사용자 영향**: 관리자 시나리오 주입 API 호출 시 발생(`ScenarioController.tsx`를 통하거나 직접 API 호출 시).
- **최소 수정 방향**: `scenarioParams.initialPrice` 재사용(또는 DB 현재가 조회), 입력 검증, `withStockLock`/`runWithCommitGate`/`persistConfirmedState()` 래핑.
- **검증**: `app/api/admin/scenarios/route.ts` 코드 분석으로 확인 완료.

---

### F15 [P2] `app/admin/page.tsx` 비로그인 시 UI 관리자 권한 우회 및 로컬 DB에서 무조건 `403` 실패하는 쓰기 호출

- **위치**: [app/admin/page.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/admin/page.tsx:56-59,86-96,118-132), [local-db/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts:15-32,256-262,542-545)
- **발생 조건 및 호출 경로**:
  - `AdminPage.fetchAdminStatus`가 비로그인(`!isLoggedIn || !userId`) 분기에서 무조건 `setIsAdmin(true)`를 설정함(`56-59`).
  - 또한 `handleAIEventTrigger`와 `handleListStock`이 클라이언트에서 `db.from("novel_events").insert(...)`와 `db.from("stocks").insert(...)`를 호출하나, `/api/local-db`는 `stocks`를 `PUBLIC_READ_TABLES`(SELECT 전용 `403`)로, `novel_events`를 미허용 테이블(`403`)로 차단함.
- **관측 / 기대 결과**:
  - **관측 (코드 대조)**: 비로그인/비관리자 사용자에게 `/admin` 화면이 `"SYSTEM ADMIN ACTIVE"`로 열리고, 이벤트 등록 및 신규 상장 기능은 로컬 모드에서 항상 `403` 실패함.
  - **기대**: UI에서도 세션 `is_admin`을 엄격히 확인하고, 신규 상장/AI 이벤트는 서버 관리자 전용 API로 제공해야 함.
- **도달성 및 사용자 영향**: `/admin` 페이지의 신규 상장/AI 이벤트 탭 사용 시 100% 실패.
- **최소 수정 방향**: `AdminPage`의 무조건 `setIsAdmin(true)` fallback 제거 및 관리자 전용 `/api/admin/*` API 경로 이관.
- **검증**: `app/admin/page.tsx`와 `app/api/local-db/route.ts` 대조 확인 완료.

---

### F16 [P2] `GET /api/market-flow`의 비인증 내부 시뮬레이션 상태(`marketState`) 전체 노출

- **위치**: [market-flow/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/market-flow/route.ts:45-75)
- **발생 조건 및 호출 경로**:
  - `POST /api/market-flow`는 `verifyAdminSession`으로 보호되지만, `GET /api/market-flow`는 인증 없이 `engine.getMarketFlowData()`, `engine.getMarketStateSnapshot()` 전체를 반환함.
- **관측 / 기대 결과**:
  - **관측 (코드 확인)**: `marketState` 내부의 비공개 펀더멘털/시뮬레이션 내부 상태가 비인증 GET 요청에 그대로 노출됨.
  - **기대**: 공개 차트/리더보드 지표 외 내부 봇/펀더멘털 스냅샷은 마스킹하거나 관리자 인증으로 보호해야 함.
- **도달성 및 사용자 영향**: 비로그인 외부 요청자 누구나 `/api/market-flow` GET으로 내부 시뮬레이션 상태 조회 가능.
- **최소 수정 방향**: `GET /api/market-flow`에서 내부 `marketState` 필드를 제거하거나 관리자 세션 확인 후에만 포함하도록 제한함.
- **검증**: `app/api/market-flow/route.ts` 확인 완료.

---

### F17 [P2] 상점 유료 부스터(`fee_booster`, `scanner_item`, `ai_predictor`) 및 이벤트 `acquired_passives` 효과 미연동

- **위치**: [catalog.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/shop/catalog.ts:67-85), [app/shop/page.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/shop/page.tsx:440-482), [playerEventService.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/events/playerEventService.ts:95,122)
- **발생 조건 및 호출 경로**:
  - 상점에서 `fee_booster`(₩1,000,000, "거래 수수료 50% 자동 할인"), `scanner_item`(₩2,000,000), `ai_predictor`(₩1,500,000) 구매 시 `profiles.cash`가 차감되고 `unlocked_features`에 기록됨.
  - 랜덤 이벤트 보상 역시 `profiles.acquired_passives`에 저장됨.
- **관측 / 기대 결과**:
  - **관측 (`rg` 전수 검색)**: `fee_booster`, `ai_predictor`, `scanner_item`, `acquired_passives`는 구매·이벤트 저장 외 매칭/정산(`dbMatching.ts`, `orderRisk.ts`, `optionOrderService.ts`, `settlement.ts`, `InMemorySettlementRepository.ts`)이나 프론트엔드 기능 게이트에서 단 한 곳도 참조되지 않음.
  - **기대**: 최소한 `fee_booster`는 수수료 계산 및 사전 예약에 반영되거나, 미구현 기능은 판매/과금을 중단해야 함.
- **도달성 및 사용자 영향**: 사용자가 상점에서 ₩100만~₩200만 원씩 지불해도 거래 수수료 50% 할인 등 어떠한 효과도 발생하지 않음.
- **최소 수정 방향**: `fee_booster` 만료일 체크 기반 수수료 할인율 연동(예약/정산 양측 일치 필수) 또는 미구현 상품 비활성화.
- **검증**: 코드베이스 전체 `rg -n "fee_booster|ai_predictor|scanner_item|acquired_passives"` 실행으로 확인 완료.

---

### F18 [P2] `OptionMonthChainGrid`의 고정 하드코딩 선물 지수(`260.45`, `126,293`)로 인한 ATM 오표시

- **위치**: [OptionMonthChainGrid.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionMonthChainGrid.tsx:59-62,95)
- **발생 조건 및 호출 경로**:
  - `OptionMonthChainGrid` 상단 선물 헤더와 `atmStrike` 판정이 `const futuresPrice = 260.45; const futuresChange = 0.20; ...` 하드코딩 상수에 고정됨.
- **관측 / 기대 결과**:
  - **관측 (코드 확인)**: 시장/옵션 프리미엄이 변해도 선물 지수는 항상 `260.45 (+0.08%)`로 표시되고 ATM 하이라이트 행이 `260.0`에 고정됨.
  - **기대**: 실제 기초 지수/옵션 등가격(Call-Put 패리티 또는 서버 지수) 기반으로 계산해야 함.
- **도달성 및 사용자 영향**: `/options` HTS 터미널을 이용하는 모든 사용자에게 고정된 더미 지수 노출.
- **최소 수정 방향**: `market_indices` 또는 계약 콜/풋 가격 근사치로부터 동적 지수를 계산해 전달함.
- **검증**: `OptionMonthChainGrid.tsx` 확인 완료.

---

### F19 [P2] `MemoryDatabase.restoreRollbackSnapshot`의 `Object.assign` 병합으로 틱 중 추가된 프로필 키 잔존

- **위치**: [memoryStore.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts:1504-1516)
- **발생 조건 및 호출 경로**:
  - `restoreRollbackSnapshot`은 롤백 전 `prevProfiles` 참조를 유지하기 위해 `Object.assign(existingObj, restored)`를 수행함(`1512`).
  - 스냅샷 생성 이후 해당 `ProfileRecord`에 새로 추가된 선택적 프로퍼티(예: `has_options_license`, `news_subscriptions`, `acquired_passives` 등)는 `restored`에 키가 없으면 `Object.assign`에 의해 덮어써지지 않고 그대로 남음.
- **관측 / 기대 결과**:
  - **관측 (CE-7 재현)**: 스냅샷 이후 `(profile as any).has_options_license = true` 추가 후 `restoreRollbackSnapshot(snap)` 실행 시 `db.profiles.get(uid).has_options_license === true`로 잔존함.
  - **기대**: 기존 객체의 키 중 `restored`에 존재하지 않는 키는 `delete existingObj[k]`로 제거한 뒤 `Object.assign`해야 함.
- **도달성 및 사용자 영향**: 틱/트랜잭션 롤백 시 새로 부여된 권한·구독·패시브 속성이 롤백되지 않고 남을 수 있는 상태 오염 결함.
- **최소 수정 방향**: `Object.assign(existingObj, restored)` 직전에 `for (const k of Object.keys(existingObj)) if (!(k in restored)) delete (existingObj as any)[k];` 수행.
- **검증**: 격리 반례 CE-7 실행으로 직접 재현 완료.

---

### F20 [P2] `MemoryDatabase.trimSettlementLedger`의 `settledBondRedemptions` 및 `evictedCustomTradeIds` 상한 부재

- **위치**: [memoryStore.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts:1332-1344)
- **발생 조건 및 호출 경로**:
  - `settledOptionExpiryKeys`는 `compactSettledOptionExpiryKeys()`로 `2000`건 초과 시 날짜 워터마크로 압축되지만, `settledBondRedemptions`(`bond_*` 중 쿠폰 패턴 외 키)와 `evictedCustomTradeIds`(모노토닉/결정론/쿠폰/옵션 패턴 외 모든 키)에는 어떠한 상한(cap)이나 압축도 없음.
- **관측 / 기대 결과**:
  - **관측 (코드 확인)**: `settlementLedger`가 트리밍될 때마다 위 두 `Set`은 무한히 증가하며 스냅샷 JSON에도 전량 직렬화됨.
  - **기대**: 상환 완료 만기일 워터마크 또는 FIFO 상한 등 메모리/디스크 상한 정책이 필요함.
- **도달성 및 사용자 영향**: 단기 실행에서는 영향이 적으나, 장기 운영 시 커스텀 정산 ID·채권 상환 키 축적으로 스냅샷 크기 및 직렬화 시간이 선형 증가함.
- **최소 수정 방향**: `settledBondRedemptions`에 만기일 워터마크 압축을 도입하고 `evictedCustomTradeIds`에 최대 크기/시간 기반 슬라이딩 캡을 적용함.
- **검증**: `memoryStore.ts` 정적 분석으로 확인 완료.

---

### F21 [P2] `CommodityMarketEngine.stepTickAsync`에서 자전거래 취소 주문을 `'expired'` 상태로 환불 처리

- **위치**: [CommodityMarketEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/CommodityMarketEngine.ts:696-706)
- **발생 조건 및 호출 경로**:
  - `CommodityOrderBook.matchOrders`에서 자전거래 방지(STP)로 취소된 주문(`selfTradeCancelledOrders`)은 오더북에서 제거됨.
  - 이후 `CommodityMarketEngine.stepTickAsync`(`701-706`)은 오더북에 없는 모든 `open`/`partial` 예약을 일괄 `releaseCommodityOrderMargin(this.db, orderId, 'expired')`로 환불 처리함.
- **관측 / 기대 결과**:
  - **관측 (코드 확인)**: 자전거래로 취소된 주문 상태가 `'cancelled'`가 아닌 `'expired'`로 기록됨(참고: CE-6 스크립트의 80원 주문은 봇 호가에 즉시 체결되어 `filled`되었으나, 코드상 `book`에서 빠진 미체결 자전취소 주문은 모두 `703`행 `'expired'` 분기로 진입함).
  - **기대**: `tickRes.selfTradeCancelledOrders`에 포함된 주문 ID는 `'cancelled'` 상태로 해제해야 함.
- **도달성 및 사용자 영향**: 원자재 자전거래 방지 발생 시 주문 이력 상태(`expired` vs `cancelled`) 오표기.
- **최소 수정 방향**: `selfTradeCancelledIds` 집합을 추적하여 `'cancelled'`와 `'expired'`를 구분해 `releaseCommodityOrderMargin` 호출.
- **검증**: `CommodityMarketEngine.ts:696-706` 코드 확인 완료.

---

### F22 [P3] 마이페이지 채권(`/bonds`) 및 사이드바 경제지표(`/eco`) 링크의 404 라우트

- **위치**: [app/mypage/page.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/mypage/page.tsx:127), [Sidebar.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/Sidebar.tsx:211)
- **발생 조건 및 호출 경로**:
  - 마이페이지 보유 채권 행은 `href: "/bonds"`를 생성하고, `Sidebar`는 `eco_calendar` 해금 또는 관리자일 때 `href="/eco"`를 렌더링함.
- **관측 / 기대 결과**:
  - **관측 (`Test-Path`)**: `app/bonds`와 `app/eco` 디렉터리 모두 `False`(라우트 부재 -> 클릭 시 404).
  - **기대**: 채권 목록은 `/markets/bonds`로 연결하고 `/eco`는 실제 페이지를 구현하거나 비활성화해야 함.
- **도달성 및 사용자 영향**: 관리자 사이드바에서 `경제지표 일정` 클릭 시 또는 채권 보유자의 마이페이지 링크 클릭 시 404 페이지 이동.
- **최소 수정 방향**: `mypage/page.tsx:127`을 `href: "/markets/bonds"`(또는 `/stocks/${h.stock_id}`)로 수정하고, 미구현 `/eco` 메뉴를 정리함.
- **검증**: `Test-Path "app/bonds"` -> `False`, `Test-Path "app/eco"` -> `False` 확인 완료.

---

### F23 [P3] `TopBar` 상단 종목 검색 입력창의 핸들러 미연결

- **위치**: [TopBar.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/TopBar.tsx:54-58)
- **발생 조건 및 호출 경로**:
  - `TopBar`의 `<input placeholder="종목명, 티커 검색 (예: AAPL, 삼성전자)" />`에 `value`, `onChange`, `onKeyDown`, 검색 결과 드롭다운 또는 라우팅 로직이 전혀 없음.
- **관측 / 기대 결과**: 텍스트 입력만 되고 검색/이동이 동작하지 않음.
- **도달성 및 사용자 영향**: 모든 V1 페이지 상단바의 검색 UI가 무동작 상태.
- **최소 수정 방향**: `stocks` 검색 결과 드롭다운 및 `/stocks/[id]` 네비게이션 연결.
- **검증**: `TopBar.tsx` 확인 완료.

---

### F24 [P3] `MarketEngine.ts`의 WTI 매크로 충격 ID 불일치(`WTI_CRUDE` vs `CRUDE_OIL`) 및 `AGENTS.md`·워크스페이스 불일치

- **위치**: [MarketEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:885), [definitions.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/definitions.ts:9), [AGENTS.md](/C:/Users/abcde/Desktop/웹소설/stock-sys/AGENTS.md:148-167)
- **발생 조건 및 호출 경로**:
  - `MarketEngine.tick()`은 `(marketState.commodities || []).find(c => c.commodity_id === 'WTI_CRUDE')`로 83달러 돌파 시 `INFLATION_SHOCK`를 발동하려 하나, `COMMODITY_DEFINITIONS`의 원유 ID는 `'CRUDE_OIL'`임.
  - 또한 `AGENTS.md`는 `vm-db/sql/init/01_schema.sql`을 참조하나 현 워크스페이스에 `vm-db/` 디렉터리가 존재하지 않음(레거시 SQL은 `archive/legacy-postgres/`에 위치).
- **관측 / 기대 결과**: WTI 인플레이션 충격 연동이 절대 트리거되지 않으며, `vm-db` 운영 체크리스트 경로가 현재 파일 구조와 불일치함.
- **도달성 및 사용자 영향**: `engine-server` 원자재-주식 간 WTI `$83` 인플레이션 충격 연동 미발동.
- **최소 수정 방향**: `MarketEngine.ts:885` 조건을 `c.commodity_id === 'CRUDE_OIL' || c.id === 'CRUDE_OIL'`로 보완하고 `AGENTS.md`의 비활성 `vm-db` 경로를 현행화함(본 리뷰는 읽기 전용이므로 미수정).
- **검증**: `MarketEngine.ts:885`, `definitions.ts:9`, `vm-db` 부재(`os error 2`) 확인 완료.

---

### F25 [P3] `npm run lint` 실패(`eslint` 오류 5건) 및 기존 회귀 스크립트 3건 실패

- **위치**: [app/api/commodities/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/commodities/route.ts:57), [app/etf/page.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/etf/page.tsx:135,169), [scripts/test-post-fix-remediation.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/scripts/test-post-fix-remediation.ts:153), [scripts/test-phase2-bot-portfolio-authority.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/scripts/test-phase2-bot-portfolio-authority.ts:150-168), [scripts/test-phase3-atomic-lp-quote-refresh.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/scripts/test-phase3-atomic-lp-quote-refresh.ts:75-95), [scripts/test-order-security-and-atomic.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/scripts/test-order-security-and-atomic.ts:186-203)
- **관측 / 기대 결과**:
  - `npm run lint`가 `exit 1`로 실패함 (`151 problems (5 errors, 146 warnings)`): `app/api/commodities/route.ts:57` (`prefer-const`), `app/etf/page.tsx:135,169` (`react-hooks/preserve-manual-memoization` 3건 — `useCallback` 의존성 `[..., selectedEtf.etfTicker, selectedEtf.basePrice]` vs 추론 `selectedEtf`), `scripts/test-post-fix-remediation.ts:153` (`prefer-const`).
  - 기존 회귀 스위트 3건 실패:
    1. `test-phase2-bot-portfolio-authority.ts` (`exit 1`): `BO_BOT_1`/`SO_LP_1` 주문이 `db.orders`에 등록되지 않은 채 `commitMatchedBatchAtomically`를 호출해 현행 주문 존재 검증에 거부됨(`false !== true`).
    2. `test-phase3-atomic-lp-quote-refresh.ts` (`exit 1`): 테스트가 `bundle.market.insertOrders`에 장애를 주입하나 실제 `MarketEngine`은 `batch.lpQuoteUpserts`를 `settlement.commitMatchedBatchAtomically`로 처리하므로 장애가 발동하지 않고 5틱 LP가 정상 갱신되어 지문이 달라짐.
    3. `test-order-security-and-atomic.ts` (`exit 1`): `1,000,000`원 현금으로 100,000원 주문을 10회 통과시키려 하나, 현행 `0.25%` 테이커 수수료 예약(`100,250`원/건) 때문에 9건만 통과함(`Accepted: 9, Rejected: 11`).
- **사용자 영향**: CI에서 `npm run lint` 또는 전체 `scripts/test-*.ts` 스위트를 실행할 경우 즉시 실패함.
- **최소 수정 방향**: `prefer-const` 및 `useCallback` 의존성(`[isLoggedIn, userId, selectedEtf]`) 정리, 3개 구형 테스트의 픽스처·기대값을 현행 수수료/원자적 LP·주문 검증 계약에 맞게 갱신.
- **검증**: `npm run lint` 및 각 테스트 스크립트 직접 실행으로 exit code 및 에러 메시지 확인 완료.

---

## 4. 검증 실행 결과표 (격리 임시 `STOCKSYS_DATA_DIR`)

| 구분 | 실행 명령 | Exit Code | 관측 결과 |
| :--- | :--- | :---: | :--- |
| 루트 타입 검사 | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | `0` | 오류 없음 (`ROOT_TSC_EXIT=0`) |
| 엔진 타입 검사 | `node node_modules/typescript/bin/tsc -p engine-server/tsconfig.json --noEmit --incremental false` | `0` | 오류 없음 (`ENGINE_TSC_EXIT=0`) |
| ESLint 검사 | `npm run lint` | `1` | `151 problems (5 errors, 146 warnings)` (`LINT_EXIT=1`) |
| 최근 수정·E2E·Stage2·ABM (7종) | `test-post-fix-remediation.ts`, `test-route-handlers-e2e.ts`, `test-codex-review-16-fixes.ts`, `test-order-risk-and-settlement.ts`, `test-stage2-verification.ts`, `test-stage2-review-fixes-v2.ts`, `test-agent-based-market.ts` | 모두 `0` | 7개 스크립트 전부 통과 |
| Phase 1~4·인증·Orderbook·교차자산 (30종 중 27종) | `test-phase1-suite.ts`, `test-phase2-*`(5종), `test-phase3-*`(8종), `test-phase4-*`(8종), `test-nextauth-http-integration.ts`, `test-cross-asset-full-suite.ts`, `test-orderbook-rpc-contract.ts`, `test-orderbook-react-render.tsx`, `test-use-orderbook-hook.tsx` | 모두 `0` | 27개 스크립트 통과 |
| Phase 2/3·보안 테스트 실패 (3종) | `test-phase2-bot-portfolio-authority.ts`, `test-phase3-atomic-lp-quote-refresh.ts`, `test-order-security-and-atomic.ts` | 모두 `1` | 각각 `settleRes.success false!==true`(168행), LP 지문 불일치(95행), `buyAccepted === 10` vs `actual: 9`(203행) 실패 |
| 신규 격리 반례 스크립트 (CE-1~CE-7) | 임시 `verify_counterexamples.ts` (`npx tsx`, 실행 후 삭제) | `0` | CE-1(`17,935,000,000`원 지급), CE-2(`INVALID_COUPON_RATE` / `15,000`원), CE-3(롤백 후 `ghostOrderStillInOrdersMap: true`), CE-4(콜론 키 `undefined` / `1,000`원 계좌 `AAPL` BUY 생성), CE-5(`REJECTED_UNAUTHORIZED_LP`), CE-6(`userCashAfterLargeLoss: -31,830,000`), CE-7(`staleHasOptionsLicenseInDbMap: true`) 모두 재현 확인 |
| **미실행 항목** | `npm run build`, `next start` HTTP 스모크, Playwright 브라우저 E2E, 실 OAuth, 원격 DB | - | 본 독립 리뷰 세션에서는 미실행 |

---

## 5. 이전 수정 보고서(`docs/post-fix-review-remediation-results.md`) 주장 독립 검증

| 이전 항목 | 주장 상태 | 독립 재판정 | 근거 (중복 합산 제외 안내) |
| :--- | :---: | :---: | :--- |
| **P1-1** 옵션 상대방 수수료 & 누적 검증 | 해결 완료 | **해결** | [optionOrderService.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/options/optionOrderService.ts:242-366) 구현 및 `test-post-fix-remediation.ts` `exit 0` 확인. (단, 만기 정산 단위 결함 `F1`은 별개 사안) |
| **P1-2** `MarketEngine.tick()` 롤백·비거래 저장·옵저버 지연 | 해결 완료 | **해결** | [MarketEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:951-1017), [SettlementBatchService.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/SettlementBatchService.ts:148-150) 및 관련 Phase 2~4/신규 회귀 `exit 0` 확인 |
| **P2-1** 구형 스냅샷 ETF·미래 옵션 보충 & 롤백 분리 | 해결 완료 | **해결** | `supplementMissingCatalogStocks`, `supplementFutureOptionContracts`, `restoreRollbackSnapshot` 분리 확인 및 `test-post-fix-remediation.ts` 통과. (단, `restoreRollbackSnapshot`의 `Object.assign` 잔존 키 결함 `F19`는 별개 신규 결함) |
| **P2-2** `trimSettlementLedger` 연속 워터마크·압축 | 해결 완료 | **해결** | `recordContiguousSeq`, `settledBondCouponIntervals`, `compactSettledOptionExpiryKeys` 확인. (단, `settledBondRedemptions`/`evictedCustomTradeIds` 상한 부재 `F20`은 별개 결함) |
| **P2-3** 주식/ETF 사전 검증·예약 `0.25%` 수수료 | 해결 완료 | **해결** | [orderRisk.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/orderRisk.ts:8-94), `dbMatching.ts`, `test-order-risk-and-settlement.ts` `exit 0` 확인. (단, 구형 `test-order-security-and-atomic.ts` 미갱신으로 `F25` 실패) |
| **P2-4** `ActiveOrdersPanel` 일괄 취소 `.in('id', ...)` | 해결 완료 | **해결** | [local-db/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts:498-512) 및 `test-route-handlers-e2e.ts` 통과 확인. (단, `orders` 조회 시 `stocks(...)` 조인 누락 `F12`는 별개 결함) |
| **P2-5.1** USD 종목/ETF 정산 통화·`/etf` 서버 연동 | 해결 완료 | **해결** | [currency.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/currency.ts:1-73), `InMemorySettlementRepository.ts`, `app/etf/page.tsx` 폴링 확인. (`app/etf/page.tsx` ESLint 메모이제이션 오류는 `F25`, ABM `valueStrategy`/`trendStrategy` USD 미환산은 `F6`으로 별도 기록) |
| **P2-5.2** 원자재 `reduce-only` UI·동적 환율·취소 API/패널 | 해결 완료 | **해결** | `app/api/commodities/route.ts`, `CommodityOrderEntry.tsx`, `CommodityActiveOrdersPanel.tsx`, `test-route-handlers-e2e.ts` 통과 확인 |
| **P2-5.3** 마이페이지 옵션명·승수·USD 원화 평가 | 해결 완료 | **해결** | `app/mypage/page.tsx` 옵션 및 환율 변환 렌더링 확인. (`href: "/bonds"` 404 링크는 `F22`로 별도 기록) |
| **P2-5.4** `OptionsPanel` 미존재 RPC 제거 & 롤오버 부분 보고 | 해결 완료 | **잔존** | `OptionsPanel.tsx`가 `quantity: qty`를 전송하고 `res.filledQty`를 참조하는 반면 `/api/options/order`는 `qty`만 수신하고 `res.order.filledQty`로 응답해 모든 주문·롤오버가 `400` 실패함(**Finding F10과 동일 건 — 합계 중복 제외**) |
| **P2-5.5** `HttpMemoryClient` JSON 오류 메시지 보존 | 해결 완료 | **해결** | [lib/db/client.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/db/client.ts:175-179) 및 `test-post-fix-remediation.ts` [P2-5.5] 확인 |
| **P2-6.1~5** 원자재 락/시세동기화·인덱스·트림락·무변이 SELECT | 해결 완료 | **해결** | `CommodityMarketEngine.ts`, `InMemoryMarketRepository.ts`, `localStandaloneServer.ts`, `local-db/route.ts` 구현 및 `test-post-fix-remediation.ts` [P2-6] 통과 확인 |
| **P3-1** `news/page.tsx`·`RUMOR` 서버 마스킹·라우트 E2E 복구 | 해결 완료 | **해결** | [local-db/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts:47-60,267-283), `app/news/page.tsx`, `test-route-handlers-e2e.ts` `exit 0` 확인 |
| **기타** 프로덕션 빌드·HTTP 스모크 주장 | 통과 주장 | **검증불가** | 본 독립 리뷰에서는 `npm run build` 및 `next start` HTTP 스모크를 직접 실행하지 않아 미검증으로 분류 |
