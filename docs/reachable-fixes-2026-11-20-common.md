# 확정 리뷰 결함 9건 수정: 공통 지시

사용자가 `docs/reachable-review-2026-11-19-findings.md`의 리뷰 결함 수정을 요청했다. 현재 과제는 구현이다. 확정 RR-01~RR-09와 각 작업 담당 범위만 수정한다. 의심 SU-* 6개는 해결됐다고 주장하지 않는다. 이전 사용자 지정 antigravity / gemini-4-hydrogen-high / high를 사용한다.

- AGENTS.md를 준수하고 Next 코드 작성 전 설치된 node_modules/next/dist/docs 해당 가이드를 읽는다. 여러 TSX 수정 시 vercel:react-best-practices 스킬을 적용한다. 기존 미커밋 작업을 보존한다.
- 작업자는 보안, 정산/저장, UI 세 영역으로 나뉘어 같은 워크트리를 사용한다. **자기 과제의 파일만 편집**한다. 다른 담당 파일이 필요하면 코디네이터에 메시지로 알린다. 다른 작업자의 파일을 되돌리거나 수정하지 않는다. git reset/checkout/clean/커밋/푸시를 하지 않는다.
- .codex/hooks.json, .codex/run-impeccable-hook.cjs, debug.log, 실제 .env 파일, 기존 보고서는 수정하지 않는다. 운영 .data/외부 DB/OAuth 공급자를 변경하거나 비밀값을 출력하지 않는다.
- 테스트는 각 실행마다 임시 STOCKSYS_DATA_DIR/독립 DB로 격리한다. `npx` 백그라운드/inline 명령에서 멈추는 문제가 반복됐으므로 로컬 `node --import tsx`와 개별 timeout(일반 60초), 충분한 출력 버퍼를 사용한다. 시작한 작업의 결과를 반드시 회수한다. 응답 없는 단일 배치를 계속 대기하지 않는다.
- 자기 영역의 재현 반례와 관련 회귀를 검증한다. 변경을 덮는 assert 삭제/skip/완화나 process.exit(0)로 실패·대기를 숨기지 않는다. 전체 테스트·공용 빌드/전체 lint는 모든 워커 완료 후 코디네이터가 실행한다. 작업자들이 .next 빌드를 동시에 실행하지 않는다.
- HISTORY.md 동시 쓰기를 피하기 위해 작업자는 **HISTORY를 편집하지 않는다**. 실제 변경·검증 요약을 자기 결과 문서에 남기고 코디네이터가 최종 HISTORY에 합쳐 기록한다.
- 결과 문서에는 RR 번호, 변경 파일·좁은 행, 정책/호환성, 실제 명령·exit·검증 로그, 미해결 및 미검증 범위를 기록한다. 반드시 worker_done으로 보고한다. 필수 결함이 남으면 succeeded로 보고하지 않는다.

## 보안/UI 공유 인터페이스

보안 워커만 `lib/news/accessPolicy.ts`를 생성·편집한다. 서버 DB/세션 의존성이 없는 순수 모듈로 아래를 export한다.

```ts
export function canReadRumor(
  profile?: { is_admin?: boolean; news_subscriptions?: Record<string, string> } | null,
  nowMs?: number,
): boolean;
export function authorizeNewsRecord(record: any, hasRumorAccess: boolean): any;
```

`authorizeNewsRecord`는 기존 sanitizePublicNewsRecord를 적용하고 권한 없는 RUMOR의 본문/summary/body를 가린다. 원본을 변경하지 않는다. `canReadRumor`는 관리자 또는 실제 유효 구독 여부를 판정한다. 보안 워커가 API에서, UI 워커가 서버 페이지에서 이 인터페이스를 사용한다. UI 워커는 모듈을 편집하지 않으며 파일이 아직 없으면 페이지 작업 후 해당 의존성 대기를 명시한다. 최종 통합은 코디네이터가 확인한다.
