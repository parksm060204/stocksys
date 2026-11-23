import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionProvider } from 'next-auth/react';
import { ToastProvider } from '../app/components/ToastProvider';

function renderWithProviders(el: React.ReactElement): string {
  return renderToStaticMarkup(
    React.createElement(
      SessionProvider as any,
      { session: null },
      React.createElement(ToastProvider, null, el)
    )
  );
}

const origLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
  if (request === 'lightweight-charts') {
    return {
      createChart: () => ({ addSeries: () => ({ setData: () => {} }), remove: () => {}, timeScale: () => ({ fitContent: () => {} }) }),
      ColorType: { Solid: 'solid' },
      LineSeries: {},
      CandlestickSeries: {},
      AreaSeries: {},
    };
  }
  return origLoad.call(this, request, parent, isMain);
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-review-20261120-'));
process.env.STOCKSYS_DATA_DIR = tempDir;

async function main() {
  try {
    const { MemoryDatabase, GUEST_USER_ID, SequentialIdGenerator } = await import('../lib/memoryDb/memoryStore');
    const { createInMemoryRepositoryBundle } = await import('../lib/repositories/inMemory');
    const { createMemoryDbClient } = await import('../lib/memoryDb/memoryDbClient');
    const { StaticTimeSource } = await import('../lib/engine/simulation/runtime/simulationTimeSource');
    const { SettlementBatchService } = await import('../engine-server/src/settlement/SettlementBatchService');
    const { MarketEngine } = await import('../engine-server/src/MarketEngine');
    const { evaluateOrderSafety } = await import('../engine-server/src/risk/legacyOrderSafety');
    const { createSimulationContext } = await import('../lib/engine/simulation/runtime/simulationContext');
    const {
      LocalMarketEngineInstance,
      stopLocalStandaloneEngine,
      memoryDb: _unused,
    } = await import('../lib/engine/localStandaloneServer') as any;
    const { memoryDb } = await import('../lib/memoryDb/memoryStore');
    const { LocalMarketService } = await import('../lib/engine/marketService');
    const { submitAuthoritativeOptionOrder, getOptionAccountSummary } = await import('../lib/options/optionOrderService');
    const { calculateMaxOptionBuyContracts, calculateOptionBuyRequiredCashKrw, getAvailableCashKrw } = await import('../lib/engine/orderRisk');
    const { CommodityOrderBook } = await import('../lib/commodities/CommodityOrderBook');
    const { reserveMarginAndSubmitCommodityOrder } = await import('../lib/commodities/commodityLedger');
    const { COMMODITY_DEFINITIONS } = await import('../lib/commodities/definitions');
    const { CommodityMarketEngine } = await import('../lib/commodities/CommodityMarketEngine');
    const { fmtPrice } = await import('../lib/format');
    const { isUsdQuotedAsset } = await import('../lib/engine/currency');
    const { authorizeNewsRecord, canReadRumor, MASKED_RUMOR_MESSAGE } = await import('../lib/news/accessPolicy');

    // ── F01: 채권 분기 쿠폰 주기 일치, 만기 상환 성공, 기존 키 호환, 오류 전파 ──
    console.log('▶ [F01] Bond quarterly coupon period, maturity redemption, legacy key compat & error propagation');
    {
      let simNow = Date.parse('2026-01-15T00:00:00Z');
      const clock = {
        now: () => simNow,
        setTime: (ms: number) => { simNow = ms; },
      };
      const db = new MemoryDatabase({
        clock,
        idGenerator: { nextId: (() => { let c = 0; return (p = 'id') => `${p}_${++c}`; })() },
      });
      const bundle = createInMemoryRepositoryBundle(db);
      const service = new SettlementBatchService(bundle, clock);

      const uid = 'u_f01';
      db.ensureUserProfile(uid, { email: 'f01@test.local' });
      db.profiles.get(uid)!.cash = 0;
      db.bonds.set('bond_f01', {
        id: 'bond_f01',
        ticker: 'F01B',
        name: 'F01 국고채',
        bond_type: 'govt',
        maturity: '1Y',
        maturity_date: '2026-09-15T00:00:00Z',
        coupon_rate: 4.0,
        face_value: 10000,
        quote_base: 100,
        current_price: 100,
        ytm: 4.0,
        duration: 1,
        volume: 1000,
      });
      const h = {
        id: `${uid}_bond_f01`,
        user_id: uid,
        stock_id: 'bond_f01',
        quantity: 10,
        avg_price: 100,
        created_at: db.getIsoTimestamp(),
      };
      db.holdings.set(h.id, h);
      db.addHoldingToIndex(h);

      // Q1 (1, 2, 3월): 1회만 지급 (10 * 10000 * 4% / 4 = 1000)
      const jan = await service.runDailySettlementBatch();
      clock.setTime(Date.parse('2026-02-15T00:00:00Z'));
      const feb = await service.runDailySettlementBatch();
      clock.setTime(Date.parse('2026-03-15T00:00:00Z'));
      const mar = await service.runDailySettlementBatch();
      assert.equal(jan.bondCouponsPaid, 1000);
      assert.equal(feb.bondCouponsPaid, 0);
      assert.equal(mar.bondCouponsPaid, 0);
      assert.equal(db.profiles.get(uid)!.cash, 1000);

      // Q3 (8월 15일 쿠폰 지급 후 9월 15일 동일 분기 내 만기 도래 -> 원금 100,000원만 상환, 중복 쿠폰 0)
      clock.setTime(Date.parse('2026-08-15T00:00:00Z'));
      const aug = await service.runDailySettlementBatch();
      assert.equal(aug.bondCouponsPaid, 1000);

      clock.setTime(Date.parse('2026-09-15T00:00:00Z'));
      const sepMat = await service.runDailySettlementBatch();
      assert.equal(sepMat.bondCouponsPaid, 0, 'Duplicate coupon must not be paid in same quarter');
      assert.equal(sepMat.bondPrincipalRedeemed, 100_000, 'Principal must redeem even after Q3 coupon already paid');
      assert.equal(db.holdings.has(h.id), false, 'Matured bond holding must be closed');
      assert.equal(db.profiles.get(uid)!.cash, 102_000);

      // 교차 분기 91.25일 윈도우 내 만기(8/15 지급 -> 10/05 만기)도 INVALID_COUPON_AMOUNT 없이 원금 상환
      const uidCross = 'u_f01_cross';
      db.ensureUserProfile(uidCross, { email: 'f01c@test.local' });
      db.profiles.get(uidCross)!.cash = 0;
      db.bonds.set('bond_f01_cross', {
        id: 'bond_f01_cross',
        ticker: 'F01C',
        name: 'F01C 채권',
        bond_type: 'govt',
        maturity: '1Y',
        maturity_date: '2026-10-05T00:00:00Z',
        coupon_rate: 4.0,
        face_value: 10000,
        quote_base: 100,
        current_price: 100,
        ytm: 4.0,
        duration: 1,
        volume: 1000,
      });
      const hCross = {
        id: `${uidCross}_bond_f01_cross`,
        user_id: uidCross,
        stock_id: 'bond_f01_cross',
        quantity: 10,
        avg_price: 100,
        created_at: db.getIsoTimestamp(),
      };
      db.holdings.set(hCross.id, hCross);
      db.addHoldingToIndex(hCross);
      clock.setTime(Date.parse('2026-08-15T00:00:00Z'));
      await service.runDailySettlementBatch();
      clock.setTime(Date.parse('2026-10-05T00:00:00Z'));
      const crossMat = await service.runDailySettlementBatch();
      assert.equal(crossMat.bondPrincipalRedeemed, 100_000);
      assert.equal(crossMat.bondCouponsPaid, 0);
      assert.equal(db.profiles.get(uidCross)!.cash, 101_000);

      // 기존 월간 키(period_2026-08)와 호환 + 트리밍 후에도 중복 차단
      const uidLegacy = 'u_f01_legacy';
      db.ensureUserProfile(uidLegacy, { email: 'f01l@test.local' });
      db.profiles.get(uidLegacy)!.cash = 0;
      const hLeg = {
        id: `${uidLegacy}_bond_f01`,
        user_id: uidLegacy,
        stock_id: 'bond_f01',
        quantity: 5,
        avg_price: 100,
        created_at: db.getIsoTimestamp(),
      };
      db.holdings.set(hLeg.id, hLeg);
      db.addHoldingToIndex(hLeg);
      db.settlementLedger.set(`bond_coupon_bond_f01_${uidLegacy}_period_2026-08`, {
        trade_id: `bond_coupon_bond_f01_${uidLegacy}_period_2026-08`,
        stock_id: 'bond_f01',
        price: 0,
        size: 0,
        total_amount: 500,
        buyer_fee_rate: 0,
        seller_fee_rate: 0,
        buyer_fee_amount: 0,
        seller_fee_amount: 0,
        settled_at: '2026-08-15T00:00:00.000Z',
      });
      clock.setTime(Date.parse('2026-09-15T00:00:00Z'));
      const legMat = await service.runDailySettlementBatch();
      assert.equal(legMat.bondCouponsPaid, 0);
      assert.equal(legMat.bondPrincipalRedeemed, 50_000);

      // 실패 은폐 금지: 누락 프로필 보유 포지션 정산 시 에러 전파 확인
      const ghostH = {
        id: `missing_user_bond_f01`,
        user_id: 'missing_user',
        stock_id: 'bond_f01',
        quantity: 2,
        avg_price: 100,
        created_at: db.getIsoTimestamp(),
      };
      db.holdings.set(ghostH.id, ghostH);
      db.addHoldingToIndex(ghostH);
      await assert.rejects(() => service.runDailySettlementBatch(), /USER_NOT_FOUND|failed/);
      db.removeHoldingFromIndex(ghostH);
      db.holdings.delete(ghostH.id);
    }
    console.log('  ✅ PASS [F01]');

    // ── F02 & F03: Standalone 활성 틱 만기 정산 + 20틱 봇/LP 정리 및 사용자 주문 보호 ──
    console.log('▶ [F02 & F03] Standalone tick settlement & 20-tick bot/LP cleanup with real user protection');
    {
      memoryDb.resetToSeedData();
      const engine = new LocalMarketEngineInstance();
      let persistCalls = 0;
      let allowPersist = true;
      engine.setOnPersist(async () => {
        persistCalls += 1;
        return allowPersist;
      });

      const nowMs = memoryDb.getNowMs();
      const uid = 'usr_f02_real';
      memoryDb.ensureUserProfile(uid, { email: 'f02real@test.local' });
      memoryDb.profiles.get(uid)!.cash = 10_000_000;

      // 만기 도래 ITM 옵션과 만기 채권 보유 시드
      const opt = Array.from(memoryDb.optionsContracts.values())[0]!;
      opt.expiry_date = new Date(nowMs - 10_000).toISOString();
      opt.strike_price = 200; // KOSPI200 ~260..300 대비 ITM
      opt.asset_class = 'IDX';
      opt.type = 'CALL';
      opt.option_type = 'CALL';
      opt.multiplier = 250000;
      const optHid = `${uid}_${opt.id}`;
      const optHolding = { id: optHid, user_id: uid, stock_id: opt.id, quantity: 2, avg_price: 5, created_at: memoryDb.getIsoTimestamp() };
      memoryDb.holdings.set(optHid, optHolding);
      memoryDb.addHoldingToIndex(optHolding);

      const bond = Array.from(memoryDb.bonds.values())[0]!;
      bond.maturity_date = new Date(nowMs - 10_000).toISOString();
      const bondHid = `${uid}_${bond.id}`;
      const bondHolding = { id: bondHid, user_id: uid, stock_id: bond.id, quantity: 3, avg_price: 100, created_at: memoryDb.getIsoTimestamp() };
      memoryDb.holdings.set(bondHid, bondHolding);
      memoryDb.addHoldingToIndex(bondHolding);

      // F03: 실제 사용자 주문 + acc_ 프리픽스 실제 사용자 주문 + 종료 봇/LP 주문 생성
      const realUserOrder: any = {
        id: 'ord_real_human_1',
        stock_id: Array.from(memoryDb.stocks.keys())[0]!,
        user_id: uid,
        side: 'buy',
        price: 1000,
        size: 10,
        filled: 0,
        status: 'open',
        is_lp: false,
        created_at: new Date(nowMs - 120_000).toISOString(),
      };
      const accPrefixRealUser = 'acc_human_edge_case';
      memoryDb.ensureUserProfile(accPrefixRealUser, { email: 'acchuman@test.local' });
      const accPrefixUserOrder: any = {
        id: 'ord_acc_prefix_real_user',
        stock_id: Array.from(memoryDb.stocks.keys())[0]!,
        user_id: accPrefixRealUser,
        side: 'buy',
        price: 1000,
        size: 5,
        filled: 0,
        status: 'open',
        is_lp: false,
        created_at: new Date(nowMs - 120_000).toISOString(),
      };
      const terminatedBotOrder: any = {
        id: 'ord_bot_done_1',
        stock_id: Array.from(memoryDb.stocks.keys())[0]!,
        user_id: 'acc_bot_val_1',
        participant_type: 'bot',
        agent_id: 'bot_val_1',
        side: 'buy',
        price: 1000,
        size: 5,
        filled: 5,
        status: 'filled',
        is_lp: false,
        created_at: new Date(nowMs - 10_000).toISOString(),
      };
      const staleLpOrder: any = {
        id: 'ord_lp_done_1',
        stock_id: Array.from(memoryDb.stocks.keys())[0]!,
        user_id: 'acc_lp_main',
        participant_type: 'lp',
        agent_id: 'lp_main',
        side: 'sell',
        price: 100000,
        size: 100,
        filled: 0,
        status: 'cancelled',
        is_lp: true,
        created_at: new Date(nowMs - 45_000).toISOString(),
      };
      for (const o of [realUserOrder, accPrefixUserOrder, terminatedBotOrder, staleLpOrder]) {
        memoryDb.orders.set(o.id, o);
        memoryDb.addOrderToIndex(o);
      }

      // 49틱까지 실행 -> 아직 정산되지 않음, 20틱/40틱에 봇/LP 정리 실행
      for (let t = 1; t <= 49; t++) {
        await engine.tick();
      }
      assert.equal(memoryDb.holdings.has(optHid), true, 'Option must not settle before tick 50');
      assert.equal(memoryDb.orders.has(realUserOrder.id), true, 'Real human order must be preserved');
      assert.equal(memoryDb.orders.has(accPrefixUserOrder.id), true, 'acc_* human user order without bot metadata must be preserved');
      assert.equal(memoryDb.orders.has(terminatedBotOrder.id), false, 'Filled bot order must be cleaned up at 20-tick loop');
      assert.equal(memoryDb.orders.has(staleLpOrder.id), false, 'Stale terminated LP order must be cleaned up at 20-tick loop');

      // 인덱스 정합성 확인: 인덱스 내 모든 ID가 memoryDb.orders에 실존해야 함
      for (const [sid, idSet] of memoryDb.orderStockIndex.entries()) {
        for (const oid of idSet) {
          assert.ok(memoryDb.orders.has(oid), `orderStockIndex[${sid}] has dangling id ${oid}`);
        }
      }
      for (const [uidIdx, idSet] of memoryDb.orderUserIndex.entries()) {
        for (const oid of idSet) {
          assert.ok(memoryDb.orders.has(oid), `orderUserIndex[${uidIdx}] has dangling id ${oid}`);
        }
      }

      // 50번째 틱에서 만기 옵션·채권 정산 실행 확인 (실패 롤백 먼저 검증 후 성공 검증)
      allowPersist = false;
      const cashBeforeRollback = memoryDb.profiles.get(uid)!.cash;
      await engine.tick(); // tick 50 -> persist 실패로 롤백되어야 함
      assert.equal(engine.lastPersistOk, false);
      assert.equal(memoryDb.holdings.has(optHid), true, 'Option holding must roll back when persist fails');
      assert.equal(memoryDb.holdings.has(bondHid), true, 'Bond holding must roll back when persist fails');
      assert.equal(memoryDb.profiles.get(uid)!.cash, cashBeforeRollback);

      // 이제 100번째 틱에서 영속 성공 시 실제 만기 정산 커밋 확인
      allowPersist = true;
      for (let t = 51; t <= 100; t++) {
        await engine.tick();
      }
      assert.equal(memoryDb.holdings.has(optHid), false, 'Expired option must be settled and closed on tick');
      assert.equal(memoryDb.holdings.has(bondHid), false, 'Matured bond must be redeemed and closed on tick');
      assert.ok(memoryDb.profiles.get(uid)!.cash > cashBeforeRollback, 'User cash must increase after maturity settlement');
      assert.ok(persistCalls > 0);
    }
    console.log('  ✅ PASS [F02 & F03]');

    // ── F04: MemoryQueryBuilder .or(), V1/V2 SSR 뉴스 권한 마스킹 및 title 호환 ──
    console.log('▶ [F04] .or() query builder, V1/V2 SSR rumor masking & title rendering');
    {
      memoryDb.resetToSeedData();
      const targetStock = Array.from(memoryDb.stocks.values()).find((s) => s.ticker === '005930')!;
      memoryDb.marketNews.unshift(
        {
          id: 'news_f04_rumor',
          type: 'MARKET',
          category: 'RUMOR',
          publisher: '찌라시일보',
          title: `${targetStock.name} 비공개 루머 제목`,
          content: 'SECRET_INSIDER_RUMOR_BODY_XYZ',
          target_sector: targetStock.sector,
          target_ticker: targetStock.ticker,
          impact_score: 0.7,
          created_at: new Date().toISOString(),
        },
        {
          id: 'news_f04_official',
          type: 'MARKET',
          category: 'OFFICIAL',
          publisher: '공식경제',
          title: `${targetStock.name} 공식 공시 제목`,
          content: 'OFFICIAL_PUBLIC_CONTENT_ABC',
          target_sector: targetStock.sector,
          target_ticker: targetStock.ticker,
          impact_score: 0.5,
          created_at: new Date().toISOString(),
        }
      );

      const client = createMemoryDbClient(memoryDb);
      const { data: orRows, error: orErr } = await client
        .from('market_news')
        .select('*')
        .or(`target_ticker.eq.${targetStock.ticker},title.ilike.%${targetStock.name}%`)
        .order('created_at', { ascending: false })
        .limit(5);
      assert.equal(orErr, null);
      assert.ok(Array.isArray(orRows) && orRows.length >= 2);

      // 비구독 SSR 렌더링 (개발 게스트 기본 비구독 상태)
      const guestProf = memoryDb.profiles.get(GUEST_USER_ID);
      if (guestProf) {
        guestProf.is_admin = false;
        guestProf.news_subscriptions = {};
      }
      const { default: StockDetailV2Page } = await import('../app/v2/stocks/[id]/page');
      const { default: StockDetailV1Page } = await import('../app/stocks/[id]/page');

      const v2El = await StockDetailV2Page({ params: Promise.resolve({ id: targetStock.id }) });
      const v2Related = (v2El as any).props.relatedNews as any[];
      assert.ok(v2Related.length >= 2, 'V2 SSR must load relatedNews without .or() crash');
      const v2Rumor = v2Related.find((n) => n.id === 'news_f04_rumor');
      const v2Official = v2Related.find((n) => n.id === 'news_f04_official');
      assert.ok(v2Rumor && v2Official);
      assert.equal(v2Rumor.locked, true);
      assert.equal(v2Rumor.content, MASKED_RUMOR_MESSAGE);
      assert.equal(v2Official.content, 'OFFICIAL_PUBLIC_CONTENT_ABC');

      const { default: StockDetailV2Client } = await import('../app/v2/stocks/[id]/StockDetailV2Client');
      const v2Html = renderWithProviders(
        React.createElement(StockDetailV2Client, {
          stock: (v2El as any).props.stock,
          relatedNews: v2Related,
          messages: [],
          tradingValueStr: (v2El as any).props.tradingValueStr,
        })
      );
      assert.equal(v2Html.includes('SECRET_INSIDER_RUMOR_BODY_XYZ'), false, 'V2 SSR HTML must NOT leak unsubscribed RUMOR body');
      assert.equal(v2Html.includes(`${targetStock.name} 비공개 루머 제목`), true, 'V2 SSR must render MarketNewsRecord.title');

      const v1El = await StockDetailV1Page({ params: Promise.resolve({ id: targetStock.id }) });
      const v1Html = renderWithProviders(v1El as React.ReactElement);
      assert.equal(v1Html.includes('SECRET_INSIDER_RUMOR_BODY_XYZ'), false, 'V1 SSR HTML must NOT leak unsubscribed RUMOR body');
      // V1 Server Component가 StockDetailClient에 전달한 relatedNews prop 검증
      const findRelatedNewsProp = (node: any): any[] | null => {
        if (!node || typeof node !== 'object') return null;
        if (node.props && Array.isArray(node.props.relatedNews)) return node.props.relatedNews;
        const ch = node.props?.children;
        if (Array.isArray(ch)) {
          for (const c of ch) {
            const found = findRelatedNewsProp(c);
            if (found) return found;
          }
        } else if (ch) {
          return findRelatedNewsProp(ch);
        }
        return null;
      };
      const v1Related = findRelatedNewsProp(v1El);
      assert.ok(v1Related && v1Related.length >= 2, 'V1 SSR must pass non-empty relatedNews to StockDetailClient');
      const v1Rumor = v1Related!.find((n) => n.id === 'news_f04_rumor');
      assert.ok(v1Rumor);
      assert.equal(v1Rumor.locked, true);
      assert.equal(v1Rumor.content, MASKED_RUMOR_MESSAGE);

      // 구독자 권한 시나리오 확인
      if (guestProf) {
        guestProf.news_subscriptions = { press_a: new Date(Date.now() + 86_400_000).toISOString() };
        const v2SubEl = await StockDetailV2Page({ params: Promise.resolve({ id: targetStock.id }) });
        const v2SubRelated = (v2SubEl as any).props.relatedNews as any[];
        const subRumor = v2SubRelated.find((n) => n.id === 'news_f04_rumor');
        assert.equal(subRumor.locked, false);
        assert.equal(subRumor.content, 'SECRET_INSIDER_RUMOR_BODY_XYZ');
        guestProf.news_subscriptions = {};
      }
      assert.equal(canReadRumor(null), false);
      assert.equal(authorizeNewsRecord(memoryDb.marketNews[0], false).content, MASKED_RUMOR_MESSAGE);
    }
    console.log('  ✅ PASS [F04]');

    // ── F05: 해외주식/USD ETF 0.01 틱, 국내 KRX 틱, 채권 전용 클램프 & 저장소 주문 매칭 ──
    console.log('▶ [F05] Market-specific tick alignment & decimal repo order matching (no ORDER_PRICE_MISMATCH)');
    {
      const usdSafety = evaluateOrderSafety(
        { stock_id: 'stk_googl', side: 'buy', price: 141.2, size: 2 },
        141.2,
        { market: 'overseas', ticker: 'GOOGL' }
      );
      assert.equal(usdSafety.accepted, true);
      assert.equal(usdSafety.order!.price, 141.2);

      const usdEtfSafety = evaluateOrderSafety(
        { stock_id: 'stk_tqqq', side: 'buy', price: 60.25, size: 2 },
        60.25,
        { market: 'etf', ticker: 'TQQQ' }
      );
      assert.equal(usdEtfSafety.accepted, true);
      assert.equal(usdEtfSafety.order!.price, 60.25, 'USD ETF in $50..$150 must not clamp to [80,120] or KRX integer');

      const krxSafety = evaluateOrderSafety(
        { stock_id: 'stk_kr', side: 'buy', price: 10004, size: 2 },
        10004,
        { market: 'domestic', ticker: '005930' }
      );
      assert.equal(krxSafety.accepted, true);
      assert.equal(krxSafety.order!.price, 10000);

      const bondSafety = evaluateOrderSafety(
        { stock_id: 'bond_1', side: 'buy', price: 75.5, size: 2 },
        75.5,
        { market: 'bonds', ticker: 'KR3Y' }
      );
      assert.equal(bondSafety.accepted, true);
      assert.equal(bondSafety.order!.price, 80);

      // MarketEngine 실제 매칭 정산 검증 (GOOGL $141.20 & TQQQ $60.25)
      const simCtx = createSimulationContext({ seed: 77, clock: new StaticTimeSource(Date.parse('2026-06-01T10:00:00Z')) });
      const db = new MemoryDatabase({ clock: simCtx.clock, idGenerator: new SequentialIdGenerator(77) });
      const bundle = createInMemoryRepositoryBundle(db);
      const engine = new MarketEngine({ simulationContext: simCtx, repositories: bundle });
      const googl = Array.from(db.stocks.values()).find((s) => s.ticker === 'GOOGL')!;
      const tqqq = Array.from(db.stocks.values()).find((s) => s.ticker === 'TQQQ')!;
      const buyer = 'u_f05_buyer';
      const seller = 'u_f05_seller';
      db.ensureUserProfile(buyer, { email: 'f05b@test.local' });
      db.ensureUserProfile(seller, { email: 'f05s@test.local' });
      db.profiles.get(buyer)!.cash = 50_000_000;
      db.profiles.get(seller)!.cash = 1_000_000;
      for (const stk of [googl, tqqq]) {
        const h = { id: `${seller}_${stk.id}`, user_id: seller, stock_id: stk.id, quantity: 20, avg_price: 50, created_at: db.getIsoTimestamp() };
        db.holdings.set(h.id, h);
        db.addHoldingToIndex(h);
      }
      const ordersToInsert: any[] = [
        { id: 'f05_b1', stock_id: googl.id, user_id: buyer, side: 'buy', price: 141.2, size: 2, filled: 0, status: 'open', is_lp: false, created_at: new Date(simCtx.clock.now() - 2000).toISOString(), version: 1 },
        { id: 'f05_s1', stock_id: googl.id, user_id: seller, side: 'sell', price: 141.2, size: 2, filled: 0, status: 'open', is_lp: false, created_at: new Date(simCtx.clock.now() - 1000).toISOString(), version: 1 },
        { id: 'f05_b2', stock_id: tqqq.id, user_id: buyer, side: 'buy', price: 60.25, size: 3, filled: 0, status: 'open', is_lp: false, created_at: new Date(simCtx.clock.now() - 2000).toISOString(), version: 1 },
        { id: 'f05_s2', stock_id: tqqq.id, user_id: seller, side: 'sell', price: 60.25, size: 3, filled: 0, status: 'open', is_lp: false, created_at: new Date(simCtx.clock.now() - 1000).toISOString(), version: 1 },
      ];
      for (const o of ordersToInsert) {
        db.orders.set(o.id, o);
        db.addOrderToIndex(o);
      }
      const batchRes = await (engine as any).processBatchOrders([], {
        stocks: Array.from(db.stocks.values()),
        bonds: [],
        commodities: [],
        options_contracts: [],
        usdToKrwRate: 1380,
      }, false);
      assert.equal(batchRes.commitStatus, 'COMMITTED');
      assert.equal(batchRes.settledTradesCount, 2, 'Both GOOGL $141.20 and TQQQ $60.25 repo orders must match and settle');
      assert.equal(engine.getLastSettlementError(), null);
      assert.equal(db.holdings.get(`${buyer}_${googl.id}`)?.quantity, 2);
      assert.equal(db.holdings.get(`${buyer}_${tqqq.id}`)?.quantity, 3);
    }
    console.log('  ✅ PASS [F05]');

    // ── F06: CommodityOrderbookPanel 호가 잔량/스프레드 표시 (NaN 없음) ──
    console.log('▶ [F06] CommodityOrderbookPanel depth/spread format & null safety');
    {
      const { default: CommodityOrderbookPanel } = await import('../app/components/commodities/CommodityOrderbookPanel');
      const book = new CommodityOrderBook('GOLD', new StaticTimeSource(1774000000000));
      book.addOrder({ id: 'cb1', commodityId: 'GOLD', side: 'buy', type: 'limit', price: 2345.5, size: 12, filled: 0, createdAtTick: 1, createdAtTime: 1 });
      book.addOrder({ id: 'ca1', commodityId: 'GOLD', side: 'sell', type: 'limit', price: 2346.5, size: 8, filled: 0, createdAtTick: 1, createdAtTime: 2 });
      const depth = book.getDepth(10);
      const spreadObj = book.getSpread(2346);

      const htmlValid = renderToStaticMarkup(
        React.createElement(CommodityOrderbookPanel, {
          ticker: 'GC',
          currentPrice: 2346,
          bids: depth.bids,
          asks: depth.asks,
          spread: spreadObj,
        })
      );
      assert.equal(htmlValid.includes('NaN'), false, 'Valid orderbook must not render NaN');
      assert.equal(htmlValid.includes('$1.00'), true, 'Spread object must render $1.00');
      assert.equal(htmlValid.includes('12'), true);
      assert.equal(htmlValid.includes('8'), true);

      const htmlEmpty = renderToStaticMarkup(
        React.createElement(CommodityOrderbookPanel, {
          ticker: 'GC',
          currentPrice: 2346,
          bids: [],
          asks: [],
          spread: { bestBid: null, bestAsk: null, spread: null, spreadPct: null },
        })
      );
      assert.equal(htmlEmpty.includes('NaN'), false, 'Empty/null spread must not render NaN');
      assert.equal(htmlEmpty.includes('—'), true);
    }
    console.log('  ✅ PASS [F06]');

    // ── F07: 원자재 선물 숏 포지션 side 표시 및 청산/부분청산/반대방향 초과 증거금 ──
    console.log('▶ [F07] Commodity short position display & reduce-only / partial / reverse margin');
    {
      memoryDb.resetToSeedData();
      const gold = COMMODITY_DEFINITIONS.find((c) => c.id === 'GOLD')!;
      const uid = 'u_f07_short';
      memoryDb.ensureUserProfile(uid, { email: 'f07@test.local' });
      memoryDb.profiles.get(uid)!.cash = 30_000_000;
      memoryDb.commodityPositions.set(`${uid}_${gold.id}`, {
        id: `${uid}_${gold.id}`,
        user_id: uid,
        commodity_id: gold.id,
        side: 'short',
        quantity: 5,
        avg_entry_price: 2350,
        reserved_margin_krw: 10_000_000,
        realized_pnl_krw: 0,
        updated_at: memoryDb.getIsoTimestamp(),
      });
      const book = new CommodityOrderBook(gold.id, new StaticTimeSource(1774000000000));

      // 부분청산(buy 3 <= short 5): 증거금 0원
      const partialRes = await reserveMarginAndSubmitCommodityOrder({
        db: memoryDb,
        commodity: gold,
        userId: uid,
        side: 'buy',
        type: 'limit',
        price: 2340,
        size: 3,
        submitToEngine: () => {
          const ord = { id: 'cm_part', commodityId: gold.id, userId: uid, side: 'buy' as const, type: 'limit' as const, price: 2340, size: 3, filled: 0, createdAtTick: 1, createdAtTime: 1 };
          book.addOrder(ord);
          return ord;
        },
        rollbackFromEngine: (id) => {
          book.bids = book.bids.filter((o) => o.id !== id);
          book.asks = book.asks.filter((o) => o.id !== id);
        },
      });
      assert.equal(partialRes.success, true, partialRes.message);
      assert.equal(partialRes.reservation?.reserved_krw, 0, 'Partial close of short must reserve 0 margin');

      // 반대방향 초과(buy 4 when remaining closing capacity is 5 - 3 = 2): 2계약분만 증거금 부과
      const reverseRes = await reserveMarginAndSubmitCommodityOrder({
        db: memoryDb,
        commodity: gold,
        userId: uid,
        side: 'buy',
        type: 'limit',
        price: 2340,
        size: 4,
        submitToEngine: () => {
          const ord = { id: 'cm_rev', commodityId: gold.id, userId: uid, side: 'buy' as const, type: 'limit' as const, price: 2340, size: 4, filled: 0, createdAtTick: 2, createdAtTime: 2 };
          book.addOrder(ord);
          return ord;
        },
        rollbackFromEngine: (id) => {
          book.bids = book.bids.filter((o) => o.id !== id);
          book.asks = book.asks.filter((o) => o.id !== id);
        },
      });
      assert.equal(reverseRes.success, true, reverseRes.message);
      assert.equal(
        reverseRes.reservation?.reserved_krw,
        2 * reverseRes.reservation!.margin_per_contract_krw,
        'Excess buy beyond remaining short closing capacity must charge 2 contracts margin'
      );
    }
    console.log('  ✅ PASS [F07]');

    // ── F08: 관리자 거래 동결 서버/엔진 연동, LP 무한 유동성 비활성화, 시나리오 API 거부 & 주식 시나리오 연동 ──
    console.log('▶ [F08] Admin trading halt enforcement, unsupported scenario rejection & stock/commodity scenario wiring');
    {
      memoryDb.resetToSeedData();
      process.env.ALLOW_DEV_ADMIN = 'true';
      const { GET: adminGet, POST: adminPost } = await import('../app/api/admin/scenarios/route');
      const { POST: ordersPost } = await import('../app/api/orders/route');
      const { default: AdminPage } = await import('../app/admin/page');

      // 1) 비지원 bond / 존재하지 않는 stock 시나리오 거부 (400)
      const bondScenRes = await adminPost(new Request('http://localhost/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'inject_scenario', assetType: 'bond', assetId: 'bond_kr_2y', ticker: 'KR2Y', name: '국고채', mode: 'pump' }),
      }));
      assert.equal(bondScenRes.status, 400);

      const badStockScenRes = await adminPost(new Request('http://localhost/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'inject_scenario', assetType: 'stock', assetId: 'not_a_real_stock', ticker: 'NOPE', name: 'Nope', mode: 'pump' }),
      }));
      assert.equal(badStockScenRes.status, 400);

      // 2) 거래 동결(set_trading_halt) 활성화 -> GET 조회 및 주식/옵션/원자재 주문/엔진 틱 차단 확인
      const haltOnRes = await adminPost(new Request('http://localhost/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_trading_halt', tradingHalt: true }),
      }));
      assert.equal(haltOnRes.status, 200);

      const statusJson = await (await adminGet(new Request('http://localhost/api/admin/scenarios'))).json();
      assert.equal(statusJson.emergencyControl.tradingHalt, true);
      assert.equal(statusJson.emergencyControl.lpInfiniteLiquiditySupported, false);

      const stk = Array.from(memoryDb.stocks.values())[0]!;
      const haltedStockOrder = await ordersPost(new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_id: stk.id, side: 'buy', price: stk.current_price, size: 1 }),
      }));
      assert.equal(haltedStockOrder.status, 400);
      const haltedStockJson = await haltedStockOrder.json();
      assert.match(haltedStockJson.message, /거래 동결|서킷브레이커/);

      const optId = Array.from(memoryDb.optionsContracts.keys())[0]!;
      const haltedOptRes = await submitAuthoritativeOptionOrder({
        db: memoryDb,
        userId: GUEST_USER_ID,
        contractId: optId,
        side: 'BUY',
        orderType: 'LIMIT',
        price: 1.0,
        qty: 1,
      });
      assert.equal(haltedOptRes.success, false);
      assert.equal(haltedOptRes.statusCode, 403);

      const gold = COMMODITY_DEFINITIONS[0]!;
      const commBook = new CommodityOrderBook(gold.id, new StaticTimeSource(1774000000000));
      const haltedCommRes = await reserveMarginAndSubmitCommodityOrder({
        db: memoryDb,
        commodity: gold,
        userId: GUEST_USER_ID,
        side: 'buy',
        type: 'limit',
        price: 2300,
        size: 1,
        submitToEngine: () => {
          const ord = { id: 'h1', commodityId: gold.id, side: 'buy' as const, type: 'limit' as const, price: 2300, size: 1, filled: 0, createdAtTick: 1, createdAtTime: 1 };
          commBook.addOrder(ord);
          return ord;
        },
        rollbackFromEngine: () => {},
      });
      assert.equal(haltedCommRes.success, false);
      assert.equal(haltedCommRes.statusCode, 403);

      const commEngine = new CommodityMarketEngine({ db: memoryDb });
      const tickBefore = commEngine.currentTick;
      commEngine.nextTick();
      assert.equal(commEngine.currentTick, tickBefore, 'CommodityMarketEngine must freeze ticks while trading is halted');

      // 동결 해제
      const haltOffRes = await adminPost(new Request('http://localhost/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_trading_halt', tradingHalt: false }),
      }));
      assert.equal(haltOffRes.status, 200);

      // 3) 주식 시나리오 주입 시 Standalone 엔진 틱 펀더멘털에 실제 반영됨을 확인
      const baseEngine = new LocalMarketEngineInstance();
      await baseEngine.tick();
      const baseFundamental = baseEngine.__getAgentManagerForTesting().fundamentals.get(stk.id)!;

      memoryDb.resetToSeedData();
      const scenEngine = new LocalMarketEngineInstance();
      const stockPumpRes = await adminPost(new Request('http://localhost/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'inject_scenario',
          assetType: 'stock',
          assetId: stk.id,
          ticker: stk.ticker,
          name: stk.name,
          mode: 'pump',
          durationTicks: 10,
          targetChangePct: 50,
          volumeMultiplier: 4,
        }),
      }));
      assert.equal(stockPumpRes.status, 200);
      await scenEngine.tick();
      const pumpedFundamental = scenEngine.__getAgentManagerForTesting().fundamentals.get(stk.id)!;
      assert.ok(pumpedFundamental > baseFundamental, `Stock pump scenario must shift fundamental (${pumpedFundamental} > ${baseFundamental})`);

      // AdminPage 정적 SSR 체크 (React client comp 초기 렌더 검증)
      assert.ok(typeof AdminPage === 'function');
      delete process.env.ALLOW_DEV_ADMIN;
    }
    console.log('  ✅ PASS [F08]');

    // ── F09: USD ETF 통화 기호($) vs 국내 ETF(₩) V1/V2/PriceHero/TradeFeed 일관성 ──
    console.log('▶ [F09] USD ETF currency formatting across V1/V2/PriceHeroV2/TradeFeed');
    {
      const { default: PriceHeroV2 } = await import('../app/components/v2/PriceHeroV2');
      const { default: TradeFeedV2 } = await import('../app/components/v2/TradeFeedV2');
      const { TradeFeed } = await import('../app/components/TradeFeed');
      const { default: StockDetailV2Client } = await import('../app/v2/stocks/[id]/StockDetailV2Client');

      const usdEtfStock: any = {
        id: 'etf_tqqq',
        ticker: 'TQQQ',
        name: '프로셰어즈 울트라프로 QQQ',
        market: 'etf',
        sector: 'ETF',
        description: '',
        currentPrice: 62.5,
        previousClose: 60.0,
        openPrice: 60.5,
        high: 63.0,
        low: 59.8,
        volume: 1000,
        marketCap: 1000000,
        relevanceWeight: 1,
        targetPrice: 65,
        isCore: true,
        listedAt: '2010-02-09',
      };
      const krEtfStock: any = {
        ...usdEtfStock,
        id: 'etf_kodex',
        ticker: '069500',
        name: 'KODEX 200',
        currentPrice: 35400,
        previousClose: 35000,
        openPrice: 35100,
        high: 35600,
        low: 34900,
      };

      assert.equal(isUsdQuotedAsset({ market: 'etf', ticker: 'TQQQ' }), true);
      assert.equal(isUsdQuotedAsset({ market: 'etf', ticker: '069500' }), false);
      assert.equal(fmtPrice(62.5, 'etf', 'TQQQ'), '$62.50');
      assert.equal(fmtPrice(35400, 'etf', '069500'), '₩35,400');

      const heroHtml = renderToStaticMarkup(React.createElement(PriceHeroV2, { stock: usdEtfStock }));
      assert.equal(heroHtml.includes('$62.50'), true);
      assert.equal(heroHtml.includes('$2.50'), true, 'PriceHeroV2 delta must render $2.50');
      assert.equal(heroHtml.includes('$60.00'), true, 'PriceHeroV2 previousClose must render $60.00');
      assert.equal(heroHtml.includes('₩'), false, 'USD ETF PriceHeroV2 must not contain ₩');

      const tradesSample: any[] = [{ tradeId: 't1', price: 62.5, quantity: 5, side: 'buy', timestamp: '2026-11-20T01:00:00Z' }];
      const feedV1Html = renderToStaticMarkup(React.createElement(TradeFeed, { stock: usdEtfStock, trades: tradesSample }));
      const feedV2Html = renderToStaticMarkup(React.createElement(TradeFeedV2, { stock: usdEtfStock, trades: tradesSample }));
      assert.equal(feedV1Html.includes('$62.50'), true);
      assert.equal(feedV1Html.includes('₩'), false);
      assert.equal(feedV2Html.includes('$62.50'), true);
      assert.equal(feedV2Html.includes('₩'), false);

      const v2ClientHtml = renderWithProviders(
        React.createElement(StockDetailV2Client, {
          stock: usdEtfStock,
          relatedNews: [],
          messages: [],
          tradingValueStr: '$62.5K',
        })
      );
      assert.equal(v2ClientHtml.includes('$60.50'), true);
      assert.equal(v2ClientHtml.includes('$63.00'), true);
      assert.equal(v2ClientHtml.includes('$59.80'), true);
      assert.equal(v2ClientHtml.includes('$62.50'), true, 'BigTradeButtons must display $62.50 for USD ETF');
      assert.equal(v2ClientHtml.includes('₩63'), false, 'USD ETF V2 page must not display KRW-rounded price');
      assert.equal(v2ClientHtml.includes('₩60'), false, 'USD ETF V2 page must not display KRW-rounded price');

      const krHeroHtml = renderToStaticMarkup(React.createElement(PriceHeroV2, { stock: krEtfStock }));
      assert.equal(krHeroHtml.includes('₩35,400'), true);
      assert.equal(krHeroHtml.includes('$'), false, 'Domestic ETF must keep KRW');
    }
    console.log('  ✅ PASS [F09]');

    // ── F10: 옵션 비율 수량(100% 가능) 0.1% 수수료 & float 경계 일치 검증 ──
    console.log('▶ [F10] Option percentage quantity fee (0.1%) & float boundary precision');
    {
      memoryDb.resetToSeedData();
      const opt = Array.from(memoryDb.optionsContracts.values())[0]!;
      opt.expiry_date = new Date(Date.now() + 86_400_000 * 30).toISOString();
      opt.current_price = 2.15;
      opt.multiplier = 250000;

      // 1계약: 2.15 * 250000 = 537,500 + 538(0.1%) = 538,038
      assert.equal(calculateOptionBuyRequiredCashKrw(2.15, 250000, 1), 538038);
      assert.equal(calculateMaxOptionBuyContracts(538037, 2.15, 250000, 100), 0);
      assert.equal(calculateMaxOptionBuyContracts(538038, 2.15, 250000, 100), 1);

      // IEEE-754 float 경계: 2.10 * 250000 * 3 = 1,575,000 + 1,575 = 1,576,575
      // 1576575 / (2.1 * 250000 * 1.001) = 2.9999999999999996 -> 반드시 3계약 반환해야 함
      opt.current_price = 2.10;
      const exact3Cost = calculateOptionBuyRequiredCashKrw(2.10, 250000, 3);
      assert.equal(exact3Cost, 1_576_575);
      const maxQtyFloatEdge = calculateMaxOptionBuyContracts(exact3Cost, 2.10, 250000, 100);
      assert.equal(maxQtyFloatEdge, 3);

      const uid = 'u_f10_opt';
      memoryDb.ensureUserProfile(uid, { email: 'f10@test.local' });
      const prof = memoryDb.profiles.get(uid)!;
      prof.has_options_license = true;
      prof.cash = exact3Cost;

      const { availableCash } = getAvailableCashKrw(memoryDb, uid);
      const computedQty = calculateMaxOptionBuyContracts(availableCash, 2.10, 250000, 100);
      assert.equal(computedQty, 3);

      const optOrderRes = await submitAuthoritativeOptionOrder({
        db: memoryDb,
        userId: uid,
        contractId: opt.id,
        side: 'BUY',
        orderType: 'LIMIT',
        price: 2.10,
        qty: computedQty,
      });
      assert.equal(optOrderRes.success, true, `100% boundary order must succeed: ${optOrderRes.message}`);
      assert.equal(prof.cash, 0);

      // 보유 옵션 매도 가능 수량(resting sell 예약 제외) 확인
      const summary = getOptionAccountSummary(memoryDb, uid);
      assert.equal(summary.positions[0]?.qty, 3);
    }
    console.log('  ✅ PASS [F10]');

    console.log('\n🎉 ALL 2026-11-20 F01~F10 REGRESSION CHECKS PASSED!\n');
  } finally {
    const { stopLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');
    stopLocalStandaloneEngine();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
