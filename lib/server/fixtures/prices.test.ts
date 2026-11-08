import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildChart } from "./chart";
import { aggregateRows, ANCHOR_DAY, dailyRows, intradayRows } from "./prices";
import { buildQuote } from "./quote";
import { securityOf, type Security } from "./securities";
import { latestCompletedSession, parseDayKey, PROFILES } from "./sessions";

const security = (symbol: string): Security => {
  const found = securityOf(symbol);
  if (!found) throw new Error(symbol);
  return found;
};

const DAY = 86_400_000;
const SATURDAY = Date.parse("2026-11-07T15:00:00Z");
const WEEK_LATER = SATURDAY + 7 * DAY;

describe("daily bars", () => {
  it("are the same on every call and for every window that contains the day", () => {
    const aapl = security("AAPL");
    const day = parseDayKey("2026-10-15");
    const narrow = dailyRows(aapl, day, day)[0];
    const wide = dailyRows(aapl, day - 400, day + 10).find((row) => row.day === day);
    const decade = dailyRows(aapl, parseDayKey("2016-01-01"), day).find((row) => row.day === day);
    expect(narrow).toEqual(wide);
    expect(narrow).toEqual(decade);
  });

  it("keep a past session's bar when the clock moves on", () => {
    const nvda = security("NVDA");
    const thisWeek = latestCompletedSession(PROFILES.us, SATURDAY);
    const nextWeek = latestCompletedSession(PROFILES.us, WEEK_LATER);
    expect(nextWeek).toBeGreaterThan(thisWeek);
    const before = dailyRows(nvda, thisWeek - 30, thisWeek);
    const after = dailyRows(nvda, thisWeek - 30, nextWeek).filter((row) => row.day <= thisWeek);
    expect(after).toEqual(before);
  });

  it("anchor each walk at its table price on 2026-01-02", () => {
    for (const symbol of ["AAPL", "SPY", "EURUSD=X", "BTC-USD"]) {
      const s = security(symbol);
      const [row] = dailyRows(s, ANCHOR_DAY, ANCHOR_DAY);
      expect(row.c / s.anchorPrice).toBeCloseTo(1, 3);
    }
  });

  it("are internally consistent and exist only on trading days", () => {
    for (const symbol of ["AAPL", "^VIX", "^TNX", "GC=F", "BTC-USD", "0700.HK"]) {
      const s = security(symbol);
      const rows = dailyRows(s, parseDayKey("2025-01-01"), parseDayKey("2026-11-06"));
      expect(rows.length).toBeGreaterThan(400);
      for (const row of rows) {
        expect(row.l).toBeLessThanOrEqual(Math.min(row.o, row.c));
        expect(row.h).toBeGreaterThanOrEqual(Math.max(row.o, row.c));
        expect(row.l).toBeGreaterThan(0);
      }
    }
    const us = dailyRows(security("AAPL"), parseDayKey("2026-11-20"), parseDayKey("2026-11-30"));
    expect(us.map((row) => new Date(row.day * DAY).toISOString().slice(0, 10))).not.toContain("2026-11-26");
  });

  it("keep ^VIX around its level and Treasury yields at a few percent", () => {
    const vix = dailyRows(security("^VIX"), parseDayKey("2016-01-01"), parseDayKey("2026-11-06")).map((row) => row.c);
    expect(Math.min(...vix)).toBeGreaterThan(8);
    expect(Math.max(...vix)).toBeLessThan(70);
    const mean = vix.reduce((sum, v) => sum + v, 0) / vix.length;
    expect(mean).toBeGreaterThan(14);
    expect(mean).toBeLessThan(21);
    for (const symbol of ["^IRX", "^FVX", "^TNX", "^TYX"]) {
      const yields = dailyRows(security(symbol), parseDayKey("2024-01-01"), parseDayKey("2026-11-06")).map((row) => row.c);
      expect(Math.min(...yields), symbol).toBeGreaterThan(1);
      expect(Math.max(...yields), symbol).toBeLessThan(8);
    }
  });

  it("keep long histories of volatile securities within 20 times their anchor price", () => {
    for (const symbol of ["MSTR", "SMCI", "PLTR", "NG=F", "CL=F", "BTC-USD", "AAPL", "^GSPC"]) {
      const s = security(symbol);
      const closes = dailyRows(s, parseDayKey("2000-01-01"), parseDayKey("2026-11-06")).map((row) => row.c);
      expect(Math.max(...closes) / s.anchorPrice, symbol).toBeLessThan(20);
      expect(Math.min(...closes) / s.anchorPrice, symbol).toBeGreaterThan(1 / 20);
    }
  });

  it("start a later listing on its first trading day", () => {
    const pltr = security("PLTR");
    const [first] = dailyRows(pltr, parseDayKey("2000-01-01"), parseDayKey("2021-01-01"));
    expect(new Date(first.day * DAY).toISOString().slice(0, 10)).toBe("2020-09-30");
    expect((buildQuote(pltr, SATURDAY)?.firstTradeDateMilliseconds as Date).toISOString()).toBe("2020-09-30T13:30:00.000Z");
    expect(dailyRows(security("AAPL"), parseDayKey("2000-01-01"), parseDayKey("2000-01-10"))[0].day).toBe(parseDayKey("2000-01-03"));
  });

  it("move a fund exactly like the index it tracks", () => {
    const from = parseDayKey("2026-09-01");
    const to = parseDayKey("2026-11-06");
    const spy = dailyRows(security("SPY"), from, to);
    const index = dailyRows(security("^GSPC"), from, to);
    for (let i = 1; i < spy.length; i++) {
      expect(spy[i].c / spy[i - 1].c).toBeCloseTo(index[i].c / index[i - 1].c, 3);
    }
  });
});

