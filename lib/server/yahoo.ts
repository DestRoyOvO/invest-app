import "server-only";

import YahooFinance from "yahoo-finance2";

import type {
  Bar,
  ChartData,
  ChartInterval,
  ChartRange,
  KeyStats,
  MarketState,
  Quote,
  StockProfile,
  SymbolSearchResult,
  UpstreamHealth,
} from "@/types/api";

import {
  foldTrailingSession,
  latestSessions,
  normalizeBars,
  normalizeDividends,
  normalizeIntradayBars,
  normalizeSplits,
  rollingWindow,
  tradesAroundTheClock,
  type DailyBar,
  type RawChart,
} from "@/lib/bars";
import { hasCjk } from "@/lib/names-zh";

import { cached, HOUR, isFresh, MINUTE, peek } from "./cache";
import { log } from "./log";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** Every Yahoo request (headers and body) must finish within this time. */
const REQUEST_TIMEOUT_MS = 8_000;

const timeoutFetch: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

type YahooClient = InstanceType<typeof YahooFinance>;

const globalForYahoo = globalThis as unknown as { __investseekYahoo?: YahooClient };

/** One shared client per process: the cookie jar, crumb and request queue are reused across requests. */
export const yf: YahooClient =
  globalForYahoo.__investseekYahoo ??
  (globalForYahoo.__investseekYahoo = new YahooFinance({
    suppressNotices: ["yahooSurvey", "ripHistorical"],
    versionCheck: false,
    fetch: timeoutFetch,
    queue: { concurrency: 4 },
    validation: { logErrors: false, logOptionsErrors: false },
  }));

/**
 * Upper bound on Yahoo calls queued in or running through the client (concurrency 4). Beyond it new calls fail fast
 * instead of waiting behind thousands of jobs, so one burst of uncached symbols cannot stall every route; cached
 * values, including stale ones, are still served.
 */
const MAX_PENDING_CALLS = 200;

/** Call outcomes kept by upstream() for the readiness check. On globalThis so every route bundle shares one copy. */
interface UpstreamState {
  pending: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  consecutiveFailures: number;
  /** Start of the current failure streak; null while the latest call succeeded. */
  failingSince: number | null;
}

const globalUpstream = globalThis as unknown as { __investseekUpstream?: UpstreamState };
const upstreamState: UpstreamState = (globalUpstream.__investseekUpstream ??= {
  pending: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
  consecutiveFailures: 0,
  failingSince: null,
});

export type UpstreamStats = Omit<UpstreamHealth, "ready">;

export class UpstreamBusyError extends Error {
  constructor() {
    super("Too many Yahoo requests are pending");
    this.name = "UpstreamBusyError";
  }
}

/** Queue wait plus run time allowed per call: a job dequeued after this fails at once instead of fetching. */
const CALL_DEADLINE_MS = 20_000;

/**
 * Module options for every Yahoo call; the signal reaches timeoutFetch through the library's fetchOptions.
 * Server modules that add new Yahoo calls (earnings, fundamentals, options, screeners) must pass these options and
 * wrap the call in upstream(), so every request shares the timeout, the deadline and the pending-call cap.
 */
export function callOptions() {
  return { validateResult: false as const, fetchOptions: { signal: AbortSignal.timeout(CALL_DEADLINE_MS) } };
}

/**
 * True for errors that carry Yahoo's own answer about the request (unknown symbol, no fundamentals, a query it cannot
 * parse). Those show the service is up, so they do not count as failures. HTTP errors, timeouts and network errors do.
 */
export function isYahooAnswer(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "HTTPError") return false;
  return error.name === "BadRequestError" || /No data found|Quote not found|No fundamentals/i.test(error.message);
}

function recordOutcome(ok: boolean, now = Date.now()): void {
  if (ok) {
    upstreamState.lastSuccessAt = now;
    upstreamState.consecutiveFailures = 0;
    upstreamState.failingSince = null;
  } else {
    upstreamState.lastFailureAt = now;
    upstreamState.consecutiveFailures++;
    upstreamState.failingSince ??= now;
  }
}

/**
 * Runs one Yahoo call under the pending-call cap and records its outcome for /api/health?ready=1. A rejection by the
 * cap itself (UpstreamBusyError) is load on this server, not a Yahoo failure, so it is not recorded.
 */
