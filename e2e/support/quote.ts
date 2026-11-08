import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { CHART_SETTINGS_KEY, type ChartSettings } from "@/components/stock/chart-settings";
import { HOLDINGS_STORAGE_KEY, type Holdings } from "@/hooks/useHoldings";
import type { Bar, ChartData, ChartRange, MarketState, StockDetail } from "@/types/api";

import { expect } from "./test";

// Helpers of the quote workstation specs (e2e/specs/quote.spec.ts, chart.spec.ts and position-editor.spec.ts). The
// expected figures come from the API routes the quote page reads, requested again through the test's own client (the
// fixture data answers every request the same way), and are written the way the English UI writes them: grouping,
// fixed decimals, "+" for a gain and a true minus (U+2212) for a loss.

const MINUS = "−";
export const NEW_YORK = "America/New_York";

/** The text as a regular expression source that matches it literally. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A value the test needs, or a failure that names it (the API types allow null for what Yahoo can leave out). */
export function known<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`The API sent no ${what}.`);
  return value;
}

// ---------------------------------------------------------------------------------------------------------------------
// Numbers and dates as the UI writes them
// ---------------------------------------------------------------------------------------------------------------------

const numberFormats = new Map<number, Intl.NumberFormat>();

/** 1,234.56: grouping and a fixed number of decimals. */
export function fixed(value: number, digits = 2): string {
  let format = numberFormats.get(digits);
  if (!format) {
    format = new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    numberFormats.set(digits, format);
  }
  return format.format(value);
}

function withSign(text: string, sign: number): string {
  return sign > 0 ? `+${text}` : sign < 0 ? `${MINUS}${text}` : text;
}

/** A price of a US stock or fund: two decimals, four below 1. */
export function price(value: number): string {
  const abs = Math.abs(value);
  return fixed(value, abs > 0 && abs < 1 ? 4 : 2);
}

/** A price change or an amount of P&L with its sign: +1.20, −25.15 (four decimals below a cent). */
export function change(value: number): string {
  const abs = Math.abs(value);
  return withSign(fixed(abs, abs > 0 && abs < 0.01 ? 4 : 2), Math.sign(value));
}

/** A change in percent units with its sign: 0.388 -> "+0.39%". A change that rounds to zero has no sign. */
export function percent(value: number, digits = 2): string {
  const text = `${Math.abs(value).toFixed(digits)}%`;
  return withSign(text, Number(text.slice(0, -1)) === 0 ? 0 : Math.sign(value));
}

/** A decimal ratio as a signed percentage: 1.0697 -> "+107.0%". */
export function ratio(value: number, digits = 1): string {
  return percent(value * 100, digits);
}

