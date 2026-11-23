# 2026-11-19 전체 재리뷰 수정 및 직접 복구 검증

기준: `7008f55` 이후 워크트리. 원본 항목은 [리뷰 보고서](/C:/Users/abcde/Desktop/웹소설/stock-sys/docs/full-code-review-2026-11-19-findings.md) F-01~F-19다. AGY가 남긴 수정을 보존하고 코디네이터가 검증 실패와 추가 롤백 결함을 직접 수정했다. 커밋·푸시는 수행하지 않았다.

## 반복 대기 진단과 복구

- 두 번째 AGY 실행 `ctx_940c91453aa1`의 마지막 화면은 LP 호가 디버그 `npx tsx -e ...`를 실행 중으로 표시했다. 실행 상태는 `unverifiable`였고 최종 보고서는 없었다. 사용자 지시에 따라 `worker-stop`으로 `stopped`, `ptyKilled: true`를 확인했다. 정확한 CLI 내부 정체 원인은 확정하지 않았으며, 코디네이터가 직접 실행을 인계했다.
- `npx` 대기 작업을 재사용하지 않고 `node --import tsx`를 별도 자식 프로세스로 실행했다. 스크립트마다 임시 `STOCKSYS_DATA_DIR`, 출력 로그, 60초 또는 장기 스위트 180초 제한을 부여했다. 테스트 실패와 종료 대기를 구분했으며 종료되지 않은 테스트를 성공으로 계산하지 않았다.
- 신규 리뷰 테스트는 실제로 약 16초 뒤 실패했다. 타이머가 도는 전역 엔진 및 이미 존재하는 주문 때문에 수수료 경계 fixture가 다른 가격에 체결됐다. 테스트의 자동 틱을 중지하고 별도 종목을 사용한 뒤 약 2초에 정상 완료했다. 현금 0원 및 정확한 수수료 검증은 유지했다.
- LP 테스트는 정상 거래가 일어난 틱 1~5 사이에도 최초 호가 지문과 같아야 한다고 검사했다. 실패한 갱신 직전의 장부를 기준으로 원자성을 검사하고 `COMMITTED`와 LP 경고도 검증하도록 바로잡았다. 100틱 상한 검사도 유지했다.
- 전체 검사에서 특화 봇의 **실제 런타임 롤백 누락**을 발견했다. 포트폴리오 외에 봇별 난수 스트림, 재고, 회귀/호가 모델, 뉴스·취소 큐까지 복구하도록 `BaseAgent.snapshotRuntimeState`/`restoreRuntimeState`를 구현했다. AS/Adversarial/WallBreaker 전용 인스턴스도 포함했다. 전략 보조 객체의 프로토타입을 보존해 복원 후에도 메서드가 동작한다.
- 결정론 테스트의 두 실행이 같은 종목 객체를 공유하지 않도록 분리하고, 동일한 시작 상태 및 봇 런타임·난수 상태까지 지문에 포함했다. 실패 후 재시도가 정상 실행과 동일한 거래/DB/봇 상태를 만드는 검사를 통과했다. 단언을 제거하거나 성공 종료로 강제하지 않았다.

## 항목별 구현

