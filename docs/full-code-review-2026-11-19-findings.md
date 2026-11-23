# 2026-11-19 전체 코드 독립 재리뷰 보고서 (`HEAD 7008f55`)

- **기준 커밋 및 작업트리**: `main` @ `7008f55` (기존 `.codex/hooks.json`, `.codex/run-impeccable-hook.cjs`, `debug.log`, `docs/full-code-review-2026-11-19-plan.md` 보존, 앱/설정/기존 테스트 무수정)
- **검증 원칙**: 이전 리뷰·수정 보고서는 참고 맥락으로만 활용하고, 본 보고서의 모든 결함과 테스트 판정은 실제 코드 대조 및 격리된 `STOCKSYS_DATA_DIR` / `MemoryDatabase` 실행 결과만을 근거로 기록했다.
- **심각도 기준**:
  - **P0**: 조건 없이 서비스 전반을 막거나 즉시 광범위 자산 손실이 확실한 경우 (본 리뷰에서 P0 확정 0건)
  - **P1**: 실질적 금전·부채·정산 불일치, 데이터 손상/유실, 인증/정보 경계 침해, 핵심 엔진/화면 기능 불능
  - **P2**: 특정 조건·경로에서의 일관성 결여, UI 단위/표기 오류, 영속화 누락, 결정론/운영 설정 불일치

---

## 1. 요약 및 우선순위별 결함 목록

총 **19건(P1 10건, P2 9건)**의 독립 결함을 확정했으며, 기존 실패/종료 대기 8개 테스트는 모두 **노후 테스트 픽스처/API·정책 불일치(6건) 및 종료 핸들 누락(2건)**임을 실행 확인으로 구분했다.

| ID | 심각도 | 영역 | 요약 | 파일:행 |
| :--- | :--- | :--- | :--- | :--- |
| **F-01** | P1 | API/보안 | `/api/local-db` `trades` 필터 오라클 (`buyer_id`/`seller_id` 필터 후 마스킹) 및 내부 설정 테이블 공개 | [route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts:264) |
| **F-02** | P1 | 회계/채권 | 시드 채권 만기 문자열(`2Y`/`5Y`)로 만기 정산 전량 실패, ISO 만기 시 연 쿠폰 전액 과지급, 호가(`99.8`) vs 액면(`10000`) 100배 불일치 | [InMemorySettlementRepository.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts:1695) |
| **F-03** | P1 | 부채/정산 | 옵션 만기·채권 만기 정산 지급이 `margin_debt_krw` 우선 상환을 우회해 `profile.cash` 직접 가산 | [InMemorySettlementRepository.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts:1582) |
| **F-04** | P1 | 부채/이벤트 | 음수 비용(`cost < 0`) 플레이어 이벤트 보상이 `margin_debt_krw` 우선 상환을 우회해 `profile.cash` 직접 가산 | [playerEventService.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/events/playerEventService.ts:90) |
| **F-05** | P1 | 부채/주문 | 부채(`margin_debt_krw`) 발생 전 대기 매수 주문이 부채 발생 후에도 체결·주식 취득 가능하며 취소 시 해제 현금이 부채 상환 없이 잔존 | [memoryDbClient.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryDbClient.ts:552) |
| **F-06** | P1 | 저장/동시성 | `MarketEngine.tick()`이 `commitGate` 밖에서 비동기·상태 변이를 수행하는 동안 30초 `startAutoSave`가 미커밋/중간 상태를 디스크에 저장 가능 | [MarketEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:709) |
| **F-07** | P1 | 봇/엔진 | `engine-server` `MarketEngine.initializeBots()`가 15개 기본 봇을 모두 `ExecutionTrader`로 초기화하고 7개 특화 봇 풀을 `0`개로 비움 | [MarketEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:334) |
| **F-08** | P1 | 봇/LP | `ASMarketMakerAgent`에 `orderBook` 미전달로 기존 LP 취소 불가 + 부분체결된 신규 LP 주문이 `ord_...`와 `lp_..._slot*`으로 이중 잔존 | [MarketEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:855) |
| **F-09** | P1 | 옵션/시드 | 시드 옵션 `opt_c_720`/`opt_p_720`의 `IDX-K200` 티커/포인트 시세(`2.15`)와 `STK`·삼성전자(`72000`) 행사가 혼재 | [memoryStore.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts:910) |
| **F-10** | P1 | UI/옵션 | `OptionsPanel`→`optionBotEngine`이 클라이언트에서 금지된 DB 쓰기/RPC(`options_contracts`, `stocks`, `settle_options_expiration`) 호출 | [optionBotEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/optionBotEngine.ts:310) |
| **F-11** | P2 | API/조회 | `/api/local-db` `profiles` 조회가 `profileUserIdIndex`를 사용하지 않아 `id !== user_id` 시 조회 누락 위험 | [route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts:362) |
| **F-12** | P2 | 관리자/영속 | `admin/scenarios`·`commodities` 이벤트 상태가 스냅샷에 영속화되지 않고 `list_stock` 롤백이 `marketIndex` 정리를 누락 | [route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/admin/scenarios/route.ts:209) |
| **F-13** | P2 | 수수료/엔진 | `localStandaloneServer.processMatching`이 `fee_booster` 50% 할인을 무시하고 `0.0025` 고정 징수(주문 수락 후 체결 거절 유발) | [localStandaloneServer.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts:457) |
| **F-14** | P2 | 정산/동시성 | `optionOrderService`가 `commitGate`·스냅샷 이전에 만료 엔타이틀먼트를 변이하고 롤백 시 신규 추가 키 삭제 누락 | [optionOrderService.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/options/optionOrderService.ts:215) |
| **F-15** | P2 | 결정론/키 | `localStandaloneServer`·`dbMatching`의 `Date.now()`/`Math.random()` 사용 및 `memoryStore.getNowMs()` 컨텍스트 미바인딩 시 고정 상수(`1774000000000`) 반환 | [localStandaloneServer.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts:364) |
| **F-16** | P2 | UI/화면연결 | `OrderEntry` 수수료/예약금/부채 미반영, 상점 `feature_expiries`/`acquired_passives`/만료일 표시 누락, V2 종목상세 `ticker`/`bonds` 미지원, 원자재 `Orderbook` `stockId` 누락, 옵션 `₩`/채권 `Math.round` 단위 표기 오류 | [OrderEntry.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OrderEntry.tsx:11) |
| **F-17** | P2 | 봇/결정론 | `QuantAgent`·`StatArbAgent`·`CommercialHedgerAgent`·`CTAAgent`가 `SimulationContext` 미주입으로 공유 시계·PRNG에서 분리됨 | [QuantAgent.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/QuantAgent.ts:15) |
| **F-18** | P2 | 봇/정렬 | `ensureBuiltInParticipantsRegistered()`의 봇 분류(`bot_hf_*`/`bot_prop_*`/`bot_cta_*`가 `DOMESTIC_INSTITUTION`)가 폴백 분류(`FOREIGN_INSTITUTION`)와 불일치 | [MarketEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:355) |
| **F-19** | P2 | 운영/스키마 | `verify-env-alignment.ts` 루트/엔진 환경 불일치, `.env.production.example`(HTTP/비인메모리)과 `localDevMode.ts`(`true` 고정)/`sharedRateLimiter.ts`(`https://` 필수) 충돌, 레거시 SQL 대비 스키마 8개 컬럼 불일치 | [localDevMode.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localDevMode.ts:10) |

