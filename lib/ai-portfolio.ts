// Precomputed portfolio facts for the AI portfolio scan and chat: day P&L by position with gainer and decliner
// counts, ranks by value, the holdings outside the largest group, a risk block from aligned daily closes (lib/risk.ts)
// and the next earnings and ex-dividend dates. The model copies figures well but gets relations wrong (which positions
// fell, which holdings diversify), so every relation it might state is computed here and written out explicitly.
// Pure; lib/server/ai-context.ts loads the quotes and bars.

import type { Portfolio, ValuedPosition } from "@/lib/portfolio";
import {
  annualizedVolatility,
  beta,
  correlation,
  covarianceMatrix,
  dailyReturns,
  effectivePositions,
  historicalVar,
  holdingsValueSeries,
  maxDrawdown,
  MIN_RETURNS,
  riskContributions,
} from "@/lib/risk";
import type { Quote } from "@/types/api";

import { daysUntil, fmtDaysUntil, fmtNumber, fmtRatio, fmtShare, fmtSigned, isFiniteNumber } from "./ai-format";

const MAX_RANKED = 15;
const MAX_EVENTS = 15;
/** Earnings and ex-dividend dates further out than this are left out of the events line. */
const EVENT_HORIZON_DAYS = 90;

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

/** Day P&L of every base-currency position, highest first, with the counts of gainers, decliners and flat ones. */
export function dayPnlLine(portfolio: Portfolio): string | null {
  const rows = portfolio.rows.filter((row) => isFiniteNumber(row.dayPnl));
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => (b.dayPnl as number) - (a.dayPnl as number));
  const gained = rows.filter((row) => (row.dayPnl as number) > 0).length;
  const lost = rows.filter((row) => (row.dayPnl as number) < 0).length;
  const flat = rows.length - gained - lost;
  const counts = [`${gained} gained`, `${lost} lost`];
  if (flat > 0) counts.push(`${flat} unchanged`);
  return `Day P&L by position (${portfolio.baseCurrency}, highest to lowest): ${sorted.map((row) => `${row.symbol} ${fmtSigned(row.dayPnl)}`).join(", ")}; ${counts.join(", ")}.`;
}

/** "#1 MSFT 31%, #2 NVDA 24%, ..." by market value. */
export function ranksLine(portfolio: Portfolio): string | null {
  if (portfolio.rows.length === 0) return null;
  const ranked = portfolio.rows.slice(0, MAX_RANKED).map((row, i) => `#${i + 1} ${row.symbol} ${fmtShare(row.weight ?? 0)}`);
  const more = portfolio.rows.length > MAX_RANKED ? ` (and ${portfolio.rows.length - MAX_RANKED} smaller)` : "";
  return `Ranks by value (weights of the ${portfolio.baseCurrency} total): ${ranked.join(", ")}${more}.`;
}

export interface GroupSplit {
  group: string;
  share: number;
  inside: ValuedPosition[];
  outside: Array<{ row: ValuedPosition; group: string }>;
}

