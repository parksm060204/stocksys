-- =====================================================================
-- Phase 5: Auth & Rogue-lite Events Migration
-- =====================================================================

-- 1. profiles 테이블 업데이트
ALTER TABLE public.profiles ALTER COLUMN cash SET DEFAULT 5000000;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS acquired_passives JSONB DEFAULT '[]'::jsonb;

-- 2. player_events 테이블 생성
CREATE TABLE IF NOT EXISTS public.player_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage INT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  choice_a_text TEXT NOT NULL,
  choice_a_cost BIGINT DEFAULT 0,
  choice_a_passive TEXT,
  choice_b_text TEXT NOT NULL,
  choice_b_cost BIGINT DEFAULT 0,
  choice_b_passive TEXT
);

-- RLS for player_events
GRANT SELECT ON TABLE public.player_events TO anon, authenticated;
ALTER TABLE public.player_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read events" ON public.player_events FOR SELECT USING (true);

-- 3. 샘플 데이터 삽입
TRUNCATE TABLE public.player_events;

INSERT INTO public.player_events (stage, title, description, choice_a_text, choice_a_cost, choice_a_passive, choice_b_text, choice_b_cost, choice_b_passive) VALUES
(1, '[어둠의 정보상]', '술집에서 우연히 기관 트레이더의 잡담을 엿들었습니다. 술값을 대신 내주면 더 고급 정보를 알려주겠다고 합니다.', '술값 50만 원을 대신 내준다.', 500000, 'FEE_REDUCTION_10', '무시하고 자리를 뜬다.', 0, 'MENTAL_STEEL'),
(1, '[작전 세력의 제안]', '정체불명의 텔레그램 방에 초대되었습니다. 시키는 대로 매수벽을 세워주면 뒷돈을 챙겨준다고 합니다.', '위험하지만 가담한다.', -2000000, NULL, '방을 나가고 금감원에 찌른다.', 0, 'FSS_REWARD'),
(1, '[오류 난 알고리즘 봇]', '해외 헤지펀드의 매매 봇 소스코드가 다크웹에 100만 원에 올라왔습니다.', '100만 원에 구매하여 분석한다.', 1000000, 'PREDICT_HEDGEFUND', '사기일지 모르니 지나친다.', 0, NULL);

-- 4. active_player_events 테이블 (현재 유저에게 떠있는 팝업)
CREATE TABLE IF NOT EXISTS public.active_player_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.player_events(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  created_at TIMESTAMPTZ DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.active_player_events TO anon, authenticated;
ALTER TABLE public.active_player_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own active events" ON public.active_player_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users update own active events" ON public.active_player_events FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Service role can insert active events" ON public.active_player_events FOR INSERT TO authenticated WITH CHECK (true); -- simplified for demo
CREATE POLICY "Anon can insert active events" ON public.active_player_events FOR INSERT TO anon WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.active_player_events;
