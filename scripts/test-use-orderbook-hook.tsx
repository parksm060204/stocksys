/**
 * scripts/test-use-orderbook-hook.tsx
 *
 * P1: 실제 useOrderbookData 훅의 라이프사이클·폴링·경합 10대 시나리오 검증
 * 모의 훅이나 우회 prop이 아닌, 실제 useOrderbookData 훅을 React Hook Test Harness로 마운트하여 검증합니다.
 */

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:3000',
  pretendToBeVisual: true,
});

Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true, writable: true });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true, writable: true });
Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, configurable: true, writable: true });
Object.defineProperty(globalThis, 'Node', { value: dom.window.Node, configurable: true, writable: true });

import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useOrderbookData, UseOrderbookDataResult } from '../lib/hooks/useOrderbookData';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

function createDeferred<T>() {
  let resolve!: (val: T) => void;
  let reject!: (err: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface HarnessProps {
  stockId: string;
  ticker: string;
  currentPrice: number;
  intervalMs?: number;
  client?: any;
  onUpdate?: (data: UseOrderbookDataResult) => void;
}

function HookHarness({
  stockId,
  ticker,
  currentPrice,
  intervalMs = 1000,
  client,
  onUpdate,
}: HarnessProps) {
  const result = useOrderbookData(stockId, ticker, currentPrice, intervalMs, client);

  useEffect(() => {
    if (onUpdate) {
      onUpdate(result);
    }
  }, [result, onUpdate]);

  return (
    <div data-testid="orderbook-status" data-state={result.connectionState} data-quality={result.dataQuality}>
      <div data-testid="bids-count">{result.bids.length}</div>
      <div data-testid="asks-count">{result.asks.length}</div>
      <div data-testid="price">{result.price}</div>
    </div>
  );
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runHookTests() {
  console.log('================================================================');
  console.log('  🧪 USEORDERBOOKDATA REAL HOOK LIFECYCLE & CONCURRENCY TESTS');
  console.log('================================================================\n');

  function getFreshRoot() {
    const el = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(el);
    const root = createRoot(el);
    return {
      root,
      cleanup: async () => {
        await act(async () => {
          root.unmount();
        });
        el.remove();
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 1: 첫 RPC 성공 (loading -> live, 실제 bids/asks/trades 반영)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [SCENARIO 1] 첫 RPC 성공 (loading -> live, 실제 bids/asks/trades 반영)');
  {
    const { root, cleanup } = getFreshRoot();
    let latestData: UseOrderbookDataResult | null = null;
    const mockRpcData = {
      bids: [{ price: 70000, totalSize: 150 }],
      asks: [{ price: 70100, totalSize: 250 }],
      trades: [
        {
          id: 't_init_1',
          price: 70050,
          size: 10,
          buyer_is_bot: false,
          seller_is_bot: true,
          created_at: new Date().toISOString(),
        },
      ],
      timestamp: Date.now(),
    };

    const mockClient = {
      rpc: async (fn: string) => {
        if (fn === 'get_authoritative_orderbook') {
          return { data: mockRpcData, error: null };
        }
        return { data: null, error: { message: 'not supported' } };
      },
    };

    await act(async () => {
      root.render(
        <HookHarness
          stockId="stock_sc1"
          ticker="005930"
          currentPrice={70000}
          intervalMs={5000}
          client={mockClient}
          onUpdate={(d) => {
            latestData = d;
          }}
        />
      );
      await sleep(50);
    });

    assert(latestData !== null, 'Hook Harness가 데이터를 반환해야 함');
    assert(latestData!.connectionState === 'live', `상태가 live여야 함 (실제: ${latestData!.connectionState})`);
    assert(latestData!.dataQuality === 'authoritative', `품질이 authoritative여야 함 (실제: ${latestData!.dataQuality})`);
    assert(latestData!.bids.length === 1 && latestData!.bids[0].price === 70000, 'bids 데이터 정상 반영');
    assert(latestData!.asks.length === 1 && latestData!.asks[0].price === 70100, 'asks 데이터 정상 반영');
    assert(latestData!.price === 70050, '최신 체결가(70050) 반영 확인');
    await cleanup();
    console.log('  ✓ SCENARIO 1 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 2: 성공 후 일시 실패 (기존 데이터 유지, live -> stale)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [SCENARIO 2] 성공 후 일시 실패 (기존 데이터 유지, live -> stale)');
  {
    const { root, cleanup } = getFreshRoot();
    let latestData: UseOrderbookDataResult | null = null;
    let failRpc = false;

    const mockClient = {
      rpc: async (fn: string) => {
        if (failRpc) {
          return { data: null, error: { message: 'Database temporarily unavailable' } };
        }
        return {
          data: {
            bids: [{ price: 70000, totalSize: 100 }],
            asks: [{ price: 70100, totalSize: 200 }],
            trades: [],
            timestamp: Date.now(),
          },
          error: null,
        };
      },
    };

    await act(async () => {
      root.render(
        <HookHarness
          stockId="stock_sc2"
          ticker="005930"
          currentPrice={70000}
          intervalMs={50}
          client={mockClient}
          onUpdate={(d) => {
            latestData = d;
          }}
        />
      );
      await sleep(30);
    });

    assert(latestData!.connectionState === 'live', '첫 호출 성공 후 live 상태 확인');
    assert(latestData!.bids.length === 1, '첫 데이터 수신 완료');

    // 장애 모드로 전환
    failRpc = true;
    await act(async () => {
      await sleep(120); // 폴링 주기(50ms) 이상 대기
    });

    assert(latestData!.connectionState === 'stale', `장애 발생 시 live -> stale로 전환되어야 함 (실제: ${latestData!.connectionState})`);
    assert(latestData!.bids.length === 1 && latestData!.bids[0].price === 70000, 'stale 상태에서도 기존 호가 데이터가 유지되어야 함');
    assert(latestData!.asks.length === 1 && latestData!.asks[0].price === 70100, 'stale 상태에서도 기존 매도 데이터가 유지되어야 함');
    await cleanup();
    console.log('  ✓ SCENARIO 2 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 3: 최초 요청 실패 (loading -> error)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [SCENARIO 3] 최초 요청 실패 (loading -> error)');
  {
    const { root, cleanup } = getFreshRoot();
    let latestData: UseOrderbookDataResult | null = null;
    const failingClient = {
      rpc: async () => ({ data: null, error: { message: 'Fatal connection error' } }),
    };

    await act(async () => {
      root.render(
        <HookHarness
          stockId="stock_sc3"
          ticker="005930"
          currentPrice={50000}
          intervalMs={5000}
          client={failingClient}
          onUpdate={(d) => {
            latestData = d;
          }}
        />
      );
      await sleep(50);
    });

    assert(latestData!.connectionState === 'error', `최초 요청 실패 시 loading -> error로 전환되어야 함 (실제: ${latestData!.connectionState})`);
    assert(latestData!.bids.length === 0 && latestData!.asks.length === 0, '실패 시 빈 호가 유지');
    await cleanup();
    console.log('  ✓ SCENARIO 3 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 4: 오류 후 다음 폴링 성공 (error -> live 복구)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [SCENARIO 4] 오류 후 다음 폴링 성공 (error -> live 복구)');
  {
    const { root, cleanup } = getFreshRoot();
    let latestData: UseOrderbookDataResult | null = null;
    let recover = false;

    const recoveringClient = {
      rpc: async () => {
        if (!recover) {
          return { data: null, error: { message: 'Initial failure' } };
        }
        return {
          data: {
            bids: [{ price: 55000, totalSize: 77 }],
            asks: [{ price: 55100, totalSize: 88 }],
            trades: [],
            timestamp: Date.now(),
          },
          error: null,
        };
      },
    };

    await act(async () => {
      root.render(
        <HookHarness
          stockId="stock_sc4"
          ticker="005930"
          currentPrice={55000}
          intervalMs={50}
          client={recoveringClient}
          onUpdate={(d) => {
            latestData = d;
          }}
        />
      );
      await sleep(30);
    });

    assert(latestData!.connectionState === 'error', '초기에는 error 상태');

    // 복구 모드로 전환 후 폴링 대기
    recover = true;
    await act(async () => {
      await sleep(120);
    });

    assert(latestData!.connectionState === 'live', `복구 성공 시 error -> live로 전환되어야 함 (실제: ${latestData!.connectionState})`);
    assert(latestData!.bids[0]?.price === 55000, '복구 후 최신 호가 데이터 정상 반영');
    await cleanup();
    console.log('  ✓ SCENARIO 4 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 5: 종목 A 요청 중 B로 전환 (A 응답 폐기, B 데이터만 반영)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [SCENARIO 5] 종목 A 요청 중 B로 전환 (A 응답 폐기, B 데이터만 반영)');
  {
    const { root, cleanup } = getFreshRoot();
    let latestData: UseOrderbookDataResult | null = null;
    const defA = createDeferred<any>();
    const defB = createDeferred<any>();

    const raceClient = {
      rpc: async (_fn: string, params: { p_stock_id: string }) => {
        if (params.p_stock_id === 'stock_A') {
          return defA.promise;
        }
        if (params.p_stock_id === 'stock_B') {
          return defB.promise;
        }
        return { data: null, error: { message: 'unknown stock' } };
      },
    };

    // 1) 종목 A로 렌더링
    await act(async () => {
      root.render(
        <HookHarness
          stockId="stock_A"
          ticker="005930"
          currentPrice={1000}
          intervalMs={5000}
          client={raceClient}
          onUpdate={(d) => {
            latestData = d;
          }}
        />
      );
    });

    // 2) 종목 A 응답이 오기 전에 종목 B로 전환
    await act(async () => {
      root.render(
        <HookHarness
          stockId="stock_B"
          ticker="000660"
          currentPrice={2000}
          intervalMs={5000}
          client={raceClient}
          onUpdate={(d) => {
            latestData = d;
          }}
        />
      );
    });

    // 3) 종목 B의 응답이 먼저 완료됨
    await act(async () => {
      defB.resolve({
        data: {
          bids: [{ price: 2000, totalSize: 222 }],
          asks: [{ price: 2100, totalSize: 333 }],
          trades: [],
          timestamp: Date.now(),
        },
        error: null,
      });
      await sleep(20);
    });

    assert(latestData!.bids[0]?.price === 2000, '종목 B의 호가가 반영되어야 함');

    // 4) 뒤늦게 종목 A의 응답이 도착
    await act(async () => {
      defA.resolve({
        data: {
          bids: [{ price: 1000, totalSize: 99999 }], // 이전 종목 A 데이터
          asks: [{ price: 1100, totalSize: 99999 }],
          trades: [],
          timestamp: Date.now(),
        },
        error: null,
      });
      await sleep(20);
    });

    // 종목 A의 데이터는 폐기되고 종목 B가 여전히 유지되어야 함!
    assert(latestData!.bids[0]?.price === 2000, '뒤늦게 도착한 종목 A의 응답은 generation 가드로 폐기되어야 함 (현재: 종목 B 2000원 유지)');
    assert(latestData!.bids[0]?.totalSize === 222, '종목 A의 수량(99999)이 종목 B(222)를 덮어쓰지 않아야 함');
    await cleanup();
    console.log('  ✓ SCENARIO 5 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 6: 컴포넌트 언마운트 후 pending 응답 완료 (상태 변경 없음, 다음 타이머 없음)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [SCENARIO 6] 컴포넌트 언마운트 후 pending 응답 완료');
  {
    const { root, cleanup } = getFreshRoot();
    const defUnmount = createDeferred<any>();
    let updateAfterUnmount = false;

    const unmountClient = {
      rpc: async () => defUnmount.promise,
    };

    await act(async () => {
      root.render(
        <HookHarness
          stockId="stock_unmount_test"
          ticker="005930"
          currentPrice={10000}
          intervalMs={50}
          client={unmountClient}
          onUpdate={() => {
            updateAfterUnmount = true;
          }}
        />
      );
    });

    updateAfterUnmount = false;

    // 컴포넌트 언마운트
    await cleanup();

    // 언마운트 이후 pending 응답 resolve
    await act(async () => {
      defUnmount.resolve({
        data: {
          bids: [{ price: 10000, totalSize: 50 }],
          asks: [{ price: 10100, totalSize: 50 }],
          trades: [],
          timestamp: Date.now(),
        },
        error: null,
      });
      await sleep(100);
    });

    assert(!updateAfterUnmount, '언마운트된 후에는 pending 응답이 완료되어도 상태 업데이트가 일어나지 않아야 함');
    console.log('  ✓ SCENARIO 6 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 7: 요청이 완료되기 전 다음 요청이 시작되지 않음 (중복 동시 요청 방지)
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [SCENARIO 7] 요청이 완료되기 전 다음 요청이 시작되지 않음 (재귀 완료 기반 폴링)');
  {
    const { root, cleanup } = getFreshRoot();
    let activeInFlightRequests = 0;
    let maxConcurrentRequests = 0;
    let totalRequests = 0;

    const slowClient = {
      rpc: async () => {
        totalRequests++;
        activeInFlightRequests++;
        if (activeInFlightRequests > maxConcurrentRequests) {
          maxConcurrentRequests = activeInFlightRequests;
        }
        await sleep(30); // 30ms 지연
        activeInFlightRequests--;
        return {
          data: {
            bids: [{ price: 50000, totalSize: 10 }],
            asks: [{ price: 50100, totalSize: 10 }],
            trades: [],
            timestamp: Date.now(),
          },
          error: null,
        };
      },
    };

    await act(async () => {
      root.render(
        <HookHarness
          stockId="stock_concurrency_test"
          ticker="005930"
          currentPrice={50000}
          intervalMs={20} // 폴링 간격 20ms
          client={slowClient}
        />
      );
    });

    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await sleep(40);
      });
    }

    assert(maxConcurrentRequests === 1, `동시 진행 요청 수는 정확히 1이어야 함 (실제: ${maxConcurrentRequests})`);
    assert(totalRequests >= 2, `순차적으로 2회 이상 완료되어야 함 (실제: ${totalRequests})`);
    await cleanup();
    console.log('  ✓ SCENARIO 7 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 8: RPC 미설치와 실제 네트워크 오류를 구분
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [SCENARIO 8] RPC 미설치(PGRST202)와 실제 네트워크 오류 구분');
  {
    const { root, cleanup } = getFreshRoot();
    let qualityDetected: string = '';
    let fallbackCalled = false;

    const pgrst202Client = {
      rpc: async () => {
        return {
          data: null,
          error: {
            code: 'PGRST202',
            message: 'Could not find the function get_authoritative_orderbook',
          },
        };
      },
      from: (table: string) => {
        if (table === 'orders' || table === 'trades') {
          fallbackCalled = true;
        }
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          order: () => builder,
          limit: () => Promise.resolve({ data: [], error: null }),
        };
        return builder;
      },
    };

    await act(async () => {
      root.render(
        <HookHarness
          stockId="stock_pgrst202"
          ticker="005930"
          currentPrice={30000}
          intervalMs={5000}
          client={pgrst202Client}
          onUpdate={(d) => {
            qualityDetected = d.dataQuality;
          }}
        />
      );
      await sleep(50);
    });

    assert(fallbackCalled, 'PGRST202 수신 시 레거시 fallback 쿼리가 실행되어야 함');
    assert(qualityDetected === 'legacy-fallback', `PGRST202의 dataQuality는 legacy-fallback이어야 함 (실제: ${qualityDetected})`);
    await cleanup();
    console.log('  ✓ SCENARIO 8 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 9: authoritative와 legacy fallback 품질 상태 구분
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [SCENARIO 9] authoritative와 legacy fallback 품질 상태 구분');
  {
    const { root: rootAuth, cleanup: cleanupAuth } = getFreshRoot();
    let authoritativeQuality = '';

    const authClient = {
      rpc: async () => ({
        data: { bids: [{ price: 100, totalSize: 10 }], asks: [], trades: [], timestamp: Date.now() },
        error: null,
      }),
    };

    await act(async () => {
      rootAuth.render(
        <HookHarness
          stockId="stock_auth_check"
          ticker="005930"
          currentPrice={100}
          intervalMs={5000}
          client={authClient}
          onUpdate={(d) => {
            authoritativeQuality = d.dataQuality;
          }}
        />
      );
      await sleep(50);
    });

    assert(authoritativeQuality === 'authoritative', `정상 RPC는 authoritative 품질이어야 함 (실제: ${authoritativeQuality})`);
    await cleanupAuth();

    const { root: rootFb, cleanup: cleanupFb } = getFreshRoot();
    let legacyQuality = '';

    const fallbackClient = {
      rpc: async () => ({
        data: null,
        error: { code: 'PGRST202', message: 'Function does not exist' },
      }),
      from: () => {
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          order: () => builder,
          limit: () => Promise.resolve({
            data: [{ id: 'o1', stock_id: 's', side: 'buy', price: 100, size: 10, filled: 0, status: 'open' }],
            error: null,
          }),
        };
        return builder;
      },
    };

    await act(async () => {
      rootFb.render(
        <HookHarness
          stockId="stock_fb_check"
          ticker="005930"
          currentPrice={100}
          intervalMs={5000}
          client={fallbackClient}
          onUpdate={(d) => {
            legacyQuality = d.dataQuality;
          }}
        />
      );
      await sleep(50);
    });

    assert(legacyQuality === 'legacy-fallback', `PGRST202 Fallback은 legacy-fallback 품질이어야 함 (실제: ${legacyQuality})`);
    await cleanupFb();
    console.log('  ✓ SCENARIO 9 완료\n');
  }

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 10: 호가 레벨 수 변화가 불필요한 폴링 재시작을 만들지 않음
  // ─────────────────────────────────────────────────────────────────
  console.log('▶ [SCENARIO 10] 호가 레벨 수 변화가 불필요한 폴링 재시작을 만들지 않음');
  {
    const { root, cleanup } = getFreshRoot();
    let rpcCallCount = 0;
    let bookDepth = 1;

    const dynamicDepthClient = {
      rpc: async () => {
        rpcCallCount++;
        const bids = [];
        for (let i = 0; i < bookDepth; i++) {
          bids.push({ price: 70000 - i * 100, totalSize: 100 });
        }
        return {
          data: {
            bids,
            asks: [{ price: 70100, totalSize: 100 }],
            trades: [],
            timestamp: Date.now(),
          },
          error: null,
        };
      },
    };

    await act(async () => {
      root.render(
        <HookHarness
          stockId="stock_depth_stability"
          ticker="005930"
          currentPrice={70000}
          intervalMs={150}
          client={dynamicDepthClient}
        />
      );
      await sleep(50);
    });

    assert(rpcCallCount === 1, '첫 번째 RPC 호출 완료');

    // 호가 레벨을 1개에서 10개로 증가시킴
    bookDepth = 10;
    await act(async () => {
      await sleep(200); // 1회 주기 경과
    });

    // 만약 bids.length에 의존하여 effect가 재시작되었다면 타이머 중첩으로 콜 카운트가 폭발했을 것임
    assert(rpcCallCount === 2, `호가 수 변화 후 정확히 1회 추가 폴링되어 누적 2회여야 함 (실제: ${rpcCallCount})`);
    await cleanup();
    console.log('  ✓ SCENARIO 10 완료\n');
  }

  console.log('================================================================');
  console.log('  🎉 ALL 10 REAL USEORDERBOOKDATA HOOK SCENARIOS PASSED (EXIT CODE 0)');
  console.log('================================================================\n');
}

runHookTests().catch((err) => {
  console.error('\n❌ UNHANDLED TEST ERROR:', err);
  process.exit(1);
});
