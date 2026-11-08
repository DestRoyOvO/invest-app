import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DailyBar } from "@/lib/bars";
import { UNIVERSE_STOCKS } from "@/lib/universe";
import type { ApiErrorBody, FactorProfile, Quote, ScreenerResponse, ScreenerRow } from "@/types/api";

vi.mock("server-only", () => ({}));

const yahoo = vi.hoisted(() => ({
  getQuotes: vi.fn<(symbols: string[]) => Promise<Map<string, Quote>>>(),
  getDailyBars: vi.fn<(symbol: string, days: number) => Promise<DailyBar[]>>(),
  getQuote: vi.fn(),
  getSummary: vi.fn(),
  todayInExchange: () => Date.UTC(2026, 10, 7),
}));
vi.mock("./yahoo", () => yahoo);

import { GET as factorsRoute } from "@/app/api/stock/[symbol]/factors/route";
import { GET as screenerRoute } from "@/app/api/screener/route";

import { clearCache } from "./cache";
import { resetRateLimits } from "./rate-limit";
import { barMetrics, ETF_UNIVERSE, getFactorProfile, getScreener, quoteColumns, rankFactors, upcomingExDate } from "./screener";

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2025, 2, 1);

/** Deterministic bars with a per-symbol drift, so the style factors differ across symbols. */
function bars(seed: number, n = 330): DailyBar[] {
  const out: DailyBar[] = [];
  let close = 100;
  for (let k = 0; k < n; k++) {
    close *= 1 + 0.0004 * (seed % 7) - 0.001 + Math.sin((k + 1) * 0.7 * (seed + 1)) * 0.012;
    out.push({ t: START + k * DAY, o: close, h: close * 1.01, l: close * 0.99, c: close, adjClose: close, v: 1_000_000 });
  }
  return out;
}

function seedOf(symbol: string): number {
  return [...symbol].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
}

