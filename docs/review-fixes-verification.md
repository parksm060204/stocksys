# 코드 리뷰 11개 문제 수정 및 검증 보고서

작성일: 2026-11-17
대상 리뷰: `docs/code-review-2026-11-16.md`

---

## 1. [P1] 잘못된 원자재 수량이 매칭 루프를 종료하지 못하게 함
- **수정 파일:**
  - `app/api/commodities/route.ts`
  - `lib/commodities/CommodityMarketEngine.ts`
  - `lib/commodities/CommodityOrderBook.ts`
- **처리 결과:**
  - API 등록 전 평문 객체 구조, 종목 존재 여부, `side`/`type` enum, `size`(유한 양의 정수), `price`(지정가 양수/시장가 정규화)를 서버에서 엄격 검증하고 잘못된 입력은 `400`으로 거절한다.
  - `CommodityOrderBook.addOrder()`에서 비정상 주문을 거부하고, `matchOrders()` 루프에서 `NaN`/`Infinity`/0 이하의 잔량(`bidRemaining`, `askRemaining`, `tradeSize`, `tradePrice`)이 유입되더라도 해당 주문을 제거하고 반드시 루프가 진행·종료되도록 방어했다.
- **검증 증거:**
  - `scripts/test-review-fixes-verification.ts` (`test1_CommodityInputAndLoopDefense`): 5초 타임아웃 격리 자식 프로세스에서 `NaN` 수량 강제 주입 후 무한 루프 없이 안전 제거 및 종료 확인.
  - 개발 서버 HTTP E2E 테스트: `size: "abc"` 요청 시 `400` 반환 확인.
- **남은 제한:** 없음.

## 2. [P1] 프로필 갱신으로 외화 잔액과 유료 권한을 임의 변경할 수 있음
- **수정 파일:**
  - `app/api/local-db/route.ts`
- **처리 결과:**
  - `profiles` `UPDATE`에서 블랙리스트 방식(`forbiddenFields`)을 제거하고 명시적 허용 목록(`ALLOWED_PROFILE_UPDATE_FIELDS = new Set(['username', 'nickname'])`)으로 교체했다.
  - 허용되지 않은 필드(`usd_balance`, `has_options_license`, `unlocked_features`, `news_subscriptions`, `is_admin`, `cash` 등) 포함 시 `403`, 잘못된 payload/빈 payload/길이 초과 시 `400`을 반환한다.
- **검증 증거:**
  - 개발 서버 HTTP E2E 테스트: `usd_balance` 갱신 요청 `403` 차단, `nickname` 갱신 요청 `200` 허용 확인.
- **남은 제한:** 없음.

## 3. [P1] 원자재 이벤트 발생과 주문에 인증·인가가 없음
- **수정 파일:**
  - `app/api/commodities/route.ts`
  - `lib/auth/sessionAuth.ts`
- **처리 결과:**
  - `trigger_event` 액션에 `verifyAdminSession(req)` 관리자 권한 검증을 적용하여 비관리자 요청을 `403`으로 차단했다.
  - `submit_order` 액션은 `resolveAuthenticatedUserId()`를 통해 서버 세션(프로덕션 비로그인은 `401`)으로만 주문자를 결정하며, `order.botId` 지정 또는 타인 `order.userId` 위조 요청은 `403`으로 거절한다.
- **검증 증거:**
  - 프로덕션 HTTP E2E 테스트: 비인증 `trigger_event` -> `403`, 비인증 `submit_order` -> `401`.
  - 개발 서버 HTTP E2E 테스트: `botId` 위조 주문 -> `403`.
- **남은 제한:** 없음.

## 4. [P1] 런타임에 영속 저장·복원이 연결되어 있지 않음 (및 스냅샷 완전성·저장 경계)
- **수정 파일:**
  - `lib/memoryDb/StorageAdapter.ts`
  - `lib/memoryDb/PersistenceManager.ts`
  - `lib/memoryDb/memoryStore.ts`
  - `lib/engine/localStandaloneServer.ts`
  - `engine-server/src/index.ts`
  - `app/api/orders/route.ts`, `app/api/local-db/route.ts`, `app/api/commodities/route.ts`, `app/api/options/order/route.ts`, `app/api/shop/purchase/route.ts`
