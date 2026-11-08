import "server-only";

import type {
  BoardItem,
  BreadthTally,
  ChartData,
  ChartRange,
  KeyStats,
  MarketBreadth,
  MarketOverview,
  NewsItem,
  OverviewQuote,
  Quote,
  SectorSnapshot,
  StockDetail,
  StockProfile,
} from "@/types/api";
import { BREADTH_REFERENCES, MARKET_BOARD, MARKET_STATE_SYMBOL, SECTORS, UNIVERSE_STOCKS } from "@/lib/universe";

import { cached } from "./cache";
import { log } from "./log";
import { getCompanyNews, getMarketNews } from "./news";
import { getChart, getQuote, getQuotes, getSparkline, getSummary } from "./yahoo";

// Assembles the market overview, stock detail and chart payloads from the cached Yahoo getters.
// Partial upstream failures degrade a section (listed in `warnings`) instead of failing the response.

const MOVERS_COUNT = 8;
/** The overview is shared by every visitor, so it is assembled at most once per this interval. */
const OVERVIEW_TTL_MS = 10_000;
/** A stock within this distance of its 52-week high (or low) counts as near it in the breadth figures. */
export const NEAR_EXTREME = 0.03;

const BOARD_SYMBOLS = MARKET_BOARD.map((b) => b.symbol);
const BREADTH_SYMBOLS = [BREADTH_REFERENCES.equalWeight, BREADTH_REFERENCES.capWeight];
/**
 * Everything the overview shows, fetched in one batched quote request (lib/server/yahoo.ts sends at most 100 symbols
 * per request). Sector ETFs are not part of it: the sector page loads them with its related ETFs.
 */
export const OVERVIEW_SYMBOLS = [...new Set([...BOARD_SYMBOLS, ...UNIVERSE_STOCKS, ...BREADTH_SYMBOLS])];

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

/** The fields of a quote that the overview's heatmap, sector tables and movers show (see OverviewQuote). */
export function slimQuote(quote: Quote): OverviewQuote {
  return {
    symbol: quote.symbol,
    name: quote.name,
    price: quote.price,
    change: quote.change,
    changePercent: quote.changePercent,
    volume: quote.volume,
    avgVolume: quote.avgVolume,
    marketCap: quote.marketCap,
    trailingPE: quote.trailingPE,
    fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
  };
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
    .map((e) => slimQuote(e.quote));
  const losers = changes
    .filter((e) => e.change < 0)
    .sort((a, b) => a.change - b.change || bySymbol(a.quote, b.quote))
    .slice(0, count)
    .map((e) => slimQuote(e.quote));
  const mostActive = quotes
    .flatMap((quote) => {
      const value = dollarVolume(quote);
      return value === null ? [] : [{ quote, value }];
    })
    .sort((a, b) => b.value - a.value || bySymbol(a.quote, b.quote))
    .slice(0, count)
    .map((e) => slimQuote(e.quote));
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
    return { key: sector.key, changePercent: weightedChangePercent(stocks), stocks: stocks.map(slimQuote) };
  });
}

function tally(): BreadthTally {
  return { count: 0, of: 0 };
}

/** Counts a stock into a tally when its data can tell (known), and as a hit when it meets the condition. */
function record(target: BreadthTally, known: boolean, hit: boolean): void {
  if (!known) return;
  target.of += 1;
  if (hit) target.count += 1;
}

function positive(value: number | null): value is number {
  return value !== null && value > 0;
}

/**
 * Breadth of the universe stocks: advancers and decliners, the share above the 50- and 200-session averages and near a
 * 52-week extreme, overall and per sector, plus today's change of the equal-weight and cap-weighted S&P 500 ETFs.
 * A stock counts towards a tally only when its quote has the fields that tally needs. Null without any universe quote.
 */
export function computeBreadth(quotes: ReadonlyMap<string, Quote>, nearExtreme = NEAR_EXTREME): MarketBreadth | null {
  const breadth: MarketBreadth = {
    stocks: 0,
    advancers: 0,
    decliners: 0,
    unchanged: 0,
    above50d: tally(),
    above200d: tally(),
    nearHigh: tally(),
    nearLow: tally(),
    nearExtreme,
    equalWeight: quotes.get(BREADTH_REFERENCES.equalWeight)?.changePercent ?? null,
    capWeight: quotes.get(BREADTH_REFERENCES.capWeight)?.changePercent ?? null,
    sectors: [],
  };
  for (const sector of SECTORS) {
    const row = { key: sector.key, advancers: 0, decliners: 0, above50d: tally(), above200d: tally() };
    for (const symbol of sector.stocks) {
      const quote = quotes.get(symbol);
      if (!quote) continue;
      breadth.stocks += 1;
      const { price, changePercent, fiftyDayAverage, twoHundredDayAverage, fiftyTwoWeekHigh, fiftyTwoWeekLow } = quote;
      if (changePercent !== null) {
        if (changePercent > 0) {
          breadth.advancers += 1;
          row.advancers += 1;
        } else if (changePercent < 0) {
          breadth.decliners += 1;
          row.decliners += 1;
        } else {
          breadth.unchanged += 1;
        }
      }
      if (!positive(price)) continue;
      const knows50 = positive(fiftyDayAverage);
      const knows200 = positive(twoHundredDayAverage);
      record(breadth.above50d, knows50, knows50 && price > fiftyDayAverage);
      record(row.above50d, knows50, knows50 && price > fiftyDayAverage);
      record(breadth.above200d, knows200, knows200 && price > twoHundredDayAverage);
      record(row.above200d, knows200, knows200 && price > twoHundredDayAverage);
      record(breadth.nearHigh, positive(fiftyTwoWeekHigh), positive(fiftyTwoWeekHigh) && price >= fiftyTwoWeekHigh * (1 - nearExtreme));
      record(breadth.nearLow, positive(fiftyTwoWeekLow), positive(fiftyTwoWeekLow) && price <= fiftyTwoWeekLow * (1 + nearExtreme));
    }
    breadth.sectors.push(row);
  }
  return breadth.stocks > 0 ? breadth : null;
}

/** The oldest fetch time among the quotes served stale (ISO), or null when every quote is fresh. */
export function oldestStaleFetch(quotes: Iterable<Pick<Quote, "stale" | "fetchedAt">>): string | null {
  let oldest: string | null = null;
  for (const quote of quotes) {
    if (quote.stale && quote.fetchedAt && (oldest === null || quote.fetchedAt < oldest)) oldest = quote.fetchedAt;
  }
  return oldest;
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
    breadth: computeBreadth(quotes),
    news,
    warnings,
    staleSince: oldestStaleFetch(quotes.values()),
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
