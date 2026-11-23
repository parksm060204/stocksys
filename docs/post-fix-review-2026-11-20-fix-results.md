# 2026-11-20 추가 오류(`AR-01`~`AR-04`) 수정 결과 보고서

- **원본 발견 보고서**: [post-fix-review-2026-11-20-findings.md](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/docs/post-fix-review-2026-11-20-findings.md) (원본 유지)
- **수행 기준일**: 2026-11-20
- **검증 환경**: 임시 격리 `STOCKSYS_DATA_DIR`, 주입 `MemoryDatabase` / `StaticTimeSource` / `SequentialIdGenerator` / 고정 `marketDataSource`

---

## 1. 항목별 수정 내역 및 제어 범위

| 항목 | 상태 | 수정 파일 | 구현된 실제 동작 |
|---|---|---|---|
| **AR-01** | 해결 | [MarketEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts), [marketRepository.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/marketRepository.ts), [InMemoryMarketRepository.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemoryMarketRepository.ts) | `MarketEngine.tick()` 및 `processBatchOrders()`가 커밋 게이트(`withTickLock` → `runWithTickCommitGate`) 내부에서 전역 싱글톤이 아닌 주입된 저장소의 `isAuthoritativeTradingHalted()`(`repositories.markets.isTradingHalted()` / `getDatabase().isTradingHalted()` / `getMarketSnapshot().adminSettings.trading_halt`)를 검사한다. `trading_halt === true`일 때는 대기 주문 체결, 신규 봇 주문 생성, LP 호가 갱신, `commodityEngine.nextTick()`, 랜덤 이벤트 발동을 차단하며, `tickCount % 20 === 0` 롤링 데이터 정리(`trimOldTrades()`)와 `tickCount % 50 === 0` 만기 정산/쿠폰 지급(`settlementService.runDailySettlementBatch()`) 의무 처리는 유지하고 영속 실패 시 전체 롤백(`rollbackAll()`)한다. |
| **AR-02** | 해결 | [dbMatching.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/dbMatching.ts), [optionOrderService.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/options/optionOrderService.ts), [commodityLedger.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/commodityLedger.ts), [route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/admin/scenarios/route.ts) | 주식(`submitAndMatchOrder`), 옵션(`submitAuthoritativeOptionOrder`), 원자재(`reserveMarginAndSubmitCommodityOrder`) 모두 계좌/종목/원자재 `tickLock`을 획득한 뒤 실제 변경을 직렬화하는 `runWithCommitGate(...)` 내부(`onPersist` 미전달 시에도 `persistenceManager` 커밋 게이트 참여)에서 `isTradingHalted()`를 재검사한다. 관리자 `set_trading_halt` 토글 또한 동일 `persistenceManager.withCommitGate` 경계에서 상태를 확정하므로, 잠금 대기 중 동결이 확정되면 대기 주문이 거절되고 현금·보유·주문·예약 장부가 불변이며 동결 전 먼저 커밋된 주문은 보존된다. |
| **AR-03** | 해결 | [memoryStore.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts), [ScenarioManager.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/scenario/ScenarioManager.ts), [localStandaloneServer.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts), [CommodityMarketEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/CommodityMarketEngine.ts), [route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/admin/scenarios/route.ts), [route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/commodities/route.ts) | `memoryDb.scenarioRuntimeState`를 단일 권위 스냅샷으로 삼고 `syncScenarioManagerFromDatabase()`로 동기화한다. `LocalMarketEngineInstance`는 `prepareActiveStockScenarios()`로 바이어스만 읽고 스텝 후 `commitStockScenarioStep()`이 `commitGate` 안에서 최신 `scenarioRuntimeState`를 복원해 `stepTick('stock')`과 영속/롤백을 수행한다. `CommodityMarketEngine.stepTickAsync()`는 `tickLock → accountLocks → commitGate` 안에서 최신 `scenarioRuntimeState`를 동기화해 `stepTick('commodity')` 후 저장·롤백한다. 관리자 `GET`/`POST`(`inject_scenario`, `trigger_macro_shock`, `rollback_scenario`, `emergency_halt`)는 `commitGate` 내부에서 동기화·변이·영속·롤백을 수행하여 `stockLock ↔ commodityTickLock` 역순 교착 없이 주식·원자재 양쪽 진행도와 완료 상태를 일관되게 보존한다. |
| **AR-04** | 해결 | [settlementRepository.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/settlementRepository.ts), [InMemorySettlementRepository.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts), [OptionSettlementEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/OptionSettlementEngine.ts), [SettlementBatchService.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/SettlementBatchService.ts), [localStandaloneServer.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts), [MarketEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts) | `InMemorySettlementRepository.getOpenOptionOrderAccountIds()` 및 `expireOrdersForExpiredOption()`를 추가하고, `OptionSettlementEngine.executeSettlementBatch()`에서 만기 도래 옵션 계약의 `open`/`partial` 매수·매도 주문을 보유 유무와 무관하게 `status = 'expired'`, `version` 증가, `remainingQuantity`/`remaining` 0, 인덱스 정합 유지 상태로 전환한다. `LocalMarketEngineInstance.runPeriodicSettlementBatch()`는 보유자와 주문자 계좌를 모두 `accountIds` 락 집합에 포함하고, 주문 스냅샷 롤백 및 `optionOrdersExpired > 0` 배치 영속 저장을 수행한다. `MarketEngine.tick()` 역시 `optionOrdersExpired > 0`을 영속 대상으로 반영하며, 동적 예약금(`calculateSingleBuyOrderReservedCash`)만 해제되고 현금은 이중 환급되지 않는다. |