- **처리 결과:**
  - `FileStorageAdapter`: PID·타임스탬프 기반 고유 임시 파일에 `writeFile` + `fsync()` + `close()` 후 `rename()`으로 원자적 교체를 수행한다.
  - `PersistenceManager`: 단일 writer 직렬 큐(`saveTail`)로 동시 저장 경합 및 저장 누락을 방지하고, 손상된 JSON 또는 필수 권위 필드 누락 스냅샷 복원 시 조용히 초기화하지 않고 예외를 발생시킨다.
  - `MemoryDatabase`: `schemaVersion: 2` 스냅샷에 `settlementLedger`, `settlementLedgerCutoffMs`, `lpLiabilities`, `lpQuoteGeneration`, `lpAccounts`, `optionSettlements`, `bondCouponPayments`, `commodityPositions`, `commodityMarginReservations`, `commoditySettlementLedger` 등 모든 권위 데이터를 포함했다. 체결 이력이 있는데 `settlementLedger`가 없는 구버전(v1) 스냅샷은 안전을 위해 복원을 거절한다.
  - 런타임 연결: `ensureLocalStandaloneReady()`가 스냅샷 복원 완료 후 엔진을 시작하며 모든 API 라우트가 복원 완료를 대기한다. 확정된 사용자 거래/구매/환전/취소/리셋은 `persistConfirmedState()` 성공 시에만 `200`을 반환하며 저장 실패 시 메모리 상태를 롤백하고 `500`을 반환한다.
  - `engine-server`: Next.js standalone(`.data/snapshot.json`)과 분리된 `.data/engine-server/snapshot.json` 디렉터리를 사용하여 저장소 소유권을 분리했다.
- **검증 증거:**
  - `scripts/test-review-fixes-verification.ts` (`test4_7_9_PersistenceAndSnapshotCompleteness`): 동시 저장 직렬화, 새 `MemoryDatabase` 인스턴스 복원, `settlementLedger`/`lpLiabilities`/파생 정산 복원 및 재정산 차단, 손상/v1 불완전 스냅샷 거절 확인.
  - 개발 서버 HTTP E2E 테스트: 임시 `STOCKSYS_DATA_DIR`에 `snapshot.json` 생성 확인.
- **남은 제한:** 독립형 단일 프로세스 파일 스냅샷 모델이므로, 다중 Next.js 워커가 동일 파일 시스템을 공유하는 수평 확장 환경에서는 외부 공유 DB/분산 락이 필요하다.

## 5. [P1] 원자재 주문은 증거금을 내지 않고 체결되며 사용자 장부도 갱신되지 않음
- **수정 파일:**
  - `lib/commodities/commodityLedger.ts`
  - `lib/commodities/CommodityMarketEngine.ts`
  - `lib/commodities/CommodityOrderBook.ts`
  - `app/api/commodities/route.ts`
  - `app/components/commodities/CommodityOrderEntry.tsx`
- **처리 결과:**
  - `reserveMarginAndSubmitCommodityOrder`가 `withAccountLocks([userId])` 계좌 잠금(주식 주문과 동일 락 네임스페이스) 하에 서버 기준 위탁증거금을 검증·차감하고 `commodityMarginReservations`에 예약한다.
  - 체결 시 `settleCommodityTradeForUsers`가 `commoditySettlementLedger` 멱등성 검사와 함께 사용자 포지션(`commodityPositions`), 실현 손익, 예약 증거금 해제를 정산한다. 미체결 주문 만료/취소 시 `releaseCommodityOrderMargin`으로 잔여 증거금을 계좌에 환불한다.
  - `CommodityOrderEntry.tsx`의 클라이언트 `profiles.update({ cash })` 호출을 제거하고 서버 응답 성공 시에만 체결/예약 완료를 표시한다.
