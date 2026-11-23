# 전체 작업본 재리뷰(R2-01~07) 수정 및 검증 결과 — 2026-11-20 22:33

대상 발견 보고서: [full-code-review-2026-11-20-rereview-findings.md](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/docs/full-code-review-2026-11-20-rereview-findings.md) (`R2-01`~`R2-07`, `P1` 5건 / `P2` 2건)

일곱 결함 모두 수정 및 회귀 검증을 완료했다. 원본 발견 보고서(`docs/full-code-review-2026-11-20-rereview-findings.md`)는 수정하지 않고 보존했다.

---

## R2별 수정 요약 및 최종 동작

### R2-01 [P1] 시장 초기화 후 원자재 구주문이 남아 틱 정산이 반복 실패
- **수정 파일**
  - [memoryStore.ts](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/lib/memoryDb/memoryStore.ts)
  - [CommodityMarketEngine.ts](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/lib/commodities/CommodityMarketEngine.ts)
  - [localStandaloneServer.ts](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/lib/engine/localStandaloneServer.ts)
  - [app/api/local-db/route.ts](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/app/api/local-db/route.ts)
  - [app/api/commodities/route.ts](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/app/api/commodities/route.ts)
- **최종 동작**
  - `MemoryDatabase`에 `commodityResetVersion`(시드 초기화 세대)과 `commoditySnapshotVersion`(스냅샷 `importSnapshot`/초기화 세대)을 추가하고, 트랜잭션 롤백(`restoreRollbackSnapshot`)은 세대 증가가 아닌 원상태 복원으로 구분했다.
  - `CommodityMarketEngine`은 `reconcileWithDatabase(db)`에서 `reconciledDb === db`뿐 아니라 `reconciledResetVersion` 및 `reconciledSnapshotVersion`까지 검사해 동일 DB 객체여도 초기화·스냅샷 교체를 감지한다. 시드 초기화 감지 시 생성자에서 보관한 `initialRuntimeSnapshot`(오더북·봇 자산/포지션/히스토리·시세·이벤트·PRNG)과 `scenarioManager`를 초기 상태로 복원한 뒤 DB와 재동기화한다.
  - `stepTickAsync()` 진입 시 이미 reconcile된 엔진이 DB 세대 불일치를 감지하면 틱 실행 전 `reconcileWithDatabase`를 자동 수행한다.
  - `resetStandaloneMarketAtomically`를 도입해 `LocalMarketEngineInstance.resetSimulation()`과 `POST /api/local-db` (`action: 'reset_market'`)가 연결된 모든 `CommodityMarketEngine`의 `runWithTickLock` → `withAllStockLocks` → `runWithCommitGate` 순서로 락을 획득해 초기화·재동기화·영속 저장을 원자적으로 실행하며, 저장 실패/예외 시 DB와 원자재 엔진 런타임·reconcile 메타데이터를 모두 롤백한다.

### R2-02 [P1] 상점의 상속 속성 상품ID가 현금을 NaN으로 손상시킴
- **수정 파일**
  - [catalog.ts](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/lib/shop/catalog.ts)
  - [app/api/shop/purchase/route.ts](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/app/api/shop/purchase/route.ts)
- **최종 동작**
  - `SHOP_PRODUCT_MAP` 및 `getShopProductById(productId)`를 도입해 `Object.prototype.hasOwnProperty.call`과 `Map` 조회로 `__proto__`, `constructor`, `toString`, `valueOf`, `hasOwnProperty` 등 상속 속성 및 비문자열·범위 외 가격/기간 상품을 변경 전 400으로 거절한다.
  - `news_subscription` 경로의 `outletId`/`days`도 `parseStrictPositiveInt`로 검증해 `Number(true) === 1` 같은 비정상 형변환을 차단한다.
  - `withAccountLocks` + `runWithCommitGate` 내부에서 `pruneExpiredProfileEntitlements` 호출 전 프로필 전체 스냅샷(`structuredClone(profile)`)을 확보하고 `try-catch` 및 `saved === false` 분기 모두 `restoreProfileSnapshot`으로 현금과 권한 원본을 복구한다.

### R2-03 [P1] ETF 선택 직후 매수하면 이전 종목 주문이 제출됨
- **수정 파일**
  - [app/etf/page.tsx](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/app/etf/page.tsx)