### 제어 범위 명시 (AR-01)
- Next.js Standalone 런타임(`lib/memoryDb/memoryStore.ts` 싱글톤 `memoryDb`)과 독립 `engine-server`(`engine-server/src/index.ts`의 별도 `MemoryDatabase` 및 `.data/engine-server` 스냅샷)는 저장소 소유권이 분리되어 있다.
- 금번 AR-01 수정은 각 `MarketEngine` 인스턴스가 **자신에게 주입된 authoritative repository/MemoryDatabase의 `adminSettings.trading_halt`를 커밋 경계 안에서 준수**하도록 교정한 것이며, Next.js `/admin` UI 클릭을 별도 원격 `engine-server` 프로세스로 전파하는 원격 제어 채널은 새로 구축하지 않았다.

---

## 2. 검증 명령 및 Exit Code

신규 회귀 테스트: [test-post-fix-review-2026-11-20-fixes.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/scripts/test-post-fix-review-2026-11-20-fixes.ts) (`AR-01`~`AR-04` 실제 동작·잠금 경합 barrier·롤백/재시도 검증)

| 검증 항목 | 실행 명령 | Exit Code | 비고 |
|---|---|---|---|
| 신규 회귀 (`AR-01`~`AR-04`) | `node --import tsx scripts/test-post-fix-review-2026-11-20-fixes.ts` | `0` | 격리 `STOCKSYS_DATA_DIR`, 전 항목 통과 |
| 기존 F01~F10 회귀 | `node --import tsx scripts/test-full-review-2026-11-20-fixes.ts` | `0` | 격리 환경 통과 |
| 보안 회귀 (`RR-01`~`RR-02`) | `node --import tsx scripts/test-reachable-security-fixes.ts` | `0` | 통과 |
| 기존 11-19 회귀 | `node --import tsx scripts/test-full-review-2026-11-19-fixes.ts` | `0` | 통과 |
| 옵션 만기 fail-closed | `node --import tsx scripts/test-phase2-option-expiry-failclosed.ts` | `0` | 통과 |
| 주문·정산 동시성 | `node --import tsx scripts/test-phase2-order-settlement-concurrency.ts` | `0` | 통과 |
| 관리자-원자재 시나리오 연동 | `node --import tsx scripts/test-phase3-admin-scenario-engine-integration.ts` | `0` | 통과 |
| 원자재 시나리오 결정성 | `node --import tsx scripts/test-phase2-commodity-scenario-determinism.ts` | `0` | 통과 |
| 전체 런타임 결정성/롤백 | `node --import tsx scripts/test-phase3-full-runtime-deterministic-rollback.ts` | `0` | 통과 |
| 주문 위험 및 정산 | `node --import tsx scripts/test-order-risk-and-settlement.ts` | `0` | 통과 |
| 정산 엔진 단위 스위트 | `node --import tsx engine-server/src/settlement/test/runSettlementTests.ts` | `0` | 5개 테스트 통과 |
| 루트 TypeScript | `npx tsc --noEmit` | `0` | 오류 0건 |
| 엔진 TypeScript | `Push-Location engine-server; npx tsc --noEmit; Pop-Location` | `0` | 오류 0건 |
| ESLint | `npm run lint` | `0` | `0 errors, 151 warnings` |
| Next.js Production Build | `npm run build` | `0` | `.next` 프로덕션 빌드 성공 |

---

## 3. 검증 한계

1. **별도 원격 `engine-server` 프로세스 간 제어 전파 미구축**: 독립 `engine-server`와 Next.js Standalone은 각각 자신의 저장소를 사용하므로, Next.js `/admin`에서 변경한 `trading_halt`는 Standalone 저장소에만 즉시 반영되며 별도 프로세스인 `engine-server`에 대한 원격 동기화 API는 범위 외로 포함하지 않았다.
2. **실제 브라우저 DOM / 실계정 OAuth / 원격 PostgreSQL 미실측**: 모든 동적 검증은 임시 `STOCKSYS_DATA_DIR` 및 주입 `MemoryDatabase` 격리 환경에서 수행되었으며, 실제 브라우저 UI 인터랙션, 실계정 OAuth, 아카이브된 레거시 PostgreSQL 원격 DB는 실행하지 않았다.
3. **기존 작업본 미커밋 파일 보존**: 사전부터 작업 트리에 존재하던 미커밋 수정·문서 파일 및 `.data` 운영 스냅샷은 변경/초기화하지 않고 그대로 보존했다.
