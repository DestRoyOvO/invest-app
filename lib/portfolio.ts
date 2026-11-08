// Portfolio valuation shared by the watchlist panel and the AI context.
//
// Amounts are never converted between currencies. Positions quoted in the base currency (the most common currency
// among priced positions, USD on a tie) make up the totals and weights. Positions in another currency are valued on
// their own, and positions without a usable price are listed separately, so no position disappears silently.

import { displayedSign } from "./format";

export interface PositionLike {
  symbol: string;
  shares: number;
  /** Average cost per share, in the quote currency. */
  cost: number;
}

export interface QuoteLike {
  price: number | null;
  change: number | null;
  currency: string | null;
}

export interface ValuedPosition extends PositionLike {
  price: number;
  /** Quote currency as Yahoo reports it (for example "USD", "JPY" or "GBp" for pence). */
  currency: string;
  value: number;
  costBasis: number;
  pnl: number;
  pnlPct: number | null;
  dayPnl: number | null;
  /** Share of the base-currency total; null for a position in another currency. */
  weight: number | null;
}

export interface PortfolioTotals {
  value: number;
  costBasis: number;
  dayPnl: number;
  pnl: number;
  pnlPct: number | null;
}

export interface Portfolio {
  baseCurrency: string;
  /** Base-currency positions, largest value first. The totals and weights cover these only. */
  rows: ValuedPosition[];
  /** Priced positions in another currency, largest cost basis first. Not converted, so not in the totals. */
  foreign: ValuedPosition[];
  /** Positions without a usable price (no quote, or a missing or non-positive price), in input order. */
  unpriced: PositionLike[];
  totals: PortfolioTotals;
}

export const DEFAULT_CURRENCY = "USD";

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** The most common currency; ties prefer USD, then alphabetical order. */
export function pickBaseCurrency(currencies: readonly string[]): string {
  if (currencies.length === 0) return DEFAULT_CURRENCY;
  const counts = new Map<string, number>();
  for (const currency of currencies) counts.set(currency, (counts.get(currency) ?? 0) + 1);
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || Number(b[0] === DEFAULT_CURRENCY) - Number(a[0] === DEFAULT_CURRENCY) || a[0].localeCompare(b[0]),
  );
  return ranked[0][0];
}

