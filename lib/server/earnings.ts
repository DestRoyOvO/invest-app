import "server-only";

import type {
  AnalystAction,
  AnalystActivity,
  EarningsConsensus,
  EarningsDetail,
  EarningsEstimate,
  EarningsQuarter,
  EstimatePeriod,
  RatingCounts,
} from "@/types/earnings";

import { cached, HOUR, isFresh } from "./cache";
import { earningsTiming } from "./calendar";
import { callOptions, num, str, toIso, upstream, yf } from "./yahoo";

// Earnings and analyst data for one symbol (contract in types/earnings.ts), one cached quoteSummary call each.
//
// Yahoo's earnings modules disagree with each other for a few days around a report (observed 2026-11-07):
// - earningsTrend keeps the "0q" row labelled with the quarter just reported while its numbers already describe the
//   next quarter (AAPL), or keeps the reported quarter's numbers too (PLTR, whose "+1q" row is then the upcoming one);
// - calendarEvents can carry the next report date with the consensus of the quarter just reported (PLTR);
// - surprisePercent is a fraction in earningsHistory but a percent string in earnings.earningsChart.
// So quarters are labelled from earningsHistory, rows whose numbers equal the reported quarter's estimate are treated as
// stale, and surprises are recomputed from actual and estimate. Funds, indices and unknown symbols return null.

const EARNINGS_MODULES = ["earnings", "earningsHistory", "earningsTrend", "calendarEvents", "financialData"] as const;
const ANALYST_MODULES = ["recommendationTrend", "upgradeDowngradeHistory", "financialData"] as const;

const TTL_MS = 6 * HOUR;
const STALE_MS = 24 * HOUR;
const DAY_MS = 24 * HOUR;

/** Quarters of history kept, and the window and row cap for analyst actions (applied before caching). */
const HISTORY_QUARTERS = 5;
const ACTION_DAYS = 90;
const MAX_ACTIONS = 30;
/** A report date this far in the past still counts as "next" while Yahoo has not added its result yet. */
const NEXT_DATE_GRACE_MS = 3 * DAY_MS;

type Raw = Record<string, unknown>;

function obj(value: unknown): Raw {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
}

function list(value: unknown): Raw[] {
  return Array.isArray(value) ? value.filter((item): item is Raw => !!item && typeof item === "object") : [];
}

/** A count: finite, non-negative and whole; null otherwise. */
function count(value: unknown): number | null {
  const n = num(value);
  return n !== null && n >= 0 ? Math.round(n) : null;
}

/** A price target or similar amount that Yahoo sends as 0 when it has none. */
function positive(value: unknown): number | null {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
}

/** Percent given as a string or a number ("5.78" means 5.78%), as a decimal. */
function percentAsDecimal(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseFloat(value) : num(value);
  return n !== null && Number.isFinite(n) ? n / 100 : null;
}

function day(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/** Same number within `tolerance` relative to the larger magnitude (and a small absolute floor). */
function near(a: number | null, b: number | null, tolerance: number, floor = 0): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= Math.max(floor, tolerance * Math.max(Math.abs(a), Math.abs(b)));
}

/** Stale-row test: equal to Yahoo's printed precision (estimates carry five decimals). */
function sameEstimate(a: number | null, b: number | null): boolean {
  return near(a, b, 1e-4, 5e-6);
}

/** Two consensus figures for the same quarter from different modules (they differ in the third or fourth decimal). */
function matchingEstimate(a: number | null, b: number | null): boolean {
  return near(a, b, 0.005, 0.01);
}

/** Last day of the month `months` after the month of `isoDay` (quarter ends: "2026-09-30" + 3 -> "2026-12-31"). */
export function monthEndAfter(isoDay: string, months: number): string {
  const [y, m] = isoDay.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months + 1, 0)).toISOString().slice(0, 10);
}

/** "3Q2026" for a quarter end, the way Yahoo labels calendar quarters (a quarter ending Oct 31 is "3Q"). */
export function quarterLabel(isoDay: string): string {
  const [y, m] = isoDay.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 2, 1));
  return `${Math.floor(shifted.getUTCMonth() / 3) + 1}Q${shifted.getUTCFullYear()}`;
}

