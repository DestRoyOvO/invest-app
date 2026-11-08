import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { clearCache } from "./cache";
import { uncachedQuoteCalls } from "./charging";
import {
  analystRating,
  announcedDividend,
  displayName,
  earningsDates,
  getQuotes,
  getSummary,
  getUpstreamStats,
  hasCachedNewsSearch,
  hasCachedSummary,
  hasFreshQuote,
  isYahooAnswer,
  mapQuote,
  mapSummary,
  peekQuote,
  peekSummary,
  resetUpstreamStats,
  searchNews,
  searchSymbols,
  upstream,
  UpstreamBusyError,
  withoutPlaceholderPrices,
  yf,
} from "./yahoo";

const NOW = Date.parse("2026-11-07T15:00:00Z");

describe("earningsDates", () => {
  it("splits the timestamps into the next report and the last one", () => {
    // Apple-like: the last report in earningsTimestamp, the next (estimated) one in Start/End.
    expect(
      earningsDates(
        {
          earningsTimestamp: new Date("2026-11-02T21:00:00Z"),
          earningsTimestampStart: new Date("2027-01-28T21:00:00Z"),
          earningsTimestampEnd: new Date("2027-01-28T21:00:00Z"),
        },
        NOW,
      ),
    ).toEqual({ next: "2027-01-28T21:00:00.000Z", last: "2026-11-02T21:00:00.000Z" });
  });

  it("handles only future, only past, epoch seconds and missing dates", () => {
    expect(earningsDates({ earningsTimestamp: 1_799_933_400 }, NOW)).toEqual({ next: "2027-01-14T13:30:00.000Z", last: null });
    expect(earningsDates({ earningsTimestampStart: "2026-10-27T12:30:00Z" }, NOW)).toEqual({ next: null, last: "2026-10-27T12:30:00.000Z" });
    expect(earningsDates({}, NOW)).toEqual({ next: null, last: null });
  });

  it("takes the earliest future date when Yahoo gives a window", () => {
    const dates = earningsDates({ earningsTimestampStart: "2027-02-01T21:00:00Z", earningsTimestampEnd: "2027-02-05T21:00:00Z" }, NOW);
    expect(dates.next).toBe("2027-02-01T21:00:00.000Z");
  });
});

describe("announcedDividend", () => {
  const action = (dateEpochMs: number, amount: unknown, eventType = "DIVIDEND") => ({
    header: "Dividend",
    message: "announced a cash dividend",
    meta: { eventType, dateEpochMs, amount },
  });

  it("reads the ex-date and amount of an announced cash dividend", () => {
    expect(announcedDividend([action(1_794_459_600_000, "0.27")])).toEqual({ exDate: "2026-11-12T05:00:00.000Z", amount: 0.27 });
  });

  it("accepts the JSON-string form, keeps the latest ex-date and skips other events", () => {
    const json = JSON.stringify([action(1_794_459_600_000, "0.27"), action(1_802_235_600_000, "0.28"), action(1_810_000_000_000, null, "DELISTING")]);
    expect(announcedDividend(json)).toEqual({ exDate: "2027-02-10T05:00:00.000Z", amount: 0.28 });
  });

  it("returns null for missing or malformed data and drops a bad amount", () => {
    expect(announcedDividend(undefined)).toBeNull();
    expect(announcedDividend("not json")).toBeNull();
    expect(announcedDividend([{ meta: { eventType: "DIVIDEND" } }])).toBeNull();
    expect(announcedDividend([action(1_794_459_600_000, "n/a")])).toEqual({ exDate: "2026-11-12T05:00:00.000Z", amount: null });
  });
});

describe("analystRating", () => {
  it("parses Yahoo's rating text and rejects values outside 1-5", () => {
    expect(analystRating("2.3 - Buy")).toBe(2.3);
    expect(analystRating(1.7)).toBe(1.7);
    expect(analystRating("n/a")).toBeNull();
    expect(analystRating("7 - ?")).toBeNull();
    expect(analystRating(undefined)).toBeNull();
  });
});

