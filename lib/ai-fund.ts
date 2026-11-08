// The fund block of the AI context for ETFs and mutual funds: what the fund holds (top holdings and sector weights from
// quoteSummary topHoldings), what it costs and what it is (fundProfile). Pure: lib/server/ai-context.ts makes the one
// cached quoteSummary call and passes the raw modules here.

import type { Quote } from "@/types/api";

import { cleanInline, fmtChangePercent, fmtCompact, fmtRatio, isFiniteNumber } from "./ai-format";

const MAX_HOLDINGS = 10;
const MAX_SECTORS = 8;

export interface FundHolding {
  symbol: string | null;
  name: string;
  /** Share of assets (decimal). */
  weight: number;
}

export interface FundData {
  category: string | null;
  family: string | null;
  legalType: string | null;
  /** Annual expense ratio from the fund profile (decimal); the quote's net expense ratio is preferred when known. */
  expenseRatio: number | null;
  holdings: FundHolding[];
  sectorWeights: Array<{ sector: string; weight: number }>;
  stockShare: number | null;
  bondShare: number | null;
  /** Valuation of the equity holdings. */
  priceToEarnings: number | null;
  priceToBook: number | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = record(value)?.raw;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Yahoo's sector keys ("consumer_cyclical", "realestate") in words. */
export function sectorName(key: string): string {
  const named: Record<string, string> = { realestate: "real estate" };
  return named[key] ?? key.replace(/_/g, " ");
}

/** Maps raw quoteSummary { topHoldings, fundProfile } modules; null when neither carries anything usable. */
export function mapFundData(raw: Record<string, unknown> | null | undefined): FundData | null {
  const top = record(raw?.topHoldings);
  const profile = record(raw?.fundProfile);
  if (!top && !profile) return null;

  const holdings = (Array.isArray(top?.holdings) ? top.holdings : [])
    .map((item): FundHolding | null => {
      const row = record(item);
      const weight = num(row?.holdingPercent);
      const name = str(row?.holdingName) ?? str(row?.symbol);
      if (!row || !name || weight === null || weight <= 0) return null;
      return { symbol: str(row.symbol), name, weight };
    })
    .filter((holding): holding is FundHolding => holding !== null)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_HOLDINGS);

  const sectorWeights = (Array.isArray(top?.sectorWeightings) ? top.sectorWeightings : [])
    .flatMap((item) => Object.entries(record(item) ?? {}))
    .map(([sector, value]) => ({ sector: sectorName(sector), weight: num(value) }))
    .filter((entry): entry is { sector: string; weight: number } => entry.weight !== null && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_SECTORS);

  const equity = record(top?.equityHoldings);
  const fees = record(profile?.feesExpensesInvestment);
  const data: FundData = {
    category: str(profile?.categoryName),
    family: str(profile?.family),
    legalType: str(profile?.legalType),
    expenseRatio: num(fees?.annualReportExpenseRatio),
    holdings,
    sectorWeights,
    stockShare: num(top?.stockPosition),
    bondShare: num(top?.bondPosition),
    priceToEarnings: num(equity?.priceToEarnings),
    priceToBook: num(equity?.priceToBook),
  };
  const empty = !data.category && !data.family && data.expenseRatio === null && holdings.length === 0 && sectorWeights.length === 0;
  return empty ? null : data;
}

/** The fund block; `quote` adds the net expense ratio, net assets and year-to-date return from the quote. */
export function fundBlock(fund: FundData | null, quote: Quote | null): string {
  const expense = quote?.expenseRatio ?? fund?.expenseRatio ?? null;
  const facts = [
    fund?.category ? `category ${cleanInline(fund.category, 60)}` : null,
    fund?.family ? `family ${cleanInline(fund.family, 60)}` : null,
    fund?.legalType ? `legal type ${cleanInline(fund.legalType, 40)}` : null,
    isFiniteNumber(expense) ? `expense ratio ${fmtRatio(expense, 2)} a year` : null,
    isFiniteNumber(quote?.netAssets) ? `net assets ${fmtCompact(quote?.netAssets, quote?.currency)}` : null,
    isFiniteNumber(quote?.ytdReturnPercent) ? `year to date ${fmtChangePercent(quote?.ytdReturnPercent)}` : null,
  ].filter(Boolean);
  if (!fund && facts.length === 0) return "Fund profile: not available.";
  const lines = ["Fund profile (Yahoo fund data, may lag by weeks):"];
  if (facts.length > 0) lines.push(`- ${facts.join("; ")}`);
  if (fund && fund.holdings.length > 0) {
    const total = fund.holdings.reduce((sum, holding) => sum + holding.weight, 0);
    const items = fund.holdings.map((holding) => `${holding.symbol ? `${cleanInline(holding.symbol, 16)} ` : ""}${cleanInline(holding.name, 40)} ${fmtRatio(holding.weight)}`);
    lines.push(`- top ${fund.holdings.length} holdings, ${fmtRatio(total)} of assets (Yahoo lists only these, so exposure beyond them is unknown): ${items.join(", ")}`);
  }
  if (fund && fund.sectorWeights.length > 0) {
    lines.push(`- sector weights: ${fund.sectorWeights.map((entry) => `${cleanInline(entry.sector, 30)} ${fmtRatio(entry.weight)}`).join(", ")}`);
  }
  if (fund) {
    // Yahoo's holdings P/E and P/B come in inconsistent units (seen as 0.0x and 0.2x for SPY), so they are left out.
    const mix = [isFiniteNumber(fund.stockShare) ? `stocks ${fmtRatio(fund.stockShare)}` : null, isFiniteNumber(fund.bondShare) ? `bonds ${fmtRatio(fund.bondShare)}` : null].filter(Boolean);
    if (mix.length > 0) lines.push(`- asset mix: ${mix.join(", ")}`);
  }
  return lines.join("\n");
}
