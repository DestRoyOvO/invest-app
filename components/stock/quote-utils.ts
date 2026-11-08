// Pure helpers behind the quote page (StockView, QuoteHeader), kept free of React so they can be tested: which tabs
// apply, the compare list from the URL, event chips, the header's ranges, the live tab title and the position line.
// Price decimals and Yahoo's placeholder figures are shared with the other views (lib/quote-figures.ts).

import { isNonEquity, knownNonEquity } from "@/components/calendar/earnings-model";
import { isDateOnly } from "@/lib/events";
import { priceDigits } from "@/lib/quote-figures";
import { normalizeSymbol } from "@/lib/symbols";
import type { Bar, Quote } from "@/types/api";

import { MAX_COMPARE } from "./chart-utils";

export type QuoteTab = "overview" | "financials" | "earnings" | "analysts" | "dividends" | "ownership";

export const QUOTE_TABS: readonly QuoteTab[] = ["overview", "financials", "earnings", "analysts", "dividends", "ownership"];

const FUND_TYPES = new Set(["ETF", "MUTUALFUND"]);

export type InstrumentKind = "equity" | "fund" | "other";

/**
 * The kind of instrument behind a quote type, for what the quote page shows: stocks (and a missing or unknown type)
 * get the company figures, ETFs and mutual funds the fund figures, and indices, currencies, futures and crypto only
 * the trading figures, since they have no statements, analysts, earnings or dividends.
 */
export function instrumentKind(quoteType: string | null | undefined): InstrumentKind {
  if (quoteType === null || quoteType === undefined || quoteType === "EQUITY") return "equity";
  return FUND_TYPES.has(quoteType) ? "fund" : "other";
}

/**
 * Tabs that apply to a quote type. Stocks get every tab; funds pay distributions but have no statements, earnings,
 * analysts or insiders; indices, currencies, futures and crypto have only the overview. An unknown type (no quote
 * yet) shows every tab so a deep link keeps its place while the quote loads.
 */
export function tabsFor(quoteType: string | null | undefined): QuoteTab[] {
  const kind = instrumentKind(quoteType);
  if (kind === "equity") return [...QUOTE_TABS];
  return kind === "fund" ? ["overview", "dividends"] : ["overview"];
}

const DAY_MS = 86_400_000;
/** 52 weeks: the 52-week range covers the sessions after the same weekday a year before the quote's session. */
const YEAR_MS = 364 * DAY_MS;
/** The bars must reach back to within a week of that start (weekends and holidays) to give a 52-week range. */
const YEAR_SLACK_MS = 7 * DAY_MS;

/** The open, day range and 52-week range of the quote header. */
export interface QuoteRanges {
  open: number | null;
  dayLow: number | null;
  dayHigh: number | null;
  low52: number | null;
  high52: number | null;
}

type RangeQuote = Pick<Quote, "quoteType" | "price" | "open" | "dayLow" | "dayHigh" | "fiftyTwoWeekLow" | "fiftyTwoWeekHigh" | "regularMarketTime">;

/**
 * True when the quote lacks a figure of its ranges that daily bars could give. Mutual funds have no intraday trading
 * (their bars are one NAV a day), so their missing open and day range stay missing.
 */
export function rangesNeedBars(quote: RangeQuote): boolean {
  if (quote.quoteType === "MUTUALFUND" || quote.price === null) return false;
  return [quote.open, quote.dayLow, quote.dayHigh, quote.fiftyTwoWeekLow, quote.fiftyTwoWeekHigh].some((value) => value === null);
}

/** UTC midnight of the date of `iso` on the exchange's clock: the `t` of that session's daily bar. */
function sessionDay(iso: string | null, timeZone: string | null): number | null {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms)) return null;
  try {
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone ?? "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
    return Date.parse(`${key}T00:00:00Z`);
  } catch {
    return null; // a time zone this browser does not know
  }
}

/**
 * The quote header's open, day range and 52-week range. Yahoo leaves some out for yields (^TNX quotes no open, day
 * range or 52-week low) while its daily bars (`bars`, `timeZone`: the 2Y chart the page loads) carry them, so a missing
 * figure is taken from the bars where they hold that very figure: the open and the day range from the latest bar when
 * it is the quote's own session and traded a range, the 52-week low and high from the bars of the 52 weeks up to that
 * session when the bars reach that far back. Yahoo's own 52-week figures are the extremes of the same daily bars
 * (^GSPC, EURUSD=X, BTC-USD and ^TNX's high match exactly on 2026-11-07), and the current price lies inside both ranges
 * by definition, so the derived ends include it. Figures the quote has always win.
 */
export function quoteRanges(quote: RangeQuote, bars: readonly Bar[] | null, timeZone: string | null): QuoteRanges {
  const ranges: QuoteRanges = { open: quote.open, dayLow: quote.dayLow, dayHigh: quote.dayHigh, low52: quote.fiftyTwoWeekLow, high52: quote.fiftyTwoWeekHigh };
  const day = rangesNeedBars(quote) && bars && bars.length > 0 ? sessionDay(quote.regularMarketTime, timeZone) : null;
  if (day === null || !bars) return ranges;
  const price = quote.price !== null && quote.price > 0 ? quote.price : null;
  const low = (value: number) => (price === null ? value : Math.min(value, price));
  const high = (value: number) => (price === null ? value : Math.max(value, price));

  const latest = bars[bars.length - 1];
  if (latest.t === day && latest.h > latest.l) {
    ranges.open ??= latest.o;
    ranges.dayLow ??= low(latest.l);
    ranges.dayHigh ??= high(latest.h);
  }
  const from = day - YEAR_MS;
  if (bars[0].t <= from + YEAR_SLACK_MS) {
    const year = bars.filter((bar) => bar.t > from && bar.t <= day);
    if (year.length > 0) {
      ranges.low52 ??= low(Math.min(...year.map((bar) => bar.l)));
      ranges.high52 ??= high(Math.max(...year.map((bar) => bar.h)));
    }
  }
  return ranges;
}

