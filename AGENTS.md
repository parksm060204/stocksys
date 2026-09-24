<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:prompt-logging -->
# 작업 이력 로깅 (프롬프트 로깅)

사용자가 요청한 내용을 바탕으로 AI(LLM)가 실제로 수행하고 구현한 결과물을 요약하여 프로젝트 루트의 `HISTORY.md` 파일 하단에 추가해야 한다.
- 사용자의 프롬프트를 그대로 복붙하는 것이 아니라, 해당 요청을 통해 "어떤 사항이 변경되고 구현되었는지"를 간략하게 요약하여 기록한다.
- 각 기록은 구분선(`---`)과 함께 타임스탬프를 포함하여 기록한다.
- 포맷:
  ```markdown
  ---
  ## YYYY-MM-DD HH:MM

  **요청 요약:** [사용자의 요청 내용 핵심]
  **수행 결과:**
  - [실제로 수정한 파일이나 구현된 내용 간략 요약 1]
  - [실제로 수정한 파일이나 구현된 내용 간략 요약 2]
  ```
- HISTORY.md가 없으면 생성한다.
- 기록은 파일 끝에 계속해서 append한다.
- 단, `.opencode/` 관련 설정 변경, AGENTS.md 자체 수정, 또는 프롬프트 로깅 규칙 자체에 대한 논의는 기록하지 않는다.
<!-- END:prompt-logging -->

<!-- BEGIN:database-policies -->
# 데이터베이스 정책 (최신)

테이블을 생성하거나 액세스할 때 아래 사항을 항상 적용한다.

## 1. 명시적인 GRANT

