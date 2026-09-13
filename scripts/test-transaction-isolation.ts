import { LocalMarketService } from '../lib/engine/marketService';
import { __setTestFailureHook } from '../lib/engine/dbMatching';
import { memoryDb, ProfileRecord, StockRecord } from '../lib/memoryDb/memoryStore';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
  console.log(`  PASS: ${message}`);
}

function addStock(id: string, ticker: string): void {
  const stock: StockRecord = {
    id,
    ticker,
    name: ticker,
    market: 'test',
    current_price: 700_000,
    previous_close: 700_000,
    open_price: 700_000,
    high: 700_000,
    low: 700_000,
    volume: 0,
    change_rate: 0,
    market_cap: 1_000_000_000,
    pe_ratio: 10,
    dividend_yield: 0,
    sector: 'test',
  };
  memoryDb.stocks.set(id, stock);
}

function addProfile(id: string, cash: number): void {
  const profile: ProfileRecord = {
    id,
    user_id: id,
    username: id,
    nickname: id,
    cash,
    net_worth: cash,
    rank_tier: 'Bronze',
    created_at: new Date().toISOString(),
  };
  memoryDb.profiles.set(id, profile);
}

function addHolding(userId: string, stockId: string, quantity = 1): void {
  const holding = {
    id: `${userId}_${stockId}`,
    user_id: userId,
    stock_id: stockId,
    quantity,
    avg_price: 700_000,
    created_at: new Date().toISOString(),
  };
  memoryDb.holdings.set(holding.id, holding);
  memoryDb.addHoldingToIndex(holding);
}

async function testCrossStockRollback(): Promise<void> {
  console.log('\n[TEST 1] Cross-stock rollback keeps successful transaction');
  const stockA = '00000000-0000-4000-8000-000000001001';
  const stockB = '00000000-0000-4000-8000-000000001002';
  const buyerA = 'isolation_buyer_a';
  const sellerA = 'isolation_seller_a';
  const buyerB = 'isolation_buyer_b';
  const sellerB = 'isolation_seller_b';

  addStock(stockA, 'ISOA');
  addStock(stockB, 'ISOB');
  addProfile(buyerA, 2_000_000);
  addProfile(sellerA, 100_000);
  addProfile(buyerB, 2_000_000);
  addProfile(sellerB, 100_000);
  addHolding(sellerA, stockA);
  addHolding(sellerB, stockB);

  const makerA = await LocalMarketService.submitOrder({ userId: sellerA, stockId: stockA, side: 'sell', price: 700_000, size: 1 });
  const makerB = await LocalMarketService.submitOrder({ userId: sellerB, stockId: stockB, side: 'sell', price: 700_000, size: 1 });
  assert(makerA.success && makerB.success, 'Both maker orders are resting');

  let concurrentB: Promise<Awaited<ReturnType<typeof LocalMarketService.submitOrder>>> | undefined;
  __setTestFailureHook(async ({ stockId }) => {
    if (stockId !== stockA) return false;

    concurrentB = LocalMarketService.submitOrder({ userId: buyerB, stockId: stockB, side: 'buy', price: 700_000, size: 1 });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (memoryDb.trades.some((trade) => trade.stock_id === stockB && trade.buyer_id === buyerB)) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert(memoryDb.trades.some((trade) => trade.stock_id === stockB && trade.buyer_id === buyerB), 'Stock B settles before Stock A rollback');
    await concurrentB;
    throw new Error('SIMULATED_CROSS_STOCK_FAILURE');
  });

  let failedA;
  try {
    failedA = await LocalMarketService.submitOrder({ userId: buyerA, stockId: stockA, side: 'buy', price: 700_000, size: 1 });
  } finally {
    __setTestFailureHook(null);
  }
  const successfulB = await concurrentB!;

  assert(failedA.success === false, 'Stock A transaction fails');
  assert(successfulB.success === true, 'Stock B transaction succeeds');
  assert(!memoryDb.trades.some((trade) => trade.stock_id === stockA && trade.buyer_id === buyerA), 'Failed Stock A trade is removed');
  assert(memoryDb.trades.some((trade) => trade.stock_id === stockB && trade.buyer_id === buyerB), 'Successful Stock B trade remains');
  assert(memoryDb.profiles.get(buyerA)!.cash === 2_000_000, 'Stock A buyer cash is restored');
  assert(memoryDb.profiles.get(buyerB)!.cash === 2_000_000 - 701_750, 'Stock B buyer cash is committed');
  assert(memoryDb.holdings.get(`${sellerA}_${stockA}`)!.quantity === 1, 'Stock A seller holding is restored');
  assert(memoryDb.holdings.get(`${sellerB}_${stockB}`) === undefined, 'Stock B seller holding is consumed');
  assert(memoryDb.orders.get(makerA.orderId!)!.filled === 0, 'Stock A maker order is restored');
  assert(memoryDb.orders.get(makerB.orderId!)!.filled === 1, 'Stock B maker order remains filled');
  assert(memoryDb.stocks.get(stockA)!.volume === 0, 'Stock A volume is restored');
  assert(memoryDb.stocks.get(stockB)!.volume === 1 && memoryDb.stocks.get(stockB)!.current_price === 700_000, 'Stock B stats remain updated');
  const bTrade = memoryDb.trades.find((trade) => trade.stock_id === stockB && trade.buyer_id === buyerB)!;
  assert(memoryDb.tradeStockIndex.get(stockB)?.some((trade) => trade.id === bTrade.id) === true, 'Stock B trade index entry remains');
}

