import "server-only";

import { isFresh } from "./cache";
import { buildCompanyMatcher, planCompanyQueries } from "./news";
import { hasCachedDailyBars, hasCachedNewsSearch, hasCachedSummary, hasFreshQuote, peekQuote, peekSummary } from "./yahoo";

// How many Yahoo calls a public request is about to make, so a route can charge one rate-limit unit per call with
// chargePublicRequest, as /api/sparklines does. The counts mirror what the loaders fetch. charging.test.ts runs the
// real loaders against counting fakes, so a loader that starts fetching more fails that test until this module follows.

/** Most news searches behind one company feed: ticker, brand, two industry searches and one macro search. */
export const MAX_COMPANY_NEWS_SEARCHES = 5;

/** Mirrors lib/server/signal-service.ts: the report's cache key and the days of history it loads. */
const SIGNAL_HISTORY_DAYS = 540;

function signalReportKey(symbol: string): string {
  return `signal:${symbol}`;
}

/**
 * Uncached news searches behind getCompanyNews for the symbol. None while Yahoo's "unknown symbol" answer is fresh in
 * the quote cache, because getStockDetail then answers 404 before it searches. Otherwise the plan depends on the
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

/** Uncached Yahoo calls behind getStockDetail(symbol): the quote, the summary and the company news searches. */
export function uncachedStockDetailCalls(symbol: string): number {
  return (hasFreshQuote(symbol) ? 0 : 1) + (hasCachedSummary(symbol) ? 0 : 1) + uncachedCompanyNewsSearches(symbol);
}

/** Uncached Yahoo calls behind getSignalReport(symbol): none while the report is cached, else bars, quote and summary. */
export function uncachedSignalCalls(symbol: string): number {
  if (isFresh(signalReportKey(symbol))) return 0;
  return (hasCachedDailyBars(symbol, SIGNAL_HISTORY_DAYS) ? 0 : 1) + (hasFreshQuote(symbol) ? 0 : 1) + (hasCachedSummary(symbol) ? 0 : 1);
}

/** Units to charge beyond the one limitPublicRequest already took for the request itself. */
export function extraUnits(upstreamCalls: number): number {
  return Math.max(0, upstreamCalls - 1);
}
