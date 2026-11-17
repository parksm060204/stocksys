import type { MemoryDatabase } from '@/lib/memoryDb/memoryStore';
import { withAccountLocks } from '@/lib/memoryDb/accountLocks';
import { runWithCommitGate } from '@/lib/memoryDb/PersistenceManager';
import { getAvailableCashKrw } from '@/lib/engine/orderRisk';

export interface ResolvePlayerEventInput {
  db: MemoryDatabase;
  userId: string;
  activeEventId: string;
  choice: unknown;
  onPersist?: () => Promise<boolean>;
}

export interface ResolvePlayerEventResult {
  success: boolean;
  statusCode: number;
  message: string;
  cash?: number;
  acquired_passives?: string[];
  resolved_choice?: 'A' | 'B';
}

export async function resolvePlayerEventChoice(
  input: ResolvePlayerEventInput
): Promise<ResolvePlayerEventResult> {
  const { db, userId, activeEventId, choice, onPersist } = input;

  if (!userId || typeof userId !== 'string') {
    return { success: false, statusCode: 401, message: '로그인이 필요한 서비스입니다.' };
  }
  if (!activeEventId || typeof activeEventId !== 'string') {
    return { success: false, statusCode: 400, message: '유효한 이벤트 식별자(activeEventId)가 필요합니다.' };
  }
  if (choice !== 'A' && choice !== 'B') {
    return { success: false, statusCode: 400, message: '선택지(choice)는 A 또는 B여야 합니다.' };
  }

  return withAccountLocks([userId], async () => {
    return runWithCommitGate(onPersist, async () => {
      const activeEvent = db.activePlayerEvents.find((e: any) => e?.id === activeEventId);
      if (!activeEvent) {
        return { success: false, statusCode: 404, message: '진행 중인 이벤트를 찾을 수 없습니다.' };
      }

      if (activeEvent.user_id !== userId) {
        return { success: false, statusCode: 403, message: '본인의 이벤트만 처리할 수 있습니다.' };
      }

      if (activeEvent.status !== 'pending') {
        return { success: false, statusCode: 409, message: '이미 처리 완료된 이벤트입니다.' };
      }

      const eventDef = db.playerEvents.find((e: any) => e?.id === activeEvent.event_id);
      if (!eventDef) {
        return { success: false, statusCode: 404, message: '이벤트 마스터 데이터를 찾을 수 없습니다.' };
      }

      const profile = db.profiles.get(userId);
      if (!profile) {
        return { success: false, statusCode: 404, message: '사용자 계좌 프로필을 찾을 수 없습니다.' };
      }

      const costRaw = choice === 'A' ? eventDef.choice_a_cost : eventDef.choice_b_cost;
      const cost = Number(costRaw ?? 0);
      if (!Number.isFinite(cost)) {
        return { success: false, statusCode: 500, message: '서버 이벤트 비용 설정이 올바르지 않습니다.' };
      }

      const passiveRaw = choice === 'A' ? eventDef.choice_a_passive : eventDef.choice_b_passive;
      const passive = typeof passiveRaw === 'string' && passiveRaw.trim() ? passiveRaw.trim() : null;

      if (cost > 0) {
        const { availableCash, reservedCash } = getAvailableCashKrw(db, userId);
        if (!Number.isFinite(availableCash) || availableCash < cost) {
          return {
            success: false,
            statusCode: 400,
            message: `가용 예수금이 부족합니다. 필요: ₩${cost.toLocaleString()}, 가용: ₩${Math.floor(availableCash).toLocaleString()} (주문 예약금: ₩${reservedCash.toLocaleString()})`,
          };
        }
      }

      const prevCash = profile.cash;
      const prevPassives = Array.isArray(profile.acquired_passives) ? [...profile.acquired_passives] : undefined;
      const prevStatus = activeEvent.status;
      const prevChoice = activeEvent.resolved_choice;
      const prevResolvedAt = activeEvent.resolved_at;

      try {
        profile.cash = Math.round((profile.cash - cost) * 100) / 100;
        const nextPassives = prevPassives ? [...prevPassives] : [];
        if (passive && !nextPassives.includes(passive)) {
          nextPassives.push(passive);
        }
        profile.acquired_passives = nextPassives;

        activeEvent.status = 'resolved';
        activeEvent.resolved_choice = choice;
        activeEvent.resolved_at = db.getIsoTimestamp();

        if (onPersist) {
          const saved = await onPersist();
          if (!saved) {
            profile.cash = prevCash;
            profile.acquired_passives = prevPassives;
            activeEvent.status = prevStatus;
            activeEvent.resolved_choice = prevChoice;
            activeEvent.resolved_at = prevResolvedAt;
            return {
              success: false,
              statusCode: 500,
              message: '이벤트 처리 결과 영속 저장에 실패하여 롤백했습니다.',
            };
          }
        }

        return {
          success: true,
          statusCode: 200,
          message: '돌발 이벤트 선택이 반영되었습니다.',
          cash: profile.cash,
          acquired_passives: profile.acquired_passives,
          resolved_choice: choice,
        };
      } catch (err: any) {
        profile.cash = prevCash;
        profile.acquired_passives = prevPassives;
        activeEvent.status = prevStatus;
        activeEvent.resolved_choice = prevChoice;
        activeEvent.resolved_at = prevResolvedAt;
        return {
          success: false,
          statusCode: 500,
          message: err?.message || '이벤트 처리 중 오류가 발생하여 롤백했습니다.',
        };
      }
    });
  });
}
