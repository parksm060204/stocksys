import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config(); // engine-server/.env 에서 SUPABASE_SERVICE_ROLE_KEY 읽기

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // service role로 RLS 우회
  { auth: { persistSession: false } }
);

async function check() {
  const { count: oCount, error: oErr } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true });
  
  const { count: tCount, error: tErr } = await supabase
    .from('trades')
    .select('*', { count: 'exact', head: true });

  const { count: lpCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('is_lp', true);

  const { data: recentTrades } = await supabase
    .from('trades')
    .select('id, price, size, created_at')
    .order('created_at', { ascending: false })
    .limit(3);

  console.log('=== DB Status (service role) ===');
  console.log('Total Orders:', oCount, oErr ? `[ERR: ${oErr.message}]` : '');
  console.log('LP Orders only:', lpCount);
  console.log('Total Trades:', tCount, tErr ? `[ERR: ${tErr.message}]` : '');
  console.log('Recent trades:', JSON.stringify(recentTrades, null, 2));
}

check();