describe("displayName", () => {
  it("takes the long name when Yahoo cut the short one", () => {
    expect(displayName("State Street SPDR S&P 500 ETF T", "State Street SPDR S&P 500 ETF Trust")).toBe("State Street SPDR S&P 500 ETF Trust");
    // Yahoo can cut at a space, which str() trims.
    expect(displayName("State Street Technology Select ", "State Street Technology Select Sector SPDR ETF")).toBe("State Street Technology Select Sector SPDR ETF");
    expect(displayName("Taiwan Semiconductor Manufactur", "Taiwan Semiconductor Manufacturing Company Limited")).toBe("Taiwan Semiconductor Manufacturing Company Limited");
  });

  it("takes the shorter long name when the cut short name runs past it", () => {
    expect(displayName("Booking Holdings Inc. Common St", "Booking Holdings Inc.")).toBe("Booking Holdings Inc.");
    expect(displayName("Duke Energy Corporation (Holdin", "Duke Energy Corporation")).toBe("Duke Energy Corporation");
    expect(displayName("American Tower Corporation (REI", "American Tower Corporation")).toBe("American Tower Corporation");
    // Short names under the cut stay, even when they extend the long name.
    expect(displayName("Invesco QQQ Trust, Series 1", "Invesco QQQ Trust")).toBe("Invesco QQQ Trust, Series 1");
    // A long name that ends inside a word of the short one is a different name.
    expect(displayName("Exampleco Worldwide Holdings Co", "Example")).toBe("Exampleco Worldwide Holdings Co");
  });

  it("drops a trailing New share-class marker the long name does not have", () => {
    expect(displayName("Berkshire Hathaway Inc. New", "Berkshire Hathaway Inc.")).toBe("Berkshire Hathaway Inc.");
    expect(displayName("Example Holdings New", "Example Holdings New")).toBe("Example Holdings New");
    // Without a long name to compare with, the short name stays as it is.
    expect(displayName("Berkshire Hathaway Inc. New", undefined)).toBe("Berkshire Hathaway Inc. New");
  });

  it("keeps the short name otherwise and falls back to whichever name exists", () => {
    expect(displayName("Invesco QQQ Trust, Series 1", "Invesco QQQ Trust")).toBe("Invesco QQQ Trust, Series 1");
    expect(displayName("JP Morgan Chase & Co.", "JPMorgan Chase & Co.")).toBe("JP Morgan Chase & Co.");
    expect(displayName("Apple Inc.", "Apple Inc.")).toBe("Apple Inc.");
    expect(displayName(null, "Apple Inc.")).toBe("Apple Inc.");
    expect(displayName("  ", {})).toBeNull();
  });
});

