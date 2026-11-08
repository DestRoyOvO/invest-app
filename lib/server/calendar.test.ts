import { beforeEach, describe, expect, it, vi } from "vitest";

import { UNIVERSE_STOCKS } from "@/lib/universe";
import type { CalendarResponse, Quote } from "@/types/api";

vi.mock("server-only", () => ({}));

const yahoo = vi.hoisted(() => ({
  getQuotes: vi.fn<(symbols: string[]) => Promise<Map<string, Quote>>>(),
  /** The quote-cache probe behind the route's charging (lib/server/charging.ts). */
  hasFreshQuote: vi.fn<(symbol: string) => boolean>(() => false),
}));
vi.mock("./yahoo", () => yahoo);

import { GET as calendarRoute } from "@/app/api/calendar/route";

import { earningsTiming, getCalendar, macroCalendarEvents, quoteEvents } from "./calendar";
import { clientIp } from "./http";
import { clientKey, consumeRateLimit, RATE_LIMITS, resetRateLimits } from "./rate-limit";

const NOW = Date.parse("2026-11-07T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function quote(symbol: string, overrides: Partial<Quote> = {}): Quote {
  return {
    symbol,
    name: `${symbol} Corp`,
    quoteType: "EQUITY",
    currency: "USD",
    exchange: "NYQ",
    marketState: "CLOSED",
    price: 100,
    change: 0,
    changePercent: 0,
    previousClose: 100,
    open: 100,
    dayHigh: 100,
    dayLow: 100,
    volume: 1,
    avgVolume: 1,
    marketCap: 1,
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

describe("earningsTiming", () => {
  it("classifies confirmed release times in New York time and leaves estimates open", () => {
    expect(earningsTiming("2027-01-14T13:30:00Z", false)).toBe("pre"); // 8:30 EST
    expect(earningsTiming("2026-11-02T21:00:00Z", false)).toBe("post"); // 16:00 EST
    expect(earningsTiming("2026-07-15T17:00:00Z", false)).toBe("intraday"); // 13:00 EDT
    expect(earningsTiming("2026-07-15T20:05:00Z", false)).toBe("post"); // 16:05 EDT
    expect(earningsTiming("2027-01-28T21:00:00Z", true)).toBeNull();
  });

  it("gives no slot to date-only values or to listings outside the US", () => {
    // UTC midnight is how Yahoo sends a date without a time; it is not a 19:00 ET release.
    expect(earningsTiming("2026-11-18T00:00:00.000Z", false)).toBeNull();
    expect(earningsTiming("2026-11-18T08:10:00.000Z", false, "0700.HK")).toBeNull();
    expect(earningsTiming("2026-11-18T13:30:00.000Z", false, "BRK-B")).toBe("pre");
    expect(earningsTiming("not a date", false)).toBeNull();
  });

  it("gives no slot to weekend dates, when there is no session", () => {
    // Berkshire reports on a Saturday; Yahoo's 21:00Z is a placeholder, not "after the close".
    expect(earningsTiming("2026-11-07T21:00:00.000Z", false, "BRK-B")).toBeNull();
    expect(earningsTiming("2026-11-08T13:30:00.000Z", false, "XYZ")).toBeNull();
    // 01:00Z on Saturday is still Friday evening in New York.
    expect(earningsTiming("2026-11-07T01:00:00.000Z", false, "XYZ")).toBe("post");
  });
});

describe("quoteEvents", () => {
  it("lists next and recent earnings and dividend payments inside the window", () => {
    const events = quoteEvents(
      quote("JPM", {
        nextEarningsDate: "2026-11-20T13:30:00.000Z",
        earningsDateEstimated: false,
        lastEarningsDate: "2026-11-06T13:30:00.000Z",
        exDividendDate: "2026-11-30T05:00:00.000Z",
        dividendAmount: 1.65,
      }),
      NOW - 2 * DAY,
      NOW + 30 * DAY,
    );
    expect(events.map((e) => [e.kind, e.at.slice(0, 10), e.timing])).toEqual([
      ["earnings", "2026-11-20", "pre"],
      ["earnings", "2026-11-06", "pre"],
      ["dividend", "2026-11-30", null],
    ]);
    expect(events[2]).toMatchObject({ amount: 1.65, symbol: "JPM", name: "JPM Corp", id: "dividend:JPM:2026-11-30" });
  });

  it("keeps the date of a Hong Kong report but no New York session slot", () => {
    const events = quoteEvents(quote("0700.HK", { currency: "HKD", nextEarningsDate: "2026-11-18T08:10:00.000Z", earningsDateEstimated: false }), NOW, NOW + 30 * DAY);
    expect(events.map((e) => [e.id, e.timing, e.estimated])).toEqual([["earnings:0700.HK:2026-11-18", null, false]]);
  });

  it("keeps one event when the next and the last report share a day", () => {
    const events = quoteEvents(
      quote("XYZ", { nextEarningsDate: "2026-11-09T21:00:00.000Z", earningsDateEstimated: false, lastEarningsDate: "2026-11-09T12:00:00.000Z" }),
      NOW - 2 * DAY,
      NOW + 30 * DAY,
    );
    expect(events.map((e) => [e.id, e.timing])).toEqual([["earnings:XYZ:2026-11-09", "post"]]);
  });

  it("skips dates outside the window", () => {
    const events = quoteEvents(quote("AAPL", { nextEarningsDate: "2027-01-28T21:00:00.000Z", earningsDateEstimated: true }), NOW, NOW + 30 * DAY);
    expect(events).toEqual([]);
  });
});

describe("macroCalendarEvents", () => {
  it("returns the scheduled releases in the window with their flags", () => {
    const events = macroCalendarEvents(Date.parse("2026-12-01T00:00:00Z"), Date.parse("2026-12-31T00:00:00Z"));
    expect(events.map((e) => [e.macro, e.at])).toEqual([
      ["jobs", "2026-12-04T13:30:00.000Z"],
      ["fomc", "2026-12-09T19:00:00.000Z"],
      ["cpi", "2026-12-10T13:30:00.000Z"],
    ]);
    expect(events[1]).toMatchObject({ projections: true, estimated: false, period: null });
    expect(events[2].period).toBe("2026-11");
  });
});

describe("getCalendar", () => {
  beforeEach(() => {
    yahoo.getQuotes.mockReset();
  });

  it("merges company and macro events in time order and lists unknown symbols", async () => {
    yahoo.getQuotes.mockResolvedValue(
      new Map([["NVDA", quote("NVDA", { nextEarningsDate: "2026-11-19T21:20:00.000Z", earningsDateEstimated: false })]]),
    );
    const calendar = await getCalendar(["NVDA", "ZZZZ"], 30, NOW);
    // Yesterday's jobs report is still inside the two-day look-back.
    expect(calendar.events.map((e) => e.id)).toEqual(["macro:jobs:2026-11-06", "macro:cpi:2026-11-10", "earnings:NVDA:2026-11-19", "macro:jobs:2026-12-04"]);
    expect(calendar.missing).toEqual(["ZZZZ"]);
    expect(calendar.macroCalendarEnds).toBe("2027-12-10T13:30:00.000Z");
  });

  it("works without symbols", async () => {
    const calendar = await getCalendar([], 7, NOW);
    expect(yahoo.getQuotes).not.toHaveBeenCalled();
    expect(calendar.events.map((e) => e.macro)).toEqual(["jobs", "cpi"]);
  });
});

describe("GET /api/calendar", () => {
  beforeEach(() => {
    yahoo.getQuotes.mockReset();
    yahoo.getQuotes.mockResolvedValue(new Map());
    resetRateLimits();
  });

  const call = (query: string) => calendarRoute(new Request(`http://localhost/api/calendar${query}`));

  it("validates days and scope", async () => {
    expect((await call("?days=0")).status).toBe(400);
    expect((await call("?days=91")).status).toBe(400);
    expect((await call("?days=abc")).status).toBe(400);
    expect((await call("?scope=world")).status).toBe(400);
  });

  it("adds the stock universe for scope=universe", async () => {
    const res = await call("?symbols=SHOP&scope=universe&days=14");
    expect(res.status).toBe(200);
    const requested = yahoo.getQuotes.mock.calls[0][0];
    expect(requested[0]).toBe("SHOP");
    expect(requested).toHaveLength(UNIVERSE_STOCKS.length + 1);
    expect(((await res.json()) as CalendarResponse).missing).toContain("SHOP");
  });

  describe("charging", () => {
    // 100 symbols outside the stock universe: with scope=universe the list passes 100 and getQuotes sends two batches.
    const LIST = Array.from({ length: 100 }, (_, i) => `ZQ${i}`).join(",");
    /** Units left in this client's market budget (reading it costs one more). */
    const remaining = () => {
      const result = consumeRateLimit(RATE_LIMITS.market, clientKey(clientIp(new Request("http://localhost/api/calendar"))));
      return result.ok ? result.remaining : 0;
    };

    beforeEach(() => {
      yahoo.hasFreshQuote.mockReset();
      yahoo.hasFreshQuote.mockReturnValue(false);
    });

    it("charges one unit for the second quote batch when the universe takes the list past 100 symbols", async () => {
      expect((await call(`?symbols=${LIST}&scope=universe`)).status).toBe(200);
      expect(yahoo.getQuotes.mock.calls[0][0]).toHaveLength(100 + UNIVERSE_STOCKS.length);
      expect(remaining()).toBe(RATE_LIMITS.market.limit - 1 - 1 - 1);
    });

    it("charges nothing extra for one batch or when the quotes are cached", async () => {
      await call(`?symbols=${LIST}`);
      expect(remaining()).toBe(RATE_LIMITS.market.limit - 1 - 1);
      resetRateLimits();
      yahoo.hasFreshQuote.mockReturnValue(true);
      await call(`?symbols=${LIST}&scope=universe`);
      expect(remaining()).toBe(RATE_LIMITS.market.limit - 1 - 1);
    });

    it("answers 429 without calling Yahoo when the budget cannot cover the second batch", async () => {
      for (let i = 0; i < RATE_LIMITS.market.limit - 1; i++) remaining();
      const res = await call(`?symbols=${LIST}&scope=universe`);
      expect(res.status).toBe(429);
      expect(yahoo.getQuotes).not.toHaveBeenCalled();
    });
  });
});