/** The largest group by value and the positions outside it (the only ones that diversify away from it). */
export function largestGroupSplit(portfolio: Portfolio, groupOf: (symbol: string) => string): GroupSplit | null {
  const total = portfolio.totals.value;
  if (portfolio.rows.length === 0 || !(total > 0)) return null;
  const byGroup = new Map<string, number>();
  for (const row of portfolio.rows) byGroup.set(groupOf(row.symbol), (byGroup.get(groupOf(row.symbol)) ?? 0) + row.value);
  const [group, value] = [...byGroup.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const inside = portfolio.rows.filter((row) => groupOf(row.symbol) === group);
  const outside = portfolio.rows.filter((row) => groupOf(row.symbol) !== group).map((row) => ({ row, group: groupOf(row.symbol) }));
  return { group, share: value / total, inside, outside };
}

export function groupSplitLine(split: GroupSplit | null): string | null {
  if (!split) return null;
  const inside = split.inside.map((row) => row.symbol).join(", ");
  const outside =
    split.outside.length > 0
      ? `Outside it: ${split.outside.map(({ row, group }) => `${row.symbol} ${fmtShare(row.weight ?? 0)} (${group})`).join(", ")}.`
      : "Every position is in this group.";
  return `Largest group by value: ${split.group} ${fmtShare(split.share)} (${inside}). ${outside}`;
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export interface AlignedSeries {
  dates: readonly number[];
  closes: Readonly<Record<string, ReadonlyArray<number | null>>>;
}

export interface PortfolioRisk {
  /** Positions with enough price history, largest first. */
  covered: string[];
  /** Positions left out for lack of history. */
  missing: string[];
  /** Share of the base-currency value the covered positions hold. */
  coveredShare: number;
  /** Daily returns of the holdings value series. */
  returns: number;
  volatility: number | null;
  beta: number | null;
  averageCorrelation: number | null;
  topContributor: { symbol: string; share: number; weight: number } | null;
  /** 95% one-day historical value at risk as a negative decimal, and as an amount of the covered value. */
  var95: number | null;
  var95Amount: number | null;
  drawdown: { depth: number; peak: string; trough: string; recovery: string | null } | null;
  effectivePositions: number | null;
}

function isoDay(t: number | undefined): string {
  return t === undefined ? "n/a" : new Date(t).toISOString().slice(0, 10);
}

/**
 * Past-year risk of today's holdings (fixed share counts) from adjusted closes aligned on one calendar: volatility,
 * beta to the benchmark, average pairwise correlation, each position's share of variance, historical VaR, the
 * largest drawdown and the effective number of positions. Null when no position has enough history.
 */
export function portfolioRisk(aligned: AlignedSeries, portfolio: Portfolio, benchmark: string): PortfolioRisk | null {
  const rows = portfolio.rows;
  if (rows.length === 0) return null;
  const enough = (symbol: string) => (aligned.closes[symbol] ?? []).filter((close) => isFiniteNumber(close)).length > MIN_RETURNS;
  const covered = rows.filter((row) => enough(row.symbol));
  if (covered.length === 0) return null;
  const missing = rows.filter((row) => !enough(row.symbol)).map((row) => row.symbol);
  const coveredValue = covered.reduce((sum, row) => sum + row.value, 0);

  const shares = Object.fromEntries(covered.map((row) => [row.symbol, row.shares]));
  const values = holdingsValueSeries(aligned, shares);
  const valueReturns = dailyReturns(values);
  const returnCount = valueReturns.filter(isFiniteNumber).length;
  const benchmarkReturns = aligned.closes[benchmark] ? dailyReturns(aligned.closes[benchmark]) : null;

  const series = covered.map((row) => dailyReturns(aligned.closes[row.symbol]));
  const weights = covered.map((row) => row.value / coveredValue);
  const contributions = covered.length > 1 ? riskContributions(weights, covarianceMatrix(series)) : null;
  let topContributor: PortfolioRisk["topContributor"] = null;
  if (contributions) {
    const top = contributions.reduce((best, share, i) => (share > contributions[best] ? i : best), 0);
    topContributor = { symbol: covered[top].symbol, share: contributions[top], weight: weights[top] };
  }

  const correlations: number[] = [];
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const r = correlation(series[i], series[j]);
      if (r !== null) correlations.push(r);
    }
  }

  const var95 = historicalVar(valueReturns, 0.95);
  const worst = maxDrawdown(values);
  return {
    covered: covered.map((row) => row.symbol),
    missing,
    coveredShare: portfolio.totals.value > 0 ? coveredValue / portfolio.totals.value : 0,
    returns: returnCount,
    volatility: annualizedVolatility(valueReturns),
    beta: benchmarkReturns ? beta(valueReturns, benchmarkReturns) : null,
    averageCorrelation: correlations.length > 0 ? correlations.reduce((sum, r) => sum + r, 0) / correlations.length : null,
    topContributor,
    var95,
    var95Amount: var95 !== null ? -var95 * coveredValue : null,
    drawdown: worst
      ? {
          depth: worst.depth,
          peak: isoDay(aligned.dates[worst.peakIndex]),
          trough: isoDay(aligned.dates[worst.troughIndex]),
          recovery: worst.recoveryIndex !== null ? isoDay(aligned.dates[worst.recoveryIndex]) : null,
        }
      : null,
    effectivePositions: effectivePositions(rows.map((row) => row.value)),
  };
}

