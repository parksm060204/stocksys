const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Parse .env.local manually
try {
  const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        process.env[key] = val;
      }
    }
  });
} catch (e) {
  console.warn("⚠️ Could not read .env.local, checking process.env");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing Supabase URL or Key in environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seedBotHoldings() {
  console.log("🔄 Starting institutional bot portfolio initial holdings allocation...");

  // 1. Fetch all bots and stocks
  const [{ data: bots, error: botErr }, { data: stocks, error: stockErr }] = await Promise.all([
    supabase.from('bots_config').select('*'),
    supabase.from('stocks').select('*')
  ]);

  if (botErr || !bots || bots.length === 0) {
    console.error("❌ Failed to fetch bots_config:", botErr);
    process.exit(1);
  }
  if (stockErr || !stocks || stocks.length === 0) {
    console.error("❌ Failed to fetch stocks:", stockErr);
    process.exit(1);
  }

  console.log(`📊 Found ${bots.length} institutional bots and ${stocks.length} instruments.`);

  // Group stocks by market
  const krStocks = stocks.filter(s => s.market === 'domestic');
  const usStocks = stocks.filter(s => s.market === 'overseas');
  const euStocks = stocks.filter(s => s.market === 'europe');
  const bondStocks = stocks.filter(s => s.market === 'bonds');
  const commodityStocks = stocks.filter(s => s.market === 'commodities');

  let updatedBotCount = 0;

  for (const bot of bots) {
    const capital = Number(bot.capital || 100000000000);
    const traits = bot.traits || {};
    const alloc = traits.targetAllocation || {
      kr_equity: 0.2,
      us_equity: 0.4,
      eu_equity: 0.1,
      bond: 0.2,
      commodity: 0.05
    };

    const holdingsMap = {}; // stock_id -> quantity

    const distributeCapitalToMarket = (marketStocks, marketAllocRatio) => {
      if (!marketStocks || marketStocks.length === 0 || !marketAllocRatio) return;
      const totalMarketCapAlloc = capital * marketAllocRatio;
      const allocPerStock = totalMarketCapAlloc / marketStocks.length;

      for (const stock of marketStocks) {
        const price = stock.current_price > 0 ? stock.current_price : 10000;
        // 주식 수량 = 할당 금액 / 주가
        const qty = Math.floor(allocPerStock / price);
        if (qty > 0) {
          holdingsMap[stock.id] = qty;
        }
      }
    };

    distributeCapitalToMarket(krStocks, alloc.kr_equity || 0);
    distributeCapitalToMarket(usStocks, alloc.us_equity || 0);
    distributeCapitalToMarket(euStocks, alloc.eu_equity || 0);
    distributeCapitalToMarket(bondStocks, alloc.bond || 0);
    distributeCapitalToMarket(commodityStocks, alloc.commodity || 0);

    // Save initialHoldings to bot traits in DB
    const updatedTraits = {
      ...traits,
      initialHoldings: holdingsMap
    };

    const { error: updateErr } = await supabase
      .from('bots_config')
      .update({ traits: updatedTraits })
      .eq('id', bot.id);

    if (updateErr) {
      console.error(`❌ Failed to update holdings for bot ${bot.name}:`, updateErr);
    } else {
      updatedBotCount++;
    }
  }

  console.log(`✅ Successfully seeded initial portfolio holdings for ${updatedBotCount} institutional bots.`);
  console.log("🎉 Bot portfolio holdings seeding complete!");
}

seedBotHoldings();
