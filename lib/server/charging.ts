import "server-only";

import { isFresh } from "./cache";
import { buildCompanyMatcher, planCompanyQueries } from "./news";
import { DIVIDENDS_CALLS, FINANCIALS_CALLS, hasCachedDividends, hasCachedFinancials, hasCachedOwnership, OWNERSHIP_CALLS } from "./research";
import { hasCachedDailyBars, hasCachedNewsSearch, hasCachedSummary, hasFreshQuote, peekQuote, peekSummary } from "./yahoo";

// How many Yahoo calls a public request is about to make, so a route can charge one rate-limit unit per call with
// chargePublicRequest, as /api/sparklines does. The counts mirror what the loaders fetch. charging.test.ts runs the
// real loaders against counting fakes, so a loader that starts fetching more fails that test until this module follows.

/** Most news searches behind one company feed: ticker, brand, two industry searches and one macro search. */
export const MAX_COMPANY_NEWS_SEARCHES = 5;

/** Mirrors lib/server/signal-service.ts: the report's cache key, the days of history it loads and the beta benchmark. */
const SIGNAL_HISTORY_DAYS = 540;
const SIGNAL_BENCHMARK = "SPY";

function signalReportKey(symbol: string): string {
  return `signal:${symbol}`;
}

/**
 * Uncached news searches behind getCompanyNews for the symbol. None while Yahoo's "unknown symbol" answer is fresh in
 * the quote cache, because getStockNews then answers 404 before it searches. Otherwise the plan depends on the
 * profile (industry and sector) and the company name; when those are not cached yet, every search is assumed to run.
 */
function uncachedCompanyNewsSearches(symbol: string): number {
  const quote = peekQuote(symbol);
  if (quote === null && hasFreshQuote(symbol)) return 0;
  const summary = peekSummary(symbol);
  if (summary === undefined || (summary === null && !quote)) return MAX_COMPANY_NEWS_SEARCHES;
  const profile = summary?.profile ?? null;
  const companyName = quote?.name || profile?.name || symbol;
  const matcher = buildCompanyMatcher(symbol, [profile?.longName, companyName, profile?.name]);
  return planCompanyQueries(matcher, profile).filter((query) => !hasCachedNewsSearch(query.term, query.count)).length;
}

/** Uncached Yahoo calls behind getStockDetail(symbol): the quote and the summary (news has its own route). */
export function uncachedStockDetailCalls(symbol: string): number {
  return (hasFreshQuote(symbol) ? 0 : 1) + (hasCachedSummary(symbol) ? 0 : 1);
}

/** Uncached Yahoo calls behind getStockNews(symbol): the quote, the summary and the company news searches. */
export function uncachedStockNewsCalls(symbol: string): number {
  return uncachedStockDetailCalls(symbol) + uncachedCompanyNewsSearches(symbol);
}

/** Uncached Yahoo calls behind getFinancials(symbol): four statement requests plus the summary for the currency. */
export function uncachedFinancialsCalls(symbol: string): number {
  if (hasCachedFinancials(symbol)) return 0;
  return FINANCIALS_CALLS + (hasCachedSummary(symbol) ? 0 : 1);
}

/** Uncached Yahoo calls behind getDividends(symbol): the dividend chart plus the quote. */
export function uncachedDividendsCalls(symbol: string): number {
  if (hasCachedDividends(symbol)) return 0;
  return DIVIDENDS_CALLS + (hasFreshQuote(symbol) ? 0 : 1);
}

/** Uncached Yahoo calls behind getOwnership(symbol): one quoteSummary request. */
export function uncachedOwnershipCalls(symbol: string): number {
  return hasCachedOwnership(symbol) ? 0 : OWNERSHIP_CALLS;
}

/**
 * Uncached Yahoo calls behind getSignalReport(symbol): none while the report is cached, else bars, quote, summary and
 * the benchmark's bars for beta (shared with every other report, and not loaded twice for the benchmark itself).
 */
export function uncachedSignalCalls(symbol: string): number {
  if (isFresh(signalReportKey(symbol))) return 0;
  const benchmark = symbol === SIGNAL_BENCHMARK || hasCachedDailyBars(SIGNAL_BENCHMARK, SIGNAL_HISTORY_DAYS) ? 0 : 1;
  return (
    (hasCachedDailyBars(symbol, SIGNAL_HISTORY_DAYS) ? 0 : 1) + (hasFreshQuote(symbol) ? 0 : 1) + (hasCachedSummary(symbol) ? 0 : 1) + benchmark
  );
}

/** Units to charge beyond the one limitPublicRequest already took for the request itself. */
export function extraUnits(upstreamCalls: number): number {
  return Math.max(0, upstreamCalls - 1);
}