- **최종 동작**
  - `serverStockId`/`serverStockPrice` 분리 상태를 `syncedEtf: { ticker, stockId, price } | null` 단일 계약으로 통합하고 `etfSyncSeqRef` 세대 번호 및 `selectedTickerRef`를 도입했다.
  - `handleSelectETF`로 종목을 전환하는 즉시 `syncedEtf`를 `null`로 무효화하고 `etfLoading`을 활성화해, 새 종목의 서버 응답이 완료되고 `syncedEtf.ticker === selectedEtf.etfTicker`가 확인되기 전에는 매수/매도 버튼을 비활성화하고 `handleUserTrade`에서도 주문을 차단한다.
  - 지연 도착한 이전 종목 응답은 `reqSeq !== etfSyncSeqRef.current || selectedTickerRef.current !== reqTicker` 검사로 폐기하며, 주문 제출 직전 오더북 RPC 대기 중 종목이 바뀐 경우에도 전송하지 않는다.

### R2-04 [P1] 잠금 대기 중 만기된 옵션도 체결 가능
- **수정 파일**
  - [optionOrderService.ts](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/lib/options/optionOrderService.ts)
- **최종 동작**
  - `OptionOrderSubmitInput`에 선택적 `now?: () => number` 클록을 추가하고 `getCurrentNowMs()`로 진입·종목 락·계좌 락·`runWithCommitGate` 각 경계에서 현재 시각을 동적으로 조회하도록 수정했다(기존 고정 `nowMs` 주입 테스트 계약은 유지).
  - `withStockLock` 내부에서 authoritative 계약과 LP 호가를 다시 조회하고, `runWithCommitGate` 내부에서도 `commitNowMs` 기준으로 최신 계약 존재·단위 정합·만기(`latestExpiryMs <= commitNowMs` 시 400 거절)·승수/LP 호가 불변·거래 동결·옵션 자격증(`pruneExpiredProfileEntitlements`)을 모두 재검증한다.

### R2-05 [P1, 독립 engine-server] 빌드는 성공하지만 npm start 방식으로 기동 불가
- **수정 파일**
  - [engine-server/package.json](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/engine-server/package.json)
  - [rewrite-aliases.mjs](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/engine-server/scripts/rewrite-aliases.mjs) (신규; 구 `.cjs` 제거)
  - [README.md](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/README.md)
- **최종 동작**
  - `engine-server/package.json`의 `build` 스크립트를 `tsc && node scripts/rewrite-aliases.mjs`로 변경해 `dist/` 내 모든 `.js`/`.d.ts` 산출물의 `@/` 경로 별칭을 실제 상대 경로로 치환하고 대상 파일 존재 여부를 검증한다.
  - `start`(`node dist/engine-server/src/index.js`)는 추가 런타임 의존성 없이 일반 Node로 기동되며, `README.md`의 빌드/실행 안내를 최종 구현과 일치시켰다.

### R2-06 [P2] 마이페이지 USD 자산 평가에 실제 환율 대신 1380 사용
- **수정 파일**
  - [mypageSummary.ts](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/lib/portfolio/mypageSummary.ts) (신규)
  - [app/mypage/page.tsx](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/app/mypage/page.tsx)
- **최종 동작**
  - `computeMyPagePortfolioSummary`를 명시적 응답 타입(`MyPageProfileRow`, `MyPageHoldingRow`, `MyPageExchangeRateRow`, `MyPageOptionContractRow`, `MyPageBondRow`)으로 추출해 `any`로 인한 호출 오류 은폐를 제거했다.
  - `getUsdFxRateFromDb({ exchangeRates })` 형태로 올바른 객체를 전달하며, 해외주식·USD ETF 평가액/원가/손익·총자산과 외화 현금(`usdInKrw`) 모두 동일한 서버 `usdToKrw` 환율을 사용하고 실제 환율 부재 시에만 `1380` fallback을 적용한다. 국내 KRW 자산은 1:1 원화 계산을 유지한다.

### R2-07 [P2] 환전 화면 로그아웃 후에도 이전 계정 잔액 표시
- **수정 파일**
  - [app/exchange/page.tsx](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/app/exchange/page.tsx)
  - [app/v2/exchange/page.tsx](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/app/v2/exchange/page.tsx) (래퍼 재사용으로 동일 동작 확인)
- **최종 동작**
  - 잔액 상태를 소유자 ID와 결합한 `balanceState: { userId: string; balances: UserBalances } | null`로 변경하고 `hasValidUserBalances = Boolean(currentUid && balanceState && balanceState.userId === currentUid)`로 렌더링을 게이팅했다.
  - 로그아웃(`!currentUid`) 또는 계정 전환 시 즉시 `balanceState`를 비우고 로그인 안내/로딩 상태를 표시해 이전 계정 잔액이 렌더링되지 않으며, `balanceRequestSeqRef` + `activeAuthUserIdRef`로 로그아웃 후·계정 전환 후 늦게 도착한 응답을 무시한다. `parseProfileBalances`로 `NaN`/비문자/음수 등 비정상 잔액도 차단한다.

