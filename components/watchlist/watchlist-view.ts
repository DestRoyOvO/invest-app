// How the investor last viewed the watchlist table (a per-viewer convenience): the column sort, or null for their own
// order. Sorting is a view only; it never rewrites the stored watchlist order.

import type { SortState } from "@/components/ui/table-sort";
import { createLocalStore } from "@/lib/local-store";

export const WATCHLIST_VIEW_KEY = "investseek:watchlist-view:v1";

export interface WatchlistViewPrefs {
  /** Column sort; null shows the investor's own order (and the drag handles). */
  sort: SortState | null;
}

/** Columns of the watchlist table that can be sorted. */
export const WATCHLIST_SORT_KEYS = ["symbol", "name", "last", "changePct", "marketCap", "pe"] as const;

const EMPTY: WatchlistViewPrefs = { sort: null };

export function sanitizeWatchlistView(raw: unknown): WatchlistViewPrefs {
  if (!raw || typeof raw !== "object") return EMPTY;
  const sort = (raw as { sort?: unknown }).sort;
  if (!sort || typeof sort !== "object") return EMPTY;
  const { key, direction } = sort as { key?: unknown; direction?: unknown };
  const known = typeof key === "string" && (WATCHLIST_SORT_KEYS as readonly string[]).includes(key);
  return known && (direction === "asc" || direction === "desc") ? { sort: { key: key as string, direction } } : EMPTY;
}

export const watchlistViewStore = createLocalStore<WatchlistViewPrefs>({ key: WATCHLIST_VIEW_KEY, sanitize: sanitizeWatchlistView, empty: EMPTY });
