import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// .env.local 로드
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or Service Role Key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seedOptions() {
  console.log('Seeding Options Contracts & Call/Put Walls...');

  // 1. 기초자산(우량주 및 지수) 가져오기
  // market='overseas' 또는 market='etf' 중 시가총액이 큰 종목 선택
  const { data: stocks, error: stockErr } = await supabase
    .from('stocks')
    .select('*')
    .in('market', ['overseas', 'etf'])
    .order('market_cap', { ascending: false })
    .limit(10);

  if (stockErr || !stocks || stocks.length === 0) {
    console.error('Failed to fetch underlying stocks:', stockErr);
    process.exit(1);
  }

  const contracts = [];
  // 게임 내 만기일: 임의로 현재 시점으로부터 7일 뒤로 설정
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 7);

  for (const stock of stocks) {
    const currentPrice = stock.current_price;
    const tickSize = currentPrice >= 1000 ? 10 : (currentPrice >= 100 ? 1 : 0.1);

    // Call Wall: 현재가보다 5% 높은 지점
    const callStrike = Math.round((currentPrice * 1.05) / tickSize) * tickSize;
    // Put Wall: 현재가보다 5% 낮은 지점
    const putStrike = Math.round((currentPrice * 0.95) / tickSize) * tickSize;

    contracts.push({
      underlying_stock_id: stock.id,
      type: 'CALL',
      strike_price: callStrike,
      expiry_date: expiryDate.toISOString(),
      open_interest: 50000, // 거대 Call Wall
      implied_volatility: 0.25
    });

    contracts.push({
      underlying_stock_id: stock.id,
      type: 'PUT',
      strike_price: putStrike,
      expiry_date: expiryDate.toISOString(),
      open_interest: 50000, // 거대 Put Wall
      implied_volatility: 0.30
    });
    
    console.log(`Prepared options for ${stock.name} - Call Wall at ${callStrike}, Put Wall at ${putStrike}`);
  }

  // 2. Insert contracts into DB
  const { error: insertErr } = await supabase
    .from('options_contracts')
    .upsert(contracts, { onConflict: 'underlying_stock_id, type, strike_price, expiry_date' });

  if (insertErr) {
    console.error('Failed to insert options contracts:', insertErr);
  } else {
    console.log('Successfully seeded options contracts and Call/Put walls.');
  }

  process.exit(0);
}

seedOptions();
