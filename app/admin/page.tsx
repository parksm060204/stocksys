"use client";

import { useState, useEffect } from "react";
import { INSTITUTION, STOCKS, STOCK_METAS, LP_ENGINE } from "@/lib/mock-data";
import type { InstitutionStatus } from "@/lib/lp/institution";

interface SectorImpact {
  sector: string;
  impact: "positive" | "negative";
  score: number;
}

export default function AdminPage() {
  const [tab, setTab] = useState<"novel" | "ipo" | "actions" | "institution" | "priceLimits" | "marketTime" | "users" | "rates">("novel");

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-tx">관리자 페이지</h1>
        <p className="text-[13px] text-muted">웹소설 기입 · 신규 상장 · 상장폐지 · 주식 병합 · 세력 관리</p>
      </div>

      <div className="mb-5 flex gap-1 rounded-lg border border-border bg-panel p-1">
        {[
          { id: "novel", label: "웹소설 이벤트 기입" },
          { id: "ipo", label: "신규 상장 (IPO)" },
          { id: "actions", label: "상장폐지 / 병합" },
          { id: "institution", label: "세력 관리" },
          { id: "priceLimits", label: "상하한가 설정" },
          { id: "rates", label: "기준금리 🏦" },
          { id: "users", label: "유저 관리" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            className={`flex-1 rounded-md px-4 py-2 text-[13px] font-medium transition-colors ${
              tab === t.id ? "bg-panel2 text-tx" : "text-dim hover:text-tx"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "novel" && <NovelPanel />}
      {tab === "ipo" && <IpoPanel />}
      {tab === "actions" && <ActionsPanel />}
      {tab === "institution" && <InstitutionPanel />}
      {tab === "priceLimits" && <PriceLimitPanel />}
      {tab === "rates" && <RatePanel />}
      {tab === "users" && <UsersPanel />}
    </div>
  );
}

function NovelPanel() {
  const [text, setText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<{ summary: string; impacts: SectorImpact[] } | null>(null);

  const analyze = async () => {
    if (!text.trim()) return;
    setAnalyzing(true);
    setResult(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "분석 실패");
      
      const impacts = (data.impacts ?? []) as SectorImpact[];
      // Apply novel news impacts to the engine
      LP_ENGINE.onNews(impacts, true);

      setResult({
        summary: data.summary ?? "Gemini AI가 웹소설 텍스트를 분석해 섹터별 영향을 추출했습니다.",
        impacts,
      });
    } catch {
      setResult({ summary: "분석 중 오류가 발생했습니다.", impacts: [] });
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-panel p-5">
        <label className="mb-2 block text-[13px] font-semibold text-tx">
          웹소설 본문 붙여넣기
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder="최신 에피소드 텍스트를 여기에 붙여넣으세요. AI가 호재/악재를 판정하여 섹터별 점수를 산출하고, 각 기업의 목표가(target_price)를 갱신합니다."
          className="w-full resize-y rounded-lg border border-border bg-bg px-4 py-3 text-[13px] leading-relaxed text-tx outline-none placeholder:text-dim focus:border-accent/50"
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] text-dim">{text.length}자 입력됨</span>
          <button
            onClick={analyze}
            disabled={analyzing || !text.trim()}
            className="rounded-lg bg-accent px-5 py-2 text-[13px] font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {analyzing ? "AI 분석 중…" : "Gemini AI 분석 실행"}
          </button>
        </div>
      </div>

      {result && (
        <div className="rounded-xl border border-border bg-panel p-5">
          <h3 className="mb-1 text-[13px] font-semibold text-tx">AI 판정 결과</h3>
          <p className="mb-4 text-[12px] text-muted">{result.summary}</p>
          <div className="space-y-2">
            {result.impacts.map((i) => (
              <div
                key={i.sector}
                className="flex items-center justify-between rounded-lg bg-panel2 px-4 py-2.5"
              >
                <span className="text-[13px] font-medium text-tx">{i.sector}</span>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                      i.impact === "positive" ? "bg-up/15 text-up" : "bg-down/15 text-down"
                    }`}
                  >
                    {i.impact === "positive" ? "호재" : "악재"}
                  </span>
                  <span
                    className={`font-mono text-[14px] font-bold tabular-nums ${
                      i.score >= 0 ? "text-up" : "text-down"
                    }`}
                  >
                    {i.score >= 0 ? "+" : ""}{i.score.toFixed(1)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-accent/20 bg-accent/5 px-4 py-3 text-[12px] text-muted">
            ↳ 이 점수 × 각 기업의 <code className="text-accent">relevance_weight</code> 가 적용되어
            <code className="text-accent"> target_price</code> 가 갱신되고, LP 알고리즘이 새 목표가로 호가를 견인합니다.
          </div>
        </div>
      )}
    </div>
  );
}

function IpoPanel() {
  return (
    <div className="rounded-xl border border-border bg-panel p-5">
      <h3 className="mb-4 text-[13px] font-semibold text-tx">신규 상장 (IPO)</h3>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="종목명" placeholder="예: 스텔라 로보틱스" />
        <FormField label="티커" placeholder="예: STELLA" />
        <SelectField label="시장" options={["domestic", "overseas", "bonds", "options", "commodities", "etf"]} />
        <FormField label="섹터" placeholder="예: 로보틱스" />
        <FormField label="공모가" placeholder="예: 45000" />
        <FormField label="상장 주식 수" placeholder="예: 1000000" />
        <FormField label="섹터 민감도 (0.5~1.5)" placeholder="예: 1.2" />
        <SelectField label="핵심 종목 여부" options={["일반", "핵심(CORE)"]} />
        <div className="col-span-2">
          <FormField label="기업 설명 (스토리텔링)" placeholder="세계관 내 기업의 역할과 특성" />
        </div>
      </div>
      <button className="mt-4 w-full rounded-lg bg-accent py-2.5 text-[14px] font-bold text-black hover:opacity-90">
        신규 상장 처리
      </button>
    </div>
  );
}

function ActionsPanel() {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-panel p-5">
        <h3 className="mb-3 text-[13px] font-semibold text-tx">상장 폐지</h3>
        <FormField label="종목 선택" placeholder="티커 또는 종목명" />
        <button className="mt-3 w-full rounded-lg border border-down/40 bg-down/10 py-2 text-[13px] font-semibold text-down hover:bg-down/15">
          상장 폐지 처리
        </button>
      </div>

      <div className="rounded-xl border border-border bg-panel p-5">
        <h3 className="mb-3 text-[13px] font-semibold text-tx">주식 병합 / 액면 분할</h3>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="종목 선택" placeholder="티커 또는 종목명" />
          <SelectField label="처리 종류" options={["병합 (Reverse Split)", "액면 분할 (Split)"]} />
          <FormField label="비율 (예: 1:5)" placeholder="예: 5" />
          <FormField label="기준일" placeholder="YYYY-MM-DD" />
        </div>
        <button className="mt-3 w-full rounded-lg bg-panel2 py-2 text-[13px] font-semibold text-tx hover:bg-panel2/80">
          병합/분할 실행
        </button>
      </div>
    </div>
  );
}

