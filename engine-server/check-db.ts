import { createIsolatedMemoryDbClient } from '../lib/memoryDb/memoryDbClient';

async function check(dbClient = createIsolatedMemoryDbClient()) {
  const { count: oCount, error: oErr } = await dbClient
    .from('orders')
    .select('*', { count: 'exact', head: true });
  
  const { count: tCount, error: tErr } = await dbClient
    .from('trades')
    .select('*', { count: 'exact', head: true });

  const { count: lpCount } = await dbClient
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('is_lp', true);

  const { data: recentTrades } = await dbClient
    .from('trades')
    .select('id, price, size, created_at')
    .order('created_at', { ascending: false })
    .limit(3);

  console.log('=== Memory Store Status ===');
  console.log('Total Orders:', oCount, oErr ? `[ERR: ${oErr.message}]` : '');
  console.log('LP Orders only:', lpCount);
  console.log('Total Trades:', tCount, tErr ? `[ERR: ${tErr.message}]` : '');
  console.log('Recent trades:', JSON.stringify(recentTrades, null, 2));
}

if (require.main === module) {
  check().catch(console.error);
}

export { check };
