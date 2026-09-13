-- =====================================================================
-- MUMYEONG: Atomic Submit and Match Order RPC (단일 원자적 주문 매칭 & 정산)
-- 주문 검증 → 자산 예약 확인 → 매칭 → 수수료 정산 → 주문/체결/주식 통계 갱신을 단일 DB 트랜잭션으로 처리
-- =====================================================================

CREATE OR REPLACE FUNCTION public.submit_and_match_order(
  p_user_id UUID,
  p_stock_id UUID,
  p_side TEXT,
  p_price NUMERIC,
  p_size BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_cash NUMERIC;
  v_user_qty INT;
  v_reserved_cash NUMERIC := 0;
  v_reserved_qty INT := 0;
  v_available_cash NUMERIC;
  v_available_qty INT;
  v_required_cash NUMERIC;

  v_remaining_qty BIGINT := p_size;
  v_total_filled BIGINT := 0;
  v_last_exec_price NUMERIC := p_price;
  v_opp_side TEXT;
  v_opp_record RECORD;
  v_opp_remaining BIGINT;
  v_match_qty BIGINT;
  v_exec_price NUMERIC;

  v_buyer_id UUID;
  v_seller_id UUID;
  v_buyer_is_bot BOOLEAN;
  v_seller_is_bot BOOLEAN;
  v_buyer_fee NUMERIC;
  v_seller_fee NUMERIC;

  v_buyer_cash NUMERIC;
  v_seller_qty INT;
  v_existing_qty INT;
  v_existing_avg NUMERIC;
  v_new_qty INT;
  v_new_avg NUMERIC;

  v_new_order_id UUID;
  v_new_order_status TEXT;
BEGIN
  -- 0. 기본 파라미터 엄격 검증
  IF p_user_id IS NULL OR p_stock_id IS NULL THEN
    RAISE EXCEPTION 'user_id and stock_id must not be null';
  END IF;

  IF p_side NOT IN ('buy', 'sell') THEN
    RAISE EXCEPTION 'side must be either buy or sell';
  END IF;

  IF p_price <= 0 OR p_size <= 0 THEN
    RAISE EXCEPTION 'price and size must be greater than zero: price=%, size=%', p_price, p_size;
  END IF;

  -- 1. 자산 예약 확인 및 행 잠금 (Race Condition 방지)
  IF p_side = 'buy' THEN
    -- 매수자 프로필 FOR UPDATE 잠금
    SELECT cash INTO v_user_cash
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'User profile not found: %', p_user_id;
    END IF;

    -- 트랜잭션 내에서 미체결 매수 주문 예약금 재계산
    SELECT COALESCE(SUM((size - filled) * price), 0)
    INTO v_reserved_cash
    FROM public.orders
    WHERE user_id = p_user_id
      AND side = 'buy'
      AND status IN ('open', 'partial');

    v_available_cash := v_user_cash - v_reserved_cash;
    v_required_cash := p_price * p_size;

    IF v_available_cash < v_required_cash THEN
      RAISE EXCEPTION 'Insufficient available cash: required %, available % (reserved %)',
        v_required_cash, v_available_cash, v_reserved_cash;
    END IF;

  ELSE
    -- 매도자 보유 주식 FOR UPDATE 잠금
    SELECT quantity INTO v_user_qty
    FROM public.holdings
    WHERE user_id = p_user_id AND stock_id = p_stock_id
    FOR UPDATE;

    IF NOT FOUND OR v_user_qty <= 0 THEN
      RAISE EXCEPTION 'No holdings found for selling stock %', p_stock_id;
    END IF;

    -- 트랜잭션 내에서 미체결 매도 주문 예약수량 재계산
    SELECT COALESCE(SUM(size - filled), 0)
    INTO v_reserved_qty
    FROM public.orders
    WHERE user_id = p_user_id
      AND stock_id = p_stock_id
      AND side = 'sell'
      AND status IN ('open', 'partial');

    v_available_qty := v_user_qty - v_reserved_qty;

    IF v_available_qty < p_size THEN
      RAISE EXCEPTION 'Insufficient available holdings: required %, available % (reserved %)',
        p_size, v_available_qty, v_reserved_qty;
    END IF;
  END IF;

  -- 2. 반대 방향 미체결 주문 탐색 및 매칭 (Price-Time Priority)
  v_opp_side := CASE WHEN p_side = 'buy' THEN 'sell' ELSE 'buy' END;

  FOR v_opp_record IN
    SELECT id, user_id, is_lp, side, price, size, filled, status, created_at
    FROM public.orders
    WHERE stock_id = p_stock_id
      AND side = v_opp_side
      AND status IN ('open', 'partial')
      AND (
        (p_side = 'buy' AND price <= p_price) OR
        (p_side = 'sell' AND price >= p_price)
      )
    ORDER BY
      CASE WHEN p_side = 'buy' THEN price END ASC,
      CASE WHEN p_side = 'sell' THEN price END DESC,
      created_at ASC
    FOR UPDATE
  LOOP
    IF v_remaining_qty <= 0 THEN
      EXIT;
    END IF;

    v_opp_remaining := v_opp_record.size - v_opp_record.filled;
    IF v_opp_remaining <= 0 THEN
      CONTINUE;
    END IF;

    v_match_qty := LEAST(v_remaining_qty, v_opp_remaining);
    IF v_match_qty <= 0 THEN
      CONTINUE;
    END IF;

    -- 체결 가격은 Price-Time Priority에 따라 먼저 대기 중이던 Maker(Resting Order)의 지정가 우선
    v_exec_price := v_opp_record.price;
    v_last_exec_price := v_exec_price;

    v_buyer_id := CASE WHEN p_side = 'buy' THEN p_user_id ELSE v_opp_record.user_id END;
    v_seller_id := CASE WHEN p_side = 'sell' THEN p_user_id ELSE v_opp_record.user_id END;
    v_buyer_is_bot := CASE WHEN p_side = 'buy' THEN false ELSE (v_opp_record.user_id IS NULL OR v_opp_record.is_lp) END;
    v_seller_is_bot := CASE WHEN p_side = 'sell' THEN false ELSE (v_opp_record.user_id IS NULL OR v_opp_record.is_lp) END;

    -- Maker Rebate (-0.1%), Taker Fee (+0.25%)
    -- opp는 Maker, incoming(p_side)은 Taker
    IF p_side = 'buy' THEN
      v_buyer_fee := 0.0025;   -- Taker fee
      v_seller_fee := -0.001;  -- Maker rebate
    ELSE
      v_buyer_fee := -0.001;   -- Maker rebate
      v_seller_fee := 0.0025;  -- Taker fee
    END IF;

    -- 2-1. 매수자 정산 (봇이 아닌 경우)
    IF NOT v_buyer_is_bot AND v_buyer_id IS NOT NULL THEN
      SELECT cash INTO v_buyer_cash
      FROM public.profiles
      WHERE id = v_buyer_id
      FOR UPDATE;

      IF v_buyer_cash < (v_exec_price * v_match_qty * (1 + v_buyer_fee)) THEN
        RAISE EXCEPTION 'Insufficient cash for buyer % during execution', v_buyer_id;
      END IF;

      UPDATE public.profiles
      SET cash = cash - (v_exec_price * v_match_qty * (1 + v_buyer_fee)),
          net_worth = net_worth - (v_exec_price * v_match_qty * v_buyer_fee)
      WHERE id = v_buyer_id;

      SELECT quantity, avg_price INTO v_existing_qty, v_existing_avg
      FROM public.holdings
      WHERE user_id = v_buyer_id AND stock_id = p_stock_id
      FOR UPDATE;

      IF NOT FOUND THEN
        INSERT INTO public.holdings (user_id, stock_id, quantity, avg_price)
        VALUES (v_buyer_id, p_stock_id, v_match_qty, v_exec_price);
      ELSE
        v_new_qty := v_existing_qty + v_match_qty;
        v_new_avg := ((v_existing_avg * v_existing_qty) + (v_exec_price * v_match_qty)) / v_new_qty;
        UPDATE public.holdings
        SET quantity = v_new_qty, avg_price = ROUND(v_new_avg, 4)
        WHERE user_id = v_buyer_id AND stock_id = p_stock_id;
      END IF;
    END IF;

    -- 2-2. 매도자 정산 (봇이 아닌 경우)
    IF NOT v_seller_is_bot AND v_seller_id IS NOT NULL THEN
      SELECT quantity INTO v_seller_qty
      FROM public.holdings
      WHERE user_id = v_seller_id AND stock_id = p_stock_id
      FOR UPDATE;

      IF NOT FOUND OR v_seller_qty < v_match_qty THEN
        RAISE EXCEPTION 'Insufficient holdings for seller % during execution', v_seller_id;
      END IF;

      v_new_qty := v_seller_qty - v_match_qty;
      IF v_new_qty = 0 THEN
        DELETE FROM public.holdings
        WHERE user_id = v_seller_id AND stock_id = p_stock_id;
      ELSE
        UPDATE public.holdings
        SET quantity = v_new_qty
        WHERE user_id = v_seller_id AND stock_id = p_stock_id;
      END IF;

      UPDATE public.profiles
      SET cash = cash + (v_exec_price * v_match_qty * (1 - v_seller_fee)),
          net_worth = net_worth - (v_exec_price * v_match_qty * v_seller_fee)
      WHERE id = v_seller_id;
    END IF;

    -- 2-3. trades 테이블 기록
    INSERT INTO public.trades (
      stock_id, buyer_id, seller_id, buyer_is_bot, seller_is_bot,
      price, size, buyer_fee, seller_fee, created_at
    ) VALUES (
      p_stock_id, v_buyer_id, v_seller_id, v_buyer_is_bot, v_seller_is_bot,
      v_exec_price, v_match_qty, v_buyer_fee, v_seller_fee, now()
    );

    -- 2-4. 상대 주문 진행도 UPDATE
    UPDATE public.orders
    SET filled = filled + v_match_qty,
        status = CASE WHEN filled + v_match_qty >= size THEN 'filled' ELSE 'partial' END
    WHERE id = v_opp_record.id;

    v_remaining_qty := v_remaining_qty - v_match_qty;
    v_total_filled := v_total_filled + v_match_qty;
  END LOOP;

  -- 3. 주식 통계 원자적 업데이트 (Canonical schema: high, low)
  IF v_total_filled > 0 THEN
    UPDATE public.stocks
    SET current_price = v_last_exec_price,
        high = GREATEST(COALESCE(high, 0), v_last_exec_price),
        low = CASE WHEN COALESCE(low, 0) = 0 THEN v_last_exec_price ELSE LEAST(low, v_last_exec_price) END,
        volume = COALESCE(volume, 0) + v_total_filled
    WHERE id = p_stock_id;
  END IF;

  -- 4. 신규 유저 주문 orders INSERT
  v_new_order_status := CASE
    WHEN v_total_filled = 0 THEN 'open'
    WHEN v_remaining_qty = 0 THEN 'filled'
    ELSE 'partial'
  END;

  INSERT INTO public.orders (
    stock_id, user_id, side, price, size, filled, status, is_lp, created_at
  ) VALUES (
    p_stock_id, p_user_id, p_side, p_price, p_size, v_total_filled, v_new_order_status, false, now()
  ) RETURNING id INTO v_new_order_id;

  -- 5. Invariant 최종 검증
  IF p_side = 'buy' THEN
    SELECT cash INTO v_user_cash FROM public.profiles WHERE id = p_user_id;
    IF v_user_cash < 0 THEN
      RAISE EXCEPTION 'Invariant violation: negative cash balance (%)', v_user_cash;
    END IF;
  ELSE
    SELECT quantity INTO v_user_qty FROM public.holdings WHERE user_id = p_user_id AND stock_id = p_stock_id;
    IF v_user_qty < 0 THEN
      RAISE EXCEPTION 'Invariant violation: negative holdings quantity (%)', v_user_qty;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_new_order_id,
    'filled_qty', v_total_filled,
    'exec_price', v_last_exec_price,
    'status', v_new_order_status,
    'message', CASE
      WHEN v_total_filled > 0 THEN format('🎉 %s주가 체결되었습니다! (체결가: ₩%s)', v_total_filled, v_last_exec_price)
      ELSE format('주문이 호가창에 정상 접수되었습니다! (%s원 %s주)', p_price, p_size)
    END
  );
END;
$$;

-- 보안 강화: 일반 사용자 실행 권한 박탈 및 service_role 전용 허용
REVOKE EXECUTE ON FUNCTION public.submit_and_match_order(UUID, UUID, TEXT, NUMERIC, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_and_match_order(UUID, UUID, TEXT, NUMERIC, BIGINT) TO service_role;
