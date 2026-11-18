# 수정 후 전체 코드 독립 리뷰 보고서

- **검토 기준 커밋**: `4c1b394927e5a09c6d639c1b1f377142d8bd1012` (`fix(trading): harden settlement persistence and connect account flows`)
- **참고 문서**: `docs/code-review-2026-11-17-codex.md`, `docs/codex-review-fixes-hydrogen-high-results.md`
- **검토 원칙**: 애플리케이션 코드·기존 테스트·설정을 수정하지 않고, 소스 코드 열람과 격리된 Node/tsx 프로세스(`STOCKSYS_DATA_DIR` 임시 디렉터리 및 격리 `MemoryDatabase`) 실행 결과만을 근거로 판정.

---

## 1. 검토 범위표

| 영역 | 직접 읽고 점검한 범위 | 비고 / 미점검 범위 |
| :--- | :--- | :--- |
| `app/api/**`, `app/auth/**` | `app/api/orders/route.ts`, `app/api/local-db/route.ts`, `app/api/options/order/route.ts`, `app/api/options/account/route.ts`, `app/api/commodities/route.ts`, `app/api/events/resolve/route.ts`, `app/api/shop/purchase/route.ts`, `app/api/auth/[...nextauth]/route.ts`, `app/api/admin/scenarios/route.ts`, `app/api/market-flow/route.ts`, `app/api/analyze/route.ts`, `app/auth/callback/route.ts` | 실제 외부 Google OAuth / Redis / 원격 DB 연동 미실행 |
| `lib/memoryDb/**`, `lib/repositories/**` | `memoryStore.ts`, `memoryDbClient.ts`, `memoryTransaction.ts`, `PersistenceManager.ts`, `StorageAdapter.ts`, `accountLocks.ts`, `InMemoryMarketRepository.ts`, `InMemorySettlementRepository.ts`(후반 정산·복구 구간) | `InMemorySettlementRepository.ts` 1~899행 상세 줄 단위 열람 미완료 |
| `lib/engine/**`, `engine-server/**` | `localDevMode.ts`, `localStandaloneServer.ts`, `marketService.ts`, `dbMatching.ts`, `orderRisk.ts`, `settlement.ts`, `simulation/agentManager.ts`(일부 구간 제외), `engine-server/src/{index,restartRuntime,MarketEngine}.ts`, `engine-server/src/settlement/*` | `engine-server/src/bots/*` 개별 봇 전략 내부, `agentManager.ts` 1201~1599행 미열람 |
| 파생·환전·상점·시나리오·인증 | `optionOrderService.ts`, `commodityLedger.ts`, `CommodityMarketEngine.ts`, `CommodityOrderBook.ts`, `CommodityBot.ts`, `eventSystem.ts`, `exchangeService.ts`, `playerEventService.ts`, `catalog.ts`, `ScenarioManager.ts`, `lib/auth/*`, `lib/db/*` | `lib/commodities/definitions.ts` 31행 이후 전체 마스터 목록 미열람 |
| `app/**` 및 클라이언트 훅 | `OptionAccountPanel.tsx`, `OptionHTSDashboard.tsx`, `OptionMonthChainGrid.tsx`, `OptionOrderEntry.tsx`, `app/etf/page.tsx`, `RandomEventModal.tsx`, `TradeNotifier.tsx`, `CommodityOrderEntry.tsx`, `app/shop/page.tsx`, `app/exchange/page.tsx`, `app/mypage/page.tsx`, `app/v2/exchange/page.tsx`, `app/v2/shop/page.tsx`, `app/v2/stocks/[id]/StockDetailV2Client.tsx`, `OrderEntry.tsx`, `ActiveOrdersPanel.tsx`, `app/news/page.tsx`, `app/options/page.tsx`, `CommodityDetailClient.tsx`, `StockDetailClient.tsx`, `OptionsPanel.tsx`, `useOrderbookData.ts`, `useOptionMarketData.ts`, `useStockBotSimulation.ts` | 미언급 v2 서브 컴포넌트·차트 UI 및 실제 브라우저 클릭 E2E 미실행 |
| 설정·문서 | `package.json`, `next.config.ts`, `proxy.ts`, `node_modules/next/dist/docs/01-app/01-getting-started/{15-route-handlers,16-proxy}.md` | 프로덕션 `next build` 및 실제 `engine-server` 프로세스 강제 종료 실험 미실행 |

---

## 2. 심각도별 발견 사항

