import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DailyBar } from "@/lib/bars";
import type { KeyStats, Quote, StockProfile } from "@/types/api";

import { clearCache } from "./cache";
import { dropPartialBar, getSignalReport, SignalNotFoundError, toFundamentals } from "./signal-service";
import { getDailyBars, getQuote, getSummary, todayInExchange } from "./yahoo";

vi.mock("server-only", () => ({}));
vi.mock("./yahoo", () => ({
  getDailyBars: vi.fn(),
  getQuote: vi.fn(),
  getSummary: vi.fn(),
  todayInExchange: vi.fn(),
}));

const DAY_MS = 86_400_000;
const LAST_SESSION = Date.UTC(2026, 10, 6);

function makeBars(n: number): DailyBar[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 * Math.exp(0.02 * Math.sin(i / 4) + 0.0005 * i);
    return { t: LAST_SESSION - (n - 1 - i) * DAY_MS, o: c * 0.998, h: c * 1.01, l: c * 0.99, c, adjClose: c, v: 1e6 + 5e4 * (i % 7) };
  });
}

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: "TEST",
    name: "Test Corp",
    quoteType: "EQUITY",
    currency: "USD",
    exchange: "NasdaqGS",
    marketState: "CLOSED",
    price: 100,
    change: 1,
    changePercent: 1,
    previousClose: 99,
    open: 99,
    dayHigh: 101,
    dayLow: 98,
    volume: 1e6,
    avgVolume: 1e6,
    marketCap: 1e10,
    fiftyTwoWeekHigh: 120,
    fiftyTwoWeekLow: 80,
    trailingPE: 20,
    forwardPE: 18,
    epsTrailingTwelveMonths: 5,
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

function makeSummary(stats: Partial<KeyStats>, sector: string | null = "Technology"): { profile: StockProfile; stats: KeyStats } {
  const profile: StockProfile = {
    symbol: "TEST",
    name: "Test Corp",
    longName: null,
    sector,
    industry: null,
    exchange: null,
    currency: "USD",
    country: null,
    website: null,
    employees: null,
    summary: null,
  };
  return { profile, stats: { ...EMPTY_STATS, ...stats } };
}

const SUMMARY = makeSummary({ roe: 0.2, profitMargin: 0.15, revenueGrowth: 0.1, debtToEquity: 0.6 });

describe("dropPartialBar", () => {
  const bars = makeBars(130);

  it("drops today's bar only while the regular session is open", () => {
    expect(dropPartialBar(bars, "REGULAR", LAST_SESSION)).toEqual({ bars: bars.slice(0, -1), dropped: true });
    for (const state of ["PRE", "POST", "CLOSED", null] as const) {
      expect(dropPartialBar(bars, state, LAST_SESSION)).toEqual({ bars, dropped: false });
    }
    expect(dropPartialBar(bars, "REGULAR", LAST_SESSION + DAY_MS).dropped).toBe(false);
    expect(dropPartialBar([], "REGULAR", LAST_SESSION)).toEqual({ bars: [], dropped: false });
  });
});

