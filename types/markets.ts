// Contract of the world markets and rates endpoints (see types/api.ts for the shared conventions: raw numbers, null for
// missing values, percent fields in percent units, ISO timestamps).
//
//   GET /api/markets/world  -> WorldMarketsResponse  (indices, FX, commodities and crypto of WORLD_BOARD, lib/universe.ts)
//   GET /api/rates/curve    -> YieldCurveResponse    (US Treasury daily par yield curve)

import type { MarketState } from "./api";

// ---------------------------------------------------------------------------
// World markets
// ---------------------------------------------------------------------------

export interface WorldRow {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  /** Session state Yahoo reports for the instrument's own exchange. */
  marketState: MarketState | null;
  /** Time of the last regular-session trade (ISO). */
  time: string | null;
  /** About one month of daily closes, oldest first; empty while it loads or when it failed. */
  spark: number[];
  /** True when the latest refresh failed and an older cached quote is shown. */
  stale: boolean;
}

export interface WorldMarketsResponse {
  asOf: string;
  /** In the order of WORLD_BOARD; symbols without a quote are left out and listed in `missing`. */
  rows: WorldRow[];
  missing: string[];
  /** "sparklines" when some series are still loading or failed, "quotes_stale" when some quotes are old. */
  warnings: string[];
  /** With "quotes_stale": the oldest fetch time among the stale quotes (ISO), so the page can say how old they are. */
  staleSince: string | null;
}

// ---------------------------------------------------------------------------
// US Treasury yield curve
// ---------------------------------------------------------------------------

/** Constant-maturity tenors of the Treasury par yield curve, shortest first ("6W" is the 1.5-month bill). */
export type TenorKey = "1M" | "6W" | "2M" | "3M" | "4M" | "6M" | "1Y" | "2Y" | "3Y" | "5Y" | "7Y" | "10Y" | "20Y" | "30Y";

export interface YieldCurve {
  /** Treasury business day, YYYY-MM-DD. */
  date: string;
  /** Par yields in percent, aligned with YieldCurveResponse.tenors; null where Treasury published none that day. */
  yields: Array<number | null>;
}

export type SpreadKey = "2s10s" | "3m10y";

export interface SpreadPoint {
  date: string;
  /** Basis points. */
  bp: number;
}

export interface YieldSpread {
  /** 2s10s: 10-year minus 2-year; 3m10y: 10-year minus 3-month. */
  key: SpreadKey;
  /** Latest value in basis points; negative means the curve is inverted between the two tenors. */
  bp: number | null;
  /** Value on the curve one month earlier. */
  monthAgoBp: number | null;
  /** Daily values over the last year, oldest first. */
  history: SpreadPoint[];
  /** Days in `history` with a negative spread. */
  invertedDays: number;
}

export interface YieldCurveResponse {
  asOf: string;
  /** Tenors with a yield on at least one of the curves, shortest first. */
  tenors: TenorKey[];
  current: YieldCurve;
  /** The latest curve on or before one month and one year before `current.date`; null without data that far back. */
  monthAgo: YieldCurve | null;
  yearAgo: YieldCurve | null;
  spreads: YieldSpread[];
  /** True when the latest Treasury download failed and older data is shown. */
  stale: boolean;
  /** When the file behind the latest curve was downloaded from Treasury (ISO): how old the data is when `stale`. */
  fetchedAt: string;
  /** "previous_year" when last year's file could not be loaded, so the year-ago curve and part of the history are missing. */
  warnings: string[];
}
