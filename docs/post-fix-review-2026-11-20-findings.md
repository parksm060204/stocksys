# 수정 후 추가 오류 검토 — 2026-11-20

검토 대상은 F-20261120-01~10 수정이 반영된 현재 작업본(미커밋 변경 포함)이다. 애플리케이션과 기존 테스트는 수정하지 않았다. 최근 수정의 정산·예약금·거래 동결·시나리오 수명주기 경로를 집중 검토했다. 전체 저장소 무결점이나 전체 브라우저 E2E 통과를 의미하지 않는다.

## 결과

확정 결함 **4건(P1 2건, P2 2건)**을 별도 격리 실행으로 확인했다. 독립 engine-server 관련 P1 한 건은 해당 실행 방식을 사용하는 환경에 해당한다. 기존 `scripts/test-full-review-2026-11-20-fixes.ts`는 재실행 결과 exit 0으로 F01~F10 전체 통과했다. 기존 테스트의 성공과 아래 추가 경계 조건의 성공은 별개다.

### AR-01 [P1, 독립 engine-server 사용 시] 거래 동결 중에도 주식 주문을 실제 체결

- 위치: `engine-server/src/MarketEngine.ts:706`, `:820`, `:1011`.
- 독립 실행 진입점: `engine-server/src/index.ts:23`에서 저장소 번들을 생성하고 `MarketEngine`을 시작한다.
- 원인: Standalone 및 신규 주문 제출 경로에는 추가된 `isTradingHalted()` 검사가 독립 `MarketEngine.tick()`에는 없다. `adminSettings.trading_halt === true`인 저장소에서도 기존 미체결 주문을 읽고 `processBatchOrders()`를 호출한다.
- 격리 재현: `MemoryDatabase`에 계좌 2개, 매도 보유 100주, 동일 가격 매수/매도 각 1주를 생성했다. 주입 시계와 `SequentialIdGenerator`, 고정 `marketDataSource`, 성공하는 인메모리 영속 콜백을 사용하고 저장소의 거래 동결을 활성화한 뒤 실제 `engine.tick()`을 호출했다. 봇 초기화나 운영 서버는 실행하지 않았다.

```json
{"halted":true,"success":true,"commitStatus":"COMMITTED","tradesAdded":1,"buyerShares":1}
```

- 영향: 독립 엔진에서 동결 플래그가 설정되어 있어도 대기 주문 체결이 계속될 수 있다.
- 주의: Next.js 관리자 API와 독립 엔진 서버는 저장소 소유권이 분리되어 있다. 이번 검증은 **독립 엔진 자체가 자기 저장소의 동결 플래그조차 지키지 않음**을 확인했다. Next.js 관리자 클릭이 별도 서버까지 전달됨을 확인한 것은 아니다.
- 수정 방향: 독립 엔진의 커밋 경계 안에서 권위 있는 거래 동결 상태를 검사하고 거래·봇 주문·LP 갱신을 차단한다. 동결 중 만기 정산 등 허용할 작업은 명시적으로 구분한다. 별도 서버를 제어해야 하는 환경이면 관리자 설정 전달 방식도 필요하다.

### AR-02 [P1] 잠금 대기 주문이 거래 동결 이후에도 접수됨

- 직접 재현 위치: `lib/commodities/commodityLedger.ts:69`, `:77`, `:78`, `:193`.
- 동일 구조 관찰: `lib/engine/dbMatching.ts:120`, `:135`, `:322`; `lib/options/optionOrderService.ts:96` 및 이후 종목·계좌·커밋 잠금.
- 원인: 동결 확인은 비동기 잠금을 획득하기 전에 한 번만 실행된다. 잠금 대기 중 관리자가 동결을 완료해도 실제 주문 변경 시점에는 다시 확인하지 않는다.
- 격리 재현 순서:
  1. 신규 `MemoryDatabase`에서 계좌의 `withAccountLocks([userId], ...)`를 Promise로 유지한다.
  2. 동결이 꺼진 상태에서 `reserveMarginAndSubmitCommodityOrder()`를 시작해 같은 계좌 잠금을 기다리게 한다.
  3. 해당 DB의 `adminSettings.trading_halt`를 `true`로 전환한다.
  4. 기존 잠금을 해제하고 주문 결과와 예약 장부를 읽는다.

```json
{"halted":true,"success":true,"statusCode":200,"reservations":1}
```

- 영향: 동결 전에 진입했으나 아직 확정되지 않은 주문이 동결 이후 증거금을 차감하고 미체결 장부에 남는다. 원자재 체결까지 일어났다는 뜻은 아니며, 동결 이후 **신규 접수·예약이 성공한 것**을 재현했다.
- 증거 범위: 원자재 경로는 실제 잠금 경합으로 재현했다. 주식·옵션의 같은 시간차 문제는 코드상 확인했으며 별도의 동적 재현은 하지 않았다.
- 수정 방향: 실제 변경을 직렬화하는 커밋 게이트 내부에서 동결을 재검사한다. 관리자 동결 변경과 주문 확정의 순서를 같은 권위 경계에서 보장하고, 원자재 tickLock 대기까지 포함한 회귀 테스트를 추가한다.

### AR-03 [P2] 관리자 조회와 신규 시나리오 주입이 주식 시나리오 진행도를 되돌림