describe("mapQuote", () => {
  it("shows the full name of funds whose short name Yahoo cut, and Berkshire without the share-class marker", () => {
    expect(mapQuote({ symbol: "SPY", shortName: "State Street SPDR S&P 500 ETF T", longName: "State Street SPDR S&P 500 ETF Trust" }).name).toBe(
      "State Street SPDR S&P 500 ETF Trust",
    );
    expect(mapQuote({ symbol: "BRK-B", shortName: "Berkshire Hathaway Inc. New", longName: "Berkshire Hathaway Inc." }).name).toBe("Berkshire Hathaway Inc.");
    expect(mapQuote({ symbol: "BKNG", shortName: "Booking Holdings Inc. Common St", longName: "Booking Holdings Inc." }).name).toBe("Booking Holdings Inc.");
    expect(mapQuote({ symbol: "ES=F", displayName: "E-Mini S&P 500" }).name).toBe("E-Mini S&P 500");
    expect(mapQuote({ symbol: "XYZ" }).name).toBe("XYZ");
  });

  it("maps averages, valuation, dividends and fund fields with the documented units", () => {
    const quote = mapQuote({
      symbol: "KO",
      shortName: "Coca-Cola",
      regularMarketPrice: 95.7,
      fiftyDayAverage: 89.94,
      twoHundredDayAverage: 82.74,
      fiftyTwoWeekChangePercent: 35.66,
      priceToBook: 11.01,
      epsForward: 3.53,
      dividendRate: 2.12,
      dividendYield: 2.22,
      averageAnalystRating: "1.7 - Buy",
      sharesOutstanding: 4_301_902_335,
      dividendDate: new Date("2026-12-15T00:00:00Z"),
      earningsTimestamp: new Date("2099-01-01T12:30:00Z"),
      isEarningsDateEstimate: true,
      netExpenseRatio: 0.0945,
      netAssets: 7.9e11,
      ytdReturn: 11.69,
    });
    expect(quote).toMatchObject({
      fiftyDayAverage: 89.94,
      twoHundredDayAverage: 82.74,
      fiftyTwoWeekChangePercent: 35.66,
      priceToBook: 11.01,
      forwardEps: 3.53,
      dividendRate: 2.12,
      dividendYield: 0.0222,
      analystRating: 1.7,
      sharesOutstanding: 4_301_902_335,
      dividendDate: "2026-12-15T00:00:00.000Z",
      nextEarningsDate: "2099-01-01T12:30:00.000Z",
      earningsDateEstimated: true,
      netAssets: 7.9e11,
      ytdReturnPercent: 11.69,
    });
    expect(quote.expenseRatio).toBeCloseTo(0.000945);
  });

  it("maps Yahoo's placeholder zeros to null: a yield's open, day range and 52-week low, volume where none is reported", () => {
    // ^TNX, ^VIX, EURUSD=X, GC=F, AAPL and SPY as Yahoo quoted them on 2026-11-07.
    const tnx = mapQuote({
      symbol: "^TNX",
      quoteType: "INDEX",
      regularMarketPrice: 4.859,
      regularMarketPreviousClose: 4.837,
      regularMarketOpen: 0,
      regularMarketDayLow: 0,
      regularMarketDayHigh: 0,
      fiftyTwoWeekLow: 0,
      fiftyTwoWeekHigh: 5.364,
      regularMarketVolume: 0,
      averageDailyVolume3Month: 0,
    });
    expect(tnx).toMatchObject({ price: 4.859, previousClose: 4.837, open: null, dayLow: null, dayHigh: null, fiftyTwoWeekLow: null, fiftyTwoWeekHigh: 5.364, volume: null, avgVolume: null });
    expect(mapQuote({ symbol: "^VIX", quoteType: "INDEX", regularMarketOpen: 27.68, regularMarketVolume: 0, averageDailyVolume3Month: 0 })).toMatchObject({ open: 27.68, volume: null, avgVolume: null });
    expect(mapQuote({ symbol: "^GSPC", quoteType: "INDEX", regularMarketVolume: 3_410_452_000 }).volume).toBe(3_410_452_000);
    expect(mapQuote({ symbol: "EURUSD=X", quoteType: "CURRENCY", regularMarketVolume: 0, averageDailyVolume3Month: 0 })).toMatchObject({ volume: null, avgVolume: null });
    expect(mapQuote({ symbol: "GC=F", quoteType: "FUTURE", regularMarketVolume: 166_431 }).volume).toBe(166_431);
    // A stock or an ETF can trade nothing (before the open, halted): its zero is a volume.
    expect(mapQuote({ symbol: "AAPL", quoteType: "EQUITY", regularMarketVolume: 0, regularMarketOpen: 338.73 })).toMatchObject({ volume: 0, open: 338.73 });
    expect(mapQuote({ symbol: "SPY", quoteType: "ETF", regularMarketVolume: 0 }).volume).toBe(0);
    // Negative prices are real (WTI, April 2020).
    expect(mapQuote({ symbol: "CL=F", quoteType: "FUTURE", regularMarketDayLow: -40.32, regularMarketPreviousClose: 18.27 })).toMatchObject({ dayLow: -40.32, previousClose: 18.27 });
  });

  it("recomputes a change Yahoo derived from a placeholder price of 0", () => {
    // ^TNX as Yahoo quoted it on 2026-11-08 from about 06:55 UTC: change -4.837 (minus the previous close), -49.89%.
    const tnx = mapQuote({ symbol: "^TNX", quoteType: "INDEX", regularMarketPrice: 4.859, regularMarketPreviousClose: 4.837, regularMarketChange: -4.837, regularMarketChangePercent: -49.886547 });
    expect(tnx.change).toBeCloseTo(0.022, 10);
    expect(tnx.changePercent).toBeCloseTo(0.4548, 4);
    const aapl = mapQuote({ symbol: "AAPL", quoteType: "EQUITY", regularMarketPrice: 342.37, regularMarketPreviousClose: 344.17, regularMarketChange: -1.80002, regularMarketChangePercent: -0.523 });
    expect(aapl).toMatchObject({ change: -1.80002, changePercent: -0.523 });
  });

  it("leaves the new fields null when Yahoo omits them", () => {
    const quote = mapQuote({ symbol: "^GSPC", regularMarketPrice: 7000 });
    expect(quote).toMatchObject({
      fiftyDayAverage: null,
      analystRating: null,
      nextEarningsDate: null,
      earningsDateEstimated: null,
      lastEarningsDate: null,
      dividendDate: null,
      expenseRatio: null,
      ytdReturnPercent: null,
    });
  });
});

