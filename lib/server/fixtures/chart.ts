import "server-only";

import { dividendSchedule } from "./company";
import { aggregateRows, closeBefore, dailyRows, intradayRows, priceDigits, type DailyRow, type IntradayRow, type Period } from "./prices";
import { recentRows } from "./quote";
import { securityOf, type Security } from "./securities";
import {
  dailyStamp,
  isTradingDay,
  latestCompletedSession,
  localDayOf,
  localToUtc,
  nextTradingDay,
  parseDayKey,
  sessionClose,
  sessionOpen,
  tradingDaysBetween,
  zoneOffsetMinutes,
  zoneShortName,
  type MarketProfile,
} from "./sessions";

// chart() of the fixture data, shaped like yahoo-finance2's default "array" result: { meta, quotes, events } with
// Date objects for every time. Daily bars end at the latest completed session; weekly and monthly bars aggregate them;
// intraday bars (1m to 1h) exist for completed sessions only and include pre- and after-market bars when
// includePrePost is on (the library's default). An unknown symbol fails with Yahoo's own message.

export interface FixtureChartOptions {
  period1: Date | string | number;
  period2?: Date | string | number;
  interval?: string;
  includePrePost?: boolean;
  events?: string;
  return?: "array" | "object";
}

/** Yahoo's error for a symbol it has no chart for. */
export const NO_CHART_DATA = "No data found, symbol may be delisted";

const INTRADAY_MINUTES: Readonly<Record<string, number>> = { "1m": 1, "2m": 2, "5m": 5, "15m": 15, "30m": 30, "60m": 60, "90m": 90, "1h": 60 };
/** How far back Yahoo serves each intraday interval; older sessions are left out. */
const INTRADAY_DAYS: Readonly<Record<string, number>> = { "1m": 30, "2m": 60, "5m": 60, "15m": 60, "30m": 60, "60m": 730, "90m": 60, "1h": 730 };
const PERIODS: Readonly<Record<string, Period>> = { "5d": "5d", "1wk": "1wk", "1mo": "1mo", "3mo": "3mo" };
const VALID_RANGES = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"];

/** Real stock splits of a few well-known symbols, so split markers have something to show. Bars stay continuous. */
const SPLITS: Readonly<Record<string, ReadonlyArray<readonly [string, number, number]>>> = {
  NVDA: [
    ["2021-07-20", 4, 1],
    ["2024-06-10", 10, 1],
  ],
  AAPL: [["2020-08-31", 4, 1]],
  TSLA: [
    ["2020-08-31", 5, 1],
    ["2022-08-25", 3, 1],
  ],
  AMZN: [["2022-06-06", 20, 1]],
  GOOGL: [["2022-07-18", 20, 1]],
  AVGO: [["2024-07-15", 10, 1]],
  WMT: [["2024-02-26", 3, 1]],
};

/** Epoch ms of a chart period option the way the library reads it (numbers are epoch seconds). */
export function periodMs(value: Date | string | number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`yahooFinance.chart() option 'period1' invalid date provided: '${value}'`);
  return parsed;
}

function tradingPeriod(profile: MarketProfile, start: number, end: number, now: number) {
  return { timezone: zoneShortName(profile.timeZone, now), start: new Date(start), end: new Date(end), gmtoffset: zoneOffsetMinutes(profile.timeZone, now) * 60 };
}

/** The pre, regular and post periods of a day (zero-length pre and post where a market has none). */
function periodsOf(profile: MarketProfile, day: number, now: number) {
  const open = sessionOpen(profile, day);
  const close = sessionClose(profile, day);
  const preStart = profile.pre === null ? open : localToUtc(profile.timeZone, day, profile.pre);
  const postEnd = profile.post === null ? close : localToUtc(profile.timeZone, day, profile.post);
  return {
    pre: tradingPeriod(profile, preStart, open, now),
    regular: tradingPeriod(profile, open, close, now),
    post: tradingPeriod(profile, close, postEnd, now),
  };
}

function quoteRow(row: DailyRow | IntradayRow, withAdjclose: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { date: new Date(row.t), high: row.h, volume: row.v, open: row.o, low: row.l, close: row.c };
  if (withAdjclose) out.adjclose = row.c;
  return out;
}

function chartEvents(security: Security, from: number, to: number, latest: number, kinds: string): Record<string, unknown[]> | undefined {
  const events: Record<string, unknown[]> = {};
  if (/div/.test(kinds)) {
    const schedule = dividendSchedule(security, latest);
    const dividends = (schedule?.history ?? [])
      .filter((payment) => payment.exDay <= latest)
      .map((payment) => ({ amount: payment.amount, date: new Date(dailyStamp(security.profile, payment.exDay)) }))
      .filter((event) => event.date.getTime() >= from && event.date.getTime() <= to);
    if (dividends.length) events.dividends = dividends;
  }
  if (/split/.test(kinds)) {
    const splits = (SPLITS[security.symbol] ?? [])
      .map(([day, numerator, denominator]) => ({
        date: new Date(dailyStamp(security.profile, parseDayKey(day))),
        numerator,
        denominator,
        splitRatio: `${numerator}:${denominator}`,
      }))
      .filter((event) => event.date.getTime() >= from && event.date.getTime() <= to);
    if (splits.length) events.splits = splits;
  }
  return Object.keys(events).length ? events : undefined;
}

