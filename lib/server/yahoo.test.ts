import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { clearCache } from "./cache";
import { analystRating, announcedDividend, earningsDates, getQuotes, mapQuote, searchSymbols, yf } from "./yahoo";

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

describe("mapQuote", () => {
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
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const stale = (await getQuotes(["STALE1"])).get("STALE1");
    expect(stale).toMatchObject({ price: 10, stale: true, fetchedAt: "2026-11-07T15:00:00.000Z" });

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