describe("mapSummary", () => {
  it("names the profile like the quote and keeps Yahoo's long name", () => {
    const { profile } = mapSummary("BRK-B", { price: { shortName: "Berkshire Hathaway Inc. New", longName: "Berkshire Hathaway Inc." } });
    expect(profile).toMatchObject({ name: "Berkshire Hathaway Inc.", longName: "Berkshire Hathaway Inc." });
    expect(mapSummary("SPY", { price: { shortName: "State Street SPDR S&P 500 ETF T", longName: "State Street SPDR S&P 500 ETF Trust" } }).profile.name).toBe(
      "State Street SPDR S&P 500 ETF Trust",
    );
    expect(mapSummary("ZZZ", {}).profile.name).toBe("ZZZ");
  });

  it("drops the placeholder zeros the summary repeats from the quote", () => {
    const tnx = mapSummary("^TNX", { price: { quoteType: "INDEX" }, summaryDetail: { fiftyTwoWeekLow: 0, fiftyTwoWeekHigh: 5.364, averageVolume: 0 } });
    expect(tnx.stats).toMatchObject({ fiftyTwoWeekLow: null, fiftyTwoWeekHigh: 5.364, avgVolume: null });
    const aapl = mapSummary("AAPL", { price: { quoteType: "EQUITY" }, summaryDetail: { fiftyTwoWeekLow: 243.42, averageVolume: 42_880_493 } });
    expect(aapl.stats).toMatchObject({ fiftyTwoWeekLow: 243.42, avgVolume: 42_880_493 });
  });
});

describe("withoutPlaceholderPrices", () => {
  it("falls back to the close for an open, high or low of 0 and leaves real bars alone", () => {
    const real = { t: 1, o: 4.874, h: 4.903, l: 4.814, c: 4.859, v: 0 };
    expect(withoutPlaceholderPrices(real)).toBe(real);
    expect(withoutPlaceholderPrices({ t: 2, o: 0, h: 0, l: 0, c: 4.859, v: 0 })).toEqual({ t: 2, o: 4.859, h: 4.859, l: 4.859, c: 4.859, v: 0 });
    expect(withoutPlaceholderPrices({ t: 3, o: 4.9, h: 0, l: 0, c: 4.859, v: null })).toEqual({ t: 3, o: 4.9, h: 4.9, l: 4.859, c: 4.859, v: null });
  });
});

