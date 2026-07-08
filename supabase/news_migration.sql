CREATE TABLE real_news (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source TEXT NOT NULL,
  title TEXT NOT NULL UNIQUE, -- 제목 중복 방지 (간이 처리)
  link TEXT,
  pub_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS 활성화
ALTER TABLE real_news ENABLE ROW LEVEL SECURITY;

-- 누구나 읽을 수 있게 (anon, authenticated 모두)
CREATE POLICY "Anyone can read real_news"
ON real_news FOR SELECT
TO anon, authenticated
USING (true);

-- 쓰기는 서비스 역할(Service Role)이나 관리자만 가능하도록 (일반 유저 쓰기 금지)
-- 엔진 서버는 Service Role Key를 사용하므로 RLS를 우회하여 INSERT 가능합니다.
