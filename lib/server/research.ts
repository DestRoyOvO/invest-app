import "server-only";

import type {
  DividendFrequency,
  DividendHistory,
  DividendPayment,
  DividendYear,
  FinancialPeriod,
  FinancialStatements,
  HolderBreakdown,
  InsiderSummary,
  InsiderTrade,
  InsiderTradeKind,
  InstitutionHolder,
  OwnershipData,
} from "@/types/research";
import type { Quote } from "@/types/api";
import { normalizeDividends, toMs, type RawChart } from "@/lib/bars";

import { cached, HOUR, isFresh, MINUTE } from "./cache";
import { logThrottled } from "./log";
import { callOptions, getQuote, getSummary, num, str, upstream, yf } from "./yahoo";

// Research tabs of the quote page: financial statements (fundamentalsTimeSeries), dividend history (chart events plus
// the quote) and ownership (one quoteSummary call). Contract in types/research.ts. Every Yahoo call goes through
// upstream() with callOptions(); each loader is cached as a whole, and lib/server/charging.ts charges its calls.

const DAY_MS = 86_400_000;

/** Calls behind one uncached load, for lib/server/charging.ts. */
export const FINANCIALS_CALLS = 4; // annual and quarterly x financials and cash flow (the summary is counted apart)
export const DIVIDENDS_CALLS = 1; // one chart call (the quote is counted apart)
export const OWNERSHIP_CALLS = 1;

function financialsKey(symbol: string): string {
  return `research:financials:${symbol}`;
}
function dividendsKey(symbol: string): string {
  return `research:dividends:${symbol}`;
}
function ownershipKey(symbol: string): string {
  return `research:ownership:${symbol}`;
}

export function hasCachedFinancials(symbol: string): boolean {
  return isFresh(financialsKey(symbol));
}
export function hasCachedDividends(symbol: string): boolean {
  return isFresh(dividendsKey(symbol));
}
export function hasCachedOwnership(symbol: string): boolean {
  return isFresh(ownershipKey(symbol));
}

/** YYYY-MM-DD of a Yahoo date (Date, ISO string, epoch seconds or milliseconds). */
function isoDate(value: unknown): string | null {
  const ms = toMs(value);
  return ms === null ? null : new Date(ms).toISOString().slice(0, 10);
}

function ratio(part: number | null, whole: number | null): number | null {
  return part === null || whole === null || whole === 0 ? null : part / whole;
}

// ---------------------------------------------------------------------------
// Financials
// ---------------------------------------------------------------------------

export type RawStatementRow = Record<string, unknown>;

const ANNUAL_PERIODS = 4;
const QUARTERLY_PERIODS = 5;

/** Data fields of a fundamentalsTimeSeries row (everything but its date and type markers). */
function fieldCount(row: RawStatementRow): number {
  return Object.keys(row).filter((key) => key !== "date" && key !== "TYPE" && key !== "periodType" && row[key] !== null && row[key] !== undefined).length;
}

/**
 * Drops Yahoo's partial "stub" periods: rows with fewer than half the fields of the fullest row in the same request
 * (its oldest period often carries only a handful of values, e.g. 6 of 38). Returns the rows keyed by period end.
 */
export function fullRows(rows: readonly RawStatementRow[]): Map<string, RawStatementRow> {
  const counts = rows.map(fieldCount);
  const most = Math.max(0, ...counts);
  const out = new Map<string, RawStatementRow>();
  rows.forEach((row, i) => {
    const end = isoDate(row.date);
    if (end && counts[i] >= most / 2) out.set(end, row);
  });
  return out;
}