describe("toFundamentals", () => {
  it("combines the quote and the summary", () => {
    expect(toFundamentals(makeQuote(), SUMMARY, null)).toEqual({
      pe: 20,
      eps: 5,
      roe: 0.2,
      profitMargin: 0.15,
      revenueGrowth: 0.1,
      debtToEquity: 0.6,
      sector: "Technology",
    });
  });

  it("falls back to the summary and derives the P/E from price and EPS", () => {
    const quote = makeQuote({ trailingPE: null, epsTrailingTwelveMonths: null, price: 90 });
    expect(toFundamentals(quote, makeSummary({ eps: 3 }), null).pe).toBeCloseTo(30, 10);
    expect(toFundamentals(null, makeSummary({ eps: 4 }), 80).pe).toBeCloseTo(20, 10);
    // Loss-makers keep a null P/E so the value factor sees EPS <= 0.
    expect(toFundamentals(makeQuote({ trailingPE: null, epsTrailingTwelveMonths: -2 }), null, null)).toMatchObject({ pe: null, eps: -2 });
  });

  it("ignores company fundamentals for ETFs, indices and other non-equities", () => {
    for (const quoteType of ["ETF", "INDEX", "CRYPTOCURRENCY", "FUTURE"]) {
      expect(Object.values(toFundamentals(makeQuote({ quoteType }), SUMMARY, 100)).every((v) => v === null)).toBe(true);
    }
  });

  it("does not score a fund's trailing P/E when the instrument type is unknown", () => {
    // Yahoo reports a trailing P/E for ETFs (SPY about 23) but no sector; without a quote that is the only clue.
    const fund = makeSummary({ trailingPE: 23.4 }, null);
    expect(Object.values(toFundamentals(null, fund, 500)).every((v) => v === null)).toBe(true);
    expect(toFundamentals(makeQuote({ quoteType: null }), fund, 500).pe).toBeNull();
    expect(toFundamentals(makeQuote({ quoteType: null }), SUMMARY, 500)).toMatchObject({ pe: 20, roe: 0.2 });
  });
});

/** Calls of the mocked getDailyBars for one symbol. */
function barCalls(symbol: string): number {
  return vi.mocked(getDailyBars).mock.calls.filter(([requested]) => requested === symbol).length;
}

