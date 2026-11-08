// Bar normalization shared by the server data layer and offline scripts (pure, no I/O).
//
// Yahoo stamps daily bars at the session open, weekly and monthly bars at local midnight, and intraday bars at their
// start time. Daily and longer bars are mapped to the session date (UTC midnight); intraday bars keep their real
// timestamps and get the trading session (pre, regular, post) they belong to.

/** Daily bar with the dividend/split-adjusted close, used by the signal engine. */
export interface DailyBar {
  /** UTC midnight of the session date in the exchange time zone. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  adjClose: number;
  v: number | null;
}

export type IntradaySession = "pre" | "regular" | "post";

/** Intraday bar: `t` is the bar's start time (epoch ms). */
export interface IntradayBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
  session: IntradaySession;
}

/** Loose shape of a yahoo-finance2 chart() result (validation is off, so every field is checked here). */
export interface RawChart {
  meta?: Record<string, unknown>;
  quotes?: Array<Record<string, unknown>>;
  /** Arrays with the default return: "array", objects keyed by timestamp with return: "object". */
  events?: { dividends?: unknown; splits?: unknown };
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Epoch ms from a Date, an ISO string or a Yahoo number (seconds, or milliseconds when above 1e12). */
export function toMs(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  if (value && typeof value === "object" && "raw" in value) return toMs((value as { raw: unknown }).raw);
  return null;
}

/**
 * UTC midnight of the exchange-local date of `ms`, given the exchange's UTC offset in seconds. Yahoo's offset is the
 * one in force today, so across a daylight-saving change it can be an hour off; a local time in the last two hours
 * before midnight therefore counts as the next day. Weekly and monthly bars stamped at local midnight then keep their
 * date, and daily bars (stamped at the session open) are never near midnight.
 */
export function sessionDate(ms: number, gmtOffsetSec: number): number {
  const local = ms + gmtOffsetSec * 1000;
  const day = Math.floor(local / DAY_MS) * DAY_MS;
  return local - day >= 22 * HOUR_MS ? day + DAY_MS : day;
}

/** Exchange-local day number of `ms` (days since the epoch), for grouping intraday bars by session date. */
export function localDay(ms: number, gmtOffsetSec: number): number {
  return Math.floor((ms + gmtOffsetSec * 1000) / DAY_MS);
}

function gmtOffsetOf(chart: RawChart | null | undefined): number {
  return finite(chart?.meta?.gmtoffset) ?? 0;
}

/**
 * Converts chart rows into clean daily bars: drops rows with missing or non-positive prices, maps each row to the
 * session date in the exchange time zone (UTC midnight), and keeps only the latest row when Yahoo repeats a date.
 */
export function normalizeBars(chart: RawChart | null | undefined): DailyBar[] {
  if (!chart?.quotes) return [];
  const gmtOffsetSec = gmtOffsetOf(chart);
  const bars: DailyBar[] = [];
  for (const q of chart.quotes) {
    const ms = toMs(q.date);
    const o = finite(q.open);
    const h = finite(q.high);
    const l = finite(q.low);
    const c = finite(q.close);
    if (ms === null || o === null || h === null || l === null || c === null || c <= 0) continue;
    const t = sessionDate(ms, gmtOffsetSec);
    const adjClose = finite(q.adjclose) ?? c;
    const v = finite(q.volume);
    if (bars.length > 0 && bars[bars.length - 1].t === t) bars.pop();
    bars.push({ t, o, h, l, c, adjClose, v });
  }
  return bars;
}

/** Start of the bar's period: the Monday of its week or the first of its month (UTC midnight). */
function periodStart(t: number, interval: "1wk" | "1mo"): number {
  const date = new Date(t);
  if (interval === "1mo") return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  return t - weekday * DAY_MS;
}

/**
 * Weekly and monthly charts end with an extra row for the latest session (stamped at its trade time) after the row of
 * the period it belongs to. Folds that row into the period bar: the period keeps its date and open, takes the wider
 * high and low and the latest close. The period row already counts the session's volume, so its volume is kept.
 */
export function foldTrailingSession<T extends { t: number; o: number; h: number; l: number; c: number }>(bars: readonly T[], interval: "1wk" | "1mo"): T[] {
  if (bars.length < 2) return [...bars];
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  if (periodStart(last.t, interval) !== periodStart(prev.t, interval)) return [...bars];
  const merged = { ...prev, h: Math.max(prev.h, last.h), l: Math.min(prev.l, last.l), c: last.c };
  if ("adjClose" in last && "adjClose" in merged) (merged as { adjClose: unknown }).adjClose = (last as { adjClose: unknown }).adjClose;
  return [...bars.slice(0, -2), merged];
}

// ---------------------------------------------------------------------------
// Intraday bars and sessions
// ---------------------------------------------------------------------------

interface Period {
  start: number;
  end: number;
}

function toPeriod(raw: unknown): Period | null {
  if (!raw || typeof raw !== "object") return null;
  const start = toMs((raw as { start?: unknown }).start);
  const end = toMs((raw as { end?: unknown }).end);
  return start !== null && end !== null && end > start ? { start, end } : null;
}

/**
 * Regular-session periods from the chart meta. Yahoo sends tradingPeriods as { pre, regular, post } (arrays of days,
 * each an array of periods) when pre- and post-market data is included, and as a plain array of days of regular
 * periods otherwise; times are Dates or epoch seconds depending on the library's coercion.
 */
export function regularPeriods(meta: Record<string, unknown> | undefined): Period[] {
  const tp = meta?.tradingPeriods;
  let rows: unknown[] = [];
  if (Array.isArray(tp)) rows = tp.flat();
  else if (tp && typeof tp === "object" && Array.isArray((tp as { regular?: unknown }).regular)) rows = ((tp as { regular: unknown[] }).regular).flat();
  return rows
    .map(toPeriod)
    .filter((p): p is Period => p !== null)
    .sort((a, b) => a.start - b.start);
}

/** Minutes after local midnight of the current regular session's start and end, the fallback for days without periods. */
function sessionTemplate(meta: Record<string, unknown> | undefined, gmtOffsetSec: number): { open: number; close: number } | null {
  const current = (meta?.currentTradingPeriod as { regular?: unknown } | undefined)?.regular;
  const period = toPeriod(current);
  if (!period) return null;
  const minutes = (ms: number) => Math.round(((ms + gmtOffsetSec * 1000) % DAY_MS + DAY_MS) % DAY_MS / 60_000);
  const open = minutes(period.start);
  const close = minutes(period.end);
  return close > open ? { open, close } : null;
}

/** Classifies bar start times into pre, regular and post sessions (see regularPeriods and sessionTemplate). */
export function sessionClassifier(meta: Record<string, unknown> | undefined): (t: number) => IntradaySession {
  const gmtOffsetSec = finite(meta?.gmtoffset) ?? 0;
  const periods = regularPeriods(meta);
  const template = sessionTemplate(meta, gmtOffsetSec);
  const byDay = new Map<number, Period>();
  for (const period of periods) {
    const day = localDay(period.start, gmtOffsetSec);
    const known = byDay.get(day);
    // A day with a split session (a lunch break) is classified against its first open and last close.
    byDay.set(day, known ? { start: Math.min(known.start, period.start), end: Math.max(known.end, period.end) } : period);
  }
  return (t) => {
    for (const period of periods) if (t >= period.start && t < period.end) return "regular";
    const period = byDay.get(localDay(t, gmtOffsetSec));
    if (period) return t < period.start ? "pre" : t >= period.end ? "post" : "regular";
    if (template) {
      const minute = Math.floor((((t + gmtOffsetSec * 1000) % DAY_MS) + DAY_MS) % DAY_MS / 60_000);
      return minute < template.open ? "pre" : minute >= template.close ? "post" : "regular";
    }
    return "regular";
  };
}

/**
 * Offset of the interval grid most timestamps sit on (ms past a multiple of `intervalMs`): 0 for exchanges whose
 * sessions open on the hour or half hour. A tie goes to the offset seen first.
 */
export function gridPhase(times: readonly number[], intervalMs: number): number {
  const counts = new Map<number, number>();
  let best = 0;
  let bestCount = 0;
  for (const t of times) {
    const phase = ((t % intervalMs) + intervalMs) % intervalMs;
    const count = (counts.get(phase) ?? 0) + 1;
    counts.set(phase, count);
    if (count > bestCount) {
      best = phase;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Intraday rows to bars that keep their timestamps: rows with missing or non-positive prices are dropped, a repeated
 * timestamp keeps its latest row, and every bar gets its session. Yahoo ends with an extra row for the latest trade,
 * stamped at its own time (19:59:59) rather than on the interval grid. Given `intervalMs`, such a row is folded into
 * the bar it falls in: the bar keeps its open, takes the wider high and low, the latest close and the added volume
 * (a bar is created at the grid time if there is none), so the chart shows no extra sliver of a candle.
 */
export function normalizeIntradayBars(chart: RawChart | null | undefined, intervalMs?: number): IntradayBar[] {
  if (!chart?.quotes) return [];
  const classify = sessionClassifier(chart.meta);
  const rows: Array<Omit<IntradayBar, "session">> = [];
  for (const q of chart.quotes) {
    const t = toMs(q.date);
    const o = finite(q.open);
    const h = finite(q.high);
    const l = finite(q.low);
    const c = finite(q.close);
    if (t === null || o === null || h === null || l === null || c === null || c <= 0) continue;
    rows.push({ t, o, h, l, c, v: finite(q.volume) });
  }
  const step = intervalMs !== undefined && intervalMs > 0 ? intervalMs : null;
  const phase = step ? gridPhase(rows.map((row) => row.t), step) : 0;
  const bars: IntradayBar[] = [];
  for (const row of rows) {
    const start = step ? row.t - ((((row.t - phase) % step) + step) % step) : row.t;
    const last = bars.at(-1);
    if (last && last.t > start) continue; // out of order: keep the timeline monotonic
    if (last && last.t === start) {
      if (start !== row.t) {
        last.h = Math.max(last.h, row.h);
        last.l = Math.min(last.l, row.l);
        last.c = row.c;
        last.v = last.v === null && row.v === null ? null : (last.v ?? 0) + (row.v ?? 0);
        continue;
      }
      bars.pop();
    }
    bars.push({ ...row, t: start, session: classify(start) });
  }
  return bars;
}

/**
 * The latest `count` session dates that have regular-session bars, plus any later bars (the next day's pre-market).
 * With no regular bars at all (a holiday week, or data that is all extended hours) the latest `count` dates are kept.
 * Also returns the last regular close before the first kept day, for the change baseline.
 */
export function latestSessions<T extends { t: number; c: number; session?: IntradaySession }>(
  bars: readonly T[],
  count: number,
  gmtOffsetSec: number,
): { bars: T[]; previousClose: number | null } {
  if (bars.length === 0 || count < 1) return { bars: [], previousClose: null };
  const regularDays = [...new Set(bars.filter((b) => (b.session ?? "regular") === "regular").map((b) => localDay(b.t, gmtOffsetSec)))];
  const days = regularDays.length > 0 ? regularDays : [...new Set(bars.map((b) => localDay(b.t, gmtOffsetSec)))];
  const firstDay = days[Math.max(0, days.length - count)];
  const kept = bars.filter((b) => localDay(b.t, gmtOffsetSec) >= firstDay);
  let previousClose: number | null = null;
  for (const bar of bars) {
    if (localDay(bar.t, gmtOffsetSec) >= firstDay) break;
    if ((bar.session ?? "regular") === "regular") previousClose = bar.c;
  }
  return { bars: kept, previousClose };
}

/**
 * True for markets that trade around the clock (crypto, and nearly so futures and currencies): Yahoo gives them a
 * regular period of 23 hours or more. Their "latest session date" would start at midnight, so the intraday ranges
 * use rolling windows of 24 hours instead.
 */
export function tradesAroundTheClock(meta: Record<string, unknown> | undefined): boolean {
  const period = toPeriod((meta?.currentTradingPeriod as { regular?: unknown } | undefined)?.regular);
  return period !== null && period.end - period.start >= 23 * HOUR_MS;
}

/** The bars of the last `days` x 24 hours, and the close just before them as the change baseline. */
export function rollingWindow<T extends { t: number; c: number }>(bars: readonly T[], days: number): { bars: T[]; previousClose: number | null } {
  const last = bars.at(-1);
  if (!last || days <= 0) return { bars: [], previousClose: null };
  const from = last.t - days * DAY_MS;
  const index = bars.findIndex((bar) => bar.t > from);
  return { bars: bars.slice(index), previousClose: index > 0 ? bars[index - 1].c : null };
}

// ---------------------------------------------------------------------------
// Dividend and split events
// ---------------------------------------------------------------------------

export interface DividendEvent {
  t: number;
  amount: number;
}

export interface SplitEvent {
  t: number;
  numerator: number;
  denominator: number;
  ratio: string;
}

function eventList(value: unknown): Array<Record<string, unknown>> {
  const list = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : [];
  return list.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
}

/**
 * Dividend events, oldest first, one per date. `intraday` keeps the event's timestamp; otherwise it is mapped to the
 * session date like the daily bars, so a marker lands on its bar.
 */
export function normalizeDividends(chart: RawChart | null | undefined, intraday = false): DividendEvent[] {
  const gmtOffsetSec = gmtOffsetOf(chart);
  const byTime = new Map<number, DividendEvent>();
  for (const event of eventList(chart?.events?.dividends)) {
    const ms = toMs(event.date);
    const amount = finite(event.amount);
    if (ms === null || amount === null || amount <= 0) continue;
    const t = intraday ? ms : sessionDate(ms, gmtOffsetSec);
    byTime.set(t, { t, amount });
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/** Split events, oldest first (see normalizeDividends for `intraday`). */
export function normalizeSplits(chart: RawChart | null | undefined, intraday = false): SplitEvent[] {
  const gmtOffsetSec = gmtOffsetOf(chart);
  const byTime = new Map<number, SplitEvent>();
  for (const event of eventList(chart?.events?.splits)) {
    const ms = toMs(event.date);
    const numerator = finite(event.numerator);
    const denominator = finite(event.denominator);
    if (ms === null || numerator === null || denominator === null || numerator <= 0 || denominator <= 0) continue;
    const t = intraday ? ms : sessionDate(ms, gmtOffsetSec);
    const ratio = typeof event.splitRatio === "string" && event.splitRatio.trim() ? event.splitRatio.trim() : `${numerator}:${denominator}`;
    byTime.set(t, { t, numerator, denominator, ratio });
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}
