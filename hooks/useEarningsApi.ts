"use client";

import useSWR from "swr";

import type { AnalystActivity, EarningsDetail } from "@/types/earnings";

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