function surpriseOf(actual: number | null, estimate: number | null, ...fallbacks: Array<number | null>): number | null {
  if (actual !== null && estimate !== null && estimate !== 0) return (actual - estimate) / Math.abs(estimate);
  return fallbacks.find((value) => value !== null) ?? null;
}

/**
 * Reported quarters from earningsHistory merged with earnings.earningsChart.quarterly (labels and report dates), by
 * quarter end. Quarters without an actual EPS are left out; the last HISTORY_QUARTERS are kept, oldest first.
 */
export function mapQuarters(historyRows: Raw[], chartRows: Raw[]): EarningsQuarter[] {
  const chartByEnd = new Map<string, Raw>();
  for (const row of chartRows) {
    const end = day(toIso(row.periodEndDate));
    if (end) chartByEnd.set(end, row);
  }
  const quarters = new Map<string, EarningsQuarter>();
  const add = (end: string, history: Raw | null, chart: Raw | null) => {
    const actual = num(history?.epsActual) ?? num(chart?.actual);
    const estimate = num(history?.epsEstimate) ?? num(chart?.estimate);
    if (actual === null) return;
    quarters.set(end, {
      period: str(chart?.date) ?? quarterLabel(end),
      fiscalPeriod: str(chart?.fiscalQuarter),
      periodEnd: `${end}T00:00:00.000Z`,
      reportedAt: toIso(chart?.reportedDate),
      epsActual: actual,
      epsEstimate: estimate,
      surprise: surpriseOf(actual, estimate, num(history?.surprisePercent), percentAsDecimal(chart?.surprisePct)),
    });
  };
  for (const row of historyRows) {
    const end = day(toIso(row.quarter));
    if (end) add(end, row, chartByEnd.get(end) ?? null);
  }
  // Chart rows missing from earningsHistory.
  for (const [end, row] of chartByEnd) if (!quarters.has(end)) add(end, null, row);
  return [...quarters.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, quarter]) => quarter)
    .slice(-HISTORY_QUARTERS);
}

const ESTIMATE_PERIODS: readonly EstimatePeriod[] = ["0q", "+1q", "0y", "+1y"];

/** One earningsTrend row as Yahoo labels it; null for periods outside the contract (+5y, -5y). */
export function mapEstimate(row: Raw): EarningsEstimate | null {
  const period = str(row.period) as EstimatePeriod | null;
  if (!period || !ESTIMATE_PERIODS.includes(period)) return null;
  const eps = obj(row.earningsEstimate);
  const revenue = obj(row.revenueEstimate);
  const trend = obj(row.epsTrend);
  const revisions = obj(row.epsRevisions);
  return {
    period,
    periodEnd: toIso(row.endDate),
    epsAvg: num(eps.avg),
    epsLow: num(eps.low),
    epsHigh: num(eps.high),
    yearAgoEps: num(eps.yearAgoEps),
    revenueAvg: num(revenue.avg),
    revenueLow: num(revenue.low),
    revenueHigh: num(revenue.high),
    analysts: count(eps.numberOfAnalysts),
    revenueAnalysts: count(revenue.numberOfAnalysts),
    epsTrend: { current: num(trend.current), d7: num(trend["7daysAgo"]), d30: num(trend["30daysAgo"]), d60: num(trend["60daysAgo"]), d90: num(trend["90daysAgo"]) },
    revisions: {
      up7: count(revisions.upLast7days),
      up30: count(revisions.upLast30days),
      // Yahoo spells this one with a capital D.
      down7: count(revisions.downLast7Days ?? revisions.downLast7days),
      down30: count(revisions.downLast30days),
    },
  };
}

function epsOfQuarterEnding(history: readonly EarningsQuarter[], isoDay: string): number | null {
  const target = Date.parse(isoDay);
  const match = history.find((q) => q.periodEnd !== null && Math.abs(Date.parse(q.periodEnd) - target) <= 10 * DAY_MS);
  return match?.epsActual ?? null;
}

/**
 * Fixes Yahoo's lagging labels on the estimate rows. A quarterly row that ends on or before the last reported quarter
 * either still carries that quarter's estimate (stale: dropped) or already the next quarter's numbers (relabeled to
 * the next quarter end, unless another row already covers it). A yearly row that overlaps the previous one moves a year.
 */
