// Screener columns beyond the shared ScreenerRow contract (types/api.ts). lib/server/screener.ts fills them from the
// batched quote, so they cost no extra Yahoo call. They are optional so that a client reading an older snapshot (or a
// test fixture built from ScreenerRow alone) still type-checks; a missing field reads as "no data".

import type { ScreenerRow } from "./api";

export interface ScreenerRowExtras {
  /** Forward annual dividend per share (Quote.dividendRate). */
  dividendRate?: number | null;
  /**
   * Ex-date of the announced cash dividend (ISO, midnight New York time), today or later on the snapshot's New York
   * date; null when none is announced or the latest one has already gone ex.
   */
  exDividendDate?: string | null;
}

/** One screener row as the snapshot serves it. */
export type ScreenRow = ScreenerRow & ScreenerRowExtras;
