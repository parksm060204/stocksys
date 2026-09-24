import { createIsolatedMemoryDbClient } from '../lib/memoryDb/memoryDbClient';

async function purge(dbClient = createIsolatedMemoryDbClient()) {
  console.log('🧹 Purging all stale LP orders from orders table in memory store...');

  const { count: beforeCount } = await dbClient
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('is_lp', true);
  console.log(`📊 LP orders before purge: ${beforeCount}`);

  let total = 0;

  while (true) {
    const { data: batch, error: fetchErr } = await dbClient
      .from('orders')
      .select('id')
      .eq('is_lp', true)
      .limit(500);

    if (fetchErr) { console.error('Fetch error:', fetchErr); break; }
    if (!batch || batch.length === 0) { console.log('No more LP orders to delete.'); break; }

    const ids = batch.map((r: any) => r.id);

    const { error: delErr } = await dbClient
      .from('orders')
      .delete()
      .in('id', ids);

    if (delErr) { console.error('Delete error:', delErr); break; }

    total += ids.length;
    console.log(`  ✓ Deleted ${total} LP orders so far...`);

    if (ids.length < 500) break;
  }

  const { count: afterCount } = await dbClient
    .from('orders')
    .select('*', { count: 'exact', head: true });

  console.log(`✅ Purge complete. Total LP orders deleted: ${total}`);
  console.log(`📊 Remaining total orders in DB: ${afterCount}`);
}

if (require.main === module) {
  purge().catch(console.error);
}

export { purge };
