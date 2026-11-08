// Pure helpers behind the price chart workstation (PriceChart.tsx), kept free of React and of lightweight-charts so
// they can be tested: which data a range loads, the visible window, studies, time zones and axis labels.

import type { Bar, ChartRange, HistoryRange } from "@/types/api";

export const RANGES: readonly ChartRange[] = ["1d", "5d", "1mo", "3mo", "6mo", "ytd", "1y", "2y", "5y", "max"];

export const MAX_COMPARE = 3;

/**
 * The chart range whose bars a view loads. Every daily view up to two years shares one two-year request: switching
 * between 1M and 1Y needs no new data, the moving averages have their warm-up bars, and panning left shows more.
 */
export function dataRange(range: ChartRange): ChartRange {
  switch (range) {
    case "1mo":
    case "3mo":
    case "6mo":
    case "ytd":
    case "1y":
    case "2y":
      return "2y";
    default:
      return range;
  }
}

/** True when comparisons use dividend-adjusted closes from /api/history (6 months and longer, up to five years). */
export function historyRangeFor(range: ChartRange): HistoryRange | null {
  if (range === "6mo" || range === "ytd" || range === "1y" || range === "2y") return "2y";
  if (range === "5y") return "5y";
  return null;
}

/** Start of the visible window for a view over shared data (UTC ms), or null to show all of it. */
export function windowStart(range: ChartRange, lastT: number): number | null {
  const d = new Date(lastT);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  switch (range) {
    case "1mo":
      return Date.UTC(y, m - 1, day);
    case "3mo":
      return Date.UTC(y, m - 3, day);
    case "6mo":
      return Date.UTC(y, m - 6, day);
    case "ytd":
      return Date.UTC(y, 0, 1);
    case "1y":
      return Date.UTC(y - 1, m, day);
    default:
      return null;
  }
}

/** The range before or after `range` in RANGES (the [ and ] keys), clamped at the ends. */
export function stepRange(range: ChartRange, step: -1 | 1): ChartRange {
  const index = RANGES.indexOf(range);
  return RANGES[Math.min(Math.max(index + step, 0), RANGES.length - 1)];
}

/** Hides pre- and post-market bars unless extended hours are on; daily bars have no session and always stay. */
export function visibleBars(bars: readonly Bar[], extended: boolean): Bar[] {
  return extended ? [...bars] : bars.filter((bar) => (bar.session ?? "regular") === "regular");
}

// ---------------------------------------------------------------------------
// Studies
// ---------------------------------------------------------------------------

/** Simple moving average aligned with the input: null until `period` values are available. */
export function smaSeries(values: readonly number[], period: number): Array<number | null> {
  const out = new Array<number | null>(values.length).fill(null);
  if (period < 1) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Bollinger bands: the moving average plus and minus `k` population standard deviations over `period` values. */
export function bollingerSeries(values: readonly number[], period = 20, k = 2): { upper: Array<number | null>; lower: Array<number | null> } {
  const upper = new Array<number | null>(values.length).fill(null);
  const lower = new Array<number | null>(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    const mean = sum / period;
    let squares = 0;
    for (let j = i - period + 1; j <= i; j++) squares += (values[j] - mean) ** 2;
    const sd = Math.sqrt(squares / period);
    upper[i] = mean + k * sd;
    lower[i] = mean - k * sd;
  }
  return { upper, lower };
}

/** Percent change from `first` to `last` (percent units), or null when either is missing or the base is not positive. */
export function percentChange(first: number | null | undefined, last: number | null | undefined): number | null {
  if (typeof first !== "number" || typeof last !== "number" || !Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return null;
  return (last / first - 1) * 100;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** UTC offset of `timeZone` at the instant `ms`, in seconds (e.g. -18000 for New York in winter). 0 if unknown. */
export function zoneOffsetSeconds(ms: number, timeZone: string | null): number {
  if (!timeZone) return 0;
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
    } catch {
      return 0;
    }
    offsetFormatters.set(timeZone, formatter);
  }
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(ms))) if (part.type !== "literal") parts[part.type] = Number(part.value);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 1000);
}

/**
 * Chart time (seconds) for a bar. The chart draws times as UTC, so intraday bars are shifted by the exchange's offset
 * at that instant and read as local exchange time; daily bars are already UTC midnight of their session date.
 */
export function chartTime(t: number, intraday: boolean, timeZone: string | null): number {
  const seconds = Math.floor(t / 1000);
  return intraday ? seconds + zoneOffsetSeconds(t, timeZone) : seconds;
}

/**
 * The close each intraday bar's change is measured from: the last regular-session close of an earlier session date
 * (the first session in the data uses `previousClose`). A date with only pre-market bars so far keeps the previous
 * session's close, so Monday's pre-market compares with Friday's close.
 */
export function sessionBaselines(bars: readonly Bar[], previousClose: number | null, timeZone: string | null): Array<number | null> {
  const out: Array<number | null> = [];
  let currentDay: number | null = null;
  let baseline = previousClose;
  let lastRegular: number | null = null;
  for (const bar of bars) {
    const day = Math.floor((bar.t / 1000 + zoneOffsetSeconds(bar.t, timeZone)) / 86_400);
    if (currentDay !== null && day !== currentDay && lastRegular !== null) {
      baseline = lastRegular;
      lastRegular = null;
    }
    currentDay = day;
    out.push(baseline);
    if ((bar.session ?? "regular") === "regular") lastRegular = bar.c;
  }
  return out;
}

/**
 * Index of the last bar time at or before `t` (both in the same units), so an event marker lands on the bar that
 * contains it (a dividend on a weekly or monthly bar, an earnings date on a holiday). -1 when `t` precedes every bar.
 */
export function barIndexAt(times: readonly number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Axis labels
// ---------------------------------------------------------------------------

/**
 * Decimals for a set of price ticks: none when every tick is whole (250, not 250.00), otherwise the fewest that
 * show the step between ticks (182.5) and at most four for sub-dollar prices.
 */
export function tickDecimals(ticks: readonly number[]): number {
  const finite = ticks.filter(Number.isFinite);
  if (finite.length === 0) return 2;
  for (let digits = 0; digits <= 4; digits++) {
    const factor = 10 ** digits;
    if (finite.every((tick) => Math.abs(Math.round(tick * factor) - tick * factor) < 1e-6 * Math.max(1, Math.abs(tick * factor)))) return digits;
  }
  return 4;
}