---

## 2. 영역별 상세 결함 및 반례 증거

### [F-01] `/api/local-db` `trades` 필터 오라클 및 내부 운영 테이블 공개 (P1)
- **위치**: [app/api/local-db/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts:264)
- **호출 경로/발생 조건**: 비인증 클라이언트가 `POST /api/local-db`로 `tableName: "trades"`, `query: { action: "select", filters: [{ col: "buyer_id", op: "eq", val: "<target_user_id>" }] }` 요청 전송.
- **영향**: 응답 본문에서 `sanitizePublicTradeRecord`가 `buyer_id`, `seller_id`, `buy_order_id`, `sell_order_id`를 제거하더라도 필터링이 마스킹 전에 수행되므로 임의 사용자의 체결 내역·주문 ID를 전수 열거할 수 있다. 또한 `PUBLIC_READ_TABLES`에 `active_manipulations`, `bots_config`, `admin_settings`가 포함되어 내부 시뮬레이션 설정이 노출된다.
- **관측 vs 기대**:
  - 관측(`CE-10`): 비인증 `POST /api/local-db` 요청이 `HTTP 200`과 함께 `tr_secret_probe` 1건을 반환(`tradesMatchedSecretVictimCount: 1`, `returnedTradeHasBuyerId: false`).
  - 기대: 공개 `trades` 조회 시 `buyer_id`, `seller_id`, `buy_order_id`, `sell_order_id` 컬럼에 대한 필터/정렬을 거부하거나 마스킹된 공개 프로젝션 이후에만 필터를 적용해야 하며, `bots_config`/`active_manipulations`/`admin_settings`는 관리자 또는 서버 내부로 제한해야 한다.
- **최소 수정 방향**: `trades` SELECT 시 필터 화이트리스트(`id`, `stock_id`, `price`, `size`, `created_at` 등 공개 컬럼만 허용)를 적용하고 내부 테이블 읽기 권한을 분리한다.

### [F-02] 채권 만기 정산 실패(`2Y`/`5Y`), 연 쿠폰 과지급, 호가-액면 100배 괴리 (P1)
- **위치**:
  - [lib/memoryDb/memoryStore.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts:860) (시드 채권 `maturity: '2Y'`, `face_value: 10000`, `current_price: 99.8`)
  - [engine-server/src/settlement/BondCouponEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/settlement/BondCouponEngine.ts:136)
  - [lib/repositories/inMemory/InMemorySettlementRepository.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts:1695)
- **호출 경로/발생 조건**:
  1. 시드 채권(`bond_kr_2y` 등)은 `maturity`가 `'2Y'`/`'5Y'` 상대 기간 문자열이어서 `settleBondMaturityAtomically` 날짜 파싱에서 `INVALID_MATURITY_DATE`로 전량 거절됨.
  2. ISO 만기일이 도달한 채권에서 `BondCouponEngine`이 `couponAmount`를 생략하고 `{ principalAmount }`만 넘겨 `settleBondMaturityAtomically`를 호출하면, 저장소(1695~1713행)가 `authoritativeCoupon = roundMoney(bond.face_value * (couponRate / 100) * holding.quantity)`로 **연간 쿠폰 전액**(분기 쿠폰 `couponRate / 4`가 아님)을 추가 계산해 합산 지급함.
  3. 시드 채권 `current_price`가 액면 100 기준 `99.8`인 반면 `face_value`는 `10000`으로 설정되어, 1주 매수(약 100원) 후 만기 상환 시 10,000원(100배) 차익이 발생한다.
- **관측 vs 기대**:
  - 관측(`CE-4`): 시드 채권 호출 시 `INVALID_MATURITY_DATE: Invalid bond maturity date: 2Y` 실패. 만기일을 ISO 과거 날짜(`2026-01-01T00:00:00.000Z`)로 보정해 `bond_kr_2y`(`face_value=10000, coupon_rate=3.25%`) 10주 정산 시 `payout = 103,250`(원금 `100,000` + 연 쿠폰 `3,250`) 지급 확인.
  - 기대: 시드 채권의 만기일 필드(ISO `maturity_date`)·호가/액면 단위(100 기준 vs 10,000원 기준)를 통일하고, 만기 시 미지급 분기 쿠폰 여부 정책에 맞춰 중복/연간 전액 가산을 차단한다.
- **최소 수정 방향**: 시드 채권에 명시적 ISO `maturity_date` 및 일관된 거래 단위(`face_value` 또는 `multiplier`)를 부여하고, `settleBondMaturityAtomically`의 최종 쿠폰 계산을 분기(`couponRate / 400`) 또는 `couponAmount` 검증 모델로 통일한다.

