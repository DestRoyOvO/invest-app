import "server-only";

import type { DailyBar } from "@/lib/bars";
import type { HistoryRange, HistoryResponse } from "@/types/api";

import { getDailyBars, hasCachedDailyBars } from "./yahoo";

// Daily adjusted closes for several symbols on one shared calendar, for portfolio analytics, return comparisons and
// correlations. Each symbol's bars come from the cached daily-bar getter, so pages that share a symbol share the work.

/**
 * Calendar days requested from Yahoo and kept in the response, per range. 6mo and 1y reuse the signal engine's
 * 540-day request, so a symbol whose quote page was opened recently costs no extra upstream call.
 */
const RANGE_DAYS: Record<HistoryRange, { fetch: number; keep: number }> = {
  "6mo": { fetch: 540, keep: 186 },
  "1y": { fetch: 540, keep: 372 },
  "2y": { fetch: 740, keep: 737 },
  "5y": { fetch: 1840, keep: 1835 },
};

export const HISTORY_RANGES = Object.keys(RANGE_DAYS) as HistoryRange[];

export function isHistoryRange(value: string | null): value is HistoryRange {
  return value !== null && value in RANGE_DAYS;
}

/** True when the symbol's bars for the range can be served from the cache without calling Yahoo. */
export function hasCachedHistory(symbol: string, range: HistoryRange): boolean {
  return hasCachedDailyBars(symbol, RANGE_DAYS[range].fetch);
}

export interface AlignedHistory {
  dates: number[];
  closes: Record<string, Array<number | null>>;
  /** Symbols without a single bar from `fromMs` on. */
  missing: string[];
}

/**
 * Aligns adjusted closes on the union of the symbols' session dates from `fromMs` on, keeping the input order of
 * symbols. A symbol gets null on sessions it has no bar for (before its listing, or another market's holiday).
 */
export function alignCloses(symbols: readonly string[], barsBySymbol: ReadonlyMap<string, readonly DailyBar[]>, fromMs: number): AlignedHistory {
  const dateSet = new Set<number>();
  const present: string[] = [];
  const missing: string[] = [];
  for (const symbol of symbols) {
    const bars = (barsBySymbol.get(symbol) ?? []).filter((bar) => bar.t >= fromMs);
    if (bars.length === 0) {
      missing.push(symbol);
      continue;
    }
    present.push(symbol);
    for (const bar of bars) dateSet.add(bar.t);
  }
  const dates = [...dateSet].sort((a, b) => a - b);
  const index = new Map(dates.map((t, i) => [t, i]));
  const closes: Record<string, Array<number | null>> = {};
  for (const symbol of present) {
    const row: Array<number | null> = dates.map(() => null);
    for (const bar of barsBySymbol.get(symbol) ?? []) {
      const i = index.get(bar.t);
      if (i !== undefined) row[i] = bar.adjClose;
    }
    closes[symbol] = row;
  }
  return { dates, closes, missing };
}

/**
 * Aligned closes for up to a few dozen symbols. Symbols that fail or have no data are listed in `missing`; the call
 * throws only when no symbol could be loaded because Yahoo failed.
 */
export async function getHistory(symbols: readonly string[], range: HistoryRange, now = Date.now()): Promise<HistoryResponse> {
  const { fetch, keep } = RANGE_DAYS[range];
  const settled = await Promise.allSettled(symbols.map((symbol) => getDailyBars(symbol, fetch)));
  const bars = new Map<string, readonly DailyBar[]>();
  let failure: unknown = null;
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") bars.set(symbols[i], outcome.value);
    else failure ??= outcome.reason;
  });
  if (bars.size === 0 && failure !== null) throw failure;

  const aligned = alignCloses(symbols, bars, now - keep * 24 * 60 * 60 * 1000);
  return { asOf: new Date(now).toISOString(), range, ...aligned, degraded: failure !== null };
}
