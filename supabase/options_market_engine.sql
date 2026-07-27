-- =====================================================================
-- Options Market Engine Migration SQL
-- Rollover Combo Order Execution (Atomic Position Close + Open)
-- =====================================================================

-- 1. options_contracts 테이블 확장
CREATE TABLE IF NOT EXISTS public.options_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    underlying_stock_id UUID REFERENCES public.stocks(id) ON DELETE CASCADE,
    ticker VARCHAR(50) NOT NULL UNIQUE,
    asset_class VARCHAR(10) NOT NULL DEFAULT 'STK', -- 'IDX', 'STK', 'FUT'
    underlying_symbol VARCHAR(20) NOT NULL,
    option_type VARCHAR(5) NOT NULL CHECK (option_type IN ('CALL', 'PUT')),
    strike_price NUMERIC(15, 2) NOT NULL,
    current_price NUMERIC(15, 2) NOT NULL DEFAULT 1000,
    open_interest INT NOT NULL DEFAULT 0,
    volume INT NOT NULL DEFAULT 0,
    delta NUMERIC(6, 4) DEFAULT 0.50,
    gamma NUMERIC(6, 4) DEFAULT 0.05,
    theta NUMERIC(6, 4) DEFAULT -0.10,
    implied_volatility NUMERIC(6, 4) DEFAULT 0.25,
    expiry_date TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS & Grant policies
ALTER TABLE public.options_contracts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.options_contracts TO anon, authenticated;

CREATE POLICY "Anyone can view options contracts" ON public.options_contracts FOR SELECT USING (true);
CREATE POLICY "Authenticated users can execute options contracts" ON public.options_contracts FOR ALL TO authenticated USING (true);

-- 2. 옵션 체결 처리 RPC
CREATE OR REPLACE FUNCTION public.execute_option_order(
    p_user_id UUID,
    p_option_id UUID,
    p_side VARCHAR(5), -- 'BUY' or 'SELL'
    p_quantity INT,
    p_price NUMERIC
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total_cost NUMERIC;
    v_user_cash NUMERIC;
    v_contract RECORD;
BEGIN
    v_total_cost := p_price * p_quantity;

    SELECT * INTO v_contract FROM public.options_contracts WHERE id = p_option_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Option contract not found';
    END IF;

    IF p_side = 'BUY' THEN
        SELECT cash_balance INTO v_user_cash FROM public.portfolios WHERE user_id = p_user_id;
        IF v_user_cash IS NULL OR v_user_cash < v_total_cost THEN
            RAISE EXCEPTION 'Insufficient cash balance for option order';
        END IF;

        -- Deduct cash
        UPDATE public.portfolios SET cash_balance = cash_balance - v_total_cost WHERE user_id = p_user_id;

        -- Update Open Interest & Volume
        UPDATE public.options_contracts 
        SET open_interest = open_interest + p_quantity,
            volume = volume + p_quantity,
            current_price = p_price
        WHERE id = p_option_id;
    ELSIF p_side = 'SELL' THEN
        -- Add cash (Premium revenue)
        UPDATE public.portfolios SET cash_balance = cash_balance + v_total_cost WHERE user_id = p_user_id;

        -- Update Volume
        UPDATE public.options_contracts 
        SET volume = volume + p_quantity,
            current_price = p_price
        WHERE id = p_option_id;
    END IF;

    RETURN true;
END;
$$;

-- 3. 롤오버 원자적 결합 주문 RPC (Combo Order: 근월물 청산 + 원월물 진입)
CREATE OR REPLACE FUNCTION public.execute_rollover_combo(
    p_user_id UUID,
    p_curr_option_id UUID,
    p_next_option_id UUID,
    p_quantity INT,
    p_curr_price NUMERIC,
    p_next_price NUMERIC
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_spread NUMERIC;
    v_user_cash NUMERIC;
BEGIN
    -- Rollover Spread = Next Price - Curr Price
    v_spread := (p_next_price - p_curr_price) * p_quantity;

    SELECT cash_balance INTO v_user_cash FROM public.portfolios WHERE user_id = p_user_id;

    -- If Contango (Spread > 0), check cash
    IF v_spread > 0 AND (v_user_cash IS NULL OR v_user_cash < v_spread) THEN
        RAISE EXCEPTION 'Insufficient cash for Rollover Contango spread';
    END IF;

    -- Update Cash balance with Spread difference
    UPDATE public.portfolios SET cash_balance = cash_balance - v_spread WHERE user_id = p_user_id;

    -- Close Current Month position (decrease OI)
    UPDATE public.options_contracts 
    SET open_interest = GREATEST(0, open_interest - p_quantity),
        volume = volume + p_quantity,
        current_price = p_curr_price
    WHERE id = p_curr_option_id;

    -- Open Next Month position (increase OI)
    UPDATE public.options_contracts 
    SET open_interest = open_interest + p_quantity,
        volume = volume + p_quantity,
        current_price = p_next_price
    WHERE id = p_next_option_id;

    RETURN v_spread;
END;
$$;

-- 4. 만기일 결제 정산 처리 RPC
CREATE OR REPLACE FUNCTION public.settle_options_expiration(
    p_stock_id UUID,
    p_final_spot_price NUMERIC
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_contract RECORD;
    v_settled_count INT := 0;
    v_is_itm BOOLEAN;
    v_payout NUMERIC;
BEGIN
    FOR v_contract IN 
        SELECT * FROM public.options_contracts 
        WHERE underlying_stock_id = p_stock_id AND expiry_date <= NOW()
    LOOP
        v_is_itm := (v_contract.option_type = 'CALL' AND p_final_spot_price > v_contract.strike_price)
                 OR (v_contract.option_type = 'PUT' AND p_final_spot_price < v_contract.strike_price);

        IF v_is_itm THEN
            IF v_contract.option_type = 'CALL' THEN
                v_payout := (p_final_spot_price - v_contract.strike_price) * v_contract.open_interest;
            ELSE
                v_payout := (v_contract.strike_price - p_final_spot_price) * v_contract.open_interest;
            END IF;
            
            UPDATE public.options_contracts 
            SET current_price = 0, open_interest = 0
            WHERE id = v_contract.id;
        ELSE
            UPDATE public.options_contracts 
            SET current_price = 0, open_interest = 0
            WHERE id = v_contract.id;
        END IF;

        v_settled_count := v_settled_count + 1;
    END LOOP;

    RETURN v_settled_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.execute_option_order TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_rollover_combo TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_options_expiration TO anon, authenticated;