describe("getQuotes when Yahoo fails", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    clearCache();
  });

  it("serves the last quote marked stale, with its original fetch time, until the stale window ends", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T15:00:00Z"));
    const quoteSpy = vi.spyOn(yf, "quote");
    quoteSpy.mockResolvedValueOnce([{ symbol: "STALE1", regularMarketPrice: 10, marketState: "CLOSED" }] as never);

    const fresh = (await getQuotes(["STALE1"])).get("STALE1");
    expect(fresh).toMatchObject({ price: 10, stale: false, fetchedAt: "2026-11-07T15:00:00.000Z" });

    // Closed-market quotes are cached for 5 minutes; after that a refresh is attempted and fails.
    vi.setSystemTime(new Date("2026-11-07T15:06:00Z"));
    quoteSpy.mockRejectedValueOnce(new Error("Yahoo down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stale = (await getQuotes(["STALE1"])).get("STALE1");
    expect(stale).toMatchObject({ price: 10, stale: true, fetchedAt: "2026-11-07T15:00:00.000Z" });
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      level: "warn",
      event: "yahoo.stale_served",
      count: 1,
      oldestFetchedAt: "2026-11-07T15:00:00.000Z",
    });

    // Beyond the one-hour stale window nothing is left to serve.
    vi.setSystemTime(new Date("2026-11-07T16:10:00Z"));
    quoteSpy.mockRejectedValueOnce(new Error("Yahoo down"));
    await expect(getQuotes(["STALE1"])).rejects.toThrow("Yahoo down");
  });
});

describe("searchSymbols", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearCache();
  });

  it("never sends Chinese or symbol-only text to Yahoo", async () => {
    const searchSpy = vi.spyOn(yf, "search");
    expect(await searchSymbols("苹果")).toEqual([]);
    expect(await searchSymbols("英伟达 nvda")).toEqual([]);
    expect(await searchSymbols("&&")).toEqual([]);
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it("treats Yahoo's invalid-query error as no results but rethrows outages", async () => {
    const searchSpy = vi.spyOn(yf, "search");
    const invalid = Object.assign(new Error("Invalid Search Query"), { name: "BadRequestError" });
    searchSpy.mockRejectedValueOnce(invalid as never);
    expect(await searchSymbols("zz~weird")).toEqual([]);
    searchSpy.mockRejectedValueOnce(new Error("fetch failed") as never);
    await expect(searchSymbols("apple")).rejects.toThrow("fetch failed");
  });
});

describe("upstream", () => {
  afterEach(() => resetUpstreamStats());

  it("tracks pending calls and the outcome of each call", async () => {
    let release: () => void = () => undefined;
    const running = upstream(() => new Promise<string>((resolve) => (release = () => resolve("done"))));
    expect(getUpstreamStats().pending).toBe(1);
    release();
    expect(await running).toBe("done");
    expect(getUpstreamStats()).toMatchObject({ pending: 0, consecutiveFailures: 0, failingSince: null });
    expect(getUpstreamStats().lastSuccessAt).not.toBeNull();

    await expect(upstream(() => Promise.reject(new Error("fetch failed")))).rejects.toThrow("fetch failed");
    await expect(upstream(() => Promise.reject(new Error("fetch failed")))).rejects.toThrow("fetch failed");
    expect(getUpstreamStats()).toMatchObject({ pending: 0, consecutiveFailures: 2 });
    expect(getUpstreamStats().failingSince).not.toBeNull();
  });

  it("fails fast once 200 calls are pending, without counting that as a Yahoo failure", async () => {
    const releases: Array<() => void> = [];
    const calls = Array.from({ length: 200 }, () => upstream(() => new Promise<void>((resolve) => releases.push(resolve))));
    await expect(upstream(() => Promise.resolve("late"))).rejects.toBeInstanceOf(UpstreamBusyError);
    expect(getUpstreamStats().consecutiveFailures).toBe(0);
    for (const release of releases) release();
    await Promise.all(calls);
    expect(getUpstreamStats().pending).toBe(0);
  });
});

