import { GoogleGenerativeAI } from "@google/generative-ai";

export interface NewsItem {
  id?: string;
  created_at?: string;
  type: 'MACRO' | 'MICRO';
  category: 'OFFICIAL' | 'RUMOR' | 'CORRECTION';
  publisher: string;
  title: string;
  content: string;
  target_sector?: string | null;
  target_ticker?: string | null;
  impact_score: number; // -10.0 to +10.0
  is_fake?: boolean;
  original_rumor_id?: string | null;
}

export class NewsGenerator {
  private genAI: GoogleGenerativeAI | null = null;
  private model: any = null;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';
    if (apiKey) {
      try {
        this.genAI = new GoogleGenerativeAI(apiKey);
        // Use gemini-1.5-pro or gemini-2.0-flash
        this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
      } catch (e) {
        console.warn("⚠️ Failed to initialize Gemini API in NewsGenerator:", e);
      }
    } else {
      console.warn("⚠️ GEMINI_API_KEY is not set. NewsGenerator will use high-quality template fallbacks.");
    }
  }

  public async generateNews(marketContext?: { stocks?: any[]; sentiment?: any }): Promise<NewsItem> {
    if (this.model) {
      try {
        const tickers = (marketContext?.stocks || []).map((s: any) => `${s.ticker} (${s.name})`).join(", ");

        const prompt = `
당신은 가상 금융 시장의 전문 경제부 기자이자 정보 브로커입니다.
현재 시장에 거래 중인 종목 목록: [${tickers.slice(0, 300) || "NVDA, US10Y, KRW, GC00, OSEL3Y"}]

무작위로 시장을 뒤흔들 경제 뉴스/호재/악재 또는 찌라시 1건을 생성하세요.

[필수 조건]
1. type: "MACRO" (거시경제, 금리, 인플레이션, 채권, 환율) 또는 "MICRO" (기업 실적, 수주, 경영권, 특허)
2. category: "OFFICIAL" (정식 언론 보도) 또는 "RUMOR" (미확인 찌라시/소문)
3. publisher: "월스트리트저널", "스트리트 리포트", "블룸버그 터미널", "가십 썬", "페일 리포트", "캐피탈 옵저버" 중 하나
4. title: 직관적이고 자극적인 한글 헤드라인 (30자 이내)
5. content: 뉴스 핵심 내용 3줄 요약 (한글 150자 이내)
6. target_sector: "테크", "금융", "에너지", "바이오", "원자재", "채권" 중 하나 (없으면 null)
7. target_ticker: 관련 특정 종목 티커 (예: "NVDA", "KR10Y", "US10Y" 등, 없으면 null)
8. impact_score: -10.0 (대폭락/메가 숏) ~ +10.0 (대폭등/메가 롱) 사이의 실수 수치
9. is_fake: category가 "RUMOR"일 경우 50% 확률로 true (거짓 찌라시 여부)

반드시 아래 JSON 형식만 반환하세요 (마크다운 코드블록이나 다른 텍스트 금지):
{
  "type": "MACRO",
  "category": "OFFICIAL",
  "publisher": "월스트리트저널",
  "title": "연준 금리 전격 인하 가능성 제기",
  "content": "1. 미국 국채 금리 급락세 연출\\n2. 기술주 위주 대규모 매수세 유입\\n3. 시장 변동성 급증 전망",
  "target_sector": "금융",
  "target_ticker": "US10Y",
  "impact_score": 6.5,
  "is_fake": false
}
        `;

        const result = await this.model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        });

        const text = result.response.text();
        const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const json = JSON.parse(cleanedText);

        return {
          type: json.type || 'MACRO',
          category: json.category || 'OFFICIAL',
          publisher: json.publisher || '블룸버그 터미널',
          title: json.title || '시장 긴급 변동성 경보',
          content: json.content || '1. 시장 참가자 관심 급증\n2. 주요 섹터 변동성 유입\n3. 기관 포트폴리오 재편',
          target_sector: json.target_sector || null,
          target_ticker: json.target_ticker || null,
          impact_score: typeof json.impact_score === 'number' ? Math.max(-10, Math.min(10, json.impact_score)) : 0,
          is_fake: json.category === 'RUMOR' ? Boolean(json.is_fake) : false
        };
      } catch (err) {
        console.error("❌ Gemini API News Generation error, falling back to templates:", err);
      }
    }

    return this.getFallbackTemplate();
  }

  public generateCorrection(originalRumor: NewsItem): NewsItem {
    return {
      type: originalRumor.type || 'MICRO',
      category: 'CORRECTION',
      publisher: '기업 전자공시 (DART)',
      title: `[정정 공시] ${originalRumor.title || '최근 소문'}은 사실무근으로 확인`,
      content: `1. 최근 시장에 유포된 소문은 조사 결과 근거 없는 낭설로 판명되었습니다.\n2. 해당 기업 및 주주 보호를 위해 강력한 법적 대처를 시사합니다.\n3. 시장 참가자들의 신중한 투자 주의가 요망됩니다.`,
      target_sector: originalRumor.target_sector || null,
      target_ticker: originalRumor.target_ticker || null,
      impact_score: Math.max(-10, Math.min(10, -1 * (originalRumor.impact_score || 5.0))),
      is_fake: false,
      original_rumor_id: originalRumor.id || null
    };
  }

  private getFallbackTemplate(): NewsItem {
    const templates: NewsItem[] = [
      {
        type: 'MACRO',
        category: 'OFFICIAL',
        publisher: '월스트리트저널',
        title: '미 연준 금리 인하 기대감 확산',
        content: '1. 인플레이션 지표 둔화 신호 감지\n2. 주요 국채 금리 하락세 전환\n3. 억눌렸던 기술주 중심으로 강한 반등 시도',
        target_sector: '테크',
        target_ticker: 'US10Y',
        impact_score: 5.5,
        is_fake: false
      },
      {
        type: 'MICRO',
        category: 'RUMOR',
        publisher: '가십 썬',
        title: '대형 테크 기업 엠앤에이(M&A) 비공식 타진설',
        content: '1. 글로벌 인수합병 추진 소문 입수\n2. 이사회 비밀 회동 정황 포착\n3. 양사 주가 폭등 기대감 반영',
        target_sector: '테크',
        target_ticker: 'NVDA',
        impact_score: 7.8,
        is_fake: true
      },
      {
        type: 'MACRO',
        category: 'OFFICIAL',
        publisher: '블룸버그 터미널',
        title: '국제 유가 급등에 따른 인플레이션 우려 재발',
        content: '1. 중동 정세 불안으로 공급망 우려\n2. 원자재 시장 강세 지속\n3. 채권 시장 수익률 급등세',
        target_sector: '원자재',
        target_ticker: 'GC00',
        impact_score: -6.2,
        is_fake: false
      },
      {
        type: 'MICRO',
        category: 'OFFICIAL',
        publisher: '스트리트 리포트',
        title: '주요 반도체 기업 신규 데이터센터 납품 확정',
        content: '1. 차세대 AI 칩 공급 계약 수주 성공\n2. 수주 규모 사상 최대 기록\n3. 영업이익률 대폭 개선 전망',
        target_sector: '테크',
        target_ticker: 'NVDA',
        impact_score: 8.2,
        is_fake: false
      }
    ];

    const randomIndex = Math.floor(Math.random() * templates.length);
    return templates[randomIndex];
  }
}