### [F-03] 옵션·채권 만기 지급액의 `margin_debt_krw` 우선 상환 우회 (P1)
- **위치**: [lib/repositories/inMemory/InMemorySettlementRepository.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts:1582), [1724행](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/repositories/inMemory/InMemorySettlementRepository.ts:1724)
- **호출 경로/발생 조건**: `margin_debt_krw > 0`인 사용자가 `settleOptionExpiryAtomically` 또는 `settleBondMaturityAtomically`로 만기 상환금을 수령할 때.
- **영향**: 같은 파일의 `commitCashPayout`(1335행)과 달리 위 두 메서드는 `profile.cash = roundMoney(profile.cash + payout)`를 직접 수행해 미수 부채를 갚지 않고 현금을 지급한다.
- **관측 vs 기대**:
  - 관측(`CE-4`, `CE-4b`): `cash=0, margin_debt_krw=5000` 계좌에 채권 만기(`103,250`), 옵션 만기(`5,000,000`) 정산 후 각각 `finalCash=103250, finalMarginDebt=5000` 및 `finalCash=5000000, finalMarginDebt=5000` 관측.
  - 기대: `applyCashCreditWithMarginDebt`로 부채(`5,000`)를 우선 상환하고 차액만 `profile.cash`에 반영.
- **최소 수정 방향**: 두 메서드의 현금 지급 라인을 `applyCashCreditWithMarginDebt(profile, payout)` 호출로 교체한다.

### [F-04] 음수 비용(`cost < 0`) 플레이어 이벤트 현금 보상의 `margin_debt_krw` 우회 (P1)
- **위치**: [lib/events/playerEventService.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/events/playerEventService.ts:63)
- **호출 경로/발생 조건**: `RandomEventModal.tsx:142-144`가 지원하는 현금 보상형 선택지(`choice_a_cost < 0` 또는 `choice_b_cost < 0`)를 `margin_debt_krw > 0`인 사용자가 선택할 때.
- **영향**: `if (cost > 0)` 검사를 건너뛴 뒤 90행에서 `profile.cash = Math.round((profile.cash - cost) * 100) / 100`으로 `cash`만 증가시켜 `margin_debt_krw`를 상환하지 않는다.
- **관측 vs 기대**:
  - 관측(`CE-5`): `cash=0, margin_debt_krw=500,000` 사용자가 `choice_a_cost: -200,000` 이벤트 수락 시 `evRes.success=true`, `cash=200,000`, `margin_debt_krw=500,000` 유지.
  - 기대: `cost < 0`인 보상금은 `applyCashCreditWithMarginDebt(profile, -cost)`로 부채 우선 상환.
- **최소 수정 방향**: `cost < 0` 분기에서 `applyCashCreditWithMarginDebt`를 호출한다.

### [F-05] 부채 발생 전 대기 매수 주문의 후속 체결 및 취소 시 해제 현금 미상환 (P1)
- **위치**:
  - [lib/memoryDb/memoryDbClient.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryDbClient.ts:552) (`bulk_settle_trades`)
  - [lib/engine/marketService.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/marketService.ts:166) (`cancelOrder`)
  - [lib/options/optionOrderService.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/options/optionOrderService.ts:331)
- **호출 경로/발생 조건**:
  1. 사용자가 정상 현금(`1,000,000`)으로 지정가 매수 주문(`802,000`원 예약)을 걸어 둔 상태에서 원자재 손실(`-500,000`)이 발생하면, `applyCashDeltaWithMarginDebt`가 예약 현금 `802,000`을 보호하고 초과 손실 `302,000`을 `margin_debt_krw`에 기록함.
  2. 이후 반대편 매도 주문이 들어오면 `bulk_settle_trades`는 `margin_debt_krw > 0`을 차단하지 않아 매수 체결이 성사됨(부채 상태에서 추가 매수 체결).
  3. 남은 대기 매수 주문을 `LocalMarketService.cancelOrder`로 취소해도 해제된 현금이 `margin_debt_krw` 상환에 사용되지 않고 `cash`와 `margin_debt_krw`가 공존함.
- **관측 vs 기대**:
  - 관측(`CE-7`): `preFill {cash: 802000, debt: 302000}` → 매도 5주 유입 체결 후 `{sellSuccess: true, sellFilled: 5, buyerCash: 602200, buyerDebt: 302000, buyerHolding: 5}` → 잔여 주문 취소 후 `{buyerCash: 602200, buyerDebt: 302000}`.
  - 기대: 부채 발생 시 기존 미체결 매수 주문을 자동 취소해 예약 현금을 즉시 부채 상환에 충당하거나, 최소한 `cancelOrder`/`cancelOptionOrder` 시 해제된 가용 현금으로 `margin_debt_krw`를 우선 상환하고 부채 계좌 매수 체결을 거부해야 한다.
- **최소 수정 방향**: `applyCashDeltaWithMarginDebt`에서 부채 발생 시 미체결 매수 주문 취소/스윕 또는 `cancelOrder`/`cancelOptionOrder`·`bulk_settle_trades`에서 부채 계좌 매수 체결 차단 및 현금 스윕을 적용한다.

### [F-06] `MarketEngine.tick()` 비동기 구간 vs 30초 `startAutoSave` 스냅샷 오염 (P1)
- **위치**:
  - [engine-server/src/MarketEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:709)
  - [engine-server/src/index.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/index.ts:42)
  - [lib/engine/localStandaloneServer.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts:626)
- **호출 경로/발생 조건**: `MarketEngine.tick()`은 여러 `await` 단계를 거치며 `commitGate` 밖에서 동작하는 반면, `PersistenceManager.startAutoSave()`의 30초 타이머는 `commitGate`만 획득해 `saveSnapshot(memoryDb)`를 호출한다.
- **영향**: `tick()`이 아직 최종 커밋에 도달하지 않은 중간 변이 상태에서 `saveSnapshot()`이 실행되면 미커밋/중간 상태가 `snapshot.json`에 영구 기록되어, 이후 `tick()`이 실패·롤백되거나 프로세스가 재시작되면 오염된 상태가 복원된다.
- **관측 vs 기대**:
  - 관측(`CE-3`): `MarketEngine.tick()` 중 비커밋 주가 변이(`999999`) 직후 `pm3.saveSnapshot(db3)` 호출 후 `SIMULATED_PRE_COMMIT_CRASH_CE3` 발생 → 디스크 재로드 결과 `diskPriceWrittenByAutoSave: 999999` 저장 확인(또한 `MarketEngine.tick()`이 예외를 내부 포획해 호출자에게 에러가 전파되지 않고 `tickErr: ""` 반환).
  - 기대: `startAutoSave` 역시 직렬화된 엔진 틱/커밋 락 외부의 일관된 커밋 스냅샷만 저장해야 하며, 틱 중간 변이는 커밋 게이트 완료 전 디스크에 노출되지 않아야 한다.
