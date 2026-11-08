import { describe, expect, it } from "vitest";

import {
  calendarDate,
  calendarDaysUntil,
  dayChangeRatio,
  dayMovers,
  extendedHoursPnl,
  lastSessionDate,
  nextEarnings,
  pickBaseCurrency,
  topWeight,
  valuePortfolio,
  type ExtendedQuoteLike,
  type QuoteLike,
} from "./portfolio";

function quotes(entries: Record<string, QuoteLike>) {
  return (symbol: string) => entries[symbol];
}

describe("valuePortfolio", () => {
  it("values positions, weights and totals in one currency", () => {
    const portfolio = valuePortfolio(
      [
        { symbol: "AAPL", shares: 10, cost: 150 },
        { symbol: "MSFT", shares: 6, cost: 500 },
      ],
      quotes({ AAPL: { price: 200, change: 2, currency: "USD" }, MSFT: { price: 400, change: -4, currency: null } }),
    );
    expect(portfolio.baseCurrency).toBe("USD");
    expect(portfolio.rows.map((row) => row.symbol)).toEqual(["MSFT", "AAPL"]);
    const aapl = portfolio.rows.find((row) => row.symbol === "AAPL");
    expect(aapl).toMatchObject({ value: 2000, costBasis: 1500, pnl: 500, dayPnl: 20, currency: "USD" });
    expect(aapl?.pnlPct).toBeCloseTo(1 / 3);
    expect(portfolio.totals).toEqual({ value: 4400, costBasis: 4500, dayPnl: -4, pnl: -100, pnlPct: -100 / 4500 });
    expect(portfolio.rows.reduce((sum, row) => sum + (row.weight ?? 0), 0)).toBeCloseTo(1);
    expect(portfolio.foreign).toEqual([]);
    expect(portfolio.unpriced).toEqual([]);
  });

  it("keeps other currencies out of the totals instead of adding them up", () => {
    const portfolio = valuePortfolio(
      [
        { symbol: "AAPL", shares: 10, cost: 150 },
        { symbol: "NVDA", shares: 1, cost: 100 },
        { symbol: "7203.T", shares: 100, cost: 2500 },
      ],
      quotes({
        AAPL: { price: 200, change: 1, currency: "USD" },
        NVDA: { price: 180, change: 2, currency: "USD" },
        "7203.T": { price: 3000, change: 50, currency: "JPY" },
      }),
    );
    expect(portfolio.baseCurrency).toBe("USD");
    expect(portfolio.totals.value).toBe(2180);
    expect(portfolio.foreign).toHaveLength(1);
    expect(portfolio.foreign[0]).toMatchObject({ symbol: "7203.T", currency: "JPY", value: 300_000, weight: null, dayPnl: 5000 });
  });

  it("lists positions without a usable price instead of dropping them", () => {
    const portfolio = valuePortfolio(
      [
        { symbol: "AAPL", shares: 10, cost: 150 },
        { symbol: "GONE", shares: 5, cost: 20 },
        { symbol: "ZERO", shares: 1, cost: 1 },
        { symbol: "NAN", shares: 1, cost: 1 },
      ],
      quotes({ AAPL: { price: 200, change: null, currency: "USD" }, ZERO: { price: 0, change: 0, currency: "USD" }, NAN: { price: Number.NaN, change: 0, currency: "USD" } }),
    );
    expect(portfolio.unpriced.map((position) => position.symbol)).toEqual(["GONE", "ZERO", "NAN"]);
    expect(portfolio.rows.map((row) => row.symbol)).toEqual(["AAPL"]);
    expect(portfolio.totals).toMatchObject({ value: 2000, dayPnl: 0 });
    expect(portfolio.rows[0].dayPnl).toBeNull();
  });

  it("returns empty totals for an empty or unpriced portfolio", () => {
    const portfolio = valuePortfolio([{ symbol: "GONE", shares: 1, cost: 1 }], () => undefined);
    expect(portfolio.rows).toEqual([]);
    expect(portfolio.totals).toEqual({ value: 0, costBasis: 0, dayPnl: 0, pnl: 0, pnlPct: null });
    expect(portfolio.baseCurrency).toBe("USD");
  });
});

describe("pickBaseCurrency", () => {
  it("takes the most common currency and prefers USD on a tie", () => {
    expect(pickBaseCurrency([])).toBe("USD");
    expect(pickBaseCurrency(["JPY", "JPY", "USD"])).toBe("JPY");
    expect(pickBaseCurrency(["JPY", "USD"])).toBe("USD");
    expect(pickBaseCurrency(["JPY", "EUR"])).toBe("EUR");
    expect(pickBaseCurrency(["GBp", "GBP", "GBp"])).toBe("GBp");
  });
});

