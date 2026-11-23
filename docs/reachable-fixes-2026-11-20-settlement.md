# 정산·저장 워커: RR-03 / RR-04 / RR-05

먼저 `docs/reachable-fixes-2026-11-20-common.md`와 원본 리뷰를 읽는다.

## 소유 파일

- lib/engine/localStandaloneServer.ts
- engine-server/src/settlement/SettlementBatchService.ts
- engine-server/src/settlement/BondCouponEngine.ts
- engine-server/src/settlement/types.ts
- lib/repositories/inMemory/InMemorySettlementRepository.ts
- lib/repositories/types.ts
- lib/memoryDb/memoryStore.ts (정산/정리 수정에 필요한 경우에만)
- scripts/test-reachable-settlement-fixes.ts (신규)
- docs/reachable-fixes-2026-11-20-settlement-results.md (신규)

다른 영역, 기존 테스트, HISTORY는 편집하지 않는다. 허용 범위 밖 파일이 필요하면 코디네이터에게 알린다.

## 구현

1. RR-03: 채권 쿠폰 주기/period key/최종 쿠폰의 권위 검증을 통일한다. 기본 분기(연 4회)를 월간 키마다 지급하지 않는다. 이미 저장된 monthly idempotency keys/지급이력과 호환하여 같은 분기의 재시작·재실행 중복지급을 막는다. 기존 과다 지급을 몰래 차감하지 않는다. 최종 쿠폰이 지급됐다면 원금만 정산하고, 최근 지급 이력 충돌을 이유로 원금 지급을 막지 않는다. 기존 정산키 압축 regex와 period 구조를 깨서 새 무제한 Set을 만들지 않는다. 만기/행사가/보유량을 추측 변경하지 않는다.
2. RR-04: Next.js standalone의 실제 틱 경로에 **같은 DB**의 만기 옵션·채권 정산을 연결한다. 별도 engine-server DB를 공유하려 하지 않는다. WallClock(실 사용자 API)과 headless simulation 시계의 차이를 확인하여 2026년 3월로 고정된 ABM 시각 때문에 실제 만기를 놓치지 않게 한다. 정산에 따른 자산/원장/보유량 변경을 적절한 account/stock/commit gate 순서로 원자적으로 저장하고, 저장 실패 시 런타임·DB 복원 및 재시도 exactly-once를 보장한다. 커밋 게이트 안에서 상위락을 역취득하는 교착을 만들지 않는다.
3. RR-05: AgentManager의 실제 system bot/LP 계좌를 신뢰할 수 있는 registry로 구분해 종료 orders를 고정 cap/retention으로 관리한다. `if (user_id) continue`로 acc_* 봇 종료 기록을 모두 무기한 보존하지 않는다. 사용자 ID prefix만 보고 실제 사람 주문을 삭제하거나 활성 주문/예약을 삭제하지 않는다. 일반 사용자 주문, 정산 멱등 원장, 보유 장부를 보존하고 보조 인덱스·스냅샷을 일치시킨다.

## 검증

- SettlementBatchService 실제 진입으로 1/2/3월→동일 분기 1회, 다음 분기 1회, 직전 쿠폰 지급 후 만기 원금 성공, 재실행/재시작·legacy monthly 키·부분/복수 보유 계좌를 검증한다. 기본 상태에 채권 보유가 없다는 조건도 결과에 명시한다.
- standalone에서 실제 옵션 주문 서비스로 포지션을 만든 뒤 만기·ITM/OTM 처리, 현금/부채/보유/원장 변화, 저장 실패·재시도·이미 정산된 계약 재지급 방지를 검증한다. 코드에 없는 전용 engine-server 함수를 직접 호출한 것만으로 standalone 연결 성공을 주장하지 않는다.
- 실제 ABM 가동/cleanup과 대량 terminal bot order fixture로 cap 및 활성/인간 주문 보존·인덱스 일치·재시작을 검증한다.
- 새 테스트와 관련 정산/Phase2~4 회귀를 개별 timeout/임시 DATA_DIR로 실행하고 결과를 회수한다. 단일 긴 배치에 무기한 대기하지 않는다.