- **최소 수정 방향**: `MarketEngine.tick()`의 상태 변이를 커밋 게이트 내부로 축소하거나 `PersistenceManager.saveSnapshot`이 엔진 틱 락과 상호 배타적으로 실행되도록 동기화한다.

### [F-07] `engine-server` `MarketEngine.initializeBots()`의 7개 특화 봇 풀 누락 (P1)
- **위치**: [engine-server/src/MarketEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:334)
- **호출 경로/발생 조건**: `initializeBots()`가 먼저 `ensureBuiltInParticipantsRegistered()`(387행)를 호출해 `db.botsConfig`에 15개 기본 봇을 `bot_type` 없이 등록한 뒤, `configs.length === 0`일 때만 특화 봇 풀을 생성하는 분기(448행)에 진입하지 못함. 또한 402~445행 루프는 `config.bot_type`이 없는 모든 15개 레코드를 `else { this.institutionalBots.push(new ExecutionTrader(...)) }`로 생성함.
- **영향**: `bot_as_mm_001`, `AS_MARKET_MAKER`, `bot_options_mm_001`까지 모두 일반 `ExecutionTrader`로 생성되며 `retailSwarmAgents`, `hedgeFundAgents`, `propDeskAgents`, `quantAgents`, `optionsMMBots`, `ctaBots`, `commercialHedgerAgents`가 전부 빈 배열 `[]`로 남아 봇 생태계가 작동하지 않는다.
- **관측 vs 기대**:
  - 관측(`CE-1`): `botsConfigCount: 15, botsWithBotType: 0, institutionalBots: 15, retailSwarmAgents: 0, hedgeFundAgents: 0, propDeskAgents: 0, quantAgents: 0, optionsMMBots: 0, ctaBots: 0, commercialHedgerAgents: 0`.
  - 기대: 각 내장 봇의 `bot_type`을 명시적으로 설정하고 전용 에이전트 인스턴스로 초기화되어야 한다.
- **최소 수정 방향**: `ensureBuiltInParticipantsRegistered()`에서 `bot_type`을 정확히 부여하거나 `initializeBots()`가 전용 ID/타입 매핑을 통해 각 특화 풀을 채우도록 수정한다.

### [F-08] `ASMarketMakerAgent` `orderBook` 미전달 및 부분체결 LP 주문 이중 잔존 (P1)
- **위치**:
  - [engine-server/src/MarketEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:854), [1446~1498행](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:1446), [1848~1944행](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:1848)
  - [engine-server/src/bots/ASMarketMakerAgent.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/ASMarketMakerAgent.ts:15)
- **호출 경로/발생 조건**:
  1. `MarketEngine.ts:855`가 `this.asMarketMakerAgent.executeMarketMaking(marketState)`로 2번째 인자 `orderBook`을 생략해 호출하므로 `ASMarketMakerAgent` 내부에서 기존 LP 호가(`existingLpBids/Asks`)와 호가 불균형(`imbalance`)이 항상 빈 값으로 계산됨.
  2. 동일 틱 내 신규 생성 LP 주문(`!bid._fromRepo && isTrueLpOrder(bid)`)이 타 주문과 부분 체결되면 `ord_...` ID로 커밋될 뿐 아니라, `refreshLpQuotesAtomically`에서 동일 호가가 `lp_${stockId}_buy_slot*`로 원래 수량(`filled: 0`)째 재삽입됨.
- **관측 vs 기대**:
  - 관측(`CE-2b`): 1주 매도 유입 후 1틱 실행 결과 동일 가격(`71600`)에 `ord_run%5Fseed%5F42_t1_...` (`size: 12, filled: 1, status: "partial"`)과 `lp_..._buy_slot0` (`size: 12, filled: 0, status: "open"`)이 동시에 잔존함(총 `openLpBuyCount: 16`).
  - 기대: `MarketEngine.ts:855`에서 현재 `orderBook` 스냅샷을 전달하고, `refreshLpQuotesAtomically`로 관리되는 LP 호가는 `ord_...` 잔존과 중복 슬롯 삽입을 하나로 일원화해야 한다.
- **최소 수정 방향**: `executeMarketMaking(marketState, orderBookSnapshot)` 전달 및 LP 주문은 슬롯 교체(`lp_..._slot*`) 경로로만 잔존시키고 `ord_...` 부분체결 LP 잔량 중복 저장을 제거한다.

### [F-09] 시드 옵션 티커/시세(`IDX-K200`·`2.15`) vs 기초자산(`STK`·`72000`) 불일치 (P1)
- **위치**: [lib/memoryDb/memoryStore.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts:910)
- **영향**: `opt_c_720`/`opt_p_720` 시드 계약이 `ticker: 'IDX-K200-2608-C260.0'`, `current_price: 2.15`이면서 `asset_class: 'STK'`, `underlying_stock_id: '00000000-0000-4000-8000-000000000101'`(삼성전자), `strike_price: 72000`으로 혼합되어 있어 지수(`~260pt`)와 개별주(`~72,000원`) 기준이 충돌한다.
- **관측 vs 기대**: `MemoryDatabase` 시드 출력에서 직접 확인 (`asset_class: 'STK'`, `ticker: 'IDX-K200-2608-C260.0'`, `strike_price: 72000`, `current_price: 2.15`).
- **최소 수정 방향**: 지수 옵션(`IDX` / `idx_k200` / `strike_price: 260`)과 삼성전자 주식 옵션(`STK` / `STK-005930-...` / 원화 호가)으로 시드를 분리·정합화한다.

### [F-10] `OptionsPanel`→`optionBotEngine`의 클라이언트 금지 DB 쓰기·RPC 호출 (P1)
- **위치**:
  - [app/components/OptionsPanel.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionsPanel.tsx:59)
  - [lib/engine/optionBotEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/optionBotEngine.ts:310)
- **영향**: 브라우저에서 실행되는 `optionBotEngine`이 `db.from('options_contracts').insert/update`, `db.from('stocks').update`, `db.rpc('settle_options_expiration')`를 직접 호출해 `/api/local-db` 화이트리스트·권한 정책에 의해 403/오류로 실패한다.
- **최소 수정 방향**: 옵션 체인 시드/호출/정산은 서버 측 엔진(`localStandaloneServer` 또는 전용 서버 API)으로 이관하고 클라이언트 `optionBotEngine` DB 쓰기 호출을 제거한다.

