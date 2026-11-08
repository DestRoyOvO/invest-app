import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorBody,
  ChartData,
  ChartRange,
  KeyStats,
  MarketOverview,
  MarketState,
  NewsItem,
  NewsResponse,
  Quote,
  QuotesResponse,
  SectorKey,
  StockDetail,
  StockProfile,
  SymbolSearchResult,
} from "@/types/api";
import { MARKET_BOARD, SECTORS } from "@/lib/universe";

vi.mock("server-only", () => ({}));

const yahoo = vi.hoisted(() => ({
  getQuotes: vi.fn<(symbols: string[]) => Promise<Map<string, Quote>>>(),
  getQuote: vi.fn<(symbol: string) => Promise<Quote | null>>(),
  getSparkline: vi.fn<(symbol: string) => Promise<number[]>>(),
  getSummary: vi.fn<(symbol: string) => Promise<{ profile: StockProfile; stats: KeyStats } | null>>(),
  getChart: vi.fn<(symbol: string, range: ChartRange) => Promise<ChartData>>(),
  searchSymbols: vi.fn<(query: string) => Promise<SymbolSearchResult[]>>(),
}));
const news = vi.hoisted(() => ({
  getMarketNews: vi.fn<() => Promise<NewsItem[]>>(),
  getSectorNews: vi.fn<(sector: SectorKey) => Promise<NewsItem[]>>(),
  getCompanyNews: vi.fn<(symbol: string, companyName: string, profile: StockProfile | null) => Promise<NewsItem[]>>(),
}));
vi.mock("./yahoo", () => ({
  ...yahoo,
  // Plain values the route handlers import alongside the getters.
  CHART_RANGES: ["1d", "5d", "1mo", "3mo", "6mo", "ytd", "1y", "2y", "5y", "max"] satisfies ChartRange[],
  isSessionActive: (state: MarketState | null) => state === "REGULAR" || state === "PRE" || state === "POST",
  hasCachedSparkline: () => false,
  // Cache probes used by lib/server/charging.ts: nothing is cached, so the stock route charges its full fan-out.
  hasFreshQuote: () => false,
  hasCachedSummary: () => false,
  hasCachedNewsSearch: () => false,
  hasCachedDailyBars: () => false,
  peekQuote: () => undefined,
  peekSummary: () => undefined,
}));
vi.mock("./news", () => news);

import { GET as overviewRoute } from "@/app/api/market/overview/route";
import { GET as newsRoute } from "@/app/api/news/route";
import { GET as quotesRoute } from "@/app/api/quotes/route";
import { GET as searchRoute } from "@/app/api/search/route";
import { GET as sparklinesRoute } from "@/app/api/sparklines/route";
import { GET as chartRoute } from "@/app/api/stock/[symbol]/chart/route";
import { GET as stockNewsRoute } from "@/app/api/stock/[symbol]/news/route";
import { GET as stockRoute } from "@/app/api/stock/[symbol]/route";

import { clearCache } from "./cache";
import {
  buildBoard,
  buildSectors,
  fillStatsFromQuote,
  getChartData,
  getMarketOverview,
  getStockDetail,
  getStockNews,
  ownNewsProvenance,
  selectMovers,
  summaryFromQuote,
  weightedChangePercent,
  withApplicableMargins,
} from "./market";

/** A chart payload with the fields every range returns. */
function chartData(overrides: Partial<ChartData> = {}): ChartData {
  return {
    symbol: "AAPL",
    range: "1y",
    interval: "1d",
    intraday: false,
    bars: [{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }],
    timezone: "America/New_York",
    previousClose: null,
    dividends: [],
    splits: [],
    ...overrides,
  };
}

function quote(symbol: string, overrides: Partial<Quote> = {}): Quote {
  return {
    symbol,
    name: symbol,
    quoteType: "EQUITY",
    currency: "USD",
    exchange: "NasdaqGS",
    marketState: "REGULAR",
    price: 100,
    change: null,
    changePercent: null,
    previousClose: null,
    open: null,
    dayHigh: null,
    dayLow: null,
    volume: null,
    avgVolume: null,
    marketCap: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    trailingPE: null,
    forwardPE: null,
    epsTrailingTwelveMonths: null,
    dividendYield: null,
    extendedPrice: null,
    extendedChange: null,
    extendedChangePercent: null,
    extendedSession: null,
    regularMarketTime: null,
    fiftyDayAverage: null,
    twoHundredDayAverage: null,
    fiftyTwoWeekChangePercent: null,
    priceToBook: null,
    forwardEps: null,
    dividendRate: null,
    analystRating: null,
    sharesOutstanding: null,
    nextEarningsDate: null,
    earningsDateEstimated: null,
    lastEarningsDate: null,
    dividendDate: null,
    exDividendDate: null,
    dividendAmount: null,
    expenseRatio: null,
    netAssets: null,
    ytdReturnPercent: null,
    fetchedAt: null,
    stale: false,
    ...overrides,
  };
}

