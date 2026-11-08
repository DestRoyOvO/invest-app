// Pure helpers behind the risk panel: the volatility quintile, the geometry of the expected-range band and whether the
// next earnings report falls inside the forecast's horizon. No React and no JSON: the panel passes the data in.

import type { QuintileRow } from "@/lib/evaluation";
import type { PriceRange } from "@/types/api";

function isNum(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const round2 = (value: number) => Math.round(value * 100) / 100;

const DAY_MS = 86_400_000;

/**
 * Volatility quintile, 1 (calmest) to 5: ceil(percentile / 20) from the universe percentile of the 63-session
 * volatility, or, without a percentile, the 63-session volatility against the four quintile boundaries.
 */
export function volatilityQuintile(
  percentile: number | null | undefined,
  volatility63: number | null | undefined,
  breakpoints: readonly number[] | null | undefined,
): number | null {
  if (isNum(percentile)) return Math.min(5, Math.max(1, Math.ceil(percentile / 20)));
  if (isNum(volatility63) && breakpoints && breakpoints.length === 4) return 1 + breakpoints.filter((b) => volatility63 > b).length;
  return null;
}

export function quintileRow(rows: readonly QuintileRow[], quintile: number): QuintileRow | null {
  return rows.find((row) => row.quintile === quintile) ?? null;
}

/** Move from the reference price to a bound, as a ratio (−0.066 for a bound 6.6% below the price). */
export function rangeOffset(price: number | null | undefined, bound: number | null | undefined): number | null {
  return isNum(price) && price > 0 && isNum(bound) ? bound / price - 1 : null;
}

/**
 * Standard deviation of the log return over the horizon implied by an annualized volatility: vol x sqrt(days / 252).
 * About the size of a typical move over those sessions.
 */
export function horizonMove(annualVolatility: number | null | undefined, horizonDays: number, tradingDays = 252): number | null {
  return isNum(annualVolatility) && annualVolatility >= 0 && horizonDays > 0 ? annualVolatility * Math.sqrt(horizonDays / tradingDays) : null;
}

export interface BandLayout {
  /** Left edge and width of the plus/minus 2 sigma band, in percent of the track. */
  outer: { left: number; width: number };
  /** The plus/minus 1 sigma band. */
  inner: { left: number; width: number };
  /** Position of the reference price. */
  marker: number;
}

/**
 * Positions of the two bands and the price marker on a linear price axis that spans the outer band plus `pad` of its
 * width on each side. Null when a range is missing, empty or inconsistent (the inner band must sit inside the outer
 * one and contain the price).
 */
export function bandLayout(price: number | null | undefined, range1: PriceRange | null | undefined, range2: PriceRange | null | undefined, pad = 0.08): BandLayout | null {
  if (!isNum(price) || !range1 || !range2) return null;
  const { low, high } = range2;
  if (![low, high, range1.low, range1.high].every(isNum) || !(high > low)) return null;
  if (range1.low < low || range1.high > high || price < range1.low || price > range1.high) return null;
  const span = high - low;
  const min = low - span * pad;
  const total = span * (1 + 2 * pad);
  const x = (value: number) => round2(((value - min) / total) * 100);
  return {
    outer: { left: x(low), width: round2(x(high) - x(low)) },
    inner: { left: x(range1.low), width: round2(x(range1.high) - x(range1.low)) },
    marker: x(price),
  };
}

/** Calendar date (YYYY-MM-DD) of an instant in New York, the exchange's time zone. */
export function exchangeDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * Weekdays d with from < d <= to (dates as YYYY-MM-DD), 0 when `to` is not after `from`. Exchange holidays are not
 * known here, so across a holiday this counts one session too many.
 */
export function weekdaysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  // Whole weeks first, then the remaining days one by one.
  const days = Math.round((end - start) / DAY_MS);
  const weeks = Math.floor(days / 7);
  let count = weeks * 5;
  for (let t = start + weeks * 7 * DAY_MS + DAY_MS; t <= end; t += DAY_MS) {
    const weekday = new Date(t).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

/**
 * True when the next earnings report falls inside the forecast: on or after the session of the reference close, and
 * within `horizonDays` weekdays of it. A date before today is ignored (Yahoo sometimes keeps a past report date).
 * `referenceClose` is the ISO time of the last completed daily bar (UTC midnight of its session).
 */
export function reportWithinHorizon(
  nextEarnings: string | null | undefined,
  referenceClose: string | null | undefined,
  horizonDays: number,
  now: number = Date.now(),
): boolean {
  const report = exchangeDate(nextEarnings);
  const today = exchangeDate(now);
  if (!report || !today || report < today) return false;
  const start = referenceClose && /^\d{4}-\d{2}-\d{2}/.test(referenceClose) ? referenceClose.slice(0, 10) : today;
  if (report < start) return false;
  return weekdaysBetween(start, report) <= horizonDays;
}
