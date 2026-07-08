"use client";

import { useState, useEffect } from "react";
import type { Stock } from "@/lib/types";
import { calcYTM, calcMaturityProfit, fmtYTM, RISK_CATEGORY_KO } from "@/lib/bond-utils";
import { createClient } from "@/lib/supabase/client";

/**
 * 채권 상세 정보 패널
 * - YTM(만기수익률) 실시간 표시
 * - 만기 수익 시뮬레이터
 * - 표면금리 / 발행기관 정보
 */
export default function BondDetailPanel({ stock }: { stock: Stock }) {
  const bm = stock.bondMeta;
  const [currentPrice, setCurrentPrice] = useState(stock.currentPrice);
  const [qty, setQty] = useState(10);
  
  const supabase = createClient();

  // 실시간 가격 구독 (YTM 동기화)
  useEffect(() => {
    const channel = supabase
      .channel(`realtime_bond_price_${stock.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'stocks', filter: `id=eq.${stock.id}` },
        (payload) => {
          if (payload.new.current_price) {
            setCurrentPrice(payload.new.current_price);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stock.id, supabase]);

  if (!bm) return null;

  // 현재 가격 기준 실시간 YTM
  const liveYtm = calcYTM(currentPrice, bm.faceValue, bm.couponRate, bm.maturityYears);

  // 만기 수익 시뮬레이션 (100원 = 1주 기준, 실제 액면가로 환산)
  // 채권 시뮬에서 1주 = 액면가 10,000원 단위로 처리
  const FACE_UNIT = 10_000; // 1주 = 10,000원 (단순화)
  const purchasePrice = (currentPrice / bm.faceValue) * FACE_UNIT;
  const faceActual = FACE_UNIT;
  const profit = calcMaturityProfit({
    purchasePrice,
    faceValue: faceActual,
    couponRatePct: bm.couponRate,
    maturityYears: bm.maturityYears,
    quantity: qty,
  });

  const riskColor =
    bm.riskCategory === "sovereign"
      ? "text-accent"
      : bm.riskCategory === "corporate_ig"
      ? "text-up"
      : "text-down";

  const riskBg =
    bm.riskCategory === "sovereign"
      ? "bg-accent/15 border-accent/30"
      : bm.riskCategory === "corporate_ig"
      ? "bg-up/15 border-up/30"
      : "bg-down/15 border-down/30";

  return (
    <div className="rounded-xl border border-border bg-panel overflow-hidden">
      {/* 헤더 */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-tx">채권 정보</h3>
        <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${riskBg} ${riskColor}`}>
          {RISK_CATEGORY_KO[bm.riskCategory]}
        </span>
      </div>

      {/* YTM 메인 표시 */}
      <div className="px-4 py-4 border-b border-border bg-gradient-to-br from-panel to-panel2">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[11px] text-dim uppercase tracking-wider mb-1">만기수익률 (YTM)</div>
            <div className={`text-3xl font-bold font-mono tabular-nums ${liveYtm > bm.couponRate ? "text-up" : "text-down"}`}>
              {fmtYTM(liveYtm)}
            </div>
            <div className="text-[11px] text-muted mt-1">
              표면금리 {fmtYTM(bm.couponRate)} 기준
              {liveYtm > bm.couponRate
                ? <span className="text-up ml-1">↑ 할인 거래 중 (가격 ↓)</span>
                : <span className="text-down ml-1">↓ 프리미엄 거래 중 (가격 ↑)</span>
              }
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-dim mb-0.5">현재 가격 (액면 100 기준)</div>
            <div className="font-mono text-[18px] font-bold text-tx">{currentPrice.toFixed(2)}</div>
            <div className="text-[10px] text-dim mt-0.5">액면가 {bm.faceValue}</div>
          </div>
        </div>
      </div>

      {/* 채권 주요 지표 */}
      <div className="grid grid-cols-2 gap-px bg-border/40">
        <BondCell label="발행기관" value={bm.issuerName || "—"} />
        <BondCell label="국가" value={bm.countryCode} />
        <BondCell label="잔존만기" value={`${bm.maturityYears.toFixed(1)}년`} />
        <BondCell label="표면금리(쿠폰)" value={fmtYTM(bm.couponRate)} accent />
      </div>

      {/* 만기 수익 시뮬레이터 */}
      <div className="px-4 py-4 border-t border-border">
        <div className="text-[12px] font-semibold text-tx mb-3 flex items-center gap-2">
          📊 만기 보유 시 확정 수익 시뮬레이터
        </div>
        <div className="flex items-center gap-3 mb-3">
          <label className="text-[11px] text-dim whitespace-nowrap">매수 수량</label>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-right font-mono text-[13px] text-tx outline-none focus:border-accent/50"
          />
          <span className="text-[11px] text-dim">주</span>
        </div>

        <div className="rounded-lg border border-border bg-bg/60 p-3 space-y-2 text-[12px]">
          <div className="flex justify-between">
            <span className="text-dim">총 매수금액</span>
            <span className="font-mono text-tx">₩{(purchasePrice * qty).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-dim">쿠폰 이자 수입 (만기까지)</span>
            <span className="font-mono text-up">+₩{Math.round(profit.couponTotal).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-dim">자본손익 (만기 상환가 - 매수가)</span>
            <span className={`font-mono ${profit.capitalGain >= 0 ? "text-up" : "text-down"}`}>
              {profit.capitalGain >= 0 ? "+" : ""}₩{Math.round(profit.capitalGain).toLocaleString()}
            </span>
          </div>
          <div className="border-t border-border/60 pt-2 flex justify-between font-semibold">
            <span className="text-tx">예상 확정 수익 (세전)</span>
            <span className={`font-mono text-[14px] ${profit.total >= 0 ? "text-up" : "text-down"}`}>
              {profit.total >= 0 ? "+" : ""}₩{Math.round(profit.total).toLocaleString()}
            </span>
          </div>
          <div className="text-[10px] text-dim text-center mt-1">
            * 만기까지 보유 시 확정 수익 (중간 매도 시 시세 차익/손실 별도)
          </div>
        </div>

        {bm.riskCategory === "high_yield" && (
          <div className="mt-3 rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-[11px] text-down">
            ⚠️ <strong>하이일드 위험 경고</strong>: 발행사 부도 시 원금 전액 손실 가능. 높은 쿠폰 수익률은 신용 위험의 대가입니다.
          </div>
        )}
      </div>
    </div>
  );
}

function BondCell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-panel px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-dim">{label}</div>
      <div className={`mt-0.5 font-mono text-[13px] tabular-nums ${accent ? "text-accent font-bold" : "text-tx"}`}>
        {value}
      </div>
    </div>
  );
}
