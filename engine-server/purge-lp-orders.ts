import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function purge() {
  console.log('🧹 Purging all stale LP orders from orders table...');

  // 현재 LP 주문 총 수 확인
  const { count: beforeCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('is_lp', true);
  console.log(`📊 LP orders before purge: ${beforeCount}`);

  let total = 0;

  // 배치로 LP 주문 삭제 (500개씩)
  while (true) {
    const { data: batch, error: fetchErr } = await supabase
      .from('orders')
      .select('id')
      .eq('is_lp', true)
      .limit(500);

    if (fetchErr) { console.error('Fetch error:', fetchErr); break; }
    if (!batch || batch.length === 0) { console.log('No more LP orders to delete.'); break; }

    const ids = batch.map((r: any) => r.id);

    const { error: delErr } = await supabase
      .from('orders')
      .delete()
      .in('id', ids);

    if (delErr) { console.error('Delete error:', delErr); break; }

    total += ids.length;
    console.log(`  ✓ Deleted ${total} LP orders so far...`);

    if (ids.length < 500) break;
  }

  // 남은 카운트 확인
  const { count: afterCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true });

  console.log(`✅ Purge complete. Total LP orders deleted: ${total}`);
  console.log(`📊 Remaining total orders in DB: ${afterCount}`);
}

purge();
