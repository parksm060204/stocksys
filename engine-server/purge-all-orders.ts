import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function go() {
  console.log('🚨 Full orders table purge started...');
  
  let total = 0;
  while (true) {
    const { data, error } = await sb.from('orders').select('id').limit(500);
    if (error) { console.error('Fetch error:', error); break; }
    if (!data || data.length === 0) break;
    const ids = data.map((r: any) => r.id);
    const { error: delErr } = await sb.from('orders').delete().in('id', ids);
    if (delErr) { console.error('Delete error:', delErr); break; }
    total += ids.length;
    console.log(`  Deleted ${total} orders so far...`);
    if (ids.length < 500) break;
  }

  const { count } = await sb.from('orders').select('*', { count: 'exact', head: true });
  console.log(`✅ Done. Remaining orders in DB: ${count}`);
}

go();