### [F-11] `/api/local-db` `profiles` 조회 시 `profileUserIdIndex` 미사용 (P2)
- **위치**: [app/api/local-db/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/local-db/route.ts:362)
- **영향**: `memoryDb.profiles.get(targetId)`만 직접 조회하므로 `id`와 `user_id`가 다른 프로필을 `user_id`로 조회할 때 누락될 수 있다.
- **최소 수정 방향**: `memoryDb.profiles.get(targetId) ?? memoryDb.profiles.get(memoryDb.profileUserIdIndex.get(targetId) ?? '')` 패턴으로 보조 인덱스를 병행한다.

### [F-12] 관리자 시나리오·원자재 이벤트 미영속 및 `list_stock` 롤백 `marketIndex` 누락 (P2)
- **위치**: [app/api/admin/scenarios/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/admin/scenarios/route.ts:83), [209~210행](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/admin/scenarios/route.ts:209), [app/api/commodities/route.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/api/commodities/route.ts:126)
- **영향**: `inject_scenario`/`rollback_scenario`/`emergency_halt`/`trigger_event` 상태가 `MemoryDatabase.exportSnapshot()`에 저장되지 않아 재시작 시 증발하며, `list_stock` 영속 실패 롤백 시 `marketIndex`에서 신규 종목 ID를 제거하지 않는다.
- **최소 수정 방향**: `list_stock` 롤백에 `marketIndex` 정리를 추가하고, 활성 시나리오/원자재 이벤트를 스냅샷 영속 대상에 포함한다.

### [F-13] `localStandaloneServer.processMatching`의 `fee_booster` 할인 미반영 (P2)
- **위치**: [lib/engine/localStandaloneServer.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts:457)
- **호출 경로/발생 조건**: `fee_booster` 보유 사용자가 수수료 할인 기준 딱 맞는 현금(`1,001,250`원)으로 대기 매수 주문을 제출한 뒤, 후속 틱에서 `LocalMarketEngineInstance.processMatching`이 해당 주문을 테이커로 체결할 때.
- **관측 vs 기대**:
  - 관측(`CE-8b`): `Insufficient cumulative cash for buyer ce8_taker_buyer: required=1002500, available=1001250` 에러와 함께 체결 롤백(`sellFilled: 0`).
  - 기대: `dbMatching.ts:253`과 동일하게 `getEffectiveStockTakerFeeRate`를 반영해야 한다.
  - (참고: 반대로 `fee_booster` 만료 시 `calculateUserReservedCashKrw` 변화 여부는 `CE-8` 실행 결과 `reservedActive=1001250`, `reservedExpired=1001250`으로 저장된 주문 기준이 유지됨을 확인함. 단 [lib/engine/orderRisk.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/orderRisk.ts:12) TypeScript 시그니처에 `acquired_passives` 필드가 빠져 있음.)
- **최소 수정 방향**: `localStandaloneServer.ts:457`에서 `getEffectiveStockTakerFeeRate`를 호출하도록 통일한다.

### [F-14] `optionOrderService` 게이트 밖 엔타이틀먼트 변이 및 불완전 롤백 (P2)
- **위치**: [lib/options/optionOrderService.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/options/optionOrderService.ts:215), [402~408행](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/options/optionOrderService.ts:402)
- **영향**: `runWithCommitGate` 및 스냅샷 생성 이전에 `pruneExpiredProfileEntitlements`로 `profile`을 변이하고, `rollbackLocal`이 `Object.assign(curP, prevP)`만 수행해 트랜잭션 중 추가된 속성을 제거하지 않는다.
- **최소 수정 방향**: 만료 정리를 게이트·스냅샷 내부로 이동하고 `memoryStore.ts`의 키 제거 포함 복원 헬퍼를 사용한다.

### [F-15] 비결정론적 `Date.now()`/`Math.random()` ID 생성 및 `getNowMs()` 고정 Fallback (P2)
- **위치**: [lib/engine/localStandaloneServer.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localStandaloneServer.ts:364), [lib/engine/dbMatching.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/dbMatching.ts:294), [lib/memoryDb/memoryStore.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/memoryDb/memoryStore.ts)
- **영향**: `localStandaloneServer`·`dbMatching`의 `Date.now()`/`Math.random()` 기반 ID·시각 생성은 재현 결정론을 깨뜨린다. 또한 `MemoryDatabase.getNowMs()`가 실행 컨텍스트 미바인딩 시 항상 `1774000000000` (`2026-03-20T09:46:40.000Z`, `CE-9` 확인)을 반환한다.
- **최소 수정 방향**: `nextMonotonic...` 계열 단조 ID 생성기와 명시적 시계 주입을 사용한다.

### [F-16] 프론트엔드·API·표시 단위 연결 불일치 묶음 (P2)
- **위치 및 세부 내용**:
  1. [app/components/OrderEntry.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OrderEntry.tsx:11), [119~128행](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OrderEntry.tsx:119): `STOCK_TAKER_FEE_RATE = 0.0025` 하드코딩으로 `fee_booster` 50% 할인·예약 현금(`reservedCash`)·`margin_debt_krw`가 주문 가능 금액 계산에 미반영됨.
  2. [app/shop/page.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/shop/page.tsx:49): `feature_expiries`/`acquired_passives` 미조회, 보유 아이템 목록(242/251/260행)에 실제 만료일 대신 `"30일 유효"` 하드코딩, 판매 중단 카드(461/477행)의 `loading={true}` 하드코딩.
  3. [app/v2/stocks/[id]/page.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/v2/stocks/[id]/page.tsx:58): V1([app/stocks/[id]/page.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/stocks/[id]/page.tsx:64))과 달리 `id` 단건 조회만 수행해 티커 경로·채권(`bonds`) 접근 시 404 반환.
  4. [app/commodities/[id]/CommodityDetailClient.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/commodities/[id]/CommodityDetailClient.tsx:203): `<Orderbook>`에 `stockId`를 넘기지 않으며, 원자재 주문장은 `CommodityOrderBook`에 분리되어 있어 주식용 `useOrderbookData`와 연결되지 않음.
  5. [app/components/OptionsPanel.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionsPanel.tsx:442), [OptionHTSDashboard.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionHTSDashboard.tsx:187), [OptionOrderEntry.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/OptionOrderEntry.tsx:210): 옵션 포인트 가격에 `₩` 또는 `"주문 가격 (원)"` 표기 혼재.
  6. [app/components/TradeFeed.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/TradeFeed.tsx:47), [TradeFeedV2.tsx](/C:/Users/abcde/Desktop/웹소설/stock-sys/app/components/v2/TradeFeedV2.tsx:46): 채권 체결가를 `₩${Math.round(priceVal).toLocaleString()}`로 반올림해 소수 호가(`99.80` → `₩100`)가 손실됨.
