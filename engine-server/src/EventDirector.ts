import { createClient } from '@supabase/supabase-js';
import type { MarketEngine } from './MarketEngine';
import type { MarketEvent } from './types';
import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

export class EventDirector {
  private engine: MarketEngine;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private lastGlobalEventTime: string = "";

  constructor(engine: MarketEngine) {
    this.engine = engine;
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("🎬 Event Director Started (Monitoring time...)");
    
    // 1분(60000ms)마다 시간 및 확률 체크
    this.timer = setInterval(() => this.tickMinute(), 60 * 1000);
  }

  public stop() {
    this.isRunning = false;
    if (this.timer) clearInterval(this.timer);
    console.log("🛑 Event Director Stopped.");
  }

  private async tickMinute() {
    const now = new Date();
    // KST 변환
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstTime = new Date(now.getTime() + kstOffset);
    const hours = kstTime.getUTCHours();
    const minutes = kstTime.getUTCMinutes();
    const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

    // 시장 시간 외 무시
    if (hours < 18 || (hours === 22 && minutes > 30) || hours > 22) return;

    // 1. 글로벌 메가톤급 이벤트 (macro_calendar 스케줄 체크)
    const { data: calendarEvents, error } = await supabase
      .from('macro_calendar')
      .select('*')
      .eq('trigger_time', timeStr)
      .eq('status', 'PENDING');

    if (!error && calendarEvents && calendarEvents.length > 0) {
      for (const calEvent of calendarEvents) {
        console.log(`[EventDirector] 🚨 MACRO CALENDAR EVENT TRIGGERED: ${calEvent.event_name}`);
        await this.generateCalendarEvent(calEvent);
      }
      return; // 글로벌 이벤트 터지면 랜덤 인카운트는 스킵
    }

    // 2. 랜덤 인카운트 (개별/섹터 뉴스, 매 분 3% 확률)
    if (Math.random() < 0.03) {
      console.log(`[EventDirector] 🎲 RANDOM ENCOUNTER TRIGGERED at ${timeStr}`);
      await this.generateRandomEvent();
    }
  }

