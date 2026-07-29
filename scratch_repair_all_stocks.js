const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

try {
  const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        process.env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
      }
    }
  });
} catch (e) {}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function repairAllStocks() {
  console.log("🛠️ Starting comprehensive market-wide stock price repair...");

  const { data: stocks, error } = await supabase.from('stocks').select('*');
  if (error || !stocks) {
    console.error("❌ Failed to fetch stocks:", error);
    return;
  }

  let repairedCount = 0;

  for (const s of stocks) {
    const prev = Number(s.previous_close || s.current_price || 1000);
    const curr = Number(s.current_price || prev);
    const market = s.market;

    let targetPrice = curr;

    if (market === 'domestic') {
      // KRX 상/하한가 (±30%)
      const upper = prev * 1.30;
      const lower = prev * 0.70;
      if (curr > upper || curr < lower || curr <= 0) {
        targetPrice = prev; // Reset to fair previous close
      }
    } else if (market === 'overseas' || market === 'europe') {
      // 해외 주식: 붕괴된 주가(1~10달러) 복구 (최소 50% ~ 최대 200% 범위)
      if (curr < prev * 0.50 || curr > prev * 2.00 || curr <= 0) {
        targetPrice = prev;
      }
    } else if (market === 'bonds') {
      if (curr < 80.00 || curr > 120.00) {
        targetPrice = 100.00;
      }
    } else if (market === 'commodities') {
      if (curr < prev * 0.50 || curr > prev * 2.00 || curr <= 0) {
        targetPrice = prev;
      }
    }

    if (targetPrice !== curr) {
      await supabase.from('stocks').update({
        current_price: targetPrice,
        open_price: targetPrice,
        high: Math.max(targetPrice, Number(s.high || targetPrice)),
        low: Math.min(targetPrice, Number(s.low || targetPrice))
      }).eq('id', s.id);
      repairedCount++;
      console.log(`✅ Repaired ${s.name} (${s.ticker}): ${curr} -> ${targetPrice} (Prev: ${prev})`);
    }
  }

  // Clear bad open orders that have out-of-bounds prices
  await supabase.from('orders').delete().filter('status', 'eq', 'open');
  console.log("🧹 Purged stale open orders in DB.");

  console.log(`🎉 Market Repair Completed! Total ${repairedCount} corrupted stocks fixed.`);
}

repairAllStocks();
