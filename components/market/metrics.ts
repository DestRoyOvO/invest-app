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

/** The fields of a market payload (overview, board, world, breadth) that say whether and since when it is stale. */
export interface StaleFields {
  asOf: string;
  warnings: readonly string[];
  staleSince: string | null;
}

/**
 * When the data under a stale banner was fetched: the oldest stale quote when the server served some ("quotes_stale"),
 * otherwise the time the response was assembled (the last refresh failed and the previous response is shown). Null
 * when that is unknown, so the banner leaves the time out rather than pairing "stale" with the current time.
 */
export function staleSinceOf(data: StaleFields | undefined): string | null {
  if (!data) return null;
  return data.warnings.includes("quotes_stale") ? data.staleSince : data.asOf;
}

/** What a stale banner says about one feed: whether older data is shown, and since when (null when unknown). */
export interface Staleness {
  stale: boolean;
  since: string | null;
}

/** One feed's staleness: the server served older quotes, or the latest refresh failed while the last payload is shown. */
export function stalenessOf(data: StaleFields | undefined, refreshFailed: boolean): Staleness {
  const stale = Boolean(data) && (refreshFailed || Boolean(data?.warnings.includes("quotes_stale")));
  return { stale, since: stale ? staleSinceOf(data) : null };
}

/** One banner over several feeds: stale when any is, since the oldest of their times; no time when one is unknown. */
export function combineStaleness(feeds: readonly Staleness[]): Staleness {
  const stale = feeds.filter((feed) => feed.stale);
  if (stale.length === 0) return { stale: false, since: null };
  let since: string | null = null;
  for (const feed of stale) {
    if (feed.since === null) return { stale: true, since: null };
    if (since === null || Date.parse(feed.since) < Date.parse(since)) since = feed.since;
  }
  return { stale: true, since };
}