- **최소 수정 방향**: 각 화면의 표시 단위(`fmtPrice`)·프로필 쿼리 필드·서버 API 연동을 백엔드 스펙에 맞게 정합화한다.

### [F-17] 일부 봇 에이전트의 `SimulationContext` 미주입 (P2)
- **위치**: [engine-server/src/bots/QuantAgent.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/QuantAgent.ts:15), [StatArbAgent.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/StatArbAgent.ts:17), [CommodityBots.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/bots/CommodityBots.ts:11)
- **영향**: `super(...)` 호출 시 `SimulationContext`를 전달받지 않아 `MarketEngine`의 시드 기반 PRNG/시계와 분리된다.
- **최소 수정 방향**: 생성자 인자에 `context?: SimulationContext`를 추가해 `super(..., context)`로 전달한다.

### [F-18] `ensureBuiltInParticipantsRegistered()` 봇 시장 구분 불일치 (P2)
- **위치**: [engine-server/src/MarketEngine.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:355) vs [459~486행](/C:/Users/abcde/Desktop/웹소설/stock-sys/engine-server/src/MarketEngine.ts:459)
- **영향**: `bot_hf_001/002`, `bot_prop_001/002`, `bot_cta_001`이 `ensureBuiltInParticipantsRegistered`에서는 `DOMESTIC_INSTITUTION`으로, 기존 폴백에서는 `FOREIGN_INSTITUTION`으로 서로 다르게 분류된다.
- **최소 수정 방향**: 단일 내장 참가자 메타데이터 정의로 통합한다.

### [F-19] 환경변수 템플릿·실행모드·레거시 스키마 불일치 (P2)
- **위치**: [lib/engine/localDevMode.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/engine/localDevMode.ts:10), [.env.production.example](/C:/Users/abcde/Desktop/웹소설/stock-sys/.env.production.example:8), [lib/rateLimit/sharedRateLimiter.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/lib/rateLimit/sharedRateLimiter.ts:99), [scripts/verify-env-alignment.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/scripts/verify-env-alignment.ts:23), [scripts/verify-schema-diff.ts](/C:/Users/abcde/Desktop/웹소설/stock-sys/scripts/verify-schema-diff.ts:100)
- **관측**:
  - `verify-env-alignment.ts`: 루트 `.env.local`과 `engine-server/.env` 간 URL(`undefined` vs `http://49.247.136.231:3001`)·키 불일치 보고.
  - `.env.production.example`은 `NEXT_PUBLIC_USE_IN_MEMORY=false`와 `http://...`를 안내하나, `localDevMode.ts`는 항상 `true`를 반환하며 `PostgresRateLimiterStore`는 `https://`만 허용.
  - `verify-schema-diff.ts`: 레거시 SQL 대비 `bonds`(5개 컬럼), `commodities`(3개 컬럼) 총 8건 불일치 보고.
- **최소 수정 방향**: 현재 로컬 독립 실행 모드 기준으로 환경 템플릿/정합성 스크립트를 정리하거나 프로덕션 분기 정책을 단일화한다.

---

## 3. 정적 검사·테스트·반례 실행 결과 요약

모든 테스트는 격리된 임시 `STOCKSYS_DATA_DIR` 환경에서 실행했다.

| 검사 항목 | 결과 | 세부 내역 |
| :--- | :--- | :--- |
| 루트 TypeScript (`npx tsc --noEmit`) | **PASS (exit 0)** | 0 errors |
| 엔진 TypeScript (`engine-server/npx tsc --noEmit`) | **PASS (exit 0)** | 0 errors |
| ESLint (`npm run lint`) | **PASS (exit 0)** | 0 errors, 147 warnings |
| 신규·핵심 회귀 13종 (`test-full-review-2026-11-18-fixes.ts`, `test-codex-review-16-fixes.ts`, `test-followup-a-to-f.ts`, `test-phase0-baseline.ts`, `test-phase1-suite.ts`, `run_settlement_verification.ts`, `test-order-security-and-atomic.ts`, `test-order-risk-and-settlement.ts`, `test-nextauth-http-integration.ts`, `test-route-handlers-e2e.ts`, `test-phase3-authoritative-derivatives-settlement.ts`, `test-phase4-engine-cas-concurrency.ts`, `test-phase4-post-commit-split-brain.ts`) | **13/13 PASS** | 격리 `STOCKSYS_DATA_DIR` 완주 (NextAuth Live HTTP 6건 포함) |
| Phase 2~4 & UI 훅·렌더 & 검증 스크립트 24종 (`test-phase2-*`, `test-phase3-*`, `test-phase4-*`, `test-use-orderbook-hook.tsx`, `test-orderbook-react-render.tsx`, `verify-env-alignment.ts`, `verify-schema-diff.ts`) | **24/24 EXIT 0** | `verify-env-alignment.ts`·`verify-schema-diff.ts`는 exit 0이나 경고/불일치 출력(F-19) |
| 격리 반례 실행 (`CE-1` ~ `CE-10`) | **확정 완료** | `CE-1`(봇 풀 0개), `CE-2b`(이중 LP 슬롯), `CE-3`(미커밋 오토세이브), `CE-4`/`4b`(채권 만기 2Y실패·연쿠폰·부채우회), `CE-5`(이벤트 음수비용 부채우회), `CE-7`(부채 계좌 대기주문 체결·취소 미상환), `CE-8b`(Standalone fee_booster 미반영), `CE-9`(고정 `getNowMs`), `CE-10`(`/api/local-db` `trades` 필터 오라클) 재현 확인. (`CE-6` 롤백 부채 유지 및 `CE-8` 예약금 유지 확인으로 오탐 배제) |

