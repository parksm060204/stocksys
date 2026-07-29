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

const BOND_FAIR_PRICES = {
  "US10Y": { name: "미국 국채 10년물", price: 100.00, close: 100.00, vol: 250000 },
  "KR10Y": { name: "한국 국채 10년물", price: 100.50, close: 100.50, vol: 180000 },
  "OSEL3Y": { name: "오성전자 3년 회사채", price: 101.20, close: 101.20, vol: 95000 },
  "DE10Y": { name: "독일 국채 10년물 (분트)", price: 99.80, close: 99.80, vol: 120000 },
  "AKHY5Y": { name: "아크리스 5년 정크본드", price: 98.50, close: 98.50, vol: 75000 },
  "NOVA5Y": { name: "노바에너지 5년 회사채", price: 100.10, close: 100.10, vol: 88000 },
  "UK10Y": { name: "영국 국채 10년물 (길트)", price: 99.40, close: 99.40, vol: 110000 },
  "GTHY7Y": { name: "글로벌테크 7년 고수익채", price: 100.80, close: 100.80, vol: 64000 },
  "JP10Y": { name: "일본 국채 10년물 (JGB)", price: 99.90, close: 99.90, vol: 310000 }
};

async function repairBonds() {
  console.log("🛠️ Starting bond data repair in Supabase...");

  // 1. Repair stocks table records with market = 'bonds'
  const { data: stocks } = await supabase.from('stocks').select('*').eq('market', 'bonds');
  if (stocks) {
    for (const s of stocks) {
      const meta = BOND_FAIR_PRICES[s.ticker] || { price: 100.00, close: 100.00, vol: 100000 };
      await supabase.from('stocks').update({
        current_price: meta.price,
        previous_close: meta.close,
        open_price: meta.price,
        high: meta.price + 0.35,
        low: meta.price - 0.25,
        volume: meta.vol,
        market_cap: meta.price * 10000000
      }).eq('id', s.id);
      console.log(`✅ Repaired stock bond: ${s.name} (${s.ticker}) -> ${meta.price}`);
    }
  }

  // 2. Repair bonds table records
  const { data: bonds } = await supabase.from('bonds').select('*');
  if (bonds) {
    for (const b of bonds) {
      await supabase.from('bonds').update({
        current_price: 100.00,
        face_value: 100.00
      }).eq('id', b.id);
      console.log(`✅ Repaired bonds table record: ${b.name} -> 100.00`);
    }
  }

  // 3. Clear open orders on bond stocks to purge invalid orders
  const bondStockIds = (stocks || []).map(s => s.id);
  if (bondStockIds.length > 0) {
    await supabase.from('orders').delete().in('stock_id', bondStockIds);
    console.log("🧹 Purged invalid open orders on bond stocks.");
  }

  console.log("🎉 Bond repair completed successfully!");
}

repairBonds();