| 원본 | 구현 결과 | 주요 파일 | 검증 |
| --- | --- | --- | --- |
| F-01 | 체결 공개 컬럼만 필터·정렬 허용. 내부 설정은 관리자 전용, 기관 디렉터리는 id/name만 공개 | `app/api/local-db/route.ts` | 신규 리뷰 회귀, 라우트 E2E |
| F-02 | 시드 채권 ISO 만기·액면 100 호가 승수·분기 쿠폰 정합화. 최종 주기 중복 쿠폰 방지 | `memoryStore.ts`, `currency.ts`, `InMemorySettlementRepository.ts`, `BondCouponEngine.ts` | 신규 회귀, Phase 1 정산 무결성, Phase 3/4 파생 정산 |
| F-03 | 옵션·채권 만기 지급액을 부채 우선 상환 후 현금 반영. 실패 복구에서 부채 필드도 복원 | `InMemorySettlementRepository.ts` | 신규 회귀의 부채 계좌 만기 지급 사례 |
| F-04 | 음수 비용 이벤트 보상금에 공통 부채 상환 계산 적용 | `playerEventService.ts` | 신규 회귀 이벤트 사례 |
| F-05 | 미수 계좌의 기존 매수 주문 후속 체결 차단, 취소로 해제된 비예약 현금의 부채 상환, 저장 실패 복구 | `memoryDbClient.ts`, `optionOrderService.ts`, `marketService.ts`, `commodityLedger.ts`, `localStandaloneServer.ts` | 신규 회귀 주식·옵션·원자재 사례, 계좌/종목 동시성 검사 |
| F-06 | 틱 전체 상태 변경과 autosave가 같은 커밋 게이트를 사용. 런타임과 DB를 함께 복구 | `MarketEngine.ts`, `engine-server/src/index.ts` | 신규 회귀의 별도 타이머 autosave + 틱 실패, Phase 2~4 |
| F-07 | 내장 참가자에 bot_type과 단일 메타데이터 부여, 특화 풀 초기화 | `MarketEngine.ts`, 각 봇 생성자 | 신규 회귀의 7개 특화 풀 및 공유 시계 검사 |
| F-08 | AS 봇에 실제 호가 전달, 슬롯 유지·잔량 인계로 부분체결 LP 중복 잔존 방지 | `MarketEngine.ts`, `ASMarketMakerAgent.ts` | 신규 LP 사례, 100틱 LP 상한, Phase 3/4 원자성 |
| F-09 | 새 시드 옵션을 IDX/idx_k200/260포인트로 일치. 노출 없는 알려진 구형 시드만 정정. 보유·미체결 계약은 임의 변경하지 않음 | `memoryStore.ts`, `options/contractUnits.ts`, 옵션 주문/정산 경로 | 신규 회귀의 시드 검사 및 구형 보유 계약 주문/지급 차단 |
| F-10 | 브라우저 optionBotEngine의 DB 쓰기/RPC 제거. 실제 주문은 기존 서버 옵션 API 사용 | `optionBotEngine.ts`, `OptionsPanel.tsx` | fetch 감시로 쓰기/RPC 요청 0건, 빌드 |
| F-11 | 프로필 조회에 user_id→profileId 인덱스 사용. 공개 응답의 잔액 비공개 유지 | `app/api/local-db/route.ts` | id와 user_id가 다른 프로필 회귀 |
| F-12 | 시나리오/원자재 이벤트 런타임을 스냅샷에 포함. 신규 종목 실패 복구에서 marketIndex 제거 | 관리자·원자재 API, `memoryStore.ts` | 신규 회귀의 스냅샷/인덱스 검사, 관리자 엔진 통합 |
| F-13 | standalone 자동 매칭의 테이커 수수료에 공통 할인 계산 적용 | `localStandaloneServer.ts` | 정확히 1,001,250원으로 100만원 매수 체결 후 현금 0원 |
| F-14 | 옵션 자격 검사에서 원본 프로필을 변이하지 않음. 만료 정리와 복구를 커밋 경계로 이동하고 새 키도 제거 | `optionOrderService.ts` | 검증 실패 시 엔타이틀먼트 보존, 저장 실패 회귀 |
| F-15 | 미주입 DB 시계는 실제 시간, 시뮬레이션은 주입 시계 사용. 매칭 ID는 epoch/단조 생성 | `memoryStore.ts`, `dbMatching.ts`, `localStandaloneServer.ts` | 실시간 시계, 재시작 ID, 결정론 회귀 |
| F-16.1 | OrderEntry의 할인·부채·예약금 반영. 옵션 승수도 서버와 동일한 공통 예약 함수로 계산 | `OrderEntry.tsx`, `orderRisk.ts` | 타입 검사, React 검토, 빌드; 서버 계산은 주문 리스크 회귀 |
| F-16.2 | 상점에서 실제 만료일·패시브·판매 중단 상태 표시 | `app/shop/page.tsx` | 타입 검사 및 빌드; 실제 클릭은 미실행 |
| F-16.3 | V2 상세의 티커 조회 및 채권 표시 지원 | V2 종목 상세 페이지/클라이언트 | 프로덕션 HTTP 검사 대상, 빌드 |
| F-16.4 | 원자재 API에 실제 depth/spread 반환 및 전용 호가 패널 연결 | 원자재 API·상세, `CommodityOrderbookPanel.tsx` | 신규 회귀의 depth/spread 응답, 빌드 |
| F-16.5 | 옵션 가격 단위를 포인트로 구분하고 KRW 결제금액 별도 표시 | 옵션 패널·HTS·주문 입력 | 소스 대조, 타입 검사, 빌드 |
| F-16.6 | 채권 호가의 소수 두 자리 보존 | V1/V2 체결 목록, 시장 목록 | 소스 대조, 빌드 |
| F-17 | Quant/StatArb/CTA/Hedger 등 봇에 공통 SimulationContext 주입 | 각 봇 생성자 | 신규 공유 시계 검사, 결정론 롤백 지문 |
| F-18 | 내장 참가자 분류를 단일 목록으로 정합화 | `MarketEngine.ts` | 헤지펀드/프롭/CTA 외국기관 분류 회귀 |
| F-19 | 실행모드와 비활성 레거시 DB 설정·SQL 비교를 구분. 검증 예외/strict 불일치 시 비영 exit. 자격증명 값 출력 제거. 현재 모드 예제 제공 | `verify-env-alignment.ts`, `verify-schema-diff.ts`, `docs/local-standalone.env.example` | 두 검증 스크립트 exit 0; 레거시 SQL 8필드 경고는 명시적으로 유지 |

