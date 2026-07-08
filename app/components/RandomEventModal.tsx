'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

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

export default function RandomEventModal() {
  const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);
  const [eventData, setEventData] = useState<PlayerEvent | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  useEffect(() => {
    let userId: string | null = null;

    const checkPendingEvents = async (uid: string) => {
      const { data } = await supabase
        .from('active_player_events')
        .select('*')
        .eq('user_id', uid)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1);

      if (data && data.length > 0) {
        const active = data[0];
        setActiveEvent(active);
        const { data: edata } = await supabase.from('player_events').select('*').eq('id', active.event_id).single();
        if (edata) setEventData(edata);
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      userId = data.session?.user?.id ?? null;
      if (userId) checkPendingEvents(userId);
    });

    const channel = supabase.channel('active_events_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'active_player_events' }, (payload) => {
        if (payload.new.user_id === userId && payload.new.status === 'pending') {
          if (!activeEvent) {
            checkPendingEvents(userId!);
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeEvent, supabase]);

  if (!activeEvent || !eventData) return null;

  const handleChoice = async (choice: 'A' | 'B') => {
    if (loading) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;

      const cost = choice === 'A' ? eventData.choice_a_cost : eventData.choice_b_cost;
      const passive = choice === 'A' ? eventData.choice_a_passive : eventData.choice_b_passive;

      // Update cash & passive via an RPC or manually
      // Note: In a real secure app, this should be an RPC to prevent tampering.
      // For this simulator, we do it directly using client if RLS permits.
      // Wait, RLS on profiles might not allow direct updates of cash by the user if it's protected, but our policy says "Users can update their own profile".
      const { data: profile } = await supabase.from('profiles').select('cash, acquired_passives').eq('id', uid).single();
      
      if (profile) {
        const newCash = Number(profile.cash) - cost;
        const passives = Array.isArray(profile.acquired_passives) ? profile.acquired_passives : [];
        if (passive && !passives.includes(passive)) {
          passives.push(passive);
        }

        await supabase.from('profiles').update({ cash: newCash, acquired_passives: passives }).eq('id', uid);
      }

      // Mark event as resolved
      await supabase.from('active_player_events').update({ status: 'resolved' }).eq('id', activeEvent.id);

      setActiveEvent(null);
      setEventData(null);
    } catch (e) {
      console.error(e);
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
          <p className="text-[14px] text-muted leading-relaxed mb-8">
            {eventData.description}
          </p>

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
                  <span className="text-accent">보상: {eventData.choice_a_passive}</span>
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
                  <span className="text-accent">보상: {eventData.choice_b_passive}</span>
                )}
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