function book(entries: Array<[string, number, number, number, number | null]>) {
  // [symbol, shares, cost, price, change]
  return valuePortfolio(
    entries.map(([symbol, shares, cost]) => ({ symbol, shares, cost })),
    (symbol) => {
      const row = entries.find((e) => e[0] === symbol);
      return row ? { price: row[3], change: row[4], currency: "USD" } : undefined;
    },
  );
}

describe("dayChangeRatio", () => {
  it("weights the day by value at the previous close", () => {
    // AAPL 10 x 200 (+2), MSFT 6 x 400 (-4): P&L 20 - 24 = -4 on 4400 - (-4) = 4404 at the previous close.
    const portfolio = book([
      ["AAPL", 10, 150, 200, 2],
      ["MSFT", 6, 500, 400, -4],
    ]);
    expect(dayChangeRatio(portfolio.rows)).toBeCloseTo(-4 / 4404, 10);
  });

  it("differs from the equal-weighted average of the changes", () => {
    // A small position up 10% and a large one down 1%.
    const portfolio = book([
      ["SMALL", 1, 10, 11, 1],
      ["BIG", 100, 100, 99, -1],
    ]);
    const ratio = dayChangeRatio(portfolio.rows) as number;
    expect(ratio).toBeCloseTo((1 - 100) / (11 - 1 + 9900 + 100), 10);
    expect(ratio).toBeLessThan(0);
  });

  it("skips positions without a change and returns null when none has one", () => {
    const portfolio = book([
      ["AAPL", 10, 150, 200, 2],
      ["NOCHG", 5, 10, 20, null],
    ]);
    expect(dayChangeRatio(portfolio.rows)).toBeCloseTo(20 / 1980, 10);
    expect(dayChangeRatio(book([["NOCHG", 5, 10, 20, null]]).rows)).toBeNull();
    expect(dayChangeRatio([])).toBeNull();
  });
});

describe("extendedHoursPnl", () => {
  const portfolio = book([
    ["AAPL", 10, 150, 200, 2],
    ["MSFT", 6, 500, 400, -4],
    ["KO", 50, 60, 70, 0.5],
  ]);

  it("sums shares x extended change and never touches the day P&L", () => {
    const ext: Record<string, ExtendedQuoteLike> = {
      AAPL: { extendedSession: "POST", extendedChange: 1.5 },
      MSFT: { extendedSession: "POST", extendedChange: -2 },
      KO: { extendedSession: null, extendedChange: null },
    };
    const result = extendedHoursPnl(portfolio.rows, (s) => ext[s]);
    expect(result).toEqual({ session: "POST", pnl: 15 - 12, ratio: 3 / 4400, positions: 2 });
    expect(portfolio.totals.dayPnl).toBeCloseTo(20 - 24 + 25);
  });

  it("reports a mixed session and returns null without extended quotes", () => {
    const mixed = extendedHoursPnl(portfolio.rows, (s) =>
      s === "AAPL" ? { extendedSession: "PRE", extendedChange: 1 } : s === "KO" ? { extendedSession: "POST", extendedChange: 0.1 } : undefined,
    );
    expect(mixed?.session).toBe("MIXED");
    expect(mixed?.positions).toBe(2);
    expect(extendedHoursPnl(portfolio.rows, () => ({ extendedSession: "PRE", extendedChange: null }))).toBeNull();
    expect(extendedHoursPnl(portfolio.rows, () => undefined)).toBeNull();
  });
});

describe("dayMovers and topWeight", () => {
  const portfolio = book([
    ["A", 10, 1, 10, 1],
    ["B", 10, 1, 10, -3],
    ["C", 10, 1, 10, 2],
    ["D", 10, 1, 10, -1],
    ["E", 10, 1, 10, 0],
    ["F", 10, 1, 10, null],
    ["G", 10, 1, 10, 0.5],
    ["H", 10, 1, 10, 4],
  ]);

  it("ranks contributors and detractors by money", () => {
    const { contributors, detractors } = dayMovers(portfolio.rows);
    expect(contributors.map((r) => r.symbol)).toEqual(["H", "C", "A"]);
    expect(detractors.map((r) => r.symbol)).toEqual(["B", "D"]);
    expect(dayMovers(portfolio.rows, 1).contributors.map((r) => r.symbol)).toEqual(["H"]);
  });

  it("measures concentration in the largest positions", () => {
    const p = book([
      ["BIG", 1, 1, 50, 0],
      ["MID", 1, 1, 30, 0],
      ["S1", 1, 1, 10, 0],
      ["S2", 1, 1, 10, 0],
    ]);
    expect(topWeight(p.rows)).toBeCloseTo(0.9);
    expect(topWeight(p.rows, 1)).toBeCloseTo(0.5);
    expect(topWeight([])).toBeNull();
  });
});

