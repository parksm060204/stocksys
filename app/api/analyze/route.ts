import { NextRequest } from "next/server";

interface SectorImpact {
  sector: string;
  impact: "positive" | "negative";
  score: number;
}

const SYSTEM_PROMPT = `너는 가상 주식 시장의 경제 분석가다. 주어진 웹소설 본문을 읽고, 어떤 산업 섹터에 호재 또는 악재로 작용할지 분석하라.
반드시 아래 JSON 형식으로만 응답하라 (다른 텍스트 금지):
{"summary":"한 줄 요약","impacts":[{"sector":"섹터명","impact":"positive|negative","score":-10~+10 사이 실수}]}
sector 키워드: 에너지, 반도체, 방산, 바이오, 금융, 화학, 철강, 통신, 소비재, IT, 희토류, 원자재, 채권, 파생상품, 로보틱스 등.
score는 -10(강한 악재) ~ +10(강한 호재) 범위다.`;

function heuristic(text: string): { summary: string; impacts: SectorImpact[] } {
  const impacts: SectorImpact[] = [];
  const add = (sector: string, score: number) => {
    const ex = impacts.find((i) => i.sector === sector);
    if (ex) ex.score += score;
    else impacts.push({ sector, impact: score >= 0 ? "positive" : "negative", score });
  };
  if (/에너지|원자력|수소|석유|가스/.test(text)) add("에너지", 7.5);
  if (/전쟁|무기|미사일|방산|군/.test(text)) add("방산", 8.2);
  if (/반도체|ai|칩|팹/i.test(text)) add("반도체", 6.4);
  if (/임상|치료제|바이오|백신/.test(text)) add("바이오", 5.8);
  if (/규제|제재|금지|제한/.test(text)) add("금융", -4.2);
  if (/희토류|리튬|광물/.test(text)) add("희토류", 7.0);
  if (impacts.length === 0) add("전반", 1.2);
  impacts.forEach((i) => (i.impact = i.score >= 0 ? "positive" : "negative"));
  return {
    summary: "AI 분석(휴리스틱 fallback) — GEMINI_API_KEY 미설정 시 로컬 추정.",
    impacts,
  };
}

export async function POST(request: NextRequest) {
  let body: { text?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) return Response.json({ error: "text is required" }, { status: 400 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(heuristic(text));
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );
    if (!res.ok) {
      return Response.json({ error: `Gemini API error: ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const parsed = JSON.parse(raw);
    return Response.json({
      summary: parsed.summary ?? "분석 완료",
      impacts: (parsed.impacts ?? []) as SectorImpact[],
    });
  } catch {
    return Response.json({ error: "Gemini 호출 실패" }, { status: 500 });
  }
}
