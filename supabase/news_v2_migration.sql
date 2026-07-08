-- =====================================================================
-- Phase 6: Subscription Premium News & Media Outlets Migration
-- =====================================================================

-- 1. profiles 테이블에 subscriptions 배열(JSONB) 추가
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS subscriptions JSONB DEFAULT '[]'::jsonb;

-- 2. media_outlets 테이블 생성
CREATE TABLE IF NOT EXISTS public.media_outlets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('MACRO', 'MICRO')),
  reliability INT NOT NULL CHECK (reliability >= 0 AND reliability <= 100),
  subscription_fee BIGINT NOT NULL DEFAULT 0,
  description TEXT
);

-- RLS
GRANT SELECT ON TABLE public.media_outlets TO anon, authenticated;
ALTER TABLE public.media_outlets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read media_outlets" ON public.media_outlets FOR SELECT USING (true);

-- 샘플 데이터 삽입 (기존 데이터 초기화)
TRUNCATE TABLE public.media_outlets CASCADE;
INSERT INTO public.media_outlets (name, type, reliability, subscription_fee, description) VALUES
('월스트리트 저널 (WSJ)', 'MACRO', 95, 500000, '최고 권위. 글로벌 거시경제 지표 발표. 거의 무조건 팩트.'),
('불룸버그 (Bloomberg)', 'MACRO', 95, 450000, '글로벌 금융, 원자재 중심 속보.'),
('로이터즈 (Reuters)', 'MACRO', 90, 400000, '연준(Fed) 인사 발언 등 거시경제 시황.'),
('파이넨셜 타임스 (FT)', 'MACRO', 90, 300000, '글로벌 금융 정책 관련 매크로 뉴스.'),
('뉴욕 다임스 (NY Dimes)', 'MICRO', 60, 150000, '뉴욕 타임스 패러디 (Dime=10센트). 은근히 사실이 섞여있음.'),
('워싱턴 토스트 (Wash Toast)', 'MICRO', 50, 100000, '워싱턴 포스트 패러디. 개별 기업의 정치적 로비 등 보도.'),
('뽀브스 (Fauxbes)', 'MICRO', 40, 50000, '포브스 패러디 (Faux=가짜). 자극적인 억만장자 가십.'),
('CNBS', 'MICRO', 30, 30000, 'CNBC 패러디 (BS=헛소리). 전문가를 빙자한 종목 추천 찌라시.'),
('더 썬 (The Sun)', 'MICRO', 20, 10000, '영국 타블로이드 더 선. 자극적이고 원색적인 루머 양산.'),
('데일리 페일 (Daily Fail)', 'MICRO', 10, 5000, '데일리 메일 패러디 (Fail=실패). 대놓고 가짜뉴스가 판치는 하급 언론.'),
('기업 전자공시 (DART)', 'MICRO', 100, 0, '기업의 공식 해명 및 정정 보도를 담당하는 전자공시 채널.');

-- 3. premium_news 테이블 생성
CREATE TABLE IF NOT EXISTS public.premium_news (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_outlet_id INT REFERENCES public.media_outlets(id) ON DELETE CASCADE,
  headline TEXT NOT NULL,
  content_summary TEXT NOT NULL,
  is_quoted BOOLEAN DEFAULT false,
  is_true BOOLEAN DEFAULT true, -- 엔진만 참고
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
GRANT SELECT ON TABLE public.premium_news TO anon, authenticated;
ALTER TABLE public.premium_news ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read premium_news" ON public.premium_news FOR SELECT USING (true);
-- Service Role writes via backend

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.premium_news;
