/**
 * Order Source Metadata + Participant Verification
 *
 * 전략 기관 주문의 실제 엔진 통합을 위한 단일 표준:
 *  1. 봇 주문 메타데이터(`_botId` / `bot_id` / `participant_id`)를 하나의
 *     `OrderSourceMetadata`로 정규화한다.
 *  2. 주문 객체에 적힌 participantKind를 신뢰하지 않는다.
 *     `participantId` 기준으로 검증된 ParticipantRepository에서 실제 값을 조회한다.
 *  3. 검증 실패 시 일반 주문으로 조용히 낮추지 않고 거부(reason code 반환)한다.
 */

import type { OrderRiskContext } from '../risk/legacyOrderSafety';
import type { RepositoryBundle } from '../../../lib/repositories/repositoryBundle';
import type { ParticipantKind } from '../../../lib/engine/simulation/participants/participantTypes';

export interface OrderSourceMetadata {
  readonly participantId: string;
  readonly participantKind: ParticipantKind;
  readonly strategyId: string;
}

export interface VerifiedParticipantProfile {
  readonly participantId: string;
  readonly participantKind: ParticipantKind;
  readonly domicile: string;
  readonly availableCash: number;
  readonly accountEquity: number;
  readonly currentPosition: number;
  readonly positionLimit: number;
  readonly riskBudget: number;
  readonly canPlaceStrategicOrder: boolean;
  readonly isVerified: boolean;
}

/** 봇 설정의 기관 종류 문자열을 정규 ParticipantKind로 매핑. */
export function mapInstitutionalKindToParticipantKind(raw: string | undefined | null): ParticipantKind {
  if (!raw) return 'UNKNOWN';
  const value = String(raw).toUpperCase();
  if (value === 'DOMESTIC_INSTITUTION') return 'DOMESTIC_INSTITUTION';
  if (value === 'FOREIGN_INSTITUTION') return 'FOREIGN_INSTITUTION';
  if (value === 'LIQUIDITY_PROVIDER') return 'LIQUIDITY_PROVIDER';
  if (value === 'RETAIL') return 'RETAIL';
  if (value === 'HUMAN') return 'HUMAN';
  return 'UNKNOWN';
}

/** 봇 주문에서 원시 참가자 식별자를 추출한다 (`_botId` > `bot_id` > `participant_id`). */
export function extractParticipantId(order: Record<string, unknown>): string | null {
  const candidates = [order._botId, order.bot_id, order.participant_id, order.participantId];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return null;
}

export function extractStrategyId(order: Record<string, unknown>): string {
  const candidates = [order._strategyId, order.strategy_id, order.agentId];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return 'UNKNOWN_STRATEGY';
}

const DOMICILES: Record<ParticipantKind, string> = {
  DOMESTIC_INSTITUTION: 'KR',
  FOREIGN_INSTITUTION: 'US',
  LIQUIDITY_PROVIDER: 'KR',
  RETAIL: 'KR',
  HUMAN: 'KR',
  UNKNOWN: 'XX',
};

/** 기관별 기본 한도/예산 정책 (결정론적 상수). */
export const INSTITUTION_RISK_POLICY = {
  DOMESTIC_INSTITUTION: { positionLimit: 1_000_000, riskBudget: 5_000_000_000 },
  FOREIGN_INSTITUTION: { positionLimit: 800_000, riskBudget: 4_000_000_000 },
} as const;

/**
 * participantId를 기준으로 검증된 참가자 프로필을 조회한다.
 * 반환값이 null이면 participantId는 검증되지 않은 참가자이다.
 */
export async function verifyParticipantProfile(
  repositories: RepositoryBundle,
  participantId: string,
  stockId: string
): Promise<VerifiedParticipantProfile | null> {
  const bots = await repositories.participant.getBotConfigs();
  const bot = (bots || []).find((b: Record<string, unknown>) => {
    const id = b.bot_id ?? b.id ?? b.agentId;
    return id === participantId;
  });

  const profile = await repositories.participant.getProfile(participantId);

  if (!bot && !profile) return null;

  let participantKind: ParticipantKind = 'UNKNOWN';
  if (bot) {
    participantKind = mapInstitutionalKindToParticipantKind(
      (bot.participant_kind ?? bot.participantKind ?? bot.type ?? bot.strategy_type) as string | undefined
    );
  } else if (profile) {
    participantKind = 'HUMAN';
  }

  if (participantKind === 'UNKNOWN') return null;

  const isInstitution =
    participantKind === 'DOMESTIC_INSTITUTION' || participantKind === 'FOREIGN_INSTITUTION';
  const policy = isInstitution
    ? INSTITUTION_RISK_POLICY[
        participantKind === 'DOMESTIC_INSTITUTION' ? 'DOMESTIC_INSTITUTION' : 'FOREIGN_INSTITUTION'
      ]
    : undefined;

  // 참가자 현금과 포지션은 초기 botsConfig의 고정값이 아니라 authoritative 현재 상태를 조회해야 한다.
  const availableCash = profile
    ? Number(profile.cash ?? 0)
    : Number((bot?.current_cash ?? 0) as number);
  const accountEquity = profile
    ? Number(profile.net_worth ?? profile.cash ?? 0)
    : Number((bot?.account_equity ?? bot?.total_capital ?? bot?.current_cash ?? 0) as number);

  const holding = await repositories.participant.getHolding(participantId, stockId);
  const currentPosition = holding ? Number(holding.quantity || 0) : 0;

  return {
    participantId,
    participantKind,
    domicile: DOMICILES[participantKind] ?? 'XX',
    availableCash: Number.isFinite(availableCash) ? availableCash : 0,
    accountEquity: Number.isFinite(accountEquity) ? accountEquity : 0,
    currentPosition: Number.isFinite(currentPosition) ? currentPosition : 0,
    positionLimit: policy ? policy.positionLimit : 0,
    riskBudget: policy ? policy.riskBudget : 0,
    canPlaceStrategicOrder: isInstitution,
    isVerified: true,
  };
}