function quoteMap(quotes: Quote[]): Map<string, Quote> {
  return new Map(quotes.map((q) => [q.symbol, q]));
}

const newsItem: NewsItem = {
  id: "n1",
  title: "Stocks rally",
  publisher: "Reuters",
  link: "https://finance.yahoo.com/news/n1.html",
  publishedAt: "2026-11-07T14:00:00.000Z",
  relatedTickers: [],
  provenance: "market",
};

beforeEach(() => {
  clearCache();
  for (const mock of [...Object.values(yahoo), ...Object.values(news)]) mock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("weightedChangePercent", () => {
  it("weights changes by market cap", () => {
    const result = weightedChangePercent([
      { changePercent: 1, marketCap: 300 },
      { changePercent: -1, marketCap: 100 },
    ]);
    expect(result).toBeCloseTo(0.5);
  });

  it("leaves constituents without a cap out of the weighted average", () => {
    const result = weightedChangePercent([
      { changePercent: 2, marketCap: 100 },
      { changePercent: 4, marketCap: 300 },
      { changePercent: -50, marketCap: null },
    ]);
    expect(result).toBeCloseTo(3.5);
  });

  it("falls back to a simple average when no constituent has a cap", () => {
    expect(weightedChangePercent([{ changePercent: 1, marketCap: null }, { changePercent: 2, marketCap: 0 }])).toBeCloseTo(1.5);
  });

  it("returns null without data", () => {
    expect(weightedChangePercent([])).toBeNull();
    expect(weightedChangePercent([{ changePercent: null, marketCap: 100 }])).toBeNull();
  });
});

describe("selectMovers", () => {
  const universe = [
    quote("AAA", { changePercent: 5, price: 10, volume: 1_000 }),
    quote("BBB", { changePercent: -3, price: 500, volume: 1_000 }),
    quote("CCC", { changePercent: 2, price: 20, volume: 100_000 }),
    quote("DDD", { changePercent: 2, price: 50, volume: null }),
    quote("EEE", { changePercent: -7, price: null, volume: 9_000_000 }),
    quote("FFF", { changePercent: 0, price: 30, volume: 10 }),
    quote("GGG", { changePercent: null, price: 40, volume: 5_000 }),
  ];

  it("ranks gainers and losers by change, breaking ties by symbol", () => {
    const { gainers, losers } = selectMovers(universe);
    expect(gainers.map((q) => q.symbol)).toEqual(["AAA", "CCC", "DDD"]);
    expect(losers.map((q) => q.symbol)).toEqual(["EEE", "BBB"]);
  });

  it("ranks the most active by dollar volume and skips missing price or volume", () => {
    expect(selectMovers(universe).mostActive.map((q) => q.symbol)).toEqual(["CCC", "BBB", "GGG", "AAA", "FFF"]);
  });

  it("limits every list to the requested count", () => {
    const many = Array.from({ length: 10 }, (_, i) => quote(`S${i}`, { changePercent: i + 1, price: 10, volume: i + 1 }));
    const movers = selectMovers(many, 6);
    expect(movers.gainers).toHaveLength(6);
    expect(movers.gainers[0].symbol).toBe("S9");
    expect(movers.losers).toHaveLength(0);
    expect(movers.mostActive).toHaveLength(6);
  });
});

describe("buildSectors", () => {
  it("keeps SECTORS order, sorts constituents by market cap and weights the change", () => {
    const quotes = quoteMap([
      quote("NVDA", { marketCap: 4_000, changePercent: 2 }),
      quote("AAPL", { marketCap: 5_000, changePercent: -1 }),
      quote("MSFT", { marketCap: null, changePercent: 10 }),
      quote("XLK", { quoteType: "ETF", changePercent: 0.4 }),
    ]);
    const sectors = buildSectors(quotes);
    expect(sectors.map((s) => s.key)).toEqual(SECTORS.map((s) => s.key));

    const technology = sectors[0];
    expect(technology.stocks.map((q) => q.symbol)).toEqual(["AAPL", "NVDA", "MSFT"]);
    expect(technology.changePercent).toBeCloseTo((2 * 4_000 - 1 * 5_000) / 9_000);
    // Slim rows: only the fields the heatmap and the sector tables show.
    expect(Object.keys(technology.stocks[0]).sort()).toEqual(
      ["avgVolume", "change", "changePercent", "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "marketCap", "name", "price", "symbol", "trailingPE", "volume"],
    );

    const energy = sectors.find((s) => s.key === "energy");
    expect(energy).toEqual({ key: "energy", changePercent: null, stocks: [] });
  });
});

describe("buildBoard", () => {
  it("follows MARKET_BOARD order and omits symbols without a quote", () => {
    const quotes = quoteMap([quote("BTC-USD"), quote("^GSPC"), quote("^VIX")]);
    const board = buildBoard(quotes, new Map([["^GSPC", [1, 2, 3]]]));
    expect(board.map((b) => b.quote.symbol)).toEqual(["^GSPC", "^VIX", "BTC-USD"]);
    expect(board[0].spark).toEqual([1, 2, 3]);
    expect(board[1].spark).toEqual([]);
  });
});

describe("getMarketOverview", () => {
  function allQuotes(): Map<string, Quote> {
    const symbols = [...MARKET_BOARD.map((b) => b.symbol), ...SECTORS.flatMap((s) => [s.etf, ...s.stocks])];
    return quoteMap(
      symbols.map((symbol, i) =>
        quote(symbol, { changePercent: (i % 7) - 3, marketCap: 1_000 + i, volume: 1_000 * (i + 1), marketState: "CLOSED" }),
      ),
    );
  }

  it("assembles every section from one quote batch", async () => {
    yahoo.getQuotes.mockResolvedValue(allQuotes());
    yahoo.getSparkline.mockResolvedValue([1, 2, 3]);
    news.getMarketNews.mockResolvedValue([newsItem]);

    const overview = await getMarketOverview();

    expect(yahoo.getQuotes).toHaveBeenCalledTimes(1);
    expect(yahoo.getQuotes.mock.calls[0][0].length).toBeLessThanOrEqual(100);
    expect(overview.marketState).toBe("CLOSED");
    expect(overview.board.map((b) => b.quote.symbol)).toEqual(MARKET_BOARD.map((b) => b.symbol));
    expect(overview.board.every((b) => b.spark.length === 3)).toBe(true);
    expect(overview.sectors).toHaveLength(SECTORS.length);
    expect(overview.movers.gainers.length).toBeGreaterThan(0);
    expect(overview.movers.gainers.every((q) => !MARKET_BOARD.some((b) => b.symbol === q.symbol))).toBe(true);
    expect(overview.news).toEqual([newsItem]);
    expect(overview.warnings).toEqual([]);
  });

  it("warns when some quotes are stale cached copies", async () => {
    const quotes = allQuotes();
    quotes.set("^GSPC", { ...(quotes.get("^GSPC") as Quote), stale: true, fetchedAt: "2026-11-07T14:00:00.000Z" });
    yahoo.getQuotes.mockResolvedValue(quotes);
    yahoo.getSparkline.mockResolvedValue([1, 2, 3]);
    news.getMarketNews.mockResolvedValue([newsItem]);

    const overview = await getMarketOverview();
    expect(overview.warnings).toEqual(["quotes_stale"]);
  });

  it("degrades failed sections instead of failing the response", async () => {
    yahoo.getQuotes.mockResolvedValue(allQuotes());
    yahoo.getSparkline.mockImplementation(async (symbol) => {
      if (symbol === "^VIX") throw new Error("timeout");
      return [1, 2];
    });
    news.getMarketNews.mockRejectedValue(new Error("Yahoo search down"));

    const overview = await getMarketOverview();

    expect(overview.warnings).toEqual(["sparklines", "news"]);
    expect(overview.news).toEqual([]);
    expect(overview.board.find((b) => b.quote.symbol === "^VIX")?.spark).toEqual([]);
    expect(overview.board.find((b) => b.quote.symbol === "^GSPC")?.spark).toEqual([1, 2]);
  });

  it("reports missing board symbols and empty sectors", async () => {
    const quotes = allQuotes();
    quotes.delete("^RUT");
    for (const symbol of SECTORS.find((s) => s.key === "utilities")?.stocks ?? []) quotes.delete(symbol);
    yahoo.getQuotes.mockResolvedValue(quotes);
    yahoo.getSparkline.mockResolvedValue([]);
    news.getMarketNews.mockResolvedValue([]);

    const overview = await getMarketOverview();

    expect(overview.warnings).toEqual(["board", "sectors"]);
    expect(overview.board).toHaveLength(MARKET_BOARD.length - 1);
  });

  it("fails when no quotes can be loaded", async () => {
    yahoo.getSparkline.mockResolvedValue([]);
    news.getMarketNews.mockResolvedValue([]);
    yahoo.getQuotes.mockRejectedValue(new Error("Yahoo down"));
    await expect(getMarketOverview()).rejects.toThrow("Yahoo down");

    yahoo.getQuotes.mockResolvedValue(new Map());
    await expect(getMarketOverview()).rejects.toThrow("no quotes");
  });

  it("is assembled once per cache interval", async () => {
    yahoo.getQuotes.mockResolvedValue(allQuotes());
    yahoo.getSparkline.mockResolvedValue([]);
    news.getMarketNews.mockResolvedValue([]);

    const [first, second] = await Promise.all([getMarketOverview(), getMarketOverview()]);
    const third = await getMarketOverview();

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(yahoo.getQuotes).toHaveBeenCalledTimes(1);
  });
});

describe("summaryFromQuote and fillStatsFromQuote", () => {
  const base = quote("XYZ", { name: "Xyz Corp", marketCap: 123, trailingPE: 20, epsTrailingTwelveMonths: 5, dividendYield: 0.01 });

  it("builds a minimal profile and statistics from the quote", () => {
    const { profile, stats } = summaryFromQuote(base);
    expect(profile).toMatchObject({ symbol: "XYZ", name: "Xyz Corp", sector: null, industry: null, exchange: "NasdaqGS" });
    expect(stats).toMatchObject({ marketCap: 123, trailingPE: 20, eps: 5, dividendYield: 0.01, beta: null, roe: null });
  });

  it("never overrides summary values", () => {
    const { stats } = summaryFromQuote(quote("XYZ"));
    const filled = fillStatsFromQuote({ ...stats, trailingPE: 30, beta: 1.2 }, base);
    expect(filled).toMatchObject({ trailingPE: 30, beta: 1.2, marketCap: 123, eps: 5 });
  });
});

describe("getStockDetail", () => {
  const appleQuote = quote("AAPL", { name: "Apple Inc.", marketCap: 4_000, trailingPE: null });
  const appleSummary = summaryFromQuote(quote("AAPL", { name: "Apple Inc." }));
  const profile: StockProfile = { ...appleSummary.profile, longName: "Apple Inc.", sector: "Technology", industry: "Consumer Electronics" };
  const stats: KeyStats = { ...appleSummary.stats, trailingPE: 31, beta: 1.1 };

  it("returns null for unknown symbols", async () => {
    yahoo.getQuote.mockResolvedValue(null);
    yahoo.getSummary.mockResolvedValue(null);
    expect(await getStockDetail("NOPE")).toBeNull();
    expect(news.getCompanyNews).not.toHaveBeenCalled();
  });

  it("combines quote and summary without waiting for news", async () => {
    yahoo.getQuote.mockResolvedValue(appleQuote);
    yahoo.getSummary.mockResolvedValue({ profile, stats });

    const detail = await getStockDetail("AAPL");

    expect(detail?.warnings).toEqual([]);
    expect(detail?.profile.industry).toBe("Consumer Electronics");
    expect(detail?.stats).toMatchObject({ trailingPE: 31, beta: 1.1, marketCap: 4_000 });
    expect(detail).not.toHaveProperty("news");
    expect(news.getCompanyNews).not.toHaveBeenCalled();
  });

  it("falls back to the quote when the summary is missing", async () => {
    yahoo.getQuote.mockResolvedValue(appleQuote);
    yahoo.getSummary.mockRejectedValue(new Error("quoteSummary failed"));

    const detail = await getStockDetail("AAPL");

    expect(detail?.warnings).toEqual(["summary"]);
    expect(detail?.profile).toMatchObject({ symbol: "AAPL", name: "Apple Inc.", industry: null });
    expect(detail?.stats.marketCap).toBe(4_000);
  });

  it("reports a bank's zero gross and EBITDA margins as not available", async () => {
    yahoo.getQuote.mockResolvedValue(quote("JPM", { name: "JPMorgan Chase & Co." }));
    yahoo.getSummary.mockResolvedValue({ profile, stats: { ...stats, grossMargin: 0, ebitdaMargin: 0, operatingMargin: 0.42 } });

    const detail = await getStockDetail("JPM");

    expect(detail?.stats).toMatchObject({ grossMargin: null, ebitdaMargin: null, operatingMargin: 0.42 });
  });

  it("throws when the quote cannot be loaded", async () => {
    yahoo.getQuote.mockRejectedValue(new Error("Yahoo down"));
    yahoo.getSummary.mockResolvedValue(null);
    await expect(getStockDetail("AAPL")).rejects.toThrow("Yahoo down");
  });
});

describe("getStockNews", () => {
  const appleQuote = quote("AAPL", { name: "Apple Inc." });
  const summary = summaryFromQuote(appleQuote);
  const profile: StockProfile = { ...summary.profile, longName: "Apple Inc.", industry: "Consumer Electronics" };

  it("returns null for unknown symbols without searching", async () => {
    yahoo.getQuote.mockResolvedValue(null);
    yahoo.getSummary.mockResolvedValue(null);
    expect(await getStockNews("NOPE")).toBeNull();
    expect(news.getCompanyNews).not.toHaveBeenCalled();
  });

  it("searches with the quote's name and the summary's profile, or the quote alone", async () => {
    yahoo.getQuote.mockResolvedValue(appleQuote);
    yahoo.getSummary.mockResolvedValue({ profile, stats: summary.stats });
    news.getCompanyNews.mockResolvedValue([newsItem]);
    expect(await getStockNews("AAPL")).toEqual([newsItem]);
    expect(news.getCompanyNews).toHaveBeenCalledWith("AAPL", "Apple Inc.", profile);

    yahoo.getSummary.mockRejectedValue(new Error("quoteSummary failed"));
    await getStockNews("AAPL");
    expect(news.getCompanyNews).toHaveBeenLastCalledWith("AAPL", "Apple Inc.", null);
  });

  it("tags a fund's, an index's or a currency pair's own headlines by its kind and keeps a stock's as company news", async () => {
    const own = { ...newsItem, id: "own", provenance: "company" as const };
    const macro = { ...newsItem, id: "ctx", provenance: "macro" as const };
    yahoo.getSummary.mockResolvedValue(null);
    news.getCompanyNews.mockResolvedValue([own, macro]);
    const tags = async (symbol: string, quoteType: string | null) => {
      yahoo.getQuote.mockResolvedValue(quote(symbol, { quoteType }));
      return (await getStockNews(symbol))?.map((item) => item.provenance);
    };
    expect(await tags("AAPL", "EQUITY")).toEqual(["company", "macro"]);
    expect(await tags("SPY", "ETF")).toEqual(["fund", "macro"]);
    expect(await tags("VFIAX", "MUTUALFUND")).toEqual(["fund", "macro"]);
    expect(await tags("^GSPC", "INDEX")).toEqual(["index", "macro"]);
    expect(await tags("EURUSD=X", "CURRENCY")).toEqual(["currency", "macro"]);
    expect(await tags("CL=F", "FUTURE")).toEqual(["futures", "macro"]);
    expect(await tags("BTC-USD", "CRYPTOCURRENCY")).toEqual(["crypto", "macro"]);
    expect(await tags("XYZ", null)).toEqual(["company", "macro"]);
  });

  it("names the tag of a symbol's own news after its quote type", () => {
    expect(ownNewsProvenance("EQUITY")).toBe("company");
    expect(ownNewsProvenance("ETF")).toBe("fund");
    expect(ownNewsProvenance("OPTION")).toBe("company");
    expect(ownNewsProvenance(null)).toBe("company");
  });

  it("throws when the quote or every search fails", async () => {
    yahoo.getQuote.mockRejectedValue(new Error("Yahoo down"));
    await expect(getStockNews("AAPL")).rejects.toThrow("Yahoo down");
    yahoo.getQuote.mockResolvedValue(appleQuote);
    yahoo.getSummary.mockResolvedValue(null);
    news.getCompanyNews.mockRejectedValue(new Error("All news searches failed"));
    await expect(getStockNews("AAPL")).rejects.toThrow("All news searches failed");
  });
});

describe("withApplicableMargins", () => {
  it("turns exact zero gross and EBITDA margins into null and keeps real values", () => {
    const stats = summaryFromQuote(quote("JPM")).stats;
    expect(withApplicableMargins({ ...stats, grossMargin: 0, ebitdaMargin: 0 })).toMatchObject({ grossMargin: null, ebitdaMargin: null });
    expect(withApplicableMargins({ ...stats, grossMargin: 0.47, ebitdaMargin: 0.36 })).toMatchObject({ grossMargin: 0.47, ebitdaMargin: 0.36 });
    expect(withApplicableMargins({ ...stats, ebitdaMargin: undefined }).ebitdaMargin).toBeNull();
  });
});

describe("getChartData", () => {
  const chart = chartData();
  const empty: ChartData = { ...chart, bars: [] };

  it("returns bars when Yahoo has them, without loading the quote", async () => {
    yahoo.getChart.mockResolvedValue(chart);
    yahoo.getQuote.mockResolvedValue(null);
    expect(await getChartData("AAPL", "1y")).toBe(chart);
    expect(yahoo.getQuote).not.toHaveBeenCalled();
  });

  it("returns null for unknown symbols", async () => {
    yahoo.getChart.mockRejectedValue(new Error("No data found"));
    yahoo.getQuote.mockResolvedValue(null);
    expect(await getChartData("NOPE", "1y")).toBeNull();

    yahoo.getChart.mockResolvedValue(empty);
    expect(await getChartData("NOPE", "1y")).toBeNull();
  });

  it("returns an empty chart for a known symbol without bars and throws on upstream failure", async () => {
    yahoo.getQuote.mockResolvedValue(quote("AAPL"));
    yahoo.getChart.mockResolvedValue(empty);
    expect(await getChartData("AAPL", "1mo")).toBe(empty);

    yahoo.getChart.mockRejectedValue(new Error("timeout"));
    await expect(getChartData("AAPL", "1mo")).rejects.toThrow("timeout");
  });
});

describe("route handlers", () => {
  /** Stands in for an internal error detail that must never reach the client. */
  const INTERNAL = "ECONNRESET 10.0.0.7:443";

  function request(path: string): Request {
    return new Request(`http://localhost${path}`);
  }

  function symbolParams(symbol: string): { params: Promise<{ symbol: string }> } {
    return { params: Promise.resolve({ symbol }) };
  }

  function expectCdnCache(response: Response, seconds: number): void {
    expect(response.headers.get("cache-control")).toMatch(new RegExp(`s-maxage=${seconds}(?!\\d)`));
  }

  async function expectError(response: Response, status: number, code: ApiErrorBody["error"]["code"]): Promise<void> {
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe(code);
    expect(body.error.message).not.toContain(INTERNAL);
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  describe("GET /api/market/overview", () => {
    it("caches briefly while the session trades and longer when it is closed", async () => {
      yahoo.getSparkline.mockResolvedValue([]);
      news.getMarketNews.mockResolvedValue([]);

      yahoo.getQuotes.mockResolvedValue(quoteMap([quote("^GSPC", { marketState: "REGULAR" })]));
      const open = await overviewRoute(request("/api/market/overview"));
      expect(open.status).toBe(200);
      expectCdnCache(open, 15);
      expect(((await open.json()) as MarketOverview).marketState).toBe("REGULAR");

      clearCache();
      yahoo.getQuotes.mockResolvedValue(quoteMap([quote("^GSPC", { marketState: "CLOSED" })]));
      expectCdnCache(await overviewRoute(request("/api/market/overview")), 60);
    });

    it("returns a generic 502 when no quotes can be loaded", async () => {
      yahoo.getSparkline.mockResolvedValue([]);
      news.getMarketNews.mockResolvedValue([]);
      yahoo.getQuotes.mockRejectedValue(new Error(INTERNAL));
      await expectError(await overviewRoute(request("/api/market/overview")), 502, "upstream_error");
    });
  });

  describe("GET /api/quotes", () => {
    it("rejects missing, invalid-only and oversized symbol lists", async () => {
      const tooMany = Array.from({ length: 51 }, (_, i) => `S${i}`).join(",");
      for (const path of ["/api/quotes", "/api/quotes?symbols=,%20,", "/api/quotes?symbols=not%20a%20symbol,$$$", `/api/quotes?symbols=${tooMany}`]) {
        await expectError(await quotesRoute(request(path)), 400, "bad_request");
      }
      expect(yahoo.getQuotes).not.toHaveBeenCalled();
    });

    it("returns quotes in request order and lists the symbols Yahoo did not return", async () => {
      yahoo.getQuotes.mockResolvedValue(quoteMap([quote("MSFT"), quote("AAPL")]));

      const response = await quotesRoute(request("/api/quotes?symbols=aapl,NOPE,msft,AAPL"));

      expect(yahoo.getQuotes).toHaveBeenCalledWith(["AAPL", "NOPE", "MSFT"]);
      expectCdnCache(response, 10);
      const body = (await response.json()) as QuotesResponse;
      expect(body.quotes.map((q) => q.symbol)).toEqual(["AAPL", "MSFT"]);
      expect(body.missing).toEqual(["NOPE"]);
    });

    it("maps an upstream failure to a generic 502", async () => {
      yahoo.getQuotes.mockRejectedValue(new Error(INTERNAL));
      await expectError(await quotesRoute(request("/api/quotes?symbols=AAPL")), 502, "upstream_error");
    });
  });

  describe("GET /api/sparklines", () => {
    it("returns an empty series for failed symbols and shortens the CDN cache", async () => {
      yahoo.getSparkline.mockImplementation(async (symbol) => {
        if (symbol === "MSFT") throw new Error("timeout");
        return [1, 2, 3];
      });
      const degraded = await sparklinesRoute(request("/api/sparklines?symbols=AAPL,msft"));
      expect(await degraded.json()).toEqual({ AAPL: [1, 2, 3], MSFT: [] });
      expectCdnCache(degraded, 30);

      yahoo.getSparkline.mockResolvedValue([4, 5]);
      expectCdnCache(await sparklinesRoute(request("/api/sparklines?symbols=AAPL")), 300);
    });

    it("validates the symbol list like /api/quotes", async () => {
      await expectError(await sparklinesRoute(request("/api/sparklines?symbols=")), 400, "bad_request");
      expect(yahoo.getSparkline).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/search", () => {
    it("rejects empty, oversized and control-character queries", async () => {
      for (const path of ["/api/search", "/api/search?q=", "/api/search?q=%20%20", `/api/search?q=${"x".repeat(41)}`, "/api/search?q=apple%0Ainc"]) {
        await expectError(await searchRoute(request(path)), 400, "bad_request");
      }
      expect(yahoo.searchSymbols).not.toHaveBeenCalled();
    });

    it("passes the trimmed query to Yahoo and lets the CDN cache it for an hour", async () => {
      const results: SymbolSearchResult[] = [{ symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", type: "EQUITY" }];
      yahoo.searchSymbols.mockResolvedValue(results);

      const response = await searchRoute(request("/api/search?q=%20apple%20"));

      expect(yahoo.searchSymbols).toHaveBeenCalledWith("apple");
      expectCdnCache(response, 3600);
      expect(await response.json()).toEqual({ results });
    });
  });

  describe("GET /api/news", () => {
    it("accepts only the sector keys of lib/universe.ts", async () => {
      for (const path of ["/api/news", "/api/news?sector=crypto", "/api/news?sector=Energy"]) {
        await expectError(await newsRoute(request(path)), 400, "bad_request");
      }
      expect(news.getSectorNews).not.toHaveBeenCalled();
    });

    it("returns the sector's news", async () => {
      news.getSectorNews.mockResolvedValue([newsItem]);

      const response = await newsRoute(request("/api/news?sector=energy"));

      expect(news.getSectorNews).toHaveBeenCalledWith("energy");
      expectCdnCache(response, 120);
      expect(((await response.json()) as NewsResponse).news).toEqual([newsItem]);
    });

    it("maps an upstream failure to a generic 502", async () => {
      news.getSectorNews.mockRejectedValue(new Error(INTERNAL));
      await expectError(await newsRoute(request("/api/news?sector=energy")), 502, "upstream_error");
    });
  });

  describe("GET /api/stock/[symbol]", () => {
    it("rejects malformed symbols and returns 404 for unknown ones", async () => {
      await expectError(await stockRoute(request("/api/stock/x"), symbolParams("not a symbol")), 400, "bad_request");
      expect(yahoo.getQuote).not.toHaveBeenCalled();

      yahoo.getQuote.mockResolvedValue(null);
      yahoo.getSummary.mockResolvedValue(null);
      await expectError(await stockRoute(request("/api/stock/zzzz"), symbolParams("zzzz")), 404, "not_found");
    });

    it("normalizes the symbol and sets the CDN cache from the quote's session", async () => {
      yahoo.getQuote.mockResolvedValue(quote("^GSPC", { name: "S&P 500", quoteType: "INDEX", marketState: "REGULAR" }));
      yahoo.getSummary.mockResolvedValue(null);
      news.getCompanyNews.mockResolvedValue([]);

      const response = await stockRoute(request("/api/stock/%5Egspc"), symbolParams("%5Egspc"));

      expect(yahoo.getQuote).toHaveBeenCalledWith("^GSPC");
      expect(response.status).toBe(200);
      expectCdnCache(response, 15);
      const body = (await response.json()) as StockDetail;
      expect(body.quote.symbol).toBe("^GSPC");
      expect(body.warnings).toEqual(["summary"]);
    });

    it("maps an upstream failure to a generic 502", async () => {
      yahoo.getQuote.mockRejectedValue(new Error(INTERNAL));
      yahoo.getSummary.mockResolvedValue(null);
      await expectError(await stockRoute(request("/api/stock/AAPL"), symbolParams("AAPL")), 502, "upstream_error");
    });
  });

  describe("GET /api/stock/[symbol]/news", () => {
    it("rejects malformed symbols and returns 404 for unknown ones", async () => {
      await expectError(await stockNewsRoute(request("/api/stock/x/news"), symbolParams("not a symbol")), 400, "bad_request");
      yahoo.getQuote.mockResolvedValue(null);
      yahoo.getSummary.mockResolvedValue(null);
      await expectError(await stockNewsRoute(request("/api/stock/zzzz/news"), symbolParams("zzzz")), 404, "not_found");
    });

    it("returns the company feed with a CDN cache and maps a failure to a generic 502", async () => {
      yahoo.getQuote.mockResolvedValue(quote("AAPL", { name: "Apple Inc." }));
      yahoo.getSummary.mockResolvedValue(null);
      news.getCompanyNews.mockResolvedValue([newsItem]);
      const response = await stockNewsRoute(request("/api/stock/aapl/news"), symbolParams("aapl"));
      expect(response.status).toBe(200);
      expectCdnCache(response, 300);
      expect(((await response.json()) as NewsResponse).news).toEqual([newsItem]);

      news.getCompanyNews.mockRejectedValue(new Error(INTERNAL));
      await expectError(await stockNewsRoute(request("/api/stock/AAPL/news"), symbolParams("AAPL")), 502, "upstream_error");
    });
  });

  describe("GET /api/stock/[symbol]/chart", () => {
    const chart = chartData();

    it("defaults to one year and rejects unknown ranges", async () => {
      yahoo.getChart.mockResolvedValue(chart);
      yahoo.getQuote.mockResolvedValue(quote("AAPL"));

      for (const path of ["/api/stock/AAPL/chart", "/api/stock/AAPL/chart?range="]) {
        const response = await chartRoute(request(path), symbolParams("AAPL"));
        expect(response.status).toBe(200);
        expectCdnCache(response, 60);
        expect(await response.json()).toEqual(chart);
      }
      expect(yahoo.getChart.mock.calls.map(([, range]) => range)).toEqual(["1y", "1y"]);

      await expectError(await chartRoute(request("/api/stock/AAPL/chart?range=10y"), symbolParams("AAPL")), 400, "bad_request");
    });

    it("accepts the intraday ranges and keeps them in the shared cache for less time", async () => {
      yahoo.getChart.mockResolvedValue(chartData({ range: "1d", interval: "5m", intraday: true }));
      const response = await chartRoute(request("/api/stock/AAPL/chart?range=1d"), symbolParams("AAPL"));
      expect(response.status).toBe(200);
      expectCdnCache(response, 30);
      expect(yahoo.getChart).toHaveBeenLastCalledWith("AAPL", "1d");
    });

    it("returns 404 for unknown symbols and a generic 502 when Yahoo fails", async () => {
      yahoo.getChart.mockRejectedValue(new Error(INTERNAL));
      yahoo.getQuote.mockResolvedValue(null);
      await expectError(await chartRoute(request("/api/stock/ZZZZ/chart"), symbolParams("ZZZZ")), 404, "not_found");

      yahoo.getQuote.mockResolvedValue(quote("AAPL"));
      await expectError(await chartRoute(request("/api/stock/AAPL/chart"), symbolParams("AAPL")), 502, "upstream_error");
    });
  });
});
