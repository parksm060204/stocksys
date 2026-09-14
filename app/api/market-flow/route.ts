import { NextResponse } from 'next/server';
import {
  ensureLocalStandaloneEngine,
  getLocalStandaloneEngine,
} from '@/lib/engine/localStandaloneServer';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    ensureLocalStandaloneEngine();
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
    const pointsParam = searchParams.get('points');
    const pointsLimit = pointsParam ? Math.min(120, Math.max(10, parseInt(pointsParam, 10))) : 60;

    const simTime = engine.agentManager.clock.simulationTime;
    const flowData = engine.agentManager.diagnostics.getMarketFlowData(simTime, pointsLimit);

    return NextResponse.json(
      {
        success: true,
        data: {
          ...flowData,
          engineRunning: true,
          activeAgentsCount: engine.agentManager.agents.size,
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
    ensureLocalStandaloneEngine();
    const engine = getLocalStandaloneEngine();

    if (!engine) {
      return NextResponse.json(
        { success: false, message: 'Market Engine is not available.' },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const action = body?.action || 'step';
    const dt = typeof body?.dt === 'number' ? Math.max(0.1, Math.min(10.0, body.dt)) : 1.0;

    if (action === 'step') {
      await engine.stepSimulation(dt);
      const simTime = engine.agentManager.clock.simulationTime;
      const flowData = engine.agentManager.diagnostics.getMarketFlowData(simTime, 60);

      return NextResponse.json({
        success: true,
        message: `Simulation advanced by ${dt}s`,
        data: flowData,
      });
    }

    return NextResponse.json(
      { success: false, message: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('[API /api/market-flow POST] Error:', error);
    return NextResponse.json(
      { success: false, message: error?.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