### 기존 실패(6건) 및 종료 대기(2건) 테스트 원인 분류

| 테스트 파일 | 실행 상태 | 원인 분류 (실제 결함 vs 테스트/픽스처 불일치) |
| :--- | :--- | :--- |
| `scripts/test-market-regime-foundation.ts` | `EXIT=1` | **테스트 픽스처 한계**: `addTwoSidedOrders`가 `$50` 미만 미국 주식에 정수 `Math.round(p*0.99)`·`Math.round(p*1.01)`을 적용해 `bestBid === bestAsk` 교차 장부(3/33 = `0.0909...`) 유발. |
| `scripts/test-comprehensive-audit-fixes.ts` | `EXIT=1` | **노후 테스트 API**: `ensureLocalStandaloneEngine()` 미호출 및 폐기된 `engine.processMatching([...])` 시그니처 호출(`undefined` 참조). |
| `scripts/test-concurrency-and-stale-ref.ts` | `EXIT=1` | **노후 테스트 API**: `ensureLocalStandaloneEngine()` 미호출 및 폐기된 `engine.refreshLpOrders()` 호출(`undefined` 참조). |
| `scripts/test-stage1-verification.ts` | `EXIT=1` | **테스트 기대값 노후화**: Stage 2에서 `valueStrategy.ts:135`가 고불확실성 보류 사유를 `'insufficient_profit_margin_uncertainty'`로 세분화했으나 테스트는 구 `'insufficient_profit_margin'`을 단언. |
| `scripts/test-stage2-review-fixes.ts` | `EXIT=1` | **테스트 기대값 노후화**: `C-4`가 수수료 제외 예약금 `2,000,000`을 기대하나, 현재 엔진은 0.25% 수수료 포함 `2,005,000`을 정상 예약. |
| `scripts/test-transaction-isolation.ts` | `EXIT=1` | **아키텍처 전제 불일치**: `__setTestFailureHook`이 `runWithCommitGate` 내부에서 타 종목(`Stock B`) 트랜잭션 완료를 `await`하여 단일 전역 `commitGate` 뮤텍스와 상호 대기. |
| `scripts/test-causal-market-flow.ts` | `TIMEOUT(>35s)` | **종료 핸들 누락**: 시나리오 A~H **전부 PASS** 출력 후 `main()`에 `process.exit(0)` 미호출로 백그라운드 핸들에 대기. |
| `scripts/test-market-flow-verification.ts` | `TIMEOUT(>35s)` | **종료 핸들 누락**: 전 시나리오 **PASS** 출력 후 `main()`에 `process.exit(0)` 미호출. |

---

## 4. 검토 범위 및 미검토 영역 표

| 구분 | 검토 완료 범위 | 미검토 / 제한 사항 |
| :--- | :--- | :--- |
| API · 인증 · DB 어댑터 | `sessionAuth`, `adminAuth`, `useAuth`, `nextauth`, `auth/callback`, `admin/scenarios`, `analyze`, `commodities`, `events/resolve`, `local-db`, `market-flow`, `options/*`, `orders`, `shop/purchase`, `memoryDbClient`, `db/*`, `proxy.ts` | `npm run build` 미실행 (기존 `.next` 빌드 산출물 기반 HTTP 통합 테스트만 실행). 실제 Google OAuth 외부 공급자 및 원격 PostgreSQL(`49.247.136.231:3001`) 미접속. |
| 상품 회계 · 부채 · 정산 | `orderRisk`, `dbMatching`, `currency`, `settlement`, `optionOrderService`, `commodityLedger`, `exchangeService`, `playerEventService`, `catalog`, `marketObservation`, `InMemorySettlementRepository`, `BondCouponEngine`, `OptionSettlementEngine`, `SettlementBatchService`, `settlementPolicy` | — |
| 저장 · 동시성 · 엔진 · 봇 | `memoryStore`, `PersistenceManager`, `StorageAdapter`, `accountLocks`, `memoryTransaction`, `marketService`, `localStandaloneServer`, `CommodityMarketEngine`, `CommodityOrderBook`, `agentManager`, `MarketEngine`, `restartRuntime`, `ASMarketMakerAgent`, `BaseAgent`, `ExecutionTrader`, `HedgeFundAgent`, `StatArbAgent`, `CommercialBankAgent`, `PropDeskAgent`, `QuantAgent`, `RetailSwarmAgent`, `CommodityBots`, `OptionsMMAgent`, `WallBreakerAgent`, `EventDirector`, `NewsGenerator`, `OptionsEngine`, `iNAVEngine`, `APArbitrageEngine`, `LeverageETFEngine`, `etfDefinitions`, `optionBotEngine`, `macroRegimeEngine`, `crossAssetLinkageEngine`, `institutionalSectorEngine`, `valueStrategy`, `lpStrategy`, `sharedRateLimiter` | `trendStrategy.ts`, `ArbitrageurBot` 등 일부 보조 전략·부하 테스트(`scripts/loadtest/*`) 미실행. 라이브 브라우저 DOM/Playwright UI 클릭 테스트 미실행. |
| 프론트엔드 | V1/V2 주식 목록·상세, `OrderEntry`, `ActiveOrdersPanel`, `Orderbook`/`OrderbookV2`, `TradeFeed`/`TradeFeedV2`, `TickChart`, `StockChartV2`, `PriceHeroV2`, `RealtimePriceHeader`, `BondDetailPanel`, `OptionsPanel`, `OptionOrderEntry`, `OptionHTSDashboard`, `OptionMonthChainGrid`, `OptionAccountPanel`, `etf`, `commodities` 목록·상세·주문, `exchange`, `news`, `institutions`, `market-flow`, `shop`, `v2/shop`, `mypage`, `admin`, `ScenarioController`, `RandomEventModal`, `TopBar`, `Sidebar` | 일부 서브 위젯(`FinancialPanel`, `ChatPanel`, `CrossAssetLinkageWidget` 등) 정밀 미독. |

---

## 5. 후속 수정 워커(AGY)용 우선순위 및 항목별 검증 조건

