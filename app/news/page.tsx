import { NEWS } from "@/lib/mock-data";

const SOURCE_LABEL: Record<string, string> = {
  AI: "AI 생성",
  DISCLOSURE: "전자공시",
  ADMIN: "관리자",
};

export default function NewsPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-tx">뉴스 · 공시</h1>
        <p className="text-[13px] text-muted">AI 생성 뉴스 · 가상 전자공시 · 관리자 발행</p>
      </div>

      <div className="space-y-3">
        {NEWS.map((n) => (
          <article
            key={n.id}
            className="rounded-xl border border-border bg-panel p-5 transition-colors hover:border-border/80"
          >
            <div className="mb-2 flex items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                  n.source === "AI"
                    ? "bg-accent/15 text-accent"
                    : n.source === "DISCLOSURE"
                      ? "bg-warn/15 text-warn"
                      : "bg-up/15 text-up"
                }`}
              >
                {SOURCE_LABEL[n.source]}
              </span>
              {n.sector && (
                <span className="rounded bg-panel2 px-2 py-0.5 text-[10px] text-muted">{n.sector}</span>
              )}
              <span
                className={`text-[10px] font-semibold ${
                  n.sentiment === "positive" ? "text-up" : n.sentiment === "negative" ? "text-down" : "text-dim"
                }`}
              >
                {n.sentiment === "positive" ? "● 호재" : n.sentiment === "negative" ? "● 악재" : "● 중립"}
              </span>
              <span className="ml-auto text-[11px] text-dim">
                {new Date(n.createdAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <h2 className="text-[15px] font-semibold text-tx">{n.title}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{n.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
