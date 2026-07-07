<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:prompt-logging -->
# 프롬프트 로깅

사용자가 보내는 모든 프롬프트(메시지)를 프로젝트 루트의 `README.md` 파일 하단에 추가해야 한다.
- 각 프롬프트는 구분선(`---`)과 함께 타임스탬프를 포함하여 기록한다.
- 포맷:
  ```markdown
  ---
  ## YYYY-MM-DD HH:MM

  [프롬프트 내용]
  ```
- README.md가 없으면 생성한다.
- 기록은 파일 끝에 계속해서 append한다.
- 단, `.opencode/` 관련 설정 변경, AGENTS.md 자체 수정, 또는 프롬프트 로깅 규칙 자체에 대한 논의는 기록하지 않는다.
<!-- END:prompt-logging -->

<!-- BEGIN:supabase-policies -->
# Supabase 정책 (최신)

테이블을 생성하거나 액세스할 때 아래 사항을 항상 적용한다.

## 1. 명시적인 GRANT

`anon`, `authenticated` 역할이 PostgREST API를 통해 테이블에 접근할 수 있도록 GRANT SQL 문을 반드시 포함한다.

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
<!-- END:supabase-policies -->
