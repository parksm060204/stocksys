import { NextResponse } from 'next/server';
import {
  ensureLocalStandaloneReady,
  getLocalStandaloneEngine,
  persistConfirmedState,
} from '@/lib/engine/localStandaloneServer';
import { verifyAdminSession } from '@/lib/auth/adminAuth';
import { resolveAuthenticatedUserId } from '@/lib/auth/sessionAuth';
import {
  allowManualStep,
  parseMarketFlowStepBody,
  parsePointsLimit,
  resolveViewerRumorAccess,
  sanitizeMarketFlowRecentNews,
} from '@/lib/engine/marketFlowHelper';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await ensureLocalStandaloneReady();
    const engine = getLocalStandaloneEngine();

    if (!engine) {
      return NextResponse.json(
        {
          success: false,
          message: 'Market Engine is initializing. Please retry in a moment.',
        },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const pointsLimit = parsePointsLimit(searchParams.get('points'));
    const [auth, authenticatedUserId] = await Promise.all([
      verifyAdminSession(request),
      resolveAuthenticatedUserId(),
    ]);
    const hasRumorAccess = resolveViewerRumorAccess(authenticatedUserId);

    const flowData = engine.getMarketFlowData(pointsLimit);
    const recentNews = sanitizeMarketFlowRecentNews(flowData.recentNews, hasRumorAccess);

    return NextResponse.json(
      {
        success: true,
        data: {
          ...flowData,
          recentNews,
          engineRunning: engine.isEngineRunning(),
          activeAgentsCount: engine.getActiveAgentsCount(),
          ...(auth.isAdmin ? { marketState: engine.getMarketStateSnapshot() } : {}),
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
      }
    );
  } catch (error: any) {
    console.error('[API /api/market-flow] Error:', error);
    return NextResponse.json(
      { success: false, message: error?.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await verifyAdminSession(request);
    if (!auth.isAdmin) {
      return NextResponse.json(
        { success: false, message: auth.error || 'Administrator permission is required.' },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, message: 'Request body must be valid JSON.' }, { status: 400 });
    }
    const parsed = parseMarketFlowStepBody(body);
    if (!parsed.ok) {
      return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
    }
    if (!allowManualStep(auth.adminUser)) {
      return NextResponse.json(
        { success: false, message: 'Manual simulation step rate limit exceeded.' },
        { status: 429 }
      );
    }

    await ensureLocalStandaloneReady();
    const engine = getLocalStandaloneEngine();

    if (!engine) {
      return NextResponse.json(
        { success: false, message: 'Market Engine is not available.' },
        { status: 503 }
      );
    }

    if (parsed.ok) {
      await engine.stepSimulation(parsed.dt, engine.hasOnPersist() ? undefined : persistConfirmedState);
      const flowData = engine.getMarketFlowData(60);
      const recentNews = sanitizeMarketFlowRecentNews(flowData.recentNews, true);

      return NextResponse.json({
        success: true,
        message: `Simulation advanced by ${parsed.dt}s`,
        data: {
          ...flowData,
          recentNews,
          engineRunning: engine.isEngineRunning(),
          activeAgentsCount: engine.getActiveAgentsCount(),
          marketState: engine.getMarketStateSnapshot(),
        },
      });
    }

    return NextResponse.json({ success: false, message: 'Invalid simulation request.' }, { status: 400 });
  } catch (error: any) {
    console.error('[API /api/market-flow POST] Error:', error);
    return NextResponse.json(
      { success: false, message: error?.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
