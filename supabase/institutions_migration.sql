-- Create institutional_portfolios table
CREATE TABLE IF NOT EXISTS institutional_portfolios (
    bot_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    total_capital NUMERIC NOT NULL,
    current_cash NUMERIC NOT NULL,
    current_stock NUMERIC NOT NULL,
    current_bond NUMERIC NOT NULL,
    current_commodity NUMERIC NOT NULL,
    target_weights JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Apply Supabase Policies per AGENTS.md rules
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE institutional_portfolios TO anon, authenticated;

ALTER TABLE institutional_portfolios ENABLE ROW LEVEL SECURITY;

-- Allow read access to all users (Dashboard data is public)
CREATE POLICY "Anyone can view institutional portfolios"
ON institutional_portfolios FOR SELECT
USING (true);

-- Allow engine to insert/update (Engine uses service_role, which bypasses RLS, but we can also add policies if needed)
-- (No specific policies needed for service_role as it bypasses RLS, but we add dummy ones per rule if auth.uid() is required.
-- Since this is engine data, we don't need auth.uid() check for updates, service_role will handle it)