- **검증 증거:**
  - `scripts/test-review-fixes-verification.ts` (`test5_CommodityMarginAndSettlement`): 동시 증거금 초과 주문 방어(1건만 성공), 부분 체결 + 잔여 주문 만료 환불, 멱등 재실행 방어 확인.
- **남은 제한:** 없음.

## 6. [P1] 옵션 HTS는 주문을 보내지 않고 접수 성공 알림만 표시함
- **수정 파일:**
  - `app/api/options/order/route.ts`
  - `app/components/OptionHTSDashboard.tsx`
  - `app/components/OptionOrderEntry.tsx`
  - `lib/memoryDb/memoryStore.ts`
- **처리 결과:**
  - `POST /api/options/order`를 신설하여 세션 인증, 계약 존재 여부, 만기(`expiry_date`), 계약 승수(`multiplier ?? 250000`), 지원 주문 방식(`LIMIT`/`MARKET`만 허용, 미지원 유형 400 거절), 매수 예수금 및 매도 보유 수량을 서버에서 검증·정산하고 영속 저장한다.
  - `OptionHTSDashboard.tsx`에서 실제 `options_contracts` 및 `profiles.cash`를 조회해 `OptionOrderEntry`에 연결했고, 가짜 기본 잔액(1천만 원)과 무조건 성공 `alert` 및 미지원 주문 유형 탭을 제거했다.
- **검증 증거:**
  - 개발 서버 HTTP E2E 테스트: 미지원 `CONDITIONAL` 주문 `400` 거절, 유효한 `LIMIT` 매수 주문 `200` 체결 확인.
- **남은 제한:** `OptionAccountPanel`의 미체결/잔고 표시 탭은 기존 UI 구조를 유지하며, 신규 체결 내역의 실시간 계좌 패널 전체 통합은 후속 UI 개선 범위에 남는다.

## 7. [P2] 상점의 모든 구매가 현재 서버 정책에 의해 거절됨
- **수정 파일:**
  - `lib/shop/catalog.ts`
  - `app/api/shop/purchase/route.ts`
  - `app/api/local-db/route.ts`
  - `lib/memoryDb/memoryDbClient.ts`
  - `app/shop/page.tsx`
- **처리 결과:**
  - `MEDIA_OUTLETS` 카탈로그 및 `SHOP_PRODUCTS` 서버 가격표를 정의하고 `media_outlets` 공개 조회를 연결했다.
  - `POST /api/shop/purchase`에서 서버 가격 확인, 계좌 잠금, 중복 구매 검증(`409`), 잔액 부족 검증(`400`), 현금 차감 및 권한/구독 부여를 원자적으로 처리한다.
  - 30일 기간제 상품(`fee_booster`, `scanner_item`, `ai_predictor`) 및 뉴스 구독권의 만료 시각을 `feature_expiries`/`news_subscriptions`에 기록하고, `pruneExpiredProfileEntitlements()`를 `profiles` 조회·구매 시점에 적용하여 만료 후 자동 회수한다.
- **검증 증거:**
  - `scripts/test-review-fixes-verification.ts` (`test7_8_11_ShopExchangeGuestPolicy`): 카탈로그 존재, 30일 만료 권한 자동 회수 확인.
  - 프로덕션/개발 HTTP E2E 테스트: `media_outlets` 조회 `200`, 상품 구매 `200`, 중복 구매 `409` 확인.
- **남은 제한:** 없음.

## 8. [P2] 환전 화면이 호출하는 RPC가 구현되어 있지 않음
- **수정 파일:**
  - `lib/exchange/exchangeService.ts`
  - `app/api/local-db/route.ts`
  - `lib/memoryDb/memoryDbClient.ts`
  - `app/exchange/page.tsx`