### 1순위 — 보안·회계·부채·엔진 P1 핵심 수정
1. **F-01 (`/api/local-db` `trades` 필터 오라클 차단)**: `trades` 조회 시 민감 컬럼 필터 차단 및 내부 테이블 읽기 차단.
   - *검증 조건*: 비인증 `POST /api/local-db`에서 `buyer_id`/`seller_id` 필터 시 `400/403` 반환, 정상 `stock_id` 조회는 200 유지, `test-route-handlers-e2e.ts` 통과.
2. **F-02·F-03 (채권 만기 정산·단위 및 옵션/채권 만기 `margin_debt_krw` 상환)**: 시드 채권 만기/단위 정합, 연 쿠폰 과지급 해소, 만기 지급 시 `applyCashCreditWithMarginDebt` 적용.
   - *검증 조건*: 시드 채권 만기 정산 성공 및 쿠폰 분기/명세 일치, `margin_debt_krw > 0` 계좌의 옵션/채권 만기 수령 후 부채 우선 감소 재현 확인, `test-phase3-authoritative-derivatives-settlement.ts`·`test-phase2-option-expiry-failclosed.ts` 통과.
3. **F-04·F-05 (이벤트 음수 비용 & 부채 계좌 대기 매수 주문/취소 스윕)**: `playerEventService` `cost < 0` 시 부채 우선 상환, 부채 발생 시 대기 매수 주문 차단·취소 시 해제 현금 스윕.
   - *검증 조건*: `CE-5`, `CE-7` 시나리오 재실행 시 부채(`margin_debt_krw`)가 `cash` 증가보다 우선 0까지 차감되고 부채 계좌의 기존 매수 주문 추가 체결 차단.
4. **F-06·F-07·F-08 (`MarketEngine` 오토세이브 직렬화, 봇 풀 초기화, `ASMarketMakerAgent` 호가창/중복 슬롯 제거)**:
   - *검증 조건*: `CE-1` 재실행 시 7개 특화 봇 풀 모두 > 0, `CE-2b` 부분체결 후 동일 가격 중복 LP 슬롯(`ord_` + `lp_..._slot*`) 부재, 틱 중 `saveSnapshot` 호출 시 미커밋 변이가 디스크에 기록되지 않음, `test-phase4-*` 전체 통과.
5. **F-09·F-10 (옵션 시드 단위 정합 & `optionBotEngine` 브라우저 쓰기 제거)**:
   - *검증 조건*: 시드 `opt_c_720`/`opt_p_720`의 `asset_class`·`underlying_stock_id`·`strike_price`·`ticker` 일치, 브라우저/테스트에서 `/options` 패널 진입 시 403/RPC 실패 0건.

### 2순위 — 정합성·프론트엔드·결정론·운영 P2 수정
6. **F-11~F-15**: `profiles` 인덱스 조회, `admin` `marketIndex` 정리, `localStandaloneServer` `fee_booster` 적용, `optionOrderService` 게이트·롤백 수정, 비결정론 ID 제거.
   - *검증 조건*: `CE-8b` 재실행 시 `fee_booster` 보유자 체결 성공(`1,001,250`원 차감 0잔액), `list_stock` 롤백 후 `marketIndex` 미잔존.
7. **F-16~F-19**: `OrderEntry`·`shop`·`v2/stocks/[id]`·`commodities` 호가·옵션/채권 단위 표기, 봇 `SimulationContext` 전달, 봇 시장 구분 통일, 환경/스키마/노후 테스트 8건 정리.
   - *검증 조건*: 루트/`engine-server` `tsc --noEmit`, `npm run lint`, `npm run build`, 격리 `next start` HTTP 스모크 및 전체 회귀 테스트 suite `EXIT=0`.

---

## 6. 재현 명령 (후속 워커 검증용)

> 모든 반례 검증은 임시 디렉터리의 `STOCKSYS_DATA_DIR`에서만 실행해 운영 `.data`를 보호한다.

```powershell
# 1) 타입 검사 & Lint
npx tsc --noEmit
Push-Location engine-server; npx tsc --noEmit; Pop-Location
npm run lint

# 2) 핵심 회귀 테스트 격리 실행 예시
$tmp = Join-Path $env:TEMP ("stocksys_verify_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
$env:STOCKSYS_DATA_DIR = $tmp
try {
  npx tsx scripts/test-full-review-2026-11-18-fixes.ts
  npx tsx scripts/test-codex-review-16-fixes.ts
  npx tsx scripts/test-followup-a-to-f.ts
  npx tsx scripts/test-route-handlers-e2e.ts
  npx tsx scripts/test-nextauth-http-integration.ts
  npx tsx scripts/test-phase4-engine-cas-concurrency.ts
  npx tsx scripts/test-phase4-post-commit-split-brain.ts
} finally {
  Remove-Item Env:\STOCKSYS_DATA_DIR -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
```

### 주요 반례 재현 스니펫 (격리 `npx tsx` 실행)
- **F-07 / F-08 (`MarketEngine` 봇 풀 0개 & 부분체결 LP 중복)**: `MemoryDatabase`에 1종목·매도 1주 등록 후 `new MarketEngine({ simulationContext, repositories }).initializeBots()` 및 `tick()` 실행 → `institutionalBots.length === 15`, 타 봇 풀 `0`, `ord_...` 부분체결 주문과 `lp_<id>_buy_slot0` 동시 잔존 확인.
- **F-02 / F-03 / F-04 / F-05 (`margin_debt_krw` 우회 및 채권 만기)**:
  - `settleBondMaturityAtomically`: 시드 `bond_kr_2y`는 `INVALID_MATURITY_DATE` 반환, `maturity` ISO 설정 후 호출 시 `payout = 103,250`(연 쿠폰 포함)이 `margin_debt_krw=5000` 상환 없이 `cash` 가산.
  - `resolvePlayerEventChoice`: `choice_a_cost = -200_000` 선택 시 `cash = 200_000`, `margin_debt_krw = 500_000`.
  - `LocalMarketService.submitOrder`(매수) → `applyCashDeltaWithMarginDebt(-500_000)` → `submitOrder`(매도) 체결 후 `cancelOrder` 시 `buyerCash=602200, buyerDebt=302000`.
- **F-01 (`/api/local-db` 필터 오라클)**: 비인증 `POST`로 `{ action: "execute", tableName: "trades", query: { action: "select", filters: [{ col: "buyer_id", op: "eq", val: "<uid>" }] } }` 전송 시 `HTTP 200` 및 해당 사용자 거래 건수/ID 노출 확인.
