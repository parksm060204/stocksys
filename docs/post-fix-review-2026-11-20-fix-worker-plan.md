# 추가 오류 AR-01~04 수정 작업

## 요청과 목표
사용자가 `docs/post-fix-review-2026-11-20-findings.md`에 재현한 추가 오류 4건 전부의 수정을 요청했다. 기존 사용자 선호대로 코딩은 Orca Antigravity Hydrogen High 워커인 당신이 수행한다. 현재 작업본에 직접 수정하고 검증 결과를 코디네이터에게 보고한다.

## 공통 제약
- 먼저 AGENTS.md, 위 오류 보고서, `docs/full-code-review-2026-11-20-fix-results.md`, 관련 코드와 git diff를 읽는다. 많은 미커밋 수정 및 신규 파일이 있으므로 전부 보존한다. reset/clean/checkout 덮어쓰기/stash/commit/push/deploy 금지.
- Next.js 코드를 작성하기 전에 설치된 node_modules/next/dist/docs/의 관련 가이드를 읽는다. UI 변경이 꼭 필요할 때만 해당 스킬을 적용한다. 이번 요청은 동작 교정이며 시각적 재설계를 하지 않는다.
- 실제 .data, 운영 snapshot, 원격 DB, 실제 OAuth 자격 증명을 변경/출력하지 않는다. 모든 동적 검증은 mkdtemp 기반 STOCKSYS_DATA_DIR 및 주입 MemoryDatabase로 격리한다.
- 애플리케이션/테스트 코딩을 모두 당신이 수행한다. 코디네이터는 검토와 결과 확인을 맡는다. 루틴 구현 선택은 자율적으로 진행하고, 미해결 장애는 구체적 증거와 함께 orchestration ask로 보고한다.
- 락 순서와 재진입 제약을 지키고 commit gate 하의 변경·영속·롤백을 하나의 경계로 유지한다. 기존 금융·뉴스 권한 수정의 회귀를 피한다.

## AR-01: 독립 엔진의 거래 동결 준수
`MarketEngine.tick()`의 실제 커밋 경계 안에서 자신의 authoritative repository/adminSettings 동결 플래그를 확인하고, 동결 시 대기 주문 체결·신규 봇 주문·LP 갱신을 차단한다. 전달받은 저장소를 기준으로 검사하며 전역 singleton만 검사하지 않는다. 동결 중 만기 정산 같은 의무 처리를 유지할지 명시적으로 결정해 보고하고 조기 return 때문에 필수 정산이 무기한 중단되지 않도록 한다. Next.js와 engine-server의 별도 저장소를 몰래 합치거나 원격 제어를 새로 구축할 필요는 없다. 제어 범위가 각 저장소임을 보고서에 명시한다.
실제 tick 회귀: 주입 MemoryDatabase/시계/SequentialIdGenerator/고정 marketDataSource에 동일 가격 매수·매도 1주를 대기시키고 trading_halt=true 상태에서 거래·현금·보유·주문 filled 변경이 0인지 확인한다. 동결 해제 후 정상 체결도 검증한다.

## AR-02: 잠금 대기 이후 거래 동결 재검사
주식 dbMatching, 옵션 optionOrderService, 원자재 commodityLedger에서 실제 변경을 수행하는 commit gate 내부에 동결 재검사를 추가한다. 계좌/종목/tickLock 대기 중 관리자 동결이 먼저 확정되면 이후 주문 접수·예약·정산이 일어나지 않아야 한다. 기존 빠른 검사는 유지해도 된다. 관리자 동결 변경도 같은 권위 경계를 사용함을 확인한다.
회귀: 실제 계좌 락/커밋 gate 또는 원자재 tickLock을 Promise barrier로 잡은 상태에서 동결 전 주문을 시작하고, 잠금 대기 중 동결을 true로 확정하고 해제한다. 세 자산 경로 모두 거절 및 현금·보유·주문/예약 장부 불변을 검증한다. timeout만으로 성공 판정하지 않는다. 동결 전 먼저 커밋된 주문까지 되돌리지 않는다.

## AR-03: 시나리오 진행 상태 일관성
Standalone 임시 manager와 commodity manager/admin API가 서로 오래된 snapshot으로 덮어쓰지 않도록 authoritative 상태를 통일하거나 안전한 자산별 동기화를 구현한다. 관리자 GET, 주식 tick, 원자재 tick, 신규 주입, rollback, emergency_halt, macro shock 및 영속 실패 롤백을 함께 검토한다. 상태를 commit gate 밖에서 변경하거나 stock lock→commodity tickLock 역순으로 교착을 만들지 않는다.
필수 회귀: 10틱 stock 시나리오 3틱 진행 뒤 DB/API 모두 remainingTicks=7; 다른 시나리오 추가 후 기존도 7; commodity tick과 번갈아 실행해 stock·commodity 양쪽 진행도를 보존; 완료한 시나리오가 새 주입/조회/스냅샷 복원 후 재활성화되지 않음; 영속 실패 시 원본 상태 보존. 반복 polling이나 manager reset으로 진행도를 손실시키지 않는다.

## AR-04: 옵션 만기 미체결 주문 및 예약금 해제
만기 계약의 open/partial 매수·매도 주문을 실제 정산 경계에서 expired 또는 cancelled로 전환한다. 보유 없이 미체결 주문만 있는 계좌도 포함한다. 계좌·종목 락 집합을 보유자만으로 산출하지 말고 주문자까지 포함한다. 변경된 주문 수량/버전/인덱스 등 필드 정합을 유지하고, 주문 상태만 바뀐 배치도 영속 저장한다. 영속 실패 시 주문 상태/예약금/보유·현금·지급이력·멱등 장부가 모두 복구되어야 한다. 별도 standalone과 MarketEngine 정산의 실제 호출 경로 양쪽에서 동작한다.
필수 회귀: 실제 submitAuthoritativeOptionOrder로 미래 만기 옵션 지정가 매수 0.01×250000 1계약을 open 상태로 접수, 만기 도래 후 실제 50번째 tick 실행 시 holding 제거와 주문 종료 및 예약금 2503→0; 보유자 없는 미체결-only 계좌·partial 매수·미체결 매도·영속 실패/재시도도 검증한다. 증거금 예약은 동적 계산이므로 현금을 이중 환급하지 않는다.

## 검증 및 산출물
- 네 오류의 의미 있는 동작 회귀를 `scripts/test-post-fix-review-2026-11-20-fixes.ts`에 추가한다. 소스 문자열 검사로 런타임 검증을 대체하지 않는다.
- 신규 회귀, 기존 F01~10(`scripts/test-full-review-2026-11-20-fixes.ts`), 보안(`test-reachable-security-fixes.ts`), 기존 `test-full-review-2026-11-19-fixes.ts`, 영향받는 정산/시나리오/동시성/롤백 테스트, 루트 및 engine-server tsc, lint, production build를 수행한다. 실패 시 원인을 수정하고 재검증한다. 필요 없는 광범위 반복 테스트는 피한다.
- `docs/post-fix-review-2026-11-20-fix-results.md`에 AR별 수정 파일/실제 동작/테스트 명령 및 exit code/제어 범위/검증 한계를 기록한다. 원본 발견 보고서는 유지한다.
- HISTORY.md 끝에 타임스탬프와 실제 구현 내용을 한국어 UTF-8로 추가한다.
- 모든 AR이 해결되고 검사 통과해야 완료로 보고한다. 해결 불가능한 항목을 단순 완료로 감추지 않는다. worker_done에 AR별 상태, 테스트 증거, 보고서 경로, 남은 한계를 포함한다.