- **처리 결과:**
  - `executeCurrencyExchange`를 구현하여 허용 통화(`KRW`, `USD`, `EUR`, `JPY`, `CNY`, `GBP`), 양수·유한성, 서버 환율(`db.exchangeRates`), 통화별 반올림(`KRW`/`JPY` 정수, 그 외 소수 둘째 자리)을 검증하고 계좌 잠금 하에 두 통화 잔액을 원자적으로 갱신한다.
  - 요청 파라미터의 타인 `p_user_id`를 신뢰하지 않으며(불일치 시 `403`), 알 수 없는 RPC는 `PGRST202` 명시적 오류를 반환하도록 수정했다. `/v2/exchange`도 `app/exchange/page.tsx`를 공유하므로 동일하게 동작한다.
- **검증 증거:**
  - `scripts/test-review-fixes-verification.ts`: 정상 환전 시 양 통화 잔액 갱신, 잔액 부족 실패 시 무변경, 알 수 없는 RPC 오류 반환 확인.
  - 개발 서버 HTTP E2E 테스트: `exchange_currency` RPC `200` 및 환전 결과(`to_amount: 100`) 확인.
- **남은 제한:** 없음.

## 9. [P2] 원자재 오더북의 내부 체결 이력이 무한 누적됨 (및 `settlementLedger` 보존 정책)
- **수정 파일:**
  - `lib/commodities/CommodityOrderBook.ts`
  - `lib/memoryDb/memoryStore.ts`
  - `lib/repositories/inMemory/InMemorySettlementRepository.ts`
- **처리 결과:**
  - `CommodityOrderBook`의 미사용 무한 누적 배열 `tradeHistory`를 제거했다.
  - `MemoryDatabase.trimSettlementLedger(10000)` 및 `settlementLedgerCutoffMs` 워터마크를 도입하여, 인메모리 원장 크기를 상한으로 관리하면서도 제거된 구간 이전 타임스탬프의 재실행은 `isTradeAlreadySettled()`로 계속 차단한다.
- **검증 증거:**
  - `scripts/test-review-fixes-verification.ts`: `CommodityOrderBook.tradeHistory` 미존재 및 `trimSettlementLedger` 이후 과거 거래 재정산 차단 확인.
- **남은 제한:** 없음.

## 10. [P2] 사용자 필터를 생략하면 다른 사용자의 전체 주문을 읽을 수 있음
- **수정 파일:**
  - `app/api/local-db/route.ts`
  - `lib/memoryDb/memoryDbClient.ts`
  - `app/components/TradeNotifier.tsx`
- **처리 결과:**
  - `orders` `SELECT`는 요청 필터 유무와 무관하게 항상 인증된 세션 사용자(`user_id = authenticatedUserId`)로 제한한다(비로그인 `401`). 공개 호가는 기존의 집계 전용 RPC(`get_authoritative_orderbook`) 경로를 사용한다.
  - `option_settlements`, `bond_coupon_payments`를 `PUBLIC_READ_TABLES`에서 제거하여 본인 전용 조회로 전환했다.
  - 공개 `trades` 조회에서는 `buyer_id`, `seller_id`, `buy_order_id`, `sell_order_id`를 제거하고, `TradeNotifier`는 상대방 ID를 노출하지 않는 `get_my_recent_trades` RPC를 사용하도록 전환했다.
- **검증 증거:**
  - 프로덕션 HTTP E2E 테스트: 비인증 `orders` 조회 `401`, 공개 `trades` 조회 시 `buyer_id`/`seller_id` 미포함 확인.
- **남은 제한:** 없음.

## 11. [P2] 프로덕션에서도 화면이 게스트 로그인 상태를 만듦
- **수정 파일:**
  - `lib/engine/localDevMode.ts`
  - `lib/auth/sessionAuth.ts`
  - `lib/auth/useAuth.ts`
  - `app/mypage/page.tsx`
  - `lib/db/client.ts`
  - `app/api/orders/route.ts`
  - `app/api/local-db/route.ts`
