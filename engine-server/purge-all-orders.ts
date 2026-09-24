import { createIsolatedMemoryDbClient } from '../lib/memoryDb/memoryDbClient';

async function go(dbClient = createIsolatedMemoryDbClient()) {
  console.log('🚨 Full orders table purge started in memory store...');
  
  let total = 0;
  while (true) {
    const { data, error } = await dbClient.from('orders').select('id').limit(500);
    if (error) { console.error('Fetch error:', error); break; }
    if (!data || data.length === 0) break;
    const ids = data.map((r: any) => r.id);
    const { error: delErr } = await dbClient.from('orders').delete().in('id', ids);
    if (delErr) { console.error('Delete error:', delErr); break; }
    total += ids.length;
    console.log(`  Deleted ${total} orders so far...`);
    if (ids.length < 500) break;
  }

  const { count } = await dbClient.from('orders').select('*', { count: 'exact', head: true });
  console.log(`✅ Done. Remaining orders in DB: ${count}`);
}

if (require.main === module) {
  go().catch(console.error);
}

export { go };
