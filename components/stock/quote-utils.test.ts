import { describe, expect, it } from "vitest";

import {
  daysUntil,
  earningsTiming,
  futureDate,
  isUsListing,
  liveTitle,
  parseCompare,
  positionFigures,
  quoteQuery,
  resolveTab,
  showsCoverage,
  tabsFor,
  upcomingExDividend,
} from "./quote-utils";

describe("tabs", () => {
  it("shows every tab for stocks, dividends for funds and only the overview otherwise", () => {
    expect(tabsFor("EQUITY")).toEqual(["overview", "financials", "earnings", "analysts", "dividends", "ownership"]);
    expect(tabsFor("ETF")).toEqual(["overview", "dividends"]);
    expect(tabsFor("MUTUALFUND")).toEqual(["overview", "dividends"]);
    expect(tabsFor("INDEX")).toEqual(["overview"]);
    expect(tabsFor("CRYPTOCURRENCY")).toEqual(["overview"]);
    expect(tabsFor(undefined)).toHaveLength(6);
  });

  it("falls back to the overview for a tab that is missing or does not apply", () => {
    expect(resolveTab("financials", tabsFor("EQUITY"))).toBe("financials");
    expect(resolveTab("financials", tabsFor("ETF"))).toBe("overview");
    expect(resolveTab("nonsense", tabsFor("EQUITY"))).toBe("overview");
    expect(resolveTab(null, tabsFor("EQUITY"))).toBe("overview");
  });

  it("shows the earnings and analyst panels for stocks only, and for the app's own funds and indices not even while loading", () => {
    // Known up front: the app's broad and sector ETFs, indices, currencies, futures and crypto pairs.
    for (const symbol of ["SPY", "QQQ", "XLK", "^GSPC", "EURUSD=X", "CL=F", "BTC-USD"]) expect(showsCoverage(symbol, undefined)).toBe(false);
    // Other symbols keep the panels while the quote loads (no layout jump for stocks), then follow the quote type.
    expect(showsCoverage("AAPL", undefined)).toBe(true);
    expect(showsCoverage("AAPL", "EQUITY")).toBe(true);
    expect(showsCoverage("VTI", undefined)).toBe(true);
    expect(showsCoverage("VTI", "ETF")).toBe(false);
    expect(showsCoverage("VFIAX", "MUTUALFUND")).toBe(false);
    expect(showsCoverage("^N225", "INDEX")).toBe(false);
    // Yahoo without a type: treated as a stock, like tabsFor.
    expect(showsCoverage("XYZ", null)).toBe(true);
  });

  it("builds the query string with readable commas", () => {
    expect(quoteQuery("overview", [])).toBe("");
    expect(quoteQuery("financials", [])).toBe("?tab=financials");
    expect(quoteQuery("overview", ["SPY", "XLK"])).toBe("?compare=SPY,XLK");
  });
});

describe("parseCompare", () => {
  it("normalizes, de-duplicates, drops the quote's own symbol and keeps three", () => {
    expect(parseCompare("spy, xlk,SPY,NVDA,qqq,dia", "NVDA")).toEqual(["SPY", "XLK", "QQQ"]);
    expect(parseCompare("not a symbol,^gspc", "AAPL")).toEqual(["^GSPC"]);
    expect(parseCompare(null, "AAPL")).toEqual([]);
  });
});

describe("events", () => {
  it("reads the session of a confirmed earnings release in New York time", () => {
    expect(earningsTiming("2027-01-14T13:30:00.000Z")).toBe("pre");
    expect(earningsTiming("2026-11-02T21:00:00.000Z")).toBe("post");
    expect(earningsTiming("2026-07-30T16:00:00.000Z")).toBe("intraday");
    // Apple's estimated next report keeps its usual 16:00 release time (Yahoo, 7 Nov 2026), in winter time too.
    expect(earningsTiming("2027-01-28T21:00:00.000Z")).toBe("post");
    // Midnight in New York is Yahoo's placeholder for an unknown time.
    expect(earningsTiming("2026-11-05T05:00:00.000Z")).toBeNull();
    expect(earningsTiming("2027-01-14T05:00:00.000Z")).toBeNull();
    // New York hours mean nothing for a Hong Kong listing.
    expect(earningsTiming("2026-11-18T08:00:00.000Z", false)).toBeNull();
    expect(earningsTiming("garbage")).toBeNull();
  });

  it("tells US listings from suffixed foreign ones", () => {
    expect(isUsListing("BRK-B")).toBe(true);
    expect(isUsListing("0700.HK")).toBe(false);
  });

  it("keeps a report date only while it is still ahead", () => {
    const now = Date.UTC(2026, 10, 7, 15);
    expect(futureDate("2026-11-17T21:00:00.000Z", now)).toBe("2026-11-17T21:00:00.000Z");
    expect(futureDate("2026-11-02T21:00:00.000Z", now)).toBeNull();
    expect(futureDate(null, now)).toBeNull();
    expect(futureDate("garbage", now)).toBeNull();
  });

  it("flags an ex-dividend date from today to two weeks ahead", () => {
    const now = Date.UTC(2026, 10, 7, 15);
    expect(daysUntil("2026-11-12T05:00:00.000Z", now)).toBe(5);
    expect(upcomingExDividend("2026-11-12T05:00:00.000Z", now)).toBe(true);
    expect(upcomingExDividend("2026-11-07T05:00:00.000Z", now)).toBe(true);
    expect(upcomingExDividend("2026-11-30T05:00:00.000Z", now)).toBe(false);
    expect(upcomingExDividend("2026-11-01T05:00:00.000Z", now)).toBe(false);
    expect(upcomingExDividend(null, now)).toBe(false);
  });
});

describe("liveTitle", () => {
  it("shows the price and the change with an arrow", () => {
    expect(liveTitle("NVDA", 186.64, 2.78)).toBe("NVDA 186.64 ▲2.78% · InvestSeek");
    expect(liveTitle("AAPL", 1234.5, -0.523)).toBe("AAPL 1,234.50 ▼0.52% · InvestSeek");
    expect(liveTitle("DOGE-USD", 0.12345, 0)).toBe("DOGE-USD 0.1235 0.00% · InvestSeek");
    expect(liveTitle("XYZ", null, null)).toBe("XYZ · InvestSeek");
    expect(liveTitle("XYZ", 10, null)).toBe("XYZ 10.00 · InvestSeek");
  });
});

describe("positionFigures", () => {
  it("values the position, today's P&L and the total against the average cost", () => {
    const figures = positionFigures({ shares: 40, cost: 118.5 }, 186.64, 5.04);
    expect(figures?.value).toBeCloseTo(7465.6);
    expect(figures?.dayPnl).toBeCloseTo(201.6);
    expect(figures?.pnl).toBeCloseTo(2725.6);
    expect(figures?.pnlPct).toBeCloseTo(0.575, 3);
    expect(positionFigures({ shares: 40, cost: 118.5 }, 186.64, null)?.dayPnl).toBeNull();
    expect(positionFigures({ shares: 40, cost: 118.5 }, null, 1)).toBeNull();
  });
});
