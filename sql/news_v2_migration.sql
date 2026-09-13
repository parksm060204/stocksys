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
('스트리트 리포트 (Street Report)', 'MACRO', 95, 400000, '금융가 골목의 독립 금융 투자 레터. 글로벌 거시경제 지표와 금융 정책 위주 보도.'),
('피드 터미널 (Feed Terminal)', 'MACRO', 95, 400000, '실시간 속보 중심의 1인 미디어 금융 터미널 레터.'),
('와이어 넷 (Wire Net)', 'MACRO', 90, 400000, '글로벌 경제 연구원들의 비공식 메일링 리스트 시황.'),
('캐피탈 옵저버 (Capital Observer)', 'MACRO', 90, 400000, '금융 정책 분석 및 글로벌 자본 흐름 분석 칼럼 리포트.'),
('메트로 포스트 (Metro Post)', 'MICRO', 60, 50000, '뉴욕 시내 전역의 개별 기업 소식을 다루는 중소형 지역 언론.'),
('디스트릭트 레터 (District Letter)', 'MICRO', 50, 50000, '개별 기업 밀착 보도 및 정치 권력 관련 독점 로비 소식 전문 독립지.'),
('리치 가이드 (Rich Guide)', 'MICRO', 40, 50000, '자산가 및 고액 주주 동향을 다루는 가십성 독립 잡지.'),
('인베스트 캐스트 (Invest Cast)', 'MICRO', 30, 50000, '개인 투자자를 타겟으로 투자 의견과 개별 종목 소식을 전하는 인터넷 미디어.'),
('가십 썬 (Gossip Sun)', 'MICRO', 20, 50000, '자극적이고 원색적인 기업 루머를 양산하는 소형 인터넷 찌라시.'),
('페일 리포트 (Fail Report)', 'MICRO', 10, 50000, '극단적인 헤드라인과 검증되지 않은 루머를 무차별 보도하는 황색 리포트.'),
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