export function correctEstimates(estimates: readonly EarningsEstimate[], history: readonly EarningsQuarter[]): EarningsEstimate[] {
  const last = history.at(-1) ?? null;
  const lastEnd = day(last?.periodEnd ?? null);
  const quarterly = estimates.filter((e) => e.period === "0q" || e.period === "+1q");
  const yearly = estimates.filter((e) => e.period === "0y" || e.period === "+1y");

  const out: EarningsEstimate[] = [];
  const covered = new Set(
    quarterly.map((e) => day(e.periodEnd)).filter((end): end is string => end !== null && (lastEnd === null || end > lastEnd)),
  );
  for (const estimate of quarterly) {
    const end = day(estimate.periodEnd);
    if (lastEnd === null || end === null || end > lastEnd) {
      out.push(estimate);
      continue;
    }
    if (sameEstimate(estimate.epsAvg, last?.epsEstimate ?? null)) continue;
    const next = monthEndAfter(lastEnd, 3);
    if (covered.has(next)) continue;
    covered.add(next);
    out.push({ ...estimate, periodEnd: `${next}T00:00:00.000Z`, relabeled: true, yearAgoEps: epsOfQuarterEnding(history, monthEndAfter(next, -12)) });
  }

  let previousEnd: string | null = null;
  for (const estimate of yearly) {
    let end = day(estimate.periodEnd);
    let relabeled = false;
    while (end !== null && ((lastEnd !== null && end <= lastEnd) || (previousEnd !== null && end <= previousEnd))) {
      end = monthEndAfter(end, 12);
      relabeled = true;
    }
    previousEnd = end ?? previousEnd;
    out.push(relabeled && end ? { ...estimate, periodEnd: `${end}T00:00:00.000Z`, relabeled: true } : estimate);
  }
  return out.sort((a, b) => ESTIMATE_PERIODS.indexOf(a.period) - ESTIMATE_PERIODS.indexOf(b.period));
}

/** The quarterly estimate for the next report: the earliest quarter ending after the last reported one. */
export function upcomingEstimate(estimates: readonly EarningsEstimate[], history: readonly EarningsQuarter[]): EarningsEstimate | null {
  const lastEnd = day(history.at(-1)?.periodEnd ?? null);
  const candidates = estimates
    .filter((e): e is EarningsEstimate & { periodEnd: string } => (e.period === "0q" || e.period === "+1q") && e.periodEnd !== null)
    .filter((e) => lastEnd === null || e.periodEnd.slice(0, 10) > lastEnd)
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  return candidates[0] ?? null;
}

/** When the last reported quarter came out: its report date, or its quarter end when Yahoo gives no date. */
function lastReportTime(history: readonly EarningsQuarter[]): number | null {
  const last = history.at(-1);
  const iso = last?.reportedAt ?? last?.periodEnd ?? null;
  return iso ? Date.parse(iso) : null;
}

/** Earliest listed report date that comes after the last reported quarter and is not long past. */
export function pickNextReport(dates: readonly string[], history: readonly EarningsQuarter[], now: number): string | null {
  const lastReport = lastReportTime(history);
  const valid = [...new Set(dates)]
    .filter((iso) => {
      const t = Date.parse(iso);
      return Number.isFinite(t) && t >= now - NEXT_DATE_GRACE_MS && (lastReport === null || t > lastReport + 12 * HOUR);
    })
    .sort();
  return valid[0] ?? null;
}

function datesOf(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).map(toIso).filter((iso): iso is string => iso !== null);
}

