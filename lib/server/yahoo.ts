import "server-only";

import YahooFinance from "yahoo-finance2";

import type {
  Bar,
  ChartData,
  ChartRange,
  KeyStats,
  MarketState,
  Quote,
  StockProfile,
  SymbolSearchResult,
} from "@/types/api";

import { normalizeBars, type DailyBar, type RawChart } from "@/lib/bars";

import { cached, HOUR, MINUTE, peek } from "./cache";

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
let pendingCalls = 0;

export class UpstreamBusyError extends Error {
  constructor() {
    super("Too many Yahoo requests are pending");
    this.name = "UpstreamBusyError";
  }
}

/** Queue wait plus run time allowed per call: a job dequeued after this fails at once instead of fetching. */
const CALL_DEADLINE_MS = 20_000;

/** Module options for every Yahoo call; the signal reaches timeoutFetch through the library's fetchOptions. */
function callOptions() {
  return { validateResult: false as const, fetchOptions: { signal: AbortSignal.timeout(CALL_DEADLINE_MS) } };
}

async function upstream<T>(call: () => Promise<T>): Promise<T> {
  if (pendingCalls >= MAX_PENDING_CALLS) throw new UpstreamBusyError();
  pendingCalls++;
  try {
    return await call();
  } finally {
    pendingCalls--;
  }
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

function str(value: unknown): string | null {
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

function marketState(value: unknown): MarketState | null {
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
  return (raw ?? []).filter((q) => q && typeof q.symbol === "string").map(mapQuote);
}

/**
 * Quotes for many symbols. Each symbol is cached individually (15 s while its session trades, 5 min otherwise),
 * misses are fetched in one batched request, and symbols Yahoo does not know are omitted from the result.
 * If Yahoo fails, recently expired quotes (up to 1 hour old) are served instead.
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
    let servedStale = false;
    for (const symbol of sorted) {
      const slot = quoteSlots.get(symbol);
      if (slot?.quote && slot.staleUntil > Date.now()) {
        result.set(symbol, slot.quote);
        servedStale = true;
      }
    }
    if (!servedStale && result.size === 0) throw error;
  }
  return result;
}

export async function getQuote(symbol: string): Promise<Quote | null> {
  const quotes = await getQuotes([symbol]);
  return quotes.get(symbol) ?? null;
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

const RANGE_SPEC: Record<ChartRange, { days: number; interval: "1d" | "1wk" }> = {
  "1mo": { days: 35, interval: "1d" },
  "3mo": { days: 95, interval: "1d" },
  "6mo": { days: 186, interval: "1d" },
  "1y": { days: 372, interval: "1d" },
  "2y": { days: 737, interval: "1d" },
  "5y": { days: 1835, interval: "1wk" },
};

export const CHART_RANGES = Object.keys(RANGE_SPEC) as ChartRange[];

export async function getChart(symbol: string, range: ChartRange): Promise<ChartData> {
  const spec = RANGE_SPEC[range];
  const bars = await cached(`chart:${symbol}:${range}`, { ttlMs: barsTtl(), staleMs: 6 * HOUR }, () =>
    fetchChart(symbol, spec.days, spec.interval),
  );
  const out: Bar[] = bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
  return { symbol, range, interval: spec.interval, bars: out };
}

/** About one month of daily closes for sparklines (cached 30 minutes). */
/** True when a sparkline can be served from the cache (fresh or stale) without calling Yahoo. */
export function hasCachedSparkline(symbol: string): boolean {
  return peek(`spark:${symbol}`) !== undefined;
}

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
    revenueGrowth: num(fin.revenueGrowth),
    earningsGrowth: num(fin.earningsGrowth),
    debtToEquity: debtToEquityPercent === null ? null : debtToEquityPercent / 100,
    totalCash: num(fin.totalCash),
    totalDebt: num(fin.totalDebt),
    totalRevenue: num(fin.totalRevenue),
    freeCashflow: num(fin.freeCashflow),
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

/** Profile and key statistics (cached 6 hours). Returns null when Yahoo has no summary for the symbol. */
export async function getSummary(symbol: string): Promise<{ profile: StockProfile; stats: KeyStats } | null> {
  return cached(`summary:${symbol}`, { ttlMs: 6 * HOUR, staleMs: 24 * HOUR }, async () => {
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

/** Ticker autocomplete (cached 1 hour). Equities and ETFs are listed first. */
export async function searchSymbols(query: string): Promise<SymbolSearchResult[]> {
  const q = query.trim().slice(0, 40);
  if (!q) return [];
  return cached(`search:${q.toLowerCase()}`, { ttlMs: HOUR, staleMs: 6 * HOUR }, async () => {
    const res = (await upstream(() => yf.search(q, { quotesCount: 10, newsCount: 0 }, callOptions()))) as unknown as {
      quotes?: Array<Record<string, unknown>>;
    };
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

/** Yahoo news search (cached 10 minutes). Short 1-3 word queries work best. */
export async function searchNews(query: string, count = 8): Promise<RawNewsItem[]> {
  const q = query.trim().slice(0, 60);
  if (!q) return [];
  return cached(`news-search:${q.toLowerCase()}:${count}`, { ttlMs: 10 * MINUTE, staleMs: 6 * HOUR }, async () => {
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