`anon`, `authenticated` 역할이 API를 통해 테이블에 접근할 수 있도록 GRANT SQL 문을 반드시 포함한다.

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE table_name TO anon, authenticated;
```

## 2. RLS 활성화

모든 테이블에 RLS(Row Level Security)를 활성화한다.

```sql
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;
```

## 3. RLS Policy

인증된 유저(authenticated)만 본인의 데이터를 읽고 쓸 수 있도록 Policy를 작성한다.

```sql
-- SELECT: 본인 데이터만 조회
CREATE POLICY "Users can view their own data"
ON table_name FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- INSERT: 본인 데이터만 삽입
CREATE POLICY "Users can insert their own data"
ON table_name FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- UPDATE: 본인 데이터만 수정
CREATE POLICY "Users can update their own data"
ON table_name FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- DELETE: 본인 데이터만 삭제
CREATE POLICY "Users can delete their own data"
ON table_name FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
```
<!-- END:database-policies -->

<!-- BEGIN:critical-lessons -->
# 🚨 크리티컬 장애 이력 & 재발 방지 규칙

이 섹션은 실제 프로덕션에서 발생한 장애 사례를 기록하고, AI 에이전트가 동일한 실수를 반복하지 않도록 강제 규칙으로 명시한다.

---

## ❌ 장애 #1: VM 디스크 100% 포화 → 서비스 전체 중단

### 원인
- 50개 기관 봇이 24시간 가동되며 `trades` 테이블에 매 틱 무한 `INSERT`를 반복.
- `stock_price_history` 테이블에도 매 틱마다 모든 종목의 시세를 무한 `INSERT`.
- PostgreSQL WAL(Write-Ahead Log) 트랜잭션 파일이 지워지지 않고 `/root/vm-db/data/` 디렉터리에 누적 → **15GB 가득 참**.
- `orders` 테이블에서 LP 주문을 `DELETE → INSERT` 반복 시 PostgreSQL MVCC 특성상 **Dead Tuple**이 쌓여 디스크와 WAL 폭발 가속.

### 재발 방지 규칙 (필수)
1. **`trades` 테이블에 Ring Buffer(롤링 슬라이딩 캡) 적용 필수**: 새 체결 INSERT 후 매 20틱마다 `trimOldTrades()`를 호출하여 최신 5,000건만 유지. **절대로 `trades` 테이블을 무한 누적 저장하지 않는다.**
2. **`stock_price_history`에 롤링 캡 적용 필수**: 최신 3,000건 초과분을 주기적으로 트리밍.
3. **`orders`에서 `DELETE → INSERT` 패턴 금지**: LP 호가 갱신 시 반드시 UPSERT 또는 슬라이딩 윈도우 방식 사용. `safeDeleteLpOrders()`가 아닌 방식의 무제한 DELETE는 금지.
4. **PostgreSQL WAL 제한 설정 필수**: `docker-compose.yml`의 Postgres 컨테이너에 반드시 `-c max_wal_size=1GB -c min_wal_size=80MB` 플래그가 있어야 한다. 이 플래그 없이 Postgres를 기동하는 것은 금지.
5. **Docker 컨테이너 로그 사이즈 제한 필수**: 모든 컨테이너에 `logging: driver: json-file, options: max-size: 10m, max-file: 3` 설정이 없으면 서비스를 기동하지 않는다.

---

## ❌ 장애 #2: NextAuth `CLIENT_FETCH_ERROR` (`Unexpected token '<'`)

### 원인
- `app/api/auth/[...nextauth]/route.ts`의 `signIn`/`jwt` 콜백에서 DB 쿼리가 실패할 때 `throw`가 발생.
- NextAuth가 내부적으로 JSON 응답을 기대하는 엔드포인트에서 500 HTML 에러 페이지가 반환됨.
- 클라이언트가 HTML을 JSON으로 파싱하려다 `Unexpected token '<'` 에러 발생.

### 재발 방지 규칙 (필수)
1. **NextAuth 콜백(`signIn`, `jwt`, `session`) 내부에서 DB 쿼리는 반드시 `try-catch`로 감싸야 한다.**
2. `.single()` 대신 **`.maybeSingle()`을 사용**하여 row가 없을 때 에러가 아닌 `null`을 반환하도록 한다.
3. DB가 다운되어도 NextAuth가 graceful하게 처리할 수 있어야 하며, DB 에러를 이유로 인증 플로우 자체가 500을 뱉으면 안 된다.

```typescript
// ✅ 올바른 패턴
async signIn({ user }) {
  try {
    const { data } = await db.from('profiles').select().eq('id', user.id).maybeSingle();
    // ... 처리
    return true;
  } catch (e) {
    console.error('[Auth] signIn DB error (ignored):', e);
    return true; // DB 에러여도 로그인 자체는 허용
  }
}
```

---

## ❌ 장애 #3: 환경 변수 `dbUrl is required` 크래시

### 원인
- 환경변수 불일치 또는 미설정 시 엔진 및 NextAuth 코드가 DB URL 누락으로 크래시 발생 가능.

### 재발 방지 규칙 (필수)
1. **환경변수는 명확한 표준 이름을 사용**한다.
2. `.env.local`에서 표준 URL을 정의한다:
   ```env
   NEXT_PUBLIC_ENGINE_DB_URL=http://49.247.136.231:3001
   ```
3. 코드 내에서도 `process.env.NEXT_PUBLIC_ENGINE_DB_URL || 'http://localhost:3001'` 형태의 안전한 fallback 패턴을 사용한다.

---

## ❌ 장애 #4: 기관 봇 자산 변화가 DB에 영구 반영되지 않음

### 원인
- `trades` 테이블에 체결 로그를 기록하고, 기관 봇의 포트폴리오 상태는 **메모리에만 존재**하여, 엔진 서버 재시작 시 50개 기관 봇의 현금/주식 보유 상태가 초기값으로 리셋됨.

### 재발 방지 규칙 (필수)
1. **`institutional_portfolios` 테이블은 항상 실존해야 하며**, 엔진 서버가 체결을 확정할 때마다 해당 봇의 자산 상태를 DB에 `UPSERT` 해야 한다.
2. **체결 로그(trades)와 자산 장부(institutional_portfolios)를 반드시 분리**한다:
   - `trades`: 화면 렌더링용, 롤링 윈도우(최신 5,000건)로 관리.
   - `institutional_portfolios`: 영구 자산 장부, In-Place UPDATE, Row 수 고정.
3. `vm-db/sql/init/01_schema.sql`에 `institutional_portfolios` 테이블 정의가 반드시 포함되어야 한다. 이 테이블 없이 DB 초기화하는 것은 금지.

---

## ✅ VM DB 운영 체크리스트

새로 DB를 초기화(`bash setup.sh`)하거나 `docker-compose.yml`을 수정할 때 아래 사항을 반드시 확인한다:

- [ ] `docker-compose.yml` Postgres에 `max_wal_size=1GB` 플래그가 있는가?
- [ ] 모든 컨테이너에 Docker 로그 rotation 설정이 있는가?
- [ ] `01_schema.sql`에 `institutional_portfolios` 테이블이 정의되어 있는가?
- [ ] `MarketEngine.ts`에 `trimOldTrades()` 롤링 트리밍 호출이 매 20틱마다 있는가?
- [ ] `.env.local`에 `NEXT_PUBLIC_ENGINE_DB_URL`이 존재하는가?
- [ ] NextAuth 콜백이 모두 `try-catch`로 보호되어 있는가?
<!-- END:critical-lessons -->
