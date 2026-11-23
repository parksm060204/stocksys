# 전체 작업본 재리뷰 — 2026-11-20 18:19

대상: HEAD `7008f55` 위의 현재 미커밋 수정·신규 파일을 포함한 작업본. 앞선 F01~F10, AR-01~04, TopBar 수정 이후 상태를 검토했다. 애플리케이션·설정·기존 테스트 소스는 수정하지 않았다.

**확정 결함 7건: P1 5건, P2 2건.** 발견 사항은 기존 보고서의 해결 항목을 단순 재기재한 것이 아니라 추가 실행 조건에서 확인한 문제다. P1 한 건은 독립 engine-server 배포 경로에 해당한다.

## 검토 범위

전체 파일 목록을 확인하고 아래 활성 실행 경로를 정적 검토했다. 타입 검사와 대표 회귀 검증으로 범위를 보완했으며, 모든 파일의 모든 분기를 동적으로 실행했다는 의미는 아니다.

| 영역 | 검토한 대표 경로 |
|---|---|
| 인증·권한·API | NextAuth callbacks/안전 handler, sessionAuth/adminAuth, proxy, local-db의 공개·본인·관리자 테이블/RPC, news accessPolicy, analyze/rateLimit, shop/purchase, orders/options/commodities/events/admin 라우트 |
| 현금·정산·예약 | dbMatching, settlement, orderRisk, optionOrderService, commodityLedger, exchangeService, playerEventService, OptionSettlementEngine/BondCouponEngine/SettlementBatchService |
| 메모리 DB·영속화 | memoryStore의 초기화·스냅샷·인덱스·멱등 장부, memoryDbClient, memoryTransaction, accountLocks, PersistenceManager, StorageAdapter |
| 시장 엔진 | localStandaloneServer, AgentManager/관측·주문 경로, ScenarioManager, CommodityMarketEngine/OrderBook, 독립 MarketEngine/index/restartRuntime 및 위험 정책 |
| 화면·데이터 연결 | TopBar, V1/V2 종목 상세·뉴스·체결, 옵션 dashboard/account/order, 원자재 상세/주문, ETF 선택·주문, mypage, exchange 및 V2 래퍼 |
| 설정·검증 | 루트/engine-server package.json·tsconfig, next.config, gitignore, README, 기존 회귀 스크립트. 비활성 archive 경로는 현재 운영 경로와 구분 |

## R2-01 [P1] 시장 초기화 후 원자재 구주문이 남아 틱 정산이 반복 실패

- 위치: `lib/engine/localStandaloneServer.ts:125`, `app/api/local-db/route.ts:284`, `lib/commodities/CommodityMarketEngine.ts:536`·`:545`·`:738`·`:779`, `lib/commodities/commodityLedger.ts:464`.
- 원인: 초기화는 같은 MemoryDatabase 인스턴스의 원자재 주문·예약 장부를 지우지만 별도 CommodityMarketEngine의 오더북/봇 상태를 초기화하지 않는다. `reconcileWithDatabase()`는 이미 연결한 동일 객체이면 바로 반환하므로 DB 내부 초기화를 감지하지 못한다. 이후 구주문 매칭은 예약금 누락으로 실패하고 틱 롤백은 구주문을 다시 오더북에 복원한다.
- 재현: 별도 DB + 기본 봇 50개 엔진을 reconcile한 뒤 실제 `reserveMarginAndSubmitCommodityOrder()`로 CRUDE_OIL 매수가 1,000,000, 1계약 주문을 접수했다. DB 초기화 후 같은 DB로 reconcile하고 실제 `stepTickAsync()`를 두 번 실행했다. 별도 수동 상대 주문을 주입하지 않고 기본 봇과 매칭했다.

```json
{"submitSuccess":true,"commodity":"CRUDE_OIL","dbOpenOrders":0,"steps":1,"firstError":"주문 예약 증거금을 찾을 수 없습니다: orderId=usr_e1_t0_s1","secondError":"주문 예약 증거금을 찾을 수 없습니다: orderId=usr_e1_t0_s1"}
```

- 영향: 시장 초기화 이후 원자재 엔진이 반복 롤백할 수 있다. 이전 초기화 시점의 주문은 화면/DB에서는 사라져 사용자가 취소하기도 어렵다.
- 수정 방향: 초기화를 주식·옵션·원자재 런타임과 장부의 공통 reset 절차로 처리하고, DB reset version/epoch 변화를 원자재 reconcile이 감지하도록 한다. 오더북·예약·봇 상태·시퀀스가 같은 초기화 경계에 있어야 한다.

## R2-02 [P1] 상점의 상속 속성 상품ID가 현금을 NaN으로 손상시킴