function FormField({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-dim">{label}</span>
      <input
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-tx outline-none placeholder:text-dim focus:border-accent/50"
      />
    </label>
  );
}

function SelectField({ label, options }: { label: string; options: string[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-dim">{label}</span>
      <select className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-tx outline-none focus:border-accent/50">
        {options.map((o) => (
          <option key={o} value={o} className="bg-bg">
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

// === 세력 관리 패널 ===
const DOMESTIC_STOCKS = STOCKS.filter((s) => s.market === "domestic");

function InstitutionPanel() {
  const [selectedStockId, setSelectedStockId] = useState("");
  const [status, setStatus] = useState<InstitutionStatus | null>(null);
  const [, forceUpdate] = useState(0);

  // 1초마다 상태 갱신
  useEffect(() => {
    const interval = setInterval(() => {
      setStatus(INSTITUTION.getStatus());
      forceUpdate((n) => n + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const start = () => {
    if (!selectedStockId) return;
    const stock = STOCKS.find((s) => s.id === selectedStockId);
    const meta = STOCK_METAS.find((m) => m.id === selectedStockId);
    if (stock && meta) {
      INSTITUTION.setTarget(meta, stock.currentPrice);
      setStatus(INSTITUTION.getStatus());
    }
  };

  const stop = () => {
    INSTITUTION.stop();
    setStatus(INSTITUTION.getStatus());
  };

  const reset = () => {
    INSTITUTION.reset();
    setStatus(INSTITUTION.getStatus());
  };

  const stateColor = (state: string) => {
    switch (state) {
      case "ACCUMULATING": return "text-down";
      case "MARKUP": return "text-up";
      case "DISTRIBUTING": return "text-warn";
      case "COMPLETE": return "text-accent";
      default: return "text-dim";
    }
  };

  return (
    <div className="space-y-5">
      {/* 종목 선택 + 컨트롤 */}
      <div className="rounded-xl border border-border bg-panel p-5">
        <h3 className="mb-1 text-[13px] font-semibold text-tx">세력 작업 컨트롤</h3>
        <p className="mb-4 text-[12px] text-muted">
          국내 주식 중 하나를 지정하면 세력이 자동으로 매집 → 시세 조종 → 분배 작업을 수행합니다.
        </p>

        <div className="flex gap-3">
          <select
            value={selectedStockId}
            onChange={(e) => setSelectedStockId(e.target.value)}
            disabled={status?.state !== "IDLE" && status?.state !== "COMPLETE"}
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-tx outline-none focus:border-accent/50 disabled:opacity-50"
          >
            <option value="">— 종목 선택 —</option>
            {DOMESTIC_STOCKS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.ticker}) — {s.sector}
              </option>
            ))}
          </select>

          <button
            onClick={start}
            disabled={!selectedStockId || (status?.state !== "IDLE" && status?.state !== "COMPLETE")}
            className="rounded-lg bg-up px-5 py-2 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            작업 시작
          </button>

          <button
            onClick={stop}
            disabled={status?.state === "IDLE" || status?.state === "COMPLETE"}
            className="rounded-lg border border-down/40 bg-down/10 px-5 py-2 text-[13px] font-semibold text-down transition-colors hover:bg-down/15 disabled:opacity-40"
          >
            강제 중단
          </button>

          <button
            onClick={reset}
            disabled={status?.state !== "IDLE" && status?.state !== "COMPLETE"}
            className="rounded-lg border border-border px-4 py-2 text-[13px] text-dim transition-colors hover:text-tx disabled:opacity-40"
          >
            리셋
          </button>
        </div>
      </div>

      {/* 상태 대시보드 */}
      {status && status.state !== "IDLE" && (
        <div className="rounded-xl border border-border bg-panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-tx">세력 상태</h3>
            <span className={`text-[13px] font-bold ${stateColor(status.state)}`}>
              ● {status.phaseLabel}
            </span>
          </div>

          <p className="mb-4 text-[12px] text-muted">{status.message}</p>

          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatBox label="대상 종목" value={status.targetStockName ?? "-"} sub={status.targetTicker ?? ""} />
            <StatBox
              label="시작가 → 현재가"
              value={`${Math.round(status.startPrice).toLocaleString()} → ${Math.round(status.currentPrice).toLocaleString()}`}
              sub={`${status.priceChangePct >= 0 ? "+" : ""}${status.priceChangePct.toFixed(1)}%`}
              tone={status.priceChangePct >= 0 ? "up" : "down"}
            />
            <StatBox
              label="매집 주식"
              value={`${status.accumulatedShares.toLocaleString()}주`}
              sub={`${status.accumulatedPct.toFixed(2)}% (목표 3%)`}
            />
            <StatBox
              label="평단가"
              value={Math.round(status.avgBuyPrice).toLocaleString()}
              sub={`투자금 ${Math.round(status.totalInvested / 1_000_000_000).toLocaleString()}억`}
            />
          </div>

          {/* 진행 바 */}
          <div className="mb-4 space-y-3">
            <ProgressBar
              label="매집 진행률"
              current={status.accumulatedPct}
              target={3}
              color="bg-down"
            />
            <ProgressBar
              label="분배 진행률"
              current={status.distributedPct}
              target={100}
              color="bg-warn"
            />
          </div>

          {/* 수익 현황 */}
          {status.distributedShares > 0 && (
            <div className="mb-4 rounded-lg bg-panel2 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-dim">실현 수익</span>
                <span
                  className={`font-mono text-[15px] font-bold tabular-nums ${
                    status.realizedPnl >= 0 ? "text-up" : "text-down"
                  }`}
                >
                  {status.realizedPnl >= 0 ? "+" : ""}
                  {Math.round(status.realizedPnl).toLocaleString()} ({status.realizedPnlPct.toFixed(1)}%)
                </span>
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-dim">
                <span>매도 {status.distributedShares.toLocaleString()}주</span>
                <span>회수금 {Math.round(status.totalRecovered / 1_000_000_000).toLocaleString()}억</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 작업 로그 */}
      {status && status.history.length > 0 && (
        <div className="rounded-xl border border-border bg-panel p-5">
          <h3 className="mb-3 text-[13px] font-semibold text-tx">작업 로그</h3>
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {status.history.map((h, i) => (
              <div key={i} className="flex gap-3 rounded-lg bg-panel2/50 px-3 py-2 text-[12px]">
                <span className="font-mono text-dim">{h.time}</span>
                <span className="font-semibold text-tx">{h.phase}</span>
                <span className="flex-1 text-muted">{h.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 세력 패턴 설명 */}
      <div className="rounded-xl border border-border bg-panel p-5">
        <h3 className="mb-3 text-[13px] font-semibold text-tx">세력 작업 패턴 (실제 시장 패턴 기반)</h3>
        <div className="space-y-3 text-[12px] text-muted">
          <PatternStep
            num="1"
            title="매집 (Accumulation)"
            color="text-down"
            desc="주가를 누르면서 저가에 소량씩 매수. 매도벽(capping)으로 저항선 형성하여 가격 상승 억제. Iceberg 주문으로 매집 사실 은폐. 시장 풀린 주식의 3% 이상 매집 시 다음 phase로 전환."
          />
          <PatternStep
            num="2"
            title="시세 조종 (Markup)"
            color="text-up"
            desc="급격한 매수(ramping)로 주가 상승 연출. 연속 상승봉 패턴으로 개미 투자자 유인. 거래량 부풀리기(wash trades). 시작가 대비 +25% 목표."
          />
          <PatternStep
            num="3"
            title="분배 (Distribution)"
            color="text-warn"
            desc="매수 지지벽(support wall)으로 강세 연출하면서 보유 주식 매도. 개미가 매수하는 틈을 타 분배. 주가는 상승세 유지하며 매도. 전량 매도 시 작업 완료."
          />
        </div>
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down";
}) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-tx";
  return (
    <div className="rounded-lg bg-panel2 p-3">
      <div className="text-[10px] uppercase tracking-wider text-dim">{label}</div>
      <div className={`mt-1 font-mono text-[14px] font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-dim">{sub}</div>}
    </div>
  );
}

function ProgressBar({
  label,
  current,
  target,
  color,
}: {
  label: string;
  current: number;
  target: number;
  color: string;
}) {
  const pct = Math.min((current / target) * 100, 100);
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px]">
        <span className="text-dim">{label}</span>
        <span className="font-mono text-muted">
          {current.toFixed(2)}% / {target}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-bg">
        <div
          className={`h-full ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function PatternStep({
  num,
  title,
  color,
  desc,
}: {
  num: string;
  title: string;
  color: string;
  desc: string;
}) {
  return (
    <div className="flex gap-3">
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full bg-panel2 text-[11px] font-bold ${color}`}>
        {num}
      </span>
      <div>
        <span className={`font-semibold ${color}`}>{title}</span>
        <p className="mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

// === 상하한가 설정 패널 ===
const MARKET_NAMES: Record<string, string> = {
  domestic: "한국 주식 (KR)",
  overseas: "미국 주식 (US)",
  europe: "유럽 주식 (EU)",
  bonds: "채권 시장",
  options: "파생/옵션",
  commodities: "원자재 선물",
  etf: "ETF/지수",
};

function PriceLimitPanel() {
  const [, forceUpdate] = useState(0);

  // 로컬 폼 상태
  const [limits, setLimits] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const [m, val] of Object.entries(LP_ENGINE.priceLimits)) {
      init[m] = val === null ? "무제한" : (val * 100).toString();
    }
    return init;
  });

  const handleChange = (marketId: string, value: string) => {
    setLimits(prev => ({ ...prev, [marketId]: value }));
  };

  const handleSave = () => {
    for (const [m, val] of Object.entries(limits)) {
      if (val === "무제한" || val.trim() === "") {
        LP_ENGINE.setPriceLimit(m as any, null);
      } else {
        const num = parseFloat(val);
        if (!isNaN(num)) {
          LP_ENGINE.setPriceLimit(m as any, num / 100);
        }
      }
    }
    forceUpdate(n => n + 1);
    alert("상하한가 설정이 즉시 적용되었습니다.");
  };

  return (
    <div className="rounded-xl border border-border bg-panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="mb-1 text-[13px] font-semibold text-tx">각 시장별 상하한가 설정</h3>
          <p className="text-[12px] text-muted">
            퍼센티지(%) 숫자를 입력하세요. (예: 30 = ±30%). 제한을 없애려면 '무제한'으로 입력하세요. 저장 시 엔진에 즉각 반영됩니다.
          </p>
        </div>
        <button 
          onClick={handleSave}
          className="rounded-lg bg-accent px-5 py-2 text-[13px] font-bold text-black transition-opacity hover:opacity-90"
        >
          저장 및 즉시 적용
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(limits).map(([marketId, limitStr]) => (
          <div key={marketId} className="flex items-center justify-between rounded-lg bg-panel2 p-4">
            <span className="text-[13px] font-bold text-tx">{MARKET_NAMES[marketId] || marketId}</span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={limitStr}
                onChange={(e) => handleChange(marketId, e.target.value)}
                placeholder="무제한 or 숫자"
                className="w-24 rounded border border-border bg-bg px-2 py-1.5 text-center font-mono text-[13px] text-tx outline-none focus:border-accent/50"
              />
              <span className="text-dim text-[12px]">%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// === 유저 관리 패널 ===
function UsersPanel() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<"ALL" | "AI" | "REAL">("ALL");
  const [, forceUpdate] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 실시간으로 갱신하지 않고, 새로고침 버튼으로 갱신 (부하 방지)
  const accounts = LP_ENGINE.accounts;

  const filtered = accounts.filter(a => {
    if (filterType === "AI" && a.isRealUser) return false;
    if (filterType === "REAL" && !a.isRealUser) return false;
    return (
      a.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (a.name && a.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      a.investorCategory.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  return (
    <div className="rounded-xl border border-border bg-panel p-5">
      <div className="mb-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="mb-1 text-[13px] font-semibold text-tx">유저 및 계좌 자산 관리</h3>
          <p className="text-[12px] text-muted">총 {accounts.length}개의 활성 계좌가 존재합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <select 
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="rounded-lg border border-border bg-bg px-3 py-2 text-[12px] text-tx outline-none focus:border-accent/50"
          >
            <option value="ALL">모든 계좌 보기</option>
            <option value="AI">AI 봇 계좌만 보기</option>
            <option value="REAL">실제 유저 계좌만 보기</option>
          </select>
          <button 
            onClick={() => forceUpdate(n => n + 1)}
            className="rounded-lg border border-border px-4 py-2 text-[12px] text-tx hover:bg-panel2"
          >
            🔄 새로고침
          </button>
        </div>
      </div>

      <input
        type="text"
        placeholder="계좌 ID, 이름 또는 분류 검색..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="mb-4 w-full rounded-lg border border-border bg-bg px-4 py-2 text-[13px] text-tx outline-none placeholder:text-dim focus:border-accent/50"
      />

      <div className="max-h-[600px] overflow-y-auto">
        <table className="w-full text-left text-[12px]">
          <thead className="sticky top-0 bg-panel text-dim border-b border-border">
            <tr>
              <th className="pb-2 px-2">ID / 분류</th>
              <th className="pb-2 px-2 text-right">보유 현금</th>
              <th className="pb-2 px-2">보유 주식 (종목 수)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {filtered.map(a => {
              const holdingsCount = Object.keys(a.holdings).length;
              return (
                <tr key={a.id} className="hover:bg-panel2/50">
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-tx">{a.name || a.id}</span>
                      {a.isRealUser && (
                        <span className="rounded bg-up/15 px-1.5 py-px text-[9px] font-bold text-up">
                          REAL USER
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted">{a.investorCategory} {a.isRealUser ? "" : "(AI BOT)"}</div>
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-tx">
                    {Math.round(a.cash).toLocaleString()}
                  </td>
                  <td className="py-3 px-2">
                    {holdingsCount > 0 ? (
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium text-tx">{holdingsCount}종목 보유</span>
                          <button 
                            onClick={() => toggleExpand(a.id)}
                            className="rounded px-1.5 py-0.5 text-[10px] border border-border bg-panel2 text-dim hover:text-tx transition-colors"
                          >
                            {expandedIds.has(a.id) ? "접기" : "상세보기"}
                          </button>
                        </div>
                        {expandedIds.has(a.id) && (
                          <div className="mt-2 max-h-32 overflow-y-auto space-y-1 rounded border border-border/50 bg-bg p-2">
                            {Object.entries(a.holdings).map(([stockId, h]) => {
                              const stock = STOCKS.find(s => s.id === stockId);
                              const stockName = stock?.name || stockId;
                              
                              const holdingValue = h.quantity * h.avgPrice;
                              const pct = a.capital > 0 ? ((holdingValue / a.capital) * 100).toFixed(4) : "0.0000";

                              return (
                                <div key={stockId} className="flex justify-between items-center text-[10px] py-0.5">
                                  <span className="text-muted truncate w-32" title={stockName}>{stockName}</span>
                                  <span className="font-mono text-tx text-right flex-1">
                                    {h.quantity.toLocaleString()}주 <span className="text-accent/80 text-[9px]">({pct}%)</span>
                                  </span>
                                  <span className="font-mono text-dim w-36 text-right">평균단가: {Math.round(h.avgPrice).toLocaleString()}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-dim text-[10px]">보유 종목 없음</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RatePanel() {
  const [baseRate, setBaseRate] = useState(LP_ENGINE.baseRate);
  const [log, setLog] = useState<string[]>([]);

  const applyShock = (direction: "hike" | "cut", bps: number) => {
    LP_ENGINE.applyInterestRateShock(direction, bps);
    setBaseRate(LP_ENGINE.baseRate);
    const label = direction === "hike" ? `📈 금리 인상 +${bps}bp` : `📉 금리 인하 -${bps}bp`;
    const now = new Date().toLocaleTimeString("ko-KR");
    setLog((prev) => [`[${now}] ${label} → 기준금리 ${LP_ENGINE.baseRate.toFixed(2)}%`, ...prev.slice(0, 9)]);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-panel p-5">
        <h2 className="text-[15px] font-bold text-tx mb-1">🏦 중앙은행 기준금리 조작</h2>
        <p className="text-[12px] text-muted mb-4">
          금리 인상 → 채권 가격 하락 / 금리 인하 → 채권 가격 상승 (역상관관계).<br />
          충격 적용 시 모든 채권 종목의 목표가(targetPrice)가 즉시 변동됩니다.
        </p>

        {/* 현재 기준금리 */}
        <div className="flex items-center justify-center mb-6">
          <div className="text-center">
            <div className="text-[11px] text-dim uppercase tracking-wider">현재 기준금리</div>
            <div className="text-4xl font-bold font-mono text-accent mt-1">{baseRate.toFixed(2)}%</div>
          </div>
        </div>

        {/* 조작 버튼들 */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="space-y-2">
            <div className="text-[11px] text-dim font-medium mb-1">📈 금리 인상 (채권 가격 ↓)</div>
            {[25, 50, 100].map((bps) => (
              <button
                key={`hike-${bps}`}
                onClick={() => applyShock("hike", bps)}
                className="w-full rounded-lg border border-down/40 bg-down/10 px-4 py-2.5 text-[13px] font-semibold text-down hover:bg-down/20 transition-colors"
              >
                +{bps}bp 인상
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <div className="text-[11px] text-dim font-medium mb-1">📉 금리 인하 (채권 가격 ↑)</div>
            {[25, 50, 100].map((bps) => (
              <button
                key={`cut-${bps}`}
                onClick={() => applyShock("cut", bps)}
                className="w-full rounded-lg border border-up/40 bg-up/10 px-4 py-2.5 text-[13px] font-semibold text-up hover:bg-up/20 transition-colors"
              >
                -{bps}bp 인하
              </button>
            ))}
          </div>
        </div>

        {/* Risk-On / Risk-Off 설명 */}
        <div className="grid grid-cols-2 gap-3 text-[11px]">
          <div className="rounded-lg border border-down/30 bg-down/5 p-3">
            <div className="font-semibold text-down mb-1">⚠️ Risk-Off 발동</div>
            <div className="text-muted">악재 뉴스(전쟁·부도) → 채권 LP들이 주식 매도 후 국채 매수. 채권 가격 ↑, 주식 가격 ↓</div>
          </div>
          <div className="rounded-lg border border-up/30 bg-up/5 p-3">
            <div className="font-semibold text-up mb-1">🚀 Risk-On 발동</div>
            <div className="text-muted">호재 뉴스(경기 호황) → LP들이 국채 매도 후 주식 매수. 채권 가격 ↓, 주식 가격 ↑</div>
          </div>
        </div>
      </div>

      {/* 조작 로그 */}
      {log.length > 0 && (
        <div className="rounded-xl border border-border bg-panel p-4">
          <h3 className="text-[12px] font-semibold text-tx mb-2">조작 이력</h3>
          <div className="space-y-1">
            {log.map((entry, i) => (
              <div key={i} className="text-[11px] font-mono text-muted">{entry}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