function quote(symbol: string, overrides: Partial<Quote> = {}): Quote {
  return {
    symbol,
    name: `${symbol} Inc.`,
    quoteType: "EQUITY",
    currency: "USD",
    exchange: "NMS",
    marketState: "CLOSED",
    price: 100,
    change: 1,
    changePercent: 1,
    previousClose: 99,
    open: 99,
    dayHigh: 101,
    dayLow: 98,
    volume: 1_000_000,
    avgVolume: 2_000_000,
    marketCap: 1e11,
    fiftyTwoWeekHigh: 125,
    fiftyTwoWeekLow: 80,
    trailingPE: 20,
    forwardPE: 18,
    epsTrailingTwelveMonths: 5,
    dividendYield: 0.01,
    extendedPrice: null,
    extendedChange: null,
    extendedChangePercent: null,
    extendedSession: null,
    regularMarketTime: null,
    fiftyDayAverage: 80,
    twoHundredDayAverage: 125,
    fiftyTwoWeekChangePercent: 12,
    priceToBook: 4,
    forwardEps: 5.5,
    dividendRate: 1,
    analystRating: 2.1,
    sharesOutstanding: 1e9,
    nextEarningsDate: "2027-01-28T21:00:00.000Z",
    earningsDateEstimated: true,
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

function row(symbol: string, momentum: number | null): ScreenerRow {
  return {
    ...quoteColumns(symbol, quote(symbol)),
    return1m: null,
    return3m: null,
    return6m: null,
    rsi14: null,
    technicalScore: null,
    factors: { momentum, reversal: null, high52: null, volatility: null, beta: null },
    percentiles: { momentum: null, reversal: null, high52: null, volatility: null, beta: null },
  };
}

beforeEach(() => {
  clearCache();
  resetRateLimits();
  yahoo.getQuotes.mockReset();
  yahoo.getDailyBars.mockReset();
  yahoo.getQuotes.mockImplementation(async (symbols) => new Map(symbols.map((s) => [s, quote(s)])));
  yahoo.getDailyBars.mockImplementation(async (symbol) => bars(seedOf(symbol)));
});

describe("row building", () => {
  it("derives price ratios, dollar volume and the sector from the quote", () => {
    const columns = quoteColumns("AAPL", quote("AAPL"));
    expect(columns).toMatchObject({ sector: "technology", analystRating: 2.1, dollarVolume: 2e8 });
    expect(columns.fromHigh52).toBeCloseTo(-0.2);
    expect(columns.vs50d).toBeCloseTo(0.25);
    expect(columns.vs200d).toBeCloseTo(-0.2);
    expect(quoteColumns("SPY", quote("SPY", { quoteType: "ETF" })).sector).toBeNull();
    expect(quoteColumns("GONE", undefined)).toMatchObject({ name: "GONE", price: null, fromHigh52: null, dividendRate: null, exDividendDate: null });
  });

  it("carries the dividend columns from the quote", () => {
    const columns = quoteColumns("KO", quote("KO", { dividendRate: 2.04, exDividendDate: "2026-11-28T05:00:00.000Z" }));
    expect(columns).toMatchObject({ dividendRate: 2.04, exDividendDate: "2026-11-28T05:00:00.000Z", dividendYield: 0.01 });
  });

  it("keeps only ex-dividend dates from today on (New York)", () => {
    // todayInExchange is mocked to 2026-11-07; Yahoo still lists a dividend that went ex the day before.
    expect(quoteColumns("PFE", quote("PFE", { exDividendDate: "2026-11-06T05:00:00.000Z" })).exDividendDate).toBeNull();
    expect(quoteColumns("WFC", quote("WFC", { exDividendDate: "2026-11-07T05:00:00.000Z" })).exDividendDate).toBe("2026-11-07T05:00:00.000Z");
    const today = Date.UTC(2026, 10, 7);
    // 03:00 UTC on Nov 7 is still Nov 6 in New York.
    expect(upcomingExDate("2026-11-07T03:00:00.000Z", today)).toBeNull();
    expect(upcomingExDate("2026-11-10T05:00:00.000Z", today)).toBe("2026-11-10T05:00:00.000Z");
    expect(upcomingExDate("not a date", today)).toBeNull();
    expect(upcomingExDate(null, today)).toBeNull();
  });

  it("computes returns, RSI, the technical reading and the style factors from bars", () => {
    const metrics = barMetrics(bars(3), bars(1).map((b) => ({ t: b.t, c: b.adjClose })));
    expect(metrics.return1m).not.toBeNull();
    expect(metrics.return6m).not.toBeNull();
    expect(metrics.rsi14).toBeGreaterThanOrEqual(0);
    expect(metrics.rsi14).toBeLessThanOrEqual(100);
    expect(metrics.technicalScore).toBeGreaterThanOrEqual(0);
    expect(Object.values(metrics.factors).every((v) => v !== null)).toBe(true);
  });

  it("returns nulls for a short history instead of throwing", () => {
    const metrics = barMetrics(bars(3, 30), null);
    expect(metrics).toMatchObject({ return3m: null, technicalScore: null });
    expect(metrics.factors.beta).toBeNull();
  });

  it("ranks each factor across the universe", () => {
    const ranked = rankFactors([row("A", 0.1), row("B", 0.3), row("C", null), row("D", 0.2)]);
    const percentiles = ranked.map((r) => r.percentiles.momentum);
    expect(percentiles[0]).toBeCloseTo(100 / 6);
    expect(percentiles[1]).toBeCloseTo(500 / 6);
    expect(percentiles[2]).toBeNull();
    expect(percentiles[3]).toBeCloseTo(50);
  });
});

describe("getScreener", () => {
  it("builds one row per universe stock with percentiles", async () => {
    const snapshot = await getScreener("stocks");
    expect(snapshot.rows.map((r) => r.symbol)).toEqual(UNIVERSE_STOCKS);
    expect(snapshot.partial).toEqual([]);
    expect(snapshot.warnings).toEqual([]);
    const momentum = snapshot.rows.map((r) => r.percentiles.momentum).filter((p): p is number => p !== null);
    expect(momentum.length).toBe(UNIVERSE_STOCKS.length);
    expect(Math.min(...momentum)).toBeLessThan(10);
    expect(Math.max(...momentum)).toBeGreaterThan(90);
  });

  it("marks symbols whose bars failed and keeps their quote columns", async () => {
    yahoo.getDailyBars.mockImplementation(async (symbol) => {
      if (symbol === "AAPL") throw new Error("Yahoo down");
      return bars(seedOf(symbol));
    });
    const snapshot = await getScreener("stocks");
    expect(snapshot.partial).toEqual(["AAPL"]);
    expect(snapshot.warnings).toContain("history");
    const aapl = snapshot.rows.find((r) => r.symbol === "AAPL");
    expect(aapl).toMatchObject({ price: 100, technicalScore: null, return1m: null });
  });

  it("is cached between calls", async () => {
    await getScreener("stocks");
    const calls = yahoo.getDailyBars.mock.calls.length;
    await getScreener("stocks");
    expect(yahoo.getDailyBars.mock.calls.length).toBe(calls);
  });

  it("serves the dividend columns on every row", async () => {
    yahoo.getQuotes.mockImplementation(async (symbols) => new Map(symbols.map((s) => [s, quote(s, { dividendRate: 1.5, exDividendDate: "2026-12-01T05:00:00.000Z" })])));
    const snapshot = await getScreener("stocks");
    expect(snapshot.rows[0]).toMatchObject({ dividendRate: 1.5, exDividendDate: "2026-12-01T05:00:00.000Z" });
  });

  it("warns when quotes are stale or the benchmark history is missing", async () => {
    yahoo.getQuotes.mockImplementation(async (symbols) => new Map(symbols.map((s) => [s, quote(s, { stale: s === "MSFT" })])));
    yahoo.getDailyBars.mockImplementation(async (symbol) => {
      if (symbol === "SPY") throw new Error("Yahoo down");
      return bars(seedOf(symbol));
    });
    const snapshot = await getScreener("stocks");
    expect(snapshot.warnings).toEqual(expect.arrayContaining(["benchmark", "quotes_stale"]));
    expect(snapshot.rows.every((r) => r.factors.beta === null)).toBe(true);
  });

  it("covers the ETF universe with fund fields", async () => {
    yahoo.getQuotes.mockImplementation(async (symbols) => new Map(symbols.map((s) => [s, quote(s, { quoteType: "ETF", expenseRatio: 0.0009 })])));
    const snapshot = await getScreener("etfs");
    expect(snapshot.rows.map((r) => r.symbol)).toEqual(ETF_UNIVERSE);
    expect(snapshot.rows[0]).toMatchObject({ sector: null, expenseRatio: 0.0009 });
  });
});

describe("getFactorProfile", () => {
  it("reuses the snapshot row for a universe stock", async () => {
    const profile = await getFactorProfile("MSFT");
    const snapshot = await getScreener("stocks");
    const own = snapshot.rows.find((r) => r.symbol === "MSFT");
    expect(profile).toMatchObject({ symbol: "MSFT", inUniverse: true, universeSize: UNIVERSE_STOCKS.length, percentiles: own?.percentiles });
  });

  it("places another symbol within the universe's distribution", async () => {
    const profile = await getFactorProfile("SHOP");
    expect(profile?.inUniverse).toBe(false);
    expect(profile?.percentiles.momentum).toBeGreaterThanOrEqual(0);
    expect(profile?.percentiles.momentum).toBeLessThanOrEqual(100);
  });

  it("returns null for a symbol without history", async () => {
    yahoo.getDailyBars.mockImplementation(async (symbol) => (symbol === "NOPE" ? [] : bars(seedOf(symbol))));
    expect(await getFactorProfile("NOPE")).toBeNull();
  });
});

describe("routes", () => {
  it("validates the screener universe and serves the snapshot", async () => {
    expect((await screenerRoute(new Request("http://localhost/api/screener?universe=crypto"))).status).toBe(400);
    const res = await screenerRoute(new Request("http://localhost/api/screener"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as ScreenerResponse).universe).toBe("stocks");
  });

  it("serves factor profiles and 404s symbols without history", async () => {
    yahoo.getDailyBars.mockImplementation(async (symbol) => (symbol === "NOPE" ? [] : bars(seedOf(symbol))));
    const ctx = (symbol: string) => ({ params: Promise.resolve({ symbol }) });
    const ok = await factorsRoute(new Request("http://localhost/api/stock/NVDA/factors"), ctx("NVDA"));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as FactorProfile).symbol).toBe("NVDA");
    const missing = await factorsRoute(new Request("http://localhost/api/stock/NOPE/factors"), ctx("NOPE"));
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as ApiErrorBody).error.code).toBe("not_found");
    const bad = await factorsRoute(new Request("http://localhost/api/stock/$$/factors"), ctx("$$"));
    expect(bad.status).toBe(400);
  });
});
