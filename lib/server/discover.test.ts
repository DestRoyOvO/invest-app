import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiErrorBody, DiscoverResponse, Quote } from "@/types/api";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  screener: vi.fn(),
  trendingSymbols: vi.fn(),
  getQuotes: vi.fn<(symbols: string[]) => Promise<Map<string, Quote>>>(),
}));
vi.mock("./yahoo", async (importOriginal) => {
  const original = await importOriginal<typeof import("./yahoo")>();
  return { ...original, yf: { screener: mocks.screener, trendingSymbols: mocks.trendingSymbols }, getQuotes: mocks.getQuotes };
});

import { GET as discoverRoute } from "@/app/api/discover/route";

import { clearCache } from "./cache";
import { getDiscover, MAX_ROWS, passesQuality, SCAN_COUNT } from "./discover";
import { resetRateLimits } from "./rate-limit";
import { mapQuote } from "./yahoo";

function raw(symbol: string, overrides: Record<string, unknown> = {}) {
  return {
    symbol,
    shortName: `${symbol} Inc`,
    quoteType: "EQUITY",
    market: "us_market",
    currency: "USD",
    regularMarketPrice: 50,
    regularMarketChangePercent: 12.5,
    marketCap: 5e9,
    ...overrides,
  };
}

beforeEach(() => {
  clearCache();
  resetRateLimits();
  mocks.screener.mockReset();
  mocks.trendingSymbols.mockReset();
  mocks.getQuotes.mockReset();
});

describe("passesQuality", () => {
  it("keeps US-listed equities above the price and cap floors", () => {
    expect(passesQuality(mapQuote(raw("OK")), "us_market", 1e9)).toBe(true);
    expect(passesQuality(mapQuote(raw("FUND", { quoteType: "ETF" })), "us_market", 1e9)).toBe(false);
    expect(passesQuality(mapQuote(raw("ADR")), "gb_market", 1e9)).toBe(false);
    expect(passesQuality(mapQuote(raw("PENNY", { regularMarketPrice: 1.2 })), "us_market", 1e9)).toBe(false);
    expect(passesQuality(mapQuote(raw("TINY", { marketCap: 4e8 })), "us_market", 1e9)).toBe(false);
    expect(passesQuality(mapQuote(raw("NOCAP", { marketCap: undefined })), "us_market", 0)).toBe(false);
  });

  it("falls back to the currency when Yahoo omits the market", () => {
    expect(passesQuality(mapQuote(raw("USD")), null, 1e9)).toBe(true);
    expect(passesQuality(mapQuote(raw("EUR", { currency: "EUR" })), null, 1e9)).toBe(false);
  });
});

describe("getDiscover", () => {
  it("filters a predefined screen and keeps Yahoo's order and total", async () => {
    mocks.screener.mockResolvedValue({ total: 371, quotes: [raw("AAA"), raw("JUNK", { marketCap: 1e8 }), raw("BBB")] });
    const res = await getDiscover("day_gainers");
    expect(mocks.screener.mock.calls[0][0]).toMatchObject({ scrIds: "day_gainers", count: SCAN_COUNT });
    expect(res.quotes.map((q) => q.symbol)).toEqual(["AAA", "BBB"]);
    expect(res).toMatchObject({ screen: "day_gainers", scanned: 3, total: 371, minMarketCap: 1e9 });
    expect(res.quotes[0].fetchedAt).not.toBeNull();
  });

  it("applies a custom cap floor to the cached rows without another Yahoo call", async () => {
    mocks.screener.mockResolvedValue({ total: 2, quotes: [raw("BIG", { marketCap: 5e10 }), raw("MID", { marketCap: 3e9 })] });
    await getDiscover("most_actives");
    const large = await getDiscover("most_actives", 1e10);
    expect(large.quotes.map((q) => q.symbol)).toEqual(["BIG"]);
    expect(mocks.screener).toHaveBeenCalledTimes(1);
  });

  it("keeps the first 50 passing rows of a deep scan", async () => {
    const quotes = Array.from({ length: 120 }, (_, i) => raw(`S${i}`, { marketCap: i % 2 === 0 ? 5e9 : 1e8 }));
    mocks.screener.mockResolvedValue({ total: 371, quotes });
    const res = await getDiscover("day_losers");
    expect(SCAN_COUNT).toBe(250);
    expect(res.quotes).toHaveLength(MAX_ROWS);
    expect(res.quotes[0].symbol).toBe("S0");
    expect(res.quotes[1].symbol).toBe("S2");
    expect(res).toMatchObject({ scanned: 120, total: 371 });
  });

  it("finds large caps far down a list for a high floor", async () => {
    const quotes = Array.from({ length: 250 }, (_, i) => raw(`S${i}`, { marketCap: i >= 230 ? 2e11 : 2e9 }));
    mocks.screener.mockResolvedValue({ total: 300, quotes });
    const res = await getDiscover("day_gainers", 1e11);
    expect(res.quotes.map((q) => q.symbol)).toEqual(Array.from({ length: 20 }, (_, i) => `S${230 + i}`));
  });

  it("reads Yahoo's epoch-second earnings times from screen rows", async () => {
    const next = Math.floor(Date.now() / 1000) + 5 * 86_400;
    mocks.screener.mockResolvedValue({ total: 1, quotes: [raw("ERN", { earningsTimestampStart: next, isEarningsDateEstimate: true, volume: 1 })] });
    const res = await getDiscover("growth_technology_stocks");
    expect(res.quotes[0].nextEarningsDate).toBe(new Date(next * 1000).toISOString());
    expect(res.quotes[0].earningsDateEstimated).toBe(true);
  });

  it("prices trending symbols through the batched quotes", async () => {
    mocks.trendingSymbols.mockResolvedValue({ quotes: [{ symbol: "AA" }, { symbol: "BTC-USD" }, { symbol: "GONE" }] });
    mocks.getQuotes.mockResolvedValue(
      new Map([
        ["AA", mapQuote(raw("AA"))],
        ["BTC-USD", mapQuote(raw("BTC-USD", { quoteType: "CRYPTOCURRENCY" }))],
      ]),
    );
    const res = await getDiscover("trending");
    expect(mocks.getQuotes).toHaveBeenCalledWith(["AA", "BTC-USD", "GONE"]);
    expect(res.quotes.map((q) => q.symbol)).toEqual(["AA"]);
    expect(res).toMatchObject({ scanned: 2, total: 3 });
  });
});

describe("GET /api/discover", () => {
  it("validates the screen and the cap floor", async () => {
    const bad = await discoverRoute(new Request("http://localhost/api/discover?screen=penny_stocks"));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as ApiErrorBody).error.code).toBe("bad_request");
    expect((await discoverRoute(new Request("http://localhost/api/discover?minCap=-5"))).status).toBe(400);
  });

  it("serves the default screen and maps upstream failures to 502", async () => {
    mocks.screener.mockResolvedValueOnce({ total: 1, quotes: [raw("AAA")] });
    const ok = await discoverRoute(new Request("http://localhost/api/discover"));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as DiscoverResponse).screen).toBe("day_gainers");

    mocks.screener.mockRejectedValueOnce(new Error("Yahoo down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await discoverRoute(new Request("http://localhost/api/discover?screen=day_losers"));
    expect(failed.status).toBe(502);
  });
});