/**
 * Whether the overview shows the earnings and analyst panels. Funds, indices, currencies and crypto report no earnings
 * and have no analyst coverage (their tabs drop Earnings and Analysts too). The app's own funds and index symbols are
 * known before the quote arrives, so their page never shows the panels; any other symbol keeps them (loading, in
 * parallel with the quote) until its quote type says otherwise, so a stock's page does not jump when the quote lands.
 */
export function showsCoverage(symbol: string, quoteType: string | null | undefined): boolean {
  return !knownNonEquity(symbol) && !isNonEquity(quoteType);
}

/** The tab named in ?tab=, or the overview when it is missing, unknown or does not apply. */
export function resolveTab(param: string | null | undefined, available: readonly QuoteTab[]): QuoteTab {
  return param && (available as readonly string[]).includes(param) ? (param as QuoteTab) : "overview";
}

/** Symbols from ?compare=SPY,XLK: normalized, unique, without the quote's own symbol, at most three. */
export function parseCompare(param: string | null | undefined, symbol: string): string[] {
  const out: string[] = [];
  for (const part of (param ?? "").split(",")) {
    const candidate = normalizeSymbol(part);
    if (candidate && candidate !== symbol && !out.includes(candidate)) out.push(candidate);
    if (out.length >= MAX_COMPARE) break;
  }
  return out;
}

/** Query string for a quote page URL with the tab and compare list (both omitted when empty or default). */
export function quoteQuery(tab: QuoteTab, compare: readonly string[]): string {
  const params = new URLSearchParams();
  if (tab !== "overview") params.set("tab", tab);
  if (compare.length > 0) params.set("compare", compare.join(","));
  const query = params.toString().replace(/%2C/g, ",");
  return query ? `?${query}` : "";
}

const NY_TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", weekday: "short", hour: "numeric", minute: "numeric" });

/**
 * Session of an earnings release from its New York time: before the open, after the close or during the session.
 * Yahoo's estimated dates carry the company's usual release time (Apple 16:00, JPMorgan 08:30: the time of its last
 * report), so an estimate gets a session too, which the chip marks "est.". Midnight, in New York or in UTC (a date
 * without a time), is Yahoo's placeholder for an unknown time and gets none; so do listings outside the US, where New
 * York hours mean nothing, and weekend dates, when there is no session (Berkshire reports on Saturdays). The earnings
 * panel reads it the same way, and so does the calendar (reportSession in lib/server/calendar.ts).
 */
export function earningsTiming(iso: string, usListing = true): "pre" | "post" | "intraday" | null {
  if (!usListing) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || isDateOnly(iso)) return null;
  const parts = NY_TIME.formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  if (weekday === "Sat" || weekday === "Sun") return null;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const minutes = hour * 60 + minute;
  if (minutes === 0) return null;
  if (minutes < 9 * 60 + 30) return "pre";
  if (minutes >= 16 * 60) return "post";
  return "intraday";
}

/** True for symbols listed in the US (no exchange suffix such as .HK, .L or .TO). */
export function isUsListing(symbol: string): boolean {
  return !symbol.includes(".");
}

/** Whole calendar days from today to the date (negative in the past), both read as UTC dates. */
export function daysUntil(iso: string, now: number): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const day = (ms: number) => Math.floor(ms / 86_400_000);
  return day(t) - day(now);
}

/** An ex-dividend date worth flagging: announced and between today and 14 days ahead. */
export function upcomingExDividend(iso: string | null | undefined, now = Date.now(), withinDays = 14): boolean {
  if (!iso) return false;
  const days = daysUntil(iso, now);
  return days !== null && days >= 0 && days <= withinDays;
}

/** The date when it is still ahead of `now`, else null (Yahoo can leave a past report in its "next" field). */
export function futureDate(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t > now ? iso : null;
}

/**
 * The live tab title, "NVDA 186.64 ▲2.78% · InvestSeek": arrows instead of colors, so the direction survives in a
 * plain-text tab strip. Prices below 1 keep four decimals, and currency pairs their own (see priceDigits).
 */
export function liveTitle(symbol: string, price: number | null, changePercent: number | null): string {
  if (price === null || !Number.isFinite(price)) return `${symbol} · InvestSeek`;
  const digits = priceDigits(symbol, null) ?? (Math.abs(price) < 1 ? 4 : 2);
  const priceText = price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (changePercent === null || !Number.isFinite(changePercent)) return `${symbol} ${priceText} · InvestSeek`;
  const arrow = changePercent > 0 ? "▲" : changePercent < 0 ? "▼" : "";
  return `${symbol} ${priceText} ${arrow}${Math.abs(changePercent).toFixed(2)}% · InvestSeek`;
}

export interface PositionFigures {
  shares: number;
  cost: number;
  value: number;
  /** Today's P&L: shares x the day's price change; null without a change. */
  dayPnl: number | null;
  /** Unrealized P&L against the average cost, and as a decimal of the cost basis. */
  pnl: number;
  pnlPct: number | null;
}

/** The figures of the position line in the quote header, or null without a usable price. */
export function positionFigures(position: { shares: number; cost: number }, price: number | null, change: number | null): PositionFigures | null {
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  const value = position.shares * price;
  const basis = position.shares * position.cost;
  return {
    shares: position.shares,
    cost: position.cost,
    value,
    dayPnl: change !== null && Number.isFinite(change) ? position.shares * change : null,
    pnl: value - basis,
    pnlPct: basis > 0 ? (value - basis) / basis : null,
  };
}