export async function upstream<T>(call: () => Promise<T>): Promise<T> {
  if (upstreamState.pending >= MAX_PENDING_CALLS) throw new UpstreamBusyError();
  upstreamState.pending++;
  try {
    const result = await call();
    recordOutcome(true);
    return result;
  } catch (error) {
    recordOutcome(isYahooAnswer(error));
    throw error;
  } finally {
    upstreamState.pending--;
  }
}

function isoOrNull(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

/** A snapshot of the Yahoo call statistics for /api/health?ready=1. */
export function getUpstreamStats(): UpstreamStats {
  return {
    pending: upstreamState.pending,
    lastSuccessAt: isoOrNull(upstreamState.lastSuccessAt),
    lastFailureAt: isoOrNull(upstreamState.lastFailureAt),
    consecutiveFailures: upstreamState.consecutiveFailures,
    failingSince: isoOrNull(upstreamState.failingSince),
  };
}

/** Test helper. */
export function resetUpstreamStats(): void {
  Object.assign(upstreamState, { pending: 0, lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0, failingSince: null });
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

/** Finite number or null (Yahoo sometimes sends {}, strings or NaN when validation is off). */
export function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value && typeof value === "object" && "raw" in value) return num((value as { raw: unknown }).raw);
  return null;
}

export function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function toIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    // Yahoo uses seconds in some payloads and milliseconds in others.
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

const MARKET_STATES = new Set<MarketState>(["PREPRE", "PRE", "REGULAR", "POST", "POSTPOST", "CLOSED"]);

export function marketState(value: unknown): MarketState | null {
  return typeof value === "string" && MARKET_STATES.has(value as MarketState) ? (value as MarketState) : null;
}

/** True while the regular, pre- or post-market session is trading (quotes change often). */
export function isSessionActive(state: MarketState | null): boolean {
  return state === "REGULAR" || state === "PRE" || state === "POST";
}

/** UTC-midnight timestamp of today's date in the exchange time zone (default New York). */
export function todayInExchange(timeZone = "America/New_York"): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, m, d] = parts.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

// Loose shape of a raw Yahoo quote; every field is validated through num()/str().
type RawQuote = Record<string, unknown>;

