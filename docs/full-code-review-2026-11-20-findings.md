# 전체 코드 리뷰 결과 보고서 (2026-11-20)

- **검토 대상**: `C:/Users/abcde/Desktop/웹소설/stock-sys` 현재 작업본 전체(미커밋 수정 및 신규 파일 포함)
- **검토 원칙**: 애플리케이션 소스·설정·기존 테스트 무수정(읽기 전용), 활성 실행 경로 기준 정적/동적 검증, 임시 `STOCKSYS_DATA_DIR` 및 임시 스크립트 격리 실행, 확정 결함과 `추측 및 미검증 사항` 분리
- **작성 기준일**: 2026-11-20

---

## 1. 요약 (Executive Summary)

1. **타입·린트·기존 핵심 회귀 스위트 현황**
   - 루트 `npx tsc --noEmit` PASS (`exit 0`), `engine-server` `npx tsc --noEmit` PASS (`exit 0`), `npm run lint` PASS (`exit 0`, `0 errors, 149 warnings`).
   - 2026-11-20 보안 패치 대상이었던 **`RR-01`(`/api/local-db` `NEWS_TABLES` 필터/정렬 오라클 및 `RUMOR` 마스킹)** 및 **`RR-02`(`GET /api/market-flow` `recentNews` 비구독 `RUMOR` 유출)** 는 코드 및 격리 동적 회귀 테스트(`scripts/test-reachable-security-fixes.ts`, `EXIT=0`)에서 해결이 확인되었다.
   - `scripts/test-full-review-2026-11-19-fixes.ts`, `scripts/test-route-handlers-e2e.ts`, `scripts/test-nextauth-http-integration.ts`, `scripts/test-phase1-suite.ts`, `scripts/test-order-security-and-atomic.ts`, `scripts/test-order-risk-and-settlement.ts`, Phase 2~4 원자성·CAS·롤백 테스트, `verify-env-alignment.ts`, `verify-schema-diff.ts` 모두 격리 환경에서 `EXIT=0`으로 통과했다.
2. **확정 결함 요약 (총 10건: `P1` 5건, `P2` 4건, `P3` 1건)**
   - **기존 미해결 잔존 (`RR-03`~`RR-09` 확인 및 실측)**:
     - **`F-20261120-01` [P1]**: `SettlementBatchService`의 월 단위 키(`period_YYYY-MM`)와 `BondCouponEngine`의 분기 쿠폰(`paymentsPerYear=4`) 불일치 → 평상시 매월 분기치 지급(연 3배 과지급) 및 `db.clock` 정렬 시 직전 달 쿠폰 지급 이력으로 만기 상환 영구 실패(`INVALID_COUPON_AMOUNT`를 `continue`로 삼킴).
     - **`F-20261120-02` [P1]**: Local Standalone 런타임(`localStandaloneServer.ts`)에서 만기 옵션·채권 정산 배치가 전혀 호출되지 않음.
     - **`F-20261120-03` [P1]**: Local Standalone `runTick()`의 20틱 메모리 정리 루프가 `if (order.user_id) continue;`로 인해 `AgentManager`가 생성하는 `acc_lp_main`·`acc_bot_*` 주문을 전량 스킵해 주문/스냅샷이 무한 누적됨.
     - **`F-20261120-04` [P1]**: `/v2/stocks/[id]`가 `MemoryQueryBuilder`에 없는 `.or()`를 `try-catch` 없이 호출해 SSR 크래시가 발생하며(`/stocks/[id]`는 `try-catch`로 삼켜 `relatedNews=[]`), V1/V2 모두 `authorizeNewsRecord` 미적용 및 `MarketNewsRecord.title` 대신 `n.headline` 참조.
     - **`F-20261120-06` [P2]**: `CommodityOrderbookPanel`이 API의 `totalSize`·`{ spread }` 객체 대신 `.size`·`Number(spread)`를 읽어 `$NaN`/`NaN`으로 깨짐.
     - **`F-20261120-07` [P2]**: `CommodityOrderEntry`·`CommodityActiveOrdersPanel`이 `myPosition.side` (`'long' | 'short'`)를 무시해 숏 포지션을 롱으로 표시하고 매수 청산 증거금 면제를 오계산.
   - **금번 추가 확정 결함**:
     - **`F-20261120-05` [P1/조건부]**: `MarketEngine.alignToTickSize`의 `market` 인자 누락(`[80, 120]` 채권 클램핑 오작동 위험) 및 `evaluateOrderSafety`(`legacyOrderSafety.ts`)의 KRX 정수 틱 강제 변환으로 소수점 가격의 해외주식/USD ETF 미체결 주문 매칭 시 `ORDER_PRICE_MISMATCH` 발생.
     - **`F-20261120-08` [P2]**: `/admin` 긴급 서킷브레이커 토글이 순수 React 로컬 상태이며, `/admin` 시나리오 제어기의 주식/채권 시나리오는 `CommodityMarketEngine`만 소비하고 주식 엔진(`MarketEngine`/`AgentManager`)에 미연결.
     - **`F-20261120-09` [P2]**: USD 표시 ETF(`SPY`, `QQQ`, `TQQQ`, `TSLL`, `NVDL`, `EWJ`, `FXI`)의 정산은 `USD × 환율` KRW 기준이나 `/stocks/[id]`·`/v2/stocks/[id]`·`PriceHeroV2` 등락폭·`TradeFeed`/`TradeFeedV2`가 `₩`로 잘못 표기.
     - **`F-20261120-10` [P3]**: `OptionOrderEntry`의 비율 버튼(`100% 가능` 등)이 `0.1%` 예약 수수료를 차감하지 않고 수량을 계산해 잔액 경계에서 서버 거부 발생.