/** One period from its income statement and cash flow rows (either may be missing). */
export function buildPeriod(end: string, income: RawStatementRow | undefined, cash: RawStatementRow | undefined): FinancialPeriod {
  const revenue = num(income?.totalRevenue);
  const grossProfit = num(income?.grossProfit);
  const operatingIncome = num(income?.operatingIncome);
  const netIncome = num(income?.netIncome);
  const operatingCashFlow = num(cash?.operatingCashFlow);
  const capitalExpenditure = num(cash?.capitalExpenditure);
  return {
    end,
    revenue,
    grossProfit,
    operatingIncome,
    netIncome,
    grossMargin: ratio(grossProfit, revenue),
    operatingMargin: ratio(operatingIncome, revenue),
    netMargin: ratio(netIncome, revenue),
    dilutedEps: num(income?.dilutedEPS),
    ebitda: num(income?.EBITDA) ?? num(income?.normalizedEBITDA),
    operatingCashFlow,
    capitalExpenditure,
    // Capex is reported as a negative outflow; free cash flow is operating cash flow minus the cash spent on it.
    freeCashFlow: operatingCashFlow !== null && capitalExpenditure !== null ? operatingCashFlow - Math.abs(capitalExpenditure) : null,
    buybacks: num(cash?.repurchaseOfCapitalStock),
    dividendsPaid: num(cash?.cashDividendsPaid) ?? num(cash?.commonStockDividendPaid),
  };
}

/** Merges income and cash flow rows by period end, keeps the latest `max` periods, oldest first. */
export function buildPeriods(income: readonly RawStatementRow[], cash: readonly RawStatementRow[], max: number): FinancialPeriod[] {
  const incomeRows = fullRows(income);
  const cashRows = fullRows(cash);
  const ends = [...new Set([...incomeRows.keys(), ...cashRows.keys()])].sort();
  return ends
    .map((end) => buildPeriod(end, incomeRows.get(end), cashRows.get(end)))
    .filter((period) => period.revenue !== null || period.netIncome !== null || period.operatingCashFlow !== null)
    .slice(-max);
}

type StatementType = "annual" | "quarterly";
type StatementModule = "financials" | "cash-flow";

async function loadStatements(symbol: string, type: StatementType, module: StatementModule, now: number): Promise<RawStatementRow[]> {
  // Yahoo serves at most four fiscal years plus a stub row and five quarters plus one or two stubs, whatever the start.
  const years = type === "annual" ? 6 : 2;
  const period1 = new Date(now - years * 366 * DAY_MS);
  const rows = await upstream(() => yf.fundamentalsTimeSeries(symbol, { period1, type, module }, callOptions()));
  return Array.isArray(rows) ? (rows as RawStatementRow[]) : [];
}

/**
 * Up to four fiscal years and five quarters of income statement and cash flow figures, with the statements'
 * currency from the cached summary. Null when Yahoo has no statements (funds, indices, unknown symbols).
 */
export async function getFinancials(symbol: string): Promise<FinancialStatements | null> {
  return cached(financialsKey(symbol), { ttlMs: 24 * HOUR, staleMs: 48 * HOUR }, async () => {
    const now = Date.now();
    // The summary (cached for the quote page) carries the statements' currency; fetched alongside, never required.
    const summaryPromise = getSummary(symbol).catch(() => null);
    const settled = await Promise.allSettled([
      loadStatements(symbol, "annual", "financials", now),
      loadStatements(symbol, "annual", "cash-flow", now),
      loadStatements(symbol, "quarterly", "financials", now),
      loadStatements(symbol, "quarterly", "cash-flow", now),
    ]);
    const failures = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
    if (failures.length === settled.length) throw failures[0].reason;
    // Any client can ask for any symbol, so a Yahoo outage could repeat this for every one of them: at most once a minute.
    if (failures.length > 0) logThrottled("research.statements_partial", MINUTE, "warn", "research.statements_partial", { symbol, failed: failures.length, error: failures[0].reason });
    const [annualIncome, annualCash, quarterlyIncome, quarterlyCash] = settled.map((s) => (s.status === "fulfilled" ? s.value : []));

    const annual = buildPeriods(annualIncome, annualCash, ANNUAL_PERIODS);
    const quarterly = buildPeriods(quarterlyIncome, quarterlyCash, QUARTERLY_PERIODS);
    const summary = await summaryPromise;
    if (annual.length === 0 && quarterly.length === 0) return null;
    return {
      symbol,
      asOf: new Date(now).toISOString(),
      currency: summary?.stats.financialCurrency ?? summary?.profile.currency ?? null,
      annual,
      quarterly,
    };
  });
}

