import { describe, expect, it } from "vitest";

import type { DailyBar } from "@/lib/bars";
import type { Quote } from "@/types/api";

import { dailyVolatility, describeZ, moveBlock, moveFacts, nearestPeers, newYorkDate, trailingBeta, type MoveInput } from "./ai-move";

function quote(symbol: string, overrides: Partial<Quote> = {}): Quote {
  return {
    symbol,
    name: `${symbol} Inc.`,
    quoteType: "EQUITY",
    currency: "USD",
    exchange: "NasdaqGS",
    marketState: "CLOSED",
    price: 100,
    change: 1,
    changePercent: 1,
    previousClose: 99,
    open: null,
    dayHigh: null,
    dayLow: null,
    volume: 3_000_000,
    avgVolume: 2_000_000,
    marketCap: 1e11,
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
    regularMarketTime: "2026-11-06T21:00:00.000Z",
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

/** Closes alternating up and down by `step` around 100, one bar per day from 2026-07-01. */
function zigzag(count: number, step = 0.02, start = Date.UTC(2026, 6, 1)): DailyBar[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 * (i % 2 === 0 ? 1 : 1 + step);
    return { t: start + i * 86_400_000, o: close, h: close, l: close, c: close, adjClose: close, v: 1 };
  });
}

describe("move statistics", () => {
  it("dates a trade in New York", () => {
    expect(newYorkDate("2026-11-06T21:00:00.000Z")).toBe("2026-11-06");
    expect(newYorkDate("2026-11-07T03:00:00.000Z")).toBe("2026-11-06");
    expect(newYorkDate(null)).toBeNull();
    expect(newYorkDate("bad")).toBeNull();
  });

  it("measures daily volatility before the session of the move", () => {
    const bars = zigzag(80);
    const all = dailyVolatility(bars, null);
    expect(all).not.toBeNull();
    // Leaving out a huge last bar keeps the baseline unchanged.
    const spiked = [...bars, { ...bars[0], t: bars[79].t + 86_400_000, adjClose: 200, c: 200 }];
    const moveDate = new Date(spiked[80].t).toISOString().slice(0, 10);
    expect(dailyVolatility(spiked, moveDate)).toBeCloseTo(all as number, 12);
    expect(dailyVolatility(spiked, null)).not.toBeCloseTo(all as number, 3);
    expect(dailyVolatility(zigzag(30), null)).toBeNull();
  });

  it("computes beta on the sessions both series share", () => {
    const market = zigzag(300, 0.01);
    const stock = market.map((bar, i) => ({ ...bar, adjClose: 100 * (i % 2 === 0 ? 1 : 1.02) }));
    expect(trailingBeta(stock, market)).toBeCloseTo(2, 1);
    expect(trailingBeta(stock.slice(0, 10), market)).toBeNull();
  });

  it("picks the peers nearest in market cap, without the symbol itself", () => {
    const candidates = [
      quote("NVDA", { marketCap: 4.6e12 }),
      quote("MSFT", { marketCap: 3.5e12 }),
      quote("AAPL", { marketCap: 3.9e12 }),
      quote("AMD", { marketCap: 3e11 }),
      quote("CSCO", { marketCap: 2.5e11 }),
      quote("NOCAP", { marketCap: null }),
      quote("NOCHG", { marketCap: 4e12, changePercent: null }),
    ];
    expect(nearestPeers("NVDA", 4.6e12, candidates, 3).map((q) => q.symbol)).toEqual(["AAPL", "MSFT", "AMD"]);
    expect(nearestPeers("NVDA", null, candidates, 2).map((q) => q.symbol)).toEqual(["AAPL", "MSFT"]);
  });

  it("names how unusual a move is", () => {
    expect(describeZ(3)).toContain("unusually large");
    expect(describeZ(-1.6)).toContain("a large move");
    expect(describeZ(0.4)).toContain("usual daily range");
  });
});

describe("moveBlock", () => {
  const input: MoveInput = {
    quote: quote("NVDA", {
      price: 186.64,
      changePercent: 2.78,
      volume: 3_060_000,
      avgVolume: 2_000_000,
      extendedSession: "POST",
      extendedPrice: 187.5,
      extendedChangePercent: 0.46,
    }),
    market: quote("^GSPC", { changePercent: 0.31 }),
    sectorLabel: "Information Technology",
    sectorEtf: quote("XLK", { changePercent: 1.45 }),
    relatedEtfs: [quote("SMH", { changePercent: 3.62 }), quote("IGV", { changePercent: -0.2 })],
    peers: [quote("AVGO", { changePercent: 4.1 }), quote("AMD", { changePercent: 11.04 }), quote("MSFT", { changePercent: 0.5 })],
    beta: { value: 2.25, source: "risk report" },
    dailyVolatility: 0.021,
    session: "in the latest session (2026-11-06)",
  };

  it("precomputes the residuals against the market, the sector ETF and the peers", () => {
    const facts = moveFacts(input);
    expect(facts.impliedMove).toBeCloseTo(0.6975, 10);
    expect(facts.beyondMarket).toBeCloseTo(2.0825, 10);
    expect(facts.vsSector).toBeCloseTo(1.33, 10);
    expect(facts.peerMedian).toBe(4.1);
    expect(facts.vsPeers).toBeCloseTo(-1.32, 10);
    expect(facts.relativeVolume).toBeCloseTo(1.53, 10);
    expect(facts.zScore).toBeCloseTo(0.0278 / 0.021, 10);
  });

  it("writes the attribution in order", () => {
    const text = moveBlock(input);
    expect(text).toContain("Move breakdown for NVDA in the latest session (2026-11-06)");
    expect(text).toContain("- What moved: NVDA +2.78% to 186.64; volume 1.53x the 3-month daily average");
    expect(text).not.toContain("so far in the session");
    expect(text).toContain("- after hours: 187.50 (+0.46% from the close)");
    expect(text).toContain("- Market: S&P 500 +0.31%; with a beta of 2.25 (252 sessions against SPY, from the risk report) the market alone implies +0.70%, which leaves +2.08 pt beyond the market");
    expect(text).toContain("- Sector (Information Technology): XLK +1.45%, so NVDA moved +1.33 pt against its sector ETF; related ETFs: SMH +3.62%, IGV -0.20%");
    expect(text).toContain("- Peers nearest in market cap: AVGO +4.10%, AMD +11.04%, MSFT +0.50%; peer median +4.10%, so NVDA moved -1.32 pt against them");
    expect(text).toContain("- How unusual: daily volatility over the previous 60 sessions 2.10%, so the move is 1.3 standard deviations, within its usual daily range");
    expect(text.indexOf("- Market")).toBeLessThan(text.indexOf("- Sector"));
    expect(text.indexOf("- Sector")).toBeLessThan(text.indexOf("- Peers"));
  });

  it("degrades without beta, sector or history", () => {
    const text = moveBlock({ ...input, quote: { ...input.quote, marketState: "REGULAR" }, beta: null, sectorEtf: undefined, sectorLabel: null, peers: [], dailyVolatility: null });
    expect(text).toContain("so far in the session");
    expect(text).toContain("beta not available, so no market-implied move");
    expect(text).toContain("- Sector: not classified in the tracked sectors");
    expect(text).not.toContain("- Peers");
    expect(text).toContain("- How unusual: not enough daily history to compare");
  });
});
