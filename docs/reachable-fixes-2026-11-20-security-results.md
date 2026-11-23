# 보안 워커 결과 보고서: RR-01 / RR-02

## 1. 대상 결함 및 변경 파일

- **RR-01**: `/api/local-db` 뉴스 테이블(`market_news`, `news`, `news_v2`) 조회 시 `is_fake` 등 내부 진실 필드와 비구독자 마스킹 대상(`content`, `summary`, `body`)에 대한 필터·정렬·`limit` 조합 오라클 차단 및 권한별 마스킹.
- **RR-02**: `GET /api/market-flow`의 `recentNews`에 동일한 세션/구독 정책(`canReadRumor`, `authorizeNewsRecord`) 적용 및 `MarketDiagnostics` 변환 과정에서 누락된 `category` 메타데이터 복원을 통한 `RUMOR` 판정 유지.

### 변경 및 신규 파일 (좁은 행)

1. `lib/news/accessPolicy.ts` (신규, `1~78행`)
   - 서버 DB/세션 의존성 없는 순수 공용 모듈로 `canReadRumor(profile, nowMs)`(`15~36행`) 및 `authorizeNewsRecord(record, hasRumorAccess)`(`42~77행`) export.
   - `canReadRumor`: 관리자(`is_admin === true`) 또는 만료되지 않은(`Date.parse(expIso) > effectiveNowMs`) 구독권 존재 여부를 비변이 방식으로 판정.
   - `authorizeNewsRecord`: `sanitizePublicNewsRecord` 및 snake_case 진실 필드(`is_rumor_fake`, `corrected_at`) 제거 후, 권한 없는 `RUMOR`의 `content`·`summary`·`body`를 `MASKED_RUMOR_MESSAGE`로 마스킹하고 `locked: true` 부여(원본 객체 불변).
2. `app/api/local-db/route.ts`
   - `8행`: `@/lib/news/accessPolicy`의 `authorizeNewsRecord`, `canReadRumor` import.
   - `42~102행`: `PUBLIC_NEWS_COLUMNS`, `SUBSCRIBER_NEWS_COLUMNS` 화이트리스트 정의 및 `findProfileByAuthId()`(`id` / `profileUserIdIndex` 보조 인덱스 조회), `hasDisallowedQueryColumns()` 헬퍼 구현.
   - `319~381행`: `NEWS_TABLES`(`market_news`, `news`, `news_v2`) 쿼리 실행 전 `canReadRumor(viewerProfile)` 판정 및 허용 컬럼 화이트리스트 검증(`403` 차단). `is_fake`, `isRumorFake`, `correctedAt`은 모든 사용자(관리자/구독자 포함)에서 필터·정렬 및 응답 노출 차단. `hasRumorAccess === false`일 때 `content`, `summary`, `body` 필터·정렬 차단(`403`).
3. `app/api/market-flow/route.ts`
   - `7~9행`: `resolveAuthenticatedUserId`, `memoryDb`, `authorizeNewsRecord`, `canReadRumor` import.
   - `48~78행`: `resolveViewerRumorAccess()`(`id` / `profileUserIdIndex` + `canReadRumor`), `sanitizeMarketFlowRecentNews()`(`memoryDb.marketNews` 원본 레코드에서 `category`/`news_type`/`eventType` 메타데이터를 참조한 뒤 `authorizeNewsRecord` 적용, 내부 진실 필드 미노출).
   - `97~112행`, `175~183행`: `GET`/`POST` 응답의 `recentNews`에 동일 정책 적용(기존 시장 통계·차트 `leaderBoard`, `sectorSummary`, `timeSeries`, `causalLogs` 공개 기능 유지).
4. `scripts/test-reachable-security-fixes.ts` (신규, `1~400행`)
   - RR-01, RR-02 및 `lib/news/accessPolicy.ts` 단위·통합 보안 반례 검증 스크립트.

---

## 2. 정책 및 호환성