- **처리 결과:**
  - 클라이언트와 서버가 동일한 `isDevGuestAuthEnabled()` 정책(`NODE_ENV === 'production'`에서는 항상 `false`, `NEXT_PUBLIC_DISABLE_GUEST_AUTH=true` 시 `false`)을 공유하도록 통일했다.
  - 프로덕션의 비로그인/로그아웃 방문자는 클라이언트와 서버 모두에서 게스트로 자동 로그인되지 않는다.
- **검증 증거:**
  - 프로덕션 HTTP E2E 테스트: `/mypage` 렌더링 시 게스트 계좌가 아닌 "로그인이 필요한 서비스입니다" 안내 출력 확인, 모든 보호 API `401` 확인.
- **남은 제한:** 실제 Google OAuth 로그인 흐름은 외부 OAuth 자격 증명/콜백 환경이 없어 본 로컬 검증에서 실행하지 않았다.

---

## 전체 검증 명령 요약 (최종 수정 후 실행)
- `node node_modules/typescript/bin/tsc --noEmit --incremental false` → 통과 (exit 0)
- `node node_modules/typescript/bin/tsc -p engine-server/tsconfig.json --noEmit --incremental false` → 통과 (exit 0)
- `node node_modules/next/dist/bin/next build` → 통과 (exit 0)
- `node node_modules/eslint/bin/eslint.js app lib engine-server/src` → 오류 0건, 경고 53건 (exit 0)
- `node --import tsx scripts/test-phase1-suite.ts` → 9개 스위트 전체 통과 (exit 0)
- `node --import tsx scripts/test-review-fixes-verification.ts` → 전체 통과 (exit 0)
- Phase 2–4 정산/파생 회귀 5종 (`test-phase2-order-settlement-concurrency.ts`, `test-phase2-option-expiry-failclosed.ts`, `test-phase3-order-replay-protection.ts`, `test-phase3-authoritative-derivatives-settlement.ts`, `test-phase4-derivatives-validation.ts`) → 전체 통과 (exit 0)
- 격리된 프로덕션/개발 HTTP E2E 검증 (`STOCKSYS_DATA_DIR` 임시 디렉터리 사용) → `HTTP_PROD_E2E_OK`, `HTTP_DEV_E2E_OK` (exit 0)

---

## 추가 리뷰·수정·재검증 루프 (1회)

### 발견 사항 및 수정
1. **원자재 정산 원장(`commoditySettlementLedger`) 및 런타임 `trimSettlementLedger` 상한 보완**
   - `lib/commodities/commodityLedger.ts`: `db.commoditySettlementLedger`에 상한(5,000건)을 적용하여 장기 실행 시 무한 RAM 누적을 방지했다.
   - `lib/engine/localStandaloneServer.ts`: 매 20틱 주기 정리 구간(`trim_old_market_data` 직후)에 `memoryDb.trimSettlementLedger(10000)`를 연결하여 런타임 중 주식 정산 원장의 메모리 상한과 워터마크 기반 재실행 방지가 실제로 동작하도록 보완했다.
2. **ESLint 미사용 변수 정리 (`app/api/local-db/route.ts`)**
   - 미사용 import(`OrderRecord`, `withStockLock`) 및 `sanitizePublicTradeRecord`의 미사용 구조 분해 경고를 제거했다.
3. **v2 및 인증·불변식 재점검**
   - `/v2/shop`, `/v2/exchange`, `/v2/news`, `/v2/stocks/[id]` 경로가 모두 수정된 API/RPC(`POST /api/shop/purchase`, `exchange_currency`, `get_authoritative_orderbook`)와 일치함을 재확인했다.
   - `options` 계약 만기·승수·매도 보유 수량 검증, 상점 30일 만료 회수, 프로덕션 게스트 비활성화, `engine-server` 별도 저장 경로가 유지됨을 확인했다.

### 추가 루프 재검증 결과
- `node node_modules/typescript/bin/tsc --noEmit --incremental false` → 통과 (exit 0)
- `node node_modules/typescript/bin/tsc -p engine-server/tsconfig.json --noEmit --incremental false` → 통과 (exit 0)
- `node --import tsx scripts/test-review-fixes-verification.ts` → 전체 통과 (exit 0)
- `node --import tsx scripts/test-phase1-suite.ts` → 9개 스위트 전체 통과 (exit 0)
- `node node_modules/next/dist/bin/next build` → 통과 (exit 0)