---

## 검증 결과 및 실측 근거

모든 테스트는 임시 `STOCKSYS_DATA_DIR` / `ENGINE_SERVER_DATA_DIR` 및 격리된 `MemoryDatabase`를 사용해 실행했으며, 운영 `.data/` 및 원격 DB는 수정하지 않았다.

### 1. 최종 코드 기준 전체 검사 (최종 수정 이후 실행)

| 검사 항목 | 실행 명령 | Exit Code | 실측 요약 |
|---|---|---|---|
| 루트 TypeScript | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | `0` | `ROOT_TSC_EXIT=0` (오류 0건) |
| 엔진 TypeScript | `node node_modules/typescript/bin/tsc -p engine-server/tsconfig.json --noEmit --incremental false` | `0` | `ENGINE_TSC_EXIT=0` (오류 0건) |
| 전체 ESLint | `node node_modules/eslint/bin/eslint.js . --quiet` | `0` | `ESLINT_EXIT=0` (오류 0건) |
| 독립 엔진 빌드 | `npm --workspace engine-server run build` | `0` | `Rewrote 18 @/ specifier(s) across 7 file(s)`, `ENGINE_BUILD_EXIT=0` |
| 독립 엔진 Node 기동 스모크 | 임시 `ENGINE_SERVER_DATA_DIR`, 포트 `49258`에서 `node dist/engine-server/src/index.js` 기동 후 `http://127.0.0.1:49258/` 조회 및 `SIGTERM` 종료 | `0` | `ENGINE_START_PORT=49258 HTTP_STATUS=200 BODY="STOCKSYS Market Engine is running."` |
| R2-01~07 신규 회귀 스위트 | 임시 `STOCKSYS_DATA_DIR` 설정 후 `node --import tsx scripts/test-r2-01-to-07-fixes.tsx` | `0` | `R2-01`~`R2-07` 7개 시나리오 전부 통과 (`R2_SUITE_EXIT=0`) |

### 2. R2-01~07 신규 회귀 테스트 상세 ([test-r2-01-to-07-fixes.tsx](file:///C:/Users/abcde/Desktop/%EC%9B%B9%EC%86%8C%EC%84%A4/stock-sys/scripts/test-r2-01-to-07-fixes.tsx))
- **R2-01**: 기본 50봇 + `CRUDE_OIL` 지정가 매수(1,000,000 / 1계약) → `resetToSeedData()` → 동일 DB `reconcileWithDatabase(db)` → `stepTickAsync()` 2회 정상 완료(구주문·예약 0건), 정상 restart `importSnapshot` 복원 유지, `resetStandaloneMarketAtomically` 저장 실패 시 롤백, 실제 `POST /api/local-db` (`reset_market`) 성공 후 2틱 완료 검증.
- **R2-02**: 실제 `POST /api/shop/purchase`에 `__proto__`, `constructor`, `toString`, `valueOf`, `hasOwnProperty`, `""`, `null`, `123`, `outletId: true` 전송 시 모두 4xx + 현금 불변(100,000,000)·권한 불변, 잔액 부족 400, `persistenceManager.saveSnapshot` false 반환 및 예외 throw 시 현금/권한 완전 롤백, 정상 구매(200) 검증.
- **R2-03**: JSDOM 실제 `ETFPage` 클릭으로 `KODEX200` 주문(`etf_KODEX200`, `35000`) → `SPY` 클릭 후 응답 보류 중 BUY/SELL 버튼 disabled 및 `/api/orders` 호출 0건 → `SPY` 응답 완료 후 BUY/SELL 모두 `etf_SPY`/`500` 전송 → `KODEX200` 지연 응답이 늦게 도착해도 `SPY` 유지 검증.
- **R2-04**: `withStockLock(contract.id)` Promise barrier 진입 전 `T0`(만기 1초 전)로 `submitAuthoritativeOptionOrder` 시작 → 대기 중 `Date.now`만 `T0+2000`으로 이동(계약 만기일 미변경) → 락 해제 시 400 거절 및 현금·보유·주문·`lpLiabilities` 불변, 만기 전 정상 주문(200) 성공 검증.
- **R2-05**: 임시 `outDir`에 `tsc -p engine-server/tsconfig.json --outDir ...` + `rewrite-aliases.mjs` 실행, 산출물 `require("@/` 잔존 0건 확인, 일반 `node` 기동 후 전용 포트 HTTP 200 응답 확인 및 프로세스 종료.
- **R2-06**: `ratesData = [{ currency_code: 'USD', rate_to_krw: 2000 }]`에서 `computeMyPagePortfolioSummary`로 $100 해외주식(`AAPL`), $100 USD ETF(`SPY`), $100 USD 현금 모두 `200,000`원(138,000원 아님)으로 계산되고 국내 주식(`005930`)은 1:1 KRW 유지 확인.
- **R2-07**: JSDOM 실제 `CurrencyExchangePage` 및 `V2ExchangePage`에서 로그인 잔액(`123,456,789` / `99,888,777`) 로드 → 로그아웃 시 즉시 미표시, A 지연 응답 Promise barrier 중 B(`777,000`) 전환 및 늦은 A 응답 무시, 비정상 `cash: 'invalid'` 차단 검증.

