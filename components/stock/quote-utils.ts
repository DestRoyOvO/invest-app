// Pure helpers behind the quote page (StockView, QuoteHeader), kept free of React so they can be tested: which tabs
// apply, the compare list from the URL, event chips, price decimals and Yahoo's placeholder figures, the live tab
// title and the position line.

import { isNonEquity, knownNonEquity } from "@/components/calendar/earnings-model";
import { isDateOnly } from "@/lib/events";
import { formatNumber, formatPrice } from "@/lib/format";
import { normalizeSymbol } from "@/lib/symbols";
import { getWorldSymbol } from "@/lib/universe";
import type { Lang } from "@/types/api";

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

/**
 * Decimals for an instrument's prices, or null for formatPrice's own rule (2, or 4 below 1). The world board's
 * instruments keep its digits (EUR/USD 4, USD/JPY 3, copper 4), so a pair reads the same on its quote page as on
 * /markets; other currency pairs (quote type CURRENCY, or Yahoo's "=X" symbols before the quote arrives) get 4.
 */
export function priceDigits(symbol: string, quoteType: string | null | undefined): number | null {
  const listed = getWorldSymbol(symbol);
  if (listed) return listed.digits;
  return quoteType === "CURRENCY" || symbol.endsWith("=X") ? 4 : null;
}

/** A price with the instrument's decimals (see priceDigits), or formatPrice's rule without them. */
export function formatQuotePrice(value: number | null | undefined, digits: number | null, lang: Lang): string {
  return digits === null ? formatPrice(value, lang) : formatNumber(value, digits, lang);
}

/**
 * A price of the session or the year (open, day low and high, 52-week low and high), or null for Yahoo's placeholder
 * zero: yields such as ^TNX and ^IRX come with an open, a day range and a 52-week low of 0.
 */
export function reportedPrice(value: number | null): number | null {
  return value === 0 ? null : value;
}

/** The session's volume, or null where Yahoo's 0 means none is reported: indices and currencies (^VIX, EURUSD=X). */
export function reportedVolume(volume: number | null, kind: InstrumentKind): number | null {
  return kind === "other" && volume !== null && volume <= 0 ? null : volume;
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
