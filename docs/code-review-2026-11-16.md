# 전체 코드 리뷰 — 2026-11-16

## 범위와 검증

Next.js 화면과 API, 인증, 인메모리 DB, 주문·정산 서비스, 원자재 엔진, 별도 engine-server의 시작 및 저장 경로를 검토했다. 아래 문제는 현재 코드의 호출 경로를 근거로 작성했다. 전체 파일의 모든 분기를 실행한 검증은 아니며, 원격 운영 서버와 실제 OAuth 계정은 사용하지 않았다. 서비스 중단 가능성이 있는 잘못된 주문은 실행하지 않았다.

- 프로덕션 빌드: `node node_modules/next/dist/bin/next build` 통과.
- 루트 타입 검사: `node node_modules/typescript/bin/tsc --noEmit --incremental false` 통과.
- 엔진 타입 검사: `node node_modules/typescript/bin/tsc -p engine-server/tsconfig.json --noEmit --incremental false` 통과.
- ESLint (`app`, `lib`, `engine-server/src`): 오류 0건, 경고 49건.
- Phase 1 회귀 테스트: `node --import tsx scripts/test-phase1-suite.ts`의 9개 스크립트 모두 통과. 최초 샌드박스 실행은 OS 사용자 정보 조회 오류로 실패했으며, 승인된 재실행에서 통과했다.

P1은 우선 수정이 필요한 보안·장부·핵심 기능 문제, P2는 기능 결함이나 운영 위험을 뜻한다. 빌드와 회귀 테스트 통과가 아래 기능 간 연결의 정상 동작을 보장하지는 않는다.

## 1. [P1] 잘못된 원자재 수량이 매칭 루프를 종료하지 못하게 한다

**위치:** `app/api/commodities/route.ts:71`, `lib/commodities/CommodityMarketEngine.ts:296`, `lib/commodities/CommodityOrderBook.ts:29,87,116`.

POST는 전달받은 `order`를 런타임 검증 없이 등록한다. `addOrder()`도 `order.size <= 0`만 검사한다. 수량이 숫자로 변환되지 않는 문자열이면 이 검사를 통과하고, 반대 주문과 만났을 때 `Math.min(bidRemaining, askRemaining)`이 `NaN`이 된다. `tradeSize <= 0`과 양쪽 주문의 체결 완료 비교가 모두 false이므로 같은 두 주문을 반복 처리하며 거래 배열을 계속 늘린다.

인증 없이 호출 가능한 경로에서 Node.js 이벤트 루프 정지와 메모리 고갈을 유발할 수 있다. 가격·수량의 타입, 유한성, 양수/정수 여부, side/type과 종목 존재를 등록 전에 검증하고, 매칭 루프에도 유효하지 않은 잔량을 거절하는 방어가 필요하다.

## 2. [P1] 프로필 갱신으로 외화 잔액과 유료 권한을 임의 변경할 수 있다

**위치:** `app/api/local-db/route.ts:250,265`; 관련 표시/접근 경로 `app/mypage/page.tsx:48`, `app/components/OptionsPanel.tsx:39`, `app/components/DashboardGate.tsx:32`, `app/news/page.tsx:36`.

프로필 UPDATE는 `cash`, `is_admin`, `net_worth`, `id`, `user_id`만 금지하고 나머지 payload를 그대로 병합한다. 따라서 로그인한 사용자는 `usd_balance` 등 외화 잔액과 `has_options_license`, `unlocked_features`, `news_subscriptions`를 직접 지정할 수 있다. 외화 자산 표시를 위조하거나 유료 접근 제한을 우회할 수 있다. 현재 환전 RPC가 미구현이므로 원화 환전까지 가능하다는 주장은 하지 않는다.

사용자에게 허용할 이름 등만 명시적으로 허용하고, 잔액·구매·구독 필드는 서버의 검증된 거래 경로에서만 수정해야 한다.

## 3. [P1] 원자재 이벤트 발생과 주문에 인증·인가가 없다

**위치:** `app/api/commodities/route.ts:58–73`.

