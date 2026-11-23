# 보안 워커: RR-01 / RR-02

먼저 `docs/reachable-fixes-2026-11-20-common.md`와 원본 리뷰를 읽는다.

## 소유 파일

- app/api/local-db/route.ts
- app/api/market-flow/route.ts
- lib/news/accessPolicy.ts (신규, 공통 지시의 export 계약 준수)
- scripts/test-reachable-security-fixes.ts (신규)
- docs/reachable-fixes-2026-11-20-security-results.md (신규)

다른 담당 영역/기존 테스트/HISTORY는 편집하지 않는다.

## 구현

1. RR-01: news/market_news/news_v2 조회에서 비공개 필드와 마스킹 대상 content/summary/body의 필터·정렬·count/limit·프로젝션 조합으로 값이 유출되지 않게 한다. trades처럼 허용 공개 필드 화이트리스트 또는 권한별 projection 후 query를 사용한다. `is_fake` 등 내부 진실 플래그는 공개 요청에 절대 노출하지 않는다. 정상 뉴스 목록/시간순 정렬·공개 제목/섹터 조회를 유지한다.
2. RR-02: `/api/market-flow` recentNews에도 동일 구독/세션 정책을 적용한다. 단순 field 제거만으로 category/eventType 변환 후 RUMOR 판정이 소실되지 않는지 실제 diagnostics 결과로 검증한다. 필요하면 route에서 원본 뉴스 메타데이터를 참조하되 클라이언트에 내부 필드나 원문을 재노출하지 않는다. 시장통계·차트 공개 기능을 유지한다.
3. API와 SSR용 공유 순수 함수는 공통 문서 인터페이스에 맞춰 구현한다. viewer 프로필 id/user_id 보조 인덱스·만료일 판정을 맞추고 조회 중 상태를 변경하지 않는다.

## 검증

- 실제 라우트 handler로 비인증/미구독/만료구독/유효구독/관리자 cases, is_fake eq 및 content/summary/body 범위검색·정렬·limit 조합, 정상 공개 목록을 검증한다. `AgentManager.publishEvent`가 만든 RUMOR를 market-flow에서 확인한다.
- 보안 반례 스크립트는 원본 리뷰 링크를 참고하되 기존 앱/테스트를 수정하지 않는다. 자기 테스트 및 관련 라우트 회귀를 격리 실행한다.
- 구현 완료 시 UI 워커가 공용 모듈을 사용 가능함을 코디네이터에 알리고 결과 문서/worker_done을 남긴다.