## 기존 데이터 처리의 제한

- 시드에 명시적인 만기일을 추가했지만, **보유 중인 구형 채권에 상대 만기(2Y 등)만 있는 경우에는 새 만기일을 추측하지 않는다.** 날짜가 확정되기 전 만기 정산을 거절한다. 기존 권리를 연장하거나 줄이는 것보다 자료 확인을 우선한다.
- 구형 보유 K200 계약의 STK/지수 단위가 모호하면 원본 행사가·보유량을 유지하고 신규 주문은 409, 만기 지급은 `HELD_UNDERLYING_UNIT_MISMATCH`로 차단한다. 수동 자료 확인 없이 보유자의 계약을 다른 상품으로 바꾸지 않는다.
- 임의 정산 ID의 무한 보존에 관한 이전 F20 한계는 이번 F-01~F-19 변경으로 해결됐다고 주장하지 않는다.

## 직접 실행한 검증

| 검사 | 결과 |
| --- | --- |
| 전체 `scripts/test-*.ts*` 76개 개별 실행 | 최초 74 PASS / 2 FAIL. A–F는 고정된 만기 티커, Phase 3 결정론은 위 실제 런타임 복구 누락으로 실패. 둘 다 수정 후 통과 |
| 엔진 변경 후 Phase 2~4 및 신규 리뷰/A–F 재검증 25개 | 25/25 PASS, 각 exit 0 |
| 구형 계약 보호 추가 후 신규 리뷰·정산 무결성·권위 파생 정산·입력 검증·A–F·기존 16건 회귀 6개 | 6/6 PASS, 각 exit 0 |
| 신규 리뷰 테스트 | 최종 약 2초, exit 0 |
| 기존 실패/종료 대기 8개 스크립트 | 모두 정상 종료 및 exit 0 |
| 장기 국면 테스트 | 약 84초, exit 0. 제한시간 초과나 종료 대기를 성공으로 세지 않음 |
| 루트/engine TypeScript | exit 0; 최종 Next 빌드도 TypeScript 검증 포함 |
| ESLint | 전체 검사 exit 0, 경고 149개. 후속 수정 파일 검사도 오류 0개 |
| 프로덕션 빌드 | 최종 구형 계약 보호 반영 후 `npm run build` exit 0 (TypeScript 포함) |
| 최종 lint | 전체 `eslint --quiet` exit 0. 이전 전체 출력의 경고 149개는 잔존하며 오류는 없음 |
| 최종 프로덕션 HTTP | 임시 데이터로 기동/종료, 아래 7개 검사 전부 통과, exit 0 |

### 최종 HTTP 확인

- `/v2/stocks/AAPL`, `/v2/stocks/bond_kr_2y`, `/commodities/CRUDE_OIL`, `/shop`: HTTP 200.
- `/api/commodities?id=CRUDE_OIL`: HTTP 200 및 실제 `depth.bids`/`depth.asks` 배열 확인.
- 비로그인 공개 trades 조회에서 `buyer_id` 필터: HTTP 403.
- 비로그인 `/api/options/order` 쓰기: HTTP 401.
- 서버는 임시 포트·임시 `STOCKSYS_DATA_DIR`로만 실행했고 검사 후 해당 자식 프로세스를 종료했다. 기록: 임시 `stocksys-final-http-nHrAy8/checks.json` 및 `server.log`.

최초 76개 중 실패했던 2개는 수정 후 통과했으며, 코드 변경 영향을 받는 엔진 검사 25개와 구형 계약 보호 관련 6개도 모두 재검증했다. 따라서 실행한 76개 스크립트 각각의 최종 결과는 PASS이며, 이를 전체 76개를 최종 수정 후 일괄 재실행했다는 의미로 사용하지 않는다.

전체 실행 메타데이터: 임시 `stocksys-review-suite-rLfbB7/results.json`; 영향 재검증: `stocksys-engine-recheck-aThhxN/results.json`. 각 스크립트의 출력은 같은 디렉터리의 개별 output.log에 보존했다. 최종 상태는 최초 전체 실행에 실패가 없었다고 표현하지 않고, 실패 수정과 영향 범위 재검증을 구분한다.

실제 브라우저의 DOM/버튼 클릭·Google OAuth 왕복·운영 PostgreSQL/Redis·프로세스 강제 종료/디스크 고갈 실험은 수행하지 않았다. HTTP 200 응답만으로 브라우저 동작을 검증했다고 주장하지 않는다.
