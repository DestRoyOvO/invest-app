import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiErrorBody, MarketState, Quote } from "@/types/api";
import type { WorldMarketsResponse } from "@/types/markets";
import { WORLD_BOARD } from "@/lib/universe";

vi.mock("server-only", () => ({}));

const yahoo = vi.hoisted(() => ({
  getQuotes: vi.fn<(symbols: string[]) => Promise<Map<string, Quote>>>(),
  getSparkline: vi.fn<(symbol: string) => Promise<number[]>>(),
  hasCachedSparkline: vi.fn<(symbol: string) => boolean>(),
  hasFreshQuote: vi.fn<(symbol: string) => boolean>(),
}));
vi.mock("./yahoo", () => yahoo);

import { GET as worldRoute } from "@/app/api/markets/world/route";

import { buildWorldRows, getWorldMarkets, loadSparks, oldestStaleFetch, uncachedWorldCalls, WORLD_SYMBOLS } from "./world";

function quote(symbol: string, overrides: Partial<Quote> = {}): Quote {
  return {
    symbol,
    name: symbol,
    quoteType: "INDEX",
    currency: "USD",
    exchange: null,
    marketState: "CLOSED",
    price: 100,
    change: 1,
    changePercent: 1,
    previousClose: 99,
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
    regularMarketTime: "2026-11-06T06:45:02.000Z",
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

function allQuotes(state: MarketState = "CLOSED"): Map<string, Quote> {
  return new Map(WORLD_SYMBOLS.map((symbol, i) => [symbol, quote(symbol, { price: 100 + i, changePercent: i - 10, marketState: state })]));
}

beforeEach(() => {
  for (const mock of Object.values(yahoo)) mock.mockReset();
  yahoo.hasCachedSparkline.mockReturnValue(false);
  yahoo.hasFreshQuote.mockReturnValue(false);
});

describe("WORLD_BOARD", () => {
  it("lists every region's symbols once, with a code, labels and a real time zone", () => {
    expect(new Set(WORLD_SYMBOLS).size).toBe(WORLD_SYMBOLS.length);
    expect(WORLD_SYMBOLS).toHaveLength(30);
    for (const item of WORLD_BOARD) {
      expect(item.code).toMatch(/^[A-Z0-9]{2,7}$/);
      expect(item.label.en && item.label.zh && item.place.en && item.place.zh).toBeTruthy();
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: item.timeZone })).not.toThrow();
    }
    expect(WORLD_SYMBOLS).not.toContain("^MOVE");
    expect(WORLD_BOARD.filter((item) => item.overnight).map((item) => item.region)).toEqual(
      expect.arrayContaining(["asia", "europe"]),
    );
  });
});

describe("buildWorldRows", () => {
  it("keeps WORLD_BOARD order, maps the quote fields and lists symbols without a quote", () => {
    const quotes = allQuotes();
    quotes.delete("^FTSE");
    quotes.set("^N225", quote("^N225", { price: 57_434.77, change: -3_641.2, changePercent: -5.96, stale: true }));
    const { rows, missing } = buildWorldRows(quotes, new Map([["^N225", [1, 2, 3]]]));

    expect(rows.map((row) => row.symbol)).toEqual(WORLD_SYMBOLS.filter((symbol) => symbol !== "^FTSE"));
    expect(missing).toEqual(["^FTSE"]);
    expect(rows.find((row) => row.symbol === "^N225")).toEqual({
      symbol: "^N225",
      price: 57_434.77,
      change: -3_641.2,
      changePercent: -5.96,
      marketState: "CLOSED",
      time: "2026-11-06T06:45:02.000Z",
      spark: [1, 2, 3],
      stale: true,
    });
    expect(rows.find((row) => row.symbol === "^GSPC")?.spark).toEqual([]);
  });
});

describe("loadSparks", () => {
  it("returns every series when they arrive within the budget", async () => {
    yahoo.getSparkline.mockImplementation(async (symbol) => [symbol.length, 2]);
    const { sparks, complete } = await loadSparks(["^GSPC", "GC=F"], 1_000);
    expect(complete).toBe(true);
    expect(sparks.get("^GSPC")).toEqual([5, 2]);
  });

  it("answers at the deadline with the series that arrived, and flags failures", async () => {
    yahoo.getSparkline.mockImplementation((symbol) =>
      symbol === "SLOW" ? new Promise<number[]>((resolve) => setTimeout(() => resolve([9]), 500)) : Promise.resolve([1]),
    );
    const late = await loadSparks(["FAST", "SLOW"], 20);
    expect(late.complete).toBe(false);
    expect([...late.sparks.keys()]).toEqual(["FAST"]);

    yahoo.getSparkline.mockImplementation((symbol) => (symbol === "BAD" ? Promise.reject(new Error("timeout")) : Promise.resolve([1])));
    const failed = await loadSparks(["GOOD", "BAD"], 1_000);
    expect(failed.complete).toBe(false);
    expect([...failed.sparks.keys()]).toEqual(["GOOD"]);
  });
});