export function mapQuote(q: RawQuote): Quote {
  const symbol = String(q.symbol);
  const state = marketState(q.marketState);
  const regularTime = toIso(q.regularMarketTime);

  let extendedSession: Quote["extendedSession"] = null;
  let extendedPrice: number | null = null;
  let extendedChange: number | null = null;
  let extendedChangePercent: number | null = null;

  const prePrice = num(q.preMarketPrice);
  const postPrice = num(q.postMarketPrice);
  if ((state === "PRE" || state === "PREPRE") && prePrice !== null) {
    extendedSession = "PRE";
    extendedPrice = prePrice;
    extendedChange = num(q.preMarketChange);
    extendedChangePercent = num(q.preMarketChangePercent);
  } else if (postPrice !== null && state !== "REGULAR") {
    const postTime = toIso(q.postMarketTime);
    if (!regularTime || !postTime || postTime > regularTime) {
      extendedSession = "POST";
      extendedPrice = postPrice;
      extendedChange = num(q.postMarketChange);
      extendedChangePercent = num(q.postMarketChangePercent);
    }
  }

  const earnings = earningsDates(q, Date.now());
  const dividend = announcedDividend(q.corporateActions);
  const expenseRatioPercent = num(q.netExpenseRatio); // percent units
  const quoteDividendYield = num(q.dividendYield); // percent units in the quote endpoint
  const dividendYield =
    quoteDividendYield !== null ? quoteDividendYield / 100 : num(q.trailingAnnualDividendYield);

  return {
    symbol,
    name: str(q.shortName) ?? str(q.longName) ?? str(q.displayName) ?? symbol,
    quoteType: str(q.quoteType),
    currency: str(q.currency),
    exchange: str(q.fullExchangeName) ?? str(q.exchange),
    marketState: state,
    price: num(q.regularMarketPrice),
    change: num(q.regularMarketChange),
    changePercent: num(q.regularMarketChangePercent),
    previousClose: num(q.regularMarketPreviousClose),
    open: num(q.regularMarketOpen),
    dayHigh: num(q.regularMarketDayHigh),
    dayLow: num(q.regularMarketDayLow),
    volume: num(q.regularMarketVolume),
    avgVolume: num(q.averageDailyVolume3Month),
    marketCap: num(q.marketCap),
    fiftyTwoWeekHigh: num(q.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: num(q.fiftyTwoWeekLow),
    trailingPE: num(q.trailingPE),
    forwardPE: num(q.forwardPE),
    epsTrailingTwelveMonths: num(q.epsTrailingTwelveMonths),
    dividendYield,
    extendedPrice,
    extendedChange,
    extendedChangePercent,
    extendedSession,
    regularMarketTime: regularTime,
    fiftyDayAverage: num(q.fiftyDayAverage),
    twoHundredDayAverage: num(q.twoHundredDayAverage),
    fiftyTwoWeekChangePercent: num(q.fiftyTwoWeekChangePercent),
    priceToBook: num(q.priceToBook),
    forwardEps: num(q.epsForward),
    dividendRate: num(q.dividendRate),
    analystRating: analystRating(q.averageAnalystRating),
    sharesOutstanding: num(q.sharesOutstanding),
    nextEarningsDate: earnings.next,
    earningsDateEstimated: earnings.next === null ? null : q.isEarningsDateEstimate === true,
    lastEarningsDate: earnings.last,
    dividendDate: toIso(q.dividendDate),
    exDividendDate: dividend?.exDate ?? null,
    dividendAmount: dividend?.amount ?? null,
    expenseRatio: expenseRatioPercent === null ? null : expenseRatioPercent / 100,
    netAssets: num(q.netAssets),
    ytdReturnPercent: num(q.ytdReturn),
    fetchedAt: null,
    stale: false,
  };
}

/**
 * The announced cash dividend from the quote's corporate actions, e.g. { header: "Dividend", message: "AAPL announced
 * a cash dividend of $0.27 with an ex-date of Nov. 12, 2026", meta: { eventType: "DIVIDEND", dateEpochMs, amount:
 * "0.27" } }. When several are listed, the latest ex-date wins. Yahoo sometimes sends the array as a JSON string.
 */
export function announcedDividend(value: unknown): { exDate: string; amount: number | null } | null {
  let actions: unknown = value;
  if (typeof actions === "string") {
    try {
      actions = JSON.parse(actions);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(actions)) return null;
  let best: { exDate: string; amount: number | null } | null = null;
  for (const action of actions) {
    const meta = (action as { meta?: Record<string, unknown> } | null)?.meta;
    if (!meta || meta.eventType !== "DIVIDEND") continue;
    const exDate = toIso(meta.dateEpochMs);
    if (!exDate) continue;
    const parsed = typeof meta.amount === "string" ? Number.parseFloat(meta.amount) : num(meta.amount);
    const amount = parsed !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    if (!best || exDate > best.exDate) best = { exDate, amount };
  }
  return best;
}

/** "2.3 - Buy" -> 2.3 (1 = strong buy ... 5 = sell); null when missing or out of range. */
export function analystRating(value: unknown): number | null {
  const rating = typeof value === "string" ? Number.parseFloat(value) : num(value);
  return rating !== null && Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : null;
}

/**
 * Next and last earnings report from the quote's timestamps. Yahoo puts the latest report in earningsTimestamp and
 * the next one (often an estimate) in earningsTimestampStart/End, but either can hold past or future dates.
 */
export function earningsDates(q: RawQuote, now: number): { next: string | null; last: string | null } {
  const times = [q.earningsTimestamp, q.earningsTimestampStart, q.earningsTimestampEnd]
    .map(toIso)
    .filter((iso): iso is string => iso !== null)
    .map((iso) => Date.parse(iso));
  const future = times.filter((t) => t > now);
  const past = times.filter((t) => t <= now);
  return {
    next: future.length ? new Date(Math.min(...future)).toISOString() : null,
    last: past.length ? new Date(Math.max(...past)).toISOString() : null,
  };
}

interface QuoteSlot {
  quote: Quote | null; // null = Yahoo returned nothing for this symbol (negative cache)
  expiresAt: number;
  staleUntil: number;
}

const globalQuotes = globalThis as unknown as { __investseekQuotes?: Map<string, QuoteSlot> };
const quoteSlots: Map<string, QuoteSlot> = (globalQuotes.__investseekQuotes ??= new Map());

/** Public routes accept any well-formed symbol, so the slot map is bounded like the shared cache. */
const MAX_QUOTE_SLOTS = 5000;

function storeQuoteSlot(symbol: string, slot: QuoteSlot): void {
  // Re-insert so refreshed symbols move to the newest end of the eviction order.
  quoteSlots.delete(symbol);
  quoteSlots.set(symbol, slot);
  if (quoteSlots.size <= MAX_QUOTE_SLOTS) return;
  const now = Date.now();
  for (const [key, entry] of quoteSlots) {
    if (entry.staleUntil < now) quoteSlots.delete(key);
  }
  while (quoteSlots.size > MAX_QUOTE_SLOTS) {
    const oldest = quoteSlots.keys().next().value;
    if (oldest === undefined) break;
    quoteSlots.delete(oldest);
  }
}

function quoteTtl(quote: Quote | null): number {
  // Short negative cache: long enough to absorb polling of a mistyped ticker, short enough that a transient
  // partial Yahoo response cannot hide a real symbol for long.
  if (!quote) return 3 * MINUTE;
  return isSessionActive(quote.marketState) ? 15_000 : 5 * MINUTE;
}

const QUOTE_BATCH = 100;

async function fetchQuoteBatch(symbols: string[]): Promise<Quote[]> {
  const raw = (await upstream(() => yf.quote(symbols, { return: "array" }, callOptions()))) as unknown as RawQuote[];
  const fetchedAt = new Date().toISOString();
  return (raw ?? []).filter((q) => q && typeof q.symbol === "string").map((q) => ({ ...mapQuote(q), fetchedAt }));
}

/**
 * Quotes for many symbols. Each symbol is cached individually (15 s while its session trades, 5 min otherwise),
 * misses are fetched in one batched request, and symbols Yahoo does not know are omitted from the result.
 * If Yahoo fails, recently expired quotes (up to 1 hour old) are served instead, marked stale: true so routes and
 * screens can say the prices are delayed rather than present them as live.
 */
export async function getQuotes(symbols: string[]): Promise<Map<string, Quote>> {
  const now = Date.now();
  const result = new Map<string, Quote>();
  const misses: string[] = [];

  for (const symbol of symbols) {
    const slot = quoteSlots.get(symbol);
    if (slot && slot.expiresAt > now) {
      if (slot.quote) result.set(symbol, slot.quote);
      quoteSlots.delete(symbol);
      quoteSlots.set(symbol, slot);
    } else {
      misses.push(symbol);
    }
  }
  if (misses.length === 0) return result;

  const sorted = [...new Set(misses)].sort();
  try {
    for (let i = 0; i < sorted.length; i += QUOTE_BATCH) {
      const batch = sorted.slice(i, i + QUOTE_BATCH);
      const fetched = await cached(`quote-batch:${batch.join(",")}`, { ttlMs: 2_000 }, () => fetchQuoteBatch(batch));
      const loadedAt = Date.now();
      const bySymbol = new Map(fetched.map((q) => [q.symbol, q]));
      for (const symbol of batch) {
        const quote = bySymbol.get(symbol) ?? null;
        const ttl = quoteTtl(quote);
        storeQuoteSlot(symbol, { quote, expiresAt: loadedAt + ttl, staleUntil: loadedAt + ttl + HOUR });
        if (quote) result.set(symbol, quote);
      }
    }
  } catch (error) {
    let servedStale = 0;
    let oldest: string | null = null;
    for (const symbol of sorted) {
      const slot = quoteSlots.get(symbol);
      if (slot?.quote && slot.staleUntil > Date.now() && !result.has(symbol)) {
        result.set(symbol, slot.quote.stale ? slot.quote : { ...slot.quote, stale: true });
        servedStale++;
        if (slot.quote.fetchedAt && (oldest === null || slot.quote.fetchedAt < oldest)) oldest = slot.quote.fetchedAt;
      }
    }
    if (servedStale === 0 && result.size === 0) throw error;
    if (servedStale > 0) log("warn", "yahoo.stale_served", { count: servedStale, oldestFetchedAt: oldest, error });
  }
  return result;
}

export async function getQuote(symbol: string): Promise<Quote | null> {
  const quotes = await getQuotes([symbol]);
  return quotes.get(symbol) ?? null;
}

/** True when getQuotes would answer for the symbol without calling Yahoo (a fresh quote or a fresh "unknown"). */
export function hasFreshQuote(symbol: string): boolean {
  const slot = quoteSlots.get(symbol);
  return slot !== undefined && slot.expiresAt > Date.now();
}

/**
 * The last answer stored for the symbol, fresh or not, without loading: its quote, null when Yahoo did not know the
 * symbol (the negative cache), undefined when nothing is stored.
 */
export function peekQuote(symbol: string): Quote | null | undefined {
  return quoteSlots.get(symbol)?.quote;
}

// ---------------------------------------------------------------------------
// Daily bars and charts
// ---------------------------------------------------------------------------

export type { DailyBar } from "@/lib/bars";

async function fetchChart(symbol: string, days: number, interval: "1d" | "1wk"): Promise<DailyBar[]> {
  const period1 = new Date(Date.now() - days * 24 * HOUR);
  try {
    const chart = (await upstream(() => yf.chart(symbol, { period1, interval }, callOptions()))) as unknown as RawChart;
    return normalizeBars(chart);
  } catch (error) {
    // Unknown or delisted symbols: an empty (cacheable) result instead of an error, so repeated requests for
    // them do not keep hitting Yahoo. Network and server errors still throw.
    if (/No data found|symbol may be delisted/i.test(String(error))) return [];
    throw error;
  }
}

function barsTtl(): number {
  // Daily bars only change during the session; refresh moderately even when closed to pick up corrections.
  return 10 * MINUTE;
}

/**
 * Daily bars for the last `days` calendar days (the signal engine uses 540).
 * During market hours the last bar is the still-forming session.
 */
export async function getDailyBars(symbol: string, days: number): Promise<DailyBar[]> {
  return cached(`bars:${symbol}:${days}`, { ttlMs: barsTtl(), staleMs: 6 * HOUR }, () => fetchChart(symbol, days, "1d"));
}

/** True when getDailyBars(symbol, days) can be answered from the cache without calling Yahoo. */
export function hasCachedDailyBars(symbol: string, days: number): boolean {
  // Fresh only: an expired entry is reloaded (its stale value is a fallback for a failed reload), which costs a call.
  return isFresh(`bars:${symbol}:${days}`);
}

interface RangeSpec {
  interval: ChartInterval;
  /** Calendar days requested from Yahoo; "ytd" starts on January 1 and "max" at the first trade. */
  from: number | "ytd" | "max";
  /** Intraday ranges keep this many of the latest sessions. */
  sessions?: number;
}

/**
 * Yahoo's limits: 1m bars only within the last 30 days (8 days per request), 5m and 15m within 60 days, 60m within
 * 730 days; beyond them it answers HTTP 422. The intraday windows below cover their sessions across long weekends.
 */
const RANGE_SPEC: Record<ChartRange, RangeSpec> = {
  "1d": { interval: "5m", from: 7, sessions: 1 },
  "5d": { interval: "15m", from: 12, sessions: 5 },
  "1mo": { interval: "1d", from: 35 },
  "3mo": { interval: "1d", from: 95 },
  "6mo": { interval: "1d", from: 186 },
  ytd: { interval: "1d", from: "ytd" },
  "1y": { interval: "1d", from: 372 },
  "2y": { interval: "1d", from: 737 },
  "5y": { interval: "1wk", from: 1835 },
  max: { interval: "1mo", from: "max" },
};

export const CHART_RANGES = Object.keys(RANGE_SPEC) as ChartRange[];

export function isChartRange(value: string | null): value is ChartRange {
  return value !== null && Object.hasOwn(RANGE_SPEC, value);
}

function isIntraday(interval: ChartInterval): boolean {
  return interval === "5m" || interval === "15m";
}

function chartKey(symbol: string, range: ChartRange): string {
  return `chart:v2:${symbol}:${range}`;
}

/**
 * Intraday bars refresh every minute while the symbol's session trades (or before its quote is known) and every
 * 10 minutes otherwise; daily and longer bars every 10 minutes, as the daily-bar cache does.
 */
function chartTtl(symbol: string, interval: ChartInterval): number {
  if (!isIntraday(interval)) return barsTtl();
  const quote = peekQuote(symbol);
  return quote && !isSessionActive(quote.marketState) ? 10 * MINUTE : MINUTE;
}

function chartStart(spec: RangeSpec, now: number): Date {
  if (spec.from === "max") return new Date("1970-01-02T00:00:00Z");
  if (spec.from === "ytd") return new Date(Date.UTC(new Date(now).getUTCFullYear(), 0, 1));
  return new Date(now - spec.from * 24 * HOUR);
}

const EMPTY_CHART = { meta: undefined, quotes: [] } satisfies RawChart;

/** One chart() call with dividend and split events. Unknown or delisted symbols give an empty (cacheable) chart. */
async function fetchChartData(symbol: string, range: ChartRange, now = Date.now()): Promise<ChartData> {
  const spec = RANGE_SPEC[range];
  const intraday = isIntraday(spec.interval);
  let raw: RawChart;
  try {
    raw = (await upstream(() =>
      yf.chart(symbol, { period1: chartStart(spec, now), interval: spec.interval, includePrePost: intraday, events: "div|split" }, callOptions()),
    )) as unknown as RawChart;
  } catch (error) {
    if (!/No data found|symbol may be delisted/i.test(String(error))) throw error;
    raw = EMPTY_CHART;
  }
  const meta = raw?.meta;
  const gmtOffset = num(meta?.gmtoffset) ?? 0;
  const timezone = str(meta?.exchangeTimezoneName);

  let bars: Bar[];
  let previousClose: number | null = null;
  const continuous = tradesAroundTheClock(meta);
  if (intraday) {
    // Round-the-clock markets (crypto, futures, currencies) get rolling 24-hour windows instead of session dates.
    const all = normalizeIntradayBars(raw);
    const latest = continuous ? rollingWindow(all, spec.sessions ?? 1) : latestSessions(all, spec.sessions ?? 1, gmtOffset);
    bars = latest.bars;
    previousClose = latest.previousClose ?? num(meta?.previousClose);
  } else {
    let daily = normalizeBars(raw);
    if (spec.interval === "1wk" || spec.interval === "1mo") daily = foldTrailingSession(daily, spec.interval);
    if (spec.from === "ytd") {
      const yearStart = Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
      daily = daily.filter((bar) => bar.t >= yearStart);
    }
    bars = daily.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
  }

  // Events inside the bars' span; a weekly or monthly bar covers its whole period.
  const first = bars[0]?.t ?? Infinity;
  const inRange = (t: number) => t >= first;
  return {
    symbol,
    range,
    interval: spec.interval,
    intraday,
    continuous,
    bars,
    timezone,
    previousClose,
    dividends: normalizeDividends(raw, intraday).filter((d) => inRange(d.t)),
    splits: normalizeSplits(raw, intraday).filter((s) => inRange(s.t)),
  };
}

/** True when getChart(symbol, range) can be answered from the cache without calling Yahoo. */
export function hasCachedChart(symbol: string, range: ChartRange): boolean {
  return isFresh(chartKey(symbol, range));
}

/** Bars, dividends and splits for one range (see RANGE_SPEC), cached per symbol and range. */
export async function getChart(symbol: string, range: ChartRange): Promise<ChartData> {
  const spec = RANGE_SPEC[range];
  return cached(chartKey(symbol, range), { ttlMs: chartTtl(symbol, spec.interval), staleMs: 6 * HOUR }, () => fetchChartData(symbol, range));
}

/** True when a sparkline can be answered from the cache without calling Yahoo. */
export function hasCachedSparkline(symbol: string): boolean {
  return isFresh(`spark:${symbol}`);
}

/** About one month of daily closes for sparklines (cached 30 minutes). */
export async function getSparkline(symbol: string): Promise<number[]> {
  const bars = await cached(`spark:${symbol}`, { ttlMs: 30 * MINUTE, staleMs: 12 * HOUR }, () => fetchChart(symbol, 35, "1d"));
  // 6 significant digits keeps sub-dollar assets (e.g. DOGE-USD) from flattening while trimming float noise.
  return bars.map((b) => Number(b.c.toPrecision(6)));
}

// ---------------------------------------------------------------------------
// Fundamentals and profile
// ---------------------------------------------------------------------------

const SUMMARY_MODULES = ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "calendarEvents", "assetProfile"] as const;

type RawSummary = Record<string, Record<string, unknown> | undefined>;

function pickEarningsDate(calendar: Record<string, unknown> | undefined): string | null {
  const earnings = calendar?.earnings as Record<string, unknown> | undefined;
  const dates = Array.isArray(earnings?.earningsDate) ? (earnings.earningsDate as unknown[]) : [];
  const isoDates = dates.map(toIso).filter((d): d is string => d !== null).sort();
  if (isoDates.length === 0) return null;
  const now = new Date().toISOString();
  return isoDates.find((d) => d >= now) ?? isoDates[isoDates.length - 1];
}

export function mapSummary(symbol: string, s: RawSummary): { profile: StockProfile; stats: KeyStats } {
  const price = s.price ?? {};
  const detail = s.summaryDetail ?? {};
  const keyStats = s.defaultKeyStatistics ?? {};
  const fin = s.financialData ?? {};
  const asset = s.assetProfile ?? {};
  const debtToEquityPercent = num(fin.debtToEquity);

  const profile: StockProfile = {
    symbol,
    name: str(price.shortName) ?? str(price.longName) ?? symbol,
    longName: str(price.longName),
    sector: str(asset.sector),
    industry: str(asset.industry),
    exchange: str(price.exchangeName),
    currency: str(price.currency),
    country: str(asset.country),
    website: str(asset.website),
    employees: num(asset.fullTimeEmployees),
    summary: str(asset.longBusinessSummary),
  };

  const stats: KeyStats = {
    marketCap: num(price.marketCap) ?? num(detail.marketCap),
    trailingPE: num(detail.trailingPE),
    forwardPE: num(detail.forwardPE) ?? num(keyStats.forwardPE),
    pegRatio: num(keyStats.pegRatio),
    priceToBook: num(keyStats.priceToBook),
    eps: num(keyStats.trailingEps),
    forwardEps: num(keyStats.forwardEps),
    dividendYield: num(detail.dividendYield) ?? num(detail.trailingAnnualDividendYield),
    beta: num(detail.beta) ?? num(keyStats.beta),
    fiftyTwoWeekHigh: num(detail.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: num(detail.fiftyTwoWeekLow),
    avgVolume: num(detail.averageVolume),
    sharesOutstanding: num(keyStats.sharesOutstanding),
    roe: num(fin.returnOnEquity),
    profitMargin: num(fin.profitMargins),
    grossMargin: num(fin.grossMargins),
    operatingMargin: num(fin.operatingMargins),
    ebitdaMargin: num(fin.ebitdaMargins),
    revenueGrowth: num(fin.revenueGrowth),
    earningsGrowth: num(fin.earningsGrowth),
    debtToEquity: debtToEquityPercent === null ? null : debtToEquityPercent / 100,
    totalCash: num(fin.totalCash),
    totalDebt: num(fin.totalDebt),
    totalRevenue: num(fin.totalRevenue),
    freeCashflow: num(fin.freeCashflow),
    financialCurrency: str(fin.financialCurrency),
    targetMeanPrice: num(fin.targetMeanPrice),
    targetHighPrice: num(fin.targetHighPrice),
    targetLowPrice: num(fin.targetLowPrice),
    recommendationKey: str(fin.recommendationKey),
    recommendationMean: num(fin.recommendationMean),
    numberOfAnalysts: num(fin.numberOfAnalystOpinions),
    nextEarningsDate: pickEarningsDate(s.calendarEvents),
    exDividendDate: toIso(detail.exDividendDate) ?? toIso(s.calendarEvents?.exDividendDate),
  };

  return { profile, stats };
}

function summaryKey(symbol: string): string {
  return `summary:${symbol}`;
}

/** True when getSummary can be answered from the cache without calling Yahoo. */
export function hasCachedSummary(symbol: string): boolean {
  return isFresh(summaryKey(symbol));
}

/** The cached summary, fresh or stale, without loading: null when Yahoo has none, undefined when nothing is cached. */
export function peekSummary(symbol: string): { profile: StockProfile; stats: KeyStats } | null | undefined {
  return peek<{ profile: StockProfile; stats: KeyStats } | null>(summaryKey(symbol));
}

/** Profile and key statistics (cached 6 hours). Returns null when Yahoo has no summary for the symbol. */
export async function getSummary(symbol: string): Promise<{ profile: StockProfile; stats: KeyStats } | null> {
  return cached(summaryKey(symbol), { ttlMs: 6 * HOUR, staleMs: 24 * HOUR }, async () => {
    try {
      const raw = (await upstream(() => yf.quoteSummary(symbol, { modules: [...SUMMARY_MODULES] }, callOptions()))) as unknown as RawSummary;
      return mapSummary(symbol, raw ?? {});
    } catch (error) {
      // Unknown symbols make quoteSummary throw "Quote not found"; treat that as "no summary".
      const message = String(error);
      if (/not found|No fundamentals|Not Found|404/i.test(message)) return null;
      throw error;
    }
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const SEARCH_TYPES = new Set(["EQUITY", "ETF", "INDEX", "MUTUALFUND", "CRYPTOCURRENCY", "FUTURE", "CURRENCY"]);

/** Yahoo answers queries it cannot parse with a 400 ("Invalid Search Query"): that means no results, not an outage. */
function isInvalidQuery(error: unknown): boolean {
  return error instanceof Error && (error.name === "BadRequestError" || /Invalid Search Query/i.test(error.message));
}

/**
 * Ticker autocomplete (cached 1 hour). Equities and ETFs are listed first. Yahoo only understands Latin text, so
 * Chinese queries return no results here; the client resolves them from lib/names-zh.ts.
 */
export async function searchSymbols(query: string): Promise<SymbolSearchResult[]> {
  const q = query.trim().slice(0, 40);
  if (!q || hasCjk(q) || !/[a-z0-9]/i.test(q)) return [];
  return cached(`search:${q.toLowerCase()}`, { ttlMs: HOUR, staleMs: 6 * HOUR }, async () => {
    let res: { quotes?: Array<Record<string, unknown>> };
    try {
      res = (await upstream(() => yf.search(q, { quotesCount: 10, newsCount: 0 }, callOptions()))) as unknown as typeof res;
    } catch (error) {
      if (isInvalidQuery(error)) return [];
      throw error;
    }
    const rank = (type: string | null) => (type === "EQUITY" ? 0 : type === "ETF" ? 1 : type === "INDEX" ? 2 : 3);
    return (res.quotes ?? [])
      .filter((r) => r.isYahooFinance !== false && typeof r.symbol === "string" && SEARCH_TYPES.has(String(r.quoteType)))
      .map((r) => ({
        symbol: String(r.symbol),
        name: str(r.longname) ?? str(r.shortname) ?? String(r.symbol),
        exchange: str(r.exchDisp),
        type: str(r.quoteType),
      }))
      .sort((a, b) => rank(a.type) - rank(b.type))
      .slice(0, 8);
  });
}

/** Raw Yahoo news search result (provenance is assigned by lib/server/news.ts). */
export interface RawNewsItem {
  id: string;
  title: string;
  publisher: string | null;
  link: string;
  publishedAt: string | null;
  relatedTickers: string[];
}

const DEFAULT_NEWS_COUNT = 8;

function newsQuery(query: string): string {
  return query.trim().slice(0, 60);
}

function newsSearchKey(q: string, count: number): string {
  return `news-search:${q.toLowerCase()}:${count}`;
}

/** True when searchNews(query, count) can be answered without calling Yahoo (fresh in the cache, or an empty query). */
export function hasCachedNewsSearch(query: string, count = DEFAULT_NEWS_COUNT): boolean {
  const q = newsQuery(query);
  return !q || isFresh(newsSearchKey(q, count));
}

/** Yahoo news search (cached 10 minutes). Short 1-3 word queries work best. */
export async function searchNews(query: string, count = DEFAULT_NEWS_COUNT): Promise<RawNewsItem[]> {
  const q = newsQuery(query);
  if (!q) return [];
  return cached(newsSearchKey(q, count), { ttlMs: 10 * MINUTE, staleMs: 6 * HOUR }, async () => {
    const res = (await upstream(() => yf.search(q, { quotesCount: 0, newsCount: count }, callOptions()))) as unknown as {
      news?: Array<Record<string, unknown>>;
    };
    return (res.news ?? [])
      .filter((n) => typeof n.uuid === "string" && typeof n.title === "string" && typeof n.link === "string")
      .map((n) => ({
        id: String(n.uuid),
        title: String(n.title).trim(),
        publisher: str(n.publisher),
        link: String(n.link),
        publishedAt: toIso(n.providerPublishTime),
        relatedTickers: Array.isArray(n.relatedTickers) ? (n.relatedTickers as unknown[]).filter((t): t is string => typeof t === "string") : [],
      }));
  });
}