- **API/SSR 공유 인터페이스**: `docs/reachable-fixes-2026-11-20-common.md`의 export 계약(`canReadRumor`, `authorizeNewsRecord`)과 100% 일치하며 UI 워커(`app/stocks/[id]/page.tsx`, `app/v2/stocks/[id]/page.tsx`)에서 즉시 import 가능.
- **비변이 원칙**: `canReadRumor`와 `findProfileByAuthId`는 조회 경로에서 `memoryDb.profiles`를 변경하지 않으며 `profileUserIdIndex` 보조 인덱스(`id !== user_id`)를 정상 처리함.
- **정상 공개 조회 호환성**: `created_at`/`sequence` 시간순 정렬, `limit`, `target_sector`, `title`, `category` 등 공개 컬럼 필터·정렬은 모든 사용자에게 정상 동작(`200`)하며 `OFFICIAL`/`CORRECTION` 본문 및 `market-flow` 통계/차트는 그대로 유지됨.

---

## 3. 실행 명령 및 검증 결과 (격리 임시 `STOCKSYS_DATA_DIR`)

| 검증 항목 | 실행 명령 | 종료 코드 | 관측 요약 |
| --- | --- | --- | --- |
| RR-01 / RR-02 신규 보안 반례 | `node --import tsx scripts/test-reachable-security-fixes.ts` | `0` | `accessPolicy` 순수 검사 통과; `/api/local-db` 3개 테이블(`market_news`/`news`/`news_v2`) × 5역할(비인증/미구독/만료구독/유효구독/관리자)에서 `is_fake`/`isRumorFake`/`correctedAt` 필터·정렬 전수 `403`, 미구독자 `content`/`summary`/`body` 범위검색·정렬·`limit` 전수 `403`, 정상 공개 목록·시간순 정렬·제목/섹터 조회 `200` 통과; `AgentManager.publishEvent`로 발행한 `RUMOR`가 `/api/market-flow` `recentNews`에서 비인증/미구독/만료 시 마스킹(`locked: true`), 유효구독/관리자 시 원문 반환(`locked: false`), `is_fake` 미노출 확인 |
| 라우트 핸들러 E2E 회귀 | `node --import tsx scripts/test-route-handlers-e2e.ts` | `0` | TEST 1~9 전체 통과 (`market-flow`, `local-db` RUMOR 게이팅 및 `profiles` SELECT 비변이, `commodities`, `orders`) |
| 2026-11-19 리뷰 수정 회귀 | 임시 `STOCKSYS_DATA_DIR` 지정 후 `node --import tsx scripts/test-full-review-2026-11-19-fixes.ts` | `0` | `F-01`~`F-18` 전체 통과 |
| 뉴스 생명주기 회귀 | 임시 `STOCKSYS_DATA_DIR` 지정 후 `node --import tsx scripts/test-news-lifecycle-and-causal-flow.ts` | `0` | TEST A~F 전체 통과 |
| 호가/뉴스 무결성 회귀 | 임시 `STOCKSYS_DATA_DIR` 지정 후 `node --import tsx scripts/test-orderbook-and-news-integrity.ts` | `0` | TEST A~F 전체 통과 |

---

## 4. 미해결 및 미검증 범위

- `SU-*` 6개 의심 항목은 본 작업 범위 외이며 해결된 것으로 주장하지 않음.
- 실제 브라우저/NextAuth Google OAuth 실공급자 세션 쿠키 E2E 및 공용 `next build` / `tsc` / `lint` 일괄 검증은 모든 워커 완료 후 코디네이터 통합 검증 단계에서 수행 예정.

## ????? ?? (2026-11-20)

- ?? ??? ?? ??? RR-01?RR-02? ???? ?? ?? ??? ??? ???? ???.
- ??? engine-server? `tsc --noEmit --incremental false` ?? ?? ?? 0.
- ??? ??? ??? ???? ?? ???? ??? ??? ??? ??? ??, ??? ??? ??? ?? ??? ID? ??? fixture? ????. ?? NextAuth ?? ?? ? OAuth ??? E2E? ??? ?? ???.
- `fields`? ?? ???? ???? ???? projection ??? ??? ?? ??? ????. ?? count ??? ???? ??? ?? ?? ?? ??? ?? ??? ?? ?? ???? ????.
- ?? ????? ???? ??? ???? ???.

- ?? ?? 4?? ESLint ??? 60? ???? `ETIMEDOUT`?? ???? ???? ???. lint ??? ???? ???.

- ?? ??? (2026-11-20 11:50): ?? ?? ?? 4?? ESLint? 180? ???? ????? ?? ?? 0, ????? ?? ????. ?? ?? ??? ?? ??? ????.
