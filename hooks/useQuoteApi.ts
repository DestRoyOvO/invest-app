"use client";

import useSWR from "swr";

import type { ChartData, ChartRange, NewsResponse } from "@/types/api";
import type { DividendHistory, FinancialStatements, OwnershipData } from "@/types/research";

// Quote page data: company news, chart bars per range, and the research tabs. The quote itself comes from useStock in
// hooks/useApi.ts; these hooks load in parallel with it, so the price never waits for news or statements.

function stockUrl(symbol: string, path: string): string {
  return `/api/stock/${encodeURIComponent(symbol)}${path}`;
}

/** Company news with industry and macro context, refreshed every 10 minutes. */
export function useStockNews(symbol: string | null) {
  return useSWR<NewsResponse>(symbol ? stockUrl(symbol, "/news") : null, { refreshInterval: 600_000, revalidateOnFocus: false });
}

const INTRADAY_RANGES: ReadonlySet<ChartRange> = new Set(["1d", "5d"]);

export function isIntradayRange(range: ChartRange): boolean {
  return INTRADAY_RANGES.has(range);
}

/**
 * Bars for one symbol and range. Intraday ranges refresh every minute while the session trades (`live`), everything
 * else every 5 minutes. A newly selected range never shows the previous range's bars.
 */
export function useChartSeries(symbol: string | null, range: ChartRange, live = false) {
  const intraday = isIntradayRange(range);
  return useSWR<ChartData>(symbol ? stockUrl(symbol, `/chart?range=${range}`) : null, {
    refreshInterval: intraday && live ? 60_000 : 300_000,
    revalidateOnFocus: false,
    keepPreviousData: false,
  });
}

/** Annual and quarterly statements. Pass enabled=false to defer the request until the tab opens. */
export function useFinancials(symbol: string | null, enabled = true) {
  return useSWR<FinancialStatements>(symbol && enabled ? stockUrl(symbol, "/financials") : null, {
    refreshInterval: 0,
    revalidateOnFocus: false,
  });
}

/** Ten years of dividends with growth, frequency and yield. */
export function useDividends(symbol: string | null, enabled = true) {
  return useSWR<DividendHistory>(symbol && enabled ? stockUrl(symbol, "/dividends") : null, {
    refreshInterval: 0,
    revalidateOnFocus: false,
  });
}

/** Holder breakdown, insider activity and the largest institutions. */
export function useOwnership(symbol: string | null, enabled = true) {
  return useSWR<OwnershipData>(symbol && enabled ? stockUrl(symbol, "/ownership") : null, {
    refreshInterval: 0,
    revalidateOnFocus: false,
  });
}
