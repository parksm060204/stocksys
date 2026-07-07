"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/types";

export default function ChatPanel({
  stockId,
  initial,
}: {
  stockId: string;
  initial: ChatMessage[];
}) {
  const [messages, setMessages] = useState(initial);
  const [input, setInput] = useState("");

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setMessages((m) => [
      {
        id: `${stockId}-local-${Date.now()}`,
        stockId,
        userId: "me",
        userName: "나",
        isShareholder: true,
        content: text,
        createdAt: new Date().toISOString(),
      },
      ...m,
    ]);
    setInput("");
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h3 className="text-[13px] font-semibold text-tx">종목 토론방</h3>
        <span className="text-[11px] text-dim">주주 인증 표시</span>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => (
          <div key={m.id} className="flex gap-2.5">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-panel2 text-[11px] font-bold text-muted">
              {m.userName.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-semibold text-tx">{m.userName}</span>
                {m.isShareholder && (
                  <span className="rounded bg-accent/15 px-1.5 py-px text-[9px] font-semibold text-accent">
                    주주
                  </span>
                )}
              </div>
              <p className="text-[12px] leading-snug text-muted">{m.content}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="메시지를 입력하세요…"
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-tx outline-none placeholder:text-dim focus:border-accent/50"
          />
          <button
            onClick={send}
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-black transition-opacity hover:opacity-90"
          >
            전송
          </button>
        </div>
      </div>
    </div>
  );
}
