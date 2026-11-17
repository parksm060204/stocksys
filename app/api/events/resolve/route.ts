import { NextResponse } from 'next/server';
import { resolveAuthenticatedUserId } from '@/lib/auth/sessionAuth';
import { ensureLocalStandaloneReady, persistConfirmedState } from '@/lib/engine/localStandaloneServer';
import { memoryDb } from '@/lib/memoryDb/memoryStore';
import { resolvePlayerEventChoice } from '@/lib/events/playerEventService';

export async function POST(req: Request) {
  try {
    await ensureLocalStandaloneReady();

    const authenticatedUserId = await resolveAuthenticatedUserId();
    if (!authenticatedUserId) {
      return NextResponse.json(
        { success: false, message: '로그인이 필요한 서비스입니다.' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: '올바른 요청 형식이 아닙니다.' },
        { status: 400 }
      );
    }

    const { activeEventId, choice } = body as { activeEventId?: unknown; choice?: unknown };

    const result = await resolvePlayerEventChoice({
      db: memoryDb,
      userId: authenticatedUserId,
      activeEventId: typeof activeEventId === 'string' ? activeEventId : '',
      choice,
      onPersist: persistConfirmedState,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: result.statusCode }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      cash: result.cash,
      acquired_passives: result.acquired_passives,
      resolved_choice: result.resolved_choice,
    });
  } catch (err: any) {
    console.error('[POST /api/events/resolve Error]', err);
    return NextResponse.json(
      { success: false, message: err?.message || '돌발 이벤트 처리 중 서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
