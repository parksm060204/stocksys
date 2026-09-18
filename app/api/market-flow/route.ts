import { NextResponse } from 'next/server';
import {
  ensureLocalStandaloneEngine,
  getLocalStandaloneEngine,
} from '@/lib/engine/localStandaloneServer';
import { verifyAdminSession } from '@/lib/auth/adminAuth';

export const dynamic = 'force-dynamic';

const manualStepRateLimit = new Map<string, { count: number; resetAt: number }>();

function allowManualStep(adminUser: string): boolean {
  const now = Date.now();
  const current = manualStepRateLimit.get(adminUser);
  if (!current || now >= current.resetAt) {
    manualStepRateLimit.set(adminUser, { count: 1, resetAt: now + 1000 });
    return true;
  }
  if (current.count >= 15) return false;
  current.count += 1;
  return true;
}

export function parseMarketFlowStepBody(body: unknown): { ok: true; dt: number } | { ok: false; message: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Request body must be a JSON object.' };
  }
  const input = body as { action?: unknown; dt?: unknown };
  if (input.action !== 'step') {
    return { ok: false, message: 'action must be "step".' };
  }
  if (typeof input.dt !== 'number' || !Number.isFinite(input.dt) || input.dt < 0.1 || input.dt > 10) {
    return { ok: false, message: 'dt must be a finite number between 0.1 and 10 seconds.' };
  }
  return { ok: true, dt: input.dt };
}

function parsePointsLimit(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return 60;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return 60;
  return Math.min(120, Math.max(10, parsed));
}

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
    const pointsLimit = parsePointsLimit(searchParams.get('points'));

    const flowData = engine.getMarketFlowData(pointsLimit);

    return NextResponse.json(
      {
        success: true,
        data: {
          ...flowData,
          engineRunning: engine.isEngineRunning(),
          activeAgentsCount: engine.getActiveAgentsCount(),
          marketState: engine.getMarketStateSnapshot(),
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

    ensureLocalStandaloneEngine();
    const engine = getLocalStandaloneEngine();

    if (!engine) {
      return NextResponse.json(
        { success: false, message: 'Market Engine is not available.' },
        { status: 503 }
      );
    }

    if (parsed.ok) {
      await engine.stepSimulation(parsed.dt);
      const flowData = engine.getMarketFlowData(60);

      return NextResponse.json({
        success: true,
        message: `Simulation advanced by ${parsed.dt}s`,
        data: {
          ...flowData,
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
