import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { GUEST_USER_ID } from "@/lib/memoryDb/memoryStore";

interface SectorImpact {
  sector: string;
  impact: "positive" | "negative";
  score: number;
}

export const MAX_TEXT_LENGTH = 5000;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const MAX_REQUESTS_PER_WINDOW = 5;

export const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  entry.count++;
  return true;
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
  // 1. 인증 확인
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    session = null;
  }

  const authenticatedUserId = session?.user?.id;
  if (!authenticatedUserId) {
    return Response.json({ error: "로그인이 필요한 서비스입니다." }, { status: 401 });
  }

  // 2. 요청 빈도 제한 (Rate Limiting)
  if (!checkRateLimit(authenticatedUserId)) {
    return Response.json(
      { error: "요청이 너무 빈번합니다. 잠시 후 다시 시도해주세요." },
      { status: 429 }
    );
  }

  // 3. 입력 본문 검증 및 길이 제한
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "올바른 JSON 요청이 아닙니다." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || typeof (body as { text?: unknown }).text !== "string") {
    return Response.json({ error: "분석할 텍스트를 입력해주세요." }, { status: 400 });
  }
  const text = (body as { text: string }).text.trim();
  if (!text) {
    return Response.json({ error: "분석할 텍스트를 입력해주세요." }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return Response.json(
      { error: `입력 본문이 너무 깁니다. 최대 ${MAX_TEXT_LENGTH.toLocaleString()}자까지 입력 가능합니다.` },
      { status: 400 }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(heuristic(text));
  }

  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      }
    );
    if (!res.ok) {
      return Response.json({ error: "AI 분석 서비스를 일시적으로 사용할 수 없습니다." }, { status: 502 });
    }
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const parsed = JSON.parse(raw);
    return Response.json({
      summary: parsed.summary ?? "분석 완료",
      impacts: (parsed.impacts ?? []) as SectorImpact[],
    });
  } catch {
    return Response.json({ error: "AI 분석 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