### 3. Next.js 프로덕션 빌드 및 기존 회귀 23개 스위트
*(최종 `rewrite-aliases.cjs`→`.mjs` 파일명 정리 직전, 모든 `app/`·`lib/` 코드 수정 완료 상태에서 실행; 이후 변경은 `engine-server/scripts/rewrite-aliases.mjs`·`engine-server/package.json`·문서만 해당)*

- **Next.js 프로덕션 빌드**: 임시 `STOCKSYS_DATA_DIR` 환경으로 `npm run build` 실행 → **exit 0** (28개 App Router 정적/동적 라우트 및 TypeScript 검사 통과).
- **기존 회귀 23개 스위트**: 각 프로세스별 임시 `STOCKSYS_DATA_DIR` 격리 실행 → **23건 전부 exit 0 (`TOTAL_FAILED=0`)**:
  1. `test-topbar-cash-runtime.tsx` (`EXIT=0`)
  2. `test-post-fix-review-2026-11-20-fixes.ts` (`EXIT=0`)
  3. `test-full-review-2026-11-20-fixes.ts` (`EXIT=0`)
  4. `test-reachable-security-fixes.ts` (`EXIT=0`)
  5. `test-route-handlers-e2e.ts` (`EXIT=0`)
  6. `test-order-risk-and-settlement.ts` (`EXIT=0`)
  7. `test-phase4-mid-write-rollback.ts` (`EXIT=0`)
  8. `test-phase4-post-commit-split-brain.ts` (`EXIT=0`)
  9. `test-phase1-suite.ts` (`EXIT=0`)
  10. `test-full-review-2026-11-19-fixes.ts` (`EXIT=0`)
  11. `test-order-security-and-atomic.ts` (`EXIT=0`)
  12. `test-phase2-bot-portfolio-authority.ts` (`EXIT=0`)
  13. `test-phase2-option-expiry-failclosed.ts` (`EXIT=0`)
  14. `test-phase2-order-settlement-concurrency.ts` (`EXIT=0`)
  15. `test-phase3-authoritative-derivatives-settlement.ts` (`EXIT=0`)
  16. `test-phase3-admin-scenario-engine-integration.ts` (`EXIT=0`)
  17. `test-phase4-engine-cas-concurrency.ts` (`EXIT=0`)
  18. `test-market-flow-verification.ts` (`EXIT=0`)
  19. `test-regression-settlement-auth-ai.ts` (`EXIT=0`)
  20. `test-use-orderbook-hook.tsx` (`EXIT=0`)
  21. `test-orderbook-react-render.tsx` (`EXIT=0`)
  22. `test-cross-asset-full-suite.ts` (`EXIT=0`)
  23. `test-post-fix-remediation.ts` (`EXIT=0`)

---

## 남은 한계 및 미검증 범위

- `app/mypage/page.tsx`는 Next.js Server Component로서 `getServerSession(authOptions)`(요청 컨텍스트 `headers`/`cookies` 필요)에 의존하므로, 이번 회귀 테스트는 `app/mypage/page.tsx`가 직접 호출하는 타입 검증된 계산 모듈 `computeMyPagePortfolioSummary`와 `getUsdFxRateFromDb` 실행, 그리고 `next build` 타입/컴파일 통과로 검증했으며 실제 HTTP 요청 기반 `/mypage` SSR 응답은 별도 구동하지 않았다.
- UI 테스트(`R2-03`, `R2-07`)는 JSDOM + 실제 React 렌더링·이벤트·효과 및 mock `fetch` 기반으로 검증했으며, 실제 Chromium 브라우저 클릭 E2E, 실계정 Google OAuth, 원격 PostgreSQL, 외부 AI/시세 API, 원격 배포는 수행하지 않았다.
- 발견 보고서 `미검증·추가 점검 후보`에 기재된 `lpLiabilities` 매입 환매 감소 정책, 레거시 `profile.id !== user_id` 스냅샷 호환 범위, `.data/` `.gitignore` 정책은 이번 R2-01~07 수정 범위에 포함되지 않았다.
