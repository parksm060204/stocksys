-- Migration: Create market_news table for Gemini AI Endogenous News Engine
CREATE TABLE IF NOT EXISTS market_news (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  type VARCHAR(20) NOT NULL CHECK (type IN ('MACRO', 'MICRO')),
  category VARCHAR(20) NOT NULL CHECK (category IN ('OFFICIAL', 'RUMOR', 'CORRECTION')),
  publisher VARCHAR(100) NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  target_sector VARCHAR(50),
  target_ticker VARCHAR(20),
  impact_score NUMERIC(4, 2) NOT NULL DEFAULT 0.00,
  is_fake BOOLEAN DEFAULT FALSE,
  original_rumor_id UUID REFERENCES market_news(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_market_news_created_at ON market_news(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_news_target_ticker ON market_news(target_ticker);

-- Enable Row Level Security (RLS)
ALTER TABLE market_news ENABLE ROW LEVEL SECURITY;

-- Explicit GRANT permissions per Supabase rules
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE market_news TO anon, authenticated;

-- RLS Policies
CREATE POLICY "Anyone can view market_news" ON market_news FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can insert market_news" ON market_news FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anyone can update market_news" ON market_news FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete market_news" ON market_news FOR DELETE TO anon, authenticated USING (true);