---

## 코디네이터 후속 수정 지시(A–F) 해결 및 재검증

대상 지시서: `docs/review-fixes-coordinator-followup.md`

### A. 옵션 지정가 실제 매칭 및 LP/상대방 자산 보존
- **수정 파일:** `lib/options/optionOrderService.ts`, `app/api/options/order/route.ts`, `lib/memoryDb/memoryStore.ts`, `app/components/OptionOrderEntry.tsx`
- **해결 내용:**
  - `LIMIT` 주문이 요청 `price`로 무조건 체결되던 경로를 제거하고, 실제 Price-Time 휴면 주문 매칭 + LP(`bot_options_mm_001`) 호가(`lpAskPrice = current_price`, `lpBidPrice = 0.98 * current_price`)를 통해 BUY는 `price >= execPrice`, SELL은 `price <= execPrice`일 때만 체결되도록 구현했다.
  - 비시장성 지정가(예: 낮은 매수가 `0.01`, 높은 매도가 `99999`)는 `status: 'open'`, `filledQty: 0` 미체결로 유지하며 UI에서도 체결 완료로 오표시하지 않는다.
  - 서버 측 라이선스(`is_admin || has_options_license`) + 30일 만료 정리, 계약 만기, 안전 정수 범위(`Number.isSafeInteger`), 양측 계좌 락 + 영속 저장 실패 시 롤백을 적용했다.

### B. 주식 정산 원장 트리밍 후 실제 repository 경로 멱등성 유지
- **수정 파일:** `lib/memoryDb/memoryStore.ts`, `lib/repositories/inMemory/InMemorySettlementRepository.ts`
- **해결 내용:**
  - `isTradeAlreadySettled(tradeId)`가 호출자의 `created_at`에 의존하지 않고 `settlementLedger`, `settledEpochWatermarks`(`tr_e<epoch>_<seq>`), `evictedCustomTradeIds`를 검사하도록 개선했다.
  - `InMemorySettlementRepository`의 `isTradeSettled`, `recordOptionOpen`, `recordOptionClose`, `settleExpiredOptionPosition`, `payBondCouponOrMaturity`가 모두 `isTradeAlreadySettled`를 통해 실제 배치 경로에서 트리밍·복원 이후에도 재실행을 차단한다.

### C. 원자재 정산 원장 단순 cap 삭제 제거 및 재시작 ID 충돌 방지
- **수정 파일:** `lib/commodities/commodityLedger.ts`, `lib/commodities/CommodityMarketEngine.ts`, `lib/memoryDb/memoryStore.ts`
- **해결 내용:**
  - `commoditySettlementLedger`의 단순 `delete` cap을 제거하고 `trimCommoditySettlementLedger(5000)`가 단조 ID(`cm_trade_e<epoch>_t<tick>_s<seq>`)는 `commoditySettledEpochWatermarks`로 압축, 커스텀 ID는 `commodityEvictedCustomTradeIds`에 보존하도록 수정했다.
  - `commodityNextEpoch`, `commodityCurrentTick`, `commodityUserOrderSeq`, `commodityTradeSeq`를 스냅샷에 영속 저장하고 재시작 시 에포크를 증가시켜 재시작 전후 ID 충돌을 원천 차단했다.