/** A decimal share as a percentage without a sign: 0.0986 -> "9.86%". */
export function share(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Money as the position editor's preview and the positions table write P&L: "+1,604.50", "0.00" when it rounds to zero. */
export function money(value: number): string {
  return withSign(fixed(Math.abs(value)), Math.sign(Number(value.toFixed(2))));
}

/** A large amount in compact notation with a true minus: "970.28B", "−89.27B". */
export function compact(value: number): string {
  const text = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
  return text.startsWith("-") ? `${MINUS}${text.slice(1)}` : text;
}

/** A cash amount per share: two decimals from 0.10 up, up to four below. */
export function perShare(value: number): string {
  return Math.abs(value) >= 0.1 ? fixed(value) : new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}

function dateText(ms: number | string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", options).format(new Date(ms));
}

/** "Nov 6, 2026", read in the time zone (UTC for session dates). */
export function longDate(ms: number | string, timeZone = "UTC"): string {
  return dateText(ms, { year: "numeric", month: "short", day: "numeric", timeZone });
}

/** "Nov 6". */
export function shortDate(ms: number | string, timeZone = "UTC"): string {
  return dateText(ms, { month: "short", day: "numeric", timeZone });
}

/** "15:55", on a 24-hour clock. */
export function clockTime(ms: number | string, timeZone = "UTC"): string {
  return dateText(ms, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
}

/** "Mon Nov 16": the New York day of an event, as the quote header's event chips write it. */
export function eventDay(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: NEW_YORK }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("month")} ${part("day")}`;
}

/** The session of an earnings release from its New York time, as the header chip names it ("after close"). */
export function reportSession(iso: string): string | null {
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "short", timeZone: NEW_YORK }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  if (part("weekday") === "Sat" || part("weekday") === "Sun") return null;
  const minutes = Number(part("hour")) * 60 + Number(part("minute"));
  if (minutes === 0) return null;
  return minutes < 9 * 60 + 30 ? "before open" : minutes >= 16 * 60 ? "after close" : "during market hours";
}

/** The header's label for a market state. */
export const MARKET_STATE: Record<MarketState, string> = {
  PREPRE: "Pre-market",
  PRE: "Pre-market",
  REGULAR: "Market open",
  POST: "After hours",
  POSTPOST: "After hours",
  CLOSED: "Market closed",
};

/**
 * Text that has these parts in this order, at most `gap` characters other than digits apart: the separators, arrows and
 * spaces between the spans of one line ("310.45", "+1.20", "▲+0.39%"). No digit may touch either end, so "310.45" does
 * not match inside "1,310.45".
 */
export function inOrder(parts: readonly string[], gap = 3): RegExp {
  return new RegExp(`(?<![\\d.,])${parts.map(escapeRegExp).join(`\\D{0,${gap}}`)}(?!\\d)`);
}

/**
 * A number written with any number of decimals from `min` to `max`, as a pattern source: for figures whose decimals
 * depend on the instrument and are being reworked (a currency pair's pips), so the check is that the value agrees with
 * the API at whatever precision the page picks.
 */
export function anyPrecisionSource(value: number, min = 0, max = 6): string {
  const texts = new Set<string>();
  for (let digits = min; digits <= max; digits++) texts.add(fixed(Math.abs(value), digits));
  const sign = value < 0 ? `[${MINUS}-]` : "\\+?";
  return `${sign}(?:${[...texts].map(escapeRegExp).join("|")})`;
}

/** The whole text is the number, at any precision (see anyPrecisionSource). */
export function anyPrecision(value: number): RegExp {
  return new RegExp(`^${anyPrecisionSource(value)}$`);
}

/** The quote header's price line, the price and the change at any precision: "1.3062", "−0.0025", "▼−0.19%". */
export function priceLinePattern(last: number, dayChange: number, changePercent: number): RegExp {
  const parts = [anyPrecisionSource(last, 2), anyPrecisionSource(dayChange, 2), escapeRegExp(percent(changePercent))];
  return new RegExp(`(?<![\\d.,])${parts.join("\\D{0,3}")}(?!\\d)`);
}

// ---------------------------------------------------------------------------------------------------------------------
// The app's API routes
// ---------------------------------------------------------------------------------------------------------------------

/** GET an API route of the app, which must answer 200, as JSON. */
export async function api<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  expect(response.status(), `status of GET ${path}`).toBe(200);
  return (await response.json()) as T;
}

/** The path of a quote route: /api/stock/<symbol><part>. */
export function stockRoute(symbol: string, part = ""): string {
  return `/api/stock/${encodeURIComponent(symbol)}${part}`;
}

export function stockDetail(request: APIRequestContext, symbol: string): Promise<StockDetail> {
  return api<StockDetail>(request, stockRoute(symbol));
}

export function chartSeries(request: APIRequestContext, symbol: string, range: ChartRange): Promise<ChartData> {
  return api<ChartData>(request, stockRoute(symbol, `/chart?range=${range}`));
}

// ---------------------------------------------------------------------------------------------------------------------
// The chart
// ---------------------------------------------------------------------------------------------------------------------

/** The range buttons in order, with their labels. */
export const RANGE_LABELS: Readonly<Record<ChartRange, string>> = {
  "1d": "1D",
  "5d": "5D",
  "1mo": "1M",
  "3mo": "3M",
  "6mo": "6M",
  ytd: "YTD",
  "1y": "1Y",
  "2y": "2Y",
  "5y": "5Y",
  max: "MAX",
};

export const CHART_RANGES = Object.keys(RANGE_LABELS) as ChartRange[];

/** Months of the windowed views: from the same day this many months before the last bar. */
const WINDOW_MONTHS: Partial<Record<ChartRange, number>> = { "1mo": 1, "3mo": 3, "6mo": 6, "1y": 12 };

/**
 * The series a view loads. Every daily view from 1M to 2Y shares one two-year request (switching between them loads
 * nothing); 1D, 5D, 5Y and MAX load their own.
 */
export function seriesRange(range: ChartRange): ChartRange {
  return range === "1mo" || range === "3mo" || range === "6mo" || range === "ytd" || range === "1y" || range === "2y" ? "2y" : range;
}

/**
 * The bars a view shows: the regular session's unless extended hours are on, and for 1M, 3M, 6M and 1Y those from the
 * same day 1, 3, 6 or 12 months before the last bar (from January 1 for YTD), a window of the two-year series; 1D,
 * 5D, 2Y, 5Y and MAX show all bars of their series.
 */
export function shownBars(range: ChartRange, series: ChartData, extended = false): Bar[] {
  const bars = extended ? series.bars : series.bars.filter((bar) => (bar.session ?? "regular") === "regular");
  const last = bars.at(-1);
  if (!last) return [];
  const end = new Date(last.t);
  const months = WINDOW_MONTHS[range];
  const start =
    range === "ytd"
      ? Date.UTC(end.getUTCFullYear(), 0, 1)
      : months !== undefined
        ? Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, end.getUTCDate())
        : null;
  return start === null ? bars : bars.filter((bar) => bar.t >= start);
}

export interface SummaryFigures {
  low: number;
  high: number;
  last: number;
  /** The last bar's time: "Nov 6 15:55" in the exchange's zone for intraday bars, "Nov 6, 2026" for daily ones. */
  date: string;
}

/** The figures of the chart's text summary for a view: the low and high of the bars shown, the last close and its time. */
export function summaryFigures(range: ChartRange, series: ChartData, extended = false): SummaryFigures {
  const bars = shownBars(range, series, extended);
  const last = known(bars.at(-1), `bar for ${series.symbol} ${range}`);
  const zone = series.timezone ?? undefined;
  return {
    low: Math.min(...bars.map((bar) => bar.l)),
    high: Math.max(...bars.map((bar) => bar.h)),
    last: last.c,
    date: series.intraday ? `${shortDate(last.t, zone)} ${clockTime(last.t, zone)}` : longDate(last.t, "UTC"),
  };
}

/** The summary of a US stock's view, two decimals: "AAPL 1Y: low 244.18, high 392.34, last 310.45 on Nov 6, 2026". */
export function chartSummary(range: ChartRange, series: ChartData, extended = false): string {
  const f = summaryFigures(range, series, extended);
  return `${series.symbol} ${RANGE_LABELS[range]}: low ${price(f.low)}, high ${price(f.high)}, last ${price(f.last)} on ${f.date}`;
}

/** The same summary with the prices at any precision, for instruments whose decimals vary (see anyPrecisionSource). */
export function chartSummaryPattern(range: ChartRange, series: ChartData, extended = false): RegExp {
  const f = summaryFigures(range, series, extended);
  const n = (value: number) => anyPrecisionSource(value, 2, 6);
  return new RegExp(`^${escapeRegExp(series.symbol)} ${RANGE_LABELS[range]}: low ${n(f.low)}, high ${n(f.high)}, last ${n(f.last)} on ${escapeRegExp(f.date)}$`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------------------------------------------------

/** A panel by its title (the first match: a table inside a panel can become a labelled region of its own). */
export function panel(page: Page, title: string): Locator {
  return page.getByRole("region", { name: title, exact: true }).first();
}

/** The quote header: a region named by the symbol. */
export function quoteHeader(page: Page, symbol: string): Locator {
  return page.getByRole("region", { name: symbol, exact: true });
}

/** The section tabs under the quote header (links in a navigation landmark). */
export function quoteTabs(page: Page): Locator {
  return page.getByRole("navigation", { name: "Quote sections" });
}

/** The price chart panel. */
export function chartPanel(page: Page): Locator {
  return panel(page, "Price");
}

/** The chart's text summary of its bars (for screen readers, so attached rather than visible). */
export function chartSummaryText(page: Page, symbol: string): Locator {
  return chartPanel(page).getByText(new RegExp(`^${escapeRegExp(symbol)} \\S+: low `));
}

/** The data rows of a table: rows of cells, without DataTable's one full-width cell for loading or no rows. */
export function dataRows(table: Locator): Locator {
  const page = table.page();
  return table.getByRole("row").filter({ has: page.getByRole("cell") }).filter({ hasNot: page.locator("td[colspan]") });
}

/** The table inside a panel that has this column, whatever its caption says. */
export function tableWithColumn(scope: Locator, column: string): Locator {
  return scope.getByRole("table").filter({ has: scope.page().getByRole("columnheader", { name: column, exact: true }) });
}

/**
 * No error state on screen: ErrorState and the error boundary are alerts (Next.js keeps an empty alert region of its
 * own for route announcements, which is not one). Not for pages with an open form, whose field errors are alerts too.
 */
export async function expectNoErrorStates(page: Page): Promise<void> {
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({ visible: true })).toHaveCount(0);
}

// ---------------------------------------------------------------------------------------------------------------------
// What the app keeps in this browser
// ---------------------------------------------------------------------------------------------------------------------

/** The positions in localStorage (investseek:holdings:v1), as the store wrote them. */
export async function storedHoldings(page: Page): Promise<Holdings> {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "{}") as Holdings, HOLDINGS_STORAGE_KEY);
}

/** The chart settings in localStorage (investseek:chart:v1), or null before the first change. */
export async function storedChartSettings(page: Page): Promise<Partial<ChartSettings> | null> {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null") as Partial<ChartSettings> | null, CHART_SETTINGS_KEY);
}
