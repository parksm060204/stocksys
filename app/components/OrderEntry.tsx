"use client";

import { useState } from "react";
import type { Stock } from "@/lib/types";
import { LP_ENGINE } from "@/lib/mock-data";
import { fmtPrice } from "@/lib/format";

export default function OrderEntry({ stock }: { stock: Stock }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState(String(stock.currentPrice));
  const [qty, setQty] = useState("10");

  const total = (Number(price) || 0) * (Number(qty) || 0);
  const emergency = LP_ENGINE?.emergencyClosed;

  return (
    <div className="rounded-xl border border-border bg-panel">
      <div className="grid grid-cols-2 border-b border-border">
        <button
          disabled={emergency}
          onClick={() => setSide("buy")}
          className={`py-2.5 text-[13px] font-semibold transition-colors ${
            emergency ? "cursor-not-allowed opacity-50" : side === "buy" ? "bg-up/15 text-up" : "text-dim hover:text-tx"
          }`}
        >
          매수
        </button>
        <button
          disabled={emergency}
          onClick={() => setSide("sell")}
          className={`py-2.5 text-[13px] font-semibold transition-colors ${
            emergency ? "cursor-not-allowed opacity-50" : side === "sell" ? "bg-down/15 text-down" : "text-dim hover:text-tx"
          }`}
        >
          매도
        </button>
      </div>

      <div className="space-y-3 p-4">
        <Field label="주문 가격">
          <input
            disabled={emergency}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-right font-mono text-[13px] text-tx outline-none focus:border-accent/50 disabled:opacity-50"
          />
        </Field>
        <Field label="주문 수량">
          <input
            disabled={emergency}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-right font-mono text-[13px] text-tx outline-none focus:border-accent/50 disabled:opacity-50"
          />
        </Field>

        <div className="flex gap-2">
          {["10", "50", "100", "500"].map((q) => (
            <button
              disabled={emergency}
              key={q}
              onClick={() => setQty(q)}
              className="flex-1 rounded-md border border-border py-1 text-[11px] text-muted hover:border-accent/40 hover:text-tx disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {q}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between rounded-lg bg-panel2 px-3 py-2">
          <span className="text-[12px] text-dim">예상 주문금액</span>
          <span className="font-mono text-[14px] font-semibold tabular-nums text-tx">
            {fmtPrice(total, stock.market)}
          </span>
        </div>

        <button
          disabled={emergency}
          className={`w-full rounded-lg py-2.5 text-[14px] font-bold text-white transition-opacity hover:opacity-90 ${
            emergency ? "bg-dim cursor-not-allowed opacity-50" : side === "buy" ? "bg-up" : "bg-down"
          }`}
        >
          {emergency ? "주문 불가 (서킷브레이커)" : side === "buy" ? "매수 주문" : "매도 주문"}
        </button>
        <p className="text-center text-[10px] text-dim">
          {emergency ? "⚠️ 서킷브레이커가 발동되어 시장이 폐쇄되었습니다." : "데모 모드 — 실제 체결되지 않습니다"}
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-dim">{label}</span>
      {children}
    </label>
  );
}
