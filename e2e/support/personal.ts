import { readFileSync } from "node:fs";

import type { APIRequestContext, Download, Locator, Page } from "@playwright/test";

import type { CalendarResponse, HistoryResponse, Quote, QuotesResponse } from "@/types/api";
import type { ProfilesResponse } from "@/types/portfolio";

import { expect } from "./test";

// Helpers for the specs of the investor's own data: the watchlist (watchlist.spec.ts), the positions and the portfolio
// page (portfolio.spec.ts) and the data page (data.spec.ts). Expectations are computed here from the same API answers
// the pages read (quotes, price history, calendar, profiles) and formatted the way the app formats figures, so a spec
// compares what the page shows with what the data implies instead of with numbers copied from a screenshot.

// ---------------------------------------------------------------------------
// The app's own API, as the pages call it
// ---------------------------------------------------------------------------

async function getJson<T>(request: APIRequestContext, url: string): Promise<T> {
  const response = await request.get(url);
  expect(response.status(), `GET ${url}`).toBe(200);
  return (await response.json()) as T;
}

/** Quotes by symbol from /api/quotes, the request the watchlist, positions and portfolio pages make. */
export async function fetchQuotes(request: APIRequestContext, symbols: readonly string[]): Promise<Map<string, Quote>> {
  const query = [...new Set(symbols)].sort().map(encodeURIComponent).join(",");
  const body = await getJson<QuotesResponse>(request, `/api/quotes?symbols=${query}`);
  return new Map(body.quotes.map((quote) => [quote.symbol, quote]));
}

/** Aligned daily closes from /api/history, as the portfolio page asks for them (symbols sorted, SPY among them). */
export async function fetchHistory(request: APIRequestContext, symbols: readonly string[], range = "1y"): Promise<HistoryResponse> {
  const query = [...new Set(symbols)].sort().map(encodeURIComponent).join(",");
  return getJson<HistoryResponse>(request, `/api/history?symbols=${query}&range=${range}`);
}

/** Earnings and dividend dates from /api/calendar, as the watchlist's Upcoming panel asks for them. */
export async function fetchCalendar(request: APIRequestContext, symbols: readonly string[], days: number): Promise<CalendarResponse> {
  const query = [...new Set(symbols)].sort().join(",");
  return getJson<CalendarResponse>(request, `/api/calendar?days=${days}&symbols=${encodeURIComponent(query)}`);
}

/** Company profiles (Yahoo's sector) from /api/profiles, which the exposure breakdown reads for stocks outside the universe. */
export async function fetchProfiles(request: APIRequestContext, symbols: readonly string[]): Promise<ProfilesResponse> {
  return getJson<ProfilesResponse>(request, `/api/profiles?symbols=${symbols.map(encodeURIComponent).join(",")}`);
}

// ---------------------------------------------------------------------------
// Figures as the app writes them
// ---------------------------------------------------------------------------

/** U+2212, the minus sign the app puts before negative changes and P&L. */
export const MINUS = "−";

const numberFormats = new Map<number, Intl.NumberFormat>();

/** A plain amount with grouping and fixed decimals: 10,065.99 (lib/format.ts formatNumber). */
export function amount(value: number, digits = 2): string {
  let format = numberFormats.get(digits);
  if (!format) {
    format = new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    numberFormats.set(digits, format);
  }
  return format.format(value);
}

/** A P&L amount: + or a true minus by the rounded value, nothing for zero: +1,604.50, −72.58, 0.00 (SignedMoney). */
export function signedAmount(value: number, digits = 2): string {
  const rounded = Number(value.toFixed(digits));
  const text = amount(Math.abs(value), digits);
  return rounded > 0 ? `+${text}` : rounded < 0 ? `${MINUS}${text}` : text;
}

