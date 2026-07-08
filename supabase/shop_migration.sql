-- =====================================================================
-- Phase 7: Shop Subscription System RPC Migration
-- =====================================================================

-- 1. profiles 테이블에 news_subscriptions 필드 추가 (기존에 없을 경우 대비)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS news_subscriptions JSONB DEFAULT '{}'::jsonb;

-- 2. 언론사 구독 결제 및 기간 연장 RPC 함수 추가
CREATE OR REPLACE FUNCTION purchase_news_subscription_v2(
  user_uuid UUID,          
  agency_id TEXT,            
  total_price NUMERIC,       
  add_days INTEGER           
) RETURNS BOOLEAN AS $$
DECLARE
  current_cash NUMERIC;
  current_subs JSONB;
  existing_expiry TIMESTAMPTZ;
  new_expiry TIMESTAMPTZ;
BEGIN
  -- 유저 예수금 조회 (portfolios 테이블 기준)
  SELECT cash_balance INTO current_cash FROM public.portfolios WHERE user_id = user_uuid;
  
  -- 잔액 부족 시 FALSE 반환
  IF current_cash < total_price THEN 
    RETURN FALSE; 
  END IF;
  
  -- 잔액 차감
  UPDATE public.portfolios SET cash_balance = cash_balance - total_price WHERE user_id = user_uuid;

  -- 현재 구독 상태 조회
  SELECT news_subscriptions INTO current_subs FROM public.profiles WHERE id = user_uuid;
  
  -- 기존 만료일 추출 시도
  BEGIN
    existing_expiry := (current_subs->>agency_id)::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN 
    existing_expiry := NULL;
  END;

  -- 기존 구독권이 유효하게 남아있다면 잔여 기간에 추가, 아니라면 지금부터 추가
  IF existing_expiry IS NOT NULL AND existing_expiry > NOW() THEN
    new_expiry := existing_expiry + (add_days || ' days')::INTERVAL;
  ELSE
    new_expiry := NOW() + (add_days || ' days')::INTERVAL;
  END IF;

  -- profiles 테이블 업데이트 (JSONB 객체 병합)
  UPDATE public.profiles
  SET news_subscriptions = COALESCE(news_subscriptions, '{}'::jsonb) || jsonb_build_object(agency_id, new_expiry)
  WHERE id = user_uuid;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 익명 및 로그인 유저를 위한 RPC 실행 권한 부여
GRANT EXECUTE ON FUNCTION purchase_news_subscription_v2(UUID, TEXT, NUMERIC, INTEGER) TO anon, authenticated;
