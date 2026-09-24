import { createIsolatedMemoryDbClient } from '../../lib/memoryDb/memoryDbClient';

async function seedOptions(dbClient = createIsolatedMemoryDbClient()) {
  console.log('Seeding Options Contracts & Call/Put Walls into Memory Store...');

  const { data: stocks, error: stockErr } = await dbClient
    .from('stocks')
    .select('*')
    .in('market', ['overseas', 'etf'])
    .order('market_cap', { ascending: false })
    .limit(10);

  if (stockErr || !stocks || stocks.length === 0) {
    console.log('No underlying stocks found in memory store. Seed skipped.');
    return;
  }

  const contracts = [];
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 7);

  for (const stock of stocks) {
    const currentPrice = stock.current_price;
    const tickSize = currentPrice >= 1000 ? 10 : (currentPrice >= 100 ? 1 : 0.1);

    const callStrike = Math.round((currentPrice * 1.05) / tickSize) * tickSize;
    const putStrike = Math.round((currentPrice * 0.95) / tickSize) * tickSize;

    contracts.push({
      underlying_stock_id: stock.id,
      ticker: `${stock.ticker}-C-${callStrike}`,
      option_type: 'CALL',
      strike_price: callStrike,
      current_price: Math.max(0.1, Math.round((currentPrice * 0.05) * 10) / 10),
      expiry_date: expiryDate.toISOString(),
      open_interest: 500,
      volume: 120,
    });

    contracts.push({
      underlying_stock_id: stock.id,
      ticker: `${stock.ticker}-P-${putStrike}`,
      option_type: 'PUT',
      strike_price: putStrike,
      current_price: Math.max(0.1, Math.round((currentPrice * 0.05) * 10) / 10),
      expiry_date: expiryDate.toISOString(),
      open_interest: 450,
      volume: 95,
    });
  }

  const { error: insertErr } = await dbClient
    .from('options_contracts')
    .insert(contracts);

  if (insertErr) {
    console.error('Failed to insert options contracts:', insertErr);
    return;
  }

  console.log(`✅ Successfully seeded ${contracts.length} options contracts!`);
}

if (require.main === module) {
  seedOptions().catch(console.error);
}

export { seedOptions };
