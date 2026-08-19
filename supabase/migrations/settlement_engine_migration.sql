-- =====================================================================
-- Option Settlements & Bond Coupon Payments Migration
-- =====================================================================

-- 1. 옵션 만기 결제 기록 테이블
CREATE TABLE IF NOT EXISTS public.option_settlements (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  option_id               uuid NOT NULL REFERENCES public.options_contracts(id) ON DELETE CASCADE,
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  underlying_stock_id     uuid REFERENCES public.stocks(id) ON DELETE SET NULL,
  option_type             text NOT NULL CHECK (option_type IN ('CALL', 'PUT')),
  strike_price            numeric(18,4) NOT NULL,
  underlying_close_price  numeric(18,4) NOT NULL,
  is_itm                  boolean NOT NULL DEFAULT false,
  quantity                bigint NOT NULL DEFAULT 0,
  multiplier              numeric(18,4) NOT NULL DEFAULT 250000,
  payout_amount           numeric(18,4) NOT NULL DEFAULT 0,
  idempotency_key         text NOT NULL UNIQUE,
  settled_at              timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_option_settlements_user ON public.option_settlements(user_id);
CREATE INDEX IF NOT EXISTS idx_option_settlements_option ON public.option_settlements(option_id);
CREATE INDEX IF NOT EXISTS idx_option_settlements_key ON public.option_settlements(idempotency_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.option_settlements TO anon, authenticated;
ALTER TABLE public.option_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own option settlements"
ON public.option_settlements FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own option settlements"
ON public.option_settlements FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- 2. 채권 이자(쿠폰) 및 만기 원금 상환 기록 테이블
CREATE TABLE IF NOT EXISTS public.bond_coupon_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bond_id           uuid NOT NULL REFERENCES public.bonds(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_type      text NOT NULL CHECK (payment_type IN ('COUPON', 'MATURITY_REDEMPTION')),
  coupon_rate       numeric(6,3) NOT NULL DEFAULT 0,
  face_value        numeric(18,4) NOT NULL DEFAULT 10000,
  quantity          bigint NOT NULL DEFAULT 0,
  payment_amount    numeric(18,4) NOT NULL DEFAULT 0,
  idempotency_key   text NOT NULL UNIQUE,
  payment_date      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bond_coupon_payments_user ON public.bond_coupon_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_bond_coupon_payments_bond ON public.bond_coupon_payments(bond_id);
CREATE INDEX IF NOT EXISTS idx_bond_coupon_payments_key ON public.bond_coupon_payments(idempotency_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bond_coupon_payments TO anon, authenticated;
ALTER TABLE public.bond_coupon_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own bond coupon payments"
ON public.bond_coupon_payments FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own bond coupon payments"
ON public.bond_coupon_payments FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);
