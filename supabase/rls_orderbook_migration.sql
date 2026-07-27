-- =====================================================================
-- RLS Migration: 호가창/체결내역 공개 조회 허용
-- 모든 authenticated 유저가 orders + trades 테이블 조회 가능하도록 수정
-- (기존 제한적 RLS 정책은 본인 주문 또는 LP(null)만 조회 가능했음)
-- =====================================================================

-- 1) ORDERS — 기존 제한적 정책 삭제 후 공개 조회 정책 추가
DROP POLICY IF EXISTS "Users can view orders" ON public.orders;
DROP POLICY IF EXISTS "Users can view orders anon" ON public.orders;

-- 모든 authenticated 유저가 모든 open 주문 조회 가능 (호가창 표시용)
CREATE POLICY "Anyone can view all orders"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (true);

-- anon도 조회 가능 (비로그인 상태에서도 호가창은 볼 수 있도록)
CREATE POLICY "Anyone can view all orders anon"
  ON public.orders
  FOR SELECT
  TO anon
  USING (true);

-- 2) TRADES — 이미 공개되어 있지만 명시적으로 재확인
DROP POLICY IF EXISTS "Anyone can view trades" ON public.trades;
DROP POLICY IF EXISTS "Anyone can view trades anon" ON public.trades;

CREATE POLICY "Anyone can view all trades"
  ON public.trades
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anyone can view all trades anon"
  ON public.trades
  FOR SELECT
  TO anon
  USING (true);

-- 3) STOCKS — 현재가 조회도 공개 (이미 대부분 공개되어 있지만 확인)
DROP POLICY IF EXISTS "Anyone can view current prices" ON public.stocks;
DROP POLICY IF EXISTS "Anyone can view stock prices" ON public.stocks;
DROP POLICY IF EXISTS "Anyone can view stock prices anon" ON public.stocks;
CREATE POLICY "Anyone can view stock prices"
  ON public.stocks
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anyone can view stock prices anon"
  ON public.stocks
  FOR SELECT
  TO anon
  USING (true);