describe("weekly, monthly and intraday bars", () => {
  it("aggregate the daily bars of their period", () => {
    const aapl = security("AAPL");
    const daily = dailyRows(aapl, parseDayKey("2026-10-01"), parseDayKey("2026-10-31"));
    const [october] = aggregateRows(aapl, daily, "1mo");
    expect(october.o).toBe(daily[0].o);
    expect(october.c).toBe(daily[daily.length - 1].c);
    expect(october.h).toBe(Math.max(...daily.map((row) => row.h)));
    expect(october.l).toBe(Math.min(...daily.map((row) => row.l)));
    expect(new Date(october.t).toISOString()).toBe("2026-10-01T04:00:00.000Z");
    const weeks = aggregateRows(aapl, daily, "1wk");
    expect(new Date(weeks[1].t).toISOString()).toBe("2026-10-05T04:00:00.000Z");
  });

  it("stay inside their daily bar and match its open, high, low and close", () => {
    for (const symbol of ["AAPL", "BTC-USD", "^GSPC"]) {
      const s = security(symbol);
      const [previous, bar] = dailyRows(s, parseDayKey("2026-11-05"), parseDayKey("2026-11-06")).slice(-2);
      for (const step of [5, 15]) {
        const rows = intradayRows(s, bar, previous.c, step, false);
        expect(rows[0].o, `${symbol} ${step}m open`).toBe(bar.o);
        expect(rows[rows.length - 1].c, `${symbol} ${step}m close`).toBe(bar.c);
        expect(Math.max(...rows.map((row) => row.h))).toBe(bar.h);
        expect(Math.min(...rows.map((row) => row.l))).toBe(bar.l);
      }
    }
  });

  it("serve the latest sessions for the quote page's intraday ranges", () => {
    const oneDay = buildChart("AAPL", { period1: new Date(SATURDAY - 7 * DAY), interval: "5m", includePrePost: true }, SATURDAY);
    const quotes = oneDay.quotes as Array<{ date: Date }>;
    // Five sessions of pre-market (66), regular (78) and after-hours (48) five-minute bars.
    expect(quotes.length).toBe(5 * (66 + 78 + 48));
    expect(quotes[quotes.length - 1].date.toISOString()).toBe("2026-11-07T00:55:00.000Z");
    const meta = oneDay.meta as Record<string, unknown>;
    expect(meta.tradingPeriods).toMatchObject({ regular: expect.any(Array), pre: expect.any(Array), post: expect.any(Array) });
  });

  it("leave out extended hours for indices, as Yahoo does", () => {
    const options = { period1: new Date(SATURDAY - 7 * DAY), interval: "5m", includePrePost: true };
    for (const symbol of ["^GSPC", "^VIX", "^TNX"]) {
      const chart = buildChart(symbol, options, SATURDAY);
      // Five sessions of regular five-minute bars only.
      expect((chart.quotes as unknown[]).length, symbol).toBe(5 * 78);
      expect((chart.meta as Record<string, unknown>).hasPrePostMarketData, symbol).toBe(false);
      expect(buildQuote(security(symbol), SATURDAY)?.hasPrePostMarketData, symbol).toBe(false);
    }
    expect((buildChart("SPY", options, SATURDAY).meta as Record<string, unknown>).hasPrePostMarketData).toBe(true);
    expect(buildQuote(security("AAPL"), SATURDAY)?.hasPrePostMarketData).toBe(true);
  });

  it("agree with the quote on the latest close", () => {
    const quote = buildQuote(security("MSFT"), SATURDAY);
    const chart = buildChart("MSFT", { period1: new Date(SATURDAY - 35 * DAY), interval: "1d" }, SATURDAY);
    const last = (chart.quotes as Array<{ close: number }>).at(-1);
    expect(last?.close).toBe(quote?.regularMarketPrice);
  });
});