/** Maps one quoteSummary payload (EARNINGS_MODULES) to the contract; null when it holds no earnings data. */
export function mapEarningsDetail(symbol: string, raw: Raw, now: number): EarningsDetail | null {
  const earnings = obj(raw.earnings);
  const chart = obj(earnings.earningsChart);
  const calendar = obj(obj(raw.calendarEvents).earnings);
  const historyRows = list(obj(raw.earningsHistory).history);
  const trendRows = list(obj(raw.earningsTrend).trend);
  const chartRows = list(chart.quarterly);
  const financial = obj(raw.financialData);
  const calendarDates = datesOf(calendar.earningsDate);
  const chartDates = datesOf(chart.earningsDate);
  if (historyRows.length === 0 && trendRows.length === 0 && chartRows.length === 0 && calendarDates.length === 0 && chartDates.length === 0) return null;

  const history = mapQuarters(historyRows, chartRows);
  const estimates = correctEstimates(
    trendRows.map(mapEstimate).filter((e): e is EarningsEstimate => e !== null),
    history,
  );
  const upcoming = upcomingEstimate(estimates, history);
  const last = history.at(-1) ?? null;

  const calendarNext = pickNextReport(calendarDates, history, now);
  const nextDate = calendarNext ?? pickNextReport(chartDates, history, now);
  // Two listed dates are a window: the company has not fixed the day yet.
  const listed = calendarNext !== null ? calendarDates : chartDates;
  const isWindow = new Set(listed.map((iso) => iso.slice(0, 10))).size > 1;
  const nextDateEstimated = nextDate === null ? null : calendar.isEarningsDateEstimate === true || chart.isEarningsDateEstimate === true || isWindow;

  // The calendarEvents consensus counts only when its date is the upcoming report and its figures are not the
  // reported quarter's estimate; otherwise the earningsTrend row of the upcoming quarter stands in.
  const calendarEps = num(calendar.earningsAverage);
  let consensus: EarningsConsensus | null = null;
  if (calendarNext !== null && calendarEps !== null && !sameEstimate(calendarEps, last?.epsEstimate ?? null)) {
    const match = upcoming !== null && matchingEstimate(upcoming.epsAvg, calendarEps) ? upcoming : null;
    consensus = {
      epsAvg: calendarEps,
      epsLow: num(calendar.earningsLow),
      epsHigh: num(calendar.earningsHigh),
      revenueAvg: num(calendar.revenueAverage),
      revenueLow: num(calendar.revenueLow),
      revenueHigh: num(calendar.revenueHigh),
      analysts: match?.analysts ?? null,
      revenueAnalysts: match?.revenueAnalysts ?? null,
      periodEnd: match?.periodEnd ?? null,
      source: "calendar",
    };
  } else if (upcoming !== null && upcoming.epsAvg !== null) {
    consensus = {
      epsAvg: upcoming.epsAvg,
      epsLow: upcoming.epsLow,
      epsHigh: upcoming.epsHigh,
      revenueAvg: upcoming.revenueAvg,
      revenueLow: upcoming.revenueLow,
      revenueHigh: upcoming.revenueHigh,
      analysts: upcoming.analysts,
      revenueAnalysts: upcoming.revenueAnalysts ?? null,
      periodEnd: upcoming.periodEnd,
      source: "trend",
    };
  }

  const epsCurrency = str(obj(trendRows[0]?.earningsEstimate).earningsCurrency) ?? str(historyRows.at(-1)?.currency);
  const financialCurrency = str(financial.financialCurrency) ?? str(earnings.financialCurrency);
  // Revenue estimates come in the reporting currency, which can differ from the EPS currency (an ADR such as TSM).
  const revenueCurrency = trendRows.map((row) => str(obj(row.revenueEstimate).revenueCurrency)).find((code) => code !== null) ?? financialCurrency;

  return {
    symbol,
    asOf: new Date(now).toISOString(),
    financialCurrency,
    epsCurrency,
    revenueCurrency,
    nextDate,
    nextDateEstimated,
    nextTiming: nextDate === null ? null : earningsTiming(nextDate, nextDateEstimated === true, symbol),
    consensus,
    history,
    estimates,
  };
}

const RATING_PERIODS = ["0m", "-1m", "-2m", "-3m"];