export function valuePortfolio(positions: readonly PositionLike[], quoteOf: (symbol: string) => QuoteLike | undefined): Portfolio {
  const priced: ValuedPosition[] = [];
  const unpriced: PositionLike[] = [];
  for (const { symbol, shares, cost } of positions) {
    const quote = quoteOf(symbol);
    const price = quote?.price;
    if (!quote || !isFiniteNumber(price) || price <= 0) {
      unpriced.push({ symbol, shares, cost });
      continue;
    }
    const value = shares * price;
    const costBasis = shares * cost;
    priced.push({
      symbol,
      shares,
      cost,
      price,
      currency: quote.currency || DEFAULT_CURRENCY,
      value,
      costBasis,
      pnl: value - costBasis,
      pnlPct: costBasis > 0 ? (value - costBasis) / costBasis : null,
      dayPnl: isFiniteNumber(quote.change) ? shares * quote.change : null,
      weight: null,
    });
  }

  const baseCurrency = pickBaseCurrency(priced.map((position) => position.currency));
  const rows = priced.filter((position) => position.currency === baseCurrency).sort((a, b) => b.value - a.value);
  const foreign = priced.filter((position) => position.currency !== baseCurrency).sort((a, b) => b.costBasis - a.costBasis);
  const value = rows.reduce((sum, row) => sum + row.value, 0);
  const costBasis = rows.reduce((sum, row) => sum + row.costBasis, 0);
  for (const row of rows) row.weight = value > 0 ? row.value / value : null;

  return {
    baseCurrency,
    rows,
    foreign,
    unpriced,
    totals: {
      value,
      costBasis,
      dayPnl: rows.reduce((sum, row) => sum + (row.dayPnl ?? 0), 0),
      pnl: value - costBasis,
      pnlPct: costBasis > 0 ? (value - costBasis) / costBasis : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Day summary: the figures the watchlist summary, My day and the portfolio page share
// ---------------------------------------------------------------------------

/**
 * Today's change of the base-currency positions as a decimal of their value at the previous close:
 * dayPnl / (value - dayPnl), over the positions whose change is known. Value-weighted, unlike an average of changes.
 */
export function dayChangeRatio(rows: readonly ValuedPosition[]): number | null {
  let pnl = 0;
  let previous = 0;
  for (const row of rows) {
    if (row.dayPnl === null) continue;
    pnl += row.dayPnl;
    previous += row.value - row.dayPnl;
  }
  return previous > 0 ? pnl / previous : null;
}

export interface ExtendedQuoteLike {
  extendedSession: "PRE" | "POST" | null;
  /** Change of the extended-hours price from the regular close it follows. */
  extendedChange: number | null;
}

export interface ExtendedHoursPnl {
  /** PRE or POST when every quoted position is in the same session; MIXED otherwise. */
  session: "PRE" | "POST" | "MIXED";
  /** Sum of shares x extended change. Never part of the day P&L. */
  pnl: number;
  /** pnl over the value of the positions it covers, at the regular price. */
  ratio: number | null;
  /** Positions with an extended-hours quote. */
  positions: number;
}

/**
 * Pre-market or after-hours P&L of the base-currency positions: shares x the change since the regular close, for the
 * positions that have an extended-hours quote. Null when none has one. Kept apart from the day P&L on purpose.
 */
export function extendedHoursPnl(rows: readonly ValuedPosition[], quoteOf: (symbol: string) => ExtendedQuoteLike | undefined): ExtendedHoursPnl | null {
  let pnl = 0;
  let value = 0;
  let positions = 0;
  const sessions = new Set<"PRE" | "POST">();
  for (const row of rows) {
    const quote = quoteOf(row.symbol);
    if (!quote?.extendedSession || !isFiniteNumber(quote.extendedChange)) continue;
    sessions.add(quote.extendedSession);
    pnl += row.shares * quote.extendedChange;
    value += row.value;
    positions++;
  }
  if (positions === 0) return null;
  const session = sessions.size === 1 ? [...sessions][0] : "MIXED";
  return { session, pnl, ratio: value > 0 ? pnl / value : null, positions };
}

/**
 * The largest gains and losses of the day in money: contributors (largest gain first) and detractors (largest loss
 * first). A day P&L that rounds to zero at `digits` decimals, as My day prints it, is neither: it would show as a flat
 * 0.00 under a direction heading.
 */
export function dayMovers(rows: readonly ValuedPosition[], count = 3, digits = 2): { contributors: ValuedPosition[]; detractors: ValuedPosition[] } {
  const known = rows.filter((row) => displayedSign(row.dayPnl, digits) !== 0);
  return {
    contributors: known
      .filter((row) => (row.dayPnl as number) > 0)
      .sort((a, b) => (b.dayPnl as number) - (a.dayPnl as number))
      .slice(0, count),
    detractors: known
      .filter((row) => (row.dayPnl as number) < 0)
      .sort((a, b) => (a.dayPnl as number) - (b.dayPnl as number))
      .slice(0, count),
  };
}

/** Share of the base-currency value held in the `count` largest positions; null without priced positions. */
export function topWeight(rows: readonly ValuedPosition[], count = 3): number | null {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (!(total > 0)) return null;
  const top = [...rows].sort((a, b) => b.value - a.value).slice(0, count);
  return top.reduce((sum, row) => sum + row.value, 0) / total;
}

// ---------------------------------------------------------------------------
// Scheduled events
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>();

/** UTC-midnight timestamp of the calendar date of `ms` in a time zone (New York by default). */
export function calendarDate(ms: number, timeZone = "America/New_York"): number {
  let formatter = dateKeyFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dateKeyFormatters.set(timeZone, formatter);
  }
  const [y, m, d] = formatter.format(new Date(ms)).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Calendar days from `now` until the ISO time, counted on New York dates (0 = today, 1 = tomorrow, negative = past).
 * Null for a missing or unparseable date.
 */
export function calendarDaysUntil(iso: string | null | undefined, now: number, timeZone = "America/New_York"): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.round((calendarDate(at, timeZone) - calendarDate(now, timeZone)) / DAY_MS);
}

export interface SessionQuoteLike {
  /** Time of the last regular-session trade (ISO). */
  regularMarketTime: string | null;
}

/**
 * The New York date (UTC midnight) of the latest regular session among the positions' quotes when that session was
 * before today, so a day figure shown while the market is closed (a weekend, or before the open) can say it covers the
 * last session rather than today. Null when a quote traded today, when no time is known, or without a clock (now <= 0).
 */
export function lastSessionDate(rows: ReadonlyArray<{ symbol: string }>, quoteOf: (symbol: string) => SessionQuoteLike | undefined, now: number): number | null {
  if (now <= 0) return null;
  let latest: number | null = null;
  for (const row of rows) {
    const at = Date.parse(quoteOf(row.symbol)?.regularMarketTime ?? "");
    if (!Number.isNaN(at) && (latest === null || at > latest)) latest = at;
  }
  if (latest === null) return null;
  const session = calendarDate(latest);
  return session < calendarDate(now) ? session : null;
}

export interface EarningsQuoteLike {
  nextEarningsDate: string | null;
  earningsDateEstimated: boolean | null;
}

export interface UpcomingEarnings {
  symbol: string;
  date: string;
  estimated: boolean;
  days: number;
}

/** The earliest report from today on among the symbols, within `maxDays` (default: any); ties keep input order. */
export function nextEarnings(
  symbols: readonly string[],
  quoteOf: (symbol: string) => EarningsQuoteLike | undefined,
  now: number,
  maxDays = Number.POSITIVE_INFINITY,
): UpcomingEarnings | null {
  let best: UpcomingEarnings | null = null;
  for (const symbol of symbols) {
    const quote = quoteOf(symbol);
    const days = calendarDaysUntil(quote?.nextEarningsDate, now);
    if (!quote?.nextEarningsDate || days === null || days < 0 || days > maxDays) continue;
    if (!best || Date.parse(quote.nextEarningsDate) < Date.parse(best.date)) {
      best = { symbol, date: quote.nextEarningsDate, estimated: quote.earningsDateEstimated === true, days };
    }
  }
  return best;
}
