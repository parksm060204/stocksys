CREATE TABLE macro_calendar (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_date DATE NOT NULL DEFAULT CURRENT_DATE,
  trigger_time TEXT NOT NULL,       -- 예: "21:30"
  event_name TEXT NOT NULL,         -- 예: "US CPI (YoY)"
  period TEXT,                      -- 예: "Jun"
  impact_level TEXT NOT NULL,       -- 'HIGH', 'MEDIUM', 'LOW'
  survey_value TEXT,                -- 예: "3.1%"
  actual_value TEXT,                -- 예: "3.3%" (시간 되면 제미나이가 채움)
  status TEXT DEFAULT 'PENDING',    -- 'PENDING', 'RELEASED'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS 활성화
ALTER TABLE macro_calendar ENABLE ROW LEVEL SECURITY;

-- 누구나 읽을 수 있게 (anon, authenticated 모두)
CREATE POLICY "Anyone can read macro_calendar"
ON macro_calendar FOR SELECT
TO anon, authenticated
USING (true);

-- 엔진에서만 업데이트
-- Service Role 우회

-- 초기 테스트 데이터 주입
INSERT INTO macro_calendar (trigger_time, event_name, period, impact_level, survey_value, actual_value, status) VALUES
('18:30', 'Eurozone CPI (YoY)', 'Jun', 'MEDIUM', '2.5%', '--', 'PENDING'),
('19:30', 'Initial Jobless Claims', 'Jul 4', 'HIGH', '230k', '--', 'PENDING'),
('21:30', 'US Core CPI (MoM)', 'Jun', 'HIGH', '0.2%', '--', 'PENDING'),
('22:00', 'ISM Manufacturing PMI', 'Jun', 'HIGH', '48.5', '--', 'PENDING'),
('22:15', 'Fed Chair Powell Speaks', '', 'HIGH', '--', '--', 'PENDING');