/** A decimal ratio in percent: 30.8%, or +114.2% / −0.72% when signed (formatRatio, as Delta and the tiles show it). */
export function percent(ratio: number, digits = 1, signed = false): string {
  const value = ratio * 100;
  const fixed = Math.abs(value).toFixed(digits);
  const sign = signed ? (value > 0 ? "+" : value < 0 ? MINUS : "") : value < 0 ? MINUS : "";
  return `${sign}${fixed}%`;
}

/** A price: two decimals, four below 1 (formatPrice). */
export function price(value: number): string {
  const abs = Math.abs(value);
  return amount(value, abs > 0 && abs < 1 ? 4 : 2);
}

/** The New York date of an instant, as the tables show dates: "Nov 10". */
export function shortDate(iso: string | number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(iso));
}

/** A shown figure as a number: "−1,234.50" is -1234.5 and "+30.8%" is 30.8. */
export function parseFigure(text: string): number {
  return Number(text.trim().replace(/−/g, "-").replace(/[,%+\s]/g, ""));
}

/** A figure with a sign and grouping: "+1,234.56", "−0.72%", "30.2%", "1.32". */
export const FIGURE = /^[+−]?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?$/;

/**
 * "ok" when `text` shows `expected` to its displayed precision (`digits` decimals, in percent units for a percentage)
 * and in the app's number format, else what is wrong: for figures computed from price history, where the last binary
 * digit of a sum may differ from the app's while the rounded figure is the same.
 */
export function figureCheck(text: string, expected: number, digits: number): string {
  const shown = text.trim();
  if (!FIGURE.test(shown) || (shown.split(".")[1] ?? "").replace("%", "").length !== digits) return `"${shown}" is not a figure with ${digits} decimals`;
  return Math.abs(parseFigure(shown) - expected) <= 0.5 * 10 ** -digits + 1e-9 ? "ok" : `"${shown}" is not ${expected} to ${digits} decimals`;
}

/** Passes once the element (or the text `source` reads) shows `expected` to its displayed precision (figureCheck). */
export async function expectFigure(source: Locator | (() => Promise<string>), expected: number, digits: number): Promise<void> {
  const read = typeof source === "function" ? source : async () => source.innerText();
  await expect.poll(async () => figureCheck(await read(), expected, digits)).toBe("ok");
}

/**
 * Shown percentages ("30.8%", "+1.2%") that add up to 100% within their rounding: half a unit of the last decimal
 * each. Give it what the page shows, not figures the test computed, so the sum is a check of the page.
 */
export function expectSumOf100(shown: readonly string[]): void {
  const sum = shown.reduce((total, text) => total + parseFigure(text), 0);
  const decimals = Math.max(0, ...shown.map((text) => (text.split(".")[1] ?? "").replace("%", "").length));
  expect(shown.every((text) => FIGURE.test(text.trim()) && text.trim().endsWith("%")), `percentages: ${shown.join(" + ")}`).toBe(true);
  expect(Math.abs(sum - 100), `${shown.join(" + ")} = ${sum}`).toBeLessThanOrEqual(0.5 * 10 ** -decimals * shown.length + 1e-9);
}

/** The percentage that ends a line of text ("Information Technology 7,898 78.5%" gives "78.5%"). */
export function trailingPercent(text: string): string {
  return /([+−]?\d[\d,]*(?:\.\d+)?%)\s*$/.exec(text)?.[1] ?? `(no percentage in "${text}")`;
}

// ---------------------------------------------------------------------------
// Positions valued at the quotes
// ---------------------------------------------------------------------------

export type Holdings = Readonly<Record<string, { shares: number; cost: number }>>;

export interface ValuedRow {
  symbol: string;
  shares: number;
  cost: number;
  price: number;
  currency: string;
  value: number;
  costBasis: number;
  pnl: number;
  pnlRatio: number;
  dayPnl: number;
  /** shares x the change of the extended-hours trade, or null without one. */
  extendedPnl: number | null;
  /** Share of the base-currency value; null for a position in another currency. */
  weight: number | null;
}

