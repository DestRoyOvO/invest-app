// Pure helpers behind the research tabs (financials, dividends, ownership), kept free of React so they can be tested.

import type { FinancialPeriod } from "@/types/research";

export type FinancialRowKey =
  | "revenue"
  | "grossMargin"
  | "operatingMargin"
  | "netMargin"
  | "eps"
  | "ebitda"
  | "operatingCashFlow"
  | "capex"
  | "freeCashFlow"
  | "buybacks"
  | "dividendsPaid";

/** How a row's year-over-year change is measured. */
export type ChangeKind = "growth" | "outflow" | "points";

export interface FinancialRowSpec {
  key: FinancialRowKey;
  value: (period: FinancialPeriod) => number | null;
  /** amount: compact currency; ratio: percent; perShare: price-style decimals. */
  format: "amount" | "ratio" | "perShare";
  change: ChangeKind;
}

export const FINANCIAL_ROWS: readonly FinancialRowSpec[] = [
  { key: "revenue", value: (p) => p.revenue, format: "amount", change: "growth" },
  { key: "grossMargin", value: (p) => p.grossMargin, format: "ratio", change: "points" },
  { key: "operatingMargin", value: (p) => p.operatingMargin, format: "ratio", change: "points" },
  { key: "netMargin", value: (p) => p.netMargin, format: "ratio", change: "points" },
  { key: "eps", value: (p) => p.dilutedEps, format: "perShare", change: "growth" },
  { key: "ebitda", value: (p) => p.ebitda, format: "amount", change: "growth" },
  { key: "operatingCashFlow", value: (p) => p.operatingCashFlow, format: "amount", change: "growth" },
  { key: "capex", value: (p) => p.capitalExpenditure, format: "amount", change: "outflow" },
  { key: "freeCashFlow", value: (p) => p.freeCashFlow, format: "amount", change: "growth" },
  { key: "buybacks", value: (p) => p.buybacks, format: "amount", change: "outflow" },
  { key: "dividendsPaid", value: (p) => p.dividendsPaid, format: "amount", change: "outflow" },
];

const DAY_MS = 86_400_000;

/**
 * Index of the period that ended about a year before the latest one (within 45 days): the previous fiscal year, the
 * same quarter a year earlier, or the same half for companies that report twice a year. Null when the data does not
 * reach that far or a period is missing.
 */
export function yearAgoIndex(ends: readonly string[]): number | null {
  if (ends.length < 2) return null;
  const target = Date.parse(`${ends[ends.length - 1]}T00:00:00Z`) - 365 * DAY_MS;
  let best: number | null = null;
  ends.slice(0, -1).forEach((end, i) => {
    const gap = Math.abs(Date.parse(`${end}T00:00:00Z`) - target);
    if (gap <= 45 * DAY_MS && (best === null || gap < Math.abs(Date.parse(`${ends[best]}T00:00:00Z`) - target))) best = i;
  });
  return best;
}

/**
 * Year-over-year change of the latest period. growth: relative change, only from a positive base (a swing from a
 * loss has no meaningful rate); outflow: relative change of the cash spent (capex, buybacks, dividends are negative
 * as reported); points: change of a margin in percentage points. Null when either period is missing.
 */
export function yearOverYear(values: ReadonlyArray<number | null>, ends: readonly string[], kind: ChangeKind): number | null {
  const latest = values.at(-1) ?? null;
  const index = yearAgoIndex(ends);
  const prior = index === null ? null : values[index];
  if (latest === null || prior === null || latest === undefined || prior === undefined) return null;
  if (kind === "points") return (latest - prior) * 100;
  if (kind === "outflow") return Math.abs(prior) > 0 ? Math.abs(latest) / Math.abs(prior) - 1 : null;
  return prior > 0 ? latest / prior - 1 : null;
}

/**
 * Prefixes an unsigned figure ("2.0%", "0.4") with + or a true minus by the sign of `value`, and with neither when the
 * figure shows as zero, so a change that rounds to zero reads "0.0%" rather than "−0.0%".
 */
export function signedFigure(text: string, value: number): string {
  if (!/[1-9]/.test(text)) return text;
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

/** Bar lengths for one row (percent of the largest magnitude in it); null for missing values. */
export function barWidths(values: ReadonlyArray<number | null>): Array<number | null> {
  const most = Math.max(0, ...values.map((v) => (v === null ? 0 : Math.abs(v))));
  return values.map((v) => (v === null ? null : most > 0 ? (Math.abs(v) / most) * 100 : 0));
}

/** Fiscal year of a period end (companies name a fiscal year after the calendar year it ends in). */
export function fiscalYear(end: string): number {
  return Number(end.slice(0, 4));
}

/**
 * Digits for a per-share cash amount: two from 0.10 up (0.52, 2.04), otherwise up to four without trailing zeros
 * (0.01, 0.004, 0.0005), so tiny split-adjusted dividends stay readable.
 */
export function perShareDigits(value: number): { min: number; max: number } {
  return Math.abs(value) >= 0.1 ? { min: 2, max: 2 } : { min: 2, max: 4 };
}

/**
 * Yahoo writes insider names in capitals ("TETER TIMOTHY S"); this sets them in title case for reading. Names that
 * already mix cases are left alone.
 */
export function readableName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase());
}

/** Annual dividend income and yield on cost for a position, at the forward (or trailing) annual rate per share. */
export function dividendIncome(position: { shares: number; cost: number }, annualPerShare: number | null): { income: number; yieldOnCost: number } | null {
  if (annualPerShare === null || !Number.isFinite(annualPerShare) || annualPerShare <= 0 || position.cost <= 0) return null;
  return { income: position.shares * annualPerShare, yieldOnCost: annualPerShare / position.cost };
}