describe("quotes", () => {
  it("are identical at any moment between two closes", () => {
    const morning = buildQuote(security("AAPL"), Date.parse("2026-11-07T09:00:00Z"));
    const evening = buildQuote(security("AAPL"), Date.parse("2026-11-08T23:00:00Z"));
    expect(evening).toEqual(morning);
  });

  it("report the latest completed session even while the next one trades", () => {
    const duringSession = buildQuote(security("AAPL"), Date.parse("2026-11-09T16:00:00Z"));
    expect(duringSession?.marketState).toBe("REGULAR");
    expect((duringSession?.regularMarketTime as Date).toISOString()).toBe("2026-11-06T21:00:00.000Z");
  });

  it("carry the after-hours trade of the latest session, as the intraday chart draws it", () => {
    const quote = buildQuote(security("AAPL"), SATURDAY)!;
    const chart = buildChart("AAPL", { period1: new Date("2026-11-06T09:00:00Z"), interval: "1m", includePrePost: true }, SATURDAY);
    const bars = chart.quotes as Array<{ date: Date; close: number }>;
    expect(quote.postMarketPrice).toBe(bars.at(-1)?.close);
    expect((quote.postMarketTime as Date).toISOString()).toBe("2026-11-07T01:00:00.000Z");
    expect(quote.postMarketChange).toBeCloseTo((quote.postMarketPrice as number) - (quote.regularMarketPrice as number), 6);
    expect(quote.preMarketPrice).toBeUndefined();
    // An hour into the after-hours session: the trade of 17:00 New York time.
    const evening = buildQuote(security("AAPL"), Date.parse("2026-11-06T22:00:30Z"))!;
    expect(evening.marketState).toBe("POST");
    expect((evening.postMarketTime as Date).toISOString()).toBe("2026-11-06T22:00:00.000Z");
    expect(evening.postMarketPrice).toBe(bars.find((bar) => bar.date.toISOString() === "2026-11-06T21:59:00.000Z")?.close);
  });

  it("carry the next session's pre-market trade while it trades, and nothing for indices", () => {
    const monday = Date.parse("2026-11-09T13:30:00Z");
    const quote = buildQuote(security("MSFT"), monday)!;
    expect(quote.marketState).toBe("PRE");
    expect(quote.preMarketPrice).toEqual(expect.any(Number));
    expect((quote.preMarketTime as Date).getTime()).toBeLessThanOrEqual(monday);
    expect(buildQuote(security("^GSPC"), SATURDAY)?.postMarketPrice).toBeUndefined();
    // The pre-market path ends at the session's open, which the chart shows once the session is complete.
    const [bar] = dailyRows(security("MSFT"), parseDayKey("2026-11-09"), parseDayKey("2026-11-09"));
    const atOpen = buildQuote(security("MSFT"), Date.parse("2026-11-09T14:29:59Z"))!;
    expect(Math.abs((atOpen.preMarketPrice as number) - bar.o)).toBeLessThan(bar.o * 0.01);
  });
});
