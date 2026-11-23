# UI/SSR 워커: RR-06 / RR-07 / RR-08 / RR-09

먼저 `docs/reachable-fixes-2026-11-20-common.md`와 원본 리뷰를 읽는다.

## 소유 파일

- app/stocks/[id]/page.tsx
- app/v2/stocks/[id]/page.tsx
- app/commodities/[id]/CommodityDetailClient.tsx
- app/components/commodities/CommodityOrderbookPanel.tsx
- app/components/commodities/CommodityOrderEntry.tsx
- app/components/commodities/CommodityActiveOrdersPanel.tsx
- lib/news/relatedNews.ts (신규가 필요한 경우)
- scripts/test-reachable-ui-fixes.tsx (신규)
- docs/reachable-fixes-2026-11-20-ui-results.md (신규)

다른 영역, 기존 테스트, HISTORY는 편집하지 않는다. `lib/news/accessPolicy.ts`는 보안 워커 소유이며 공통 문서 export 계약으로 import만 한다.

## 구현

1. RR-06/RR-09: 실제 server DB client가 지원하지 않는 `.or()` 호출을 없애 V1/V2 관련 뉴스 조회가 동작하도록 한다. QueryBuilder 전체에 새 쿼리 문법을 덧대기보다 지원되는 조회/별도 순수 관련 뉴스 선택기를 사용한다. 정상 종목·티커·채권 라우트를 유지한다. 공개 필드 기준 관련성 필터를 사용하고 shared `canReadRumor`/`authorizeNewsRecord`로 서버에서 권한을 검사해 유료 본문을 SSR로 유출하지 않는다. 원문 비공개 필드를 필터한 적중 여부로 숨긴 값을 추론하는 경로도 만들지 않는다.
2. RR-07: 실제 commodities API의 depth `{price,totalSize,orderCount}` 및 spread `{bestBid,bestAsk,spread,spreadPct}` 구조를 타입으로 맞추거나 명시적 adapter로 정규화한다. 잘못된 타입을 any로 숨기지 않는다. 빈 장부/단측 장부/0잔량/응답 전 상태도 finite하게 표시한다.
3. RR-08: 원자재 포지션의 `side:'long'|'short'`와 양수 quantity를 사용하여 signed UI 수량/청산 방향/가용 계약 수/증거금 면제를 정확하게 계산한다. 매도=숏을 quantity 음수라고 가정하지 않는다. 숏 청산 buy, 롱 청산 sell, 부분/초과 청산, 기존 청산 대기 주문을 고려하며 서버 권위 주문 검증을 우회하지 않는다.

## 검증

- 실제 API 응답을 adapter/컴포넌트에 넣어 React SSR/DOM 렌더링에서 NaN 없음, 잔량/스프레드 표시를 검사한다. 부호/방향/청산 계산은 실제 서버 생성 short/long 데이터로 검증한다.
- 관련 뉴스가 있는 fixture에서 V1/V2 모두 표시되고 미구독 RUMOR는 가려지며 유효 구독은 정상 본문을 읽는지 검증한다. getServerSession 요청 스코프가 필요한 테스트는 격리 HTTP 또는 안전한 test harness로 확인하고 실제 OAuth를 사용하지 않는다.
- 여러 TSX 변경 후 제공된 React best-practices 스킬을 적용한다. Next 설치 가이드를 읽는다. 공용 빌드/next start는 코디네이터가 최종 통합 시 수행하므로 워커는 자기 렌더/쿼리 회귀와 타입 범위만 확인한다. HTTP 200만으로 SSR 정상이라고 판단하지 않고 streamed error/digest도 확인하는 검증 조건을 남긴다.
