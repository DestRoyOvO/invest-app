"use client";

import useSWR from "swr";

import type { AnalystActivity, EarningsDetail, ImpliedMove } from "@/types/earnings";

/** Next report, consensus, revisions and recent surprises (404 for funds and symbols without coverage). */
export function useEarnings(symbol: string | null) {
  return useSWR<EarningsDetail>(symbol ? `/api/stock/${encodeURIComponent(symbol)}/earnings` : null, {
    refreshInterval: 3_600_000,
    revalidateOnFocus: false,
  });
}

/** Rating distribution, price targets and recent analyst actions. */
export function useAnalysts(symbol: string | null) {
  return useSWR<AnalystActivity>(symbol ? `/api/stock/${encodeURIComponent(symbol)}/analysts` : null, {
    refreshInterval: 3_600_000,
    revalidateOnFocus: false,
  });
}

/**
 * Approximate ATM straddle into the next report (404 without listed options or a report within 30 days). Pass null to
 * skip the request, e.g. until a calendar row scrolls into view. Option quotes change slowly off-hours, so it refreshes
 * every 15 minutes.
 */
export function useImpliedMove(symbol: string | null) {
  return useSWR<ImpliedMove>(symbol ? `/api/stock/${encodeURIComponent(symbol)}/implied-move` : null, {
    refreshInterval: 900_000,
    revalidateOnFocus: false,
  });
}
