'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from "@/lib/db/client";
import { useAuth } from "@/lib/auth/useAuth";

interface PlayerEvent {
  id: string;
  stage: number;
  title: string;
  description: string;
  choice_a_text: string;
  choice_a_cost: number;
  choice_a_passive: string | null;
  choice_b_text: string;
  choice_b_cost: number;
  choice_b_passive: string | null;
}

interface ActiveEvent {
  id: string;
  user_id: string;
  event_id: string;
  status: string;
}

const db = createClient();

export default function RandomEventModal() {
  const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);
  const [eventData, setEventData] = useState<PlayerEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { userId, isLoggedIn } = useAuth();
  const reqSeqRef = useRef<number>(0);
  const activeAccountRef = useRef<string | null>(isLoggedIn && userId ? userId : null);
  const hasActiveEventRef = useRef<boolean>(false);

  useEffect(() => {
    hasActiveEventRef.current = Boolean(activeEvent);
  }, [activeEvent]);

  useEffect(() => {
    let mounted = true;
    const reqSeq = ++reqSeqRef.current;
    const currentUserId: string | null = isLoggedIn && userId ? userId : null;
    activeAccountRef.current = currentUserId;

    // 로그아웃 또는 계정 전환 시 이전 계정의 돌발 이벤트 모달 상태 즉시 초기화
    setActiveEvent(null);
    setEventData(null);
    setErrorMsg(null);
    setLoading(false);

    if (!currentUserId) {
      return () => {
        mounted = false;
        reqSeqRef.current += 1;
      };
    }

    const isStale = () =>
      !mounted || reqSeq !== reqSeqRef.current || activeAccountRef.current !== currentUserId;

    const checkPendingEvents = async (uid: string) => {
      const { data } = await db
        .from('active_player_events')
        .select('*')
        .eq('user_id', uid)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1);

      if (isStale()) return;
      if (data && data.length > 0) {
        const active = data[0];
        const { data: edata } = await db
          .from('player_events')
          .select('*')
          .eq('id', active.event_id)
          .maybeSingle();
        if (isStale()) return;
        if (edata) {
          setActiveEvent(active);
          setEventData(edata);
        }
      } else {
        setActiveEvent(null);
        setEventData(null);
      }
    };

    // 주기적 이벤트 체크 폴링 (매 30초)
    const pollInterval = setInterval(() => {
      if (!isStale() && !hasActiveEventRef.current) {
        void checkPendingEvents(currentUserId);
      }
    }, 30000);

    // Initial delay check
    const delayTimer = setTimeout(() => {
      if (!isStale()) void checkPendingEvents(currentUserId);
    }, 2000);

    return () => {
      mounted = false;
      reqSeqRef.current += 1;
      clearTimeout(delayTimer);
      clearInterval(pollInterval);
    };
  }, [isLoggedIn, userId]);

  if (!activeEvent || !eventData) return null;

  const handleChoice = async (choice: 'A' | 'B') => {
    if (loading || !activeEvent) return;
    const reqUserId = isLoggedIn && userId ? userId : null;
    const reqSeq = reqSeqRef.current;
    setLoading(true);
    setErrorMsg(null);
    try {
      if (!reqUserId) {
        setErrorMsg('로그인이 필요한 기능입니다.');
        return;
      }

      const res = await fetch('/api/events/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activeEventId: activeEvent.id,
          choice,
        }),
      });
      const data = await res.json();
      if (activeAccountRef.current !== reqUserId || reqSeqRef.current !== reqSeq) return;

      if (!res.ok || !data.success) {
        setErrorMsg(data.message || '이벤트 선택을 저장하지 못했습니다.');
        return;
      }

      setActiveEvent(null);
      setEventData(null);
    } catch (e: any) {
      if (activeAccountRef.current !== reqUserId || reqSeqRef.current !== reqSeq) return;
      console.error(e);
      setErrorMsg(e?.message || '이벤트 처리 중 통신 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-panel overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-300">
        <div className="bg-warn/10 border-b border-warn/20 px-6 py-4 flex items-center gap-3">
          <span className="text-warn text-xl">⚠️</span>
          <h2 className="text-lg font-bold text-tx tracking-tight">돌발 이벤트 발생!</h2>
        </div>
        
        <div className="p-6">
          <h3 className="text-xl font-bold text-tx mb-3">{eventData.title}</h3>
          <p className="text-[14px] text-muted leading-relaxed mb-6">
            {eventData.description}
          </p>

          {errorMsg && (
            <div className="mb-4 rounded-lg border border-red-500/50 bg-red-950/60 px-3 py-2 text-xs font-medium text-red-300">
              {errorMsg}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <button
              disabled={loading}
              onClick={() => handleChoice('A')}
              className="group relative w-full rounded-lg border border-border bg-panel2 p-4 text-left transition-colors hover:border-accent/50 hover:bg-accent/5"
            >
              <div className="font-medium text-tx mb-1">{eventData.choice_a_text}</div>
              <div className="text-[12px] text-dim flex gap-3">
                {eventData.choice_a_cost !== 0 && (
                  <span className={eventData.choice_a_cost > 0 ? 'text-down' : 'text-up'}>
                    현금 {eventData.choice_a_cost > 0 ? '-' : '+'}{Math.abs(eventData.choice_a_cost).toLocaleString()} ₩
                  </span>
                )}
                {eventData.choice_a_passive && (
                  <span className="text-accent">
                    {eventData.choice_a_passive === 'fee_booster'
                      ? '패시브 효과: 수수료 50% 감면'
                      : `프로필 배지(수치 효과 없음): ${eventData.choice_a_passive}`}
                  </span>
                )}
              </div>
            </button>

            <button
              disabled={loading}
              onClick={() => handleChoice('B')}
              className="group relative w-full rounded-lg border border-border bg-panel2 p-4 text-left transition-colors hover:border-accent/50 hover:bg-accent/5"
            >
              <div className="font-medium text-tx mb-1">{eventData.choice_b_text}</div>
              <div className="text-[12px] text-dim flex gap-3">
                {eventData.choice_b_cost !== 0 && (
                  <span className={eventData.choice_b_cost > 0 ? 'text-down' : 'text-up'}>
                    현금 {eventData.choice_b_cost > 0 ? '-' : '+'}{Math.abs(eventData.choice_b_cost).toLocaleString()} ₩
                  </span>
                )}
                {eventData.choice_b_passive && (
                  <span className="text-accent">
                    {eventData.choice_b_passive === 'fee_booster'
                      ? '패시브 효과: 수수료 50% 감면'
                      : `프로필 배지(수치 효과 없음): ${eventData.choice_b_passive}`}
                  </span>
                )}
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