- 위치: `lib/engine/localStandaloneServer.ts:187`~`:215`, `app/api/admin/scenarios/route.ts:22`, `:32`, `:122`~`:141`.
- 원인: Standalone은 `memoryDb.scenarioRuntimeState`로부터 임시 `ScenarioManager`를 복원해 주식 진행도를 갱신한다. 관리자 API는 다른 객체인 `commodityEngineInstance.scenarioManager`를 계속 조회한다. 이 객체는 주식 틱의 변경을 받지 않으며 신규 주입 시 이 객체의 전체 스냅샷으로 DB의 진행도를 덮어쓴다.
- 격리 재현: 실제 관리자 POST로 10틱짜리 stock/pump 시나리오를 주입했다. 별도 Standalone 인스턴스의 에이전트 거래 스텝만 no-op으로 대체하여 주문·시세 노이즈를 제외하고 실제 `tick()` 수명주기를 3회 실행했다. 이어 실제 관리자 GET과 두 번째 시나리오 주입 POST를 호출했다.

```json
{"status":200,"stateAfter3":7,"apiAfter3":10,"stateAfterNew":10}
```

- 영향: 관리자는 실제 남은 틱을 보지 못하고, 추가 주입/다른 관리자 조작으로 기존 진행도를 되돌릴 수 있다. 완료된 시나리오도 오래된 관리자 객체에 남으면 후속 전체 스냅샷 저장으로 다시 유입될 수 있는 구조다. **완료 후 재활성화 자체는 별도 동적 검증하지 않았다.**
- 수정 방향: 단일 권위 시나리오 상태를 사용하거나 자산별 진행도를 병합·동기화한다. 조회·추가 주입·원자재 틱·주식 틱이 같은 진행 상태를 관찰하도록 한다.

### AR-04 [P2] 만기 옵션의 미체결 주문이 남아 예약금을 계속 점유

- 위치: `engine-server/src/settlement/SettlementBatchService.ts:65`~`:108`, `lib/repositories/inMemory/InMemorySettlementRepository.ts:1509`~`:1667`, `lib/engine/localStandaloneServer.ts:219`~`:306`.
- 예약금 계산: `lib/engine/orderRisk.ts`의 `calculateSingleBuyOrderReservedCash()`는 계약 만기가 아닌 `open`/`partial` 상태를 기준으로 예약금을 산출한다.
- 원인: 만기 배치는 보유 옵션의 지급·보유 제거를 수행하지만 같은 계약의 사용자 미체결 주문을 취소/만료시키지 않는다. 20틱 봇 주문 정리는 실제 사용자 주문을 보존하므로 이를 정리하지도 않는다.
- 격리 재현 순서:
  1. 미래 만기의 IDX 옵션을 현재가 5, 승수 250,000으로 두고 실제 `submitAuthoritativeOptionOrder()`로 매수가 0.01, 수량 1의 미체결 지정가 주문을 접수한다.
  2. 동일 사용자의 해당 옵션 보유 1계약을 생성하고 계약 만기를 과거로 이동한다.
  3. Standalone 실제 50번째 틱의 만기 배치를 실행한다. 거래 스텝만 no-op으로 대체하여 만기 배치를 독립적으로 확인한다.
  4. 보유 제거, 주문 상태, `getAvailableCashKrw()` 예약금을 확인한다.

```json
{"submitSuccess":true,"holdingStillExists":false,"orderStatus":"open","reservedCash":2503}
```

- 영향: 만기 정산은 끝났어도 거래할 수 없는 옵션의 주문이 계속 가용 예수금을 줄인다. 수동 취소 전까지 자금이 묶이고 사용자 미체결 목록도 오염된다. 수동 취소 불가능이나 영구 손실을 주장하는 것은 아니다.
- 수정 방향: 만기 계약의 open/partial 주문을 동일한 계좌 락·커밋·영속 경계에서 expired/cancelled로 전환한다. 보유가 전혀 없고 미체결 주문만 있는 계좌도 대상에 포함하고 영속 실패 시 주문 상태와 예약금도 롤백한다.

## 검증 환경과 한계

- `node --import tsx scripts/test-full-review-2026-11-20-fixes.ts`: **exit 0**, F01~F10 전체 통과.
- 추가 재현 4건: 임시 `%TEMP%/stocksys-*-audit-*` 계열 `STOCKSYS_DATA_DIR`, 별도 인메모리 DB/로컬 Request 객체를 사용했다. 재현 코드는 Node/tsx 인라인 실행이며 애플리케이션·기존 테스트 파일을 변경하지 않았다.
- Node/tsx 최초 실행은 샌드박스의 `uv_os_get_passwd ENOMEM`으로 시작에 실패했으며 승인 후 샌드박스 밖에서 실행했다. 이를 애플리케이션 결함으로 집계하지 않았다.
- 독립 엔진 첫 검증용 fixture에서 `idGenerator` 주입 누락으로 실패한 결과는 폐기하고, 올바른 주입 구성으로 실제 tick 체결을 재현했다. fixture 오류를 애플리케이션 결함으로 집계하지 않았다.
- 운영 `.data`, 원격 DB, 실계정 OAuth, 브라우저 클릭 흐름에는 접근하지 않았다. 이번에는 타입/린트/빌드를 다시 실행하지 않았으며 통과했다고 주장하지 않는다.
- 이번 요청은 추가 오류 탐색이므로 수정·커밋·푸시·배포를 수행하지 않았다.
