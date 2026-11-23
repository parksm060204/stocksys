# TopBar cash 런타임 크래시 수정

사용자가 다음 실제 런타임 오류를 보고했다: `app/components/TopBar.tsx:159`의 `cash.toLocaleString()`에서 `Cannot read properties of undefined`.
기존 요청대로 코딩은 Antigravity Hydrogen High 워커가 수행한다. 현재 작업본에서 이 오류를 수정하고 검증한 후 worker_done으로 보고한다.

## 확인한 코드와 원인
- TopBar의 cash 상태는 number|null 타입이지만 profiles 조회 후 `if (!cancelled && data) setCash(data.cash)`로 런타임 필드를 검증하지 않는다.
- 렌더는 `cash !== null`만 확인하므로 undefined가 통과한다.
- `app/api/local-db/route.ts` profiles SELECT는 대상이 본인이 아닐 때 민감 자산 cash를 제외한 safeData를 반환한다. 인증 전환/정상 보호 응답/레거시 데이터 등으로 cash가 없는 응답은 가능하다. 보안 정책을 약화해 cash를 무조건 공개하는 수정을 하지 않는다.

## 구현 범위
- 먼저 AGENTS.md, 관련 git diff, TopBar, lib/db/client.ts, auth/sessionAuth.ts 및 profiles API 응답을 확인한다. 기존 미커밋 변경을 보존한다. reset/clean/stash/commit/push/deploy 금지.
- Next.js 수정 전 설치된 node_modules/next/dist/docs의 관련 React client/effect 가이드를 읽는다. UI 내구성 교정에는 `.agents/skills/impeccable/SKILL.md` 및 harden 지침을 적용하되 기존 외형을 보존하고 unrelated 디자인/설정 변경을 하지 않는다.
- TopBar가 미검증 cash를 상태에 저장하지 않도록 하고 렌더도 안전하게 한다. undefined/null/NaN/Infinity/배열/객체/비정상 문자열 등으로 앱이 깨지거나 NaN/잘못된 0원이 표시되지 않게 한다. 정상 number(0 포함)는 기존 형식으로 표시한다. 문자열 금액을 지원할지는 실제 데이터 계약을 확인해 결정한다. `Number(undefined)`, `Number(null)` 같은 무분별한 coercion 금지.
- 조회 실패/누락 응답 및 logout/user ID 변경 시 다른 계정의 이전 잔액이 남지 않도록 정리하고 늦게 도착한 이전 요청을 무시한다. 정상 로그인 사용자와 개발 게스트의 조회 흐름을 살펴 실제 원인이 필요로 하는 최소 범위 수정만 한다.
- 권한 없는 응답에 잔액을 추가하거나 auth 우회를 도입하지 않는다. 서버/API의 기존 owner 보호 유지.
- 실제 cash 입력 누락으로 재렌더하는 의미 있는 회귀 검증(가능하면 기존 jsdom/React harness 사용)을 추가한다. source 문자열 검사나 useEffect가 실행되지 않는 SSR 검사만으로 크래시 해결 판정하지 않는다. 정상 잔액 0 및 양수, 누락/조회 실패, 계정 변경·stale 응답을 검증한다. 실제 .data/운영 DB 대신 mock fetch/임시 STOCKSYS_DATA_DIR만 사용한다.
- 관련 회귀 테스트, 루트 tsc 및 대상 파일 ESLint를 실행한다. 변경 범위 대비 불필요한 전체 정산 테스트 반복은 하지 않는다. 새 테스트 의존성 설치 없이 기존 도구를 활용한다.
- HISTORY.md 끝에 UTF-8 한국어·타임스탬프로 실제 수정과 검증을 기록한다. 필요하면 간단한 결과 문서를 작성하되 긴 보고서는 불필요하다.
- 완료 보고에는 실제 원인, 변경 파일, 테스트 명령/exit code, 남은 미검증 한계를 포함한다. 재현 실패나 검사 실패가 남으면 완료로 감추지 않고 구체적으로 보고한다.