describe("getWorldMarkets", () => {
  it("assembles the board from one quote request and the series", async () => {
    yahoo.getQuotes.mockResolvedValue(allQuotes());
    yahoo.getSparkline.mockResolvedValue([1, 2, 3]);
    const world = await getWorldMarkets(1_000);

    expect(yahoo.getQuotes).toHaveBeenCalledTimes(1);
    expect(yahoo.getQuotes.mock.calls[0][0]).toEqual([...WORLD_SYMBOLS]);
    expect(world.rows).toHaveLength(WORLD_SYMBOLS.length);
    expect(world.rows.every((row) => row.spark.length === 3)).toBe(true);
    expect(world.missing).toEqual([]);
    expect(world.warnings).toEqual([]);
    expect(world.staleSince).toBeNull();
  });

  it("warns about missing series and stale quotes instead of failing", async () => {
    const quotes = allQuotes();
    quotes.set("BTC-USD", quote("BTC-USD", { stale: true, fetchedAt: "2026-11-07T20:01:00.000Z" }));
    quotes.set("GC=F", quote("GC=F", { stale: true, fetchedAt: "2026-11-07T19:58:00.000Z" }));
    quotes.set("^GSPC", quote("^GSPC", { fetchedAt: "2026-11-07T19:00:00.000Z" }));
    yahoo.getQuotes.mockResolvedValue(quotes);
    yahoo.getSparkline.mockImplementation(async (symbol) => {
      if (symbol === "^HSI") throw new Error("timeout");
      return [1, 2];
    });
    const world = await getWorldMarkets(1_000);
    expect(world.warnings).toEqual(["sparklines", "quotes_stale"]);
    // How old the stale quotes are: the oldest of them, not the fresh ones.
    expect(world.staleSince).toBe("2026-11-07T19:58:00.000Z");
    expect(world.rows.find((row) => row.symbol === "^HSI")?.spark).toEqual([]);
  });

  it("finds the oldest fetch among stale quotes only", () => {
    expect(oldestStaleFetch([])).toBeNull();
    expect(oldestStaleFetch([{ stale: false, fetchedAt: "2026-11-07T10:00:00.000Z" }])).toBeNull();
    expect(oldestStaleFetch([{ stale: true, fetchedAt: null }])).toBeNull();
    expect(
      oldestStaleFetch([
        { stale: true, fetchedAt: "2026-11-07T12:00:00.000Z" },
        { stale: false, fetchedAt: "2026-11-07T09:00:00.000Z" },
        { stale: true, fetchedAt: "2026-11-07T11:00:00.000Z" },
      ]),
    ).toBe("2026-11-07T11:00:00.000Z");
  });

  it("fails only when no quote can be loaded", async () => {
    yahoo.getSparkline.mockResolvedValue([]);
    yahoo.getQuotes.mockRejectedValue(new Error("Yahoo down"));
    await expect(getWorldMarkets(100)).rejects.toThrow("Yahoo down");
    yahoo.getQuotes.mockResolvedValue(new Map());
    await expect(getWorldMarkets(100)).rejects.toThrow("no quotes");
  });

  it("counts the upstream calls a request would make", () => {
    expect(uncachedWorldCalls()).toBe(1 + WORLD_SYMBOLS.length);
    yahoo.hasFreshQuote.mockReturnValue(true);
    yahoo.hasCachedSparkline.mockImplementation((symbol) => symbol !== "GC=F");
    expect(uncachedWorldCalls()).toBe(1);
  });
});

describe("GET /api/markets/world", () => {
  it("returns the board with a short shared cache", async () => {
    yahoo.getQuotes.mockResolvedValue(allQuotes("REGULAR"));
    yahoo.getSparkline.mockResolvedValue([1, 2]);
    yahoo.hasFreshQuote.mockReturnValue(true);
    yahoo.hasCachedSparkline.mockReturnValue(true);
    const response = await worldRoute(new Request("http://localhost/api/markets/world"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/s-maxage=15(?!\d)/);
    const body = (await response.json()) as WorldMarketsResponse;
    expect(body.rows[0].symbol).toBe("^GSPC");
  });

  it("answers a generic 502 when Yahoo is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    yahoo.getSparkline.mockResolvedValue([]);
    yahoo.getQuotes.mockRejectedValue(new Error("ECONNRESET 10.0.0.7:443"));
    const response = await worldRoute(new Request("http://localhost/api/markets/world"));
    expect(response.status).toBe(502);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("upstream_error");
    expect(body.error.message).not.toContain("10.0.0.7");
  });
});