// ---------------------------------------------------------------------------
// Dividends
// ---------------------------------------------------------------------------

const DIVIDEND_YEARS = 10;

/** Frequency from the median gap between consecutive ex-dates (the last eight payments); null with fewer than two. */
export function dividendFrequency(exDates: readonly string[]): DividendFrequency | null {
  const times = exDates.map((d) => Date.parse(d)).filter(Number.isFinite).sort((a, b) => a - b).slice(-9);
  if (times.length < 2) return null;
  const gaps = times.slice(1).map((t, i) => (t - times[i]) / DAY_MS).sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  if (median <= 45) return "monthly";
  if (median >= 60 && median <= 120) return "quarterly";
  if (median >= 150 && median <= 220) return "semiannual";
  if (median >= 300 && median <= 400) return "annual";
  return "irregular";
}

export interface DividendSummary {
  years: DividendYear[];
  trailingAnnual: number | null;
  growth5y: number | null;
  frequency: DividendFrequency | null;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Yearly totals, the trailing twelve months, five-year growth of the yearly total and the payment frequency. */
export function summarizeDividends(payments: readonly DividendPayment[], now: number): DividendSummary {
  const currentYear = new Date(now).getUTCFullYear();
  const byYear = new Map<number, { total: number; payments: number }>();
  let trailing = 0;
  let trailingCount = 0;
  for (const payment of payments) {
    const year = Number(payment.exDate.slice(0, 4));
    const entry = byYear.get(year) ?? { total: 0, payments: 0 };
    entry.total += payment.amount;
    entry.payments += 1;
    byYear.set(year, entry);
    const age = now - Date.parse(payment.exDate);
    if (age >= 0 && age < 365 * DAY_MS) {
      trailing += payment.amount;
      trailingCount += 1;
    }
  }
  const years = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, entry]) => ({ year, total: round(entry.total), payments: entry.payments, partial: year === currentYear }));

  // Growth over the last five full years: both ends must have paid, or there is no meaningful rate.
  const lastFull = currentYear - 1;
  const end = byYear.get(lastFull)?.total ?? 0;
  const start = byYear.get(lastFull - 5)?.total ?? 0;
  const growth5y = end > 0 && start > 0 ? round((end / start) ** (1 / 5) - 1) : null;

  return {
    years,
    trailingAnnual: trailingCount > 0 ? round(trailing) : null,
    growth5y,
    frequency: dividendFrequency(payments.map((p) => p.exDate)),
  };
}

/** Assembles the dividend history from the chart's dividend events and the quote's announced dividend. */
export function buildDividendHistory(symbol: string, chart: RawChart | null, quote: Quote | null, now: number): DividendHistory {
  const from = now - DIVIDEND_YEARS * 366 * DAY_MS;
  const payments: DividendPayment[] = normalizeDividends(chart)
    .filter((event) => event.t >= from && event.t <= now + DAY_MS)
    .map((event) => ({ exDate: new Date(event.t).toISOString().slice(0, 10), amount: round(event.amount) }));
  const summary = summarizeDividends(payments, now);
  // The window starts ten years back, usually mid-year: that first calendar year is incomplete, so its bar is left out.
  const firstFullYear = new Date(from).getUTCFullYear() + 1;
  const years = summary.years.filter((year) => year.year >= firstFullYear);

  // Forward rate over the price, else the trailing year over the price, else Yahoo's own (rounded for funds) yield.
  const price = quote?.price ?? null;
  const forwardAnnual = quote?.dividendRate ?? null;
  const positivePrice = price !== null && price > 0 ? price : null;
  const yieldValue =
    positivePrice !== null && forwardAnnual !== null && forwardAnnual > 0
      ? forwardAnnual / positivePrice
      : positivePrice !== null && summary.trailingAnnual !== null
        ? summary.trailingAnnual / positivePrice
        : (quote?.dividendYield ?? null);

  const today = new Date(now).toISOString().slice(0, 10);
  const nextEx = quote?.exDividendDate ? quote.exDividendDate.slice(0, 10) : null;
  const payDate = quote?.dividendDate ? quote.dividendDate.slice(0, 10) : null;

  return {
    symbol,
    asOf: new Date(now).toISOString(),
    currency: quote?.currency ?? null,
    payments,
    ...summary,
    years,
    forwardAnnual,
    yield: yieldValue,
    next: nextEx && nextEx >= today ? { exDate: nextEx, amount: quote?.dividendAmount ?? null } : null,
    nextPayDate: payDate && payDate >= today ? payDate : null,
  };
}

