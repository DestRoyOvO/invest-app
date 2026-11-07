"use client";

import useSWR from "swr";

import { symbolsParam } from "@/lib/api-client";
import { hasCjk } from "@/lib/names-zh";
import type {
  AuthStatus,
  CalendarResponse,
  ChartData,
  ChartRange,
  DiscoverResponse,
  DiscoverScreen,
  FactorProfile,
  HistoryRange,
  HistoryResponse,
  MarketOverview,
  MarketState,
  NewsResponse,
  QuotesResponse,
  ScreenerResponse,
  ScreenerUniverse,
  SearchResponse,
  SectorKey,
  SignalReport,
  Sparklines,
  StockDetail,
} from "@/types/api";

function active(state: MarketState | null | undefined): boolean {
  return state === "REGULAR" || state === "PRE" || state === "POST";
}

/** Market overview: every 30 s while US markets trade, every 2 min otherwise (paused in hidden tabs by SWR). */
export function useOverview() {
  return useSWR<MarketOverview>("/api/market/overview", {
    refreshInterval: (data) => (active(data?.marketState) ? 30_000 : 120_000),
  });
}

/** Quotes for a list of symbols (max 50), refreshed every 15 s while any of them trades. */
export function useQuotes(symbols: string[]) {
  const key = symbols.length > 0 ? `/api/quotes?symbols=${symbolsParam(symbols.slice(0, 50))}` : null;
  return useSWR<QuotesResponse>(key, {
    refreshInterval: (data) => (data?.quotes.some((q) => active(q.marketState)) ? 15_000 : 60_000),
  });
}

/** ~1 month of daily closes per symbol; refreshed every 10 min. */
export function useSparklines(symbols: string[]) {
  const key = symbols.length > 0 ? `/api/sparklines?symbols=${symbolsParam(symbols.slice(0, 50))}` : null;
  return useSWR<Sparklines>(key, { refreshInterval: 600_000, revalidateOnFocus: false });
}

/** Quote, profile, key stats and news for one symbol. */
export function useStock(symbol: string | null) {
  return useSWR<StockDetail>(symbol ? `/api/stock/${encodeURIComponent(symbol)}` : null, {
    refreshInterval: (data) => (active(data?.quote.marketState) ? 20_000 : 300_000),
  });
}

/** Bars for one symbol and range. Never shows the previous range's bars under a newly selected range. */
export function useChart(symbol: string | null, range: ChartRange) {
  return useSWR<ChartData>(symbol ? `/api/stock/${encodeURIComponent(symbol)}/chart?range=${range}` : null, {
    refreshInterval: 300_000,
    revalidateOnFocus: false,
    keepPreviousData: false,
  });
}

/**
 * Aligned daily adjusted closes for up to 25 symbols (portfolio analytics, comparisons). Never shows the series of a
 * previous symbol set or range under a new one.
 */
export function useHistory(symbols: string[], range: HistoryRange) {
  const key = symbols.length > 0 ? `/api/history?symbols=${symbolsParam(symbols.slice(0, 25))}&range=${range}` : null;
  return useSWR<HistoryResponse>(key, { refreshInterval: 900_000, revalidateOnFocus: false, keepPreviousData: false });
}

/** The universe snapshot behind the screener; the server rebuilds it at most every 10 minutes. */
export function useScreener(universe: ScreenerUniverse) {
  return useSWR<ScreenerResponse>(`/api/screener?universe=${universe}`, { refreshInterval: 300_000, revalidateOnFocus: false });
}

/** Style factor values of one symbol with percentiles against the stock universe. */
export function useFactorProfile(symbol: string | null) {
  return useSWR<FactorProfile>(symbol ? `/api/stock/${encodeURIComponent(symbol)}/factors` : null, {
    refreshInterval: 900_000,
    revalidateOnFocus: false,
  });
}

/** Earnings, dividends and macro releases for the symbols (plus the whole stock universe when asked). */
export function useCalendar(symbols: string[], days: number, includeUniverse = false) {
  const params = new URLSearchParams({ days: String(days) });
  if (symbols.length > 0) params.set("symbols", symbols.slice(0, 100).join(","));
  if (includeUniverse) params.set("scope", "universe");
  return useSWR<CalendarResponse>(`/api/calendar?${params.toString()}`, { refreshInterval: 1_800_000, revalidateOnFocus: false });
}

/** A market-wide Yahoo screen (movers, idea lists, trending), quality-filtered on the server. */
export function useDiscover(screen: DiscoverScreen | null, minMarketCap?: number) {
  const params = new URLSearchParams();
  if (screen) params.set("screen", screen);
  if (minMarketCap !== undefined) params.set("minCap", String(minMarketCap));
  return useSWR<DiscoverResponse>(screen ? `/api/discover?${params.toString()}` : null, {
    refreshInterval: (data) => (data?.quotes.some((q) => active(q.marketState)) ? 120_000 : 900_000),
    revalidateOnFocus: false,
  });
}

export function useSignal(symbol: string | null) {
  return useSWR<SignalReport>(symbol ? `/api/stock/${encodeURIComponent(symbol)}/signal` : null, {
    revalidateOnFocus: false,
    refreshInterval: 900_000,
  });
}

/**
 * Symbol search. Results of an earlier query are never shown (or opened with Enter) for a new one. Chinese text is
 * matched locally (lib/names-zh.ts) because Yahoo's search cannot handle it, and failures are not retried.
 */
export function useSymbolSearch(query: string) {
  const q = query.trim();
  return useSWR<SearchResponse>(q.length > 0 && !hasCjk(q) ? `/api/search?q=${encodeURIComponent(q)}` : null, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
    keepPreviousData: false,
    shouldRetryOnError: false,
  });
}

export function useSectorNews(sector: SectorKey | null) {
  return useSWR<NewsResponse>(sector ? `/api/news?sector=${sector}` : null, {
    refreshInterval: 600_000,
    revalidateOnFocus: false,
  });
}

export function useAuthStatus() {
  return useSWR<AuthStatus>("/api/auth/status", { refreshInterval: 0, dedupingInterval: 10_000 });
}
