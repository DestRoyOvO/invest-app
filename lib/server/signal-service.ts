import "server-only";

import type { DailyBar } from "@/lib/bars";
import { riskSnapshot } from "@/lib/risk-forecast";
import { computeSignalReport, type Fundamentals } from "@/lib/signal";
import type { KeyStats, MarketState, Quote, SignalReport, StockProfile } from "@/types/api";

import { cached, HOUR, MINUTE } from "./cache";
import { getDailyBars, getQuote, getSummary, todayInExchange } from "./yahoo";

/**
 * Calendar days of daily history requested for the model (about 370 sessions): enough for the 252-session volatility
 * blend, beta and the own-history volatility percentile of the risk forecast.
 */
const HISTORY_DAYS = 540;
/** Market benchmark for beta. Same request as the screener's, so the bars come from one shared cache entry. */
const BENCHMARK = "SPY";
const REPORT_TTL_MS = 15 * MINUTE;
/** If a refresh fails, the previous report (with its original asOf) is served for up to this long. */
const REPORT_STALE_MS = HOUR;

const NO_FUNDAMENTALS: Fundamentals = {
  pe: null,
  eps: null,
  roe: null,
  profitMargin: null,
  revenueGrowth: null,
  debtToEquity: null,
  sector: null,
};

/** Thrown when Yahoo has neither a quote nor any price history for the symbol. */
export class SignalNotFoundError extends Error {
  constructor(readonly symbol: string) {
    super(`No market data for ${symbol}`);
    this.name = "SignalNotFoundError";
  }
}

/**
 * Removes today's still-forming daily bar while the regular session is open, so the model only sees completed
 * sessions. `today` is the UTC-midnight timestamp of the current exchange date (see todayInExchange).
 */
export function dropPartialBar(
  bars: readonly DailyBar[],
  marketState: MarketState | null,
  today: number,
): { bars: readonly DailyBar[]; dropped: boolean } {
  const last = bars[bars.length - 1];
  if (marketState === "REGULAR" && last !== undefined && last.t === today) return { bars: bars.slice(0, -1), dropped: true };
  return { bars, dropped: false };
}

type Summary = { profile: StockProfile; stats: KeyStats };

/**
 * Whether company fundamentals apply. The quote's type decides; without a quote, a sector in the profile marks an
 * operating company. Funds have no sector, yet Yahoo reports a trailing P/E for them (SPY, QQQ) that must not be
 * scored as a company valuation.
 */
function isOperatingCompany(quote: Quote | null, summary: Summary | null): boolean {
  if (quote?.quoteType) return quote.quoteType === "EQUITY";
  return Boolean(summary?.profile.sector);
}

/**
 * Model inputs from the quote and the summary. Company fundamentals only mean something for single stocks, so ETFs,
 * indices, futures, currencies and crypto get none (their value and quality factors are imputed). When Yahoo has
 * EPS but no trailing P/E, the P/E is derived from the price.
 */
export function toFundamentals(quote: Quote | null, summary: Summary | null, fallbackPrice: number | null): Fundamentals {
  if (!isOperatingCompany(quote, summary)) return NO_FUNDAMENTALS;
  const stats = summary?.stats ?? null;
  const eps = quote?.epsTrailingTwelveMonths ?? stats?.eps ?? null;
  const price = quote?.price ?? fallbackPrice;
  const reportedPe = quote?.trailingPE ?? stats?.trailingPE ?? null;
  const derivedPe = eps !== null && eps > 0 && price !== null && price > 0 ? price / eps : null;
  return {
    pe: reportedPe ?? derivedPe,
    eps,
    roe: stats?.roe ?? null,
    profitMargin: stats?.profitMargin ?? null,
    revenueGrowth: stats?.revenueGrowth ?? null,
    debtToEquity: stats?.debtToEquity ?? null,
    sector: summary?.profile.sector ?? null,
  };
}

/**
 * Loads the inputs and computes the report. Returns null when Yahoo definitively does not know the symbol (the quote
 * lookup succeeded but found nothing, and there is no price history); that answer is cached like a report.
 */
async function loadReport(symbol: string): Promise<SignalReport | null> {
  const [barsResult, quoteResult, summaryResult, benchmarkResult] = await Promise.allSettled([
    getDailyBars(symbol, HISTORY_DAYS),
    getQuote(symbol),
    getSummary(symbol),
    // Only beta needs the benchmark; without it the report is still complete, with a null beta.
    symbol === BENCHMARK ? Promise.resolve(null) : getDailyBars(BENCHMARK, HISTORY_DAYS),
  ]);
  const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;
  const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
  const quoteMissing = quoteResult.status === "fulfilled" && quote === null;

  if (barsResult.status === "rejected") {
    // The chart endpoint throws for unknown symbols, so a confirmed missing quote means "not found". Otherwise the
    // price history is temporarily unavailable, which must surface as an upstream error rather than a cached report.
    if (quoteMissing) return null;
    throw barsResult.reason;
  }

  const allBars = barsResult.value;
  if (allBars.length === 0 && quote === null) {
    if (quoteMissing) return null;
    // The quote lookup itself failed: answer "not found" without caching it.
    throw new SignalNotFoundError(symbol);
  }

  const marketState = quote?.marketState ?? null;
  const today = todayInExchange();
  const { bars, dropped } = dropPartialBar(allBars, marketState, today);
  const report = computeSignalReport({
    symbol,
    bars,
    fundamentals: toFundamentals(quote, summary, allBars[allBars.length - 1]?.c ?? null),
    asOf: new Date().toISOString(),
    droppedPartialBar: dropped,
  });
  if (report.status !== "ok") return { ...report, risk: null };

  // The benchmark's forming bar goes by the same rule; beta then only uses sessions both series completed.
  let benchmark: readonly DailyBar[] | null = null;
  if (symbol === BENCHMARK) benchmark = bars;
  else if (benchmarkResult.status === "fulfilled" && benchmarkResult.value) benchmark = dropPartialBar(benchmarkResult.value, marketState, today).bars;
  return { ...report, risk: riskSnapshot(bars, benchmark) };
}

/** Computes (and caches) the quant signal report for one symbol. */
export async function getSignalReport(symbol: string): Promise<SignalReport> {
  const report = await cached(`signal:${symbol}`, { ttlMs: REPORT_TTL_MS, staleMs: REPORT_STALE_MS }, () =>
    loadReport(symbol),
  );
  if (report === null) throw new SignalNotFoundError(symbol);
  return report;
}