`trigger_event`는 관리자 검증 없이 이벤트를 발생시키고, `submit_order`는 세션 확인 없이 body의 `userId`와 `botId`를 수용한다. 비로그인 요청이 시장에 개입하거나 다른 참여자의 식별자를 붙여 주문할 수 있다. 다른 관리자 API의 `verifyAdminSession()`과도 정책이 다르다.

이벤트 조작은 관리자 검증을 거치고, 주문자는 서버 세션에서 결정해야 한다. 클라이언트의 봇 식별 필드는 거절해야 한다.

## 4. [P1] 런타임에 영속 저장·복원이 연결되어 있지 않다

**위치:** `lib/memoryDb/memoryStore.ts:954`, `lib/engine/localStandaloneServer.ts:50`, `engine-server/src/index.ts:13`; 저장 구현 `lib/memoryDb/PersistenceManager.ts`.

두 실행 경로 모두 새 인메모리 DB로 시작한다. `PersistenceManager`의 저장·복원·자동 저장 메서드는 구현되어 있으나 런타임에서 호출하지 않는다. 프로세스 종료나 재배포 후 사용자의 현금·보유량·주문과 기관 자산이 초기화된다. `globalThis`는 프로세스 재시작이나 여러 서버 인스턴스 사이의 공유 저장소가 아니다.

실서비스 계좌를 유지하려면 복원 완료 후 서비스를 시작하고 확정된 장부를 내구성 있는 저장소에 기록해야 한다. 단순 자동 저장 연결에 앞서 스냅샷에 빠진 `settlementLedger`, `lpLiabilities`, `optionSettlements`, `bondCouponPayments`도 처리해야 한다(`memoryStore.ts:870–906`). 현재 스냅샷만 복원하면 중복 정산 방지 원장과 LP 부채가 복구되지 않는다.

## 5. [P1] 원자재 주문은 증거금을 내지 않고 체결되며 사용자 장부도 갱신되지 않는다

**위치:** `app/components/commodities/CommodityOrderEntry.tsx:100–115`, `lib/commodities/CommodityMarketEngine.ts:168–183`.

클라이언트는 주문 접수 후 별도 프로필 UPDATE로 현금을 차감한다. 그러나 `/api/local-db`는 cash 수정을 403으로 차단한다. 이 반환 오류를 확인하지 않아 화면은 증거금 납부 성공으로 표시한다. 엔진은 체결 후 봇의 `onTradeExecuted()`만 호출하며 일반 사용자의 현금·포지션 정산은 수행하지 않는다.

정상 UI로 주문해도 현금이 차감되지 않고, 체결된 사용자 포지션을 계좌에 반영할 경로가 없다. 주문 등록·증거금 예약·체결 정산을 서버의 하나의 장부 처리 흐름으로 연결해야 한다.

## 6. [P1] 옵션 HTS는 주문을 보내지 않고 접수 성공 알림만 표시한다

**위치:** `app/options/page.tsx:9`, `app/components/OptionHTSDashboard.tsx:76–79`, `app/components/OptionOrderEntry.tsx:44–51`.

실제 `/options` 화면에서 `OptionOrderEntry`에 `onOrderSubmit`을 전달하지 않는다. 클릭하면 optional callback은 실행되지 않고 접수 alert만 표시된다. 주문 API 호출·계약 식별·서버 접수 결과 확인이 모두 빠져 있어 사용자는 제출되지 않은 주문을 접수된 것으로 오해한다. 기본 잔액도 실제 계좌가 아닌 1천만 원이다.

선택한 계약과 실제 계좌를 서버 주문 처리에 연결하고, 성공 응답 이후에만 접수 완료를 표시해야 한다.

## 7. [P2] 상점의 모든 구매가 현재 서버 정책에 의해 거절된다

**위치:** `app/shop/page.tsx:110–117,147–154,188–194,226–232,264–270,302–308`; 차단 지점 `app/api/local-db/route.ts:250`.

뉴스 구독, 옵션 자격증, 대시보드 해금, 부스터 구매가 모두 `profiles.update({ cash: ..., ... })`를 사용한다. 서버는 cash가 들어간 갱신을 항상 403으로 거절하므로 잔액이 충분해도 구매할 수 없다. `media_outlets` 조회 역시 API 허용 목록과 인메모리 테이블 구현에 없어 뉴스 상품 목록을 가져오지 못한다.

