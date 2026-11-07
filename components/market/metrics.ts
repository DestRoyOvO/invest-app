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
