import "server-only";

import type {
  BoardItem,
  ChartData,
  ChartRange,
  KeyStats,
  MarketOverview,
  NewsItem,
  Quote,
  SectorSnapshot,
  StockDetail,
  StockProfile,
} from "@/types/api";
import { MARKET_BOARD, MARKET_STATE_SYMBOL, SECTORS, UNIVERSE_STOCKS } from "@/lib/universe";

import { cached } from "./cache";
import { log } from "./log";
import { getCompanyNews, getMarketNews } from "./news";
import { getChart, getQuote, getQuotes, getSparkline, getSummary } from "./yahoo";

// Assembles the market overview, stock detail and chart payloads from the cached Yahoo getters.
// Partial upstream failures degrade a section (listed in `warnings`) instead of failing the response.

const MOVERS_COUNT = 6;
/** The overview is shared by every visitor, so it is assembled at most once per this interval. */
const OVERVIEW_TTL_MS = 10_000;

const BOARD_SYMBOLS = MARKET_BOARD.map((b) => b.symbol);
/** Everything the overview shows, fetched in one batched quote request (under Yahoo's 100-symbol batch). */
const OVERVIEW_SYMBOLS = [...new Set([...BOARD_SYMBOLS, ...UNIVERSE_STOCKS, ...SECTORS.map((s) => s.etf)])];

function isQuote(quote: Quote | undefined): quote is Quote {
  return quote !== undefined;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Market-cap-weighted average change in percent units. Constituents without a cap are left out of the weighted
 * average; when none has a cap, the simple average is used. Null when no constituent has a change.
 */
export function weightedChangePercent(quotes: ReadonlyArray<Pick<Quote, "changePercent" | "marketCap">>): number | null {
  let weightedSum = 0;
  let totalCap = 0;
  let plainSum = 0;
  let count = 0;
  for (const { changePercent, marketCap } of quotes) {
    if (changePercent === null) continue;
    plainSum += changePercent;
    count += 1;
    if (marketCap !== null && marketCap > 0) {
      weightedSum += changePercent * marketCap;
      totalCap += marketCap;
    }
  }
  if (count === 0) return null;
  return totalCap > 0 ? weightedSum / totalCap : plainSum / count;
}

function bySymbol(a: Quote, b: Quote): number {
  return a.symbol.localeCompare(b.symbol);
}

function dollarVolume(quote: Quote): number | null {
  return quote.price !== null && quote.volume !== null && quote.volume > 0 ? quote.price * quote.volume : null;
}

/**
 * Top gainers (positive changes, largest first), top losers (negative changes, largest drop first) and the highest
 * dollar volume. Ties are broken by symbol so the lists do not flicker between refreshes.
 */
export function selectMovers(quotes: readonly Quote[], count = MOVERS_COUNT): MarketOverview["movers"] {
  const changes = quotes.flatMap((quote) => (quote.changePercent === null ? [] : [{ quote, change: quote.changePercent }]));
  const gainers = changes
    .filter((e) => e.change > 0)
    .sort((a, b) => b.change - a.change || bySymbol(a.quote, b.quote))
    .slice(0, count)
    .map((e) => e.quote);
  const losers = changes
    .filter((e) => e.change < 0)
    .sort((a, b) => a.change - b.change || bySymbol(a.quote, b.quote))
    .slice(0, count)
    .map((e) => e.quote);
  const mostActive = quotes
    .flatMap((quote) => {
      const value = dollarVolume(quote);
      return value === null ? [] : [{ quote, value }];
    })
    .sort((a, b) => b.value - a.value || bySymbol(a.quote, b.quote))
    .slice(0, count)
    .map((e) => e.quote);
  return { gainers, losers, mostActive };
}

function byMarketCapDesc(a: Quote, b: Quote): number {
  if (a.marketCap === b.marketCap) return bySymbol(a, b);
  if (a.marketCap === null) return 1;
  if (b.marketCap === null) return -1;
  return b.marketCap - a.marketCap;
}

/** Sectors in SECTORS order with constituents sorted by market cap (largest first). */
export function buildSectors(quotes: ReadonlyMap<string, Quote>): SectorSnapshot[] {
  return SECTORS.map((sector) => {
    const stocks = sector.stocks.map((symbol) => quotes.get(symbol)).filter(isQuote).sort(byMarketCapDesc);
    return { key: sector.key, etf: quotes.get(sector.etf) ?? null, changePercent: weightedChangePercent(stocks), stocks };
  });
}

/** Board items in MARKET_BOARD order; symbols without a quote are omitted. */
export function buildBoard(quotes: ReadonlyMap<string, Quote>, sparks: ReadonlyMap<string, number[]>): BoardItem[] {
  return BOARD_SYMBOLS.flatMap((symbol) => {
    const quote = quotes.get(symbol);
    return quote ? [{ quote, spark: sparks.get(symbol) ?? [] }] : [];
  });
}

/** Fills statistics the summary lacks with the matching quote fields; summary values always win. */
export function fillStatsFromQuote(stats: KeyStats, quote: Quote): KeyStats {
  return {
    ...stats,
    marketCap: stats.marketCap ?? quote.marketCap,
    trailingPE: stats.trailingPE ?? quote.trailingPE,
    forwardPE: stats.forwardPE ?? quote.forwardPE,
    eps: stats.eps ?? quote.epsTrailingTwelveMonths,
    dividendYield: stats.dividendYield ?? quote.dividendYield,
    fiftyTwoWeekHigh: stats.fiftyTwoWeekHigh ?? quote.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: stats.fiftyTwoWeekLow ?? quote.fiftyTwoWeekLow,
    avgVolume: stats.avgVolume ?? quote.avgVolume,
  };
}

const EMPTY_STATS: KeyStats = {
  marketCap: null,
  trailingPE: null,
  forwardPE: null,
  pegRatio: null,
  priceToBook: null,
  eps: null,
  forwardEps: null,
  dividendYield: null,
  beta: null,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  avgVolume: null,
  sharesOutstanding: null,
  roe: null,
  profitMargin: null,
  grossMargin: null,
  operatingMargin: null,
  revenueGrowth: null,
  earningsGrowth: null,
  debtToEquity: null,
  totalCash: null,
  totalDebt: null,
  totalRevenue: null,
  freeCashflow: null,
  targetMeanPrice: null,
  targetHighPrice: null,
  targetLowPrice: null,
  recommendationKey: null,
  recommendationMean: null,
  numberOfAnalysts: null,
  nextEarningsDate: null,
  exDividendDate: null,
};

/** Minimal profile and statistics from the quote alone, for symbols Yahoo has no summary for. */
export function summaryFromQuote(quote: Quote): { profile: StockProfile; stats: KeyStats } {
  return {
    profile: {
      symbol: quote.symbol,
      name: quote.name,
      longName: null,
      sector: null,
      industry: null,
      exchange: quote.exchange,
      currency: quote.currency,
      country: null,
      website: null,
      employees: null,
      summary: null,
    },
    stats: fillStatsFromQuote(EMPTY_STATS, quote),
  };
}

// ---------------------------------------------------------------------------
// Market overview
// ---------------------------------------------------------------------------

async function loadBoardSparks(): Promise<{ sparks: Map<string, number[]>; failed: boolean }> {
  const settled = await Promise.allSettled(BOARD_SYMBOLS.map((symbol) => getSparkline(symbol)));
  const sparks = new Map<string, number[]>();
  let failed = false;
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") sparks.set(BOARD_SYMBOLS[i], outcome.value);
    else failed = true;
  });
  return { sparks, failed };
}

