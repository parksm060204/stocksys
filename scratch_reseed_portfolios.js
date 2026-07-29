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

async function reseedInstitutionalPortfolios() {
  console.log("🛠️ Reseeding institutional portfolios in DB based on active bot configs...");

  const { data: bots, error } = await supabase.from('bots_config').select('*');
  if (error || !bots) {
    console.error("❌ Failed to fetch bots_config:", error);
    return;
  }

  const upserts = [];

  for (const bot of bots) {
    const cap = Number(bot.capital || 1000000000000);
    const traits = bot.traits || {};
    const targetW = traits.targetAllocation || traits.baseWeights || {};

    const krW = Number(targetW.kr_equity || 0);
    const usW = Number(targetW.us_equity || 0);
    const euW = Number(targetW.eu_equity || 0);
    const stockW = Number(targetW.stock || (krW + usW + euW) || 0.4);
    const bondW = Number(targetW.bond || 0.2);
    const commW = Number(targetW.commodity || 0.05);
    const derivW = Number(targetW.derivatives || 0);
    const cashW = targetW.cash !== undefined ? Number(targetW.cash) : Math.max(0.05, 1.0 - stockW - bondW - commW - derivW);

    const totalW = stockW + bondW + commW + derivW + cashW || 1.0;

    const stockVal = cap * (stockW / totalW);
    const krVal = cap * (krW > 0 ? krW / totalW : (stockW * 0.5) / totalW);
    const usVal = cap * (usW > 0 ? usW / totalW : (stockW * 0.5) / totalW);
    const euVal = cap * (euW > 0 ? euW / totalW : 0);

    upserts.push({
      bot_id: bot.id,
      name: bot.name || bot.id,
      total_capital: cap,
      current_cash: cap * (cashW / totalW),
      current_stock: stockVal,
      current_kr_equity: krVal,
      current_us_equity: usVal,
      current_eu_equity: euVal,
      current_bond: cap * (bondW / totalW),
      current_commodity: cap * (commW / totalW),
      current_derivatives: cap * (derivW / totalW),
      target_weights: {
        stock: stockW / totalW,
        kr_equity: krVal / cap,
        us_equity: usVal / cap,
        eu_equity: euVal / cap,
        bond: bondW / totalW,
        commodity: commW / totalW,
        cash: cashW / totalW
      },
      updated_at: new Date().toISOString()
    });
  }

  const { error: upsertErr } = await supabase.from('institutional_portfolios').upsert(upserts);
  if (upsertErr) {
    console.error("❌ Failed to upsert portfolios:", upsertErr);
  } else {
    console.log(`🎉 Successfully reseeded ${upserts.length} institutional portfolios!`);
  }
}

reseedInstitutionalPortfolios();