- 위치: `app/api/shop/purchase/route.ts:38`·`:45`·`:70`·`:83`·`:92`; `lib/shop/catalog.ts`의 일반 객체 `SHOP_PRODUCTS`.
- 원인: `SHOP_PRODUCTS[productId]`의 truthy 여부만 검사하여 `__proto__`, `constructor` 같은 상속 속성도 상품으로 인정한다. `product.price`가 undefined여도 부족 금액 비교가 거짓으로 평가된다. 먼저 현금을 NaN으로 변경한 뒤 기간 계산이 예외를 발생시키고, 최상위 catch는 변경된 프로필을 복구하지 않는다.
- 재현: 실제 POST handler에 개발 게스트 세션으로 아래 JSON을 전송했다. 별도 임시 데이터에서 수행했다.

```json
{"itemType":"product","productId":"__proto__"}
```

```json
{"status":500,"before":100000000,"cashIsNaN":true,"reply":{"success":false,"message":"Invalid time value"}}
```

- 영향: 거절되어야 할 요청 1회로 로그인 사용자의 장부 현금이 손상된다. 이후 자동 저장이 이 상태를 저장할 위험도 있다. 이번 재현에서는 저장을 유발하지 않고 메모리 손상만 확인했다. 다른 사용자의 자산을 직접 변경한 것으로 주장하지 않는다.
- 수정 방향: own-property allowlist/Map 조회를 사용하고 상품의 price/duration/id를 변경 전에 검증한다. 구매 도중 예외에도 원본 자산·권한을 복원하는 트랜잭션 경계를 둔다.

## R2-03 [P1] ETF 선택 직후 매수하면 이전 종목 주문이 제출됨

- 위치: `app/etf/page.tsx:25`·`:138`·`:181`·`:208`·`:244`.
- 원인: `handleSelectETF()`는 selectedTicker만 바꾸고 serverStockId/serverStockPrice를 이전 값으로 유지한다. 새 종목 조회가 끝나기 전에도 주문 버튼은 활성화되어 있고, 주문 함수는 현재 ticker와 연결되었는지 확인하지 않은 serverStockId를 사용한다. 이전 요청을 취소하거나 응답의 ticker를 확인하는 처리도 없다.
- 재현: JSDOM에서 실제 ETFPage와 ETFItemCard를 React로 렌더링했다. KODEX200의 서버 응답을 완료시킨 뒤 SPY 카드의 실제 클릭 요소를 눌렀다. SPY 조회 응답은 Promise로 보류하고 화면의 BUY 버튼을 눌러 실제 fetch(`/api/orders`) 본문을 관찰했다. 자산 데이터 조회·인증만 mock했으며 실제 주문 함수는 변경하지 않았다.

```json
{"selectedTicker":"SPY","blockedSpyRequests":2,"submittedStockId":"etf_KODEX200","submittedPrice":35000}
```

- 영향: 사용자가 확인한 종목과 다른 자산의 매수/매도 주문이 서버로 전송된다.
- 수정 방향: 선택한 ticker와 서버 조회 결과를 함께 저장하고, 동일 자산으로 확인된 경우에만 주문을 허용한다. 종목 전환 즉시 이전 식별자/가격을 무효화하고 요청 취소·세대 번호 등으로 늦은 응답의 덮어쓰기를 막는다.

## R2-04 [P1] 잠금 대기 중 만기가 지난 옵션도 체결 가능

- 위치: `lib/options/optionOrderService.ts:94`·`:132`·`:158`·`:405`.
- 원인: 현재 시각과 계약 만기를 주문 함수 진입 시 한 번만 검사한다. 종목·계좌·커밋 게이트 대기 후에는 거래 동결만 재검사하고 만기는 재검사하지 않는다. 진입 시각의 nowMs가 나중의 자격/유효성 검증에도 재사용된다.
- 재현: 주입 MemoryDatabase, 유효한 옵션 거래 자격 계좌와 1초 뒤 만기인 옵션을 준비했다. 실제 종목 락을 먼저 잡고 MARKET BUY 1계약을 시작했다. Date.now를 통제하여 같은 계약의 만기보다 1초 뒤로 진행한 후 락을 풀었다. 계약 만기 자체를 바꾸지 않고 실제 주문 경로의 대기 전후 시각만 바꿨다.

```json
{"expiredAtCommit":true,"success":true,"status":200,"filled":1,"holding":1}
```

- 영향: 이미 만기인 옵션에 새 보유가 생성될 수 있다. 만기 정산·미체결 종료와의 경합이 다시 발생한다. 이미 정산한 동일 사용자의 새 보유가 멱등 키로 인해 정산에서 제외되는 후속 문제는 이번에 별도 재현하지 않았다.
- 수정 방향: 실제 주문 확정 경계에서 최신 계약·시각으로 만기를 재검증하고, 대기 중 변경될 수 있는 호가/자격/계약 정보도 재검토한다. 시계는 테스트 주입을 유지하면서 실제 확정 시점을 표현해야 한다.

