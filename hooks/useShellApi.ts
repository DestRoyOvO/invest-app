"use client";

import useSWR from "swr";

import type { MarketState } from "@/types/api";
import type { BoardResponse } from "@/types/shell";

function trading(state: MarketState | null | undefined): boolean {
  return state === "REGULAR" || state === "PRE" || state === "POST";
}

/**
 * The 10 board instruments and the market state for the ticker strip, the status bar and the top bar: every 15 s while
 * US markets trade, every 2 min otherwise (paused in hidden tabs by SWR). About 13 KB instead of the 80 KB overview.
 */
export function useBoard() {
  return useSWR<BoardResponse>("/api/market/board", {
    refreshInterval: (data) => (trading(data?.marketState) ? 15_000 : 120_000),
  });
}
