import { memoryDb, StockRecord, ProfileRecord, HoldingRecord, OrderRecord } from '../lib/memoryDb/memoryStore';
import { createMemoryDbClient } from '../lib/memoryDb/memoryDbClient';
import { LocalMarketService } from '../lib/engine/marketService';
import { ensureLocalStandaloneEngine, stopLocalStandaloneEngine, getLocalStandaloneEngine } from '../lib/engine/localStandaloneServer';
import { POST as ordersPostHandler, DELETE as ordersDeleteHandler } from '../app/api/orders/route';
import { POST as localDbPostHandler } from '../app/api/local-db/route';
import { GET as adminGetHandler, POST as adminPostHandler } from '../app/api/admin/scenarios/route';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`❌ FAIL: ${msg}`);
  }
  console.log(`  ✅ PASS: ${msg}`);
}

async function runComprehensiveTests() {
  console.log('==================================================');
  console.log('🚀 STOCKSYS COMPREHENSIVE AUDIT & REGRESSION TESTS');
  console.log('==================================================\n');

  ensureLocalStandaloneEngine();
  const engine = getLocalStandaloneEngine()!;

  // ----------------------------------------------------
  // TEST 1: Price-Time Priority Matching & Multi-Order Specs
  // ----------------------------------------------------
  console.log('[TEST 1] Price-Time Priority Matching & Multi-Order Specs');
  const stockPTP = '00000000-0000-4000-8000-000000002001';
  memoryDb.stocks.set(stockPTP, {
    id: stockPTP, ticker: 'PTP01', name: 'Price-Time Stock', market: 'KRX',
    current_price: 10_000, previous_close: 10_000, open_price: 10_000,
    high: 10_000, low: 10_000, volume: 0, change_rate: 0, market_cap: 1_000_000_000, pe_ratio: 10, dividend_yield: 0, sector: 'IT',
  });

  const sellerOlder10100 = 'seller_ptp_older_10100';
  const sellerNewer10000 = 'seller_ptp_newer_10000';
  const buyer10100 = 'buyer_ptp_10100';

  for (const uid of [sellerOlder10100, sellerNewer10000, buyer10100]) {
    memoryDb.profiles.set(uid, {
      id: uid, user_id: uid, username: uid, nickname: uid,
      cash: 1_000_000, net_worth: 1_000_000, rank_tier: 'Bronze', created_at: new Date().toISOString(),
    });
  }

  // Sellers have 10 shares each
  for (const uid of [sellerOlder10100, sellerNewer10000]) {
    const hKey = `${uid}_${stockPTP}`;
    memoryDb.holdings.set(hKey, { id: hKey, user_id: uid, stock_id: stockPTP, quantity: 10, avg_price: 10_000, created_at: new Date().toISOString() });
    memoryDb.addHoldingToIndex({ id: hKey, user_id: uid, stock_id: stockPTP, quantity: 10, avg_price: 10_000, created_at: new Date().toISOString() });
  }

  // 1. Place older SELL @ 10,100 (Maker 1)
  const client = createMemoryDbClient();
  const olderSellRes = await LocalMarketService.submitOrder({
    userId: sellerOlder10100,
    stockId: stockPTP,
    side: 'sell',
    price: 10_100,
    size: 1,
  });
  assert(olderSellRes.success === true, 'Older SELL @ 10,100 placed');

  // Sleep 10ms to ensure timestamp difference
  await new Promise((r) => setTimeout(r, 15));

  // 2. Place newer SELL @ 10,000 (Maker 2)
  const newerSellRes = await LocalMarketService.submitOrder({
    userId: sellerNewer10000,
    stockId: stockPTP,
    side: 'sell',
    price: 10_000,
    size: 1,
  });
  assert(newerSellRes.success === true, 'Newer SELL @ 10,000 placed');

  // 3. Incoming BUY 1 @ 10,100
  // Price priority: even though 10,100 was placed earlier, 10,000 is cheaper for buyer, so it MUST fill against 10,000!
  const incomingBuyRes = await LocalMarketService.submitOrder({
    userId: buyer10100,
    stockId: stockPTP,
    side: 'buy',
    price: 10_100,
    size: 1,
  });

  assert(incomingBuyRes.success === true, 'Incoming BUY executed');
  assert(incomingBuyRes.filledQty === 1, 'Incoming BUY filled 1 share');
  assert(incomingBuyRes.execPrice === 10_000, `Execution price must be 10,000 (cheaper price priority), actual: ${incomingBuyRes.execPrice}`);

  const newerSellOrder = memoryDb.orders.get(newerSellRes.orderId!);
  const olderSellOrder = memoryDb.orders.get(olderSellRes.orderId!);
  assert(newerSellOrder?.status === 'filled', 'Newer 10,000 seller order must be filled');
  assert(olderSellOrder?.status === 'open', 'Older 10,100 seller order must remain open');

  // 4. Test Sell Direction (Highest Bid Priority)
  const buyerOlder9900 = 'buyer_ptp_older_9900';
  const buyerNewer10000 = 'buyer_ptp_newer_10000';
  const seller9900 = 'seller_ptp_9900';

  for (const uid of [buyerOlder9900, buyerNewer10000, seller9900]) {
    memoryDb.profiles.set(uid, {
      id: uid, user_id: uid, username: uid, nickname: uid,
      cash: 1_000_000, net_worth: 1_000_000, rank_tier: 'Bronze', created_at: new Date().toISOString(),
    });
  }
  const seller9900HKey = `${seller9900}_${stockPTP}`;
  memoryDb.holdings.set(seller9900HKey, { id: seller9900HKey, user_id: seller9900, stock_id: stockPTP, quantity: 10, avg_price: 10_000, created_at: new Date().toISOString() });
  memoryDb.addHoldingToIndex({ id: seller9900HKey, user_id: seller9900, stock_id: stockPTP, quantity: 10, avg_price: 10_000, created_at: new Date().toISOString() });

  await LocalMarketService.submitOrder({ userId: buyerOlder9900, stockId: stockPTP, side: 'buy', price: 9_900, size: 1 });
  await new Promise((r) => setTimeout(r, 15));
  const buyer10000Res = await LocalMarketService.submitOrder({ userId: buyerNewer10000, stockId: stockPTP, side: 'buy', price: 10_000, size: 1 });

  // Incoming SELL 1 @ 9,900 -> Must match against 10,000 (highest bid)
  const incomingSellRes = await LocalMarketService.submitOrder({ userId: seller9900, stockId: stockPTP, side: 'sell', price: 9_900, size: 1 });
  assert(incomingSellRes.success === true, 'Sell direction incoming order succeeded');
  assert(incomingSellRes.execPrice === 10_000, `Execution price must be highest bid 10,000, actual: ${incomingSellRes.execPrice}`);
  assert(memoryDb.orders.get(buyer10000Res.orderId!)?.status === 'filled', 'Highest bidder must be filled');

  // ----------------------------------------------------
  // TEST 2: Autonomous Engine Process Matching & Self-Trade Prevention & user_id=null Support
  // ----------------------------------------------------
  console.log('\n[TEST 2] Autonomous Engine Process Matching & Self-Trade Prevention & user_id=null Support');
  const stockAuto = '00000000-0000-4000-8000-000000002002';
  memoryDb.stocks.set(stockAuto, {
    id: stockAuto, ticker: 'AUTO02', name: 'Auto Engine Stock', market: 'KRX',
    current_price: 50_000, previous_close: 50_000, open_price: 50_000,
    high: 50_000, low: 50_000, volume: 0, change_rate: 0, market_cap: 1_000_000_000, pe_ratio: 10, dividend_yield: 0, sector: 'IT',
  });

  // A. Bot-to-Bot crossing (user_id = null): Must succeed
  const botBuyOrder = { stock_id: stockAuto, user_id: null, side: 'buy', price: 50_000, size: 10, filled: 0, status: 'open', is_lp: false, created_at: new Date().toISOString() };
  const botSellOrder = { stock_id: stockAuto, user_id: null, side: 'sell', price: 50_000, size: 10, filled: 0, status: 'open', is_lp: false, created_at: new Date().toISOString() };

  await engine.processMatching([botBuyOrder, botSellOrder]);
  assert(memoryDb.stocks.get(stockAuto)!.volume >= 10, 'Bot-to-bot orders with user_id=null must match and produce volume');

  // B. Self-trade prevention in auto engine: Same real user orders must not match each other
  const selfUser = 'real_user_self_trading';
  memoryDb.profiles.set(selfUser, {
    id: selfUser, user_id: selfUser, username: selfUser, nickname: selfUser,
    cash: 5_000_000, net_worth: 5_000_000, rank_tier: 'Gold', created_at: new Date().toISOString(),
  });
  const selfHKey = `${selfUser}_${stockAuto}`;
  memoryDb.holdings.set(selfHKey, { id: selfHKey, user_id: selfUser, stock_id: stockAuto, quantity: 50, avg_price: 50_000, created_at: new Date().toISOString() });
  memoryDb.addHoldingToIndex({ id: selfHKey, user_id: selfUser, stock_id: stockAuto, quantity: 50, avg_price: 50_000, created_at: new Date().toISOString() });

  const userSelfBuy: OrderRecord = {
    id: 'self_buy_ord', stock_id: stockAuto, user_id: selfUser, side: 'buy', price: 50_000, size: 5, filled: 0, status: 'open', is_lp: false, created_at: new Date(Date.now() - 5000).toISOString()
  };
  const userSelfSell: OrderRecord = {
    id: 'self_sell_ord', stock_id: stockAuto, user_id: selfUser, side: 'sell', price: 50_000, size: 5, filled: 0, status: 'open', is_lp: false, created_at: new Date().toISOString()
  };
  memoryDb.orders.set(userSelfBuy.id, userSelfBuy);
  memoryDb.addOrderToIndex(userSelfBuy);
  memoryDb.orders.set(userSelfSell.id, userSelfSell);
  memoryDb.addOrderToIndex(userSelfSell);

  const volBeforeSelf = memoryDb.stocks.get(stockAuto)!.volume;
  await engine.processMatching([]); // Process existing book

  assert(userSelfBuy.filled === 0, 'Self-trade buy order must not fill against own sell order');
  assert(userSelfSell.filled === 0, 'Self-trade sell order must not fill against own buy order');
  assert(memoryDb.stocks.get(stockAuto)!.volume === volBeforeSelf, 'Volume must not increase from self-trade');

  // Clean up self orders
  memoryDb.orders.delete(userSelfBuy.id);
  memoryDb.removeOrderFromIndex(userSelfBuy);
  memoryDb.orders.delete(userSelfSell.id);
  memoryDb.removeOrderFromIndex(userSelfSell);

  // ----------------------------------------------------
  // TEST 3: Autonomous Engine Settlement Rejection & Full Rollback
  // ----------------------------------------------------
  console.log('\n[TEST 3] Autonomous Engine Settlement Rejection & Full Rollback');
  const stockRollback = '00000000-0000-4000-8000-000000002003';
  memoryDb.stocks.set(stockRollback, {
    id: stockRollback, ticker: 'ROLL03', name: 'Rollback Stock', market: 'KRX',
    current_price: 30_000, previous_close: 30_000, open_price: 30_000,
    high: 30_000, low: 30_000, volume: 0, change_rate: 0, market_cap: 1_000_000_000, pe_ratio: 10, dividend_yield: 0, sector: 'IT',
  });

  const poorBuyer = 'auto_poor_buyer';
  const goodSeller = 'auto_good_seller';

  // Buyer only has 10,000 cash, needs 300,000
  memoryDb.profiles.set(poorBuyer, { id: poorBuyer, user_id: poorBuyer, username: poorBuyer, nickname: poorBuyer, cash: 10_000, net_worth: 10_000, rank_tier: 'Bronze', created_at: new Date().toISOString() });
  memoryDb.profiles.set(goodSeller, { id: goodSeller, user_id: goodSeller, username: goodSeller, nickname: goodSeller, cash: 500_000, net_worth: 500_000, rank_tier: 'Bronze', created_at: new Date().toISOString() });

  const goodSellerHKey = `${goodSeller}_${stockRollback}`;
  memoryDb.holdings.set(goodSellerHKey, { id: goodSellerHKey, user_id: goodSeller, stock_id: stockRollback, quantity: 10, avg_price: 30_000, created_at: new Date().toISOString() });
  memoryDb.addHoldingToIndex({ id: goodSellerHKey, user_id: goodSeller, stock_id: stockRollback, quantity: 10, avg_price: 30_000, created_at: new Date().toISOString() });

  // Place resting sell order
  const restingSellOrd: OrderRecord = {
    id: 'resting_good_sell', stock_id: stockRollback, user_id: goodSeller, side: 'sell', price: 30_000, size: 10, filled: 0, status: 'open', is_lp: false, created_at: new Date(Date.now() - 5000).toISOString()
  };
  memoryDb.orders.set(restingSellOrd.id, restingSellOrd);
  memoryDb.addOrderToIndex(restingSellOrd);

  // Place matching buy order from poorBuyer
  const matchingBuyOrd: OrderRecord = {
    id: 'matching_poor_buy', stock_id: stockRollback, user_id: poorBuyer, side: 'buy', price: 30_000, size: 10, filled: 0, status: 'open', is_lp: false, created_at: new Date().toISOString()
  };
  memoryDb.orders.set(matchingBuyOrd.id, matchingBuyOrd);
  memoryDb.addOrderToIndex(matchingBuyOrd);

  const tradesCountBefore = memoryDb.trades.length;
  const historyCountBefore = memoryDb.stockPriceHistory.length;

  // Process matching -> settlement should fail due to insufficient cash -> rollback
  await engine.processMatching([]);

  assert(memoryDb.profiles.get(poorBuyer)!.cash === 10_000, 'Poor buyer cash must remain 10,000 (rolled back)');
  assert(memoryDb.profiles.get(goodSeller)!.cash === 500_000, 'Good seller cash must remain 500,000 (rolled back)');
  assert(memoryDb.holdings.get(goodSellerHKey)!.quantity === 10, 'Good seller holdings must remain 10 (rolled back)');
  assert(memoryDb.trades.length === tradesCountBefore, 'No trades must be appended on settlement rollback');
  assert(memoryDb.stockPriceHistory.length === historyCountBefore, 'Price history must not have leaked entries');
  assert(restingSellOrd.status === 'open', 'Resting sell order must remain open');
  assert(restingSellOrd.filled === 0, 'Resting sell order filled must remain 0');

  // Clean up
  memoryDb.orders.delete(restingSellOrd.id);
  memoryDb.removeOrderFromIndex(restingSellOrd);
  memoryDb.orders.delete(matchingBuyOrd.id);
  memoryDb.removeOrderFromIndex(matchingBuyOrd);

  // ----------------------------------------------------
  // TEST 4: Failure Rollback Preserves Other Successful Stock Trades
  // ----------------------------------------------------
  console.log('\n[TEST 4] Failure Rollback Preserves Other Successful Stock Trades');
  const stockSucc = '00000000-0000-4000-8000-000000002004';
  memoryDb.stocks.set(stockSucc, {
    id: stockSucc, ticker: 'SUCC04', name: 'Success Stock', market: 'KRX',
    current_price: 40_000, previous_close: 40_000, open_price: 40_000,
    high: 40_000, low: 40_000, volume: 0, change_rate: 0, market_cap: 1_000_000_000, pe_ratio: 10, dividend_yield: 0, sector: 'IT',
  });

  const succBuyer = 'succ_buyer_user';
  const succSeller = 'succ_seller_user';
  for (const uid of [succBuyer, succSeller]) {
    memoryDb.profiles.set(uid, { id: uid, user_id: uid, username: uid, nickname: uid, cash: 1_000_000, net_worth: 1_000_000, rank_tier: 'Bronze', created_at: new Date().toISOString() });
  }
  const succHKey = `${succSeller}_${stockSucc}`;
  memoryDb.holdings.set(succHKey, { id: succHKey, user_id: succSeller, stock_id: stockSucc, quantity: 10, avg_price: 40_000, created_at: new Date().toISOString() });
  memoryDb.addHoldingToIndex({ id: succHKey, user_id: succSeller, stock_id: stockSucc, quantity: 10, avg_price: 40_000, created_at: new Date().toISOString() });

  // Settle trade in stockSucc
  await LocalMarketService.submitOrder({ userId: succSeller, stockId: stockSucc, side: 'sell', price: 40_000, size: 5 });
  const succRes = await LocalMarketService.submitOrder({ userId: succBuyer, stockId: stockSucc, side: 'buy', price: 40_000, size: 5 });
  assert(succRes.success === true, 'Stock Succ trade completed successfully');

  const succTradesCount = memoryDb.trades.length;
  const succTradeRecord = memoryDb.trades[memoryDb.trades.length - 1];

  // Now trigger a rollback in stockRollback
  const failBuyer = 'fail_trigger_buyer';
  memoryDb.profiles.set(failBuyer, { id: failBuyer, user_id: failBuyer, username: failBuyer, nickname: failBuyer, cash: 0, net_worth: 0, rank_tier: 'Bronze', created_at: new Date().toISOString() });
  await LocalMarketService.submitOrder({ userId: succSeller, stockId: stockRollback, side: 'sell', price: 30_000, size: 1 });
  // This buy will fail due to 0 cash
  const failRes = await LocalMarketService.submitOrder({ userId: failBuyer, stockId: stockRollback, side: 'buy', price: 30_000, size: 1 });
  assert(failRes.success === false, 'Failed order rejected');

  // Verify stockSucc trade was completely preserved
  assert(memoryDb.trades.length === succTradesCount, 'Trade count must preserve successful trade');
  assert(memoryDb.trades.some((t) => t.id === succTradeRecord.id), 'Successful trade must not be deleted by other stock rollback');
  assert(memoryDb.stocks.get(stockSucc)!.volume === 5, 'Stock Succ volume remains intact');

  // ----------------------------------------------------
  // TEST 5: HTTP Route Security & RBAC Enforcement
  // ----------------------------------------------------
  console.log('\n[TEST 5] HTTP Route Security & RBAC Enforcement');

  // A. POST /api/orders in production rejects unauthenticated request
  const oldNodeEnv = process.env.NODE_ENV;
  try {
    (process.env as any).NODE_ENV = 'production';

    const unauthReq = new Request('http://localhost:3000/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock_id: stockSucc, side: 'buy', price: 40_000, size: 1 }),
    });
    const unauthRes = await ordersPostHandler(unauthReq);
    assert(unauthRes.status === 401, `Production unauthenticated /api/orders must return 401 (actual: ${unauthRes.status})`);
  } finally {
    (process.env as any).NODE_ENV = oldNodeEnv;
  }

  // B. POST /api/local-db forbids internal RPCs
  const forbiddenRpcReq = new Request('http://localhost:3000/api/local-db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'rpc', fnName: 'bulk_settle_trades', params: { p_trades: [] } }),
  });
  const forbiddenRpcRes = await localDbPostHandler(forbiddenRpcReq);
  assert(forbiddenRpcRes.status === 403, `bulk_settle_trades RPC via HTTP must return 403 (actual: ${forbiddenRpcRes.status})`);

  // C. POST /api/local-db forbids direct holdings modification
  const holdingTamperReq = new Request('http://localhost:3000/api/local-db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'execute', tableName: 'holdings', query: { action: 'insert', payloadData: { quantity: 1000 } } }),
  });
  const holdingTamperRes = await localDbPostHandler(holdingTamperReq);
  assert(holdingTamperRes.status === 403, `Direct holdings insert must return 403 (actual: ${holdingTamperRes.status})`);

  // D. POST /api/local-db forbids profile cash/is_admin tampering
  const profileTamperReq = new Request('http://localhost:3000/api/local-db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'execute', tableName: 'profiles', query: { action: 'update', payloadData: { cash: 999_999_999, is_admin: true } } }),
  });
  const profileTamperRes = await localDbPostHandler(profileTamperReq);
  assert(profileTamperRes.status === 403, `Profile cash/is_admin update must return 403 (actual: ${profileTamperRes.status})`);

  // E. POST /api/admin/scenarios rejects hardcoded x-admin-key bypass
  try {
    (process.env as any).NODE_ENV = 'production';
    const fakeKeyReq = new Request('http://localhost:3000/api/admin/scenarios', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': 'myung_admin_secret', // Legacy bypass attempt
      },
      body: JSON.stringify({ action: 'emergency_halt' }),
    });
    const fakeKeyRes = await adminPostHandler(fakeKeyReq);
    assert(fakeKeyRes.status === 403, `Legacy x-admin-key bypass must be rejected with 403 (actual: ${fakeKeyRes.status})`);

    const fakeKeyGetReq = new Request('http://localhost:3000/api/admin/scenarios', {
      method: 'GET',
      headers: { 'x-admin-key': 'myung_admin_secret' },
    });
    const fakeKeyGetRes = await adminGetHandler(fakeKeyGetReq);
    assert(fakeKeyGetRes.status === 403, `Admin GET logs without session must return 403 (actual: ${fakeKeyGetRes.status})`);
  } finally {
    (process.env as any).NODE_ENV = oldNodeEnv;
  }

  // ----------------------------------------------------
  // TEST 6: LP Recurring Refresh & Retention Cap & User Order Safety
  // ----------------------------------------------------
  console.log('\n[TEST 6] LP Recurring Refresh & Retention Cap & User Order Safety');
  const stockLp = '00000000-0000-4000-8000-000000002006';
  memoryDb.stocks.set(stockLp, {
    id: stockLp, ticker: 'LP06', name: 'LP Cap Test Stock', market: 'KRX',
    current_price: 100_000, previous_close: 100_000, open_price: 100_000,
    high: 100_000, low: 100_000, volume: 0, change_rate: 0, market_cap: 1_000_000_000, pe_ratio: 10, dividend_yield: 0, sector: 'IT',
  });

  // User places an open order on stockLp
  const lpUser = 'lp_test_user';
  memoryDb.profiles.set(lpUser, { id: lpUser, user_id: lpUser, username: lpUser, nickname: lpUser, cash: 10_000_000, net_worth: 10_000_000, rank_tier: 'Gold', created_at: new Date().toISOString() });
  const userOrderRes = await LocalMarketService.submitOrder({
    userId: lpUser, stockId: stockLp, side: 'buy', price: 95_000, size: 5,
  });
  assert(userOrderRes.success === true, 'User order placed on LP test stock');
  const userOrderId = userOrderRes.orderId!;

  // Trigger 15 LP refreshes and insert some filled LP orders
  for (let i = 0; i < 15; i++) {
    await engine.refreshLpOrders();
    // Simulate some filled LP orders
    const fakeFilledLp: OrderRecord = {
      id: `lp_filled_dummy_${stockLp}_${i}_${Date.now()}`,
      stock_id: stockLp,
      user_id: null,
      side: 'sell',
      price: 105_000,
      size: 10,
      filled: 10,
      status: 'filled',
      is_lp: true,
      created_at: new Date(Date.now() - (40 - i) * 1000).toISOString(),
    };
    memoryDb.orders.set(fakeFilledLp.id, fakeFilledLp);
    memoryDb.addOrderToIndex(fakeFilledLp);
  }

  // Refresh LP orders again (enforces cap <= 30 per stock)
  await engine.refreshLpOrders();

  const stockLpOrders = Array.from(memoryDb.orders.values()).filter((o) => o.stock_id === stockLp);
  const filledLpOrders = stockLpOrders.filter((o) => o.is_lp && (o.status === 'filled' || o.status === 'cancelled'));

  assert(filledLpOrders.length <= 30, `Filled LP orders must not exceed retention cap of 30 (actual: ${filledLpOrders.length})`);

  // Verify User Order is untouched
  const userOrderCheck = memoryDb.orders.get(userOrderId);
  assert(userOrderCheck !== undefined, 'User order must not be deleted during LP refreshes');
  assert(userOrderCheck?.status === 'open', 'User order must remain open');
  assert(userOrderCheck?.filled === 0, 'User order filled quantity must remain 0');

  // Verify LP Order IDs are stable
  const level1Bid = memoryDb.orders.get(`lp_${stockLp}_bid_1`);
  const level1Ask = memoryDb.orders.get(`lp_${stockLp}_ask_1`);
  assert(level1Bid !== undefined && level1Bid.is_lp === true, 'Stable Level 1 Bid LP order exists');
  assert(level1Ask !== undefined && level1Ask.is_lp === true, 'Stable Level 1 Ask LP order exists');

  // Clean up user order
  await ordersDeleteHandler(new Request(`http://localhost:3000/api/orders?order_id=${userOrderId}`, { method: 'DELETE' }));

  console.log('\n==================================================');
  console.log('🎉 ALL COMPREHENSIVE REGRESSION TESTS PASSED!');
  console.log('==================================================\n');

  stopLocalStandaloneEngine();
}

runComprehensiveTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Test failed with error:', err);
    stopLocalStandaloneEngine();
    process.exit(1);
  });