  private async generateCalendarEvent(calEvent: any) {
    try {
      const prompt = `
당신은 가상 주식 거래 게임의 이벤트 디렉터(게임 마스터)입니다.
지금 경제 캘린더 일정이 발표되었습니다. 아래 정보를 바탕으로 가상 주식 게임의 호가창에 던질 'MarketEvent' 객체와 실제 발표 수치를 만들어주세요.

[이벤트 정보]
이벤트명: ${calEvent.event_name}
예상치(Survey): ${calEvent.survey_value}
임팩트 수준: ${calEvent.impact_level}

[지시사항]
1. 실제 발표치(actual_value)를 주사위를 굴리듯 예상치와 비교해서 무작위로 생성하세요. (예: 예상치를 크게 상회, 하회, 부합 등)
2. targetSector 필드에 무조건 'ALL'을 반환하라.
3. impact 필드: 수치 결과에 따라 'STRONG_POSITIVE', 'POSITIVE', 'NEGATIVE', 'STRONG_NEGATIVE' 중 하나 선택.
4. urgencyMultiplier 필드: 1.0 ~ 3.0 사이의 숫자.
5. durationTicks 필드: 60 ~ 300 사이.
6. JSON 형식으로만 응답하되, 다음 키를 반드시 포함해야 합니다: 
   { "targetSector": "...", "impact": "...", "urgencyMultiplier": 2.5, "durationTicks": 120, "actual_value": "..." }
7. json 코드블록 없이 순수 JSON 문자열만 반환하세요.
`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-preview:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: "application/json" }
        })
      });

      if (!response.ok) throw new Error(`Gemini API Error: ${response.statusText}`);

      const resJson = await response.json();
      const parsedEvent = JSON.parse(resJson.candidates[0].content.parts[0].text);
      
      const event: MarketEvent = {
        id: uuidv4(),
        targetSector: parsedEvent.targetSector,
        impact: parsedEvent.impact,
        urgencyMultiplier: parsedEvent.urgencyMultiplier,
        durationTicks: parsedEvent.durationTicks
      };

      // 엔진 주입
      this.engine.injectEvent(event);

      // DB 업데이트 (프론트엔드 UI용)
      await supabase.from('macro_calendar')
        .update({ actual_value: parsedEvent.actual_value, status: 'RELEASED' })
        .eq('id', calEvent.id);

    } catch (e: any) {
      console.error("[EventDirector] Calendar Event Gen Failed:", e.message);
    }
  }

  private async generateRandomEvent() {
    try {
      // 1. 미디어 아울렛 목록 가져오기
      const { data: outlets, error } = await supabase.from('media_outlets').select('*');
      if (error || !outlets || outlets.length === 0) return;

      // 2. 랜덤 언론사 픽
      const outlet = outlets[Math.floor(Math.random() * outlets.length)];

      // 3. 진위 여부 및 찌라시 여부 결정
      const isQuoted = Math.random() < (outlet.type === 'MICRO' ? 0.7 : 0.3);
      
      let truthProb = outlet.reliability / 100;
      if (isQuoted) {
        // 매크로 언론이 찌라시를 낼 경우: 팩트 확률이 15% 깎임 (예: 95% -> 80%)
        // 마이크로 언론이 찌라시를 낼 경우: 팩트 확률이 30% 깎임 (예: 50% -> 20%)
        const penalty = outlet.type === 'MACRO' ? 0.15 : 0.30;
        truthProb = Math.max(0, truthProb - penalty);
      }
      const isTrue = Math.random() < truthProb;

      // 4. Gemini 프롬프트 구성
      const prompt = `
당신은 가상 주식 거래 게임의 게임 마스터이자 '${outlet.name}' 언론사의 편집장입니다.
방금 새로운 [${outlet.type}] 경제/기업 뉴스가 들어왔습니다.
- 언론사 유형: ${outlet.type} (MACRO는 거시경제, MICRO는 특정 개별 기업 중심)
- 인용(찌라시) 여부: ${isQuoted ? '누군가의 말을 인용한 카더라 통신' : '직접 취재한 팩트 기반'}
- 실제 진위 여부 (내부용): ${isTrue ? '진짜 팩트' : '주가 조작을 위한 가짜 뉴스/헛소문'}

[지시사항]
1. headline: 뉴스의 자극적인 제목 (모든 유저에게 공개됨). 가짜 뉴스라면 더욱 그럴듯하게 과장할 것.
2. content_summary: 뉴스 내용 3줄 요약 (구독자에게만 공개됨). 
3. targetSector: 이 뉴스가 영향을 미칠 섹터 ('TECH', 'BIO', 'FINANCE', 'CONSUMER' 중 하나, MACRO면 'ALL').
4. impact: 이 뉴스가 주가에 미칠 영향 ('STRONG_POSITIVE', 'POSITIVE', 'NEGATIVE', 'STRONG_NEGATIVE'). 가짜 뉴스라도 사람들은 일시적으로 이 방향을 믿음.
5. urgencyMultiplier: 1.0 ~ 3.0.
6. durationTicks: 60 ~ 300.
7. json 코드블록 없이 순수 JSON 문자열만 반환하세요.
`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-preview:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: "application/json" }
        })
      });

      if (!response.ok) return;

      const resJson = await response.json();
      const parsedEvent = JSON.parse(resJson.candidates[0].content.parts[0].text);
      
      // 5. premium_news DB에 저장
      const { data: insertedNews, error: insertError } = await supabase.from('premium_news').insert({
        media_outlet_id: outlet.id,
        headline: parsedEvent.headline,
        content_summary: parsedEvent.content_summary,
        is_quoted: isQuoted,
        is_true: isTrue
      }).select().single();

      if (insertError) {
        console.error("Premium News Insert Error:", insertError);
        return;
      }

      console.log(`[EventDirector] 📰 New Premium News: [${outlet.name}] ${parsedEvent.headline} (True: ${isTrue})`);

      // 6. 엔진에 시장 이벤트 주입 (봇들을 움직이게 함)
      const event: MarketEvent = {
        id: uuidv4(),
        targetSector: parsedEvent.targetSector,
        impact: parsedEvent.impact,
        urgencyMultiplier: parsedEvent.urgencyMultiplier,
        durationTicks: parsedEvent.durationTicks
      };

      this.engine.injectEvent(event);

      // 7. 가짜 뉴스(MICRO)일 경우 4시간(14,400,000ms) 뒤 정정 공시 스케줄링
      if (!isTrue && outlet.type === 'MICRO') {
        this.scheduleCorrection(parsedEvent, outlets);
      }

    } catch (e: any) {
      console.error("[EventDirector] Random Event Gen Failed:", e.message);
    }
  }

  private scheduleCorrection(fakeNewsData: any, allOutlets: any[]) {
    // 4시간 = 4 * 60 * 60 * 1000 ms = 14400000 ms
    const delayMs = 14400000;
    console.log(`[EventDirector] 🕒 Scheduled correction for fake news in 4 hours.`);

    setTimeout(async () => {
      try {
        console.log(`[EventDirector] 🚨 Executing Scheduled Correction News!`);
        
        const dartOutlet = allOutlets.find(o => o.name.includes('DART') || o.name.includes('전자공시'));
        if (!dartOutlet) return;

        const templates = [
          "[해명] 본사 관련 찌라시는 전혀 사실 무근이며 강력한 법적 대응을 시사합니다.",
          "[공시] 시장에 유포되고 있는 당사 관련 악의적 루머에 대해 전면 부인합니다.",
          "[안내] 해당 보도는 사실과 다르며, 현재 내부 조사 결과 근거 없는 낭설로 확인되었습니다.",
          "[해명] 최근 보도된 당사의 수주/실적 관련 이슈는 전혀 확정된 바 없는 가짜 뉴스입니다.",
          "[공식입장] 당사 관련 미확인 루머 유포자에 대해 수사 의뢰 등 엄중 대처할 예정입니다."
        ];
        const selectedTemplate = templates[Math.floor(Math.random() * templates.length)];

        // DB에 프리미엄 뉴스 삽입 (DART 채널)
        await supabase.from('premium_news').insert({
          media_outlet_id: dartOutlet.id,
          headline: "[기업 전자공시] 풍문 또는 보도에 대한 해명",
          content_summary: selectedTemplate,
          is_quoted: false,
          is_true: true
        });

        // 엔진에 반대 이벤트 주입
        const inverseImpact = (impact: string) => {
          if (impact === 'STRONG_POSITIVE') return 'STRONG_NEGATIVE';
          if (impact === 'POSITIVE') return 'NEGATIVE';
          if (impact === 'NEGATIVE') return 'POSITIVE';
          if (impact === 'STRONG_NEGATIVE') return 'STRONG_POSITIVE';
          return 'NEGATIVE';
        };

        const event: MarketEvent = {
          id: uuidv4(),
          targetSector: fakeNewsData.targetSector,
          impact: inverseImpact(fakeNewsData.impact),
          urgencyMultiplier: 3.0, // 공시는 파급력이 세고 즉각적임
          durationTicks: 120
        };

        this.engine.injectEvent(event);
      } catch (e: any) {
        console.error("[EventDirector] Correction News Gen Failed:", e.message);
      }
    }, delayMs);
  }
}