## R2-05 [P1, 독립 engine-server] 빌드는 성공하지만 npm start 방식으로 기동 불가

- 위치: `engine-server/package.json:8`·`:9`, `engine-server/tsconfig.json:10`·`:23`, `lib/commodities/commodityLedger.ts:8` 등 런타임 `@/` import.
- 원인: engine-server의 build는 순수 tsc, start는 일반 Node의 CommonJS 실행이다. tsc의 paths 설정은 출력 JS의 `@/` import를 해석 가능한 상대 경로로 바꾸지 않으며 start에는 alias resolver/bundler가 없다. tsx로 실행하는 회귀 테스트는 별칭을 해석하므로 이 장애를 잡지 못한다.
- 재현: 실제 engine-server tsconfig를 사용하되 outDir만 새 임시 디렉터리로 변경해 컴파일했다. dependencies를 찾을 수 있도록 NODE_PATH에 프로젝트 node_modules를 지정하고, start와 같은 일반 Node로 임시 빌드의 `engine-server/src/index.js`를 실행했다. 데이터 디렉터리도 임시 경로를 사용했다.

```text
ENGINE_TEMP_BUILD_EXIT=0
Node process exit=1
Error: Cannot find module '@/lib/memoryDb/accountLocks'
Require stack: lib/commodities/commodityLedger.js
 → lib/commodities/CommodityMarketEngine.js
 → engine-server/src/MarketEngine.js
 → engine-server/src/index.js
```

- 영향: 문서화된 별도 엔진의 build→start 배포 경로가 import 단계에서 실패한다. Next.js 내부 Standalone이 기동 불가하다는 뜻은 아니다.
- 수정 방향: 독립 서버 빌드에서 alias를 rewrite/bundle하거나, 검증된 런타임 resolver를 start에 포함한다. 검증은 tsx 테스트뿐 아니라 실제 빌드 산출물을 일반 Node로 기동하는 단계까지 포함한다.

## R2-06 [P2] 마이페이지 USD 자산 평가에 실제 환율 대신 1380 사용

- 위치: `app/mypage/page.tsx:77`·`:148`·`:153`·`:209`, `lib/engine/currency.ts:46`.
- 원인: `getUsdFxRateFromDb()`는 `{ exchangeRates: [...] }` 객체를 받지만 호출부는 ratesData 배열 자체를 전달한다. helper가 환율을 찾지 못해 항상 DEFAULT_USD_TO_KRW_RATE=1380을 반환한다. 외화 현금은 다른 getRate()를 사용하므로 같은 화면 안에서도 계산 기준이 달라진다.
- 재현: 현재 호출 형태와 올바른 형태에 같은 환율 데이터를 전달해 실제 helper 결과를 비교했다.

```json
{"currentMypageCall":1380,"correct":2000}
```

- 입력: `[{"currency_code":"USD","rate_to_krw":2000}]`. USD 자산 $100은 현재 코드에서 138,000원, 실제 환율로는 200,000원으로 평가된다. 이 사례는 helper 직접 실행과 호출부 추적으로 검증했으며 MyPage 전체 화면 렌더링을 따로 실행한 것은 아니다.
- 영향: 해외주식·USD ETF 평가액/손익/총자산이 실제 정산 환율과 불일치한다.
- 수정 방향: 올바른 객체 구조를 전달하고 API 응답 타입을 명시하여 any가 인자 오류를 숨기지 않게 한다.

## R2-07 [P2] 환전 화면 로그아웃 후에도 이전 계정 잔액 표시

- 위치: `app/exchange/page.tsx:63`·`:77`·`:86`·`:98`, `app/v2/exchange/page.tsx`의 동일 화면 재사용.
- 원인: 로그아웃 시 `fetchRatesAndBalances(null)`을 호출하지만 이 함수는 `if (!uid) return`하여 balances를 비우지 않는다. 요청 취소/계정별 응답 확인도 없어 전환 전 요청이 늦게 도착하면 새 세션의 표시를 덮어쓸 수 있는 구조다.
- 재현: 실제 Exchange 컴포넌트를 React/JSDOM으로 렌더링해 로그인 계좌 현금 123,456,789원을 로드했다. auth 상태를 로그아웃으로 바꾸고 재렌더/효과 실행을 기다린 뒤 DOM을 확인했다.

```json
{"loadedOwnerBalance":true,"balanceStillVisibleAfterLogout":true}
```

