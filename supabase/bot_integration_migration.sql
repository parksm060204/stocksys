-- supabase/bot_integration_migration.sql
-- Run this in the Supabase SQL editor to drop FK constraints and add is_bot columns

-- 1. Drop the foreign key from orders
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_user_id_fkey;

-- 2. Drop the foreign keys from trades
ALTER TABLE public.trades DROP CONSTRAINT IF EXISTS trades_buyer_id_fkey;
ALTER TABLE public.trades DROP CONSTRAINT IF EXISTS trades_seller_id_fkey;

-- 3. Add buyer_is_bot and seller_is_bot columns to trades
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS buyer_is_bot BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS seller_is_bot BOOLEAN NOT NULL DEFAULT false;
