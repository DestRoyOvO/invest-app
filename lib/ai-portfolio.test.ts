import { describe, expect, it } from "vitest";

import { valuePortfolio } from "@/lib/portfolio";
import type { Quote } from "@/types/api";

import {
  dayPnlLine,
  eventsLine,
  groupSplitLine,
  largestGroupSplit,
  largestMovers,
  portfolioRisk,
  portfolioSummary,
  ranksLine,
  riskBlock,
  type AlignedSeries,
} from "./ai-portfolio";

const NOW = new Date("2026-11-07T16:00:00Z");

function quote(symbol: string, price: number, change: number, overrides: Partial<Quote> = {}): Quote {
  return {
    symbol,
    name: symbol,
    quoteType: "EQUITY",
    currency: "USD",
    exchange: null,
    marketState: "CLOSED",
    price,
    change,
    changePercent: (change / (price - change)) * 100,
    previousClose: price - change,
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

// The README screenshot case: JPM is the largest position, NVDA (third) rose while the other three fell.
const QUOTES = new Map<string, Quote>([
  ["JPM", quote("JPM", 300, -3)],
  ["AAPL", quote("AAPL", 264, -2, { nextEarningsDate: "2027-01-29T21:00:00.000Z", earningsDateEstimated: true })],
  ["NVDA", quote("NVDA", 230, 6, { nextEarningsDate: "2026-11-19T21:00:00.000Z", earningsDateEstimated: false })],
  ["MSFT", quote("MSFT", 490, -1, { exDividendDate: "2026-11-20T00:00:00.000Z", dividendAmount: 0.91 })],
]);
const POSITIONS = [
  { symbol: "JPM", shares: 10.3, cost: 250 },
  { symbol: "AAPL", shares: 10, cost: 200 },
  { symbol: "NVDA", shares: 10, cost: 120 },
  { symbol: "MSFT", shares: 4, cost: 400 },
];
const PORTFOLIO = valuePortfolio(POSITIONS, (symbol) => QUOTES.get(symbol));
const GROUPS: Record<string, string> = { JPM: "Financials", AAPL: "Information Technology", NVDA: "Information Technology", MSFT: "Information Technology" };
const groupOf = (symbol: string) => GROUPS[symbol] ?? "Unclassified";

describe("portfolio relations", () => {
  it("lists day P&L from highest to lowest with the gainer and decliner counts", () => {
    expect(dayPnlLine(PORTFOLIO)).toBe("Day P&L by position (USD, highest to lowest): NVDA +60.00, MSFT -4.00, AAPL -20.00, JPM -30.90; 1 gained, 3 lost.");
  });

  it("ranks positions by value", () => {
    // Values: JPM 3,090, AAPL 2,640, NVDA 2,300, MSFT 1,960 of 9,990.
    expect(ranksLine(PORTFOLIO)).toBe("Ranks by value (weights of the USD total): #1 JPM 31%, #2 AAPL 26%, #3 NVDA 23%, #4 MSFT 20%.");
  });

  it("names the largest group by value and what sits outside it", () => {
    const split = largestGroupSplit(PORTFOLIO, groupOf);
    expect(split?.group).toBe("Information Technology");
    expect(split?.share).toBeCloseTo(6_900 / 9_990, 10);
    expect(groupSplitLine(split)).toBe("Largest group by value: Information Technology 69% (AAPL, NVDA, MSFT). Outside it: JPM 31% (Financials).");
    expect(groupSplitLine(largestGroupSplit(PORTFOLIO, () => "Tech"))).toContain("Every position is in this group.");
  });

  it("picks the two largest movers by absolute day P&L", () => {
    expect(largestMovers(PORTFOLIO).map((row) => row.symbol)).toEqual(["NVDA", "JPM"]);
  });

  it("lists upcoming earnings and ex-dividend dates soonest first", () => {
    expect(eventsLine(["JPM", "AAPL", "NVDA", "MSFT"], QUOTES, NOW)).toBe(
      "Upcoming earnings and ex-dividend dates for holdings (from quotes, next 90 days): NVDA earnings 2026-11-19 (confirmed, in 12 days); MSFT ex-dividend 2026-11-20 (in 13 days, 0.91 per share); AAPL earnings 2027-01-29 (estimated, in 83 days).",
    );
    expect(eventsLine(["JPM"], QUOTES, NOW)).toContain("none known in the next 90 days");
  });

  it("summarizes the portfolio in two lines for the market and sector chats", () => {
    const summary = portfolioSummary(PORTFOLIO, 4) ?? "";
    expect(summary).toContain("Investor's positions (entered by the investor; 4 positions, totals in USD): value 9,990.00, today +5.10 (+0.05%), unrealized +2,615.00 (+35.5%).");
    expect(summary).toContain("\nLargest weights: JPM 31%, AAPL 26%, NVDA 23%.");
    expect(portfolioSummary(valuePortfolio([{ symbol: "GONE", shares: 1, cost: 1 }], () => undefined), 1)).toContain("no prices for GONE");
  });
});

/** Aligned closes: two assets moving together, one moving against them, and the benchmark. */
function aligned(): AlignedSeries {
  const n = 260;
  const dates = Array.from({ length: n }, (_, i) => Date.UTC(2025, 10, 1) + i * 86_400_000);
  const wave = (i: number, amplitude: number) => 100 * (1 + amplitude * Math.sin(i / 3) + 0.0005 * i);
  return {
    dates,
    closes: {
      JPM: dates.map((_, i) => wave(i, 0.03)),
      AAPL: dates.map((_, i) => wave(i, 0.04)),
      NVDA: dates.map((_, i) => wave(i, 0.08)),
      MSFT: dates.map((_, i) => wave(i, 0.02)),
      SPY: dates.map((_, i) => wave(i, 0.03)),
    },
  };
}

describe("portfolio risk", () => {
  it("computes past-year risk of today's holdings and words it as past behaviour", () => {
    const risk = portfolioRisk(aligned(), PORTFOLIO, "SPY");
    expect(risk).not.toBeNull();
    if (!risk) return;
    expect(risk.covered).toEqual(["JPM", "AAPL", "NVDA", "MSFT"]);
    expect(risk.returns).toBe(259);
    expect(risk.volatility).toBeGreaterThan(0);
    expect(risk.beta).toBeGreaterThan(1);
    expect(risk.averageCorrelation).toBeGreaterThan(0.9);
    expect(risk.topContributor?.symbol).toBe("NVDA");
    expect(risk.var95).toBeLessThan(0);
    expect(risk.var95Amount).toBeGreaterThan(0);
    expect(risk.drawdown?.depth).toBeLessThan(0);
    expect(risk.effectivePositions).toBeCloseTo(1 / PORTFOLIO.rows.reduce((sum, row) => sum + (row.weight ?? 0) ** 2, 0), 10);

    const text = riskBlock(risk, PORTFOLIO, "SPY") ?? "";
    expect(text).toContain("These statistics describe past behaviour, not the future:");
    expect(text).toContain("covers all 4 USD positions");
    expect(text).toMatch(/- annualized volatility \d+\.\d%; beta to SPY \d\.\d\d; average pairwise correlation of daily returns (0\.9\d|1\.00)/);
    expect(text).toMatch(/- largest contributor to portfolio variance: NVDA, \d+% of the variance at a 23% weight/);
    expect(text).toMatch(/- 95% one-day historical value at risk: \d\.\d% of value \(about [\d,]+\.\d\d USD\)/);
    expect(text).toMatch(/- largest peak-to-trough fall: -\d+\.\d% \(from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}; /);
    expect(text).toContain("- effective number of positions 3.9 of 4");
  });

  it("starts the value series once every held symbol trades", () => {
    const series = aligned();
    const late = { ...series, closes: { ...series.closes, MSFT: series.dates.map((_, i) => (i < 200 ? null : 100 + i)) } };
    expect(portfolioRisk(late, PORTFOLIO, "SPY")?.returns).toBe(59);
  });

  it("reports coverage when a position has no history and is null when none has", () => {
    const series = aligned();
    const risk = portfolioRisk({ ...series, closes: { ...series.closes, MSFT: series.dates.map(() => null) } }, PORTFOLIO, "SPY");
    expect(risk?.missing).toEqual(["MSFT"]);
    expect(riskBlock(risk, PORTFOLIO, "SPY")).toContain("covers 3 of 4 positions, 80% of value; no history for MSFT");
    expect(risk?.notLoaded).toEqual([]);
    expect(portfolioRisk({ dates: [], closes: {} }, PORTFOLIO, "SPY")).toBeNull();
    expect(riskBlock(null, PORTFOLIO, "SPY")).toBeNull();
  });

  it("says smaller positions whose history was not loaded are not included, instead of lacking history", () => {
    const risk = portfolioRisk(aligned(), PORTFOLIO, "SPY", new Set(["JPM", "AAPL", "NVDA"]));
    expect(risk?.covered).toEqual(["JPM", "AAPL", "NVDA"]);
    expect(risk?.missing).toEqual([]);
    expect(risk?.notLoaded).toEqual(["MSFT"]);
    const text = riskBlock(risk, PORTFOLIO, "SPY") ?? "";
    expect(text).toContain("covers 3 of 4 positions, 80% of value; not included: MSFT (outside the 3 largest positions)");
    expect(text).not.toContain("no history");
    // The effective number of positions still counts every position by value.
    expect(text).toContain("- effective number of positions 3.9 of 4");
  });
});
