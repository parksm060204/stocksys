import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MarketEvent } from '../lib/engine/simulation/marketEventTypes';

const ISOLATED_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-sec-fixes-'));
process.env.STOCKSYS_DATA_DIR = ISOLATED_DATA_DIR;
delete process.env.ALLOW_DEV_ADMIN;

async function main(): Promise<void> {
  const {
    canReadRumor,
    authorizeNewsRecord,
    MASKED_RUMOR_MESSAGE,
  } = await import('../lib/news/accessPolicy');
  const { POST: localDbPOST } = await import('../app/api/local-db/route');
  const { GET: marketFlowGET } = await import('../app/api/market-flow/route');
  const {
    ensureLocalStandaloneReady,
    getLocalStandaloneEngine,
    stopLocalStandaloneEngine,
  } = await import('../lib/engine/localStandaloneServer');
  const { persistenceManager } = await import('../lib/memoryDb/PersistenceManager');
  const { memoryDb, GUEST_USER_ID } = await import('../lib/memoryDb/memoryStore');

  await ensureLocalStandaloneReady();
  const engine = getLocalStandaloneEngine()!;
  assert.ok(engine, 'Local standalone engine must be initialized');
  engine.stop();
  persistenceManager.stopAutoSave();

  try {
    console.log('================================================================');
    console.log('🔐 RR-01 & RR-02 Security Regression Verification');
    console.log('================================================================');

    // ── 1. Pure accessPolicy module unit checks ──
    console.log('\n▶ [1] Pure module lib/news/accessPolicy.ts');
    {
      const now = 1_773_500_000_000;
      const pastIso = new Date(now - 60_000).toISOString();
      const exactIso = new Date(now).toISOString();
      const futureIso = new Date(now + 60_000).toISOString();

      assert.equal(canReadRumor(null, now), false);
      assert.equal(canReadRumor(undefined, now), false);
      assert.equal(canReadRumor({ is_admin: false, news_subscriptions: {} }, now), false);
      assert.equal(
        canReadRumor({ is_admin: false, news_subscriptions: { '4': pastIso } }, now),
        false
      );
      assert.equal(
        canReadRumor({ is_admin: false, news_subscriptions: { '4': exactIso } }, now),
        false
      );
      assert.equal(
        canReadRumor(
          { is_admin: false, news_subscriptions: { '1': pastIso, '4': futureIso } },
          now
        ),
        true
      );
      assert.equal(canReadRumor({ is_admin: true, news_subscriptions: {} }, now), true);

      // Non-mutation guarantee
      const profileSnapshot = {
        is_admin: false,
        news_subscriptions: { expired: pastIso, active: futureIso },
      };
      canReadRumor(profileSnapshot, now);
      assert.deepEqual(profileSnapshot.news_subscriptions, {
        expired: pastIso,
        active: futureIso,
      });

      assert.equal(authorizeNewsRecord(null, false), null);

      const rawRumor = {
        id: 'pure_rumor_1',
        category: 'RUMOR',
        title: 'Pure Rumor Title',
        content: 'RAW_RUMOR_CONTENT',
        summary: 'RAW_RUMOR_SUMMARY',
        body: 'RAW_RUMOR_BODY',
        is_fake: true,
        isRumorFake: true,
        correctedAt: 12345,
      };
      const lockedView = authorizeNewsRecord(rawRumor, false);
      assert.equal(lockedView.locked, true);
      assert.equal(lockedView.content, MASKED_RUMOR_MESSAGE);
      assert.equal(lockedView.summary, MASKED_RUMOR_MESSAGE);
      assert.equal(lockedView.body, MASKED_RUMOR_MESSAGE);
      assert.equal('is_fake' in lockedView, false);
      assert.equal('isRumorFake' in lockedView, false);
      assert.equal('correctedAt' in lockedView, false);
      // Original object untouched
      assert.equal(rawRumor.content, 'RAW_RUMOR_CONTENT');
      assert.equal(rawRumor.is_fake, true);

      const unlockedView = authorizeNewsRecord(rawRumor, true);
      assert.equal(unlockedView.locked, false);
      assert.equal(unlockedView.content, 'RAW_RUMOR_CONTENT');
      assert.equal(unlockedView.summary, 'RAW_RUMOR_SUMMARY');
      assert.equal(unlockedView.body, 'RAW_RUMOR_BODY');
      assert.equal('is_fake' in unlockedView, false);
      assert.equal('isRumorFake' in unlockedView, false);
      assert.equal('correctedAt' in unlockedView, false);
    }
    console.log('  ✅ PASS [1] accessPolicy pure checks');

    // ── 2. RR-01: /api/local-db news oracle & entitlement matrix ──
    console.log('\n▶ [2] RR-01 /api/local-db news_tables oracle & 5-role access checks');
    const setupNewsFixtures = () => {
      memoryDb.marketNews = [
        {
          id: 'news_oracle_probe_1',
          type: 'STOCK',
          category: 'RUMOR',
          publisher: '가십 썬',
          title: '[찌라시] 비밀 인수설',
          content: 'SECRET_ALPHA_RUMOR_CONTENT',
          summary: 'SECRET_SUMMARY_TEXT',
          body: 'SECRET_BODY_TEXT',
          target_sector: 'semiconductor',
          target_ticker: '0010',
          impact_score: 4.0,
          is_fake: true,
          isRumorFake: true,
          correctedAt: 999999,
          created_at: '2026-11-20T01:00:00.000Z',
          simulation_time: 1_773_500_001_000,
          sequence: 1,
        } as any,
        {
          id: 'news_oracle_probe_2',
          type: 'SECTOR',
          category: 'RUMOR',
          publisher: '루머 데스크',
          title: '[찌라시] 루머 B',
          content: 'ZZZ_RUMOR_CONTENT',
          summary: 'ZZZ_SUMMARY',
          body: 'ZZZ_BODY',
          target_sector: 'auto',
          target_ticker: null,
          impact_score: -2.0,
          is_fake: false,
          created_at: '2026-11-20T02:00:00.000Z',
          simulation_time: 1_773_500_002_000,
          sequence: 2,
        } as any,
        {
          id: 'news_public_official',
          type: 'STOCK',
          category: 'OFFICIAL',
          publisher: '공식 공시',
          title: '공식 실적 발표',
          content: 'PUBLIC_OFFICIAL_CONTENT',
          target_sector: 'semiconductor',
          target_ticker: '0010',
          impact_score: 3.5,
          is_fake: false,
          created_at: '2026-11-20T03:00:00.000Z',
          simulation_time: 1_773_500_003_000,
          sequence: 3,
        } as any,
      ];
    };

    const callLocalDb = async (tableName: string, query: any) => {
      const res = await localDbPOST(
        new Request('http://localhost/api/local-db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'execute', tableName, query }),
        })
      );
      const json = await res.json();
      return { status: res.status, json };
    };

    type RoleConfig = {
      name: string;
      expectRumorAccess: boolean;
      apply: () => void;
    };

    const roles: RoleConfig[] = [
      {
        name: 'unauthenticated',
        expectRumorAccess: false,
        apply: () => {
          process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'true';
        },
      },
      {
        name: 'unsubscribed_user',
        expectRumorAccess: false,
        apply: () => {
          process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'false';
          const base = memoryDb.ensureUserProfile(GUEST_USER_ID);
          base.is_admin = false;
          base.news_subscriptions = {};
          memoryDb.rebuildIndexes();
        },
      },
      {
        name: 'expired_subscription_via_user_id_index',
        expectRumorAccess: false,
        apply: () => {
          process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'false';
          // Put profile under separate primary id to verify profileUserIdIndex resolution
          memoryDb.profiles.delete(GUEST_USER_ID);
          memoryDb.profiles.set('prof_sec_alias', {
            id: 'prof_sec_alias',
            user_id: GUEST_USER_ID,
            username: 'alias_sec',
            nickname: 'AliasSec',
            cash: 1_000_000,
            net_worth: 1_000_000,
            rank_tier: 'Silver',
            is_admin: false,
            news_subscriptions: {
              '4': new Date(Date.now() - 120_000).toISOString(),
            },
            created_at: memoryDb.getIsoTimestamp(),
          });
          memoryDb.rebuildIndexes();
        },
      },
      {
        name: 'active_subscription_via_user_id_index',
        expectRumorAccess: true,
        apply: () => {
          process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'false';
          memoryDb.profiles.delete(GUEST_USER_ID);
          memoryDb.profiles.set('prof_sec_alias', {
            id: 'prof_sec_alias',
            user_id: GUEST_USER_ID,
            username: 'alias_sec',
            nickname: 'AliasSec',
            cash: 1_000_000,
            net_worth: 1_000_000,
            rank_tier: 'Silver',
            is_admin: false,
            news_subscriptions: {
              '4': new Date(Date.now() + 86_400_000).toISOString(),
            },
            created_at: memoryDb.getIsoTimestamp(),
          });
          memoryDb.rebuildIndexes();
        },
      },
      {
        name: 'admin_user',
        expectRumorAccess: true,
        apply: () => {
          process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'false';
          memoryDb.profiles.delete('prof_sec_alias');
          const base = memoryDb.ensureUserProfile(GUEST_USER_ID);
          base.is_admin = true;
          base.news_subscriptions = {};
          memoryDb.rebuildIndexes();
        },
      },
    ];

    setupNewsFixtures();

    for (const role of roles) {
      role.apply();

      for (const tableName of ['market_news', 'news', 'news_v2']) {
        // A. Internal truth flags ALWAYS blocked (403) even for admin/subscriber
        for (const forbiddenQuery of [
          { action: 'select', filters: [{ col: 'is_fake', op: 'eq', val: true }] },
          { action: 'select', filters: [{ col: 'is_fake', op: 'eq', val: false }] },
          { action: 'select', filters: [{ col: 'is_fake', op: 'in', val: [true] }] },
          { action: 'select', filters: [{ col: 'isRumorFake', op: 'eq', val: true }] },
          { action: 'select', filters: [{ col: 'correctedAt', op: 'gt', val: 0 }] },
          { action: 'select', orderCol: 'is_fake', orderAsc: true, limitCount: 1 },
          { action: 'select', orderSpecs: [{ col: 'isRumorFake', ascending: false }], limitCount: 1 },
        ]) {
          const { status, json } = await callLocalDb(tableName, forbiddenQuery);
          assert.equal(
            status,
            403,
            `[${role.name}][${tableName}] internal truth query must return 403, got ${status}`
          );
          assert.equal(json.data, null);
        }

        // B. Masked body fields (content/summary/body) range/eq/in/order+limit blocked for !hasRumorAccess
        const bodyOracleQueries = [
          {
            action: 'select',
            filters: [
              { col: 'content', op: 'gt', val: 'SECRET_ALPHA_' },
              { col: 'content', op: 'lt', val: 'SECRET_ALPHA_Z' },
            ],
            limitCount: 1,
          },
          {
            action: 'select',
            filters: [{ col: 'content', op: 'in', val: ['SECRET_ALPHA_RUMOR_CONTENT'] }],
            limitCount: 1,
          },
          {
            action: 'select',
            filters: [{ col: 'summary', op: 'gte', val: 'SECRET_S' }],
            orderCol: 'summary',
            orderAsc: true,
            limitCount: 1,
          },
          {
            action: 'select',
            filters: [{ col: 'body', op: 'lt', val: 'SECRET_Z' }],
            orderSpecs: [{ col: 'body', ascending: false }],
            limitCount: 1,
          },
          {
            action: 'select',
            filters: [{ col: 'category', op: 'eq', val: 'RUMOR' }],
            orderCol: 'content',
            orderAsc: true,
            limitCount: 1,
          },
        ];

        for (const bodyQuery of bodyOracleQueries) {
          const { status, json } = await callLocalDb(tableName, bodyQuery);
          if (!role.expectRumorAccess) {
            assert.equal(
              status,
              403,
              `[${role.name}][${tableName}] body filter/order oracle must return 403, got ${status}`
            );
            assert.equal(json.data, null);
          } else {
            assert.equal(
              status,
              200,
              `[${role.name}][${tableName}] authorized user can query content/summary/body`
            );
          }
        }

        // C. Normal public list (chronological desc + limit + explicit projection attempt) works for ALL roles
        const listRes = await callLocalDb(tableName, {
          action: 'select',
          fields: 'id,is_fake,content,summary,body',
          filters: [],
          orderCol: 'created_at',
          orderAsc: false,
          limitCount: 10,
        });
        assert.equal(listRes.status, 200, `[${role.name}][${tableName}] normal list must return 200`);
        const rows = listRes.json.data as any[];
        assert.equal(rows.length, 3);
        assert.deepEqual(
          rows.map((r) => r.id),
          ['news_public_official', 'news_oracle_probe_2', 'news_oracle_probe_1'],
          `[${role.name}][${tableName}] chronological descending order preserved`
        );

        for (const r of rows) {
          assert.equal('is_fake' in r, false, 'is_fake must never be returned');
          assert.equal('isRumorFake' in r, false, 'isRumorFake must never be returned');
          assert.equal('correctedAt' in r, false, 'correctedAt must never be returned');
        }

        const official = rows.find((r) => r.id === 'news_public_official');
        assert.equal(official.locked, false);
        assert.equal(official.content, 'PUBLIC_OFFICIAL_CONTENT');

        const rumor1 = rows.find((r) => r.id === 'news_oracle_probe_1');
        if (role.expectRumorAccess) {
          assert.equal(rumor1.locked, false);
          assert.equal(rumor1.content, 'SECRET_ALPHA_RUMOR_CONTENT');
          assert.equal(rumor1.summary, 'SECRET_SUMMARY_TEXT');
          assert.equal(rumor1.body, 'SECRET_BODY_TEXT');
        } else {
          assert.equal(rumor1.locked, true);
          assert.equal(rumor1.content, MASKED_RUMOR_MESSAGE);
          assert.equal(rumor1.summary, MASKED_RUMOR_MESSAGE);
          assert.equal(rumor1.body, MASKED_RUMOR_MESSAGE);
        }

        // D. Public title + sector filtering works for ALL roles
        const sectorRes = await callLocalDb(tableName, {
          action: 'select',
          filters: [
            { col: 'target_sector', op: 'eq', val: 'semiconductor' },
            { col: 'title', op: 'eq', val: '공식 실적 발표' },
          ],
          orderCol: 'created_at',
          orderAsc: false,
          limitCount: 5,
        });
        assert.equal(sectorRes.status, 200);
        assert.equal(sectorRes.json.data.length, 1);
        assert.equal(sectorRes.json.data[0].id, 'news_public_official');
      }

      // Confirm expired_subscription_via_user_id_index did NOT mutate profile
      if (role.name === 'expired_subscription_via_user_id_index') {
        const stored = memoryDb.profiles.get('prof_sec_alias');
        assert.ok(stored && '4' in (stored.news_subscriptions || {}), 'read path must not mutate profile');
      }
    }
    console.log('  ✅ PASS [2] RR-01 /api/local-db 5-role & oracle checks');

    // ── 3. RR-02: /api/market-flow recentNews RUMOR gating via AgentManager.publishEvent ──
    console.log('\n▶ [3] RR-02 /api/market-flow recentNews via AgentManager.publishEvent');
    {
      memoryDb.marketNews = [];
      const simNow = engine.getSimulationTime();
      const stockId = Array.from(memoryDb.stocks.values())[0]!.id;

      const rumorEvent: MarketEvent = {
        eventId: 'evt_rumor_leak_probe',
        publishedAt: simNow,
        effectiveFrom: simNow,
        scope: 'stock',
        targetStockIds: [stockId],
        eventType: 'RUMOR',
        valuationSignal: 0.4,
        attentionShock: 0.85,
        uncertaintyShock: 0.7,
        confidence: 0.5,
        halfLife: 30,
        publisher: '가십 썬',
        title: '[찌라시] 테스트 루머 제목',
        content: 'UNMASKED_PAID_RUMOR_SECRET',
        isRumorFake: true,
      };
      const officialEvent: MarketEvent = {
        eventId: 'evt_official_public_probe',
        publishedAt: simNow,
        effectiveFrom: simNow,
        scope: 'stock',
        targetStockIds: [stockId],
        eventType: 'OFFICIAL',
        valuationSignal: 0.25,
        attentionShock: 0.6,
        uncertaintyShock: 0.1,
        confidence: 0.9,
        halfLife: 45,
        publisher: '공식 공시',
        title: '공식 공시 제목',
        content: 'PUBLIC_OFFICIAL_FLOW_CONTENT',
      };

      const pubRumorOk = await engine.publishEvent(rumorEvent);
      const pubOfficialOk = await engine.publishEvent(officialEvent);
      assert.equal(pubRumorOk, true, 'AgentManager.publishEvent RUMOR must succeed');
      assert.equal(pubOfficialOk, true, 'AgentManager.publishEvent OFFICIAL must succeed');

      // Advance simulation 1 step so diagnostics also has fresh market stats/timeSeries
      await engine.stepSimulation(1.0);

      for (const role of roles) {
        role.apply();
        const res = await marketFlowGET(new Request('http://localhost/api/market-flow?points=10'));
        assert.equal(res.status, 200, `[${role.name}] GET /api/market-flow must return 200`);
        const body = await res.json();
        assert.equal(body.success, true);

        // Public market stats & charts preserved
        assert.ok(Array.isArray(body.data.leaderBoard) && body.data.leaderBoard.length > 0);
        assert.ok(Array.isArray(body.data.sectorSummary) && body.data.sectorSummary.length > 0);
        assert.ok(Array.isArray(body.data.timeSeries) && body.data.timeSeries.length > 0);

        const recentNews = body.data.recentNews as any[];
        const rumorItem = recentNews.find((n) => n.id === 'evt_rumor_leak_probe');
        const officialItem = recentNews.find((n) => n.id === 'evt_official_public_probe');

        assert.ok(rumorItem, `[${role.name}] recentNews must contain published RUMOR`);
        assert.ok(officialItem, `[${role.name}] recentNews must contain published OFFICIAL`);

        assert.equal(rumorItem.category, 'RUMOR');
        assert.equal('is_fake' in rumorItem, false);
        assert.equal('isRumorFake' in rumorItem, false);
        assert.equal('correctedAt' in rumorItem, false);

        assert.equal(officialItem.locked, false);
        assert.equal(officialItem.content, 'PUBLIC_OFFICIAL_FLOW_CONTENT');

        if (role.expectRumorAccess) {
          assert.equal(rumorItem.locked, false);
          assert.equal(rumorItem.content, 'UNMASKED_PAID_RUMOR_SECRET');
        } else {
          assert.equal(rumorItem.locked, true);
          assert.equal(rumorItem.content, MASKED_RUMOR_MESSAGE);
          assert.equal(
            JSON.stringify(body.data).includes('UNMASKED_PAID_RUMOR_SECRET'),
            false,
            `[${role.name}] raw rumor secret must not appear anywhere in /api/market-flow response`
          );
        }
      }
    }
    console.log('  ✅ PASS [3] RR-02 /api/market-flow 5-role & diagnostics RUMOR checks');

    console.log('\n🎉 ALL RR-01 & RR-02 SECURITY REGRESSION CHECKS PASSED');
  } finally {
    delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    delete process.env.ALLOW_DEV_ADMIN;
    stopLocalStandaloneEngine();
    persistenceManager.stopAutoSave();
    fs.rmSync(ISOLATED_DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('❌ Security regression failed:', err);
  process.exit(1);
});
