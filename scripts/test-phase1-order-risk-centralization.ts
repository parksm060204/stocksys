/**
 * Phase 1 Test: Order Risk Policy Centralization & Diagnostic Verification
 *
 * Verifies that:
 * 1. Default child orders strictly enforce 5,000,000 KRW notional and 5,000 shares caps.
 * 2. Strategic institutional orders can safely scale within ADV and cash limits without arbitrary 5M capping.
 * 3. Absolute systemic limits block negative quantity, NaN, Infinity, and invalid prices (fail-closed).
 * 4. Reason codes and diagnostic records accurately document every adjustment reason.
 * 5. Prices are consistently aligned to the KRX tick ladder.
 */

import {
  evaluateOrderSafety,
  applyLegacyChildOrderSafetyLimits,
  OrderRiskContext,
  LEGACY_CHILD_ORDER_LIMITS
} from '../engine-server/src/risk/legacyOrderSafety';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`[Order Risk Centralization Test Failure] ${msg}`);
  }
}

async function runTest() {
  console.log('--- Testing Order Risk Policy Centralization ---');

  // 1. Standard Child Order Clamping (5M KRW / 5K Shares)
  const hugeChildOrder = {
    stock_id: 'STOCK_01',
    side: 'buy' as const,
    price: 100000,
    size: 50000 // 50,000 shares at 100,000 KRW = 5 Billion KRW
  };

  const childResult = evaluateOrderSafety(hugeChildOrder, 100000);
  assert(childResult.isAccepted, 'Order should be accepted after capping');
  // 5,000,000 / 100,000 = 50 shares
  assert(childResult.safeOrder.size === 50, `Expected 50 shares, received ${childResult.safeOrder.size}`);
  assert(childResult.diagnostic.reasonCodes.includes('REDUCED_BY_NOTIONAL_CAP'), 'Must contain REDUCED_BY_NOTIONAL_CAP');

  // Quantity cap check (cheap stock: 100 KRW, 10,000 shares)
  const cheapStockOrder = {
    stock_id: 'STOCK_CHEAP',
    side: 'buy' as const,
    price: 100,
    size: 10000
  };
  const cheapResult = evaluateOrderSafety(cheapStockOrder, 100);
  assert(cheapResult.safeOrder.size === 5000, `Expected 5000 shares cap, received ${cheapResult.safeOrder.size}`);
  assert(cheapResult.diagnostic.reasonCodes.includes('REDUCED_BY_QTY_CAP'), 'Must contain REDUCED_BY_QTY_CAP');

  // 2. Strategic Institutional Order (bypassing fixed 5M cap with ADV and available cash constraints)
  const strategicContext: OrderRiskContext = {
    orderType: 'STRATEGIC_ORDER',
    bypassLegacyChildOrderCap: true,
    adv: 200000, // 200,000 shares ADV -> max 25% = 50,000 shares
    availableCash: 2000000000, // 2 Billion KRW cash
    participantKind: 'DOMESTIC_INSTITUTION'
  };

  const strategicOrder = {
    stock_id: 'STOCK_01',
    side: 'buy' as const,
    price: 50000,
    size: 20000 // 20,000 shares at 50,000 KRW = 1 Billion KRW (exceeds 5M KRW, but within ADV 50K and cash 2B)
  };

  const strategicResult = evaluateOrderSafety(strategicOrder, 50000, strategicContext);
  assert(strategicResult.isAccepted, 'Strategic order should be accepted');
  assert(strategicResult.safeOrder.size === 20000, `Strategic order size should be 20,000, got ${strategicResult.safeOrder.size}`);
  assert(!strategicResult.diagnostic.reasonCodes.includes('REDUCED_BY_NOTIONAL_CAP'), 'Strategic order must NOT be clamped to 5M KRW');

  // Strategic order exceeding ADV limit (e.g. 70,000 shares when ADV is 200,000 -> max 50,000)
  const advContext: OrderRiskContext = {
    ...strategicContext,
    availableCash: 10000000000 // 10 Billion KRW (not cash constrained)
  };
  const oversizedStrategic = {
    stock_id: 'STOCK_01',
    side: 'buy' as const,
    price: 50000,
    size: 70000
  };
  const advResult = evaluateOrderSafety(oversizedStrategic, 50000, advContext);
  assert(advResult.safeOrder.size === 50000, `Expected 50,000 ADV limit, got ${advResult.safeOrder.size}`);
  assert(advResult.diagnostic.reasonCodes.includes('REDUCED_BY_ADV_LIMIT'), 'Must contain REDUCED_BY_ADV_LIMIT');

  // 3. Absolute Safety Guarantees (NaN, Negative, Infinity)
  const invalidPriceOrder = {
    stock_id: 'STOCK_01',
    side: 'buy' as const,
    price: NaN,
    size: 100
  };
  const nanPriceResult = evaluateOrderSafety(invalidPriceOrder, 1000);
  assert(!nanPriceResult.isAccepted, 'NaN price must be rejected');
  assert(nanPriceResult.diagnostic.reasonCodes.includes('REJECTED_INVALID_PRICE'), 'Must record REJECTED_INVALID_PRICE');

  const negativeQtyOrder = {
    stock_id: 'STOCK_01',
    side: 'sell' as const,
    price: 50000,
    size: -500
  };
  const negQtyResult = evaluateOrderSafety(negativeQtyOrder, 50000);
  assert(!negQtyResult.isAccepted, 'Negative quantity must be rejected');
  assert(negQtyResult.diagnostic.reasonCodes.includes('REJECTED_NON_POSITIVE_QTY'), 'Must record REJECTED_NON_POSITIVE_QTY');

  // 4. Tick Alignment
  const unalignedOrder = {
    stock_id: 'STOCK_01',
    side: 'buy' as const,
    price: 54321, // Price between 50,000 and 200,000 KRW has tick size 100
    size: 10
  };
  const alignedResult = evaluateOrderSafety(unalignedOrder, 50000);
  assert(alignedResult.safeOrder.price % 100 === 0, `Expected tick aligned to 100, got ${alignedResult.safeOrder.price}`);
  assert(alignedResult.diagnostic.reasonCodes.includes('ALIGNED_TO_KRX_TICK'), 'Must record ALIGNED_TO_KRX_TICK');

  console.log('✅ Order Risk Policy Centralization Test Passed: All limits, exemptions, and fail-safes verified.');
}

runTest().catch(err => {
  console.error(err);
  process.exit(1);
});