- 영향: 로그아웃 뒤에도 같은 화면에서 이전 사용자의 자산이 표시된다. 이는 클라이언트 잔존 표시 결함이며 서버에서 타인 자산을 새로 조회할 수 있음을 재현한 것은 아니다. 계정 전환의 지연 응답 경합은 코드상 관찰이며 별도 동적 재현은 하지 않았다.
- 수정 방향: 인증/사용자 변경 시 잔액을 즉시 초기화하고, 계정 ID와 응답 세대를 함께 검증한다. 앞서 TopBar에서 적용한 원칙을 이 화면에도 적용한다.

## 기준 검사와 회귀 결과

| 검사 | 결과 |
|---|---|
| 루트 `node node_modules/typescript/bin/tsc --noEmit --incremental false` | exit 0 |
| engine-server `node ../node_modules/typescript/bin/tsc --noEmit --incremental false` | exit 0 |
| `node node_modules/eslint/bin/eslint.js . --quiet` | exit 0; 오류 없음, 경고 건수는 이번 실행에서 집계하지 않음 |
| engine-server 임시 출력 디렉터리 tsc 빌드 | exit 0 |
| 해당 산출물 일반 Node 기동 | **exit 1**, R2-05 재현 |
| 아래 기존 회귀 스크립트 22개 | 모두 exit 0 |

회귀 스크립트는 각 프로세스 시작 전에 별도 임시 `STOCKSYS_DATA_DIR`를 설정하고 `node --import tsx scripts/<파일명>`으로 실행했다. 각 로그는 `%TEMP%/stocksys-review-*.log`에 보존했다.

1. test-topbar-cash-runtime.tsx
2. test-post-fix-review-2026-11-20-fixes.ts
3. test-full-review-2026-11-20-fixes.ts
4. test-reachable-security-fixes.ts
5. test-route-handlers-e2e.ts
6. test-order-risk-and-settlement.ts
7. test-phase4-mid-write-rollback.ts
8. test-phase4-post-commit-split-brain.ts
9. test-phase1-suite.ts
10. test-full-review-2026-11-19-fixes.ts
11. test-order-security-and-atomic.ts
12. test-phase2-bot-portfolio-authority.ts
13. test-phase2-option-expiry-failclosed.ts
14. test-phase2-order-settlement-concurrency.ts
15. test-phase3-authoritative-derivatives-settlement.ts
16. test-phase3-admin-scenario-engine-integration.ts
17. test-phase4-engine-cas-concurrency.ts
18. test-market-flow-verification.ts
19. test-regression-settlement-auth-ai.ts
20. test-use-orderbook-hook.tsx
21. test-orderbook-react-render.tsx
22. test-cross-asset-full-suite.ts

기존 F01~F10, AR-01~04, TopBar 회귀가 통과하더라도 위 새 경계 조건까지 통과한다는 뜻은 아니다. 신규 재현은 제품/기존 테스트 소스를 바꾸지 않는 Node/tsx 인라인 코드로 실행했다. ETF 첫 시도에서 카드가 button이라고 가정해 selector를 찾지 못한 결과는 폐기하고 실제 clickable div로 재검증했다. 원자재 첫 2봇 검증은 구주문 잔존만 확인했으며, 최종 50봇 검증에서 추가 수동 주문 없이 반복 정산 실패를 확인했다.

## 미검증·추가 점검 후보 및 한계

- `lpLiabilities`는 옵션 발행 시 증가하지만 매입 환매/만기 시 감소시키는 사용처를 찾지 못했다. LP 전체 자산·의무의 정확한 회계 정책 확인과 별도 재현이 필요하며 위 7건에 포함하지 않았다.
- `profile.id !== user_id`인 레거시 스냅샷에 대해 일부 경로는 인덱스를 경유하고 상점/환전/이벤트 등은 직접 profiles.get(userId)를 사용한다. 정상 로그인에서 동일 ID로 생성되므로 이번 실행에서는 레거시 문제를 확정하지 않았다.
- `.data/`가 gitignore에 없고 작업 트리에서 untracked로 보인다. 데이터 파일의 배포/커밋 제외 정책 점검 후보이며 실제 외부 유출을 확인한 것은 아니다. 내용이나 비밀 값은 출력하지 않았다.
- 원격 PostgreSQL, 외부 AI/시세 서비스의 실제 응답, 실계정 OAuth, 실제 브라우저 클릭 E2E, 최신 Next.js production build/HTTP 배포는 이번에 실행하지 않았다. UI 재현은 실제 컴포넌트의 JSDOM 렌더/효과/이벤트와 mock 통신을 사용했다.
- 운영 `.data`를 직접 수정하거나 서버를 재시작하지 않았다. 실행 중인 개발 서버의 독립적인 저장 동작은 이 리뷰에서 중단하지 않았다. 수정·커밋·푸시·배포도 수행하지 않았다.