export function riskBlock(risk: PortfolioRisk | null, portfolio: Portfolio, benchmark: string): string | null {
  if (!risk) return null;
  const currency = portfolio.baseCurrency;
  const coverage =
    risk.missing.length > 0
      ? `covers ${risk.covered.length} of ${portfolio.rows.length} positions, ${fmtShare(risk.coveredShare)} of value; no history for ${risk.missing.join(", ")}`
      : `covers all ${risk.covered.length} ${currency} positions`;
  const lines = [
    `Risk of today's holdings over the past year (fixed share counts, dividend-adjusted closes, ${risk.returns} daily returns, ${coverage}). These statistics describe past behaviour, not the future:`,
  ];
  const stats = [
    isFiniteNumber(risk.volatility) ? `annualized volatility ${fmtRatio(risk.volatility)}` : null,
    isFiniteNumber(risk.beta) ? `beta to ${benchmark} ${fmtNumber(risk.beta)}` : null,
    isFiniteNumber(risk.averageCorrelation) ? `average pairwise correlation of daily returns ${fmtNumber(risk.averageCorrelation)}` : null,
  ].filter(Boolean);
  if (stats.length > 0) lines.push(`- ${stats.join("; ")}`);
  if (risk.topContributor) {
    lines.push(
      `- largest contributor to portfolio variance: ${risk.topContributor.symbol}, ${fmtShare(risk.topContributor.share)} of the variance at a ${fmtShare(risk.topContributor.weight)} weight`,
    );
  }
  if (isFiniteNumber(risk.var95) && isFiniteNumber(risk.var95Amount)) {
    lines.push(
      `- 95% one-day historical value at risk: ${fmtRatio(-risk.var95)} of value (about ${fmtNumber(risk.var95Amount)} ${currency}); on 5% of the past year's sessions these holdings lost more than that`,
    );
  }
  if (risk.drawdown && risk.drawdown.depth < 0) {
    const recovery = risk.drawdown.recovery ? `regained by ${risk.drawdown.recovery}` : "not regained since";
    lines.push(`- largest peak-to-trough fall: ${fmtRatio(risk.drawdown.depth, 1, true)} (from ${risk.drawdown.peak} to ${risk.drawdown.trough}; ${recovery})`);
  }
  if (isFiniteNumber(risk.effectivePositions)) {
    lines.push(`- effective number of positions ${fmtNumber(risk.effectivePositions, 1)} of ${portfolio.rows.length} (1 / sum of squared value weights)`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

interface HoldingEvent {
  date: string;
  text: string;
}

/** Next earnings and ex-dividend dates of the given symbols within 90 days, soonest first (from Quote fields). */
export function eventsLine(symbols: readonly string[], quotes: ReadonlyMap<string, Quote>, now: Date): string | null {
  const events: HoldingEvent[] = [];
  for (const symbol of symbols) {
    const quote = quotes.get(symbol);
    if (!quote) continue;
    if (quote.nextEarningsDate) {
      const days = daysUntil(quote.nextEarningsDate, now);
      if (days !== null && days >= 0 && days <= EVENT_HORIZON_DAYS) {
        const status = quote.earningsDateEstimated === true ? "estimated" : quote.earningsDateEstimated === false ? "confirmed" : "unconfirmed";
        events.push({ date: quote.nextEarningsDate.slice(0, 10), text: `${symbol} earnings ${quote.nextEarningsDate.slice(0, 10)} (${status}, ${fmtDaysUntil(days)})` });
      }
    }
    if (quote.exDividendDate) {
      const days = daysUntil(quote.exDividendDate, now);
      if (days !== null && days >= 0 && days <= EVENT_HORIZON_DAYS) {
        const amount = isFiniteNumber(quote.dividendAmount) ? `, ${fmtNumber(quote.dividendAmount, quote.dividendAmount < 0.1 ? 4 : 2)} per share` : "";
        events.push({ date: quote.exDividendDate.slice(0, 10), text: `${symbol} ex-dividend ${quote.exDividendDate.slice(0, 10)} (${fmtDaysUntil(days)}${amount})` });
      }
    }
  }
  if (events.length === 0) return `Upcoming earnings and ex-dividend dates for holdings: none known in the next ${EVENT_HORIZON_DAYS} days.`;
  events.sort((a, b) => a.date.localeCompare(b.date) || a.text.localeCompare(b.text));
  const shown = events.slice(0, MAX_EVENTS).map((event) => event.text);
  const more = events.length > MAX_EVENTS ? `; ${events.length - MAX_EVENTS} more` : "";
  return `Upcoming earnings and ex-dividend dates for holdings (from quotes, next ${EVENT_HORIZON_DAYS} days): ${shown.join("; ")}${more}.`;
}

/** The two positions with the largest absolute day P&L (the movers whose headlines the scan adds). */
export function largestMovers(portfolio: Portfolio, count = 2): ValuedPosition[] {
  return portfolio.rows
    .filter((row) => isFiniteNumber(row.dayPnl) && row.dayPnl !== 0)
    .sort((a, b) => Math.abs(b.dayPnl as number) - Math.abs(a.dayPnl as number))
    .slice(0, count);
}

/** Two lines for the market and sector chats: totals, today's P&L and the largest weights. */
export function portfolioSummary(portfolio: Portfolio, positions: number): string | null {
  const { rows, foreign, unpriced, totals, baseCurrency } = portfolio;
  if (rows.length === 0 && foreign.length === 0) return unpriced.length > 0 ? `Investor's positions (entered by the investor): no prices for ${unpriced.map((p) => p.symbol).join(", ")}.` : null;
  const previous = totals.value - totals.dayPnl;
  const dayPct = previous > 0 ? ` (${fmtRatio(totals.dayPnl / previous, 2, true)})` : "";
  const extras: string[] = [];
  if (foreign.length > 0) extras.push(`${foreign.length} in other currencies not included`);
  if (unpriced.length > 0) extras.push(`${unpriced.length} without a price not included`);
  const first = `Investor's positions (entered by the investor; ${positions} positions, totals in ${baseCurrency}${extras.length > 0 ? `; ${extras.join(", ")}` : ""}): value ${fmtNumber(totals.value)}, today ${fmtSigned(totals.dayPnl)}${dayPct}, unrealized ${fmtSigned(totals.pnl)} (${fmtRatio(totals.pnlPct, 1, true)}).`;
  const top = rows.slice(0, 3).map((row) => `${row.symbol} ${fmtShare(row.weight ?? 0)}`);
  return top.length > 0 ? `${first}\nLargest weights: ${top.join(", ")}.` : first;
}
