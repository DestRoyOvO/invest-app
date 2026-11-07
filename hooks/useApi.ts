"use client";

import useSWR from "swr";

import { symbolsParam } from "@/lib/api-client";
import type {
  AuthStatus,
  ChartData,
  ChartRange,
  MarketOverview,
  MarketState,
  NewsResponse,
  QuotesResponse,
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

export function useSignal(symbol: string | null) {
  return useSWR<SignalReport>(symbol ? `/api/stock/${encodeURIComponent(symbol)}/signal` : null, {
    revalidateOnFocus: false,
    refreshInterval: 900_000,
  });
}

/** Symbol search. Results of an earlier query are never shown (or opened with Enter) for a new one. */
export function useSymbolSearch(query: string) {
  const q = query.trim();
  return useSWR<SearchResponse>(q.length > 0 ? `/api/search?q=${encodeURIComponent(q)}` : null, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
    keepPreviousData: false,
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