async function loadDividendChart(symbol: string, now: number): Promise<RawChart | null> {
  try {
    const period1 = new Date(now - DIVIDEND_YEARS * 366 * DAY_MS);
    // Monthly bars keep the payload small; the events are the same at any interval.
    return (await upstream(() => yf.chart(symbol, { period1, interval: "1mo", events: "div|split" }, callOptions()))) as unknown as RawChart;
  } catch (error) {
    if (/No data found|symbol may be delisted/i.test(String(error))) return null;
    throw error;
  }
}

/**
 * Ten years of dividends with yearly totals, growth, frequency, yield and the next ex-date. Null when Yahoo does not
 * know the symbol; a stock that pays nothing gets an empty history.
 */
export async function getDividends(symbol: string): Promise<DividendHistory | null> {
  return cached(dividendsKey(symbol), { ttlMs: 6 * HOUR, staleMs: 24 * HOUR }, async () => {
    const now = Date.now();
    const [chartResult, quoteResult] = await Promise.allSettled([loadDividendChart(symbol, now), getQuote(symbol)]);
    if (chartResult.status === "rejected") throw chartResult.reason;
    const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;
    if (quoteResult.status === "rejected") logThrottled("research.dividend_quote_unavailable", MINUTE, "warn", "research.dividend_quote_unavailable", { symbol, error: quoteResult.reason });
    if (!chartResult.value && quote === null) return null;
    return buildDividendHistory(symbol, chartResult.value, quote, now);
  });
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

const OWNERSHIP_MODULES = ["insiderTransactions", "netSharePurchaseActivity", "majorHoldersBreakdown", "institutionOwnership"] as const;
const MAX_INSIDER_TRADES = 20;
const MAX_INSTITUTIONS = 10;

type RawRecord = Record<string, unknown>;

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : null;
}

function list(value: unknown): RawRecord[] {
  return Array.isArray(value) ? value.map(record).filter((r): r is RawRecord => r !== null) : [];
}

/** Kind of an insider transaction from Yahoo's text ("Sale at price ...", "Stock Award(Grant) ...", "Stock Gift ..."). */
export function insiderKind(text: string | null): InsiderTradeKind {
  if (!text) return "other";
  if (/\bsale\b|\bsold\b/i.test(text)) return "sale";
  if (/\bpurchase\b|\bbought\b|\bbuy\b/i.test(text)) return "buy";
  if (/\bgift\b/i.test(text)) return "gift";
  if (/\baward\b|\bgrant\b/i.test(text)) return "award";
  if (/\boption\b|\bexercise\b|\bconversion\b|\bderivative\b/i.test(text)) return "option";
  return "other";
}

/**
 * Price per share of an insider transaction. Yahoo puts it only in the text: "Sale at price 325.75 per share." for
 * one price, "Sale at price 222.19 - 223.75 per share." for a range (then value / shares gives the average, or the
 * midpoint without them). Awards and gifts at 0.00 have no price.
 */
export function insiderPrice(text: string | null, shares: number | null, value: number | null): number | null {
  const match = text ? /price\s+([\d,]+(?:\.\d+)?)(?:\s*-\s*([\d,]+(?:\.\d+)?))?/i.exec(text) : null;
  const parse = (s: string | undefined) => (s === undefined ? null : Number.parseFloat(s.replace(/,/g, "")));
  const low = parse(match?.[1]);
  const high = parse(match?.[2]);
  const average = shares && value && shares > 0 && value > 0 ? value / shares : null;
  if (low !== null && high !== null && Number.isFinite(low) && Number.isFinite(high) && high > 0) {
    return average !== null && average >= low * 0.98 && average <= high * 1.02 ? round(average, 4) : round((low + high) / 2, 4);
  }
  if (low !== null && Number.isFinite(low) && low > 0) return low;
  return null;
}