export type StrategicOrderRejection =
  | 'REJECTED_UNKNOWN_PARTICIPANT'
  | 'REJECTED_STRATEGIC_NON_INSTITUTION'
  | 'REJECTED_ZERO_OR_UNKNOWN_ADV'
  | 'REJECTED_ZERO_CASH_BUY'
  | 'REJECTED_INVALID_RISK_BUDGET'
  | 'REJECTED_INVALID_POSITION_LIMIT';

export interface StrategicOrderAssessment {
  readonly accepted: boolean;
  readonly rejection?: StrategicOrderRejection;
  readonly profile?: VerifiedParticipantProfile;
  readonly context?: OrderRiskContext;
}

/**
 * 전략 주문의 필수 조건을 검증하고 risk context를 생성한다.
 * 어떤 조건이든 충족되지 않으면 조용히 낮추지 않고 거부한다.
 */
export function assessStrategicOrder(params: {
  profile: VerifiedParticipantProfile | null;
  side: 'buy' | 'sell';
  adv: number;
  isEmergencyLiquidation?: boolean;
  requestedOrderType: 'STRATEGIC_ORDER' | 'CHILD_ORDER' | 'LP_QUOTE';
}): StrategicOrderAssessment {
  const { profile, side, adv, isEmergencyLiquidation = false, requestedOrderType } = params;

  if (!profile || !profile.isVerified) {
    return { accepted: false, rejection: 'REJECTED_UNKNOWN_PARTICIPANT' };
  }

  if (!Number.isFinite(adv) || adv <= 0) {
    return { accepted: false, rejection: 'REJECTED_ZERO_OR_UNKNOWN_ADV', profile };
  }

  if (side === 'buy' && !(profile.availableCash > 0)) {
    return { accepted: false, rejection: 'REJECTED_ZERO_CASH_BUY', profile };
  }

  if (requestedOrderType === 'STRATEGIC_ORDER') {
    if (isEmergencyLiquidation) {
      return {
        accepted: true,
        profile,
        context: {
          participantKind: profile.participantKind,
          participantIdentity: profile.participantId,
          availableCash: profile.availableCash,
          accountEquity: profile.accountEquity,
          adv,
          orderType: 'STRATEGIC_ORDER',
          isEmergencyLiquidation: true,
        },
      };
    }

    const isInstitution =
      profile.participantKind === 'DOMESTIC_INSTITUTION' ||
      profile.participantKind === 'FOREIGN_INSTITUTION';

    if (!isInstitution) {
      return { accepted: false, rejection: 'REJECTED_STRATEGIC_NON_INSTITUTION', profile };
    }
    if (!(profile.riskBudget > 0)) {
      return { accepted: false, rejection: 'REJECTED_INVALID_RISK_BUDGET', profile };
    }
    if (!(profile.positionLimit > 0)) {
      return { accepted: false, rejection: 'REJECTED_INVALID_POSITION_LIMIT', profile };
    }

    return {
      accepted: true,
      profile,
      context: {
        participantKind: profile.participantKind,
        participantIdentity: profile.participantId,
        availableCash: profile.availableCash,
        accountEquity: profile.accountEquity,
        adv,
        currentPosition: profile.currentPosition,
        positionLimit: profile.positionLimit,
        riskBudget: profile.riskBudget,
        orderType: 'STRATEGIC_ORDER',
      },
    };
  }

  // CHILD_ORDER or LP_QUOTE
  return {
    accepted: true,
    profile,
    context: {
      participantKind: profile.participantKind,
      participantIdentity: profile.participantId,
      availableCash: profile.availableCash,
      accountEquity: profile.accountEquity,
      adv,
      orderType: requestedOrderType,
    },
  };
}