describe("getSignalReport", () => {
  beforeEach(() => {
    clearCache();
    vi.resetAllMocks();
    vi.mocked(todayInExchange).mockReturnValue(LAST_SESSION);
    vi.mocked(getDailyBars).mockResolvedValue(makeBars(300));
    vi.mocked(getQuote).mockResolvedValue(makeQuote());
    vi.mocked(getSummary).mockResolvedValue(SUMMARY);
  });

  it("computes a report from 540 days of history and caches it", async () => {
    const report = await getSignalReport("TEST");
    expect(report).toMatchObject({ symbol: "TEST", status: "ok", meta: { bars: 300, droppedPartialBar: false } });
    expect(report.meta.lastBarDate).toBe(new Date(LAST_SESSION).toISOString());
    expect(Number.isNaN(Date.parse(report.asOf))).toBe(false);
    expect(report.factors.find((f) => f.key === "quality")?.imputed).toBe(false);
    expect(getDailyBars).toHaveBeenCalledWith("TEST", 540);
    // The benchmark uses the same request as the screener, so both share one cache entry.
    expect(getDailyBars).toHaveBeenCalledWith("SPY", 540);

    await getSignalReport("TEST");
    expect(barCalls("TEST")).toBe(1);
    expect(barCalls("SPY")).toBe(1);
  });

  it("attaches the risk forecast, with beta against the benchmark", async () => {
    const report = await getSignalReport("TEST");
    const risk = report.risk;
    if (!risk) throw new Error("risk missing");
    // The mocked benchmark moves exactly like the stock.
    expect(risk.beta).toBeCloseTo(1, 10);
    expect(risk.price).toBeCloseTo(makeBars(300)[299].c, 10);
    expect(risk.forecastVolatility).toBeGreaterThan(0);
    expect(risk.range1?.low).toBeLessThan(risk.price ?? 0);
    expect(risk.range2?.high).toBeGreaterThan(risk.range1?.high ?? Infinity);
    expect(risk.volatility63).toBeGreaterThan(0);
    expect(risk.ownPercentile).not.toBeNull();
  });

  it("still reports risk without the benchmark, leaving beta null", async () => {
    vi.mocked(getDailyBars).mockImplementation(async (symbol) => {
      if (symbol === "SPY") throw new Error("benchmark down");
      return makeBars(300);
    });
    const report = await getSignalReport("TEST");
    expect(report.status).toBe("ok");
    expect(report.risk?.beta).toBeNull();
    expect(report.risk?.forecastVolatility).toBeGreaterThan(0);
  });

  it("measures the benchmark against itself without a second request", async () => {
    const report = await getSignalReport("SPY");
    expect(report.risk?.beta).toBeCloseTo(1, 10);
    expect(barCalls("SPY")).toBe(1);
  });

  it("drops today's still-forming bar during the regular session", async () => {
    vi.mocked(getQuote).mockResolvedValue(makeQuote({ marketState: "REGULAR" }));
    const report = await getSignalReport("TEST");
    expect(report.meta).toEqual({ bars: 299, droppedPartialBar: true, lastBarDate: new Date(LAST_SESSION - DAY_MS).toISOString() });
    expect(report.risk?.price).toBeCloseTo(makeBars(300)[298].c, 10);
    expect(report.risk?.beta).toBeCloseTo(1, 10);
  });

  it("still reports when the quote or the summary is unavailable", async () => {
    vi.mocked(getSummary).mockRejectedValue(new Error("summary down"));
    vi.mocked(getQuote).mockRejectedValue(new Error("quote down"));
    const report = await getSignalReport("TEST");
    expect(report.status).toBe("ok");
    expect(report.factors.find((f) => f.key === "quality")?.imputed).toBe(true);
    expect(report.coverage).toBeLessThan(100);
  });

  it("reports insufficient data for a known symbol without enough history", async () => {
    vi.mocked(getDailyBars).mockResolvedValue([]);
    const report = await getSignalReport("TEST");
    expect(report).toMatchObject({ status: "insufficient_data", score: null, factors: [], backtest: null, risk: null });
  });

  it("throws SignalNotFoundError for unknown symbols and caches that answer", async () => {
    vi.mocked(getDailyBars).mockRejectedValue(new Error("Not Found: No data found, symbol may be delisted"));
    vi.mocked(getQuote).mockResolvedValue(null);
    vi.mocked(getSummary).mockResolvedValue(null);
    await expect(getSignalReport("NOPE")).rejects.toBeInstanceOf(SignalNotFoundError);
    await expect(getSignalReport("NOPE")).rejects.toBeInstanceOf(SignalNotFoundError);
    expect(barCalls("NOPE")).toBe(1);
  });

  it("does not cache a not-found answer when the quote lookup itself failed", async () => {
    vi.mocked(getDailyBars).mockResolvedValue([]);
    vi.mocked(getQuote).mockRejectedValue(new Error("quote down"));
    await expect(getSignalReport("MAYBE")).rejects.toBeInstanceOf(SignalNotFoundError);
    await expect(getSignalReport("MAYBE")).rejects.toBeInstanceOf(SignalNotFoundError);
    expect(barCalls("MAYBE")).toBe(2);
  });

  it("serves the previous report for up to an hour when a refresh fails", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 6, 22, 0) });
    try {
      const fresh = await getSignalReport("TEST");
      const outage = new Error("Yahoo is down");
      vi.mocked(getDailyBars).mockRejectedValue(outage);
      vi.mocked(getQuote).mockRejectedValue(outage);

      vi.setSystemTime(Date.UTC(2026, 10, 6, 22, 16)); // past the 15-minute lifetime
      await expect(getSignalReport("TEST")).resolves.toBe(fresh); // unchanged, including its asOf
      vi.setSystemTime(Date.UTC(2026, 10, 6, 23, 16)); // past the extra hour as well
      await expect(getSignalReport("TEST")).rejects.toBe(outage);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces upstream failures without caching them", async () => {
    const outage = new Error("Yahoo is down");
    vi.mocked(getDailyBars).mockRejectedValueOnce(outage);
    vi.mocked(getQuote).mockRejectedValueOnce(outage);
    await expect(getSignalReport("TEST")).rejects.toBe(outage);

    vi.mocked(getDailyBars).mockRejectedValueOnce(outage);
    await expect(getSignalReport("TEST")).rejects.toBe(outage); // a quote alone is not enough for a report

    await expect(getSignalReport("TEST")).resolves.toMatchObject({ status: "ok" });
    expect(barCalls("TEST")).toBe(3);
  });
});