describe("isYahooAnswer", () => {
  it("separates Yahoo's answers about a request from outages", () => {
    expect(isYahooAnswer(new Error("No data found, symbol may be delisted"))).toBe(true);
    expect(isYahooAnswer(new Error("Quote not found for symbol: ZZZZ"))).toBe(true);
    expect(isYahooAnswer(Object.assign(new Error("Invalid Search Query"), { name: "BadRequestError" }))).toBe(true);
    // An HTTP error page that happens to say "not found" is a broken endpoint, not an answer.
    expect(isYahooAnswer(Object.assign(new Error("<html>404 Not Found: No data found</html>"), { name: "HTTPError" }))).toBe(false);
    expect(isYahooAnswer(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))).toBe(false);
    expect(isYahooAnswer("No data found")).toBe(false);
  });
});

describe("cache probes for rate-limit charging", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    clearCache();
  });

  it("knows when a quote is fresh and keeps the last one for its name", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T15:00:00Z"));
    expect(hasFreshQuote("PROBE1")).toBe(false);
    vi.spyOn(yf, "quote").mockResolvedValueOnce([{ symbol: "PROBE1", shortName: "Probe Inc.", regularMarketPrice: 5, marketState: "CLOSED" }] as never);
    await getQuotes(["PROBE1"]);
    expect(hasFreshQuote("PROBE1")).toBe(true);
    expect(peekQuote("PROBE1")?.name).toBe("Probe Inc.");
    // Closed-market quotes are fresh for 5 minutes.
    vi.setSystemTime(new Date("2026-11-07T15:06:00Z"));
    expect(hasFreshQuote("PROBE1")).toBe(false);
    expect(peekQuote("PROBE1")?.name).toBe("Probe Inc.");
  });

  it("predicts the batched quote requests getQuotes sends, 100 symbols at a time", async () => {
    const symbols = Array.from({ length: 178 }, (_, i) => `BATCH${i}`);
    const quote = vi
      .spyOn(yf, "quote")
      .mockImplementation((async (batch: string[]) => batch.map((symbol) => ({ symbol, regularMarketPrice: 1, marketState: "CLOSED" }))) as never);
    expect(uncachedQuoteCalls(symbols)).toBe(2);
    await getQuotes(symbols);
    expect(quote).toHaveBeenCalledTimes(2);
    expect(uncachedQuoteCalls(symbols)).toBe(0);
    expect(uncachedQuoteCalls([...symbols.slice(0, 3), "BATCHNEW", "BATCHNEW"])).toBe(1);
  });

  it("keeps Yahoo's answer that it does not know a symbol as a fresh null", async () => {
    expect(peekQuote("PROBE3")).toBeUndefined();
    vi.spyOn(yf, "quote").mockResolvedValueOnce([] as never);
    expect((await getQuotes(["PROBE3"])).size).toBe(0);
    expect(hasFreshQuote("PROBE3")).toBe(true);
    expect(peekQuote("PROBE3")).toBeNull();
  });

  it("probes the summary and news caches under the getters' own keys", async () => {
    vi.spyOn(yf, "quoteSummary").mockResolvedValueOnce({ price: { shortName: "Probe" }, assetProfile: { industry: "Semiconductors" } } as never);
    expect(hasCachedSummary("PROBE2")).toBe(false);
    expect(peekSummary("PROBE2")).toBeUndefined();
    await getSummary("PROBE2");
    expect(hasCachedSummary("PROBE2")).toBe(true);
    expect(peekSummary("PROBE2")?.profile.industry).toBe("Semiconductors");

    vi.spyOn(yf, "search").mockResolvedValueOnce({ news: [] } as never);
    expect(hasCachedNewsSearch(" Chip Stocks ", 5)).toBe(false);
    await searchNews("chip stocks", 5);
    expect(hasCachedNewsSearch(" Chip Stocks ", 5)).toBe(true);
    expect(hasCachedNewsSearch("chip stocks")).toBe(false);
    expect(hasCachedNewsSearch("   ")).toBe(true);
  });
});
