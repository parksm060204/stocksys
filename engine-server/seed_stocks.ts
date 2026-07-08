import { STOCKS } from '../lib/mock-data';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '../.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase URL or Key");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seed() {
  console.log("Seeding STOCKS into Supabase...");
  const mappedStocks = STOCKS.map(s => ({
    ticker: s.ticker,
    name: s.name,
    market: s.market === 'europe' ? 'overseas' : s.market,
    sector: s.sector,
    description: s.description,
    current_price: s.currentPrice,
    previous_close: s.previousClose,
    open_price: s.openPrice,
    high: s.high,
    low: s.low,
    volume: s.volume,
    market_cap: s.marketCap,
    relevance_weight: s.relevanceWeight,
    target_price: s.targetPrice || s.currentPrice,
    is_core: s.isCore || false
  }));

  const uniqueStocks = Array.from(
    new Map(mappedStocks.map(item => [item.ticker, item])).values()
  );

  const { data, error } = await supabase.from('stocks').upsert(uniqueStocks, { onConflict: 'ticker' }).select('id');
  
  if (error) {
    console.error("Failed to seed stocks:", error);
  } else {
    console.log(`Successfully seeded ${data.length} stocks.`);
  }
}

seed();
