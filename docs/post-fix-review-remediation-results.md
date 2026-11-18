# 독립 재리뷰 발견 사항(`docs/post-fix-full-review-findings.md`) 수정 결과 보고서

- **기준 문서**: [post-fix-full-review-findings.md](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/docs/post-fix-full-review-findings.md)
- **검증 원칙**: 모든 테스트와 프로덕션 HTTP 스모크 점검은 격리된 임시 `STOCKSYS_DATA_DIR`에서만 수행 후 삭제하여 기존 `.data` 및 원격 DB를 변경하지 않음.

---

## 1. 항목별 수정 내역 및 상세 근거

### P1-1. 옵션 매수 상대방 수수료 및 계좌별 누적 체결·예약 검증 누락

- **해결 상태**: **해결 완료**
- **수정 파일 및 위치**:
  - [optionOrderService.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/options/optionOrderService.ts#L242-L366)
- **수정 내용**:
  - 매칭된 각 `fill`에 대해 `fillNotional` 및 매수측 수수료 `fillBuyerFee`를 계산하고, 신규 주문 매수 시 `totalFillBuyerFeeKrw`와 잔여 대기 주문 예상 수수료(`restingFeeKrw`)를 함께 합산하여 주문자 필요 현금(`requiredCash`)을 검증하도록 수정.
  - `cpCumulativeBuyCash`(`Map<string, number>`)와 `cpCumulativeSellQty`(`Map<string, number>`)를 도입해 동일 상대방 계좌가 복수의 휴면 주문과 연속 체결될 때 누적 매수 필요액(`fillNotional + fillBuyerFee`)과 누적 매도 가능 수량을 보유 현금(`getAvailableCashKrw` + 현재 체결로 해제되는 기존 예약금 합산) 및 보유 계약 수량과 원자적으로 사전 검증하여 초과 시 어떤 변이도 없이 `400` 반환.
- **검증 근거**: `scripts/test-post-fix-remediation.ts` [P1-1a], [P1-1b] (`exit 0`) — 정확히 명목가만 보유한 매수자 및 복수 주문 겹침 시 마이너스 예수금 원천 차단 확인.

---

### P1-2. `engine-server` `MarketEngine.tick()` 영속 저장 실패 시 Split-Brain(`COMMITTED` + `PERSISTENCE_FAILED`) 및 비거래 상태 미저장

- **해결 상태**: **해결 완료**
- **수정 파일 및 위치**:
  - [MarketEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts#L632-L1029), [MarketEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts#L1798-L2093)
  - [SettlementBatchService.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/SettlementBatchService.ts#L148-L152)
  - [index.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/index.ts#L29-L36)
- **수정 내용**:
  - `MarketEngine.tick()` 진입 시 `onTickCommitPersist`가 존재하면 `inMemoryDb.exportRollbackSnapshot()`, 원자재 런타임, `SettlementBatchService.lastRunPeriodKey`(`restoreLastRunPeriodKey`), 봇 포트폴리오, 틱 카운터 및 PRNG 시퀀스를 백업하고, `onTickCommitPersist`가 `false`를 반환하거나 예외를 던지면 `rollbackAll()`으로 DB 및 엔진 런타임 상태를 틱 이전으로 완전 복원한 뒤 `{ success: false, commitStatus: 'NOT_COMMITTED', errorCode: 'PERSISTENCE_FAILED' }`를 반환하도록 수정.
  - `executionObserver.onSettlementCommitted` 호출을 영속 저장 성공(`onTickCommitPersist` 통과) 이후로 이동하여 미커밋 체결 이벤트의 외부 공개(Split-Brain) 차단.
  - `hasPersistentStateChanges` 플래그를 추가하여 체결 외 옵션 만기 정산, 채권 쿠폰, 환율, 봇 현금/포트폴리오, 랜덤 이벤트, 원자재 가격 변화 등 영구 상태 변경이 있는 경우에도 `engine-server/src/index.ts`가 즉시 저장(`if (hadTrades || hasPersistentStateChanges || tickCount % 20 === 0)`)하도록 수정(변화 없는 공회전 틱의 불필요한 디스크/WAL 쓰기 방지 유지).
- **검증 근거**: `scripts/test-post-fix-remediation.ts` [P1-2a]~[P1-2c], `scripts/test-phase2-engine-tick-rollback-id.ts`, `scripts/test-phase3-full-runtime-deterministic-rollback.ts`, `scripts/test-phase4-post-commit-split-brain.ts` (모두 `exit 0`).

---

### P2-1. 구형 스냅샷 복원(`importSnapshot`) 시 신설 ETF(12종) 및 미래 만기 옵션 월물 미보충

- **해결 상태**: **해결 완료**
- **수정 파일 및 위치**:
  - [memoryStore.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts#L780-L880), [memoryStore.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts#L1497-L1795)
- **수정 내용**:
  - `supplementMissingCatalogStocks()`와 `supplementFutureOptionContracts()`를 구현하여, 기존 잔고·주문·가격 및 과거 만기 옵션 계약의 `expiry_date`를 임의로 변경하지 않고 누락된 카탈로그 종목/ETF만 비파괴 보충하며 유효한 미래 월물이 3개 미만일 때 기존 만기 ID 접두사(`opt_k200_${yymm}_`)와 충돌하지 않는 미래 월물을 탐색해 시드하도록 수정.
  - 부팅/마이그레이션용 `importSnapshot(data, { migrateCatalog = true })`와 달리, 트랜잭션 실패 복구용 `exportRollbackSnapshot()` / `restoreRollbackSnapshot(data)`를 분리해 롤백 시에는 카탈로그 보충이나 `tradeEpoch` 증가 없이 순수 상태만 정확히 복원하도록 격리.
- **검증 근거**: `scripts/test-post-fix-remediation.ts` [P2-1a]~[P2-1b] (`exit 0`).

---

### P2-2. `trimSettlementLedger` 비순차 삽입 시 워터마크 과상승 및 `opt_settle_*`/`bond_*` 무제한 누적

- **해결 상태**: **해결 완료**
- **수정 파일 및 위치**:
  - [memoryStore.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts#L364-L372), [memoryStore.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts#L1143-L1435)
- **수정 내용**:
  - `recordContiguousSeq()`와 `isContiguousSeqSettled()`로 연속(contiguous) 확인된 시퀀스까지만 워터마크를 전진시키고 비순차 선행 시퀀스는 병합 구간(`settledEpochIntervals`, `settledOptionEpochIntervals`, `settledDeterministicIntervals`, `commoditySettledEpochIntervals`)에 유지하여 뒤집힌 순서로 삽입·퇴거돼도 미처리 거래가 기처리로 오인되지 않도록 수정.
  - 채권 원금 상환(`settledBondRedemptions`), 채권 쿠폰(`YYYY-MM` 연속 구간 압축), 옵션 만기 정산 키(`settledOptionExpiryKeys` + `compactSettledOptionExpiryKeys()`)를 `evictedCustomTradeIds`에서 분리하여 재시작·트리밍 이후에도 중복 지급을 차단하면서 메모리 무한 증가를 방지.
- **검증 근거**: `scripts/test-post-fix-remediation.ts` [P2-2a]~[P2-2c] (`exit 0`), `scripts/test-codex-review-16-fixes.ts` (`exit 0`).

---

### P2-3. 주식/ETF 사전 매수 검증(`validateOrderCapacity`) 및 예약 현금의 테이커 수수료(`0.25%`) 누락

- **해결 상태**: **해결 완료**
- **수정 파일 및 위치**:
  - [orderRisk.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/orderRisk.ts#L8-L95), [orderRisk.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/orderRisk.ts#L186-L235)
  - [dbMatching.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/dbMatching.ts#L220-L310)
  - [marketObservation.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/marketObservation.ts#L9-L55), [marketObservation.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/marketObservation.ts#L261-L286)
  - [lpStrategy.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/strategies/lpStrategy.ts#L34-L185)
  - [agentManager.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/agentManager.ts#L645-L655), [agentManager.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/agentManager.ts#L1120-L1135), [agentManager.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/simulation/agentManager.ts#L2340-L2352)
- **수정 내용**:
  - `STOCK_TAKER_FEE_RATE = 0.0025`를 `calculateSingleBuyOrderReservedCash`, `calculateReservedCash`, `calculateUserReservedCashKrw`, `validateOrderCapacity`에 일관 적용하여 정산 엔진(`bulk_settle_trades` / `commitMatchedBatchAtomically`)의 최대 필요 현금과 일치시킴.
  - ABM 시뮬레이션(`marketObservation.ts`, `lpStrategy.ts`, `agentManager.ts`)의 예약 현금·가용 예산 계산에도 `optionsContracts` 및 `CurrencyReservationContext`(`stocks`, `exchangeRates`)를 전달해 엔진 매칭 규칙과 일치시킴.
- **검증 근거**: `scripts/test-post-fix-remediation.ts` [P2-3], `scripts/test-order-risk-and-settlement.ts` (0.25% 수수료 불변식으로 갱신 후 `exit 0`), `scripts/test-stage2-review-fixes-v2.ts` (`exit 0`).

---

### P2-4. `ActiveOrdersPanel` 일괄 취소(`.in('id', ...)`)와 `/api/local-db` 필터 불일치

- **해결 상태**: **해결 완료**
- **수정 파일 및 위치**:
  - [marketService.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/marketService.ts#L221-L320)
  - [route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts#L490-L512)
  - [ActiveOrdersPanel.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/ActiveOrdersPanel.tsx#L123-L148)
- **수정 내용**:
  - `LocalMarketService.cancelOrdersBatch`를 추가해 대상 주문들의 종목 락(`withAllStockLocks`) 및 커밋 게이트(`runWithCommitGate`) 내부에서 타인 주문 포함 여부(소유권 검증 `403`), 미존재(`404`) 등을 검사한 뒤 일괄 취소 및 영속 저장을 원자적으로 수행(저장 실패 시 롤백).
  - `/api/local-db` `POST` `orders` update 분기에서 `f.col === 'id' && f.op === 'in'` 배열 필터와 세션 `user_id` 검증을 처리해 `cancelOrdersBatch`로 연결.
- **검증 근거**: `scripts/test-post-fix-remediation.ts` [P2-4], `scripts/test-route-handlers-e2e.ts` [TEST 9] (`exit 0`).

---

### P2-5. UI-서버 간 단위·데이터·엔드포인트 단절

#### P2-5.1 USD 종목/ETF 정산 통화·환율 통일 및 `/etf` 서버 시세 연동
- **해결 상태**: **해결 완료**
- **수정 파일 및 위치**:
  - [currency.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/currency.ts#L1-L73)
  - [etfDefinitions.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/etfDefinitions.ts#L11-L25)
  - [format.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/format.ts)
  - [memoryDbClient.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryDbClient.ts#L533-L615)
  - [InMemorySettlementRepository.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts#L905-L1070)
  - [app/etf/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/etf/page.tsx#L27-L320), [ETFItemCard.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/ETFItemCard.tsx), [ETFMonitorWidget.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/ETFMonitorWidget.tsx), [ETFStructureCard.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/ETFStructureCard.tsx), [ETFUserUnderlyingHoldings.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/ETFUserUnderlyingHoldings.tsx)
  - [OrderEntry.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OrderEntry.tsx#L21-L286), [ActiveOrdersPanel.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/ActiveOrdersPanel.tsx), [TradeNotifier.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/TradeNotifier.tsx), [PriceTag.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/PriceTag.tsx), [RealtimePriceHeader.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/RealtimePriceHeader.tsx), [StockTable.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/StockTable.tsx), [MoverCard.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/MoverCard.tsx), [StockDetailClient.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/stocks/[id]/StockDetailClient.tsx)
- **수정 내용**:
  - 브라우저 번들 안전한 순수 통화 헬퍼 `lib/engine/currency.ts`와 `isUsdEtf`를 구현하고, `bulk_settle_trades`·`commitMatchedBatchAtomically`·`calculateSingleBuyOrderReservedCash`·`dbMatching`에서 USD 종목 및 미국형 ETF(`SPY`, `QQQ`, `TQQQ`, `TSLL`, `NVDL`, `EWJ`, `FXI` 등) 체결/예약 시 서버 DB `exchangeRates` 기반 원화 환율(`1380` 등)을 곱해 `profile.cash`(KRW)에 반영(`TradeRecord.price`와 `holding.avg_price`는 호가 통화 보존).
  - `app/etf/page.tsx`의 클라이언트 임의 `Math.random()` 가격 시뮬레이션 루프를 제거하고 `stocks` 및 `exchange_rates` 테이블 실측 폴링에 연결했으며, 주문 패널에 원화 환산 예상액 및 `0.25%` 수수료를 표시.
- **검증 근거**: `scripts/test-post-fix-remediation.ts` [P2-5.1], `npm run build` (`exit 0`), `/etf` HTTP 200.

#### P2-5.2 원자재 `reduce-only` UI 예외·동적 환율·주문 취소 API 및 전용 미체결 패널
- **해결 상태**: **해결 완료**
- **수정 파일 및 위치**:
  - [commodityLedger.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/commodityLedger.ts#L535-L625)
  - [app/api/commodities/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/commodities/route.ts#L48-L95), [app/api/commodities/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/commodities/route.ts#L216-L245)
  - [CommodityOrderEntry.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityOrderEntry.tsx#L24-L260)
  - [CommodityActiveOrdersPanel.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityActiveOrdersPanel.tsx#L1-L160)
  - [CommodityDetailClient.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/commodities/[id]/CommodityDetailClient.tsx#L15-L260)
- **수정 내용**:
  - `/api/commodities` `GET`에 동적 `usdToKrwRate`, `myOrders`, `myPosition`, `availableCashKrw`를 포함하고 `POST`에 `cancel_order` / `cancel_all_orders` 액션을 추가(`cancelCommodityOrders`: 계좌 락 + `runWithCommitGate` 하에 증거금 환불 및 실패 시 롤백).
  - `CommodityOrderEntry.tsx`에서 `1350` 하드코딩을 제거하고 서버 환율을 사용하며, 기존 보유 포지션 범위 내 반대방향(`reduce-only`) 주문은 증거금 부족 검사를 면제하도록 수정.
  - `CommodityDetailClient.tsx` 미체결 탭을 주식 패널 대신 신설 `CommodityActiveOrdersPanel`로 교체.
- **검증 근거**: `scripts/test-route-handlers-e2e.ts` [TEST 8] (`exit 0`), `/api/commodities` 프로덕션 `GET` 200(`rate: 1380`).

#### P2-5.3 마이페이지 옵션 종목명·승수(`250,000`) 및 USD 주식 원화 환산 평가
- **해결 상태**: **해결 완료**
- **수정 파일 및 위치**:
  - [app/mypage/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/mypage/page.tsx#L45-L120)
- **수정 내용**:
  - `options_contracts`와 `exchange_rates`를 함께 조회하여 옵션 포지션을 `"알 수 없는 종목"` 대신 실제 계약명/티커/유형/행사가/승수(`250,000`)와 `/options` 링크로 렌더링하고, USD 종목/ETF 평가액을 원화 환산해 총 자산 요약에 합산하도록 수정.
- **검증 근거**: `npm run build` (`exit 0`), `/mypage` SSR HTTP 200.

#### P2-5.4 구형 `OptionsPanel.tsx` 존재하지 않는 RPC 제거 및 다리별 부분 성공 정확 보고
- **해결 상태**: **해결 완료**
- **수정 파일 및 위치**:
  - [OptionsPanel.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionsPanel.tsx#L110-L200)
- **수정 내용**:
  - 미존재 `execute_option_order` / `execute_rollover_combo` RPC 호출을 실제 지원 엔드포인트 `POST /api/options/order`로 교체.
  - 롤오버 2개 다리(기존 청산 + 차월물 진입) 실행 시 1번 다리만 성공하고 2번 다리가 실패하면 전체 콤보 성공으로 보고하지 않고 부분 체결/실패 상세 메시지를 그대로 보고하도록 수정.
- **검증 근거**: `npm run build` / `tsc --noEmit` (`exit 0`). (구형 컴포넌트 UI 브라우저 클릭 E2E는 미실행)

#### P2-5.5 `HttpMemoryClient.rpc` 및 `HttpQueryBuilder.execute` JSON 오류 메시지 보존
- **해결 상태**: **해결 완료**
- **수정 파일 및 위치**:
  - [client.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/db/client.ts#L114-L185)
- **수정 내용**:
  - `!res.ok` 응답 시 본문을 읽어 JSON의 `error.message` / `message` / `error`를 파싱해 `error.message`로 보존하도록 수정.
- **검증 근거**: `scripts/test-post-fix-remediation.ts` [P2-5.5] (`exit 0`).

---

### P2-6. 동시성·저장 경계·인덱스 정합성 국소 결함 5건

- **해결 상태**: **해결 완료**
- **수정 파일 및 위치**:
  - `P2-6.1` [CommodityMarketEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/CommodityMarketEngine.ts#L72), [CommodityMarketEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/CommodityMarketEngine.ts#L515-L601): `reconcileWithDatabase`가 공유 `reconcilePromise`를 대기하고 내부 tick/account lock 획득 후 복구 완료 시점에만 `reconciled = true`를 설정하며, 실패 시 `reconcilePromise = null`로 초기화해 재시도 가능하도록 수정. 또한 `db.commodities` 저장 시세가 있으면 재시작 시 가격을 복원.
  - `P2-6.2` [CommodityMarketEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/CommodityMarketEngine.ts#L400-L470), [CommodityMarketEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/CommodityMarketEngine.ts#L629-L725), [CommodityBot.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/bots/CommodityBot.ts#L174-L200): `stepTickAsync`에서 틱 가격 변동을 `db.commodities`에 동기화(`syncPricesToDatabase`)하고 `userMutations > 0 || dbPricesSynced`일 때 영속 저장(`onPersist`), 저장 실패 시 엔진 런타임 및 DB 상품 상태를 롤백하도록 수정.
  - `P2-6.3` [InMemoryMarketRepository.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemoryMarketRepository.ts#L231-L240): `deleteOrders`에서 주문 삭제 시 `this.db.removeOrderFromIndex(ord)`를 호출하여 `orderStockIndex`·`orderUserIndex` 누수 제거.
  - `P2-6.4` [localStandaloneServer.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts#L172-L225): 20틱 주기 주문 정리, `trim_old_market_data`, `trimSettlementLedger`를 `withAllStockLocks` → `runWithCommitGate` 경계 내부로 이동하고 전체 락 중첩 순서(`stockLocks -> accountLocks -> commitGate`) 일관성 점검.
  - `P2-6.5` [app/api/local-db/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts#L268-L276), [app/api/local-db/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts#L368-L378): `profiles` 및 뉴스 `SELECT` 경로에서 원본 `profile`을 락 없이 변이시키지 않고 shallow copy(`{ ...profile }`)에 `pruneExpiredProfileEntitlements`를 적용하도록 수정(만료 정리는 쓰기 트랜잭션에만 위임).
- **검증 근거**: `scripts/test-post-fix-remediation.ts` [P2-6.1]~[P2-6.5] (`exit 0`), `scripts/test-stage2-review-fixes-v2.ts` (`exit 0`).

---

### P3-1. `app/news/page.tsx` 미존재 `premium_news` 조회 제거·구독 서버 검증 및 `test-route-handlers-e2e.ts` 복구

- **해결 상태**: **해결 완료**
- **수정 파일 및 위치**:
  - [app/api/local-db/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts#L47-L66), [app/api/local-db/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts#L267-L284)
  - [app/news/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/news/page.tsx#L38-L160)
  - [test-route-handlers-e2e.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/scripts/test-route-handlers-e2e.ts#L1-L342)
- **수정 내용**:
  - `/api/local-db`의 공개 뉴스 테이블(`market_news`, `news`, `news_v2`) `SELECT`에서 세션 사용자의 `is_admin` 또는 만료되지 않은 `news_subscriptions` 권한을 서버에서 검증(`authorizeNewsRecord`)해, 미구독 요청에는 `RUMOR` 기사의 본문을 마스킹하고 `locked: true`를 반환.
  - `app/news/page.tsx`에서 존재하지 않는 `premium_news` 쿼리를 제거하고 `profile.news_subscriptions` 만료 여부 및 서버 `locked` 플래그를 기준으로 프리미엄 구독 상태를 표시·갱신하도록 수정.
  - `scripts/test-route-handlers-e2e.ts`에 `ensureLocalStandaloneReady()` 초기화 및 `STOCKSYS_DATA_DIR` 격리를 적용해 단독 실행 실패를 수정하고, USD ETF 주문 정산/배치 취소/원자재 취소/뉴스 찌라시 서버 마스킹 검증 테스트([TEST 6]~[TEST 9])를 추가.
- **검증 근거**: `scripts/test-post-fix-remediation.ts` [P3-1], `scripts/test-route-handlers-e2e.ts` (`exit 0`), 프로덕션 `/news` HTTP 200.

---

## 2. 이전 16건 중 "부분 해결" 7건 재판정 결과

| 기존 # | 항목 | 최종 판정 | 비고 |
| :-: | :--- | :---: | :--- |
| #3 | `accountLocks` 잠금·원자재 재조정 경합 | **해결** | `reconcileWithDatabase` 공유 Promise 및 재시도·락 경계 완료 |
| #5 | 가용 현금·사전 검증·옵션 상대방 수수료/누적 | **해결** | `P1-1` + `P2-3` 수정으로 옵션/주식/ETF 전 경로 정렬 |
| #7 | `settlementLedger` 워터마크·정산 키 상한 | **해결** | `P2-2` 연속 워터마크·구간 병합 및 옵션/채권 키 분리 완료 |
| #8 | `MarketEngine.tick()` 저장·롤백 경계 | **해결** | `P1-2` `NOT_COMMITTED` 롤백 및 비거래 영구 상태 즉시 저장 완료 |
| #11 | 원자재 `reduce-only` UI·환율·취소 API | **해결** | `P2-5.2` UI 차단 제거·동적 환율·원자재 취소 API/패널 구현 |
| #13 | 구형 스냅샷 복원 시 미래 옵션 월물 공급 | **해결** | `P2-1` 비파괴 미래 월물 보충 및 롤백 스냅샷 구분 완료 |
| #14 | 구형 스냅샷 신설 ETF 보충 및 `/etf` 서버 시세·통화 | **해결** | `P2-1` + `P2-5.1` 카탈로그 보충 및 서버 시세/USD 정산 연결 |

---

## 3. 최종 검증 실행 명령 및 결과 (최종 수정 후 재실행)

모든 명령은 최종 코드 수정 이후 격리된 임시 `STOCKSYS_DATA_DIR` 환경에서 실행되었으며, 실행 후 임시 디렉터리를 삭제했다.

| 구분 | 실행 명령 | Exit Code | 결과 요약 |
| :--- | :--- | :---: | :--- |
| 루트 타입 검사 | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | `0` | 오류 없음 (`ROOT_TSC=0`) |
| 엔진 타입 검사 | `node node_modules/typescript/bin/tsc -p engine-server/tsconfig.json --noEmit` | `0` | 오류 없음 (`ENGINE_TSC=0`) |
| Next 프로덕션 빌드 | `npm run build` (`STOCKSYS_DATA_DIR=<tmp>`) | `0` | 28개 라우트 컴파일·생성 완료 (`NEXT_BUILD_EXIT=0`) |
| 신규 재리뷰 회귀 | `npx tsx scripts/test-post-fix-remediation.ts` | `0` | P1-1~2, P2-1~6, P3-1 전 항목 불변식·롤백·재시도 통과 |
| 기존 16건 회귀 | `npx tsx scripts/test-codex-review-16-fixes.ts` | `0` | 전 항목 통과 |
| 기존 수정 검증 | `npx tsx scripts/test-review-fixes-verification.ts` | `0` | 전 항목 통과 |
| 후속 A-F 검증 | `npx tsx scripts/test-followup-a-to-f.ts` | `0` | 전 항목 통과 |
| Phase 1 스위트 | `npx tsx scripts/test-phase1-suite.ts` | `0` | 9개 스위트 전체 통과 |
| Phase 2 (롤백/ID) | `npx tsx scripts/test-phase2-engine-tick-rollback-id.ts` | `0` | 통과 |
| Phase 2 (옵션 만기) | `npx tsx scripts/test-phase2-option-expiry-failclosed.ts` | `0` | 통과 |
| Phase 3 (결정론적 롤백) | `npx tsx scripts/test-phase3-full-runtime-deterministic-rollback.ts` | `0` | 통과 |
| Phase 4 (Split-Brain) | `npx tsx scripts/test-phase4-post-commit-split-brain.ts` | `0` | 통과 |
| 주문 리스크·정산 | `npx tsx scripts/test-order-risk-and-settlement.ts` | `0` | 0.25% 테이커 수수료 정책 반영 기대값 검증 포함 통과 |
| Stage 2 검증 | `npx tsx scripts/test-stage2-verification.ts` | `0` | 0.25% 테이커 수수료 정책 반영 기대값 검증 포함 통과 |
| Stage 2 v2 리뷰 | `npx tsx scripts/test-stage2-review-fixes-v2.ts` | `0` | Part 1~2(Case A~H, USD FX 반영 LP 예산) 전체 통과 |
| ABM 시장 시뮬레이션 | `npx tsx scripts/test-agent-based-market.ts` | `0` | 0.25% 테이커 수수료 반영 및 백그라운드 엔진 정상 종료 통과 |
| 라우트 핸들러 E2E | `npx tsx scripts/test-route-handlers-e2e.ts` | `0` | 기존 36행 실패 수정 및 TEST 1~9 전체 통과 |
| 프로덕션 HTTP 스모크 | `next start -p 3199` (`STOCKSYS_DATA_DIR=<tmp>`) | `0` | `/etf`, `/news`, `/mypage`, `/commodities/CRUDE_OIL` HTTP 200; `/api/commodities` 200 (`rate: 1380`); `SPY` USD 확인; 비인증 쓰기/계좌 라우트 401 fail-closed (`HTTP_PRODUCTION_SMOKE_OK=true`) |

---

## 4. 미검증 사항 및 잔여 위험

- **실제 브라우저(Playwright 등) DOM 렌더링/클릭 E2E**: 프로덕션 `next start` SSR(HTTP 200)과 라우트 핸들러 E2E(`test-route-handlers-e2e.ts`, `test-post-fix-remediation.ts`)는 실행했으나, 실제 브라우저에서 버튼 클릭(`ActiveOrdersPanel` 일괄 취소, `CommodityDetailClient` 청산/취소 탭, `OptionsPanel` 롤오버 클릭 등)을 통한 클라이언트 상태 갱신은 미실행.
- **실제 외부 Google OAuth 로그인 및 원격 PostgreSQL/Redis 운영 DB 연동**: 규칙에 따라 운영 VM/원격 DB 및 실제 OAuth 공급자 왕복은 수행하지 않음.
- **실제 별도 OS 프로세스 `SIGKILL` 및 디스크 풀(`ENOSPC`) 장애 주입**: `MarketEngine.tick()` 및 `CommodityMarketEngine` 영속 실패 콜백 예외 주입을 통한 인메모리 롤백은 단위/통합 테스트로 검증했으나, 실제 운영 프로세스 강제 종료 실험은 미실행.
- **`test-stage2-verification.ts`, `test-agent-based-market.ts`, `test-order-risk-and-settlement.ts` 구 기대값 조정**: 기존 0% 수수료 가정(또는 무제한 20억 KRW LP 현금 가정) 테스트 케이스를 현재 0.25% 테이커 수수료 및 USD/KRW FX 예약 정책에 맞춘 엄격한 수수료/예약 불변식 검증으로 갱신함.
