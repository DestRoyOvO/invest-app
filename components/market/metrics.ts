// Small pure helpers shared by the overview's heatmap card, movers and breadth panels.

import { toPercent } from "@/components/ui/glyphs";
import type { OverviewQuote } from "@/types/api";

/** Volume today as a multiple of the 3-month daily average; null without both. */
export function relativeVolume(quote: Pick<OverviewQuote, "volume" | "avgVolume">): number | null {
  const { volume, avgVolume } = quote;
  return volume !== null && avgVolume !== null && volume >= 0 && avgVolume > 0 ? volume / avgVolume : null;
}

/** Where the price sits in its 52-week range, 0 (at the low) to 100 (at the high); null without a valid range. */
export function rangePosition(quote: Pick<OverviewQuote, "price" | "fiftyTwoWeekLow" | "fiftyTwoWeekHigh">): number | null {
  const { price, fiftyTwoWeekLow: low, fiftyTwoWeekHigh: high } = quote;
  if (low === null || high === null || !(high > low)) return null;
  return toPercent(price, low, high);
}

/** A share in whole percent (0 to 100), or null when there is nothing to divide by. */
export function sharePercent(count: number, of: number): number | null {
  return of > 0 ? Math.round((count / of) * 100) : null;
}

/**
 * When the data under a stale banner was fetched: the oldest stale quote when the server served some ("quotes_stale"),
 * otherwise the time the response was assembled (the last refresh failed and the previous response is shown). Null
 * when that is unknown, so the banner leaves the time out rather than pairing "stale" with the current time.
 */
export function staleSinceOf(data: { asOf: string; warnings: readonly string[]; staleSince: string | null } | undefined): string | null {
  if (!data) return null;
  return data.warnings.includes("quotes_stale") ? data.staleSince : data.asOf;
}