export interface ValuedHoldings {
  base: string;
  /** Base-currency positions, largest value first: the ones the totals and weights cover. */
  rows: ValuedRow[];
  /** Positions quoted in another currency, never converted into the totals. */
  foreign: ValuedRow[];
  totals: { value: number; costBasis: number; pnl: number; pnlRatio: number; dayPnl: number; dayRatio: number; extendedPnl: number };
}

/**
 * What the seeded shares and costs are worth at the quotes: value = shares x price, day P&L = shares x change, P&L =
 * value - shares x cost, weight = value / total. The totals cover the positions in the most common currency (USD on a
 * tie), summed largest first as the app sums them; positions in other currencies stay out of them.
 */
export function valueHoldings(holdings: Holdings, quotes: ReadonlyMap<string, Quote>): ValuedHoldings {
  const priced: ValuedRow[] = Object.entries(holdings).map(([symbol, { shares, cost }]) => {
    const quote = quotes.get(symbol);
    if (!quote || typeof quote.price !== "number" || typeof quote.change !== "number") throw new Error(`No quote for ${symbol}`);
    const value = shares * quote.price;
    const costBasis = shares * cost;
    return {
      symbol,
      shares,
      cost,
      price: quote.price,
      currency: quote.currency ?? "USD",
      value,
      costBasis,
      pnl: value - costBasis,
      pnlRatio: (value - costBasis) / costBasis,
      dayPnl: shares * quote.change,
      extendedPnl: quote.extendedSession && typeof quote.extendedChange === "number" ? shares * quote.extendedChange : null,
      weight: null,
    };
  });
  const counts = new Map<string, number>();
  for (const row of priced) counts.set(row.currency, (counts.get(row.currency) ?? 0) + 1);
  const base = [...counts].sort((a, b) => b[1] - a[1] || Number(b[0] === "USD") - Number(a[0] === "USD") || a[0].localeCompare(b[0]))[0]?.[0] ?? "USD";
  const rows = priced.filter((row) => row.currency === base).sort((a, b) => b.value - a.value);
  const foreign = priced.filter((row) => row.currency !== base).sort((a, b) => b.costBasis - a.costBasis);
  const value = rows.reduce((sum, row) => sum + row.value, 0);
  const costBasis = rows.reduce((sum, row) => sum + row.costBasis, 0);
  const dayPnl = rows.reduce((sum, row) => sum + row.dayPnl, 0);
  for (const row of rows) row.weight = row.value / value;
  return {
    base,
    rows,
    foreign,
    totals: {
      value,
      costBasis,
      pnl: value - costBasis,
      pnlRatio: (value - costBasis) / costBasis,
      dayPnl,
      dayRatio: dayPnl / (value - dayPnl),
      extendedPnl: rows.reduce((sum, row) => sum + (row.extendedPnl ?? 0), 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Risk of today's holdings over their price history
// ---------------------------------------------------------------------------

const TRADING_DAYS = 252;

type Series = ReadonlyArray<number | null>;

function isPrice(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sample covariance (n - 1). */
function covariance(x: readonly number[], y: readonly number[]): number {
  const mx = mean(x);
  const my = mean(y);
  return x.reduce((sum, xi, i) => sum + (xi - mx) * (y[i] - my), 0) / (x.length - 1);
}

function returnsOf(values: Series): Array<number | null> {
  return values.map((value, i) => {
    const previous = i > 0 ? values[i - 1] : null;
    return isPrice(previous) && isPrice(value) ? value / previous - 1 : null;
  });
}

function paired(a: Series, b: Series): [number[], number[]] {
  const x: number[] = [];
  const y: number[] = [];
  a.forEach((ai, i) => {
    const bi = b[i];
    if (typeof ai === "number" && typeof bi === "number") {
      x.push(ai);
      y.push(bi);
    }
  });
  return [x, y];
}

function betaOf(asset: Series, benchmark: Series): number {
  const [x, y] = paired(asset, benchmark);
  return covariance(x, y) / covariance(y, y);
}

function volatilityOf(returns: Series): number {
  const values = returns.filter((r): r is number => r !== null);
  return Math.sqrt(covariance(values, values)) * Math.sqrt(TRADING_DAYS);
}

export interface RiskFigures {
  /** Session dates of the analysis (SPY's sessions, the last year of them). */
  dates: number[];
  /** What today's shares were worth on each of those sessions. */
  values: Array<number | null>;
  benchmark: Array<number | null>;
  sessions: number;
  beta: number;
  volatility: number;
  /** 1-day 95% historical VaR as a (negative) decimal, and the loss in money at today's value. */
  varRatio: number;
  varAmount: number;
  maxDrawdown: { depth: number; troughDate: number };
  positions: Record<string, { weight: number; riskShare: number; beta: number; volatility: number }>;
  correlation: Record<string, Record<string, number>>;
}

/**
 * The risk figures the portfolio page derives from /api/history, by their textbook definitions (the page's "How these
 * are computed" panel): daily returns of today's share counts valued at the closes of SPY's last 253 sessions, the
 * sample volatility annualized over 252 sessions, beta as cov/var against SPY, the 5th percentile of the daily returns
 * (linear between order statistics) times today's value, the deepest fall from a running peak, each position's Euler
 * share of the variance and the Pearson correlation of each pair.
 */
export function riskFigures(history: HistoryResponse, positions: readonly ValuedRow[], benchmark = "SPY"): RiskFigures {
  const bench = history.closes[benchmark] ?? [];
  const keep = history.dates.map((_, i) => isPrice(bench[i]));
  const carried = (series: Series) => {
    let last: number | null = null;
    const out: Array<number | null> = [];
    history.dates.forEach((_, i) => {
      if (isPrice(series[i])) last = series[i];
      if (keep[i]) out.push(last);
    });
    return out.slice(-(TRADING_DAYS + 1));
  };
  const dates = history.dates.filter((_, i) => keep[i]).slice(-(TRADING_DAYS + 1));
  const closes = Object.fromEntries(positions.map((p) => [p.symbol, carried(history.closes[p.symbol] ?? [])]));
  const benchCloses = carried(bench);
  const values = dates.map((_, i) => {
    let total = 0;
    for (const p of positions) {
      const close = closes[p.symbol][i];
      if (!isPrice(close)) return null;
      total += close * p.shares;
    }
    return total;
  });
  const returns = returnsOf(values);
  const present = returns.filter((r): r is number => r !== null);
  const benchReturns = returnsOf(benchCloses);

  const sorted = [...present].sort((a, b) => a - b);
  const position = 0.05 * (sorted.length - 1);
  const lo = Math.floor(position);
  const varRatio = sorted[lo] + (sorted[Math.ceil(position)] - sorted[lo]) * (position - lo);
  const today = positions.reduce((sum, p) => sum + p.value, 0);

  let peak = -Infinity;
  let drawdown = { depth: 0, troughDate: dates[0] };
  values.forEach((value, i) => {
    if (!isPrice(value)) return;
    peak = Math.max(peak, value);
    if (value / peak - 1 < drawdown.depth) drawdown = { depth: value / peak - 1, troughDate: dates[i] };
  });

  const symbolReturns = positions.map((p) => returnsOf(closes[p.symbol]).map((r, i) => (returns[i] === null ? null : r)));
  const weights = positions.map((p) => p.value / today);
  const cov = symbolReturns.map((a) => symbolReturns.map((b) => covariance(...paired(a, b))));
  const marginal = cov.map((row) => row.reduce((sum, c, j) => sum + c * weights[j], 0));
  const variance = weights.reduce((sum, w, i) => sum + w * marginal[i], 0);
  const correlation: Record<string, Record<string, number>> = {};
  positions.forEach((p, i) => {
    correlation[p.symbol] = {};
    positions.forEach((q, j) => {
      const [x, y] = paired(symbolReturns[i], symbolReturns[j]);
      correlation[p.symbol][q.symbol] = i === j ? 1 : covariance(x, y) / Math.sqrt(covariance(x, x) * covariance(y, y));
    });
  });

  return {
    dates,
    values,
    benchmark: benchCloses,
    sessions: present.length,
    beta: betaOf(returns, benchReturns),
    volatility: volatilityOf(returns),
    varRatio,
    varAmount: Math.max(0, -varRatio) * today,
    maxDrawdown: drawdown,
    positions: Object.fromEntries(
      positions.map((p, i) => [p.symbol, { weight: weights[i], riskShare: (weights[i] * marginal[i]) / variance, beta: betaOf(symbolReturns[i], benchReturns), volatility: volatilityOf(symbolReturns[i]) }]),
    ),
    correlation,
  };
}

/**
 * The performance chart's returns over its range: today's holdings and the benchmark from the first session of the
 * last `sessions` on which both have a value to the latest session. The benchmark's closes are looked up by date, so
 * QQQ's own history (a separate request) lines up with the analysis sessions.
 */
export function rangeReturns(risk: RiskFigures, sessions: number, benchmark: { dates: number[]; closes: Series } | null = null): { holdings: number; benchmark: number } {
  const byDate = benchmark ? new Map(benchmark.dates.map((date, i) => [date, benchmark.closes[i]])) : null;
  const bench = byDate ? risk.dates.map((date) => byDate.get(date) ?? null) : risk.benchmark;
  const n = risk.dates.length;
  let start = Math.max(0, n - 1 - sessions);
  while (start < n && !(isPrice(risk.values[start]) && isPrice(bench[start]))) start++;
  return { holdings: (risk.values[n - 1] as number) / (risk.values[start] as number) - 1, benchmark: (bench[n - 1] as number) / (bench[start] as number) - 1 };
}

// ---------------------------------------------------------------------------
// The page: stored data, tables, tiles, files
// ---------------------------------------------------------------------------

/** A localStorage value of the app, parsed; null when the key is absent. */
export async function readStored<T = unknown>(page: Page, key: string): Promise<T | null> {
  return page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  }, key) as Promise<T | null>;
}

/** Every localStorage key the app owns (the "investseek:" prefix), sorted. */
export async function storedKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("investseek:")).sort());
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The data row of a table whose accessible name starts with the symbol ("AAPL 10 3,104.50 …"). */
export function rowOf(table: Locator, symbol: string): Locator {
  return table.getByRole("row", { name: new RegExp(`^${escapeRegExp(symbol)}(?:\\s|$)`) });
}

/** The data rows of a table (rows of cells), in the order shown. */
export function dataRows(table: Locator): Locator {
  return table.getByRole("row").filter({ has: table.page().getByRole("cell") });
}

/** Text as it reads on screen: runs of white space as one space, trimmed. */
function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A row's cells by their column heads, read together in one round trip, with what went wrong if the row cannot be read
 * (no row, or more than one). Only the columns shown at this width count: a hidden column drops out of the heads and
 * the cells alike, so the positions line up on phones too. Heads are read as written (their CSS upper case aside),
 * cells as rendered (innerText, white space squashed).
 */
export async function rowCells(table: Locator, row: Locator): Promise<{ cells: Record<string, string>; problem: string | null }> {
  const [count, heads, cells] = await Promise.all([row.count(), table.getByRole("columnheader").allTextContents(), row.getByRole("cell").allInnerTexts()]);
  const names = heads.map((head) => head.trim());
  const problem = count === 1 ? null : `${count} rows match ${row}`;
  return { cells: Object.fromEntries(names.map((name, index) => [name, squash(cells[index] ?? "")])), problem };
}

/**
 * The cell of a row under a column head, among the columns shown at this width: hidden columns drop out of the heads
 * and the cells alike, so the positions line up on phones too. Throws when the column is not shown.
 */
export async function cellOf(table: Locator, row: Locator, column: string): Promise<Locator> {
  await expect(row).toBeVisible();
  const heads = (await table.getByRole("columnheader").allTextContents()).map((text) => text.trim());
  const index = heads.indexOf(column);
  if (index < 0) throw new Error(`No column "${column}" is shown; the heads are ${heads.join(" | ")}`);
  return row.getByRole("cell").nth(index);
}

/**
 * What a cell should show: its whole text, a pattern, or a check that returns "ok" or what is wrong (`figure` compares a
 * computed number at the precision shown).
 */
export type CellExpectation = string | RegExp | ((text: string) => string);

/** A cell check: the cell shows `expected` to its displayed precision (figureCheck). */
export function figure(expected: number, digits: number): (text: string) => string {
  return (text) => figureCheck(text, expected, digits);
}

/**
 * Passes once the row shows what is expected under each column head. One retrying assertion per row (rather than one
 * per cell), which reads the heads and the cells together on each try; a column that is not shown fails with the heads
 * that are. Resolves to the cells as they were read when it passed.
 */
export async function expectCells(table: Locator, row: Locator, expected: Readonly<Record<string, CellExpectation>>): Promise<Record<string, string>> {
  const columns = Object.keys(expected);
  let read: Record<string, string> = {};
  await expect
    .poll(async () => {
      const { cells, problem } = await rowCells(table, row);
      read = cells;
      if (problem) return { problem };
      return Object.fromEntries(
        columns.map((column) => {
          const text = cells[column];
          const want = expected[column];
          if (text === undefined) return [column, `(no column "${column}"; the heads are ${Object.keys(cells).join(" | ")})`];
          return [column, typeof want === "function" ? want(text) : text];
        }),
      );
    })
    .toEqual(
      Object.fromEntries(
        columns.map((column) => {
          const want = expected[column];
          return [column, typeof want === "function" ? "ok" : typeof want === "string" ? want : expect.stringMatching(want)];
        }),
      ),
    );
  return read;
}

/**
 * A KPI tile by its label: the label's own element and the figure, delta and sub-line beside it. StatTile has no role
 * or name to find it by, so this relies on its markup: the label is a direct child of the tile's root element (a
 * wrapper around the label would break every tile read). A labelled group on StatTile would remove the coupling.
 */
export function tile(page: Page, label: string): Locator {
  // The tiles come first in the page, before any panel that may use the same words.
  return page.locator("main").getByText(label, { exact: true }).first().locator("xpath=..");
}

/** What a KPI tile shows under its label, one line per part: the figure, then its delta and sub-line if any. */
export async function tileLines(page: Page, label: string): Promise<string[]> {
  const text = await tile(page, label).innerText();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(1);
}

/**
 * The toast that says `message` (its Undo and Close buttons are inside it). Toasts have no role of their own (they sit
 * in a polite live region without one), so they are found by the data-toast attribute components/ui/Toast.tsx sets.
 */
export function toast(page: Page, message: string | RegExp): Locator {
  return page.locator("[data-toast]").filter({ hasText: message });
}

/** Clicks `trigger`, waits for the download it starts and saves it in the test's output folder. */
export async function downloadFrom(page: Page, trigger: Locator, outputPath: (name: string) => string): Promise<{ download: Download; path: string; text: string }> {
  const [download] = await Promise.all([page.waitForEvent("download"), trigger.click()]);
  const path = outputPath(download.suggestedFilename());
  await download.saveAs(path);
  return { download, path, text: readFileSync(path, "utf8") };
}

/** Clicks the button that opens the file picker and picks `file`. */
export async function chooseFile(page: Page, button: Locator, file: string): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), button.click()]);
  await chooser.setFiles(file);
}

/** The byte order mark (U+FEFF) the app puts before CSV files so that Excel reads them as UTF-8. */
export const BOM = "\uFEFF";

/** Rows of a CSV text (quoted fields, doubled quotes, CRLF), without the byte order mark the app writes for Excel. */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quoted) {
      if (char === '"' && body[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && body[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