describe("calendar days and next earnings", () => {
  // 2026-11-07 15:00 UTC is 10:00 in New York (EST).
  const now = Date.parse("2026-11-07T15:00:00Z");

  it("counts New York calendar days", () => {
    expect(calendarDate(now)).toBe(Date.UTC(2026, 10, 7));
    // 03:00 UTC on Nov 8 is still Nov 7 in New York.
    expect(calendarDaysUntil("2026-11-08T03:00:00Z", now)).toBe(0);
    expect(calendarDaysUntil("2026-11-08T21:00:00Z", now)).toBe(1);
    expect(calendarDaysUntil("2026-11-17T21:00:00Z", now)).toBe(10);
    expect(calendarDaysUntil("2026-11-05T21:00:00Z", now)).toBe(-2);
    expect(calendarDaysUntil(null, now)).toBeNull();
    expect(calendarDaysUntil("not a date", now)).toBeNull();
  });

  it("finds the earliest upcoming report within the window", () => {
    const quotes: Record<string, { nextEarningsDate: string | null; earningsDateEstimated: boolean | null }> = {
      NVDA: { nextEarningsDate: "2026-11-17T21:00:00Z", earningsDateEstimated: false },
      WMT: { nextEarningsDate: "2026-11-19T12:00:00Z", earningsDateEstimated: true },
      CSCO: { nextEarningsDate: "2026-11-12T21:00:00Z", earningsDateEstimated: true },
      OLD: { nextEarningsDate: "2026-11-01T21:00:00Z", earningsDateEstimated: false },
      NONE: { nextEarningsDate: null, earningsDateEstimated: null },
    };
    const of = (s: string) => quotes[s];
    expect(nextEarnings(Object.keys(quotes), of, now)).toEqual({ symbol: "CSCO", date: "2026-11-12T21:00:00Z", estimated: true, days: 5 });
    expect(nextEarnings(["NVDA", "WMT"], of, now)).toMatchObject({ symbol: "NVDA", days: 10, estimated: false });
    expect(nextEarnings(["NVDA", "WMT"], of, now, 7)).toBeNull();
    expect(nextEarnings(["OLD", "NONE", "MISSING"], of, now)).toBeNull();
  });
});

describe("lastSessionDate", () => {
  const rows = [{ symbol: "AAPL" }, { symbol: "MSFT" }, { symbol: "NONE" }];
  const times: Record<string, string | null> = { AAPL: "2026-11-06T21:00:00Z", MSFT: "2026-11-06T20:59:58Z", NONE: null };
  const of = (s: string) => (s in times ? { regularMarketTime: times[s] } : undefined);

  it("names the last session while the market has not traded today", () => {
    // Saturday 2026-11-07 19:30 in New York: Friday's session (16:00 New York is 21:00 UTC).
    expect(lastSessionDate(rows, of, Date.parse("2026-11-08T00:30:00Z"))).toBe(Date.UTC(2026, 10, 6));
    // Monday 08:00 in New York, before the open: still Friday.
    expect(lastSessionDate(rows, of, Date.parse("2026-11-09T13:00:00Z"))).toBe(Date.UTC(2026, 10, 6));
  });

  it("is null once a quote traded today, and without times or a clock", () => {
    // Friday 17:00 in New York (after hours): the day P&L is today's.
    expect(lastSessionDate(rows, of, Date.parse("2026-11-06T22:00:00Z"))).toBeNull();
    // One quote from today (crypto trades on weekends) makes it today.
    const mixed = (s: string) => (s === "BTC-USD" ? { regularMarketTime: "2026-11-07T23:59:00Z" } : of(s));
    expect(lastSessionDate([...rows, { symbol: "BTC-USD" }], mixed, Date.parse("2026-11-08T00:30:00Z"))).toBeNull();
    expect(lastSessionDate([{ symbol: "NONE" }, { symbol: "MISSING" }], of, Date.parse("2026-11-08T00:30:00Z"))).toBeNull();
    expect(lastSessionDate(rows, of, 0)).toBeNull();
  });
});
