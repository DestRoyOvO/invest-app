"use client";

import { useMemo, useSyncExternalStore } from "react";
import useSWR from "swr";

import { fetchJson, symbolsParam } from "@/lib/api-client";
import type { Portfolio } from "@/lib/portfolio";
import type { MarketState, Quote, QuotesResponse } from "@/types/api";

import { valuePositions, useHoldings, type Holdings } from "./useHoldings";
import { useWatchlist } from "./useWatchlist";

// One source for the investor's own data: the watchlist, the positions and one combined quote request for both
// (chunked by 50, the quotes route's limit), valued through lib/portfolio.ts. The watchlist page, My day, the position
// editor and the portfolio page all read it, so they show the same numbers from the same request.

/** The quotes route accepts at most this many symbols per request. */
export const QUOTE_CHUNK_SIZE = 50;

/**
 * Quote request URLs for a set of symbols: unique, sorted (so reordering the watchlist never changes the request),
 * and split into chunks the quotes route accepts.
 */
export function quoteRequestUrls(symbols: Iterable<string>, size = QUOTE_CHUNK_SIZE): string[] {
  const unique = [...new Set(symbols)].sort();
  const urls: string[] = [];
  for (let i = 0; i < unique.length; i += size) urls.push(`/api/quotes?symbols=${symbolsParam(unique.slice(i, i + size))}`);
  return urls;
}

/** One response from several chunks: quotes and missing symbols joined, asOf the oldest so no chunk looks fresher than it is. */
export function mergeQuoteResponses(responses: readonly QuotesResponse[]): QuotesResponse {
  if (responses.length === 1) return responses[0];
  const asOf = responses.map((r) => r.asOf).sort()[0] ?? new Date(0).toISOString();
  return { asOf, quotes: responses.flatMap((r) => r.quotes), missing: responses.flatMap((r) => r.missing) };
}

/** When the oldest quote the server marked stale (an older cached quote after a failed refresh) was fetched. */
export function staleQuoteSince(quotes: Iterable<Quote>): string | null {
  let oldest: string | null = null;
  for (const quote of quotes) {
    if (!quote.stale) continue;
    const at = quote.fetchedAt;
    if (at && (oldest === null || oldest === "" || at < oldest)) oldest = at;
    else if (!at && oldest === null) oldest = "";
  }
  return oldest;
}

function isTrading(state: MarketState | null | undefined): boolean {
  return state === "REGULAR" || state === "PRE" || state === "POST";
}

async function fetchQuoteChunks(key: readonly string[]): Promise<QuotesResponse> {
  const responses = await Promise.all(key.slice(1).map((url) => fetchJson<QuotesResponse>(url)));
  return mergeQuoteResponses(responses);
}

export interface PortfolioData {
  /** Watchlist symbols in the investor's order. */
  watchlist: string[];
  holdings: Holdings;
  /** Latest quotes for the watchlist and the held symbols. */
  quotes: ReadonlyMap<string, Quote>;
  /** Positions valued at those quotes (lib/portfolio.ts: base currency, foreign and unpriced positions). */
  portfolio: Portfolio;
  /** False during server rendering and hydration, before the stored lists are known. */
  hydrated: boolean;
  /** The first quotes are still loading. */
  loading: boolean;
  /** The latest quote request failed (older quotes may still be shown). */
  error: unknown;
  /** Some numbers are old: a refresh failed while older quotes are shown, or the server served cached quotes. */
  stale: boolean;
  /** When the oldest data shown was fetched (for StaleBanner); null when unknown. */
  staleSince: string | null;
  /** Requested symbols Yahoo does not know. */
  missing: string[];
  asOf: string | null;
  refresh: () => void;
}

/** The investor's watchlist, positions and quotes from one combined request (see the module comment). */
export function usePortfolio(): PortfolioData {
  const { symbols: watchlist, hydrated } = useWatchlist();
  const { holdings } = useHoldings();
  const urls = useMemo(() => quoteRequestUrls([...watchlist, ...Object.keys(holdings)]), [watchlist, holdings]);
  const { data, error, mutate } = useSWR<QuotesResponse, unknown, readonly string[] | null>(
    urls.length > 0 ? ["portfolio:quotes", ...urls] : null,
    fetchQuoteChunks,
    { refreshInterval: (latest) => (latest?.quotes.some((q) => isTrading(q.marketState)) ? 15_000 : 60_000) },
  );

  const quotes = useMemo(() => new Map((data?.quotes ?? []).map((q) => [q.symbol, q])), [data]);
  const portfolio = useMemo(() => valuePositions(holdings, quotes), [holdings, quotes]);
  const quotesStaleSince = useMemo(() => staleQuoteSince(quotes.values()), [quotes]);
  const failedWithData = Boolean(error) && Boolean(data);

  return {
    watchlist,
    holdings,
    quotes,
    portfolio,
    hydrated,
    loading: urls.length > 0 && !data && !error,
    error,
    stale: failedWithData || quotesStaleSince !== null,
    staleSince: failedWithData ? (data?.asOf ?? null) : quotesStaleSince || null,
    missing: data?.missing ?? [],
    asOf: data?.asOf ?? null,
    refresh: () => void mutate(),
  };
}

// A shared minute clock for "in 3 days" labels, so rendering stays pure and every label updates together.
const clockListeners = new Set<() => void>();
let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | undefined;

function subscribeClock(listener: () => void): () => void {
  if (clockListeners.size === 0) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      for (const l of clockListeners) l();
    }, 60_000);
  }
  clockListeners.add(listener);
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== undefined) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}

function getClock(): number {
  if (clockNow === 0) clockNow = Date.now();
  return clockNow;
}

/** Current time in ms, refreshed every minute; 0 during server rendering (treat it as unknown). */
export function useNow(): number {
  return useSyncExternalStore(subscribeClock, getClock, () => 0);
}
