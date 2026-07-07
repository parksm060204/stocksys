import { generateAllStocks, getMarketCapSummary } from "../lib/stock-data";
import { capLabel } from "../lib/lp/config";
import {
  generateAccounts,
  totalLPCapital,
  totalMacroCapital,
  formatCapital,
  getAccountGroups,
  getPlayerTypeLabel,
  getBotStyleLabel,
  getAlgoLabel,
  getBondGradeLabel,
  getDerivativePurposeLabel,
} from "../lib/lp/accounts";
import { TRILLION } from "../lib/lp/config";
import * as fs from "fs";
import * as path from "path";

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function main() {
  const { metas } = generateAllStocks();

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // === stocks.csv ===
  const csvPath = path.join(dataDir, "stocks.csv");
  const headers = [
    "id", "ticker", "name", "market", "sector", "market_cap",
    "market_cap_label", "cap_class", "is_core", "relevance_weight",
    "shares_outstanding", "initial_price", "description",
  ];

  const rows = metas.map((m) => [
    m.id,
    m.ticker,
    escapeCsv(m.name),
    m.market,
    escapeCsv(m.sector),
    m.marketCap,
    formatCapital(m.marketCap),
    capLabel(m.marketCap),
    m.isCore ? "Y" : "N",
    m.relevanceWeight,
    m.sharesOutstanding,
    m.initialPrice,
    escapeCsv(m.description),
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  fs.writeFileSync(csvPath, "\uFEFF" + csv, "utf-8");
  console.log(`stocks.csv: ${metas.length} rows`);

  // === lp_accounts.csv (상세 버전) ===
  const accounts = generateAccounts();
  const lpPath = path.join(dataDir, "lp_accounts.csv");
  const lpHeaders = [
    "id", "type", "name", "player_type", "player_type_label",
    "bot_style", "bot_style_label", "market_focus",
    "algo_pattern", "algo_label",
    "capital", "capital_label",
    "aggressiveness", "patience", "sector_bias",
    "defense_threshold", "news_sensitivity", "trade_frequency",
    "stock_max_pct", "bond_max_pct", "derivative_max_pct", "cash_min_pct",
    "bond_grade", "derivative_purpose",
    "stock_style", "bond_style", "derivative_style", "rationale",
    "description",
  ];

  const lpRows = accounts.map((a) => [
    a.id,
    a.type,
    escapeCsv(a.name),
    a.playerType,
    getPlayerTypeLabel(a.playerType),
    a.botStyle,
    getBotStyleLabel(a.botStyle),
    a.marketFocus,
    a.algoPattern,
    getAlgoLabel(a.algoPattern),
    a.capital,
    formatCapital(a.capital),
    a.aggressiveness.toFixed(2),
    a.patience.toFixed(2),
    a.sectorBias ?? "",
    a.defenseThreshold.toFixed(1),
    a.newsSensitivity.toFixed(2),
    a.tradeFrequency.toFixed(2),
    a.allocation.stockMax,
    a.allocation.bondMax,
    a.allocation.derivativeMax,
    a.allocation.cashMin,
    getBondGradeLabel(a.allocation.bondGrade),
    getDerivativePurposeLabel(a.allocation.derivativePurpose),
    escapeCsv(a.allocation.stockStyle),
    escapeCsv(a.allocation.bondStyle),
    escapeCsv(a.allocation.derivativeStyle),
    escapeCsv(a.allocation.rationale),
    escapeCsv(a.description),
  ]);

  const lpCsv = [lpHeaders.join(","), ...lpRows.map((r) => r.join(","))].join("\n");
  fs.writeFileSync(lpPath, "\uFEFF" + lpCsv, "utf-8");
  console.log(`lp_accounts.csv: ${accounts.length} rows`);

  // === Summary ===
  const capSummary = getMarketCapSummary(metas);
  console.log("\n=== Market Cap Summary ===");
  for (const [market, cap] of Object.entries(capSummary)) {
    console.log(`  ${market}: ${formatCapital(cap)}`);
  }
  console.log(`  domestic target: ${formatCapital(4000 * TRILLION)}`);
  console.log(`  overseas target: ${formatCapital(5 * 10_000 * TRILLION)}`);

  const groups = getAccountGroups(accounts);
  console.log("\n=== LP System ===");
  console.log(`  국내중심 LP: ${groups.domestic.length}계좌`);
  for (const a of groups.domestic) {
    console.log(`    ${a.id} ${a.name} — ${formatCapital(a.capital)} — ${getAlgoLabel(a.algoPattern)}`);
  }
  console.log(`  해외중심 LP: ${groups.overseas.length}계좌`);
  const osTotal = groups.overseas.reduce((s, a) => s + a.capital, 0);
  console.log(`    총자본: ${formatCapital(osTotal)}`);
  console.log(`  세계적 IB: ${groups.ib.length}계좌 × ${formatCapital(groups.ib[0]?.capital ?? 0)}`);
  console.log(`  매크로: ${groups.macro.length}계좌 × ${formatCapital(groups.macro[0]?.capital ?? 0)}`);

  console.log(`\n  LP 총자본: ${formatCapital(totalLPCapital())}`);
  console.log(`  매크로 총자본: ${formatCapital(totalMacroCapital())}`);
  console.log(`  전체 총자본: ${formatCapital(totalLPCapital() + totalMacroCapital())}`);

  // Player type별 분포
  console.log("\n=== Player Type 분포 ===");
  const typeCounts: Record<string, number> = {};
  for (const a of accounts) {
    typeCounts[a.playerType] = (typeCounts[a.playerType] ?? 0) + 1;
  }
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  ${getPlayerTypeLabel(type as "PENSION")}: ${count}계좌`);
  }

  // Algo pattern별 분포
  console.log("\n=== Algo Pattern 분포 ===");
  const algoCounts: Record<string, number> = {};
  for (const a of accounts) {
    algoCounts[a.algoPattern] = (algoCounts[a.algoPattern] ?? 0) + 1;
  }
  for (const [algo, count] of Object.entries(algoCounts)) {
    console.log(`  ${getAlgoLabel(algo as "DEFENDER")}: ${count}계좌`);
  }
}

main();