/** chart(symbol, options) in fixture mode. Throws Yahoo's "No data found" error for unknown symbols. */
export function buildChart(symbol: string, options: FixtureChartOptions, now: number): Record<string, unknown> {
  const security = securityOf(symbol);
  if (!security) throw new Error(NO_CHART_DATA);
  const profile = security.profile;
  const tz = profile.timeZone;
  const p2 = periodMs(options.period2, now);
  const p1 = periodMs(options.period1, p2);
  const interval = options.interval ?? "1d";
  const includePrePost = options.includePrePost ?? true;
  const latest = latestCompletedSession(profile, now);
  const endDay = Math.min(latest, localDayOf(tz, Math.min(p2, now)));
  const intradayStep = INTRADAY_MINUTES[interval];

  let rows: Array<DailyRow | IntradayRow> = [];
  let previousClose: number | null = null;
  let firstDay: number | null = null;
  if (intradayStep !== undefined) {
    const oldest = Math.max(localDayOf(tz, p1), latest - (INTRADAY_DAYS[interval] ?? 60));
    for (const day of tradingDaysBetween(profile, oldest, endDay)) {
      const bar = dailyRows(security, day, day)[0];
      const before = closeBefore(security, day) ?? bar.o;
      firstDay ??= day;
      rows.push(...intradayRows(security, bar, before, intradayStep, includePrePost).filter((row) => row.t >= p1 && row.t <= p2));
    }
    previousClose = closeBefore(security, latest);
  } else {
    const startDay = localDayOf(tz, p1);
    const daily = dailyRows(security, startDay, endDay).filter((row) => row.day > startDay || row.t >= p1);
    const period = PERIODS[interval];
    rows = period ? aggregateRows(security, daily, period) : [...daily];
    firstDay = daily[0]?.day ?? null;
  }

  const recent = recentRows(security, now).rows;
  const last = recent.at(-1);
  const year = recent.filter((row) => row.day > latest - 365);
  const today = localDayOf(tz, now);
  const periodDay = isTradingDay(profile, today) ? today : nextTradingDay(profile, today);
  const digits = priceDigits(security, last?.c ?? security.anchorPrice);
  const meta: Record<string, unknown> = {
    currency: security.currency,
    symbol: security.symbol,
    exchangeName: security.exchange,
    fullExchangeName: security.fullExchangeName,
    instrumentType: security.type,
    firstTradeDate: new Date(dailyStamp(profile, profile.epoch)),
    regularMarketTime: new Date(sessionClose(profile, latest)),
    hasPrePostMarketData: profile.pre !== null,
    gmtoffset: zoneOffsetMinutes(tz, now) * 60,
    timezone: zoneShortName(tz, now),
    exchangeTimezoneName: tz,
    regularMarketPrice: last?.c ?? security.anchorPrice,
    fiftyTwoWeekHigh: year.length ? Math.max(...year.map((row) => row.h)) : undefined,
    fiftyTwoWeekLow: year.length ? Math.min(...year.map((row) => row.l)) : undefined,
    regularMarketDayHigh: last?.h,
    regularMarketDayLow: last?.l,
    regularMarketVolume: last?.v,
    longName: security.name,
    shortName: security.shortName,
    chartPreviousClose: firstDay === null ? (last?.c ?? security.anchorPrice) : (closeBefore(security, firstDay) ?? rows[0]?.o),
    scale: 3,
    priceHint: digits,
    currentTradingPeriod: periodsOf(profile, periodDay, now),
    dataGranularity: interval,
    range: "",
    validRanges: VALID_RANGES,
  };
  if (intradayStep !== undefined) {
    meta.previousClose = previousClose ?? undefined;
    const days = tradingDaysBetween(profile, localDayOf(tz, p1), endDay);
    const periods = days.map((day) => periodsOf(profile, day, now));
    meta.tradingPeriods = includePrePost
      ? { pre: periods.map((p) => [p.pre]), regular: periods.map((p) => [p.regular]), post: periods.map((p) => [p.post]) }
      : periods.map((p) => [p.regular]);
  }
  for (const key of Object.keys(meta)) if (meta[key] === undefined) delete meta[key];

  const withAdjclose = intradayStep === undefined;
  const events = chartEvents(security, p1, p2, latest, options.events ?? "div|split|earn");
  if (options.return === "object") return objectForm(meta, rows, withAdjclose, events);
  const result: Record<string, unknown> = { meta, quotes: rows.map((row) => quoteRow(row, withAdjclose)) };
  if (events) result.events = events;
  return result;
}

/** The library's return: "object" shape (timestamps in seconds, indicator arrays, events keyed by timestamp). */
function objectForm(meta: Record<string, unknown>, rows: ReadonlyArray<DailyRow | IntradayRow>, withAdjclose: boolean, events: Record<string, unknown[]> | undefined): Record<string, unknown> {
  const keyed = (list: unknown[] | undefined) =>
    list ? Object.fromEntries(list.map((event) => [String(Math.floor(((event as { date: Date }).date.getTime()) / 1000)), event])) : undefined;
  const result: Record<string, unknown> = {
    meta,
    timestamp: rows.map((row) => Math.floor(row.t / 1000)),
    indicators: {
      quote: [{ open: rows.map((r) => r.o), high: rows.map((r) => r.h), low: rows.map((r) => r.l), close: rows.map((r) => r.c), volume: rows.map((r) => r.v) }],
      ...(withAdjclose ? { adjclose: [{ adjclose: rows.map((r) => r.c) }] } : {}),
    },
  };
  if (events) result.events = { dividends: keyed(events.dividends), splits: keyed(events.splits) };
  if (rows.length === 0) delete result.timestamp;
  return result;
}