클라이언트의 가격·잔액 계산을 신뢰하지 않는 전용 서버 구매 API에서 상품 가격 확인, 계좌 잠금, 현금 차감, 권한 부여를 원자적으로 처리해야 한다.

## 8. [P2] 환전 화면이 호출하는 RPC가 구현되어 있지 않다

**위치:** `app/exchange/page.tsx:164–172`, `lib/memoryDb/memoryDbClient.ts:459–867`.

화면은 `exchange_currency`를 호출하지만 RPC 구현에 해당 분기가 없다. 알 수 없는 함수는 `{ data: null, error: null }`로 반환되어 모든 환전이 일반적인 실패 메시지로 끝난다. `/v2/exchange`도 같은 화면을 사용한다.

세션 기반 사용자 확인, 서버 환율 적용, 원자적 두 통화 잔액 갱신을 구현하고, 알 수 없는 RPC도 명시적인 오류를 반환해야 한다.

## 9. [P2] 원자재 오더북의 내부 체결 이력이 무한 누적된다

**위치:** `lib/commodities/CommodityOrderBook.ts:17,149`.

엔진의 `tradesHistory`에는 상한이 있지만 각 오더북의 별도 `tradeHistory`에는 매 체결을 계속 push하며 제한이나 제거가 없다. `clear()`도 bids/asks만 비운다. 1.5초 주기로 돌아가는 API 엔진이 장기 실행되면 종목별 거래 객체가 무한 누적된다. 사용하지 않는 중복 이력은 제거하거나 별도 롤링 캡을 적용해야 한다.

별도 엔진의 `settlementLedger`도 거래마다 증가하고 `trimOldData()`는 이 원장을 줄이지 않는다. 이 경우는 중복 정산 방지 데이터이므로 단순 삭제하면 안 되며, 영속 원장·보존 정책을 함께 설계해야 한다.

## 10. [P2] 사용자 필터를 생략하면 다른 사용자의 전체 주문을 읽을 수 있다

**위치:** `app/api/local-db/route.ts:278–304`.

본인 주문 강제 필터는 요청에 `user_id`/`userId` 필터가 이미 들어 있을 때만 적용된다. 필터 없이 orders를 조회하면 인증 확인 없이 원본 주문을 반환한다. 주석의 open/partial 상태 제한도 실제로 추가하지 않아 체결·취소된 주문과 사용자 식별자까지 조회할 수 있다.

개인 주문 이력은 항상 세션 소유자로 제한하고, 공개 호가 정보는 가격별 집계나 민감 식별자를 제거한 응답으로 제공해야 한다.

## 11. [P2] 프로덕션에서도 화면이 게스트 로그인 상태를 만든다

**위치:** `lib/engine/localDevMode.ts:10–12`, `lib/auth/useAuth.ts:48`; 서버의 거절 지점 `app/api/orders/route.ts:37–43`.

`isLocalStandaloneMode()`가 환경과 관계없이 true를 반환하여 프로덕션의 비로그인 방문자도 클라이언트에서는 guest로 로그인한 상태가 된다. 서버는 프로덕션에서 게스트 fallback을 허용하지 않으므로 주문·개인 자산 조회가 401로 실패한다. 로그아웃 후에도 클라이언트가 다시 게스트를 만든다.

게스트 모드는 개발 환경과 명시적 설정에서만 활성화하고, 서버와 클라이언트가 동일한 인증 정책을 사용해야 한다.

## 권장 수정 순서

1. 원자재 입력 검증 및 API 인증, 프로필 허용 필드 제한.
2. 장부 영속성, 스냅샷 복원 완전성, 사용자 원자재 정산.
3. 옵션 주문 실제 연결, 서버 구매·환전 처리.
4. 공개 주문 응답 축소, 프로덕션 게스트 정책, 메모리 보존 정책.

이번 작업에서는 리뷰 보고서와 작업 이력만 추가하고 애플리케이션 코드는 수정하지 않았다.