/** Maps one quoteSummary payload (ANALYST_MODULES) to the contract; null without ratings, actions or targets. */
export function mapAnalystActivity(symbol: string, raw: Raw, now: number): AnalystActivity | null {
  const financial = obj(raw.financialData);
  const trend: RatingCounts[] = list(obj(raw.recommendationTrend).trend)
    .map((row) => ({
      period: str(row.period) ?? "",
      strongBuy: count(row.strongBuy) ?? 0,
      buy: count(row.buy) ?? 0,
      hold: count(row.hold) ?? 0,
      sell: count(row.sell) ?? 0,
      strongSell: count(row.strongSell) ?? 0,
    }))
    .filter((row) => RATING_PERIODS.includes(row.period))
    .sort((a, b) => RATING_PERIODS.indexOf(a.period) - RATING_PERIODS.indexOf(b.period));

  const since = now - ACTION_DAYS * DAY_MS;
  const actions: AnalystAction[] = list(obj(raw.upgradeDowngradeHistory).history)
    .map((row) => ({
      date: toIso(row.epochGradeDate) ?? "",
      firm: str(row.firm) ?? "",
      fromGrade: str(row.fromGrade),
      toGrade: str(row.toGrade),
      action: str(row.action),
      priceTargetAction: str(row.priceTargetAction),
      currentTarget: positive(row.currentPriceTarget),
      priorTarget: positive(row.priorPriceTarget),
    }))
    .filter((action) => action.firm !== "" && action.date !== "" && Date.parse(action.date) >= since && Date.parse(action.date) <= now + DAY_MS)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_ACTIONS);

  const targetMean = num(financial.targetMeanPrice);
  const hasRatings = trend.some((row) => row.strongBuy + row.buy + row.hold + row.sell + row.strongSell > 0);
  if (!hasRatings && actions.length === 0 && targetMean === null) return null;

  return {
    symbol,
    asOf: new Date(now).toISOString(),
    trend,
    actions,
    targetMean,
    targetHigh: num(financial.targetHighPrice),
    targetLow: num(financial.targetLowPrice),
    targetMedian: num(financial.targetMedianPrice),
    numberOfAnalysts: count(financial.numberOfAnalystOpinions),
    recommendationMean: num(financial.recommendationMean),
    recommendationKey: str(financial.recommendationKey),
    currentPrice: num(financial.currentPrice),
  };
}

/** Yahoo's answers for symbols without fundamentals (funds, indices) and for unknown symbols. */
function isNoData(error: unknown): boolean {
  return /not found|No fundamentals|Not Found|404/i.test(String(error));
}

async function loadSummary(symbol: string, modules: readonly string[]): Promise<Raw | null> {
  try {
    const raw: unknown = await upstream(() => yf.quoteSummary(symbol, { modules: [...modules] as never }, callOptions()));
    return raw && typeof raw === "object" ? (raw as Raw) : null;
  } catch (error) {
    if (isNoData(error)) return null;
    throw error;
  }
}

export function earningsKey(symbol: string): string {
  return `earnings:${symbol}`;
}

export function analystsKey(symbol: string): string {
  return `analysts:${symbol}`;
}

/** Uncached Yahoo calls behind getEarningsDetail(symbol), for charging the public route. */
export function uncachedEarningsCalls(symbol: string): number {
  return isFresh(earningsKey(symbol)) ? 0 : 1;
}

/** Uncached Yahoo calls behind getAnalystActivity(symbol). */
export function uncachedAnalystCalls(symbol: string): number {
  return isFresh(analystsKey(symbol)) ? 0 : 1;
}

/** Next report, consensus, revisions and recent surprises (cached 6 hours, served stale for 24 hours on failure). */
export async function getEarningsDetail(symbol: string): Promise<EarningsDetail | null> {
  return cached(earningsKey(symbol), { ttlMs: TTL_MS, staleMs: STALE_MS }, async () => {
    const raw = await loadSummary(symbol, EARNINGS_MODULES);
    return raw ? mapEarningsDetail(symbol, raw, Date.now()) : null;
  });
}

/** Rating counts, price targets and the last 90 days of rating actions (cached 6 hours, served stale for 24 hours). */
export async function getAnalystActivity(symbol: string): Promise<AnalystActivity | null> {
  return cached(analystsKey(symbol), { ttlMs: TTL_MS, staleMs: STALE_MS }, async () => {
    const raw = await loadSummary(symbol, ANALYST_MODULES);
    return raw ? mapAnalystActivity(symbol, raw, Date.now()) : null;
  });
}