export function mapInsiderTrade(raw: RawRecord): InsiderTrade {
  const text = str(raw.transactionText);
  const shares = num(raw.shares);
  const value = num(raw.value);
  const ownership = raw.ownership === "D" || raw.ownership === "I" ? raw.ownership : null;
  return {
    date: isoDate(raw.startDate),
    name: str(raw.filerName) ?? "",
    relation: str(raw.filerRelation),
    kind: insiderKind(text),
    shares,
    value: value !== null && value > 0 ? value : null,
    price: insiderPrice(text, shares, value),
    ownership,
  };
}

/** Maps the quoteSummary ownership modules; null when Yahoo sent none of them (funds, indices). */
export function mapOwnership(symbol: string, raw: RawRecord | null, now = Date.now()): OwnershipData | null {
  if (!raw) return null;
  const holders = record(raw.majorHoldersBreakdown);
  const net = record(raw.netSharePurchaseActivity);
  const trades = list(record(raw.insiderTransactions)?.transactions);
  const institutions = list(record(raw.institutionOwnership)?.ownershipList);

  const breakdown: HolderBreakdown | null = holders
    ? {
        insiders: num(holders.insidersPercentHeld),
        institutions: num(holders.institutionsPercentHeld),
        institutionsFloat: num(holders.institutionsFloatPercentHeld),
        institutionsCount: num(holders.institutionsCount),
      }
    : null;

  const buyShares = num(net?.buyInfoShares);
  const sellShares = num(net?.sellInfoShares);
  const insiderSummary: InsiderSummary | null = net
    ? {
        period: str(net.period),
        buyCount: num(net.buyInfoCount),
        buyShares,
        sellCount: num(net.sellInfoCount),
        sellShares,
        netShares: num(net.netInfoShares) ?? (buyShares !== null && sellShares !== null ? buyShares - sellShares : null),
        netPercent: num(net.netPercentInsiderShares),
        totalInsiderShares: num(net.totalInsiderShares),
      }
    : null;

  const insiderTrades = trades
    .map(mapInsiderTrade)
    .filter((trade) => trade.name)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, MAX_INSIDER_TRADES);

  const topInstitutions: InstitutionHolder[] = institutions
    .map((row) => ({
      name: str(row.organization) ?? "",
      reportDate: isoDate(row.reportDate),
      pctHeld: num(row.pctHeld),
      shares: num(row.position),
      value: num(row.value),
      pctChange: num(row.pctChange),
    }))
    .filter((row) => row.name)
    .sort((a, b) => (b.pctHeld ?? -1) - (a.pctHeld ?? -1))
    .slice(0, MAX_INSTITUTIONS);

  if (!breakdown && !insiderSummary && insiderTrades.length === 0 && topInstitutions.length === 0) return null;
  return { symbol, asOf: new Date(now).toISOString(), breakdown, insiderSummary, insiderTrades, institutions: topInstitutions };
}

/** Holder breakdown, insider activity and the largest institutions. Null for funds and unknown symbols. */
export async function getOwnership(symbol: string): Promise<OwnershipData | null> {
  return cached(ownershipKey(symbol), { ttlMs: 6 * HOUR, staleMs: 24 * HOUR }, async () => {
    try {
      const raw = await upstream(() => yf.quoteSummary(symbol, { modules: [...OWNERSHIP_MODULES] }, callOptions()));
      return mapOwnership(symbol, record(raw));
    } catch (error) {
      // Unknown symbols make quoteSummary throw "Quote not found"; that means "no ownership data".
      if (/not found|No fundamentals|404/i.test(String(error))) return null;
      throw error;
    }
  });
}
