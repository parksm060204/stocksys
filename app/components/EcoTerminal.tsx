'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

interface MacroEvent {
  id: string;
  trigger_time: string;
  event_name: string;
  period: string;
  survey_value: string;
  actual_value: string;
  status: string;
}

export default function EcoTerminal() {
  const [events, setEvents] = useState<MacroEvent[]>([]);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 1000);

    // 1. 초기 데이터 로드
    const fetchEvents = async () => {
      const { data } = await supabase
        .from('macro_calendar')
        .select('*')
        .order('trigger_time', { ascending: true });
      if (data) setEvents(data);
    };
    fetchEvents();

    // 2. 실시간 구독 (발표치가 업데이트되면 번쩍이도록)
    const channel = supabase.channel('macro_calendar_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'macro_calendar' }, (payload) => {
        setEvents((prev) => prev.map(ev => {
          if (ev.id === payload.new.id) {
            // 방금 업데이트된 항목에 하이라이트 효과를 주기 위해 상태 추가 가능
            return { ...ev, ...payload.new, isNew: true } as any;
          }
          return ev;
        }));
        
        // 2초 뒤 하이라이트 해제
        setTimeout(() => {
          setEvents((prev) => prev.map(ev => 
            ev.id === payload.new.id ? { ...ev, isNew: false } : ev
          ));
        }, 2000);
      })
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div style={{
      backgroundColor: '#000000',
      color: '#FF9900',
      fontFamily: '"Courier New", Courier, monospace',
      padding: '10px',
      border: '2px solid #333',
      width: '100%',
      maxWidth: '900px',
      height: '400px',
      overflowY: 'auto',
      boxShadow: '0 0 10px rgba(255, 153, 0, 0.2)'
    }}>
      {/* 터미널 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #FF9900', paddingBottom: '5px', marginBottom: '10px' }}>
        <div>
          <span style={{ backgroundColor: '#FF9900', color: '#000', padding: '0 5px', fontWeight: 'bold' }}>ECO</span> 경제지표 일정
        </div>
        <div>
          <span style={{ color: '#aaa' }}>브라우즈</span> {now ? now.toLocaleTimeString() : '--:--:--'}
        </div>
      </div>

      {/* 테이블 헤더 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 3fr 1fr 1.5fr 1.5fr',
        borderBottom: '1px dotted #555',
        paddingBottom: '5px',
        color: '#888',
        fontSize: '0.9em'
      }}>
        <div>일자시간</div>
        <div>이벤트</div>
        <div>기간</div>
        <div style={{ textAlign: 'right' }}>서베이</div>
        <div style={{ textAlign: 'right' }}>발표치</div>
      </div>

      {/* 이벤트 리스트 */}
      <div style={{ marginTop: '5px' }}>
        {events.map((ev, idx) => (
          <div key={ev.id} style={{
            display: 'grid',
            gridTemplateColumns: '1fr 3fr 1fr 1.5fr 1.5fr',
            padding: '4px 0',
            borderBottom: '1px solid #111',
            backgroundColor: (ev as any).isNew ? '#331a00' : 'transparent',
            transition: 'background-color 0.5s'
          }}>
            <div>{ev.trigger_time}</div>
            <div style={{ color: '#fff' }}>{ev.event_name}</div>
            <div style={{ color: '#aaa' }}>{ev.period}</div>
            <div style={{ textAlign: 'right', color: '#ccc' }}>{ev.survey_value}</div>
            <div style={{ 
              textAlign: 'right', 
              color: ev.status === 'RELEASED' ? '#00FF00' : '#ff9900',
              fontWeight: ev.status === 'RELEASED' ? 'bold' : 'normal',
              textShadow: (ev as any).isNew ? '0 0 8px #00FF00' : 'none'
            }}>
              {ev.actual_value}
            </div>
          </div>
        ))}
        {events.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: '20px', color: '#555' }}>
            일정 로딩 중...
          </div>
        )}
      </div>
    </div>
  );
}