---

## 2. 영역별 검토 파일 및 경로 인벤토리

| 영역 | 주요 검토 파일 |
|---|---|
| **인증·권한·보안** | [proxy.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/proxy.ts), [route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/auth/[...nextauth]/route.ts), [sessionAuth.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/auth/sessionAuth.ts), [adminAuth.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/auth/adminAuth.ts), [useAuth.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/auth/useAuth.ts), [accessPolicy.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/news/accessPolicy.ts), [sharedRateLimiter.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/rateLimit/sharedRateLimiter.ts) |
| **API Route Handlers** | [local-db/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts), [market-flow/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/market-flow/route.ts), [orders/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/orders/route.ts), [options/order/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/options/order/route.ts), [options/account/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/options/account/route.ts), [commodities/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/commodities/route.ts), [admin/scenarios/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/admin/scenarios/route.ts), [events/resolve/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/events/resolve/route.ts), [shop/purchase/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/shop/purchase/route.ts), [analyze/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/analyze/route.ts) |
| **메모리 DB·영속화·저장소** | [memoryStore.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts), [memoryDbClient.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryDbClient.ts), [PersistenceManager.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/PersistenceManager.ts), [StorageAdapter.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/StorageAdapter.ts), [lib/db/client.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/db/client.ts), [lib/db/server.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/db/server.ts), [InMemorySettlementRepository.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts), [InMemoryMarketRepository.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemoryMarketRepository.ts), [InMemoryParticipantRepository.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemoryParticipantRepository.ts) |
| **거래·리스크·정산·시뮬레이션** | [localStandaloneServer.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts), [localDevMode.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localDevMode.ts), [marketService.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/marketService.ts), [dbMatching.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/dbMatching.ts), [orderRisk.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/orderRisk.ts), [currency.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/currency.ts), [agentManager.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/agentManager.ts), [marketDiagnostics.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/marketDiagnostics.ts), [optionOrderService.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/options/optionOrderService.ts), [contractUnits.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/options/contractUnits.ts), [commodityLedger.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/commodityLedger.ts), [CommodityMarketEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/CommodityMarketEngine.ts), [exchangeService.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/exchange/exchangeService.ts), [playerEventService.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/events/playerEventService.ts), [catalog.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/shop/catalog.ts), [ScenarioManager.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/scenario/ScenarioManager.ts), [format.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/format.ts) |
| **독립 엔진 서버 (`engine-server`)** | [index.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/index.ts), [restartRuntime.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/restartRuntime.ts), [MarketEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts), [EventDirector.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/EventDirector.ts), [legacyOrderSafety.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/risk/legacyOrderSafety.ts), [SettlementBatchService.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/SettlementBatchService.ts), [BondCouponEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/BondCouponEngine.ts), [OptionSettlementEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/OptionSettlementEngine.ts), [BaseAgent.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/BaseAgent.ts), [ASMarketMakerAgent.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/ASMarketMakerAgent.ts), [PensionFundAgent.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/PensionFundAgent.ts), [CommercialBankAgent.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/CommercialBankAgent.ts), [HedgeFundAgent.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/HedgeFundAgent.ts), [QuantAgent.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/QuantAgent.ts), [StatArbAgent.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/StatArbAgent.ts) |
| **UI 페이지 및 컴포넌트 (`app`)** | [app/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/page.tsx), [DashboardGate.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/DashboardGate.tsx), [stocks/[id]/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/stocks/[id]/page.tsx), [StockDetailClient.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/stocks/[id]/StockDetailClient.tsx), [v2/stocks/[id]/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/v2/stocks/[id]/page.tsx), [StockDetailV2Client.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/v2/stocks/[id]/StockDetailV2Client.tsx), [PriceHeroV2.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/v2/PriceHeroV2.tsx), [Orderbook.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/Orderbook.tsx), [OrderbookV2.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/v2/OrderbookV2.tsx), [TradeFeed.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/TradeFeed.tsx), [TradeFeedV2.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/v2/TradeFeedV2.tsx), [OrderEntry.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OrderEntry.tsx), [ActiveOrdersPanel.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/ActiveOrdersPanel.tsx), [OptionOrderEntry.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionOrderEntry.tsx), [OptionAccountPanel.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionAccountPanel.tsx), [OptionMonthChainGrid.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionMonthChainGrid.tsx), [OptionHTSDashboard.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionHTSDashboard.tsx), [OptionsPanel.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionsPanel.tsx), [commodities/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/commodities/page.tsx), [CommodityDetailClient.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/commodities/[id]/CommodityDetailClient.tsx), [CommodityOrderbookPanel.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityOrderbookPanel.tsx), [CommodityOrderEntry.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityOrderEntry.tsx), [CommodityActiveOrdersPanel.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityActiveOrdersPanel.tsx), [market-flow/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/market-flow/page.tsx), [news/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/news/page.tsx), [shop/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/shop/page.tsx), [mypage/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/mypage/page.tsx), [exchange/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/exchange/page.tsx), [etf/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/etf/page.tsx), [institutions/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/institutions/page.tsx), [admin/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/admin/page.tsx), [ScenarioController.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/admin/ScenarioController.tsx), [BondDetailPanel.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/BondDetailPanel.tsx), [FinancialPanel.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/FinancialPanel.tsx), [ChatPanel.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/ChatPanel.tsx), [Sidebar.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/Sidebar.tsx), [TopBar.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/TopBar.tsx), [v2/*](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/v2/page.tsx) |
| **운영·설정·문서·검증 스크립트** | [AGENTS.md](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/AGENTS.md), [package.json](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/package.json), [next.config.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/next.config.ts), [instrumentation.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/instrumentation.ts), [.env.example](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/.env.example), [.env.local.example](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/.env.local.example), [.env.production.example](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/.env.production.example), [local-standalone.env.example](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/docs/local-standalone.env.example), [verify-env-alignment.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/scripts/verify-env-alignment.ts), [verify-schema-diff.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/scripts/verify-schema-diff.ts), [node_modules/next/dist/docs](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/node_modules/next/dist/docs/index.md) |

---

## 3. 확정 결함 상세 (`P0` ~ `P3`)

### `F-20261120-01` [P1] 월간 정산 키(`period_YYYY-MM`) vs 분기 채권 쿠폰(`paymentsPerYear=4`) 불일치 → 3배 과지급 & 만기 상환 영구 실패
- **위치**:
  - [SettlementBatchService.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/SettlementBatchService.ts#L47-L50) 및 [L118-L123](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/SettlementBatchService.ts#L118-L123)
  - [BondCouponEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/BondCouponEngine.ts#L24) 및 [L46-L53](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/BondCouponEngine.ts#L46-L53), [L130-L152](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/BondCouponEngine.ts#L130-L152)
  - [InMemorySettlementRepository.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts#L1740-L1777)
- **발생 조건**: `engine-server`의 `MarketEngine` 50틱 배치(`SettlementBatchService.runDailySettlementBatch`) 또는 동일 서비스를 호출하는 운영 배치에서 채권 보유자가 (1) 복수 월에 걸쳐 채권을 보유하거나, (2) 직전 달에 쿠폰 지급을 받은 뒤 91.25일 이내 다른 월(`period_YYYY-MM`)에 채권 만기일을 맞이할 때.
- **영향**:
  - `SettlementBatchService.currentPeriodKey()`는 월 단위 키(`period_${iso.slice(0, 7)}`)를 생성하지만, `BondCouponEngine`은 `defaultPaymentsPerYear = 4`(분기 금액 `coupon_rate / 4`)를 그대로 지급하므로 **매월 분기치 이자가 나가 연 3배 과지급**된다.
  - `db.clock`과 정산 `clock`이 일치하는 정상 시계에서 직전 달(`period_2026-08`) 쿠폰이 지급된 뒤 다음 달(`period_2026-09`) 만기일에 도달하면, `BondCouponEngine`은 새 키(`period_2026-09`) 때문에 최종 쿠폰(`1,000`원)을 포함해 요청하는 반면, `InMemorySettlementRepository.settleBondMaturityAtomically()`는 최근 `365/4=91.25`일 내 `paid_at` 이력을 발견해 `maxAllowedFinalCoupon=0`으로 설정하고 `INVALID_COUPON_AMOUNT`를 반환한다. `BondCouponEngine.ts:152`는 `!settlementRes.success`를 `continue`로 무시하므로 **원금 만기 상환 자체가 영구 실패**한다.
  - 반대로 `db.clock`이 `simClock`과 동기화되지 않아 `paid_at`이 `maturityTime`보다 미래로 찍히는 경우 이력 차단을 우회해 만기월에도 추가 쿠폰이 과지급된다.
- **근거 및 검증 결과**:
  - 격리 재현(`REPRO-1A`, `db.clock`과 `simClock` 동기화): `2026-08-15` 실행 `bondCouponsPaid: 1000` → `2026-09-15` 만기 실행 `{ bondCouponsPaid: 0, bondPrincipalRedeemed: 0 }`, 보유 수량 `10` 잔존, 현금 `1000` 고착 확인.
  - 격리 재현(`REPRO-1B`, Q1 1·2·3월 실행): `{ jan: 1000, feb: 1000, mar: 1000, totalPaidInOneQuarter: 3000 }`로 분기당 3배 과지급 확인.
- **수정 방향**: `SettlementBatchService`가 분기 단위 기간 키(`YYYY-Qn`) 또는 직전 지급일 기준 만기/분기 경과 판정을 사용하고, `BondCouponEngine`이 기지급 윈도우 내 만기 시 `couponAmount: 0`으로 원금 상환을 진행하며, 실패 시 `continue`로 은폐하지 않고 오류를 전파/기록한다.

---

### `F-20261120-02` [P1] Local Standalone 런타임(`localStandaloneServer.ts`)에서 만기 옵션·채권 정산 미실행
- **위치**:
  - [localStandaloneServer.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts#L165-L227)
  - 대비: [MarketEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts#L308) 및 [L2313-L2323](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts#L2313-L2323)
- **발생 조건**: Next.js 기본 실행 경로(`instrumentation.ts:5-7` → `ensureLocalStandaloneEngine()`)로만 앱을 실행할 때 옵션 계약 또는 채권의 만기일이 도래한 경우.
- **영향**: `LocalMarketEngineInstance.runTick()`은 `agentManager.step(1.0)`과 20틱 메모리/스냅샷 정리만 수행하며 `SettlementBatchService` / `OptionSettlementEngine` / `BondCouponEngine`을 일절 호출하지 않는다. 만기된 옵션과 채권이 자동으로 정산·청산되지 않고 계좌에 방치된다.
- **근거 및 검증 결과**: 전수 검색(`rg "runDailySettlementBatch|settlementService"`)에서 활성 Next.js 런타임(`app/`, `lib/`) 내 호출처 0건 확인.
- **수정 방향**: `LocalMarketEngineInstance.runTick()`에 주기적(예: 50틱마다) `SettlementBatchService` 호출을 추가하고 `withAllStockLocks`/계좌 락·`runWithCommitGate` 하에서 영속 저장까지 원자적으로 처리한다.

---

### `F-20261120-03` [P1] Standalone `runTick()`의 20틱 정리 루프가 `acc_*` 봇·LP 주문을 스킵해 메모리·스냅샷 무한 누적
- **위치**:
  - [agentManager.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/agentManager.ts#L2070-L2086) 및 [L2117-L2133](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/agentManager.ts#L2117-L2133)
  - [localStandaloneServer.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts#L178-L202)
- **발생 조건**: Local Standalone 엔진(`LocalMarketEngineInstance`)이 동작해 `AgentManager.step()`이 매 틱 `acc_lp_main`·`acc_bot_*` 주문을 생성할 때 항상 발생.
- **영향**: `AgentManager`가 제출하는 LP/봇 주문에는 `userId: 'acc_lp_main'` / `'acc_bot_*'`가 설정되는 반면, `runTick()` 20틱 정리 루프는 `if (order.user_id) continue;`(`localStandaloneServer.ts:180`)로 `user_id`가 있는 모든 주문을 보호 대상으로 취급한다. 결과적으로 체결(`filled`)·취소(`cancelled`)·시간 만료된 봇/LP 주문이 `memoryDb.orders`와 `snapshot.json`에 무한 누적된다.
- **근거 및 검증 결과**: `REPRO-2`에서 `AgentManager.step(1.0)` 1회 실행 후 `memoryDb.orders.size=862` 중 `user_id` 보유 주문 `203`건(샘플 `acc_lp_main`)이 생성됨을 확인; `localStandaloneServer.ts:180` 조건상 해당 주문 전량이 정리 루프를 통과하지 못함.
- **수정 방향**: 실제 사용자와 봇/LP 계좌(`order.user_id.startsWith('acc_')` 또는 `participantType === 'bot' | 'lp'`/`is_lp`)를 명확히 분리해, 종료(`filled`/`cancelled`) 또는 TTL 초과 봇/LP 주문을 안전하게 정리·인덱스 해제한다.

---

### `F-20261120-04` [P1] `/v2/stocks/[id]` `.or()` 미구현 SSR 예외 크래시 및 V1·V2 뉴스 권한 마스킹·필드명(`headline` vs `title`) 불일치
- **위치**:
  - [memoryDbClient.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryDbClient.ts#L40-L130) (`.or()` 메서드 부재)
  - [app/v2/stocks/[id]/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/v2/stocks/[id]/page.tsx#L144-L153) (`try-catch` 없는 `.or(...)` + `sanitizePublicNewsRecord`만 사용)
  - [app/stocks/[id]/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/stocks/[id]/page.tsx#L141-L152) (`try-catch`가 `.or()` 예외를 삼켜 `relatedNews` 항상 `[]` + `authorizeNewsRecord` 미사용)
  - [StockDetailV2Client.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/v2/stocks/[id]/StockDetailV2Client.tsx#L446), [StockDetailClient.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/stocks/[id]/StockDetailClient.tsx#L374), [DashboardGate.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/DashboardGate.tsx#L162) (`n.headline` 참조)
- **발생 조건**: Local Standalone 모드에서 `/v2/stocks/[id]` 또는 `/stocks/[id]` 진입 시 항상 발생.
- **영향**:
  - Next.js App Router([10-error-handling.md](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md#L271)) 기준 Server Component의 미처리 예외는 상위 에러 경계로 전파되어 `/v2/stocks/[id]` 페이지 렌더링이 실패한다.
  - `/stocks/[id]`는 예외를 삼켜 관련 뉴스가 항상 비어 있고, `.or()`가 동작하도록 고치더라도 두 페이지 모두 `canReadRumor`/`authorizeNewsRecord`를 거치지 않아 비구독자 SSR 응답에 `RUMOR` 원문이 노출될 위험이 있다.
  - `MarketNewsRecord`(`memoryStore.ts:290-304`)는 `title` 필드를 사용하므로, 클라이언트에서 `n.headline`만 렌더링하면 뉴스 제목이 빈 줄로 표시된다.
- **근거 및 검증 결과**: `REPRO-3`에서 `createMemoryDbClient().from('market_news').select('*').or(...)` 실행 시 `TypeError: client.from(...).select(...).or is not a function` 즉시 재현.
- **수정 방향**: `MemoryQueryBuilder`에 `.or()` 지원 추가 또는 메모리 DB 호환 필터 조회로 변경, V1/V2 SSR에서 세션 프로필 기반 `authorizeNewsRecord(r, canReadRumor(viewerProfile))` 적용, UI는 `n.title ?? n.headline`으로 렌더링.

---

### `F-20261120-05` [P1/조건부] `MarketEngine.alignToTickSize` `market` 인자 누락 및 `legacyOrderSafety` KRX 정수 틱 강제로 소수점 해외주식·USD ETF 매칭 거부(`ORDER_PRICE_MISMATCH`)
- **위치**:
  - [MarketEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts#L1591) 및 [L2498-L2503](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts#L2498-L2503)
  - [legacyOrderSafety.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/risk/legacyOrderSafety.ts#L37-L41) 및 [L188](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/risk/legacyOrderSafety.ts#L188)
- **발생 조건**: `engine-server`의 `MarketEngine`이 소수점 지정가(예: `GOOGL $141.20`, `AAPL $185.50`)를 가진 저장소 미체결 주문(`_fromRepo`, 예: `/api/orders`를 통해 등록된 주문)을 매칭하거나, `alignToTickSize(price)`를 `market` 없이 `$50~$150` 소수 가격(`TQQQ`, `EWJ`, `GOOGL`)에 호출할 때.
- **영향**: `validateSingleOrder`가 `applyLegacyChildOrderSafetyLimits`를 호출하면서 `alignToLegacyTickSize(141.2)`가 실행되어 인메모리 주문 가격은 `141`로 바뀌지만 DB 원본 주문의 `price`는 `141.2`로 남아, `InMemorySettlementRepository.settleTradesBatch`가 `ORDER_PRICE_MISMATCH`로 해당 틱의 체결 배치 전체를 거부한다. 또한 `MarketEngine.alignToTickSize(price)`는 `market` 미전달 시 `50 <= price <= 150 && !Number.isInteger(price)`를 채권으로 간주해 `[80.00, 120.00]`으로 강제 클램핑한다.
- **근거 및 검증 결과**: `REPRO-5`에서 GOOGL `$141.20` 양방향 미체결 주문을 `MarketEngine.processBatchOrders`로 매칭 시 `[MarketEngine] Authoritative settlement REJECTED: ORDER_PRICE_MISMATCH: Trade price 141 outside limits (buy: 141.2, sell: 141.2)` 확인. (내장 `engine-server` 봇 신규 주문끼리는 생성 단계에서 정수로 맞춰져 통과하지만, 사용자/저장소 소수점 주문 유입 시 충돌함.)
- **수정 방향**: `evaluateOrderSafety`와 `MarketEngine.alignToTickSize`에 자산 시장 정보(`market`, `currency`)를 전달해 해외/USD ETF는 `$0.01`, 국내주식은 KRX 틱, `[80, 120]` 클램핑은 `market === 'bonds'`일 때만 적용한다.

---

### `F-20261120-06` [P2] 원자재 호가창(`CommodityOrderbookPanel`) 필드명·타입 불일치로 `NaN`/`$NaN` 표시
- **위치**:
  - [app/api/commodities/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/commodities/route.ts#L72-L73) 및 [L100-L101](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/commodities/route.ts#L100-L101)
  - [CommodityDetailClient.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/commodities/[id]/CommodityDetailClient.tsx#L208-L214)
  - [CommodityOrderbookPanel.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityOrderbookPanel.tsx#L27-L28), [L39](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityOrderbookPanel.tsx#L39), [L56-L77](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityOrderbookPanel.tsx#L56-L77)
- **발생 조건**: 사용자가 `/commodities/[id]` 페이지에서 `호가 / 실시간 체결` 탭을 선택할 때 항상 발생.
- **영향**: `getDepth(10)`은 `{ price, totalSize, orderCount }[]`를, `getSpread()`는 `{ bestBid, bestAsk, spread, spreadPct }` 객체를 반환하나, 패널은 `b.size`/`ask.size`와 `Number(spread)`를 직접 참조해 스프레드가 `$NaN`, 모든 호가 잔량이 `NaN`으로 렌더링된다.
- **근거 및 검증 결과**: `REPRO-4`에서 `CommodityOrderBook.getDepth(10)`과 `getSpread()` 반환값에 대해 패널 표현식 평가 시 각각 `NaN` 출력 확인.
- **수정 방향**: 패널에서 `b.totalSize ?? b.size` 및 `typeof spread === 'object' ? spread?.spread : spread`를 사용하도록 수정한다.

---

### `F-20261120-07` [P2] 원자재 선물 UI의 숏(Short) 포지션 `side` 누락으로 보유 표기 및 청산 증거금 오동작
- **위치**:
  - [commodityLedger.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/commodityLedger.ts#L84-L106) (`side: 'long' | 'short'`에 `quantity > 0` 저장)
  - [CommodityOrderEntry.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityOrderEntry.tsx#L42), [L67-L72](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityOrderEntry.tsx#L67-L72), [L265-L270](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityOrderEntry.tsx#L265-L270)
  - [CommodityActiveOrdersPanel.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityActiveOrdersPanel.tsx#L20-L23) 및 [L157-L164](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityActiveOrdersPanel.tsx#L157-L164)
- **발생 조건**: 사용자가 원자재 선물 숏(매도) 포지션을 보유한 상태에서 `/commodities/[id]` 주문/미체결 패널을 조회할 때.
- **영향**: 서버 `commodityPositions`는 `{ side: 'short', quantity: 5 }`로 저장되지만, 두 UI 컴포넌트 모두 `side`를 무시하고 양수 `quantity`만 읽어 **숏 포지션을 `롱 +5계약`으로 잘못 표시**하며, `CommodityOrderEntry`는 `positionQty < 0` 분기에 절대 진입하지 못해 숏 청산(매수) 주문에도 신규 위탁증거금이 필요한 것처럼 표시·계산한다.
- **수정 방향**: `myPosition?.side === 'short' ? -Math.abs(qty) : Math.abs(qty)`로 부호를 복원한다.

---

### `F-20261120-08` [P2] 관리자 페이지(`/admin`) 긴급 서킷브레이커 무동작 및 주식 시나리오 엔진 미연결
- **위치**:
  - [app/admin/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/admin/page.tsx#L31) 및 [L350-L374](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/admin/page.tsx#L350-L374)
  - [ScenarioController.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/admin/ScenarioController.tsx#L32) 및 [L80-L99](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/admin/ScenarioController.tsx#L80-L99)
  - [app/api/admin/scenarios/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/admin/scenarios/route.ts#L10-L12)
- **발생 조건**: 관리자가 `/admin`의 `긴급 대응` 탭에서 `거래 동결`/`LP 무한 유동성` 버튼을 클릭하거나, `시나리오 제어기` 탭에서 `주식(stock)` 타겟 작전 시나리오를 주입할 때.
- **영향**: `tradingHalt`/`lpInfiniteLiquidity`는 서버 API 호출 없이 React `useState`만 변경해 실제 거래나 봇을 제어하지 못한다. 또한 `/api/admin/scenarios`에 등록된 시나리오는 `CommodityMarketEngine`만 매 틱 `getAssetBias()`를 소비하므로 주식·채권 타겟 작전은 시세에 아무 영향을 주지 않는다.
- **근거 및 검증 결과**: 전수 검색(`rg "scenarioManager|ScenarioManager"`)에서 `CommodityMarketEngine.ts`와 `admin/scenarios/route.ts` 외 활성 엔진 참조 0건 확인.
- **수정 방향**: 서킷브레이커용 서버 API·엔진 게이트를 구현하거나 미지원 컨트롤을 비활성화하고, 시나리오 제어기는 주식 엔진 연동 전까지 원자재 전용임을 UI/API에서 명확히 제한한다.

---

### `F-20261120-09` [P2] USD 표시 ETF(`SPY`, `QQQ`, `TQQQ` 등) UI 통화 기호(`₩` vs `$`) 불일치
- **위치**:
  - [currency.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/currency.ts#L5-L40), [format.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/format.ts#L15-L36)
  - [app/v2/stocks/[id]/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/v2/stocks/[id]/page.tsx#L136-L142), [app/stocks/[id]/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/stocks/[id]/page.tsx#L137-L138)
  - [StockDetailV2Client.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/v2/stocks/[id]/StockDetailV2Client.tsx#L91-L93), [L180-L182](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/v2/stocks/[id]/StockDetailV2Client.tsx#L180-L182), [L464-L471](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/v2/stocks/[id]/StockDetailV2Client.tsx#L464-L471)
  - [PriceHeroV2.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/v2/PriceHeroV2.tsx#L78) (`fmtPrice(Math.abs(amount), stock.market)`에 `stock.ticker` 누락)
  - [TradeFeed.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/TradeFeed.tsx#L48), [TradeFeedV2.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/v2/TradeFeedV2.tsx#L46-L49)
- **발생 조건**: `market === 'etf'`이면서 USD로 호가·정산되는 ETF(`SPY`, `QQQ`, `TQQQ`, `TSLL`, `NVDL`, `EWJ`, `FXI`) 상세 화면 조회 시 항상 발생.
- **영향**: 메인 가격(`PriceHeroV2.tsx:54`)과 주문 정산(`orderRisk.ts`, `/api/orders` `test-route-handlers-e2e.ts` TEST 9)은 `$` 기준(`USD × 환율`)으로 처리되지만, `PriceHeroV2` 등락폭·V2 시고저/빅버튼·거래대금·체결 피드(`TradeFeed`/`TradeFeedV2`)는 `market === 'overseas' || 'europe' || 'commodities'`만 확인하거나 `ticker`를 누락해 `₩60`처럼 원화로 잘못 표기한다.
- **근거 및 검증 결과**: `REPRO-7`에서 `isUsdQuotedAsset({ market: 'etf', ticker: 'TQQQ' }) === true`, `fmtPrice(60, 'etf', 'TQQQ') === '$60.00'`, `fmtPrice(60, 'etf') === '₩60'` 확인.
- **수정 방향**: 모든 가격/체결/거래대금 표시부에서 `isUsdQuotedAsset(stock)` 또는 `fmtPrice(..., stock.market, stock.ticker)`를 일관 적용한다.

---

### `F-20261120-10` [P3] 옵션 주문창 비율 버튼(`100% 가능` 등)의 `0.1%` 예약 수수료 미반영
- **위치**:
  - [OptionOrderEntry.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionOrderEntry.tsx#L44-L58)
  - [orderRisk.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/orderRisk.ts#L68-L74) (`OPTION_RESERVATION_FEE_RATE = 0.001`)
- **발생 조건**: 옵션 매수 가용 예수금이 `가격 × 승수 × N` 이상이고 `가격 × 승수 × N × 1.001` 미만일 때 비율(`100%`) 버튼으로 수량을 채워 주문 제출 시.
- **영향**: 화면 하단 합계(`totalWithFee`)에는 `0.1%` 수수료를 포함해 표시하면서도 최대 가능 수량 계산(`handlePctQty`)에서는 `effectivePrice * multiplier`로만 나누어, `100%` 버튼 클릭 후 매수 시 서버에서 예수금 부족(`400`)으로 거절된다.
- **수정 방향**: `unitCost = effectivePrice * multiplier * 1.001` 기준으로 최대 주문 가능 계약 수를 산출한다.

---

## 4. 기존 결함 해결 확인 (`2026-11-20` 패치 검증)

- **`RR-01` 해결 확인**: [app/api/local-db/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts#L41-L104) 및 [L326-L358](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts#L326-L358), [accessPolicy.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/news/accessPolicy.ts)에서 `NEWS_TABLES` 비허용 컬럼 필터/정렬 차단(`403`) 및 서버 측 `canReadRumor`/`authorizeNewsRecord` 적용 확인. (`scripts/test-reachable-security-fixes.ts` PASS)
- **`RR-02` 해결 확인**: [app/api/market-flow/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/market-flow/route.ts#L48-L115) 및 [L175-L186](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/market-flow/route.ts#L175-L186)에서 세션 프로필 기반 `resolveViewerRumorAccess` 및 `sanitizeMarketFlowRecentNews` 적용 확인. (`scripts/test-reachable-security-fixes.ts` PASS)
- **`2026-11-19 F-01 ~ F-19` 회귀 확인**: `scripts/test-full-review-2026-11-19-fixes.ts` (`EXIT=0`)로 `commitGate`, `profileUserIdIndex`, `fee_booster`, `lp_liabilities`, `optionOrderService`, `NextAuth` JSON 보호 등 유지 확인.

---

## 5. 추측 및 미검증 사항 (Speculation & Unverified Items)

1. **`SU-01` [조건부 리스크] `MarketEngine` 비-LP 채권 봇 매수 현금 사전검증 `100x` 승수 누락**
   - **관찰 사실**: [MarketEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts#L1392-L1396), [L1436-L1444](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts#L1436-L1444), [L1594-L1597](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts#L1594-L1597)는 `marketState.stocks` 기준 `fx`만 곱해 봇 매수 현금을 사전 검증하고 `marketState.bonds`의 `quote_base` 100배 환산(`getBondQuoteMultiplierToKrw`)을 누락한다. `REPRO-6`에서 `processBatchOrders` 직접 호출 시 자본 부족(`50,000`원 < `100,250`원) 채권 봇 주문이 사전검증을 통과해 정산 단계 `PRE_VALIDATION_FAILED`로 전체 배치가 거부됨을 확인했다.
   - **유보 사유**: 기본 `BUILT_IN_PARTICIPANTS`(`MarketEngine.ts:48-64`) 및 기본 시드에 `PENSION_FUND`/`COMMERCIAL_BANK` 채권 봇이 포함되지 않아(`MarketEngine.ts:460, 473`), 커스텀 `bots_config`로 채권 봇을 투입하고 해당 봇 잔고가 한계에 도달한 경우에만 실제 틱에서 발현한다.
2. **`SU-02` `profileUserIdIndex` 우회 `profiles.get(userId)` 직접 조회 일관성**
   - **관찰 사실**: [app/api/local-db/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts#L77-L82)는 `profileUserIdIndex`를 경유하지만, [adminAuth.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/auth/adminAuth.ts#L50), [shop/purchase/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/shop/purchase/route.ts#L54), [commodityLedger.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/commodityLedger.ts#L71), [playerEventService.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/events/playerEventService.ts#L58)는 `profiles.get(userId)`를 직접 호출한다.
   - **미검증 사유**: 현재 NextAuth 로그인 및 게스트 계정은 `profile.id === user_id`로 생성되므로 정상 경로에서는 동일 키이나, `id !== user_id`인 레거시/수동 스냅샷 유입 시 404 또는 관리자 인식 누락 가능성이 있다.
3. **`SU-03` 뉴스 구독의 글로벌(`canReadRumor`) vs 언론사별(`outlet`) 정책 차이**
   - [accessPolicy.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/news/accessPolicy.ts#L16-L42)와 [app/news/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/news/page.tsx#L133) 모두 현재 "만료되지 않은 언론사 구독 1건 이상 보유 시 전체 `RUMOR` 열람 허용"으로 동작이 일치한다. 다만 상점(`MEDIA_OUTLETS`)이 언론사별 구독을 판매하므로 언론사 단위 권한 제한이 요구된다면 정책 정비가 필요하다.
4. **`SU-04` 최신 소스 기준 라이브 `.next` 빌드/SSR 및 실브라우저 OAuth E2E 미실측**
   - `.next/BUILD_ID`(`ZPbJhT3GqVusCk1Ty3LG8`)의 생성 시각(`2026-11-19 16:46:56`)이 금일 `local-db`/`market-flow` 수정(`2026-11-20 10:50:09`) 이전이며 읽기 전용 제약으로 `next build`를 수행하지 않았다. 따라서 최신 코드 기준 라이브 브라우저 DOM 렌더링·Google OAuth 실제 쿠키 로그인 흐름은 미검증 상태이다.
5. **`SU-05` 레거시 원격 PostgreSQL(`49.247.136.231:3001`) 트랜잭션 검증**
   - `scripts/settlement/run_settlement_verification.ts` 실행 시 원격 DB 비도달로 인해 자동으로 `In-Memory Verification Mode`로 폴백 통과했으며, `archive/legacy-postgres/` 원격 DB 실트랜잭션은 미검증이다.

---

## 6. 검증 명령 및 실행 결과

모든 테스트는 실제 `.data`·운영 서버와 분리된 임시 `STOCKSYS_DATA_DIR` 환경에서 실행했다.

| 구분 | 실행 명령 | 결과 | 비고 |
|---|---|---|---|
| 루트 TypeScript | `npx tsc --noEmit` | PASS (`exit 0`) | 컴파일 오류 없음 |
| 엔진 TypeScript | `Push-Location engine-server; npx tsc --noEmit; Pop-Location` | PASS (`exit 0`) | 컴파일 오류 없음 |
| ESLint | `npm run lint` | PASS (`exit 0`) | `0 errors, 149 warnings` |
| 금일 보안 패치 (`RR-01`, `RR-02`) | `node --import tsx scripts/test-reachable-security-fixes.ts` | PASS (`exit 0`) | `accessPolicy`, `/api/local-db`, `/api/market-flow` 5역할 검증 통과 |
| 전일 전면 리뷰 회귀 (`F-01`~`F-19`) | `node --import tsx scripts/test-full-review-2026-11-19-fixes.ts` | PASS (`exit 0`) | 전체 회귀 통과 |
| 라우트 핸들러 E2E | `node --import tsx scripts/test-route-handlers-e2e.ts` | PASS (`exit 0`) | TEST 1~9 전체 통과 |
| NextAuth HTTP 통합 | `node --import tsx scripts/test-nextauth-http-integration.ts` | PASS (`exit 0`) | 6개 HTTP 통합 테스트 통과(`.next` 포트 `3098`) |
| 환경변수·스키마 점검 | `node --import tsx scripts/verify-env-alignment.ts`; `verify-schema-diff.ts` | PASS (`exit 0`) | Standalone 기준 통과 / 레거시 DDL 차이 8건(비활성 안내 출력) |
| Phase 1 통합 스위트 | `node --import tsx scripts/test-phase1-suite.ts` | PASS (`exit 0`) | DB 격리, 결정성, 정산 무결성, 전략 주문 등 통과 |
| 정산 스위트 v2 | `node --import tsx scripts/settlement/run_settlement_verification.ts` | PASS (`exit 0`) | 원격 DB 비도달 → In-Memory 모드로 STEP 1~3 통과 |
| 주문 보안·원자성 / 리스크·정산 | `test-order-security-and-atomic.ts`; `test-order-risk-and-settlement.ts` | PASS (`exit 0`) | TEST 1~14 및 TEST A~N 통과 |
| Phase 2~4 / 크로스애셋 / 흐름 / AI 회귀 | `test-phase2-bot-portfolio-authority.ts`, `test-phase2-option-expiry-failclosed.ts`, `test-phase2-order-settlement-concurrency.ts`, `test-phase3-full-runtime-deterministic-rollback.ts`, `test-phase3-authoritative-derivatives-settlement.ts`, `test-phase3-admin-scenario-engine-integration.ts`, `test-phase4-engine-cas-concurrency.ts`, `test-phase4-mid-write-rollback.ts`, `test-phase4-post-commit-split-brain.ts`, `test-phase4-derivatives-validation.ts`, `test-phase4-lp-metadata-forgery.ts`, `test-cross-asset-full-suite.ts`, `test-market-flow-verification.ts`, `test-orderbook-and-news-integrity.ts`, `test-regression-settlement-auth-ai.ts` | ALL PASS (`exit 0`) | 전 항목 격리 환경 통과 |
| 임시 결함 재현 (`%TEMP%`) | `repro_2026_11_20_v2.ts` & `repro_56_v4.ts` (실행 후 삭제 완료) | 재현 성공 (`EXIT=0`) | `REPRO-1A/1B`, `REPRO-2`~`7` 실측 근거 확보 |
