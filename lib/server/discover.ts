import "server-only";

import type { DiscoverResponse, DiscoverScreen, Quote } from "@/types/api";

import { cached, HOUR, MINUTE } from "./cache";
import { callOptions, getQuotes, mapQuote, upstream, yf } from "./yahoo";

// Market-wide screens from Yahoo's predefined screeners (day gainers, losers, most active, and a few idea lists) and
// Yahoo's trending symbols. Yahoo's lists include micro caps, OTC names and funds, so rows pass a quality filter:
// US-listed equities only, with a market-cap and a price floor. One Yahoo call per screen every two minutes, shared
// by every visitor. Each call asks for Yahoo's top 250 rows, the most one request returns, so a high cap floor such as
// $100B still finds the large names further down a list sorted by percent change; the response keeps the first 50 that
// pass, which is more than any list on screen shows.

export const DISCOVER_SCREENS: readonly DiscoverScreen[] = [
  "day_gainers",
  "day_losers",
  "most_actives",
  "undervalued_large_caps",
  "growth_technology_stocks",
  "most_shorted_stocks",
  "trending",
];

/** Default market-cap floor: $1B keeps the lists to investable names. */
export const DEFAULT_MIN_MARKET_CAP = 1e9;
const MIN_PRICE = 2;
/** Rows requested from Yahoo per screen: the most one request returns. */
export const SCAN_COUNT = 250;
/** Rows a response keeps after the quality filter, in Yahoo's order. */
export const MAX_ROWS = 50;
const TTL_MS = 2 * MINUTE;
const STALE_MS = HOUR;

type RawRow = Record<string, unknown>;

interface ScreenRows {
  /** Quotes in Yahoo's order, each with the listing market Yahoo reported (null when it did not). */
  rows: Array<{ quote: Quote; market: string | null }>;
  total: number | null;
}

/** Quality filter for screen rows. Exported for tests. */
export function passesQuality(quote: Quote, market: string | null, minMarketCap: number): boolean {
  if (quote.quoteType !== "EQUITY") return false;
  // Yahoo marks the listing market; fall back to the currency when it is missing.
  if (market !== null ? market !== "us_market" : quote.currency !== "USD") return false;
  if (quote.price === null || quote.price < MIN_PRICE) return false;
  return quote.marketCap !== null && quote.marketCap >= minMarketCap;
}

async function loadScreen(screen: Exclude<DiscoverScreen, "trending">): Promise<ScreenRows> {
  const result = (await upstream(() => yf.screener({ scrIds: screen, count: SCAN_COUNT }, undefined, callOptions()))) as {
    quotes?: unknown[];
    total?: unknown;
  } | null;
  const fetchedAt = new Date().toISOString();
  const rows = (result?.quotes ?? [])
    .filter((row): row is RawRow => !!row && typeof (row as RawRow).symbol === "string")
    .map((row) => ({ quote: { ...mapQuote(row), fetchedAt }, market: typeof row.market === "string" ? row.market : null }));
  return { rows, total: typeof result?.total === "number" ? result.total : null };
}

async function loadTrending(): Promise<ScreenRows> {
  const result = (await upstream(() => yf.trendingSymbols("US", { count: 30 }, callOptions()))) as { quotes?: Array<{ symbol?: unknown }> } | null;
  const symbols = (result?.quotes ?? []).map((q) => q.symbol).filter((s): s is string => typeof s === "string");
  // Trending gives symbols only; the batched quote supplies prices (from its own per-symbol cache).
  const quotes = await getQuotes(symbols);
  const rows = symbols.flatMap((symbol) => {
    const quote = quotes.get(symbol);
    return quote ? [{ quote, market: null }] : [];
  });
  return { rows, total: symbols.length };
}

/**
 * A screen's first 50 rows after the quality filter, in Yahoo's order (cached two minutes, served stale for an hour if
 * Yahoo fails). The cap floor is applied to the cached rows, so changing it costs no Yahoo call.
 */
export async function getDiscover(screen: DiscoverScreen, minMarketCap = DEFAULT_MIN_MARKET_CAP): Promise<DiscoverResponse> {
  const { rows, total } = await cached(`discover:${screen}`, { ttlMs: TTL_MS, staleMs: STALE_MS }, () =>
    screen === "trending" ? loadTrending() : loadScreen(screen),
  );
  const quotes = rows
    .filter((row) => passesQuality(row.quote, row.market, minMarketCap))
    .slice(0, MAX_ROWS)
    .map((row) => row.quote);
  return { asOf: new Date().toISOString(), screen, quotes, scanned: rows.length, total, minMarketCap };
}