async function testSameUserCashSerialization(): Promise<void> {
  console.log('\n[TEST 2] Same user cannot overspend across two stocks');
  const stockA = '00000000-0000-4000-8000-000000001011';
  const stockB = '00000000-0000-4000-8000-000000001012';
  const buyer = 'same_user_cross_stock';
  const sellerA = 'same_user_seller_a';
  const sellerB = 'same_user_seller_b';

  addStock(stockA, 'CASH_A');
  addStock(stockB, 'CASH_B');
  addProfile(buyer, 1_000_000);
  addProfile(sellerA, 100_000);
  addProfile(sellerB, 100_000);
  addHolding(sellerA, stockA);
  addHolding(sellerB, stockB);
  const makerA = await LocalMarketService.submitOrder({ userId: sellerA, stockId: stockA, side: 'sell', price: 700_000, size: 1 });
  const makerB = await LocalMarketService.submitOrder({ userId: sellerB, stockId: stockB, side: 'sell', price: 700_000, size: 1 });
  assert(makerA.success && makerB.success, 'Cash test maker orders are resting');

  const results = await Promise.all([
    LocalMarketService.submitOrder({ userId: buyer, stockId: stockA, side: 'buy', price: 700_000, size: 1 }),
    LocalMarketService.submitOrder({ userId: buyer, stockId: stockB, side: 'buy', price: 700_000, size: 1 }),
  ]);
  const committed = results.filter((result) => result.success);
  const rejected = results.filter((result) => !result.success);
  assert(committed.length === 1 && rejected.length === 1, 'At most one 700,000-won purchase commits');

  const buyerTrades = memoryDb.trades.filter((trade) => trade.buyer_id === buyer && (trade.stock_id === stockA || trade.stock_id === stockB));
  const spending = buyerTrades.reduce((sum, trade) => sum + trade.price * trade.size * (1 + Number(trade.buyer_fee || 0)), 0);
  assert(spending <= 1_000_000, 'Committed spending never exceeds initial cash');
  assert(memoryDb.profiles.get(buyer)!.cash >= 0, 'Buyer cash is never negative');
  assert(buyerTrades.length === 1, 'No phantom second trade is created');
  assert(memoryDb.holdingUserIndex.get(buyer)?.size === 1, 'Buyer receives holdings for only the committed trade');
  for (const stockId of [stockA, stockB]) {
    const trade = buyerTrades.find((entry) => entry.stock_id === stockId);
    const makerOrderId = stockId === stockA ? makerA.orderId : makerB.orderId;
    if (trade) {
      assert(memoryDb.tradeStockIndex.get(stockId)?.some((entry) => entry.id === trade.id) === true, `${stockId} trade index is consistent`);
      assert(memoryDb.orders.get(makerOrderId!)!.filled === 1, `${stockId} committed maker is filled`);
    } else {
      assert(!memoryDb.trades.some((entry) => entry.stock_id === stockId && entry.buyer_id === buyer), `${stockId} rejected trade has no phantom record`);
      assert(memoryDb.orders.get(makerOrderId!)!.filled === 0, `${stockId} rejected maker remains open`);
    }
  }
}

async function main(): Promise<void> {
  await testCrossStockRollback();
  await testSameUserCashSerialization();
  console.log('\nALL TRANSACTION ISOLATION TESTS PASSED');
}

main().catch((error) => {
  __setTestFailureHook(null);
  console.error(error);
  process.exit(1);
});