### P1-1. [잔존/부분해결 — 기존 #5·#10 연관] 옵션 상대방 매수자 현금 검증의 수수료 누락 및 복수 체결 누적 미검증 → 매수자 잔고 음수화

- **위치**: [optionOrderService.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/options/optionOrderService.ts#L291-L301), [optionOrderService.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/options/optionOrderService.ts#L374-L381)
- **발생 조건**: 신규 옵션 `SELL` 주문(`submitAuthoritativeOptionOrder`)이 기존 휴면 매수 지정가 주문과 매칭될 때, 상대방 검증 루프(`292-301`행)가 각 `fill`에 대해 개별적으로 `cp.cash < fillNotional`만 검사함.
  1. 휴면 매수자에게 정산 시 실제로 부과되는 매수 수수료(`OPTION_FEE_RATE = 0.001`, `374-381`행)를 검증 금액에 합산하지 않음.
  2. 동일 상대방이 여러 휴면 주문에 걸쳐 2회 이상 체결될 때 누적 필요 현금을 합산하지 않고 매번 전체 `cp.cash`와 비교함.
- **관측 결과 / 기대 결과**:
  - **관측 (`[1a]`)**: 승수 `250,000`, 가격 `2.0`(명목가 `500,000`원) 계약에 정확히 `cash = 500,000`인 휴면 매수자의 지정가 매수 1계약이 매도 주문과 체결됨 → `{ success: true, statusCode: 200, filledQty: 1, buyerCash: -500 }`.
  - **관측 (`[1b]`)**: `cash = 600,000`인 동일 매수자가 `2.0`원 1계약 BUY 주문 2건을 보유한 상태에서 매도 2계약 체결 → 각 fill(`500,000 <= 600,000`)이 개별 통과해 2건 모두 체결되고 `{ success: true, statusCode: 200, filledQty: 2, buyerCash: -401000 }`.
  - **기대**: 상대방 매수자의 누적 `fillNotional + buyerFee`가 `cp.cash`를 초과하면 체결을 차단(400)하여 잔고가 음수가 되지 않아야 함.
- **영향**: 휴면 매수 주문이 자기 보유 현금이나 다른 주문과 겹쳐 체결될 때 마이너스 예수금이 발생하여 무담보 포지션이 생성됨.
- **최소 재현**: 격리 `MemoryDatabase`에서 옵션 `current_price = 1.0`(LP 매수가 ~0.98 < 2.0)으로 둔 뒤, 매수자의 `open` BUY 지정가(`price: 2.0`) 1건(또는 2건)에 `submitAuthoritativeOptionOrder(..., side: 'SELL')` 실행.
- **수정 방향**: `fills` 순회 시 `Map<string, number>`로 상대방별 누적 `fillNotional + buyerFee`를 합산해 `cp.cash` 및 예약 일관성을 1회 검증하도록 수정.

---

### P1-2. [신규] `engine-server` `MarketEngine.tick()` 영속 저장 실패 시 인메모리 롤백 없는 Split-Brain (`COMMITTED` + `PERSISTENCE_FAILED`)

- **위치**: [MarketEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts#L865-L898), [index.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/index.ts#L32-L34)
- **발생 조건**: `MarketEngine.tick()`이 `processBatchOrders`에서 `memoryDb`의 체결·잔고·보유수량을 이미 변경한 뒤, 마지막 단계(`866-898`행)에서 `onTickCommitPersist`를 호출함. 영속 저장이 `false`를 반환하거나 예외를 던지면 인메모리 상태를 롤백하지 않고 `{ success: false, commitStatus: 'COMMITTED', tickCount, errorCode: 'PERSISTENCE_FAILED' }`를 반환함. 또한 [index.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/index.ts#L32-L34)는 `if (hadTrades || tickCount % 20 === 0)`일 때만 저장하여, 거래 없는 중간 틱의 옵션 만기·채권 쿠폰·가격·봇 상태 변경은 디스크 저장이 지연됨.
- **관측 결과 / 기대 결과**:
  - **관측 (`[6]`)**: 교차 지정가 주문 1쌍(`10주`)이 존재하는 `MarketEngine`에 `onTickCommitPersist: async () => false` 주입 후 `await eng.tick()` 호출 → `{ tickRes: { success: false, commitStatus: "COMMITTED", tickCount: 1, errorCode: "PERSISTENCE_FAILED", ... }, tradesDelta: 1, buyerCashDelta: -719280 }`.
  - **기대**: 영속 저장 실패가 에러로 보고된다면 인메모리 상태 역시 롤백(`NOT_COMMITTED`)되거나, 반대로 영속 저장 완료 전에는 커밋되지 않아 메모리-디스크 불일치가 없어야 함.
- **영향**: 영속 저장 장애 시 API/메모리에는 체결·차감이 반영되지만 디스크 스냅샷에는 기록되지 않아, 엔진 재시작 시 체결·잔고 변화가 소실됨.
- **최소 재현**: 격리 `MemoryDatabase`에 매수·매도 교차 `open` 주문 2건을 넣고 `new MarketEngine({ repositories, onTickCommitPersist: async () => false }).tick()` 실행.
- **수정 방향**: 틱 단위 실행 전 스냅샷/보상 경계를 두고 `onTickCommitPersist` 실패 시 `memoryDb`·엔진 상태(`tickCount`, `partialFillSequence`)를 원복한 뒤 `commitStatus: 'NOT_COMMITTED'`를 반환하고, 비거래 상태 변경(옵션 만기/채권 쿠폰 등)도 저장 대상에 포함.

---

### P2-1. [잔존/부분해결 — 기존 #13·#14] 기존 스냅샷 복원(`importSnapshot`) 시 신설 ETF(12종) 및 미래 만기 옵션 월물 미공급

- **위치**: [memoryStore.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts#L1200-L1351)
- **발생 조건**: `MemoryDatabase` 생성자는 `seedDefaultData()`를 호출하지만, 이어서 `PersistenceManager`가 기존 `.data` 스냅샷으로 `importSnapshot(data)`를 호출하면 `this.stocks = new Map(data.stocks)`와 `this.optionsContracts = ...`로 전체 맵을 교체함.
- **관측 결과 / 기대 결과**:
  - **관측 (`[2]`)**: 기존 스냅샷에서 `KODEXSEMI`를 제거하고 모든 옵션 계약의 `expiry_date`를 과거로 설정한 뒤 `restored.importSnapshot(snap)` 호출 → `{ unexpiredOpts: 0, hasKodexSemi: false }`.
  - **기대**: 기존 계약의 만기는 임의 연장하지 않으면서도, 신규 카탈로그 ETF가 누락되어 있거나 유효한 미래 만기 옵션 월물이 0건인 경우 새 계약/종목이 보충 시드되어야 함.
- **영향**: 기존 `.data` 파일이 유지된 운영/개발 환경에서는 이번 패치로 추가된 ETF 12종과 미래 만기 옵션 월물이 UI/주문에 나타나지 않음.
- **최소 재현**: `fresh.exportSnapshot()`에서 ETF 1종 제거 및 옵션 `expiry_date`를 과거 시점으로 변경한 뒤 `new MemoryDatabase().importSnapshot(snap)` 실행.
- **수정 방향**: `importSnapshot` 완료 직후 `STOCK_UUID_MAP`/ETF 카탈로그 누락 종목을 비파괴 보충(`!this.stocks.has(id)`)하고, 유효한 미래 만기 옵션이 없으면 기존 만기 계약은 그대로 둔 채 새 만기 월물만 추가 시드.

---

### P2-2. [잔존/부분해결 — 기존 #7] `trimSettlementLedger` 삽입 순서 역전 시 워터마크 과상승 및 `opt_settle_*`/`bond_*` 무제한 누적

- **위치**: [memoryStore.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts#L1038-L1108)
- **발생 조건**:
  1. `trimSettlementLedger`가 `Map` 삽입 순서대로 앞 항목을 퇴거하면서 `seq > cur` 조건만으로 `settledEpochWatermarks`·`settledOptionEpochWatermarks`·`settledDeterministicWatermarks`를 갱신함. 동시 종목 체결 또는 장애 복구 중 높은 시퀀스(`seq=2`)가 낮은 시퀀스(`seq=1`)보다 먼저 삽입·퇴거되면 워터마크가 `2`로 상승해 아직 처리되지 않은 `seq=1`도 이미 정산된 것으로 판정됨.
  2. `opt_settle_*`, `bond_*` 등 정규식 3종에 해당하지 않는 ID는 전부 `evictedCustomTradeIds`(`Set<string>`)로 이동해 상한 없이 계속 누적됨.
- **관측 결과 / 기대 결과**:
  - **관측 (`[8]`)**: `opt_tr_e1_2`, `opt_settle_contract1`, `opt_tr_e1_3` 순으로 원장 삽입 후 `trimSettlementLedger(1)` 호출 → `{ watermarkEpoch1: 2, t1ReportedAlreadySettled: true, evictedCustomSize: 1, evictedHasOptSettle: true }`.
  - **기대**: 중간에 비어 있는(미정산) 시퀀스를 건너뛰어 워터마크가 올라가지 않아야 하며, 옵션 만기/채권 쿠폰 정산 키도 무한 증가하는 `Set`에 의존하지 않아야 함.
- **영향**: 비순차 삽입/퇴거 상황에서 미정산 거래가 중복으로 오인되어 정산이 건너뛰어질 수 있고, 장기 가동 시 `evictedCustomTradeIds`가 서서히 증가함.
- **최소 재현**: `MemoryDatabase`에 `opt_tr_e1_2`, `opt_settle_contract1`, `opt_tr_e1_3`을 기록한 뒤 `trimSettlementLedger(1)` 실행 후 `isTradeAlreadySettled('opt_tr_e1_1')` 확인.
- **수정 방향**: 연속(contiguous) 확인된 시퀀스까지만 워터마크를 전진시키고 미연속 시퀀스는 별도 소규모 비트셋/대기열에 두며, `opt_settle_*`·`bond_*`는 계약/쿠폰 회차 상태 또는 전용 상한 구조로 분리.

---

### P2-3. [신규] 일반 주식/ETF 매수 사전 용량 검증(`validateOrderCapacity`)의 테이커 수수료(`0.25%`) 누락

- **위치**: [orderRisk.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/orderRisk.ts#L183), [dbMatching.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/dbMatching.ts#L242-L308), [memoryDbClient.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryDbClient.ts#L532-L556)
- **발생 조건**: `validateOrderCapacity`는 `requiredCash = incomingPrice * incomingSize`로 수수료를 반영하지 않음. 반면 매수 주문이 기존 매도 호가와 즉시 체결되면 `dbMatching.ts`가 `buyer_fee = 0.0025`를 계산하고 `bulk_settle_trades`는 `tradeAmount * (1 + buyerFee)`를 요구함.
- **관측 결과 / 기대 결과**:
  - **관측 (`[4]`)**: `cash = 100,000`, 매도 호가 `10,000 * 10`이 존재하는 상태에서 매수 주문 검증/실행 → `validateOrderCapacity.valid === true`, `submitAndMatchOrder` 결과 `{ success: false, filledQty: 0, message: "Insufficient cumulative cash for buyer stk_fee_buyer: required=100250, available=100000" }`.
  - **기대**: 사전 검증과 정산의 수수료 기준이 일치해 최대 매수 가능 금액 경계에서 혼선이 없어야 함.
- **영향**: 가용 현금 전액(또는 잔액 근접치)으로 매수 주문 시 사전 용량 통과 후 정산 거절이 발생하며, 다건 미체결 예약 계산(`calculateReservedCash`)에도 테이커 수수료 여유분이 빠짐.
- **최소 재현**: `cash = 100_000` 계좌로 `price = 10_000, size = 10` 매수 주문을 상대 `open` 매도 호가가 있는 종목에 `submitAndMatchOrder` 호출.
- **수정 방향**: `validateOrderCapacity`와 `calculateReservedCash`에서 매수 시 최대 테이커 수수료(`0.0025`)를 일관되게 반영(또는 옵션과 동일한 정책으로 정렬).

---

### P2-4. [신규] `ActiveOrdersPanel` 일괄 취소(`.in('id', ...)`)와 `/api/local-db` 필터 불일치

- **위치**: [ActiveOrdersPanel.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/ActiveOrdersPanel.tsx#L129-L133), [route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts#L463-L466)
- **발생 조건**: `ActiveOrdersPanel`의 일괄 취소 기능이 `db.from('orders').update({ status: 'cancelled' }).in('id', targetIds).eq('user_id', userId)`를 호출함. 그러나 `/api/local-db` `POST`의 `orders` update 분기는 `f.col === 'id' && f.op === 'eq'`만 검색해 `op === 'in'` 요청을 거절함.
- **관측 결과 / 기대 결과**:
  - **관측 (`[3]`)**: `POST /api/local-db`에 `filters: [{ col: 'id', op: 'in', val: ['ord_1', 'ord_2'] }, { col: 'user_id', op: 'eq', val: 'user-1' }]` 전송 → HTTP `400` (`message: '주문 ID가 필요합니다.'`).
  - **기대**: 일괄 취소가 인증된 본인 주문에 한해 일괄로 `cancelled` 처리되어야 함.
- **영향**: 미체결 주문 패널의 전체/일괄 취소 UI 기능이 실제로 동작하지 않음.
- **최소 재현**: `app/api/local-db/route.ts` `POST`에 `ActiveOrdersPanel.tsx:129-133`과 동일한 `in` 필터 payload로 요청.
- **수정 방향**: `/api/local-db`에서 `orders` update 시 `op === 'in'` 배열 처리(각 주문 소유권 및 `withAccountLocks` + `withCommitGate` 적용) 또는 전용 일괄 취소 API 추가.

---

### P2-5. [신규] UI-서버 간 단위·데이터·엔드포인트 단절 다수 (`/etf`·해외주식 통화, `/commodities`, `/mypage`, `OptionsPanel`, `HttpMemoryClient.rpc`)

- **위치 및 관측 근거**:
  1. **USD 표시 종목 KRW 직접 차감 및 `/etf` 시뮬레이션 불일치**: [app/etf/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/etf/page.tsx#L31-L82), [app/etf/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/etf/page.tsx#L250-L293), [OrderEntry.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OrderEntry.tsx) — `SPY`·`TSLL`·미국 주식 등 UI에 `$`로 표시되는 종목도 서버(`dbMatching.ts`, `memoryDbClient.ts`)는 환율 변환 없이 숫자 `price * size`를 원화(`profile.cash`)에서 차감함. 또한 `/etf` 카드 UI는 클라이언트 로컬 시뮬레이션 시세를 표시하면서 주문 시에만 `/api/orders`를 호출함.
  2. **원자재 UI 차단·하드코딩 환율·취소 기능 부재**: [CommodityOrderEntry.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityOrderEntry.tsx#L44), [CommodityOrderEntry.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/commodities/CommodityOrderEntry.tsx#L69-L76), [CommodityDetailClient.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/commodities/[id]/CommodityDetailClient.tsx#L242), [app/api/commodities/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/commodities/route.ts#L8) — UI는 `usdToKrwRate = 1350`(서버 `1380`과 불일치)을 사용하며 `userCash < totalRequiredMarginKrw` 조건으로 `reduce-only` 청산 주문까지 클라이언트에서 차단함. 또한 `CommodityDetailClient` `내 미체결` 탭은 주식 `ActiveOrdersPanel`을 렌더링하고, `/api/commodities`는 `releaseCommodityOrderMargin`을 import만 한 채 주문 취소 액션이 없음.
  3. **마이페이지 옵션 보유종목 파손**: [app/mypage/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/mypage/page.tsx#L45-L95) — `holdings`를 `stocks(...)`와만 조인해 `db.holdings`에 저장된 옵션 포지션이 `"알 수 없는 종목"` / `"UNKN"`으로 표시되고 승수(`250,000`) 없이 평가금액에 합산됨.
  4. **죽은 RPC 호출 잔존**: [OptionsPanel.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionsPanel.tsx#L110), [OptionsPanel.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionsPanel.tsx#L142) (`StockDetailClient`에서 사용) — 서버에 없는 `execute_option_order` / `execute_rollover_combo` RPC를 호출함.
  5. **HTTP RPC 에러 메시지 유실**: [client.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/db/client.ts#L165-L167) — `HttpMemoryClient.rpc`가 `!res.ok` 응답의 JSON 에러 본문을 읽지 않고 `Local RPC Error: ${res.statusText}`를 반환하여 [app/exchange/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/exchange/page.tsx#L172) 등에서 서버의 구체적 실패 사유가 손실됨.
- **수정 방향**: 해외/USD ETF 주문의 통화 단위·환율 기준을 명확히 통일하고, 원자재 취소 API 및 `reduce-only` UI 예외·동적 환율·원자재 전용 미체결 패널 연결, `mypage`에서 `options_contracts` 구분 렌더링, `OptionsPanel`의 `/api/options/order` 전환, `HttpMemoryClient.rpc` JSON 에러 파싱을 적용.

---

### P2-6. [잔존/부분해결 — 기존 #3·#8 연관] 동시성·저장 경계·인덱스 정합성 국소 결함

- **위치 및 관측 근거**:
  1. **`CommodityMarketEngine.reconcileWithDatabase` 조기 `reconciled = true`**: [CommodityMarketEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/CommodityMarketEngine.ts#L400-L435) — `await releaseCommodityOrderMargin(...)` 완료 전에 `this.reconciled = true`를 먼저 설정함. 격리 재현 `[5]`에서 누락 상품 주문(`UNKNOWN_COMM`) 뒤에 정상 주문(`CRUDE_OIL`)이 있을 때 동시 호출 `p1`, `p2` 중 두 번째 호출이 복원 완료 전 즉시 반환됨(`bidsAfterP2: 0`, `bidsAfterP1: 1`).
  2. **`CommodityMarketEngine.stepTickAsync` 저장 및 시세 동기화 누락**: [CommodityMarketEngine.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/commodities/CommodityMarketEngine.ts#L552) — `userMutations > 0`일 때만 `onPersist()`를 호출하고, `this.commodities` 가격 변동을 `db.commodities`와 동기화하지 않음.
  3. **`InMemoryMarketRepository.deleteOrders` 보조 인덱스 누수**: [InMemoryMarketRepository.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemoryMarketRepository.ts#L227-L231) — `this.db.orders.delete(id)`만 수행하고 `removeOrderFromIndex`를 호출하지 않음. 격리 재현 `[7]` → `{ inOrders: false, inStockIndex: true, inUserIndex: true }`.
  4. **`localStandaloneServer.runTick` 20틱 트리밍 무잠금/무커밋게이트**: [localStandaloneServer.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts#L200-L202) — `trim_old_market_data`와 `trimSettlementLedger`를 `withCommitGate`·`withStockLock` 밖에서 실행함.
  5. **`/api/local-db` `profiles` 조회 중 상태 변이**: [app/api/local-db/route.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts#L340) — `SELECT` 요청에서 `pruneExpiredProfileEntitlements(profile)`을 락/커밋게이트 없이 호출함.
- **수정 방향**: `reconcileWithDatabase`를 단일 in-flight Promise로 직렬화하고, `deleteOrders`에 `removeOrderFromIndex` 추가, `runTick` 트리밍을 `withCommitGate` 내부로 이동.

---

### P3-1. [신규] `news/page.tsx` 미존재 `premium_news` 조회 및 `test-route-handlers-e2e.ts` 단독 실행 실패

- **위치**: [app/news/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/news/page.tsx#L48), [app/news/page.tsx](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/app/news/page.tsx#L136), [test-route-handlers-e2e.ts](file:///C:/Users/abcde/Desktop/웹소설/stock-sys/scripts/test-route-handlers-e2e.ts#L36)
- **내용**: `app/news/page.tsx`가 메모리 DB에 존재하지 않는 `premium_news` 테이블을 조회하고 `profile.news_subscriptions`와 연결되어 있지 않음(`market_news` 기본 피드는 동작). 또한 기존 테스트 `scripts/test-route-handlers-e2e.ts` 실행 시 36행에서 `TypeError: Cannot read properties of undefined (reading 'stop')`로 즉시 실패(exit code `1`).

---

## 3. 이전 16건 재판정 표

| # | 항목 (Codex 리뷰 기준) | 판정 | 근거 (실제 코드·테스트 대조) |
| :-: | :--- | :---: | :--- |
| 1 | 일반 주식 주문 경로 자산 경계 (`options`/`commodities`/`bonds`/미등록 차단) | **해결** | `app/api/orders/route.ts`, `lib/engine/dbMatching.ts:95-115`, `app/api/local-db/route.ts`에서 차단 확인; `test-codex-review-16-fixes.ts` [1] 통과 |
| 2 | `PersistenceManager` 전역 직렬 커밋 게이트 (`withCommitGate`) | **해결** | `PersistenceManager.ts`, `memoryTransaction.ts`, 주요 API/서비스 쓰기 적용 및 [2] 통과 (단, `localStandaloneServer` 20틱 트리밍·`local-db` SELECT 변이는 P2-6으로 별도 보고) |
| 3 | `accountLocks` 잠금 순서·재진입·원자재 틱 스코프 롤백 | **부분 해결** | `accountLocks.ts` 정렬/재진입 및 `commodityLedger.ts` 스코프 롤백 정상([3] 통과); `CommodityMarketEngine.reconcileWithDatabase` 조기 `reconciled=true` 경쟁(`[5]`) 잔존 |
| 4 | 환전(`exchangeService.ts`) 최소 단위 내림(`floorCurrency`) 차익 차단 | **해결** | `lib/exchange/exchangeService.ts` 검증 및 [4] 통과 (단, `HttpMemoryClient.rpc` 에러 메시지 유실은 P2-5) |
| 5 | 공용 가용 현금(`getAvailableCashKrw`) 및 원자재 이중 차감 제거 | **부분 해결** | `getAvailableCashKrw` 및 원자재 이중 차감 제거는 [5] 통과; **옵션 상대방 매수자 수수료·누적 검증 누락(P1-1, `[1a]/[1b]`)** 및 **주식 테이커 매수 수수료 사전 검증 누락(P2-3, `[4]`)** 잔존 |
| 6 | `engine-server` 재시작 에포크·`simulationRunId` 격리 | **해결** | `engine-server/src/restartRuntime.ts` 확인 및 [6] 통과 |
| 7 | `settlementLedger` 상한 및 워터마크 기반 중복 정산 방지 | **부분 해결** | 순차 ID 압축 [7] 통과; **비순차 삽입/퇴거 시 워터마크 과상승(`opt_tr_e1_1` 오판) 및 `opt_settle_*`/`bond_*` `evictedCustomTradeIds` 무제한 누적(P2-2, `[8]`)** 잔존 |
| 8 | 자동 체결 저장 경계 및 실패 전파 | **부분 해결** | `localStandaloneServer`·`agentManager` 저장/롤백([8])은 동작하나, **`engine-server/src/MarketEngine.ts:866-898` 영속 실패 시 인메모리 롤백 없는 `COMMITTED`+`PERSISTENCE_FAILED` Split-Brain(P1-2, `[6]`)** 및 `index.ts:32-34` 중간 틱 비거래 상태 미저장 잔존 |
| 9 | 옵션 LP vs 사용자 대기 주문 가격 우선 매칭 | **해결** | `lib/options/optionOrderService.ts:183-186`에서 LP 가격보다 유리한 대기 주문 우선 차단 확인 및 [9] 통과 |
| 10 | 원자재 `rate_to_krw` 일관 조회 | **해결** | `lib/commodities/commodityLedger.ts` 확인 및 [10] 통과 |
| 11 | 원자재 `reduce-only` 증거금 면제 및 중복 청산 방지 | **부분 해결** | `commodityLedger.ts` 서버 로직 및 [11] 통과; **`CommodityOrderEntry.tsx:69-76`가 `userCash` 검사로 청산 주문까지 UI 차단 및 `1350` 하드코딩, 취소 API 부재(P2-5)** 잔존 |
| 12 | `/api/options/account` · `OptionAccountPanel` 실계좌 연동 | **해결** | `app/api/options/account/route.ts` 및 `OptionAccountPanel.tsx` 확인, [12] 통과 (구형 `OptionsPanel.tsx` dead RPC 및 `mypage` 표시 문제는 P2-5) |
| 13 | `OptionMonthChainGrid` 동적 미래 만기 월물 전환 | **부분 해결** | 신규 시드 환경 [13] 통과; **기존 스냅샷 `importSnapshot` 시 전부 만기된 상태면 미래 월물 미공급(P2-1, `[2]`)** |
| 14 | `ETF_CATALOG` 12종 서버 시드 및 `/etf` `/api/orders` 연동 | **부분 해결** | `seedDefaultData` 및 `/etf` 주문 연동 [14] 통과; **`importSnapshot` 시 기존 스냅샷에 신설 ETF 미병합(P2-1, `[2]`)**, `/etf` 카드 시세 시뮬레이션·USD/KRW 혼용(P2-5) 잔존 |
| 15 | `playerEventService` · `/api/events/resolve` · `RandomEventModal` 서버 권위화 | **해결** | `playerEventService.ts`, `app/api/events/resolve/route.ts`, `RandomEventModal.tsx` 확인 및 [15] 통과 |
| 16 | `ensureMemoryDbReady()` / `ensureLocalStandaloneReady()` 분리 및 `useAuth.ts` 서버 코드 누수 제거 | **해결** | `lib/engine/localDevMode.ts`, `localStandaloneServer.ts`, `lib/auth/useAuth.ts` 확인 및 [16] 통과 |

---

## 4. 실행한 검증 명령 및 실제 결과

모든 테스트와 재현은 임시 디렉터리(`STOCKSYS_DATA_DIR=$env:TEMP\...`) 또는 메모리 DB로 격리 실행했으며 실행 후 임시 파일과 디렉터리를 정리했다.

| 구분 | 실행 명령 | Exit Code | 관측 결과 요약 |
| :--- | :--- | :---: | :--- |
| 타입 검사 (루트) | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | `0` | 오류 없음 |
| 타입 검사 (엔진) | `node node_modules/typescript/bin/tsc -p engine-server/tsconfig.json --noEmit --incremental false` | `0` | 오류 없음 |
| 16건 회귀 | `node --import tsx scripts/test-codex-review-16-fixes.ts` | `0` | `ALL 16 CODEX REVIEW REGRESSION TESTS PASSED` |
| 기존 수정 검증 | `node --import tsx scripts/test-review-fixes-verification.ts` | `0` | `ALL CODE REVIEW FIX VERIFICATION TESTS PASSED` |
| 후속 A-F | `node --import tsx scripts/test-followup-a-to-f.ts` | `0` | `ALL COORDINATOR FOLLOW-UP (A-F) REPRODUCTION & VERIFICATION TESTS PASSED` |
| Phase 1 스위트 | `node --import tsx scripts/test-phase1-suite.ts` | `0` | 9개 스위트 전체 통과 (`All Phase 1 Test Suites Passed Successfully!`) |
| Phase 2~4 주요 정산/롤백 | `scripts/test-phase2-engine-tick-rollback-id.ts`, `test-phase2-option-expiry-failclosed.ts`, `test-phase3-full-runtime-deterministic-rollback.ts`, `test-phase4-post-commit-split-brain.ts` | 각 `0` | 4개 모두 통과 |
| 라우트 E2E (기존) | `node --import tsx scripts/test-route-handlers-e2e.ts` | **`1`** | `TypeError: Cannot read properties of undefined (reading 'stop')` (`scripts/test-route-handlers-e2e.ts:36`) |
| 격리 재현 `[1a]` | `submitAuthoritativeOptionOrder` 상대 매수자 수수료 누락 | `0` | `{"success":true,"statusCode":200,"filledQty":1,"buyerCash":-500}` |
| 격리 재현 `[1b]` | `submitAuthoritativeOptionOrder` 동일 상대방 2건 누적 검증 부재 | `0` | `{"success":true,"statusCode":200,"filledQty":2,"buyerCash":-401000}` |
| 격리 재현 `[2]` | 구 스냅샷 `importSnapshot` 후 신설 ETF/미만기 옵션 | `0` | `{"unexpiredOpts":0,"hasKodexSemi":false}` |
| 격리 재현 `[3]` | `ActiveOrdersPanel` `.in('id', ...)` → `POST /api/local-db` | `0` | `{"status":400}` |
| 격리 재현 `[4]` | `validateOrderCapacity` 통과 vs `submitAndMatchOrder` 테이커 수수료 거절 | `0` | `validateOk: true`, `matchRes.success: false` (`required=100250, available=100000`) |
| 격리 재현 `[5]` | `CommodityMarketEngine.reconcileWithDatabase` 동시 호출 조기 반환 | `0` | `{"bidsAfterP2":0,"bidsAfterP1":1}` |
| 격리 재현 `[6]` | `MarketEngine.tick()` 영속 실패 시 Split-Brain | `0` | `success: false, commitStatus: "COMMITTED", errorCode: "PERSISTENCE_FAILED"`, `tradesDelta: 1`, `buyerCashDelta: -719280` |
| 격리 재현 `[7]` | `InMemoryMarketRepository.deleteOrders` 보조 인덱스 누수 | `0` | `{"inOrders":false,"inStockIndex":true,"inUserIndex":true}` |
| 격리 재현 `[8]` | `trimSettlementLedger` 비순차 퇴거 워터마크 & `opt_settle_*` 커스텀 누적 | `0` | `{"watermarkEpoch1":2,"t1ReportedAlreadySettled":true,"evictedCustomSize":1,"evictedHasOptSettle":true}` |

---

## 5. 미검증 범위

- 이번 독립 리뷰에서는 `npx next build` 프로덕션 빌드 및 `next start` 실HTTP 서버 기동을 직접 재실행하지 않음(이전 보고 `docs/codex-review-fixes-hydrogen-high-results.md`에만 기록됨).
- 실제 브라우저(Playwright 등) 렌더링·클릭 E2E, 실제 Google OAuth 로그인 왕복, 실제 운영 VM/원격 Postgres/Redis/엔진 프로세스 강제 종료(`SIGKILL`) 장애 복구 실험은 수행하지 않음.
- `engine-server/src/bots/*` 개별 봇 구현 내부 및 `InMemorySettlementRepository.ts` 초반부, `agentManager.ts` 중반부는 전체 줄 단위 열람 대상에서 제외되었음.
