import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NewsItem, Quote } from "@/types/api";
import { MARKET_BOARD, SECTORS, UNIVERSE_STOCKS } from "@/lib/universe";

// The overview's breadth figures, its symbol set and its slim rows. The rest of the overview is covered in market.test.ts.

vi.mock("server-only", () => ({}));

const yahoo = vi.hoisted(() => ({
  getQuotes: vi.fn<(symbols: string[]) => Promise<Map<string, Quote>>>(),
  getQuote: vi.fn(),
  getSparkline: vi.fn<(symbol: string) => Promise<number[]>>(),
  getSummary: vi.fn(),
  getChart: vi.fn(),
}));
const news = vi.hoisted(() => ({
  getMarketNews: vi.fn<() => Promise<NewsItem[]>>(),
  getCompanyNews: vi.fn(),
}));
vi.mock("./yahoo", () => yahoo);
vi.mock("./news", () => news);

import { clearCache } from "./cache";
import { computeBreadth, getMarketOverview, NEAR_EXTREME, OVERVIEW_SYMBOLS, slimQuote } from "./market";

function quote(symbol: string, overrides: Partial<Quote> = {}): Quote {
  return {
    symbol,
    name: `${symbol} Inc.`,
    quoteType: "EQUITY",
    currency: "USD",
    exchange: "NasdaqGS",
    marketState: "CLOSED",
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

beforeEach(() => {
  clearCache();
  for (const mock of [...Object.values(yahoo), ...Object.values(news)]) mock.mockReset();
});

describe("OVERVIEW_SYMBOLS", () => {
  it("covers the board, the universe and the breadth references in one batch, without the sector ETFs", () => {
    expect(OVERVIEW_SYMBOLS.length).toBeLessThanOrEqual(100);
    for (const symbol of [...MARKET_BOARD.map((b) => b.symbol), ...UNIVERSE_STOCKS, "RSP", "SPY"]) expect(OVERVIEW_SYMBOLS).toContain(symbol);
    for (const sector of SECTORS) expect(OVERVIEW_SYMBOLS).not.toContain(sector.etf);
  });
});

describe("slimQuote", () => {
  it("keeps only what the heatmap, the sector tables and the movers show", () => {
    const full = quote("NVDA", { price: 186.64, change: 5.05, changePercent: 2.78, volume: 2e8, avgVolume: 1.8e8, marketCap: 4.5e12, trailingPE: 52, fiftyTwoWeekHigh: 212, fiftyTwoWeekLow: 86 });
    expect(slimQuote(full)).toEqual({
      symbol: "NVDA",
      name: "NVDA Inc.",
      price: 186.64,
      change: 5.05,
      changePercent: 2.78,
      volume: 2e8,
      avgVolume: 1.8e8,
      marketCap: 4.5e12,
      trailingPE: 52,
      fiftyTwoWeekHigh: 212,
      fiftyTwoWeekLow: 86,
    });
  });
});

describe("computeBreadth", () => {
  const [tech, comm] = SECTORS;

  it("counts advancers, decliners and unchanged stocks, skipping missing changes", () => {
    const quotes = quoteMap([
      quote(tech.stocks[0], { changePercent: 1.2 }),
      quote(tech.stocks[1], { changePercent: -0.4 }),
      quote(tech.stocks[2], { changePercent: 0 }),
      quote(comm.stocks[0], { changePercent: null }),
      quote(comm.stocks[1], { changePercent: 3 }),
      // Not in the universe: ignored.
      quote("^GSPC", { changePercent: 5 }),
    ]);
    const breadth = computeBreadth(quotes);
    expect(breadth).toMatchObject({ stocks: 5, advancers: 2, decliners: 1, unchanged: 1 });
    expect(breadth?.sectors[0]).toMatchObject({ key: tech.key, advancers: 1, decliners: 1 });
    expect(breadth?.sectors[1]).toMatchObject({ key: comm.key, advancers: 1, decliners: 0 });
    expect(breadth?.sectors.map((s) => s.key)).toEqual(SECTORS.map((s) => s.key));
  });

  it("counts stocks above their averages out of those with the data", () => {
    const quotes = quoteMap([
      quote(tech.stocks[0], { price: 110, fiftyDayAverage: 100, twoHundredDayAverage: 120 }),
      quote(tech.stocks[1], { price: 90, fiftyDayAverage: 100, twoHundredDayAverage: 80 }),
      quote(tech.stocks[2], { price: 100, fiftyDayAverage: 100, twoHundredDayAverage: null }),
      quote(comm.stocks[0], { price: null, fiftyDayAverage: 100, twoHundredDayAverage: 100 }),
    ]);
    const breadth = computeBreadth(quotes);
    expect(breadth?.above50d).toEqual({ count: 1, of: 3 });
    expect(breadth?.above200d).toEqual({ count: 1, of: 2 });
    expect(breadth?.sectors[0].above50d).toEqual({ count: 1, of: 3 });
    expect(breadth?.sectors[1].above50d).toEqual({ count: 0, of: 0 });
  });

  it("counts stocks within the threshold of a 52-week extreme", () => {
    const quotes = quoteMap([
      quote(tech.stocks[0], { price: 97, fiftyTwoWeekHigh: 100, fiftyTwoWeekLow: 50 }),
      quote(tech.stocks[1], { price: 96.9, fiftyTwoWeekHigh: 100, fiftyTwoWeekLow: 50 }),
      quote(tech.stocks[2], { price: 51.5, fiftyTwoWeekHigh: 100, fiftyTwoWeekLow: 50 }),
      quote(tech.stocks[3], { price: 51.6, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: 50 }),
    ]);
    const breadth = computeBreadth(quotes);
    expect(NEAR_EXTREME).toBe(0.03);
    expect(breadth?.nearExtreme).toBe(0.03);
    expect(breadth?.nearHigh).toEqual({ count: 1, of: 3 });
    expect(breadth?.nearLow).toEqual({ count: 1, of: 4 });
  });

  it("compares the equal-weight and cap-weighted S&P 500 ETFs", () => {
    const breadth = computeBreadth(quoteMap([quote(tech.stocks[0]), quote("RSP", { changePercent: -0.38 }), quote("SPY", { changePercent: 0.31 })]));
    expect(breadth?.equalWeight).toBe(-0.38);
    expect(breadth?.capWeight).toBe(0.31);
    expect(computeBreadth(quoteMap([quote(tech.stocks[0])]))).toMatchObject({ equalWeight: null, capWeight: null });
  });

  it("is null without any universe quote", () => {
    expect(computeBreadth(quoteMap([quote("RSP"), quote("SPY")]))).toBeNull();
  });
});

describe("getMarketOverview breadth", () => {
  it("adds the breadth of the batch to the overview", async () => {
    const quotes = quoteMap([
      ...UNIVERSE_STOCKS.map((symbol, i) => quote(symbol, { changePercent: i % 2 === 0 ? 1 : -1, fiftyDayAverage: 90, twoHundredDayAverage: 110 })),
      quote("RSP", { changePercent: 0.1 }),
      quote("SPY", { changePercent: 0.2 }),
    ]);
    yahoo.getQuotes.mockResolvedValue(quotes);
    yahoo.getSparkline.mockResolvedValue([]);
    news.getMarketNews.mockResolvedValue([]);

    const overview = await getMarketOverview();
    expect(overview.breadth?.stocks).toBe(UNIVERSE_STOCKS.length);
    expect(overview.breadth?.above50d).toEqual({ count: UNIVERSE_STOCKS.length, of: UNIVERSE_STOCKS.length });
    expect(overview.breadth?.above200d.count).toBe(0);
    expect(overview.breadth?.equalWeight).toBe(0.1);
    expect(overview.movers.gainers.length).toBeLessThanOrEqual(8);
    expect(Object.keys(overview.movers.gainers[0])).not.toContain("quoteType");
  });
});