async function buildOverview(): Promise<MarketOverview> {
  const [quotesResult, sparksResult, newsResult] = await Promise.allSettled([
    getQuotes(OVERVIEW_SYMBOLS),
    loadBoardSparks(),
    getMarketNews(),
  ]);
  if (quotesResult.status === "rejected") throw quotesResult.reason;
  const quotes = quotesResult.value;
  if (quotes.size === 0) throw new Error("Market overview: Yahoo returned no quotes");

  const warnings: string[] = [];
  const sparks = sparksResult.status === "fulfilled" ? sparksResult.value.sparks : new Map<string, number[]>();
  if (sparksResult.status === "rejected" || sparksResult.value.failed) warnings.push("sparklines");

  if ([...quotes.values()].some((quote) => quote.stale)) warnings.push("quotes_stale");

  const board = buildBoard(quotes, sparks);
  if (board.length < BOARD_SYMBOLS.length) warnings.push("board");

  const sectors = buildSectors(quotes);
  if (sectors.some((sector) => sector.stocks.length === 0)) warnings.push("sectors");

  let news: NewsItem[] = [];
  if (newsResult.status === "fulfilled") {
    news = newsResult.value;
  } else {
    warnings.push("news");
    log("warn", "market.news_unavailable", { error: newsResult.reason });
  }

  return {
    asOf: new Date().toISOString(),
    marketState: quotes.get(MARKET_STATE_SYMBOL)?.marketState ?? null,
    board,
    sectors,
    movers: selectMovers(UNIVERSE_STOCKS.map((symbol) => quotes.get(symbol)).filter(isQuote)),
    news,
    warnings,
  };
}

/** Overview for the home page. Throws only when no quotes at all can be loaded. */
export function getMarketOverview(): Promise<MarketOverview> {
  return cached("market:overview", { ttlMs: OVERVIEW_TTL_MS }, buildOverview);
}

// ---------------------------------------------------------------------------
// Stock detail and chart
// ---------------------------------------------------------------------------

/** Stock page payload; null when Yahoo does not know the symbol. Throws when the quote cannot be loaded. */
export async function getStockDetail(symbol: string): Promise<StockDetail | null> {
  const [quoteResult, summaryResult] = await Promise.allSettled([getQuote(symbol), getSummary(symbol)]);
  if (quoteResult.status === "rejected") throw quoteResult.reason;
  const quote = quoteResult.value;
  if (!quote) return null;

  const warnings: string[] = [];
  if (quote.stale) warnings.push("quotes_stale");
  if (summaryResult.status === "rejected") log("warn", "stock.summary_unavailable", { symbol, error: summaryResult.reason });
  const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
  if (!summary) warnings.push("summary");
  const { profile, stats } = summary
    ? { profile: summary.profile, stats: fillStatsFromQuote(summary.stats, quote) }
    : summaryFromQuote(quote);

  let news: NewsItem[] = [];
  try {
    news = await getCompanyNews(symbol, quote.name || profile.name, summary?.profile ?? null);
  } catch (error) {
    warnings.push("news");
    log("warn", "stock.news_unavailable", { symbol, error });
  }

  return { asOf: new Date().toISOString(), quote, profile, stats, news, warnings };
}

/**
 * Chart bars for the range. Null when the symbol is unknown (no quote and no bars); a known symbol without bars
 * in the range gets an empty chart. Throws when the bars cannot be loaded for a known symbol.
 */
export async function getChartData(symbol: string, range: ChartRange): Promise<ChartData | null> {
  const [chartResult, quoteResult] = await Promise.allSettled([getChart(symbol, range), getQuote(symbol)]);
  if (chartResult.status === "fulfilled" && chartResult.value.bars.length > 0) return chartResult.value;
  if (quoteResult.status === "fulfilled" && quoteResult.value === null) return null;
  if (chartResult.status === "rejected") throw chartResult.reason;
  return chartResult.value;
}