### D. 원자재 주문별 예약 귀속, 비동기 정산 대기·롤백, 자기매매 및 손실 보존
- **수정 파일:** `lib/commodities/types.ts`, `lib/commodities/CommodityOrderBook.ts`, `lib/commodities/commodityLedger.ts`, `lib/commodities/CommodityMarketEngine.ts`
- **해결 내용:**
  - `CommodityTrade`에 `buyOrderId`, `sellOrderId`를 추가하고, `settleCommodityTradeForUsers`가 `(userId, commodityId, side)` 첫 예약 탐색이 아닌 정확한 주문 ID 예약만 검증·차감하도록 수정했다.
  - `CommodityOrderBook.matchOrders`에서 동일 사용자 자기매매 교차를 취소·환불 처리하고, `stepTickAsync()`가 정산·만료 환불·영속 저장을 모두 `await`하며 실패 시 오더북과 사용자 장부를 원자적으로 롤백한다.
  - 실현 손실 정산 시 `Math.max(0, ...)` 클램핑을 제거하여 증거금 초과 손실이 계좌에 그대로 보존되도록 수정했다.

### E. 원자재 미체결 주문 복원 및 복원 완료 후 지연 시작
- **수정 파일:** `lib/memoryDb/memoryStore.ts`, `lib/commodities/CommodityMarketEngine.ts`, `app/api/commodities/route.ts`
- **해결 내용:**
  - 미체결 사용자 주문을 `memoryDb.commodityOpenOrders`에 영속화하고, `app/api/commodities/route.ts` 모듈 import 시 즉시 타이머 시작을 제거했다.
  - `ensureCommodityEngineReady()`가 `ensureLocalStandaloneReady()` 완료 후 `reconcileWithDatabase(memoryDb)`로 오더북 미체결 주문을 복원하고 고아 예약을 일회성 환불한 뒤에야 엔진 타이머를 시작한다.

### F. 락 내부 영속 커밋 경계, 계좌별 롤백, 스냅샷 격리 및 다중 프로세스 락
- **수정 파일:** `lib/memoryDb/StorageAdapter.ts`, `lib/memoryDb/PersistenceManager.ts`, `lib/engine/dbMatching.ts`, `lib/engine/marketService.ts`, `lib/exchange/exchangeService.ts`, `lib/engine/localStandaloneServer.ts`, `app/api/orders/route.ts`, `app/api/local-db/route.ts`, `engine-server/src/index.ts`
- **해결 내용:**
  - `FileStorageAdapter`에 PID 기반 배타적 파일 락(`.lock`, `O_CREAT|O_EXCL`)을 구현하여 두 프로세스가 동일 `STOCKSYS_DATA_DIR`를 여는 것을 `StorageWriterLockError`로 차단한다.
  - `PersistenceManager`에 `withCommitGate` + `enqueueSerializedSave`를 추가해 변경 중 불완전 스냅샷 추출을 방지한다.
  - 주식 주문/취소(`dbMatching`, `LocalMarketService`), 환전(`executeCurrencyExchange`), 옵션/상점/원자재 모두 `withStockLock`/`withAccountLocks` 내부에서 영속 저장을 수행하고, 실패 시 해당 계좌·종목만 롤백하여 동시 성공한 타 계좌 상태를 보존한다.
  - `LocalMarketEngineInstance.runTick()` 완료 시에도 `persistenceManager.saveSnapshot(memoryDb)`를 호출하여 자동 체결 내역의 커밋 경계를 보장한다.

### 후속 A–F + 최종 리뷰 루프 검증 결과 (최종 수정 후 실행)
- `node node_modules/typescript/bin/tsc --noEmit --incremental false` → 통과 (exit 0)
- `node node_modules/typescript/bin/tsc -p engine-server/tsconfig.json --noEmit --incremental false` → 통과 (exit 0)
- `node --import tsx scripts/test-followup-a-to-f.ts` → A–F 전체 재현·수정 검증 통과 (exit 0)
- `node --import tsx scripts/test-review-fixes-verification.ts` → 전체 통과 (exit 0)
- `node --import tsx scripts/test-phase1-suite.ts` → 9개 스위트 전체 통과 (exit 0)
- Phase 2–4 정산/파생 회귀 5종 → 전체 통과 (exit 0)
- `node node_modules/eslint/bin/eslint.js app lib engine-server/src` → 오류 0건 (exit 0)
- `node node_modules/next/dist/bin/next build` → 통과 (exit 0)
