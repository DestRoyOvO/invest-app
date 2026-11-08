import "server-only";

import { MACRO_CALENDAR_ENDS, macroEventsBetween } from "@/lib/macro-calendar";
import type { CalendarEvent, CalendarResponse, Quote } from "@/types/api";

import { getQuotes } from "./yahoo";

// Upcoming events for a set of symbols: earnings reports and ex-dividend dates from the batched quotes (cached per
// symbol, so the calendar costs at most one or two Yahoo requests), plus the scheduled macro releases.

const DAY_MS = 24 * 60 * 60 * 1000;
/** Events from shortly before now stay visible, so a report released this morning still shows. */
const LOOKBACK_DAYS = 2;

const NY_HOUR = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" });

/** True for listings on a US exchange. Yahoo suffixes other listings with their market (0700.HK, SAP.DE, 7203.T). */
export function isUsListing(symbol: string): boolean {
  return !symbol.includes(".");
}

/**
 * Session timing of an earnings release from its New York time. Null for estimates (Yahoo uses placeholder times), for
 * date-only values (UTC midnight) and for listings outside the US, where the New York session says nothing.
 */
export function earningsTiming(iso: string, estimated: boolean, symbol?: string): CalendarEvent["timing"] {
  if (estimated) return null;
  if (symbol !== undefined && !isUsListing(symbol)) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms % DAY_MS === 0) return null;
  const parts = NY_HOUR.formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const minutes = hour * 60 + minute;
  if (minutes < 9 * 60 + 30) return "pre";
  if (minutes >= 16 * 60) return "post";
  return "intraday";
}

function inWindow(iso: string | null, from: number, to: number): iso is string {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t >= from && t < to;
}

/** Earnings and dividend events of one quote inside [from, to). Exported for tests. */
export function quoteEvents(quote: Quote, from: number, to: number): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const base = { symbol: quote.symbol, name: quote.name, macro: null, period: null, projections: false };
  for (const [iso, estimated] of [
    [quote.nextEarningsDate, quote.earningsDateEstimated === true],
    [quote.lastEarningsDate, false],
  ] as const) {
    if (!inWindow(iso, from, to)) continue;
    const id = `earnings:${quote.symbol}:${iso.slice(0, 10)}`;
    // Around a report Yahoo's next and last timestamps can fall on the same day: keep one event so ids stay unique.
    if (events.some((event) => event.id === id)) continue;
    events.push({ ...base, id, kind: "earnings", at: iso, timing: earningsTiming(iso, estimated, quote.symbol), estimated, amount: null });
  }
  // Ex-dividend dates (you must hold the shares before this date to receive the dividend). Payment dates are left
  // out: Yahoo often keeps a past one, and the ex-date is the one that matters for a holder.
  if (inWindow(quote.exDividendDate, from, to)) {
    events.push({
      ...base,
      id: `dividend:${quote.symbol}:${quote.exDividendDate.slice(0, 10)}`,
      kind: "dividend",
      at: quote.exDividendDate,
      timing: null,
      estimated: false,
      amount: quote.dividendAmount,
    });
  }
  return events;
}

/** Macro releases inside [from, to) as calendar events. Exported for tests. */
export function macroCalendarEvents(from: number, to: number): CalendarEvent[] {
  return macroEventsBetween(from, to).map((event) => ({
    id: `macro:${event.key}:${event.at.slice(0, 10)}`,
    kind: "macro",
    at: new Date(event.at).toISOString(),
    timing: null,
    estimated: event.tentative === true,
    symbol: null,
    name: null,
    macro: event.key,
    period: event.period,
    projections: event.projections === true,
    amount: null,
  }));
}

/** Events for the symbols over the next `days` days (and the last two), sorted by time. */
export async function getCalendar(symbols: readonly string[], days: number, now = Date.now()): Promise<CalendarResponse> {
  const from = now - LOOKBACK_DAYS * DAY_MS;
  const to = now + days * DAY_MS;
  const quotes = symbols.length > 0 ? await getQuotes([...symbols]) : new Map<string, Quote>();
  const events = [...symbols.flatMap((symbol) => {
    const quote = quotes.get(symbol);
    return quote ? quoteEvents(quote, from, to) : [];
  }), ...macroCalendarEvents(from, to)];
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  return {
    asOf: new Date(now).toISOString(),
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    events,
    missing: symbols.filter((symbol) => !quotes.has(symbol)),
    macroCalendarEnds: new Date(MACRO_CALENDAR_ENDS).toISOString(),
  };
}
