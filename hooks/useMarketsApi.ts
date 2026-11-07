"use client";

import useSWR from "swr";

import type { MarketState } from "@/types/api";
import type { WorldMarketsResponse, YieldCurveResponse } from "@/types/markets";
import { getWorldSymbol } from "@/lib/universe";

function trading(state: MarketState | null): boolean {
  return state === "REGULAR" || state === "PRE" || state === "POST";
}

/** True while an exchange-traded row trades; crypto trades around the clock, so it does not count. */
function anyExchangeTrading(data: WorldMarketsResponse | undefined): boolean {
  return (data?.rows ?? []).some((row) => getWorldSymbol(row.symbol)?.region !== "crypto" && trading(row.marketState));
}

/** World indices, FX, commodities and crypto: every 30 s while an exchange trades, every 2 min otherwise. */
export function useWorldMarkets() {
  return useSWR<WorldMarketsResponse>("/api/markets/world", {
    refreshInterval: (data) => (anyExchangeTrading(data) ? 30_000 : 120_000),
  });
}

/** The US Treasury par yield curve; Treasury publishes once a business day. */
export function useYieldCurve() {
  return useSWR<YieldCurveResponse>("/api/rates/curve", { refreshInterval: 1_800_000, revalidateOnFocus: false });
}
